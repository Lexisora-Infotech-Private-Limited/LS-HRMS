import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Task } from '@prisma/client';
import type { MyTask, TaskCreateInput, TaskDetail, TaskMoveInput, TaskMoveResult, TaskStatusKey, TaskUpdateInput } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { currentTenantId } from '../../../core/context/request-context';
import { AppError, badRequest, conflict, forbidden } from '../../../core/http/errors';
import { WorkAccessService } from '../work-access.service';
import { WorkEvents } from '../work-events.service';
import { WorkMetricsService } from '../projects/work-metrics.service';
import { GitService } from '../git/git.service';
import { moveMessage, planTransition, STATUS_LABEL, type TaskStatus } from '../work.rules';
import { dateKey, dateOnly, iso } from '../work.util';
import { toCard } from './task-mapper';

const LOCKED_PROJECT = ['ARCHIVED', 'COMPLETED', 'CANCELLED'];

@Injectable()
export class TasksService {
  private readonly log = new Logger('Tasks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkAccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: WorkEvents,
    private readonly metrics: WorkMetricsService,
    private readonly git: GitService,
  ) {}

  private assertWritable(p: { status: string; name: string }) {
    if (LOCKED_PROJECT.includes(p.status)) throw new AppError(423, 'PROJECT_LOCKED', `${p.name} is ${p.status.toLowerCase()} — its board is read-only`);
  }

  /** Employees who may be assigned on a board: the department lead + allocated members. */
  private async boardPeople(projectId: string, departmentId: string | null, isSystem: boolean): Promise<string[]> {
    if (isSystem || !departmentId) {
      const m = await this.prisma.projectMember.findMany({ where: { projectId }, select: { employeeId: true } });
      return m.map((x) => x.employeeId);
    }
    const [d, members] = await Promise.all([
      this.prisma.department.findFirst({ where: { id: departmentId }, select: { leadEmployeeId: true } }),
      this.prisma.boardMember.findMany({ where: { projectId, departmentId }, select: { employeeId: true } }),
    ]);
    return [...new Set([...(d?.leadEmployeeId ? [d.leadEmployeeId] : []), ...members.map((m) => m.employeeId)])];
  }

  private recompute(projectId: string) {
    void this.metrics.recomputeProject(projectId).catch((e) => this.log.warn(`recompute ${projectId}: ${(e as Error).message}`));
  }

  private async userIds(employeeIds: (string | null | undefined)[]) {
    return this.notifications.usersForEmployees(employeeIds);
  }

