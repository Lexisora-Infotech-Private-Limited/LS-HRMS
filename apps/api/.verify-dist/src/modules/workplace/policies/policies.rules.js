"use strict";
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
    get ackDueAt () {
        return ackDueAt;
    },
    get complianceCounts () {
        return complianceCounts;
    },
    get isOverdue () {
        return isOverdue;
    },
    get lowerTitle () {
        return lowerTitle;
    },
    get pdfPageCount () {
        return pdfPageCount;
    },
    get reminderDue () {
        return reminderDue;
    },
    get requirementsForVersion () {
        return requirementsForVersion;
    }
});
const _dates = require("../common/dates");
function ackDueAt(effectiveFromKey, now, ackDueDays) {
    const today = (0, _dates.todayKey)(now);
    const base = effectiveFromKey && effectiveFromKey > today ? effectiveFromKey : today;
    return (0, _dates.istInstant)((0, _dates.addDaysKey)(base, ackDueDays), '18:30');
}
function isOverdue(a, now) {
    return !a.acknowledgedAt && a.dueAt.getTime() < now.getTime();
}
const daysBetween = (a, b)=>Math.round(((0, _dates.dateOnly)(b).getTime() - (0, _dates.dateOnly)(a).getTime()) / _dates.DAY_MS);
function reminderDue(a, now) {
    if (a.acknowledgedAt) return false;
    if (a.lastRemindedAt && now.getTime() - a.lastRemindedAt.getTime() < _dates.DAY_MS - 60_000) return false;
    const today = (0, _dates.todayKey)(now);
    const due = (0, _dates.todayKey)(a.dueAt);
    if (today === due) return true;
    if (today < due) return today === (0, _dates.addDaysKey)(a.startKey, 3);
    return daysBetween(due, today) % 3 === 0;
}
function complianceCounts(acks, now) {
    const required = acks.length;
    const acknowledged = acks.filter((a)=>a.acknowledgedAt).length;
    const overdue = acks.filter((a)=>isOverdue(a, now)).length;
    return {
        required,
        acknowledged,
        pending: required - acknowledged,
        overdue,
        pct: required ? Math.round(acknowledged / required * 100) : 100
    };
}
function requirementsForVersion(input) {
    const prev = new Map(input.previous.map((p)=>[
            p.employeeId,
            p
        ]));
    return input.audience.map((employeeId)=>{
        const p = prev.get(employeeId);
        if (!input.isFirst && !input.requiresReack && p) return {
            employeeId,
            dueAt: p.dueAt,
            acknowledgedAt: p.acknowledgedAt,
            carried: true
        };
        return {
            employeeId,
            dueAt: input.dueAt,
            acknowledgedAt: null,
            carried: false
        };
    });
}
function lowerTitle(title) {
    const [first = '', ...rest] = title.split(' ');
    const keep = first.length > 1 && first === first.toUpperCase();
    return [
        keep ? first : first.charAt(0).toLowerCase() + first.slice(1),
        ...rest
    ].join(' ');
}
function pdfPageCount(buf) {
    if (!buf?.length) return null;
    const m = buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g);
    return m ? m.length : null;
}

//# sourceMappingURL=policies.rules.js.map