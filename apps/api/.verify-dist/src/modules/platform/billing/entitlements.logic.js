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
    get READ_ONLY_MESSAGE () {
        return READ_ONLY_MESSAGE;
    },
    get WRITE_METHODS () {
        return WRITE_METHODS;
    },
    get consumesSeat () {
        return consumesSeat;
    },
    get hasFreeSeat () {
        return hasFreeSeat;
    },
    get readOnlyBlocks () {
        return readOnlyBlocks;
    },
    get readOnlyExempt () {
        return readOnlyExempt;
    },
    get routePath () {
        return routePath;
    },
    get seatBlocks () {
        return seatBlocks;
    },
    get seatLimit () {
        return seatLimit;
    },
    get seatLimitMessage () {
        return seatLimitMessage;
    }
});
const _shared = require("@lexisora/shared");
const _billinglogic = require("./billing.logic");
const WRITE_METHODS = new Set([
    'POST',
    'PUT',
    'PATCH',
    'DELETE'
]);
function routePath(url) {
    let p = (url ?? '').split('?')[0].split('#')[0];
    p = p.replace(/^\/api\/v1(?=\/|$)/, '');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
}
const EXEMPT_PREFIXES = [
    '/auth',
    '/billing',
    '/support',
    '/notifications',
    '/tenants',
    '/attendance/me/punch',
    '/attendance/biometric',
    '/tracker/auth',
    '/tracker/pair',
    '/tracker/punch',
    '/tracker/sync',
    '/tracker/screenshots',
    '/tracker/heartbeat'
];
function readOnlyExempt(path) {
    return EXEMPT_PREFIXES.some((p)=>path === p || path.startsWith(`${p}/`));
}
const SEAT_ROUTES = [
    /^\/employees$/,
    /^\/employees\/[^/]+\/invite$/,
    /^\/employees\/import\/[^/]+\/commit$/
];
function consumesSeat(method, path) {
    return method.toUpperCase() === 'POST' && SEAT_ROUTES.some((r)=>r.test(path));
}
function seatLimit(sub) {
    if (!sub || sub.planCode === 'INTERNAL') return null;
    return sub.planCode === 'FREE' ? _shared.FREE_SEATS : sub.quantity;
}
function hasFreeSeat(sub, used) {
    return !sub || (0, _billinglogic.seatAvailable)(sub.planCode, sub.quantity, used);
}
function seatLimitMessage(sub) {
    if (sub?.planCode === 'FREE') return `All ${_shared.FREE_SEATS} seats on the Free plan are in use. Upgrade to Growth in Subscription & billing to add more people.`;
    return `All ${seatLimit(sub) ?? 0} seats are in use. Add seats in Subscription.`;
}
const READ_ONLY_MESSAGE = 'Your workspace is read-only until the overdue Lexisora invoice is paid. An admin can pay it under SaaS → Subscription.';
function readOnlyBlocks(method, path, status) {
    return status === 'READ_ONLY' && WRITE_METHODS.has(method.toUpperCase()) && !readOnlyExempt(path);
}
function seatBlocks(method, path, sub, used) {
    return consumesSeat(method, path) && !hasFreeSeat(sub, used);
}

//# sourceMappingURL=entitlements.logic.js.map