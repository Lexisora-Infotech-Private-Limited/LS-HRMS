import { KUDOS_LIMITS } from '@lexisora/shared';

/** Kudos & Employee of the Month rules (spec §4.5). Pure — unit tested. */

export type RecentKudos = { recipientEmployeeId: string; badgeId: string; createdAt: Date };
export type RuleError = { status: 422 | 429 | 409; code: string; message: string };

const DAY = 86_400_000;

/** Self-kudos → 422; same badge to the same person within 7 days or > 10 a week → 429. */
export function kudosLimitError(i: { giverId: string; recipientId: string; badgeId: string; recipientName: string; recent: RecentKudos[]; now: Date }): RuleError | null {
  if (i.giverId === i.recipientId) return { status: 422, code: 'KUDOS_SELF', message: 'You can’t give kudos to yourself' };
  const since = (days: number) => i.now.getTime() - days * DAY;
  const window = i.recent.filter((k) => k.createdAt.getTime() >= since(KUDOS_LIMITS.windowDays));
  if (i.recent.some((k) => k.recipientEmployeeId === i.recipientId && k.badgeId === i.badgeId && k.createdAt.getTime() >= since(KUDOS_LIMITS.sameBadgeDays))) {
    return { status: 429, code: 'KUDOS_LIMIT', message: `You already gave ${i.recipientName} this badge in the last ${KUDOS_LIMITS.sameBadgeDays} days` };
  }
  if (window.length >= KUDOS_LIMITS.maxPerWindow) return { status: 429, code: 'KUDOS_LIMIT', message: `You can give up to ${KUDOS_LIMITS.maxPerWindow} kudos a week` };
  return null;
}

/** "2026-09" for an IST date key. */
export const monthOf = (key: string) => key.slice(0, 7);

export function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The announce form offers the current month and the previous two. */
export function eotmMonthOptions(todayKey: string): string[] {
  const cur = monthOf(todayKey);
  return [cur, shiftMonth(cur, -1), shiftMonth(cur, -2)];
}

export function eotmMonthError(month: string, todayKey: string): RuleError | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { status: 422, code: 'EOTM_MONTH', message: 'Pick a month' };
  if (month > monthOf(todayKey)) return { status: 422, code: 'EOTM_FUTURE', message: 'Employee of the Month can’t be announced for a future month' };
  if (!eotmMonthOptions(todayKey).includes(month)) return { status: 422, code: 'EOTM_MONTH', message: 'Pick the current month or one of the previous two' };
  return null;
}

/** The recipient must have been on the rolls during the month (joined by its last day, not exited before it). */
export function eotmEligible(e: { status: string; joiningDate: Date | null; exitDate?: Date | null }, month: string): boolean {
  if (!['ACTIVE', 'NOTICE_PERIOD'].includes(e.status)) return false;
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(`${shiftMonth(month, 1)}-01T00:00:00Z`);
  if (e.joiningDate && e.joiningDate.getTime() >= end.getTime()) return false;
  if (e.exitDate && e.exitDate.getTime() < start.getTime()) return false;
  return true;
}

/** "Rahul Desai" → "Rahul D." (sidebar "Star Coder → Rahul D."). */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

export const kudosPostTitle = (badge: string, recipient: string) => `${badge} → ${recipient}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** EOTM post body: the citation + the pronoun-neutral certificate line. */
export function eotmPostBody(citation: string): string {
  return `<p>${esc(citation.trim())}</p><p>The certificate is ready to download.</p>`;
}

export function kudosPostBody(message: string): string {
  return `<p>${esc(message.trim())}</p>`;
}

/** Most-given badge (ties → the most recent). */
export function topBadge(rows: { badge: string; createdAt: Date }[]): { name: string; count: number } | null {
  const by = new Map<string, { count: number; last: number }>();
  for (const r of rows) {
    const x = by.get(r.badge) ?? { count: 0, last: 0 };
    x.count++;
    x.last = Math.max(x.last, r.createdAt.getTime());
    by.set(r.badge, x);
  }
  let best: { name: string; count: number; last: number } | null = null;
  for (const [name, x] of by) if (!best || x.count > best.count || (x.count === best.count && x.last > best.last)) best = { name, ...x };
  return best ? { name: best.name, count: best.count } : null;
}
