import { describe, expect, it } from 'vitest';
import { FREE_SEATS, GROWTH_PRICE_PAISE, YEARLY_SAVINGS_PCT, chargeableSeats, planCtas, quoteSchema, seatPeriodPaise, seatUsageCopy, billingProfileSchema } from '@lexisora/shared';
import {
  daysInclusive,
  daysUntil,
  defaultSubscriptionFor,
  discountFor,
  displayedSeats,
  gstSplit,
  invoiceNumber,
  mrrPaise,
  pctChange,
  periodLine,
  planLabel,
  prorationPaise,
  reminderDue,
  roundToRupee,
  seatAvailable,
  seatsBilled,
  totalsFor,
  validatePromo,
  type PromoRecord,
} from './billing.logic';

const ist = (s: string) => new Date(`${s}+05:30`);

describe('Seats & prices', () => {
  it('first 10 users are free on every plan', () => {
    expect(FREE_SEATS).toBe(10);
    expect(chargeableSeats(50)).toBe(40);
    expect(chargeableSeats(10)).toBe(0);
    expect(chargeableSeats(7)).toBe(0);
    expect(chargeableSeats(11)).toBe(1);
  });

  it('Growth costs ₹179 monthly or ₹149 yearly per seat per month — "save 17%"', () => {
    expect(GROWTH_PRICE_PAISE).toEqual({ MONTHLY: 17900, YEARLY: 14900 });
    expect(YEARLY_SAVINGS_PCT).toBe(17);
    expect(seatPeriodPaise('MONTHLY')).toBe(17900);
    expect(seatPeriodPaise('YEARLY')).toBe(178800);
  });

  it('period line charges only the seats above the free 10', () => {
    const y = periodLine('YEARLY', 50);
    expect(y.quantity).toBe(40);
    expect(y.amountPaise).toBe(40 * 178800);
    expect(y.description).toContain('50 seats (first 10 free)');
    expect(periodLine('MONTHLY', 62).amountPaise).toBe(52 * 17900);
  });

  it('subtitle copy', () => {
    expect(seatUsageCopy(42, 50)).toBe('42 of 50 seats used · first 10 users are free on every plan.');
  });

  it('seat gate: Free stops at 10, paid at the purchased seats, Internal never', () => {
    expect(seatAvailable('FREE', 10, 9)).toBe(true);
    expect(seatAvailable('FREE', 10, 10)).toBe(false);
    expect(seatAvailable('GROWTH', 50, 49)).toBe(true);
    expect(seatAvailable('GROWTH', 50, 50)).toBe(false);
    expect(seatAvailable('INTERNAL', 0, 500)).toBe(true);
  });

  it('a workspace without a subscription gets Free — unless it is the operator’s own (Internal, unlimited)', () => {
    expect(defaultSubscriptionFor(false)).toEqual({ planCode: 'FREE', status: 'FREE', quantity: FREE_SEATS, collection: 'GATEWAY' });
    const op = defaultSubscriptionFor(true);
    expect(op).toMatchObject({ planCode: 'INTERNAL', status: 'ACTIVE' });
    // The operator never hits the seat gate, however many people it adds.
    expect(seatAvailable(op.planCode, op.quantity, 128)).toBe(true);
  });

  it('seats shown: Free is fixed at 10, Internal shows its users, paid plans the purchased seats', () => {
    expect(displayedSeats('FREE', 25, 9)).toBe(FREE_SEATS);
    expect(displayedSeats('INTERNAL', FREE_SEATS, 128)).toBe(128);
    expect(displayedSeats('INTERNAL', FREE_SEATS, 4)).toBe(FREE_SEATS);
    expect(displayedSeats('GROWTH', 50, 42)).toBe(50);
  });

  it('Growth checkout needs at least 11 seats', () => {
    expect(quoteSchema.safeParse({ planCode: 'GROWTH', cycle: 'YEARLY', quantity: 10 }).success).toBe(false);
    expect(quoteSchema.parse({ planCode: 'GROWTH', cycle: 'YEARLY', quantity: '11' }).quantity).toBe(11);
  });
});

