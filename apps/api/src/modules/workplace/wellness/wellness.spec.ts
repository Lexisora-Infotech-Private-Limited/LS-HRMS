import { describe, expect, it } from 'vitest';
import { elapsedFor, gameTile, leaderboardTile, nextUnlockLabel, peopleBoard, streakFrom, teamBoard, weekLabel, weekRange } from './wellness.rules';

describe('wellness weeks and streaks', () => {
  it('weeks run Monday to Sunday', () => {
    expect(weekRange('2026-09-29')).toEqual({ start: '2026-09-28', end: '2026-10-04' });
    expect(weekRange('2026-09-29', 'last')).toEqual({ start: '2026-09-21', end: '2026-09-27' });
    expect(weekRange('2026-10-04')).toEqual({ start: '2026-09-28', end: '2026-10-04' });
    expect(weekLabel(weekRange('2026-09-29'), 'current')).toBe('This week · 28 Sep – 4 Oct');
  });
  it('streak counts consecutive days ending today or yesterday', () => {
    expect(streakFrom(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'], '2026-09-29')).toBe(4);
    expect(streakFrom(['2026-09-28', '2026-09-29'], '2026-09-29')).toBe(2);
    expect(streakFrom(['2026-09-26', '2026-09-27'], '2026-09-29')).toBe(0);
    expect(streakFrom([], '2026-09-29')).toBe(0);
  });
  it('elapsed time is server-side and capped at 60 minutes', () => {
    const start = new Date('2026-09-29T07:00:00Z');
    expect(elapsedFor(start, new Date(start.getTime() + 134_000))).toBe(134);
    expect(elapsedFor(start, new Date(start.getTime() + 5 * 3_600_000))).toBe(3600);
    expect(elapsedFor(start, new Date(start.getTime() - 5000))).toBe(0);
  });
  it('unlock countdown', () => {
    expect(nextUnlockLabel(new Date('2026-09-29T04:10:00Z'))).toBe('New set unlocks at 00:00 IST · in 14h 20m');
  });
});

describe('leaderboards', () => {
  const depts = [
    { id: 'dev', name: 'Development', headcount: 5 },
    { id: 'qa', name: 'QA', headcount: 2 },
    { id: 'hr', name: 'HR', headcount: 1 },
    { id: 'fin', name: 'Finance', headcount: 1 },
  ];
  const rows = [
    { employeeId: 'priya', departmentId: 'dev', points: 18 },
    { employeeId: 'priya', departmentId: 'dev', points: 17 },
    { employeeId: 'rahul', departmentId: 'dev', points: 19 },
    { employeeId: 'rahul', departmentId: 'dev', points: 20 },
    { employeeId: 'arjun', departmentId: 'dev', points: 14 },
    { employeeId: 'sneha', departmentId: 'qa', points: 15 },
    { employeeId: 'karan', departmentId: 'qa', points: 8 },
    { employeeId: 'kavya', departmentId: 'hr', points: 15 },
    { employeeId: 'guest', departmentId: null, points: 30 },
  ];
  it('normalises team points by active headcount and ranks', () => {
    const b = teamBoard(rows, depts, 'dev');
    expect(b[0]).toMatchObject({ department: 'Development', points: 88, players: 3, scorePerMember: 17.6, rank: 1, mine: true });
    expect(b.find((t) => t.department === 'HR')).toMatchObject({ scorePerMember: 15, rank: 2 });
    expect(b.find((t) => t.department === 'QA')).toMatchObject({ scorePerMember: 11.5, rank: 3 });
    expect(b.find((t) => t.department === 'Finance')).toMatchObject({ points: 0, rank: null });
  });
  it('keeps people without a department out of the ranks', () => {
    const none = teamBoard(rows, depts, 'dev').find((t) => t.department === 'Unassigned');
    expect(none).toMatchObject({ rank: null, points: 30 });
  });
  it('breaks ties by number of players', () => {
    const b = teamBoard(
      [
        { employeeId: 'a', departmentId: 'x', points: 10 },
        { employeeId: 'b', departmentId: 'y', points: 5 },
        { employeeId: 'c', departmentId: 'y', points: 5 },
      ],
      [
        { id: 'x', name: 'X', headcount: 2 },
        { id: 'y', name: 'Y', headcount: 2 },
      ],
      null,
    );
    expect(b.map((t) => t.department)).toEqual(['Y', 'X']);
  });
  it('individuals: top by points with game counts', () => {
    const people = new Map([
      ['rahul', { name: 'Rahul Desai', initials: 'RD', department: 'Development' }],
      ['priya', { name: 'Priya Sharma', initials: 'PS', department: 'Development' }],
    ]);
    const p = peopleBoard(rows, people, 'priya', 2);
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ rank: 1, employeeId: 'rahul', points: 39, games: 2 });
    expect(p[1]).toMatchObject({ rank: 2, name: 'Priya Sharma', mine: true });
  });
});

describe('tiles', () => {
  it('wireframe copy before and after solving', () => {
    expect(gameTile('queens', null)).toMatchObject({ kicker: 'Daily · 3 min', title: 'Queens', sub: 'Place one queen per row, column and colour region.', cta: 'Play' });
    expect(gameTile('sudoku6', { completedAt: new Date(), elapsedSec: 134, points: 16, revealed: false })).toMatchObject({ sub: 'Solved in 2:14 · +16 pts', cta: 'Review', state: 'SOLVED' });
    expect(gameTile('wordladder', { completedAt: new Date(), elapsedSec: 700, points: 0, revealed: true }).state).toBe('REVEALED');
    expect(leaderboardTile('Development')).toMatchObject({ kicker: 'Weekly', title: 'Team leaderboard', sub: 'Development leads this week.', cta: 'View' });
  });
});
