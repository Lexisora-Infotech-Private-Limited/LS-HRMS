/**
 * Pure day classification for one employee-month (spec P3 §5 steps 2–4, D31):
 *   eligible working days, paid leave, unpaid leave, absence LOP, projected days after the
 *   attendance lock, and deducted idle minutes (idle on LOP days is dropped).
 */
import type { CalendarFn } from '../leave/leave-calc';
import { eachDay, maxKey, minKey, monthBounds, type DateKey } from '../common/dates';

export type LeaveOnDay = { units: number; isPaid: boolean; code: string };
export type AttendanceOnDay = { status: string; presentFraction: number; idleDeductibleMinutes: number };

export type DayClassInput = {
  period: string;
  lockDate: DateKey;
  joinDate: DateKey | null;
  exitDate: DateKey | null;
  calendar: CalendarFn;
  leave: Map<DateKey, LeaveOnDay[]>;
  attendance: Map<DateKey, AttendanceOnDay>;
  /** Idle minutes from another source (tracker) when the employee has no attendance rows. */
  fallbackIdleMinutes?: number;
};

export type DayClassResult = {
  workingDays: number;
  eligibleDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  projectedDays: number;
  presentDays: number;
  holidays: number;
  weeklyOffs: number;
  leaveSummary: { code: string; days: number }[];
  idleMinutes: number;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export function classifyDays(inp: DayClassInput): DayClassResult {
  const b = monthBounds(inp.period);
  const from = inp.joinDate ? maxKey(inp.joinDate, b.start) : b.start;
  const to = inp.exitDate ? minKey(inp.exitDate, b.end) : b.end;
  let workingDays = 0;
  let holidays = 0;
  let weeklyOffs = 0;
  for (const d of eachDay(b.start, b.end)) {
    const k = inp.calendar(d).kind;
    if (k === 'WORKING') workingDays++;
    else if (k === 'HOLIDAY') holidays++;
    else weeklyOffs++;
  }
  let eligibleDays = 0;
  let paidLeave = 0;
  let unpaidLeave = 0;
  let absent = 0;
  let projected = 0;
  let present = 0;
  let idle = 0;
  const summary = new Map<string, number>();
  if (from <= to) {
    for (const d of eachDay(from, to)) {
      if (inp.calendar(d).kind !== 'WORKING') continue;
      eligibleDays++;
      const lv = inp.leave.get(d) ?? [];
      const paid = Math.min(1, lv.filter((l) => l.isPaid).reduce((s, l) => s + l.units, 0));
      const unpaid = Math.min(1 - paid, lv.filter((l) => !l.isPaid).reduce((s, l) => s + l.units, 0));
      for (const l of lv) summary.set(l.code, (summary.get(l.code) ?? 0) + l.units);
      paidLeave += paid;
      unpaidLeave += unpaid;
      const rest = Math.max(0, 1 - paid - unpaid);
      if (d > inp.lockDate) {
        projected += rest;
        continue;
      }
      const att = inp.attendance.get(d);
      let lop = 0;
      if (att) {
        if (att.status === 'ABSENT') lop = rest;
        else if (att.status === 'HALF_DAY') lop = Math.max(0, rest - Math.max(0.5, att.presentFraction || 0.5));
        else if (att.status === 'HALF_DAY_LEAVE' && paid + unpaid < 0.5) lop = Math.max(0, 0.5 - paid - unpaid);
      }
      absent += lop;
      present += Math.max(0, rest - lop);
      // Idle on an LOP day is dropped (no double penalty).
      if (att && lop < 1) idle += att.idleDeductibleMinutes;
    }
  }
  if (!inp.attendance.size && inp.fallbackIdleMinutes) idle = inp.fallbackIdleMinutes;
  return {
    workingDays,
    eligibleDays,
    paidLeaveDays: r2(paidLeave),
    unpaidLeaveDays: r2(unpaidLeave),
    absentDays: r2(absent),
    projectedDays: r2(projected),
    presentDays: r2(present),
    holidays,
    weeklyOffs,
    leaveSummary: [...summary].map(([code, days]) => ({ code, days: r2(days) })).sort((a, c) => a.code.localeCompare(c.code)),
    idleMinutes: Math.round(idle),
  };
}

export type GateInput = { required: boolean; statuses: string[] };
/**
 * Timesheet gate (spec P3 §5 step 10): APPROVED only when every weekly timesheet overlapping
 * [periodStart, lockDate] is RM-approved (or locked). Weeks without a timesheet row don't block
 * (spec acceptance: only employees with a timesheet pending RM are held back); a DRAFT sheet
 * counts as NOT_SUBMITTED.
 */
export function timesheetGate(g: GateInput): string {
  if (!g.required) return 'NOT_REQUIRED';
  if (!g.statuses.length) return 'APPROVED';
  const order = ['NOT_SUBMITTED', 'SENT_BACK', 'PENDING_PL', 'PENDING_RM'];
  const mapped: string[] = g.statuses.map((s) => (s === 'APPROVED' || s === 'LOCKED' ? 'APPROVED' : s === 'DRAFT' ? 'NOT_SUBMITTED' : s === 'RETURNED' ? 'SENT_BACK' : s === 'SUBMITTED' ? 'PENDING_PL' : s === 'PENDING_RM' ? 'PENDING_RM' : 'NOT_SUBMITTED'));
  for (const o of order) if (mapped.includes(o)) return o;
  return 'APPROVED';
}

export const GATE_OK = ['APPROVED', 'NOT_REQUIRED'];
