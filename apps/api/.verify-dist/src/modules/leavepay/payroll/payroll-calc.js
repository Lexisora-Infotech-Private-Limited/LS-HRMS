/**
 * Payroll item calculation (pure, deterministic, replayable from stored inputs).
 *   paidDays = eligibleDays − LOP (paid leave counts as paid, D31)
 *   earned_c = monthly_c × paidDays / workingDays
 *   idle     = max(0, monthly deducted idle − allowance) / 60 × grossFixed / (WD × shiftNet/60)   (D12)
 *   PF → ESI → PT → TDS, net rounded to the rupee.
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
    get DEFAULT_INTERN_STATUTORY () {
        return DEFAULT_INTERN_STATUTORY;
    },
    get calculateItem () {
        return calculateItem;
    },
    get fmtHm () {
        return fmtHm;
    },
    get idleAmountPaise () {
        return idleAmountPaise;
    }
});
const _statutory = require("./statutory");
const _dates = require("../common/dates");
const DEFAULT_INTERN_STATUTORY = {
    pf: false,
    esi: false,
    pt: false,
    tds: false,
    idle: true
};
const r2 = (x)=>Math.round(x * 100) / 100;
const rupees = (p)=>'₹' + Math.round(p / 100).toLocaleString('en-IN');
function calculateItem(input) {
    const trace = [];
    const errors = [];
    const lines = [];
    const intern = input.internStatutory ?? DEFAULT_INTERN_STATUTORY;
    const isStipend = input.payType === 'STIPEND';
    const WD = input.days.workingDays;
    const month = Number(input.period.slice(5, 7));
    if (!input.structure.length || input.grossFixedPaise <= 0) errors.push('No salary structure');
    if (WD <= 0) errors.push('No working days in the period');
    const lopDays = r2(input.days.unpaidLeaveDays + input.days.absentDays);
    const paidDays = Math.max(0, r2(input.days.eligibleDays - lopDays));
    trace.push(`Working days ${WD}; eligible ${input.days.eligibleDays}; paid leave ${input.days.paidLeaveDays}; LOP ${lopDays} → paid days ${paidDays}`);
    // Earnings (prorated on paid days).
    let order = 0;
    let grossEarned = 0;
    let basicEarned = 0;
    const earned = {};
    for (const c of input.structure){
        const amt = WD > 0 ? Math.round(c.monthlyPaise * paidDays / WD) : 0;
        earned[c.code] = amt;
        grossEarned += amt;
        if (c.code === 'BASIC' || c.code === 'DA') basicEarned += amt;
        lines.push({
            componentCode: c.code,
            label: c.label,
            kind: 'EARNING',
            fullAmountPaise: c.monthlyPaise,
            amountPaise: amt,
            order: order++
        });
    }
    const lopAmount = Math.max(0, input.grossFixedPaise - grossEarned);
    if (lopAmount > 0) {
        const shortDays = r2(WD - paidDays);
        lines.push({
            componentCode: 'LOP',
            label: `Loss of pay (${shortDays} ${shortDays === 1 ? 'day' : 'days'})`,
            kind: 'INFO',
            amountPaise: lopAmount,
            order: 90
        });
        trace.push(`Gross ${rupees(input.grossFixedPaise)} × ${paidDays}/${WD} = ${rupees(grossEarned)}`);
    }
    // Idle deduction (D12): monthly deducted idle beyond the allowance at the hourly rate.
    const perDay = WD > 0 ? input.grossFixedPaise / WD : 0;
    const shiftHours = (input.idle.shiftNetMinutes || 480) / 60;
    const hourly = WD > 0 ? input.grossFixedPaise / (WD * shiftHours) : 0;
    const applyIdle = input.idle.apply && (!isStipend || intern.idle);
    const deductibleMin = applyIdle ? Math.max(0, input.idle.rawMinutes - input.idle.allowanceMinutes) : 0;
    let idleDed = deductibleMin > 0 ? Math.round(deductibleMin / 60 * hourly / 100) * 100 : 0;
    idleDed = Math.min(idleDed, grossEarned);
    if (applyIdle) trace.push(`Idle ${input.idle.rawMinutes} min − allowance ${input.idle.allowanceMinutes} = ${deductibleMin} min × ${rupees(hourly)}/h = ${rupees(idleDed)}`);
    else if (input.idle.rawMinutes > 0) trace.push('Idle deduction not applied for this employee');
    // Adjustments.
    const adjustments = input.adjustments ?? [];
    let adjPos = 0;
    let adjNeg = 0;
    let adjTaxable = 0;
    let adjPf = 0;
    let adjEsi = 0;
    for (const a of adjustments){
        if (a.amountPaise >= 0) {
            adjPos += a.amountPaise;
            lines.push({
                componentCode: a.type,
                label: a.label,
                kind: 'EARNING',
                amountPaise: a.amountPaise,
                adjustmentId: a.id,
                order: 50 + order++
            });
        } else {
            adjNeg += -a.amountPaise;
            lines.push({
                componentCode: a.type,
                label: a.label,
                kind: 'DEDUCTION',
                amountPaise: -a.amountPaise,
                adjustmentId: a.id,
                order: 150 + order++
            });
        }
        if (a.taxable) adjTaxable += a.amountPaise;
        if (a.pfApplicable) adjPf += a.amountPaise;
        if (a.esiApplicable) adjEsi += a.amountPaise;
    }
    // Statutory.
    const basicShare = input.grossFixedPaise > 0 ? (earned.BASIC ?? 0) / Math.max(1, grossEarned) : 0;
    const idleForWages = input.idleReducesStatutoryWages === false ? 0 : idleDed;
    const pfApplies = input.profile.pfEnabled && (!isStipend || intern.pf);
    const pfWage = Math.max(0, basicEarned + adjPf - Math.round(idleForWages * basicShare));
    const pf = (0, _statutory.computePf)(pfWage, {
        enabled: pfApplies,
        ceilingOpted: input.profile.pfCeilingOpted
    });
    if (pfApplies) trace.push(pf.trace);
    const esiApplies = (!isStipend || intern.esi) && (0, _statutory.esiCovered)(input.grossFixedPaise, input.profile.esiMode);
    const esiWage = Math.max(0, grossEarned + adjEsi - idleForWages);
    const esi = (0, _statutory.computeEsi)(esiWage, esiApplies, paidDays);
    if (esiApplies) trace.push(esi.trace);
    const ptApplies = !isStipend || intern.pt;
    const pt = ptApplies ? (0, _statutory.computePt)(input.profile.ptStateCode, grossEarned, month, input.profile.gender) : 0;
    if (ptApplies) trace.push(`PT ${input.profile.ptStateCode} on ${rupees(grossEarned)} = ${rupees(pt)}`);
    const taxableMonthly = grossEarned - idleDed + adjTaxable;
    let tds = 0;
    if (!isStipend || intern.tds) {
        const fixedPf = (0, _statutory.computePf)(input.structure.filter((c)=>c.code === 'BASIC' || c.code === 'DA').reduce((s, c)=>s + c.monthlyPaise, 0), {
            enabled: pfApplies,
            ceilingOpted: input.profile.pfCeilingOpted
        });
        const t = (0, _statutory.monthlyTds)({
            regime: input.profile.taxRegime,
            monthsRemaining: (0, _dates.fyMonthsRemaining)(input.period),
            missingPriorMonths: input.tax.missingPriorMonths,
            ytdMonths: input.tax.ytdMonths,
            ytdTaxablePaise: input.tax.ytdTaxablePaise,
            ytdTdsPaise: input.tax.ytdTdsPaise,
            ytdPfEePaise: input.tax.ytdPfEePaise,
            ytdPtPaise: input.tax.ytdPtPaise,
            currentTaxablePaise: taxableMonthly,
            fixedMonthlyTaxablePaise: input.grossFixedPaise,
            currentBasicPaise: earned.BASIC ?? 0,
            fixedBasicPaise: input.structure.find((c)=>c.code === 'BASIC')?.monthlyPaise ?? 0,
            fixedHraPaise: input.structure.find((c)=>c.code === 'HRA')?.monthlyPaise ?? 0,
            pfEeMonthlyPaise: fixedPf.eePaise,
            ptMonthlyPaise: ptApplies ? (0, _statutory.computePt)(input.profile.ptStateCode, input.grossFixedPaise, month, input.profile.gender) : 0,
            declarations: input.profile.declarations
        });
        tds = t.tdsPaise;
        trace.push(t.trace);
    }
    if (pf.eePaise) lines.push({
        componentCode: 'PF_EE',
        label: 'Provident fund',
        kind: 'DEDUCTION',
        amountPaise: pf.eePaise,
        order: 100
    });
    if (esi.eePaise) lines.push({
        componentCode: 'ESI_EE',
        label: 'ESI',
        kind: 'DEDUCTION',
        amountPaise: esi.eePaise,
        order: 101
    });
    if (pt) lines.push({
        componentCode: 'PT',
        label: 'Professional tax',
        kind: 'DEDUCTION',
        amountPaise: pt,
        order: 102
    });
    if (tds) lines.push({
        componentCode: 'TDS',
        label: 'Income tax (TDS)',
        kind: 'DEDUCTION',
        amountPaise: tds,
        order: 103
    });
    if (idleDed) lines.push({
        componentCode: 'IDLE_DED',
        label: `Idle time deduction (${fmtHm(deductibleMin)})`,
        kind: 'DEDUCTION',
        amountPaise: idleDed,
        order: 104
    });
    if (pf.erPaise) lines.push({
        componentCode: 'PF_ER',
        label: 'PF (employer)',
        kind: 'EMPLOYER',
        amountPaise: pf.erPaise,
        order: 200
    });
    if (esi.erPaise) lines.push({
        componentCode: 'ESI_ER',
        label: 'ESI (employer)',
        kind: 'EMPLOYER',
        amountPaise: esi.erPaise,
        order: 201
    });
    const totalEarnings = grossEarned + adjPos;
    let totalDeductions = pf.eePaise + esi.eePaise + pt + tds + idleDed + adjNeg;
    const rawNet = totalEarnings - totalDeductions;
    const net = Math.round(rawNet / 100) * 100;
    const rounding = net - rawNet;
    if (rounding !== 0) {
        lines.push({
            componentCode: 'ROUNDING',
            label: 'Rounding',
            kind: rounding > 0 ? 'EARNING' : 'DEDUCTION',
            amountPaise: Math.abs(rounding),
            order: rounding > 0 ? 80 : 180
        });
        if (rounding < 0) totalDeductions += -rounding;
    }
    if (net < 0) errors.push('Negative net pay; defer recoveries to next period');
    return {
        lopDays,
        paidDays,
        grossEarnedPaise: grossEarned,
        lopAmountPaise: lopAmount,
        hourlyRatePaise: r2(hourly),
        perDayRatePaise: r2(perDay),
        idleMinutesDeductible: deductibleMin,
        idleDeductionPaise: idleDed,
        pfWagePaise: pfWage,
        esiWagePaise: esiApplies ? esiWage : 0,
        pfEePaise: pf.eePaise,
        pfErPaise: pf.erPaise,
        esiEePaise: esi.eePaise,
        esiErPaise: esi.erPaise,
        ptPaise: pt,
        tdsPaise: tds,
        adjustmentsPaise: adjPos - adjNeg,
        totalEarningsPaise: totalEarnings + (rounding > 0 ? rounding : 0),
        totalDeductionsPaise: totalDeductions,
        employerContribPaise: pf.erPaise + esi.erPaise,
        roundingPaise: rounding,
        netPaise: net,
        taxableMonthlyPaise: taxableMonthly,
        lines: lines.sort((a, b)=>a.order - b.order),
        trace,
        errors
    };
}
function fmtHm(minutes) {
    const m = Math.max(0, Math.round(minutes));
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
function idleAmountPaise(deductibleMinutes, grossFixedPaise, workingDays, shiftNetMinutes = 480) {
    if (deductibleMinutes <= 0 || workingDays <= 0) return 0;
    const hourly = grossFixedPaise / (workingDays * (shiftNetMinutes / 60));
    return Math.round(deductibleMinutes / 60 * hourly / 100) * 100;
}

//# sourceMappingURL=payroll-calc.js.map