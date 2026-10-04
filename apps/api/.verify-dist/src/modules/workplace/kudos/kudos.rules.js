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
    get eotmEligible () {
        return eotmEligible;
    },
    get eotmMonthError () {
        return eotmMonthError;
    },
    get eotmMonthOptions () {
        return eotmMonthOptions;
    },
    get eotmPostBody () {
        return eotmPostBody;
    },
    get kudosLimitError () {
        return kudosLimitError;
    },
    get kudosPostBody () {
        return kudosPostBody;
    },
    get kudosPostTitle () {
        return kudosPostTitle;
    },
    get monthOf () {
        return monthOf;
    },
    get shiftMonth () {
        return shiftMonth;
    },
    get shortName () {
        return shortName;
    },
    get topBadge () {
        return topBadge;
    }
});
const _shared = require("@lexisora/shared");
const DAY = 86_400_000;
function kudosLimitError(i) {
    if (i.giverId === i.recipientId) return {
        status: 422,
        code: 'KUDOS_SELF',
        message: 'You can’t give kudos to yourself'
    };
    const since = (days)=>i.now.getTime() - days * DAY;
    const window = i.recent.filter((k)=>k.createdAt.getTime() >= since(_shared.KUDOS_LIMITS.windowDays));
    if (i.recent.some((k)=>k.recipientEmployeeId === i.recipientId && k.badgeId === i.badgeId && k.createdAt.getTime() >= since(_shared.KUDOS_LIMITS.sameBadgeDays))) {
        return {
            status: 429,
            code: 'KUDOS_LIMIT',
            message: `You already gave ${i.recipientName} this badge in the last ${_shared.KUDOS_LIMITS.sameBadgeDays} days`
        };
    }
    if (window.length >= _shared.KUDOS_LIMITS.maxPerWindow) return {
        status: 429,
        code: 'KUDOS_LIMIT',
        message: `You can give up to ${_shared.KUDOS_LIMITS.maxPerWindow} kudos a week`
    };
    return null;
}
const monthOf = (key)=>key.slice(0, 7);
function shiftMonth(month, delta) {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7)) - 1 + delta;
    const d = new Date(Date.UTC(y, m, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function eotmMonthOptions(todayKey) {
    const cur = monthOf(todayKey);
    return [
        cur,
        shiftMonth(cur, -1),
        shiftMonth(cur, -2)
    ];
}
function eotmMonthError(month, todayKey) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return {
        status: 422,
        code: 'EOTM_MONTH',
        message: 'Pick a month'
    };
    if (month > monthOf(todayKey)) return {
        status: 422,
        code: 'EOTM_FUTURE',
        message: 'Employee of the Month can’t be announced for a future month'
    };
    if (!eotmMonthOptions(todayKey).includes(month)) return {
        status: 422,
        code: 'EOTM_MONTH',
        message: 'Pick the current month or one of the previous two'
    };
    return null;
}
function eotmEligible(e, month) {
    if (![
        'ACTIVE',
        'NOTICE_PERIOD'
    ].includes(e.status)) return false;
    const start = new Date(`${month}-01T00:00:00Z`);
    const end = new Date(`${shiftMonth(month, 1)}-01T00:00:00Z`);
    if (e.joiningDate && e.joiningDate.getTime() >= end.getTime()) return false;
    if (e.exitDate && e.exitDate.getTime() < start.getTime()) return false;
    return true;
}
function shortName(full) {
    const parts = full.trim().split(/\s+/);
    if (parts.length < 2) return parts[0] ?? '';
    return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
const kudosPostTitle = (badge, recipient)=>`${badge} → ${recipient}`;
const esc = (s)=>s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function eotmPostBody(citation) {
    return `<p>${esc(citation.trim())}</p><p>The certificate is ready to download.</p>`;
}
function kudosPostBody(message) {
    return `<p>${esc(message.trim())}</p>`;
}
function topBadge(rows) {
    const by = new Map();
    for (const r of rows){
        const x = by.get(r.badge) ?? {
            count: 0,
            last: 0
        };
        x.count++;
        x.last = Math.max(x.last, r.createdAt.getTime());
        by.set(r.badge, x);
    }
    let best = null;
    for (const [name, x] of by)if (!best || x.count > best.count || x.count === best.count && x.last > best.last) best = {
        name,
        ...x
    };
    return best ? {
        name: best.name,
        count: best.count
    } : null;
}

//# sourceMappingURL=kudos.rules.js.map