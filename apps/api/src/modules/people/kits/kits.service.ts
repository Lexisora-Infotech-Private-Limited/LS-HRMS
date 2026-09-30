import { Injectable } from '@nestjs/common';
import type { KitStatus, Prisma } from '@prisma/client';
import type { KitItemDto, KitRow } from '@lexisora/shared';
import { AuditService } from '../../../core/audit/audit.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, notFound } from '../../../core/http/errors';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { kitStatus, stockKey } from '../people.rules';
import { dbDateKey, toDbDate, todayKey } from '../people.util';

type Stock = Record<string, number>;

/** Welcome kits (M9): one issue per joiner with a line per active kit item; stock per size. */
@Injectable()
export class KitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  // ── Items master ─────────────────────────────────────────────────────────

  async items(): Promise<KitItemDto[]> {
    const rows = await this.prisma.welcomeKitItem.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
    return rows.map((r) => ({ id: r.id, name: r.name, sizes: r.sizes, stock: (r.stock ?? {}) as Stock, lowStockThreshold: r.lowStockThreshold, isActive: r.isActive }));
  }

  async createItem(i: { name: string; sizes: string[]; stock: Stock; lowStockThreshold: number; isActive: boolean }) {
    const count = await this.prisma.welcomeKitItem.count();
    const row = await this.prisma.welcomeKitItem.create({
      data: { name: i.name, sizes: i.sizes, stock: i.stock, lowStockThreshold: i.lowStockThreshold, isActive: i.isActive, order: count } as Prisma.WelcomeKitItemUncheckedCreateInput,
    });
    await this.audit.record({ action: 'master.created', entity: 'WelcomeKitItem', entityId: row.id, meta: { name: i.name } });
    return row;
  }

  async updateItem(id: string, i: { name: string; sizes: string[]; stock: Stock; lowStockThreshold: number; isActive: boolean }) {
    const row = await this.prisma.welcomeKitItem.update({ where: { id }, data: { name: i.name, sizes: i.sizes, stock: i.stock, lowStockThreshold: i.lowStockThreshold, isActive: i.isActive } });
    await this.audit.record({ action: 'welcomekit.stock_adjusted', entity: 'WelcomeKitItem', entityId: id, meta: { stock: i.stock } });
    return row;
  }

  // ── Issues ───────────────────────────────────────────────────────────────

  /** Created PENDING when an employee is added, with a line per active item. */
  async ensureIssue(employeeId: string) {
    const existing = await this.prisma.welcomeKitIssue.findUnique({ where: { employeeId } });
    if (existing) return existing;
    const items = await this.prisma.welcomeKitItem.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } });
    const tenantId = requireContext().tenantId;
    return this.prisma.welcomeKitIssue.create({
      data: {
        employeeId,
        status: 'PENDING',
        lines: { create: items.map((it) => ({ tenantId, itemId: it.id })) },
      } as Prisma.WelcomeKitIssueUncheckedCreateInput,
    });
  }

  /** Onboarding step 5 records the size and delivery mode. */
  async setSize(employeeId: string, size: string, delivery: string) {
    const issue = await this.ensureIssue(employeeId);
    await this.prisma.welcomeKitIssue.update({ where: { id: issue.id }, data: { tshirtSize: size, delivery } });
    const sized = await this.prisma.welcomeKitItem.findMany({ where: { NOT: { sizes: { isEmpty: true } } }, select: { id: true } });
    await this.prisma.welcomeKitIssueLine.updateMany({ where: { issueId: issue.id, itemId: { in: sized.map((s) => s.id) }, issued: false }, data: { size } });
  }

  async list(status?: string): Promise<{ items: KitItemDto[]; rows: KitRow[] }> {
    const items = (await this.items()).filter((i) => i.isActive);
    const issues = await this.prisma.welcomeKitIssue.findMany({
      where: status ? { status: status as KitStatus } : { status: { not: 'VOID' } },
      include: { lines: true },
    });
    const emps = await this.prisma.employee.findMany({ where: { id: { in: issues.map((i) => i.employeeId) } }, select: { id: true, fullName: true, joiningDate: true, status: true } });
    const byId = new Map(emps.map((e) => [e.id, e]));
    const rows: KitRow[] = issues
      .filter((i) => byId.has(i.employeeId) && byId.get(i.employeeId)!.status !== 'EXITED')
      .map((i) => {
        const e = byId.get(i.employeeId)!;
        return {
          id: i.id,
          employeeId: i.employeeId,
          name: e.fullName,
          joined: dbDateKey(e.joiningDate),
          status: i.status,
          tshirtSize: i.tshirtSize,
          issuedBy: i.lastIssuedName,
          lines: items.map((it) => {
            const l = i.lines.find((x) => x.itemId === it.id);
            return { itemId: it.id, issued: !!l?.issued, size: l?.size ?? null };
          }),
        };
      })
      .sort((a, b) => (b.joined ?? '').localeCompare(a.joined ?? ''));
    return { items, rows };
  }

  private async recompute(issueId: string) {
    const issue = await this.prisma.welcomeKitIssue.findUnique({ where: { id: issueId }, include: { lines: true } });
    if (!issue) return;
    const active = new Set((await this.prisma.welcomeKitItem.findMany({ where: { isActive: true }, select: { id: true } })).map((x) => x.id));
    const st = kitStatus(issue.lines.filter((l) => active.has(l.itemId)));
    await this.prisma.welcomeKitIssue.update({ where: { id: issueId }, data: { status: st, completedAt: st === 'ISSUED' ? (issue.completedAt ?? new Date()) : null } });
  }

  /** Tick / untick one item for a joiner (optimistic checkbox in the table). */
  async toggleLine(issueId: string, itemId: string, issued: boolean, size?: string | null, force?: boolean, issuedOn?: string) {
    const ctx = requireContext();
    const issue = await this.prisma.welcomeKitIssue.findUnique({ where: { id: issueId }, include: { lines: true } });
    if (!issue) throw notFound('Welcome kit');
    const item = await this.prisma.welcomeKitItem.findUnique({ where: { id: itemId } });
    if (!item) throw notFound('Kit item');
    let line = issue.lines.find((l) => l.itemId === itemId);
    if (!line) line = await this.prisma.welcomeKitIssueLine.create({ data: { tenantId: ctx.tenantId, issueId, itemId } as Prisma.WelcomeKitIssueLineUncheckedCreateInput });
    if (line.issued === issued) return { ok: true };
    const stock = { ...((item.stock ?? {}) as Stock) };
    const useSize = item.sizes.length ? (size ?? line.size ?? issue.tshirtSize ?? null) : null;
    if (issued) {
      if (item.sizes.length && !useSize) throw new AppError(422, 'SIZE_REQUIRED', `Pick a ${item.name} size first (the joiner has not chosen one)`);
      const k = stockKey(item.sizes, useSize);
      const have = stock[k] ?? 0;
      if (have <= 0 && !force) throw new AppError(409, 'OUT_OF_STOCK', `${item.name}${useSize ? ` (${useSize})` : ''} is out of stock`);
      stock[k] = have - 1;
    } else {
      if (line.issuedOn && Date.now() - line.issuedOn.getTime() > 7 * 86400_000) throw badRequest('Items can only be un-issued within 7 days', 'UNISSUE_WINDOW');
      const k = stockKey(item.sizes, line.size);
      stock[k] = (stock[k] ?? 0) + 1;
    }
    await this.prisma.welcomeKitItem.update({ where: { id: item.id }, data: { stock } });
    await this.prisma.welcomeKitIssueLine.update({
      where: { id: line.id },
      data: issued ? { issued: true, size: useSize, issuedOn: toDbDate(issuedOn ?? todayKey()), issuedByName: ctx.userName ?? null } : { issued: false, issuedOn: null, issuedByName: null },
    });
    if (issued) await this.prisma.welcomeKitIssue.update({ where: { id: issueId }, data: { lastIssuedName: ctx.userName ?? null } });
    await this.recompute(issueId);
    await this.audit.record({ action: issued ? 'welcomekit.line_issued' : 'welcomekit.line_unissued', entity: 'WelcomeKitIssue', entityId: issueId, meta: { item: item.name, size: useSize } });
    if (issued) {
      const k = stockKey(item.sizes, useSize);
      if ((stock[k] ?? 0) < item.lowStockThreshold) {
        await this.notify.notify({
          userIds: await this.notify.usersWithPermission('welcomekit.manage'),
          type: 'people.kitLowStock',
          title: `Low stock: ${item.name}${useSize ? ` (${useSize})` : ''} · ${stock[k] ?? 0} left`,
          link: '/welcome-kits',
          from: 'System',
        });
      }
    }
    return { ok: true };
  }

  /** "Issue kit" form: tick several items at once. */
  async issue(employeeId: string, itemIds: string[], issuedOn: string, force?: boolean) {
    const issue = await this.ensureIssue(employeeId);
    const errors: string[] = [];
    for (const itemId of itemIds) {
      try {
        await this.toggleLine(issue.id, itemId, true, undefined, force, issuedOn);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (errors.length && errors.length === itemIds.length) throw badRequest(errors[0]!, 'KIT_ISSUE_FAILED');
    await this.audit.record({ action: 'welcomekit.issued', entity: 'WelcomeKitIssue', entityId: issue.id, meta: { items: itemIds.length } });
    return { ok: true, warnings: errors };
  }

  async voidFor(employeeId: string) {
    await this.prisma.welcomeKitIssue.updateMany({ where: { employeeId }, data: { status: 'VOID' } });
  }

  /** Profile Assets tab row "Welcome kit · x of y items". */
  async summary(employeeId: string): Promise<{ issued: number; total: number; date: string | null } | null> {
    const issue = await this.prisma.welcomeKitIssue.findUnique({ where: { employeeId }, include: { lines: true } });
    if (!issue || issue.status === 'VOID') return null;
    const active = new Set((await this.prisma.welcomeKitItem.findMany({ where: { isActive: true }, select: { id: true } })).map((x) => x.id));
    const lines = issue.lines.filter((l) => active.has(l.itemId));
    const first = lines.filter((l) => l.issuedOn).map((l) => l.issuedOn!.getTime()).sort()[0];
    return { issued: lines.filter((l) => l.issued).length, total: lines.length, date: first ? dbDateKey(new Date(first)) : null };
  }
}
