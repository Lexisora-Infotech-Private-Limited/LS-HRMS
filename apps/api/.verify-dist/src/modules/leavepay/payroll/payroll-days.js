/**
 * Pure day classification for one employee-month (spec P3 §5 steps 2–4, D31):
 *   eligible working days, paid leave, unpaid leave, absence LOP, projected days after the
 *   attendance lock, and deducted idle minutes (idle on LOP days is dropped).
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
    get GATE_OK () {
        return GATE_OK;
    },
    get classifyDays () {
        return classifyDays;
    },
    get timesheetGate () {
        return timesheetGate;
    }
});
const _dates = require("../common/dates");
const r2 = (x)=>Math.round(x * 100) / 100;
function classifyDays(inp) {
    const b = (0, _dates.monthBounds)(inp.period);
    const from = inp.joinDate ? (0, _dates.maxKey)(inp.joinDate, b.start) : b.start;
    const to = inp.exitDate ? (0, _dates.minKey)(inp.exitDate, b.end) : b.end;
    let workingDays = 0;
    let holidays = 0;
    let weeklyOffs = 0;
    for (const d of (0, _dates.eachDay)(b.start, b.end)){
        const k = inp.calendar(d).kind;
        if (k === 'WORKING') workingDays++;
        else if (k === 'HOLIDAY') holidays++;
        else weeklyOffs++;
    }
    let eligibleDays = 0;
    let paidLeave = 0;
    let unpaidLeave = 0;
    let absent = 0;
    let projected = 0;
    let present = 0;
    let idle = 0;
    const summary = new Map();
    if (from <= to) {
        for (const d of (0, _dates.eachDay)(from, to)){
            if (inp.calendar(d).kind !== 'WORKING') continue;
            eligibleDays++;
            const lv = inp.leave.get(d) ?? [];
            const paid = Math.min(1, lv.filter((l)=>l.isPaid).reduce((s, l)=>s + l.units, 0));
            const unpaid = Math.min(1 - paid, lv.filter((l)=>!l.isPaid).reduce((s, l)=>s + l.units, 0));
            for (const l of lv)summary.set(l.code, (summary.get(l.code) ?? 0) + l.units);
            paidLeave += paid;
            unpaidLeave += unpaid;
            const rest = Math.max(0, 1 - paid - unpaid);
            if (d > inp.lockDate) {
                projected += rest;
                continue;
            }
            const att = inp.attendance.get(d);
            let lop = 0;
            if (att) {
                if (att.status === 'ABSENT') lop = rest;
                else if (att.status === 'HALF_DAY') lop = Math.max(0, rest - Math.max(0.5, att.presentFraction || 0.5));
                else if (att.status === 'HALF_DAY_LEAVE' && paid + unpaid < 0.5) lop = Math.max(0, 0.5 - paid - unpaid);
            }
            absent += lop;
            present += Math.max(0, rest - lop);
            // Idle on an LOP day is dropped (no double penalty).
            if (att && lop < 1) idle += att.idleDeductibleMinutes;
        }
    }
    if (!inp.attendance.size && inp.fallbackIdleMinutes) idle = inp.fallbackIdleMinutes;
    return {
        workingDays,
        eligibleDays,
        paidLeaveDays: r2(paidLeave),
        unpaidLeaveDays: r2(unpaidLeave),
        absentDays: r2(absent),
        projectedDays: r2(projected),
        presentDays: r2(present),
        holidays,
        weeklyOffs,
        leaveSummary: [
            ...summary
        ].map(([code, days])=>({
                code,
                days: r2(days)
            })).sort((a, c)=>a.code.localeCompare(c.code)),
        idleMinutes: Math.round(idle)
    };
}
function timesheetGate(g) {
    if (!g.required) return 'NOT_REQUIRED';
    if (!g.statuses.length) return 'APPROVED';
    const order = [
        'NOT_SUBMITTED',
        'SENT_BACK',
        'PENDING_PL',
        'PENDING_RM'
    ];
    const mapped = g.statuses.map((s)=>s === 'APPROVED' || s === 'LOCKED' ? 'APPROVED' : s === 'DRAFT' ? 'NOT_SUBMITTED' : s === 'RETURNED' ? 'SENT_BACK' : s === 'SUBMITTED' ? 'PENDING_PL' : s === 'PENDING_RM' ? 'PENDING_RM' : 'NOT_SUBMITTED');
    for (const o of order)if (mapped.includes(o)) return o;
    return 'APPROVED';
}
const GATE_OK = [
    'APPROVED',
    'NOT_REQUIRED'
];

//# sourceMappingURL=payroll-days.js.map