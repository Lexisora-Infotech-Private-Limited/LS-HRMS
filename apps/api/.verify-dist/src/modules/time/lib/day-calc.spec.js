"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _daycalc = require("./day-calc");
const _timeutils = require("./time-utils");
const GENERAL = {
    name: 'General',
    startMinute: 9 * 60 + 30,
    endMinute: 18 * 60 + 30,
    graceMinutes: 15,
    breakMinutes: 60,
    weeklyOffDays: [
        6,
        0
    ],
    minFullDayMinutes: 450,
    minHalfDayMinutes: 240,
    halfDayIfLateByMinutes: 120,
    earlyOutGraceMinutes: 15
};
const POLICY = {
    deductIdleFromPayroll: true,
    idleDeductionMode: 'SHORTFALL_ONLY',
    earlyOutCountsAsLate: false
};
const at = (d, hm)=>{
    const [h, m] = hm.split(':').map(Number);
    return (0, _timeutils.istInstant)(d, h * 60 + m);
};
function day(date, sessions, extra = {}) {
    return (0, _daycalc.computeDay)({
        date,
        today: '2026-09-29',
        now: at('2026-09-29', '11:00'),
        shift: GENERAL,
        holidayName: null,
        leave: null,
        tracker: null,
        policy: POLICY,
        sessions: sessions.map(([a, b, src])=>({
                startedAt: at(date, a),
                endedAt: b ? at(date, b) : null,
                source: src ?? 'WEB'
            })),
        ...extra
    });
}
(0, _vitest.describe)('lateMark', ()=>{
    (0, _vitest.it)('is on time within the grace window', ()=>{
        (0, _vitest.expect)((0, _daycalc.lateMark)(at('2026-09-24', '09:45'), at('2026-09-24', '09:30'), 15)).toEqual({
            isLate: false,
            lateByMinutes: 0
        });
    });
    (0, _vitest.it)('marks late after the grace window and reports minutes from shift start', ()=>{
        (0, _vitest.expect)((0, _daycalc.lateMark)(at('2026-09-24', '09:52'), at('2026-09-24', '09:30'), 15)).toEqual({
            isLate: true,
            lateByMinutes: 22
        });
    });
});
(0, _vitest.describe)('computeDay', ()=>{
    (0, _vitest.it)('present day: first in / last out, break from the gap between sessions', ()=>{
        const r = day('2026-09-28', [
            [
                '09:28',
                '13:15',
                'DESKTOP'
            ],
            [
                '14:10',
                '18:42',
                'DESKTOP'
            ]
        ]);
        (0, _vitest.expect)(r.status).toBe('PRESENT');
        (0, _vitest.expect)(r.isLate).toBe(false);
        (0, _vitest.expect)(r.breakMinutes).toBe(55);
        (0, _vitest.expect)(r.workedMinutes).toBe(554 - 55);
        (0, _vitest.expect)(r.presentFraction).toBe(1);
        (0, _vitest.expect)(r.primarySource).toBe('DESKTOP');
    });
    (0, _vitest.it)('late mark (wireframe Thu 24 Sep 09:52)', ()=>{
        const r = day('2026-09-24', [
            [
                '09:52',
                '13:30'
            ],
            [
                '14:20',
                '18:40'
            ]
        ]);
        (0, _vitest.expect)(r.status).toBe('PRESENT');
        (0, _vitest.expect)(r.isLate).toBe(true);
        (0, _vitest.expect)(r.lateByMinutes).toBe(22);
    });
    (0, _vitest.it)('very late arrival caps the day at half day', ()=>{
        const r = day('2026-09-24', [
            [
                '11:45',
                '20:30'
            ]
        ]);
        (0, _vitest.expect)(r.isLate).toBe(true);
        (0, _vitest.expect)(r.status).toBe('HALF_DAY');
        (0, _vitest.expect)(r.presentFraction).toBe(0.5);
    });
    (0, _vitest.it)('short presence is a half day, very short is absent', ()=>{
        (0, _vitest.expect)(day('2026-09-23', [
            [
                '09:30',
                '14:00'
            ]
        ]).status).toBe('HALF_DAY');
        (0, _vitest.expect)(day('2026-09-23', [
            [
                '09:30',
                '11:00'
            ]
        ]).status).toBe('ABSENT');
    });
    (0, _vitest.it)('no punches on a past working day is absent', ()=>{
        (0, _vitest.expect)(day('2026-09-22', []).status).toBe('ABSENT');
    });
    (0, _vitest.it)('weekly off (Saturday) and weekly off worked', ()=>{
        (0, _vitest.expect)((0, _daycalc.isWeeklyOff)('2026-09-26', GENERAL)).toBe(true);
        (0, _vitest.expect)(day('2026-09-26', []).status).toBe('WEEKLY_OFF');
        (0, _vitest.expect)(day('2026-09-27', [
            [
                '10:00',
                '15:30'
            ]
        ]).status).toBe('WEEKLY_OFF_WORKED');
    });
    (0, _vitest.it)('holiday and holiday worked', ()=>{
        (0, _vitest.expect)(day('2026-09-04', [], {
            holidayName: 'Janmashtami'
        }).status).toBe('HOLIDAY');
        (0, _vitest.expect)(day('2026-09-04', [
            [
                '10:00',
                '15:00'
            ]
        ], {
            holidayName: 'Janmashtami'
        }).status).toBe('HOLIDAY_WORKED');
        (0, _vitest.expect)(day('2026-09-04', [
            [
                '10:00',
                '15:00'
            ]
        ], {
            holidayName: 'Janmashtami'
        }).isLate).toBe(false);
    });
    (0, _vitest.it)('approved full-day leave wins over missing punches', ()=>{
        const r = day('2026-09-18', [], {
            leave: {
                fraction: 1,
                typeCode: 'CL',
                paid: true
            }
        });
        (0, _vitest.expect)(r.status).toBe('LEAVE');
        (0, _vitest.expect)(r.leaveFraction).toBe(1);
        (0, _vitest.expect)(r.leaveTypeCode).toBe('CL');
    });
    (0, _vitest.it)('half-day leave + half day worked', ()=>{
        const r = day('2026-09-17', [
            [
                '14:00',
                '18:40'
            ]
        ], {
            leave: {
                fraction: 0.5,
                typeCode: 'EL',
                paid: true
            }
        });
        (0, _vitest.expect)(r.status).toBe('HALF_DAY_LEAVE');
        (0, _vitest.expect)(r.presentFraction).toBe(0.5);
        (0, _vitest.expect)(r.leaveFraction).toBe(0.5);
    });
    (0, _vitest.it)('an open session on a past day is a missed punch', ()=>{
        (0, _vitest.expect)(day('2026-09-21', [
            [
                '09:30',
                null
            ]
        ]).status).toBe('MISSED_PUNCH');
    });
    (0, _vitest.it)('today with an open session is pending', ()=>{
        const r = day('2026-09-29', [
            [
                '09:20',
                null
            ]
        ]);
        (0, _vitest.expect)(r.status).toBe('PENDING');
        (0, _vitest.expect)(r.workedMinutes).toBe(100);
    });
    (0, _vitest.it)('tracker summary: worked = sessions − breaks − deducted idle', ()=>{
        const r = day('2026-09-25', [
            [
                '09:35',
                '18:30',
                'DESKTOP'
            ]
        ], {
            tracker: {
                workedSec: 0,
                breakSec: 60 * 60,
                idleSec: 45 * 60,
                idleDeductedSec: 45 * 60
            }
        });
        (0, _vitest.expect)(r.breakMinutes).toBe(60);
        (0, _vitest.expect)(r.idleMinutes).toBe(45);
        (0, _vitest.expect)(r.workedMinutes).toBe(535 - 60 - 45);
    });
    (0, _vitest.it)('a single long session without a recorded break assumes the shift break', ()=>{
        const r = day('2026-09-23', [
            [
                '09:30',
                '18:35',
                'BIOMETRIC'
            ]
        ]);
        (0, _vitest.expect)(r.breakMinutes).toBe(60);
        (0, _vitest.expect)(r.workedMinutes).toBe(545 - 60);
    });
});
(0, _vitest.describe)('idle deduction and month summary', ()=>{
    (0, _vitest.it)('shortfall-only deducts idle only up to the shortfall', ()=>{
        (0, _vitest.expect)((0, _daycalc.idleDeductible)(30, 480, GENERAL, POLICY, 1)).toBe(0); // required = 9h shift − 60m break
        (0, _vitest.expect)((0, _daycalc.idleDeductible)(30, 460, GENERAL, POLICY, 1)).toBe(20);
        (0, _vitest.expect)((0, _daycalc.idleDeductible)(30, 400, GENERAL, {
            ...POLICY,
            idleDeductionMode: 'ALL_IDLE'
        }, 1)).toBe(30);
        (0, _vitest.expect)((0, _daycalc.idleDeductible)(30, 400, GENERAL, {
            ...POLICY,
            deductIdleFromPayroll: false
        }, 1)).toBe(0);
    });
    (0, _vitest.it)('late marks per penalty', ()=>{
        (0, _vitest.expect)((0, _daycalc.latePenaltyDays)(2, 3, 0.5)).toBe(0);
        (0, _vitest.expect)((0, _daycalc.latePenaltyDays)(3, 3, 0.5)).toBe(0.5);
        (0, _vitest.expect)((0, _daycalc.latePenaltyDays)(7, 3, 0.5)).toBe(1);
    });
    (0, _vitest.it)('summarizes present days, late marks, active and idle minutes', ()=>{
        const base = {
            leaveFraction: 0,
            lateExcused: false,
            idleDeductibleMinutes: 0
        };
        const s = (0, _daycalc.summarizeMonth)([
            {
                ...base,
                status: 'PRESENT',
                presentFraction: 1,
                isLate: false,
                workedMinutes: 480,
                idleMinutes: 20
            },
            {
                ...base,
                status: 'PRESENT',
                presentFraction: 1,
                isLate: true,
                workedMinutes: 468,
                idleMinutes: 10
            },
            {
                ...base,
                status: 'WEEKLY_OFF',
                presentFraction: 0,
                isLate: false,
                workedMinutes: 0,
                idleMinutes: 0
            }
        ]);
        (0, _vitest.expect)(s.presentDays).toBe(2);
        (0, _vitest.expect)(s.lateMarks).toBe(1);
        (0, _vitest.expect)(s.activeMinutes).toBe(948);
        (0, _vitest.expect)(s.idleMinutes).toBe(30);
    });
    (0, _vitest.it)('source label: single source or Mixed', ()=>{
        (0, _vitest.expect)((0, _daycalc.sourceLabel)(_daycalc.SOURCE_BITS.DESKTOP, 'DESKTOP')).toBe('Desktop');
        (0, _vitest.expect)((0, _daycalc.sourceLabel)(_daycalc.SOURCE_BITS.DESKTOP | _daycalc.SOURCE_BITS.WEB, 'WEB')).toBe('Mixed');
        (0, _vitest.expect)((0, _daycalc.sourceLabel)(0, null)).toBeNull();
    });
});

//# sourceMappingURL=day-calc.spec.js.map