import { describe, expect, it } from 'vitest';
import {
  countQueensSolutions,
  countSudokuSolutions,
  generateLadder,
  generateQueens,
  generateSudoku,
  ladderPath,
  puzzleDateFor,
  scoreGame,
  validateLadder,
  validateQueens,
  validateSudoku,
} from '@lexisora/shared';

const T = 'tenant-demo';
const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));

describe('Queens generator', () => {
  it('is deterministic per tenant and date', () => {
    expect(generateQueens(T, '2026-09-29')).toEqual(generateQueens(T, '2026-09-29'));
    expect(generateQueens(T, '2026-09-29').regions).not.toEqual(generateQueens(T, '2026-09-30').regions);
  });
  it.each(dates)('produces a valid solvable board for %s', (d) => {
    const p = generateQueens(T, d);
    expect(p.regions).toHaveLength(7);
    // every region id 0..6 used, every cell assigned
    expect(new Set(p.regions.flat())).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    expect(validateQueens(p.regions, p.solution)).toBe(true);
    expect(countQueensSolutions(p.regions, 2)).toBeGreaterThanOrEqual(1);
  });
  it('produces unique boards on most days', () => {
    const unique = dates.filter((d) => generateQueens(T, d).unique).length;
    expect(unique).toBeGreaterThanOrEqual(dates.length * 0.8);
  });
  it('rejects touching queens and duplicate columns', () => {
    const p = generateQueens(T, '2026-09-29');
    const bad = p.solution.slice();
    bad[1] = bad[0]!;
    expect(validateQueens(p.regions, bad)).toBe(false);
    expect(validateQueens(p.regions, 'nope')).toBe(false);
  });
});

describe('Mini Sudoku 6×6', () => {
  it.each(dates.slice(0, 12))('has a unique solution for %s', (d) => {
    const p = generateSudoku(T, d);
    expect(validateSudoku(p.givens, p.solution)).toBe(true);
    expect(countSudokuSolutions(p.givens, 2)).toBe(1);
    const givens = p.givens.flat().filter(Boolean).length;
    expect(givens).toBeGreaterThanOrEqual(12);
    expect(givens).toBeLessThan(30);
  });
  it('rejects a grid that breaks a given or a box', () => {
    const p = generateSudoku(T, '2026-09-29');
    const bad = p.solution.map((r) => r.slice());
    [bad[0]![0], bad[0]![1]] = [bad[0]![1]!, bad[0]![0]!];
    expect(validateSudoku(p.givens, bad)).toBe(false);
  });
});

describe('Word ladder', () => {
  it.each(dates.slice(0, 12))('has a reachable target 4–6 moves away for %s', (d) => {
    const p = generateLadder(T, d);
    expect(p.par).toBeGreaterThanOrEqual(3);
    expect(p.par).toBeLessThanOrEqual(6);
    expect(validateLadder(p, p.example)).toBe(true);
    expect(ladderPath(p.start, p.target)!.length - 1).toBe(p.par);
  });
  it('rejects jumps of two letters and non-words', () => {
    expect(validateLadder({ start: 'cold', target: 'warm' }, ['cold', 'ward', 'warm'])).toBe(false);
    expect(validateLadder({ start: 'cold', target: 'cord' }, ['cold', 'cord'])).toBe(true);
    expect(validateLadder({ start: 'cold', target: 'cxld' }, ['cold', 'cxld'])).toBe(false);
  });
});

describe('Scoring and unlock', () => {
  it('awards 10 + (10 − 5) for a sudoku solved in 150 s', () => {
    expect(scoreGame('sudoku6', { elapsedSec: 150, hintsUsed: 0, revealed: false })).toBe(15);
  });
  it('gives 0 when revealed and floors at 2', () => {
    expect(scoreGame('queens', { elapsedSec: 10, hintsUsed: 0, revealed: true })).toBe(0);
    expect(scoreGame('queens', { elapsedSec: 5000, hintsUsed: 2, revealed: false })).toBe(4);
    expect(scoreGame('wordladder', { elapsedSec: 5000, hintsUsed: 2, revealed: false, steps: 12, par: 4 })).toBe(2);
  });
  it('unlocks the new set at 00:00 IST', () => {
    expect(puzzleDateFor(new Date('2026-09-29T18:29:00Z'))).toBe('2026-09-29'); // 23:59 IST
    expect(puzzleDateFor(new Date('2026-09-29T18:30:00Z'))).toBe('2026-09-30'); // 00:00 IST
    expect(puzzleDateFor(new Date('2026-09-30T00:30:00Z'), '07:00')).toBe('2026-09-29');
  });
});
