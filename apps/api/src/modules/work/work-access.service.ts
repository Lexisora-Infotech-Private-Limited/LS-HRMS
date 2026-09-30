import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { requireContext } from '../../core/context/request-context';
import { hasPerm } from '../../core/auth/decorators';
import { AppError, notFound } from '../../core/http/errors';
import { boardAccess } from './work.rules';

export type Viewer = {
  employeeId: string | null;
  userId: string | null;
  name: string;
  viewAll: boolean;
  canManageProjects: boolean;
  /** Department ids I lead (Department.leadEmployeeId). */
  leadsDepartments: string[];
};

export type BoardRights = { canView: boolean; canManage: boolean; canAllocate: boolean };

/**
 * Relationship scoping for the work domain:
 *  - projects: viewAll (tasks.viewAllBoards) → every project; otherwise led / member / board-allocated /
 *    department-lead-of-a-board projects.
 *  - team boards: visible to viewAll, the department lead, and members allocated by that lead.
 */
@Injectable()
export class WorkAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async viewer(): Promise<Viewer> {
    const ctx = requireContext();
    const employeeId = ctx.employeeId ?? null;
    const leads = employeeId ? await this.prisma.department.findMany({ where: { leadEmployeeId: employeeId }, select: { id: true } }) : [];
    return {
      employeeId,
      userId: ctx.userId ?? null,
      name: ctx.userName ?? 'System',
      viewAll: hasPerm(ctx, 'tasks.viewAllBoards'),
      canManageProjects: hasPerm(ctx, 'projects.manage'),
      leadsDepartments: leads.map((d) => d.id),
    };
  }

  /** Prisma where-clause for projects this viewer may see. */
  async projectScope(v: Viewer): Promise<Prisma.ProjectWhereInput> {
    if (v.viewAll) return {};
    if (!v.employeeId) return { id: '__none__' };
    const or: Prisma.ProjectWhereInput[] = [
      { leadEmployeeId: v.employeeId },
      { members: { some: { employeeId: v.employeeId } } },
      { boardMembers: { some: { employeeId: v.employeeId } } },
    ];
    if (v.leadsDepartments.length) or.push({ boardDepartmentIds: { hasSome: v.leadsDepartments } });
    return { OR: or };
  }

  async canSeeProject(v: Viewer, projectId: string): Promise<boolean> {
    if (v.viewAll) return true;
    const scope = await this.projectScope(v);
    return (await this.prisma.project.count({ where: { AND: [{ id: projectId }, scope] } })) > 0;
  }

  /** Load a project the viewer can see, else 404 (never reveal existence). */
  async requireProject(v: Viewer, projectId: string) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId } });
    if (!p || (!p.isSystem && !(await this.canSeeProject(v, projectId)))) throw notFound('Project');
    return p;
  }

  canManageProject(v: Viewer, p: { leadEmployeeId: string | null }): boolean {
    if (!v.canManageProjects) return false;
    return v.viewAll || (!!v.employeeId && p.leadEmployeeId === v.employeeId);
  }

  /** Rights on one department board of a project. */
  async boardRights(v: Viewer, project: { id: string; leadEmployeeId: string | null; isSystem?: boolean }, departmentId: string): Promise<BoardRights> {
    if (project.isSystem) return { canView: true, canManage: v.viewAll, canAllocate: false };
    const isAllocated = v.employeeId
      ? (await this.prisma.boardMember.count({ where: { projectId: project.id, departmentId, employeeId: v.employeeId } })) > 0
      : false;
    return boardAccess({
      viewAll: v.viewAll,
      isDeptLead: v.leadsDepartments.includes(departmentId),
      isAllocated,
      isProjectLead: !!v.employeeId && project.leadEmployeeId === v.employeeId,
    });
  }

  /** Map of `${projectId}|${departmentId}` → rights for many boards at once (search, my tasks). */
  async visibleBoards(v: Viewer): Promise<{ all: boolean; keys: Set<string> }> {
    if (v.viewAll) return { all: true, keys: new Set() };
    const keys = new Set<string>();
    if (v.employeeId) {
      const rows = await this.prisma.boardMember.findMany({ where: { employeeId: v.employeeId }, select: { projectId: true, departmentId: true } });
      for (const r of rows) keys.add(`${r.projectId}|${r.departmentId}`);
    }
    if (v.leadsDepartments.length) {
      const ps = await this.prisma.project.findMany({ where: { boardDepartmentIds: { hasSome: v.leadsDepartments } }, select: { id: true, boardDepartmentIds: true } });
      for (const p of ps) for (const d of p.boardDepartmentIds) if (v.leadsDepartments.includes(d)) keys.add(`${p.id}|${d}`);
    }
    return { all: false, keys };
  }

  /** employeeId → full name for a set of ids. */
  async names(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map();
    const rows = await this.prisma.employee.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }

  /** Load a task with its project, enforcing board visibility (403 BOARD_PRIVATE / 404). */
  async requireTask(v: Viewer, taskId: string) {
    const t = await this.prisma.task.findFirst({ where: { id: taskId }, include: { project: true } });
    if (!t) throw notFound('Task');
    if (!t.project.isSystem && !(await this.canSeeProject(v, t.projectId)) && !(v.employeeId && t.assigneeEmployeeId === v.employeeId)) throw notFound('Task');
    let rights: BoardRights;
    if (t.project.isSystem) rights = { canView: true, canManage: v.viewAll, canAllocate: false };
    else if (!t.departmentId) {
      const lead = !!v.employeeId && t.project.leadEmployeeId === v.employeeId;
      rights = { canView: true, canManage: v.viewAll || lead, canAllocate: false };
    } else rights = await this.boardRights(v, t.project, t.departmentId);
    // The assignee always keeps access to their own card (e.g. after a board revoke).
    if (!rights.canView && v.employeeId && t.assigneeEmployeeId === v.employeeId) rights = { ...rights, canView: true };
    if (!rights.canView) {
      const d = await this.prisma.department.findFirst({ where: { id: t.departmentId! }, select: { name: true } });
      throw this.boardLockedError(d?.name ?? 'team', t.departmentId!);
    }
    return { task: t, project: t.project, rights };
  }

  boardLockedError(departmentName: string, departmentId: string) {
    return new AppError(403, 'BOARD_PRIVATE', `This board is private to the ${departmentName} team`, { department: departmentName, departmentId });
  }
}