  // ── Create ──────────────────────────────────────────────────────────────
  async create(input: TaskCreateInput) {
    const v = await this.access.viewer();
    const project = await this.access.requireProject(v, input.projectId);
    this.assertWritable(project);
    if (!project.isSystem && !project.boardDepartmentIds.includes(input.departmentId)) throw badRequest('Pick one of the project’s team boards', 'BOARD_INVALID');
    const dept = await this.prisma.department.findFirst({ where: { id: input.departmentId }, select: { id: true, name: true } });
    if (!dept) throw badRequest('Team board not found');
    const rights = await this.access.boardRights(v, project, input.departmentId);
    if (!rights.canView) throw this.access.boardLockedError(dept.name, dept.id);
    if (input.assigneeEmployeeId) {
      const people = await this.boardPeople(project.id, input.departmentId, project.isSystem);
      if (!people.includes(input.assigneeEmployeeId)) throw new AppError(422, 'ASSIGNEE_NOT_ON_BOARD', `The assignee must be a member of the ${dept.name} board`);
      if (!rights.canManage && input.assigneeEmployeeId !== v.employeeId) throw forbidden('Only the board lead can assign tasks to others');
    }
    if (input.moduleName) {
      const m = await this.prisma.projectModule.findFirst({ where: { projectId: project.id, name: input.moduleName } });
      if (!m) {
        if (!this.access.canManageProject(v, project)) throw new AppError(422, 'MODULE_INVALID', `${input.moduleName} is not a module of ${project.name}`);
        await this.prisma.projectModule.create({ data: { tenantId: currentTenantId(), projectId: project.id, name: input.moduleName, sortOrder: 99 } });
      }
    }
    const status: TaskStatus = input.assigneeEmployeeId ? 'ALLOTTED' : 'OPEN';
    const seq = await this.prisma.project.update({ where: { id: project.id }, data: { taskSeq: { increment: 1 } }, select: { taskSeq: true } });
    const number = seq.taskSeq;
    const key = `${project.key}-${number}`;
    const maxRank = await this.prisma.task.aggregate({ where: { projectId: project.id, departmentId: input.departmentId, status }, _max: { rank: true } });
    const task = await this.prisma.task.create({
      data: {
        tenantId: currentTenantId(),
        key,
        number,
        projectId: project.id,
        departmentId: input.departmentId,
        moduleName: input.moduleName,
        title: input.title,
        description: input.description,
        status,
        rank: (maxRank._max.rank ?? 0) + 1,
        assigneeEmployeeId: input.assigneeEmployeeId,
        reporterEmployeeId: v.employeeId,
        estimatedMinutes: input.estimatedHours != null ? Math.round(input.estimatedHours * 60) : null,
        dueDate: input.dueDate ? dateOnly(input.dueDate) : null,
        transitions: { create: [{ tenantId: currentTenantId(), fromStatus: null, toStatus: status, kind: 'CREATE', note: `Created on the ${dept.name} board`, byEmployeeId: v.employeeId, byName: v.name }] },
      },
    });
    await this.audit.record({ action: 'task.created', entity: 'Task', entityId: task.id, meta: { key, title: task.title, board: dept.name } });
    if (task.assigneeEmployeeId && task.assigneeEmployeeId !== v.employeeId) {
      await this.notifications.notify({ userIds: await this.userIds([task.assigneeEmployeeId]), type: 'task.assigned', title: `${key} assigned to you: ${task.title}`, link: `/board?project=${project.id}&board=${dept.id}&task=${task.id}`, from: v.name });
    }
    this.events.boardChanged(project.id, dept.id, task.id);
    if (task.assigneeEmployeeId) this.events.trackerTasksChanged(await this.userIds([task.assigneeEmployeeId]));
    this.events.emit('task.created', { taskId: task.id, projectId: project.id });
    this.recompute(project.id);
    const warning = input.dueDate && project.deadline && input.dueDate > dateKey(project.deadline)! ? `Due date is after the project deadline (${dateKey(project.deadline)})` : null;
    return { id: task.id, key, warning };
  }

  // ── My tasks (dashboard to-do, tracker, intern links) ─────────────────────
  async mine(): Promise<MyTask[]> {
    const v = await this.access.viewer();
    if (!v.employeeId) return [];
    const rows = await this.prisma.task.findMany({
      where: {
        OR: [
          { assigneeEmployeeId: v.employeeId, status: { in: ['ALLOTTED', 'WIP', 'DEV_COMPLETED', 'QA'] } },
          { isStanding: true, project: { isSystem: true } },
        ],
        project: { status: { in: ['PLANNING', 'ACTIVE'] } },
      },
      include: { project: { select: { name: true, isSystem: true } } },
      orderBy: [{ isStanding: 'asc' }, { dueDate: 'asc' }, { number: 'asc' }],
    });
    return rows.map((t) => ({
      id: t.id,
      key: t.key,
      title: t.title,
      projectId: t.projectId,
      projectName: t.project.name,
      moduleName: t.moduleName,
      status: t.status as TaskStatusKey,
      estimatedMinutes: t.estimatedMinutes,
      loggedMinutes: t.loggedMinutes,
      dueDate: dateKey(t.dueDate),
      isStanding: t.isStanding,
    }));
  }

