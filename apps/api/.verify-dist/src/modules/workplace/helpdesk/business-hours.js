/**
 * Business-hours arithmetic for helpdesk SLAs (spec §6.4): Mon–Fri 09:30–18:30 in the tenant
 * time zone (IST), excluding tenant holidays. Pure functions — no I/O, so they are unit tested.
 *
 * Instants are shifted into "local wall clock" milliseconds (UTC getters then read IST), the
 * walk happens day by day, and results are shifted back to real instants.
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
    get DEFAULT_CALENDAR () {
        return DEFAULT_CALENDAR;
    },
    get addBusinessMinutes () {
        return addBusinessMinutes;
    },
    get businessMinutesBetween () {
        return businessMinutesBetween;
    },
    get calendarWith () {
        return calendarWith;
    },
    get dayLength () {
        return dayLength;
    },
    get isBusinessDay () {
        return isBusinessDay;
    },
    get nextBusinessOpen () {
        return nextBusinessOpen;
    }
});
const DEFAULT_CALENDAR = {
    startMin: 570,
    endMin: 1110,
    workDays: [
        1,
        2,
        3,
        4,
        5
    ],
    holidays: new Set(),
    offsetMin: 330
};
const MIN = 60_000;
const DAY = 86_400_000;
function calendarWith(holidays, base = {}) {
    return {
        ...DEFAULT_CALENDAR,
        ...base,
        holidays: new Set(holidays)
    };
}
const toLocal = (d, cal)=>d.getTime() + cal.offsetMin * MIN;
const fromLocal = (ms, cal)=>new Date(ms - cal.offsetMin * MIN);
const midnight = (localMs)=>Math.floor(localMs / DAY) * DAY;
const keyOfLocal = (localMs)=>new Date(midnight(localMs)).toISOString().slice(0, 10);
function isBusinessDay(localMidnightMs, cal) {
    const dow = new Date(localMidnightMs).getUTCDay();
    return cal.workDays.includes(dow) && !cal.holidays.has(keyOfLocal(localMidnightMs));
}
const dayLength = (cal = DEFAULT_CALENDAR)=>cal.endMin - cal.startMin;
function nextBusinessOpen(at, cal = DEFAULT_CALENDAR) {
    let t = toLocal(at, cal);
    for(let guard = 0; guard < 800; guard++){
        const day = midnight(t);
        const open = day + cal.startMin * MIN;
        const close = day + cal.endMin * MIN;
        if (isBusinessDay(day, cal) && t < close) return fromLocal(Math.max(t, open), cal);
        t = day + DAY;
    }
    return at;
}
function addBusinessMinutes(start, minutes, cal = DEFAULT_CALENDAR) {
    let remaining = Math.max(0, minutes) * MIN;
    let t = toLocal(nextBusinessOpen(start, cal), cal);
    for(let guard = 0; guard < 4000; guard++){
        const day = midnight(t);
        if (!isBusinessDay(day, cal)) {
            t = day + DAY + cal.startMin * MIN;
            continue;
        }
        const open = day + cal.startMin * MIN;
        const close = day + cal.endMin * MIN;
        if (t < open) t = open;
        if (t >= close) {
            t = day + DAY + cal.startMin * MIN;
            continue;
        }
        const avail = close - t;
        if (remaining <= avail) return fromLocal(t + remaining, cal);
        remaining -= avail;
        t = day + DAY + cal.startMin * MIN;
    }
    return fromLocal(t, cal);
}
function businessMinutesBetween(from, to, cal = DEFAULT_CALENDAR) {
    const a = toLocal(from, cal);
    const b = toLocal(to, cal);
    if (b <= a) return 0;
    let total = 0;
    for(let day = midnight(a), guard = 0; day <= b && guard < 4000; day += DAY, guard++){
        if (!isBusinessDay(day, cal)) continue;
        const open = day + cal.startMin * MIN;
        const close = day + cal.endMin * MIN;
        const s = Math.max(a, open);
        const e = Math.min(b, close);
        if (e > s) total += e - s;
    }
    return Math.floor(total / MIN);
}

//# sourceMappingURL=business-hours.js.map