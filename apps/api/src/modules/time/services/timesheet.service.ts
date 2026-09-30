import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Timesheet, TimesheetCell, TimesheetLine } from '@prisma/client';
import {
  TIMESHEET_STATUS_LABEL,
  type AddLineInput,
  type CellEditInput,
  type OutsideHoursDto,
  type OutsideHoursInput,
  type SubmitResult,
  type TimesheetCellDto,
  type TimesheetChainChip,
  type TimesheetLineDto,
  type TimesheetListRow,
  type TimesheetOptions,
  type TimesheetStatusKey,
  type TimesheetWeek,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { EventsService } from '../../../core/registry/events.service';
import { OrgService } from '../../../core/org/org.service';
import { hasPerm } from '../../../core/auth/decorators';
import { currentTenantId, getContext, requireContext, type RequestContext } from '../../../core/context/request-context';
import { AppError, badRequest, forbidden, notFound } from '../../../core/http/errors';
import { CrossReader, type ProjectRow } from '../cross';
import { isWeeklyOff } from '../lib/day-calc';
import { planL1, planL2, submitMessage } from '../lib/routing';
import { cellFinal, chainTones, isEditableStatus, outsideHoursMinutes, planCellEdit, reasonRequired, submitLabel } from '../lib/timesheet-calc';
import { addDays, dateOf, dayLabel, daysBetween, dm, DOW_SHORT, istHm, istInstant, istKeyOf, keyOf, mondayOf, parseHm, weekLabel } from '../lib/time-utils';
import { PeriodLockService } from './period-lock.service';
import { PolicyService, toShiftLike } from './policy.service';

type SheetWithLines = Timesheet & { lines: (TimesheetLine & { cells: TimesheetCell[] })[] };
const ACTIVE = ['ACTIVE', 'NOTICE_PERIOD'] as const;
const L1_SLA_HOURS = 48;

/** Default week when opening "My timesheet": the previous week early in the week (Mon/Tue), else this week. */
export function defaultWeekStart(today: string): string {
  const monday = mondayOf(today);
  const dow = dateOf(today).getUTCDay();
  return dow === 1 || dow === 2 ? addDays(monday, -7) : monday;
}

/** Submission opens on the week's Friday at 15:00 IST (or any time once the week is over). */
export function submitOpen(weekStart: string, now: Date): boolean {
  const today = istKeyOf(now);
  const weekEnd = addDays(weekStart, 6);
  if (today > weekEnd) return true;
  return now.getTime() >= istInstant(addDays(weekStart, 4), 15 * 60).getTime();
}

@Injectable()
export class TimesheetService {
  private readonly log = new Logger('Timesheets');
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: PolicyService,
    private readonly locks: PeriodLockService,
    private readonly cross: CrossReader,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly events: EventsService,
    private readonly org: OrgService,
  ) {}

  // ── loading ──────────────────────────────────────────────────────────────
  async load(id: string): Promise<SheetWithLines> {
    const ts = await this.prisma.timesheet.findFirst({ where: { id }, include: { lines: { include: { cells: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } });
    if (!ts) throw notFound('Timesheet');
    return ts;
  }

  async getOrCreate(employeeId: string, weekStart: string): Promise<Timesheet> {
    const ws = mondayOf(weekStart);
    const existing = await this.prisma.timesheet.findFirst({ where: { employeeId, weekStart: dateOf(ws) } });
    if (existing) return existing;
    try {
      return await this.prisma.timesheet.create({ data: { employeeId, weekStart: dateOf(ws), weekEnd: dateOf(addDays(ws, 6)), status: 'DRAFT' } as any });
    } catch {
      return (await this.prisma.timesheet.findFirst({ where: { employeeId, weekStart: dateOf(ws) } }))!;
    }
  }

  // ── projection from tracker segments ────────────────────────────────────
  /**
   * Rebuild tracked / idle-as-work / pending-idle minutes and the idle row from tracker
   * ActivitySegments (WORK + approved IDLE_WORK). Submitted sheets keep their snapshot; late
   * data only raises the "late data" banner for approvers.
   */
  async rebuild(ts: Timesheet): Promise<Timesheet> {
    const from = keyOf(ts.weekStart);
    const to = keyOf(ts.weekEnd);
    const segs = await this.cross.segments(ts.employeeId, from, to);
    if (!isEditableStatus(ts.status)) {
      if (segs.length && ts.submittedAt && segs.some((s) => (s as any).createdAt && (s as any).createdAt > ts.submittedAt!) && !ts.hasLateData) {
        return this.prisma.timesheet.update({ where: { id: ts.id }, data: { hasLateData: true } });
      }
      return ts;
    }
    if (!segs.length) return this.refreshTotals(ts.id);

    const claims = await this.cross.idleClaims(ts.employeeId, from, to);
    const claimBySeg = new Map<string, string>();
    for (const c of claims as any[]) if (c.segmentId) claimBySeg.set(c.segmentId, c.status);

    type Acc = { tracked: number; idleAsWork: number; pending: number };
    const groups = new Map<string, { taskId: string | null; projectId: string | null; days: Map<string, Acc> }>();
    const idle = new Map<string, number>();
    const add = (s: (typeof segs)[number], field: keyof Acc, min: number) => {
      const key = s.taskId ? `t:${s.taskId}` : s.projectId ? `p:${s.projectId}` : 'general';
      const g = groups.get(key) ?? { taskId: s.taskId ?? null, projectId: s.projectId ?? null, days: new Map() };
      const day = keyOf(s.workDate);
      const acc = g.days.get(day) ?? { tracked: 0, idleAsWork: 0, pending: 0 };
      acc[field] += min;
      g.days.set(day, acc);
      groups.set(key, g);
    };
    for (const s of segs) {
      const min = Math.round(s.durationSec / 60);
      if (min <= 0) continue;
      const day = keyOf(s.workDate);
      if (s.kind === 'WORK') add(s, 'tracked', min);
      else if (s.kind === 'IDLE_WORK' || (s.kind === 'IDLE' && s.idleResolution === 'CLAIMED_WORK')) {
        const st = claimBySeg.get(s.id) ?? 'PENDING';
        if (st === 'APPROVED') add(s, 'idleAsWork', min);
        else if (st === 'PENDING') add(s, 'pending', min);
        else idle.set(day, (idle.get(day) ?? 0) + min);
      } else if (s.kind === 'IDLE' && s.idleResolution !== 'AS_BREAK') idle.set(day, (idle.get(day) ?? 0) + min);
    }

    const full = await this.load(ts.id);
    const taskIds = [...groups.values()].map((g) => g.taskId).filter((x): x is string => !!x);
    const tasks = await this.cross.taskMap(taskIds);
    const projectIds = [...new Set([...[...groups.values()].map((g) => g.projectId), ...[...tasks.values()].map((t) => t.projectId)].filter((x): x is string => !!x))];
    const projects = await this.cross.projectMap(projectIds);
    const tenantId = currentTenantId();
    const lines = [...full.lines];
    let sort = lines.reduce((m, l) => Math.max(m, l.sortOrder), 0);

    const lineFor = async (g: { taskId: string | null; projectId: string | null }) => {
      let line = g.taskId
        ? lines.find((l) => l.taskId === g.taskId)
        : g.projectId
          ? lines.find((l) => !l.taskId && l.projectId === g.projectId && !l.isManual)
          : lines.find((l) => !l.taskId && !l.projectId && !l.isManual);
      if (line) return line;
      const task = g.taskId ? tasks.get(g.taskId) : undefined;
      const projectId = task?.projectId ?? g.projectId ?? null;
      const project = projectId ? projects.get(projectId) : undefined;
      const created = await this.prisma.timesheetLine.create({
        data: {
          tenantId,
          timesheetId: ts.id,
          taskId: g.taskId,
          projectId,
          label: task ? `${task.key} ${task.title}` : (project?.name ?? 'General'),
          subLabel: project ? (project.isInternal ? 'Internal' : `${project.name}${task?.moduleName ? ` · ${task.moduleName}` : ''}`) : null,
          billable: !!project && project.billable && !project.isInternal,
          isManual: false,
          sortOrder: ++sort,
        },
      });
      const withCells = { ...created, cells: [] as TimesheetCell[] };
      lines.push(withCells);
      return withCells;
    };

    const target = new Map<string, Map<string, Acc>>(); // lineId → day → acc
    for (const g of groups.values()) {
      const line = await lineFor(g);
      const m = target.get(line.id) ?? new Map<string, Acc>();
      for (const [d, acc] of g.days) {
        const prev = m.get(d) ?? { tracked: 0, idleAsWork: 0, pending: 0 };
        m.set(d, { tracked: prev.tracked + acc.tracked, idleAsWork: prev.idleAsWork + acc.idleAsWork, pending: prev.pending + acc.pending });
      }
      target.set(line.id, m);
    }
    const days = daysBetween(from, to);
    for (const line of lines) {
      const m = target.get(line.id);
      for (const d of days) {
        const acc = m?.get(d) ?? { tracked: 0, idleAsWork: 0, pending: 0 };
        const cell = line.cells.find((c) => keyOf(c.date) === d);
        if (!cell) {
          if (!acc.tracked && !acc.idleAsWork && !acc.pending) continue;
          await this.prisma.timesheetCell.create({
            data: { tenantId, lineId: line.id, date: dateOf(d), trackedMinutes: acc.tracked, idleAsWorkMinutes: acc.idleAsWork, pendingIdleMinutes: acc.pending, finalMinutes: cellFinal({ trackedMinutes: acc.tracked, idleAsWorkMinutes: acc.idleAsWork, outsideHoursMinutes: 0, adjustmentMinutes: 0 }) },
          });
        } else if (cell.trackedMinutes !== acc.tracked || cell.idleAsWorkMinutes !== acc.idleAsWork || cell.pendingIdleMinutes !== acc.pending) {
          await this.prisma.timesheetCell.update({
            where: { id: cell.id },
            data: {
              trackedMinutes: acc.tracked,
              idleAsWorkMinutes: acc.idleAsWork,
              pendingIdleMinutes: acc.pending,
              finalMinutes: cellFinal({ trackedMinutes: acc.tracked, idleAsWorkMinutes: acc.idleAsWork, outsideHoursMinutes: cell.outsideHoursMinutes, adjustmentMinutes: cell.adjustmentMinutes }),
            },
          });
        }
      }
    }
    for (const d of days) {
      const minutes = idle.get(d) ?? 0;
      const existing = await this.prisma.timesheetIdleDay.findFirst({ where: { timesheetId: ts.id, date: dateOf(d) } });
      if (existing) {
        if (existing.idleMinutes !== minutes) await this.prisma.timesheetIdleDay.update({ where: { id: existing.id }, data: { idleMinutes: minutes } });
      } else if (minutes) await this.prisma.timesheetIdleDay.create({ data: { tenantId, timesheetId: ts.id, date: dateOf(d), idleMinutes: minutes } });
    }
    return this.refreshTotals(ts.id);
  }

  /** Re-sum a sheet's totals (after edits / rebuilds / decisions). */
  async refreshTotals(id: string): Promise<Timesheet> {
    const ts = await this.load(id);
    const idleDays = await this.prisma.timesheetIdleDay.findMany({ where: { timesheetId: id } });
    const cells = ts.lines.flatMap((l) => l.cells);
    const shots = await this.cross.screenshotCount(ts.employeeId, keyOf(ts.weekStart), keyOf(ts.weekEnd));
    return this.prisma.timesheet.update({
      where: { id },
      data: {
        totalMinutes: cells.reduce((s, c) => s + c.finalMinutes, 0),
        trackedMinutes: cells.reduce((s, c) => s + c.trackedMinutes, 0),
        adjustmentMinutes: cells.reduce((s, c) => s + c.adjustmentMinutes, 0),
        outsideHoursMinutes: cells.reduce((s, c) => s + c.outsideHoursMinutes, 0),
        idleAsWorkMinutes: cells.reduce((s, c) => s + c.idleAsWorkMinutes, 0),
        idleMinutes: idleDays.reduce((s, d) => s + d.idleMinutes, 0),
        screenshotCount: shots || ts.screenshotCount,
      },
    });
  }

  /** Called on tracker.segmentsIngested / idle.claimDecided. */
  async rebuildForDates(employeeId: string, dates: string[]) {
    const weeks = [...new Set(dates.map((d) => mondayOf(d)))];
    for (const w of weeks) {
      const ts = await this.prisma.timesheet.findFirst({ where: { employeeId, weekStart: dateOf(w) } });
      if (ts) await this.rebuild(ts);
      else if (w <= istKeyOf(new Date())) await this.rebuild(await this.getOrCreate(employeeId, w));
    }
  }

  // ── read model ───────────────────────────────────────────────────────────
  async myWeek(weekStart?: string): Promise<TimesheetWeek> {
    const employeeId = this.org.myEmployeeId();
    const ws = weekStart ? mondayOf(weekStart) : defaultWeekStart(istKeyOf(new Date()));
    const ts = await this.rebuild(await this.getOrCreate(employeeId, ws));
    return this.weekDto(ts.id, { owner: true });
  }

  async weekFor(ctx: RequestContext, employeeId: string, weekStart: string): Promise<TimesheetWeek> {
    await this.assertCanView(ctx, employeeId);
    const ts = await this.prisma.timesheet.findFirst({ where: { employeeId, weekStart: dateOf(mondayOf(weekStart)) } });
    if (!ts) throw notFound('Timesheet');
    return this.weekDto(ts.id, { owner: employeeId === ctx.employeeId });
  }

  async weekDto(id: string, opts: { owner: boolean; scopeProjectId?: string | null }): Promise<TimesheetWeek> {
    const ts = await this.load(id);
    const from = keyOf(ts.weekStart);
    const to = keyOf(ts.weekEnd);
    const now = new Date();
    const today = istKeyOf(now);
    const emp = await this.policies.employee(ts.employeeId);
    if (!emp) throw notFound('Employee');
    const [shiftRow, holidays, idleDays, ohRows, adjustments, steps] = await Promise.all([
      this.policies.shiftFor(emp, from),
      this.policies.holidaysBetween(from, to),
      this.prisma.timesheetIdleDay.findMany({ where: { timesheetId: id } }),
      this.prisma.outsideHoursEntry.findMany({ where: { timesheetId: id }, orderBy: [{ date: 'asc' }, { startAt: 'asc' }] }),
      this.prisma.timesheetAdjustment.findMany({ where: { timesheetId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.timesheetApprovalStep.findMany({ where: { timesheetId: id, cycle: ts.cycle } }),
    ]);
    const shift = toShiftLike(shiftRow);
    const editable = opts.owner && isEditableStatus(ts.status);
    const days = [] as TimesheetWeek['days'];
    for (const d of daysBetween(from, to)) {
      days.push({
        date: d,
        dow: DOW_SHORT[dateOf(d).getUTCDay()]!,
        label: dm(d),
        future: d > today,
        weeklyOff: isWeeklyOff(d, shift),
        holiday: this.policies.holidayName(holidays, d, emp.workLocationId),
        locked: await this.locks.isLocked(d),
      });
    }
    const scoped = opts.scopeProjectId !== undefined;
    const allLines = ts.lines;
    const inScope = (l: TimesheetLine) => !scoped || l.projectId === opts.scopeProjectId;
    const lines: TimesheetLineDto[] = allLines.filter(inScope).map((l) => {
      const cells: TimesheetCellDto[] = days.map((day) => {
        const c = l.cells.find((x) => keyOf(x.date) === day.date);
        const adj = c ? adjustments.find((a) => a.cellId === c.id) : undefined;
        return {
          date: day.date,
          final: c?.finalMinutes ?? 0,
          tracked: c?.trackedMinutes ?? 0,
          adjustment: c?.adjustmentMinutes ?? 0,
          outsideHours: c?.outsideHoursMinutes ?? 0,
          idleAsWork: c?.idleAsWorkMinutes ?? 0,
          pendingIdle: c?.pendingIdleMinutes ?? 0,
          adjusted: !!c && c.adjustmentMinutes !== 0,
          adjustmentReason: adj?.reason ?? null,
          ohPending: ohRows.some((o) => o.lineId === l.id && keyOf(o.date) === day.date && o.reviewStatus === 'PENDING_PL'),
          editable: editable && !day.future && !day.locked,
          outOfPeriod: false,
        };
      });
      return { id: l.id, label: l.label, subLabel: l.subLabel, projectId: l.projectId, taskId: l.taskId, billable: l.billable, isManual: l.isManual, total: cells.reduce((s, c) => s + c.final, 0), cells };
    });
    const idleRow = days.map((d) => idleDays.find((x) => keyOf(x.date) === d.date)?.idleMinutes ?? 0);
    const dayTotals = days.map((_, i) => lines.reduce((s, l) => s + l.cells[i]!.final, 0));
    const projectIds = [...new Set(allLines.map((l) => l.projectId).filter((x): x is string => !!x))];
    const projects = await this.cross.projectMap([...projectIds, ...ohRows.map((o) => o.projectId).filter((x): x is string => !!x)]);
    const l1Steps = steps.filter((s) => s.level === 1 && s.status !== 'CANCELLED');
    const leadIds = l1Steps.length ? l1Steps.map((s) => s.approverEmployeeId) : [...projects.values()].filter((p) => !p.isInternal && p.leadEmployeeId && p.leadEmployeeId !== ts.employeeId).map((p) => p.leadEmployeeId!);
    const l2 = steps.find((s) => s.level === 2 && s.status !== 'CANCELLED');
    const nameIds = [...new Set([...leadIds, ...(l2 ? [l2.approverEmployeeId] : emp.managerId ? [emp.managerId] : [])])];
    const names = new Map((await this.prisma.employee.findMany({ where: { id: { in: nameIds } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
    const plNames = [...new Set(leadIds.map((x) => names.get(x)).filter((x): x is string => !!x))];
    const rmName = names.get(l2?.approverEmployeeId ?? emp.managerId ?? '') ?? null;
    const tones = chainTones(ts.status);
    const chain: TimesheetChainChip[] = [
      { key: 'employee', label: 'Employee', tone: tones[0], tooltip: emp.fullName },
      { key: 'pl', label: 'Project Lead', tone: tones[1], tooltip: plNames.join(', ') || 'No project lead review (internal work)' },
      { key: 'rm', label: 'Reporting Manager', tone: tones[2], tooltip: rmName ?? undefined },
      { key: 'payroll', label: 'Payroll', tone: tones[3] },
    ];
    const hasTrackerData = lines.some((l) => l.cells.some((c) => c.tracked > 0 || c.idleAsWork > 0 || c.pendingIdle > 0)) || idleRow.some((x) => x > 0);
    const outsideHours: OutsideHoursDto[] = ohRows
      .filter((o) => !scoped || o.projectId === opts.scopeProjectId)
      .map((o) => ({
        id: o.id,
        date: keyOf(o.date),
        dateLabel: dayLabel(keyOf(o.date)),
        from: istHm(o.startAt)!,
        to: istHm(o.endAt)!,
        minutes: o.minutes,
        taskText: o.taskText,
        projectId: o.projectId,
        projectName: o.projectId ? (projects.get(o.projectId)?.name ?? null) : null,
        reason: o.reason,
        reviewStatus: o.reviewStatus,
      }));
    const totals = {
      worked: lines.reduce((s, l) => s + l.total, 0),
      idle: idleRow.reduce((s, x) => s + x, 0),
      tracked: lines.reduce((s, l) => s + l.cells.reduce((a, c) => a + c.tracked, 0), 0),
      adjustments: lines.reduce((s, l) => s + l.cells.reduce((a, c) => a + c.adjustment, 0), 0),
      outsideHours: lines.reduce((s, l) => s + l.cells.reduce((a, c) => a + c.outsideHours, 0), 0),
      idleAsWork: lines.reduce((s, l) => s + l.cells.reduce((a, c) => a + c.idleAsWork, 0), 0),
    };
    const status = ts.status as TimesheetStatusKey;
    const actedSteps = steps.filter((s) => s.status === 'APPROVED' || s.status === 'RETURNED');
    return {
      id: ts.id,
      employee: { id: emp.id, name: emp.fullName },
      weekStart: from,
      weekEnd: to,
      label: weekLabel(from, to),
      shortLabel: weekLabel(from, to, true),
      status,
      statusLabel: TIMESHEET_STATUS_LABEL[status],
      editable,
      days,
      lines,
      idleRow,
      dayTotals,
      totals,
      chain,
      returned: ts.status === 'RETURNED' && ts.returnedComment ? { by: ts.returnedByName, comment: ts.returnedComment } : null,
      outsideHours,
      version: ts.version,
      submitLabel: submitLabel(ts.status),
      canSubmit: editable && submitOpen(from, now),
      canRecall: opts.owner && ts.status === 'SUBMITTED' && actedSteps.length === 0,
      hasTrackerData,
      screenshotCount: ts.screenshotCount,
      plNames,
    };
  }

  // ── employee edits ──────────────────────────────────────────────────────
  private async ownedEditable(id: string, expectedVersion?: number) {
    const me = this.org.myEmployeeId();
    const ts = await this.load(id);
    if (ts.employeeId !== me) throw forbidden('You can only edit your own timesheet');
    if (!isEditableStatus(ts.status)) throw new AppError(409, 'TIMESHEET_NOT_EDITABLE', 'This timesheet has been submitted · recall it to make changes');
    if (expectedVersion !== undefined && expectedVersion !== ts.version) throw new AppError(409, 'VERSION_CONFLICT', 'Your timesheet changed in another tab · reload and try again');
    return ts;
  }

  private assertInWeek(ts: Timesheet, date: string) {
    if (date < keyOf(ts.weekStart) || date > keyOf(ts.weekEnd)) throw badRequest('Pick a date inside this week');
  }

  private async bump(id: string, type: string, comment?: string | null) {
    const ctx = getContext();
    await this.prisma.timesheet.update({ where: { id }, data: { version: { increment: 1 } } });
    await this.prisma.timesheetEvent.create({ data: { timesheetId: id, type, actorName: ctx?.userName ?? null, comment: comment ?? null } as any });
  }

  async editCell(id: string, input: CellEditInput): Promise<TimesheetWeek> {
    const ts = await this.ownedEditable(id, input.expectedVersion);
    this.assertInWeek(ts, input.date);
    if (input.date > istKeyOf(new Date())) throw new AppError(422, 'FUTURE_DATE', "You can't log time for a future date");
    await this.locks.assertOpen(input.date);
    const line = ts.lines.find((l) => l.id === input.lineId);
    if (!line) throw notFound('Timesheet line');
    let cell = line.cells.find((c) => keyOf(c.date) === input.date) ?? null;
    const parts = cell ?? { trackedMinutes: 0, idleAsWorkMinutes: 0, outsideHoursMinutes: 0, adjustmentMinutes: 0 };
    const plan = planCellEdit(parts, input.minutes);
    if (!plan) return this.weekDto(id, { owner: true });
    const dayCells = ts.lines.flatMap((l) => l.cells.filter((c) => keyOf(c.date) === input.date));
    const dayTotalBefore = dayCells.reduce((s, c) => s + c.finalMinutes, 0);
    const attendance = await this.prisma.attendanceDay.findFirst({ where: { employeeId: ts.employeeId, date: dateOf(input.date) }, select: { workedMinutes: true } });
    const needReason = reasonRequired({
      hasTrackerData: dayCells.some((c) => c.trackedMinutes > 0 || c.idleAsWorkMinutes > 0),
      dayTotalAfter: dayTotalBefore - (cell?.finalMinutes ?? 0) + input.minutes,
      attendanceWorked: attendance?.workedMinutes ?? 0,
    });
    const reason = input.reason?.trim() ?? '';
    if (needReason && reason.length < 10) throw new AppError(422, 'REASON_REQUIRED', 'Edits to tracked time need a reason (at least 10 characters)');
    const tenantId = currentTenantId();
    const final = cellFinal({ ...parts, adjustmentMinutes: plan.adjustmentMinutes });
    if (cell) cell = await this.prisma.timesheetCell.update({ where: { id: cell.id }, data: { adjustmentMinutes: plan.adjustmentMinutes, finalMinutes: final } });
    else cell = await this.prisma.timesheetCell.create({ data: { tenantId, lineId: line.id, date: dateOf(input.date), adjustmentMinutes: plan.adjustmentMinutes, finalMinutes: final } });
    const ctx = requireContext();
    await this.prisma.timesheetAdjustment.create({
      data: { tenantId, timesheetId: id, cellId: cell.id, fromMinutes: input.minutes - plan.deltaMinutes, toMinutes: input.minutes, deltaMinutes: plan.deltaMinutes, kind: plan.kind, reason: reason || 'Manual entry', reviewStatus: plan.reviewStatus, createdByName: ctx.userName ?? null },
    });
    await this.bump(id, 'cell.adjusted', `${line.label} · ${dayLabel(input.date)} → ${input.minutes} min`);
    await this.refreshTotals(id);
    await this.audit.record({ action: 'timesheet.cell.adjusted', entity: 'Timesheet', entityId: id, meta: { lineId: line.id, date: input.date, delta: plan.deltaMinutes, kind: plan.kind } });
    return this.weekDto(id, { owner: true });
  }

  async addLine(id: string, input: AddLineInput): Promise<TimesheetWeek> {
    const ts = await this.ownedEditable(id);
    const tenantId = currentTenantId();
    let label = input.label?.trim() || '';
    let subLabel: string | null = null;
    let projectId = input.projectId ?? null;
    let billable = false;
    if (input.taskId) {
      if (ts.lines.some((l) => l.taskId === input.taskId)) throw new AppError(409, 'DUPLICATE', 'This task is already on your timesheet');
      const task = (await this.cross.tasks([input.taskId]))[0];
      if (!task) throw notFound('Task');
      projectId = task.projectId;
      label = `${task.key} ${task.title}`;
      const p = (await this.cross.projects([task.projectId]))[0];
      subLabel = p ? (p.isInternal ? 'Internal' : `${p.name}${task.moduleName ? ` · ${task.moduleName}` : ''}`) : null;
      billable = !!p && p.billable && !p.isInternal;
    } else if (projectId) {
      const p = (await this.cross.projects([projectId]))[0];
      if (!p) throw notFound('Project');
      label = label || p.name;
      subLabel = p.isInternal ? 'Internal' : p.name;
      billable = p.billable && !p.isInternal;
    }
    if (!label) throw badRequest('Pick a task or project');
    await this.prisma.timesheetLine.create({
      data: { tenantId, timesheetId: id, taskId: input.taskId ?? null, projectId, label, subLabel, billable, isManual: true, sortOrder: ts.lines.length + 1 },
    });
    await this.bump(id, 'line.added', label);
    return this.weekDto(id, { owner: true });
  }

  async removeLine(id: string, lineId: string): Promise<TimesheetWeek> {
    const ts = await this.ownedEditable(id);
    const line = ts.lines.find((l) => l.id === lineId);
    if (!line) throw notFound('Timesheet line');
    if (!line.isManual || line.cells.some((c) => c.trackedMinutes > 0 || c.outsideHoursMinutes > 0)) throw new AppError(409, 'LINE_HAS_TIME', 'Only manual lines without tracked time can be removed');
    await this.prisma.timesheetLine.delete({ where: { id: lineId } });
    await this.bump(id, 'line.removed', line.label);
    await this.refreshTotals(id);
    return this.weekDto(id, { owner: true });
  }

  // ── outside hours ───────────────────────────────────────────────────────
  async logOutsideHours(id: string, input: OutsideHoursInput): Promise<TimesheetWeek> {
    const ts = await this.ownedEditable(id);
    this.assertInWeek(ts, input.date);
    if (input.date > istKeyOf(new Date())) throw new AppError(422, 'FUTURE_DATE', "You can't log time for a future date");
    await this.locks.assertOpen(input.date);
    const fromMin = parseHm(input.from);
    const toMin = parseHm(input.to);
    const { minutes, error } = outsideHoursMinutes(fromMin, toMin);
    if (error) throw new AppError(422, 'OUTSIDE_HOURS_INVALID', error);
    const startAt = istInstant(input.date, fromMin);
    const endAt = istInstant(input.date, toMin);
    const overlap = await this.prisma.outsideHoursEntry.findFirst({ where: { employeeId: ts.employeeId, date: dateOf(input.date), reviewStatus: { not: 'REJECTED' }, startAt: { lt: endAt }, endAt: { gt: startAt } } });
    if (overlap) throw new AppError(409, 'OUTSIDE_HOURS_OVERLAP', 'This overlaps another outside-hours entry');
    const project = (await this.cross.projects([input.projectId]))[0];
    if (!project) throw notFound('Project');
    const tenantId = currentTenantId();
    let line = input.taskId ? ts.lines.find((l) => l.taskId === input.taskId) : ts.lines.find((l) => !l.taskId && l.projectId === input.projectId);
    if (!line) {
      const task = input.taskId ? (await this.cross.tasks([input.taskId]))[0] : undefined;
      const created = await this.prisma.timesheetLine.create({
        data: {
          tenantId,
          timesheetId: id,
          taskId: input.taskId ?? null,
          projectId: input.projectId,
          label: task ? `${task.key} ${task.title}` : input.taskText,
          subLabel: project.isInternal ? 'Internal' : project.name,
          billable: project.billable && !project.isInternal,
          isManual: true,
          sortOrder: ts.lines.length + 1,
        },
      });
      line = { ...created, cells: [] };
    }
    const entry = await this.prisma.outsideHoursEntry.create({
      data: { employeeId: ts.employeeId, timesheetId: id, lineId: line.id, projectId: input.projectId, taskId: input.taskId ?? null, taskText: input.taskText, date: dateOf(input.date), startAt, endAt, minutes, reason: input.reason, reviewStatus: 'PENDING_PL' } as any,
    });
    await this.syncOutsideHours(id);
    await this.bump(id, 'outside_hours.logged', `${input.taskText} · ${dayLabel(input.date)} ${input.from}–${input.to}`);
    await this.audit.record({ action: 'timesheet.outside_hours.logged', entity: 'OutsideHoursEntry', entityId: entry.id, meta: { date: input.date, minutes, projectId: input.projectId } });
    return this.weekDto(id, { owner: true });
  }

  async deleteOutsideHours(entryId: string): Promise<TimesheetWeek> {
    const e = await this.prisma.outsideHoursEntry.findFirst({ where: { id: entryId } });
    if (!e) throw notFound('Outside-hours entry');
    await this.ownedEditable(e.timesheetId);
    await this.prisma.outsideHoursEntry.delete({ where: { id: entryId } });
    await this.syncOutsideHours(e.timesheetId);
    await this.bump(e.timesheetId, 'outside_hours.removed', e.taskText);
    return this.weekDto(e.timesheetId, { owner: true });
  }

  /** Cell outsideHours = Σ non-rejected entries on that line/day. */
  async syncOutsideHours(timesheetId: string) {
    const ts = await this.load(timesheetId);
    const entries = await this.prisma.outsideHoursEntry.findMany({ where: { timesheetId, reviewStatus: { not: 'REJECTED' } } });
    const sum = new Map<string, number>();
    for (const e of entries) if (e.lineId) sum.set(`${e.lineId}|${keyOf(e.date)}`, (sum.get(`${e.lineId}|${keyOf(e.date)}`) ?? 0) + e.minutes);
    const tenantId = currentTenantId();
    for (const l of ts.lines) {
      const keys = new Set([...l.cells.map((c) => keyOf(c.date)), ...[...sum.keys()].filter((k) => k.startsWith(`${l.id}|`)).map((k) => k.split('|')[1]!)]);
      for (const d of keys) {
        const oh = sum.get(`${l.id}|${d}`) ?? 0;
        const c = l.cells.find((x) => keyOf(x.date) === d);
        if (c) {
          if (c.outsideHoursMinutes !== oh) await this.prisma.timesheetCell.update({ where: { id: c.id }, data: { outsideHoursMinutes: oh, finalMinutes: cellFinal({ ...c, outsideHoursMinutes: oh }) } });
        } else if (oh) {
          await this.prisma.timesheetCell.create({ data: { tenantId, lineId: l.id, date: dateOf(d), outsideHoursMinutes: oh, finalMinutes: oh } });
        }
      }
    }
    await this.refreshTotals(timesheetId);
  }

  // ── submit / recall ─────────────────────────────────────────────────────
  async submit(id: string, input: { expectedVersion?: number; confirmEmpty?: boolean }): Promise<SubmitResult> {
    let ts: Timesheet = await this.ownedEditable(id, input.expectedVersion);
    const now = new Date();
    if (!submitOpen(keyOf(ts.weekStart), now)) throw new AppError(422, 'SUBMIT_TOO_EARLY', `You can submit this week from Fri ${dm(addDays(keyOf(ts.weekStart), 4))}, 15:00`);
    ts = await this.rebuild(ts);
    if (ts.totalMinutes <= 0 && !input.confirmEmpty) throw new AppError(422, 'EMPTY_TIMESHEET', 'This timesheet has no hours · add time before submitting');
    const emp = (await this.policies.employee(ts.employeeId))!;
    const full = await this.load(id);
    const oh = await this.prisma.outsideHoursEntry.findMany({ where: { timesheetId: id, reviewStatus: { not: 'REJECTED' } } });
    const routeLines = [
      ...full.lines.map((l) => ({ projectId: l.projectId, minutes: l.cells.reduce((s, c) => s + c.finalMinutes, 0) })),
      ...oh.map((o) => ({ projectId: o.projectId, minutes: o.minutes })),
    ];
    const projects = await this.cross.projectMap(routeLines.map((l) => l.projectId).filter((x): x is string => !!x));
    const l1 = planL1(ts.employeeId, routeLines, projects);
    const cycle = ts.cycle + 1;
    const tenantId = currentTenantId();
    const dueAt = new Date(now.getTime() + L1_SLA_HOURS * 3600_000);
    for (const p of l1) {
      await this.prisma.timesheetApprovalStep.create({
        data: { tenantId, timesheetId: id, cycle, level: 1, projectId: p.projectId, approverEmployeeId: p.approverEmployeeId, status: p.status, dueAt, ...(p.status === 'SKIPPED_SELF' ? { actedAt: now, comment: 'Skipped: you lead this project' } : {}) },
      });
    }
    const pendingL1 = l1.filter((p) => p.status === 'PENDING');
    let status: TimesheetStatusKey = 'SUBMITTED';
    let l2Name: string | null = null;
    const notifyIds: string[] = pendingL1.map((p) => p.approverEmployeeId);
    if (!pendingL1.length) {
      const l2 = await this.createL2(ts, cycle, emp, []);
      status = l2 ? 'PENDING_RM' : 'APPROVED';
      if (l2) {
        notifyIds.push(l2.approverEmployeeId);
        l2Name = (await this.prisma.employee.findFirst({ where: { id: l2.approverEmployeeId }, select: { fullName: true } }))?.fullName ?? null;
      }
    }
    await this.prisma.timesheet.update({
      where: { id },
      data: { status, cycle, submittedAt: now, returnedComment: null, returnedByName: null, hasLateData: false, version: { increment: 1 }, ...(status === 'APPROVED' ? { approvedAt: now } : {}) },
    });
    await this.prisma.timesheetEvent.create({ data: { timesheetId: id, type: 'submitted', actorName: emp.fullName } as any });
    const label = weekLabel(keyOf(ts.weekStart), keyOf(ts.weekEnd), true);
    const users = await this.notifications.usersForEmployees(notifyIds);
    await this.notifications.notify({ userIds: users, type: 'approval', title: `${emp.fullName} submitted a timesheet · ${label}`, body: 'Review hours, screenshots and flagged items.', link: '/approvals', from: emp.fullName });
    for (const u of users) this.realtime.toUser(u, 'approvals.counts', {});
    await this.audit.record({ action: 'timesheet.submitted', entity: 'Timesheet', entityId: id, meta: { cycle, l1: l1.map((p) => ({ projectId: p.projectId, status: p.status })), status } });
    this.events.emit('timesheet.submitted', { timesheetId: id, employeeId: ts.employeeId, weekStart: keyOf(ts.weekStart) });
    if (status === 'APPROVED') this.events.emit('timesheet.approved', { timesheetId: id, employeeId: ts.employeeId, weekStart: keyOf(ts.weekStart) });
    const pendingNames = (await this.prisma.employee.findMany({ where: { id: { in: pendingL1.map((p) => p.approverEmployeeId) } }, select: { fullName: true } })).map((e) => e.fullName);
    return { status, message: submitMessage([...new Set(pendingNames)], l2Name, status) };
  }

  /** Create the Level-2 step (RM → any admin). Returns null when nobody can approve (auto-approve). */
  async createL2(ts: Timesheet, cycle: number, emp: { id: string; managerId: string | null }, l1ApprovedBy: string[]) {
    const admins = await this.prisma.employee.findMany({ where: { status: { in: [...ACTIVE] }, user: { role: { key: 'admin' } } }, select: { id: true } });
    const plan = planL2({ employeeId: emp.id, managerId: emp.managerId, adminEmployeeIds: admins.map((a) => a.id), l1ApprovedBy, skipDuplicateApprover: false });
    if (!plan) return null;
    // NULL projectIds are distinct in the unique index, so find/create instead of upsert.
    const found = await this.prisma.timesheetApprovalStep.findFirst({ where: { timesheetId: ts.id, cycle, level: 2 } });
    if (found) return this.prisma.timesheetApprovalStep.update({ where: { id: found.id }, data: { approverEmployeeId: plan.approverEmployeeId, status: plan.status } });
    return this.prisma.timesheetApprovalStep.create({
      data: { tenantId: currentTenantId(), timesheetId: ts.id, cycle, level: 2, projectId: null, approverEmployeeId: plan.approverEmployeeId, status: plan.status, dueAt: new Date(Date.now() + L1_SLA_HOURS * 3600_000) },
    });
  }

  async recall(id: string): Promise<TimesheetWeek> {
    const me = this.org.myEmployeeId();
    const ts = await this.load(id);
    if (ts.employeeId !== me) throw forbidden('You can only recall your own timesheet');
    const steps = await this.prisma.timesheetApprovalStep.findMany({ where: { timesheetId: id, cycle: ts.cycle } });
    if (ts.status !== 'SUBMITTED' || steps.some((s) => s.status === 'APPROVED' || s.status === 'RETURNED')) throw new AppError(409, 'CANNOT_RECALL', 'A reviewer has already acted on this timesheet');
    await this.prisma.timesheetApprovalStep.updateMany({ where: { timesheetId: id, cycle: ts.cycle, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await this.prisma.timesheet.update({ where: { id }, data: { status: 'DRAFT', submittedAt: null, version: { increment: 1 } } });
    await this.prisma.timesheetEvent.create({ data: { timesheetId: id, type: 'recalled', actorName: requireContext().userName ?? null } as any });
    const users = await this.notifications.usersForEmployees(steps.map((s) => s.approverEmployeeId));
    for (const u of users) this.realtime.toUser(u, 'approvals.counts', {});
    await this.audit.record({ action: 'timesheet.recalled', entity: 'Timesheet', entityId: id });
    return this.weekDto(id, { owner: true });
  }

  /** Admin reopen of an approved (not locked) sheet → RETURNED. */
  async reopen(id: string, reason: string) {
    const ctx = requireContext();
    if (!(ctx.permissions.has('*') || ctx.roleKey === 'admin')) throw forbidden('Only an admin can reopen an approved timesheet');
    const ts = await this.load(id);
    if (ts.employeeId === ctx.employeeId) throw forbidden("You can't reopen your own timesheet");
    if (ts.status !== 'APPROVED') throw new AppError(409, 'NOT_APPROVED', 'Only approved timesheets can be reopened');
    await this.prisma.timesheet.update({ where: { id }, data: { status: 'RETURNED', returnedComment: reason, returnedByName: ctx.userName ?? 'Admin', approvedAt: null, version: { increment: 1 } } });
    await this.prisma.timesheetEvent.create({ data: { timesheetId: id, type: 'reopened', actorName: ctx.userName ?? null, comment: reason } as any });
    await this.audit.record({ action: 'timesheet.reopened', entity: 'Timesheet', entityId: id, meta: { reason } });
    const users = await this.notifications.usersForEmployees([ts.employeeId]);
    await this.notifications.notify({ userIds: users, type: 'timesheet', title: `Your timesheet for ${weekLabel(keyOf(ts.weekStart), keyOf(ts.weekEnd), true)} was reopened`, body: reason, link: '/timesheet', from: ctx.userName });
    this.events.emit('timesheet.returned', { timesheetId: id, employeeId: ts.employeeId, weekStart: keyOf(ts.weekStart) });
    return { ok: true };
  }

  // ── lists / options ─────────────────────────────────────────────────────
  async assertCanView(ctx: RequestContext, employeeId: string) {
    if (employeeId === ctx.employeeId) return;
    if (hasPerm(ctx, 'attendance.manage') || hasPerm(ctx, 'payroll.manage') || ctx.roleKey === 'admin') return;
    const me = ctx.employeeId;
    if (!me) throw forbidden();
    const [reports, team] = await Promise.all([this.org.reportTree(me), this.cross.projectTeam(me)]);
    if (!reports.includes(employeeId) && !team.includes(employeeId)) throw forbidden("You can't view this timesheet");
  }

  async list(q: { status?: string; weekStart?: string; employeeId?: string; mine?: boolean }): Promise<TimesheetListRow[]> {
    const ctx = requireContext();
    const where: Prisma.TimesheetWhereInput = {};
    if (q.mine) where.employeeId = this.org.myEmployeeId();
    else if (!(hasPerm(ctx, 'attendance.manage') || hasPerm(ctx, 'payroll.manage') || ctx.roleKey === 'admin')) {
      const me = ctx.employeeId ?? '__none__';
      where.employeeId = { in: [me, ...(await this.org.reportTree(me))] };
    }
    if (q.employeeId) where.AND = [{ employeeId: q.employeeId }];
    if (q.status && q.status !== 'ALL') where.status = q.status as any;
    if (q.weekStart) where.weekStart = dateOf(mondayOf(q.weekStart));
    const rows = await this.prisma.timesheet.findMany({ where, orderBy: [{ weekStart: 'desc' }], take: 200 });
    const names = new Map((await this.prisma.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: names.get(r.employeeId) ?? '—',
      weekStart: keyOf(r.weekStart),
      label: weekLabel(keyOf(r.weekStart), keyOf(r.weekEnd), true),
      status: r.status as TimesheetStatusKey,
      statusLabel: TIMESHEET_STATUS_LABEL[r.status as TimesheetStatusKey],
      totalMinutes: r.totalMinutes,
      idleMinutes: r.idleMinutes,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      approvedAt: r.approvedAt?.toISOString() ?? null,
    }));
  }

  async options(): Promise<TimesheetOptions> {
    const me = this.org.myEmployeeId();
    const tasks = await this.cross.assignableTasks(me);
    const projectIds = [...new Set([...(await this.cross.memberProjectIds(me)), ...tasks.map((t) => t.projectId)])];
    const projects: ProjectRow[] = projectIds.length ? await this.cross.projects(projectIds) : [];
    const pm = new Map(projects.map((p) => [p.id, p]));
    return {
      projects: projects.filter((p) => !['ARCHIVED', 'CANCELLED'].includes(p.status ?? '')).map((p) => ({ id: p.id, name: p.name, key: p.key, isInternal: p.isInternal })),
      tasks: tasks.map((t) => ({ id: t.id, key: t.key, title: t.title, projectId: t.projectId, projectName: pm.get(t.projectId)?.name ?? '' })),
    };
  }

  /** Friday reminder: employees with a required, unsubmitted sheet for this week. */
  async remindUnsubmitted(now = new Date()) {
    const ws = mondayOf(istKeyOf(now));
    const emps = await this.prisma.employee.findMany({ where: { status: { in: [...ACTIVE] }, employmentType: { not: 'INTERN' }, userId: { not: null } }, select: { id: true, userId: true, workMode: true } });
    const sheets = await this.prisma.timesheet.findMany({ where: { weekStart: dateOf(ws), status: { notIn: ['DRAFT', 'RETURNED'] } }, select: { employeeId: true } });
    const done = new Set(sheets.map((s) => s.employeeId));
    const office = await this.policies.get('OFFICE');
    const remote = await this.policies.get('REMOTE');
    const users = emps.filter((e) => !done.has(e.id) && (e.workMode === 'OFFICE' ? office : remote).timesheetRequired).map((e) => e.userId!);
    await this.notifications.notify({ userIds: users, type: 'timesheet.reminder', title: `Submit your timesheet for ${weekLabel(ws, addDays(ws, 6), true)}`, body: 'Review tracked hours and submit before Monday 12:00.', link: '/timesheet', from: 'Timesheets' });
    return users.length;
  }

  /** payroll.finalized → approved sheets overlapping the period become LOCKED. */
  async lockForPeriod(period: string) {
    const from = dateOf(`${period}-01`);
    const [y, m] = period.split('-').map(Number) as [number, number];
    const to = new Date(Date.UTC(y, m, 0));
    const res = await this.prisma.timesheet.updateMany({ where: { status: 'APPROVED', weekStart: { lte: to }, weekEnd: { gte: from } }, data: { status: 'LOCKED', lockedAt: new Date() } });
    return res.count;
  }
}
