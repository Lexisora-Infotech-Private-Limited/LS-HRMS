import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env';

export type AccessPayload = { sub: string; tid: string; typ: 'access' };
/** Long-lived token issued to a paired desktop tracker device. */
export type DevicePayload = { sub: string; tid: string; did: string; typ: 'device' };

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(userId: string, tenantId: string): string {
    const p: AccessPayload = { sub: userId, tid: tenantId, typ: 'access' };
    return this.jwt.sign(p, { secret: env.JWT_ACCESS_SECRET, expiresIn: env.ACCESS_TOKEN_TTL_SEC });
  }

  signDevice(userId: string, tenantId: string, deviceId: string): string {
    const p: DevicePayload = { sub: userId, tid: tenantId, did: deviceId, typ: 'device' };
    return this.jwt.sign(p, { secret: env.JWT_ACCESS_SECRET, expiresIn: '365d' });
  }

  verify(token: string): AccessPayload | DevicePayload | null {
    try {
      return this.jwt.verify<AccessPayload | DevicePayload>(token, { secret: env.JWT_ACCESS_SECRET });
    } catch {
      return null;
    }
  }
}
