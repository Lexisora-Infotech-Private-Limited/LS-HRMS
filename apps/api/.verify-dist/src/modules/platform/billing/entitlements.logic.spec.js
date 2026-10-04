"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _entitlementslogic = require("./entitlements.logic");
(0, _vitest.describe)('routePath', ()=>{
    (0, _vitest.it)('strips the API prefix, query string and trailing slash', ()=>{
        (0, _vitest.expect)((0, _entitlementslogic.routePath)('/api/v1/employees/abc/invite?x=1')).toBe('/employees/abc/invite');
        (0, _vitest.expect)((0, _entitlementslogic.routePath)('/api/v1/leave/requests/')).toBe('/leave/requests');
        (0, _vitest.expect)((0, _entitlementslogic.routePath)('/api/v1')).toBe('/');
        (0, _vitest.expect)((0, _entitlementslogic.routePath)('/employees')).toBe('/employees');
    });
    (0, _vitest.it)('does not strip look-alike prefixes', ()=>{
        (0, _vitest.expect)((0, _entitlementslogic.routePath)('/api/v10/x')).toBe('/api/v10/x');
    });
});
(0, _vitest.describe)('READ_ONLY workspaces (spec M10: writes → 423 except the exempt routes)', ()=>{
    (0, _vitest.it)('blocks ordinary writes', ()=>{
        (0, _vitest.expect)((0, _entitlementslogic.readOnlyBlocks)('POST', '/leave/requests', 'READ_ONLY')).toBe(true);
        (0, _vitest.expect)((0, _entitlementslogic.readOnlyBlocks)('PATCH', '/employees/e1', 'READ_ONLY')).toBe(true);
        (0, _vitest.expect)((0, _entitlementslogic.readOnlyBlocks)('DELETE', '/tasks/t1', 'READ_ONLY')).toBe(true);
    });
    (0, _vitest.it)('never blocks reads', ()=>{
        (0, _vitest.expect)((0, _entitlementslogic.readOnlyBlocks)('GET', '/leave/requests', 'READ_ONLY')).toBe(false);
        (0, _vitest.expect)((0, _entitlementslogic.readOnlyBlocks)('HEAD', '/employees', 'READ_ONLY')).toBe(false);
    });
    (0, _vitest.it)('keeps sign-in, billing, support, alerts, punches and tracker ingest working', ()=>{
        for (const p of [
            '/auth/login',
            '/auth/refresh',
            '/billing/checkout',
            '/billing/invoices/i1/pay',
            '/billing/webhooks/razorpay',
            '/support/tickets',
            '/notifications/n1/read',
            '/notifications/read-all',
            '/attendance/me/punch',
            '/tracker/sync',
            '/tracker/punch',
            '/tracker/screenshots',
            '/tracker/heartbeat'
        ]){
            (0, _vitest.expect)((0, _entitlementslogic.readOnlyExempt)(p), p).toBe(true);
            (0, _vitest.expect)((0, _entitlementslogic.readOnlyBlocks)('POST', p, 'READ_ONLY'), p).toBe(false);
        }
    });
    (0, _vitest.it)('matches exempt prefixes on path segments only', ()=>{
        (0, _vitest.expect)((0, _entitlementslogic.readOnlyExempt)('/billingx')).toBe(false);
        (0, _vitest.expect)((0, _entitlementslogic.readOnlyExempt)('/tracker/idle-claims/c1/decide')).toBe(false);
        (0, _vitest.expect)((0, _entitlementslogic.readOnlyExempt)('/attendance/regularizations')).toBe(false);
    });
    (0, _vitest.it)('does nothing for other statuses', ()=>{
        for (const s of [
            'ACTIVE',
            'PAST_DUE',
            'FREE',
            'SUSPENDED',
            null,
            undefined
        ])(0, _vitest.expect)((0, _entitlementslogic.readOnlyBlocks)('POST', '/leave/requests', s)).toBe(false);
    });
});
(0, _vitest.describe)('seat gate (402 SEAT_LIMIT)', ()=>{
    (0, _vitest.it)('applies to creating, inviting and importing employees only', ()=>{
        (0, _vitest.expect)((0, _entitlementslogic.consumesSeat)('POST', '/employees')).toBe(true);
        (0, _vitest.expect)((0, _entitlementslogic.consumesSeat)('POST', '/employees/e1/invite')).toBe(true);
        (0, _vitest.expect)((0, _entitlementslogic.consumesSeat)('POST', '/employees/import/b1/commit')).toBe(true);
        (0, _vitest.expect)((0, _entitlementslogic.consumesSeat)('POST', '/employees/import')).toBe(false);
        (0, _vitest.expect)((0, _entitlementslogic.consumesSeat)('PATCH', '/employees/e1')).toBe(false);
        (0, _vitest.expect)((0, _entitlementslogic.consumesSeat)('POST', '/employees/e1/exit')).toBe(false);
        (0, _vitest.expect)((0, _entitlementslogic.consumesSeat)('GET', '/employees')).toBe(false);
    });
    (0, _vitest.it)('Free: the first 10 users are free, the 11th is refused', ()=>{
        const free = {
            planCode: 'FREE',
            quantity: 10
        };
        (0, _vitest.expect)((0, _entitlementslogic.seatLimit)(free)).toBe(10);
        (0, _vitest.expect)((0, _entitlementslogic.hasFreeSeat)(free, 9)).toBe(true);
        (0, _vitest.expect)((0, _entitlementslogic.hasFreeSeat)(free, 10)).toBe(false);
        (0, _vitest.expect)((0, _entitlementslogic.seatBlocks)('POST', '/employees', free, 10)).toBe(true);
        (0, _vitest.expect)((0, _entitlementslogic.seatLimitMessage)(free)).toMatch(/All 10 seats on the Free plan are in use/);
    });
    (0, _vitest.it)('Growth / Enterprise: up to the purchased seats', ()=>{
        const growth = {
            planCode: 'GROWTH',
            quantity: 50
        };
        (0, _vitest.expect)((0, _entitlementslogic.hasFreeSeat)(growth, 49)).toBe(true);
        (0, _vitest.expect)((0, _entitlementslogic.hasFreeSeat)(growth, 50)).toBe(false);
        (0, _vitest.expect)((0, _entitlementslogic.seatLimitMessage)(growth)).toBe('All 50 seats are in use. Add seats in Subscription.');
        (0, _vitest.expect)((0, _entitlementslogic.hasFreeSeat)({
            planCode: 'ENTERPRISE',
            quantity: 250
        }, 249)).toBe(true);
    });
    (0, _vitest.it)('never limits the operator workspace or a tenant without a subscription', ()=>{
        (0, _vitest.expect)((0, _entitlementslogic.seatLimit)({
            planCode: 'INTERNAL',
            quantity: 10
        })).toBeNull();
        (0, _vitest.expect)((0, _entitlementslogic.hasFreeSeat)({
            planCode: 'INTERNAL',
            quantity: 10
        }, 500)).toBe(true);
        (0, _vitest.expect)((0, _entitlementslogic.hasFreeSeat)(null, 500)).toBe(true);
        (0, _vitest.expect)((0, _entitlementslogic.seatBlocks)('POST', '/employees', undefined, 500)).toBe(false);
    });
});

//# sourceMappingURL=entitlements.logic.spec.js.map