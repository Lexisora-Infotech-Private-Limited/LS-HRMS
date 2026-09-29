import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Typed tenant settings stored as JSON rows (`Setting`). Domains define their own keys and
 * defaults, e.g. settings.get('attendance.policy', DEFAULT_POLICY).
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.setting.findFirst({ where: { key } });
    if (!row) return fallback;
    const v = row.value as unknown;
    // Shallow-merge objects so new default fields appear for old tenants.
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && v && typeof v === 'object') {
      return { ...(fallback as object), ...(v as object) } as T;
    }
    return v as T;
  }

  /** Read a setting for a specific tenant (outside a request). */
  async getFor<T>(tenantId: string, key: string, fallback: T): Promise<T> {
    const row = await this.prisma.raw.setting.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (!row) return fallback;
    const v = row.value as unknown;
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && v && typeof v === 'object') {
      return { ...(fallback as object), ...(v as object) } as T;
    }
    return v as T;
  }

  async set(key: string, value: unknown): Promise<void> {
    const existing = await this.prisma.setting.findFirst({ where: { key } });
    if (existing) {
      await this.prisma.setting.update({ where: { id: existing.id }, data: { value: value as Prisma.InputJsonValue } });
    } else {
      await this.prisma.setting.create({ data: { key, value: value as Prisma.InputJsonValue } as any });
    }
  }
}
