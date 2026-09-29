/**
 * Pure leave rules (no I/O): day expansion with half days, holiday/weekly-off exclusion and
 * the sandwich rule; balance split into paid/LOP; joining pro-ration and accrual schedules;
 * year-end carry forward. Covered by leave-calc.spec.ts.
 */
import { addDays, eachDay, type DateKey } from '../common/dates';

export type DayKind = 'WORKING' | 'WEEKLY_OFF' | 'HOLIDAY';
export type Session = 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';
export type HalfDay = 'NONE' | 'FIRST_HALF' | 'SECOND_HALF';

export type CalendarDay = { date: DateKey; kind: DayKind; holidayName?: string };
/** Returns the calendar kind of any date for the employee. */
export type CalendarFn = (date: DateKey) => CalendarDay;

export type ExpandedDay = {
  date: DateKey;
  kind: DayKind;
  session: Session;
  units: number;
  isSandwich: boolean;
  isPaid: boolean;
  holidayName?: string;
};

export type ExpandInput = {
  from: DateKey;
  to: DateKey;
  /** Single-day requests. */
  halfDay?: HalfDay;
  /** Multi-day: start from second half. */
  fromSession?: 'FULL' | 'SECOND_HALF';
  /** Multi-day: end at first half. */
  toSession?: 'FULL' | 'FIRST_HALF';
  calendar: CalendarFn;
  sandwichWeeklyOffs: boolean;
  sandwichHolidays: boolean;
  /** Leave already covering a date from other active (approved/pending) requests of sandwich-enabled types. */
  existingCoverage?: (date: DateKey) => Session | null;
};

export type ExpandResult = {
  days: ExpandedDay[];
  totalDays: number;
  sandwichDays: number;
  /** Holidays / weekly offs inside the range that were excluded (for the preview line). */
  excluded: { date: DateKey; kind: DayKind; holidayName?: string }[];
  error?: string;
};

const coversSecondHalf = (s: Session | null | undefined) => s === 'FULL' || s === 'SECOND_HALF';
const coversFirstHalf = (s: Session | null | undefined) => s === 'FULL' || s === 'FIRST_HALF';

export function sessionFor(input: Pick<ExpandInput, 'from' | 'to' | 'halfDay' | 'fromSession' | 'toSession'>, date: DateKey): Session {
  if (input.from === input.to) return input.halfDay && input.halfDay !== 'NONE' ? input.halfDay : 'FULL';
  if (date === input.from && input.fromSession === 'SECOND_HALF') return 'SECOND_HALF';
  if (date === input.to && input.toSession === 'FIRST_HALF') return 'FIRST_HALF';
  return 'FULL';
}

/**
 * Expand a request into per-day units.
 * - WORKING day: 1 (FULL) or 0.5 (half).
 * - WEEKLY_OFF / HOLIDAY: 0 unless sandwiched: a maximal block of non-working days whose
 *   previous working day is covered through its second half and next working day from its
 *   first half (by this request or an existing one). Sandwiched days count 1 each when the
 *   type sandwiches that kind, and are charged to THIS request only.
 * - Leading/trailing non-working days are never counted unless the other side is covered
 *   by an existing request.
 */
