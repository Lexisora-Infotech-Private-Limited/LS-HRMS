import type { WpAudienceRule } from '@lexisora/shared';

/**
 * Pure audience matching (spec §0.2), shared by notices, events, policies, LMS assignments
 * and chat membership. Kept free of Nest/Prisma so tests and seeds can import it directly.
 */
export type AudienceSubject = { id: string; departmentId: string | null; branchId: string | null; employmentType: string; projectIds: string[] };

/** An employee matches when ANY rule matches; an empty rule list means everyone. */
export function ruleMatches(e: AudienceSubject, rules: WpAudienceRule[]): boolean {
  if (!rules.length) return true;
  return rules.some((r) => {
    switch (r.type) {
      case 'ALL':
        return true;
      case 'DEPARTMENT':
        return !!r.refId && e.departmentId === r.refId;
      case 'BRANCH':
        return !!r.refId && e.branchId === r.refId;
      case 'EMPLOYEE':
        return !!r.refId && r.refId === e.id;
      case 'EMPLOYMENT_TYPE':
        return !!r.refId && r.refId === e.employmentType;
      case 'PROJECT':
        return !!r.refId && e.projectIds.includes(r.refId);
      default:
        return false;
    }
  });
}

/** Resolve a set of rules against a population → matching employee ids (population order). */
export function resolveAudience(pop: AudienceSubject[], rules: WpAudienceRule[]): string[] {
  return pop.filter((e) => ruleMatches(e, rules)).map((e) => e.id);
}

/** Project ids per employee from membership rows plus project leads. */
export function projectIdsByEmployee(members: { projectId: string; employeeId: string }[], projects: { id: string; leadEmployeeId: string | null }[]): Map<string, Set<string>> {
  const byEmp = new Map<string, Set<string>>();
  const add = (emp: string, project: string) => {
    let s = byEmp.get(emp);
    if (!s) byEmp.set(emp, (s = new Set()));
    s.add(project);
  };
  for (const m of members) add(m.employeeId, m.projectId);
  for (const p of projects) if (p.leadEmployeeId) add(p.leadEmployeeId, p.id);
  return byEmp;
}

/**
 * Departments whose every active member reports to `managerId` (directly or further down the chain) —
 * apart from the manager themselves. Only departments where the manager has at least one report count.
 * Used to scope team notices: managing one person in a department doesn't open the whole department (L10).
 */
export function departmentsFullyUnder(managerId: string, people: { id: string; managerId: string | null; departmentId: string | null }[]): string[] {
  const reportsOf = new Map<string, string[]>();
  for (const p of people) if (p.managerId) reportsOf.set(p.managerId, [...(reportsOf.get(p.managerId) ?? []), p.id]);
  const tree = new Set<string>();
  const queue = [...(reportsOf.get(managerId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (tree.has(id) || id === managerId) continue;
    tree.add(id);
    queue.push(...(reportsOf.get(id) ?? []));
  }
  const candidates = new Set(people.filter((p) => tree.has(p.id) && p.departmentId).map((p) => p.departmentId!));
  return [...candidates].filter((d) => people.filter((p) => p.departmentId === d).every((p) => p.id === managerId || tree.has(p.id)));
}