  // ── Detail ──────────────────────────────────────────────────────────────
  async detail(id: string): Promise<TaskDetail> {
    const v = await this.access.viewer();
    const { task: t, project, rights } = await this.access.requireTask(v, id);
    const [comments, history, commits, modules, dept] = await Promise.all([
      this.prisma.taskComment.findMany({ where: { taskId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.taskTransition.findMany({ where: { taskId: id }, orderBy: { at: 'desc' }, take: 100 }),
      this.prisma.gitCommitLink.findMany({ where: { taskId: id }, orderBy: { committedAt: 'desc' }, take: 20 }),
      this.prisma.projectModule.findMany({ where: { projectId: project.id, isArchived: false }, orderBy: { sortOrder: 'asc' } }),
      t.departmentId ? this.prisma.department.findFirst({ where: { id: t.departmentId }, select: { name: true } }) : Promise.resolve(null),
    ]);
    const people = await this.boardPeople(project.id, t.departmentId, project.isSystem);
    const names = await this.access.names([t.assigneeEmployeeId, t.reporterEmployeeId, ...people]);
    const card = toCard(t, names, rights, v.employeeId);
    const canEdit = !LOCKED_PROJECT.includes(project.status) && (rights.canManage || (!!v.employeeId && t.assigneeEmployeeId === v.employeeId));
    return {
      ...card,
      canMove: card.canMove && !LOCKED_PROJECT.includes(project.status),
      projectId: project.id,
      projectKey: project.key,
      projectName: project.name,
      departmentId: t.departmentId,
      departmentName: dept?.name ?? null,
      description: t.description,
      reporterName: t.reporterEmployeeId ? (names.get(t.reporterEmployeeId) ?? null) : null,
      isStanding: t.isStanding,
      gitBranchUrl: t.gitBranchUrl,
      gitSyncError: t.gitSyncError,
      pipelineStatus: t.pipelineStatus,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      startedAt: iso(t.startedAt),
      devCompletedAt: iso(t.devCompletedAt),
      doneAt: iso(t.doneAt),
      comments: comments.map((c) => ({ id: c.id, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString() })),
      history: history.map((h) => ({ id: h.id, kind: h.kind, fromStatus: h.fromStatus, toStatus: h.toStatus, note: h.note, byName: h.byName, at: h.at.toISOString() })),
      commits: commits.map((c) => ({ sha: c.sha, message: c.message, authorName: c.authorName, committedAt: c.committedAt.toISOString(), url: c.url })),
      assigneeOptions: people.map((p) => ({ value: p, label: names.get(p) ?? p })).sort((a, b) => a.label.localeCompare(b.label)),
      moduleOptions: modules.map((m) => m.name),
      canEdit,
    };
  }

  // ── Update fields ───────────────────────────────────────────────────────
  async update(id: string, input: TaskUpdateInput) {
    const v = await this.access.viewer();
    const { task: t, project, rights } = await this.access.requireTask(v, id);
    this.assertWritable(project);
    const isAssignee = !!v.employeeId && t.assigneeEmployeeId === v.employeeId;
    if (!rights.canManage && !isAssignee && !(input.assigneeEmployeeId === v.employeeId && !t.assigneeEmployeeId && Object.keys(input).length === 1)) {
      throw forbidden('Only the assignee or the board lead can edit this task');
    }
    const data: Prisma.TaskUpdateInput = { version: { increment: 1 } };
    const changes: string[] = [];
    if (input.title !== undefined && input.title !== t.title) (data.title = input.title), changes.push('title');
    if (input.description !== undefined && input.description !== t.description) (data.description = input.description), changes.push('description');
    if (input.moduleName !== undefined && input.moduleName !== t.moduleName) {
      if (input.moduleName && !(await this.prisma.projectModule.count({ where: { projectId: project.id, name: input.moduleName } }))) throw new AppError(422, 'MODULE_INVALID', `${input.moduleName} is not a module of ${project.name}`);
      data.moduleName = input.moduleName;
      changes.push('module');
    }
    if (input.estimatedHours !== undefined) {
      const m = input.estimatedHours != null ? Math.round(input.estimatedHours * 60) : null;
      if (m !== t.estimatedMinutes) (data.estimatedMinutes = m), changes.push('estimate');
    }
    if (input.dueDate !== undefined && input.dueDate !== dateKey(t.dueDate)) (data.dueDate = input.dueDate ? dateOnly(input.dueDate) : null), changes.push('due date');
    let newAssignee: string | null | undefined;
    let statusChange: { from: TaskStatus; to: TaskStatus } | null = null;
    if (input.assigneeEmployeeId !== undefined && input.assigneeEmployeeId !== t.assigneeEmployeeId) {
      if (input.assigneeEmployeeId) {
        const people = await this.boardPeople(project.id, t.departmentId, project.isSystem);
        if (!people.includes(input.assigneeEmployeeId)) throw new AppError(422, 'ASSIGNEE_NOT_ON_BOARD', 'The assignee must be a member of this board');
        if (!rights.canManage && input.assigneeEmployeeId !== v.employeeId) throw forbidden('Only the board lead can assign tasks to others');
      } else if (!rights.canManage && !isAssignee) throw forbidden('Only the board lead can unassign this task');
      newAssignee = input.assigneeEmployeeId;
      data.assigneeEmployeeId = newAssignee;
      if (newAssignee && t.status === 'OPEN') statusChange = { from: 'OPEN', to: 'ALLOTTED' };
      if (!newAssignee && t.status === 'ALLOTTED') statusChange = { from: 'ALLOTTED', to: 'OPEN' };
      if (statusChange) (data.status = statusChange.to), (data.statusChangedAt = new Date());
      changes.push('assignee');
    }
    if (!changes.length) return this.detail(id);
    await this.prisma.task.update({ where: { id }, data });
    const names = newAssignee ? await this.access.names([newAssignee]) : new Map<string, string>();
    await this.prisma.taskTransition.create({
      data: {
        tenantId: currentTenantId(),
        taskId: id,
        fromStatus: statusChange?.from ?? null,
        toStatus: statusChange?.to ?? null,
        kind: newAssignee !== undefined ? 'ASSIGN' : 'EDIT',
        note: newAssignee !== undefined ? (newAssignee ? `Assigned to ${names.get(newAssignee) ?? 'member'}` : 'Unassigned') : `Changed ${changes.join(', ')}`,
        byEmployeeId: v.employeeId,
        byName: v.name,
      },
    });
    await this.audit.record({ action: newAssignee !== undefined ? 'task.assigned' : 'task.updated', entity: 'Task', entityId: id, meta: { key: t.key, changes } });
    if (newAssignee && newAssignee !== v.employeeId) {
      await this.notifications.notify({ userIds: await this.userIds([newAssignee]), type: 'task.assigned', title: `${t.key} assigned to you: ${input.title ?? t.title}`, link: `/board?project=${project.id}&board=${t.departmentId ?? ''}&task=${id}`, from: v.name });
    }
    if (newAssignee !== undefined) this.events.trackerTasksChanged(await this.userIds([newAssignee, t.assigneeEmployeeId]));
    if (statusChange) this.events.taskStatusChanged(id, statusChange.from, statusChange.to);
    this.events.boardChanged(project.id, t.departmentId, id);
    if (changes.includes('estimate') || statusChange) this.recompute(project.id);
    return this.detail(id);
  }

  // ── Move (kanban drag / "Move to …" / "Mark done") ──────────────────────────
  private async reorder(t: Task, to: TaskStatus, beforeTaskId?: string) {
    const col = await this.prisma.task.findMany({
      where: { projectId: t.projectId, departmentId: t.departmentId, status: to, isStanding: false, id: { not: t.id } },
      orderBy: [{ rank: 'asc' }, { number: 'asc' }],
      select: { id: true, rank: true },
    });
    const idx = beforeTaskId ? col.findIndex((c) => c.id === beforeTaskId) : -1;
    const order = col.map((c) => c.id);
    order.splice(idx >= 0 ? idx : order.length, 0, t.id);
    const updates = order
      .map((taskId, i) => ({ taskId, rank: i + 1 }))
      .filter((u) => u.taskId === t.id || col.find((c) => c.id === u.taskId)?.rank !== u.rank);
    for (const u of updates) if (u.taskId !== t.id) await this.prisma.task.update({ where: { id: u.taskId }, data: { rank: u.rank } });
    return order.indexOf(t.id) + 1;
  }

  async move(id: string, input: TaskMoveInput): Promise<TaskMoveResult> {
    const v = await this.access.viewer();
    const { task: t, project, rights } = await this.access.requireTask(v, id);
    this.assertWritable(project);
    if (t.isStanding) throw new AppError(422, 'STANDING_TASK', `${t.key} is a standing task and has no board column`);
    const me = v.employeeId;
    const canMove = rights.canManage || (!!me && (t.assigneeEmployeeId === null || t.assigneeEmployeeId === me));
    if (!canMove) throw forbidden(`${t.key} is assigned to someone else — only the board lead can move it`);
    if (input.version !== undefined && input.version !== t.version) throw conflict(`${t.key} was just changed by someone else — the board has been refreshed`, 'VERSION_CONFLICT');
    const from = t.status as TaskStatus;
    const to = input.toStatus as TaskStatus;
    const names0 = await this.access.names([t.assigneeEmployeeId, me]);

    if (from === to) {
      const rank = await this.reorder(t, to, input.beforeTaskId);
      const updated = await this.prisma.task.update({ where: { id }, data: { rank, version: { increment: 1 } } });
      this.events.boardChanged(project.id, t.departmentId, id);
      return { task: toCard(updated, names0, rights, me), message: `${t.key} reordered` };
    }
    if (to === 'OPEN' && t.assigneeEmployeeId && !rights.canManage && t.assigneeEmployeeId !== me) throw forbidden('Only the board lead can return a task to Open');
    if (from !== 'OPEN' && !t.assigneeEmployeeId && !me) throw new AppError(422, 'ASSIGNEE_REQUIRED', 'Assign the task before moving it');

    const plan = planTransition({ from, to, hasRepo: !!project.gitRepoUrl, assigneeEmployeeId: t.assigneeEmployeeId, moverEmployeeId: me, startedAt: t.startedAt, now: new Date() });
    const rank = await this.reorder(t, to, input.beforeTaskId);
    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        status: to,
        rank,
        statusChangedAt: new Date(),
        version: { increment: 1 },
        ...plan.set,
        ...(plan.git !== 'none' ? { gitSyncStatus: 'PENDING' as const } : {}),
      },
    });
    await this.prisma.taskTransition.create({
      data: { tenantId: currentTenantId(), taskId: id, fromStatus: from, toStatus: to, kind: 'MOVE', note: input.reason ?? (plan.backward ? 'Moved back' : null), byEmployeeId: me, byName: v.name },
    });
    await this.audit.record({ action: to === 'DONE' ? 'task.done' : 'task.moved', entity: 'Task', entityId: id, meta: { key: t.key, from, to, reason: input.reason ?? null } });

    // Git side effect after the status change has committed; never blocks the move.
    let git: NonNullable<TaskMoveResult['git']> = { action: 'none', status: 'NONE' };
    let targetBranch: string | undefined;
    if (plan.git !== 'none') {
      const r = await this.git.syncTask(id, plan.git);
      git = { action: r.action, status: r.status, branch: r.branch ?? null, mrUrl: r.mrUrl ?? null, error: r.error ?? null };
      targetBranch = r.targetBranch;
    }
    const fresh = plan.git !== 'none' ? await this.prisma.task.findFirstOrThrow({ where: { id } }) : updated;
    const assignee = fresh.assigneeEmployeeId;
    const names = await this.access.names([assignee, me]);

    // Notifications
    if (to === 'QA') {
      const qa = await this.prisma.department.findFirst({ where: { name: { equals: 'QA', mode: 'insensitive' } }, select: { leadEmployeeId: true } });
      if (qa?.leadEmployeeId && qa.leadEmployeeId !== me) {
        await this.notifications.notify({ userIds: await this.userIds([qa.leadEmployeeId]), type: 'task.qa', title: `${t.key} is ready for QA: ${t.title}`, link: `/board?project=${project.id}&board=${t.departmentId ?? ''}&task=${id}`, from: v.name });
      }
    }
    if (plan.backward && assignee && assignee !== me) {
      await this.notifications.notify({ userIds: await this.userIds([assignee]), type: 'task.bounced', title: `${t.key} moved back to ${STATUS_LABEL[to]}`, body: input.reason, link: `/board?project=${project.id}&board=${t.departmentId ?? ''}&task=${id}`, from: v.name });
    }
    if (plan.set.assigneeEmployeeId && plan.set.assigneeEmployeeId !== me) {
      await this.notifications.notify({ userIds: await this.userIds([plan.set.assigneeEmployeeId]), type: 'task.assigned', title: `${t.key} assigned to you: ${t.title}`, link: `/board?project=${project.id}&task=${id}`, from: v.name });
    }

    this.events.taskStatusChanged(id, from, to);
    this.events.boardChanged(project.id, t.departmentId, id);
    this.events.trackerTasksChanged(await this.userIds([assignee, t.assigneeEmployeeId]));
    this.recompute(project.id);
    const message = moveMessage(t.key, to, { action: git.action, status: git.status, branch: git.branch, targetBranch });
    return { task: toCard(fresh, names, rights, me), message, git };
  }

