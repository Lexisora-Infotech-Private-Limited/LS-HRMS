import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Timesheet, TimesheetCell, TimesheetLine } from '@prisma/client';
import {
  TASK_STATUS_LABELS,
  TIMESHEET_STATUS_LABEL,
  roundTaskMinutes,
  type AddLineInput,
  type ApproveStepInput,
  type CellEditInput,
  type OutsideHoursDto,
  type OutsideHoursInput,
  type SubmitResult,
  type TimesheetCellDto,
  type TimesheetChainChip,
  type TimesheetDay,
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
import { isWeeklyOff, requiredMinutes } from '../lib/day-calc';
import { KeyedLock } from '../lib/keyed-lock';
import { planL1, planL2, submitMessage } from '../lib/routing';
import {
  cellFinal,
  chainTones,
  countedCeiling,
  decidePending,
  expectedMinutes,
  isActiveTask,
  isEditableStatus,
  isQuietLine,
  leaveLabel,
  MAX_DAY_MINUTES,
  outsideHoursMinutes,
  planCellEdit,
  reanchorPending,
  reasonRequired,
  submitLabel,
} from '../lib/timesheet-calc';
import { addDays, dateOf, dayLabel, daysBetween, dm, DOW_SHORT, hm, istHm, istInstant, istKeyOf, keyOf, mondayOf, parseHm, weekLabel } from '../lib/time-utils';
import { PeriodLockService } from './period-lock.service';
import { PolicyService, toShiftLike } from './policy.service';

type SheetWithLines = Timesheet & { lines: (TimesheetLine & { cells: TimesheetCell[] })[] };
type ItemDecision = ApproveStepInput['decisions'][number];
type Acc = { tracked: number; idleAsWork: number; pending: number };
const ACC_FIELDS = ['tracked', 'idleAsWork', 'pending'] as const;
const ACTIVE = ['ACTIVE', 'NOTICE_PERIOD'] as const;
const L1_SLA_HOURS = 48;
/** Time a cell holds for the day: counted + waiting for review. */
const claimedOf = (c: TimesheetCell) => c.finalMinutes + c.pendingAdjustmentMinutes + c.pendingOutsideMinutes;

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
  /** One writer per sheet: tracker rebuilds, edits, outside hours, submit and review decisions. */
  private readonly lock = new KeyedLock();
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
  /** Run work that changes a sheet's cells one at a time per sheet (no lost updates between rebuilds and edits). */
  withSheetLock<T>(timesheetId: string, fn: () => Promise<T>): Promise<T> {
    return this.lock.run(timesheetId, fn);
  }

  /**
   * Rebuild tracked / idle-as-work / pending-idle minutes and the idle row from tracker
   * ActivitySegments (WORK + approved IDLE_WORK). Idempotent: every run recomputes from all the
   * week's segments. Submitted sheets keep their snapshot; late data only raises the "late data"
   * banner for approvers.
   */
  rebuild(ts: Timesheet): Promise<Timesheet> {
    return this.lock.run(ts.id, () => this.rebuildNow(ts.id));
  }

  /** Idle-claim decision of each claimed segment: the approval step's decision wins over the tracker's status. */
  private async claimStatuses(employeeId: string, from: string, to: string): Promise<Map<string, string>> {
    const claims = await this.cross.idleClaims(employeeId, from, to);
    const decisions = claims.length ? await this.prisma.timesheetItemDecision.findMany({ where: { itemType: 'IDLE_CLAIM', refId: { in: claims.map((c) => c.id) } }, select: { refId: true, decision: true } }) : [];
    const byClaim = new Map(decisions.map((d) => [d.refId, d.decision]));
    const out = new Map<string, string>();
    for (const c of claims) if (c.segmentId) out.set(c.segmentId, byClaim.get(c.id) ?? c.status);
    return out;
  }

  /**
   * `claims`: refresh only the idle-claim parts of a submitted sheet after a review decision
   * (tracked time stays as submitted).
   */
  private async rebuildNow(id: string, opts: { claims?: boolean } = {}): Promise<Timesheet> {
    const ts = await this.prisma.timesheet.findFirst({ where: { id } });
    if (!ts) throw notFound('Timesheet');
    const from = keyOf(ts.weekStart);
    const to = keyOf(ts.weekEnd);
    const segs = await this.cross.segments(ts.employeeId, from, to);
    const frozen = !isEditableStatus(ts.status);
    if (frozen && !opts.claims) {
      if (segs.length && ts.submittedAt && segs.some((s) => (s as any).createdAt && (s as any).createdAt > ts.submittedAt!) && !ts.hasLateData) {
        return this.prisma.timesheet.update({ where: { id: ts.id }, data: { hasLateData: true } });
      }
      return ts;
    }
    const full = await this.load(ts.id);
    const hasTrackerCells = full.lines.some((l) => l.cells.some((c) => c.trackedMinutes || c.idleAsWorkMinutes || c.pendingIdleMinutes));
    if (!segs.length && !hasTrackerCells) return this.refreshTotals(ts.id);

    const claimStatus = await this.claimStatuses(ts.employeeId, from, to);
    // Seconds per row and day; rounded to minutes per day below so a day's rows add up to the day.
    const groups = new Map<string, { taskId: string | null; projectId: string | null; sec: Map<string, Acc> }>();
    const idleSec = new Map<string, number>();
    const add = (s: (typeof segs)[number], field: keyof Acc, sec: number) => {
      const key = s.taskId ? `t:${s.taskId}` : s.projectId ? `p:${s.projectId}` : 'general';
      const g = groups.get(key) ?? { taskId: s.taskId ?? null, projectId: s.projectId ?? null, sec: new Map() };
      const day = keyOf(s.workDate);
      const acc = g.sec.get(day) ?? { tracked: 0, idleAsWork: 0, pending: 0 };
      acc[field] += sec;
      g.sec.set(day, acc);
      groups.set(key, g);
    };
    for (const s of segs) {
      const sec = s.durationSec;
      if (sec <= 0) continue;
      const day = keyOf(s.workDate);
      if (s.kind === 'WORK') add(s, 'tracked', sec);
      else if (s.kind === 'IDLE_WORK' || (s.kind === 'IDLE' && s.idleResolution === 'CLAIMED_WORK')) {
        const st = claimStatus.get(s.id) ?? 'PENDING';
        if (st === 'APPROVED') add(s, 'idleAsWork', sec);
        else if (st === 'PENDING') add(s, 'pending', sec);
        else idleSec.set(day, (idleSec.get(day) ?? 0) + sec);
      } else if (s.kind === 'IDLE' && s.idleResolution !== 'AS_BREAK') idleSec.set(day, (idleSec.get(day) ?? 0) + sec);
    }
    const days = daysBetween(from, to);
    const minutesBy = new Map<string, Map<string, Acc>>(); // group key → day → minutes
    for (const field of ACC_FIELDS) {
      for (const d of days) {
        const perKey: Record<string, number> = {};
        for (const [k, g] of groups) {
          const v = g.sec.get(d)?.[field] ?? 0;
          if (v > 0) perKey[k] = v;
        }
        if (!Object.keys(perKey).length) continue;
        for (const [k, m] of Object.entries(roundTaskMinutes(perKey))) {
          const byDay = minutesBy.get(k) ?? new Map<string, Acc>();
          const acc = byDay.get(d) ?? { tracked: 0, idleAsWork: 0, pending: 0 };
          acc[field] = m;
          byDay.set(d, acc);
          minutesBy.set(k, byDay);
        }
      }
    }

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

    const target = new Map<string, Map<string, Acc>>(); // lineId → day → minutes
    for (const [key, g] of groups) {
      const byDay = minutesBy.get(key);
      if (!byDay) continue;
      // A submitted sheet only takes idle-claim changes: no new rows for late tracked time.
      if (frozen && ![...byDay.values()].some((a) => a.idleAsWork || a.pending)) continue;
      const line = await lineFor(g);
      const m = target.get(line.id) ?? new Map<string, Acc>();
      for (const [d, acc] of byDay) {
        const prev = m.get(d) ?? { tracked: 0, idleAsWork: 0, pending: 0 };
        m.set(d, { tracked: prev.tracked + acc.tracked, idleAsWork: prev.idleAsWork + acc.idleAsWork, pending: prev.pending + acc.pending });
      }
      target.set(line.id, m);
    }
    // Claims waiting for review are re-anchored when tracked time arrives under them.
    const pendingEdits = frozen ? [] : await this.prisma.timesheetAdjustment.findMany({ where: { timesheetId: ts.id, reviewStatus: 'PENDING_PL' }, orderBy: { createdAt: 'desc' } });
    for (const line of lines) {
      const m = target.get(line.id);
      for (const d of days) {
        const acc = m?.get(d) ?? { tracked: 0, idleAsWork: 0, pending: 0 };
        const cell = line.cells.find((c) => keyOf(c.date) === d);
        const tracked = frozen ? (cell?.trackedMinutes ?? 0) : acc.tracked;
        if (!cell) {
          if (!tracked && !acc.idleAsWork && !acc.pending) continue;
          await this.prisma.timesheetCell.create({
            data: { tenantId, lineId: line.id, date: dateOf(d), trackedMinutes: tracked, idleAsWorkMinutes: acc.idleAsWork, pendingIdleMinutes: acc.pending, finalMinutes: cellFinal({ trackedMinutes: tracked, idleAsWorkMinutes: acc.idleAsWork, outsideHoursMinutes: 0, adjustmentMinutes: 0 }) },
          });
          continue;
        }
        const parts = { trackedMinutes: tracked, idleAsWorkMinutes: acc.idleAsWork, outsideHoursMinutes: cell.outsideHoursMinutes, adjustmentMinutes: cell.adjustmentMinutes };
        let pendingAdj = cell.pendingAdjustmentMinutes;
        const claim = pendingAdj > 0 ? pendingEdits.find((a) => a.cellId === cell.id) : undefined;
        if (claim) {
          pendingAdj = reanchorPending(parts, claim.toMinutes);
          if (pendingAdj !== cell.pendingAdjustmentMinutes) {
            await this.prisma.timesheetAdjustment.update({
              where: { id: claim.id },
              data: pendingAdj > 0 ? { deltaMinutes: pendingAdj, fromMinutes: countedCeiling(parts) } : { reviewStatus: 'SUPERSEDED', reviewedByName: 'Covered by tracked time', reviewedAt: new Date() },
            });
          }
        }
        if (cell.trackedMinutes !== tracked || cell.idleAsWorkMinutes !== acc.idleAsWork || cell.pendingIdleMinutes !== acc.pending || pendingAdj !== cell.pendingAdjustmentMinutes) {
          await this.prisma.timesheetCell.update({
            where: { id: cell.id },
            data: { trackedMinutes: tracked, idleAsWorkMinutes: acc.idleAsWork, pendingIdleMinutes: acc.pending, pendingAdjustmentMinutes: pendingAdj, finalMinutes: cellFinal(parts) },
          });
        }
      }
    }
    for (const d of days) {
      const minutes = Math.round((idleSec.get(d) ?? 0) / 60);
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
        pendingMinutes: cells.reduce((s, c) => s + c.pendingAdjustmentMinutes + c.pendingOutsideMinutes, 0),
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

  /** "Refresh from tracker": the same idempotent rebuild the tracker sync runs; never touches a submitted week. */
  async refresh(id: string): Promise<{ week: TimesheetWeek; message: string }> {
    const me = this.org.myEmployeeId();
    const ts = await this.load(id);
    if (ts.employeeId !== me) throw forbidden('You can only refresh your own timesheet');
    if (!isEditableStatus(ts.status)) {
      return { week: await this.weekDto(id, { owner: true }), message: `This week is ${TIMESHEET_STATUS_LABEL[ts.status as TimesheetStatusKey].toLowerCase()} · tracker time that arrives now is flagged for your approver` };
    }
    const after = await this.rebuild(ts);
    const week = await this.weekDto(id, { owner: true });
    return { week, message: `Updated from the tracker · ${hm(after.totalMinutes)} this week${after.pendingMinutes ? ` + ${hm(after.pendingMinutes)} waiting for review` : ''}` };
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
    const [shiftRow, holidays, idleDays, ohRows, adjustments, steps, leaveRows] = await Promise.all([
      this.policies.shiftFor(emp, from),
      this.policies.holidaysBetween(from, to),
      this.prisma.timesheetIdleDay.findMany({ where: { timesheetId: id } }),
      this.prisma.outsideHoursEntry.findMany({ where: { timesheetId: id }, orderBy: [{ date: 'asc' }, { startAt: 'asc' }] }),
      this.prisma.timesheetAdjustment.findMany({ where: { timesheetId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.timesheetApprovalStep.findMany({ where: { timesheetId: id, cycle: ts.cycle } }),
      this.cross.leaveDays([ts.employeeId], from, to),
    ]);
    const shift = toShiftLike(shiftRow);
    const required = requiredMinutes(shift);
    const editable = opts.owner && isEditableStatus(ts.status);
    const days: TimesheetDay[] = [];
    for (const d of daysBetween(from, to)) {
      const weeklyOff = isWeeklyOff(d, shift);
      const holiday = this.policies.holidayName(holidays, d, emp.workLocationId);
      const onDay = leaveRows.filter((r) => r.date === d);
      const lv = CrossReader.leaveOnDay(onDay);
      const session = lv && lv.fraction < 1 ? (onDay.find((r) => r.session !== 'FULL')?.session ?? null) : null;
      days.push({
        date: d,
        dow: DOW_SHORT[dateOf(d).getUTCDay()]!,
        label: dm(d),
        future: d > today,
        weeklyOff,
        holiday,
        locked: await this.locks.isLocked(d),
        leave: lv ? { typeCode: lv.typeCode, fraction: lv.fraction, session, label: leaveLabel({ typeCode: lv.typeCode, fraction: lv.fraction, session }) } : null,
        expectedMinutes: expectedMinutes({ offDay: weeklyOff || !!holiday, leaveFraction: lv?.fraction ?? 0, requiredMinutes: required }),
      });
    }
    const scoped = opts.scopeProjectId !== undefined;
    const allLines = ts.lines;
    const inScope = (l: TimesheetLine) => !scoped || l.projectId === opts.scopeProjectId;
    const lineTasks = await this.cross.taskMap(allLines.map((l) => l.taskId).filter((x): x is string => !!x));
    const lines: TimesheetLineDto[] = allLines.filter(inScope).map((l) => {
      const cells: TimesheetCellDto[] = days.map((day) => {
        const c = l.cells.find((x) => keyOf(x.date) === day.date);
        const adj = c ? adjustments.find((a) => a.cellId === c.id) : undefined;
        const pendingAdjustment = c?.pendingAdjustmentMinutes ?? 0;
        const pendingOutside = c?.pendingOutsideMinutes ?? 0;
        return {
          date: day.date,
          final: c?.finalMinutes ?? 0,
          tracked: c?.trackedMinutes ?? 0,
          adjustment: c?.adjustmentMinutes ?? 0,
          outsideHours: c?.outsideHoursMinutes ?? 0,
          idleAsWork: c?.idleAsWorkMinutes ?? 0,
          pendingIdle: c?.pendingIdleMinutes ?? 0,
          pendingAdjustment,
          pendingOutside,
          pending: pendingAdjustment + pendingOutside,
          claimed: (c?.finalMinutes ?? 0) + pendingAdjustment,
          adjusted: !!c && (c.adjustmentMinutes !== 0 || pendingAdjustment > 0),
          adjustmentReason: adj?.reason ?? null,
          ohPending: pendingOutside > 0,
          editable: editable && !day.future && !day.locked,
          outOfPeriod: false,
        };
      });
      const task = l.taskId ? lineTasks.get(l.taskId) : undefined;
      const total = cells.reduce((s, c) => s + c.final, 0);
      const pending = cells.reduce((s, c) => s + c.pending, 0);
      const pendingIdle = cells.reduce((s, c) => s + c.pendingIdle, 0);
      return {
        id: l.id,
        label: l.label,
        subLabel: l.subLabel,
        projectId: l.projectId,
        taskId: l.taskId,
        billable: l.billable,
        isManual: l.isManual,
        total,
        pending,
        quiet: isQuietLine({ claimed: total + pending, pendingIdle, taskId: l.taskId, taskStatus: task?.status }),
        task: task?.status
          ? {
              status: task.status,
              statusLabel: (TASK_STATUS_LABELS as Record<string, string>)[task.status] ?? task.status,
              active: isActiveTask(task.status),
              estimatedMinutes: task.estimatedMinutes ?? null,
              loggedMinutes: task.loggedMinutes ?? 0,
            }
          : null,
        cells,
      };
    });
    const idleRow = days.map((d) => idleDays.find((x) => keyOf(x.date) === d.date)?.idleMinutes ?? 0);
    const dayTotals = days.map((_, i) => lines.reduce((s, l) => s + l.cells[i]!.final, 0));
    const pendingRow = days.map((_, i) => lines.reduce((s, l) => s + l.cells[i]!.pending, 0));
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
      pending: pendingRow.reduce((s, x) => s + x, 0),
      expected: days.reduce((s, d) => s + d.expectedMinutes, 0),
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
      pendingRow,
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

  editCell(id: string, input: CellEditInput): Promise<TimesheetWeek> {
    return this.lock.run(id, () => this.editCellNow(id, input));
  }

  private async editCellNow(id: string, input: CellEditInput): Promise<TimesheetWeek> {
    const ts = await this.ownedEditable(id, input.expectedVersion);
    this.assertInWeek(ts, input.date);
    if (input.date > istKeyOf(new Date())) throw new AppError(422, 'FUTURE_DATE', "You can't log time for a future date");
    await this.locks.assertOpen(input.date);
    const line = ts.lines.find((l) => l.id === input.lineId);
    if (!line) throw notFound('Timesheet line');
    let cell = line.cells.find((c) => keyOf(c.date) === input.date) ?? null;
    const parts = cell ?? { trackedMinutes: 0, idleAsWorkMinutes: 0, outsideHoursMinutes: 0, adjustmentMinutes: 0, pendingAdjustmentMinutes: 0 };
    const plan = planCellEdit(parts, input.minutes);
    if (!plan) return this.weekDto(id, { owner: true });
    const dayCells = ts.lines.flatMap((l) => l.cells.filter((c) => keyOf(c.date) === input.date));
    const dayAfter = dayCells.reduce((s, c) => s + claimedOf(c), 0) - (cell ? cell.finalMinutes + cell.pendingAdjustmentMinutes : 0) + input.minutes;
    if (dayAfter > MAX_DAY_MINUTES) {
      throw new AppError(422, 'DAY_OVER_24H', `That makes ${dayLabel(input.date)} ${hm(dayAfter)} in total · a day can hold at most 24 hours across all rows`, { fieldErrors: { minutes: ['More than 24 hours on this day'] } });
    }
    const attendance = await this.prisma.attendanceDay.findFirst({ where: { employeeId: ts.employeeId, date: dateOf(input.date) }, select: { workedMinutes: true } });
    const needReason = reasonRequired({
      hasTrackerData: dayCells.some((c) => c.trackedMinutes > 0 || c.idleAsWorkMinutes > 0),
      dayTotalAfter: dayAfter,
      attendanceWorked: attendance?.workedMinutes ?? 0,
    });
    const reason = input.reason?.trim() ?? '';
    if (needReason && reason.length < 10) throw new AppError(422, 'REASON_REQUIRED', 'Edits to tracked time need a reason (at least 10 characters)');
    const tenantId = currentTenantId();
    const data = { adjustmentMinutes: plan.adjustmentMinutes, pendingAdjustmentMinutes: plan.pendingAdjustmentMinutes, finalMinutes: cellFinal({ ...parts, adjustmentMinutes: plan.adjustmentMinutes }) };
    if (cell) cell = await this.prisma.timesheetCell.update({ where: { id: cell.id }, data });
    else cell = await this.prisma.timesheetCell.create({ data: { tenantId, lineId: line.id, date: dateOf(input.date), ...data } });
    const ctx = requireContext();
    // At most one claim per cell waits for review: a new edit replaces the earlier one.
    await this.prisma.timesheetAdjustment.updateMany({ where: { timesheetId: id, cellId: cell.id, reviewStatus: 'PENDING_PL' }, data: { reviewStatus: 'SUPERSEDED', reviewedByName: 'Replaced by a later edit', reviewedAt: new Date() } });
    await this.prisma.timesheetAdjustment.create({
      data: { tenantId, timesheetId: id, cellId: cell.id, fromMinutes: plan.fromMinutes, toMinutes: input.minutes, deltaMinutes: plan.deltaMinutes, kind: plan.kind, reason: reason || 'Manual entry', reviewStatus: plan.reviewStatus, createdByName: ctx.userName ?? null },
    });
    await this.bump(id, 'cell.adjusted', `${line.label} · ${dayLabel(input.date)} → ${input.minutes} min`);
    await this.refreshTotals(id);
    await this.audit.record({ action: 'timesheet.cell.adjusted', entity: 'Timesheet', entityId: id, meta: { lineId: line.id, date: input.date, delta: plan.deltaMinutes, kind: plan.kind, review: plan.reviewStatus } });
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

  removeLine(id: string, lineId: string): Promise<TimesheetWeek> {
    return this.lock.run(id, async () => {
      const ts = await this.ownedEditable(id);
      const line = ts.lines.find((l) => l.id === lineId);
      if (!line) throw notFound('Timesheet line');
      if (!line.isManual || line.cells.some((c) => c.trackedMinutes > 0 || c.outsideHoursMinutes > 0 || c.pendingOutsideMinutes > 0)) throw new AppError(409, 'LINE_HAS_TIME', 'Only manual lines without tracked time can be removed');
      await this.prisma.timesheetLine.delete({ where: { id: lineId } });
      await this.bump(id, 'line.removed', line.label);
      await this.refreshTotals(id);
      return this.weekDto(id, { owner: true });
    });
  }

  // ── outside hours ───────────────────────────────────────────────────────
  logOutsideHours(id: string, input: OutsideHoursInput): Promise<TimesheetWeek> {
    return this.lock.run(id, () => this.logOutsideHoursNow(id, input));
  }

  private async logOutsideHoursNow(id: string, input: OutsideHoursInput): Promise<TimesheetWeek> {
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
    const dayClaimed = ts.lines.flatMap((l) => l.cells.filter((c) => keyOf(c.date) === input.date)).reduce((s, c) => s + claimedOf(c), 0);
    if (dayClaimed + minutes > MAX_DAY_MINUTES) {
      throw new AppError(422, 'DAY_OVER_24H', `That makes ${dayLabel(input.date)} ${hm(dayClaimed + minutes)} in total · a day can hold at most 24 hours across all rows`);
    }
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
    await this.syncOutsideHoursNow(id);
    await this.bump(id, 'outside_hours.logged', `${input.taskText} · ${dayLabel(input.date)} ${input.from}–${input.to}`);
    await this.audit.record({ action: 'timesheet.outside_hours.logged', entity: 'OutsideHoursEntry', entityId: entry.id, meta: { date: input.date, minutes, projectId: input.projectId } });
    return this.weekDto(id, { owner: true });
  }

  async deleteOutsideHours(entryId: string): Promise<TimesheetWeek> {
    const e = await this.prisma.outsideHoursEntry.findFirst({ where: { id: entryId } });
    if (!e) throw notFound('Outside-hours entry');
    return this.lock.run(e.timesheetId, async () => {
      await this.ownedEditable(e.timesheetId);
      if (e.reviewStatus === 'ACCEPTED') throw new AppError(409, 'OUTSIDE_HOURS_REVIEWED', 'Your Project Lead already accepted this entry · it can’t be removed');
      await this.prisma.outsideHoursEntry.delete({ where: { id: entryId } });
      await this.syncOutsideHoursNow(e.timesheetId);
      await this.bump(e.timesheetId, 'outside_hours.removed', e.taskText);
      return this.weekDto(e.timesheetId, { owner: true });
    });
  }

  /** Cell outsideHours = Σ accepted entries on that line/day; entries waiting for review go to pendingOutside. */
  private async syncOutsideHoursNow(timesheetId: string) {
    const ts = await this.load(timesheetId);
    const entries = await this.prisma.outsideHoursEntry.findMany({ where: { timesheetId, reviewStatus: { in: ['ACCEPTED', 'PENDING_PL'] } } });
    const accepted = new Map<string, number>();
    const pending = new Map<string, number>();
    for (const e of entries) {
      if (!e.lineId) continue;
      const k = `${e.lineId}|${keyOf(e.date)}`;
      const m = e.reviewStatus === 'ACCEPTED' ? accepted : pending;
      m.set(k, (m.get(k) ?? 0) + e.minutes);
    }
    const tenantId = currentTenantId();
    for (const l of ts.lines) {
      const entryDays = [...accepted.keys(), ...pending.keys()].filter((k) => k.startsWith(`${l.id}|`)).map((k) => k.split('|')[1]!);
      for (const d of new Set([...l.cells.map((c) => keyOf(c.date)), ...entryDays])) {
        const oh = accepted.get(`${l.id}|${d}`) ?? 0;
        const poh = pending.get(`${l.id}|${d}`) ?? 0;
        const c = l.cells.find((x) => keyOf(x.date) === d);
        if (c) {
          if (c.outsideHoursMinutes !== oh || c.pendingOutsideMinutes !== poh) {
            await this.prisma.timesheetCell.update({ where: { id: c.id }, data: { outsideHoursMinutes: oh, pendingOutsideMinutes: poh, finalMinutes: cellFinal({ ...c, outsideHoursMinutes: oh }) } });
          }
        } else if (oh || poh) {
          await this.prisma.timesheetCell.create({ data: { tenantId, lineId: l.id, date: dateOf(d), outsideHoursMinutes: oh, pendingOutsideMinutes: poh, finalMinutes: oh } });
        }
      }
    }
    await this.refreshTotals(timesheetId);
  }

  // ── review decisions (Project Lead / Reporting Manager) ─────────────────
  /**
   * Accept / reject what waits for review on a sheet: outside-hours entries, manual increases and
   * "I was working" idle claims. Items in scope without an explicit decision are accepted (the
   * approver approved the sheet). scope.projectId: an L1 step reviews its own project only;
   * undefined = everything (L2 / final approval).
   */
  applyReview(timesheetId: string, scope: { projectId?: string | null }, decisions: ItemDecision[], actor: string) {
    return this.lock.run(timesheetId, () => this.applyReviewNow(timesheetId, scope, decisions, actor));
  }

  private async applyReviewNow(timesheetId: string, scope: { projectId?: string | null }, decisions: ItemDecision[], actor: string) {
    const now = new Date();
    const inScope = (projectId: string | null | undefined) => scope.projectId === undefined || (projectId ?? null) === scope.projectId;
    const pick = (type: ItemDecision['type'], id: string) => decisions.find((d) => d.type === type && d.id === id);
    const tenantId = currentTenantId();

    const pendingOh = await this.prisma.outsideHoursEntry.findMany({ where: { timesheetId, reviewStatus: 'PENDING_PL' } });
    for (const o of pendingOh) {
      if (!inScope(o.projectId)) continue;
      const d = pick('OUTSIDE_HOURS', o.id);
      await this.prisma.outsideHoursEntry.update({ where: { id: o.id }, data: { reviewStatus: d?.decision === 'REJECT' ? 'REJECTED' : 'ACCEPTED', reviewedByName: actor, reviewedAt: now, reviewComment: d?.note ?? null } });
    }

    const sheet = await this.load(timesheetId);
    const cells = new Map(sheet.lines.filter((l) => inScope(l.projectId)).flatMap((l) => l.cells.map((c) => [c.id, { ...c }] as const)));
    const pendingAdj = await this.prisma.timesheetAdjustment.findMany({ where: { timesheetId, reviewStatus: 'PENDING_PL' }, orderBy: { createdAt: 'asc' } });
    const touched = new Set<string>();
    for (const a of pendingAdj) {
      const cell = cells.get(a.cellId);
      if (!cell) continue;
      const accept = pick('MANUAL_INCREASE', a.id)?.decision !== 'REJECT';
      await this.prisma.timesheetAdjustment.update({ where: { id: a.id }, data: { reviewStatus: accept ? 'ACCEPTED' : 'REJECTED', reviewedByName: actor, reviewedAt: now } });
      Object.assign(cell, decidePending(cell, a.deltaMinutes, accept));
      touched.add(cell.id);
    }
    for (const id of touched) {
      const c = cells.get(id)!;
      await this.prisma.timesheetCell.update({ where: { id }, data: { adjustmentMinutes: c.adjustmentMinutes, pendingAdjustmentMinutes: c.pendingAdjustmentMinutes, finalMinutes: cellFinal(c) } });
    }

    const from = keyOf(sheet.weekStart);
    const to = keyOf(sheet.weekEnd);
    const claims = (await this.cross.idleClaims(sheet.employeeId, from, to)).filter((c) => c.status === 'PENDING');
    const decided = new Set(claims.length ? (await this.prisma.timesheetItemDecision.findMany({ where: { itemType: 'IDLE_CLAIM', refId: { in: claims.map((c) => c.id) } }, select: { refId: true } })).map((d) => d.refId) : []);
    const tasks = await this.cross.taskMap(claims.map((c) => c.taskId).filter((x): x is string => !!x));
    const claimEvents: { claimId: string; employeeId: string; workDate: string; status: string; source: 'approval'; note: string | null; by: string }[] = [];
    for (const c of claims) {
      if (decided.has(c.id)) continue;
      if (!inScope((c.taskId ? tasks.get(c.taskId)?.projectId : null) ?? c.projectId ?? null)) continue;
      const d = pick('IDLE_AS_WORK', c.id);
      const status = d?.decision === 'REJECT' ? 'REJECTED' : 'APPROVED';
      await this.prisma.timesheetItemDecision.create({ data: { tenantId, timesheetId, itemType: 'IDLE_CLAIM', refId: c.id, decision: status, note: d?.note ?? null, decidedByName: actor } });
      claimEvents.push({ claimId: c.id, employeeId: sheet.employeeId, workDate: keyOf(c.workDate), status, source: 'approval', note: d?.note ?? null, by: actor });
    }

    await this.syncOutsideHoursNow(timesheetId);
    if (claimEvents.length) await this.rebuildNow(timesheetId, { claims: true });
    for (const e of claimEvents) this.events.emit('idle.claimDecided', e);
  }

  // ── submit / recall ─────────────────────────────────────────────────────
  submit(id: string, input: { expectedVersion?: number; confirmEmpty?: boolean }): Promise<SubmitResult> {
    return this.lock.run(id, () => this.submitNow(id, input));
  }

  private async submitNow(id: string, input: { expectedVersion?: number; confirmEmpty?: boolean }): Promise<SubmitResult> {
    let ts: Timesheet = await this.ownedEditable(id, input.expectedVersion);
    const now = new Date();
    if (!submitOpen(keyOf(ts.weekStart), now)) throw new AppError(422, 'SUBMIT_TOO_EARLY', `You can submit this week from Fri ${dm(addDays(keyOf(ts.weekStart), 4))}, 15:00`);
    ts = await this.rebuildNow(id);
    if (ts.totalMinutes + ts.pendingMinutes <= 0 && !input.confirmEmpty) throw new AppError(422, 'EMPTY_TIMESHEET', 'This timesheet has no hours · add time before submitting');
    const emp = (await this.policies.employee(ts.employeeId))!;
    const full = await this.load(id);
    const oh = await this.prisma.outsideHoursEntry.findMany({ where: { timesheetId: id, reviewStatus: { not: 'REJECTED' } } });
    // Claimed time (counted + waiting for review) decides which Project Leads review the week.
    const routeLines = [
      ...full.lines.map((l) => ({ projectId: l.projectId, minutes: l.cells.reduce((s, c) => s + c.finalMinutes + c.pendingAdjustmentMinutes, 0) })),
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
    // Nobody can review this week (no Project Lead, Reporting Manager or admin): what waits for review is accepted with it.
    if (status === 'APPROVED') await this.applyReviewNow(id, {}, [], 'Auto-accepted · no approver');
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
