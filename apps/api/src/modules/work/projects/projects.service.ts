import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  BoardInfo,
  ProjectCreateInput,
  ProjectDetail,
  ProjectKpis,
  ProjectRow,
  ProjectUpdateInput,
  ProjectStatusKey,
  ProjectHealthKey,
} from '@lexisora/shared';
import { istDateKey, PROJECT_STATUS_LABELS } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { requireContext, currentTenantId } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../../core/http/errors';
import { paginated } from '../../../core/http/paginate';
import { WorkAccessService, type Viewer } from '../work-access.service';
import { WorkMetricsService } from './work-metrics.service';
import { WorkDocsService } from './work-docs.service';
import { GitService } from '../git/git.service';
import { WorkEvents } from '../work-events.service';
import { projectStatusLabel, suggestKey, type ProjectHealth, type ProjectStatus } from '../work.rules';
import { dateKey, dateOnly, iso, monthRange } from '../work.util';

type ProjectWithClient = Prisma.ProjectGetPayload<{ include: { client: true } }>;

const STATUS_FLOW: Record<ProjectStatus, ProjectStatus[]> = {
  PLANNING: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['PLANNING', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['ACTIVE'],
  ARCHIVED: [],
  CANCELLED: [],
};

@Injectable()
export class ProjectsService {
  private readonly log = new Logger('Projects');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkAccessService,
    private readonly metrics: WorkMetricsService,
    private readonly docs: WorkDocsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly git: GitService,
    private readonly events: WorkEvents,
  ) {}

  // ── Mapping ─────────────────────────────────────────────────────────────
  private async names(ids: (string | null | undefined)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map<string, string>();
    const rows = await this.prisma.employee.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }

  private row(p: ProjectWithClient, names: Map<string, string>): ProjectRow {
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      clientId: p.clientId,
      clientName: p.client?.name ?? (p.isInternal ? 'Internal' : '—'),
      isInternal: p.isInternal,
      leadEmployeeId: p.leadEmployeeId,
      leadName: p.leadEmployeeId ? (names.get(p.leadEmployeeId) ?? null) : null,
      progressPct: p.progressPct,
      estimatedMinutes: p.estimatedMinutes,
      loggedMinutes: p.loggedMinutes,
      status: p.status as ProjectStatusKey,
      health: p.health as ProjectHealthKey,
      healthReason: p.healthReason,
      statusLabel: projectStatusLabel(p.status as ProjectStatus, p.health as ProjectHealth),
      deadline: dateKey(p.deadline),
      billable: p.billable,
      category: p.category,
    };
  }

  // ── List & KPIs ─────────────────────────────────────────────────────────
  async list(q: { page: number; pageSize: number; q?: string; status?: string; clientId?: string; leadEmployeeId?: string; includeClosed?: boolean; tab?: string }) {
    await this.metrics.recomputeTenantIfStale();
    const v = await this.access.viewer();
    const scope = await this.access.projectScope(v);
    const statuses = (q.status ?? '').split(',').filter(Boolean) as ProjectStatus[];
    const where: Prisma.ProjectWhereInput = {
      AND: [
        scope,
        { isSystem: false },
        statuses.length ? { status: { in: statuses } } : q.includeClosed ? {} : { status: { notIn: ['ARCHIVED', 'CANCELLED'] } },
        q.clientId ? { clientId: q.clientId } : {},
        q.leadEmployeeId ? { leadEmployeeId: q.leadEmployeeId } : {},
        q.q
          ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { key: { contains: q.q, mode: 'insensitive' } }, { client: { name: { contains: q.q, mode: 'insensitive' } } }] }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({ where, include: { client: true }, orderBy: [{ createdAt: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.project.count({ where }),
    ]);
    const names = await this.names(rows.map((r) => r.leadEmployeeId));
    return { ...paginated(rows.map((r) => this.row(r, names)), total, q), canCreate: hasPerm(requireContext(), 'projects.manage') };
  }

  async kpis(month?: string): Promise<ProjectKpis> {
    await this.metrics.recomputeTenantIfStale();
    const m = month ?? istDateKey().slice(0, 7);
    const { start, end, label } = monthRange(m);
    const v = await this.access.viewer();
    const scope = await this.access.projectScope(v);
    const projects = await this.prisma.project.findMany({ where: { AND: [scope, { isSystem: false }] }, include: { client: true } });
    const active = projects.filter((p) => p.status === 'ACTIVE');
    const billable = projects.filter((p) => p.billable && !p.isInternal && ['ACTIVE', 'ON_HOLD', 'COMPLETED'].includes(p.status));
    const { byProject, source } = await this.metrics.billableMinutes(billable.map((p) => p.id), start, end);
    let minutes = 0;
    let paise = 0;
    const rateMissing: string[] = [];
    for (const p of billable) {
      const min = byProject.get(p.id) ?? 0;
      const rate = p.ratePerHourPaise ?? p.client?.defaultRatePerHourPaise ?? null;
      minutes += min;
      if (rate == null) {
        if (min > 0) rateMissing.push(p.name);
        continue;
      }
      paise += Math.round((min * rate) / 60);
    }
    return {
      month: m,
      monthLabel: label,
      active: active.length,
      dueThisMonth: active.filter((p) => p.deadline && p.deadline >= start && p.deadline < end).length,
      billableMinutes: minutes,
      billablePaise: paise,
      billableSource: source,
      rateMissing,
      onTrack: active.filter((p) => p.health === 'ON_TRACK').length,
      atRisk: active.filter((p) => p.health === 'AT_RISK' || p.health === 'OFF_TRACK').length,
    };
  }

  // ── Detail ──────────────────────────────────────────────────────────────
  async boards(v: Viewer, p: { id: string; leadEmployeeId: string | null; boardDepartmentIds: string[]; isSystem: boolean }): Promise<BoardInfo[]> {
    if (!p.boardDepartmentIds.length) return [];
    const depts = await this.prisma.department.findMany({ where: { id: { in: p.boardDepartmentIds } } });
    const names = await this.names(depts.map((d) => d.leadEmployeeId).concat(p.leadEmployeeId));
    const counts = await this.prisma.boardMember.groupBy({ by: ['departmentId'], where: { projectId: p.id }, _count: { _all: true } });
    const countOf = new Map(counts.map((c) => [c.departmentId, c._count._all]));
    const out: BoardInfo[] = [];
    for (const id of p.boardDepartmentIds) {
      const d = depts.find((x) => x.id === id);
      if (!d) continue;
      const r = await this.access.boardRights(v, p, id);
      const leadId = d.leadEmployeeId ?? p.leadEmployeeId;
      out.push({
        departmentId: id,
        name: d.name,
        locked: !r.canView,
        leadEmployeeId: leadId,
        leadName: leadId ? (names.get(leadId) ?? null) : null,
        memberCount: r.canView ? (countOf.get(id) ?? 0) : null,
        canManage: r.canAllocate,
      });
    }
    return out;
  }

  async detail(id: string): Promise<ProjectDetail> {
    const v = await this.access.viewer();
    await this.access.requireProject(v, id);
    await this.metrics.recomputeProjectIfStale(id).catch((e) => this.log.warn(e.message));
    const p = await this.prisma.project.findFirstOrThrow({
      where: { id },
      include: { client: true, modules: { orderBy: { sortOrder: 'asc' } }, members: { orderBy: { joinedAt: 'asc' } }, documents: { orderBy: { createdAt: 'desc' } } },
    });
    const tasks = await this.prisma.task.findMany({ where: { projectId: id }, select: { id: true, key: true, title: true, status: true, moduleName: true, loggedMinutes: true, estimatedMinutes: true, isStanding: true, gitBranch: true, gitBranchUrl: true, gitMrUrl: true, gitMrState: true, gitSyncStatus: true, updatedAt: true } });
    const emps = await this.prisma.employee.findMany({
      where: { id: { in: p.members.map((m) => m.employeeId).concat(p.leadEmployeeId ?? []) } },
      select: { id: true, fullName: true, department: { select: { name: true } }, designation: { select: { name: true } } },
    });
    const eOf = new Map(emps.map((e) => [e.id, e]));
    const names = new Map(emps.map((e) => [e.id, e.fullName]));
    const tasksByStatus: Record<string, number> = {};
    for (const t of tasks) if (!t.isStanding) tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1;
    const ctx = requireContext();
    const canManage = this.access.canManageProject(v, p);
    const clientDocs = p.clientId ? await this.prisma.projectDocument.findMany({ where: { clientId: p.clientId, projectId: null }, orderBy: { createdAt: 'desc' } }) : [];
    return {
      ...this.row(p, names),
      description: p.description,
      startDate: dateKey(p.startDate),
      ratePerHourPaise: p.ratePerHourPaise,
      effectiveRatePaise: p.ratePerHourPaise ?? p.client?.defaultRatePerHourPaise ?? null,
      techStack: p.techStack,
      openingLoggedMinutes: p.openingLoggedMinutes,
      taskEstimateMinutes: tasks.filter((t) => !t.isStanding && t.status !== 'CANCELLED').reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0),
      tasksByStatus,
      gitRepoUrl: p.gitRepoUrl,
      gitTargetBranch: p.gitTargetBranch,
      gitLinkStatus: p.gitLinkStatus,
      gitLinkError: p.gitLinkError,
      archiveAccess: p.archiveAccess,
      closedAt: iso(p.closedAt),
      archivedAt: iso(p.archivedAt),
      taskSeq: p.taskSeq,
      modules: p.modules.map((m) => {
        const mt = tasks.filter((t) => t.moduleName === m.name);
        return { id: m.id, name: m.name, estimatedMinutes: m.estimatedMinutes, isArchived: m.isArchived, tasks: mt.length, loggedMinutes: mt.reduce((s, t) => s + t.loggedMinutes, 0) };
      }),
      members: p.members.map((m) => ({
        id: m.id,
        employeeId: m.employeeId,
        name: eOf.get(m.employeeId)?.fullName ?? '—',
        department: eOf.get(m.employeeId)?.department?.name ?? null,
        designation: eOf.get(m.employeeId)?.designation?.name ?? null,
        role: m.role,
        allocationPct: m.allocationPct,
        joinedAt: m.joinedAt.toISOString(),
      })),
      boards: await this.boards(v, p),
      documents: await this.docs.rows([...p.documents, ...clientDocs]),
      recentGit: tasks
        .filter((t) => t.gitBranch || t.gitMrUrl)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, 10)
        .map((t) => ({ taskId: t.id, key: t.key, title: t.title, branch: t.gitBranch, branchUrl: t.gitBranchUrl, mrUrl: t.gitMrUrl, mrState: t.gitMrState, syncStatus: t.gitSyncStatus })),
      canManage,
      canArchive: hasPerm(ctx, 'archive.manage') && p.status === 'COMPLETED',
    };
  }

  // ── Create / update ─────────────────────────────────────────────────────
  async suggestKey(name: string) {
    const taken = new Set((await this.prisma.project.findMany({ select: { key: true } })).map((p) => p.key));
    return { key: suggestKey(name, taken) };
  }

  private async requireActiveLead(employeeId: string) {
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId }, select: { id: true, status: true, departmentId: true, fullName: true, userId: true } });
    if (!e || e.status === 'EXITED') throw new AppError(422, 'LEAD_INVALID', 'Project lead must be an active employee');
    return e;
  }

  async create(input: ProjectCreateInput) {
    const v = await this.access.viewer();
    const client = await this.prisma.client.findFirst({ where: { id: input.clientId } });
    if (!client) throw badRequest('Client not found');
    if (client.status !== 'ACTIVE') throw new AppError(422, 'CLIENT_INACTIVE', `${client.name} is inactive — reactivate the client first`);
    const lead = await this.requireActiveLead(input.leadEmployeeId);
    const taken = new Set((await this.prisma.project.findMany({ select: { key: true } })).map((p) => p.key));
    const key = input.key ?? suggestKey(input.name, taken);
    if (taken.has(key)) throw conflict(`Project key ${key} is already used`, 'KEY_TAKEN');
    if (await this.prisma.project.count({ where: { name: { equals: input.name, mode: 'insensitive' } } })) throw conflict(`A project named ${input.name} already exists`, 'NAME_TAKEN');
    const files = await this.docs.files(input.documentFileIds);
    const tenantId = currentTenantId();
    const boards = input.boardDepartmentIds.length ? input.boardDepartmentIds : lead.departmentId ? [lead.departmentId] : [];
    const isInternal = client.isInternal;
    const project = await this.prisma.project.create({
      data: {
        key,
        name: input.name,
        description: input.description,
        clientId: client.id,
        isInternal,
        category: input.category,
        techStack: input.techStack,
        leadEmployeeId: lead.id,
        startDate: dateOnly(input.startDate),
        deadline: dateOnly(input.deadline),
        billable: isInternal ? false : input.billable,
        ratePerHourPaise: input.ratePerHourPaise ?? null,
        estimatedMinutes: Math.round((input.estimatedHours ?? 0) * 60),
        status: input.status,
        health: input.status === 'ACTIVE' ? 'ON_TRACK' : 'NA',
        boardDepartmentIds: boards,
        gitRepoUrl: input.gitRepoUrl,
        createdByEmployeeId: v.employeeId,
        modules: { create: [...new Set(input.modules)].map((name, i) => ({ tenantId, name, sortOrder: i })) },
        members: { create: [{ tenantId, employeeId: lead.id, role: 'LEAD' }] },
        documents: {
          create: files.map((f) => ({ tenantId, fileId: f.id, title: f.filename, kind: 'REQUIREMENT', sizeBytes: f.size, uploadedByEmployeeId: v.employeeId })),
        },
      },
    });
    await this.audit.record({ action: 'project.created', entity: 'Project', entityId: project.id, meta: { key, name: project.name, client: client.name, documents: files.length } });
    this.events.emit('project.created', { projectId: project.id, key, name: project.name });
    if (lead.userId && lead.id !== v.employeeId) {
      await this.notifications.notify({ userIds: [lead.userId], type: 'project.lead', title: `You are the lead of ${project.name}`, link: `/projects/${project.id}`, from: v.name });
    }
    if (project.gitRepoUrl) void this.git.linkProject(project.id).catch((e) => this.log.warn(e.message));
    return { id: project.id, key };
  }

  private async requireManage(id: string) {
    const v = await this.access.viewer();
    const p = await this.access.requireProject(v, id);
    if (!this.access.canManageProject(v, p)) throw forbidden('Only the project lead or a manager can change this project');
    return { v, p };
  }

  async update(id: string, input: ProjectUpdateInput) {
    const { p } = await this.requireManage(id);
    if (p.status === 'ARCHIVED') throw new AppError(423, 'PROJECT_LOCKED', 'Archived projects are read-only');
    const data: Prisma.ProjectUpdateInput = {};
    if (input.name !== undefined && input.name !== p.name) {
      if (await this.prisma.project.count({ where: { id: { not: id }, name: { equals: input.name, mode: 'insensitive' } } })) throw conflict(`A project named ${input.name} already exists`, 'NAME_TAKEN');
      data.name = input.name;
    }
    if (input.key !== undefined && input.key !== p.key) {
      if (p.taskSeq > 0) throw conflict('The project key is locked once tasks exist', 'KEY_LOCKED');
      if (await this.prisma.project.count({ where: { key: input.key } })) throw conflict(`Project key ${input.key} is already used`, 'KEY_TAKEN');
      data.key = input.key;
    }
    let isInternal = p.isInternal;
    if (input.clientId !== undefined && input.clientId !== p.clientId) {
      const c = await this.prisma.client.findFirst({ where: { id: input.clientId } });
      if (!c) throw badRequest('Client not found');
      data.client = { connect: { id: c.id } };
      data.isInternal = c.isInternal;
      isInternal = c.isInternal;
    }
    if (input.leadEmployeeId !== undefined && input.leadEmployeeId !== p.leadEmployeeId) {
      const lead = await this.requireActiveLead(input.leadEmployeeId);
      data.leadEmployeeId = lead.id;
      await this.prisma.projectMember.upsert({
        where: { projectId_employeeId: { projectId: id, employeeId: lead.id } },
        create: { projectId: id, employeeId: lead.id, role: 'LEAD' },
        update: { role: 'LEAD' },
      });
      if (p.leadEmployeeId) await this.prisma.projectMember.updateMany({ where: { projectId: id, employeeId: p.leadEmployeeId, role: 'LEAD' }, data: { role: 'MEMBER' } });
      this.events.emit('project.lead.changed', { projectId: id, from: p.leadEmployeeId, to: lead.id });
    }
    const start = input.startDate ?? dateKey(p.startDate);
    const end = input.deadline ?? dateKey(p.deadline);
    if (start && end && end < start) throw badRequest('Deadline must be on or after the start date');
    if (input.startDate !== undefined) data.startDate = dateOnly(input.startDate);
    if (input.deadline !== undefined) data.deadline = dateOnly(input.deadline);
    if (input.billable !== undefined || isInternal !== p.isInternal) data.billable = isInternal ? false : (input.billable ?? p.billable);
    if (input.category !== undefined) data.category = input.category;
    if (input.techStack !== undefined) data.techStack = input.techStack;
    if (input.ratePerHourPaise !== undefined) data.ratePerHourPaise = input.ratePerHourPaise;
    if (input.estimatedHours !== undefined) data.estimatedMinutes = Math.round((input.estimatedHours ?? 0) * 60);
    if (input.description !== undefined) data.description = input.description;
    if (input.gitTargetBranch !== undefined) data.gitTargetBranch = input.gitTargetBranch;
    const repoChanged = input.gitRepoUrl !== undefined && input.gitRepoUrl !== p.gitRepoUrl;
    if (repoChanged) data.gitRepoUrl = input.gitRepoUrl;
    if (input.boardDepartmentIds !== undefined) {
      const removed = p.boardDepartmentIds.filter((d) => !input.boardDepartmentIds!.includes(d));
      if (removed.length) {
        const busy = await this.prisma.task.count({ where: { projectId: id, departmentId: { in: removed }, status: { notIn: ['DONE', 'CANCELLED'] } } });
        if (busy) throw conflict('A team board with open tasks cannot be removed — move or close its tasks first', 'BOARD_BUSY');
      }
      data.boardDepartmentIds = [...new Set(input.boardDepartmentIds)];
    }
    await this.prisma.project.update({ where: { id }, data });
    await this.audit.record({ action: 'project.updated', entity: 'Project', entityId: id, meta: { changes: Object.keys(input) } as Prisma.InputJsonValue });
    if (repoChanged) await this.git.linkProject(id).catch((e) => this.log.warn(e.message));
    await this.metrics.recomputeProject(id);
    return this.detail(id);
  }

  async setStatus(id: string, to: ProjectStatus, reason?: string, cancelRemaining?: boolean) {
    const { v, p } = await this.requireManage(id);
    const from = p.status as ProjectStatus;
    if (from === to) return this.detail(id);
    if (!STATUS_FLOW[from].includes(to)) throw new AppError(422, 'BAD_TRANSITION', `A ${PROJECT_STATUS_LABELS[from].toLowerCase()} project cannot move to ${PROJECT_STATUS_LABELS[to].toLowerCase()}`);
    if (from === 'COMPLETED' && to === 'ACTIVE' && !v.viewAll) throw forbidden('Only a manager can reopen a completed project');
    const openTasks = await this.prisma.task.findMany({ where: { projectId: id, isStanding: false, status: { in: ['OPEN', 'ALLOTTED', 'WIP', 'DEV_COMPLETED', 'QA'] } }, select: { id: true, status: true } });
    if ((to === 'COMPLETED' || to === 'CANCELLED') && openTasks.length) {
      if (to === 'COMPLETED' && !cancelRemaining) {
        throw conflict(`${openTasks.length} task${openTasks.length === 1 ? ' is' : 's are'} still open — close them or cancel the remaining tasks`, 'OPEN_TASKS');
      }
      if (cancelRemaining && !reason) throw new AppError(422, 'REASON_REQUIRED', 'Give a reason for cancelling the remaining tasks');
      await this.prisma.task.updateMany({ where: { id: { in: openTasks.map((t) => t.id) } }, data: { status: 'CANCELLED', statusChangedAt: new Date(), version: { increment: 1 } } });
      await this.prisma.taskTransition.createMany({
        data: openTasks.map((t) => ({ tenantId: currentTenantId(), taskId: t.id, fromStatus: t.status, toStatus: 'CANCELLED' as const, kind: 'MOVE', note: reason ?? `Project ${to.toLowerCase()}`, byEmployeeId: v.employeeId, byName: v.name })),
      });
    }
    await this.prisma.project.update({
      where: { id },
      data: { status: to, closedAt: to === 'COMPLETED' || to === 'CANCELLED' ? new Date() : to === 'ACTIVE' ? null : undefined },
    });
    await this.audit.record({ action: 'project.status_changed', entity: 'Project', entityId: id, meta: { from, to, reason: reason ?? null, cancelled: openTasks.length && (to === 'COMPLETED' || to === 'CANCELLED') ? openTasks.length : 0 } });
    this.events.emit('project.statusChanged', { projectId: id, from, to });
    await this.metrics.recomputeProject(id);
    return this.detail(id);
  }

  // ── Modules ─────────────────────────────────────────────────────────────
  async addModule(id: string, name: string, estimatedHours?: number | null) {
    await this.requireManage(id);
    if (await this.prisma.projectModule.count({ where: { projectId: id, name: { equals: name, mode: 'insensitive' } } })) throw conflict(`Module ${name} already exists`);
    const max = await this.prisma.projectModule.aggregate({ where: { projectId: id }, _max: { sortOrder: true } });
    const m = await this.prisma.projectModule.create({ data: { projectId: id, name, estimatedMinutes: estimatedHours != null ? Math.round(estimatedHours * 60) : null, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
    await this.audit.record({ action: 'project.module.added', entity: 'Project', entityId: id, meta: { module: name } });
    return m;
  }

  async updateModule(id: string, moduleId: string, input: { name?: string; estimatedHours?: number | null; isArchived?: boolean }) {
    await this.requireManage(id);
    const m = await this.prisma.projectModule.findFirst({ where: { id: moduleId, projectId: id } });
    if (!m) throw notFound('Module');
    const data: Prisma.ProjectModuleUpdateInput = {};
    if (input.name && input.name !== m.name) {
      if (await this.prisma.projectModule.count({ where: { projectId: id, id: { not: moduleId }, name: { equals: input.name, mode: 'insensitive' } } })) throw conflict(`Module ${input.name} already exists`);
      data.name = input.name;
      await this.prisma.task.updateMany({ where: { projectId: id, moduleName: m.name }, data: { moduleName: input.name } });
    }
    if (input.estimatedHours !== undefined) data.estimatedMinutes = input.estimatedHours != null ? Math.round(input.estimatedHours * 60) : null;
    if (input.isArchived !== undefined) data.isArchived = input.isArchived;
    await this.prisma.projectModule.update({ where: { id: moduleId }, data });
    await this.audit.record({ action: 'project.module.updated', entity: 'Project', entityId: id, meta: { module: m.name, ...input } as Prisma.InputJsonValue });
    return { ok: true };
  }

  async removeModule(id: string, moduleId: string) {
    await this.requireManage(id);
    const m = await this.prisma.projectModule.findFirst({ where: { id: moduleId, projectId: id } });
    if (!m) throw notFound('Module');
    const used = await this.prisma.task.count({ where: { projectId: id, moduleName: m.name } });
    if (used) await this.prisma.projectModule.update({ where: { id: moduleId }, data: { isArchived: true } });
    else await this.prisma.projectModule.delete({ where: { id: moduleId } });
    await this.audit.record({ action: used ? 'project.module.archived' : 'project.module.removed', entity: 'Project', entityId: id, meta: { module: m.name } });
    return { archived: !!used };
  }

  // ── Members ─────────────────────────────────────────────────────────────
  async addMember(id: string, input: { employeeId: string; role: string; allocationPct?: number | null }) {
    const { v, p } = await this.requireManage(id);
    const e = await this.prisma.employee.findFirst({ where: { id: input.employeeId }, select: { id: true, fullName: true, userId: true, status: true } });
    if (!e || e.status === 'EXITED') throw badRequest('Employee not found');
    if (await this.prisma.projectMember.count({ where: { projectId: id, employeeId: e.id } })) throw conflict(`${e.fullName} is already on this project`);
    await this.prisma.projectMember.create({ data: { projectId: id, employeeId: e.id, role: input.role, allocationPct: input.allocationPct ?? null } });
    await this.audit.record({ action: 'project.member.added', entity: 'Project', entityId: id, meta: { employeeId: e.id, name: e.fullName, role: input.role } });
    this.events.emit('project.member.added', { projectId: id, employeeId: e.id });
    if (e.userId) await this.notifications.notify({ userIds: [e.userId], type: 'project.member', title: `You were added to ${p.name}`, link: `/projects/${id}`, from: v.name });
    return { ok: true };
  }

  async updateMember(id: string, memberId: string, input: { role?: string; allocationPct?: number | null }) {
    const { p } = await this.requireManage(id);
    const m = await this.prisma.projectMember.findFirst({ where: { id: memberId, projectId: id } });
    if (!m) throw notFound('Member');
    if (m.employeeId === p.leadEmployeeId && input.role && input.role !== 'LEAD') throw conflict('Change the project lead first');
    await this.prisma.projectMember.update({ where: { id: memberId }, data: { role: input.role ?? undefined, allocationPct: input.allocationPct } });
    await this.audit.record({ action: 'project.member.updated', entity: 'Project', entityId: id, meta: { memberId, ...input } as Prisma.InputJsonValue });
    return { ok: true };
  }

  async removeMember(id: string, memberId: string) {
    const { p } = await this.requireManage(id);
    const m = await this.prisma.projectMember.findFirst({ where: { id: memberId, projectId: id } });
    if (!m) throw notFound('Member');
    if (m.employeeId === p.leadEmployeeId) throw conflict('The project lead cannot be removed — change the lead first');
    await this.prisma.projectMember.delete({ where: { id: memberId } });
    // Removing a member revokes all their board allocations on the project.
    const boards = await this.prisma.boardMember.findMany({ where: { projectId: id, employeeId: m.employeeId } });
    if (boards.length) {
      await this.prisma.boardMember.deleteMany({ where: { projectId: id, employeeId: m.employeeId } });
      await this.prisma.task.updateMany({ where: { projectId: id, assigneeEmployeeId: m.employeeId, status: 'ALLOTTED' }, data: { status: 'OPEN', assigneeEmployeeId: null, version: { increment: 1 } } });
    }
    await this.audit.record({ action: 'project.member.removed', entity: 'Project', entityId: id, meta: { employeeId: m.employeeId } });
    this.events.emit('project.member.removed', { projectId: id, employeeId: m.employeeId });
    return { ok: true };
  }

  // ── Documents ───────────────────────────────────────────────────────────
  async addDocuments(id: string, docs: { fileId: string; title?: string; kind: string }[]) {
    const { v } = await this.requireManage(id);
    const files = await this.docs.files(docs.map((d) => d.fileId));
    const fOf = new Map(files.map((f) => [f.id, f]));
    for (const d of docs) {
      const f = fOf.get(d.fileId)!;
      await this.prisma.projectDocument.create({ data: { projectId: id, fileId: f.id, title: d.title || f.filename, kind: d.kind, sizeBytes: f.size, uploadedByEmployeeId: v.employeeId } });
    }
    await this.audit.record({ action: 'project.document.added', entity: 'Project', entityId: id, meta: { count: docs.length, titles: docs.map((d) => d.title ?? fOf.get(d.fileId)?.filename ?? '') } });
    return { ok: true };
  }

  async removeDocument(id: string, docId: string) {
    await this.requireManage(id);
    const d = await this.prisma.projectDocument.findFirst({ where: { id: docId, projectId: id } });
    if (!d) throw notFound('Document');
    await this.prisma.projectDocument.delete({ where: { id: docId } });
    await this.audit.record({ action: 'project.document.removed', entity: 'Project', entityId: id, meta: { title: d.title } });
    return { ok: true };
  }

  async linkGit(id: string) {
    await this.requireManage(id);
    const r = await this.git.linkProject(id);
    await this.audit.record({ action: 'project.git.linked', entity: 'Project', entityId: id, meta: r as Prisma.InputJsonValue });
    return r;
  }
}