  // ── Comments ────────────────────────────────────────────────────────────
  async comment(id: string, body: string) {
    const v = await this.access.viewer();
    const { task: t, project } = await this.access.requireTask(v, id);
    const c = await this.prisma.taskComment.create({ data: { tenantId: currentTenantId(), taskId: id, authorEmployeeId: v.employeeId, authorName: v.name, body } });
    await this.audit.record({ action: 'task.commented', entity: 'Task', entityId: id, meta: { key: t.key } });
    const recipients = [t.assigneeEmployeeId, t.reporterEmployeeId].filter((x) => x && x !== v.employeeId);
    if (recipients.length) {
      await this.notifications.notify({ userIds: await this.userIds(recipients), type: 'task.comment', title: `${v.name} commented on ${t.key}`, body: body.slice(0, 200), link: `/board?project=${project.id}&board=${t.departmentId ?? ''}&task=${id}`, from: v.name });
    }
    return { id: c.id, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString() };
  }

  // ── Git retry ───────────────────────────────────────────────────────────
  async retryGit(id: string) {
    const v = await this.access.viewer();
    const { task: t, project, rights } = await this.access.requireTask(v, id);
    if (!rights.canManage && t.assigneeEmployeeId !== v.employeeId) throw forbidden('Only the assignee or the board lead can retry the GitLab sync');
    if (!project.gitRepoUrl) throw new AppError(422, 'NO_REPO', `${project.name} has no Git repository linked`);
    const action = t.status === 'DEV_COMPLETED' || t.status === 'QA' ? 'mr' : 'branch';
    const r = await this.git.syncTask(id, action);
    const message =
      r.status === 'SYNCED'
        ? action === 'mr'
          ? `${t.key} · merge request ${r.mrUrl ? 'ready' : 'synced'} (${r.branch})`
          : `${t.key} · branch ${r.branch} ready`
        : `GitLab sync failed: ${r.error ?? 'unknown error'}`;
    return { ...r, message };
  }