export function expandLeaveDays(input: ExpandInput): ExpandResult {
  const { from, to, calendar } = input;
  if (from > to) return { days: [], totalDays: 0, sandwichDays: 0, excluded: [], error: 'From date must be on or before To date' };
  const range = eachDay(from, to);
  if (range.length > 366) return { days: [], totalDays: 0, sandwichDays: 0, excluded: [], error: 'A request can cover at most 366 days' };

  const days = new Map<DateKey, ExpandedDay>();
  for (const date of range) {
    const c = calendar(date);
    const session = sessionFor(input, date);
    days.set(date, {
      date,
      kind: c.kind,
      session,
      units: c.kind === 'WORKING' ? (session === 'FULL' ? 1 : 0.5) : 0,
      isSandwich: false,
      isPaid: true,
      holidayName: c.holidayName,
    });
  }

  if (from === to && input.halfDay && input.halfDay !== 'NONE' && calendar(from).kind !== 'WORKING') {
    return { days: [], totalDays: 0, sandwichDays: 0, excluded: [], error: 'A half day must be on a working day' };
  }

  const coverage = (date: DateKey): Session | null => {
    const own = days.get(date);
    if (own && own.kind === 'WORKING') return own.session;
    return input.existingCoverage?.(date) ?? null;
  };
  const sandwichable = (k: DayKind) => (k === 'WEEKLY_OFF' ? input.sandwichWeeklyOffs : k === 'HOLIDAY' ? input.sandwichHolidays : false);

  if (input.sandwichWeeklyOffs || input.sandwichHolidays) {
    // Candidate blocks: inside the range, plus the blocks touching either edge from outside.
    const seen = new Set<DateKey>();
    const candidates: DateKey[] = [...range, addDays(from, -1), addDays(to, 1)];
    for (const start of candidates) {
      if (seen.has(start) || calendar(start).kind === 'WORKING') continue;
      // Grow the maximal non-working block around `start`.
      let a = start;
      let b = start;
      for (let i = 0; i < 15 && calendar(addDays(a, -1)).kind !== 'WORKING'; i++) a = addDays(a, -1);
      for (let i = 0; i < 15 && calendar(addDays(b, 1)).kind !== 'WORKING'; i++) b = addDays(b, 1);
      const block = eachDay(a, b);
      block.forEach((d) => seen.add(d));
      const before = addDays(a, -1);
      const after = addDays(b, 1);
      const touchesRequest = (before >= from && before <= to) || (after >= from && after <= to) || block.some((d) => d >= from && d <= to);
      if (!touchesRequest) continue;
      // At least one side must belong to this request (otherwise the block is someone else's).
      const beforeOwn = before >= from && before <= to;
      const afterOwn = after >= from && after <= to;
      if (!beforeOwn && !afterOwn) continue;
      if (!coversSecondHalf(coverage(before)) || !coversFirstHalf(coverage(after))) continue;
      for (const d of block) {
        const c = calendar(d);
        if (!sandwichable(c.kind)) continue;
        if (input.existingCoverage?.(d)) continue; // already charged to an earlier request
        days.set(d, { date: d, kind: c.kind, session: 'FULL', units: 1, isSandwich: true, isPaid: true, holidayName: c.holidayName });
      }
    }
  }

  const list = [...days.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  const totalDays = list.reduce((s, d) => s + d.units, 0);
  const sandwichDays = list.filter((d) => d.isSandwich).reduce((s, d) => s + d.units, 0);
  const excluded = list.filter((d) => d.kind !== 'WORKING' && !d.isSandwich).map((d) => ({ date: d.date, kind: d.kind, holidayName: d.holidayName }));
  if (totalDays === 0) return { days: list, totalDays: 0, sandwichDays: 0, excluded, error: 'No working days in range' };
  return { days: list, totalDays, sandwichDays, excluded };
}

/** Two sessions on the same date conflict unless they are complementary halves. */
export function sessionsConflict(a: Session, b: Session): boolean {
  if (a === 'FULL' || b === 'FULL') return true;
  return a === b;
}

export type ExcessAction = 'REJECT' | 'CONVERT_TO_LOP';

/**
 * Split requested units into paid and LOP against the available balance.
 * Returns blocked=true when the request cannot be accepted.
 */
export function splitPaid(
  units: number,
  available: number,
  opts: { isPaidType: boolean; allowNegative?: boolean; negativeLimit?: number; excessAction?: ExcessAction; checkBalance?: boolean },
): { paid: number; lop: number; blocked: boolean } {
  if (!opts.isPaidType) return { paid: 0, lop: units, blocked: false };
  if (opts.checkBalance === false) return { paid: units, lop: 0, blocked: false };
  if (units <= available + 1e-9) return { paid: units, lop: 0, blocked: false };
  if (opts.allowNegative && available - units >= -(opts.negativeLimit ?? 0) - 1e-9) return { paid: units, lop: 0, blocked: false };
  if (opts.excessAction === 'CONVERT_TO_LOP') {
    const paid = Math.max(0, roundHalfDown(available));
    return { paid, lop: units - paid, blocked: false };
  }
  return { paid: 0, lop: 0, blocked: true };
}

/** Mark the last `lop` units of the breakdown unpaid (latest dates first). */
export function markLop(days: ExpandedDay[], lop: number): ExpandedDay[] {
  let left = lop;
  const out = days.map((d) => ({ ...d }));
  for (let i = out.length - 1; i >= 0 && left > 0; i--) {
    const d = out[i]!;
    if (d.units <= 0) continue;
    if (d.units <= left + 1e-9) {
      d.isPaid = false;
      left -= d.units;
    } else {
      // A half of a full day is unpaid: keep the row paid but LOP accounted at request level.
      left = 0;
    }
  }
  return out;
}

/** Round to the nearest 0.5 (half-up). */
export function roundHalf(x: number): number {
  return Math.round(x * 2 + 1e-9) / 2;
}

function roundHalfDown(x: number): number {
  return Math.floor(x * 2 + 1e-9) / 2;
}

/**
 * YEARLY credit pro-ration on joining: round_half(quota × remaining months / 12), where
 * the join month counts only if the join date is on or before the 15th.
 */
export function prorateYearly(quota: number, joinDate: DateKey | null, year: number): number {
  if (!joinDate) return quota;
  const jy = Number(joinDate.slice(0, 4));
  if (jy < year) return quota;
  if (jy > year) return 0;
  const m = Number(joinDate.slice(5, 7));
  const day = Number(joinDate.slice(8, 10));
  const remaining = 12 - m + (day <= 15 ? 1 : 0);
  return roundHalf((quota * remaining) / 12);
}

/**
 * MONTHLY accrual: the months (1–12) of `year` in which a credit is due for an employee.
 * First credit is the join month if joined on/before the 15th, else the next month.
 */
export function monthlyCreditMonths(joinDate: DateKey | null, year: number): number[] {
  let first = 1;
  if (joinDate) {
    const jy = Number(joinDate.slice(0, 4));
    if (jy > year) return [];
    if (jy === year) {
      const m = Number(joinDate.slice(5, 7));
      first = Number(joinDate.slice(8, 10)) <= 15 ? m : m + 1;
    }
  }
  const out: number[] = [];
  for (let m = first; m <= 12; m++) out.push(m);
  return out;
}

/** Full-year scheduled accrual (used for the card "total"). */
export function scheduledAnnual(frequency: string, daysPerPeriod: number, quota: number, joinDate: DateKey | null, year: number): number {
  if (frequency === 'MONTHLY') return monthlyCreditMonths(joinDate, year).length * daysPerPeriod;
  if (frequency === 'QUARTERLY') {
    const months = monthlyCreditMonths(joinDate, year);
    return [1, 4, 7, 10].filter((q) => months.includes(q) || months.some((m) => m > q && m < q + 3)).length * daysPerPeriod;
  }
  if (frequency === 'YEARLY') return prorateYearly(quota, joinDate, year);
  return 0;
}

export type BalanceParts = {
  opening: number;
  accrued: number;
  credited: number;
  availed: number;
  pending: number;
  lapsed: number;
  encashed: number;
};

/** available = opening + accrued + credited − availed − lapsed − encashed − pending. */
export function availableOf(b: BalanceParts): number {
  return round2(b.opening + b.accrued + b.credited - b.availed - b.lapsed - b.encashed - b.pending);
}

/** Year-end: how much of the closing balance carries forward, and how much lapses. */
export function yearEndSplit(closing: number, carryForwardMax: number | null, encashable = false, encashExcess = false, maxEncash: number | null = null) {
  const positive = Math.max(0, closing);
  const carry = carryForwardMax === null ? 0 : Math.min(positive, carryForwardMax);
  const excess = positive - carry;
  const encash = encashable && encashExcess ? Math.min(excess, maxEncash ?? excess) : 0;
  const lapse = excess - encash;
  // A negative closing carries forward as a negative opening.
  return { carry: closing < 0 ? closing : carry, encash, lapse };
}

/** Comp-off FIFO consumption by expiry; a grant can only be used on/before its expiry. */
export function consumeCompOff(
  grants: { id: string; remaining: number; expiresOn: DateKey }[],
  units: number,
  leaveDate: DateKey,
): { consumed: { grantId: string; units: number }[]; shortfall: number } {
  let left = units;
  const consumed: { grantId: string; units: number }[] = [];
  for (const g of [...grants].sort((a, b) => (a.expiresOn < b.expiresOn ? -1 : 1))) {
    if (left <= 0) break;
    if (g.expiresOn < leaveDate || g.remaining <= 0) continue;
    const take = Math.min(g.remaining, left);
    consumed.push({ grantId: g.id, units: take });
    left -= take;
  }
  return { consumed, shortfall: round2(left) };
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** "1 EL", "2 CL", "0.5 CL · 1 LWP" for the payroll table. */
export function leaveSummaryLabel(summary: { code: string; days: number }[]): string {
  const parts = summary.filter((s) => s.days > 0).map((s) => `${fmtDays(s.days)} ${s.code}`);
  return parts.length ? parts.join(' · ') : '0';
}

export function fmtDays(n: number): string {
  return Number.isInteger(n) ? String(n) : String(round2(n));
}
