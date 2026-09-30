import {
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_MIN_PLAN,
  PERMISSION_REQUIRES,
  PLAN_RANK,
  ROLE_MATRIX_ROWS,
  matrixCell,
  type MatrixCellState,
  type PermissionKey,
  type PlanCode,
} from '@lexisora/shared';

/** Pure RBAC rules for the Roles & access screen (no I/O — unit tested). */

export const isPermissionKey = (k: string): k is PermissionKey => (PERMISSION_KEYS as string[]).includes(k);

/**
 * Matrix cell for a role: all keys of the row held → "all", some → "some" (half fill), none → "none".
 * Rows listed in MATRIX_ANY_OF_ROWS (alternative levels) show "all" when any key is held.
 */
export function matrixCellState(perms: Iterable<string>, rowKeys: readonly string[], rowLabel = ''): MatrixCellState {
  return matrixCell(perms, { label: rowLabel, keys: rowKeys });
}

export function matrixRow(label: string) {
  return ROLE_MATRIX_ROWS.find((r) => r.label === label);
}

/** The key plus everything it (transitively) requires. */
export function requiresClosure(keys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...keys];
  while (stack.length) {
    const k = stack.pop()!;
    if (out.has(k)) continue;
    out.add(k);
    for (const r of PERMISSION_REQUIRES[k as PermissionKey] ?? []) stack.push(r);
  }
  return out;
}

/** Enabled keys that (transitively) depend on `key`. */
export function dependentsOf(key: string, enabled: Iterable<string>): string[] {
  const set = new Set(enabled);
  const out = new Set<string>();
  let frontier = [key];
  while (frontier.length) {
    const next: string[] = [];
    for (const k of set) {
      if (out.has(k) || k === key) continue;
      const req = PERMISSION_REQUIRES[k as PermissionKey] ?? [];
      if (req.some((r) => frontier.includes(r))) {
        out.add(k);
        next.push(k);
      }
    }
    frontier = next;
  }
  return [...out];
}

export class DependencyError extends Error {
  constructor(public readonly key: string, public readonly dependents: string[]) {
    super(`${label(key)} is needed by ${dependents.map(label).join(', ')}`);
  }
}

export const label = (k: string) => (PERMISSIONS as Record<string, { label: string }>)[k]?.label ?? k;

export type ToggleResult = { next: string[]; added: string[]; removed: string[] };

/**
 * Enable/disable keys on a permission set.
 *  - enable adds the `requires` closure
 *  - disable refuses when other enabled keys depend on it, unless `cascade`, which also removes those
 */
export function applyToggle(current: readonly string[], keys: readonly string[], enabled: boolean, cascade = false): ToggleResult {
  const set = new Set(current);
  const added: string[] = [];
  const removed: string[] = [];
  if (enabled) {
    for (const k of requiresClosure(keys)) {
      if (!set.has(k)) {
        set.add(k);
        added.push(k);
      }
    }
  } else {
    const toRemove = new Set(keys.filter((k) => set.has(k)));
    for (const k of [...toRemove]) {
      const deps = dependentsOf(k, set).filter((d) => !toRemove.has(d));
      if (deps.length && !cascade) throw new DependencyError(k, deps);
      for (const d of deps) toRemove.add(d);
    }
    for (const k of toRemove) {
      set.delete(k);
      removed.push(k);
    }
  }
  // Catalogue order first, then any unknown/legacy keys (kept so nothing is silently dropped).
  const ordered: string[] = (PERMISSION_KEYS as readonly string[]).filter((k) => set.has(k));
  return { next: ordered.concat([...set].filter((k) => !isPermissionKey(k))), added, removed };
}

/**
 * Replace the catalogue keys of a permission set with `wanted` plus everything it requires.
 * Unknown (legacy) keys already on the role are kept untouched.
 */
export function replacePermissions(current: readonly string[], wanted: readonly string[]): ToggleResult {
  const closure = requiresClosure(wanted.filter(isPermissionKey));
  const cur = new Set(current);
  const ordered: string[] = (PERMISSION_KEYS as readonly string[]).filter((k) => closure.has(k));
  const added = ordered.filter((k) => !cur.has(k));
  const removed = current.filter((k) => isPermissionKey(k) && !closure.has(k));
  const legacy = current.filter((k) => !isPermissionKey(k));
  return { next: ordered.concat(legacy), added, removed };
}

/**
 * The plan whose features a workspace is entitled to, from its Subscription row.
 *  - no row: the workspace was not provisioned through billing (the operator's own workspace,
 *    tenants created before billing existed) → nothing is plan-gated ("INTERNAL")
 *  - CANCELLED: a cancelled paid plan falls back to the Free features
 *  - otherwise the subscribed plan (past-due / read-only / suspended keep their entitlements;
 *    what those statuses allow is enforced separately)
 */
export function effectivePlan(sub: { planCode: string; status: string } | null | undefined): PlanCode {
  if (!sub) return 'INTERNAL';
  if (sub.status === 'CANCELLED') return 'FREE';
  return sub.planCode in PLAN_RANK ? (sub.planCode as PlanCode) : 'FREE';
}

/** Does the tenant's plan include the feature behind this permission? */
export function planAllows(plan: PlanCode, key: string): boolean {
  const min = PERMISSION_MIN_PLAN[key as PermissionKey];
  if (!min) return true;
  return PLAN_RANK[plan] >= PLAN_RANK[min];
}

export function lockedKeys(plan: PlanCode, keys: Iterable<string>): string[] {
  return [...keys].filter((k) => !planAllows(plan, k));
}

/** "Facility Manager" → "facility-manager"; collision → "facility-manager-2". */
export function roleKeyFor(name: string, existing: Iterable<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'role';
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Human summary for the "Your access was updated" alert. */
export function accessChangeSummary(added: string[], removed: string[]): string {
  const parts = [...added.map((k) => `+${label(k)}`), ...removed.map((k) => `−${label(k)}`)];
  return parts.slice(0, 4).join(', ') + (parts.length > 4 ? ` and ${parts.length - 4} more` : '');
}
