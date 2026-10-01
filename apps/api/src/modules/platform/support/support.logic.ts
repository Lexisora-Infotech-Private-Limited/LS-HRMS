import type { SupportStatusKey } from '@lexisora/shared';

/**
 * Lexisora support SLAs (spec M13). Business hours are Mon–Sat 09:00–19:00 IST; Enterprise
 * (and the operator's internal workspace) get 24/7 wall-clock targets for High / Medium.
 */

const MIN = 60_000;
const IST_OFFSET = 330 * MIN;
export const BUSINESS_START_MIN = 9 * 60;
export const BUSINESS_END_MIN = 19 * 60;
export const BUSINESS_DAY_MIN = BUSINESS_END_MIN - BUSINESS_START_MIN;

/** Add `minutes` of business time (Mon–Sat 09:00–19:00 IST) to `from`. */
export function addBusinessMinutes(from: Date, minutes: number): Date {
  let t = from.getTime();
  let left = minutes;
  for (let guard = 0; left > 0 && guard < 10_000; guard++) {
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

export type SlaPolicy = { minutes: number; business: boolean; label: string };

/** First-response target by plan and severity. */
export function slaPolicy(plan: string, severity: string): SlaPolicy {
  const p = plan.toUpperCase();
  if (p === 'ENTERPRISE' || p === 'INTERNAL') {
    if (severity === 'HIGH') return { minutes: 60, business: false, label: '1 hour' };
    if (severity === 'MEDIUM') return { minutes: 240, business: false, label: '4 hours' };
    return { minutes: BUSINESS_DAY_MIN, business: true, label: '1 business day' };
  }
  if (p === 'GROWTH') {
    if (severity === 'HIGH') return { minutes: 240, business: true, label: '4 business hours' };
    if (severity === 'MEDIUM') return { minutes: BUSINESS_DAY_MIN, business: true, label: '1 business day' };
    return { minutes: 3 * BUSINESS_DAY_MIN, business: true, label: '3 business days' };
  }
  return { minutes: 3 * BUSINESS_DAY_MIN, business: true, label: '3 business days (best effort)' };
}

export function firstResponseDue(plan: string, severity: string, openedAt: Date): Date {
  const p = slaPolicy(plan, severity);
  return p.business ? addBusinessMinutes(openedAt, p.minutes) : new Date(openedAt.getTime() + p.minutes * MIN);
}

/** Subtitle hint on the support screen for the tenant's plan. */
export function slaHint(plan: string): string {
  const p = plan.toUpperCase();
  if (p === 'ENTERPRISE' || p === 'INTERNAL') return 'Priority 24/7 support · High-severity requests get a first response within 1 hour.';
  if (p === 'GROWTH') return 'Growth plan · first response within 4 business hours for High severity, 1 business day for Medium (Mon–Sat, 09:00–19:00 IST).';
  return 'Free plan · billing and account requests are answered within 3 business days. Upgrade to Growth for technical support SLAs.';
}

/** SLA breached: no first response by the due time (and still awaiting one). */
export function slaBreached(t: { firstResponseDueAt: Date; firstRespondedAt: Date | null; status: string }, now = new Date()): boolean {
  if (t.firstRespondedAt) return t.firstRespondedAt > t.firstResponseDueAt;
  if (t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
  return now > t.firstResponseDueAt;
}

export const REOPEN_WINDOW_DAYS = 7;

/** Reopen is allowed within 7 days of resolution (spec: "Reopen after 8 days → rejected"). */
export function canReopen(t: { status: string; resolvedAt: Date | null }, now = new Date()): boolean {
  if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') return false;
  if (!t.resolvedAt) return false;
  return now.getTime() - t.resolvedAt.getTime() <= REOPEN_WINDOW_DAYS * 86_400_000;
}

/** A customer reply on "Waiting on you" moves the ticket back to In progress. */
export function statusAfterCustomerReply(s: SupportStatusKey): SupportStatusKey {
  return s === 'WAITING_ON_CUSTOMER' ? 'IN_PROGRESS' : s;
}

/** Lexisora staff status changes (the state machine of spec M13). */
export const PLATFORM_STATUS_FLOW: Record<SupportStatusKey, SupportStatusKey[]> = {
  OPEN: ['ENGINEER_ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'],
  ENGINEER_ASSIGNED: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_ON_CUSTOMER', 'RESOLVED'],
  WAITING_ON_CUSTOMER: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};

export function canTransition(from: SupportStatusKey, to: SupportStatusKey): boolean {
  return PLATFORM_STATUS_FLOW[from].includes(to);
}

export const isOpenStatus = (s: string) => s !== 'RESOLVED' && s !== 'CLOSED';
