import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContext = {
  tenantId: string;
  userId?: string;
  employeeId?: string | null;
  roleKey?: string;
  permissions: Set<string>;
  isPlatformAdmin?: boolean;
  userName?: string;
  ip?: string;
};

const als = new AsyncLocalStorage<RequestContext>();

export function getContext(): RequestContext | undefined {
  return als.getStore();
}

/** Throws when called outside an authenticated request / tenant job. */
export function requireContext(): RequestContext {
  const c = als.getStore();
  if (!c) throw new Error('No request context (tenant) is active');
  return c;
}

export function currentTenantId(): string {
  return requireContext().tenantId;
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** Run background work (jobs, seeds, webhooks) scoped to one tenant with full permissions. */
export function runAsTenant<T>(tenantId: string, fn: () => T): T {
  return als.run({ tenantId, permissions: new Set(['*']) }, fn);
}
