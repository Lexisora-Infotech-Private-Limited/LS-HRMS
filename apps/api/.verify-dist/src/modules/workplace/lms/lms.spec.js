"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _lmsrules = require("./lms.rules");
const base = {
    courseId: 'c1',
    title: 'Secure coding guidelines',
    description: null,
    category: 'REQUIRED',
    totalDurationSec: 40 * 60,
    certificateOnCompletion: true,
    firstLessonType: 'VIDEO',
    lessonsTotal: 5,
    enrollment: null
};
const enr = (p)=>({
        id: 'e1',
        status: 'NOT_STARTED',
        lessonsDone: 0,
        progressPct: 0,
        dueAt: null,
        required: true,
        certificateId: null,
        certificateDownloadedAt: null,
        ...p
    });
const NOW = new Date('2026-09-29T04:10:00Z');
(0, _vitest.describe)('video progress', ()=>{
    (0, _vitest.it)('credits buckets only for real playback', ()=>{
        (0, _vitest.expect)((0, _lmsrules.bucketCount)(95)).toBe(10);
        (0, _vitest.expect)((0, _lmsrules.creditBuckets)([], 0, 15, 1, 100)).toEqual({
            buckets: [
                0,
                1
            ],
            credited: true
        });
        (0, _vitest.expect)((0, _lmsrules.creditBuckets)([
            0,
            1
        ], 15, 300, 1, 600).credited).toBe(false); // a seek
        (0, _vitest.expect)((0, _lmsrules.creditBuckets)([], 0, 30, 1.5, 600).credited).toBe(true); // 1.5× playback
        (0, _vitest.expect)((0, _lmsrules.creditBuckets)([], 0, 40, 1, 600).credited).toBe(false);
    });
    (0, _vitest.it)('merges parallel tabs as a set union', ()=>{
        (0, _vitest.expect)((0, _lmsrules.creditBuckets)([
            0,
            1,
            5
        ], 20, 30, 1, 100).buckets).toEqual([
            0,
            1,
            2,
            5
        ]);
    });
    (0, _vitest.it)('completes a video at 90 % of its buckets', ()=>{
        (0, _vitest.expect)((0, _lmsrules.isVideoComplete)([
            0,
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8
        ], 100)).toBe(true);
        (0, _vitest.expect)((0, _lmsrules.isVideoComplete)([
            0,
            1,
            2,
            3,
            4,
            5,
            6,
            7
        ], 100)).toBe(false);
    });
    (0, _vitest.it)('counts completed lessons as 1 and partial videos by share (max 0.9)', ()=>{
        (0, _vitest.expect)((0, _lmsrules.lessonFraction)({
            type: 'VIDEO',
            durationSec: 100
        }, {
            completedAt: new Date(),
            watchedBuckets: []
        })).toBe(1);
        (0, _vitest.expect)((0, _lmsrules.lessonFraction)({
            type: 'VIDEO',
            durationSec: 100
        }, {
            completedAt: null,
            watchedBuckets: [
                0,
                1,
                2,
                3,
                4
            ]
        })).toBe(0.5);
        (0, _vitest.expect)((0, _lmsrules.lessonFraction)({
            type: 'DOCUMENT',
            durationSec: 0
        }, {
            completedAt: null,
            watchedBuckets: []
        })).toBe(0);
        (0, _vitest.expect)((0, _lmsrules.courseProgressPct)([
            1,
            1,
            1,
            0.5,
            0
        ])).toBe(70);
        (0, _vitest.expect)((0, _lmsrules.courseProgressPct)([])).toBe(0);
    });
});
(0, _vitest.describe)('due dates', ()=>{
    (0, _vitest.it)('ends at 23:59:59 IST, N days later', ()=>{
        (0, _vitest.expect)((0, _lmsrules.dueAtFor)(new Date('2026-09-28T04:30:00Z'), 14).toISOString()).toBe('2026-10-12T18:29:59.000Z');
    });
    (0, _vitest.it)('labels and flags overdue', ()=>{
        const due = new Date('2026-10-12T18:29:59Z');
        (0, _vitest.expect)((0, _lmsrules.dueInfo)(due, false, NOW)).toEqual({
            label: 'Due 12 Oct',
            overdue: false
        });
        (0, _vitest.expect)((0, _lmsrules.dueInfo)(new Date('2026-09-28T18:29:59Z'), false, NOW).overdue).toBe(true);
        (0, _vitest.expect)((0, _lmsrules.dueInfo)(new Date('2026-09-28T18:29:59Z'), true, NOW).overdue).toBe(false);
    });
});
(0, _vitest.describe)('course tiles (wireframe states)', ()=>{
    (0, _vitest.it)('in progress: "3 of 5 lessons done" → Continue', ()=>{
        const t = (0, _lmsrules.courseTile)({
            ...base,
            enrollment: enr({
                status: 'IN_PROGRESS',
                lessonsDone: 3,
                progressPct: 60,
                dueAt: new Date('2026-10-12T18:29:59Z')
            })
        }, NOW);
        (0, _vitest.expect)(t.kicker).toBe('Required · 40 min');
        (0, _vitest.expect)(t.statusLine).toBe('3 of 5 lessons done');
        (0, _vitest.expect)(t.cta).toBe('Continue');
        (0, _vitest.expect)(t.dueLabel).toBe('Due 12 Oct');
    });
    (0, _vitest.it)('completed with an undownloaded certificate → "Completed · certificate ready"', ()=>{
        const t = (0, _lmsrules.courseTile)({
            ...base,
            title: 'Git workflow at Lexisora',
            category: 'ONBOARDING',
            totalDurationSec: 25 * 60,
            enrollment: enr({
                status: 'COMPLETED',
                lessonsDone: 3,
                progressPct: 100,
                certificateId: 'cert'
            })
        }, NOW);
        (0, _vitest.expect)(t.kicker).toBe('Onboarding · 25 min');
        (0, _vitest.expect)(t.statusLine).toBe('Completed · certificate ready');
        (0, _vitest.expect)(t.cta).toBe('Download certificate');
    });
    (0, _vitest.it)('completed and downloaded → "Completed" with Download certificate', ()=>{
        const t = (0, _lmsrules.courseTile)({
            ...base,
            enrollment: enr({
                status: 'COMPLETED',
                certificateId: 'cert',
                certificateDownloadedAt: new Date()
            })
        }, NOW);
        (0, _vitest.expect)(t.statusLine).toBe('Completed');
        (0, _vitest.expect)(t.cta).toBe('Download certificate');
    });
    (0, _vitest.it)('not started → Start; optional 70 min → "Optional · 1h 10m"', ()=>{
        const t = (0, _lmsrules.courseTile)({
            ...base,
            category: 'OPTIONAL',
            totalDurationSec: 70 * 60,
            enrollment: enr({})
        }, NOW);
        (0, _vitest.expect)(t.kicker).toBe('Optional · 1h 10m');
        (0, _vitest.expect)(t.statusLine).toBe('Not started');
        (0, _vitest.expect)(t.cta).toBe('Start');
    });
    (0, _vitest.it)('catalogue course without enrollment → Enroll; overdue enrollment flagged', ()=>{
        (0, _vitest.expect)((0, _lmsrules.courseTile)(base, NOW).cta).toBe('Enroll');
        const t = (0, _lmsrules.courseTile)({
            ...base,
            enrollment: enr({
                status: 'IN_PROGRESS',
                lessonsDone: 1,
                dueAt: new Date('2026-09-20T18:29:59Z')
            })
        }, NOW);
        (0, _vitest.expect)(t.status).toBe('OVERDUE');
        (0, _vitest.expect)(t.overdue).toBe(true);
    });
    (0, _vitest.it)('assignment labels', ()=>{
        (0, _vitest.expect)((0, _lmsrules.assignmentLabel)({
            audienceType: 'ALL',
            label: null
        })).toBe('All employees');
        (0, _vitest.expect)((0, _lmsrules.assignmentLabel)({
            audienceType: 'NEW_JOINERS',
            label: null
        })).toBe('New joiners');
        (0, _vitest.expect)((0, _lmsrules.assignmentLabel)({
            audienceType: 'DEPARTMENT',
            label: 'All developers'
        })).toBe('All developers');
    });
});

//# sourceMappingURL=lms.spec.js.map