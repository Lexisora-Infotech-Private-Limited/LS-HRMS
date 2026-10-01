import { describe, expect, it } from 'vitest';
import { createSupportTicketSchema, supportStatusTone, SUPPORT_STATUS_LABELS } from '@lexisora/shared';
import { addBusinessMinutes, canReopen, canTransition, firstResponseDue, slaBreached, slaHint, slaPolicy, statusAfterCustomerReply } from './support.logic';

const ist = (s: string) => new Date(`${s}+05:30`);
const istIso = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16);

describe('Business hours (Mon–Sat 09:00–19:00 IST)', () => {
  it('adds within the same day', () => {
    // Tue 29 Sep 2026 10:12 + 4 business hours → 14:12 (SUP-221, High on Growth).
    expect(istIso(addBusinessMinutes(ist('2026-09-29T10:12:00'), 240))).toBe('2026-09-29T14:12');
  });
  it('rolls past closing time into the next working day', () => {
    // Tue 17:30 + 4h → 1.5h Tue + 2.5h Wed → Wed 11:30.
    expect(istIso(addBusinessMinutes(ist('2026-09-29T17:30:00'), 240))).toBe('2026-09-30T11:30');
  });
  it('skips Sunday', () => {
    // Sat 3 Oct 18:00 + 4h → 1h Sat + 3h Mon → Mon 5 Oct 12:00.
    expect(istIso(addBusinessMinutes(ist('2026-10-03T18:00:00'), 240))).toBe('2026-10-05T12:00');
  });
  it('a request opened before hours or on Sunday starts the clock at 09:00', () => {
    expect(istIso(addBusinessMinutes(ist('2026-09-29T06:00:00'), 60))).toBe('2026-09-29T10:00');
    expect(istIso(addBusinessMinutes(ist('2026-10-04T12:00:00'), 60))).toBe('2026-10-05T10:00');
  });
});

describe('SLA targets', () => {
  it('Growth: 4 business hours / 1 business day / 3 business days', () => {
    expect(slaPolicy('GROWTH', 'HIGH')).toMatchObject({ minutes: 240, business: true });
    expect(slaPolicy('GROWTH', 'MEDIUM')).toMatchObject({ minutes: 600, label: '1 business day' });
    expect(slaPolicy('GROWTH', 'LOW')).toMatchObject({ minutes: 1800 });
  });
  it('Enterprise / Internal: 24/7 wall clock for High and Medium', () => {
    expect(slaPolicy('ENTERPRISE', 'HIGH')).toMatchObject({ minutes: 60, business: false });
    // Sunday 23:30 + 1 hour wall clock → Monday 00:30.
    expect(istIso(firstResponseDue('ENTERPRISE', 'HIGH', ist('2026-10-04T23:30:00')))).toBe('2026-10-05T00:30');
    expect(slaPolicy('INTERNAL', 'MEDIUM')).toMatchObject({ minutes: 240, business: false });
  });
  it('Free: best effort within 3 business days', () => {
    expect(slaPolicy('FREE', 'HIGH').label).toContain('best effort');
    expect(slaHint('FREE')).toContain('Upgrade to Growth');
    expect(slaHint('GROWTH')).toContain('4 business hours');
  });
  it('breach = no first response by the due time', () => {
    const due = ist('2026-09-29T14:12:00');
    expect(slaBreached({ firstResponseDueAt: due, firstRespondedAt: null, status: 'ENGINEER_ASSIGNED' }, ist('2026-09-29T15:00:00'))).toBe(true);
    expect(slaBreached({ firstResponseDueAt: due, firstRespondedAt: ist('2026-09-29T10:41:00'), status: 'IN_PROGRESS' }, ist('2026-09-30T15:00:00'))).toBe(false);
    expect(slaBreached({ firstResponseDueAt: due, firstRespondedAt: null, status: 'OPEN' }, ist('2026-09-29T11:00:00'))).toBe(false);
  });
});

describe('Ticket lifecycle', () => {
  it('a customer reply on "Waiting on you" moves the ticket back to In progress', () => {
    expect(statusAfterCustomerReply('WAITING_ON_CUSTOMER')).toBe('IN_PROGRESS');
    expect(statusAfterCustomerReply('ENGINEER_ASSIGNED')).toBe('ENGINEER_ASSIGNED');
  });
  it('reopen within 7 days of resolution; after 8 days it is refused', () => {
    const resolvedAt = ist('2026-09-21T15:00:00');
    expect(canReopen({ status: 'RESOLVED', resolvedAt }, ist('2026-09-27T15:00:00'))).toBe(true);
    expect(canReopen({ status: 'CLOSED', resolvedAt }, ist('2026-09-28T14:00:00'))).toBe(true);
    expect(canReopen({ status: 'RESOLVED', resolvedAt }, ist('2026-09-29T15:00:00'))).toBe(false);
    expect(canReopen({ status: 'IN_PROGRESS', resolvedAt: null })).toBe(false);
  });
  it('Lexisora staff transitions follow the state machine', () => {
    expect(canTransition('OPEN', 'ENGINEER_ASSIGNED')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'WAITING_ON_CUSTOMER')).toBe(true);
    expect(canTransition('RESOLVED', 'CLOSED')).toBe(true);
    expect(canTransition('CLOSED', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'OPEN')).toBe(false);
  });
  it('status copy and tones (wireframe: !Engineer assigned, ~Resolved)', () => {
    expect(SUPPORT_STATUS_LABELS.ENGINEER_ASSIGNED).toBe('Engineer assigned');
    expect(SUPPORT_STATUS_LABELS.WAITING_ON_CUSTOMER).toBe('Waiting on you');
    expect(supportStatusTone('ENGINEER_ASSIGNED')).toBe('outline');
    expect(supportStatusTone('RESOLVED')).toBe('accent');
    expect(supportStatusTone('CLOSED')).toBe('neutral');
  });
  it('validates the New support request form', () => {
    expect(createSupportTicketSchema.safeParse({ subject: 'SSO', description: 'x' }).success).toBe(false);
    expect(createSupportTicketSchema.parse({ subject: 'SSO login failing for 3 users', description: 'Since this morning.' })).toMatchObject({ severity: 'MEDIUM', category: 'TECHNICAL' });
  });
});
