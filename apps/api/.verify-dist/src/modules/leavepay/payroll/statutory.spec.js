"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _statutory = require("./statutory");
const _salary = require("./salary");
const _numwords = require("./num-words");
const P = (rupees)=>rupees * 100;
(0, _vitest.describe)('PF', ()=>{
    (0, _vitest.it)('caps the wage at ₹15,000: 12% = ₹1,800 employee and employer', ()=>{
        const pf = (0, _statutory.computePf)(P(42_000), {
            enabled: true,
            ceilingOpted: true
        });
        (0, _vitest.expect)(pf.eePaise).toBe(P(1_800));
        (0, _vitest.expect)(pf.erPaise).toBe(P(1_800));
        (0, _vitest.expect)(pf.epsPaise).toBe(P(1_250));
        (0, _vitest.expect)(pf.epfErPaise).toBe(P(550));
    });
    (0, _vitest.it)('uses the actual wage below the ceiling', ()=>{
        (0, _vitest.expect)((0, _statutory.computePf)(P(10_000), {
            enabled: true,
            ceilingOpted: true
        }).eePaise).toBe(P(1_200));
    });
    (0, _vitest.it)('uncapped when the employee opted out of the ceiling', ()=>{
        (0, _vitest.expect)((0, _statutory.computePf)(P(42_000), {
            enabled: true,
            ceilingOpted: false
        }).eePaise).toBe(P(5_040));
    });
    (0, _vitest.it)('is skipped when disabled', ()=>{
        (0, _vitest.expect)((0, _statutory.computePf)(P(42_000), {
            enabled: false,
            ceilingOpted: true
        }).eePaise).toBe(0);
    });
});
(0, _vitest.describe)('ESI', ()=>{
    (0, _vitest.it)('covers gross up to ₹21,000 only', ()=>{
        (0, _vitest.expect)((0, _statutory.esiCovered)(P(21_000))).toBe(true);
        (0, _vitest.expect)((0, _statutory.esiCovered)(P(21_001))).toBe(false);
        (0, _vitest.expect)((0, _statutory.esiCovered)(P(84_000))).toBe(false);
    });
    (0, _vitest.it)('0.75% employee / 3.25% employer rounded up to the rupee', ()=>{
        const e = (0, _statutory.computeEsi)(P(20_000), true, 22);
        (0, _vitest.expect)(e.eePaise).toBe(P(150));
        (0, _vitest.expect)(e.erPaise).toBe(P(650));
    });
    (0, _vitest.it)('employee share is nil when the daily average wage is ≤ ₹176', ()=>{
        const e = (0, _statutory.computeEsi)(P(3_500), true, 22);
        (0, _vitest.expect)(e.eePaise).toBe(0);
        (0, _vitest.expect)(e.erPaise).toBe(P(114));
    });
});
(0, _vitest.describe)('Professional tax', ()=>{
    (0, _vitest.it)('Gujarat: ₹200 at ₹12,000 and above, nil below', ()=>{
        (0, _vitest.expect)((0, _statutory.computePt)('GJ', P(84_000), 9)).toBe(P(200));
        (0, _vitest.expect)((0, _statutory.computePt)('GJ', P(12_000), 9)).toBe(P(200));
        (0, _vitest.expect)((0, _statutory.computePt)('GJ', P(11_999), 9)).toBe(0);
        (0, _vitest.expect)((0, _statutory.computePt)('GJ', 0, 9)).toBe(0);
    });
    (0, _vitest.it)('Maharashtra male: ₹200, ₹300 in February; slabs below', ()=>{
        (0, _vitest.expect)((0, _statutory.computePt)('MH', P(30_000), 9, 'M')).toBe(P(200));
        (0, _vitest.expect)((0, _statutory.computePt)('MH', P(30_000), 2, 'M')).toBe(P(300));
        (0, _vitest.expect)((0, _statutory.computePt)('MH', P(9_000), 9, 'M')).toBe(P(175));
        (0, _vitest.expect)((0, _statutory.computePt)('MH', P(7_000), 9, 'M')).toBe(0);
    });
    (0, _vitest.it)('Maharashtra female: nil up to ₹25,000', ()=>{
        (0, _vitest.expect)((0, _statutory.computePt)('MH', P(25_000), 9, 'F')).toBe(0);
        (0, _vitest.expect)((0, _statutory.computePt)('MH', P(30_000), 9, 'F')).toBe(P(200));
    });
});
(0, _vitest.describe)('Income tax FY 2026-27', ()=>{
    (0, _vitest.it)('NEW: ₹12.1 L taxable gets marginal relief → ₹10,400', ()=>{
        (0, _vitest.expect)((0, _statutory.annualTax)(12_10_000, 'NEW')).toBe(10_400);
    });
    (0, _vitest.it)('NEW: full rebate up to ₹12 L', ()=>{
        (0, _vitest.expect)((0, _statutory.annualTax)(12_00_000, 'NEW')).toBe(0);
        (0, _vitest.expect)((0, _statutory.annualTax)(9_33_000, 'NEW')).toBe(0);
    });
    (0, _vitest.it)('NEW: ₹17.25 L taxable → ₹1,50,800', ()=>{
        (0, _vitest.expect)((0, _statutory.annualTax)(17_25_000, 'NEW')).toBe(1_50_800);
    });
    (0, _vitest.it)('OLD: 87A rebate up to ₹5 L; 20% slab above', ()=>{
        (0, _vitest.expect)((0, _statutory.annualTax)(5_00_000, 'OLD')).toBe(0);
        (0, _vitest.expect)((0, _statutory.annualTax)(6_00_000, 'OLD')).toBe(Math.round((12_500 + 20_000) * 1.04 * 100) / 100);
    });
    (0, _vitest.it)('NEW regime: ₹1,50,000/month from April → monthly TDS ₹12,567', ()=>{
        const t = (0, _statutory.monthlyTds)({
            regime: 'NEW',
            monthsRemaining: 12,
            missingPriorMonths: 0,
            ytdMonths: 0,
            ytdTaxablePaise: 0,
            ytdTdsPaise: 0,
            ytdPfEePaise: 0,
            ytdPtPaise: 0,
            currentTaxablePaise: P(1_50_000),
            fixedMonthlyTaxablePaise: P(1_50_000),
            currentBasicPaise: P(75_000),
            fixedBasicPaise: P(75_000),
            fixedHraPaise: P(37_500),
            pfEeMonthlyPaise: P(1_800),
            ptMonthlyPaise: P(200)
        });
        (0, _vitest.expect)(t.annualTaxRupees).toBe(1_50_800);
        (0, _vitest.expect)(t.tdsPaise).toBe(P(12_567));
    });
    (0, _vitest.it)('NEW regime: ₹84,000/month stays under the rebate → TDS 0', ()=>{
        const t = (0, _statutory.monthlyTds)({
            regime: 'NEW',
            monthsRemaining: 7,
            missingPriorMonths: 0,
            ytdMonths: 5,
            ytdTaxablePaise: P(84_000 * 5),
            ytdTdsPaise: 0,
            ytdPfEePaise: P(9_000),
            ytdPtPaise: P(1_000),
            currentTaxablePaise: P(84_000),
            fixedMonthlyTaxablePaise: P(84_000),
            currentBasicPaise: P(42_000),
            fixedBasicPaise: P(42_000),
            fixedHraPaise: P(21_000),
            pfEeMonthlyPaise: P(1_800),
            ptMonthlyPaise: P(200)
        });
        (0, _vitest.expect)(t.tdsPaise).toBe(0);
    });
    (0, _vitest.it)('OLD regime with HRA, 80C and 80D declarations (Priya) → ₹3,580/month', ()=>{
        const t = (0, _statutory.monthlyTds)({
            regime: 'OLD',
            monthsRemaining: 10,
            missingPriorMonths: 2,
            ytdMonths: 0,
            ytdTaxablePaise: 0,
            ytdTdsPaise: 0,
            ytdPfEePaise: 0,
            ytdPtPaise: 0,
            currentTaxablePaise: P(84_000),
            fixedMonthlyTaxablePaise: P(84_000),
            currentBasicPaise: P(42_000),
            fixedBasicPaise: P(42_000),
            fixedHraPaise: P(21_000),
            pfEeMonthlyPaise: P(1_800),
            ptMonthlyPaise: P(200),
            declarations: {
                sec80CPaise: P(1_50_000),
                sec80DPaise: P(25_000),
                rentMonthlyPaise: P(15_580),
                metro: false
            }
        });
        (0, _vitest.expect)(t.tdsPaise).toBe(P(3_580));
    });
    (0, _vitest.it)('OLD regime deductions: HRA exemption is the least of the three limits', ()=>{
        const { deductions } = (0, _statutory.taxableIncome)({
            regime: 'OLD',
            annualGrossPaise: P(10_08_000),
            annualBasicPaise: P(5_04_000),
            annualHraPaise: P(2_52_000),
            annualPfEePaise: P(21_600),
            annualPtPaise: P(2_400),
            declarations: {
                rentMonthlyPaise: P(15_580),
                metro: false
            }
        });
        (0, _vitest.expect)(deductions.hraExemption).toBe(1_86_960 - 50_400);
        (0, _vitest.expect)(deductions.sec80C).toBe(21_600);
    });
});
(0, _vitest.describe)('Salary structure', ()=>{
    (0, _vitest.it)('CTC ₹10,29,600 → gross ₹84,000: Basic 42,000, HRA 21,000, Special 21,000, PF 1,800, CTC 85,800', ()=>{
        const s = (0, _salary.buildStructure)({
            ctcAnnualPaise: P(10_29_600)
        }, {
            payType: 'SALARY'
        });
        (0, _vitest.expect)(s.grossMonthlyPaise).toBe(P(84_000));
        const m = Object.fromEntries(s.table.map((l)=>[
                l.code,
                l.monthlyPaise / 100
            ]));
        (0, _vitest.expect)(m).toEqual({
            BASIC: 42_000,
            HRA: 21_000,
            SPECIAL: 21_000,
            PF_ER: 1_800,
            CTC: 85_800
        });
        (0, _vitest.expect)(s.ctcAnnualPaise).toBe(P(10_29_600));
    });
    (0, _vitest.it)('gross from CTC is the inverse of CTC from gross', ()=>{
        for (const g of [
            20_000,
            62_000,
            1_12_000
        ]){
            const s = (0, _salary.buildStructure)({
                grossMonthlyPaise: P(g)
            }, {
                payType: 'SALARY'
            });
            (0, _vitest.expect)((0, _salary.grossFromCtc)(s.ctcAnnualPaise, {
                payType: 'SALARY'
            })).toBe(P(g));
        }
    });
    (0, _vitest.it)('low gross is ESI-covered and adds employer ESI to CTC', ()=>{
        const s = (0, _salary.buildStructure)({
            grossMonthlyPaise: P(20_000)
        }, {
            payType: 'SALARY'
        });
        (0, _vitest.expect)(s.ctcMonthlyPaise).toBe(P(20_000 + 1_200 + 650));
    });
    (0, _vitest.it)('stipend has a single component and CTC = stipend', ()=>{
        const s = (0, _salary.buildStructure)({
            grossMonthlyPaise: P(15_000)
        }, {
            payType: 'STIPEND'
        });
        (0, _vitest.expect)(s.lines.map((l)=>l.code)).toEqual([
            'STIPEND'
        ]);
        (0, _vitest.expect)(s.ctcAnnualPaise).toBe(P(1_80_000));
    });
});
(0, _vitest.describe)('Amount in words (Indian system)', ()=>{
    (0, _vitest.it)('formats lakhs and thousands', ()=>{
        (0, _vitest.expect)((0, _numwords.rupeesInWords)(P(82_000))).toBe('Eighty-two thousand rupees only');
        (0, _vitest.expect)((0, _numwords.rupeesInWords)(P(78_420))).toBe('Seventy-eight thousand four hundred and twenty rupees only');
        (0, _vitest.expect)((0, _numwords.rupeesInWords)(P(1_02_880))).toBe('One lakh two thousand eight hundred and eighty rupees only');
        (0, _vitest.expect)((0, _numwords.rupeesInWords)(P(1_005))).toBe('One thousand and five rupees only');
    });
});

//# sourceMappingURL=statutory.spec.js.map