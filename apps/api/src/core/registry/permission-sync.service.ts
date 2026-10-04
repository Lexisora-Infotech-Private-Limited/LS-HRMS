import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PERMISSION_KEYS, ROLE_KEYS, defaultPermissionsFor, type RoleKey } from '@lexisora/shared';
import { PrismaService } from '../prisma/prisma.service';

const KNOWN_KEY = 'rbac.knownPermissionKeys';

/**
 * Keeps system roles current when a release adds permission keys.
 *
 * Per tenant we remember the permission catalogue it has already seen (Setting `rbac.knownPermissionKeys`).
 * On startup, keys that are new since then are granted to the seeded system roles according to the
 * defaults in packages/shared/src/permissions.ts. Keys a tenant admin removed earlier are not "new",
 * so they are never re-granted. First sync of an older tenant: keys that no role of that tenant holds
 * are treated as new.
 */
@Injectable()
export class PermissionSyncService implements OnApplicationBootstrap {
  private readonly log = new Logger('PermissionSync');

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      await this.syncAll();
    } catch (e) {
      this.log.error(`Permission sync failed: ${(e as Error).message}`);
    }
  }

  async syncAll() {
    const tenants = await this.prisma.raw.tenant.findMany({ select: { id: true } });
    for (const t of tenants) await this.syncTenant(t.id);
  }

  async syncTenant(tenantId: string) {
    const db = this.prisma.raw;
    const roles = await db.role.findMany({ where: { tenantId } });
    const setting = await db.setting.findUnique({ where: { tenantId_key: { tenantId, key: KNOWN_KEY } } });
    const known = new Set<string>(
      Array.isArray(setting?.value) ? (setting!.value as string[]) : roles.flatMap((r) => r.permissions),
    );
    const fresh = PERMISSION_KEYS.filter((k) => !known.has(k));
    let updated = 0;
    if (fresh.length) {
      for (const role of roles) {
        if (!role.isSystem || !(ROLE_KEYS as readonly string[]).includes(role.key)) continue;
        const defaults = new Set(defaultPermissionsFor(role.key as RoleKey));
        const add = fresh.filter((k) => defaults.has(k) && !role.permissions.includes(k));
        if (!add.length) continue;
        await db.role.update({ where: { id: role.id }, data: { permissions: [...role.permissions, ...add] } });
        updated++;
      }
    }
    const value = [...new Set([...known, ...PERMISSION_KEYS])];
    if (setting) {
      if (fresh.length) await db.setting.update({ where: { id: setting.id }, data: { value } });
    } else {
      await db.setting.create({ data: { tenantId, key: KNOWN_KEY, value } });
    }
    if (updated) this.log.log(`Tenant ${tenantId}: granted ${fresh.length} new permission key(s) to ${updated} system role(s)`);
  }
}
