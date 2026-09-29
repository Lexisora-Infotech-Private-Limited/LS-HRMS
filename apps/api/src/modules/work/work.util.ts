import { istDateKey } from '@lexisora/shared';

/** YYYY-MM-DD (IST business day) → Date at UTC midnight (how @db.Date columns are stored). */
export function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

/** @db.Date value → "YYYY-MM-DD". */
export function dateKey(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function todayKey(): string {
  return istDateKey(new Date());
}

export function todayDate(): Date {
  return dateOnly(todayKey());
}

/** Minutes → hours with at most 2 decimals. */
export const hoursOf = (min: number | null | undefined) => (min == null ? null : Math.round((min / 60) * 100) / 100);

/** "2026-09" → [start, nextStart) as @db.Date values + label "Sep". */
export function monthRange(month: string): { start: Date; end: Date; label: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const label = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return { start, end, label };
}

/** "Mar 2026" */
export function monthYearLabel(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** Minutes of the IST clock right now (for "after 18:30" style rules). */
export function istMinuteOfDay(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
