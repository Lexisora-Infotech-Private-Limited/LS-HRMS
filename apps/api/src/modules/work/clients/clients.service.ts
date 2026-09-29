import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { clientStateName, type ClientDetail, type ClientInput, type ClientRow } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { SequenceService } from '../../../core/registry/sequence.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError, conflict, notFound } from '../../../core/http/errors';
import { paginated } from '../../../core/http/paginate';
import { WorkDocsService } from '../projects/work-docs.service';

type ClientWithCounts = Prisma.ClientGetPayload<{ include: { projects: { select: { id: true; status: true } } } }>;

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly docs: WorkDocsService,
  ) {}

  private row(c: ClientWithCounts, docCount: number): ClientRow {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      legalName: c.legalName,
      isInternal: c.isInternal,
      gstRegType: c.gstRegType,
      gstin: c.gstin,
      pan: c.pan,
      address: c.address,
      city: c.city,
      pincode: c.pincode,
      stateCode: c.stateCode,
      stateName: clientStateName(c.stateCode),
      countryCode: c.countryCode,
      billingEmails: c.billingEmails,
      defaultRatePerHourPaise: c.defaultRatePerHourPaise,
      paymentTermsDays: c.paymentTermsDays,
      contactName: c.contactName,
      contactPhone: c.contactPhone,
      status: c.status,
      activeProjects: c.projects.filter((p) => p.status === 'ACTIVE' || p.status === 'PLANNING' || p.status === 'ON_HOLD').length,
      totalProjects: c.projects.length,
      documents: docCount,
    };
  }

  async list(q: { page: number; pageSize: number; q?: string; status: 'ACTIVE' | 'INACTIVE' | 'ALL' }) {
    const where: Prisma.ClientWhereInput = {
      ...(q.status !== 'ALL' ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { gstin: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total, all] = await Promise.all([
      this.prisma.client.findMany({ where, include: { projects: { select: { id: true, status: true } } }, orderBy: [{ isInternal: 'asc' }, { createdAt: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.client.count({ where }),
      this.prisma.client.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const docCounts = await this.prisma.projectDocument.groupBy({ by: ['clientId'], where: { clientId: { in: rows.map((r) => r.id) }, projectId: null }, _count: { _all: true } });
    const dOf = new Map(docCounts.map((d) => [d.clientId, d._count._all]));
    const counts = { ALL: all.reduce((s, x) => s + x._count._all, 0), ACTIVE: all.find((x) => x.status === 'ACTIVE')?._count._all ?? 0, INACTIVE: all.find((x) => x.status === 'INACTIVE')?._count._all ?? 0 };
    return { ...paginated(rows.map((r) => this.row(r, dOf.get(r.id) ?? 0)), total, q), counts };
  }

  async detail(id: string): Promise<ClientDetail> {
    const c = await this.prisma.client.findFirst({ where: { id }, include: { projects: { select: { id: true, key: true, name: true, status: true }, orderBy: { createdAt: 'asc' } } } });
    if (!c) throw notFound('Client');
    const vault = await this.prisma.projectDocument.findMany({ where: { clientId: id, projectId: null }, orderBy: { createdAt: 'desc' } });
    return {
      ...this.row(c, vault.length),
      projects: c.projects.map((p) => ({ id: p.id, key: p.key, name: p.name, status: p.status })),
      vault: await this.docs.rows(vault),
    };
  }

  private normalize(input: ClientInput) {
    const pan = input.pan ?? (input.gstin ? input.gstin.slice(2, 12) : null);
    return {
      name: input.name,
      legalName: input.legalName ?? input.name,
      isInternal: input.isInternal,
      gstRegType: input.isInternal ? 'UNREGISTERED' : input.gstRegType,
      gstin: input.gstin,
      pan: pan ? pan.toUpperCase() : null,
      address: input.address,
      city: input.city,
      pincode: input.pincode,
      stateCode: input.gstRegType === 'OVERSEAS' ? null : input.stateCode,
      countryCode: input.gstRegType === 'OVERSEAS' ? (input.countryCode === 'IN' ? 'US' : input.countryCode) : 'IN',
      billingEmails: [...new Set(input.billingEmails)],
      defaultRatePerHourPaise: input.defaultRatePerHourPaise ?? null,
      paymentTermsDays: input.paymentTermsDays,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
    };
  }

  private async gstinWarning(gstin: string | null, excludeId?: string) {
    if (!gstin) return null;
    const dup = await this.prisma.client.findFirst({ where: { gstin, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { name: true } });
    return dup ? `GSTIN is also used by ${dup.name}` : null;
  }

  async create(input: ClientInput) {
    if (input.isInternal && (await this.prisma.client.count({ where: { isInternal: true } }))) throw conflict('An internal client already exists');
    if (await this.prisma.client.count({ where: { name: { equals: input.name, mode: 'insensitive' } } })) throw conflict(`A client named ${input.name} already exists`);
    const code = await this.seq.next('client.code', { prefix: 'CL-', pad: 4 });
    const warning = await this.gstinWarning(input.gstin);
    const c = await this.prisma.client.create({ data: { code, ...this.normalize(input) } });
    await this.audit.record({ action: 'client.created', entity: 'Client', entityId: c.id, meta: { name: c.name, gstin: c.gstin } });
    return { id: c.id, code, warning };
  }

  async update(id: string, input: ClientInput) {
    const c = await this.prisma.client.findFirst({ where: { id } });
    if (!c) throw notFound('Client');
    if (await this.prisma.client.count({ where: { id: { not: id }, name: { equals: input.name, mode: 'insensitive' } } })) throw conflict(`A client named ${input.name} already exists`);
    const data = this.normalize({ ...input, isInternal: c.isInternal });
    const warning = await this.gstinWarning(data.gstin, id);
    await this.prisma.client.update({ where: { id }, data });
    await this.audit.record({ action: 'client.updated', entity: 'Client', entityId: id, meta: { name: data.name } });
    return { id, warning };
  }

  async setStatus(id: string, status: 'ACTIVE' | 'INACTIVE') {
    const c = await this.prisma.client.findFirst({ where: { id }, include: { projects: { select: { status: true } } } });
    if (!c) throw notFound('Client');
    if (status === 'INACTIVE') {
      if (c.isInternal) throw conflict('The internal client cannot be deactivated');
      if (c.projects.some((p) => p.status === 'ACTIVE')) throw conflict(`${c.name} has active projects — complete or hold them first`, 'CLIENT_HAS_ACTIVE_PROJECTS');
    }
    await this.prisma.client.update({ where: { id }, data: { status } });
    await this.audit.record({ action: status === 'INACTIVE' ? 'client.deactivated' : 'client.activated', entity: 'Client', entityId: id, meta: { name: c.name } });
    return { ok: true };
  }

  async remove(id: string) {
    const c = await this.prisma.client.findFirst({ where: { id }, include: { projects: { select: { id: true } } } });
    if (!c) throw notFound('Client');
    if (c.isInternal) throw conflict('The internal client cannot be deleted');
    if (c.projects.length) throw conflict(`${c.name} has projects — deactivate it instead`, 'CLIENT_IN_USE');
    await this.prisma.projectDocument.deleteMany({ where: { clientId: id, projectId: null } });
    await this.prisma.client.delete({ where: { id } });
    await this.audit.record({ action: 'client.deleted', entity: 'Client', entityId: id, meta: { name: c.name } });
    return { ok: true };
  }

  async addDocument(id: string, doc: { fileId: string; title?: string; kind: string }) {
    const c = await this.prisma.client.findFirst({ where: { id } });
    if (!c) throw notFound('Client');
    const [f] = await this.docs.files([doc.fileId]);
    const d = await this.prisma.projectDocument.create({ data: { clientId: id, fileId: f!.id, title: doc.title || f!.filename, kind: doc.kind, sizeBytes: f!.size, uploadedByEmployeeId: requireContext().employeeId ?? null } });
    await this.audit.record({ action: 'client.document.added', entity: 'Client', entityId: id, meta: { title: d.title, kind: d.kind } });
    return { id: d.id };
  }

  async removeDocument(id: string, docId: string) {
    const d = await this.prisma.projectDocument.findFirst({ where: { id: docId, clientId: id, projectId: null } });
    if (!d) throw notFound('Document');
    await this.prisma.projectDocument.delete({ where: { id: docId } });
    await this.audit.record({ action: 'client.document.removed', entity: 'Client', entityId: id, meta: { title: d.title } });
    return { ok: true };
  }

  static assertRate(r: number | null | undefined) {
    if (r != null && r < 0) throw new AppError(422, 'BAD_RATE', 'Rate must be positive');
  }
}
