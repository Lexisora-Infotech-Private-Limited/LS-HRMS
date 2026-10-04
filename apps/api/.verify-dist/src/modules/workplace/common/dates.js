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
    get DAY_MS () {
        return DAY_MS;
    },
    get IST_OFFSET_MIN () {
        return IST_OFFSET_MIN;
    },
    get MONTHS_SHORT () {
        return MONTHS_SHORT;
    },
    get addDaysKey () {
        return addDaysKey;
    },
    get dateOnly () {
        return dateOnly;
    },
    get dayMonth () {
        return dayMonth;
    },
    get dueLabel () {
        return dueLabel;
    },
    get hhmm () {
        return hhmm;
    },
    get istInstant () {
        return istInstant;
    },
    get istMinuteOfDay () {
        return istMinuteOfDay;
    },
    get keyOf () {
        return keyOf;
    },
    get longDate () {
        return longDate;
    },
    get monthLabel () {
        return monthLabel;
    },
    get shortTime () {
        return shortTime;
    },
    get todayKey () {
        return todayKey;
    },
    get weekStartKey () {
        return weekStartKey;
    },
    get weekdayShort () {
        return weekdayShort;
    }
});
const _shared = require("@lexisora/shared");
const IST_OFFSET_MIN = 330;
const DAY_MS = 86_400_000;
function dateOnly(key) {
    return new Date(`${key}T00:00:00.000Z`);
}
function keyOf(d) {
    return d.toISOString().slice(0, 10);
}
function todayKey(now = new Date()) {
    return (0, _shared.istDateKey)(now);
}
function addDaysKey(key, days) {
    return keyOf(new Date(dateOnly(key).getTime() + days * DAY_MS));
}
function istInstant(key, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(dateOnly(key).getTime() + (h * 60 + m - IST_OFFSET_MIN) * 60_000);
}
function istMinuteOfDay(d) {
    const shifted = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}
const fmt = (opts)=>new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        ...opts
    });
const MONTHS_SHORT = [
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
function longDate(d) {
    const p = fmt({
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    }).formatToParts(d);
    const g = (t)=>p.find((x)=>x.type === t)?.value ?? '';
    return `${g('weekday')}, ${g('day')} ${g('month')} ${g('year')}`;
}
function dayMonth(d) {
    const s = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
    return `${s.getUTCDate()} ${MONTHS_SHORT[s.getUTCMonth()]}`;
}
function weekdayShort(d) {
    return fmt({
        weekday: 'short'
    }).format(d);
}
function hhmm(d) {
    return fmt({
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(d);
}
function shortTime(d) {
    const s = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }).format(d);
    return s.replace(':00', '').replace(' AM', ' am').replace(' PM', ' pm');
}
function monthLabel(month) {
    return new Intl.DateTimeFormat('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(new Date(`${month}-01T00:00:00Z`));
}
function dueLabel(dueKey, today) {
    if (!dueKey) return 'Anytime';
    if (dueKey < today) return 'Overdue';
    if (dueKey === today) return 'Today';
    const diff = Math.round((dateOnly(dueKey).getTime() - dateOnly(today).getTime()) / DAY_MS);
    const d = dateOnly(dueKey);
    if (diff < 7) return new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        timeZone: 'UTC'
    }).format(d);
    return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}
function weekStartKey(key) {
    const d = dateOnly(key);
    const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
    return addDaysKey(key, -dow);
}

//# sourceMappingURL=dates.js.map