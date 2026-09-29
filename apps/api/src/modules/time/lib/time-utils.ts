/**
 * Date helpers for the time domain. Business dates are IST calendar days stored in
 * `@db.Date` columns as UTC midnight of that IST date. IST has no DST (+05:30 fixed).
 */
export const IST_OFFSET_MIN = 330;
const DAY_MS = 86_400_000;
export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-29" → Date(UTC midnight) for @db.Date columns. */
export function dateOf(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** @db.Date value → "2026-09-29". */
export function keyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Instant → IST business-day key. */
export function istKeyOf(instant: Date): string {
  return keyOf(new Date(instant.getTime() + IST_OFFSET_MIN * 60_000));
}

/** Minutes since IST midnight for an instant. */
export function istMinuteOf(instant: Date): number {
  const ms = (instant.getTime() + IST_OFFSET_MIN * 60_000) % DAY_MS;
  return Math.floor(ms / 60_000);
}

/** IST date key + minute-of-day → instant. */
export function istInstant(key: string, minute: number): Date {
  return new Date(dateOf(key).getTime() + (minute - IST_OFFSET_MIN) * 60_000);
}

/** "09:30" → 570 */
export function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 570 → "09:30" */
export function fmtMinute(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Instant → "09:41" IST. */
export function istHm(instant: Date | null | undefined): string | null {
  if (!instant) return null;
  return fmtMinute(istMinuteOf(instant));
}

export function addDays(key: string, n: number): string {
  return keyOf(new Date(dateOf(key).getTime() + n * DAY_MS));
}

/** 0 = Sunday … 6 = Saturday for a date key. */
export function dowOf(key: string): number {
  return dateOf(key).getUTCDay();
}

/** Monday of the week containing the date. */
export function mondayOf(key: string): string {
  const dow = dowOf(key);
  return addDays(key, dow === 0 ? -6 : 1 - dow);
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

export function monthOf(key: string): string {
  return key.slice(0, 7);
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** "Mon 28 Sep" */
export function dayLabel(key: string): string {
  const d = dateOf(key);
  return `${DOW_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MON_SHORT[d.getUTCMonth()]}`;
}

/** "28 Sep" */
export function dm(key: string): string {
  const d = dateOf(key);
  return `${d.getUTCDate()} ${MON_SHORT[d.getUTCMonth()]}`;
}

/** Week label: "21 – 27 Sep 2026" / short "21–27 Sep" (handles month change: "28 Sep – 4 Oct"). */
export function weekLabel(from: string, to: string, short = false): string {
  const a = dateOf(from);
  const b = dateOf(to);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const left = sameMonth ? `${a.getUTCDate()}` : `${a.getUTCDate()} ${MON_SHORT[a.getUTCMonth()]}`;
  const right = `${b.getUTCDate()} ${MON_SHORT[b.getUTCMonth()]}`;
  return short ? `${left}–${right}` : `${left} – ${right} ${b.getUTCFullYear()}`;
}

/** 2480 min → "41h 20m" */
export function hm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** 55 → "55m", 130 → "2h 10m", 0 → "0m" */
export function shortDur(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
}

/** Weekly-off label: [0,6] → "Sat, Sun" (Mon-first ordering). */
export function weeklyOffLabel(days: number[]): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const s = order.filter((d) => days.includes(d)).map((d) => DOW_SHORT[d]);
  return s.length ? s.join(', ') : 'None';
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}
