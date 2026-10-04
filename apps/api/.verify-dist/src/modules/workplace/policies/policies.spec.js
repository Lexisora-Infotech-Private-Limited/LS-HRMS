"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const _policiesrules = require("./policies.rules");
const ist = (s)=>new Date(`${s}:00+05:30`);
const fmt = (d)=>new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(d);
(0, _vitest.describe)('policy acknowledgements', ()=>{
    (0, _vitest.it)('is due ackDueDays after max(effective date, today), end of the business day', ()=>{
        (0, _vitest.expect)(fmt((0, _policiesrules.ackDueAt)('2026-07-15', ist('2026-09-29T10:00'), 7))).toBe('2026-10-06 18:30');
        (0, _vitest.expect)(fmt((0, _policiesrules.ackDueAt)('2026-10-05', ist('2026-09-29T10:00'), 7))).toBe('2026-10-12 18:30');
        (0, _vitest.expect)(fmt((0, _policiesrules.ackDueAt)(null, ist('2026-09-29T23:30'), 3))).toBe('2026-10-02 18:30');
    });
    (0, _vitest.it)('flags unacknowledged requirements past their due time as overdue', ()=>{
        const due = ist('2026-09-29T18:30');
        (0, _vitest.expect)((0, _policiesrules.isOverdue)({
            dueAt: due,
            acknowledgedAt: null
        }, ist('2026-09-29T18:00'))).toBe(false);
        (0, _vitest.expect)((0, _policiesrules.isOverdue)({
            dueAt: due,
            acknowledgedAt: null
        }, ist('2026-09-29T19:00'))).toBe(true);
        (0, _vitest.expect)((0, _policiesrules.isOverdue)({
            dueAt: due,
            acknowledgedAt: ist('2026-09-30T10:00')
        }, ist('2026-10-01T10:00'))).toBe(false);
    });
    (0, _vitest.it)('reminds on day 3, on the due day and every 3 days after, at most once a day', ()=>{
        const a = {
            startKey: '2026-09-22',
            dueAt: ist('2026-09-29T18:30'),
            acknowledgedAt: null,
            lastRemindedAt: null
        };
        (0, _vitest.expect)((0, _policiesrules.reminderDue)(a, ist('2026-09-24T10:00'))).toBe(false);
        (0, _vitest.expect)((0, _policiesrules.reminderDue)(a, ist('2026-09-25T10:00'))).toBe(true); // day 3
        (0, _vitest.expect)((0, _policiesrules.reminderDue)(a, ist('2026-09-27T10:00'))).toBe(false);
        (0, _vitest.expect)((0, _policiesrules.reminderDue)(a, ist('2026-09-29T10:00'))).toBe(true); // due day
        (0, _vitest.expect)((0, _policiesrules.reminderDue)(a, ist('2026-09-30T10:00'))).toBe(false);
        (0, _vitest.expect)((0, _policiesrules.reminderDue)(a, ist('2026-10-02T10:00'))).toBe(true); // due + 3
        (0, _vitest.expect)((0, _policiesrules.reminderDue)(a, ist('2026-10-05T10:00'))).toBe(true); // due + 6
        (0, _vitest.expect)((0, _policiesrules.reminderDue)({
            ...a,
            lastRemindedAt: ist('2026-09-29T09:00')
        }, ist('2026-09-29T10:00'))).toBe(false); // throttled
        (0, _vitest.expect)((0, _policiesrules.reminderDue)({
            ...a,
            acknowledgedAt: ist('2026-09-28T10:00')
        }, ist('2026-09-29T10:00'))).toBe(false);
    });
    (0, _vitest.it)('counts compliance', ()=>{
        const now = ist('2026-09-30T10:00');
        const c = (0, _policiesrules.complianceCounts)([
            {
                employeeId: 'a',
                dueAt: ist('2026-09-29T18:30'),
                acknowledgedAt: ist('2026-09-20T10:00')
            },
            {
                employeeId: 'b',
                dueAt: ist('2026-09-29T18:30'),
                acknowledgedAt: null
            },
            {
                employeeId: 'c',
                dueAt: ist('2026-10-06T18:30'),
                acknowledgedAt: null
            }
        ], now);
        (0, _vitest.expect)(c).toEqual({
            required: 3,
            acknowledged: 1,
            pending: 2,
            overdue: 1,
            pct: 33
        });
        (0, _vitest.expect)((0, _policiesrules.complianceCounts)([], now).pct).toBe(100);
    });
    (0, _vitest.it)('carries acknowledgements to a new version only when re-acknowledgement is not required', ()=>{
        const dueAt = ist('2026-10-06T18:30');
        const previous = [
            {
                employeeId: 'a',
                dueAt: ist('2026-07-22T18:30'),
                acknowledgedAt: ist('2026-07-16T10:00')
            },
            {
                employeeId: 'b',
                dueAt: ist('2026-07-22T18:30'),
                acknowledgedAt: null
            }
        ];
        const keep = (0, _policiesrules.requirementsForVersion)({
            audience: [
                'a',
                'b',
                'c'
            ],
            previous,
            requiresReack: false,
            isFirst: false,
            dueAt
        });
        (0, _vitest.expect)(keep.map((r)=>[
                r.employeeId,
                !!r.acknowledgedAt,
                r.carried
            ])).toEqual([
            [
                'a',
                true,
                true
            ],
            [
                'b',
                false,
                true
            ],
            [
                'c',
                false,
                false
            ]
        ]);
        const reset = (0, _policiesrules.requirementsForVersion)({
            audience: [
                'a',
                'b'
            ],
            previous,
            requiresReack: true,
            isFirst: false,
            dueAt
        });
        (0, _vitest.expect)(reset.every((r)=>!r.acknowledgedAt && r.dueAt === dueAt)).toBe(true);
    });
    (0, _vitest.it)('formats alert titles and reader gating', ()=>{
        (0, _vitest.expect)((0, _policiesrules.lowerTitle)('Leave & attendance policy')).toBe('leave & attendance policy');
        (0, _vitest.expect)((0, _policiesrules.lowerTitle)('IT & data security policy')).toBe('IT & data security policy');
        (0, _vitest.expect)((0, _policiesrules.lowerTitle)('POSH policy')).toBe('POSH policy');
        (0, _vitest.expect)((0, _shared.minReadSecondsFor)(null)).toBe(10);
        (0, _vitest.expect)((0, _shared.minReadSecondsFor)(2)).toBe(10);
        (0, _vitest.expect)((0, _shared.minReadSecondsFor)(12)).toBe(36);
    });
    (0, _vitest.it)('counts pages in a PDF', ()=>{
        const pdf = Buffer.from('%PDF-1.3\n1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] >>\n2 0 obj << /Type /Page >>\n3 0 obj << /Type /Page >>\n%%EOF', 'latin1');
        (0, _vitest.expect)((0, _policiesrules.pdfPageCount)(pdf)).toBe(2);
        (0, _vitest.expect)((0, _policiesrules.pdfPageCount)(Buffer.from('not a pdf'))).toBeNull();
    });
});

//# sourceMappingURL=policies.spec.js.map