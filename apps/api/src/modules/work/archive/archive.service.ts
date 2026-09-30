import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ArchiveDetail, ArchiveRow } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { StorageService } from '../../../core/storage/storage.service';
import { currentTenantId, requireContext } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { AppError, forbidden, notFound } from '../../../core/http/errors';
import { paginated } from '../../../core/http/paginate';
import { WorkDocsService } from '../projects/work-docs.service';
import { WorkAccessService } from '../work-access.service';
import { WorkEvents } from '../work-events.service';
import { monthYearLabel } from '../work.util';

type Tab = 'all' | 'web' | 'mobile' | 'internal';

/**
 * Project archive & client vault. Access per item: LEADS_ONLY → holders of `archive.view`;
 * ALL_DEVELOPERS → also every employee with `projects.view`. Items a viewer may not open are 404.
 */
@Injectable()
export class ArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly docs: WorkDocsService,
    private readonly access: WorkAccessService,
    private readonly events: WorkEvents,
  ) {}

  private accessWhere(): Prisma.ProjectWhereInput {
    const ctx = requireContext();
    return hasPerm(ctx, 'archive.view') ? {} : { archiveAccess: 'ALL_DEVELOPERS' };
  }

  private tabWhere(tab: Tab): Prisma.ProjectWhereInput {
    if (tab === 'web') return { category: 'WEB' };
    if (tab === 'mobile') return { category: 'MOBILE' };
    if (tab === 'internal') return { OR: [{ isInternal: true }, { client: { isInternal: true } }] };
    return {};
  }

  private searchWhere(q?: string): Prisma.ProjectWhereInput {
    if (!q) return {};
    const t = q.trim();
    return {
      OR: [
        { name: { contains: t, mode: 'insensitive' } },
        { key: { contains: t, mode: 'insensitive' } },
        { description: { contains: t, mode: 'insensitive' } },
        { client: { name: { contains: t, mode: 'insensitive' } } },
        { techStack: { hasSome: [t, t.toLowerCase(), t[0]!.toUpperCase() + t.slice(1).toLowerCase(), t.toUpperCase()] } },
        { documents: { some: { title: { contains: t, mode: 'insensitive' } } } },
      ],
    };
  }

  private async docCounts(projects: { id: string; clientId: string | null }[]) {
    const [pc, cc] = await Promise.all([
      this.prisma.projectDocument.groupBy({ by: ['projectId'], where: { projectId: { in: projects.map((p) => p.id) } }, _count: { _all: true } }),
      this.prisma.projectDocument.groupBy({ by: ['clientId'], where: { projectId: null, clientId: { in: projects.map((p) => p.clientId).filter((x): x is string => !!x) } }, _count: { _all: true } }),
    ]);
    const pOf = new Map(pc.map((x) => [x.projectId, x._count._all]));
    const cOf = new Map(cc.map((x) => [x.clientId, x._count._all]));
    return (p: { id: string; clientId: string | null }) => (pOf.get(p.id) ?? 0) + (p.clientId ? (cOf.get(p.clientId) ?? 0) : 0);
  }

  private row(p: Prisma.ProjectGetPayload<{ include: { client: true } }>, documents: number): ArchiveRow {
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      clientName: p.client?.name ?? 'Internal',
      closedAt: p.closedAt?.toISOString() ?? null,
      closedLabel: monthYearLabel(p.closedAt ?? p.archivedAt),
      documents,
      techStack: p.techStack,
      archiveAccess: p.archiveAccess,
      category: p.category,
      isInternal: p.isInternal || !!p.client?.isInternal,
    };
  }

  async list(q: { page: number; pageSize: number; q?: string; tab: Tab }) {
    const base: Prisma.ProjectWhereInput = { AND: [{ status: 'ARCHIVED' }, this.accessWhere(), this.searchWhere(q.q)] };
    const where: Prisma.ProjectWhereInput = { AND: [base, this.tabWhere(q.tab)] };
    const [rows, total, all, web, mobile, internal] = await Promise.all([
      this.prisma.project.findMany({ where, include: { client: true }, orderBy: [{ closedAt: 'desc' }, { name: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.project.count({ where }),
      this.prisma.project.count({ where: base }),
      this.prisma.project.count({ where: { AND: [base, this.tabWhere('web')] } }),
      this.prisma.project.count({ where: { AND: [base, this.tabWhere('mobile')] } }),
      this.prisma.project.count({ where: { AND: [base, this.tabWhere('internal')] } }),
    ]);
    const count = await this.docCounts(rows);
    const ctx = requireContext();
    return {
      ...paginated(rows.map((p) => this.row(p, count(p))), total, q),
      counts: { all, web, mobile, internal },
      canManage: hasPerm(ctx, 'archive.manage'),
      // Completed projects that can be archived (manager action from this screen).
      archivable: hasPerm(ctx, 'archive.manage')
        ? (await this.prisma.project.findMany({ where: { status: 'COMPLETED' }, select: { id: true, name: true, key: true }, orderBy: { closedAt: 'desc' } })).map((p) => ({ value: p.id, label: `${p.name} · ${p.key}` }))
        : [],
    };
  }

  private async requireItem(id: string) {
    const p = await this.prisma.project.findFirst({ where: { AND: [{ id }, { status: 'ARCHIVED' }, this.accessWhere()] }, include: { client: true } });
    if (!p) throw notFound('Archived project');
    return p;
  }

  async detail(id: string): Promise<ArchiveDetail> {
    const p = await this.requireItem(id);
    const [docs, clientDocs, tasks, members, modules] = await Promise.all([
      this.prisma.projectDocument.findMany({ where: { projectId: id }, orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] }),
      p.clientId ? this.prisma.projectDocument.findMany({ where: { clientId: p.clientId, projectId: null }, orderBy: { createdAt: 'asc' } }) : Promise.resolve([]),
      this.prisma.task.groupBy({ by: ['status'], where: { projectId: id, isStanding: false }, _count: { _all: true } }),
      this.prisma.projectMember.findMany({ where: { projectId: id } }),
      this.prisma.projectModule.findMany({ where: { projectId: id }, orderBy: { sortOrder: 'asc' } }),
    ]);
    const names = await this.access.names([...members.map((m) => m.employeeId), p.leadEmployeeId]);
    return {
      ...this.row(p, docs.length + clientDocs.length),
      description: p.description,
      leadName: p.leadEmployeeId ? (names.get(p.leadEmployeeId) ?? null) : null,
      estimatedMinutes: p.estimatedMinutes,
      loggedMinutes: p.loggedMinutes,
      progressPct: p.progressPct,
      tasksByStatus: Object.fromEntries(tasks.map((t) => [t.status, t._count._all])),
      members: members.map((m) => ({ name: names.get(m.employeeId) ?? '—', role: m.role })),
      modules: modules.map((m) => m.name),
      projectDocuments: await this.docs.rows(docs),
      clientDocuments: await this.docs.rows(clientDocs),
      canManage: hasPerm(requireContext(), 'archive.manage'),
    };
  }

  async setAccess(id: string, archiveAccess: 'LEADS_ONLY' | 'ALL_DEVELOPERS') {
    const p = await this.requireItem(id);
    await this.prisma.project.update({ where: { id }, data: { archiveAccess } });
    await this.audit.record({ action: 'archive.access_changed', entity: 'Project', entityId: id, meta: { name: p.name, from: p.archiveAccess, to: archiveAccess } });
    return { ok: true };
  }

  async addDocument(id: string, doc: { fileId: string; title?: string; kind: string }) {
    const p = await this.requireItem(id);
    const [f] = await this.docs.files([doc.fileId]);
    await this.prisma.projectDocument.create({
      data: { tenantId: currentTenantId(), projectId: p.id, fileId: f!.id, title: doc.title || f!.filename, kind: doc.kind, sizeBytes: f!.size, uploadedByEmployeeId: requireContext().employeeId ?? null },
    });
    await this.audit.record({ action: 'archive.document.added', entity: 'Project', entityId: id, meta: { title: doc.title ?? f!.filename } });
    return { ok: true };
  }

  /** Stream a document of an archived item (project or inherited client vault) — audited. */
  async download(id: string, docId: string) {
    const p = await this.requireItem(id);
    const d = await this.prisma.projectDocument.findFirst({ where: { id: docId, OR: [{ projectId: p.id }, ...(p.clientId ? [{ clientId: p.clientId, projectId: null }] : [])] } });
    if (!d) throw notFound('Document');
    const file = await this.storage.read(d.fileId);
    await this.audit.record({ action: 'archive.document.downloaded', entity: 'Project', entityId: id, meta: { title: d.title } });
    return file;
  }

  // ── Archive / unarchive (Project lifecycle COMPLETED ↔ ARCHIVED) ─────────────
  async archive(id: string) {
    const ctx = requireContext();
    if (!hasPerm(ctx, 'archive.manage')) throw forbidden('Only a manager can archive projects');
    const p = await this.prisma.project.findFirst({ where: { id } });
    if (!p) throw notFound('Project');
    if (p.status !== 'COMPLETED') throw new AppError(422, 'NOT_COMPLETED', 'Only completed projects can be archived — mark the project completed first');
    await this.prisma.project.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: new Date(), archivedByEmployeeId: ctx.employeeId ?? null, closedAt: p.closedAt ?? new Date(), health: 'NA' } });
    await this.audit.record({ action: 'project.archived', entity: 'Project', entityId: id, meta: { name: p.name } });
    const members = await this.prisma.projectMember.findMany({ where: { projectId: id }, select: { employeeId: true } });
    await this.notifications.notify({ userIds: (await this.notifications.usersForEmployees(members.map((m) => m.employeeId))).filter((u) => u !== ctx.userId), type: 'project.archived', title: `${p.name} archived`, link: `/archive?open=${id}`, from: ctx.userName ?? 'Projects' });
    this.events.emit('project.statusChanged', { projectId: id, from: 'COMPLETED', to: 'ARCHIVED' });
    return { ok: true, message: `${p.name} archived` };
  }

  async unarchive(id: string) {
    const ctx = requireContext();
    if (!hasPerm(ctx, 'archive.manage')) throw forbidden('Only a manager can unarchive projects');
    const p = await this.prisma.project.findFirst({ where: { id, status: 'ARCHIVED' } });
    if (!p) throw notFound('Archived project');
    await this.prisma.project.update({ where: { id }, data: { status: 'COMPLETED', archivedAt: null, archivedByEmployeeId: null } });
    await this.audit.record({ action: 'project.unarchived', entity: 'Project', entityId: id, meta: { name: p.name } });
    this.events.emit('project.statusChanged', { projectId: id, from: 'ARCHIVED', to: 'COMPLETED' });
    return { ok: true, message: `${p.name} restored to Completed` };
  }
}
