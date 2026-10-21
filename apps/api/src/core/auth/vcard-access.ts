import { DEFAULT_VCARD_ACCESS, VCARD_ACCESS_KEY, vcardAccessSchema, vcardAllowed, type VCardAccess } from '@lexisora/shared';
import type { PrismaService } from '../prisma/prisma.service';

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: VCardAccess }>();

/** The tenant's visiting-card setting (cached briefly: it is read on every authenticated request). */
export async function loadVcardAccess(prisma: PrismaService, tenantId: string): Promise<VCardAccess> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const row = await prisma.raw.setting.findUnique({ where: { tenantId_key: { tenantId, key: VCARD_ACCESS_KEY } } });
  const parsed = vcardAccessSchema.safeParse(row?.value ?? {});
  const value = parsed.success ? parsed.data : DEFAULT_VCARD_ACCESS;
  cache.set(tenantId, { at: Date.now(), value });
  return value;
}

export const forgetVcardAccess = (tenantId: string) => cache.delete(tenantId);

/** Drops `vcard.self` from a permission list when the setting leaves this person out, so the menu, route guard and API all agree. */
export async function applyVcardAccess(prisma: PrismaService, tenantId: string, who: { roleKey: string; employeeId: string | null }, permissions: string[]): Promise<string[]> {
  if (!permissions.includes('vcard.self')) return permissions;
  const access = await loadVcardAccess(prisma, tenantId);
  return vcardAllowed(access, who) ? permissions : permissions.filter((p) => p !== 'vcard.self');
}
