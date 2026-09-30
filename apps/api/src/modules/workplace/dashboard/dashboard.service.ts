import { Injectable } from '@nestjs/common';
import type { CompanyEvent, PersonalTodo } from '@prisma/client';
import {
  dayPartFor,
  quoteIndexFor,
  type CompanyEventInput,
  type CompanyEventRow,
  type DailyQuoteInput,
  type DashboardEvent,
  type DashboardResponse,
  type DashboardTodo,
  type PersonalTodoRow,
  type QuoteRow,
  type TodoCreateInput,
  type TodosResponse,
  type WpAudienceRule,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalCountsService } from '../../../core/registry/registries';
import { AuditService } from '../../../core/audit/audit.service';
import { hasPerm } from '../../../core/auth/decorators';
import { currentTenantId, requireContext, type RequestContext } from '../../../core/context/request-context';
import { badRequest, notFound } from '../../../core/http/errors';
import { AudienceService } from '../common/audience';
import { SpineReader } from '../common/spine';
import { addDaysKey, dateOnly, dayMonth, DAY_MS, dueLabel, istInstant, keyOf, longDate, shortTime, todayKey, weekStartKey } from '../common/dates';
import { NoticesService } from '../notices/notices.service';
import { approvalsFor, celebrationsWithin, DEFAULT_QUOTES, sortTodos, taskLink, titleLine, weekRangeLabel } from './dashboard.rules';

export { approvalsFor, celebrationsWithin, DEFAULT_QUOTES, reviewLink, sortTodos, taskLink, titleLine, weekRangeLabel } from './dashboard.rules';

