"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _payrollcalc = require("./payroll-calc");
const _salary = require("./salary");
const P = (rupees)=>rupees * 100;
function input(over = {}) {
    const payType = over.stipend ? 'STIPEND' : 'SALARY';
    const s = (0, _salary.buildStructure)({
        grossMonthlyPaise: P(over.gross ?? 84_000)
    }, {
        payType
    });
    return {
        period: '2026-09',
        payType,
        structure: s.lines.filter((l)=>l.code !== 'PF_ER' && l.code !== 'ESI_ER'),
        grossFixedPaise: s.grossMonthlyPaise,
        days: {
            workingDays: 22,
            eligibleDays: 22,
            paidLeaveDays: 0,
            unpaidLeaveDays: 0,
            absentDays: 0,
            projectedDays: 0
        },
        idle: {
            apply: true,
            rawMinutes: 0,
            allowanceMinutes: 60,
            shiftNetMinutes: 480
        },
        profile: {
            pfEnabled: true,
            pfCeilingOpted: true,
            esiMode: 'AUTO',
            ptStateCode: 'GJ',
            taxRegime: 'NEW'
        },
        tax: {
            ytdMonths: 5,
            missingPriorMonths: 0,
            ytdTaxablePaise: P(84_000 * 5),
            ytdTdsPaise: 0,
            ytdPfEePaise: P(9_000),
            ytdPtPaise: P(1_000)
        },
        ...over
    };
}
(0, _vitest.describe)('calculateItem', ()=>{
    (0, _vitest.it)('Gross 84,000 NEW regime GJ: PF 1,800 + PT 200, TDS 0 → net 82,000', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input());
        (0, _vitest.expect)(r.grossEarnedPaise).toBe(P(84_000));
        (0, _vitest.expect)(r.pfEePaise).toBe(P(1_800));
        (0, _vitest.expect)(r.esiEePaise).toBe(0);
        (0, _vitest.expect)(r.ptPaise).toBe(P(200));
        (0, _vitest.expect)(r.tdsPaise).toBe(0);
        (0, _vitest.expect)(r.netPaise).toBe(P(82_000));
        (0, _vitest.expect)(r.paidDays).toBe(22);
        (0, _vitest.expect)(r.errors).toEqual([]);
    });
    (0, _vitest.it)('Gross 20,000 (Basic 10,000) Sep: PF 1,200, ESI 150/650, PT 200 → net 18,450', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input({
            gross: 20_000
        }));
        (0, _vitest.expect)(r.pfEePaise).toBe(P(1_200));
        (0, _vitest.expect)(r.esiEePaise).toBe(P(150));
        (0, _vitest.expect)(r.esiErPaise).toBe(P(650));
        (0, _vitest.expect)(r.ptPaise).toBe(P(200));
        (0, _vitest.expect)(r.netPaise).toBe(P(18_450));
    });
    (0, _vitest.it)('LOP: G 66,000, WD 22, 1 LOP day → gross earned 63,000; paid days include paid leave', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input({
            gross: 66_000,
            days: {
                workingDays: 22,
                eligibleDays: 22,
                paidLeaveDays: 1,
                unpaidLeaveDays: 0,
                absentDays: 1,
                projectedDays: 0
            }
        }));
        (0, _vitest.expect)(r.lopDays).toBe(1);
        (0, _vitest.expect)(r.paidDays).toBe(21);
        (0, _vitest.expect)(r.grossEarnedPaise).toBe(P(63_000));
        (0, _vitest.expect)(r.lopAmountPaise).toBe(P(3_000));
        (0, _vitest.expect)(r.lines.find((l)=>l.componentCode === 'LOP')?.label).toBe('Loss of pay (1 day)');
    });
    (0, _vitest.it)('half-day LOP: 23 working days, 0.5 LOP → 22.5 paid days', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input({
            period: '2026-07',
            days: {
                workingDays: 23,
                eligibleDays: 23,
                paidLeaveDays: 0,
                unpaidLeaveDays: 0,
                absentDays: 0.5,
                projectedDays: 0
            }
        }));
        (0, _vitest.expect)(r.paidDays).toBe(22.5);
        // Each component is prorated and rounded separately (±1 paisa vs prorating the total).
        (0, _vitest.expect)(Math.abs(r.grossEarnedPaise - P(84_000) * 22.5 / 23)).toBeLessThanOrEqual(2);
    });
    (0, _vitest.it)('intern stipend 15,000 with 1 LOP of 22 → 14,318.18, no PF/ESI/PT/TDS', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input({
            stipend: true,
            gross: 15_000,
            days: {
                workingDays: 22,
                eligibleDays: 22,
                paidLeaveDays: 0,
                unpaidLeaveDays: 1,
                absentDays: 0,
                projectedDays: 0
            }
        }));
        (0, _vitest.expect)(r.grossEarnedPaise).toBe(1_431_818);
        (0, _vitest.expect)(r.pfEePaise + r.esiEePaise + r.ptPaise + r.tdsPaise).toBe(0);
        (0, _vitest.expect)(r.netPaise).toBe(P(14_318));
    });
    (0, _vitest.it)('mid-month joiner is prorated on eligible days', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input({
            stipend: true,
            gross: 15_000,
            days: {
                workingDays: 22,
                eligibleDays: 12,
                paidLeaveDays: 0,
                unpaidLeaveDays: 0,
                absentDays: 0,
                projectedDays: 0
            }
        }));
        (0, _vitest.expect)(r.paidDays).toBe(12);
        (0, _vitest.expect)(r.grossEarnedPaise).toBe(Math.round(P(15_000) * 12 / 22));
    });
});
(0, _vitest.describe)('idle deduction (D12)', ()=>{
    (0, _vitest.it)('G 88,000, WD 22, 8 h shift → ₹500/h; 4 h idle − 60 min allowance = 3 h → ₹1,500', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input({
            gross: 88_000,
            idle: {
                apply: true,
                rawMinutes: 240,
                allowanceMinutes: 60,
                shiftNetMinutes: 480
            }
        }));
        (0, _vitest.expect)(r.hourlyRatePaise).toBe(P(500));
        (0, _vitest.expect)(r.idleMinutesDeductible).toBe(180);
        (0, _vitest.expect)(r.idleDeductionPaise).toBe(P(1_500));
    });
    (0, _vitest.it)('idle within the monthly allowance deducts nothing (Priya 0h 40m)', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input({
            idle: {
                apply: true,
                rawMinutes: 40,
                allowanceMinutes: 60,
                shiftNetMinutes: 480
            }
        }));
        (0, _vitest.expect)(r.idleDeductionPaise).toBe(0);
        (0, _vitest.expect)(r.netPaise).toBe(P(82_000));
    });
    (0, _vitest.it)('not applied when the run or policy excludes idle', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input({
            gross: 88_000,
            idle: {
                apply: false,
                rawMinutes: 240,
                allowanceMinutes: 60,
                shiftNetMinutes: 480
            }
        }));
        (0, _vitest.expect)(r.idleDeductionPaise).toBe(0);
    });
    (0, _vitest.it)('147 deductible minutes at 84,000 / 23 days → ₹1,118', ()=>{
        (0, _vitest.expect)((0, _payrollcalc.idleAmountPaise)(147, P(84_000), 23)).toBe(P(1_118));
    });
    (0, _vitest.it)('interns: idle deduction applies to stipends', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input({
            stipend: true,
            gross: 17_600,
            idle: {
                apply: true,
                rawMinutes: 120,
                allowanceMinutes: 60,
                shiftNetMinutes: 480
            }
        }));
        (0, _vitest.expect)(r.idleDeductionPaise).toBe(P(100));
    });
});
(0, _vitest.describe)('adjustments and rounding', ()=>{
    (0, _vitest.it)('positive adjustment is an earning; negative a deduction', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input({
            adjustments: [
                {
                    id: 'a1',
                    type: 'LOP_REVERSAL',
                    label: 'LOP reversal (Aug)',
                    amountPaise: P(3_000),
                    taxable: true,
                    pfApplicable: false,
                    esiApplicable: false
                },
                {
                    id: 'a2',
                    type: 'RECOVERY',
                    label: 'Advance recovery',
                    amountPaise: -P(1_000),
                    taxable: false,
                    pfApplicable: false,
                    esiApplicable: false
                }
            ]
        }));
        (0, _vitest.expect)(r.adjustmentsPaise).toBe(P(2_000));
        (0, _vitest.expect)(r.netPaise).toBe(P(84_000));
    });
    (0, _vitest.it)('net is rounded to the rupee with a rounding line', ()=>{
        const r = (0, _payrollcalc.calculateItem)(input({
            stipend: true,
            gross: 15_000,
            days: {
                workingDays: 22,
                eligibleDays: 21,
                paidLeaveDays: 0,
                unpaidLeaveDays: 0,
                absentDays: 0,
                projectedDays: 0
            }
        }));
        (0, _vitest.expect)(r.netPaise % 100).toBe(0);
        (0, _vitest.expect)(r.lines.some((l)=>l.componentCode === 'ROUNDING')).toBe(true);
        (0, _vitest.expect)(r.totalEarningsPaise - r.totalDeductionsPaise).toBe(r.netPaise);
    });
    (0, _vitest.it)('missing structure is an error item', ()=>{
        const r = (0, _payrollcalc.calculateItem)({
            ...input(),
            structure: [],
            grossFixedPaise: 0
        });
        (0, _vitest.expect)(r.errors).toContain('No salary structure');
    });
});

//# sourceMappingURL=payroll-calc.spec.js.map