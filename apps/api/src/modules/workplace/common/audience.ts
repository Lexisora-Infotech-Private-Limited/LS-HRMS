import { Injectable } from '@nestjs/common';
import { initialsOf, type WpAudienceRule } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SpineReader } from './spine';
import { projectIdsByEmployee, resolveAudience, ruleMatches, type AudienceSubject } from './audience.rules';

export { projectIdsByEmployee, resolveAudience, ruleMatches, type AudienceSubject } from './audience.rules';

export const ACTIVE_STATUSES = ['ACTIVE', 'NOTICE_PERIOD'] as const;

export type Brief = { id: string; name: string; first: string; initials: string; userId: string | null; designation: string | null; department: string | null; departmentId: string | null; status: string };

/**
 * Audience resolver + people directory shared by notices, policies, events, LMS
 * assignments and chat membership. Only ACTIVE / NOTICE_PERIOD employees are resolved.
 */
@Injectable()
export class AudienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spine: SpineReader,
  ) {}

  async population(): Promise<AudienceSubject[]> {
    const emps = await this.prisma.employee.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] } },
      select: { id: true, departmentId: true, branchId: true, employmentType: true },
    });
    const [members, projects] = await Promise.all([this.spine.projectMembers({}), this.spine.projects({})]);
    const byEmp = projectIdsByEmployee(members, projects);
    return emps.map((e) => ({ ...e, projectIds: [...(byEmp.get(e.id) ?? [])] }));
  }

  /** Employee ids matching the union of rules. */
  async resolve(rules: WpAudienceRule[]): Promise<string[]> {
    return resolveAudience(await this.population(), rules);
  }

  async subject(employeeId: string): Promise<AudienceSubject | null> {
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, departmentId: true, branchId: true, employmentType: true } });
    if (!e) return null;
    return { ...e, projectIds: await this.spine.projectIdsOf(employeeId) };
  }

  async matches(employeeId: string | null | undefined, rules: WpAudienceRule[]): Promise<boolean> {
    if (!rules.length || rules.some((r) => r.type === 'ALL')) return true;
    if (!employeeId) return false;
    const s = await this.subject(employeeId);
    return !!s && ruleMatches(s, rules);
  }

  /** "Everyone" / "Development · Atlas" */
  label(rules: WpAudienceRule[]): string {
    if (!rules.length || rules.some((r) => r.type === 'ALL')) return 'Everyone';
    return rules.map((r) => r.label ?? r.type).join(' · ');
  }

  /** Fill in missing labels from department / project / employee names. */
  async withLabels(rules: WpAudienceRule[]): Promise<WpAudienceRule[]> {
    const need = rules.filter((r) => !r.label && r.refId);
    if (!need.length) return rules;
    const ids = need.map((r) => r.refId!);
    const [depts, projects, emps, branches] = await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: ids } } }),
      this.spine.projects({ id: { in: ids } }),
      this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }),
      this.prisma.branch.findMany({ where: { id: { in: ids } } }),
    ]);
    const name = new Map<string, string>([
      ...depts.map((d) => [d.id, d.name] as [string, string]),
      ...projects.map((p) => [p.id, p.name.split(' ')[0]!] as [string, string]),
      ...emps.map((e) => [e.id, e.fullName] as [string, string]),
      ...branches.map((b) => [b.id, b.name] as [string, string]),
    ]);
    return rules.map((r) => (r.label || !r.refId ? r : { ...r, label: name.get(r.refId) ?? (r.type === 'EMPLOYMENT_TYPE' ? r.refId : r.type) }));
  }

  // ── Directory helpers ───────────────────────────────────────────────────

  async briefs(employeeIds: (string | null | undefined)[]): Promise<Map<string, Brief>> {
    const ids = [...new Set(employeeIds.filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, firstName: true, userId: true, status: true, departmentId: true, designation: { select: { name: true } }, department: { select: { name: true } } },
    });
    return new Map(
      rows.map((e) => [
        e.id,
        { id: e.id, name: e.fullName, first: e.firstName, initials: initialsOf(e.fullName), userId: e.userId, designation: e.designation?.name ?? null, department: e.department?.name ?? null, departmentId: e.departmentId, status: e.status },
      ]),
    );
  }

  async userIds(employeeIds: (string | null | undefined)[]): Promise<string[]> {
    const ids = employeeIds.filter((x): x is string => !!x);
    if (!ids.length) return [];
    const rows = await this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { userId: true } });
    return rows.map((r) => r.userId).filter((x): x is string => !!x);
  }

  async employeeIdOfUser(userId: string): Promise<string | null> {
    const e = await this.prisma.employee.findFirst({ where: { userId }, select: { id: true } });
    return e?.id ?? null;
  }

  /** Departments/projects a publisher may target with a team notice (lead or manager). */
  async teamsLedBy(employeeId: string): Promise<{ departmentIds: string[]; projectIds: string[] }> {
    const [led, reports, projects, lead] = await Promise.all([
      this.prisma.department.findMany({ where: { leadEmployeeId: employeeId }, select: { id: true } }),
      this.prisma.employee.findMany({ where: { managerId: employeeId }, select: { departmentId: true } }),
      this.spine.projects({ leadEmployeeId: employeeId }),
      this.spine.projectMembers({ employeeId, role: 'LEAD' }),
    ]);
    return {
      departmentIds: [...new Set([...led.map((d) => d.id), ...reports.map((r) => r.departmentId).filter((x): x is string => !!x)])],
      projectIds: [...new Set([...projects.map((p) => p.id), ...lead.map((m) => m.projectId)])],
    };
  }
}
