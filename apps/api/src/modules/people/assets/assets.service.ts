import { Injectable, Logger } from '@nestjs/common';
import type { Asset, AssetStatus, Prisma } from '@prisma/client';
import type { AssetDetail, AssetInput, AssetRow, ProfileAssetRow } from '@lexisora/shared';
import { AuditService } from '../../../core/audit/audit.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../../core/http/errors';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SequenceService } from '../../../core/registry/sequence.service';
import { addDays, canAssetMove, warrantyThreshold } from '../people.rules';
import { dbDateKey, fmt, fmtMonthYear, toDbDate, todayKey } from '../people.util';

const STATUS_LABEL: Record<AssetStatus, string> = {
  IN_STOCK: 'In stock',
  ASSIGNED: 'Assigned',
  UNDER_REPAIR: 'Under repair',
  RETURNED: 'Returned',
  RETIRED: 'Retired',
  LOST: 'Lost',
};
const TAB_STATUS: Record<string, AssetStatus[] | null> = {
  all: null,
  assigned: ['ASSIGNED'],
  in_stock: ['IN_STOCK'],
  under_repair: ['UNDER_REPAIR'],
  returned: ['RETURNED'],
};

type AssetWith = Asset & { category: { name: string } | null };

/** Assets & inventory (M8): assign / return / inspect / repair / lost / retire, warranty alerts. */
@Injectable()
export class AssetsService {
  private readonly log = new Logger('Assets');

  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  private row(a: AssetWith, names: Map<string, string>, assignedOn: Map<string, Date>): AssetRow {
    const today = todayKey();
    const wt = dbDateKey(a.warrantyTill);
    const expired = !!wt && wt < today;
    const soon = !!wt && !expired && wt <= addDays(today, 30);
    const on = a.currentAssignmentId ? assignedOn.get(a.currentAssignmentId) : undefined;
    return {
      id: a.id,
      assetTag: a.assetTag,
      item: a.name,
      serialNo: a.serialNo,
      assignedTo: a.currentAssigneeId ? (names.get(a.currentAssigneeId) ?? null) : null,
      assignedToId: a.currentAssigneeId,
      assignedOn: on ? dbDateKey(on) : null,
      warrantyTill: wt,
      warrantyExpired: expired && !['RETIRED', 'LOST'].includes(a.status),
      warrantyExpiringSoon: soon,
      status: a.status,
      statusLabel: STATUS_LABEL[a.status],
      displayStatus: expired && !['RETIRED', 'LOST'].includes(a.status) ? 'Warranty expired' : STATUS_LABEL[a.status],
      category: a.category?.name ?? null,
    };
  }

