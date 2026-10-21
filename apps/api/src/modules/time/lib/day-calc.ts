import { istInstant, minutesBetween } from './time-utils';

/**
 * Pure attendance-day computation (spec-time E3/E5, B5). No I/O — the service gathers the
 * inputs (shift, holiday, leave, sessions, tracker summary) and persists the result.
 *
 * Worked time = sessions − breaks − deducted idle (from the tracker day summary when present).
 * Status thresholds use *presence* (sessions − breaks) so idle is penalised once, through
 * payroll's idle deduction, not also by downgrading the day (matches the wireframe rows).
 */

export type SourceKey = 'BIOMETRIC' | 'WEB' | 'DESKTOP' | 'MOBILE' | 'REGULARIZATION' | 'SYSTEM';
export type DayStatusKey =
  | 'PENDING'
  | 'PRESENT'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'LEAVE'
  | 'HALF_DAY_LEAVE'
  | 'HOLIDAY'
  | 'WEEKLY_OFF'
  | 'HOLIDAY_WORKED'
  | 'WEEKLY_OFF_WORKED'
  | 'MISSED_PUNCH';

export const SOURCE_BITS: Record<SourceKey, number> = { BIOMETRIC: 1, WEB: 2, DESKTOP: 4, MOBILE: 8, REGULARIZATION: 16, SYSTEM: 32 };

export type ShiftLike = {
  id?: string | null;
  name: string;
  startMinute: number;
  endMinute: number;
  graceMinutes: number;
  breakMinutes: number;
  weeklyOffDays: number[];
  minFullDayMinutes: number;
  minHalfDayMinutes: number;
  halfDayIfLateByMinutes: number | null;
  earlyOutGraceMinutes: number;
  /**
   * Late arrivals allowed a month (0 / undefined = no limit). Lates 1..N are permitted; from late N+1
   * the first half of that day is a half day (booked as half-day leave, like a 2h+ late).
   */
  lateMarksAllowed?: number;
  /** YYYY-MM-DD the limit took effect: earlier days are never turned into half days by it (null = always). */
  lateMarksAllowedFrom?: string | null;
};

export type SessionLike = { startedAt: Date; endedAt: Date | null; source: SourceKey; autoClosed?: boolean };
export type TrackerDayLike = { workedSec: number; breakSec: number; idleSec: number; idleDeductedSec?: number | null };
/**
 * Leave on the day. `plannedFirstHalf` / `plannedSecondHalf`: a half day the employee applied for
 * (not the automatic late-arrival half day), which moves the expected start / end to mid-shift.
 */
export type LeaveLike = { fraction: number; typeCode: string | null; paid: boolean; plannedFirstHalf?: boolean; plannedSecondHalf?: boolean } | null;
export type PolicyLike = { deductIdleFromPayroll: boolean; idleDeductionMode: 'SHORTFALL_ONLY' | 'ALL_IDLE' | string; earlyOutCountsAsLate: boolean };

export type DayInput = {
  date: string;
  today: string;
  now: Date;
  shift: ShiftLike;
  holidayName: string | null;
  leave: LeaveLike;
  sessions: SessionLike[];
  tracker: TrackerDayLike | null;
  lateExcused?: boolean;
  /** This day's place among the month's late arrivals if it is late (1 = first); see `lateOrdinal`. */
  lateOrdinal?: number;
  policy: PolicyLike;
};

export type DayResult = {
  status: DayStatusKey;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  primarySource: SourceKey | null;
  sourcesMask: number;
  presenceMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  idleMinutes: number;
  isLate: boolean;
  lateByMinutes: number;
  lateExcused: boolean;
  /**
   * The first half is a half day (not excused): arrived `shift.halfDayIfLateByMinutes` or more late,
   * or this is a late arrival beyond the month's allowed number (`lateOverLimit`).
   */
  lateHalfDay: boolean;
  /** Late arrival number N+1 or later this month (shift.lateMarksAllowed = N). */
  lateOverLimit: boolean;
  isEarlyOut: boolean;
  presentFraction: number;
  leaveFraction: number;
  leaveTypeCode: string | null;
  idleDeductibleMinutes: number;
  expectedStart: Date;
  expectedEnd: Date;
  holidayName: string | null;
  isWeeklyOff: boolean;
};

export function shiftDurationMinutes(shift: Pick<ShiftLike, 'startMinute' | 'endMinute'>): number {
  const d = (shift.endMinute - shift.startMinute + 1440) % 1440;
  return d === 0 ? 1440 : d;
}

