/**
 * Date helpers for the time domain. Business dates are IST calendar days stored in
 * `@db.Date` columns as UTC midnight of that IST date. IST has no DST (+05:30 fixed).
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
    get DOW_SHORT () {
        return DOW_SHORT;
    },
    get IST_OFFSET_MIN () {
        return IST_OFFSET_MIN;
    },
    get addDays () {
        return addDays;
    },
    get dateOf () {
        return dateOf;
    },
    get dayLabel () {
        return dayLabel;
    },
    get daysBetween () {
        return daysBetween;
    },
    get dm () {
        return dm;
    },
    get dowOf () {
        return dowOf;
    },
    get fmtMinute () {
        return fmtMinute;
    },
    get hm () {
        return hm;
    },
    get istHm () {
        return istHm;
    },
    get istInstant () {
        return istInstant;
    },
    get istKeyOf () {
        return istKeyOf;
    },
    get istMinuteOf () {
        return istMinuteOf;
    },
    get keyOf () {
        return keyOf;
    },
    get minutesBetween () {
        return minutesBetween;
    },
    get mondayOf () {
        return mondayOf;
    },
    get monthOf () {
        return monthOf;
    },
    get monthRange () {
        return monthRange;
    },
    get parseHm () {
        return parseHm;
    },
    get prevMonth () {
        return prevMonth;
    },
    get shortDur () {
        return shortDur;
    },
    get weekLabel () {
        return weekLabel;
    },
    get weeklyOffLabel () {
        return weeklyOffLabel;
    }
});
const IST_OFFSET_MIN = 330;
const DAY_MS = 86_400_000;
const DOW_SHORT = [
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat'
];
const MON_SHORT = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
];
function dateOf(key) {
    return new Date(`${key}T00:00:00.000Z`);
}
function keyOf(d) {
    return d.toISOString().slice(0, 10);
}
function istKeyOf(instant) {
    return keyOf(new Date(instant.getTime() + IST_OFFSET_MIN * 60_000));
}
function istMinuteOf(instant) {
    const ms = (instant.getTime() + IST_OFFSET_MIN * 60_000) % DAY_MS;
    return Math.floor(ms / 60_000);
}
function istInstant(key, minute) {
    return new Date(dateOf(key).getTime() + (minute - IST_OFFSET_MIN) * 60_000);
}
function parseHm(hm) {
    const [h, m] = hm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
}
function fmtMinute(min) {
    const m = (Math.round(min) % 1440 + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function istHm(instant) {
    if (!instant) return null;
    return fmtMinute(istMinuteOf(instant));
}
function addDays(key, n) {
    return keyOf(new Date(dateOf(key).getTime() + n * DAY_MS));
}
function dowOf(key) {
    return dateOf(key).getUTCDay();
}
function mondayOf(key) {
    const dow = dowOf(key);
    return addDays(key, dow === 0 ? -6 : 1 - dow);
}
function daysBetween(from, to) {
    const out = [];
    for(let k = from; k <= to; k = addDays(k, 1))out.push(k);
    return out;
}
function monthOf(key) {
    return key.slice(0, 7);
}
function monthRange(month) {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
        from: `${month}-01`,
        to: `${month}-${String(last).padStart(2, '0')}`
    };
}
function prevMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
function dayLabel(key) {
    const d = dateOf(key);
    return `${DOW_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MON_SHORT[d.getUTCMonth()]}`;
}
function dm(key) {
    const d = dateOf(key);
    return `${d.getUTCDate()} ${MON_SHORT[d.getUTCMonth()]}`;
}
function weekLabel(from, to, short = false) {
    const a = dateOf(from);
    const b = dateOf(to);
    const sameMonth = a.getUTCMonth() === b.getUTCMonth();
    const left = sameMonth ? `${a.getUTCDate()}` : `${a.getUTCDate()} ${MON_SHORT[a.getUTCMonth()]}`;
    const right = `${b.getUTCDate()} ${MON_SHORT[b.getUTCMonth()]}`;
    return short ? `${left}–${right}` : `${left} – ${right} ${b.getUTCFullYear()}`;
}
function hm(minutes) {
    const m = Math.max(0, Math.round(minutes));
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
function shortDur(minutes) {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60) return `${m}m`;
    return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
}
function weeklyOffLabel(days) {
    const order = [
        1,
        2,
        3,
        4,
        5,
        6,
        0
    ];
    const s = order.filter((d)=>days.includes(d)).map((d)=>DOW_SHORT[d]);
    return s.length ? s.join(', ') : 'None';
}
function minutesBetween(a, b) {
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}

//# sourceMappingURL=time-utils.js.map