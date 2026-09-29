import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getContext } from '../context/request-context';
import { AppError } from '../http/errors';
import { IS_PUBLIC, PLATFORM_ONLY, REQUIRED_PERMS } from './decorators';

/** Global guard: authentication required unless @Public(); enforces @RequirePerm / @PlatformOnly. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const ctx = getContext();
    if (!ctx?.userId) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY, targets) && !ctx.isPlatformAdmin) {
      throw new AppError(403, 'FORBIDDEN', 'Platform administrators only');
    }
    const perms = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMS, targets);
    if (perms?.length && !perms.some((p) => ctx.permissions.has(p))) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this');
    }
    return true;
  }
}
