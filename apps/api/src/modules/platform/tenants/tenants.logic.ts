import { FREE_SEATS, RESERVED_SLUGS, type PlanCode, type TenantRowDto, type TenantTab } from '@lexisora/shared';

type SubLike = { planCode: string; status: string; cycle?: string | null; quantity: number } | null | undefined;

/** Plan shown on the Tenants screen: the operator's own workspace is "Internal". */
export function tenantPlanCode(sub: SubLike, isOperator: boolean): PlanCode {
  if (isOperator) return 'INTERNAL';
  const p = sub?.planCode;
  return p === 'GROWTH' || p === 'ENTERPRISE' || p === 'INTERNAL' ? p : 'FREE';
}

/**
 * Status column (spec M9): ~Active, -Free tier, !Payment due, !Read-only, -Suspended.
 * Suspension wins; the operator is always active.
 */
export function tenantStatusOf(tenantStatus: string, sub: SubLike, isOperator: boolean): { status: string; tone: TenantRowDto['statusTone'] } {
  if (tenantStatus === 'SUSPENDED' || sub?.status === 'SUSPENDED') return { status: 'Suspended', tone: 'neutral' };
  if (isOperator) return { status: 'Active', tone: 'accent' };
  if (sub?.status === 'READ_ONLY') return { status: 'Read-only', tone: 'outline' };
  if (sub?.status === 'PAST_DUE' || tenantStatus === 'PAYMENT_DUE') return { status: 'Payment due', tone: 'outline' };
  if (!sub || sub.planCode === 'FREE') return { status: 'Free tier', tone: 'neutral' };
  if (sub.status === 'CANCELLED') return { status: 'Cancelled', tone: 'neutral' };
  return { status: 'Active', tone: 'accent' };
}

export const isPaidPlan = (p: string) => p === 'GROWTH' || p === 'ENTERPRISE';

/** Seats column: purchased seats on paid plans, users in use on Free / Internal (wireframe figures). */
export function seatsFigure(planCode: PlanCode, used: number, quantity: number): string {
  return isPaidPlan(planCode) ? quantity.toLocaleString('en-IN') : used.toLocaleString('en-IN');
}

/** Tabs a row belongs to (All, Paid, Free, Attention = past due, read-only, suspended). */
export function tenantInTab(row: Pick<TenantRowDto, 'planCode' | 'status'>, tab: TenantTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'paid') return isPaidPlan(row.planCode);
  if (tab === 'free') return row.planCode === 'FREE';
  return ['Payment due', 'Read-only', 'Suspended'].includes(row.status);
}

/** Why a workspace slug can't be used, or null when it is free (uniqueness is checked against the DB separately). */
export function slugProblem(slug: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) return 'Use letters, numbers and hyphens, e.g. nova';
  if (slug.length < 3) return 'Use at least 3 characters';
  if (RESERVED_SLUGS.includes(slug)) return `“${slug}” is reserved`;
  return null;
}

/** "kiran.rao@novaclinics.in" → "Kiran Rao". */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  const words = local.split(/[._-]+/).filter(Boolean);
  if (!words.length) return email;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Seats a new tenant's subscription starts with. */
export function initialQuantity(planCode: 'FREE' | 'GROWTH' | 'ENTERPRISE', seats: number | null | undefined): number {
  return planCode === 'FREE' ? FREE_SEATS : Math.max(FREE_SEATS + 1, seats ?? FREE_SEATS + 1);
}
