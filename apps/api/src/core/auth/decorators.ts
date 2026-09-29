import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@lexisora/shared';
import { requireContext, type RequestContext } from '../context/request-context';

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_PERMS = 'requiredPerms';
export const PLATFORM_ONLY = 'platformOnly';

/** Route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route requires ANY of the listed permissions. */
export const RequirePerm = (...perms: PermissionKey[]) => SetMetadata(REQUIRED_PERMS, perms);

/** Route only for the Lexisora platform super-admin. */
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY, true);

/** Injects the authenticated request context (tenantId, userId, employeeId, permissions…). */
export const Ctx = createParamDecorator((_: unknown, _ec: ExecutionContext): RequestContext => requireContext());

/** True if the active user holds the permission (or is running as system). */
export function hasPerm(ctx: RequestContext, perm: PermissionKey): boolean {
  return ctx.permissions.has('*') || ctx.permissions.has(perm);
}
