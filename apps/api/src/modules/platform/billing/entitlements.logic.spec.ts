import { describe, expect, it } from 'vitest';
import { consumesSeat, hasFreeSeat, readOnlyBlocks, readOnlyExempt, routePath, seatBlocks, seatLimit, seatLimitMessage } from './entitlements.logic';

describe('routePath', () => {
  it('strips the API prefix, query string and trailing slash', () => {
    expect(routePath('/api/v1/employees/abc/invite?x=1')).toBe('/employees/abc/invite');
    expect(routePath('/api/v1/leave/requests/')).toBe('/leave/requests');
    expect(routePath('/api/v1')).toBe('/');
    expect(routePath('/employees')).toBe('/employees');
  });
  it('does not strip look-alike prefixes', () => {
    expect(routePath('/api/v10/x')).toBe('/api/v10/x');
  });
});

describe('READ_ONLY workspaces (spec M10: writes → 423 except the exempt routes)', () => {
  it('blocks ordinary writes', () => {
    expect(readOnlyBlocks('POST', '/leave/requests', 'READ_ONLY')).toBe(true);
    expect(readOnlyBlocks('PATCH', '/employees/e1', 'READ_ONLY')).toBe(true);
    expect(readOnlyBlocks('DELETE', '/tasks/t1', 'READ_ONLY')).toBe(true);
  });
  it('never blocks reads', () => {
    expect(readOnlyBlocks('GET', '/leave/requests', 'READ_ONLY')).toBe(false);
    expect(readOnlyBlocks('HEAD', '/employees', 'READ_ONLY')).toBe(false);
  });
  it('keeps sign-in, billing, support, alerts, punches and tracker ingest working', () => {
    for (const p of ['/auth/login', '/auth/refresh', '/billing/checkout', '/billing/invoices/i1/pay', '/billing/webhooks/razorpay', '/support/tickets', '/notifications/n1/read', '/notifications/read-all', '/attendance/me/punch', '/tracker/sync', '/tracker/punch', '/tracker/screenshots', '/tracker/heartbeat']) {
      expect(readOnlyExempt(p), p).toBe(true);
      expect(readOnlyBlocks('POST', p, 'READ_ONLY'), p).toBe(false);
    }
  });
  it('matches exempt prefixes on path segments only', () => {
    expect(readOnlyExempt('/billingx')).toBe(false);
    expect(readOnlyExempt('/tracker/idle-claims/c1/decide')).toBe(false);
    expect(readOnlyExempt('/attendance/regularizations')).toBe(false);
  });
  it('does nothing for other statuses', () => {
    for (const s of ['ACTIVE', 'PAST_DUE', 'FREE', 'SUSPENDED', null, undefined]) expect(readOnlyBlocks('POST', '/leave/requests', s)).toBe(false);
  });
});

describe('seat gate (402 SEAT_LIMIT)', () => {
  it('applies to creating, inviting and importing employees only', () => {
    expect(consumesSeat('POST', '/employees')).toBe(true);
    expect(consumesSeat('POST', '/employees/e1/invite')).toBe(true);
    expect(consumesSeat('POST', '/employees/import/b1/commit')).toBe(true);
    expect(consumesSeat('POST', '/employees/import')).toBe(false);
    expect(consumesSeat('PATCH', '/employees/e1')).toBe(false);
    expect(consumesSeat('POST', '/employees/e1/exit')).toBe(false);
    expect(consumesSeat('GET', '/employees')).toBe(false);
  });
  it('Free: the first 10 users are free, the 11th is refused', () => {
    const free = { planCode: 'FREE', quantity: 10 };
    expect(seatLimit(free)).toBe(10);
    expect(hasFreeSeat(free, 9)).toBe(true);
    expect(hasFreeSeat(free, 10)).toBe(false);
    expect(seatBlocks('POST', '/employees', free, 10)).toBe(true);
    expect(seatLimitMessage(free)).toMatch(/All 10 seats on the Free plan are in use/);
  });
  it('Growth / Enterprise: up to the purchased seats', () => {
    const growth = { planCode: 'GROWTH', quantity: 50 };
    expect(hasFreeSeat(growth, 49)).toBe(true);
    expect(hasFreeSeat(growth, 50)).toBe(false);
    expect(seatLimitMessage(growth)).toBe('All 50 seats are in use. Add seats in Subscription.');
    expect(hasFreeSeat({ planCode: 'ENTERPRISE', quantity: 250 }, 249)).toBe(true);
  });
  it('never limits the operator workspace or a tenant without a subscription', () => {
    expect(seatLimit({ planCode: 'INTERNAL', quantity: 10 })).toBeNull();
    expect(hasFreeSeat({ planCode: 'INTERNAL', quantity: 10 }, 500)).toBe(true);
    expect(hasFreeSeat(null, 500)).toBe(true);
    expect(seatBlocks('POST', '/employees', undefined, 500)).toBe(false);
  });
});