  // ── Cancel / delete ─────────────────────────────────────────────────────
  async remove(id: string, reason?: string) {
    const v = await this.access.viewer();
    const { task: t, project, rights } = await this.access.requireTask(v, id);
    this.assertWritable(project);
    if (!rights.canManage && !(t.reporterEmployeeId === v.employeeId && t.status === 'OPEN')) throw forbidden('Only the board lead can cancel this task');
    if ((t.status === 'OPEN' || t.status === 'ALLOTTED') && t.loggedMinutes === 0) {
      await this.prisma.task.delete({ where: { id } });
      await this.audit.record({ action: 'task.deleted', entity: 'Task', entityId: id, meta: { key: t.key, title: t.title } });
    } else {
      await this.prisma.task.update({ where: { id }, data: { status: 'CANCELLED', statusChangedAt: new Date(), version: { increment: 1 } } });
      await this.prisma.taskTransition.create({ data: { tenantId: currentTenantId(), taskId: id, fromStatus: t.status, toStatus: 'CANCELLED', kind: 'MOVE', note: reason ?? 'Cancelled', byEmployeeId: v.employeeId, byName: v.name } });
      await this.audit.record({ action: 'task.cancelled', entity: 'Task', entityId: id, meta: { key: t.key, reason: reason ?? null } });
      this.events.taskStatusChanged(id, t.status, 'CANCELLED');
    }
    this.events.boardChanged(project.id, t.departmentId, id);
    this.events.trackerTasksChanged(await this.userIds([t.assigneeEmployeeId]));
    this.recompute(project.id);
    return { ok: true, message: `${t.key} removed` };
  }
}
