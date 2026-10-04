"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _payrolldays = require("./payroll-days");
const _dates = require("../common/dates");
// September 2026: 22 weekdays; Janmashtami (Fri 4 Sep) is a holiday → 21 working days.
const HOLIDAYS = {
    '2026-09-04': 'Janmashtami'
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
function input(over = {}) {
    return {
        period: '2026-09',
        lockDate: '2026-09-30',
        joinDate: '2024-01-12',
        exitDate: null,
        calendar: cal,
        leave: new Map(),
        attendance: new Map(),
        ...over
    };
}
const att = (rows)=>new Map(Object.entries(rows).map(([d, a])=>[
            d,
            {
                status: 'PRESENT',
                presentFraction: 1,
                idleDeductibleMinutes: 0,
                ...a
            }
        ]));
const lv = (rows)=>new Map(Object.entries(rows));
(0, _vitest.describe)('payroll day classification', ()=>{
    (0, _vitest.it)('counts working days net of weekly offs and holidays', ()=>{
        const r = (0, _payrolldays.classifyDays)(input());
        (0, _vitest.expect)(r).toMatchObject({
            workingDays: 21,
            eligibleDays: 21,
            holidays: 1,
            weeklyOffs: 8,
            absentDays: 0,
            paidLeaveDays: 0
        });
    });
    (0, _vitest.it)('paid leave keeps the day paid; an ABSENT day is LOP', ()=>{
        const r = (0, _payrolldays.classifyDays)(input({
            leave: lv({
                '2026-09-18': [
                    {
                        units: 1,
                        isPaid: true,
                        code: 'SL'
                    }
                ]
            }),
            attendance: att({
                '2026-09-18': {
                    status: 'LEAVE'
                },
                '2026-09-22': {
                    status: 'ABSENT',
                    presentFraction: 0
                }
            })
        }));
        (0, _vitest.expect)(r.paidLeaveDays).toBe(1);
        (0, _vitest.expect)(r.absentDays).toBe(1);
        (0, _vitest.expect)(r.leaveSummary).toEqual([
            {
                code: 'SL',
                days: 1
            }
        ]);
    });
    (0, _vitest.it)('a half day without leave is 0.5 LOP; a half-day leave covers the other half', ()=>{
        const half = (0, _payrolldays.classifyDays)(input({
            attendance: att({
                '2026-09-08': {
                    status: 'HALF_DAY',
                    presentFraction: 0.5
                }
            })
        }));
        (0, _vitest.expect)(half.absentDays).toBe(0.5);
        const covered = (0, _payrolldays.classifyDays)(input({
            leave: lv({
                '2026-09-08': [
                    {
                        units: 0.5,
                        isPaid: true,
                        code: 'CL'
                    }
                ]
            }),
            attendance: att({
                '2026-09-08': {
                    status: 'HALF_DAY_LEAVE',
                    presentFraction: 0.5
                }
            })
        }));
        (0, _vitest.expect)(covered.absentDays).toBe(0);
        (0, _vitest.expect)(covered.paidLeaveDays).toBe(0.5);
    });
    (0, _vitest.it)('unpaid leave (LWP) is counted separately from absence', ()=>{
        const r = (0, _payrolldays.classifyDays)(input({
            leave: lv({
                '2026-09-09': [
                    {
                        units: 1,
                        isPaid: false,
                        code: 'LWP'
                    }
                ]
            })
        }));
        (0, _vitest.expect)(r.unpaidLeaveDays).toBe(1);
        (0, _vitest.expect)(r.absentDays).toBe(0);
    });
    (0, _vitest.it)('days after the attendance lock are projected, never LOP', ()=>{
        const r = (0, _payrolldays.classifyDays)(input({
            lockDate: '2026-09-25',
            attendance: att({
                '2026-09-29': {
                    status: 'ABSENT',
                    presentFraction: 0
                }
            })
        }));
        (0, _vitest.expect)(r.projectedDays).toBe(3); // 28, 29, 30 Sep
        (0, _vitest.expect)(r.absentDays).toBe(0);
    });
    (0, _vitest.it)('mid-month joiner is eligible only from the joining date', ()=>{
        const r = (0, _payrolldays.classifyDays)(input({
            joinDate: '2026-09-15'
        }));
        (0, _vitest.expect)(r.workingDays).toBe(21);
        (0, _vitest.expect)(r.eligibleDays).toBe(12);
    });
    (0, _vitest.it)('idle on an LOP day is dropped (no double penalty)', ()=>{
        const r = (0, _payrolldays.classifyDays)(input({
            attendance: att({
                '2026-09-07': {
                    idleDeductibleMinutes: 25
                },
                '2026-09-08': {
                    status: 'ABSENT',
                    presentFraction: 0,
                    idleDeductibleMinutes: 30
                }
            })
        }));
        (0, _vitest.expect)(r.idleMinutes).toBe(25);
    });
    (0, _vitest.it)('falls back to tracker idle when there are no attendance rows', ()=>{
        (0, _vitest.expect)((0, _payrolldays.classifyDays)(input({
            fallbackIdleMinutes: 130
        })).idleMinutes).toBe(130);
    });
});
(0, _vitest.describe)('timesheet gate', ()=>{
    (0, _vitest.it)('interns are not required to submit weekly timesheets', ()=>{
        (0, _vitest.expect)((0, _payrolldays.timesheetGate)({
            required: false,
            statuses: [
                'DRAFT'
            ]
        })).toBe('NOT_REQUIRED');
    });
    (0, _vitest.it)('approved (or locked) sheets for every overlapping week pass the gate', ()=>{
        (0, _vitest.expect)((0, _payrolldays.timesheetGate)({
            required: true,
            statuses: [
                'APPROVED',
                'LOCKED'
            ]
        })).toBe('APPROVED');
    });
    (0, _vitest.it)('weeks without a timesheet row do not block', ()=>{
        (0, _vitest.expect)((0, _payrolldays.timesheetGate)({
            required: true,
            statuses: []
        })).toBe('APPROVED');
    });
    (0, _vitest.it)('the least advanced pending week decides the gate', ()=>{
        (0, _vitest.expect)((0, _payrolldays.timesheetGate)({
            required: true,
            statuses: [
                'APPROVED',
                'PENDING_RM'
            ]
        })).toBe('PENDING_RM');
        (0, _vitest.expect)((0, _payrolldays.timesheetGate)({
            required: true,
            statuses: [
                'PENDING_RM',
                'SUBMITTED'
            ]
        })).toBe('PENDING_PL');
        (0, _vitest.expect)((0, _payrolldays.timesheetGate)({
            required: true,
            statuses: [
                'RETURNED',
                'SUBMITTED'
            ]
        })).toBe('SENT_BACK');
        (0, _vitest.expect)((0, _payrolldays.timesheetGate)({
            required: true,
            statuses: [
                'APPROVED',
                'DRAFT'
            ]
        })).toBe('NOT_SUBMITTED');
    });
    (0, _vitest.it)('only APPROVED and NOT_REQUIRED let an item be READY', ()=>{
        (0, _vitest.expect)(_payrolldays.GATE_OK).toEqual([
            'APPROVED',
            'NOT_REQUIRED'
        ]);
    });
});

//# sourceMappingURL=payroll-days.spec.js.map