  private async hydrate(rows: AssetWith[]) {
    const names = new Map(
      (await this.prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.currentAssigneeId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]),
    );
    const assignments = await this.prisma.assetAssignment.findMany({ where: { id: { in: rows.map((r) => r.currentAssignmentId).filter((x): x is string => !!x) } }, select: { id: true, assignedOn: true } });
    const on = new Map(assignments.map((x) => [x.id, x.assignedOn]));
    return rows.map((r) => this.row(r, names, on));
  }

  async list(q: { tab?: string; q?: string; categoryId?: string; page?: number; pageSize?: number }) {
    const base: Prisma.AssetWhereInput = { deletedAt: null };
    if (q.categoryId) base.categoryId = q.categoryId;
    if (q.q) {
      const emps = await this.prisma.employee.findMany({ where: { fullName: { contains: q.q, mode: 'insensitive' } }, select: { id: true } });
      base.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { serialNo: { contains: q.q, mode: 'insensitive' } }, { assetTag: { contains: q.q, mode: 'insensitive' } }, { currentAssigneeId: { in: emps.map((e) => e.id) } }];
    }
    const statuses = TAB_STATUS[q.tab ?? 'all'] ?? null;
    const where: Prisma.AssetWhereInput = statuses ? { AND: [base, { status: { in: statuses } }] } : base;
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const [rows, total, grouped, expiring] = await Promise.all([
      this.prisma.asset.findMany({ where, include: { category: { select: { name: true } } }, orderBy: [{ updatedAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.asset.count({ where }),
      this.prisma.asset.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.asset.count({ where: { ...base, warrantyTill: { gte: toDbDate(todayKey()), lte: toDbDate(addDays(todayKey(), 30)) }, status: { notIn: ['RETIRED', 'LOST'] } } }),
    ]);
    const by = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Partial<Record<AssetStatus, number>>;
    const all = grouped.reduce((s, g) => s + g._count._all, 0);
    return {
      items: await this.hydrate(rows),
      total,
      page,
      pageSize,
      counts: { all, assigned: by.ASSIGNED ?? 0, in_stock: by.IN_STOCK ?? 0, under_repair: by.UNDER_REPAIR ?? 0, returned: by.RETURNED ?? 0 },
      kpis: { total: all, assigned: by.ASSIGNED ?? 0, inStock: by.IN_STOCK ?? 0, expiring30: expiring },
    };
  }

  async detail(id: string): Promise<AssetDetail> {
    const a = await this.prisma.asset.findUnique({ where: { id }, include: { category: { select: { name: true } }, assignments: { orderBy: { assignedOn: 'asc' } }, repairs: { orderBy: { sentOn: 'asc' } } } });
    if (!a || a.deletedAt) throw notFound('Asset');
    const [row] = await this.hydrate([a]);
    const names = new Map((await this.prisma.employee.findMany({ where: { id: { in: a.assignments.map((x) => x.employeeId) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
    const history: { at: string; text: string }[] = [];
    if (a.purchaseDate) history.push({ at: dbDateKey(a.purchaseDate)!, text: `Purchased${a.vendor ? ` from ${a.vendor}` : ''}` });
    for (const x of a.assignments) {
      history.push({ at: dbDateKey(x.assignedOn)!, text: `Assigned to ${names.get(x.employeeId) ?? '—'}${x.assignedByName ? ` by ${x.assignedByName}` : ''}${x.acknowledgedAt ? ' · acknowledged' : ''}` });
      if (x.returnedOn) history.push({ at: dbDateKey(x.returnedOn)!, text: `Returned by ${names.get(x.employeeId) ?? '—'} · ${x.returnCondition ?? 'GOOD'}${x.returnNotes ? ` · ${x.returnNotes}` : ''}` });
    }
    for (const r of a.repairs) {
      history.push({ at: dbDateKey(r.sentOn)!, text: `Sent to repair${r.vendor ? ` (${r.vendor})` : ''}: ${r.issue}` });
      if (r.completedOn) history.push({ at: dbDateKey(r.completedOn)!, text: `Repair completed${r.costPaise ? ` · ₹${(r.costPaise / 100).toLocaleString('en-IN')}` : ''}` });
    }
    history.sort((x, y) => x.at.localeCompare(y.at));
    return { ...row!, make: a.make, model: a.model, purchaseDate: dbDateKey(a.purchaseDate), purchaseCostPaise: a.purchaseCostPaise, vendor: a.vendor, condition: a.condition, notes: a.notes, history };
  }

  private async assertAssignee(employeeId: string, assignedOn: string, purchaseDate?: string | null) {
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!e || e.status === 'EXITED') throw badRequest('Pick an active employee', 'EMPLOYEE_INVALID');
    if (purchaseDate && assignedOn < purchaseDate) throw badRequest('Assigned on cannot be before the purchase date', 'DATE_INVALID');
    const jd = dbDateKey(e.joiningDate);
    if (jd && assignedOn < addDays(jd, -30)) throw badRequest('Assigned on is more than 30 days before the joining date', 'DATE_INVALID');
    return e;
  }

  async create(i: AssetInput) {
    const ctx = requireContext();
    if (i.categoryId) {
      const cat = await this.prisma.assetCategory.findUnique({ where: { id: i.categoryId } });
      if (!cat) throw badRequest('Pick a category');
      if (cat.requiresSerial && !i.serialNo) throw badRequest(`${cat.name} needs a serial number`, 'SERIAL_REQUIRED');
    }
    if (i.serialNo && (await this.prisma.asset.findFirst({ where: { serialNo: i.serialNo } }))) throw conflict(`Serial ${i.serialNo} already exists`, 'SERIAL_TAKEN');
    if (i.warrantyTill && i.purchaseDate && i.warrantyTill < i.purchaseDate) throw badRequest('Warranty cannot end before the purchase date');
    if (i.assignToId) await this.assertAssignee(i.assignToId, i.assignedOn ?? todayKey(), i.purchaseDate);
    const assetTag = await this.seq.next('asset.tag', { prefix: 'AST-', pad: 4 });
    const a = await this.prisma.asset.create({
      data: {
        assetTag,
        name: i.name,
        serialNo: i.serialNo || null,
        categoryId: i.categoryId ?? null,
        make: i.make ?? null,
        model: i.model ?? null,
        purchaseDate: i.purchaseDate ? toDbDate(i.purchaseDate) : null,
        purchaseCostPaise: i.purchaseCostPaise ?? null,
        vendor: i.vendor ?? null,
        warrantyTill: i.warrantyTill ? toDbDate(i.warrantyTill) : null,
        branchId: i.branchId ?? null,
        condition: i.condition,
        notes: i.notes ?? null,
        status: 'IN_STOCK',
      } as Prisma.AssetUncheckedCreateInput,
    });
    await this.audit.record({ action: 'asset.created', entity: 'Asset', entityId: a.id, meta: { assetTag, name: i.name, by: ctx.userName ?? null } });
    if (i.assignToId) await this.assign(a.id, i.assignToId, i.assignedOn ?? todayKey());
    return this.detail(a.id);
  }

  async update(id: string, i: AssetInput) {
    const a = await this.prisma.asset.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw notFound('Asset');
    if (i.serialNo && i.serialNo !== a.serialNo && (await this.prisma.asset.findFirst({ where: { serialNo: i.serialNo, id: { not: id } } }))) throw conflict(`Serial ${i.serialNo} already exists`, 'SERIAL_TAKEN');
    await this.prisma.asset.update({
      where: { id },
      data: {
        name: i.name,
        serialNo: i.serialNo || null,
        categoryId: i.categoryId ?? a.categoryId,
        make: i.make ?? null,
        model: i.model ?? null,
        purchaseDate: i.purchaseDate ? toDbDate(i.purchaseDate) : null,
        purchaseCostPaise: i.purchaseCostPaise ?? null,
        vendor: i.vendor ?? null,
        warrantyTill: i.warrantyTill ? toDbDate(i.warrantyTill) : null,
        branchId: i.branchId ?? a.branchId,
        notes: i.notes ?? null,
      },
    });
    await this.audit.record({ action: 'asset.updated', entity: 'Asset', entityId: id });
    return this.detail(id);
  }

  private async move(a: Asset, to: AssetStatus) {
    if (!canAssetMove(a.status, to)) throw new AppError(409, 'INVALID_TRANSITION', `A ${STATUS_LABEL[a.status].toLowerCase()} asset cannot be moved to ${STATUS_LABEL[to].toLowerCase()}`);
  }

  private async load(id: string) {
    const a = await this.prisma.asset.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw notFound('Asset');
    return a;
  }

  async assign(id: string, employeeId: string, assignedOn: string) {
    const ctx = requireContext();
    const a = await this.load(id);
    if (a.status === 'ASSIGNED') throw conflict(`${a.name} is already assigned`, 'ALREADY_ASSIGNED');
    await this.move(a, 'ASSIGNED');
    const e = await this.assertAssignee(employeeId, assignedOn, dbDateKey(a.purchaseDate));
    const asg = await this.prisma.assetAssignment.create({ data: { assetId: id, employeeId, assignedOn: toDbDate(assignedOn), assignedByName: ctx.userName ?? null } as Prisma.AssetAssignmentUncheckedCreateInput });
    await this.prisma.asset.update({ where: { id }, data: { status: 'ASSIGNED', currentAssigneeId: employeeId, currentAssignmentId: asg.id, statusBeforeRepair: null } });
    await this.notify.notify({
      userIds: await this.notify.usersForEmployees([employeeId]),
      type: 'people.assetAssigned',
      title: `${a.name} assigned to you`,
      body: `${a.serialNo ? `Serial ${a.serialNo} · ` : ''}please acknowledge receipt on your profile.`,
      link: '/me?tab=assets',
      from: 'HR',
    });
    await this.audit.record({ action: 'asset.assigned', entity: 'Asset', entityId: id, meta: { employeeId, employee: e.fullName } });
    return this.detail(id);
  }

  async returnAsset(id: string, condition: 'NEW' | 'GOOD' | 'FAIR' | 'DAMAGED', notes?: string | null, returnedOn?: string | null) {
    const a = await this.load(id);
    await this.move(a, 'RETURNED');
    if (a.currentAssignmentId) {
      const on = returnedOn ?? todayKey();
      const asg = await this.prisma.assetAssignment.findUnique({ where: { id: a.currentAssignmentId }, select: { assignedOn: true } });
      const from = dbDateKey(asg?.assignedOn ?? null);
      if (from && on < from) throw badRequest(`The return date can't be before the item was assigned (${fmt(asg!.assignedOn)})`);
      await this.prisma.assetAssignment.update({ where: { id: a.currentAssignmentId }, data: { returnedOn: toDbDate(on), returnCondition: condition, returnNotes: notes ?? null } });
    }
    await this.prisma.asset.update({ where: { id }, data: { status: 'RETURNED', condition, currentAssigneeId: null, currentAssignmentId: null } });
    await this.audit.record({ action: 'asset.returned', entity: 'Asset', entityId: id, meta: { condition, employeeId: a.currentAssigneeId } });
    return { ...(await this.detail(id)), suggestRepair: condition === 'DAMAGED' };
  }

  async inspect(id: string, to: 'IN_STOCK' | 'UNDER_REPAIR' | 'RETIRED') {
    const a = await this.load(id);
    await this.move(a, to);
    if (to === 'UNDER_REPAIR') return this.repair(id, 'Found during inspection', null, null);
    await this.prisma.asset.update({ where: { id }, data: { status: to } });
    await this.audit.record({ action: to === 'RETIRED' ? 'asset.retired' : 'asset.inspected', entity: 'Asset', entityId: id, meta: { to } });
    return this.detail(id);
  }

  async repair(id: string, issue: string, vendor?: string | null, expectedBack?: string | null) {
    const a = await this.load(id);
    await this.move(a, 'UNDER_REPAIR');
    await this.prisma.assetRepair.create({ data: { assetId: id, issue, vendor: vendor ?? null, sentOn: toDbDate(todayKey()), expectedBack: expectedBack ? toDbDate(expectedBack) : null } as Prisma.AssetRepairUncheckedCreateInput });
    await this.prisma.asset.update({ where: { id }, data: { status: 'UNDER_REPAIR', statusBeforeRepair: a.status === 'RETURNED' ? 'IN_STOCK' : a.status } });
    await this.audit.record({ action: 'asset.repair_started', entity: 'Asset', entityId: id, meta: { issue } });
    return this.detail(id);
  }

  async repairComplete(id: string, costPaise?: number | null) {
    const a = await this.load(id);
    if (a.status !== 'UNDER_REPAIR') throw new AppError(409, 'INVALID_TRANSITION', 'The asset is not under repair');
    const open = await this.prisma.assetRepair.findFirst({ where: { assetId: id, completedOn: null }, orderBy: { sentOn: 'desc' } });
    if (open) await this.prisma.assetRepair.update({ where: { id: open.id }, data: { completedOn: toDbDate(todayKey()), costPaise: costPaise ?? null } });
    const back: AssetStatus = a.statusBeforeRepair === 'ASSIGNED' && a.currentAssigneeId ? 'ASSIGNED' : 'IN_STOCK';
    await this.prisma.asset.update({ where: { id }, data: { status: back, statusBeforeRepair: null, condition: 'GOOD' } });
    await this.audit.record({ action: 'asset.repair_completed', entity: 'Asset', entityId: id, meta: { costPaise: costPaise ?? null } });
    return this.detail(id);
  }

  async lost(id: string, note: string) {
    const a = await this.load(id);
    await this.move(a, 'LOST');
    if (a.currentAssignmentId) await this.prisma.assetAssignment.update({ where: { id: a.currentAssignmentId }, data: { returnNotes: `Lost: ${note}` } });
    await this.prisma.asset.update({ where: { id }, data: { status: 'LOST', notes: note, currentAssigneeId: null, currentAssignmentId: null } });
    await this.audit.record({ action: 'asset.lost', entity: 'Asset', entityId: id, meta: { note } });
    return this.detail(id);
  }

  async acknowledge(assignmentId: string) {
    const ctx = requireContext();
    const x = await this.prisma.assetAssignment.findUnique({ where: { id: assignmentId } });
    if (!x) throw notFound('Assignment');
    if (x.employeeId !== ctx.employeeId) throw forbidden('Only the assignee can acknowledge receipt');
    await this.prisma.assetAssignment.update({ where: { id: assignmentId }, data: { acknowledgedAt: x.acknowledgedAt ?? new Date() } });
    await this.audit.record({ action: 'asset.acknowledged', entity: 'AssetAssignment', entityId: assignmentId });
    return { ok: true };
  }

  /** Profile Assets tab / My assets. */
  async forEmployee(employeeId: string): Promise<ProfileAssetRow[]> {
    const rows = await this.prisma.assetAssignment.findMany({ where: { employeeId, returnedOn: null }, include: { asset: true }, orderBy: { assignedOn: 'asc' } });
    return rows
      .filter((r) => !r.asset.deletedAt && r.asset.currentAssignmentId === r.id)
      .map((r) => {
        const expired = !!r.asset.warrantyTill && dbDateKey(r.asset.warrantyTill)! < todayKey();
        return {
          id: r.asset.id,
          item: r.asset.name,
          serial: r.asset.serialNo ?? '—',
          assigned: fmt(r.assignedOn),
          status: r.asset.status,
          statusLabel: r.asset.status === 'ASSIGNED' && expired ? 'Warranty expired' : STATUS_LABEL[r.asset.status],
          acknowledged: !!r.acknowledgedAt,
          assignmentId: r.id,
        };
      });
  }

  async assignedCount(employeeId: string) {
    return this.prisma.asset.count({ where: { currentAssigneeId: employeeId, status: 'ASSIGNED', deletedAt: null } });
  }

  /** Daily warranty scan (30 / 7 / 0 days), deduped per asset + threshold. */
  async warrantyScan(): Promise<number> {
    const today = todayKey();
    const rows = await this.prisma.asset.findMany({ where: { deletedAt: null, status: { notIn: ['RETIRED', 'LOST'] }, warrantyTill: { gte: toDbDate(today), lte: toDbDate(addDays(today, 30)) } } });
    const hits: { a: Asset; th: number }[] = [];
    for (const a of rows) {
      const th = warrantyThreshold(dbDateKey(a.warrantyTill), today);
      if (th === null) continue;
      const key = `asset:${a.id}:warranty:${th}`;
      try {
        await this.prisma.peopleAlertLog.create({ data: { key } as Prisma.PeopleAlertLogUncheckedCreateInput });
        hits.push({ a, th });
      } catch {
        /* already alerted */
      }
    }
    if (!hits.length) return 0;
    const hr = await this.notify.usersWithPermission('assets.manage');
    const soonest = hits.sort((x, y) => x.th - y.th)[0]!;
    await this.notify.notify({
      userIds: hr,
      type: 'people.warrantyExpiring',
      title: `${hits.length} asset${hits.length === 1 ? "'s" : "s'"} warranty expiring ${soonest.th === 0 ? 'today' : `in ${soonest.th} days`}`,
      body: hits.map((h) => `${h.a.name}${h.a.serialNo ? ` (${h.a.serialNo})` : ''} · ${fmtMonthYear(h.a.warrantyTill)}`).slice(0, 8).join('\n'),
      link: '/assets',
      from: 'System',
      email: true,
    });
    return hits.length;
  }
}
