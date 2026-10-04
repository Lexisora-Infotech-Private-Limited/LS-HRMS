"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _wellnessrules = require("./wellness.rules");
(0, _vitest.describe)('wellness weeks and streaks', ()=>{
    (0, _vitest.it)('weeks run Monday to Sunday', ()=>{
        (0, _vitest.expect)((0, _wellnessrules.weekRange)('2026-09-29')).toEqual({
            start: '2026-09-28',
            end: '2026-10-04'
        });
        (0, _vitest.expect)((0, _wellnessrules.weekRange)('2026-09-29', 'last')).toEqual({
            start: '2026-09-21',
            end: '2026-09-27'
        });
        (0, _vitest.expect)((0, _wellnessrules.weekRange)('2026-10-04')).toEqual({
            start: '2026-09-28',
            end: '2026-10-04'
        });
        (0, _vitest.expect)((0, _wellnessrules.weekLabel)((0, _wellnessrules.weekRange)('2026-09-29'), 'current')).toBe('This week · 28 Sep – 4 Oct');
    });
    (0, _vitest.it)('streak counts consecutive days ending today or yesterday', ()=>{
        (0, _vitest.expect)((0, _wellnessrules.streakFrom)([
            '2026-09-25',
            '2026-09-26',
            '2026-09-27',
            '2026-09-28'
        ], '2026-09-29')).toBe(4);
        (0, _vitest.expect)((0, _wellnessrules.streakFrom)([
            '2026-09-28',
            '2026-09-29'
        ], '2026-09-29')).toBe(2);
        (0, _vitest.expect)((0, _wellnessrules.streakFrom)([
            '2026-09-26',
            '2026-09-27'
        ], '2026-09-29')).toBe(0);
        (0, _vitest.expect)((0, _wellnessrules.streakFrom)([], '2026-09-29')).toBe(0);
    });
    (0, _vitest.it)('elapsed time is server-side and capped at 60 minutes', ()=>{
        const start = new Date('2026-09-29T07:00:00Z');
        (0, _vitest.expect)((0, _wellnessrules.elapsedFor)(start, new Date(start.getTime() + 134_000))).toBe(134);
        (0, _vitest.expect)((0, _wellnessrules.elapsedFor)(start, new Date(start.getTime() + 5 * 3_600_000))).toBe(3600);
        (0, _vitest.expect)((0, _wellnessrules.elapsedFor)(start, new Date(start.getTime() - 5000))).toBe(0);
    });
    (0, _vitest.it)('unlock countdown', ()=>{
        (0, _vitest.expect)((0, _wellnessrules.nextUnlockLabel)(new Date('2026-09-29T04:10:00Z'))).toBe('New set unlocks at 00:00 IST · in 14h 20m');
    });
});
(0, _vitest.describe)('leaderboards', ()=>{
    const depts = [
        {
            id: 'dev',
            name: 'Development',
            headcount: 5
        },
        {
            id: 'qa',
            name: 'QA',
            headcount: 2
        },
        {
            id: 'hr',
            name: 'HR',
            headcount: 1
        },
        {
            id: 'fin',
            name: 'Finance',
            headcount: 1
        }
    ];
    const rows = [
        {
            employeeId: 'priya',
            departmentId: 'dev',
            points: 18
        },
        {
            employeeId: 'priya',
            departmentId: 'dev',
            points: 17
        },
        {
            employeeId: 'rahul',
            departmentId: 'dev',
            points: 19
        },
        {
            employeeId: 'rahul',
            departmentId: 'dev',
            points: 20
        },
        {
            employeeId: 'arjun',
            departmentId: 'dev',
            points: 14
        },
        {
            employeeId: 'sneha',
            departmentId: 'qa',
            points: 15
        },
        {
            employeeId: 'karan',
            departmentId: 'qa',
            points: 8
        },
        {
            employeeId: 'kavya',
            departmentId: 'hr',
            points: 15
        },
        {
            employeeId: 'guest',
            departmentId: null,
            points: 30
        }
    ];
    (0, _vitest.it)('normalises team points by active headcount and ranks', ()=>{
        const b = (0, _wellnessrules.teamBoard)(rows, depts, 'dev');
        (0, _vitest.expect)(b[0]).toMatchObject({
            department: 'Development',
            points: 88,
            players: 3,
            scorePerMember: 17.6,
            rank: 1,
            mine: true
        });
        (0, _vitest.expect)(b.find((t)=>t.department === 'HR')).toMatchObject({
            scorePerMember: 15,
            rank: 2
        });
        (0, _vitest.expect)(b.find((t)=>t.department === 'QA')).toMatchObject({
            scorePerMember: 11.5,
            rank: 3
        });
        (0, _vitest.expect)(b.find((t)=>t.department === 'Finance')).toMatchObject({
            points: 0,
            rank: null
        });
    });
    (0, _vitest.it)('keeps people without a department out of the ranks', ()=>{
        const none = (0, _wellnessrules.teamBoard)(rows, depts, 'dev').find((t)=>t.department === 'Unassigned');
        (0, _vitest.expect)(none).toMatchObject({
            rank: null,
            points: 30
        });
    });
    (0, _vitest.it)('breaks ties by number of players', ()=>{
        const b = (0, _wellnessrules.teamBoard)([
            {
                employeeId: 'a',
                departmentId: 'x',
                points: 10
            },
            {
                employeeId: 'b',
                departmentId: 'y',
                points: 5
            },
            {
                employeeId: 'c',
                departmentId: 'y',
                points: 5
            }
        ], [
            {
                id: 'x',
                name: 'X',
                headcount: 2
            },
            {
                id: 'y',
                name: 'Y',
                headcount: 2
            }
        ], null);
        (0, _vitest.expect)(b.map((t)=>t.department)).toEqual([
            'Y',
            'X'
        ]);
    });
    (0, _vitest.it)('individuals: top by points with game counts', ()=>{
        const people = new Map([
            [
                'rahul',
                {
                    name: 'Rahul Desai',
                    initials: 'RD',
                    department: 'Development'
                }
            ],
            [
                'priya',
                {
                    name: 'Priya Sharma',
                    initials: 'PS',
                    department: 'Development'
                }
            ]
        ]);
        const p = (0, _wellnessrules.peopleBoard)(rows, people, 'priya', 2);
        (0, _vitest.expect)(p).toHaveLength(2);
        (0, _vitest.expect)(p[0]).toMatchObject({
            rank: 1,
            employeeId: 'rahul',
            points: 39,
            games: 2
        });
        (0, _vitest.expect)(p[1]).toMatchObject({
            rank: 2,
            name: 'Priya Sharma',
            mine: true
        });
    });
});
(0, _vitest.describe)('tiles', ()=>{
    (0, _vitest.it)('wireframe copy before and after solving', ()=>{
        (0, _vitest.expect)((0, _wellnessrules.gameTile)('queens', null)).toMatchObject({
            kicker: 'Daily · 3 min',
            title: 'Queens',
            sub: 'Place one queen per row, column and colour region.',
            cta: 'Play'
        });
        (0, _vitest.expect)((0, _wellnessrules.gameTile)('sudoku6', {
            completedAt: new Date(),
            elapsedSec: 134,
            points: 16,
            revealed: false
        })).toMatchObject({
            sub: 'Solved in 2:14 · +16 pts',
            cta: 'Review',
            state: 'SOLVED'
        });
        (0, _vitest.expect)((0, _wellnessrules.gameTile)('wordladder', {
            completedAt: new Date(),
            elapsedSec: 700,
            points: 0,
            revealed: true
        }).state).toBe('REVEALED');
        (0, _vitest.expect)((0, _wellnessrules.leaderboardTile)('Development')).toMatchObject({
            kicker: 'Weekly',
            title: 'Team leaderboard',
            sub: 'Development leads this week.',
            cta: 'View'
        });
    });
});

//# sourceMappingURL=wellness.spec.js.map