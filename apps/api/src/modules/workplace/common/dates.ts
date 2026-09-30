import { istDateKey } from '@lexisora/shared';

export const IST_OFFSET_MIN = 330;
export const DAY_MS = 86_400_000;

/** "2026-09-29" → Date at UTC midnight (how @db.Date columns are stored). */
export function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** Date-only column value → "2026-09-29". */
export function keyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayKey(now = new Date()): string {
  return istDateKey(now);
}

export function addDaysKey(key: string, days: number): string {
  return keyOf(new Date(dateOnly(key).getTime() + days * DAY_MS));
}

/** IST wall clock (date key + "HH:mm") → UTC instant. */
export function istInstant(key: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(dateOnly(key).getTime() + ((h! * 60 + m!) - IST_OFFSET_MIN) * 60_000);
}

/** Minutes since IST midnight for an instant. */
export function istMinuteOfDay(d: Date): number {
  const shifted = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', ...opts });

/**
 * Fixed three-letter month names: recent CLDR data renders en-GB/en-IN September as
 * "Sept", while the product copy (wireframe) uses "Sep" everywhere.
 */
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Tuesday, 29 September 2026" */
export function longDate(d: Date): string {
  const p = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('weekday')}, ${g('day')} ${g('month')} ${g('year')}`;
}

/** "29 Sep" (IST calendar day of the instant; date-only values keep their date). */
export function dayMonth(d: Date): string {
  const s = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return `${s.getUTCDate()} ${MONTHS_SHORT[s.getUTCMonth()]}`;
}

/** "Wed" */
export function weekdayShort(d: Date): string {
  return fmt({ weekday: 'short' }).format(d);
}

/** "11:00" (IST) */
export function hhmm(d: Date): string {
  return fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** "5 pm" / "10:30 am" (IST) */
export function shortTime(d: Date): string {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return s.replace(':00', '').replace(' AM', ' am').replace(' PM', ' pm');
}

/** "September 2026" for "2026-09" */
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Due label used on the dashboard to-do card: Overdue / Today / Wed (within a week) / 3 Oct. */
export function dueLabel(dueKey: string | null, today: string): string {
  if (!dueKey) return 'Anytime';
  if (dueKey < today) return 'Overdue';
  if (dueKey === today) return 'Today';
  const diff = Math.round((dateOnly(dueKey).getTime() - dateOnly(today).getTime()) / DAY_MS);
  const d = dateOnly(dueKey);
  if (diff < 7) return new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(d);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** Monday of the IST week containing `key`. */
export function weekStartKey(key: string): string {
  const d = dateOnly(key);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  return addDaysKey(key, -dow);
}
