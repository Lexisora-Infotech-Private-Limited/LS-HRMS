import type { PrismaClient } from '@prisma/client';
import { formatDayMonth, formatTime, istDateKey } from '@lexisora/shared';

/** Start of an IST calendar day ("2026-09-29") as a UTC instant. */
export function istStart(key: string): Date {
  return new Date(`${key}T00:00:00+05:30`);
}
export function istEnd(key: string): Date {
  return new Date(`${key}T23:59:59.999+05:30`);
}

/** "Today, 10:12" when the instant falls on today (IST), otherwise "22 Sep". */
export function openedLabel(d: Date, now = new Date()): string {
  if (istDateKey(d) === istDateKey(now)) return `Today, ${formatTime(d)}`;
  const y = new Date(now.getTime() - 86400_000);
  if (istDateKey(d) === istDateKey(y)) return `Yesterday, ${formatTime(d)}`;
  return formatDayMonth(d);
}

/** "12 Oct" within 60 days, otherwise "Mar 2027". */
export function renewalLabel(end: Date | null | undefined, now = new Date()): string {
  if (!end) return '—';
  const days = (end.getTime() - now.getTime()) / 86400_000;
  if (days <= 60) return formatDayMonth(end);
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', year: 'numeric' }).format(end);
}

let cachedPlatformTenant: string | null = null;

/**
 * The operator tenant (Lexisora itself): the tenant that hosts the platform administrators.
 * Platform-wide sequences (SUP-, LXS/) and operator alerts live there.
 */
export async function platformTenantId(raw: PrismaClient): Promise<string> {
  if (cachedPlatformTenant) return cachedPlatformTenant;
  const u = await raw.user.findFirst({ where: { isPlatformAdmin: true }, orderBy: { createdAt: 'asc' }, select: { tenantId: true } });
  const t = u ? { id: u.tenantId } : await raw.tenant.findFirst({ where: { slug: 'lexisora' }, select: { id: true } });
  if (!t) throw new Error('Platform tenant not found');
  cachedPlatformTenant = t.id;
  return t.id;
}

/** Active platform administrators (user ids) — the Lexisora ops team. */
export async function platformAdminUserIds(raw: PrismaClient): Promise<string[]> {
  const rows = await raw.user.findMany({ where: { isPlatformAdmin: true, status: 'ACTIVE' }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Seat usage = users that can sign in or are invited (DISABLED excluded; interns count). */
export const SEAT_STATUSES = ['ACTIVE', 'INVITED'] as const;
