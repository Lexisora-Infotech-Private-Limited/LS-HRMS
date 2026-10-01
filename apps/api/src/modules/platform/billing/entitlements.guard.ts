import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { getContext } from '../../../core/context/request-context';
import { AppError } from '../../../core/http/errors';
import { SEAT_STATUSES } from '../platform.util';
import { READ_ONLY_MESSAGE, WRITE_METHODS, consumesSeat, readOnlyBlocks, routePath, seatBlocks, seatLimitMessage } from './entitlements.logic';

type CachedSub = { planCode: string; quantity: number; status: string } | null;

/** Subscription lookups are cached briefly: every write request passes through this guard. */
const TTL_MS = 10_000;
const cache = new Map<string, { at: number; sub: CachedSub }>();

/** Drop the cached subscription (after a payment, status or seat change). */
export function invalidateEntitlements(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/**
 * Global guard (registered by PlatformModule as APP_GUARD): READ_ONLY workspaces can't write
 * (423 `TENANT_READ_ONLY`) and adding a user needs a free seat (402 `SEAT_LIMIT`).
 * Requests without an authenticated context are left to the core AuthGuard.
 */
@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  private async subscription(tenantId: string): Promise<CachedSub> {
    const hit = cache.get(tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.sub;
    const sub = await this.prisma.raw.subscription.findUnique({ where: { tenantId }, select: { planCode: true, quantity: true, status: true } });
    cache.set(tenantId, { at: Date.now(), sub });
    return sub;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (!req || !WRITE_METHODS.has(req.method)) return true;
    const ctx = getContext();
    if (!ctx?.tenantId || !ctx.userId) return true;
    const path = routePath(req.originalUrl ?? req.url);
    const sub = await this.subscription(ctx.tenantId);
    if (!sub) return true;
    if (readOnlyBlocks(req.method, path, sub.status)) throw new AppError(423, 'TENANT_READ_ONLY', READ_ONLY_MESSAGE);
    if (consumesSeat(req.method, path)) {
      const used = await this.prisma.raw.user.count({ where: { tenantId: ctx.tenantId, status: { in: [...SEAT_STATUSES] } } });
      if (seatBlocks(req.method, path, sub, used)) throw new AppError(402, 'SEAT_LIMIT', seatLimitMessage(sub));
    }
    return true;
  }
}
