/**
 * Pure leave rules (no I/O): day expansion with half days, holiday/weekly-off exclusion and
 * the sandwich rule; balance split into paid/LOP; joining pro-ration and accrual schedules;
 * year-end carry forward. Covered by leave-calc.spec.ts.
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
    get availableOf () {
        return availableOf;
    },
    get consumeCompOff () {
        return consumeCompOff;
    },
    get expandLeaveDays () {
        return expandLeaveDays;
    },
    get fmtDays () {
        return fmtDays;
    },
    get leaveSummaryLabel () {
        return leaveSummaryLabel;
    },
    get markLop () {
        return markLop;
    },
    get monthlyCreditMonths () {
        return monthlyCreditMonths;
    },
    get prorateYearly () {
        return prorateYearly;
    },
    get round2 () {
        return round2;
    },
    get roundHalf () {
        return roundHalf;
    },
    get scheduledAnnual () {
        return scheduledAnnual;
    },
    get sessionFor () {
        return sessionFor;
    },
    get sessionsConflict () {
        return sessionsConflict;
    },
    get splitPaid () {
        return splitPaid;
    },
    get yearEndSplit () {
        return yearEndSplit;
    }
});
const _dates = require("../common/dates");
const coversSecondHalf = (s)=>s === 'FULL' || s === 'SECOND_HALF';
const coversFirstHalf = (s)=>s === 'FULL' || s === 'FIRST_HALF';
function sessionFor(input, date) {
    if (input.from === input.to) return input.halfDay && input.halfDay !== 'NONE' ? input.halfDay : 'FULL';
    if (date === input.from && input.fromSession === 'SECOND_HALF') return 'SECOND_HALF';
    if (date === input.to && input.toSession === 'FIRST_HALF') return 'FIRST_HALF';
    return 'FULL';
}
function expandLeaveDays(input) {
    const { from, to, calendar } = input;
    if (from > to) return {
        days: [],
        totalDays: 0,
        sandwichDays: 0,
        excluded: [],
        error: 'From date must be on or before To date'
    };
    const range = (0, _dates.eachDay)(from, to);
    if (range.length > 366) return {
        days: [],
        totalDays: 0,
        sandwichDays: 0,
        excluded: [],
        error: 'A request can cover at most 366 days'
    };
    const days = new Map();
    for (const date of range){
        const c = calendar(date);
        const session = sessionFor(input, date);
        days.set(date, {
            date,
            kind: c.kind,
            session,
            units: c.kind === 'WORKING' ? session === 'FULL' ? 1 : 0.5 : 0,
            isSandwich: false,
            isPaid: true,
            holidayName: c.holidayName
        });
    }
    if (from === to && input.halfDay && input.halfDay !== 'NONE' && calendar(from).kind !== 'WORKING') {
        return {
            days: [],
            totalDays: 0,
            sandwichDays: 0,
            excluded: [],
            error: 'A half day must be on a working day'
        };
    }
    const coverage = (date)=>{
        const own = days.get(date);
        if (own && own.kind === 'WORKING') return own.session;
        return input.existingCoverage?.(date) ?? null;
    };
    const sandwichable = (k)=>k === 'WEEKLY_OFF' ? input.sandwichWeeklyOffs : k === 'HOLIDAY' ? input.sandwichHolidays : false;
    if (input.sandwichWeeklyOffs || input.sandwichHolidays) {
        // Candidate blocks: inside the range, plus the blocks touching either edge from outside.
        const seen = new Set();
        const candidates = [
            ...range,
            (0, _dates.addDays)(from, -1),
            (0, _dates.addDays)(to, 1)
        ];
        for (const start of candidates){
            if (seen.has(start) || calendar(start).kind === 'WORKING') continue;
            // Grow the maximal non-working block around `start`.
            let a = start;
            let b = start;
            for(let i = 0; i < 15 && calendar((0, _dates.addDays)(a, -1)).kind !== 'WORKING'; i++)a = (0, _dates.addDays)(a, -1);
            for(let i = 0; i < 15 && calendar((0, _dates.addDays)(b, 1)).kind !== 'WORKING'; i++)b = (0, _dates.addDays)(b, 1);
            const block = (0, _dates.eachDay)(a, b);
            block.forEach((d)=>seen.add(d));
            const before = (0, _dates.addDays)(a, -1);
            const after = (0, _dates.addDays)(b, 1);
            const touchesRequest = before >= from && before <= to || after >= from && after <= to || block.some((d)=>d >= from && d <= to);
            if (!touchesRequest) continue;
            // At least one side must belong to this request (otherwise the block is someone else's).
            const beforeOwn = before >= from && before <= to;
            const afterOwn = after >= from && after <= to;
            if (!beforeOwn && !afterOwn) continue;
            if (!coversSecondHalf(coverage(before)) || !coversFirstHalf(coverage(after))) continue;
            for (const d of block){
                const c = calendar(d);
                if (!sandwichable(c.kind)) continue;
                if (input.existingCoverage?.(d)) continue; // already charged to an earlier request
                days.set(d, {
                    date: d,
                    kind: c.kind,
                    session: 'FULL',
                    units: 1,
                    isSandwich: true,
                    isPaid: true,
                    holidayName: c.holidayName
                });
            }
        }
    }
    const list = [
        ...days.values()
    ].sort((x, y)=>x.date < y.date ? -1 : 1);
    const totalDays = list.reduce((s, d)=>s + d.units, 0);
    const sandwichDays = list.filter((d)=>d.isSandwich).reduce((s, d)=>s + d.units, 0);
    const excluded = list.filter((d)=>d.kind !== 'WORKING' && !d.isSandwich).map((d)=>({
            date: d.date,
            kind: d.kind,
            holidayName: d.holidayName
        }));
    if (totalDays === 0) return {
        days: list,
        totalDays: 0,
        sandwichDays: 0,
        excluded,
        error: 'No working days in range'
    };
    return {
        days: list,
        totalDays,
        sandwichDays,
        excluded
    };
}
function sessionsConflict(a, b) {
    if (a === 'FULL' || b === 'FULL') return true;
    return a === b;
}
function splitPaid(units, available, opts) {
    if (!opts.isPaidType) return {
        paid: 0,
        lop: units,
        blocked: false
    };
    if (opts.checkBalance === false) return {
        paid: units,
        lop: 0,
        blocked: false
    };
    if (units <= available + 1e-9) return {
        paid: units,
        lop: 0,
        blocked: false
    };
    if (opts.allowNegative && available - units >= -(opts.negativeLimit ?? 0) - 1e-9) return {
        paid: units,
        lop: 0,
        blocked: false
    };
    if (opts.excessAction === 'CONVERT_TO_LOP') {
        const paid = Math.max(0, roundHalfDown(available));
        return {
            paid,
            lop: units - paid,
            blocked: false
        };
    }
    return {
        paid: 0,
        lop: 0,
        blocked: true
    };
}
function markLop(days, lop) {
    let left = lop;
    const out = days.map((d)=>({
            ...d
        }));
    for(let i = out.length - 1; i >= 0 && left > 0; i--){
        const d = out[i];
        if (d.units <= 0) continue;
        if (d.units <= left + 1e-9) {
            d.isPaid = false;
            left -= d.units;
        } else {
            // A half of a full day is unpaid: keep the row paid but LOP accounted at request level.
            left = 0;
        }
    }
    return out;
}
function roundHalf(x) {
    return Math.round(x * 2 + 1e-9) / 2;
}
function roundHalfDown(x) {
    return Math.floor(x * 2 + 1e-9) / 2;
}
function prorateYearly(quota, joinDate, year) {
    if (!joinDate) return quota;
    const jy = Number(joinDate.slice(0, 4));
    if (jy < year) return quota;
    if (jy > year) return 0;
    const m = Number(joinDate.slice(5, 7));
    const day = Number(joinDate.slice(8, 10));
    const remaining = 12 - m + (day <= 15 ? 1 : 0);
    return roundHalf(quota * remaining / 12);
}
function monthlyCreditMonths(joinDate, year) {
    let first = 1;
    if (joinDate) {
        const jy = Number(joinDate.slice(0, 4));
        if (jy > year) return [];
        if (jy === year) {
            const m = Number(joinDate.slice(5, 7));
            first = Number(joinDate.slice(8, 10)) <= 15 ? m : m + 1;
        }
    }
    const out = [];
    for(let m = first; m <= 12; m++)out.push(m);
    return out;
}
function scheduledAnnual(frequency, daysPerPeriod, quota, joinDate, year) {
    if (frequency === 'MONTHLY') return monthlyCreditMonths(joinDate, year).length * daysPerPeriod;
    if (frequency === 'QUARTERLY') {
        const months = monthlyCreditMonths(joinDate, year);
        return [
            1,
            4,
            7,
            10
        ].filter((q)=>months.includes(q) || months.some((m)=>m > q && m < q + 3)).length * daysPerPeriod;
    }
    if (frequency === 'YEARLY') return prorateYearly(quota, joinDate, year);
    return 0;
}
function availableOf(b) {
    return round2(b.opening + b.accrued + b.credited - b.availed - b.lapsed - b.encashed - b.pending);
}
function yearEndSplit(closing, carryForwardMax, encashable = false, encashExcess = false, maxEncash = null) {
    const positive = Math.max(0, closing);
    const carry = carryForwardMax === null ? 0 : Math.min(positive, carryForwardMax);
    const excess = positive - carry;
    const encash = encashable && encashExcess ? Math.min(excess, maxEncash ?? excess) : 0;
    const lapse = excess - encash;
    // A negative closing carries forward as a negative opening.
    return {
        carry: closing < 0 ? closing : carry,
        encash,
        lapse
    };
}
function consumeCompOff(grants, units, leaveDate) {
    let left = units;
    const consumed = [];
    for (const g of [
        ...grants
    ].sort((a, b)=>a.expiresOn < b.expiresOn ? -1 : 1)){
        if (left <= 0) break;
        if (g.expiresOn < leaveDate || g.remaining <= 0) continue;
        const take = Math.min(g.remaining, left);
        consumed.push({
            grantId: g.id,
            units: take
        });
        left -= take;
    }
    return {
        consumed,
        shortfall: round2(left)
    };
}
function round2(x) {
    return Math.round(x * 100) / 100;
}
function leaveSummaryLabel(summary) {
    const parts = summary.filter((s)=>s.days > 0).map((s)=>`${fmtDays(s.days)} ${s.code}`);
    return parts.length ? parts.join(' · ') : '0';
}
function fmtDays(n) {
    return Number.isInteger(n) ? String(n) : String(round2(n));
}

//# sourceMappingURL=leave-calc.js.map