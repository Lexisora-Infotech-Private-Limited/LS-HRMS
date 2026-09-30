import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LookupsService } from '../../core/lookups/lookups';
import { SearchService } from '../../core/registry/registries';
import { EventsService } from '../../core/registry/events.service';
import { hasPerm } from '../../core/auth/decorators';
import { requireContext } from '../../core/context/request-context';
import { fileAccessCheckers } from '../../core/storage/files.controller';
import { WorkAccessService } from './work-access.service';
import { WorkMetricsService } from './projects/work-metrics.service';

/**
 * Registers the work domain in core registries:
 *  - lookups: projects, clients, teams
 *  - header search: projects, tasks (board-visibility aware)
 *  - private file access for project / client documents
 *  - recompute logged minutes when timesheets are approved or tracker segments arrive
 */
@Injectable()
export class WorkRegistry implements OnModuleInit {
  private readonly log = new Logger('WorkRegistry');

  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: LookupsService,
    private readonly search: SearchService,
    private readonly events: EventsService,
    private readonly access: WorkAccessService,
    private readonly metrics: WorkMetricsService,
  ) {}

  onModuleInit() {
    this.lookups.register('projects', async () => {
      const v = await this.access.viewer();
      const scope = await this.access.projectScope(v);
      const rows = await this.prisma.project.findMany({
        where: { status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD'] }, OR: [scope, { isSystem: true }] },
        orderBy: [{ isSystem: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, key: true },
      });
      return rows.map((p) => ({ value: p.id, label: `${p.name} · ${p.key}` }));
    });
    this.lookups.register('clients', async () =>
      (await this.prisma.client.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ isInternal: 'asc' }, { name: 'asc' }], select: { id: true, name: true } })).map((c) => ({ value: c.id, label: c.name })),
    );
    this.lookups.register('teams', async () => {
      const used = new Set((await this.prisma.project.findMany({ select: { boardDepartmentIds: true } })).flatMap((p) => p.boardDepartmentIds));
      const depts = await this.prisma.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
      const list = depts.filter((d) => used.has(d.id));
      return (list.length ? list : depts).map((d) => ({ value: d.id, label: d.name }));
    });

    this.search.register('projects', async (q, ctx) => {
      if (!hasPerm(ctx, 'projects.view')) return [];
      const v = await this.access.viewer();
      const scope = await this.access.projectScope(v);
      const rows = await this.prisma.project.findMany({
        where: { AND: [scope, { isSystem: false, status: { not: 'ARCHIVED' } }, { OR: [{ name: { contains: q, mode: 'insensitive' } }, { key: { equals: q.toUpperCase() } }] }] },
        include: { client: { select: { name: true } } },
        take: 6,
      });
      return rows.map((p) => ({ type: 'projects', id: p.id, title: p.name, subtitle: `${p.key} · ${p.client?.name ?? 'Internal'}`, link: `/projects/${p.id}` }));
    });
    this.search.register('tasks', async (q, ctx) => {
      if (!hasPerm(ctx, 'tasks.board')) return [];
      const v = await this.access.viewer();
      const boards = await this.access.visibleBoards(v);
      const rows = await this.prisma.task.findMany({
        where: { status: { not: 'CANCELLED' }, OR: [{ key: { equals: q.toUpperCase() } }, { title: { contains: q, mode: 'insensitive' } }] },
        include: { project: { select: { name: true, isSystem: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      });
      return rows
        .filter((t) => boards.all || t.project.isSystem || t.assigneeEmployeeId === v.employeeId || (t.departmentId && boards.keys.has(`${t.projectId}|${t.departmentId}`)))
        .slice(0, 6)
        .map((t) => ({
          type: 'tasks',
          id: t.id,
          title: `${t.key} ${t.title}`,
          subtitle: t.project.name,
          link: `/board?project=${t.projectId}${t.departmentId ? `&board=${t.departmentId}` : ''}&task=${t.id}`,
        }));
    });

    fileAccessCheckers.push(async (fileId) => {
      const docs = await this.prisma.projectDocument.findMany({ where: { fileId }, select: { projectId: true, clientId: true } });
      if (!docs.length) return false;
      const v = await this.access.viewer();
      for (const d of docs) {
        if (d.projectId) {
          const p = await this.prisma.project.findFirst({ where: { id: d.projectId }, select: { status: true, archiveAccess: true } });
          if (p?.status === 'ARCHIVED') {
            const ctx = requireContext();
            if (hasPerm(ctx, 'archive.view') || p.archiveAccess === 'ALL_DEVELOPERS') return true;
          } else if (await this.access.canSeeProject(v, d.projectId)) return true;
        } else if (d.clientId) {
          const ctx = requireContext();
          if (hasPerm(ctx, 'clients.manage') || hasPerm(ctx, 'archive.view')) return true;
        }
      }
      return false;
    });

    // Logged minutes follow approved timesheets / tracker ingest (throttled per project).
    const touch = async (employeeId: string) => {
      const rows = await this.prisma.task.findMany({ where: { assigneeEmployeeId: employeeId, status: { notIn: ['CANCELLED'] } }, select: { projectId: true }, distinct: ['projectId'] });
      for (const r of rows) await this.metrics.recomputeProjectIfStale(r.projectId, 5 * 60_000);
    };
    for (const ev of ['timesheet.approved', 'timesheet.submitted', 'tracker.segmentsIngested']) {
      this.events.on(ev, async (p: { employeeId?: string }) => {
        if (p?.employeeId) await touch(p.employeeId).catch((e) => this.log.warn(`${ev}: ${(e as Error).message}`));
      });
    }
  }
}
