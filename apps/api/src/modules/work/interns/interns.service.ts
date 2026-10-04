import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { InternTask } from '@prisma/client';
import type { InternContext, InternSheetRow, InternTaskInput, InternTaskRow, InternTaskStatusKey, InternTaskUpdateInput, InternWeek } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { currentTenantId, requireContext, runAsTenant } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { AppError, forbidden, notFound } from '../../../core/http/errors';
import { WorkMetricsService } from '../projects/work-metrics.service';
import { addDays, internAccess, internDayStatus, internForbiddenFields, meanScore, nextWorkingDay, weekStartOf, type InternStatus } from '../work.rules';
import { dateKey, dateOnly, hoursOf, istMinuteOfDay, todayKey } from '../work.util';

type Me = { employeeId: string | null; name: string; userId: string | null; viewAll: boolean; canAssign: boolean };
type Intern = { id: string; fullName: string; empCode: string; managerId: string | null; userId: string | null; department: { name: string } | null; employmentType: string };

const DAY_LABEL = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Intern task sheets. Mentor = the intern's reporting manager (Employee.managerId).
 * Scope: interns.viewAll → every intern; interns.manage → own mentees; an intern → their own sheet.
 */
@Injectable()
export class InternsService {
  private readonly log = new Logger('Interns');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly metrics: WorkMetricsService,
  ) {}

  private me(): Me {
    const ctx = requireContext();
    return {
      employeeId: ctx.employeeId ?? null,
      name: ctx.userName ?? 'System',
      userId: ctx.userId ?? null,
      viewAll: hasPerm(ctx, 'interns.viewAll'),
      canAssign: hasPerm(ctx, 'interns.manage') || hasPerm(ctx, 'interns.viewAll'),
    };
  }

  private internSelect = { id: true, fullName: true, empCode: true, managerId: true, userId: true, employmentType: true, department: { select: { name: true } } } as const;

  /** Interns visible to the viewer (for sheets and the assign form). */
  private async visibleInterns(m: Me, mentorFilter?: string): Promise<Intern[]> {
    const base = { employmentType: 'INTERN' as const, status: { not: 'EXITED' as const } };
    if (m.viewAll) {
      return this.prisma.employee.findMany({ where: { ...base, ...(mentorFilter ? { managerId: mentorFilter } : {}) }, select: this.internSelect, orderBy: { fullName: 'asc' } });
    }
    if (!m.employeeId) return [];
    const or: object[] = [{ id: m.employeeId }];
    // Mentor = the intern's reporting manager (relationship scope, independent of interns.manage).
    or.push({ managerId: m.employeeId });
    return this.prisma.employee.findMany({ where: { ...base, OR: or }, select: this.internSelect, orderBy: { fullName: 'asc' } });
  }

  private async requireIntern(m: Me, internId: string): Promise<Intern & { isSelf: boolean; isMentor: boolean }> {
    const e = await this.prisma.employee.findFirst({ where: { id: internId }, select: this.internSelect });
    if (!e) throw notFound('Intern');
    const a = internAccess({ viewerEmployeeId: m.employeeId, internId: e.id, internManagerId: e.managerId, viewAll: m.viewAll });
    if (!a.canView) throw notFound('Intern');
    return { ...e, isSelf: a.isSelf, isMentor: a.isMentor };
  }

  /** Linked-task hours: tracked minutes on the board task for that intern and date. */
  private async linkedMinutes(tasks: InternTask[]): Promise<Map<string, number>> {
    const linked = tasks.filter((t) => t.linkedTaskId);
    const out = new Map<string, number>();
    if (!linked.length) return out;
    const { byTaskEmpDay } = await this.metrics.trackedByTask([...new Set(linked.map((t) => t.linkedTaskId!))]);
    for (const t of linked) {
      const m = byTaskEmpDay.get(`${t.linkedTaskId}|${t.internEmployeeId}|${dateKey(t.date)}`);
      if (m) out.set(t.id, m);
    }
    return out;
  }

  private async rows(tasks: InternTask[]): Promise<Map<string, InternTaskRow>> {
    const linked = await this.linkedMinutes(tasks);
    const keys = tasks.filter((t) => t.linkedTaskId).length
      ? new Map((await this.prisma.task.findMany({ where: { id: { in: tasks.map((t) => t.linkedTaskId).filter((x): x is string => !!x) } }, select: { id: true, key: true } })).map((t) => [t.id, t.key]))
      : new Map<string, string>();
    return new Map(
      tasks.map((t) => {
        const minutes = linked.get(t.id) ?? t.minutes;
        return [
          t.id,
          {
            id: t.id,
            date: dateKey(t.date)!,
            title: t.title,
            description: t.description,
            status: t.status as InternTaskStatusKey,
            hours: minutes != null ? hoursOf(minutes) : null,
            estimatedHours: hoursOf(t.estimatedMinutes),
            internNote: t.internNote,
            mentorScore: t.mentorScore,
            mentorFeedback: t.mentorFeedback,
            linkedTaskKey: t.linkedTaskId ? (keys.get(t.linkedTaskId) ?? null) : null,
            carriedFromId: t.carriedFromId,
          },
        ];
      }),
    );
  }

  private async weekScores(internIds: string[], weekStart: string) {
    const start = dateOnly(weekStart);
    const end = dateOnly(addDays(weekStart, 7));
    const [overrides, scored] = await Promise.all([
      this.prisma.internWeekScore.findMany({ where: { internEmployeeId: { in: internIds }, weekStart: start } }),
      this.prisma.internTask.findMany({ where: { internEmployeeId: { in: internIds }, date: { gte: start, lt: end }, mentorScore: { not: null } }, select: { internEmployeeId: true, mentorScore: true } }),
    ]);
    const out = new Map<string, number | null>();
    for (const id of internIds) {
      const o = overrides.find((x) => x.internEmployeeId === id);
      out.set(id, o ? o.score : meanScore(scored.filter((s) => s.internEmployeeId === id).map((s) => s.mentorScore)));
    }
    return out;
  }

  // ── Context & sheet ─────────────────────────────────────────────────────
  async context(): Promise<InternContext> {
    const m = this.me();
    const self = m.employeeId ? await this.prisma.employee.findFirst({ where: { id: m.employeeId }, select: { employmentType: true } }) : null;
    const interns = await this.visibleInterns(m);
    const mentees = interns.filter((i) => i.id !== m.employeeId && (m.viewAll || i.managerId === m.employeeId));
    // Demo/after-hours convenience: when today's sheet is empty, offer the most recent day with tasks.
    const today = todayKey();
    const ids = interns.map((i) => i.id);
    const hasToday = ids.length ? await this.prisma.internTask.count({ where: { internEmployeeId: { in: ids }, date: dateOnly(today) } }) : 0;
    const last = ids.length && !hasToday ? await this.prisma.internTask.findFirst({ where: { internEmployeeId: { in: ids }, date: { lt: dateOnly(today) } }, orderBy: { date: 'desc' }, select: { date: true } }) : null;
    return {
      lastSheetDate: last ? dateKey(last.date) : null,
      isIntern: self?.employmentType === 'INTERN',
      isMentor: mentees.some((i) => i.managerId === m.employeeId),
      canAssign: mentees.length > 0,
      canViewAll: m.viewAll,
      mentees: mentees.map((i) => ({ value: i.id, label: i.fullName })),
      today,
    };
  }

  async sheet(q: { date?: string; mentorEmployeeId?: string }): Promise<InternSheetRow[]> {
    const m = this.me();
    const date = q.date ?? todayKey();
    const interns = await this.visibleInterns(m, q.mentorEmployeeId);
    if (!interns.length) return [];
    const ids = interns.map((i) => i.id);
    const tasks = await this.prisma.internTask.findMany({ where: { internEmployeeId: { in: ids }, date: dateOnly(date) }, orderBy: { createdAt: 'asc' } });
    const rows = await this.rows(tasks);
    const scores = await this.weekScores(ids, weekStartOf(date));
    const mentorNames = new Map(
      (await this.prisma.employee.findMany({ where: { id: { in: interns.map((i) => i.managerId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]),
    );
    const today = todayKey();
    return interns.map((i) => {
      const mine = tasks.filter((t) => t.internEmployeeId === i.id).map((t) => rows.get(t.id)!);
      const st = internDayStatus(mine.map((t) => t.status as InternStatus), { isPastDay: date < today, afterCutoff: date === today && istMinuteOfDay() >= 18 * 60 + 30 });
      return {
        internEmployeeId: i.id,
        internName: i.fullName,
        empCode: i.empCode,
        department: i.department?.name ?? null,
        mentorEmployeeId: i.managerId,
        mentorName: i.managerId ? (mentorNames.get(i.managerId) ?? null) : null,
        todayTask: mine[0]?.title ?? null,
        todayMore: Math.max(0, mine.length - 1),
        hours: Math.round(mine.reduce((s, t) => s + (t.hours ?? 0), 0) * 100) / 100,
        status: st.key,
        statusLabel: st.label,
        weekScore: scores.get(i.id) ?? null,
        tasks: mine,
      };
    });
  }

  // ── Assign / update ─────────────────────────────────────────────────────
  async assign(input: InternTaskInput) {
    const m = this.me();
    if (!m.canAssign && !m.employeeId) throw forbidden('Only mentors, HR and admins can assign intern tasks');
    const intern = await this.prisma.employee.findFirst({ where: { id: input.internEmployeeId }, select: this.internSelect });
    if (!intern) throw notFound('Intern');
    if (intern.employmentType !== 'INTERN') throw new AppError(422, 'NOT_AN_INTERN', `${intern.fullName} is not an intern`);
    if (!m.viewAll && intern.managerId !== m.employeeId) throw forbidden(`You are not ${intern.fullName}'s mentor`);
    if (input.date < todayKey()) throw new AppError(422, 'PAST_DATE', 'Tasks can be assigned for today or a later date');
    if (input.linkedTaskId && !(await this.prisma.task.count({ where: { id: input.linkedTaskId } }))) throw new AppError(422, 'TASK_INVALID', 'Linked board task not found');
    const t = await this.prisma.internTask.create({
      data: {
        tenantId: currentTenantId(),
        internEmployeeId: intern.id,
        mentorEmployeeId: intern.managerId ?? m.employeeId ?? intern.id,
        date: dateOnly(input.date),
        title: input.title,
        description: input.description,
        estimatedMinutes: input.estimatedHours != null ? Math.round(input.estimatedHours * 60) : null,
        linkedTaskId: input.linkedTaskId,
        assignedByEmployeeId: m.employeeId,
      },
    });
    await this.audit.record({ action: 'intern_task.assigned', entity: 'InternTask', entityId: t.id, meta: { intern: intern.fullName, date: input.date, title: input.title.slice(0, 120) } });
    if (intern.userId) {
      await this.notifications.notify({ userIds: [intern.userId], type: 'intern.task', title: `New task from ${m.name}`, body: input.title.slice(0, 200), link: '/interns', from: m.name });
      this.realtime.toUsers([intern.userId], 'work.interns', { internEmployeeId: intern.id });
    }
    return { id: t.id, message: `Task assigned to ${intern.fullName}` };
  }

  private async requireTask(id: string) {
    const m = this.me();
    const t = await this.prisma.internTask.findFirst({ where: { id } });
    if (!t) throw notFound('Task');
    const intern = await this.requireIntern(m, t.internEmployeeId);
    return { m, t, intern };
  }

  async update(id: string, input: InternTaskUpdateInput) {
    const { m, t, intern } = await this.requireTask(id);
    const mentorSide = intern.isMentor || m.viewAll;
    const keys = Object.keys(input).filter((k) => (input as any)[k] !== undefined);
    if (!mentorSide) {
      if (!intern.isSelf) throw forbidden();
      const bad = internForbiddenFields(keys);
      if (bad.length) throw forbidden('Only your mentor can change the task, date or score');
      if (dateKey(t.date)! < addDays(todayKey(), -7)) throw new AppError(423, 'SHEET_LOCKED', 'Tasks older than a week are read-only');
    }
    const status = (input.status ?? t.status) as InternStatus;
    if (input.mentorScore != null && status !== 'DONE' && status !== 'NOT_DONE') throw new AppError(422, 'NOT_SCOREABLE', 'Score a task once it is done or not done');
    if (input.date !== undefined && input.date !== dateKey(t.date) && input.date < todayKey()) throw new AppError(422, 'PAST_DATE', 'Move tasks to today or a later date');
    const data: Record<string, unknown> = {};
    if (input.status !== undefined) data.status = input.status;
    if (input.hours !== undefined) data.minutes = input.hours == null ? null : Math.round(input.hours * 60);
    if (input.internNote !== undefined) data.internNote = input.internNote;
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.date !== undefined) data.date = dateOnly(input.date);
    if (input.mentorFeedback !== undefined) data.mentorFeedback = input.mentorFeedback;
    if (input.mentorScore !== undefined) {
      data.mentorScore = input.mentorScore;
      data.scoredAt = input.mentorScore == null ? null : new Date();
      data.scoredByEmployeeId = input.mentorScore == null ? null : m.employeeId;
    }
    // Starting from the sheet with "Done" but no hours: take the estimate as a sensible default.
    if (input.status === 'DONE' && input.hours === undefined && t.minutes == null && t.estimatedMinutes) data.minutes = t.estimatedMinutes;
    await this.prisma.internTask.update({ where: { id }, data });
    await this.audit.record({ action: input.mentorScore != null ? 'intern_task.scored' : 'intern_task.updated', entity: 'InternTask', entityId: id, meta: { intern: intern.fullName, changes: keys } });
    if (intern.isSelf && input.status && input.status !== t.status && (input.status === 'DONE' || input.status === 'NOT_DONE')) {
      await this.notifications.notify({
        userIds: await this.notifications.usersForEmployees([intern.managerId]),
        type: 'intern.task_status',
        title: `${intern.fullName} marked "${t.title.slice(0, 60)}" ${input.status === 'DONE' ? 'done' : 'not done'}`,
        link: '/interns',
        from: intern.fullName,
      });
    }
    if (!intern.isSelf && input.mentorScore != null && intern.userId) {
      await this.notifications.notify({ userIds: [intern.userId], type: 'intern.scored', title: `Your task was scored ${input.mentorScore}/10`, body: input.mentorFeedback ?? undefined, link: '/interns', from: m.name });
    }
    this.realtime.toUsers((await this.notifications.usersForEmployees([intern.id, intern.managerId])).filter(Boolean), 'work.interns', { internEmployeeId: intern.id });
    return { ok: true };
  }

  async remove(id: string) {
    const { m, t, intern } = await this.requireTask(id);
    if (!intern.isMentor && !m.viewAll) throw forbidden('Only the mentor can remove a task');
    if (t.mentorScore != null) throw new AppError(409, 'SCORED', 'Scored tasks cannot be removed');
    await this.prisma.internTask.delete({ where: { id } });
    await this.audit.record({ action: 'intern_task.removed', entity: 'InternTask', entityId: id, meta: { intern: intern.fullName, title: t.title.slice(0, 120) } });
    return { ok: true };
  }

  async carryOver(id: string) {
    const { m, t, intern } = await this.requireTask(id);
    if (!intern.isMentor && !m.viewAll) throw forbidden('Only the mentor can carry a task over');
    if (t.status === 'DONE') throw new AppError(422, 'ALREADY_DONE', 'This task is already done');
    if (await this.prisma.internTask.count({ where: { carriedFromId: id } })) throw new AppError(409, 'ALREADY_CARRIED', 'This task was already carried over');
    const next = nextWorkingDay(dateKey(t.date)! < todayKey() ? addDays(todayKey(), -1) : dateKey(t.date)!);
    await this.prisma.internTask.update({ where: { id }, data: { status: 'NOT_DONE' } });
    const n = await this.prisma.internTask.create({
      data: { tenantId: currentTenantId(), internEmployeeId: t.internEmployeeId, mentorEmployeeId: t.mentorEmployeeId, date: dateOnly(next), title: t.title, description: t.description, estimatedMinutes: t.estimatedMinutes, linkedTaskId: t.linkedTaskId, carriedFromId: id, assignedByEmployeeId: m.employeeId },
    });
    await this.audit.record({ action: 'intern_task.carried_over', entity: 'InternTask', entityId: n.id, meta: { from: id, date: next } });
    return { id: n.id, date: next, message: `Carried over to ${DAY_LABEL(next)}` };
  }

  // ── Week view & weekly score ────────────────────────────────────────────
  async week(internId: string, weekStartIn?: string): Promise<InternWeek> {
    const m = this.me();
    const intern = await this.requireIntern(m, internId);
    const weekStart = weekStartOf(weekStartIn ?? todayKey());
    const start = dateOnly(weekStart);
    const tasks = await this.prisma.internTask.findMany({ where: { internEmployeeId: internId, date: { gte: start, lt: dateOnly(addDays(weekStart, 7)) } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
    const rows = await this.rows(tasks);
    const override = await this.prisma.internWeekScore.findFirst({ where: { internEmployeeId: internId, weekStart: start } });
    const mentor = intern.managerId ? await this.prisma.employee.findFirst({ where: { id: intern.managerId }, select: { fullName: true } }) : null;
    const scoredBy = override?.scoredByEmployeeId ? await this.prisma.employee.findFirst({ where: { id: override.scoredByEmployeeId }, select: { fullName: true } }) : null;
    const all = tasks.map((t) => rows.get(t.id)!);
    const avgTaskScore = meanScore(all.map((t) => t.mentorScore));
    // Trend: this and the previous five weeks.
    const trend: InternWeek['trend'] = [];
    for (let i = 5; i >= 0; i--) {
      const ws = addDays(weekStart, -7 * i);
      const s = await this.weekScores([internId], ws);
      trend.push({ weekStart: ws, score: s.get(internId) ?? null });
    }
    return {
      intern: { id: intern.id, name: intern.fullName, empCode: intern.empCode, mentorName: mentor?.fullName ?? null, department: intern.department?.name ?? null },
      weekStart,
      days: [0, 1, 2, 3, 4, 5].map((i) => {
        const d = addDays(weekStart, i);
        return { date: d, label: DAY_LABEL(d), tasks: all.filter((t) => t.date === d) };
      }),
      totals: { hours: Math.round(all.reduce((s, t) => s + (t.hours ?? 0), 0) * 100) / 100, done: all.filter((t) => t.status === 'DONE').length, total: all.length, avgTaskScore },
      weekScore: override ? { score: override.score, feedback: override.feedback, scoredBy: scoredBy?.fullName ?? null } : null,
      effectiveScore: override?.score ?? avgTaskScore,
      trend,
      canScore: intern.isMentor || m.viewAll,
      canEditOwn: intern.isSelf,
    };
  }

  async setWeekScore(internId: string, input: { weekStart: string; score: number; feedback: string | null }) {
    const m = this.me();
    const intern = await this.requireIntern(m, internId);
    if (!intern.isMentor && !m.viewAll) throw forbidden('Only the mentor can score the week');
    const weekStart = dateOnly(weekStartOf(input.weekStart));
    await this.prisma.internWeekScore.upsert({
      where: { internEmployeeId_weekStart: { internEmployeeId: internId, weekStart } },
      create: { tenantId: currentTenantId(), internEmployeeId: internId, weekStart, score: input.score, feedback: input.feedback, scoredByEmployeeId: m.employeeId },
      update: { score: input.score, feedback: input.feedback, scoredByEmployeeId: m.employeeId },
    });
    await this.audit.record({ action: 'intern_week.scored', entity: 'Employee', entityId: internId, meta: { weekStart: dateKey(weekStart), score: input.score } });
    if (intern.userId) await this.notifications.notify({ userIds: [intern.userId], type: 'intern.week_scored', title: `Week score: ${input.score}/10`, body: input.feedback ?? undefined, link: '/interns', from: m.name });
    return { ok: true };
  }

  // ── Schedules ───────────────────────────────────────────────────────────
  /** 00:05 IST: tasks of earlier days still open become NOT_DONE (mentor may carry them over). */
  @Cron('5 0 * * *', { timeZone: 'Asia/Kolkata' })
  async closeYesterday() {
    const tenants = await this.prisma.raw.tenant.findMany({ select: { id: true } });
    for (const tn of tenants) {
      await runAsTenant(tn.id, async () => {
        const r = await this.prisma.internTask.updateMany({ where: { date: { lt: dateOnly(todayKey()) }, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } }, data: { status: 'NOT_DONE' } });
        if (r.count) this.log.log(`${tn.id}: ${r.count} intern tasks marked not done`);
      }).catch((e) => this.log.error((e as Error).message));
    }
  }

  /** 18:00 IST: remind interns about today's open tasks. */
  @Cron('0 18 * * 1-6', { timeZone: 'Asia/Kolkata' })
  async eveningReminder() {
    const tenants = await this.prisma.raw.tenant.findMany({ select: { id: true } });
    for (const tn of tenants) {
      await runAsTenant(tn.id, async () => {
        const open = await this.prisma.internTask.findMany({ where: { date: dateOnly(todayKey()), status: { in: ['ASSIGNED', 'IN_PROGRESS'] } }, select: { internEmployeeId: true } });
        const ids = [...new Set(open.map((o) => o.internEmployeeId))];
        for (const id of ids) {
          await this.notifications.notify({ userIds: await this.notifications.usersForEmployees([id]), type: 'intern.reminder', title: 'Update today’s task sheet before you log off', link: '/interns', from: 'System' });
        }
      }).catch((e) => this.log.error((e as Error).message));
    }
  }
}
