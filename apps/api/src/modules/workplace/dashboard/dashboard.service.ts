import { Injectable } from '@nestjs/common';
import {
  dayPartFor,
  quoteIndexFor,
  type CompanyEventInput,
  type DailyQuoteInput,
  type DashboardEvent,
  type DashboardResponse,
  type DashboardTodo,
  type TodoCreateInput,
  type WpAudienceRule,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalCountsService } from '../../../core/registry/registries';
import { AuditService } from '../../../core/audit/audit.service';
import { hasPerm } from '../../../core/auth/decorators';
import { requireContext, type RequestContext } from '../../../core/context/request-context';
import { notFound } from '../../../core/http/errors';
import { AudienceService } from '../common/audience';
import { SpineReader } from '../common/spine';
import { addDaysKey, dateOnly, dayMonth, DAY_MS, dueLabel, keyOf, longDate, shortTime, todayKey, weekStartKey } from '../common/dates';
import { NoticesService } from '../notices/notices.service';

export const DEFAULT_QUOTES = [
  'Small steps every day add up to big results.',
  'Do the hard thing first; the rest of the day gets lighter.',
  'Quality is never an accident.',
  'You are one focused hour away from a good day.',
];

type RawTodo = DashboardTodo & { sortDate: string; prio: number; createdAt: number };

