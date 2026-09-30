import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PeopleMasterRow } from '@lexisora/shared';
import { AuditService } from '../../../core/audit/audit.service';
import { AppError, badRequest, conflict, notFound } from '../../../core/http/errors';
import { PrismaService } from '../../../core/prisma/prisma.service';

const ACTIVE_EMP: Prisma.EmployeeWhereInput = { status: { not: 'EXITED' } };

/** Org masters (M1 / audit G8): departments, designations, branches, asset categories, interview rounds. */
@Injectable()
export class MastersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async departments(): Promise<PeopleMasterRow[]> {
    const rows = await this.prisma.department.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { employees: { where: ACTIVE_EMP } } } } });
    const leads = await this.prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.leadEmployeeId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const lm = new Map(leads.map((l) => [l.id, l.fullName]));
    return rows.map((r) => ({ id: r.id, name: r.name, code: r.code, lead: r.leadEmployeeId ? (lm.get(r.leadEmployeeId) ?? null) : null, leadEmployeeId: r.leadEmployeeId, employees: r._count.employees }));
  }

  private async assertUnique(kind: 'department' | 'designation' | 'branch', name: string, exceptId?: string) {
    const m = this.prisma[kind] as unknown as { findFirst: (a: unknown) => Promise<{ id: string } | null> };
    const dup = await m.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (dup) throw conflict(`“${name}” already exists`, 'DUPLICATE_NAME');
  }

  async createDepartment(i: { name: string; code?: string | null; leadEmployeeId?: string | null }) {
    await this.assertUnique('department', i.name);
    if (i.code && (await this.prisma.department.findFirst({ where: { code: i.code } }))) throw conflict(`Code ${i.code} is taken`, 'DUPLICATE_CODE');
    const row = await this.prisma.department.create({ data: { name: i.name, code: i.code ?? null, leadEmployeeId: i.leadEmployeeId ?? null } as Prisma.DepartmentUncheckedCreateInput });
    await this.audit.record({ action: 'master.created', entity: 'Department', entityId: row.id, meta: { name: i.name } });
    return row;
  }

  async updateDepartment(id: string, i: { name: string; code?: string | null; leadEmployeeId?: string | null }) {
    await this.assertUnique('department', i.name, id);
    if (i.code && (await this.prisma.department.findFirst({ where: { code: i.code, id: { not: id } } }))) throw conflict(`Code ${i.code} is taken`, 'DUPLICATE_CODE');
    const row = await this.prisma.department.update({ where: { id }, data: { name: i.name, code: i.code ?? null, leadEmployeeId: i.leadEmployeeId ?? null } });
    await this.audit.record({ action: 'master.updated', entity: 'Department', entityId: id, meta: { name: i.name } });
    return row;
  }

  async designations(): Promise<PeopleMasterRow[]> {
    const rows = await this.prisma.designation.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { employees: { where: ACTIVE_EMP } } } } });
    return rows.map((r) => ({ id: r.id, name: r.name, employees: r._count.employees }));
  }

  async createDesignation(i: { name: string }) {
    await this.assertUnique('designation', i.name);
    const row = await this.prisma.designation.create({ data: { name: i.name } as Prisma.DesignationUncheckedCreateInput });
    await this.audit.record({ action: 'master.created', entity: 'Designation', entityId: row.id, meta: { name: i.name } });
    return row;
  }

  async updateDesignation(id: string, i: { name: string }) {
    await this.assertUnique('designation', i.name, id);
    const row = await this.prisma.designation.update({ where: { id }, data: { name: i.name } });
    await this.audit.record({ action: 'master.updated', entity: 'Designation', entityId: id, meta: { name: i.name } });
    return row;
  }

  async branches(): Promise<PeopleMasterRow[]> {
    const rows = await this.prisma.branch.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { employees: { where: ACTIVE_EMP } } } } });
    return rows.map((r) => ({ id: r.id, name: r.name, address: r.address, employees: r._count.employees }));
  }

  async createBranch(i: { name: string; address?: string | null }) {
    await this.assertUnique('branch', i.name);
    const row = await this.prisma.branch.create({ data: { name: i.name, address: i.address ?? null } as Prisma.BranchUncheckedCreateInput });
    await this.audit.record({ action: 'master.created', entity: 'Branch', entityId: row.id, meta: { name: i.name } });
    return row;
  }

  async updateBranch(id: string, i: { name: string; address?: string | null }) {
    await this.assertUnique('branch', i.name, id);
    const row = await this.prisma.branch.update({ where: { id }, data: { name: i.name, address: i.address ?? null } });
    await this.audit.record({ action: 'master.updated', entity: 'Branch', entityId: id, meta: { name: i.name } });
    return row;
  }

  /** Delete is blocked while active employees or open jobs reference the record. */
  async remove(kind: 'department' | 'designation' | 'branch', id: string) {
    const field = `${kind}Id` as 'departmentId' | 'designationId' | 'branchId';
    const [emps, jobs] = await Promise.all([
      this.prisma.employee.count({ where: { [field]: id, status: { not: 'EXITED' } } }),
      kind === 'designation' ? this.prisma.job.count({ where: { designationId: id, status: { not: 'CLOSED' } } }) : this.prisma.job.count({ where: { [field]: id, status: { not: 'CLOSED' } } }),
    ]);
    if (emps || jobs) {
      throw new AppError(409, 'MASTER_IN_USE', `In use by ${emps ? `${emps} active employee${emps === 1 ? '' : 's'}` : ''}${emps && jobs ? ' and ' : ''}${jobs ? `${jobs} open job${jobs === 1 ? '' : 's'}` : ''}`, { activeEmployees: emps, openJobs: jobs });
    }
    const m = this.prisma[kind] as unknown as { delete: (a: unknown) => Promise<unknown> };
    try {
      await m.delete({ where: { id } });
    } catch {
      throw conflict('This record is referenced by past records and cannot be deleted', 'MASTER_REFERENCED');
    }
    await this.audit.record({ action: 'master.deleted', entity: kind, entityId: id });
    return { ok: true };
  }

  // ── Interview rounds & asset categories ─────────────────────────────────

  async rounds() {
    const rows = await this.prisma.interviewRound.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }] });
    return rows.map((r) => ({ id: r.id, name: r.name, defaultDurationMin: r.defaultDurationMin, criteria: r.criteria as { key: string; label: string }[] }));
  }

  async createRound(i: { name: string; defaultDurationMin: number; criteria: string[] }) {
    if (await this.prisma.interviewRound.findFirst({ where: { name: { equals: i.name, mode: 'insensitive' } } })) throw conflict(`“${i.name}” already exists`, 'DUPLICATE_NAME');
    const order = await this.prisma.interviewRound.count();
    const criteria = (i.criteria.length ? i.criteria : ['Problem solving', 'Communication', 'Culture fit']).map((label) => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label }));
    return this.prisma.interviewRound.create({ data: { name: i.name, defaultDurationMin: i.defaultDurationMin, criteria, order } as unknown as Prisma.InterviewRoundUncheckedCreateInput });
  }

  async deactivateRound(id: string) {
    const r = await this.prisma.interviewRound.findUnique({ where: { id } });
    if (!r) throw notFound('Round');
    await this.prisma.interviewRound.update({ where: { id }, data: { isActive: false } });
    return { ok: true };
  }

  async assetCategories() {
    const rows = await this.prisma.assetCategory.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { assets: { where: { deletedAt: null } } } } } });
    return rows.map((r) => ({ id: r.id, name: r.name, requiresSerial: r.requiresSerial, assets: r._count.assets }));
  }

  async createAssetCategory(i: { name: string; requiresSerial: boolean }) {
    if (!i.name.trim()) throw badRequest('Enter a name');
    if (await this.prisma.assetCategory.findFirst({ where: { name: { equals: i.name, mode: 'insensitive' } } })) throw conflict(`“${i.name}” already exists`, 'DUPLICATE_NAME');
    return this.prisma.assetCategory.create({ data: { name: i.name, requiresSerial: i.requiresSerial } as Prisma.AssetCategoryUncheckedCreateInput });
  }
}
