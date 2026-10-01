import { FREE_SEATS } from '@lexisora/shared';
import { seatAvailable } from './billing.logic';

/**
 * Plan entitlements enforced on every request (spec-platform M10 / "Seat gate for other domains"):
 *  - READ_ONLY workspaces (grace period over, invoice unpaid): writes get 423 `TENANT_READ_ONLY`,
 *    except sign-in, billing (so they can pay), support, notification mark-read, attendance punches
 *    and tracker ingest (keeps payroll data complete).
 *  - Seat gate: adding a user to the workspace (create / invite / import an employee) needs a free
 *    seat — Free: fewer than 10 users; Growth / Enterprise: fewer than the purchased seats — else
 *    402 `SEAT_LIMIT`. People can't import Platform (ARCHITECTURE §5), so the gate sits in front
 *    of those routes instead of inside the People service.
 */

export const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** `/api/v1/employees/x/invite?y=1` → `/employees/x/invite`. */
export function routePath(url: string): string {
  let p = (url ?? '').split('?')[0]!.split('#')[0]!;
  p = p.replace(/^\/api\/v1(?=\/|$)/, '');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

const EXEMPT_PREFIXES = [
  '/auth',
  '/billing',
  '/support',
  '/notifications',
  '/tenants', // Lexisora console acting on other workspaces
  '/attendance/me/punch',
  '/attendance/biometric', // device push (iclock)
  '/tracker/auth',
  '/tracker/pair',
  '/tracker/punch',
  '/tracker/sync',
  '/tracker/screenshots',
  '/tracker/heartbeat',
];

/** Writes a READ_ONLY workspace may still make. */
export function readOnlyExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

const SEAT_ROUTES = [/^\/employees$/, /^\/employees\/[^/]+\/invite$/, /^\/employees\/import\/[^/]+\/commit$/];

/** Requests that add a user (a seat) to the workspace. */
export function consumesSeat(method: string, path: string): boolean {
  return method.toUpperCase() === 'POST' && SEAT_ROUTES.some((r) => r.test(path));
}

export type SeatSub = { planCode: string; quantity: number } | null | undefined;

/** Seat limit for the plan, or null when unlimited (operator / internal workspace, no subscription). */
export function seatLimit(sub: SeatSub): number | null {
  if (!sub || sub.planCode === 'INTERNAL') return null;
  return sub.planCode === 'FREE' ? FREE_SEATS : sub.quantity;
}

/** Whether one more user fits (`used` = active + invited users); the plan rule lives in billing.logic. */
export function hasFreeSeat(sub: SeatSub, used: number): boolean {
  return !sub || seatAvailable(sub.planCode, sub.quantity, used);
}

export function seatLimitMessage(sub: SeatSub): string {
  if (sub?.planCode === 'FREE') return `All ${FREE_SEATS} seats on the Free plan are in use. Upgrade to Growth in Subscription & billing to add more people.`;
  return `All ${seatLimit(sub) ?? 0} seats are in use. Add seats in Subscription.`;
}

export const READ_ONLY_MESSAGE = 'Your workspace is read-only until the overdue Lexisora invoice is paid. An admin can pay it under SaaS → Subscription.';

/** A write by a READ_ONLY workspace outside the exempt routes → 423. */
export function readOnlyBlocks(method: string, path: string, status: string | null | undefined): boolean {
  return status === 'READ_ONLY' && WRITE_METHODS.has(method.toUpperCase()) && !readOnlyExempt(path);
}

/** A seat-consuming request when every seat is taken → 402. */
export function seatBlocks(method: string, path: string, sub: SeatSub, used: number): boolean {
  return consumesSeat(method, path) && !hasFreeSeat(sub, used);
}
