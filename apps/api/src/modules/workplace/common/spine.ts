import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * Read-only access to spine models owned by other domains (ARCHITECTURE §4). Accessed
 * through a narrow typed facade so this module compiles and degrades gracefully while
 * those domains are still landing: a missing model/column yields empty results.
 */
export type SpineTask = { id: string; key: string; title: string; status: string; assigneeEmployeeId: string | null; reporterEmployeeId: string | null; projectId: string; dueDate: Date | null; departmentId: string | null };
export type SpineProject = { id: string; key: string; name: string; leadEmployeeId: string | null; status: string; isInternal: boolean };
export type SpineProjectMember = { projectId: string; employeeId: string; role: string };
export type SpineTimesheet = { id: string; employeeId: string; weekStart: Date; weekEnd: Date; status: string };
export type SpineHoliday = { id: string; date: Date; name: string; type: string };

type Delegate<T> = { findMany(args?: any): Promise<T[]>; count?(args?: any): Promise<number> };

@Injectable()
export class SpineReader {
  private readonly log = new Logger('WorkplaceSpine');
  constructor(private readonly prisma: PrismaService) {}

  private delegate<T>(name: string): Delegate<T> | null {
    const d = (this.prisma as any)[name];
    return d && typeof d.findMany === 'function' ? (d as Delegate<T>) : null;
  }

  private async safe<T>(name: string, args: any): Promise<T[]> {
    const d = this.delegate<T>(name);
    if (!d) return [];
    try {
      return await d.findMany(args);
    } catch (e) {
      this.log.debug(`${name} read failed: ${(e as Error).message}`);
      return [];
    }
  }

  tasks(where: Record<string, unknown>, take = 50) {
    return this.safe<SpineTask>('task', { where, take, orderBy: { dueDate: 'asc' } });
  }

  projects(where: Record<string, unknown> = {}) {
    return this.safe<SpineProject>('project', { where, orderBy: { name: 'asc' } });
  }

  projectMembers(where: Record<string, unknown>) {
    return this.safe<SpineProjectMember>('projectMember', { where });
  }

  timesheets(where: Record<string, unknown>) {
    return this.safe<SpineTimesheet>('timesheet', { where, orderBy: { weekStart: 'desc' }, take: 10 });
  }

  holidays(from: Date, to: Date) {
    return this.safe<SpineHoliday>('holiday', { where: { date: { gte: from, lt: to } }, orderBy: { date: 'asc' } });
  }

  /** Employee ids on a project (members + lead). */
  async projectEmployeeIds(projectId: string): Promise<string[]> {
    const [members, proj] = await Promise.all([this.projectMembers({ projectId }), this.projects({ id: projectId })]);
    return [...new Set([...members.map((m) => m.employeeId), ...proj.map((p) => p.leadEmployeeId).filter((x): x is string => !!x)])];
  }

  /** Projects an employee belongs to (member or lead). */
  async projectIdsOf(employeeId: string): Promise<string[]> {
    const [members, led] = await Promise.all([this.projectMembers({ employeeId }), this.projects({ leadEmployeeId: employeeId })]);
    return [...new Set([...members.map((m) => m.projectId), ...led.map((p) => p.id)])];
  }

  /** Other interview-scoring and onboarding to-dos (people domain), read defensively. */
  async rawFindMany<T>(model: string, args: any): Promise<T[]> {
    return this.safe<T>(model, args);
  }
}
