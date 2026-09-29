import { randomBytes } from 'node:crypto';
import { formatDate, istDateKey } from '@lexisora/shared';

/** Business "today" (IST) as YYYY-MM-DD. */
export const todayKey = () => istDateKey(new Date());

/** YYYY-MM-DD → Date at UTC midnight (how @db.Date columns are stored). */
export const toDbDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const dbDateKey = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const fmt = (d: Date | string | null | undefined) => (d ? formatDate(d) : '—');
/** "Jan 2027" */
export const fmtMonthYear = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d) : '—';
/** "30 Sep, 11:00" in IST */
export const fmtWhen = (d: Date) =>
  `${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(d)}, ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(d)}`;
/** "29 Sep 2026, 14:05" IST */
export const fmtStamp = (d: Date) =>
  `${formatDate(d)}, ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(d)}`;

export const token = (bytes = 24) => randomBytes(bytes).toString('base64url');

/** Indian digit grouping without symbol spacing issues in PDFs: "₹ 10,29,600" → "Rs. 10,29,600" (built-in PDF fonts lack ₹). */
export function inrPdf(paise: number): string {
  return 'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(paise / 100));
}

export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1]! };
}

/** Best-effort read of another domain's model (it may not exist yet in this build). */
export function model(prisma: unknown, name: string): any | null {
  const m = (prisma as Record<string, unknown>)[name];
  return m && typeof m === 'object' ? m : null;
}
