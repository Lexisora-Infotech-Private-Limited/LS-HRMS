import { Injectable, Logger } from '@nestjs/common';
import type { HelpdeskTicket, Prisma, SupportGroup, TicketCategory, TicketComment } from '@prisma/client';
import {
  DEFAULT_SLA,
  HELPDESK_PRIORITIES,
  HELPDESK_STATUS_LABEL,
  type HelpdeskMeta,
  type HelpdeskSettings,
  type HelpdeskTicketStatus,
  type SupportGroupInput,
  type TicketCategoryInput,
  type TicketCommentRow,
  type TicketCreateInput,
  type TicketDetail,
  type TicketFile,
  type TicketListResponse,
  type TicketRow,
  type TicketTab,
} from '@lexisora/shared';
import { z } from 'zod';
import { ticketCommentSchema, ticketListQuery, ticketUpdateSchema } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { EventsService } from '../../../core/registry/events.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { SequenceService } from '../../../core/registry/sequence.service';
import { SettingsService } from '../../../core/settings/settings.service';
import { hasPerm } from '../../../core/auth/decorators';
import { currentTenantId, requireContext, type RequestContext } from '../../../core/context/request-context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../../core/http/errors';
import { AudienceService, type Brief } from '../common/audience';
import { SpineReader } from '../common/spine';
import { keyOf } from '../common/dates';
import { calendarWith, DEFAULT_CALENDAR, type BusinessCalendar } from './business-hours';
import {
  AUTO_CLOSE_DAYS_DEFAULT,
  canReopen,
  canTransition,
  dueDatesFor,
  escalationTargets,
  evaluateSla,
  isOpenStatus,
  OPEN_STATES,
  pickAssignee,
  resolvedSlaState,
  resumeClock,
  slaLabel,
  type Priority,
  type SlaPolicyLike,
} from './helpdesk.rules';
import { addBusinessMinutes } from './business-hours';

type ListQuery = z.infer<typeof ticketListQuery>;
type UpdateInput = z.infer<typeof ticketUpdateSchema>;
type CommentInput = z.infer<typeof ticketCommentSchema>;
type TicketFull = HelpdeskTicket & { comments?: TicketComment[] };
type Viewer = { ctx: RequestContext; me: string | null; agent: boolean; groupIds: string[]; groups: SupportGroup[] };
type Access = 'full' | 'header' | 'none';

const NONE = '__none__';
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const TICKET_START = 1043;
const AUTO_CLOSE_KEY = 'helpdesk.autoCloseDays';

/**
 * Helpdesk (spec §6): tickets HD-1043…, categories routed to support groups, SLA clocks in
 * business hours (Mon–Fri 09:30–18:30 IST minus holidays), pause while waiting on the
 * requester, at-risk alerts, L1/L2 escalation, restricted (Payroll/HR) visibility, CSAT.
 *
 * Permissions (flat keys): `helpdesk.use` raises tickets; `helpdesk.agent` (HR/Admin) works,
 * views and configures everything. Members of a support group work their group's tickets.
 */