/** Upcoming birthdays/anniversaries within `days` from `today` (pure; unit-tested). */
export function celebrationsWithin(
  people: { id: string; name: string; dob: Date | null; joined: Date | null }[],
  today: string,
  days: number,
  excludeId?: string | null,
): DashboardEvent[] {
  const out: DashboardEvent[] = [];
  const year = +today.slice(0, 4);
  const inWindow = (md: string) => {
    for (let add = 0; add <= days; add++) {
      const k = addDaysKey(today, add);
      if (k.slice(5) === md) return k;
      // 29 Feb birthdays show on 28 Feb in non-leap years
      if (md === '02-29' && k.slice(5) === '02-28' && !isLeap(+k.slice(0, 4))) return k;
    }
    return null;
  };
  for (const p of people) {
    if (p.id === excludeId) continue;
    if (p.dob) {
      const k = inWindow(keyOf(p.dob).slice(5));
      if (k) out.push({ id: `bday:${p.id}`, kind: 'BIRTHDAY', what: `${p.name} · birthday`, when: dayMonth(dateOnly(k)), date: k });
    }
    if (p.joined) {
      const k = inWindow(keyOf(p.joined).slice(5));
      const years = k ? +k.slice(0, 4) - p.joined.getUTCFullYear() : 0;
      if (k && years >= 1) out.push({ id: `anniv:${p.id}`, kind: 'ANNIVERSARY', what: `${p.name} · ${years} year${years > 1 ? 's' : ''}`, when: dayMonth(dateOnly(k)), date: k });
    }
  }
  void year;
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Merge + sort to-dos: overdue first, then due date, then system → board → personal. */
export function sortTodos<T extends { overdue: boolean; sortDate: string; prio: number; createdAt: number }>(items: T[]): T[] {
  return items.slice().sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.sortDate.localeCompare(b.sortDate) || a.prio - b.prio || a.createdAt - b.createdAt);
}

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
          const title = me ? [me.designation?.name, me.department?.name].filter(Boolean).join(' · ') : '';
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
          out.approvals = ctx.roleKey === 'employee' && !c.some((x) => x.count > 0) ? null : c.length ? c : null;
        }),
      );
    if (want('announcements')) tasks.push(guard(this.notices.latestForMe(5), []).then((a) => void (out.announcements = a)));
    if (want('events')) tasks.push(guard(this.upcoming(7), []).then((e) => void (out.events = e.slice(0, 6))));
    await Promise.all(tasks);
    return out;
  }

  // ── Quotes ─────────────────────────────────────────────────────────────

  async quoteToday(): Promise<{ text: string; author: string | null } | null> {
    const today = todayKey();
    const scheduled = await this.prisma.quote.findFirst({ where: { active: true, scheduledFor: dateOnly(today) } });
    if (scheduled) return { text: scheduled.text, author: scheduled.author };
    const pool = await this.prisma.quote.findMany({ where: { active: true, scheduledFor: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    if (!pool.length) {
      const i = quoteIndexFor(today, DEFAULT_QUOTES.length);
      return { text: DEFAULT_QUOTES[i]!, author: null };
    }
    const q = pool[quoteIndexFor(today, pool.length)]!;
    return { text: q.text, author: q.author };
  }

  listQuotes() {
    return this.prisma.quote.findMany({ orderBy: [{ scheduledFor: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async createQuote(dto: DailyQuoteInput) {
    const max = await this.prisma.quote.aggregate({ _max: { sortOrder: true } });
    const q = await this.prisma.quote.create({
      data: { text: dto.text, author: dto.author, scheduledFor: dto.scheduledFor ? dateOnly(dto.scheduledFor) : null, active: dto.active, sortOrder: (max._max.sortOrder ?? 0) + 1 } as any,
    });
    await this.audit.record({ action: 'quote.create', entity: 'Quote', entityId: q.id });
    return q;
  }

  async updateQuote(id: string, dto: Partial<DailyQuoteInput>) {
    await this.prisma.quote.findUniqueOrThrow({ where: { id } });
    const q = await this.prisma.quote.update({
      where: { id },
      data: { ...(dto.text !== undefined && { text: dto.text }), ...(dto.author !== undefined && { author: dto.author }), ...(dto.active !== undefined && { active: dto.active }), ...(dto.scheduledFor !== undefined && { scheduledFor: dto.scheduledFor ? dateOnly(dto.scheduledFor) : null }) },
    });
    await this.audit.record({ action: 'quote.update', entity: 'Quote', entityId: id });
    return q;
  }

  async deleteQuote(id: string) {
    await this.prisma.quote.delete({ where: { id } });
    await this.audit.record({ action: 'quote.delete', entity: 'Quote', entityId: id });
    return { ok: true };
  }

  // ── To-dos ─────────────────────────────────────────────────────────────

  async todos(ctx: RequestContext, limit = 6): Promise<{ items: DashboardTodo[]; more: number }> {
    const all = await this.allTodos(ctx);
    return { items: all.slice(0, limit), more: Math.max(0, all.length - limit) };
  }

  async allTodos(ctx: RequestContext): Promise<DashboardTodo[]> {
    const me = ctx.employeeId;
    if (!me) return [];
    const today = todayKey();
    const items: RawTodo[] = [];
    const push = (t: Omit<RawTodo, 'due' | 'overdue' | 'sortDate'> & { dueDate: string | null }) =>
      items.push({ ...t, due: dueLabel(t.dueDate, today), overdue: !!t.dueDate && t.dueDate < today, sortDate: t.dueDate ?? '9999-12-31' });

    const emp = await this.prisma.employee.findUnique({ where: { id: me }, select: { employmentType: true, joiningDate: true } });
    const results = await Promise.allSettled([
      // 1. Timesheet for last week not submitted (time domain)
      (async () => {
        if (!hasPerm(ctx, 'timesheet.self') || emp?.employmentType === 'INTERN') return;
        const lastWeek = addDaysKey(weekStartKey(today), -7);
        if (emp?.joiningDate && keyOf(emp.joiningDate) > addDaysKey(lastWeek, 6)) return;
        const rows = await this.spine.timesheets({ employeeId: me, weekStart: dateOnly(lastWeek) });
        const sheet = rows[0];
        if (sheet && !['DRAFT', 'RETURNED'].includes(sheet.status)) return;
        const end = addDaysKey(lastWeek, 6);
        const label = `${+lastWeek.slice(8)}–${+end.slice(8)} ${dayMonth(dateOnly(end)).split(' ')[1]}`;
        push({ id: `sys:timesheet:${lastWeek}`, source: 'SYSTEM', text: `Submit timesheet for ${label}`, dueDate: today, link: '/timesheet', checkable: false, prio: 0, createdAt: 0 });
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
      // 3. Pending code reviews (work: DEV_COMPLETED tasks on projects I lead, or that I reported)
      (async () => {
        const led = await this.spine.projects({ leadEmployeeId: me });
        const or: Record<string, unknown>[] = [{ reporterEmployeeId: me, NOT: { assigneeEmployeeId: me } }];
        if (led.length) or.push({ projectId: { in: led.map((p) => p.id) } });
        const tasks = await this.spine.tasks({ status: 'DEV_COMPLETED', OR: or }, 10);
        for (const t of tasks)
          push({ id: `sys:review:${t.id}`, source: 'SYSTEM', text: `Code review: ${t.key} ${t.title}`, dueDate: t.dueDate ? keyOf(t.dueDate) : null, link: `/kanban?task=${t.key}`, checkable: false, prio: 0, createdAt: 2 });
      })(),
      // 4. Board tasks assigned to me (ALLOTTED/WIP), due within 7 days or overdue
      (async () => {
        const tasks = await this.spine.tasks({ assigneeEmployeeId: me, status: { in: ['ALLOTTED', 'WIP'] }, dueDate: { lte: dateOnly(addDaysKey(today, 7)) } }, 10);
        for (const t of tasks)
          push({ id: `board:${t.id}`, source: 'BOARD', text: `${t.key} ${t.title}`, dueDate: t.dueDate ? keyOf(t.dueDate) : null, link: `/kanban?task=${t.key}`, checkable: false, prio: 1, createdAt: 0 });
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
      // 7. Pending onboarding steps (people domain; read defensively)
      (async () => {
        const obs = await this.spine.rawFindMany<{ id: string; status: string }>('onboarding', { where: { employeeId: me, completedAt: null } });
        for (const ob of obs) {
          const steps = await this.spine.rawFindMany<{ id: string; status: string }>('onboardingStep', { where: { onboardingId: ob.id, completedAt: null } });
          if (steps.length) push({ id: `sys:onboarding:${ob.id}`, source: 'SYSTEM', text: `Complete onboarding · ${steps.length} step${steps.length > 1 ? 's' : ''} pending`, dueDate: today, link: '/onboarding', checkable: false, prio: 0, createdAt: 5 });
        }
      })(),
      // 8. Interviews to score (people domain; read defensively)
      (async () => {
        const panels = await this.spine.rawFindMany<{ interviewId: string }>('interviewPanelist', { where: { employeeId: me } });
        if (!panels.length) return;
        const ids = panels.map((p) => p.interviewId);
        const [ivs, cards] = await Promise.all([
          this.spine.rawFindMany<{ id: string; roundName?: string; startsAt: Date }>('interview', { where: { id: { in: ids }, startsAt: { lte: new Date() } } }),
          this.spine.rawFindMany<{ interviewId: string; status?: string }>('scorecard', { where: { interviewId: { in: ids }, interviewerId: me } }),
        ]);
        const done = new Set(cards.filter((c) => c.status !== 'DRAFT').map((c) => c.interviewId));
        for (const iv of ivs)
          if (!done.has(iv.id))
            push({ id: `sys:interview:${iv.id}`, source: 'SYSTEM', text: `Score interview${iv.roundName ? `: ${iv.roundName}` : ''}`, dueDate: today, link: '/interviews', checkable: false, prio: 0, createdAt: 6 });
      })(),
      // 9. Personal to-dos (completed ones hide after 24 h)
      (async () => {
        const rows = await this.prisma.personalTodo.findMany({ where: { employeeId: me, OR: [{ completedAt: null }, { completedAt: { gt: new Date(Date.now() - DAY_MS) } }] }, orderBy: { createdAt: 'asc' } });
        for (const r of rows.filter((x) => !x.completedAt))
          push({ id: r.id, source: 'PERSONAL', text: r.title, dueDate: r.dueDate ? keyOf(r.dueDate) : null, link: null, checkable: true, prio: 2, createdAt: r.createdAt.getTime() });
      })(),
    ]);
    void results;
    return sortTodos(items).map(({ sortDate: _s, prio: _p, createdAt: _c, ...t }) => t);
  }

  listPersonal(employeeId: string) {
    return this.prisma.personalTodo.findMany({ where: { employeeId }, orderBy: [{ completedAt: 'asc' }, { createdAt: 'desc' }], take: 200 });
  }

  createTodo(employeeId: string, dto: TodoCreateInput) {
    return this.prisma.personalTodo.create({ data: { employeeId, title: dto.title, note: dto.note, dueDate: dto.dueDate ? dateOnly(dto.dueDate) : null } as any });
  }

  private async ownTodo(employeeId: string, id: string) {
    const t = await this.prisma.personalTodo.findFirst({ where: { id, employeeId } });
    if (!t) throw notFound('To-do');
    return t;
  }

  async updateTodo(employeeId: string, id: string, dto: Partial<TodoCreateInput>) {
    await this.ownTodo(employeeId, id);
    return this.prisma.personalTodo.update({
      where: { id },
      data: { ...(dto.title !== undefined && { title: dto.title }), ...(dto.note !== undefined && { note: dto.note }), ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? dateOnly(dto.dueDate) : null }) },
    });
  }

  async setTodoDone(employeeId: string, id: string, done: boolean) {
    await this.ownTodo(employeeId, id);
    return this.prisma.personalTodo.update({ where: { id }, data: { completedAt: done ? new Date() : null } });
  }

  async deleteTodo(employeeId: string, id: string) {
    await this.ownTodo(employeeId, id);
    await this.prisma.personalTodo.delete({ where: { id } });
    return { ok: true };
  }

  // ── Events & celebrations ──────────────────────────────────────────────

  async upcoming(days: number): Promise<DashboardEvent[]> {
    const ctx = requireContext();
    const today = todayKey();
    const people = await this.prisma.employee.findMany({ where: { status: { in: ['ACTIVE', 'NOTICE_PERIOD'] } }, select: { id: true, fullName: true, dateOfBirth: true, joiningDate: true } });
    const cel = celebrationsWithin(
      people.map((p) => ({ id: p.id, name: p.fullName, dob: p.dateOfBirth, joined: p.joiningDate })),
      today,
      days,
      ctx.employeeId,
    );
    const events = await this.eventsBetween(new Date(), new Date(dateOnly(addDaysKey(today, days + 1)).getTime() - 330 * 60_000));
    const evs: DashboardEvent[] = events.map((e) => ({ id: e.id, kind: 'EVENT', what: e.title, when: `${dayMonth(e.startsAt)}, ${shortTime(e.startsAt)}`, date: keyOf(new Date(e.startsAt.getTime() + 330 * 60_000)) }));
    return [...cel, ...evs].sort((a, b) => a.date.localeCompare(b.date));
  }

  async eventsBetween(from: Date, to: Date) {
    const ctx = requireContext();
    const rows = await this.prisma.companyEvent.findMany({ where: { startsAt: { gte: from, lte: to }, OR: [{ cancelledAt: null }, { cancelledAt: { gt: new Date(Date.now() - DAY_MS) } }] }, orderBy: { startsAt: 'asc' } });
    const out = [];
    for (const r of rows) if (await this.audience.matches(ctx.employeeId, (r.audiences ?? []) as WpAudienceRule[])) out.push(r);
    return out;
  }

  async createEvent(dto: CompanyEventInput) {
    const ctx = requireContext();
    const e = await this.prisma.companyEvent.create({
      data: { title: dto.title, description: dto.description, kind: dto.kind, startsAt: new Date(dto.startsAt), endsAt: dto.endsAt ? new Date(dto.endsAt) : null, location: dto.location, createdByEmployeeId: ctx.employeeId ?? null, audiences: [] } as any,
    });
    await this.audit.record({ action: 'event.create', entity: 'CompanyEvent', entityId: e.id });
    return e;
  }

  async cancelEvent(id: string) {
    const e = await this.prisma.companyEvent.update({ where: { id }, data: { cancelledAt: new Date() } });
    await this.audit.record({ action: 'event.cancel', entity: 'CompanyEvent', entityId: id });
    return e;
  }
}
