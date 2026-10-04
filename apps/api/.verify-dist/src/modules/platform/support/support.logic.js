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
    get BUSINESS_DAY_MIN () {
        return BUSINESS_DAY_MIN;
    },
    get BUSINESS_END_MIN () {
        return BUSINESS_END_MIN;
    },
    get BUSINESS_START_MIN () {
        return BUSINESS_START_MIN;
    },
    get PLATFORM_STATUS_FLOW () {
        return PLATFORM_STATUS_FLOW;
    },
    get REOPEN_WINDOW_DAYS () {
        return REOPEN_WINDOW_DAYS;
    },
    get addBusinessMinutes () {
        return addBusinessMinutes;
    },
    get canReopen () {
        return canReopen;
    },
    get canTransition () {
        return canTransition;
    },
    get firstResponseDue () {
        return firstResponseDue;
    },
    get isOpenStatus () {
        return isOpenStatus;
    },
    get slaBreached () {
        return slaBreached;
    },
    get slaHint () {
        return slaHint;
    },
    get slaPolicy () {
        return slaPolicy;
    },
    get statusAfterCustomerReply () {
        return statusAfterCustomerReply;
    }
});
/**
 * Lexisora support SLAs (spec M13). Business hours are Mon–Sat 09:00–19:00 IST; Enterprise
 * (and the operator's internal workspace) get 24/7 wall-clock targets for High / Medium.
 */ const MIN = 60_000;
const IST_OFFSET = 330 * MIN;
const BUSINESS_START_MIN = 9 * 60;
const BUSINESS_END_MIN = 19 * 60;
const BUSINESS_DAY_MIN = BUSINESS_END_MIN - BUSINESS_START_MIN;
function addBusinessMinutes(from, minutes) {
    let t = from.getTime();
    let left = minutes;
    for(let guard = 0; left > 0 && guard < 10_000; guard++){
        const ist = new Date(t + IST_OFFSET);
        const dow = ist.getUTCDay();
        const minOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes() + ist.getUTCSeconds() / 60 + ist.getUTCMilliseconds() / 60_000;
        if (dow === 0 || minOfDay >= BUSINESS_END_MIN) {
            // Jump to 00:00 IST of the next day.
            t += (24 * 60 - minOfDay) * MIN;
            continue;
        }
        if (minOfDay < BUSINESS_START_MIN) {
            t += (BUSINESS_START_MIN - minOfDay) * MIN;
            continue;
        }
        const use = Math.min(BUSINESS_END_MIN - minOfDay, left);
        t += use * MIN;
        left -= use;
    }
    return new Date(Math.round(t));
}
function slaPolicy(plan, severity) {
    const p = plan.toUpperCase();
    if (p === 'ENTERPRISE' || p === 'INTERNAL') {
        if (severity === 'HIGH') return {
            minutes: 60,
            business: false,
            label: '1 hour'
        };
        if (severity === 'MEDIUM') return {
            minutes: 240,
            business: false,
            label: '4 hours'
        };
        return {
            minutes: BUSINESS_DAY_MIN,
            business: true,
            label: '1 business day'
        };
    }
    if (p === 'GROWTH') {
        if (severity === 'HIGH') return {
            minutes: 240,
            business: true,
            label: '4 business hours'
        };
        if (severity === 'MEDIUM') return {
            minutes: BUSINESS_DAY_MIN,
            business: true,
            label: '1 business day'
        };
        return {
            minutes: 3 * BUSINESS_DAY_MIN,
            business: true,
            label: '3 business days'
        };
    }
    return {
        minutes: 3 * BUSINESS_DAY_MIN,
        business: true,
        label: '3 business days (best effort)'
    };
}
function firstResponseDue(plan, severity, openedAt) {
    const p = slaPolicy(plan, severity);
    return p.business ? addBusinessMinutes(openedAt, p.minutes) : new Date(openedAt.getTime() + p.minutes * MIN);
}
function slaHint(plan) {
    const p = plan.toUpperCase();
    if (p === 'ENTERPRISE' || p === 'INTERNAL') return 'Priority 24/7 support · High-severity requests get a first response within 1 hour.';
    if (p === 'GROWTH') return 'Growth plan · first response within 4 business hours for High severity, 1 business day for Medium (Mon–Sat, 09:00–19:00 IST).';
    return 'Free plan · billing and account requests are answered within 3 business days. Upgrade to Growth for technical support SLAs.';
}
function slaBreached(t, now = new Date()) {
    if (t.firstRespondedAt) return t.firstRespondedAt > t.firstResponseDueAt;
    if (t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
    return now > t.firstResponseDueAt;
}
const REOPEN_WINDOW_DAYS = 7;
function canReopen(t, now = new Date()) {
    if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') return false;
    if (!t.resolvedAt) return false;
    return now.getTime() - t.resolvedAt.getTime() <= REOPEN_WINDOW_DAYS * 86_400_000;
}
function statusAfterCustomerReply(s) {
    return s === 'WAITING_ON_CUSTOMER' ? 'IN_PROGRESS' : s;
}
const PLATFORM_STATUS_FLOW = {
    OPEN: [
        'ENGINEER_ASSIGNED',
        'IN_PROGRESS',
        'WAITING_ON_CUSTOMER',
        'RESOLVED'
    ],
    ENGINEER_ASSIGNED: [
        'IN_PROGRESS',
        'WAITING_ON_CUSTOMER',
        'RESOLVED'
    ],
    IN_PROGRESS: [
        'WAITING_ON_CUSTOMER',
        'RESOLVED'
    ],
    WAITING_ON_CUSTOMER: [
        'IN_PROGRESS',
        'RESOLVED'
    ],
    RESOLVED: [
        'IN_PROGRESS',
        'CLOSED'
    ],
    CLOSED: []
};
function canTransition(from, to) {
    return PLATFORM_STATUS_FLOW[from].includes(to);
}
const isOpenStatus = (s)=>s !== 'RESOLVED' && s !== 'CLOSED';

//# sourceMappingURL=support.logic.js.map