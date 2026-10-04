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
    get DEFAULT_QUOTES () {
        return DEFAULT_QUOTES;
    },
    get approvalsFor () {
        return approvalsFor;
    },
    get celebrationsWithin () {
        return celebrationsWithin;
    },
    get reviewLink () {
        return reviewLink;
    },
    get sortTodos () {
        return sortTodos;
    },
    get taskLink () {
        return taskLink;
    },
    get titleLine () {
        return titleLine;
    },
    get weekRangeLabel () {
        return weekRangeLabel;
    }
});
const _dates = require("../common/dates");
const DEFAULT_QUOTES = [
    'Small steps every day add up to big results.',
    'Do the hard thing first; the rest of the day gets lighter.',
    'Quality is never an accident.',
    'You are one focused hour away from a good day.'
];
const isLeap = (y)=>y % 4 === 0 && y % 100 !== 0 || y % 400 === 0;
function celebrationsWithin(people, today, days, excludeId) {
    const out = [];
    const inWindow = (md)=>{
        for(let add = 0; add <= days; add++){
            const k = (0, _dates.addDaysKey)(today, add);
            if (k.slice(5) === md) return k;
            if (md === '02-29' && k.slice(5) === '02-28' && !isLeap(+k.slice(0, 4))) return k;
        }
        return null;
    };
    for (const p of people){
        if (p.id === excludeId) continue;
        if (p.dob) {
            const k = inWindow((0, _dates.keyOf)(p.dob).slice(5));
            if (k) out.push({
                id: `bday:${p.id}`,
                kind: 'BIRTHDAY',
                what: `${p.name} · birthday`,
                when: (0, _dates.dayMonth)((0, _dates.dateOnly)(k)),
                date: k
            });
        }
        if (p.joined) {
            const k = inWindow((0, _dates.keyOf)(p.joined).slice(5));
            const years = k ? +k.slice(0, 4) - p.joined.getUTCFullYear() : 0;
            if (k && years >= 1) out.push({
                id: `anniv:${p.id}`,
                kind: 'ANNIVERSARY',
                what: `${p.name} · ${years} year${years > 1 ? 's' : ''}`,
                when: (0, _dates.dayMonth)((0, _dates.dateOnly)(k)),
                date: k
            });
        }
    }
    return out.sort((a, b)=>a.date.localeCompare(b.date) || a.what.localeCompare(b.what));
}
function sortTodos(items) {
    return items.slice().sort((a, b)=>Number(b.overdue) - Number(a.overdue) || a.sortDate.localeCompare(b.sortDate) || a.prio - b.prio || a.createdAt - b.createdAt);
}
function weekRangeLabel(weekStart) {
    const end = (0, _dates.addDaysKey)(weekStart, 6);
    const mon = (k)=>(0, _dates.dayMonth)((0, _dates.dateOnly)(k)).split(' ')[1];
    return mon(weekStart) === mon(end) ? `${+weekStart.slice(8)}–${+end.slice(8)} ${mon(end)}` : `${+weekStart.slice(8)} ${mon(weekStart)} – ${+end.slice(8)} ${mon(end)}`;
}
function reviewLink(rows) {
    if (!rows?.length) return null;
    return (rows.find((r)=>r.count > 0) ?? rows[0]).link;
}
function taskLink(t) {
    const q = new URLSearchParams({
        project: t.projectId,
        ...t.departmentId ? {
            board: t.departmentId
        } : {},
        task: t.id
    });
    return `/board?${q.toString()}`;
}
function titleLine(designation, department) {
    const d = (designation ?? '').trim();
    const dep = (department ?? '').trim();
    if (!dep || dep.toLowerCase() === 'management' || d.toLowerCase().includes(dep.toLowerCase())) return d;
    return d ? `${d} · ${dep}` : dep;
}
function approvalsFor(roleKey, rows) {
    if (!rows.length) return null;
    if (roleKey === 'employee' && !rows.some((r)=>r.count > 0)) return null;
    return rows;
}

//# sourceMappingURL=dashboard.rules.js.map