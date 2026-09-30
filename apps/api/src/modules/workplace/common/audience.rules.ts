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
