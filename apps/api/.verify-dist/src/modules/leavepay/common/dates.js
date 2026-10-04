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
    get MONTHS_LONG () {
        return MONTHS_LONG;
    },
    get MONTHS_SHORT () {
        return MONTHS_SHORT;
    },
    get addDays () {
        return addDays;
    },
    get dayMonth () {
        return dayMonth;
    },
    get dd () {
        return dd;
    },
    get diffDays () {
        return diffDays;
    },
    get dk () {
        return dk;
    },
    get dow () {
        return dow;
    },
    get eachDay () {
        return eachDay;
    },
    get fyMonthsElapsed () {
        return fyMonthsElapsed;
    },
    get fyMonthsRemaining () {
        return fyMonthsRemaining;
    },
    get fyPriorPeriods () {
        return fyPriorPeriods;
    },
    get fyStartYear () {
        return fyStartYear;
    },
    get maxKey () {
        return maxKey;
    },
    get minKey () {
        return minKey;
    },
    get monthBounds () {
        return monthBounds;
    },
    get monthOf () {
        return monthOf;
    },
    get nextPeriod () {
        return nextPeriod;
    },
    get periodLabel () {
        return periodLabel;
    },
    get periodOf () {
        return periodOf;
    },
    get prevPeriod () {
        return prevPeriod;
    },
    get rangeLabel () {
        return rangeLabel;
    },
    get todayKey () {
        return todayKey;
    },
    get yearOf () {
        return yearOf;
    }
});
const _shared = require("@lexisora/shared");
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
const MONTHS_LONG = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
];
function dk(d) {
    if (typeof d === 'string') return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
}
function dd(key) {
    return new Date(`${key.slice(0, 10)}T00:00:00.000Z`);
}
function addDays(key, n) {
    const d = dd(key);
    d.setUTCDate(d.getUTCDate() + n);
    return dk(d);
}
function diffDays(a, b) {
    return Math.round((dd(a).getTime() - dd(b).getTime()) / 86_400_000);
}
function dow(key) {
    return dd(key).getUTCDay();
}
function eachDay(from, to) {
    const out = [];
    for(let k = from; k <= to; k = addDays(k, 1))out.push(k);
    return out;
}
function todayKey(now = new Date()) {
    return (0, _shared.istDateKey)(now);
}
function yearOf(key) {
    return Number(key.slice(0, 4));
}
function monthOf(key) {
    return Number(key.slice(5, 7));
}
function periodOf(key) {
    return key.slice(0, 7);
}
function monthBounds(period) {
    const [y, m] = period.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return {
        start,
        end,
        year: y,
        month: m,
        days: last
    };
}
function prevPeriod(period) {
    const [y, m] = period.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
function nextPeriod(period) {
    const [y, m] = period.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
function periodLabel(period, long = false) {
    const [y, m] = period.split('-').map(Number);
    return `${(long ? MONTHS_LONG : MONTHS_SHORT)[m - 1]} ${y}`;
}
function dayMonth(key) {
    return `${Number(key.slice(8, 10))} ${MONTHS_SHORT[monthOf(key) - 1]}`;
}
function rangeLabel(from, to) {
    if (from === to) return dayMonth(from);
    if (periodOf(from) === periodOf(to)) return `${Number(from.slice(8, 10))} – ${dayMonth(to)}`;
    return `${dayMonth(from)} – ${dayMonth(to)}`;
}
function fyStartYear(key) {
    const y = yearOf(key);
    return monthOf(key) >= 4 ? y : y - 1;
}
function fyMonthsRemaining(period) {
    const m = Number(period.slice(5, 7));
    return m >= 4 ? 12 - (m - 4) : 4 - m;
}
function fyMonthsElapsed(period) {
    return 12 - fyMonthsRemaining(period);
}
function fyPriorPeriods(period) {
    const out = [];
    let p = period;
    for(let i = 0; i < fyMonthsElapsed(period); i++){
        p = prevPeriod(p);
        out.unshift(p);
    }
    return out;
}
const minKey = (a, b)=>a < b ? a : b;
const maxKey = (a, b)=>a > b ? a : b;

//# sourceMappingURL=dates.js.map