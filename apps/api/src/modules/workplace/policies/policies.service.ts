import { Injectable, Logger } from '@nestjs/common';
import type { HrPolicy, HrPolicyVersion, PolicyAck, Prisma } from '@prisma/client';
import {
  formatDate,
  initialsOf,
  minReadSecondsFor,
  MONTHS_SHORT,
  type PolicyComplianceRow,
  type PolicyCompliancePerson,
  type PolicyCreateInput,
  type PolicyDetail,
  type PolicyListResponse,
  type PolicyRow,
  type WpAudienceRule,
  type WpHolidayList,
  type WpHolidayRow,
} from '@lexisora/shared';
import { z } from 'zod';
import { policyVersionSchema } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { EventsService } from '../../../core/registry/events.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { PdfService } from '../../../core/pdf/pdf.service';
import { StorageService } from '../../../core/storage/storage.service';
import { OrgService } from '../../../core/org/org.service';
import { hasPerm } from '../../../core/auth/decorators';
import { currentTenantId, requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../../core/http/errors';
import { AudienceService } from '../common/audience';
import { SpineReader } from '../common/spine';
import { dateOnly, keyOf, todayKey } from '../common/dates';
import { ackDueAt, complianceCounts, isOverdue, lowerTitle, pdfPageCount, reminderDue, requirementsForVersion } from './policies.rules';

type VersionInput = z.infer<typeof policyVersionSchema>;
type PolicyWithVersions = HrPolicy & { versions: HrPolicyVersion[] };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const EXCLUDED = ['EXITED'];

/**
 * Policies & rulebook (spec §9): versioned PDF policies, acknowledgement requirements per
 * version (materialised for the audience on publish), read & acknowledge with timestamp/IP,
 * compliance for HR, reminders and an overdue digest, plus the holiday list rendered from
 * the time domain's Holiday rows.
 */
@Injectable()
export class PoliciesService {
  private readonly log = new Logger('Policies');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly realtime: RealtimeGateway,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    private readonly org: OrgService,
    private readonly spine: SpineReader,
  ) {}

  private viewer() {
    const ctx = requireContext();
    return { ctx, me: ctx.employeeId ?? null, manager: hasPerm(ctx, 'policies.manage') };
  }

  private async exitedIds(): Promise<Set<string>> {
    const rows = await this.prisma.employee.findMany({ where: { status: { in: EXCLUDED as any } }, select: { id: true } });
    return new Set(rows.map((r) => r.id));
  }

  private async visibleTo(p: HrPolicy, me: string | null, manager: boolean): Promise<boolean> {
    if (manager) return true;
    const rules = (p.audiences ?? []) as WpAudienceRule[];
    return this.audience.matches(me, rules);
  }

  // ── List / detail ────────────────────────────────────────────────────────

  async list(tab: 'all' | 'pending' | 'archived'): Promise<PolicyListResponse> {
    const v = this.viewer();
    if (tab === 'archived' && !v.manager) throw forbidden();
    const policies = await this.prisma.hrPolicy.findMany({ where: { status: tab === 'archived' ? 'ARCHIVED' : 'PUBLISHED' }, include: { versions: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const visible: PolicyWithVersions[] = [];
    for (const p of policies) if (await this.visibleTo(p, v.me, v.manager)) visible.push(p);
    const rows = await this.rows(visible, v.me, v.manager);
    const pending = rows.filter((r) => r.myState === 'PENDING').length;
    const archived = v.manager ? await this.prisma.hrPolicy.count({ where: { status: 'ARCHIVED' } }) : 0;
    const all = tab === 'archived' ? await this.prisma.hrPolicy.count({ where: { status: 'PUBLISHED' } }) : rows.length;
    return { items: tab === 'pending' ? rows.filter((r) => r.myState === 'PENDING') : rows, counts: { all, pending, archived }, canManage: v.manager };
  }

  private async rows(policies: PolicyWithVersions[], me: string | null, manager: boolean): Promise<PolicyRow[]> {
    const currentIds = policies.map((p) => p.currentVersionId).filter((x): x is string => !!x);
    const [mine, all, exited] = await Promise.all([
      me && currentIds.length ? this.prisma.policyAck.findMany({ where: { employeeId: me, policyVersionId: { in: currentIds } } }) : Promise.resolve([] as PolicyAck[]),
      manager && currentIds.length ? this.prisma.policyAck.findMany({ where: { policyVersionId: { in: currentIds } }, select: { policyVersionId: true, employeeId: true, dueAt: true, acknowledgedAt: true } }) : Promise.resolve([]),
      manager ? this.exitedIds() : Promise.resolve(new Set<string>()),
    ]);
    const now = new Date();
    return policies.map((p) => {
      const cur = p.versions.find((x) => x.id === p.currentVersionId) ?? null;
      const ack = mine.find((a) => a.policyVersionId === p.currentVersionId) ?? null;
      const isHolidayList = p.category === 'HOLIDAY_LIST';
      const needsAck = p.requiresAck && !isHolidayList;
      const myState: PolicyRow['myState'] = !needsAck ? 'NA' : ack ? (ack.acknowledgedAt ? 'ACKNOWLEDGED' : 'PENDING') : 'NA';
      let compliance: string | null = null;
      if (manager && needsAck && cur) {
        const c = complianceCounts(all.filter((a) => a.policyVersionId === cur.id && !exited.has(a.employeeId)), now);
        compliance = `${c.acknowledged} / ${c.required}`;
      }
      return {
        id: p.id,
        title: p.title,
        category: p.category,
        updated: cur ? formatDate(cur.effectiveFrom) : '—',
        requiresAck: needsAck,
        myState,
        acknowledgedAt: iso(ack?.acknowledgedAt),
        versionId: cur?.id ?? null,
        version: cur?.version ?? 0,
        fileId: cur?.fileId ?? null,
        compliance,
        isHolidayList,
        dueAt: iso(ack?.dueAt),
        overdue: !!ack && isOverdue(ack, now),
        status: p.status,
      };
    });
  }

  async detail(id: string): Promise<PolicyDetail> {
    const v = this.viewer();
    const p = await this.prisma.hrPolicy.findUnique({ where: { id }, include: { versions: { orderBy: { version: 'desc' } } } });
    if (!p || (p.status !== 'PUBLISHED' && !v.manager) || !(await this.visibleTo(p, v.me, v.manager))) throw notFound('Policy');
    const [row] = await this.rows([p], v.me, v.manager);
    const people = await this.audience.briefs(p.versions.map((x) => x.publishedByEmployeeId));
    const cur = p.versions.find((x) => x.id === p.currentVersionId) ?? null;
    return {
      ...row!,
      versions: p.versions.map((x) => ({
        id: x.id,
        version: x.version,
        effectiveFrom: keyOf(x.effectiveFrom),
        changeSummary: x.changeSummary,
        fileId: x.fileId,
        publishedAt: iso(x.publishedAt),
        publishedBy: x.publishedByEmployeeId ? (people.get(x.publishedByEmployeeId)?.name ?? null) : null,
        isCurrent: x.id === p.currentVersionId,
        requiresReack: x.requiresReack,
      })),
      minReadSeconds: minReadSecondsFor(cur?.pageCount),
      ackDueDays: p.ackDueDays,
      changeSummary: cur?.changeSummary ?? null,
      effectiveFrom: cur ? keyOf(cur.effectiveFrom) : null,
    };
  }

  // ── Publish ──────────────────────────────────────────────────────────────

  private async pdfFile(fileId: string): Promise<number | null> {
    const f = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!f) throw badRequest('The policy file could not be found — upload it again', 'POLICY_FILE');
    if (f.mime !== 'application/pdf') throw badRequest('Upload the policy as a PDF', 'POLICY_FILE_TYPE');
    if (f.size > 20 * 1024 * 1024) throw badRequest('Policy PDFs can be up to 20 MB', 'POLICY_FILE_SIZE');
    try {
      return pdfPageCount((await this.storage.read(fileId)).data);
    } catch {
      return null;
    }
  }

  async create(dto: PolicyCreateInput): Promise<PolicyDetail> {
    const v = this.viewer();
    const pages = await this.pdfFile(dto.fileId);
    const isHoliday = dto.category === 'HOLIDAY_LIST';
    const exists = await this.prisma.hrPolicy.findFirst({ where: { title: { equals: dto.title, mode: 'insensitive' }, status: { not: 'ARCHIVED' } } });
    if (exists) throw conflict('A policy with this title already exists — publish a new version of it instead', 'POLICY_EXISTS');
    const now = new Date();
    const effectiveKey = dto.effectiveFrom ?? todayKey(now);
    const sortOrder = (await this.prisma.hrPolicy.count()) + 1;
    const policy = await this.prisma.hrPolicy.create({
      data: {
        title: dto.title,
        category: dto.category,
        requiresAck: isHoliday ? false : dto.requiresAck,
        ackDueDays: dto.ackDueDays,
        status: 'PUBLISHED',
        holidayYear: isHoliday ? Number(effectiveKey.slice(0, 4)) : null,
        audiences: [] as WpAudienceRule[],
        sortOrder,
        tenantId: currentTenantId(),
      },
    });
    const version = await this.prisma.hrPolicyVersion.create({
      data: { policyId: policy.id, version: 1, fileId: dto.fileId, pageCount: pages, effectiveFrom: dateOnly(effectiveKey), changeSummary: dto.changeSummary, requiresReack: true, publishedAt: now, publishedByEmployeeId: v.me } as Prisma.HrPolicyVersionUncheckedCreateInput,
    });
    await this.prisma.hrPolicy.update({ where: { id: policy.id }, data: { currentVersionId: version.id } });
    await this.audit.record({ action: 'policy.create', entity: 'HrPolicy', entityId: policy.id, meta: { title: policy.title, requiresAck: policy.requiresAck } });
    const n = await this.materialize({ ...policy, currentVersionId: version.id }, version, null);
    this.events.emit('policy.published', { policyId: policy.id, versionId: version.id, version: 1, requirements: n });
    return this.detail(policy.id);
  }

  async newVersion(id: string, dto: VersionInput): Promise<PolicyDetail> {
    const v = this.viewer();
    const p = await this.prisma.hrPolicy.findUnique({ where: { id }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!p) throw notFound('Policy');
    if (p.status === 'ARCHIVED') throw conflict('Archived policies cannot get new versions', 'POLICY_ARCHIVED');
    const pages = await this.pdfFile(dto.fileId);
    const prev = p.versions[0] ?? null;
    const now = new Date();
    const version = await this.prisma.hrPolicyVersion.create({
      data: {
        policyId: p.id,
        version: (prev?.version ?? 0) + 1,
        fileId: dto.fileId,
        pageCount: pages,
        effectiveFrom: dateOnly(dto.effectiveFrom ?? todayKey(now)),
        changeSummary: dto.changeSummary,
        requiresReack: dto.requiresReack,
        publishedAt: now,
        publishedByEmployeeId: v.me,
      } as Prisma.HrPolicyVersionUncheckedCreateInput,
    });
    await this.prisma.hrPolicy.update({ where: { id: p.id }, data: { currentVersionId: version.id, status: 'PUBLISHED' } });
    await this.audit.record({ action: 'policy.version.publish', entity: 'HrPolicy', entityId: p.id, meta: { version: version.version, requiresReack: dto.requiresReack } });
    const n = await this.materialize({ ...p, currentVersionId: version.id }, version, prev?.id ?? null);
    this.events.emit('policy.published', { policyId: p.id, versionId: version.id, version: version.version, requirements: n });
    return this.detail(p.id);
  }

  /** Creates acknowledgement requirements for the resolved audience and alerts them. */
  private async materialize(policy: HrPolicy, version: HrPolicyVersion, previousVersionId: string | null): Promise<number> {
    if (!policy.requiresAck || policy.category === 'HOLIDAY_LIST') return 0;
    const audience = await this.audience.resolve((policy.audiences ?? []) as WpAudienceRule[]);
    const previous = previousVersionId ? await this.prisma.policyAck.findMany({ where: { policyVersionId: previousVersionId } }) : [];
    const now = new Date();
    const reqs = requirementsForVersion({
      audience,
      previous,
      requiresReack: version.requiresReack,
      isFirst: !previousVersionId,
      dueAt: ackDueAt(keyOf(version.effectiveFrom), now, policy.ackDueDays),
    });
    const tenantId = currentTenantId();
    if (reqs.length) {
      await this.prisma.policyAck.createMany({
        data: reqs.map((r) => ({ tenantId, policyId: policy.id, policyVersionId: version.id, employeeId: r.employeeId, dueAt: r.dueAt, acknowledgedAt: r.acknowledgedAt, readSeconds: r.carried ? 0 : null })),
        skipDuplicates: true,
      });
    }
    const carried = reqs.filter((r) => r.carried && r.acknowledgedAt).length;
    if (carried) await this.audit.record({ action: 'policy.ack.carry', entity: 'HrPolicyVersion', entityId: version.id, meta: { carried, from: previousVersionId } });
    const pendingEmp = reqs.filter((r) => !r.acknowledgedAt).map((r) => r.employeeId);
    const users = await this.audience.userIds(pendingEmp);
    if (users.length) {
      await this.notifications.notify({
        userIds: users,
        type: 'policy.ackRequired',
        title: `Acknowledge the ${version.version > 1 ? 'updated ' : ''}${lowerTitle(policy.title)}`,
        body: `${version.changeSummary ? `What changed: ${version.changeSummary}\n\n` : ''}Please read and acknowledge it by ${formatDate(reqs.find((r) => !r.acknowledgedAt)?.dueAt ?? now)}.`,
        link: `/policies?read=${policy.id}`,
        from: 'HR',
        email: true,
      });
      this.realtime.toUsers(users, 'dashboard:invalidate', { sections: ['todos'] });
    }
    return reqs.length;
  }

  async archive(id: string) {
    const p = await this.prisma.hrPolicy.findUnique({ where: { id } });
    if (!p) throw notFound('Policy');
    await this.prisma.hrPolicy.update({ where: { id }, data: { status: 'ARCHIVED' } });
    await this.audit.record({ action: 'policy.archive', entity: 'HrPolicy', entityId: id, meta: { title: p.title } });
    const users = await this.audience.userIds((await this.prisma.policyAck.findMany({ where: { policyVersionId: p.currentVersionId ?? '', acknowledgedAt: null }, select: { employeeId: true } })).map((a) => a.employeeId));
    if (users.length) this.realtime.toUsers(users, 'dashboard:invalidate', { sections: ['todos'] });
    return { ok: true as const };
  }

  async restore(id: string) {
    const p = await this.prisma.hrPolicy.findUnique({ where: { id } });
    if (!p) throw notFound('Policy');
    await this.prisma.hrPolicy.update({ where: { id }, data: { status: 'PUBLISHED' } });
    await this.audit.record({ action: 'policy.restore', entity: 'HrPolicy', entityId: id, meta: { title: p.title } });
    return this.detail(id);
  }

  // ── Acknowledge ──────────────────────────────────────────────────────────

  async acknowledge(versionId: string, readSeconds: number, userAgent: string | null): Promise<PolicyDetail> {
    const v = this.viewer();
    if (!v.me) throw forbidden('Only employees acknowledge policies');
    const ver = await this.prisma.hrPolicyVersion.findUnique({ where: { id: versionId }, include: { policy: true } });
    if (!ver || !(await this.visibleTo(ver.policy, v.me, false))) throw notFound('Policy');
    if (ver.policy.status !== 'PUBLISHED') throw conflict('This policy is no longer in force', 'POLICY_ARCHIVED');
    if (ver.policy.currentVersionId !== ver.id) throw new AppError(409, 'VERSION_SUPERSEDED', 'A newer version of this policy was published — read the latest version');
    if (!ver.policy.requiresAck || ver.policy.category === 'HOLIDAY_LIST') throw badRequest('This document does not need an acknowledgement', 'POLICY_NO_ACK');
    let req = await this.prisma.policyAck.findFirst({ where: { policyVersionId: ver.id, employeeId: v.me } });
    if (!req) {
      // Late joiner without a materialised requirement: create it now.
      req = await this.prisma.policyAck.create({
        data: { policyId: ver.policyId, policyVersionId: ver.id, employeeId: v.me, dueAt: ackDueAt(keyOf(ver.effectiveFrom), new Date(), ver.policy.ackDueDays) } as Prisma.PolicyAckUncheckedCreateInput,
      });
    }
    if (!req.acknowledgedAt) {
      const at = new Date();
      await this.prisma.policyAck.update({ where: { id: req.id }, data: { acknowledgedAt: at, ackIp: v.ctx.ip ?? null, ackUserAgent: userAgent?.slice(0, 300) ?? null, readSeconds } });
      await this.audit.record({ action: 'policy.ack', entity: 'HrPolicyVersion', entityId: ver.id, meta: { policy: ver.policy.title, version: ver.version, ip: v.ctx.ip ?? null, readSeconds } });
      this.events.emit('policy.acknowledged', { policyId: ver.policyId, versionId: ver.id, employeeId: v.me });
      if (v.ctx.userId) this.realtime.toUser(v.ctx.userId, 'dashboard:invalidate', { sections: ['todos'] });
    }
    return this.detail(ver.policyId);
  }

  // ── Compliance (policies.manage) ─────────────────────────────────────────

  async compliance(): Promise<PolicyComplianceRow[]> {
    const policies = await this.prisma.hrPolicy.findMany({ where: { status: 'PUBLISHED', requiresAck: true, category: { not: 'HOLIDAY_LIST' } }, include: { versions: true }, orderBy: { sortOrder: 'asc' } });
    const ids = policies.map((p) => p.currentVersionId).filter((x): x is string => !!x);
    const [acks, exited] = await Promise.all([this.prisma.policyAck.findMany({ where: { policyVersionId: { in: ids } }, select: { policyVersionId: true, employeeId: true, dueAt: true, acknowledgedAt: true } }), this.exitedIds()]);
    const now = new Date();
    return policies.map((p) => {
      const c = complianceCounts(acks.filter((a) => a.policyVersionId === p.currentVersionId && !exited.has(a.employeeId)), now);
      return { id: p.id, title: p.title, category: p.category, version: p.versions.find((x) => x.id === p.currentVersionId)?.version ?? 1, ...c };
    });
  }

  async compliancePeople(id: string, state: 'pending' | 'done' | 'overdue' | 'all'): Promise<PolicyCompliancePerson[]> {
    const p = await this.prisma.hrPolicy.findUnique({ where: { id } });
    if (!p || !p.currentVersionId) throw notFound('Policy');
    const exited = await this.exitedIds();
    const now = new Date();
    const acks = (await this.prisma.policyAck.findMany({ where: { policyVersionId: p.currentVersionId } })).filter((a) => !exited.has(a.employeeId));
    const pick = acks.filter((a) => (state === 'all' ? true : state === 'done' ? !!a.acknowledgedAt : state === 'overdue' ? isOverdue(a, now) : !a.acknowledgedAt));
    const people = await this.audience.briefs(pick.map((a) => a.employeeId));
    return pick
      .map((a) => {
        const b = people.get(a.employeeId);
        return { employeeId: a.employeeId, name: b?.name ?? '—', initials: b?.initials ?? initialsOf(b?.name ?? '?'), department: b?.department ?? null, dueAt: a.dueAt.toISOString(), acknowledgedAt: iso(a.acknowledgedAt), overdue: isOverdue(a, now), lastRemindedAt: iso(a.lastRemindedAt) };
      })
      .sort((x, y) => Number(y.overdue) - Number(x.overdue) || x.name.localeCompare(y.name));
  }

  async remind(id: string): Promise<{ reminded: number; skipped: number }> {
    const p = await this.prisma.hrPolicy.findUnique({ where: { id } });
    if (!p || !p.currentVersionId) throw notFound('Policy');
    const now = new Date();
    const exited = await this.exitedIds();
    const pending = (await this.prisma.policyAck.findMany({ where: { policyVersionId: p.currentVersionId, acknowledgedAt: null } })).filter((a) => !exited.has(a.employeeId));
    const due = pending.filter((a) => !a.lastRemindedAt || now.getTime() - a.lastRemindedAt.getTime() >= 86_400_000);
    if (due.length) {
      await this.notifications.notify({ userIds: await this.audience.userIds(due.map((a) => a.employeeId)), type: 'policy.ackReminder', title: `Reminder: acknowledge the ${lowerTitle(p.title)}`, link: `/policies?read=${p.id}`, from: 'HR', email: true });
      await this.prisma.policyAck.updateMany({ where: { id: { in: due.map((a) => a.id) } }, data: { lastRemindedAt: now } });
    }
    await this.audit.record({ action: 'policy.remind', entity: 'HrPolicy', entityId: id, meta: { reminded: due.length } });
    return { reminded: due.length, skipped: pending.length - due.length };
  }

  async complianceCsv(id: string): Promise<{ filename: string; csv: string }> {
    const p = await this.prisma.hrPolicy.findUnique({ where: { id } });
    if (!p) throw notFound('Policy');
    const rows = await this.compliancePeople(id, 'all');
    const esc = (s: string | null) => `"${(s ?? '').replace(/"/g, '""')}"`;
    const fmt = (d: string | null) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)) : '');
    const lines = ['Employee,Department,Due,Acknowledged at,Status', ...rows.map((r) => [esc(r.name), esc(r.department), esc(fmt(r.dueAt)), esc(fmt(r.acknowledgedAt)), esc(r.acknowledgedAt ? 'Acknowledged' : r.overdue ? 'Overdue' : 'Pending')].join(','))];
    return { filename: `${p.title.replace(/[^\w]+/g, '-').toLowerCase()}-acknowledgements.csv`, csv: lines.join('\r\n') };
  }

  // ── Holiday list (time domain Holiday rows, read only) ───────────────────

  async holidays(year?: number): Promise<WpHolidayList> {
    const y = year ?? Number(todayKey().slice(0, 4));
    const [rows, locations, all] = await Promise.all([
      this.spine.rawFindMany<{ id: string; date: Date; name: string; type: string; calendar?: string; locationIds?: string[] }>('holiday', {
        where: { date: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) } },
        orderBy: { date: 'asc' },
      }),
      this.spine.rawFindMany<{ id: string; name: string }>('workLocation', {}),
      this.spine.rawFindMany<{ date: Date }>('holiday', { select: { date: true } }),
    ]);
    const today = todayKey();
    const items: WpHolidayRow[] = rows.map((h) => {
      const key = keyOf(h.date);
      const d = dateOnly(key);
      const locs = (h.locationIds ?? []).map((id) => locations.find((l) => l.id === id)?.name).filter(Boolean) as string[];
      return {
        id: h.id,
        date: `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
        day: new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(d),
        name: h.name,
        type: h.type,
        typeLabel: h.type === 'MANDATORY' ? 'Mandatory' : 'Optional',
        location: locs.length ? locs.join(', ') : h.calendar && h.calendar !== 'National' ? h.calendar : 'All offices',
        past: key < today,
      };
    });
    const years = [...new Set([y, ...all.map((h) => h.date.getUTCFullYear())])].sort((a, b) => a - b);
    return { year: y, items, years };
  }

  async holidaysPdf(year?: number): Promise<{ filename: string; data: Buffer }> {
    const list = await this.holidays(year);
    const tenant = await this.org.tenant();
    const data = await this.pdf.render((doc) => {
      this.pdf.header(doc, tenant.brandName ?? tenant.name ?? 'Lexisora', `Holiday list ${list.year}`);
      doc.moveDown(0.5).font('Helvetica').fontSize(10).fillColor('#605d5d').text('Mandatory holidays are paid days off for everyone. You may take optional (restricted) holidays against your leave plan.');
      doc.moveDown(0.8);
      this.pdf.table(doc, ['Date', 'Day', 'Holiday', 'Type', 'Location'], list.items.map((h) => [h.date, h.day, h.name, h.typeLabel, h.location]), [0.18, 0.16, 0.34, 0.14, 0.18]);
      if (!list.items.length) doc.moveDown().fontSize(11).text('No holidays have been published for this year yet.');
    });
    return { filename: `holiday-list-${list.year}.pdf`, data };
  }

  // ── Schedules & event consumers ──────────────────────────────────────────

  /** Joiners / re-activated employees get requirements for every policy in force. */
  async materializeForEmployee(employeeId: string): Promise<number> {
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, joiningDate: true, status: true } });
    if (!e || EXCLUDED.includes(e.status)) return 0;
    const policies = await this.prisma.hrPolicy.findMany({ where: { status: 'PUBLISHED', requiresAck: true, category: { not: 'HOLIDAY_LIST' }, currentVersionId: { not: null } }, include: { versions: true } });
    const tenantId = currentTenantId();
    let n = 0;
    for (const p of policies) {
      if (!(await this.audience.matches(employeeId, (p.audiences ?? []) as WpAudienceRule[]))) continue;
      const ver = p.versions.find((x) => x.id === p.currentVersionId);
      if (!ver) continue;
      const startKey = e.joiningDate && keyOf(e.joiningDate) > todayKey() ? keyOf(e.joiningDate) : todayKey();
      const r = await this.prisma.policyAck.createMany({ data: [{ tenantId, policyId: p.id, policyVersionId: ver.id, employeeId, dueAt: ackDueAt(startKey, new Date(), p.ackDueDays) }], skipDuplicates: true });
      n += r.count;
    }
    return n;
  }

  /** Daily 10:00 IST: reminders on day 3, the due day, then every 3 days while overdue. */
  async sendReminders(now = new Date()): Promise<number> {
    const pending = await this.prisma.policyAck.findMany({ where: { acknowledgedAt: null }, include: { version: { include: { policy: true } } } });
    const exited = await this.exitedIds();
    const due = pending.filter((a) => {
      const p = a.version.policy;
      if (p.status !== 'PUBLISHED' || p.currentVersionId !== a.policyVersionId || exited.has(a.employeeId)) return false;
      const startKey = todayKey(new Date(a.dueAt.getTime() - p.ackDueDays * 86_400_000));
      return reminderDue({ startKey, dueAt: a.dueAt, acknowledgedAt: a.acknowledgedAt, lastRemindedAt: a.lastRemindedAt }, now);
    });
    const byPolicy = new Map<string, typeof due>();
    for (const a of due) byPolicy.set(a.policyId, [...(byPolicy.get(a.policyId) ?? []), a]);
    for (const [, list] of byPolicy) {
      const p = list[0]!.version.policy;
      const overdue = list.filter((a) => isOverdue(a, now)).map((a) => a.employeeId);
      const upcoming = list.filter((a) => !isOverdue(a, now)).map((a) => a.employeeId);
      if (upcoming.length) await this.notifications.notify({ userIds: await this.audience.userIds(upcoming), type: 'policy.ackReminder', title: `Reminder: acknowledge the ${lowerTitle(p.title)}`, link: `/policies?read=${p.id}`, from: 'HR' });
      if (overdue.length) await this.notifications.notify({ userIds: await this.audience.userIds(overdue), type: 'policy.ackReminder', title: `Overdue: acknowledge the ${lowerTitle(p.title)}`, link: `/policies?read=${p.id}`, from: 'HR', email: true });
      await this.prisma.policyAck.updateMany({ where: { id: { in: list.map((a) => a.id) } }, data: { lastRemindedAt: now } });
    }
    return due.length;
  }

  /** Monday 09:00 IST: employees more than 7 days overdue → HR and each reporting manager. */
  async overdueDigest(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 7 * 86_400_000);
    const rows = await this.prisma.policyAck.findMany({ where: { acknowledgedAt: null, dueAt: { lt: cutoff } }, include: { version: { include: { policy: true } } } });
    const live = rows.filter((a) => a.version.policy.status === 'PUBLISHED' && a.version.policy.currentVersionId === a.policyVersionId);
    if (!live.length) return 0;
    const emps = await this.prisma.employee.findMany({ where: { id: { in: [...new Set(live.map((a) => a.employeeId))] }, status: { notIn: EXCLUDED as any } }, select: { id: true, fullName: true, managerId: true } });
    const line = (e: { id: string; fullName: string }) => `${e.fullName}: ${live.filter((a) => a.employeeId === e.id).map((a) => a.version.policy.title).join(', ')}`;
    const hr = await this.notifications.usersWithPermission('policies.manage');
    if (hr.length && emps.length) await this.notifications.notify({ userIds: hr, type: 'policy.overdueDigest', title: `${emps.length} employee${emps.length === 1 ? ' is' : 's are'} overdue on policy acknowledgements`, body: emps.map(line).join('\n'), link: '/policies?tab=compliance', from: 'HR', email: true });
    const byManager = new Map<string, typeof emps>();
    for (const e of emps) if (e.managerId) byManager.set(e.managerId, [...(byManager.get(e.managerId) ?? []), e]);
    for (const [mgr, list] of byManager) {
      const users = await this.audience.userIds([mgr]);
      if (users.length) await this.notifications.notify({ userIds: users, type: 'policy.overdueDigest', title: `Your team: ${list.length} overdue policy acknowledgement${list.length === 1 ? '' : 's'}`, body: list.map(line).join('\n'), link: '/policies', from: 'HR' });
    }
    return emps.length;
  }

  /** File access: published policy PDFs are readable by everyone with policies.view. */
  async canOpenFile(fileId: string): Promise<boolean> {
    const ctx = requireContext();
    if (!hasPerm(ctx, 'policies.view')) return false;
    const ver = await this.prisma.hrPolicyVersion.findFirst({ where: { fileId }, include: { policy: true } });
    if (!ver) return false;
    return ver.policy.status === 'PUBLISHED' || hasPerm(ctx, 'policies.manage');
  }

  async search(q: string) {
    const rows = await this.prisma.hrPolicy.findMany({ where: { status: 'PUBLISHED', title: { contains: q, mode: 'insensitive' } }, take: 6, orderBy: { sortOrder: 'asc' } });
    return rows.map((p) => ({ type: 'Policies', id: p.id, title: p.title, subtitle: p.category === 'HOLIDAY_LIST' ? 'Holiday list' : 'Policy', link: p.category === 'HOLIDAY_LIST' ? '/policies?tab=holidays' : `/policies?read=${p.id}` }));
  }
}
