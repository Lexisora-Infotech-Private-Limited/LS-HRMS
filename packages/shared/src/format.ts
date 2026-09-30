/**
 * Money is stored as integer paise everywhere (Int / BigInt columns). These helpers
 * format for display using Indian digit grouping (₹ 1,02,880).
 */
export function formatINR(paise: number | bigint | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (paise === null || paise === undefined) return '—';
  const rupees = Number(paise) / 100;
  const s = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: opts.decimals ? 2 : 0,
    maximumFractionDigits: opts.decimals ? 2 : 0,
  }).format(Math.abs(rupees));
  return (rupees < 0 ? '- ' : '') + '₹ ' + s;
}

/** Compact lakh/crore format used on KPI tiles: ₹ 19.2 L, ₹ 1.4 Cr. */
export function formatINRCompact(paise: number | bigint): string {
  const r = Number(paise) / 100;
  if (Math.abs(r) >= 1e7) return `₹ ${(r / 1e7).toFixed(1)} Cr`;
  if (Math.abs(r) >= 1e5) return `₹ ${(r / 1e5).toFixed(1)} L`;
  return formatINR(paise);
}

export const toPaise = (rupees: number): number => Math.round(rupees * 100);

/** Seconds → "8h 20m". */
export function formatHm(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Seconds → "4:30" (timesheet grid cells). */
export function formatHhMm(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Seconds → "02:14:09" (live punch timers). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export const TIMEZONE = 'Asia/Kolkata';

/** YYYY-MM-DD for a Date in IST (the business day). */
export function istDateKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Three-letter months as in the wireframe. Newer ICU data prints September as "Sept" for
 * en-IN/en-GB, so month names come from this table instead of Intl.
 */
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Day, month index and year of an instant in IST. */
export function istParts(d: Date | string): { day: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(d));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { day: get('day'), month: get('month') - 1, year: get('year') };
}

/** "29 Sep 2026" */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const p = istParts(d);
  return `${p.day} ${MONTHS_SHORT[p.month]} ${p.year}`;
}

/** "29 Sep" */
export function formatDayMonth(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const p = istParts(d);
  return `${p.day} ${MONTHS_SHORT[p.month]}`;
}

/** "Sep 2026" */
export function formatMonthYear(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const p = istParts(d);
  return `${MONTHS_SHORT[p.month]} ${p.year}`;
}

/** "09:41" in IST */
export function formatTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}