type RawTodo = DashboardTodo & { sortDate: string; prio: number; createdAt: number };

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalCountsService,
    private readonly audience: AudienceService,
    private readonly spine: SpineReader,
    private readonly notices: NoticesService,
    private readonly audit: AuditService,
  ) {}

  /** GET /dashboard — parallel sections; a slow/failed section degrades to an empty value. */
  async dashboard(sections?: string[]): Promise<Partial<DashboardResponse>> {
    const ctx = requireContext();
    const want = (s: string) => !sections?.length || sections.includes(s);
    const now = new Date();
    const out: Partial<DashboardResponse> = {};
    const tasks: Promise<void>[] = [];
    const guard = <T>(p: Promise<T>, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), 2500))]).catch(() => fallback);

    if (want('greeting')) {
      tasks.push(
        (async () => {
          const me = ctx.employeeId
            ? await this.prisma.employee.findUnique({ where: { id: ctx.employeeId }, include: { designation: true, department: true } })
            : null;
          const first = me?.firstName ?? (ctx.userName ?? '').split(' ')[0] ?? '';
          const title = me ? titleLine(me.designation?.name, me.department?.name) : '';
          out.greeting = { kicker: longDate(now), dayPart: dayPartFor(now), firstName: first, title, localDate: todayKey(now) };
        })(),
      );
    }
    if (want('quote')) tasks.push(guard(this.quoteToday(), null).then((q) => void (out.quote = q)));
    if (want('todos'))
      tasks.push(
        guard(this.todos(ctx), { items: [], more: 0 }).then((t) => {
          out.todos = t.items;
          out.todosMore = t.more;
        }),
      );
    if (want('approvals'))
      tasks.push(
        guard(this.approvals.counts(), []).then((c) => {
          out.approvals = approvalsFor(ctx.roleKey, c);
        }),
      );
    if (want('announcements')) tasks.push(guard(this.notices.latestForMe(5), []).then((a) => void (out.announcements = a)));
    if (want('events')) tasks.push(guard(this.upcoming(7), []).then((e) => void (out.events = e.slice(0, 6))));
    await Promise.all(tasks);
    return out;
  }

  // ── Quotes ─────────────────────────────────────────────────────────────

  async quoteToday(): Promise<{ text: string; author: string | null } | null> {
    const q = await this.pickQuote(todayKey());
    return q ? { text: q.text, author: q.author } : null;
  }

  private async pickQuote(day: string): Promise<{ id: string | null; text: string; author: string | null } | null> {
    const scheduled = await this.prisma.quote.findFirst({ where: { active: true, scheduledFor: dateOnly(day) } });
    if (scheduled) return scheduled;
    const pool = await this.prisma.quote.findMany({ where: { active: true, scheduledFor: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    if (!pool.length) return { id: null, text: DEFAULT_QUOTES[quoteIndexFor(day, DEFAULT_QUOTES.length)]!, author: null };
    return pool[quoteIndexFor(day, pool.length)]!;
  }

  async listQuotes(): Promise<QuoteRow[]> {
    const [rows, today] = await Promise.all([
      this.prisma.quote.findMany({ orderBy: [{ scheduledFor: { sort: 'desc', nulls: 'last' } }, { sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.pickQuote(todayKey()),
    ]);
    return rows.map((q) => ({ id: q.id, text: q.text, author: q.author, scheduledFor: q.scheduledFor ? keyOf(q.scheduledFor) : null, active: q.active, sortOrder: q.sortOrder, isToday: q.id === today?.id }));
  }

  async createQuote(dto: DailyQuoteInput) {
    if (dto.scheduledFor) await this.assertFreeDay(dto.scheduledFor);
    const max = await this.prisma.quote.aggregate({ _max: { sortOrder: true } });
    const q = await this.prisma.quote.create({
      data: { tenantId: currentTenantId(), text: dto.text, author: dto.author, scheduledFor: dto.scheduledFor ? dateOnly(dto.scheduledFor) : null, active: dto.active, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
    await this.audit.record({ action: 'quote.create', entity: 'Quote', entityId: q.id });
    return q;
  }

  private async assertFreeDay(day: string, exceptId?: string) {
    const clash = await this.prisma.quote.findFirst({ where: { scheduledFor: dateOnly(day), ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
    if (clash) throw badRequest(`Another quote is already scheduled for ${dayMonth(dateOnly(day))}`, 'QUOTE_DAY_TAKEN');
  }

  async updateQuote(id: string, dto: Partial<DailyQuoteInput>) {
    const cur = await this.prisma.quote.findFirst({ where: { id } });
    if (!cur) throw notFound('Quote');
    if (dto.scheduledFor) await this.assertFreeDay(dto.scheduledFor, id);
    const q = await this.prisma.quote.update({
      where: { id },
      data: {
        ...(dto.text !== undefined && { text: dto.text }),
        ...(dto.author !== undefined && { author: dto.author }),
        ...(dto.active !== undefined && { active: dto.active }),
        ...(dto.scheduledFor !== undefined && { scheduledFor: dto.scheduledFor ? dateOnly(dto.scheduledFor) : null }),
      },
    });
    await this.audit.record({ action: 'quote.update', entity: 'Quote', entityId: id });
    return q;
  }

  async deleteQuote(id: string) {
    const cur = await this.prisma.quote.findFirst({ where: { id } });
    if (!cur) throw notFound('Quote');
    await this.prisma.quote.delete({ where: { id } });
    await this.audit.record({ action: 'quote.delete', entity: 'Quote', entityId: id });
    return { ok: true };
  }

  // ── To-dos ─────────────────────────────────────────────────────────────

  async todos(ctx: RequestContext, limit = 6): Promise<{ items: DashboardTodo[]; more: number }> {
    const all = await this.allTodos(ctx);
    return { items: all.slice(0, limit), more: Math.max(0, all.length - limit) };
  }

  /** GET /todos — every merged item plus my personal list (done items stay visible for 24 hours, spec §1.3). */
  async listTodos(): Promise<TodosResponse> {
    const ctx = requireContext();
    const me = ctx.employeeId;
    if (!me) return { items: [], personal: [] };
    const [items, rows] = await Promise.all([
      this.allTodos(ctx),
      this.prisma.personalTodo.findMany({ where: { employeeId: me, OR: [{ completedAt: null }, { completedAt: { gt: new Date(Date.now() - DAY_MS) } }] }, orderBy: [{ completedAt: { sort: 'asc', nulls: 'first' } }, { dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] }),
    ]);
    return { items, personal: rows.map((r) => this.personalRow(r)) };
  }

  personalRow(r: PersonalTodo): PersonalTodoRow {
    const today = todayKey();
    const due = r.dueDate ? keyOf(r.dueDate) : null;
    return { id: r.id, title: r.title, note: r.note, dueDate: due, due: dueLabel(due, today), overdue: !r.completedAt && !!due && due < today, completedAt: r.completedAt?.toISOString() ?? null };
  }

  async allTodos(ctx: RequestContext): Promise<DashboardTodo[]> {
    const me = ctx.employeeId;
    if (!me) return [];
    const today = todayKey();
    const items: RawTodo[] = [];
    const push = (t: Omit<RawTodo, 'due' | 'overdue' | 'sortDate'> & { dueDate: string | null }) =>
      items.push({ ...t, due: dueLabel(t.dueDate, today), overdue: !!t.dueDate && t.dueDate < today, sortDate: t.dueDate ?? '9999-12-31' });

    const emp = await this.prisma.employee.findUnique({ where: { id: me }, select: { employmentType: true, joiningDate: true } });
    await Promise.allSettled([
      // 1. Last week's timesheet not submitted (time domain spine: Timesheet)
      (async () => {
        if (!hasPerm(ctx, 'timesheet.self') || emp?.employmentType === 'INTERN') return;
        const lastWeek = addDaysKey(weekStartKey(today), -7);
        if (emp?.joiningDate && keyOf(emp.joiningDate) > addDaysKey(lastWeek, 6)) return;
        const rows = await this.spine.timesheets({ employeeId: me, weekStart: dateOnly(lastWeek) });
        const sheet = rows[0];
        if (sheet && !['DRAFT', 'RETURNED'].includes(sheet.status)) return;
        push({ id: `sys:timesheet:${lastWeek}`, source: 'SYSTEM', text: `Submit timesheet for ${weekRangeLabel(lastWeek)}`, dueDate: addDaysKey(lastWeek, 8), link: '/timesheet', checkable: false, prio: 0, createdAt: 0 });
      })(),
      // 2. Policies needing acknowledgement
      (async () => {
        const acks = await this.prisma.policyAck.findMany({ where: { employeeId: me, acknowledgedAt: null }, include: { version: { include: { policy: true } } } });
        for (const a of acks) {
          const p = a.version.policy;
          if (p.status !== 'PUBLISHED' || p.currentVersionId !== a.policyVersionId) continue;
          push({ id: `sys:policy:${a.id}`, source: 'SYSTEM', text: `Acknowledge ${p.title}${a.version.version > 1 ? ' update' : ''}`, dueDate: keyOf(new Date(a.dueAt.getTime() + 330 * 60_000)), link: `/policies?read=${p.id}`, checkable: false, prio: 0, createdAt: 1 });
        }
      })(),
      // 3. Code reviews: DEV_COMPLETED tasks on projects I lead or review (I hold the project's
      //    standing "Code review" task), or that I reported — never my own.
      (async () => {
        const [led, reviewDuty] = await Promise.all([
          this.spine.projects({ leadEmployeeId: me }),
          this.spine.tasks({ assigneeEmployeeId: me, isStanding: true, status: { in: ['ALLOTTED', 'WIP'] }, title: { contains: 'review', mode: 'insensitive' } }, 20),
        ]);
        const projectIds = [...new Set([...led.map((p) => p.id), ...reviewDuty.map((t) => t.projectId)])];
        const or: Record<string, unknown>[] = [{ reporterEmployeeId: me }];
        if (projectIds.length) or.push({ projectId: { in: projectIds } });
        const tasks = await this.spine.tasks({ status: 'DEV_COMPLETED', AND: [{ OR: or }, { OR: [{ assigneeEmployeeId: null }, { assigneeEmployeeId: { not: me } }] }] }, 10);
        for (const t of tasks)
          push({ id: `sys:review:${t.id}`, source: 'SYSTEM', text: `Code review: ${t.key} ${t.title}`, dueDate: t.dueDate ? keyOf(t.dueDate) : null, link: taskLink(t), checkable: false, prio: 0, createdAt: 2 });
      })(),
      // 4. Board tasks assigned to me (ALLOTTED/WIP), due within 7 days or overdue
      (async () => {
        const tasks = await this.spine.tasks({ assigneeEmployeeId: me, status: { in: ['ALLOTTED', 'WIP'] }, dueDate: { lte: dateOnly(addDaysKey(today, 7)) } }, 10);
        for (const t of tasks)
          push({ id: `board:${t.id}`, source: 'BOARD', text: `${t.key} ${t.title}`, dueDate: t.dueDate ? keyOf(t.dueDate) : null, link: taskLink(t), checkable: false, prio: 1, createdAt: 0 });
      })(),
      // 5. Required courses due within 7 days / overdue
      (async () => {
        const enr = await this.prisma.enrollment.findMany({ where: { employeeId: me, required: true, status: { not: 'COMPLETED' }, dueAt: { lte: new Date(Date.now() + 7 * DAY_MS) } }, include: { course: true } });
        for (const e of enr)
          push({ id: `sys:course:${e.id}`, source: 'SYSTEM', text: `Complete course: ${e.course.title}`, dueDate: e.dueAt ? keyOf(new Date(e.dueAt.getTime() + 330 * 60_000)) : null, link: '/learning', checkable: false, prio: 0, createdAt: 3 });
      })(),
      // 6. Helpdesk tickets waiting on me as requester
      (async () => {
        const t = await this.prisma.helpdeskTicket.findMany({ where: { requesterEmployeeId: me, status: 'WAITING' } });
        for (const x of t) push({ id: `sys:ticket:${x.id}`, source: 'SYSTEM', text: `Reply on ${x.code}: ${x.subject}`, dueDate: today, link: `/helpdesk?ticket=${x.id}`, checkable: false, prio: 0, createdAt: 4 });
      })(),
      // 7. Pending onboarding steps (people domain, read defensively)
      (async () => {
        const obs = await this.spine.rawFindMany<{ id: string }>('onboarding', { where: { employeeId: me, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } } });
        for (const ob of obs) {
          const steps = await this.spine.rawFindMany<{ id: string }>('onboardingStep', { where: { onboardingId: ob.id, status: { in: ['PENDING', 'IN_PROGRESS', 'NEEDS_ATTENTION'] } } });
          if (steps.length) push({ id: `sys:onboarding:${ob.id}`, source: 'SYSTEM', text: `Complete onboarding · ${steps.length} step${steps.length > 1 ? 's' : ''} pending`, dueDate: today, link: '/onboarding', checkable: false, prio: 0, createdAt: 5 });
        }
      })(),
      // 8. Interviews to score (people domain, read defensively)
      (async () => {
        const panels = await this.spine.rawFindMany<{ interviewId: string }>('interviewPanelist', { where: { employeeId: me } });
        if (!panels.length) return;
        const ids = panels.map((p) => p.interviewId);
        const [ivs, cards] = await Promise.all([
          this.spine.rawFindMany<{ id: string; roundName?: string; startsAt: Date }>('interview', { where: { id: { in: ids }, startsAt: { lte: new Date() }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } } }),
          this.spine.rawFindMany<{ interviewId: string; status?: string }>('interviewScorecard', { where: { interviewId: { in: ids }, interviewerEmployeeId: me } }),
        ]);
        const done = new Set(cards.filter((c) => c.status === 'SUBMITTED').map((c) => c.interviewId));
        for (const iv of ivs)
          if (!done.has(iv.id))
            push({ id: `sys:interview:${iv.id}`, source: 'SYSTEM', text: `Score interview${iv.roundName ? `: ${iv.roundName}` : ''}`, dueDate: keyOf(new Date(iv.startsAt.getTime() + 330 * 60_000)), link: '/interviews', checkable: false, prio: 0, createdAt: 6 });
      })(),
      // 9. Personal to-dos (open ones; completed ones leave the card)
      (async () => {
        const rows = await this.prisma.personalTodo.findMany({ where: { employeeId: me, completedAt: null }, orderBy: { createdAt: 'asc' } });
        for (const r of rows)
          push({ id: r.id, source: 'PERSONAL', text: r.title, dueDate: r.dueDate ? keyOf(r.dueDate) : null, link: null, checkable: true, prio: 2, createdAt: r.createdAt.getTime() });
      })(),
    ]);
    return sortTodos(items).map(({ sortDate: _s, prio: _p, createdAt: _c, ...t }) => t);
  }

  private me(): string {
    const id = requireContext().employeeId;
    if (!id) throw badRequest('Your account is not linked to an employee record', 'NO_EMPLOYEE');
    return id;
  }

  async createTodo(dto: TodoCreateInput): Promise<PersonalTodoRow> {
    const t = await this.prisma.personalTodo.create({
      data: { tenantId: currentTenantId(), employeeId: this.me(), title: dto.title, note: dto.note, dueDate: dto.dueDate ? dateOnly(dto.dueDate) : null },
    });
    return this.personalRow(t);
  }

  private async ownTodo(id: string) {
    const t = await this.prisma.personalTodo.findFirst({ where: { id, employeeId: this.me() } });
    if (!t) throw notFound('To-do');
    return t;
  }

  async updateTodo(id: string, dto: Partial<TodoCreateInput>): Promise<PersonalTodoRow> {
    await this.ownTodo(id);
    const t = await this.prisma.personalTodo.update({
      where: { id },
      data: { ...(dto.title !== undefined && { title: dto.title }), ...(dto.note !== undefined && { note: dto.note }), ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? dateOnly(dto.dueDate) : null }) },
    });
    return this.personalRow(t);
  }

  async setTodoDone(id: string, done: boolean): Promise<PersonalTodoRow> {
    await this.ownTodo(id);
    const t = await this.prisma.personalTodo.update({ where: { id }, data: { completedAt: done ? new Date() : null } });
    return this.personalRow(t);
  }

  async deleteTodo(id: string) {
    await this.ownTodo(id);
    await this.prisma.personalTodo.delete({ where: { id } });
    return { ok: true };
  }

  /** Housekeeping: completed personal to-dos are deleted after 90 days. */
  async purgeOldTodos(): Promise<number> {
    const r = await this.prisma.personalTodo.deleteMany({ where: { completedAt: { lt: new Date(Date.now() - 90 * DAY_MS) } } });
    return r.count;
  }

  // ── Events & celebrations ──────────────────────────────────────────────

  /** Dashboard "Birthdays & events": celebrations + live company events in the next `days`. */
  async upcoming(days: number): Promise<DashboardEvent[]> {
    const ctx = requireContext();
    const today = todayKey();
    const cel = await this.celebrations(days, ctx.employeeId);
    const events = await this.eventsBetween(istInstant(today, '00:00'), istInstant(addDaysKey(today, days + 1), '00:00'), false);
    const evs: DashboardEvent[] = events.map((e) => ({ id: e.id, kind: 'EVENT', what: e.title, when: `${dayMonth(e.startsAt)}, ${shortTime(e.startsAt)}`, date: this.eventDate(e) }));
    return [...cel, ...evs].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'EVENT' ? 1 : 0) - (b.kind === 'EVENT' ? 1 : 0));
  }

  async celebrations(days: number, excludeId?: string | null): Promise<DashboardEvent[]> {
    const people = await this.prisma.employee.findMany({ where: { status: { in: ['ACTIVE', 'NOTICE_PERIOD'] } }, select: { id: true, fullName: true, dateOfBirth: true, joiningDate: true } });
    return celebrationsWithin(
      people.map((p) => ({ id: p.id, name: p.fullName, dob: p.dateOfBirth, joined: p.joiningDate })),
      todayKey(),
      days,
      excludeId,
    );
  }

  private eventDate(e: Pick<CompanyEvent, 'startsAt'>): string {
    return keyOf(new Date(e.startsAt.getTime() + 330 * 60_000));
  }

  /** Audience-filtered events between two instants; cancelled ones linger 24 h when asked. */
  async eventsBetween(from: Date, to: Date, includeCancelled: boolean) {
    const ctx = requireContext();
    const rows = await this.prisma.companyEvent.findMany({
      where: { startsAt: { gte: from, lt: to }, OR: includeCancelled ? [{ cancelledAt: null }, { cancelledAt: { gt: new Date(Date.now() - DAY_MS) } }] : [{ cancelledAt: null }] },
      orderBy: { startsAt: 'asc' },
    });
    const out: CompanyEvent[] = [];
    for (const r of rows) if (await this.audience.matches(ctx.employeeId, (r.audiences ?? []) as WpAudienceRule[])) out.push(r);
    return out;
  }

  eventRow(e: CompanyEvent, canManage: boolean): CompanyEventRow {
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      kind: e.kind,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt?.toISOString() ?? null,
      location: e.location,
      when: `${dayMonth(e.startsAt)}, ${shortTime(e.startsAt)}`,
      date: this.eventDate(e),
      cancelled: !!e.cancelledAt,
      canManage,
    };
  }

  async listEvents(q: { from?: string; to?: string; days?: number }): Promise<CompanyEventRow[]> {
    const ctx = requireContext();
    const from = q.from ?? todayKey();
    const to = q.to ?? addDaysKey(from, q.days ?? 60);
    const rows = await this.eventsBetween(istInstant(from, '00:00'), istInstant(addDaysKey(to, 1), '00:00'), true);
    const canManage = hasPerm(ctx, 'notices.publish.global');
    return rows.map((e) => this.eventRow(e, canManage));
  }

  private eventTimes(dto: Pick<CompanyEventInput, 'startsAt' | 'endsAt'>) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (Number.isNaN(startsAt.getTime())) throw badRequest('Enter a valid start date and time', 'EVENT_DATES');
    if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)) throw badRequest('The event must end after it starts', 'EVENT_DATES');
    return { startsAt, endsAt };
  }

  async createEvent(dto: CompanyEventInput): Promise<CompanyEventRow> {
    const ctx = requireContext();
    const { startsAt, endsAt } = this.eventTimes(dto);
    const e = await this.prisma.companyEvent.create({
      data: { tenantId: currentTenantId(), title: dto.title, description: dto.description, kind: dto.kind, startsAt, endsAt, location: dto.location, createdByEmployeeId: ctx.employeeId ?? null, audiences: [] },
    });
    await this.audit.record({ action: 'event.create', entity: 'CompanyEvent', entityId: e.id, meta: { title: e.title } });
    return this.eventRow(e, true);
  }

  async updateEvent(id: string, dto: CompanyEventInput): Promise<CompanyEventRow> {
    const cur = await this.prisma.companyEvent.findFirst({ where: { id } });
    if (!cur) throw notFound('Event');
    const { startsAt, endsAt } = this.eventTimes(dto);
    const e = await this.prisma.companyEvent.update({ where: { id }, data: { title: dto.title, description: dto.description, kind: dto.kind, startsAt, endsAt, location: dto.location } });
    await this.audit.record({ action: 'event.update', entity: 'CompanyEvent', entityId: id });
    return this.eventRow(e, true);
  }

  async cancelEvent(id: string): Promise<CompanyEventRow> {
    const cur = await this.prisma.companyEvent.findFirst({ where: { id } });
    if (!cur) throw notFound('Event');
    const e = await this.prisma.companyEvent.update({ where: { id }, data: { cancelledAt: cur.cancelledAt ?? new Date() } });
    await this.audit.record({ action: 'event.cancel', entity: 'CompanyEvent', entityId: id });
    return this.eventRow(e, true);
  }
}
