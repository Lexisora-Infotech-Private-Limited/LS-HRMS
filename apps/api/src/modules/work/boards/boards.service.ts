import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BOARD_COLUMNS, TASK_STATUS_LABELS, type BoardView, type TaskStatusKey } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { currentTenantId } from '../../../core/context/request-context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../../core/http/errors';
import { WorkAccessService } from '../work-access.service';
import { WorkEvents } from '../work-events.service';
import { toCard } from '../tasks/task-mapper';
import { DAY_MS } from '../work.rules';

export type BoardMembersView = {
  department: string;
  leadEmployeeId: string | null;
  leadName: string | null;
  canAllocate: boolean;
  members: { employeeId: string; name: string; designation: string | null; allocatedBy: string | null; allocatedAt: string }[];
  candidates: { value: string; label: string }[];
};

/** Department-isolated team boards: board view, and member allocation by the department lead. */
@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkAccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: WorkEvents,
  ) {}

  private async load(projectId: string, departmentId: string) {
    const v = await this.access.viewer();
    const project = await this.access.requireProject(v, projectId);
    const dept = await this.prisma.department.findFirst({ where: { id: departmentId } });
    if (!dept || (!project.isSystem && !project.boardDepartmentIds.includes(departmentId))) throw notFound('Board');
    const rights = await this.access.boardRights(v, project, departmentId);
    return { v, project, dept, rights };
  }

  async view(projectId: string, departmentId: string, includeDone: boolean): Promise<BoardView> {
    const { v, project, dept, rights } = await this.load(projectId, departmentId);
    if (!rights.canView) throw this.access.boardLockedError(dept.name, dept.id);
    const statuses: TaskStatusKey[] = [...BOARD_COLUMNS];
    const where: Prisma.TaskWhereInput = {
      projectId,
      departmentId,
      isStanding: false,
      OR: [
        { status: { in: [...BOARD_COLUMNS] } },
        ...(includeDone ? [{ status: 'DONE' as const, doneAt: { gte: new Date(Date.now() - 14 * DAY_MS) } }] : []),
      ],
    };
    if (includeDone) statuses.push('DONE');
    const tasks = await this.prisma.task.findMany({ where, orderBy: [{ rank: 'asc' }, { number: 'asc' }] });
    const allocated = await this.prisma.boardMember.findMany({ where: { projectId, departmentId } });
    const names = await this.access.names([...tasks.map((t) => t.assigneeEmployeeId), ...allocated.map((m) => m.employeeId), dept.leadEmployeeId]);
    const cards = tasks.map((t) => toCard(t, names, rights, v.employeeId));
    const members = [
      ...(dept.leadEmployeeId ? [{ employeeId: dept.leadEmployeeId, name: names.get(dept.leadEmployeeId) ?? '—', isLead: true }] : []),
      ...allocated.filter((m) => m.employeeId !== dept.leadEmployeeId).map((m) => ({ employeeId: m.employeeId, name: names.get(m.employeeId) ?? '—', isLead: false })),
    ];
    const locked = ['ARCHIVED', 'COMPLETED', 'CANCELLED'].includes(project.status);
    return {
      project: { id: project.id, key: project.key, name: project.name, status: project.status as BoardView['project']['status'], locked },
      board: {
        departmentId: dept.id,
        name: dept.name,
        locked: false,
        leadEmployeeId: dept.leadEmployeeId,
        leadName: dept.leadEmployeeId ? (names.get(dept.leadEmployeeId) ?? null) : null,
        memberCount: members.length,
        canManage: rights.canAllocate,
      },
      columns: statuses.map((s) => {
        const list = cards.filter((c) => c.status === s);
        return { status: s, label: TASK_STATUS_LABELS[s], count: list.length, cards: locked ? list.map((c) => ({ ...c, canMove: false })) : list };
      }),
      members,
    };
  }

  // ── Members (allocated by the department lead) ─────────────────────────────
  async members(projectId: string, departmentId: string): Promise<BoardMembersView> {
    const { project, dept, rights } = await this.load(projectId, departmentId);
    if (!rights.canView) throw this.access.boardLockedError(dept.name, dept.id);
    const rows = await this.prisma.boardMember.findMany({ where: { projectId, departmentId }, orderBy: { allocatedAt: 'asc' } });
    const emps = await this.prisma.employee.findMany({
      where: { id: { in: rows.map((r) => r.employeeId) } },
      select: { id: true, fullName: true, designation: { select: { name: true } } },
    });
    const eOf = new Map(emps.map((e) => [e.id, e]));
    const names = await this.access.names([...rows.map((r) => r.allocatedByEmployeeId), dept.leadEmployeeId]);
    let candidates: { value: string; label: string }[] = [];
    if (rights.canAllocate) {
      const projectMembers = await this.prisma.projectMember.findMany({ where: { projectId }, select: { employeeId: true } });
      const pool = await this.prisma.employee.findMany({
        where: {
          status: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
          id: { notIn: [...rows.map((r) => r.employeeId), ...(dept.leadEmployeeId ? [dept.leadEmployeeId] : [])] },
          OR: [{ departmentId }, { id: { in: projectMembers.map((m) => m.employeeId) } }],
        },
        orderBy: { fullName: 'asc' },
        select: { id: true, fullName: true, department: { select: { name: true } } },
      });
      candidates = pool.map((e) => ({ value: e.id, label: `${e.fullName}${e.department ? ` · ${e.department.name}` : ''}` }));
    }
    void project;
    return {
      department: dept.name,
      leadEmployeeId: dept.leadEmployeeId,
      leadName: dept.leadEmployeeId ? (names.get(dept.leadEmployeeId) ?? null) : null,
      canAllocate: rights.canAllocate,
      members: rows.map((r) => ({
        employeeId: r.employeeId,
        name: eOf.get(r.employeeId)?.fullName ?? '—',
        designation: eOf.get(r.employeeId)?.designation?.name ?? null,
        allocatedBy: r.allocatedByEmployeeId ? (names.get(r.allocatedByEmployeeId) ?? null) : null,
        allocatedAt: r.allocatedAt.toISOString(),
      })),
      candidates,
    };
  }

  async allocate(projectId: string, departmentId: string, employeeId: string) {
    const { v, project, dept, rights } = await this.load(projectId, departmentId);
    if (!rights.canAllocate) throw forbidden(`Only the ${dept.name} lead can allocate members to this board`);
    if (project.status === 'ARCHIVED') throw new AppError(423, 'PROJECT_LOCKED', 'Archived projects are read-only');
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId }, select: { id: true, fullName: true, userId: true, status: true } });
    if (!e || e.status === 'EXITED') throw badRequest('Employee not found');
    if (e.id === dept.leadEmployeeId) throw conflict(`${e.fullName} leads ${dept.name} and already has access`);
    if (await this.prisma.boardMember.count({ where: { projectId, departmentId, employeeId } })) throw conflict(`${e.fullName} is already on this board`);
    await this.prisma.boardMember.create({ data: { tenantId: currentTenantId(), projectId, departmentId, employeeId, allocatedByEmployeeId: v.employeeId } });
    await this.audit.record({ action: 'board.member.allocated', entity: 'Project', entityId: projectId, meta: { board: dept.name, employeeId, name: e.fullName } });
    if (e.userId) {
      await this.notifications.notify({ userIds: [e.userId], type: 'board.allocated', title: `You now have access to the ${dept.name} board of ${project.name}`, link: `/board?project=${projectId}&board=${departmentId}`, from: v.name });
      this.events.accessChanged([e.userId], projectId, departmentId);
    }
    this.events.boardChanged(projectId, departmentId);
    return { ok: true, message: `${e.fullName} allocated to ${dept.name}` };
  }

  async revoke(projectId: string, departmentId: string, employeeId: string) {
    const { v, project, dept, rights } = await this.load(projectId, departmentId);
    if (!rights.canAllocate) throw forbidden(`Only the ${dept.name} lead can change this board's members`);
    const row = await this.prisma.boardMember.findFirst({ where: { projectId, departmentId, employeeId } });
    if (!row) throw notFound('Board member');
    await this.prisma.boardMember.delete({ where: { id: row.id } });
    // Their ALLOTTED cards return to Open; WIP and later keep the assignee (lead is told).
    const allotted = await this.prisma.task.findMany({ where: { projectId, departmentId, assigneeEmployeeId: employeeId, status: 'ALLOTTED' }, select: { id: true } });
    if (allotted.length) {
      await this.prisma.task.updateMany({ where: { id: { in: allotted.map((t) => t.id) } }, data: { status: 'OPEN', assigneeEmployeeId: null, statusChangedAt: new Date(), version: { increment: 1 } } });
      await this.prisma.taskTransition.createMany({
        data: allotted.map((t) => ({ tenantId: currentTenantId(), taskId: t.id, fromStatus: 'ALLOTTED' as const, toStatus: 'OPEN' as const, kind: 'ASSIGN', note: 'Assignee lost board access', byEmployeeId: v.employeeId, byName: v.name })),
      });
    }
    const inFlight = await this.prisma.task.count({ where: { projectId, departmentId, assigneeEmployeeId: employeeId, status: { in: ['WIP', 'DEV_COMPLETED', 'QA'] } } });
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId }, select: { fullName: true, userId: true } });
    await this.audit.record({ action: 'board.member.revoked', entity: 'Project', entityId: projectId, meta: { board: dept.name, employeeId, returnedToOpen: allotted.length } });
    if (inFlight && dept.leadEmployeeId && dept.leadEmployeeId !== v.employeeId) {
      await this.notifications.notify({
        userIds: await this.notifications.usersForEmployees([dept.leadEmployeeId]),
        type: 'board.assignee_lost_access',
        title: `${e?.fullName ?? 'A member'} lost access to ${inFlight} in-progress task${inFlight === 1 ? '' : 's'} on ${project.name}`,
        link: `/board?project=${projectId}&board=${departmentId}`,
        from: v.name,
      });
    }
    if (e?.userId) {
      this.events.accessChanged([e.userId], projectId, departmentId);
      this.events.trackerTasksChanged([e.userId]);
    }
    this.events.boardChanged(projectId, departmentId);
    return { ok: true, message: `${e?.fullName ?? 'Member'} removed from ${dept.name}`, returnedToOpen: allotted.length };
  }
}
