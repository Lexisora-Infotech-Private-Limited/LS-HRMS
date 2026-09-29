/** Formatting helpers shared by main and renderer. All wall-clock output is IST. */

export const TZ = 'Asia/Kolkata';

/** 8h 19m style used by the wireframe ("4h 00m"). */
export function hm(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const shortDateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' });

/** HH:mm in IST. */
export function clock(ms: number | Date): string {
  return clockFmt.format(typeof ms === 'number' ? new Date(ms) : ms);
}

/** YYYY-MM-DD business day in IST. */
export function istDayKey(ms: number | Date): string {
  return dayFmt.format(typeof ms === 'number' ? new Date(ms) : ms);
}

/** "29 Sep" */
export function shortDate(ms: number | Date | string): string {
  return shortDateFmt.format(new Date(ms));
}

/** Minutes of the IST day for a timestamp (0..1439). */
export function istMinuteOfDay(ms: number): number {
  const [h, m] = clock(ms).split(':').map(Number);
  return h * 60 + m;
}

/** "09:30" → 570; null for invalid. */
export function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

export function relativeInput(sec: number): string {
  if (sec < 60) return 'just now';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

/** Compare dotted versions ("1.4.10" > "1.4.2"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