describe('GST invoices (spec M10 worked examples)', () => {
  it('50 seats, yearly, Gujarat → CGST + SGST → ₹84,394', () => {
    const t = totalsFor([periodLine('YEARLY', 50)], '24');
    expect(t.subtotalPaise).toBe(7_152_000);
    expect(t.cgstPaise).toBe(643_680);
    expect(t.sgstPaise).toBe(643_680);
    expect(t.igstPaise).toBe(0);
    expect(t.roundOffPaise).toBe(40);
    expect(t.totalPaise).toBe(8_439_400);
  });

  it('62 seats, monthly, Maharashtra → IGST → ₹10,983', () => {
    const t = totalsFor([periodLine('MONTHLY', 62)], '27');
    expect(t.taxablePaise).toBe(930_800);
    expect(t.igstPaise).toBe(167_544);
    expect(t.cgstPaise + t.sgstPaise).toBe(0);
    expect(t.roundOffPaise).toBe(-44);
    expect(t.totalPaise).toBe(1_098_300);
  });

  it('intra- vs inter-state split and rupee rounding', () => {
    expect(gstSplit(10_000, '24')).toEqual({ cgst: 900, sgst: 900, igst: 0 });
    expect(gstSplit(10_000, '29')).toEqual({ cgst: 0, sgst: 0, igst: 1800 });
    expect(roundToRupee(1_098_344)).toEqual({ total: 1_098_300, roundOff: -44 });
    expect(roundToRupee(8_439_360)).toEqual({ total: 8_439_400, roundOff: 40 });
  });

  it('a promo discount is applied before GST and shows as its own line', () => {
    const promo = { code: 'DIWALI20', description: '20% off next renewal', percentOff: 20 };
    const t = totalsFor([periodLine('YEARLY', 50)], '24', promo);
    expect(t.discountPaise).toBe(1_430_400);
    expect(t.taxablePaise).toBe(5_721_600);
    expect(t.cgstPaise).toBe(514_944);
    expect(t.lines.at(-1)).toMatchObject({ kind: 'DISCOUNT', amountPaise: -1_430_400 });
    expect(discountFor(1000, { code: 'X', description: '', amountOffPaise: 5000 })).toBe(1000);
  });

  it('invoice numbers: LXS/{FY}/{0000}', () => {
    expect(invoiceNumber('2026-27', 1)).toBe('LXS/26-27/0001');
    expect(invoiceNumber('2026-27', 42)).toBe('LXS/26-27/0042');
  });
});

describe('Seat proration', () => {
  it('yearly, add 5 seats with 182 of 365 days left → ₹4,457.75 + GST', () => {
    expect(prorationPaise(50, 55, 'YEARLY', 182, 365)).toBe(445_775);
  });
  it('only seats above the free 10 are prorated; reductions cost nothing', () => {
    expect(prorationPaise(5, 8, 'YEARLY', 100, 365)).toBe(0);
    expect(prorationPaise(8, 15, 'MONTHLY', 30, 30)).toBe(5 * 17900);
    expect(prorationPaise(50, 40, 'YEARLY', 100, 365)).toBe(0);
  });
  it('days are whole IST days', () => {
    expect(daysInclusive(ist('2026-09-29T10:00:00'), ist('2026-10-12T00:00:00'))).toBe(13);
    expect(daysUntil(ist('2026-10-06T23:00:00'), ist('2026-09-29T08:00:00'))).toBe(7);
  });
});

describe('Promo codes', () => {
  const now = ist('2026-09-29T12:00:00');
  const promo: PromoRecord = { code: 'DIWALI20', active: true, validFrom: ist('2026-09-01T00:00:00'), validUntil: ist('2026-11-30T23:59:59'), planCodes: ['GROWTH'], cycles: [], maxRedemptions: 500, redeemedCount: 3 };
  const base = { now, planCode: 'GROWTH' as const, cycle: 'YEARLY' as const, alreadyRedeemed: false };

  it('valid code', () => expect(validatePromo(promo, base)).toEqual({ ok: true }));
  it('unknown code', () => expect(validatePromo(null, base)).toMatchObject({ ok: false, status: 404, code: 'PROMO_NOT_FOUND' }));
  it('expired or not yet valid', () => {
    expect(validatePromo({ ...promo, validUntil: ist('2026-08-31T23:59:59') }, base)).toMatchObject({ code: 'PROMO_EXPIRED' });
    expect(validatePromo({ ...promo, validFrom: ist('2026-10-01T00:00:00') }, base)).toMatchObject({ code: 'PROMO_EXPIRED' });
    expect(validatePromo({ ...promo, active: false }, base)).toMatchObject({ code: 'PROMO_EXPIRED' });
  });
  it('re-applying the same code → "Already used"', () => {
    expect(validatePromo(promo, { ...base, alreadyRedeemed: true })).toMatchObject({ status: 409, message: 'Already used' });
  });
  it('redemption limit', () => {
    expect(validatePromo({ ...promo, redeemedCount: 500 }, base)).toMatchObject({ code: 'PROMO_EXHAUSTED' });
  });
  it('a Free workspace may hold a Growth promo until it upgrades; other plans are refused', () => {
    expect(validatePromo(promo, { ...base, planCode: 'FREE', cycle: null })).toEqual({ ok: true });
    expect(validatePromo(promo, { ...base, planCode: 'ENTERPRISE' })).toMatchObject({ code: 'PROMO_NOT_FOR_PLAN' });
  });
  it('cycle-restricted codes', () => {
    const monthly = { ...promo, cycles: ['MONTHLY'] };
    expect(validatePromo(monthly, base)).toMatchObject({ code: 'PROMO_NOT_FOR_CYCLE', message: 'This promo code isn’t valid for yearly billing' });
    expect(validatePromo(monthly, { ...base, cycle: 'MONTHLY' })).toEqual({ ok: true });
  });
});

