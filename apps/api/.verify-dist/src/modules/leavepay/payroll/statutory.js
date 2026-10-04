/**
 * Indian statutory engine (pure). Amounts in paise unless a name says rupees.
 * Seed values are FY 2026-27 defaults and must be verified by the tenant's CA.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get ESI_CONFIG () {
        return ESI_CONFIG;
    },
    get PF_CONFIG () {
        return PF_CONFIG;
    },
    get TAX_CONFIG () {
        return TAX_CONFIG;
    },
    get annualTax () {
        return annualTax;
    },
    get computeEsi () {
        return computeEsi;
    },
    get computePf () {
        return computePf;
    },
    get computePt () {
        return computePt;
    },
    get esiCovered () {
        return esiCovered;
    },
    get monthlyTds () {
        return monthlyTds;
    },
    get ptStateFrom () {
        return ptStateFrom;
    },
    get taxableIncome () {
        return taxableIncome;
    }
});
const PF_CONFIG = {
    eeRate: 0.12,
    erRate: 0.12,
    epsRate: 0.0833,
    wageCeilingPaise: 15_000_00,
    epsMaxPaise: 1_250_00,
    edliRate: 0.005,
    adminRate: 0.005
};
const ESI_CONFIG = {
    eeRate: 0.0075,
    erRate: 0.0325,
    thresholdPaise: 21_000_00,
    eeExemptDailyAvgPaise: 176_00
};
const rupeeRound = (paise)=>Math.round(paise / 100) * 100;
const rupeeCeil = (paise)=>Math.ceil(paise / 100 - 1e-9) * 100;
function computePf(pfWagePaise, opts) {
    const zero = {
        pfWagePaise,
        ceilWagePaise: 0,
        eePaise: 0,
        erPaise: 0,
        epsPaise: 0,
        epfErPaise: 0,
        edliPaise: 0,
        adminPaise: 0
    };
    if (!opts.enabled || pfWagePaise <= 0) return {
        ...zero,
        trace: 'PF not applicable'
    };
    const capped = Math.min(pfWagePaise, PF_CONFIG.wageCeilingPaise);
    const ceilWage = opts.ceilingOpted ? capped : pfWagePaise;
    const ee = rupeeRound(ceilWage * PF_CONFIG.eeRate);
    const er = rupeeRound(ceilWage * PF_CONFIG.erRate);
    const eps = Math.min(rupeeRound(capped * PF_CONFIG.epsRate), PF_CONFIG.epsMaxPaise);
    return {
        pfWagePaise,
        ceilWagePaise: ceilWage,
        eePaise: ee,
        erPaise: er,
        epsPaise: eps,
        epfErPaise: er - eps,
        edliPaise: rupeeRound(capped * PF_CONFIG.edliRate),
        adminPaise: Math.round(ceilWage * PF_CONFIG.adminRate),
        trace: `PF wage = min(${r(pfWagePaise)}, 15,000) = ${r(ceilWage)} × 12% = ${r(ee)}`
    };
}
function esiCovered(grossFixedPaise, mode = 'AUTO') {
    if (mode === 'FORCE_ON') return true;
    if (mode === 'FORCE_OFF') return false;
    return grossFixedPaise > 0 && grossFixedPaise <= ESI_CONFIG.thresholdPaise;
}
function computeEsi(esiWagePaise, covered, paidDays) {
    if (!covered || esiWagePaise <= 0) return {
        eePaise: 0,
        erPaise: 0,
        trace: 'ESI not applicable (gross above ₹21,000)'
    };
    const dailyAvg = paidDays > 0 ? esiWagePaise / paidDays : 0;
    const ee = dailyAvg <= ESI_CONFIG.eeExemptDailyAvgPaise ? 0 : rupeeCeil(esiWagePaise * ESI_CONFIG.eeRate);
    const er = rupeeCeil(esiWagePaise * ESI_CONFIG.erRate);
    return {
        eePaise: ee,
        erPaise: er,
        trace: `ESI wage ${r(esiWagePaise)} × 0.75% = ${r(ee)} (employer 3.25% = ${r(er)})`
    };
}
function computePt(stateCode, grossEarnedPaise, month, gender) {
    if (grossEarnedPaise <= 0) return 0;
    const g = grossEarnedPaise / 100;
    switch((stateCode || 'GJ').toUpperCase()){
        case 'GJ':
            // Gujarat: below ₹12,000 → nil; ₹12,000 and above → ₹200 (annual cap ₹2,500).
            return g >= 12_000 ? 200_00 : 0;
        case 'MH':
            {
                const feb = month === 2;
                if ((gender ?? '').toUpperCase().startsWith('F')) return g > 25_000 ? feb ? 300_00 : 200_00 : 0;
                if (g <= 7_500) return 0;
                if (g <= 10_000) return 175_00;
                return feb ? 300_00 : 200_00;
            }
        case 'KA':
            return g >= 25_000 ? 200_00 : 0;
        default:
            return 0;
    }
}
function ptStateFrom(name) {
    const s = (name ?? '').toLowerCase();
    if (s.includes('pune') || s.includes('mumbai') || s.includes('maharashtra')) return 'MH';
    if (s.includes('bengal') || s.includes('bangalore') || s.includes('karnataka')) return 'KA';
    return 'GJ';
}
const TAX_CONFIG = {
    NEW: {
        standardDeduction: 75_000,
        slabs: [
            {
                from: 0,
                to: 4_00_000,
                rate: 0
            },
            {
                from: 4_00_000,
                to: 8_00_000,
                rate: 0.05
            },
            {
                from: 8_00_000,
                to: 12_00_000,
                rate: 0.1
            },
            {
                from: 12_00_000,
                to: 16_00_000,
                rate: 0.15
            },
            {
                from: 16_00_000,
                to: 20_00_000,
                rate: 0.2
            },
            {
                from: 20_00_000,
                to: 24_00_000,
                rate: 0.25
            },
            {
                from: 24_00_000,
                to: null,
                rate: 0.3
            }
        ],
        rebateLimit: 12_00_000,
        rebateMax: 60_000,
        marginalRelief: true,
        surcharge: [
            {
                above: 50_00_000,
                rate: 0.1
            },
            {
                above: 1_00_00_000,
                rate: 0.15
            },
            {
                above: 2_00_00_000,
                rate: 0.25
            }
        ]
    },
    OLD: {
        standardDeduction: 50_000,
        slabs: [
            {
                from: 0,
                to: 2_50_000,
                rate: 0
            },
            {
                from: 2_50_000,
                to: 5_00_000,
                rate: 0.05
            },
            {
                from: 5_00_000,
                to: 10_00_000,
                rate: 0.2
            },
            {
                from: 10_00_000,
                to: null,
                rate: 0.3
            }
        ],
        rebateLimit: 5_00_000,
        rebateMax: 12_500,
        marginalRelief: false,
        surcharge: [
            {
                above: 50_00_000,
                rate: 0.1
            },
            {
                above: 1_00_00_000,
                rate: 0.15
            },
            {
                above: 2_00_00_000,
                rate: 0.25
            },
            {
                above: 5_00_00_000,
                rate: 0.37
            }
        ]
    }
};
function slabTax(taxable, slabs) {
    let t = 0;
    for (const s of slabs){
        if (taxable <= s.from) break;
        const top = s.to === null ? taxable : Math.min(taxable, s.to);
        t += (top - s.from) * s.rate;
    }
    return t;
}
function annualTax(taxableRupees, regime) {
    const cfg = TAX_CONFIG[regime];
    const taxable = Math.max(0, Math.floor(taxableRupees));
    let tax = slabTax(taxable, cfg.slabs);
    if (taxable <= cfg.rebateLimit) tax = Math.max(0, tax - cfg.rebateMax);
    else if (cfg.marginalRelief) tax = Math.min(tax, taxable - cfg.rebateLimit);
    // Surcharge with marginal relief at each threshold.
    const sc = [
        ...cfg.surcharge
    ].reverse().find((s)=>taxable > s.above);
    if (sc) {
        const withSc = tax * (1 + sc.rate);
        const lower = [
            ...cfg.surcharge
        ].reverse().find((s)=>s.above < sc.above);
        const atThreshold = slabTax(sc.above, cfg.slabs) * (1 + (lower?.rate ?? 0));
        tax = Math.min(withSc, atThreshold + (taxable - sc.above));
    }
    return Math.round(tax * 1.04 * 100) / 100;
}
function taxableIncome(input) {
    const gross = input.annualGrossPaise / 100;
    const cfg = TAX_CONFIG[input.regime];
    const ded = {
        standardDeduction: Math.min(cfg.standardDeduction, gross)
    };
    if (input.regime === 'OLD') {
        const d = input.declarations ?? {};
        ded.professionalTax = Math.min(2_500, input.annualPtPaise / 100);
        const rent = (d.rentMonthlyPaise ?? 0) * 12 / 100;
        const basic = input.annualBasicPaise / 100;
        if (rent > 0 && input.annualHraPaise > 0) {
            ded.hraExemption = Math.max(0, Math.min(input.annualHraPaise / 100, rent - 0.1 * basic, (d.metro ? 0.5 : 0.4) * basic));
        }
        ded.sec80C = Math.min(1_50_000, (d.sec80CPaise ?? 0) / 100 + input.annualPfEePaise / 100);
        if (d.sec80DPaise) ded.sec80D = Math.min(1_00_000, d.sec80DPaise / 100);
        if (d.homeLoanInterestPaise) ded.sec24b = Math.min(2_00_000, d.homeLoanInterestPaise / 100);
    }
    const total = Object.values(ded).reduce((s, v)=>s + v, 0);
    return {
        taxableRupees: Math.max(0, Math.round((gross - total) * 100) / 100),
        deductions: ded
    };
}
function monthlyTds(input) {
    const future = Math.max(0, input.monthsRemaining - 1);
    const m = input.missingPriorMonths;
    const projected = input.ytdTaxablePaise + m * input.fixedMonthlyTaxablePaise + input.currentTaxablePaise + future * input.fixedMonthlyTaxablePaise;
    const { taxableRupees } = taxableIncome({
        regime: input.regime,
        annualGrossPaise: projected,
        annualBasicPaise: input.fixedBasicPaise * 12,
        annualHraPaise: input.fixedHraPaise * 12,
        annualPfEePaise: input.ytdPfEePaise + input.pfEeMonthlyPaise * (m + input.monthsRemaining),
        annualPtPaise: input.ytdPtPaise + input.ptMonthlyPaise * (m + input.monthsRemaining),
        declarations: input.declarations
    });
    const tax = annualTax(taxableRupees, input.regime);
    const employedMonths = Math.max(1, input.ytdMonths + m + input.monthsRemaining);
    const assumedPrior = m > 0 ? tax * 100 * m / employedMonths : 0;
    const due = tax * 100 - input.ytdTdsPaise - assumedPrior;
    const monthly = Math.max(0, due / Math.max(1, input.monthsRemaining));
    const tds = rupeeRound(monthly);
    return {
        tdsPaise: tds,
        annualTaxRupees: tax,
        projectedAnnualPaise: projected,
        taxableRupees,
        trace: `${input.regime} regime: projected ${r(projected)}, taxable ₹${Math.round(taxableRupees).toLocaleString('en-IN')}, annual tax ₹${Math.round(tax).toLocaleString('en-IN')} → ${r(tds)} this month`
    };
}
function r(paise) {
    return '₹' + Math.round(paise / 100).toLocaleString('en-IN');
}

//# sourceMappingURL=statutory.js.map