import { istDateKey } from '@lexisora/shared';

/**
 * Date-only helpers. Business dates are ISO keys ("2026-09-29"); @db.Date columns hold
 * UTC midnight of that key. All arithmetic is done on keys in UTC so DST/timezone never
 * shifts a day.
 */
export type DateKey = string;

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Date (a @db.Date value) → "YYYY-MM-DD". */
export function dk(d: Date | string): DateKey {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → Date at UTC midnight (what Prisma stores for @db.Date). */
export function dd(key: DateKey): Date {
  return new Date(`${key.slice(0, 10)}T00:00:00.000Z`);
}

export function addDays(key: DateKey, n: number): DateKey {
  const d = dd(key);
  d.setUTCDate(d.getUTCDate() + n);
  return dk(d);
}

export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((dd(a).getTime() - dd(b).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dow(key: DateKey): number {
  return dd(key).getUTCDay();
}

export function eachDay(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

/** Today's business date in IST. */
export function todayKey(now: Date = new Date()): DateKey {
  return istDateKey(now);
}

export function yearOf(key: DateKey): number {
  return Number(key.slice(0, 4));
}

export function monthOf(key: DateKey): number {
  return Number(key.slice(5, 7));
}

export function periodOf(key: DateKey): string {
  return key.slice(0, 7);
}

/** "2026-09" → first/last day keys and counts. */
export function monthBounds(period: string): { start: DateKey; end: DateKey; year: number; month: number; days: number } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { start, end, year: y, month: m, days: last };
}

export function prevPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** "2026-09" → "Sep 2026" / "September 2026". */
export function periodLabel(period: string, long = false): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return `${(long ? MONTHS_LONG : MONTHS_SHORT)[m - 1]} ${y}`;
}

/** "2026-10-14" → "14 Oct". */
export function dayMonth(key: DateKey): string {
  return `${Number(key.slice(8, 10))} ${MONTHS_SHORT[monthOf(key) - 1]}`;
}

/** Range label used on the Time off screen: "14 – 16 Oct", "30 Sep – 2 Oct", "4 Sep". */
export function rangeLabel(from: DateKey, to: DateKey): string {
  if (from === to) return dayMonth(from);
  if (periodOf(from) === periodOf(to)) return `${Number(from.slice(8, 10))} – ${dayMonth(to)}`;
  return `${dayMonth(from)} – ${dayMonth(to)}`;
}

/** Indian financial year start year for a date key: 2026-09-29 → 2026; 2027-02-01 → 2026. */
export function fyStartYear(key: DateKey): number {
  const y = yearOf(key);
  return monthOf(key) >= 4 ? y : y - 1;
}

/** Months from `period` through March (inclusive): Sep → 7, Mar → 1, Apr → 12. */
export function fyMonthsRemaining(period: string): number {
  const m = Number(period.slice(5, 7));
  return m >= 4 ? 12 - (m - 4) : 4 - m;
}

/** Months of the FY elapsed before `period`: Apr → 0, Sep → 5, Mar → 11. */
export function fyMonthsElapsed(period: string): number {
  return 12 - fyMonthsRemaining(period);
}

/** Periods ("YYYY-MM") of the FY before `period`. */
export function fyPriorPeriods(period: string): string[] {
  const out: string[] = [];
  let p = period;
  for (let i = 0; i < fyMonthsElapsed(period); i++) {
    p = prevPeriod(p);
    out.unshift(p);
  }
  return out;
}

export const minKey = (a: DateKey, b: DateKey) => (a < b ? a : b);
export const maxKey = (a: DateKey, b: DateKey) => (a > b ? a : b);
