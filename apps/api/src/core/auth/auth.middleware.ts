import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { runWithContext, type RequestContext } from '../context/request-context';
import { TokenService } from './token.service';

/**
 * Optional hook for device tokens (set by the tracker module): returns false if the
 * device has been revoked/unpaired.
 */
export const deviceTokenHooks: { isDeviceActive?: (deviceId: string, tenantId: string) => Promise<boolean> } = {};

/**
 * Authenticates the bearer token (user access token or tracker device token) and runs the
 * rest of the request inside an AsyncLocalStorage context carrying tenant + permissions.
 * Requests without a valid token pass through with no context; the guard decides.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const h = req.headers.authorization;
    const q = typeof req.query.access_token === 'string' ? req.query.access_token : undefined; // for <img>/<a> downloads
    const token = h?.startsWith('Bearer ') ? h.slice(7) : q;
    if (!token) return next();
    const p = this.tokens.verify(token);
    if (!p) return next();

    if (p.typ === 'device' && deviceTokenHooks.isDeviceActive && !(await deviceTokenHooks.isDeviceActive(p.did, p.tid))) {
      return next();
    }
    const user = await this.prisma.raw.user.findUnique({
      where: { id: p.sub },
      include: { role: true, employee: { select: { id: true, fullName: true, status: true } } },
    });
    if (!user || user.tenantId !== p.tid || user.status === 'DISABLED' || user.employee?.status === 'EXITED') return next();

    const ctx: RequestContext = {
      tenantId: user.tenantId,
      userId: user.id,
      employeeId: user.employee?.id ?? null,
      roleKey: user.role.key,
      permissions: new Set(user.role.permissions),
      isPlatformAdmin: user.isPlatformAdmin,
      userName: user.employee?.fullName ?? user.name,
      ip: req.ip,
    };
    (req as any).deviceId = p.typ === 'device' ? p.did : undefined;
    runWithContext(ctx, () => next());
  }
}
