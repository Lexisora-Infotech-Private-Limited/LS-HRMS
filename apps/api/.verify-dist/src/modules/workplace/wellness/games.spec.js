"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const T = 'tenant-demo';
const dates = Array.from({
    length: 30
}, (_, i)=>new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
(0, _vitest.describe)('Queens generator', ()=>{
    (0, _vitest.it)('is deterministic per tenant and date', ()=>{
        (0, _vitest.expect)((0, _shared.generateQueens)(T, '2026-09-29')).toEqual((0, _shared.generateQueens)(T, '2026-09-29'));
        (0, _vitest.expect)((0, _shared.generateQueens)(T, '2026-09-29').regions).not.toEqual((0, _shared.generateQueens)(T, '2026-09-30').regions);
    });
    _vitest.it.each(dates)('produces a valid solvable board for %s', (d)=>{
        const p = (0, _shared.generateQueens)(T, d);
        (0, _vitest.expect)(p.regions).toHaveLength(7);
        // every region id 0..6 used, every cell assigned
        (0, _vitest.expect)(new Set(p.regions.flat())).toEqual(new Set([
            0,
            1,
            2,
            3,
            4,
            5,
            6
        ]));
        (0, _vitest.expect)((0, _shared.validateQueens)(p.regions, p.solution)).toBe(true);
        (0, _vitest.expect)((0, _shared.countQueensSolutions)(p.regions, 2)).toBeGreaterThanOrEqual(1);
    });
    (0, _vitest.it)('produces unique boards on most days', ()=>{
        const unique = dates.filter((d)=>(0, _shared.generateQueens)(T, d).unique).length;
        (0, _vitest.expect)(unique).toBeGreaterThanOrEqual(dates.length * 0.8);
    });
    (0, _vitest.it)('rejects touching queens and duplicate columns', ()=>{
        const p = (0, _shared.generateQueens)(T, '2026-09-29');
        const bad = p.solution.slice();
        bad[1] = bad[0];
        (0, _vitest.expect)((0, _shared.validateQueens)(p.regions, bad)).toBe(false);
        (0, _vitest.expect)((0, _shared.validateQueens)(p.regions, 'nope')).toBe(false);
    });
});
(0, _vitest.describe)('Mini Sudoku 6×6', ()=>{
    _vitest.it.each(dates.slice(0, 12))('has a unique solution for %s', (d)=>{
        const p = (0, _shared.generateSudoku)(T, d);
        (0, _vitest.expect)((0, _shared.validateSudoku)(p.givens, p.solution)).toBe(true);
        (0, _vitest.expect)((0, _shared.countSudokuSolutions)(p.givens, 2)).toBe(1);
        const givens = p.givens.flat().filter(Boolean).length;
        (0, _vitest.expect)(givens).toBeGreaterThanOrEqual(12);
        (0, _vitest.expect)(givens).toBeLessThan(30);
    });
    (0, _vitest.it)('rejects a grid that breaks a given or a box', ()=>{
        const p = (0, _shared.generateSudoku)(T, '2026-09-29');
        const bad = p.solution.map((r)=>r.slice());
        [bad[0][0], bad[0][1]] = [
            bad[0][1],
            bad[0][0]
        ];
        (0, _vitest.expect)((0, _shared.validateSudoku)(p.givens, bad)).toBe(false);
    });
});
(0, _vitest.describe)('Word ladder', ()=>{
    _vitest.it.each(dates.slice(0, 12))('has a reachable target 4–6 moves away for %s', (d)=>{
        const p = (0, _shared.generateLadder)(T, d);
        (0, _vitest.expect)(p.par).toBeGreaterThanOrEqual(3);
        (0, _vitest.expect)(p.par).toBeLessThanOrEqual(6);
        (0, _vitest.expect)((0, _shared.validateLadder)(p, p.example)).toBe(true);
        (0, _vitest.expect)((0, _shared.ladderPath)(p.start, p.target).length - 1).toBe(p.par);
    });
    (0, _vitest.it)('rejects jumps of two letters and non-words', ()=>{
        (0, _vitest.expect)((0, _shared.validateLadder)({
            start: 'cold',
            target: 'warm'
        }, [
            'cold',
            'ward',
            'warm'
        ])).toBe(false);
        (0, _vitest.expect)((0, _shared.validateLadder)({
            start: 'cold',
            target: 'cord'
        }, [
            'cold',
            'cord'
        ])).toBe(true);
        (0, _vitest.expect)((0, _shared.validateLadder)({
            start: 'cold',
            target: 'cxld'
        }, [
            'cold',
            'cxld'
        ])).toBe(false);
    });
});
(0, _vitest.describe)('Scoring and unlock', ()=>{
    (0, _vitest.it)('awards 10 + (10 − 5) for a sudoku solved in 150 s', ()=>{
        (0, _vitest.expect)((0, _shared.scoreGame)('sudoku6', {
            elapsedSec: 150,
            hintsUsed: 0,
            revealed: false
        })).toBe(15);
    });
    (0, _vitest.it)('gives 0 when revealed and floors at 2', ()=>{
        (0, _vitest.expect)((0, _shared.scoreGame)('queens', {
            elapsedSec: 10,
            hintsUsed: 0,
            revealed: true
        })).toBe(0);
        (0, _vitest.expect)((0, _shared.scoreGame)('queens', {
            elapsedSec: 5000,
            hintsUsed: 2,
            revealed: false
        })).toBe(4);
        (0, _vitest.expect)((0, _shared.scoreGame)('wordladder', {
            elapsedSec: 5000,
            hintsUsed: 2,
            revealed: false,
            steps: 12,
            par: 4
        })).toBe(2);
    });
    (0, _vitest.it)('unlocks the new set at 00:00 IST', ()=>{
        (0, _vitest.expect)((0, _shared.puzzleDateFor)(new Date('2026-09-29T18:29:00Z'))).toBe('2026-09-29'); // 23:59 IST
        (0, _vitest.expect)((0, _shared.puzzleDateFor)(new Date('2026-09-29T18:30:00Z'))).toBe('2026-09-30'); // 00:00 IST
        (0, _vitest.expect)((0, _shared.puzzleDateFor)(new Date('2026-09-30T00:30:00Z'), '07:00')).toBe('2026-09-29');
    });
});

//# sourceMappingURL=games.spec.js.map