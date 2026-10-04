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
    get dateKey () {
        return dateKey;
    },
    get dateOnly () {
        return dateOnly;
    },
    get hoursOf () {
        return hoursOf;
    },
    get iso () {
        return iso;
    },
    get istMinuteOfDay () {
        return istMinuteOfDay;
    },
    get monthRange () {
        return monthRange;
    },
    get monthYearLabel () {
        return monthYearLabel;
    },
    get todayDate () {
        return todayDate;
    },
    get todayKey () {
        return todayKey;
    }
});
const _shared = require("@lexisora/shared");
function dateOnly(key) {
    return new Date(`${key}T00:00:00Z`);
}
function dateKey(d) {
    return d ? d.toISOString().slice(0, 10) : null;
}
function todayKey() {
    return (0, _shared.istDateKey)(new Date());
}
function todayDate() {
    return dateOnly(todayKey());
}
const hoursOf = (min)=>min == null ? null : Math.round(min / 60 * 100) / 100;
function monthRange(month) {
    const [y, m] = month.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    const label = start.toLocaleString('en-US', {
        month: 'short',
        timeZone: 'UTC'
    });
    return {
        start,
        end,
        label
    };
}
function monthYearLabel(d) {
    if (!d) return '—';
    return d.toLocaleString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata'
    });
}
function istMinuteOfDay(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(now);
    const h = Number(parts.find((p)=>p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p)=>p.type === 'minute')?.value ?? 0);
    return h * 60 + m;
}
const iso = (d)=>d ? d.toISOString() : null;

//# sourceMappingURL=work.util.js.map