/** Required payable minutes for a full day (shift duration − break); 480 for General. */
export function requiredMinutes(shift: ShiftLike): number {
  return Math.max(0, shiftDurationMinutes(shift) - shift.breakMinutes);
}

export function shiftWindow(date: string, shift: Pick<ShiftLike, 'startMinute' | 'endMinute'>) {
  const expectedStart = istInstant(date, shift.startMinute);
  const expectedEnd = new Date(expectedStart.getTime() + shiftDurationMinutes(shift) * 60_000);
  return { expectedStart, expectedEnd };
}

export function isWeeklyOff(date: string, shift: Pick<ShiftLike, 'weeklyOffDays'>): boolean {
  return shift.weeklyOffDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

/** Late mark (B5): late when first in is after start + grace; lateBy is measured from start. */
export function lateMark(firstIn: Date, expectedStart: Date, graceMinutes: number): { isLate: boolean; lateByMinutes: number } {
  const diff = Math.round((firstIn.getTime() - expectedStart.getTime()) / 60_000);
  if (diff > graceMinutes) return { isLate: true, lateByMinutes: diff };
  return { isLate: false, lateByMinutes: 0 };
}

/** Where the second half of a shift starts (a planned first-half leave moves the expected start here). */
export function secondHalfStart(expectedStart: Date, shift: Pick<ShiftLike, 'startMinute' | 'endMinute'>): Date {
  return new Date(expectedStart.getTime() + Math.round(shiftDurationMinutes(shift) / 2) * 60_000);
}

/** Late by the half-day threshold or more (null threshold = rule off). */
export function isLateHalfDay(lateByMinutes: number, shift: Pick<ShiftLike, 'halfDayIfLateByMinutes'>): boolean {
  return shift.halfDayIfLateByMinutes != null && shift.halfDayIfLateByMinutes > 0 && lateByMinutes >= shift.halfDayIfLateByMinutes;
}

/**
 * Monthly limit: the late arrival number `ordinal` (1 = first this month) on `date` is over the
 * shift's allowed number. 0 / no limit set → never; days before the limit took effect → never.
 */
export function isOverLateLimit(ordinal: number, date: string, shift: Pick<ShiftLike, 'lateMarksAllowed' | 'lateMarksAllowedFrom'>): boolean {
  const allowed = shift.lateMarksAllowed ?? 0;
  if (allowed <= 0 || ordinal <= allowed) return false;
  return !shift.lateMarksAllowedFrom || date >= shift.lateMarksAllowedFrom;
}

/**
 * A late arrival that counts towards the month's number: not excused, and not on a day that ended
 * as an absence. (Late marks shown to the employee, and the place of each late in the month.)
 */
export function isCountedLate(d: { isLate: boolean; lateExcused: boolean; status: string }): boolean {
  return d.isLate && !d.lateExcused && d.status !== 'ABSENT';
}

/**
 * Lateness of a punch-in at `at` (the web punch-in warning): the expected start is the shift start,
 * or mid-shift when the first half is a planned leave. Off days are never late. `ordinal`: the place
 * this late would take among the month's late arrivals (for the monthly limit).
 */
export function punchLateness(input: { date: string; at: Date; shift: ShiftLike; offDay: boolean; plannedFirstHalf: boolean; ordinal?: number }) {
  const { expectedStart } = shiftWindow(input.date, input.shift);
  const start = input.plannedFirstHalf ? secondHalfStart(expectedStart, input.shift) : expectedStart;
  if (input.offDay) return { expectedStart: start, isLate: false, lateByMinutes: 0, lateHalfDay: false, overLimit: false };
  const m = lateMark(input.at, start, input.shift.graceMinutes);
  const overLimit = m.isLate && !input.plannedFirstHalf && isOverLateLimit(input.ordinal ?? 0, input.date, input.shift);
  return { expectedStart: start, ...m, lateHalfDay: m.isLate && !input.plannedFirstHalf && (isLateHalfDay(m.lateByMinutes, input.shift) || overLimit), overLimit };
}

/** Idle deduction for one day (E5, D12). */
export function idleDeductible(idle: number, worked: number, shift: ShiftLike, policy: PolicyLike, presentFraction: number): number {
  if (!policy.deductIdleFromPayroll || presentFraction <= 0 || idle <= 0) return 0;
  if (policy.idleDeductionMode === 'ALL_IDLE') return idle;
  return Math.min(idle, Math.max(0, requiredMinutes(shift) - worked));
}

export function computeDay(input: DayInput): DayResult {
  const { date, today, now, shift, policy } = input;
  const { expectedStart, expectedEnd } = shiftWindow(date, shift);
  const weeklyOff = isWeeklyOff(date, shift);
  const offDay = weeklyOff || !!input.holidayName;
  const sessions = [...input.sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const isToday = date === today;
  const isPast = date < today;

  let gross = 0;
  let gapBreak = 0;
  let missed = false;
  let mask = 0;
  let prevEnd: Date | null = null;
  for (const s of sessions) {
    mask |= SOURCE_BITS[s.source] ?? 0;
    const end = s.endedAt ?? (isToday ? now : null);
    if (!s.endedAt && !isToday) missed = true;
    if (s.autoClosed && s.source !== 'DESKTOP') missed = true;
    if (end && !(s.autoClosed && s.source !== 'DESKTOP')) gross += minutesBetween(s.startedAt, end);
    if (prevEnd && s.startedAt > prevEnd) gapBreak += minutesBetween(prevEnd, s.startedAt);
    if (s.endedAt) prevEnd = s.endedAt;
  }
  const firstInAt = sessions[0]?.startedAt ?? null;
  const closed = sessions.filter((s) => s.endedAt && !(s.autoClosed && s.source !== 'DESKTOP'));
  const lastOutAt = closed.length ? new Date(Math.max(...closed.map((s) => s.endedAt!.getTime()))) : null;
  const hasOpen = sessions.some((s) => !s.endedAt);
  const primarySource = sessions[0]?.source ?? null;

  let breakMinutes: number;
  let presence: number;
  let idle = 0;
  let deductedIdle = 0;
  if (input.tracker) {
    const tBreak = Math.round(input.tracker.breakSec / 60);
    idle = Math.round(input.tracker.idleSec / 60);
    deductedIdle = Math.round((input.tracker.idleDeductedSec ?? input.tracker.idleSec) / 60);
    breakMinutes = tBreak + gapBreak;
    presence = Math.max(0, gross - tBreak);
  } else if (sessions.length === 1 && gross > 300 && !hasOpen) {
    breakMinutes = shift.breakMinutes; // "assume shift break when unrecorded"
    presence = gross - breakMinutes;
  } else {
    breakMinutes = gapBreak;
    presence = gross;
  }
  const worked = Math.max(0, presence - deductedIdle);

  const leave = input.leave;
  const leaveFull = !!leave && leave.fraction >= 1;
  const leaveHalf = !!leave && leave.fraction > 0 && leave.fraction < 1;

  // A planned first-half leave moves the expected start to mid-shift; a planned second-half leave the expected end.
  const plannedFirst = leaveHalf && !!leave?.plannedFirstHalf;
  const plannedSecond = leaveHalf && !!leave?.plannedSecondHalf;
  const lateStart = plannedFirst ? secondHalfStart(expectedStart, shift) : expectedStart;
  const outEnd = plannedSecond ? secondHalfStart(expectedStart, shift) : expectedEnd;
  let isLate = false;
  let lateByMinutes = 0;
  if (firstInAt && !offDay) ({ isLate, lateByMinutes } = lateMark(firstInAt, lateStart, shift.graceMinutes));
  const chargeable = isLate && !input.lateExcused && !plannedFirst;
  const lateOverLimit = chargeable && isOverLateLimit(input.lateOrdinal ?? 0, date, shift);
  const lateHalfDay = chargeable && (isLateHalfDay(lateByMinutes, shift) || lateOverLimit);
  let isEarlyOut = false;
  if (lastOutAt && !hasOpen && !offDay && (isPast || now > expectedEnd)) {
    isEarlyOut = lastOutAt.getTime() < outEnd.getTime() - shift.earlyOutGraceMinutes * 60_000;
    if (isEarlyOut && policy.earlyOutCountsAsLate) isLate = true;
  }
  let status: DayStatusKey;
  let presentFraction = 0;
  let leaveFraction = 0;

  if (offDay) {
    status = presence >= shift.minHalfDayMinutes ? (input.holidayName ? 'HOLIDAY_WORKED' : 'WEEKLY_OFF_WORKED') : input.holidayName ? 'HOLIDAY' : 'WEEKLY_OFF';
  } else if (leaveFull) {
    status = 'LEAVE';
    leaveFraction = 1;
  } else if (missed) {
    status = 'MISSED_PUNCH';
    leaveFraction = leaveHalf ? 0.5 : 0;
  } else if (isToday && (hasOpen || presence < shift.minFullDayMinutes) && now < new Date(expectedEnd.getTime() + 4 * 3600_000)) {
    status = 'PENDING';
    leaveFraction = leaveHalf ? 0.5 : 0;
  } else if (date > today) {
    status = 'PENDING';
  } else if (leaveHalf) {
    leaveFraction = 0.5;
    status = 'HALF_DAY_LEAVE';
    presentFraction = presence >= shift.minHalfDayMinutes ? 0.5 : 0;
  } else if (presence >= shift.minFullDayMinutes) {
    // Late by the half-day threshold, or late beyond the month's limit: only the second half counts.
    status = lateHalfDay ? 'HALF_DAY' : 'PRESENT';
    presentFraction = lateHalfDay ? 0.5 : 1;
  } else if (presence >= shift.minHalfDayMinutes) {
    status = 'HALF_DAY';
    presentFraction = 0.5;
  } else {
    status = 'ABSENT';
  }

  const idleDeductibleMinutes = idleDeductible(idle, worked, shift, policy, presentFraction);
  return {
    status,
    firstInAt,
    lastOutAt,
    primarySource,
    sourcesMask: mask,
    presenceMinutes: presence,
    workedMinutes: worked,
    breakMinutes,
    idleMinutes: idle,
    isLate,
    lateByMinutes,
    lateExcused: !!input.lateExcused && isLate,
    lateHalfDay,
    lateOverLimit,
    isEarlyOut,
    presentFraction,
    leaveFraction,
    leaveTypeCode: leave?.typeCode ?? null,
    idleDeductibleMinutes,
    expectedStart,
    expectedEnd,
    holidayName: input.holidayName,
    isWeeklyOff: weeklyOff,
  };
}

/** Source label for the daily table: a single source, or "Mixed". */
export function sourceLabel(mask: number, primary: SourceKey | null): string | null {
  if (!mask && !primary) return null;
  const bits = Object.values(SOURCE_BITS).filter((b) => mask & b).length;
  if (bits > 1) return 'Mixed';
  const LABEL: Record<SourceKey, string> = { BIOMETRIC: 'Biometric', WEB: 'Web', DESKTOP: 'Desktop', MOBILE: 'Mobile', REGULARIZATION: 'Regularized', SYSTEM: 'System' };
  return primary ? LABEL[primary] : null;
}

export type MonthDayLike = {
  status: DayStatusKey;
  presentFraction: number;
  leaveFraction: number;
  isLate: boolean;
  lateExcused: boolean;
  lateHalfDay?: boolean;
  workedMinutes: number;
  idleMinutes: number;
  idleDeductibleMinutes: number;
};

/**
 * A late arrival counts toward the payroll late-mark penalty unless it was excused, the day is
 * already a full absence (unpaid anyway), or it was already charged as a late half day (2h+ late or
 * over the month's limit) — never penalised twice. Shared with payroll.
 */
export function countsAsLateMark(d: { isLate: boolean; lateExcused: boolean; status: string; lateHalfDay?: boolean }): boolean {
  return isCountedLate(d) && !d.lateHalfDay;
}

/** "This month" card + payroll feed figures from stored days. */
export function summarizeMonth(days: MonthDayLike[], allowanceMinutes = 0) {
  const off = new Set<DayStatusKey>(['WEEKLY_OFF', 'HOLIDAY', 'WEEKLY_OFF_WORKED', 'HOLIDAY_WORKED']);
  const sumDeductible = days.reduce((s, d) => s + d.idleDeductibleMinutes, 0);
  return {
    presentDays: round2(days.reduce((s, d) => s + d.presentFraction, 0)),
    /** Every late arrival of the month (shown as "Late marks"), including the ones that became half days. */
    lateMarks: days.filter(isCountedLate).length,
    /** The ones the payroll late-mark penalty looks at (not already charged as a half day). */
    penaltyLateMarks: days.filter(countsAsLateMark).length,
    lateHalfDays: days.filter((d) => d.lateHalfDay).length,
    activeMinutes: days.reduce((s, d) => s + d.workedMinutes, 0),
    idleMinutes: days.reduce((s, d) => s + d.idleMinutes, 0),
    leaveDays: round2(days.reduce((s, d) => s + d.leaveFraction, 0)),
    workingDays: days.filter((d) => !off.has(d.status)).length,
    absentDays: days.filter((d) => d.status === 'ABSENT').length,
    missedPunchDays: days.filter((d) => d.status === 'MISSED_PUNCH').length,
    idleDeductibleMinutes: Math.max(0, sumDeductible - allowanceMinutes),
  };
}

/** Late-mark penalty (B5): after the shift's `allowed` free marks, every N late marks cost `penaltyDays`. */
export function latePenaltyDays(lateMarks: number, perPenalty: number, penaltyDays: number, allowed = 0): number {
  if (perPenalty <= 0) return 0;
  return Math.floor(Math.max(0, lateMarks - allowed) / perPenalty) * penaltyDays;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