@Injectable()
export class HelpdeskService {
  private readonly log = new Logger('Helpdesk');
  private calCache = new Map<string, { at: number; cal: BusinessCalendar }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly realtime: RealtimeGateway,
    private readonly sequence: SequenceService,
    private readonly settingsSvc: SettingsService,
    private readonly spine: SpineReader,
  ) {}

  // ── Calendar & SLA policy ────────────────────────────────────────────────

  /** Business calendar with the tenant's company-wide mandatory holidays (cached 10 min). */
  async calendar(): Promise<BusinessCalendar> {
    const tenantId = currentTenantId();
    const hit = this.calCache.get(tenantId);
    if (hit && Date.now() - hit.at < 600_000) return hit.cal;
    const y = new Date().getUTCFullYear();
    const rows = await this.spine.rawFindMany<{ date: Date; type: string; locationIds?: string[] }>('holiday', {
      where: { date: { gte: new Date(Date.UTC(y - 1, 0, 1)), lt: new Date(Date.UTC(y + 2, 0, 1)) } },
    });
    const cal = calendarWith(rows.filter((h) => h.type === 'MANDATORY' && !(h.locationIds ?? []).length).map((h) => keyOf(h.date)), DEFAULT_CALENDAR);
    this.calCache.set(tenantId, { at: Date.now(), cal });
    return cal;
  }

  async slaPolicies(): Promise<Map<Priority, SlaPolicyLike>> {
    const rows = await this.prisma.slaPolicy.findMany();
    const map = new Map<Priority, SlaPolicyLike>();
    for (const p of HELPDESK_PRIORITIES) {
      const r = rows.find((x) => x.priority === p);
      map.set(p, r ? { firstResponseMins: r.firstResponseMins, resolutionMins: r.resolutionMins } : DEFAULT_SLA[p]);
    }
    return map;
  }

  private async autoCloseDays(): Promise<number> {
    return this.settingsSvc.get<number>(AUTO_CLOSE_KEY, AUTO_CLOSE_DAYS_DEFAULT);
  }

  // ── Access ───────────────────────────────────────────────────────────────

  private async viewer(): Promise<Viewer> {
    const ctx = requireContext();
    const me = ctx.employeeId ?? null;
    const groups = await this.prisma.supportGroup.findMany({ where: { active: true } });
    const mine = me ? groups.filter((g) => g.leadEmployeeId === me || g.memberEmployeeIds.includes(me)) : [];
    return { ctx, me, agent: hasPerm(ctx, 'helpdesk.agent'), groupIds: mine.map((g) => g.id), groups };
  }

  private inGroup(v: Viewer, groupId: string) {
    return v.groupIds.includes(groupId);
  }

  private canWork(t: Pick<HelpdeskTicket, 'groupId'>, v: Viewer) {
    return v.agent || this.inGroup(v, t.groupId);
  }

  private access(t: HelpdeskTicket, restricted: boolean, v: Viewer): Access {
    if (v.agent) return 'full';
    if (!v.me) return 'none';
    if (t.requesterEmployeeId === v.me || t.assigneeEmployeeId === v.me || this.inGroup(v, t.groupId)) return 'full';
    if (t.escalatedToEmployeeIds.includes(v.me)) return restricted ? 'header' : 'full';
    return 'none';
  }

  private async load(id: string): Promise<{ t: HelpdeskTicket; cat: TicketCategory & { group: SupportGroup } }> {
    const t = await this.prisma.helpdeskTicket.findUnique({ where: { id } });
    if (!t) throw notFound('Ticket');
    const cat = await this.prisma.ticketCategory.findUnique({ where: { id: t.categoryId }, include: { group: true } });
    if (!cat) throw notFound('Ticket category');
    return { t, cat };
  }

  /** Loads a ticket the viewer may see (404 otherwise — never leak restricted tickets). */
  private async visible(id: string, v: Viewer) {
    const r = await this.load(id);
    const access = this.access(r.t, r.cat.restricted, v);
    if (access === 'none') throw notFound('Ticket');
    return { ...r, access };
  }

  // ── Meta / list ──────────────────────────────────────────────────────────

  async meta(): Promise<HelpdeskMeta> {
    const v = await this.viewer();
    const [cats, pol] = await Promise.all([this.prisma.ticketCategory.findMany({ where: { active: true }, include: { group: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }), this.slaPolicies()]);
    return {
      categories: cats.map((c) => ({ value: c.id, label: c.name, group: c.group.name, restricted: c.restricted })),
      canWork: v.agent || v.groupIds.length > 0,
      canAdmin: v.agent,
      sla: HELPDESK_PRIORITIES.map((p) => ({ priority: p, ...pol.get(p)! })),
    };
  }

  private tabWhere(tab: TicketTab, v: Viewer): Prisma.HelpdeskTicketWhereInput {
    const me = v.me ?? NONE;
    switch (tab) {
      case 'mine':
        return { requesterEmployeeId: me };
      case 'assigned':
        if (!v.agent && !v.groupIds.length) return { id: NONE };
        return { status: { in: [...OPEN_STATES] }, OR: [{ assigneeEmployeeId: me }, { assigneeEmployeeId: null, groupId: { in: v.groupIds.length ? v.groupIds : [NONE] } }] };
      case 'all':
        if (v.agent) return {};
        if (v.groupIds.length) return { groupId: { in: v.groupIds } };
        return { id: NONE };
      case 'escalations':
        return { status: { in: [...OPEN_STATES] }, escalationLevel: { gt: 0 }, ...(v.agent ? {} : { escalatedToEmployeeIds: { has: me } }) };
    }
  }

  private filterWhere(q: ListQuery): Prisma.HelpdeskTicketWhereInput {
    const and: Prisma.HelpdeskTicketWhereInput[] = [];
    if (q.status === 'open') and.push({ status: { in: [...OPEN_STATES] } });
    else if (q.status === 'done') and.push({ status: { in: ['RESOLVED', 'CLOSED'] } });
    else if (q.status && (HELPDESK_STATUS_LABEL as Record<string, string>)[q.status]) and.push({ status: q.status as HelpdeskTicketStatus });
    if (q.categoryId) and.push({ categoryId: q.categoryId });
    if (q.priority && (HELPDESK_PRIORITIES as readonly string[]).includes(q.priority)) and.push({ priority: q.priority as Priority });
    if (q.sla && ['ON_TRACK', 'AT_RISK', 'BREACHED', 'MET'].includes(q.sla)) and.push({ slaState: q.sla as 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'MET' });
    if (q.q) {
      const term = q.q.trim();
      const n = Number(term.replace(/^HD-?/i, ''));
      and.push({ OR: [{ subject: { contains: term, mode: 'insensitive' } }, { code: { equals: term.toUpperCase() } }, ...(Number.isFinite(n) && n > 0 ? [{ number: n }] : [])] });
    }
    return and.length ? { AND: and } : {};
  }

  async list(q: ListQuery): Promise<TicketListResponse> {
    const v = await this.viewer();
    const where: Prisma.HelpdeskTicketWhereInput = { AND: [this.tabWhere(q.tab, v), this.filterWhere(q)] };
    const [rows, total, ...counts] = await Promise.all([
      this.prisma.helpdeskTicket.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.helpdeskTicket.count({ where }),
      ...(['mine', 'assigned', 'all', 'escalations'] as TicketTab[]).map((t) => this.prisma.helpdeskTicket.count({ where: this.tabWhere(t, v) })),
    ]);
    return {
      items: await this.rows(rows),
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: { mine: counts[0]!, assigned: counts[1]!, all: counts[2]!, escalations: counts[3]! },
    };
  }

  private async rows(rows: HelpdeskTicket[]): Promise<TicketRow[]> {
    if (!rows.length) return [];
    const [cats, groups, people, pol, cal] = await Promise.all([
      this.prisma.ticketCategory.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.categoryId))] } } }),
      this.prisma.supportGroup.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.groupId))] } } }),
      this.audience.briefs(rows.flatMap((r) => [r.assigneeEmployeeId, r.requesterEmployeeId])),
      this.slaPolicies(),
      this.calendar(),
    ]);
    const now = new Date();
    return rows.map((r) => {
      const cat = cats.find((c) => c.id === r.categoryId);
      const sla = slaLabel(r, pol.get(r.priority)!, now, cal);
      return {
        id: r.id,
        code: r.code,
        subject: r.subject,
        category: cat?.name ?? '—',
        priority: r.priority,
        assignee: r.assigneeEmployeeId ? (people.get(r.assigneeEmployeeId)?.name ?? '—') : (groups.find((g) => g.id === r.groupId)?.name ?? 'Unassigned'),
        unassigned: !r.assigneeEmployeeId,
        status: r.status,
        slaState: sla.state,
        slaLabel: sla.label,
        updatedAt: r.updatedAt.toISOString(),
        restricted: !!cat?.restricted,
        requester: people.get(r.requesterEmployeeId)?.name ?? '—',
        escalationLevel: r.escalationLevel,
      };
    });
  }

  // ── Detail ───────────────────────────────────────────────────────────────

  async detail(id: string): Promise<TicketDetail> {
    const v = await this.viewer();
    const { t, cat, access } = await this.visible(id, v);
    return this.toDetail(t, cat, access, v);
  }

  private async toDetail(t: HelpdeskTicket, cat: TicketCategory & { group: SupportGroup }, access: Access, v: Viewer): Promise<TicketDetail> {
    const headerOnly = access === 'header';
    const work = this.canWork(t, v) && access === 'full';
    const isRequester = !!v.me && t.requesterEmployeeId === v.me;
    const comments = headerOnly
      ? null
      : await this.prisma.ticketComment.findMany({ where: { ticketId: t.id, ...(work ? {} : { visibility: 'PUBLIC' }) }, orderBy: { createdAt: 'asc' } });
    const group = cat.group;
    const assigneePool = [...new Set([group.leadEmployeeId, ...group.memberEmployeeIds].filter((x): x is string => !!x))];
    const people = await this.audience.briefs([t.requesterEmployeeId, t.assigneeEmployeeId, ...t.escalatedToEmployeeIds, ...assigneePool, ...(comments ?? []).map((c) => c.authorEmployeeId)]);
    const allFileIds = [...t.attachmentFileIds, ...(comments ?? []).flatMap((c) => c.fileIds)];
    const files = allFileIds.length ? await this.prisma.fileObject.findMany({ where: { id: { in: allFileIds } }, select: { id: true, filename: true, size: true, mime: true } }) : [];
    const fileOf = (id: string): TicketFile | null => {
      const f = files.find((x) => x.id === id);
      return f ? { fileId: f.id, name: f.filename, size: f.size, mime: f.mime } : null;
    };
    const [pol, cal] = await Promise.all([this.slaPolicies(), this.calendar()]);
    const policy = pol.get(t.priority)!;
    const now = new Date();
    const sla = slaLabel(t, policy, now, cal);
    const ev = evaluateSla(t, policy, now, cal);
    const requester = people.get(t.requesterEmployeeId);
    let assignees = assigneePool.map((id) => ({ value: id, label: people.get(id)?.name ?? '—' }));
    if (work && !assignees.length) {
      const deskEmp = await this.deskEmployeeIds();
      const desk = await this.audience.briefs(deskEmp);
      assignees = deskEmp.map((id) => ({ value: id, label: desk.get(id)?.name ?? '—' }));
    }
    if (cat.restricted) assignees = assignees.filter((a) => a.value !== t.requesterEmployeeId);
    const open = isOpenStatus(t.status);
    return {
      id: t.id,
      code: t.code,
      subject: t.subject,
      description: headerOnly ? '' : t.description,
      status: t.status,
      priority: t.priority,
      categoryId: t.categoryId,
      category: cat.name,
      groupId: t.groupId,
      group: group.name,
      restricted: cat.restricted,
      requester: { employeeId: t.requesterEmployeeId, name: requester?.name ?? '—', initials: requester?.initials ?? '—' },
      assigneeEmployeeId: t.assigneeEmployeeId,
      assignee: t.assigneeEmployeeId ? (people.get(t.assigneeEmployeeId)?.name ?? '—') : group.name,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      firstResponseDueAt: t.firstResponseDueAt.toISOString(),
      resolutionDueAt: t.resolutionDueAt.toISOString(),
      firstRespondedAt: iso(t.firstRespondedAt),
      resolvedAt: iso(t.resolvedAt),
      closedAt: iso(t.closedAt),
      pausedMins: t.pausedMins,
      paused: !!t.pausedSince,
      slaState: sla.state,
      slaLabel: sla.label,
      elapsedMins: ev.elapsedMins,
      resolutionMins: policy.resolutionMins,
      escalationLevel: t.escalationLevel,
      escalatedTo: t.escalatedToEmployeeIds.map((id) => people.get(id)?.name ?? '—'),
      resolutionNote: headerOnly ? null : t.resolutionNote,
      csat: t.csat,
      reopenCount: t.reopenCount,
      attachments: headerOnly ? [] : t.attachmentFileIds.map(fileOf).filter((x): x is TicketFile => !!x),
      comments: comments
        ? comments.map(
            (c): TicketCommentRow => ({
              id: c.id,
              kind: c.kind,
              visibility: c.visibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC',
              body: c.body,
              authorName: c.authorEmployeeId ? (people.get(c.authorEmployeeId)?.name ?? 'Former employee') : 'System',
              initials: c.authorEmployeeId ? (people.get(c.authorEmployeeId)?.initials ?? '—') : 'HD',
              createdAt: c.createdAt.toISOString(),
              mine: !!v.me && c.authorEmployeeId === v.me,
              files: c.fileIds.map(fileOf).filter((x): x is TicketFile => !!x),
            }),
          )
        : null,
      headerOnly,
      can: {
        work: work && t.status !== 'CANCELLED' && t.status !== 'CLOSED',
        comment: !headerOnly && (isRequester || work || (!!v.me && t.escalatedToEmployeeIds.includes(v.me))) && t.status !== 'CANCELLED' && t.status !== 'CLOSED',
        internal: work,
        resolve: work && open,
        reopen: isRequester && canReopen(t.resolvedAt, now, t.status),
        cancel: isRequester && t.status === 'OPEN',
        close: (isRequester || work) && t.status === 'RESOLVED',
        escalate: work && open && t.escalationLevel < 2,
        csat: isRequester && (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.csat === null,
      },
      assignees,
    };
  }

  // ── Create ───────────────────────────────────────────────────────────────

  private async nextNumber(): Promise<number> {
    const max = await this.prisma.helpdeskTicket.aggregate({ _max: { number: true } });
    const start = Math.max(TICKET_START, (max._max.number ?? 0) + 1);
    for (let i = 0; i < 20; i++) {
      const n = await this.sequence.nextValue('helpdesk.ticket', { start });
      if (n < start) continue;
      const taken = await this.prisma.helpdeskTicket.findFirst({ where: { number: n }, select: { id: true } });
      if (!taken) return n;
    }
    throw conflict('Could not allocate a ticket number — try again');
  }

  /**
   * Round-robin auto-assign (spec §6.5): the active member with the fewest open tickets
   * (members first, the lead only when the group has no members); never the requester.
   */
  private async roundRobinPick(group: SupportGroup, requesterId: string): Promise<string | null> {
    const pool = (group.memberEmployeeIds.length ? group.memberEmployeeIds : [group.leadEmployeeId]).filter((x): x is string => !!x && x !== requesterId);
    if (!pool.length) return null;
    const active = await this.prisma.employee.findMany({ where: { id: { in: pool }, status: { in: ['ACTIVE', 'NOTICE_PERIOD'] } }, select: { id: true } });
    const candidates = pool.filter((id) => active.some((a) => a.id === id));
    if (!candidates.length) return null;
    const open = await this.prisma.helpdeskTicket.groupBy({ by: ['assigneeEmployeeId'], where: { assigneeEmployeeId: { in: candidates }, status: { in: [...OPEN_STATES] } }, _count: { _all: true } });
    return pickAssignee(candidates, new Map(open.map((o) => [o.assigneeEmployeeId ?? '', o._count._all])));
  }

  private async checkFiles(ids: string[]) {
    if (!ids.length) return;
    const n = await this.prisma.fileObject.count({ where: { id: { in: ids } } });
    if (n !== new Set(ids).size) throw badRequest('One of the attachments could not be found — upload it again', 'TICKET_ATTACHMENT');
  }

  async create(dto: TicketCreateInput): Promise<TicketDetail> {
    const v = await this.viewer();
    if (!v.me) throw forbidden('Only employees can raise tickets');
    const t = await this.createFor({ requesterEmployeeId: v.me, categoryId: dto.categoryId, priority: dto.priority, subject: dto.subject, description: dto.description, attachmentFileIds: dto.attachmentFileIds });
    return this.detail(t.id);
  }

  /** Also used by other screens (e.g. "Raise ticket" from a payslip prefills Payroll). */
  async createFor(i: { requesterEmployeeId: string; categoryId?: string; categoryName?: string; priority?: Priority; subject: string; description: string; attachmentFileIds?: string[] }): Promise<HelpdeskTicket> {
    const cat = await this.prisma.ticketCategory.findFirst({
      where: { active: true, ...(i.categoryId ? { id: i.categoryId } : { name: { equals: i.categoryName ?? '', mode: 'insensitive' } }) },
      include: { group: true },
    });
    if (!cat) throw badRequest('Pick a category', 'TICKET_CATEGORY');
    await this.checkFiles(i.attachmentFileIds ?? []);
    const priority: Priority = i.priority ?? 'MEDIUM';
    const [pol, cal] = await Promise.all([this.slaPolicies(), this.calendar()]);
    const now = new Date();
    const number = await this.nextNumber();
    const code = `HD-${number}`;
    const assignee = cat.group.roundRobin ? await this.roundRobinPick(cat.group, i.requesterEmployeeId) : null;
    const t = await this.prisma.helpdeskTicket.create({
      data: {
        number,
        code,
        categoryId: cat.id,
        groupId: cat.groupId,
        priority,
        subject: i.subject,
        description: i.description,
        requesterEmployeeId: i.requesterEmployeeId,
        assigneeEmployeeId: assignee,
        attachmentFileIds: i.attachmentFileIds ?? [],
        ...dueDatesFor(now, pol.get(priority)!, cal),
      } as Prisma.HelpdeskTicketUncheckedCreateInput,
    });
    await this.audit.record({ action: 'ticket.create', entity: 'HelpdeskTicket', entityId: t.id, meta: { code, category: cat.name, priority, assignee } });
    const people = await this.audience.briefs([i.requesterEmployeeId, assignee]);
    const requester = people.get(i.requesterEmployeeId);
    const what = `${requester?.name ?? 'An employee'} · ${cat.name} · ${priority === 'HIGH' ? 'High' : priority === 'LOW' ? 'Low' : 'Medium'} priority`;
    if (assignee) {
      const who = people.get(assignee)?.name ?? '—';
      await this.addEvent(t.id, 'ASSIGNMENT', `Assigned to ${who} (auto-assign)`, 'PUBLIC', null);
      await this.notifications.notify({ userIds: await this.audience.userIds([assignee]), type: 'ticket.assigned', title: `${code} assigned to you: ${i.subject}`, body: what, link: `/helpdesk?ticket=${t.id}`, from: cat.group.name });
    } else {
      const groupPeople = [cat.group.leadEmployeeId, ...cat.group.memberEmployeeIds].filter((x): x is string => !!x && x !== i.requesterEmployeeId);
      await this.notifications.notify({ userIds: await this.audience.userIds(groupPeople), type: 'ticket.created', title: `New ticket ${code}: ${i.subject}`, body: what, link: `/helpdesk?ticket=${t.id}`, from: cat.group.name });
    }
    this.events.emit('ticket.created', { ticketId: t.id, code, requesterEmployeeId: i.requesterEmployeeId });
    await this.push(t, cat.group);
    return t;
  }

  // ── Agent updates ────────────────────────────────────────────────────────

  private async addEvent(ticketId: string, kind: string, body: string, visibility: 'PUBLIC' | 'INTERNAL' = 'PUBLIC', authorEmployeeId: string | null = requireContext().employeeId ?? null) {
    await this.prisma.ticketComment.create({ data: { tenantId: currentTenantId(), ticketId, kind, body: body.slice(0, 5000), visibility, authorEmployeeId, fileIds: [] as string[] } });
  }

  async update(id: string, dto: UpdateInput): Promise<TicketDetail> {
    const v = await this.viewer();
    let { t, cat, access } = await this.visible(id, v);
    if (access !== 'full' || !this.canWork(t, v)) throw forbidden('Only the support desk can change this ticket');
    if (!isOpenStatus(t.status)) throw conflict('Reopen the ticket before changing it', 'TICKET_NOT_OPEN');
    const now = new Date();
    const [pol, cal] = await Promise.all([this.slaPolicies(), this.calendar()]);
    const data: Prisma.HelpdeskTicketUncheckedUpdateInput = {};
    const notes: { kind: string; body: string; visibility?: 'PUBLIC' | 'INTERNAL' }[] = [];

    if (dto.categoryId && dto.categoryId !== t.categoryId) {
      const next = await this.prisma.ticketCategory.findFirst({ where: { id: dto.categoryId, active: true }, include: { group: true } });
      if (!next) throw badRequest('Pick a category', 'TICKET_CATEGORY');
      data.categoryId = next.id;
      if (next.groupId !== t.groupId) {
        data.groupId = next.groupId;
        if (t.assigneeEmployeeId && !(next.group.memberEmployeeIds.includes(t.assigneeEmployeeId) || next.group.leadEmployeeId === t.assigneeEmployeeId)) data.assigneeEmployeeId = null;
      }
      notes.push({ kind: 'CATEGORY_CHANGE', body: `Category changed from ${cat.name} to ${next.name}${next.groupId !== t.groupId ? ` · routed to ${next.group.name}` : ''}` });
      await this.audit.record({ action: 'ticket.category', entity: 'HelpdeskTicket', entityId: t.id, meta: { from: cat.name, to: next.name } });
      cat = next;
    }

    if (dto.priority && dto.priority !== t.priority) {
      const p = pol.get(dto.priority)!;
      data.priority = dto.priority;
      data.firstResponseDueAt = t.firstRespondedAt ? t.firstResponseDueAt : addBusinessMinutes(t.createdAt, p.firstResponseMins + t.pausedMins, cal);
      data.resolutionDueAt = addBusinessMinutes(t.createdAt, p.resolutionMins + t.pausedMins, cal);
      notes.push({ kind: 'PRIORITY_CHANGE', body: `Priority changed from ${label(t.priority)} to ${label(dto.priority)}` });
      await this.audit.record({ action: 'ticket.priority', entity: 'HelpdeskTicket', entityId: t.id, meta: { from: t.priority, to: dto.priority } });
    }

    let assignedTo: string | null = null;
    if (dto.assigneeEmployeeId !== undefined && dto.assigneeEmployeeId !== t.assigneeEmployeeId) {
      const target = dto.assigneeEmployeeId;
      if (target) {
        if (cat.restricted && target === t.requesterEmployeeId) throw new AppError(422, 'TICKET_SELF_ASSIGN', 'The requester cannot be assigned a restricted ticket');
        const group = await this.prisma.supportGroup.findUnique({ where: { id: (data.groupId as string | undefined) ?? t.groupId } });
        const inGroup = !!group && (group.leadEmployeeId === target || group.memberEmployeeIds.includes(target));
        if (!inGroup && !(await this.deskEmployeeIds()).includes(target)) throw badRequest('Assign the ticket to a member of the support group', 'TICKET_ASSIGNEE');
        assignedTo = target;
      }
      data.assigneeEmployeeId = target;
      const who = target ? ((await this.audience.briefs([target])).get(target)?.name ?? '—') : 'the group queue';
      notes.push({ kind: 'ASSIGNMENT', body: target ? `Assigned to ${who}` : 'Returned to the group queue' });
      await this.audit.record({ action: 'ticket.assign', entity: 'HelpdeskTicket', entityId: t.id, meta: { assignee: target } });
    }

    if (dto.status && dto.status !== t.status) {
      if (!canTransition(t.status, dto.status, 'agent')) throw conflict(`A ticket that is ${HELPDESK_STATUS_LABEL[t.status].toLowerCase()} cannot move to ${HELPDESK_STATUS_LABEL[dto.status].toLowerCase()}`, 'TICKET_TRANSITION');
      if (t.status === 'WAITING') {
        const r = resumeClock(t, now, cal);
        Object.assign(data, { pausedMins: r.pausedMins, firstResponseDueAt: data.firstResponseDueAt ?? r.firstResponseDueAt, resolutionDueAt: data.resolutionDueAt ?? r.resolutionDueAt, pausedSince: null });
      }
      if (dto.status === 'WAITING') data.pausedSince = now;
      if (!t.firstRespondedAt) data.firstRespondedAt = now;
      data.status = dto.status;
      notes.push({ kind: 'STATUS_CHANGE', body: `Status changed to ${HELPDESK_STATUS_LABEL[dto.status]}` });
      await this.audit.record({ action: 'ticket.status', entity: 'HelpdeskTicket', entityId: t.id, meta: { from: t.status, to: dto.status } });
    }

    if (!Object.keys(data).length) return this.toDetail(t, cat, access, v);
    const updated = await this.prisma.helpdeskTicket.update({ where: { id: t.id }, data });
    for (const n of notes) await this.addEvent(t.id, n.kind, n.body, n.visibility ?? 'PUBLIC');

    if (assignedTo && assignedTo !== v.me) {
      await this.notifications.notify({ userIds: await this.audience.userIds([assignedTo]), type: 'ticket.assigned', title: `${t.code} assigned to you: ${t.subject}`, link: `/helpdesk?ticket=${t.id}`, from: cat.group.name });
    }
    if (dto.status === 'WAITING') {
      await this.notifications.notify({ userIds: await this.audience.userIds([t.requesterEmployeeId]), type: 'ticket.waiting', title: `${t.code} needs your reply`, body: t.subject, link: `/helpdesk?ticket=${t.id}`, from: cat.group.name });
    }
    await this.push(updated, cat.group);
    return this.toDetail(updated, cat, access, v);
  }

  // ── Comments ─────────────────────────────────────────────────────────────

  async comment(id: string, dto: CommentInput): Promise<TicketDetail> {
    const v = await this.viewer();
    const { t, cat, access } = await this.visible(id, v);
    if (access !== 'full') throw forbidden('You can only see the header of this ticket');
    if (t.status === 'CANCELLED' || t.status === 'CLOSED') throw conflict('This ticket is closed — raise a new one', 'TICKET_CLOSED');
    const isRequester = !!v.me && t.requesterEmployeeId === v.me;
    const work = this.canWork(t, v);
    const escalationTarget = !!v.me && t.escalatedToEmployeeIds.includes(v.me);
    if (!isRequester && !work && !escalationTarget) throw forbidden();
    const visibility = dto.visibility === 'INTERNAL' && work ? 'INTERNAL' : 'PUBLIC';
    await this.checkFiles(dto.fileIds);
    await this.prisma.ticketComment.create({ data: { ticketId: t.id, authorEmployeeId: v.me, visibility, kind: 'COMMENT', body: dto.body, fileIds: dto.fileIds } as Prisma.TicketCommentUncheckedCreateInput });

    const now = new Date();
    const data: Prisma.HelpdeskTicketUncheckedUpdateInput = { updatedAt: now };
    // Any public reply by the desk is the first response.
    if (work && !isRequester && visibility === 'PUBLIC' && !t.firstRespondedAt) data.firstRespondedAt = now;
    // The requester replying while waiting resumes the clock.
    if (isRequester && t.status === 'WAITING') {
      const r = resumeClock(t, now, await this.calendar());
      Object.assign(data, { status: 'IN_PROGRESS', pausedSince: null, pausedMins: r.pausedMins, firstResponseDueAt: r.firstResponseDueAt, resolutionDueAt: r.resolutionDueAt });
      await this.addEvent(t.id, 'STATUS_CHANGE', 'Status changed to In progress (requester replied)', 'PUBLIC', null);
    }
    const updated = await this.prisma.helpdeskTicket.update({ where: { id: t.id }, data });

    if (visibility === 'PUBLIC') {
      const others = isRequester ? (t.assigneeEmployeeId ? [t.assigneeEmployeeId] : [cat.group.leadEmployeeId, ...cat.group.memberEmployeeIds]) : [t.requesterEmployeeId];
      const me = (await this.audience.briefs([v.me])).get(v.me ?? '');
      await this.notifications.notify({
        userIds: await this.audience.userIds(others.filter((x) => x && x !== v.me)),
        type: 'ticket.comment',
        title: `${me?.name ?? 'Someone'} replied on ${t.code}`,
        body: dto.body.slice(0, 160),
        link: `/helpdesk?ticket=${t.id}`,
        from: isRequester ? (me?.name ?? 'Requester') : cat.group.name,
      });
    }
    await this.push(updated, cat.group);
    return this.toDetail(updated, cat, access, v);
  }

  // ── Resolve / reopen / cancel / close / escalate / CSAT ──────────────────

  async resolve(id: string, note: string): Promise<TicketDetail> {
    const v = await this.viewer();
    const { t, cat, access } = await this.visible(id, v);
    if (access !== 'full' || !this.canWork(t, v)) throw forbidden('Only the support desk can resolve tickets');
    if (!isOpenStatus(t.status)) throw conflict('This ticket is not open', 'TICKET_NOT_OPEN');
    const now = new Date();
    const cal = await this.calendar();
    const clock = t.pausedSince ? resumeClock(t, now, cal) : null;
    const base = { ...t, ...(clock ? { firstResponseDueAt: clock.firstResponseDueAt, resolutionDueAt: clock.resolutionDueAt } : {}) };
    const firstRespondedAt = t.firstRespondedAt ?? now;
    const updated = await this.prisma.helpdeskTicket.update({
      where: { id: t.id },
      data: {
        status: 'RESOLVED',
        resolvedAt: now,
        resolutionNote: note,
        firstRespondedAt,
        pausedSince: null,
        ...(clock ? { pausedMins: clock.pausedMins, firstResponseDueAt: clock.firstResponseDueAt, resolutionDueAt: clock.resolutionDueAt } : {}),
        slaState: resolvedSlaState({ ...base, firstRespondedAt }, now),
      },
    });
    await this.addEvent(t.id, 'STATUS_CHANGE', `Resolved: ${note}`);
    await this.audit.record({ action: 'ticket.resolve', entity: 'HelpdeskTicket', entityId: t.id, meta: { slaState: updated.slaState } });
    await this.notifications.notify({
      userIds: await this.audience.userIds([t.requesterEmployeeId]),
      type: 'ticket.resolved',
      title: `Your ticket ${t.code} was resolved`,
      body: `${t.subject}\n\n${note}\n\nNot fixed? Reopen it within 7 days from the Helpdesk.`,
      link: `/helpdesk?ticket=${t.id}`,
      from: cat.name,
      email: true,
    });
    this.events.emit('ticket.resolved', { ticketId: t.id, code: t.code });
    await this.push(updated, cat.group);
    return this.toDetail(updated, cat, access, v);
  }

  async reopen(id: string): Promise<TicketDetail> {
    const v = await this.viewer();
    const { t, cat, access } = await this.visible(id, v);
    const now = new Date();
    if (!v.me || t.requesterEmployeeId !== v.me) throw forbidden('Only the requester can reopen a ticket');
    if (!canReopen(t.resolvedAt, now, t.status)) throw conflict('Tickets can be reopened within 7 days of being resolved', 'TICKET_REOPEN_WINDOW');
    const cal = await this.calendar();
    // The resolution clock continues from its remaining time: the resolved period counts as paused.
    const r = resumeClock(t, now, cal, t.resolvedAt);
    const pol = (await this.slaPolicies()).get(t.priority)!;
    const reopened = { ...t, status: 'IN_PROGRESS' as const, resolvedAt: null, pausedSince: null, pausedMins: r.pausedMins, firstResponseDueAt: r.firstResponseDueAt, resolutionDueAt: r.resolutionDueAt };
    const ev = evaluateSla(reopened, pol, now, cal);
    const updated = await this.prisma.helpdeskTicket.update({
      where: { id: t.id },
      data: { status: 'IN_PROGRESS', resolvedAt: null, closedAt: null, reopenCount: { increment: 1 }, pausedMins: r.pausedMins, firstResponseDueAt: r.firstResponseDueAt, resolutionDueAt: r.resolutionDueAt, slaState: ev.state },
    });
    await this.addEvent(t.id, 'STATUS_CHANGE', 'Reopened by the requester');
    await this.audit.record({ action: 'ticket.reopen', entity: 'HelpdeskTicket', entityId: t.id });
    const target = t.assigneeEmployeeId ? [t.assigneeEmployeeId] : [cat.group.leadEmployeeId, ...cat.group.memberEmployeeIds];
    await this.notifications.notify({ userIds: await this.audience.userIds(target), type: 'ticket.reopened', title: `${t.code} was reopened`, body: t.subject, link: `/helpdesk?ticket=${t.id}`, from: 'Helpdesk' });
    await this.push(updated, cat.group);
    return this.toDetail(updated, cat, access, v);
  }

  async cancel(id: string): Promise<TicketDetail> {
    const v = await this.viewer();
    const { t, cat, access } = await this.visible(id, v);
    if (!v.me || t.requesterEmployeeId !== v.me) throw forbidden('Only the requester can cancel a ticket');
    if (!canTransition(t.status, 'CANCELLED', 'requester')) throw conflict('Only open tickets can be cancelled', 'TICKET_TRANSITION');
    const updated = await this.prisma.helpdeskTicket.update({ where: { id: t.id }, data: { status: 'CANCELLED', closedAt: new Date(), pausedSince: null } });
    await this.addEvent(t.id, 'STATUS_CHANGE', 'Cancelled by the requester');
    await this.audit.record({ action: 'ticket.cancel', entity: 'HelpdeskTicket', entityId: t.id });
    await this.push(updated, cat.group);
    return this.toDetail(updated, cat, access, v);
  }

  async close(id: string): Promise<TicketDetail> {
    const v = await this.viewer();
    const { t, cat, access } = await this.visible(id, v);
    const isRequester = !!v.me && t.requesterEmployeeId === v.me;
    if (!isRequester && !(access === 'full' && this.canWork(t, v))) throw forbidden();
    if (t.status !== 'RESOLVED') throw conflict('Only resolved tickets can be closed', 'TICKET_TRANSITION');
    const updated = await this.prisma.helpdeskTicket.update({ where: { id: t.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    await this.addEvent(t.id, 'STATUS_CHANGE', isRequester ? 'Closed — the requester confirmed the fix' : 'Closed');
    await this.audit.record({ action: 'ticket.close', entity: 'HelpdeskTicket', entityId: t.id });
    await this.push(updated, cat.group);
    return this.toDetail(updated, cat, access, v);
  }

  async escalate(id: string, note: string | null): Promise<TicketDetail> {
    const v = await this.viewer();
    const { t, cat, access } = await this.visible(id, v);
    if (access !== 'full' || !this.canWork(t, v)) throw forbidden('Only the support desk can escalate tickets');
    if (!isOpenStatus(t.status)) throw conflict('This ticket is not open', 'TICKET_NOT_OPEN');
    if (t.escalationLevel >= 2) throw conflict('This ticket is already at the highest escalation level', 'TICKET_ESCALATED');
    const updated = await this.applyEscalation(t, cat, t.escalationLevel + 1, note ? `Escalated manually: ${note}` : 'Escalated manually');
    return this.toDetail(updated, cat, access, v);
  }

  async csat(id: string, score: number, comment: string | null): Promise<TicketDetail> {
    const v = await this.viewer();
    const { t, cat, access } = await this.visible(id, v);
    if (!v.me || t.requesterEmployeeId !== v.me) throw forbidden('Only the requester can rate a ticket');
    if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') throw conflict('Rate a ticket once it is resolved', 'TICKET_CSAT');
    if (t.csat !== null) throw conflict('You already rated this ticket', 'TICKET_CSAT');
    const updated = await this.prisma.helpdeskTicket.update({ where: { id: t.id }, data: { csat: score } });
    await this.addEvent(t.id, 'CSAT', `Rated ${score}/5${comment ? ` · ${comment}` : ''}`);
    await this.push(updated, cat.group);
    return this.toDetail(updated, cat, access, v);
  }

  // ── Escalation & schedules ───────────────────────────────────────────────

  /** Employees of users holding helpdesk.agent (the HR/Admin desks). */
  private async deskEmployeeIds(): Promise<string[]> {
    const users = await this.notifications.usersWithPermission('helpdesk.agent');
    if (!users.length) return [];
    const rows = await this.prisma.employee.findMany({ where: { userId: { in: users }, status: { in: ['ACTIVE', 'NOTICE_PERIOD'] } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  private async applyEscalation(t: HelpdeskTicket, cat: TicketCategory & { group: SupportGroup }, level: number, reason: string): Promise<HelpdeskTicket> {
    const [people, desk, admins] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: [t.requesterEmployeeId, t.assigneeEmployeeId].filter((x): x is string => !!x) } }, select: { id: true, managerId: true } }),
      level >= 2 ? this.deskEmployeeIds() : Promise.resolve([] as string[]),
      level >= 2 ? this.prisma.employee.findMany({ where: { status: { in: ['ACTIVE', 'NOTICE_PERIOD'] }, user: { role: { key: 'admin' } } }, select: { id: true } }) : Promise.resolve([] as { id: string }[]),
    ]);
    const mgr = (id: string | null) => (id ? (people.find((p) => p.id === id)?.managerId ?? null) : null);
    const targets = escalationTargets({
      level,
      groupLeadId: cat.group.leadEmployeeId,
      assigneeManagerId: mgr(t.assigneeEmployeeId),
      requesterManagerId: mgr(t.requesterEmployeeId),
      requesterId: t.requesterEmployeeId,
      hasAssignee: !!t.assigneeEmployeeId,
      deskHolderIds: desk,
      adminIds: admins.map((a) => a.id),
      isItCategory: /\bIT\b/i.test(cat.name) || /\bIT\b/i.test(cat.group.name),
    });
    const all = [...new Set([...t.escalatedToEmployeeIds, ...targets])];
    const fresh = all.filter((x) => !t.escalatedToEmployeeIds.includes(x));
    const updated = await this.prisma.helpdeskTicket.update({ where: { id: t.id }, data: { escalationLevel: level, escalatedToEmployeeIds: all, slaState: 'BREACHED' } });
    const names = await this.audience.briefs(all);
    await this.addEvent(t.id, 'ESCALATION', `${reason} · level ${level} → ${all.map((x) => names.get(x)?.name ?? '—').join(', ') || 'no one available'}`, 'INTERNAL', null);
    await this.audit.record({ action: 'ticket.escalate', entity: 'HelpdeskTicket', entityId: t.id, meta: { level, targets: all } });
    if (fresh.length) {
      await this.notifications.notify({
        userIds: await this.audience.userIds(fresh),
        type: 'ticket.escalated',
        title: `Escalated: ${t.code} ${t.subject}`,
        body: `${cat.name} · ${label(t.priority)} priority · resolution was due ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(t.resolutionDueAt)}`,
        link: `/helpdesk?tab=escalations&ticket=${t.id}`,
        from: 'Helpdesk SLA',
        email: true,
      });
      this.realtime.toUsers(await this.audience.userIds(fresh), 'dashboard:invalidate', { sections: ['approvals'] });
    }
    this.events.emit('ticket.escalated', { ticketId: t.id, level });
    return updated;
  }

  /** Every 5 minutes (per tenant): AT_RISK alerts and L1/L2 escalations. */
  async monitorSla(now = new Date()): Promise<{ atRisk: number; escalated: number }> {
    const open = await this.prisma.helpdeskTicket.findMany({ where: { status: { in: [...OPEN_STATES] }, pausedSince: null } });
    if (!open.length) return { atRisk: 0, escalated: 0 };
    const [pol, cal, cats] = await Promise.all([this.slaPolicies(), this.calendar(), this.prisma.ticketCategory.findMany({ include: { group: true } })]);
    let atRisk = 0;
    let escalated = 0;
    for (const t of open) {
      const cat = cats.find((c) => c.id === t.categoryId);
      if (!cat) continue;
      const ev = evaluateSla(t, pol.get(t.priority)!, now, cal);
      if (ev.level > t.escalationLevel) {
        await this.applyEscalation(t, cat, ev.level, ev.level === 1 && ev.firstResponseBreached && ev.pct < 1 ? 'First response overdue' : `Resolution SLA ${Math.round(ev.pct * 100)}% used`);
        escalated++;
        continue;
      }
      if (ev.state === 'AT_RISK' && t.slaState === 'ON_TRACK') {
        await this.prisma.helpdeskTicket.update({ where: { id: t.id }, data: { slaState: 'AT_RISK' } });
        const who = t.assigneeEmployeeId ?? cat.group.leadEmployeeId;
        await this.notifications.notify({ userIds: await this.audience.userIds([who]), type: 'ticket.atRisk', title: `At risk: ${t.code} ${t.subject}`, body: `${Math.round(ev.pct * 100)}% of the resolution SLA used`, link: `/helpdesk?ticket=${t.id}`, from: 'Helpdesk SLA' });
        atRisk++;
      } else if (ev.state !== t.slaState && ev.level <= t.escalationLevel && t.escalationLevel === 0) {
        await this.prisma.helpdeskTicket.update({ where: { id: t.id }, data: { slaState: ev.state } });
      }
    }
    return { atRisk, escalated };
  }

  /** Hourly: resolved tickets with no reopen within the window are closed. */
  async autoClose(now = new Date()): Promise<number> {
    const days = await this.autoCloseDays();
    const due = await this.prisma.helpdeskTicket.findMany({ where: { status: 'RESOLVED', resolvedAt: { lt: new Date(now.getTime() - days * 86_400_000) } }, select: { id: true } });
    for (const t of due) {
      await this.prisma.helpdeskTicket.update({ where: { id: t.id }, data: { status: 'CLOSED', closedAt: now } });
      await this.addEvent(t.id, 'STATUS_CHANGE', `Closed automatically ${days} days after resolution`, 'PUBLIC', null);
    }
    return due.length;
  }

  // ── Settings (helpdesk.agent) ────────────────────────────────────────────

  async settings(): Promise<HelpdeskSettings> {
    const [groups, cats, pol, open, days] = await Promise.all([
      this.prisma.supportGroup.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.ticketCategory.findMany({ include: { group: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.slaPolicies(),
      this.prisma.helpdeskTicket.findMany({ where: { status: { in: [...OPEN_STATES] } }, select: { groupId: true, categoryId: true } }),
      this.autoCloseDays(),
    ]);
    const people = await this.audience.briefs(groups.flatMap((g) => [g.leadEmployeeId, ...g.memberEmployeeIds]));
    return {
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        leadEmployeeId: g.leadEmployeeId,
        lead: g.leadEmployeeId ? (people.get(g.leadEmployeeId)?.name ?? null) : null,
        memberEmployeeIds: g.memberEmployeeIds,
        members: g.memberEmployeeIds.map((id) => people.get(id)?.name ?? '—'),
        active: g.active,
        roundRobin: g.roundRobin,
        openTickets: open.filter((o) => o.groupId === g.id).length,
      })),
      categories: cats.map((c) => ({ id: c.id, name: c.name, groupId: c.groupId, group: c.group.name, restricted: c.restricted, active: c.active, sortOrder: c.sortOrder, openTickets: open.filter((o) => o.categoryId === c.id).length })),
      sla: HELPDESK_PRIORITIES.map((p) => ({ priority: p, ...pol.get(p)! })),
      autoCloseDays: days,
    };
  }

  async saveGroup(id: string | null, dto: SupportGroupInput) {
    const clash = await this.prisma.supportGroup.findFirst({ where: { name: { equals: dto.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw conflict('A support group with this name already exists', 'HELPDESK_GROUP_EXISTS');
    if (id && !dto.active) {
      const busy = await this.prisma.ticketCategory.count({ where: { groupId: id, active: true } });
      if (busy) throw conflict('Move its categories to another group before deactivating it', 'HELPDESK_GROUP_IN_USE');
    }
    const data = { name: dto.name, leadEmployeeId: dto.leadEmployeeId ?? null, memberEmployeeIds: [...new Set(dto.memberEmployeeIds)], active: dto.active, roundRobin: dto.roundRobin };
    const g = id ? await this.prisma.supportGroup.update({ where: { id }, data }) : await this.prisma.supportGroup.create({ data: data as Prisma.SupportGroupUncheckedCreateInput });
    await this.audit.record({ action: 'helpdesk.config.update', entity: 'SupportGroup', entityId: g.id, meta: { name: g.name } });
    return this.settings();
  }

  async saveCategory(id: string | null, dto: TicketCategoryInput) {
    const clash = await this.prisma.ticketCategory.findFirst({ where: { name: { equals: dto.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw conflict('A category with this name already exists', 'HELPDESK_CATEGORY_EXISTS');
    const group = await this.prisma.supportGroup.findFirst({ where: { id: dto.groupId, active: true } });
    if (!group) throw badRequest('Pick a support group', 'HELPDESK_GROUP');
    // Categories are never deleted (open tickets keep them); deactivating only hides them from new tickets.
    const data = { name: dto.name, groupId: dto.groupId, restricted: dto.restricted, active: dto.active };
    const c = id
      ? await this.prisma.ticketCategory.update({ where: { id }, data })
      : await this.prisma.ticketCategory.create({ data: { ...data, sortOrder: (await this.prisma.ticketCategory.count()) + 1 } as Prisma.TicketCategoryUncheckedCreateInput });
    await this.audit.record({ action: 'helpdesk.config.update', entity: 'TicketCategory', entityId: c.id, meta: { name: c.name } });
    return this.settings();
  }

  async saveSla(priority: Priority, dto: SlaPolicyLike) {
    if (dto.firstResponseMins > dto.resolutionMins) throw badRequest('First response must come before resolution', 'HELPDESK_SLA');
    await this.prisma.slaPolicy.upsert({
      where: { tenantId_priority: { tenantId: currentTenantId(), priority } },
      create: { priority, firstResponseMins: dto.firstResponseMins, resolutionMins: dto.resolutionMins } as Prisma.SlaPolicyUncheckedCreateInput,
      update: { firstResponseMins: dto.firstResponseMins, resolutionMins: dto.resolutionMins },
    });
    await this.audit.record({ action: 'helpdesk.config.update', entity: 'SlaPolicy', entityId: priority, meta: dto });
    return this.settings();
  }

  async saveAutoClose(days: number) {
    await this.settingsSvc.set(AUTO_CLOSE_KEY, days);
    await this.audit.record({ action: 'helpdesk.config.update', entity: 'Setting', entityId: AUTO_CLOSE_KEY, meta: { days } });
    return this.settings();
  }

  // ── Registry hooks ───────────────────────────────────────────────────────

  /** File access: attachments of tickets the viewer can fully see. */
  async canOpenFile(fileId: string): Promise<boolean> {
    const viaTicket = await this.prisma.helpdeskTicket.findFirst({ where: { attachmentFileIds: { has: fileId } } });
    const viaComment = viaTicket ? null : await this.prisma.ticketComment.findFirst({ where: { fileIds: { has: fileId } }, include: { ticket: true } });
    const t = viaTicket ?? viaComment?.ticket;
    if (!t) return false;
    const v = await this.viewer();
    const cat = await this.prisma.ticketCategory.findUnique({ where: { id: t.categoryId } });
    if (this.access(t, !!cat?.restricted, v) !== 'full') return false;
    if (viaComment && viaComment.visibility === 'INTERNAL' && !this.canWork(t, v)) return false;
    return true;
  }

  async search(q: string) {
    const v = await this.viewer();
    const term = q.trim();
    if (!term) return [];
    const n = Number(term.replace(/^HD-?/i, ''));
    const or: Prisma.HelpdeskTicketWhereInput[] = [{ subject: { contains: term, mode: 'insensitive' } }];
    if (Number.isFinite(n) && n > 0) or.push({ number: n });
    const scope: Prisma.HelpdeskTicketWhereInput = v.agent
      ? {}
      : { OR: [{ requesterEmployeeId: v.me ?? NONE }, { assigneeEmployeeId: v.me ?? NONE }, { groupId: { in: v.groupIds.length ? v.groupIds : [NONE] } }] };
    const rows = await this.prisma.helpdeskTicket.findMany({ where: { AND: [scope, { OR: or }] }, take: 6, orderBy: { updatedAt: 'desc' } });
    return rows.map((r) => ({ type: 'Tickets', id: r.id, title: `${r.code} ${r.subject}`, subtitle: HELPDESK_STATUS_LABEL[r.status], link: `/helpdesk?ticket=${r.id}` }));
  }

  private async push(t: HelpdeskTicket, group: SupportGroup) {
    const users = await this.audience.userIds([t.requesterEmployeeId, t.assigneeEmployeeId, group.leadEmployeeId, ...group.memberEmployeeIds]);
    if (users.length) this.realtime.toUsers(users, 'ticket:updated', { id: t.id });
  }
}

function label(p: string) {
  return p === 'HIGH' ? 'High' : p === 'LOW' ? 'Low' : 'Medium';
}

export type { Brief };
