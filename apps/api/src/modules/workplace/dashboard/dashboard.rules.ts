import type { DashboardEvent } from '@lexisora/shared';
import { addDaysKey, dateOnly, dayMonth, keyOf } from '../common/dates';

/** Pure dashboard rules (spec §1.3 / §1.5), unit-tested in dashboard.spec.ts. */

/** Platform default Thought-of-the-day list (the wireframe QUOTES) for tenants with an empty pool. */
export const DEFAULT_QUOTES = [
  'Small steps every day add up to big results.',
  'Do the hard thing first; the rest of the day gets lighter.',
  'Quality is never an accident.',
  'You are one focused hour away from a good day.',
];

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Upcoming birthdays / work anniversaries within `days` of `today` (inclusive).
 * Birthdays match month + day (29 Feb shows on 28 Feb in non-leap years; the year is never
 * exposed). Anniversaries need ≥ 1 completed year ("Sneha Patel · 3 years").
 */
export function celebrationsWithin(
  people: { id: string; name: string; dob: Date | null; joined: Date | null }[],
  today: string,
  days: number,
  excludeId?: string | null,
): DashboardEvent[] {
  const out: DashboardEvent[] = [];
  const inWindow = (md: string) => {
    for (let add = 0; add <= days; add++) {
      const k = addDaysKey(today, add);
      if (k.slice(5) === md) return k;
      if (md === '02-29' && k.slice(5) === '02-28' && !isLeap(+k.slice(0, 4))) return k;
    }
    return null;
  };
  for (const p of people) {
    if (p.id === excludeId) continue;
    if (p.dob) {
      const k = inWindow(keyOf(p.dob).slice(5));
      if (k) out.push({ id: `bday:${p.id}`, kind: 'BIRTHDAY', what: `${p.name} · birthday`, when: dayMonth(dateOnly(k)), date: k });
    }
    if (p.joined) {
      const k = inWindow(keyOf(p.joined).slice(5));
      const years = k ? +k.slice(0, 4) - p.joined.getUTCFullYear() : 0;
      if (k && years >= 1) out.push({ id: `anniv:${p.id}`, kind: 'ANNIVERSARY', what: `${p.name} · ${years} year${years > 1 ? 's' : ''}`, when: dayMonth(dateOnly(k)), date: k });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.what.localeCompare(b.what));
}

/** Merge + sort to-dos: overdue first, then due date, then system → board → personal, then age. */
export function sortTodos<T extends { overdue: boolean; sortDate: string; prio: number; createdAt: number }>(items: T[]): T[] {
  return items.slice().sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.sortDate.localeCompare(b.sortDate) || a.prio - b.prio || a.createdAt - b.createdAt);
}

/** "21–27 Sep" for the week starting `weekStart` (Mon); "28 Sep – 4 Oct" across months. */
export function weekRangeLabel(weekStart: string): string {
  const end = addDaysKey(weekStart, 6);
  const mon = (k: string) => dayMonth(dateOnly(k)).split(' ')[1];
  return mon(weekStart) === mon(end) ? `${+weekStart.slice(8)}–${+end.slice(8)} ${mon(end)}` : `${+weekStart.slice(8)} ${mon(weekStart)} – ${+end.slice(8)} ${mon(end)}`;
}

/** Where "Review now" goes: the first queue with work waiting, else the first queue. */
export function reviewLink(rows: { count: number; link: string }[] | null): string | null {
  if (!rows?.length) return null;
  return (rows.find((r) => r.count > 0) ?? rows[0])!.link;
}

/** Deep link into the task board (work domain): project + team board + task drawer (by id). */
export function taskLink(t: { id: string; projectId: string; departmentId: string | null }): string {
  const q = new URLSearchParams({ project: t.projectId, ...(t.departmentId ? { board: t.departmentId } : {}), task: t.id });
  return `/board?${q.toString()}`;
}

/**
 * Header line "designation · department" (spec §1.1). The department is left out when the
 * designation already names it ("HR Manager") or for the leadership group ("Management").
 */
export function titleLine(designation: string | null | undefined, department: string | null | undefined): string {
  const d = (designation ?? '').trim();
  const dep = (department ?? '').trim();
  if (!dep || dep.toLowerCase() === 'management' || d.toLowerCase().includes(dep.toLowerCase())) return d;
  return d ? `${d} · ${dep}` : dep;
}

/** Approvals card visibility: employees only see it when one of their queues has work. */
export function approvalsFor<T extends { count: number }>(roleKey: string | null | undefined, rows: T[]): T[] | null {
  if (!rows.length) return null;
  if (roleKey === 'employee' && !rows.some((r) => r.count > 0)) return null;
  return rows;
}
