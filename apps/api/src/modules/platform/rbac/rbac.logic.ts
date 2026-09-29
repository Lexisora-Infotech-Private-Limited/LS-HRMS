import {
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_MIN_PLAN,
  PERMISSION_REQUIRES,
  PLAN_RANK,
  ROLE_MATRIX_ROWS,
  type MatrixCellState,
  type PermissionKey,
  type PlanCode,
} from '@lexisora/shared';

/** Pure RBAC rules for the Roles & access screen (no I/O — unit tested). */

export const isPermissionKey = (k: string): k is PermissionKey => (PERMISSION_KEYS as string[]).includes(k);

/** Matrix cell for a role: all keys of the row held → "all", some → "some" (half fill), none → "none". */
export function matrixCellState(perms: Iterable<string>, rowKeys: readonly string[]): MatrixCellState {
  const set = new Set(perms);
  const held = rowKeys.filter((k) => set.has(k)).length;
  if (held === 0) return 'none';
  return held === rowKeys.length ? 'all' : 'some';
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
  return { next: PERMISSION_KEYS.filter((k) => set.has(k)).concat([...set].filter((k) => !isPermissionKey(k))), added, removed };
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
