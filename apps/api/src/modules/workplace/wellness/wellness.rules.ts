import { formatGameClock, GAME_INFO, type GameKey, type LeaderboardPersonRow, type LeaderboardTeamRow, type WellnessTile } from '@lexisora/shared';
import { addDaysKey, dateOnly, MONTHS_SHORT, weekStartKey } from '../common/dates';

/** Pure wellness rules (spec §10.5): weeks, streaks, team and individual leaderboards, tiles. */

export const MAX_ELAPSED_SEC = 3600;

export type WellnessSettings = { enabledGames: GameKey[]; unlockTime: string; breakOnly: boolean };
export const DEFAULT_WELLNESS: WellnessSettings = { enabledGames: ['queens', 'sudoku6', 'wordladder'], unlockTime: '00:00', breakOnly: false };

/** Mon–Sun week containing `key` (or the one before it). */
export function weekRange(key: string, which: 'current' | 'last' = 'current'): { start: string; end: string } {
  const start = addDaysKey(weekStartKey(key), which === 'last' ? -7 : 0);
  return { start, end: addDaysKey(start, 6) };
}

const short = (key: string) => {
  const d = dateOnly(key);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
};

export function weekLabel(range: { start: string; end: string }, which: 'current' | 'last'): string {
  return `${which === 'current' ? 'This week' : 'Last week'} · ${short(range.start)} – ${short(range.end)}`;
}

/** Consecutive days (ending today, or yesterday when today is not played yet) with a completed game. */
export function streakFrom(playedDays: string[], today: string): number {
  const days = new Set(playedDays);
  let cursor = days.has(today) ? today : addDaysKey(today, -1);
  let n = 0;
  while (days.has(cursor)) {
    n++;
    cursor = addDaysKey(cursor, -1);
  }
  return n;
}

/** Server-side elapsed time: now − startedAt, capped at 60 minutes, never negative. */
export function elapsedFor(startedAt: Date, now: Date = new Date()): number {
  return Math.min(MAX_ELAPSED_SEC, Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000)));
}

export type ScoreRow = { employeeId: string; departmentId: string | null; points: number };
export type DeptInfo = { id: string; name: string; headcount: number };

/**
 * Team score = Σ points of department members ÷ active headcount (2 decimals); ties broken by
 * the number of players. People without a department are "Unassigned" and are not ranked.
 */
export function teamBoard(rows: ScoreRow[], depts: DeptInfo[], myDepartmentId: string | null): LeaderboardTeamRow[] {
  const agg = new Map<string, { points: number; players: Set<string> }>();
  for (const r of rows) {
    const k = r.departmentId ?? '__none';
    const a = agg.get(k) ?? { points: 0, players: new Set<string>() };
    a.points += r.points;
    a.players.add(r.employeeId);
    agg.set(k, a);
  }
  const out: LeaderboardTeamRow[] = depts
    .filter((d) => d.headcount > 0)
    .map((d) => {
      const a = agg.get(d.id);
      const points = a?.points ?? 0;
      return { departmentId: d.id, department: d.name, players: a?.players.size ?? 0, headcount: d.headcount, points, scorePerMember: Math.round((points / d.headcount) * 100) / 100, rank: null, mine: d.id === myDepartmentId };
    });
  out.sort((a, b) => b.scorePerMember - a.scorePerMember || b.players - a.players || a.department.localeCompare(b.department));
  let rank = 0;
  for (const t of out) if (t.points > 0) t.rank = ++rank;
  const none = agg.get('__none');
  if (none) out.push({ departmentId: '', department: 'Unassigned', players: none.players.size, headcount: none.players.size, points: none.points, scorePerMember: Math.round((none.points / Math.max(1, none.players.size)) * 100) / 100, rank: null, mine: myDepartmentId === null });
  return out;
}

export function peopleBoard(
  rows: ScoreRow[],
  people: Map<string, { name: string; initials: string; department: string | null }>,
  me: string | null,
  limit = 20,
): LeaderboardPersonRow[] {
  const agg = new Map<string, { points: number; games: number }>();
  for (const r of rows) {
    const a = agg.get(r.employeeId) ?? { points: 0, games: 0 };
    a.points += r.points;
    a.games += 1;
    agg.set(r.employeeId, a);
  }
  return [...agg.entries()]
    .map(([employeeId, a]) => ({ employeeId, ...a, p: people.get(employeeId) }))
    .sort((a, b) => b.points - a.points || b.games - a.games || (a.p?.name ?? '').localeCompare(b.p?.name ?? ''))
    .slice(0, limit)
    .map((r, i) => ({ rank: i + 1, employeeId: r.employeeId, name: r.p?.name ?? 'Anonymous', initials: r.p?.initials ?? '?', department: r.p?.department ?? null, points: r.points, games: r.games, mine: r.employeeId === me }));
}

/** Wireframe tile: "Daily · 3 min · Queens · …" → Play; solved → "Solved in 2:14 · +16 pts" → Review. */
export function gameTile(key: GameKey, s: { completedAt: Date | null; elapsedSec: number | null; points: number; revealed: boolean } | null): WellnessTile {
  const info = GAME_INFO[key];
  if (!s) return { key, kicker: info.kicker, title: info.title, sub: info.sub, cta: 'Play', state: 'NEW', points: null, elapsedSec: null };
  if (!s.completedAt) return { key, kicker: info.kicker, title: info.title, sub: info.sub, cta: 'Resume', state: 'STARTED', points: null, elapsedSec: null };
  if (s.revealed) return { key, kicker: info.kicker, title: info.title, sub: 'Revealed · 0 pts', cta: 'Review', state: 'REVEALED', points: 0, elapsedSec: s.elapsedSec };
  return { key, kicker: info.kicker, title: info.title, sub: `Solved in ${formatGameClock(s.elapsedSec ?? 0)} · +${s.points} pts`, cta: 'Review', state: 'SOLVED', points: s.points, elapsedSec: s.elapsedSec };
}

export function leaderboardTile(leader: string | null): WellnessTile {
  return { key: 'leaderboard', kicker: 'Weekly', title: 'Team leaderboard', sub: leader ? `${leader} leads this week.` : 'No games played yet this week.', cta: 'View', state: 'BOARD', points: null, elapsedSec: null };
}

/** "New set in 6h 12m" until the next unlock (IST). */
export function nextUnlockLabel(now: Date, unlock = '00:00'): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const [h, m] = unlock.split(':').map(Number);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  let left = h! * 60 + m! - mins;
  if (left <= 0) left += 24 * 60;
  const hh = Math.floor(left / 60);
  const mm = left % 60;
  return `New set unlocks at ${unlock} IST · in ${hh ? `${hh}h ` : ''}${mm}m`;
}
