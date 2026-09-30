import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { getContext } from '../../core/context/request-context';
import { AppError } from '../../core/http/errors';

/** Device id attached by the core auth middleware when the bearer is a (still active) device token. */
export const deviceIdOf = (req: Request): string | undefined => (req as any).deviceId;

/**
 * Tracker data-plane routes: require a paired, ACTIVE device token (not a browser session).
 * Revoked devices never reach here — the auth middleware hook (isDeviceActive) drops their context.
 */
@Injectable()
export class DeviceOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = getContext();
    if (!ctx?.userId || !deviceIdOf(req)) {
      throw new AppError(401, 'DEVICE_TOKEN_REQUIRED', 'This device is not paired. Sign in to the tracker again.');
    }
    if (!ctx.employeeId) throw new AppError(403, 'TRACKER_NOT_ELIGIBLE', 'The tracker is for employees.');
    return true;
  }
}

/** Web-only routes (approving / revoking devices, reviewing claims): refuse tracker device tokens. */
@Injectable()
export class UserSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (deviceIdOf(req)) throw new AppError(403, 'WEB_SESSION_REQUIRED', 'Use the web portal for this action.');
    return true;
  }
}

/** Opaque pairing-session token: `Authorization: Bearer <pairingToken>` (or x-pairing-token). */
export function pairingTokenOf(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim() || undefined;
  const x = req.headers['x-pairing-token'];
  return typeof x === 'string' && x ? x : undefined;
}
