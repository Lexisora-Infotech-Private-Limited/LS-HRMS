import { AsyncLocalStorage } from 'node:async_hooks';
import { isRegionCode, setRegionResolver, type RegionCode } from '@lexisora/shared';
import { getContext } from '../context/request-context';

/**
 * Region a scheduled job run is for. Daily/weekly jobs written for India time run twice:
 * at India time for India tenants and at UK time for UK tenants (see RegionCronService).
 * Code in such a run that has no tenant context yet (e.g. "today" computed before the
 * tenant loop) gets this region's calendar.
 */
const cronRegionStore = new AsyncLocalStorage<RegionCode>();

export function runInCronRegion<T>(region: RegionCode, fn: () => T): T {
  return cronRegionStore.run(region, fn);
}

export function cronRegion(): RegionCode | undefined {
  return cronRegionStore.getStore();
}

/**
 * Tenants a job run should process: inside a region-specific run, only that region's
 * tenants; otherwise (interval jobs, manual calls) every tenant.
 */
export function tenantsForCron<T extends { id: string }>(rows: T[]): T[] {
  const r = cronRegion();
  return r ? rows.filter((t) => regionOfTenant(t.id) === r) : rows;
}

/**
 * In-memory tenant → region map. The shared helpers (money, dates, time zones) read the
 * region of the current request/job through the resolver registered here. Tenants not in
 * the map (and code running with no tenant context) are India, the original behaviour.
 */
const regions = new Map<string, RegionCode>();

export function cacheRegion(tenantId: string, region: string | null | undefined): void {
  if (isRegionCode(region) && region !== 'IN') regions.set(tenantId, region);
  else regions.delete(tenantId);
}

export function replaceRegionCache(rows: { id: string; region: string | null }[]): void {
  regions.clear();
  for (const r of rows) cacheRegion(r.id, r.region);
}

/** Region of a tenant (IN when unknown). */
export function regionOfTenant(tenantId: string | null | undefined): RegionCode {
  return (tenantId && regions.get(tenantId)) || 'IN';
}

/** Region of the tenant of the current request or job (or of the region-specific cron run). */
export function currentRegion(): RegionCode {
  const tenantId = getContext()?.tenantId;
  if (tenantId) return regionOfTenant(tenantId);
  return cronRegion() ?? 'IN';
}

/** Tenant ids in a region (for per-region cron jobs). India includes every tenant not mapped. */
export function tenantsInRegion(all: string[], region: RegionCode): string[] {
  return all.filter((id) => regionOfTenant(id) === region);
}

let installed = false;
export function installRegionResolver(): void {
  if (installed) return;
  installed = true;
  setRegionResolver(() => currentRegion());
}
