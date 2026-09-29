import {
  FREE_SEATS,
  GROWTH_PRICE_PAISE,
  chargeableSeats,
  seatPeriodPaise,
  type BillingCycleKey,
  type PlanCode,
  type QuoteLine,
} from '@lexisora/shared';

/**
 * SaaS billing arithmetic (integer paise, round half-up at line level). Pure and unit tested.
 * Supplier: Lexisora Infotech, Gujarat (state code 24).
 */

export const SUPPLIER_STATE = '24';
export const SUPPLIER_GSTIN = '24AAECL1234F1Z5';
export const SAC_CODE = '998314';

export const roundHalfUp = (n: number) => Math.floor(n + 0.5);

export type PromoTerms = { code: string; description: string; percentOff?: number | null; amountOffPaise?: number | null };

export function discountFor(subtotal: number, promo: PromoTerms | null | undefined): number {
  if (!promo || subtotal <= 0) return 0;
  if (promo.percentOff) return Math.min(subtotal, roundHalfUp((subtotal * promo.percentOff) / 100));
  if (promo.amountOffPaise) return Math.min(subtotal, promo.amountOffPaise);
  return 0;
}

/** Intra-state (same state as supplier) → CGST + SGST 9% each; otherwise IGST 18%. */
export function gstSplit(taxable: number, placeOfSupply: string, supplierState = SUPPLIER_STATE) {
  if (placeOfSupply === supplierState) {
    const half = roundHalfUp(taxable * 0.09);
    return { cgst: half, sgst: half, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: roundHalfUp(taxable * 0.18) };
}

/** Invoice totals round to the nearest rupee; the difference is the round-off line. */
export function roundToRupee(paise: number): { total: number; roundOff: number } {
  const total = roundHalfUp(paise / 100) * 100;
  return { total, roundOff: total - paise };
}

export type Totals = {
  lines: QuoteLine[];
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  placeOfSupply: string;
};

export function totalsFor(lines: QuoteLine[], placeOfSupply: string, promo?: PromoTerms | null): Totals {
  const subtotal = lines.reduce((s, l) => s + l.amountPaise, 0);
  const discount = discountFor(subtotal, promo);
  const all = discount ? [...lines, { kind: 'DISCOUNT' as const, description: `Promo ${promo!.code} · ${promo!.description}`, quantity: 1, unitPaise: -discount, amountPaise: -discount }] : lines;
  const taxable = subtotal - discount;
  const g = gstSplit(taxable, placeOfSupply);
  const { total, roundOff } = roundToRupee(taxable + g.cgst + g.sgst + g.igst);
  return { lines: all, subtotalPaise: subtotal, discountPaise: discount, taxablePaise: taxable, cgstPaise: g.cgst, sgstPaise: g.sgst, igstPaise: g.igst, roundOffPaise: roundOff, totalPaise: total, placeOfSupply };
}

/** Full-period seats line: chargeable seats × price × months in the cycle. */
export function periodLine(cycle: BillingCycleKey, quantity: number, unitPaise = GROWTH_PRICE_PAISE[cycle]): QuoteLine {
  const chargeable = chargeableSeats(quantity);
  const per = seatPeriodPaise(cycle, unitPaise);
  return {
    kind: 'SEATS',
    description: `Growth · ${cycle === 'YEARLY' ? 'yearly' : 'monthly'} · ${quantity} seats (first ${FREE_SEATS} free) · ${chargeable} × ₹${(unitPaise / 100).toFixed(0)}/user/month${cycle === 'YEARLY' ? ' × 12' : ''}`,
    quantity: chargeable,
    unitPaise: per,
    amountPaise: chargeable * per,
  };
}

/** Days between two instants counted in whole IST days, inclusive of the start day. */
export function daysInclusive(from: Date, to: Date): number {
  const d = (x: Date) => Math.floor((x.getTime() + 5.5 * 3600_000) / 86400_000);
  return Math.max(0, d(to) - d(from));
}

/** Prorated charge for adding seats mid-period. */
export function prorationPaise(oldQ: number, newQ: number, cycle: BillingCycleKey, remainingDays: number, totalDays: number, unitPaise = GROWTH_PRICE_PAISE[cycle]): number {
  const added = chargeableSeats(newQ) - chargeableSeats(oldQ);
  if (added <= 0 || totalDays <= 0) return 0;
  return roundHalfUp((added * seatPeriodPaise(cycle, unitPaise) * remainingDays) / totalDays);
}

export function addCycle(start: Date, cycle: BillingCycleKey): Date {
  const d = new Date(start);
  if (cycle === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

// ── Promo validation ───────────────────────────────────────────────────────

export type PromoRecord = {
  code: string;
  active: boolean;
  validFrom: Date;
  validUntil: Date | null;
  planCodes: string[];
  cycles: string[];
  maxRedemptions: number | null;
  redeemedCount: number;
};

export type PromoCheck = { ok: true } | { ok: false; status: number; code: string; message: string };

export function validatePromo(
  promo: PromoRecord | null,
  ctx: { now: Date; planCode: PlanCode; cycle: BillingCycleKey | null; alreadyRedeemed: boolean },
): PromoCheck {
  if (!promo) return { ok: false, status: 404, code: 'PROMO_NOT_FOUND', message: 'That promo code doesn’t exist' };
  if (!promo.active || ctx.now < promo.validFrom || (promo.validUntil && ctx.now > promo.validUntil)) {
    return { ok: false, status: 400, code: 'PROMO_EXPIRED', message: 'This promo code has expired' };
  }
  if (ctx.alreadyRedeemed) return { ok: false, status: 409, code: 'PROMO_ALREADY_USED', message: 'Already used' };
  if (promo.maxRedemptions !== null && promo.redeemedCount >= promo.maxRedemptions) {
    return { ok: false, status: 400, code: 'PROMO_EXHAUSTED', message: 'This promo code has reached its limit' };
  }
  // A Free tenant may hold a Growth promo until it upgrades.
  const plan = ctx.planCode === 'FREE' ? 'GROWTH' : ctx.planCode;
  if (promo.planCodes.length && !promo.planCodes.includes(plan)) {
    return { ok: false, status: 400, code: 'PROMO_NOT_FOR_PLAN', message: 'This promo code isn’t valid for your plan' };
  }
  if (ctx.cycle && promo.cycles.length && !promo.cycles.includes(ctx.cycle)) {
    return { ok: false, status: 400, code: 'PROMO_NOT_FOR_CYCLE', message: `This promo code isn’t valid for ${ctx.cycle === 'YEARLY' ? 'yearly' : 'monthly'} billing` };
  }
  return { ok: true };
}

// ── Platform metrics ───────────────────────────────────────────────────────

export type SubForMetrics = { planCode: string; cycle: BillingCycleKey | null; status: string; quantity: number; unitPaise?: number | null; contractPaisePerYear?: number | null };

const BILLABLE = new Set(['ACTIVE', 'PAST_DUE', 'READ_ONLY']);
const PAID_PLANS = new Set(['GROWTH', 'ENTERPRISE']);

/** Monthly recurring revenue (excl. GST) in paise. */
export function mrrPaise(subs: SubForMetrics[]): number {
  let sum = 0;
  for (const s of subs) {
    if (!BILLABLE.has(s.status) || !PAID_PLANS.has(s.planCode)) continue;
    if (s.planCode === 'ENTERPRISE' && s.contractPaisePerYear) {
      sum += roundHalfUp(s.contractPaisePerYear / 12);
      continue;
    }
    const cycle = s.cycle ?? 'MONTHLY';
    sum += chargeableSeats(s.quantity) * (s.unitPaise ?? GROWTH_PRICE_PAISE[cycle]);
  }
  return sum;
}

/** Σ purchased seats on paid, billable subscriptions. */
export function seatsBilled(subs: SubForMetrics[]): number {
  return subs.filter((s) => BILLABLE.has(s.status) && PAID_PLANS.has(s.planCode)).reduce((n, s) => n + s.quantity, 0);
}

export function pctChange(now: number, before: number | null | undefined): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

/** "Growth · yearly", "Free", "Internal", "Enterprise". */
export function planLabel(planCode: string, cycle: string | null | undefined): string {
  if (planCode === 'GROWTH') return `Growth · ${cycle === 'MONTHLY' ? 'monthly' : 'yearly'}`;
  return ({ FREE: 'Free', ENTERPRISE: 'Enterprise', INTERNAL: 'Internal' } as Record<string, string>)[planCode] ?? planCode;
}

/** Seats-gate for adding users (FREE: < 10; paid: < purchased). */
export function seatAvailable(planCode: string, quantity: number, activeUsers: number): boolean {
  if (planCode === 'INTERNAL') return true;
  const limit = planCode === 'FREE' ? FREE_SEATS : quantity;
  return activeUsers < limit;
}

/** "LXS/26-27/0042" */
export function invoiceNumber(fy: string, n: number): string {
  return `LXS/${fy.slice(2)}/${String(n).padStart(4, '0')}`;
}
