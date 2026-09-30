import { Injectable, Logger } from '@nestjs/common';
import type { Notice, Prisma } from '@prisma/client';
import {
  type DashboardAnnouncement,
  type NoticeAudienceOptions,
  type NoticeDetail,
  type NoticeListResponse,
  type NoticeReceipt,
  type NoticeReceipts,
  type NoticeRow,
  type NoticeTab,
  type NoticeUpsertInput,
  type WpAudienceRule,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { EventsService } from '../../../core/registry/events.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { hasPerm } from '../../../core/auth/decorators';
import { currentTenantId, getContext, requireContext, type RequestContext } from '../../../core/context/request-context';
import { AppError, badRequest, forbidden, notFound } from '../../../core/http/errors';
import { AudienceService } from '../common/audience';
import { excerptOf, sanitizeHtml } from '../common/html';
import { dayMonth } from '../common/dates';
import {
  announcementBody,
  audienceKey,
  canRemind,
  canViewNotice,
  datesError,
  dedupeRules,
  outOfScope,
  publishTarget,
  type NoticeState,
} from './notices.rules';

type Viewer = { ctx: RequestContext; me: string | null; moderator: boolean; canPublish: boolean };
type NoticeWithFiles = Notice & { attachments: { id: string; fileId: string; name: string; sizeBytes: number; mime: string }[] };

const LIVE: NoticeState[] = ['PUBLISHED', 'EXPIRED'];
const NONE = '__none__';
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Notice board (spec §2): Global notices reach everyone; Team notices reach the selected
 * departments/projects. Publishing materialises NoticeRecipient rows (read receipts),
 * notifies the audience and refreshes their dashboards.
 */
@Injectable()
export class NoticesService {
  private readonly log = new Logger('Notices');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ── Access helpers ───────────────────────────────────────────────────────

  private viewer(): Viewer {
    const ctx = requireContext();
    const moderator = hasPerm(ctx, 'notices.publish.global');
    return { ctx, me: ctx.employeeId ?? null, moderator, canPublish: moderator || hasPerm(ctx, 'notices.publish.team') };
  }

  /** Live notices the viewer may see (moderators see every live notice). */
  private visibleWhere(v: Pick<Viewer, 'me' | 'moderator'>, personal = false): Prisma.NoticeWhereInput {
    const base: Prisma.NoticeWhereInput = { deletedAt: null, status: { in: LIVE } };
    if (v.moderator && !personal) return base;
    const or: Prisma.NoticeWhereInput[] = [{ visibility: 'GLOBAL' }];
    if (v.me) or.push({ recipients: { some: { employeeId: v.me } } }, { authorEmployeeId: v.me });
    return { ...base, OR: or };
  }

  private tabWhere(tab: NoticeTab, v: Viewer): Prisma.NoticeWhereInput {
    switch (tab) {
      case 'global':
        return { AND: [this.visibleWhere(v), { visibility: 'GLOBAL' }] };
      case 'teams':
        return {
          deletedAt: null,
          status: { in: LIVE },
          visibility: 'TEAM',
          OR: v.me ? [{ recipients: { some: { employeeId: v.me } } }, { authorEmployeeId: v.me }] : [{ id: NONE }],
        };
      case 'drafts':
        if (!v.canPublish) return { id: NONE };
        return { deletedAt: null, status: { in: ['DRAFT', 'SCHEDULED'] }, ...(v.moderator ? {} : { authorEmployeeId: v.me ?? NONE }) };
      default:
        return this.visibleWhere(v);
    }
  }

  private async load(id: string): Promise<NoticeWithFiles> {
    const n = await this.prisma.notice.findFirst({ where: { id, deletedAt: null }, include: { attachments: true } });
    if (!n) throw notFound('Notice');
    return n;
  }

  private async isRecipient(noticeId: string, employeeId: string | null): Promise<boolean> {
    if (!employeeId) return false;
    return !!(await this.prisma.noticeRecipient.findFirst({ where: { noticeId, employeeId }, select: { id: true } }));
  }

  private assertCanManage(n: Notice, v: Viewer) {
    if (!(v.moderator || (v.me && n.authorEmployeeId === v.me))) throw forbidden('Only the author or HR can change this notice');
  }

  private assertCanPublish(visibility: 'GLOBAL' | 'TEAM', v: Viewer) {
    if (visibility === 'GLOBAL' && !hasPerm(v.ctx, 'notices.publish.global')) throw new AppError(403, 'NOTICE_GLOBAL_FORBIDDEN', 'Only HR and Admin can publish global notices');
    if (visibility === 'TEAM' && !v.canPublish) throw forbidden('You cannot publish team notices');
  }

  /** Permission + team-scope check; returns the audience with server-side labels. */
  private async checkedAudience(dto: Pick<NoticeUpsertInput, 'visibility' | 'audiences'>, v: Viewer): Promise<WpAudienceRule[]> {
    this.assertCanPublish(dto.visibility, v);
    if (dto.visibility === 'GLOBAL') return [];
    const rules = dedupeRules(dto.audiences.map((r) => ({ type: r.type, refId: r.refId ?? null })));
    if (!rules.length) throw badRequest('Pick at least one team', 'NOTICE_AUDIENCE_REQUIRED');
    if (!v.moderator) {
      if (!v.me) throw forbidden();
      const bad = outOfScope(rules, await this.audience.teamsLedBy(v.me));
      if (bad.length) throw new AppError(403, 'NOTICE_AUDIENCE_OUT_OF_SCOPE', 'You can only publish to teams you lead or manage');
    }
    return this.audience.withLabels(rules);
  }

  private audienceLabel(n: Pick<Notice, 'visibility' | 'audiences'>): string {
    return n.visibility === 'GLOBAL' ? 'Everyone' : this.audience.label((n.audiences ?? []) as WpAudienceRule[]);
  }

  private async fileRows(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.fileObject.findMany({ where: { id: { in: ids } }, select: { id: true, filename: true, size: true, mime: true } });
    if (rows.length !== new Set(ids).size) throw badRequest('One of the attachments could not be found — upload it again', 'NOTICE_ATTACHMENT');
    const tooBig = rows.find((f) => f.size > 10 * 1024 * 1024);
    if (tooBig) throw badRequest(`${tooBig.filename} is larger than 10 MB`, 'NOTICE_ATTACHMENT');
    return rows;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async list(q: { tab: NoticeTab; q?: string; page: number; pageSize: number }): Promise<NoticeListResponse> {
    const v = this.viewer();
    const search: Prisma.NoticeWhereInput = q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {};
    const where: Prisma.NoticeWhereInput = { AND: [this.tabWhere(q.tab, v), search] };
    const orderBy: Prisma.NoticeOrderByWithRelationInput[] = q.tab === 'drafts' ? [{ updatedAt: 'desc' }] : [{ pinned: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }];
    const tabs: NoticeTab[] = ['all', 'global', 'teams', 'drafts'];
    const [rows, total, ...counts] = await Promise.all([
      this.prisma.notice.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { attachments: true } }),
      this.prisma.notice.count({ where }),
      ...tabs.map((t) => this.prisma.notice.count({ where: { AND: [this.tabWhere(t, v), search] } })),
    ]);
    return {
      items: await this.toRows(rows, v),
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: Object.fromEntries(tabs.map((t, i) => [t, counts[i] ?? 0])) as Record<NoticeTab, number>,
    };
  }

  private async toRows(rows: NoticeWithFiles[], v: Pick<Viewer, 'me' | 'moderator'>): Promise<NoticeRow[]> {
    const [authors, mine] = await Promise.all([
      this.audience.briefs(rows.map((r) => r.authorEmployeeId)),
      v.me && rows.length
        ? this.prisma.noticeRecipient.findMany({ where: { employeeId: v.me, noticeId: { in: rows.map((r) => r.id) } }, select: { noticeId: true, readAt: true } })
        : Promise.resolve([] as { noticeId: string; readAt: Date | null }[]),
    ]);
    const read = new Map(mine.map((m) => [m.noticeId, !!m.readAt]));
    return rows.map((r) => {
      const own = !!v.me && r.authorEmployeeId === v.me;
      const live = LIVE.includes(r.status as NoticeState);
      let myRead: boolean | null = read.has(r.id) ? read.get(r.id)! : null;
      // Global notices published before I joined: not materialised yet, still "New" for me.
      if (myRead === null && live && !own && r.visibility === 'GLOBAL') myRead = false;
      return {
        id: r.id,
        title: r.title,
        visibility: r.visibility,
        status: r.status,
        audienceLabel: this.audienceLabel(r),
        publishedAt: iso(r.publishedAt),
        publishAt: iso(r.publishAt),
        expiresAt: iso(r.expiresAt),
        pinned: r.pinned,
        hasAttachment: r.attachments.length > 0,
        canManage: v.moderator || own,
        recipientCount: r.recipientCount,
        readCount: r.readCount,
        myRead,
        authorName: authors.get(r.authorEmployeeId)?.name ?? '—',
      };
    });
  }

  async detail(id: string): Promise<NoticeDetail> {
    const v = this.viewer();
    const n = await this.load(id);
    if (!canViewNotice(n, { employeeId: v.me, moderator: v.moderator, isRecipient: await this.isRecipient(id, v.me) })) throw notFound('Notice');
    const [row] = await this.toRows([n], v);
    const author = (await this.audience.briefs([n.authorEmployeeId])).get(n.authorEmployeeId);
    return {
      ...row!,
      bodyHtml: sanitizeHtml(n.bodyHtml),
      attachments: n.attachments.map((a) => ({ fileId: a.fileId, name: a.name, sizeBytes: a.sizeBytes, mime: a.mime })),
      audiences: (n.audiences ?? []) as WpAudienceRule[],
      authorEmployeeId: n.authorEmployeeId,
      authorTitle: author ? [author.designation, author.department].filter(Boolean).join(' · ') || null : null,
      editedAt: iso(n.editedAt),
      emailRecipients: n.emailRecipients,
    };
  }

  /** Opening a notice marks it read (idempotent; readCount increments once). */
  async markRead(id: string): Promise<{ ok: true; counted: boolean }> {
    const v = this.viewer();
    const n = await this.load(id);
    if (!v.me || !LIVE.includes(n.status as NoticeState) || n.authorEmployeeId === v.me) return { ok: true, counted: false };
    let rec = await this.prisma.noticeRecipient.findFirst({ where: { noticeId: id, employeeId: v.me } });
    if (!rec) {
      // Late joiner (or audience changed after publish): add me when the audience matches.
      const matches = n.visibility === 'GLOBAL' || (await this.audience.matches(v.me, (n.audiences ?? []) as WpAudienceRule[]));
      if (!matches) {
        if (!v.moderator) throw notFound('Notice');
        return { ok: true, counted: false };
      }
      try {
        rec = await this.prisma.noticeRecipient.create({ data: { noticeId: id, employeeId: v.me, userId: v.ctx.userId ?? null } as Prisma.NoticeRecipientUncheckedCreateInput });
        await this.prisma.notice.update({ where: { id }, data: { recipientCount: { increment: 1 } } });
      } catch {
        rec = await this.prisma.noticeRecipient.findFirst({ where: { noticeId: id, employeeId: v.me } });
        if (!rec) throw notFound('Notice');
      }
    }
    const upd = await this.prisma.noticeRecipient.updateMany({ where: { id: rec.id, readAt: null }, data: { readAt: new Date() } });
    if (upd.count === 1) {
      await this.prisma.notice.update({ where: { id }, data: { readCount: { increment: 1 } } });
      const authorUser = (await this.audience.userIds([n.authorEmployeeId]))[0];
      if (authorUser) this.realtime.toUser(authorUser, 'notice:receipt', { id });
    }
    return { ok: true, counted: upd.count === 1 };
  }

  async unreadCount(): Promise<{ unread: number }> {
    const v = this.viewer();
    if (!v.me) return { unread: 0 };
    const unread = await this.prisma.noticeRecipient.count({ where: { employeeId: v.me, readAt: null, notice: { status: 'PUBLISHED', deletedAt: null } } });
    return { unread };
  }

  /** Dashboard "Announcements": top N live, unexpired notices addressed to me; pinned first. */
  async latestForMe(limit = 5): Promise<DashboardAnnouncement[]> {
    const v = this.viewer();
    const now = new Date();
    const rows = await this.prisma.notice.findMany({
      where: { AND: [this.visibleWhere(v, true), { status: 'PUBLISHED' }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      take: limit,
    });
    const mine = v.me
      ? await this.prisma.noticeRecipient.findMany({ where: { employeeId: v.me, noticeId: { in: rows.map((r) => r.id) } }, select: { noticeId: true, readAt: true } })
      : [];
    const read = new Map(mine.map((m) => [m.noticeId, !!m.readAt]));
    return rows.map((r) => ({
      id: r.id,
      scope: r.visibility === 'GLOBAL' ? 'Global' : 'Team',
      title: r.title,
      body: announcementBody(r.visibility, this.audienceLabel(r), r.excerpt),
      date: r.publishedAt ? dayMonth(r.publishedAt) : '',
      read: r.authorEmployeeId === v.me ? true : (read.get(r.id) ?? false),
    }));
  }

  async audienceOptions(): Promise<NoticeAudienceOptions> {
    const v = this.viewer();
    const [depts, projects] = await Promise.all([
      this.prisma.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.project.findMany({ where: { status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD'] }, isInternal: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, key: true } }).catch(() => []),
    ]);
    let d = depts;
    let p = projects;
    if (!v.moderator) {
      const scope = v.me ? await this.audience.teamsLedBy(v.me) : { departmentIds: [], projectIds: [] };
      d = depts.filter((x) => scope.departmentIds.includes(x.id));
      p = projects.filter((x) => scope.projectIds.includes(x.id));
    }
    return {
      canGlobal: hasPerm(v.ctx, 'notices.publish.global'),
      canTeam: v.canPublish,
      anyTeam: v.moderator,
      canPin: v.moderator,
      departments: d.map((x) => ({ value: x.id, label: x.name })),
      projects: p.map((x) => ({ value: x.id, label: `${x.name} · ${x.key}` })),
    };
  }

  async receipts(id: string): Promise<NoticeReceipts> {
    const v = this.viewer();
    const n = await this.load(id);
    this.assertCanManage(n, v);
    const recs = await this.prisma.noticeRecipient.findMany({ where: { noticeId: id }, orderBy: [{ readAt: 'asc' }, { addedAt: 'asc' }] });
    const people = await this.audience.briefs(recs.map((r) => r.employeeId));
    const map = (r: (typeof recs)[number]): NoticeReceipt => {
      const b = people.get(r.employeeId);
      return { employeeId: r.employeeId, name: b?.name ?? 'Former employee', initials: b?.initials ?? '?', department: b?.department ?? null, readAt: iso(r.readAt), exited: !b || b.status === 'EXITED' };
    };
    const read = recs.filter((r) => r.readAt).map(map);
    const unread = recs.filter((r) => !r.readAt).map(map).sort((a, b) => a.name.localeCompare(b.name));
    return {
      recipientCount: n.recipientCount,
      readCount: n.readCount,
      read,
      unread,
      canRemind: n.status === 'PUBLISHED' && unread.some((u) => !u.exited) && canRemind(n.lastRemindedAt, new Date()),
      lastRemindedAt: iso(n.lastRemindedAt),
    };
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async create(dto: NoticeUpsertInput): Promise<NoticeDetail> {
    const v = this.viewer();
    if (!v.me) throw new AppError(400, 'NO_EMPLOYEE', 'Your account is not linked to an employee record');
    const audiences = await this.checkedAudience(dto, v);
    const publishAt = dto.publishAt ? new Date(dto.publishAt) : null;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const err = datesError(publishAt, expiresAt, new Date());
    if (err) throw badRequest(err, 'NOTICE_DATES');
    const bodyHtml = sanitizeHtml(dto.bodyHtml);
    const files = await this.fileRows(dto.attachmentFileIds);
    if (dto.action === 'publish') await this.assertAudienceNotEmpty({ visibility: dto.visibility, audiences: audiences as Prisma.JsonValue, authorEmployeeId: v.me }, dto.force);
    const tenantId = currentTenantId();
    const n = await this.prisma.notice.create({
      data: {
        title: dto.title,
        bodyHtml,
        excerpt: excerptOf(bodyHtml, 300),
        visibility: dto.visibility,
        status: 'DRAFT',
        authorEmployeeId: v.me,
        audiences: audiences as Prisma.InputJsonValue,
        publishAt,
        expiresAt,
        pinned: v.moderator ? dto.pinned : false,
        emailRecipients: dto.emailRecipients ?? dto.visibility === 'GLOBAL',
        attachments: { create: files.map((f) => ({ tenantId, fileId: f.id, name: f.filename, sizeBytes: f.size, mime: f.mime })) },
      } as Prisma.NoticeUncheckedCreateInput,
    });
    await this.audit.record({ action: 'notice.create', entity: 'Notice', entityId: n.id, meta: { title: n.title, visibility: n.visibility } });
    if (dto.action === 'publish') return this.publish(n.id, true);
    return this.detail(n.id);
  }

  /** 409 before any write when the audience resolves to nobody (the UI confirms, then sends force). */
  private async assertAudienceNotEmpty(n: Pick<Notice, 'visibility' | 'audiences' | 'authorEmployeeId'>, force: boolean) {
    if (force) return;
    if (!(await this.resolveRecipients(n)).length) throw new AppError(409, 'NOTICE_AUDIENCE_EMPTY', 'Nobody is in this audience yet. Publish anyway?');
  }

  async update(id: string, dto: NoticeUpsertInput): Promise<NoticeDetail> {
    const v = this.viewer();
    const n = await this.load(id);
    this.assertCanManage(n, v);
    if (n.status === 'ARCHIVED') throw badRequest('Archived notices cannot be edited', 'NOTICE_STATE');
    const live = LIVE.includes(n.status as NoticeState);
    let audiences = (n.audiences ?? []) as WpAudienceRule[];
    if (live) {
      const same = dto.visibility === n.visibility && audienceKey(dto.visibility === 'GLOBAL' ? [] : dto.audiences) === audienceKey(audiences);
      if (!same) throw badRequest('The audience cannot change after publishing. Archive this notice and publish a new one.', 'NOTICE_AUDIENCE_LOCKED');
    } else {
      audiences = await this.checkedAudience(dto, v);
    }
    const publishAt = live ? n.publishAt : dto.publishAt ? new Date(dto.publishAt) : null;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const err = datesError(live ? null : publishAt, expiresAt, new Date());
    if (err) throw badRequest(err, 'NOTICE_DATES');
    const bodyHtml = sanitizeHtml(dto.bodyHtml);
    const files = await this.fileRows(dto.attachmentFileIds);
    if (!live && dto.action === 'publish') await this.assertAudienceNotEmpty({ visibility: dto.visibility, audiences: audiences as Prisma.JsonValue, authorEmployeeId: n.authorEmployeeId }, dto.force);
    const changed = [
      dto.title !== n.title && 'title',
      bodyHtml !== n.bodyHtml && 'body',
      audienceKey(files.map((f) => ({ type: 'EMPLOYEE' as const, refId: f.id }))) !== audienceKey(n.attachments.map((a) => ({ type: 'EMPLOYEE' as const, refId: a.fileId }))) && 'attachments',
      iso(expiresAt) !== iso(n.expiresAt) && 'expiresAt',
    ].filter(Boolean);
    const tenantId = currentTenantId();
    await this.prisma.$transaction([
      this.prisma.notice.update({
        where: { id },
        data: {
          title: dto.title,
          bodyHtml,
          excerpt: excerptOf(bodyHtml, 300),
          expiresAt,
          ...(live ? { editedAt: new Date(), ...(n.status === 'EXPIRED' && (!expiresAt || expiresAt > new Date()) ? { status: 'PUBLISHED' as const } : {}) } : { visibility: dto.visibility, audiences: audiences as Prisma.InputJsonValue, publishAt }),
          ...(v.moderator ? { pinned: dto.pinned } : {}),
          ...(dto.emailRecipients !== undefined && !live ? { emailRecipients: dto.emailRecipients } : {}),
        },
      }),
      this.prisma.noticeAttachment.deleteMany({ where: { noticeId: id } }),
      this.prisma.noticeAttachment.createMany({ data: files.map((f) => ({ tenantId, noticeId: id, fileId: f.id, name: f.filename, sizeBytes: f.size, mime: f.mime })) }),
    ]);
    await this.audit.record({ action: 'notice.update', entity: 'Notice', entityId: id, meta: { changed } as Prisma.InputJsonValue });
    if (!live && dto.action === 'publish') return this.publish(id, true);
    return this.detail(id);
  }

  /** DRAFT/SCHEDULED → PUBLISHED now, or SCHEDULED when publishAt is in the future. */
  async publish(id: string, force = false): Promise<NoticeDetail> {
    const v = this.viewer();
    const n = await this.load(id);
    this.assertCanManage(n, v);
    if (n.status !== 'DRAFT' && n.status !== 'SCHEDULED') throw badRequest('This notice is already published', 'NOTICE_STATE');
    this.assertCanPublish(n.visibility, v);
    const ids = await this.resolveRecipients(n);
    if (!ids.length) await this.assertAudienceNotEmpty(n, force);
    if (publishTarget(n.publishAt, new Date()) === 'SCHEDULED') {
      await this.prisma.notice.update({ where: { id }, data: { status: 'SCHEDULED' } });
      await this.audit.record({ action: 'notice.schedule', entity: 'Notice', entityId: id, meta: { publishAt: iso(n.publishAt) } });
      return this.detail(id);
    }
    await this.goLive(n, ids);
    return this.detail(id);
  }

  private async resolveRecipients(n: Pick<Notice, 'visibility' | 'audiences' | 'authorEmployeeId'>): Promise<string[]> {
    const rules: WpAudienceRule[] = n.visibility === 'GLOBAL' ? [{ type: 'ALL' }] : ((n.audiences ?? []) as WpAudienceRule[]);
    return (await this.audience.resolve(rules)).filter((x) => x !== n.authorEmployeeId);
  }

  /** Claim the row (DRAFT/SCHEDULED → PUBLISHED), materialise receipts, notify. Used by the scheduler too. */
  private async goLive(n: Notice, recipientIds?: string[]): Promise<boolean> {
    const claimed = await this.prisma.notice.updateMany({ where: { id: n.id, status: { in: ['DRAFT', 'SCHEDULED'] } }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    if (!claimed.count) return false;
    const ids = recipientIds ?? (await this.resolveRecipients(n));
    const emps = ids.length ? await this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true } }) : [];
    const tenantId = currentTenantId();
    if (emps.length) {
      await this.prisma.noticeRecipient.createMany({ data: emps.map((e) => ({ tenantId, noticeId: n.id, employeeId: e.id, userId: e.userId })), skipDuplicates: true });
    }
    const recipientCount = await this.prisma.noticeRecipient.count({ where: { noticeId: n.id } });
    await this.prisma.notice.update({ where: { id: n.id }, data: { recipientCount } });
    const userIds = emps.map((e) => e.userId).filter((x): x is string => !!x);
    const author = (await this.audience.briefs([n.authorEmployeeId])).get(n.authorEmployeeId);
    await this.notifications
      .notify({
        userIds,
        type: 'notice.published',
        title: n.visibility === 'GLOBAL' ? `New notice: ${n.title}` : `New team notice: ${n.title}`,
        body: excerptOf(n.bodyHtml, 160) || undefined,
        link: `/notices?open=${n.id}`,
        from: author?.name,
        email: n.emailRecipients,
      })
      .catch((e) => this.log.warn(`notice ${n.id} notify failed: ${(e as Error).message}`));
    this.realtime.toUsers(userIds, 'dashboard:invalidate', { sections: ['announcements'] });
    this.realtime.toUsers(userIds, 'notice:new', { id: n.id });
    await this.audit.record({ action: 'notice.publish', entity: 'Notice', entityId: n.id, meta: { recipientCount } });
    this.events.emit('notice.published', { noticeId: n.id, recipientCount });
    return true;
  }

  async unschedule(id: string): Promise<NoticeDetail> {
    const v = this.viewer();
    const n = await this.load(id);
    this.assertCanManage(n, v);
    if (n.status !== 'SCHEDULED') throw badRequest('Only scheduled notices can be unscheduled', 'NOTICE_STATE');
    await this.prisma.notice.update({ where: { id }, data: { status: 'DRAFT' } });
    await this.audit.record({ action: 'notice.unschedule', entity: 'Notice', entityId: id });
    return this.detail(id);
  }

  async archive(id: string): Promise<{ ok: true }> {
    const v = this.viewer();
    const n = await this.load(id);
    this.assertCanManage(n, v);
    if (!LIVE.includes(n.status as NoticeState)) throw badRequest('Only published notices can be archived — delete drafts instead', 'NOTICE_STATE');
    await this.prisma.notice.update({ where: { id }, data: { status: 'ARCHIVED', pinned: false } });
    await this.audit.record({ action: 'notice.archive', entity: 'Notice', entityId: id });
    return { ok: true };
  }

  async remove(id: string): Promise<{ ok: true }> {
    const v = this.viewer();
    const n = await this.load(id);
    this.assertCanManage(n, v);
    if (n.status !== 'DRAFT' && n.status !== 'SCHEDULED') throw badRequest('Published notices cannot be deleted — archive them instead', 'NOTICE_STATE');
    await this.prisma.notice.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ action: 'notice.delete', entity: 'Notice', entityId: id });
    return { ok: true };
  }

  async setPinned(id: string, pinned: boolean): Promise<{ ok: true }> {
    const v = this.viewer();
    if (!v.moderator) throw forbidden('Only HR and Admin can pin notices');
    const n = await this.load(id);
    if (pinned && n.status !== 'PUBLISHED') throw badRequest('Only live notices can be pinned', 'NOTICE_STATE');
    await this.prisma.notice.update({ where: { id }, data: { pinned } });
    await this.audit.record({ action: 'notice.pin', entity: 'Notice', entityId: id, meta: { pinned } });
    return { ok: true };
  }

  async remindUnread(id: string): Promise<{ reminded: number }> {
    const v = this.viewer();
    const n = await this.load(id);
    this.assertCanManage(n, v);
    if (n.status !== 'PUBLISHED') throw badRequest('Only live notices can send reminders', 'NOTICE_STATE');
    if (!canRemind(n.lastRemindedAt, new Date())) throw new AppError(429, 'NOTICE_REMIND_THROTTLED', 'A reminder was already sent in the last 24 hours');
    const recs = await this.prisma.noticeRecipient.findMany({ where: { noticeId: id, readAt: null }, select: { employeeId: true } });
    const active = await this.prisma.employee.findMany({ where: { id: { in: recs.map((r) => r.employeeId) }, status: { not: 'EXITED' } }, select: { userId: true } });
    const userIds = active.map((e) => e.userId).filter((x): x is string => !!x);
    await this.notifications.notify({ userIds, type: 'notice.reminder', title: `Reminder: please read "${n.title}"`, link: `/notices?open=${id}` });
    await this.prisma.notice.update({ where: { id }, data: { lastRemindedAt: new Date() } });
    await this.audit.record({ action: 'notice.remind', entity: 'Notice', entityId: id, meta: { reminded: userIds.length } });
    return { reminded: userIds.length };
  }

  // ── System (scheduler, late joiners, file access) ───────────────────────

  /** Every minute: SCHEDULED notices whose publishAt has passed go live. */
  async publishDue(): Promise<number> {
    const due = await this.prisma.notice.findMany({ where: { status: 'SCHEDULED', deletedAt: null, publishAt: { lte: new Date() } }, take: 50 });
    let n = 0;
    for (const row of due) if (await this.goLive(row)) n++;
    return n;
  }

  /** Every 15 minutes: PUBLISHED → EXPIRED once expiresAt passes. */
  async expireDue(): Promise<number> {
    const r = await this.prisma.notice.updateMany({ where: { status: 'PUBLISHED', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED', pinned: false } });
    return r.count;
  }

  /** Late joiners: add the employee to every live, unexpired notice whose audience now matches. */
  async syncRecipientsFor(employeeId: string): Promise<number> {
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, userId: true, status: true } });
    if (!emp || !['ACTIVE', 'NOTICE_PERIOD'].includes(emp.status)) return 0;
    const now = new Date();
    const live = await this.prisma.notice.findMany({ where: { status: 'PUBLISHED', deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], NOT: { authorEmployeeId: employeeId } } });
    const have = new Set((await this.prisma.noticeRecipient.findMany({ where: { employeeId, noticeId: { in: live.map((x) => x.id) } }, select: { noticeId: true } })).map((r) => r.noticeId));
    const tenantId = currentTenantId();
    let added = 0;
    for (const n of live) {
      if (have.has(n.id)) continue;
      const ok = n.visibility === 'GLOBAL' || (await this.audience.matches(employeeId, (n.audiences ?? []) as WpAudienceRule[]));
      if (!ok) continue;
      const r = await this.prisma.noticeRecipient.createMany({ data: [{ tenantId, noticeId: n.id, employeeId, userId: emp.userId }], skipDuplicates: true });
      if (r.count) {
        await this.prisma.notice.update({ where: { id: n.id }, data: { recipientCount: { increment: 1 } } });
        added++;
      }
    }
    return added;
  }

  /** File access hook: attachments of a notice the current user can open. */
  async canOpenAttachment(fileId: string): Promise<boolean> {
    const ctx = getContext();
    if (!ctx) return false;
    const att = await this.prisma.noticeAttachment.findFirst({ where: { fileId }, include: { notice: true } });
    if (!att) return false;
    const me = ctx.employeeId ?? null;
    return canViewNotice(att.notice, { employeeId: me, moderator: hasPerm(ctx, 'notices.publish.global'), isRecipient: await this.isRecipient(att.noticeId, me) });
  }

  /** Header search: live notices I can see. */
  async search(q: string, ctx: RequestContext) {
    const v = { me: ctx.employeeId ?? null, moderator: hasPerm(ctx, 'notices.publish.global') };
    const rows = await this.prisma.notice.findMany({ where: { AND: [this.visibleWhere(v), { title: { contains: q, mode: 'insensitive' } }] }, orderBy: { publishedAt: 'desc' }, take: 6 });
    return rows.map((r) => ({ type: 'Notices', id: r.id, title: r.title, subtitle: `${r.visibility === 'GLOBAL' ? 'Global' : 'Team'} notice · ${r.publishedAt ? dayMonth(r.publishedAt) : ''}`, link: `/notices?open=${r.id}` }));
  }
}
