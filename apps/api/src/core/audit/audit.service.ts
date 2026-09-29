import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../context/request-context';

export type AuditInput = {
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Prisma.InputJsonValue;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Record an action by the current user (tenant/actor taken from context). */
  async record(a: AuditInput): Promise<void> {
    const ctx = getContext();
    if (!ctx) return;
    await this.prisma.raw.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorName: ctx.userName,
        ip: ctx.ip,
        action: a.action,
        entity: a.entity,
        entityId: a.entityId ?? null,
        meta: a.meta,
      },
    });
  }

  /** Record outside a request context (login, jobs). */
  async recordRaw(
    tenantId: string,
    a: AuditInput & { actorUserId?: string | null; actorName?: string | null; ip?: string },
  ): Promise<void> {
    await this.prisma.raw.auditLog.create({
      data: {
        tenantId,
        actorUserId: a.actorUserId ?? null,
        actorName: a.actorName ?? null,
        ip: a.ip,
        action: a.action,
        entity: a.entity,
        entityId: a.entityId ?? null,
        meta: a.meta,
      },
    });
  }
}
