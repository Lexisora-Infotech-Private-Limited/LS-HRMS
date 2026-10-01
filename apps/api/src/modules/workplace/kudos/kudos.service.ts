import { Injectable, Logger } from '@nestjs/common';
import type { Badge, EotmAward, Kudos, Prisma } from '@prisma/client';
import {
  type BadgeRow,
  type BadgeUpsertInput,
  type EmployeeBadge,
  type EotmCreateInput,
  type EotmOptions,
  type EotmRow,
  type KudosCreateInput,
  type KudosListResponse,
  type KudosRow,
  type KudosTab,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { EventsService } from '../../../core/registry/events.service';
import { hasPerm } from '../../../core/auth/decorators';
import { currentTenantId, requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../../core/http/errors';
import { AudienceService } from '../common/audience';
import { CertificatesService } from '../common/certificates.service';
import { excerptOf } from '../common/html';
import { dayMonth, istInstant, monthLabel, todayKey } from '../common/dates';
import { FeedService } from '../feed/feed.service';
import { eotmEligible, eotmMonthError, eotmMonthOptions, eotmPostBody, kudosLimitError, kudosPostBody, kudosPostTitle, topBadge } from './kudos.rules';

export const EOTM_BADGE = 'Employee of the Month';
const DAY = 86_400_000;

/**
 * Kudos & Employee of the Month (spec §4): badges given by leads/managers/HR post to the feed
 * and alert the recipient; HR/Admin announce one EOTM per month with a verifiable certificate.
 * Profile badges (people domain) read the Kudos rows directly.
 */
@Injectable()
export class KudosService {
  private readonly log = new Logger('Kudos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly certificates: CertificatesService,
    private readonly feed: FeedService,
  ) {}

  private viewer() {
    const ctx = requireContext();
    return { ctx, me: ctx.employeeId ?? null, moderator: hasPerm(ctx, 'kudos.eotm') || hasPerm(ctx, 'feed.publish') };
  }

  /** The system "Employee of the Month" badge (created on first use). */
  private async eotmBadge(): Promise<Badge> {
    const b = await this.prisma.badge.findFirst({ where: { name: EOTM_BADGE } });
    if (b) return b;
    return this.prisma.badge.create({ data: { name: EOTM_BADGE, icon: 'trophy', description: 'Announced monthly by HR', system: true } as Prisma.BadgeUncheckedCreateInput });
  }

  // ── Kudos ────────────────────────────────────────────────────────────────

  private tabWhere(tab: KudosTab, me: string | null): Prisma.KudosWhereInput {
    const base: Prisma.KudosWhereInput = { revokedAt: null };
    if (tab === 'given') return { ...base, giverEmployeeId: me ?? '__none__' };
    if (tab === 'received') return { ...base, recipientEmployeeId: me ?? '__none__' };
    return base;
  }

  async list(tab: KudosTab, page: number, pageSize: number): Promise<KudosListResponse> {
    const v = this.viewer();
    const where = this.tabWhere(tab, v.me);
    const monthStart = istInstant(`${todayKey().slice(0, 7)}-01`, '00:00');
    const [rows, total, all, given, received, month, current] = await Promise.all([
      this.prisma.kudos.findMany({ where, include: { badge: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.kudos.count({ where }),
      this.prisma.kudos.count({ where: this.tabWhere('all', v.me) }),
      this.prisma.kudos.count({ where: this.tabWhere('given', v.me) }),
      this.prisma.kudos.count({ where: this.tabWhere('received', v.me) }),
      this.prisma.kudos.findMany({ where: { revokedAt: null, createdAt: { gte: monthStart }, badge: { system: false } }, include: { badge: true } }),
      this.currentAward(),
    ]);
    const top = topBadge(month.map((k) => ({ badge: k.badge.name, createdAt: k.createdAt })));
    return {
      items: await this.rows(rows, v),
      total,
      page,
      pageSize,
      counts: { all, given, received },
      kpis: { thisMonth: month.length, topBadge: top?.name ?? null, topBadgeCount: top?.count ?? 0, eotm: current ? { name: current.name, month: current.monthLabel } : null },
    };
  }

  private async rows(rows: (Kudos & { badge: Badge })[], v: { me: string | null; moderator: boolean }): Promise<KudosRow[]> {
    const people = await this.audience.briefs(rows.flatMap((r) => [r.giverEmployeeId, r.recipientEmployeeId]));
    const awards = await this.prisma.eotmAward.findMany({ where: { postId: { in: rows.map((r) => r.postId).filter((x): x is string => !!x) } } });
    const now = Date.now();
    return rows.map((r) => {
      const award = r.badge.system ? awards.find((a) => a.postId === r.postId) : undefined;
      return {
        id: r.id,
        employee: people.get(r.recipientEmployeeId)?.name ?? '—',
        employeeId: r.recipientEmployeeId,
        badge: r.badge.name,
        from: people.get(r.giverEmployeeId)?.name ?? '—',
        message: r.message,
        date: dayMonth(r.createdAt),
        isEotm: r.badge.system,
        certificateId: award && !award.revokedAt ? award.certificateId : null,
        canRevoke: !r.badge.system && !r.revokedAt && (v.moderator || (!!v.me && r.giverEmployeeId === v.me && now - r.createdAt.getTime() <= DAY)),
      };
    });
  }

  async give(dto: KudosCreateInput): Promise<KudosRow> {
    const v = this.viewer();
    if (!v.me) throw forbidden('Only employees can give kudos');
    const me = v.me;
    const [recipient, badge] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: dto.recipientEmployeeId }, select: { id: true, fullName: true, firstName: true, status: true, userId: true } }),
      this.prisma.badge.findUnique({ where: { id: dto.badgeId } }),
    ]);
    if (!recipient || !['ACTIVE', 'NOTICE_PERIOD'].includes(recipient.status)) throw badRequest('Pick an active employee', 'KUDOS_RECIPIENT');
    if (!badge || !badge.active || badge.system) throw badRequest('Pick a badge', 'KUDOS_BADGE');
    const now = new Date();
    const recent = await this.prisma.kudos.findMany({ where: { giverEmployeeId: me, revokedAt: null, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } }, select: { recipientEmployeeId: true, badgeId: true, createdAt: true } });
    const err = kudosLimitError({ giverId: me, recipientId: recipient.id, badgeId: badge.id, recipientName: recipient.fullName, recent, now });
    if (err) throw new AppError(err.status, err.code, err.message);
    const tenantId = currentTenantId();
    const body = kudosPostBody(dto.message);
    const { kudos, post } = await this.prisma.$transaction(async (tx) => {
      const kudos = await tx.kudos.create({ data: { tenantId, giverEmployeeId: me, recipientEmployeeId: recipient.id, badgeId: badge.id, message: dto.message } });
      const post = await tx.post.create({
        data: { tenantId, kind: 'KUDOS', status: 'PUBLISHED', title: kudosPostTitle(badge.name, recipient.fullName), bodyHtml: body, excerpt: excerptOf(body, 300), authorEmployeeId: me, publishedAt: now, publishedByEmployeeId: me, kudosId: kudos.id },
      });
      await tx.kudos.update({ where: { id: kudos.id }, data: { postId: post.id } });
      return { kudos, post };
    });
    const giver = (await this.audience.briefs([me])).get(me);
    if (recipient.userId) {
      await this.notifications.notify({
        userIds: [recipient.userId],
        type: 'kudos.received',
        title: `${giver?.name ?? 'Someone'} gave you the ${badge.name} badge`,
        body: dto.message,
        link: '/kudos?tab=received',
        from: giver?.name ?? 'Kudos',
        email: true,
      });
    }
    await this.audit.record({ action: 'kudos.give', entity: 'Kudos', entityId: kudos.id, meta: { recipient: recipient.fullName, badge: badge.name } });
    await this.feed.afterPublish(post, { notify: false });
    this.events.emit('kudos.given', { kudosId: kudos.id, employeeId: recipient.id, badge: badge.name });
    const [row] = await this.rows([{ ...kudos, postId: post.id, badge }], v);
    return row!;
  }

  async revoke(id: string, reason: string | null) {
    const v = this.viewer();
    const k = await this.prisma.kudos.findUnique({ where: { id }, include: { badge: true } });
    if (!k || k.revokedAt) throw notFound('Kudos');
    if (k.badge.system) throw badRequest('Revoke the Employee of the Month award instead', 'KUDOS_EOTM');
    const own = !!v.me && k.giverEmployeeId === v.me && Date.now() - k.createdAt.getTime() <= DAY;
    if (!own && !v.moderator) throw forbidden('Kudos can be withdrawn by the giver within 24 hours, or by HR');
    await this.prisma.kudos.update({ where: { id }, data: { revokedAt: new Date() } });
    if (k.postId) await this.prisma.post.updateMany({ where: { id: k.postId }, data: { status: 'ARCHIVED', pinned: false } });
    await this.audit.record({ action: 'kudos.revoke', entity: 'Kudos', entityId: id, meta: { reason } });
    this.events.emit('kudos.revoked', { kudosId: id, employeeId: k.recipientEmployeeId });
    return { ok: true as const };
  }

  // ── Badges ───────────────────────────────────────────────────────────────

  async badges(): Promise<BadgeRow[]> {
    const v = this.viewer();
    await this.eotmBadge();
    const [rows, uses] = await Promise.all([
      this.prisma.badge.findMany({ where: v.moderator ? {} : { active: true }, orderBy: [{ system: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.kudos.groupBy({ by: ['badgeId'], where: { revokedAt: null }, _count: { _all: true } }),
    ]);
    return rows.map((b) => ({ id: b.id, name: b.name, icon: b.icon, description: b.description, system: b.system, active: b.active, uses: uses.find((u) => u.badgeId === b.id)?._count._all ?? 0 }));
  }

  async saveBadge(id: string | null, dto: BadgeUpsertInput): Promise<BadgeRow[]> {
    const clash = await this.prisma.badge.findFirst({ where: { name: { equals: dto.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw conflict('A badge with this name already exists', 'BADGE_EXISTS');
    if (id) {
      const b = await this.prisma.badge.findUnique({ where: { id } });
      if (!b) throw notFound('Badge');
      if (b.system) throw badRequest('The Employee of the Month badge cannot be changed', 'BADGE_SYSTEM');
      await this.prisma.badge.update({ where: { id }, data: { name: dto.name, icon: dto.icon, description: dto.description, active: dto.active } });
    } else {
      await this.prisma.badge.create({ data: { name: dto.name, icon: dto.icon, description: dto.description, active: dto.active } as Prisma.BadgeUncheckedCreateInput });
    }
    await this.audit.record({ action: 'badge.save', entity: 'Badge', entityId: id, meta: { name: dto.name, active: dto.active } });
    return this.badges();
  }

  /** Distinct badges an employee has earned, with counts (profile header tags). */
  async employeeBadges(employeeId: string): Promise<EmployeeBadge[]> {
    const rows = await this.prisma.kudos.findMany({ where: { recipientEmployeeId: employeeId, revokedAt: null }, include: { badge: true }, orderBy: { createdAt: 'desc' } });
    const by = new Map<string, EmployeeBadge>();
    for (const r of rows) {
      const x = by.get(r.badgeId) ?? { badgeId: r.badgeId, name: r.badge.name, icon: r.badge.icon, count: 0, lastAt: r.createdAt.toISOString() };
      x.count++;
      by.set(r.badgeId, x);
    }
    return [...by.values()];
  }

  // ── Employee of the Month ────────────────────────────────────────────────

  private async eotmRows(awards: EotmAward[]): Promise<EotmRow[]> {
    const people = await this.audience.briefs(awards.flatMap((a) => [a.employeeId, a.announcedByEmployeeId]));
    const certs = await this.prisma.certificate.findMany({ where: { id: { in: awards.map((a) => a.certificateId).filter((x): x is string => !!x) } }, select: { id: true, status: true } });
    return awards.map((a) => ({
      id: a.id,
      month: a.month,
      monthLabel: monthLabel(a.month),
      employeeId: a.employeeId,
      name: people.get(a.employeeId)?.name ?? '—',
      citation: a.citation,
      announcedBy: people.get(a.announcedByEmployeeId)?.name ?? '—',
      announcedAt: a.createdAt.toISOString(),
      postId: a.postId,
      certificateId: a.certificateId,
      certificateStatus: certs.find((c) => c.id === a.certificateId)?.status ?? null,
      revoked: !!a.revokedAt,
    }));
  }

  /** This month's award, else the latest earlier one. */
  async currentAward(): Promise<EotmRow | null> {
    const month = todayKey().slice(0, 7);
    const a = await this.prisma.eotmAward.findFirst({ where: { revokedAt: null, month: { lte: month } }, orderBy: { month: 'desc' } });
    return a ? ((await this.eotmRows([a]))[0] ?? null) : null;
  }

  async eotmList(year?: number): Promise<EotmRow[]> {
    const where: Prisma.EotmAwardWhereInput = year ? { month: { startsWith: `${year}-` } } : {};
    return this.eotmRows(await this.prisma.eotmAward.findMany({ where, orderBy: { month: 'desc' }, take: 36 }));
  }

  async eotmOptions(): Promise<EotmOptions> {
    const months = eotmMonthOptions(todayKey());
    const taken = await this.prisma.eotmAward.findMany({ where: { month: { in: months }, revokedAt: null }, select: { month: true } });
    return { months: months.map((m) => ({ value: m, label: monthLabel(m), taken: taken.some((t) => t.month === m) })), current: await this.currentAward() };
  }

  async announce(dto: EotmCreateInput): Promise<EotmRow> {
    const v = this.viewer();
    if (!v.me) throw forbidden('Only employees can announce awards');
    const me = v.me;
    const monthErr = eotmMonthError(dto.month, todayKey());
    if (monthErr) throw new AppError(monthErr.status, monthErr.code, monthErr.message);
    const emp = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true, fullName: true, firstName: true, status: true, joiningDate: true, exitDate: true, userId: true } });
    if (!emp || !eotmEligible(emp, dto.month)) throw badRequest('Pick an employee who was active during that month', 'EOTM_RECIPIENT');
    const existing = await this.prisma.eotmAward.findFirst({ where: { month: dto.month } });
    if (existing && !existing.revokedAt) throw conflict(`Employee of the Month for ${monthLabel(dto.month)} has already been announced`, 'EOTM_EXISTS');
    const badge = await this.eotmBadge();
    const tenantId = currentTenantId();
    const now = new Date();
    const body = eotmPostBody(dto.citation);
    const { award, post } = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        // A revoked award frees the month: keep the history on the archived post/certificate.
        await tx.post.updateMany({ where: { eotmAwardId: existing.id }, data: { eotmAwardId: null } });
        await tx.eotmAward.delete({ where: { id: existing.id } });
      }
      const award = await tx.eotmAward.create({ data: { tenantId, employeeId: emp.id, month: dto.month, citation: dto.citation, announcedByEmployeeId: me } });
      // The newest EOTM post is pinned; earlier EOTM posts are unpinned.
      await tx.post.updateMany({ where: { kind: 'EOTM', pinned: true }, data: { pinned: false } });
      const pinnedOthers = await tx.post.count({ where: { pinned: true, status: 'PUBLISHED', deletedAt: null } });
      const post = await tx.post.create({
        data: { tenantId, kind: 'EOTM', status: 'PUBLISHED', title: `Employee of the Month: ${emp.fullName}`, bodyHtml: body, excerpt: excerptOf(body, 300), authorEmployeeId: me, publishedAt: now, publishedByEmployeeId: me, eotmAwardId: award.id, pinned: pinnedOthers < 3 },
      });
      await tx.kudos.create({ data: { tenantId, giverEmployeeId: me, recipientEmployeeId: emp.id, badgeId: badge.id, message: dto.citation.slice(0, 500), postId: post.id } });
      const updated = await tx.eotmAward.update({ where: { id: award.id }, data: { postId: post.id } });
      return { award: updated, post };
    });
    const cert = await this.certificates.issue({
      type: 'EOTM',
      recipientEmployeeId: emp.id,
      title: EOTM_BADGE,
      subtitle: monthLabel(dto.month),
      sourceType: 'EOTM',
      sourceId: award.id,
      metadata: { citation: dto.citation, month: dto.month, holderName: emp.fullName },
    });
    const final = await this.prisma.eotmAward.update({ where: { id: award.id }, data: { certificateId: cert.id } });
    await this.audit.record({ action: 'eotm.announce', entity: 'EotmAward', entityId: award.id, meta: { employee: emp.fullName, month: dto.month } });
    await this.feed.afterPublish(post, { notify: false });
    const everyone = (await this.prisma.user.findMany({ where: { status: 'ACTIVE', employee: { isNot: null } }, select: { id: true } })).map((u) => u.id).filter((id) => id !== emp.userId);
    await this.notifications.notify({ userIds: everyone, type: 'eotm.announced', title: `Employee of the Month · ${monthLabel(dto.month)}: ${emp.fullName}`, body: dto.citation, link: `/feed?post=${post.id}`, from: 'HR' });
    if (emp.userId) {
      await this.notifications.notify({
        userIds: [emp.userId],
        type: 'eotm.announced',
        title: `Congratulations, ${emp.firstName}! You are the Employee of the Month for ${monthLabel(dto.month)}`,
        body: `${dto.citation}\n\nYour certificate is ready to download from the company feed.`,
        link: `/feed?post=${post.id}`,
        from: 'HR',
        email: true,
      });
    }
    this.events.emit('eotm.announced', { awardId: award.id, employeeId: emp.id, month: dto.month });
    return (await this.eotmRows([final]))[0]!;
  }

  async revokeEotm(id: string, reason: string) {
    const a = await this.prisma.eotmAward.findUnique({ where: { id } });
    if (!a || a.revokedAt) throw notFound('Award');
    const now = new Date();
    await this.prisma.eotmAward.update({ where: { id }, data: { revokedAt: now } });
    if (a.postId) {
      await this.prisma.post.updateMany({ where: { id: a.postId }, data: { status: 'ARCHIVED', pinned: false } });
      await this.prisma.kudos.updateMany({ where: { postId: a.postId }, data: { revokedAt: now } });
    }
    if (a.certificateId) await this.certificates.revoke(a.certificateId, reason);
    await this.audit.record({ action: 'eotm.revoke', entity: 'EotmAward', entityId: id, meta: { reason, month: a.month } });
    return { ok: true as const };
  }

}