describe('Platform metrics', () => {
  const subs = [
    { planCode: 'GROWTH', cycle: 'YEARLY' as const, status: 'ACTIVE', quantity: 240, unitPaise: 14900 },
    { planCode: 'GROWTH', cycle: 'MONTHLY' as const, status: 'PAST_DUE', quantity: 62, unitPaise: 17900 },
    { planCode: 'FREE', cycle: null, status: 'FREE', quantity: 10 },
    { planCode: 'INTERNAL', cycle: null, status: 'ACTIVE', quantity: 128 },
    { planCode: 'GROWTH', cycle: 'YEARLY' as const, status: 'CANCELLED', quantity: 30 },
    { planCode: 'ENTERPRISE', cycle: null, status: 'ACTIVE', quantity: 400, contractPaisePerYear: 120_000_000 },
  ];
  it('MRR counts active / past-due paid plans; Enterprise as contract ÷ 12; Free, Internal and cancelled are 0', () => {
    expect(mrrPaise(subs)).toBe(230 * 14900 + 52 * 17900 + 10_000_000);
  });
  it('seats billed = purchased seats on paid, billable subscriptions', () => {
    expect(seatsBilled(subs)).toBe(240 + 62 + 400);
  });
  it('Δ% vs 30 days ago', () => {
    expect(pctChange(108, 100)).toBe(8);
    expect(pctChange(100, null)).toBeNull();
  });
  it('plan labels', () => {
    expect(planLabel('GROWTH', 'YEARLY')).toBe('Growth · yearly');
    expect(planLabel('GROWTH', 'MONTHLY')).toBe('Growth · monthly');
    expect(planLabel('FREE', null)).toBe('Free');
    expect(planLabel('INTERNAL', null)).toBe('Internal');
  });
  it('renewal reminders at T-30 (yearly only), T-7 and T-1', () => {
    expect(reminderDue('YEARLY', 30)).toBe(true);
    expect(reminderDue('MONTHLY', 30)).toBe(false);
    expect(reminderDue('MONTHLY', 7)).toBe(true);
    expect(reminderDue('YEARLY', 1)).toBe(true);
    expect(reminderDue('YEARLY', 3)).toBe(false);
  });
});

describe('Plan cards', () => {
  it('Free workspace: Current plan / Upgrade / Contact sales', () => {
    const c = planCtas('FREE');
    expect([c.FREE.label, c.GROWTH.label, c.ENTERPRISE.label]).toEqual(['Current plan', 'Upgrade', 'Contact sales']);
    expect(c.GROWTH.action).toBe('checkout');
    expect(c.FREE.disabled).toBe(true);
  });
  it('Growth workspace: Downgrade / Current plan · renew / Contact sales; a scheduled downgrade can be cancelled', () => {
    const c = planCtas('GROWTH');
    expect([c.FREE.label, c.GROWTH.label, c.ENTERPRISE.label]).toEqual(['Downgrade', 'Current plan · renew', 'Contact sales']);
    expect(planCtas('GROWTH', true).FREE).toMatchObject({ label: 'Cancel downgrade', action: 'cancel-downgrade' });
  });
  it('Enterprise workspace: Free and Growth disabled', () => {
    const c = planCtas('ENTERPRISE');
    expect(c.FREE.disabled && c.GROWTH.disabled).toBe(true);
    expect(c.ENTERPRISE).toMatchObject({ label: 'Current plan', current: true });
  });
});

describe('Billing details', () => {
  it('validates the GSTIN and its state code', () => {
    expect(billingProfileSchema.safeParse({ legalName: 'Lexisora Infotech Pvt Ltd', gstin: '24AAECL1234F1Z1', stateCode: '24' }).success).toBe(true);
    expect(billingProfileSchema.safeParse({ legalName: 'Lexisora', gstin: '24AAECL1234F1Z1', stateCode: '27' }).success).toBe(false);
    expect(billingProfileSchema.safeParse({ legalName: 'Lexisora', gstin: 'NOT-A-GSTIN', stateCode: '24' }).success).toBe(false);
    expect(billingProfileSchema.parse({ legalName: 'Bluepeak', gstin: '', stateCode: '27' }).gstin).toBeNull();
  });
});
