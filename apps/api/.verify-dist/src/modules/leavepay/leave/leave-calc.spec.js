"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _leavecalc = require("./leave-calc");
const _dates = require("../common/dates");
const HOLIDAYS = {
    '2026-10-20': 'Dussehra',
    '2026-11-08': 'Diwali',
    '2026-11-09': 'Diwali'
};
const cal = (date)=>{
    if (HOLIDAYS[date]) return {
        date,
        kind: 'HOLIDAY',
        holidayName: HOLIDAYS[date]
    };
    const d = (0, _dates.dow)(date);
    return {
        date,
        kind: d === 0 || d === 6 ? 'WEEKLY_OFF' : 'WORKING'
    };
};
const base = {
    calendar: cal,
    sandwichWeeklyOffs: false,
    sandwichHolidays: false
};
(0, _vitest.describe)('leave day counting', ()=>{
    (0, _vitest.it)('EL Wed 14 – Fri 16 Oct 2026 = 3 days', ()=>{
        (0, _vitest.expect)((0, _leavecalc.expandLeaveDays)({
            ...base,
            from: '2026-10-14',
            to: '2026-10-16'
        }).totalDays).toBe(3);
    });
    (0, _vitest.it)('holidays are excluded: EL 19–21 Oct with Dussehra on 20 Oct = 2 days', ()=>{
        const r = (0, _leavecalc.expandLeaveDays)({
            ...base,
            sandwichWeeklyOffs: true,
            from: '2026-10-19',
            to: '2026-10-21'
        });
        (0, _vitest.expect)(r.totalDays).toBe(2);
        (0, _vitest.expect)(r.excluded).toEqual([
            {
                date: '2026-10-20',
                kind: 'HOLIDAY',
                holidayName: 'Dussehra'
            }
        ]);
    });
    (0, _vitest.it)('weekly offs are excluded without the sandwich rule: Fri 9 – Mon 12 Oct = 2', ()=>{
        (0, _vitest.expect)((0, _leavecalc.expandLeaveDays)({
            ...base,
            from: '2026-10-09',
            to: '2026-10-12'
        }).totalDays).toBe(2);
    });
    (0, _vitest.it)('sandwich rule counts the weekend: Fri 9 – Mon 12 Oct = 4', ()=>{
        const r = (0, _leavecalc.expandLeaveDays)({
            ...base,
            sandwichWeeklyOffs: true,
            from: '2026-10-09',
            to: '2026-10-12'
        });
        (0, _vitest.expect)(r.totalDays).toBe(4);
        (0, _vitest.expect)(r.sandwichDays).toBe(2);
    });
    (0, _vitest.it)('sandwich with an earlier approved Friday: a new Monday request = 3 (weekend charged here)', ()=>{
        const existing = (d)=>d === '2026-10-09' ? 'FULL' : null;
        const r = (0, _leavecalc.expandLeaveDays)({
            ...base,
            sandwichWeeklyOffs: true,
            from: '2026-10-12',
            to: '2026-10-12',
            existingCoverage: existing
        });
        (0, _vitest.expect)(r.totalDays).toBe(3);
        (0, _vitest.expect)(r.days.filter((d)=>d.isSandwich).map((d)=>d.date)).toEqual([
            '2026-10-10',
            '2026-10-11'
        ]);
    });
    (0, _vitest.it)('no sandwich when the Friday is only a first half', ()=>{
        const r = (0, _leavecalc.expandLeaveDays)({
            ...base,
            sandwichWeeklyOffs: true,
            from: '2026-10-09',
            to: '2026-10-12',
            fromSession: 'SECOND_HALF'
        });
        (0, _vitest.expect)(r.totalDays).toBe(4 - 0.5);
        const r2 = (0, _leavecalc.expandLeaveDays)({
            ...base,
            sandwichWeeklyOffs: true,
            from: '2026-10-09',
            to: '2026-10-09',
            halfDay: 'FIRST_HALF'
        });
        (0, _vitest.expect)(r2.totalDays).toBe(0.5);
    });
    (0, _vitest.it)('leading or trailing weekends are never counted', ()=>{
        (0, _vitest.expect)((0, _leavecalc.expandLeaveDays)({
            ...base,
            sandwichWeeklyOffs: true,
            from: '2026-10-10',
            to: '2026-10-13'
        }).totalDays).toBe(2);
        (0, _vitest.expect)((0, _leavecalc.expandLeaveDays)({
            ...base,
            sandwichWeeklyOffs: true,
            from: '2026-10-08',
            to: '2026-10-11'
        }).totalDays).toBe(2);
    });
    (0, _vitest.it)('holiday sandwiching follows sandwichHolidays only', ()=>{
        // Diwali Sun 8 + Mon 9 Nov, with Sat 7: Fri 6 – Tue 10 → block Sat–Mon.
        const off = (0, _leavecalc.expandLeaveDays)({
            ...base,
            sandwichWeeklyOffs: true,
            sandwichHolidays: false,
            from: '2026-11-06',
            to: '2026-11-10'
        });
        (0, _vitest.expect)(off.totalDays).toBe(2 + 1); // Fri, Tue + Sat (weekly off); Sun is a holiday (not sandwiched)
        const on = (0, _leavecalc.expandLeaveDays)({
            ...base,
            sandwichWeeklyOffs: true,
            sandwichHolidays: true,
            from: '2026-11-06',
            to: '2026-11-10'
        });
        (0, _vitest.expect)(on.totalDays).toBe(5);
    });
    (0, _vitest.it)('half day units: CL 7 Oct first half = 0.5', ()=>{
        (0, _vitest.expect)((0, _leavecalc.expandLeaveDays)({
            ...base,
            from: '2026-10-07',
            to: '2026-10-07',
            halfDay: 'FIRST_HALF'
        }).totalDays).toBe(0.5);
    });
    (0, _vitest.it)('multi-day with start from second half and end at first half', ()=>{
        const r = (0, _leavecalc.expandLeaveDays)({
            ...base,
            from: '2026-10-05',
            to: '2026-10-07',
            fromSession: 'SECOND_HALF',
            toSession: 'FIRST_HALF'
        });
        (0, _vitest.expect)(r.totalDays).toBe(2);
        (0, _vitest.expect)(r.days.map((d)=>d.session)).toEqual([
            'SECOND_HALF',
            'FULL',
            'FIRST_HALF'
        ]);
    });
    (0, _vitest.it)('rejects ranges without working days and half days on non-working days', ()=>{
        (0, _vitest.expect)((0, _leavecalc.expandLeaveDays)({
            ...base,
            from: '2026-10-10',
            to: '2026-10-11'
        }).error).toBe('No working days in range');
        (0, _vitest.expect)((0, _leavecalc.expandLeaveDays)({
            ...base,
            from: '2026-10-20',
            to: '2026-10-20',
            halfDay: 'FIRST_HALF'
        }).error).toBe('A half day must be on a working day');
        (0, _vitest.expect)((0, _leavecalc.expandLeaveDays)({
            ...base,
            from: '2026-10-12',
            to: '2026-10-09'
        }).error).toMatch(/on or before/);
    });
    (0, _vitest.it)('complementary halves do not conflict; same halves do', ()=>{
        (0, _vitest.expect)((0, _leavecalc.sessionsConflict)('FIRST_HALF', 'SECOND_HALF')).toBe(false);
        (0, _vitest.expect)((0, _leavecalc.sessionsConflict)('FIRST_HALF', 'FIRST_HALF')).toBe(true);
        (0, _vitest.expect)((0, _leavecalc.sessionsConflict)('FULL', 'SECOND_HALF')).toBe(true);
    });
});
(0, _vitest.describe)('balance checks', ()=>{
    (0, _vitest.it)('fully paid within balance', ()=>{
        (0, _vitest.expect)((0, _leavecalc.splitPaid)(3, 14, {
            isPaidType: true
        })).toEqual({
            paid: 3,
            lop: 0,
            blocked: false
        });
    });
    (0, _vitest.it)('REJECT blocks a request beyond balance', ()=>{
        (0, _vitest.expect)((0, _leavecalc.splitPaid)(5, 4, {
            isPaidType: true,
            excessAction: 'REJECT'
        }).blocked).toBe(true);
    });
    (0, _vitest.it)('CONVERT_TO_LOP splits paid 4 + LOP 1', ()=>{
        (0, _vitest.expect)((0, _leavecalc.splitPaid)(5, 4, {
            isPaidType: true,
            excessAction: 'CONVERT_TO_LOP'
        })).toEqual({
            paid: 4,
            lop: 1,
            blocked: false
        });
    });
    (0, _vitest.it)('negative balance within the limit is allowed', ()=>{
        (0, _vitest.expect)((0, _leavecalc.splitPaid)(5, 4, {
            isPaidType: true,
            allowNegative: true,
            negativeLimit: 2
        }).blocked).toBe(false);
    });
    (0, _vitest.it)('LWP is always unpaid', ()=>{
        (0, _vitest.expect)((0, _leavecalc.splitPaid)(2, 0, {
            isPaidType: false
        })).toEqual({
            paid: 0,
            lop: 2,
            blocked: false
        });
    });
    (0, _vitest.it)('available = opening + accrued + credited − availed − lapsed − encashed − pending', ()=>{
        (0, _vitest.expect)((0, _leavecalc.availableOf)({
            opening: 0.5,
            accrued: 13.5,
            credited: 0,
            availed: 0,
            pending: 3,
            lapsed: 0,
            encashed: 0
        })).toBe(11);
    });
});
(0, _vitest.describe)('accrual and pro-ration', ()=>{
    (0, _vitest.it)('joining 10 Sep 2026 → CL round_half(12 × 4/12) = 4; joining 20 Sep → 3', ()=>{
        (0, _vitest.expect)((0, _leavecalc.prorateYearly)(12, '2026-09-10', 2026)).toBe(4);
        (0, _vitest.expect)((0, _leavecalc.prorateYearly)(12, '2026-09-20', 2026)).toBe(3);
        (0, _vitest.expect)((0, _leavecalc.prorateYearly)(12, '2024-01-12', 2026)).toBe(12);
        (0, _vitest.expect)((0, _leavecalc.prorateYearly)(8, '2026-09-15', 2026)).toBe(2.5); // 8 × 4/12 = 2.67 → nearest 0.5
    });
    (0, _vitest.it)('EL monthly 1.5: full year = 18; a 20 Sep joiner accrues from October', ()=>{
        (0, _vitest.expect)((0, _leavecalc.scheduledAnnual)('MONTHLY', 1.5, 18, '2024-01-12', 2026)).toBe(18);
        (0, _vitest.expect)((0, _leavecalc.monthlyCreditMonths)('2026-09-20', 2026)).toEqual([
            10,
            11,
            12
        ]);
        (0, _vitest.expect)((0, _leavecalc.monthlyCreditMonths)('2026-09-15', 2026)).toEqual([
            9,
            10,
            11,
            12
        ]);
        (0, _vitest.expect)((0, _leavecalc.scheduledAnnual)('MONTHLY', 1.5, 18, '2026-09-20', 2026)).toBe(4.5);
    });
    (0, _vitest.it)('comp-off consumes FIFO by expiry and never after expiry', ()=>{
        const grants = [
            {
                id: 'late',
                remaining: 1,
                expiresOn: '2026-12-02'
            },
            {
                id: 'early',
                remaining: 1,
                expiresOn: '2026-11-10'
            }
        ];
        (0, _vitest.expect)((0, _leavecalc.consumeCompOff)(grants, 1.5, '2026-11-05')).toEqual({
            consumed: [
                {
                    grantId: 'early',
                    units: 1
                },
                {
                    grantId: 'late',
                    units: 0.5
                }
            ],
            shortfall: 0
        });
        (0, _vitest.expect)((0, _leavecalc.consumeCompOff)(grants, 1, '2026-11-20')).toEqual({
            consumed: [
                {
                    grantId: 'late',
                    units: 1
                }
            ],
            shortfall: 0
        });
    });
});
(0, _vitest.describe)('year-end', ()=>{
    (0, _vitest.it)('EL closing 34 with cap 30 → carry 30, lapse 4', ()=>{
        (0, _vitest.expect)((0, _leavecalc.yearEndSplit)(34, 30)).toEqual({
            carry: 30,
            encash: 0,
            lapse: 4
        });
    });
    (0, _vitest.it)('CL closing 5 with no carry forward → lapse 5', ()=>{
        (0, _vitest.expect)((0, _leavecalc.yearEndSplit)(5, null)).toEqual({
            carry: 0,
            encash: 0,
            lapse: 5
        });
    });
    (0, _vitest.it)('encash the excess when enabled', ()=>{
        (0, _vitest.expect)((0, _leavecalc.yearEndSplit)(34, 30, true, true)).toEqual({
            carry: 30,
            encash: 4,
            lapse: 0
        });
    });
    (0, _vitest.it)('payroll leave label', ()=>{
        (0, _vitest.expect)((0, _leavecalc.leaveSummaryLabel)([
            {
                code: 'CL',
                days: 0.5
            },
            {
                code: 'LWP',
                days: 1
            }
        ])).toBe('0.5 CL · 1 LWP');
        (0, _vitest.expect)((0, _leavecalc.leaveSummaryLabel)([])).toBe('0');
    });
});

//# sourceMappingURL=leave-calc.spec.js.map