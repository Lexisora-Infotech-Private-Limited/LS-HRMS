import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FIN_SAC_IT_SERVICES,
  finComputeInvoiceTax,
  finDeriveSupplyType,
  finGstLabel,
  finHoursLabel,
  finMonthLabel,
  finPlaceOfSupply,
  formatINR,
  type FinCreateInvoiceInput,
  type FinInvoiceDetail,
  type FinInvoiceFormOptions,
  type FinInvoiceKpis,
  type FinInvoiceList,
  type FinInvoicePreview,
  type FinInvoiceRow,
  type FinInvoiceStatusKey,
  type FinSupplyKind,
} from '@lexisora/shared';
import type { z } from 'zod';
import type { finEmailInvoiceSchema, finInvoiceListQuery, finRecordPaymentSchema, finUpdateInvoiceSchema } from '@lexisora/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SequenceService } from '../../core/registry/sequence.service';
import { AuditService } from '../../core/audit/audit.service';
import { EventsService } from '../../core/registry/events.service';
import { StorageService } from '../../core/storage/storage.service';
import { MailService } from '../../core/mail/mail.service';
import { PdfService } from '../../core/pdf/pdf.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { requireContext } from '../../core/context/request-context';
import { AppError, badRequest, conflict, notFound } from '../../core/http/errors';
import { paginated, pageArgs } from '../../core/http/paginate';
import { LedgerService, type PostLine } from './ledger.service';
import { FilingService } from './filing.service';
import { SpineReader, type SpineClient } from './spine';
import { renderInvoicePdf, type InvoicePdfData } from './invoice-pdf';
import { addDays, currentMonthKey, dateKeyOf, dateOnly, fyOf, monthRange, recentMonths, todayDate, CREDIT_NOTE_SEQUENCE, INVOICE_SEQUENCE } from './lib/money';
import { InvoiceRuleError, invoiceDisplayStatus, isInvoiceOverdue, OPEN_INVOICE_STATUSES, paymentOutcome } from './lib/invoice-rules';

type InvoiceBody = z.infer<typeof finUpdateInvoiceSchema>;
type ListQuery = z.infer<typeof finInvoiceListQuery>;
type EmailInput = z.infer<typeof finEmailInvoiceSchema>;
type PaymentInput = z.infer<typeof finRecordPaymentSchema>;

export type BuyerSnapshot = { name: string; displayName: string; gstin: string | null; pan: string | null; address: string | null; stateCode: string | null; emails: string[] };
export type SellerSnapshot = InvoicePdfData['seller'];

const fullInclude = {
  lines: { orderBy: { sortOrder: 'asc' as const }, include: { timeEntries: true } },
  payments: { orderBy: { date: 'asc' as const } },
  creditNotes: { orderBy: { date: 'asc' as const } },
} satisfies Prisma.InvoiceInclude;
type FullInvoice = Prisma.InvoiceGetPayload<{ include: typeof fullInclude }>;
type InvoiceRec = Prisma.InvoiceGetPayload<object>;

/**
 * GST invoices from approved billable hours: preview → draft (time entries reserved through
 * the unique `InvoiceTimeEntry.timesheetCellId`) → issue (number assigned now, SALES voucher,
 * PDF, auto-filed) → email (PDF attached) → payments (RECEIPT vouchers) → credit note.
 */
@Injectable()
export class InvoiceService {
  private readonly log = new Logger('Invoices');

  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly pdf: PdfService,
    private readonly notifications: NotificationsService,
    private readonly ledger: LedgerService,
    private readonly filing: FilingService,
    private readonly spine: SpineReader,
  ) {}

  private tenant() {
    return this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: requireContext().tenantId } });
  }

  // ── Rows ─────────────────────────────────────────────────────────────────

  toRow(inv: InvoiceRec, today = todayDate()): FinInvoiceRow {
    const overdue = isInvoiceOverdue(inv, today);
    return {
      id: inv.id,
      number: inv.number,
      projectId: inv.projectId,
      label: inv.number ?? 'Draft',
      clientId: inv.clientId,
      clientName: inv.clientName,
      projectName: inv.projectName,
      period: inv.period,
      periodLabel: finMonthLabel(inv.period),
      hours: finHoursLabel(inv.minutes),
      minutes: inv.minutes,
      taxablePaise: inv.subtotalPaise,
      gstPaise: inv.cgstPaise + inv.sgstPaise + inv.igstPaise,
      cgstPaise: inv.cgstPaise,
      sgstPaise: inv.sgstPaise,
      igstPaise: inv.igstPaise,
      totalPaise: inv.totalPaise,
      balancePaise: inv.balancePaise,
      status: inv.status as FinInvoiceStatusKey,
      displayStatus: invoiceDisplayStatus(inv.status as FinInvoiceStatusKey, overdue),
      overdue,
      invoiceDate: inv.invoiceDate ? dateKeyOf(inv.invoiceDate) : null,
      dueDate: inv.dueDate ? dateKeyOf(inv.dueDate) : null,
      supplyType: inv.supplyType as FinSupplyKind,
    };
  }

  private tabWhere(tab: ListQuery['tab'], today: Date): Prisma.InvoiceWhereInput {
    switch (tab) {
      case 'draft':
        return { status: 'DRAFT' };
      case 'emailed':
        return { status: { in: [...OPEN_INVOICE_STATUSES] } };
      case 'paid':
        return { status: 'PAID' };
      case 'overdue':
        return { status: { in: [...OPEN_INVOICE_STATUSES] }, dueDate: { lt: today } };
      default:
        return {};
    }
  }

  async list(q: ListQuery): Promise<FinInvoiceList> {
    const today = todayDate();
    const base: Prisma.InvoiceWhereInput = {
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.q
        ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { clientName: { contains: q.q, mode: 'insensitive' } }, { projectName: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
    const where = { ...base, ...this.tabWhere(q.tab, today) };
    const [rows, total, all, draft, emailed, paid, overdue] = await Promise.all([
      this.prisma.invoice.findMany({ where, orderBy: [{ invoiceDate: { sort: 'desc', nulls: 'first' } }, { number: 'desc' }, { createdAt: 'desc' }], ...pageArgs(q) }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.count({ where: base }),
      this.prisma.invoice.count({ where: { ...base, ...this.tabWhere('draft', today) } }),
      this.prisma.invoice.count({ where: { ...base, ...this.tabWhere('emailed', today) } }),
      this.prisma.invoice.count({ where: { ...base, ...this.tabWhere('paid', today) } }),
      this.prisma.invoice.count({ where: { ...base, ...this.tabWhere('overdue', today) } }),
    ]);
    return { ...paginated(rows.map((r) => this.toRow(r, today)), total, q), counts: { all, draft, emailed, paid, overdue } };
  }

  async kpis(month = currentMonthKey()): Promise<FinInvoiceKpis> {
    const today = todayDate();
    const { start, end } = monthRange(month);
    const [open, over, inv] = await Promise.all([
      this.prisma.invoice.aggregate({ where: { status: { in: [...OPEN_INVOICE_STATUSES] } }, _sum: { balancePaise: true } }),
      this.prisma.invoice.aggregate({ where: { status: { in: [...OPEN_INVOICE_STATUSES] }, dueDate: { lt: today } }, _sum: { balancePaise: true }, _count: { _all: true } }),
      this.prisma.invoice.aggregate({ where: { status: { notIn: ['DRAFT', 'CANCELLED'] }, invoiceDate: { gte: start, lte: end } }, _sum: { totalPaise: true }, _count: { _all: true } }),
    ]);
    return {
      outstandingPaise: Number(open._sum.balancePaise ?? 0),
      overduePaise: Number(over._sum.balancePaise ?? 0),
      overdueCount: over._count._all,
      invoicedMonthPaise: Number(inv._sum.totalPaise ?? 0),
      invoicedMonthCount: inv._count._all,
      monthLabel: finMonthLabel(month),
    };
  }

  // ── Form support ─────────────────────────────────────────────────────────

  async options(): Promise<FinInvoiceFormOptions> {
    const [tenant, clients, projects] = await Promise.all([this.tenant(), this.spine.clients({ isInternal: false, status: 'ACTIVE' }), this.spine.projects({ billable: true })]);
    const months = recentMonths(currentMonthKey(), 6);
    const billable = projects.filter((p) => p.clientId && !p.isInternal);
    const unbilled = await this.unbilledByMonth(
      billable.map((p) => p.id),
      monthRange(months[months.length - 1]!).start,
      monthRange(months[0]!).end,
    );
    return {
      sellerStateCode: tenant.stateCode,
      clients: clients.map((c) => ({ id: c.id, name: c.name, stateCode: c.stateCode, gstin: c.gstin, billingEmails: c.billingEmails ?? [], defaultRatePaise: c.defaultRatePerHourPaise, paymentTermsDays: c.paymentTermsDays })),
      projects: billable.map((p) => ({ id: p.id, clientId: p.clientId!, name: p.name, ratePaise: p.ratePerHourPaise, status: String(p.status), unbilled: unbilled.get(p.id) ?? [] })),
      periods: months.map((m) => ({ value: m, label: finMonthLabel(m) })),
    };
  }

  /** Project → months (newest first) with approved billable minutes not yet held by an invoice. */
  private async unbilledByMonth(projectIds: string[], start: Date, end: Date) {
    const out = new Map<string, { period: string; minutes: number }[]>();
    for (const projectId of projectIds) {
      const r = await this.spine.billableCells(projectId, start, end);
      if (!r.approved.length) continue;
      const held = new Set((await this.prisma.invoiceTimeEntry.findMany({ where: { timesheetCellId: { in: r.approved.map((c) => c.id) } }, select: { timesheetCellId: true } })).map((h) => h.timesheetCellId));
      const byMonth = new Map<string, number>();
      for (const c of r.approved) if (!held.has(c.id)) byMonth.set(dateKeyOf(c.date).slice(0, 7), (byMonth.get(dateKeyOf(c.date).slice(0, 7)) ?? 0) + c.finalMinutes);
      const rows = [...byMonth.entries()].filter(([, m]) => m > 0).sort((a, b) => b[0].localeCompare(a[0])).map(([period, minutes]) => ({ period, minutes }));
      if (rows.length) out.set(projectId, rows);
    }
    return out;
  }

  /** Approved (L1+) billable cells of a project in a month that no other invoice holds. */
  private async available(projectId: string | null, period: string, excludeInvoiceId?: string) {
    if (!projectId) return { cells: [], approvedMinutes: 0, pendingMinutes: 0, pendingTimesheets: 0, lines: new Map(), sheets: new Map() };
    const { start, end } = monthRange(period);
    const r = await this.spine.billableCells(projectId, start, end);
    const ids = r.approved.map((c) => c.id);
    const held = ids.length ? await this.prisma.invoiceTimeEntry.findMany({ where: { timesheetCellId: { in: ids } }, select: { timesheetCellId: true, invoiceId: true } }) : [];
    const taken = new Set(held.filter((h) => h.invoiceId !== excludeInvoiceId).map((h) => h.timesheetCellId));
    const cells = r.approved.filter((c) => !taken.has(c.id));
    const pendingSheets = new Set(r.pending.map((c) => r.lines.get(c.lineId)?.timesheetId).filter(Boolean));
    return {
      cells,
      approvedMinutes: cells.reduce((s, c) => s + c.finalMinutes, 0),
      pendingMinutes: r.pending.reduce((s, c) => s + c.finalMinutes, 0),
      pendingTimesheets: pendingSheets.size,
      lines: r.lines,
      sheets: r.sheets,
    };
  }

  private async clientAndProject(clientId: string, projectId: string | null | undefined) {
    const client = await this.spine.client(clientId);
    if (!client) throw notFound('Client');
    if (client.isInternal) throw badRequest('Internal projects cannot be invoiced');
    let project = null;
    if (projectId) {
      project = await this.spine.project(projectId);
      if (!project || project.clientId !== client.id) throw badRequest('Pick a project of this client');
      if (!project.billable) throw badRequest(`${project.name} is not a billable project`);
    }
    return { client, project };
  }

  async preview(q: { clientId: string; projectId?: string | null; period: string; excludeInvoiceId?: string }): Promise<FinInvoicePreview> {
    const [{ client, project }, tenant] = await Promise.all([this.clientAndProject(q.clientId, q.projectId), this.tenant()]);
    const a = await this.available(project?.id ?? null, q.period, q.excludeInvoiceId);
    const ratePaise = project?.ratePerHourPaise ?? client.defaultRatePerHourPaise ?? 0;
    const supplyType = finDeriveSupplyType(tenant.stateCode, client.stateCode);
    let guidance: string | null = null;
    if (!a.approvedMinutes) {
      const label = finMonthLabel(q.period);
      guidance = !project
        ? `${client.name} has no billable project — enter the hours manually with an adjustment note`
        : a.pendingTimesheets
          ? `0 approved hours for ${label} · ${a.pendingTimesheets} ${a.pendingTimesheets === 1 ? 'timesheet' : 'timesheets'} pending approval`
          : `0 approved, unbilled hours for ${label}`;
    } else if (a.pendingTimesheets) {
      guidance = `${finHoursLabel(a.pendingMinutes)} more hours are waiting in ${a.pendingTimesheets} ${a.pendingTimesheets === 1 ? 'timesheet' : 'timesheets'} pending approval`;
    }
    return {
      approvedMinutes: a.approvedMinutes,
      approvedHours: finHoursLabel(a.approvedMinutes),
      pendingMinutes: a.pendingMinutes,
      pendingTimesheets: a.pendingTimesheets,
      cellCount: a.cells.length,
      ratePaise,
      supplyType,
      gstLabel: finGstLabel(supplyType),
      placeOfSupply: finPlaceOfSupply(client.stateCode),
      emailTo: client.billingEmails ?? [],
      paymentTermsDays: client.paymentTermsDays,
      tax: finComputeInvoiceTax({ minutes: a.approvedMinutes, ratePaise, supply: supplyType }),
      guidance,
    };
  }

  /** Validate a create/edit body and compute every stored figure. */
  private async prepare(input: InvoiceBody, excludeInvoiceId?: string) {
    if (input.period > currentMonthKey()) throw new AppError(422, 'FUTURE_PERIOD', 'You can only invoice the current or earlier months');
    const [{ client, project }, tenant, settings] = await Promise.all([this.clientAndProject(input.clientId, input.projectId), this.tenant(), this.ledger.financeSettings()]);
    const a = await this.available(project?.id ?? null, input.period, excludeInvoiceId);
    const minutes = Math.round(input.billableHours * 60);
    const adjusted = minutes !== a.approvedMinutes;
    const note = input.adjustmentNote?.trim() || null;
    if (adjusted && !note) {
      throw new AppError(422, 'ADJUSTMENT_NOTE', `Approved hours are ${finHoursLabel(a.approvedMinutes)}. Add an adjustment note to bill ${finHoursLabel(minutes)} hours`, { fieldErrors: { adjustmentNote: ['Explain the difference from approved hours'] } });
    }
    const derived = finDeriveSupplyType(tenant.stateCode, client.stateCode);
    let supply: FinSupplyKind = derived;
    let overrideReason: string | null = null;
    if (input.gstMode !== 'AUTO' && input.gstMode !== derived) {
      if (!input.overrideReason?.trim()) throw new AppError(422, 'OVERRIDE_REASON', 'Give a reason to override the derived GST', { fieldErrors: { overrideReason: ['A reason is required'] } });
      supply = input.gstMode;
      overrideReason = input.overrideReason.trim();
    }
    const tax = finComputeInvoiceTax({ minutes, ratePaise: input.ratePaise, supply });
    const label = finMonthLabel(input.period);
    const description = `Software development services — ${project?.name ?? client.name} — ${label} (${finHoursLabel(minutes)} hrs @ ${formatINR(input.ratePaise)}/hr)`;
    const { start, end } = monthRange(input.period);
    const buyer: BuyerSnapshot = {
      name: client.legalName || client.name,
      displayName: client.name,
      gstin: client.gstin,
      pan: client.pan,
      address: [client.address, client.city, (client as SpineClient & { pincode?: string | null }).pincode].filter(Boolean).join(', ') || null,
      stateCode: client.stateCode,
      emails: client.billingEmails ?? [],
    };
    const tenantId = requireContext().tenantId;
    const data = {
      clientId: client.id,
      clientName: client.name,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      period: input.period,
      periodStart: start,
      periodEnd: end,
      paymentTermsDays: client.paymentTermsDays ?? settings.defaultPaymentTermsDays,
      placeOfSupply: finPlaceOfSupply(client.stateCode),
      supplyType: supply,
      gstRateBp: 1800,
      taxOverrideReason: overrideReason,
      buyerSnapshot: buyer as unknown as Prisma.InputJsonValue,
      minutes,
      sourceMinutes: a.approvedMinutes,
      adjustmentNote: adjusted ? note : null,
      ratePaise: input.ratePaise,
      subtotalPaise: tax.taxablePaise,
      cgstPaise: tax.cgstPaise,
      sgstPaise: tax.sgstPaise,
      igstPaise: tax.igstPaise,
      roundOffPaise: tax.roundOffPaise,
      totalPaise: tax.totalPaise,
      balancePaise: tax.totalPaise,
      emailTo: input.emailTo.length ? input.emailTo : (client.billingEmails ?? []),
      emailCc: input.emailCc ?? [],
      notes: input.notes?.trim() || null,
    };
    const line = {
      tenantId,
      sortOrder: 0,
      description,
      sac: FIN_SAC_IT_SERVICES,
      minutes,
      ratePaise: input.ratePaise,
      taxablePaise: tax.taxablePaise,
      gstRateBp: 1800,
      cgstPaise: tax.cgstPaise,
      sgstPaise: tax.sgstPaise,
      igstPaise: tax.igstPaise,
      lineTotalPaise: tax.taxablePaise + tax.cgstPaise + tax.sgstPaise + tax.igstPaise,
      projectId: project?.id ?? null,
    };
    return { data, line, a, adjusted, overridden: !!overrideReason, derived };
  }

  /** Lock the approved cells to this invoice (unique per cell — a concurrent invoice loses). */
  private async reserve(invoiceId: string, lineId: string, a: Awaited<ReturnType<InvoiceService['available']>>) {
    if (!a.cells.length) return;
    try {
      await this.prisma.invoiceTimeEntry.createMany({
        data: a.cells.map((c) => {
          const tl = a.lines.get(c.lineId);
          return { invoiceId, invoiceLineId: lineId, timesheetCellId: c.id, employeeId: a.sheets.get(tl?.timesheetId ?? '')?.employeeId ?? null, taskId: tl?.taskId ?? null, date: c.date, minutes: c.finalMinutes } as Prisma.InvoiceTimeEntryCreateManyInput;
        }),
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError(409, 'HOURS_TAKEN', 'Some of these hours were just billed on another invoice. Refresh the hours and try again.');
      }
      throw e;
    }
  }

  async create(input: FinCreateInvoiceInput): Promise<FinInvoiceDetail> {
    const ctx = requireContext();
    const p = await this.prepare(input);
    const inv = await this.prisma.invoice.create({
      data: { ...p.data, status: 'DRAFT', createdByUserId: ctx.userId ?? null, lines: { create: [p.line] } } as Prisma.InvoiceUncheckedCreateInput,
      include: { lines: true },
    });
    try {
      await this.reserve(inv.id, inv.lines[0]!.id, p.a);
    } catch (e) {
      await this.prisma.invoice.delete({ where: { id: inv.id } });
      throw e;
    }
    await this.audit.record({ action: 'invoice.created', entity: 'Invoice', entityId: inv.id, meta: { client: inv.clientName, period: inv.period, minutes: inv.minutes, totalPaise: inv.totalPaise } });
    if (p.overridden) await this.audit.record({ action: 'invoice.tax_overridden', entity: 'Invoice', entityId: inv.id, meta: { derived: p.derived, used: inv.supplyType, reason: inv.taxOverrideReason } });
    if (p.adjusted) await this.audit.record({ action: 'invoice.hours_adjusted', entity: 'Invoice', entityId: inv.id, meta: { approvedMinutes: p.a.approvedMinutes, billedMinutes: inv.minutes, note: inv.adjustmentNote } });
    if (input.action === 'issue' || input.action === 'issue_and_email') {
      await this.issue(inv.id);
      if (input.action === 'issue_and_email') await this.email(inv.id, { to: inv.emailTo, cc: inv.emailCc, message: null }, { throwOnFail: false });
    }
    return this.detail(inv.id);
  }

  async update(id: string, input: InvoiceBody): Promise<FinInvoiceDetail> {
    const inv = await this.prisma.invoice.findFirst({ where: { id } });
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'DRAFT') throw conflict('Issued invoices are immutable — raise a credit note instead', 'NOT_DRAFT');
    const p = await this.prepare(input, id);
    await this.prisma.invoiceLine.deleteMany({ where: { invoiceId: id } }); // cascades the reserved time entries
    const saved = await this.prisma.invoice.update({ where: { id }, data: { ...p.data, lines: { create: [p.line] } } as Prisma.InvoiceUncheckedUpdateInput, include: { lines: true } });
    await this.reserve(id, saved.lines[0]!.id, p.a);
    await this.audit.record({ action: 'invoice.updated', entity: 'Invoice', entityId: id, meta: { minutes: saved.minutes, totalPaise: saved.totalPaise } });
    if (p.adjusted) await this.audit.record({ action: 'invoice.hours_adjusted', entity: 'Invoice', entityId: id, meta: { approvedMinutes: p.a.approvedMinutes, billedMinutes: saved.minutes, note: saved.adjustmentNote } });
    return this.detail(id);
  }

  async remove(id: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id } });
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'DRAFT') throw conflict('Only drafts can be deleted — cancel an issued invoice with a credit note', 'NOT_DRAFT');
    await this.prisma.invoice.delete({ where: { id } });
    await this.audit.record({ action: 'invoice.deleted', entity: 'Invoice', entityId: id, meta: { client: inv.clientName, period: inv.period } });
    return { ok: true };
  }

  // ── Issue ────────────────────────────────────────────────────────────────

  private seller(tenant: Awaited<ReturnType<InvoiceService['tenant']>>): SellerSnapshot {
    return {
      legalName: tenant.legalName || tenant.name,
      address: [tenant.address, tenant.city, tenant.stateName].filter(Boolean).join(', '),
      gstin: tenant.gstin,
      pan: tenant.pan,
      stateCode: tenant.stateCode,
      phone: tenant.phone,
      email: null,
    };
  }

  async issue(id: string): Promise<FinInvoiceDetail> {
    const inv = await this.prisma.invoice.findFirst({ where: { id }, include: fullInclude });
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'DRAFT') throw conflict(`${inv.number ?? 'This invoice'} is already issued`, 'NOT_DRAFT');
    const tenant = await this.tenant();
    if (!tenant.gstin || !tenant.stateCode) throw new AppError(422, 'SELLER_GST_MISSING', 'Add the company GSTIN and state (Branding) before issuing invoices');
    const buyer = inv.buyerSnapshot as unknown as BuyerSnapshot;
    if (!buyer?.stateCode) throw new AppError(422, 'BUYER_STATE_MISSING', `${inv.clientName} has no GST state — update the client before issuing`);
    if (inv.minutes <= 0 || inv.ratePaise <= 0 || inv.totalPaise <= 0) throw new AppError(422, 'EMPTY_INVOICE', 'Billable hours and rate must be more than zero');
    const today = todayDate();
    await this.ledger.assertOpen(today);
    const cellIds = inv.lines.flatMap((l) => l.timeEntries.map((t) => t.timesheetCellId));
    if (cellIds.length) {
      const st = await this.spine.cellSheetStatus(cellIds);
      const lost = cellIds.filter((c) => !st.has(c));
      if (lost.length) throw new AppError(409, 'HOURS_CHANGED', `${lost.length} reserved timesheet ${lost.length === 1 ? 'entry is' : 'entries are'} no longer approved — edit the draft to recalculate the hours`);
    }
    const number = await this.seq.next(INVOICE_SEQUENCE.key, { prefix: INVOICE_SEQUENCE.prefix, pad: INVOICE_SEQUENCE.pad });
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        number,
        fy: fyOf(today),
        invoiceDate: today,
        dueDate: addDays(today, inv.paymentTermsDays),
        status: 'ISSUED',
        issuedAt: new Date(),
        balancePaise: inv.totalPaise,
        sellerSnapshot: this.seller(tenant) as unknown as Prisma.InputJsonValue,
      },
      include: fullInclude,
    });
    await this.audit.record({ action: 'invoice.issued', entity: 'Invoice', entityId: id, meta: { number, totalPaise: updated.totalPaise, client: updated.clientName } });
    try {
      await this.ensureSalesVoucher(id);
    } catch (e) {
      this.log.error(`Sales voucher for ${number} failed: ${(e as Error).message}`);
    }
    try {
      await this.storePdf(updated);
    } catch (e) {
      this.log.error(`PDF for ${number} failed: ${(e as Error).message}`);
    }
    this.events.emit('invoice.issued', { invoiceId: id });
    return this.detail(id);
  }

  /** Dr client receivable (total); Cr Sales (taxable) + Output GST; round-off either side. Idempotent. */
  async ensureSalesVoucher(invoiceId: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId } });
    if (!inv || !inv.number || inv.status === 'DRAFT') return null;
    if (inv.salesVoucherId) return inv.salesVoucherId;
    const ar = await this.ledger.clientAccount(inv.clientId, inv.clientName);
    const lines: PostLine[] = [
      { accountId: ar, debitPaise: inv.totalPaise, narration: `${inv.number} · ${inv.clientName}` },
      { accountId: '', systemKey: 'SALES_SERVICES', creditPaise: inv.subtotalPaise, narration: `${inv.projectName ?? inv.clientName} · ${finMonthLabel(inv.period)}` },
      { accountId: '', systemKey: 'GST_OUTPUT_CGST', creditPaise: inv.cgstPaise },
      { accountId: '', systemKey: 'GST_OUTPUT_SGST', creditPaise: inv.sgstPaise },
      { accountId: '', systemKey: 'GST_OUTPUT_IGST', creditPaise: inv.igstPaise },
      inv.roundOffPaise >= 0 ? { accountId: '', systemKey: 'ROUND_OFF', creditPaise: inv.roundOffPaise } : { accountId: '', systemKey: 'ROUND_OFF', debitPaise: -inv.roundOffPaise },
    ];
    const v = await this.ledger.post({
      type: 'SALES',
      date: inv.invoiceDate ?? todayDate(),
      narration: `Invoice ${inv.number} – ${inv.projectName ?? inv.clientName} (${finMonthLabel(inv.period)})`,
      lines,
      sourceType: 'INVOICE',
      sourceId: inv.id,
      sourceRef: inv.number,
      allowFuture: true,
    });
    await this.prisma.invoice.update({ where: { id: inv.id }, data: { salesVoucherId: v.id } });
    return v.id;
  }

  private pdfData(inv: InvoiceRec & { lines: { description: string; sac: string; minutes: number; ratePaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; lineTotalPaise: number }[] }, seller: SellerSnapshot, settings: Awaited<ReturnType<LedgerService['financeSettings']>>): InvoicePdfData {
    const buyer = inv.buyerSnapshot as unknown as BuyerSnapshot;
    return {
      number: inv.number,
      status: inv.status,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      period: inv.period,
      supplyType: inv.supplyType as FinSupplyKind,
      gstRateBp: inv.gstRateBp,
      placeOfSupplyState: buyer?.stateCode ?? null,
      seller,
      buyer: { name: buyer?.name ?? inv.clientName, address: buyer?.address ?? null, gstin: buyer?.gstin ?? null, stateCode: buyer?.stateCode ?? null },
      lines: inv.lines,
      subtotalPaise: inv.subtotalPaise,
      cgstPaise: inv.cgstPaise,
      sgstPaise: inv.sgstPaise,
      igstPaise: inv.igstPaise,
      roundOffPaise: inv.roundOffPaise,
      totalPaise: inv.totalPaise,
      notes: inv.notes,
      bank: settings.bank,
      signatory: settings.signatory,
    };
  }

  private async renderFor(inv: FullInvoice): Promise<Buffer> {
    const [tenant, settings] = await Promise.all([this.tenant(), this.ledger.financeSettings()]);
    const seller = (inv.sellerSnapshot as unknown as SellerSnapshot | null) ?? this.seller(tenant);
    return renderInvoicePdf(this.pdf, this.pdfData(inv, seller, settings));
  }

  /** Render + store the issued PDF and file it under Bills & receipts › Sales invoices. */
  private async storePdf(inv: FullInvoice) {
    const buf = await this.renderFor(inv);
    const f = await this.storage.save({ data: buf, filename: `${inv.number}.pdf`, mime: 'application/pdf', category: 'invoice-pdf' });
    await this.prisma.invoice.update({ where: { id: inv.id }, data: { pdfFileId: f.id } });
    await this.filing.autoFile({
      folderKey: 'SALES_INVOICES',
      fileId: f.id,
      title: `${inv.number} · ${inv.clientName} · ${finMonthLabel(inv.period)}.pdf`,
      tags: [inv.clientName, 'invoice', inv.fy ?? fyOf(todayDate())],
      linkedEntityType: 'INVOICE',
      linkedEntityId: inv.id,
      linkedRef: inv.number ?? undefined,
      docDate: inv.invoiceDate ?? undefined,
    });
    return { id: f.id, data: buf };
  }

  async pdfFile(id: string): Promise<{ data: Buffer; filename: string }> {
    const inv = await this.prisma.invoice.findFirst({ where: { id }, include: fullInclude });
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'DRAFT' && inv.pdfFileId) {
      try {
        const { data } = await this.storage.read(inv.pdfFileId);
        return { data, filename: `${inv.number}.pdf` };
      } catch {
        /* re-render below */
      }
    }
    if (inv.status !== 'DRAFT') {
      const s = await this.storePdf(inv);
      return { data: s.data, filename: `${inv.number}.pdf` };
    }
    return { data: await this.renderFor(inv), filename: `Draft-${inv.clientName.replace(/\W+/g, '-')}-${inv.period}.pdf` };
  }

  async creditNotePdf(id: string, cnId: string): Promise<{ data: Buffer; filename: string }> {
    const inv = await this.prisma.invoice.findFirst({ where: { id }, include: fullInclude });
    const cn = inv?.creditNotes.find((c) => c.id === cnId);
    if (!inv || !cn) throw notFound('Credit note');
    return { data: await this.renderCreditNote(inv, cn), filename: `${cn.number}.pdf` };
  }

  private async renderCreditNote(inv: FullInvoice, cn: FullInvoice['creditNotes'][number]) {
    const [tenant, settings] = await Promise.all([this.tenant(), this.ledger.financeSettings()]);
    const seller = (inv.sellerSnapshot as unknown as SellerSnapshot | null) ?? this.seller(tenant);
    const data = this.pdfData(inv, seller, settings);
    return renderInvoicePdf(this.pdf, {
      ...data,
      kind: 'CREDIT NOTE',
      number: cn.number,
      status: 'ISSUED',
      invoiceDate: cn.date,
      reference: inv.number ?? undefined,
      notes: `Reason: ${cn.reason}`,
      subtotalPaise: cn.subtotalPaise,
      cgstPaise: cn.cgstPaise,
      sgstPaise: cn.sgstPaise,
      igstPaise: cn.igstPaise,
      roundOffPaise: cn.roundOffPaise,
      totalPaise: cn.totalPaise,
    });
  }

  // ── Email ────────────────────────────────────────────────────────────────

  async email(id: string, input: EmailInput | { to: string[]; cc: string[]; message: string | null }, opts: { throwOnFail?: boolean } = {}): Promise<FinInvoiceDetail> {
    const inv = await this.prisma.invoice.findFirst({ where: { id }, include: fullInclude });
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'DRAFT') throw conflict('Issue the invoice before emailing it', 'NOT_ISSUED');
    if (inv.status === 'CANCELLED') throw conflict('This invoice is cancelled', 'CANCELLED');
    const to = input.to.length ? input.to : inv.emailTo;
    if (!to.length) throw badRequest('Add at least one recipient');
    const { data } = await this.pdfFile(id);
    const seller = (inv.sellerSnapshot as unknown as SellerSnapshot | null) ?? this.seller(await this.tenant());
    const settings = await this.ledger.financeSettings();
    const buyer = inv.buyerSnapshot as unknown as BuyerSnapshot;
    const due = inv.dueDate ? dateKeyOf(inv.dueDate) : '';
    const lines = [
      `Dear ${buyer?.displayName ?? inv.clientName} team,`,
      '',
      `Please find attached tax invoice ${inv.number} dated ${inv.invoiceDate ? dateKeyOf(inv.invoiceDate) : ''} for ${inv.projectName ?? 'our services'} — ${finMonthLabel(inv.period)} (${finHoursLabel(inv.minutes)} hours).`,
      `Amount payable: ${formatINR(inv.balancePaise || inv.totalPaise, { decimals: true })} (incl. GST)${due ? ` · due by ${due}` : ''}.`,
      ...(input.message?.trim() ? ['', input.message.trim()] : []),
      '',
      `Bank: ${settings.bank.bankName}, A/c ${settings.bank.accountNo}, IFSC ${settings.bank.ifsc} · UPI ${settings.bank.upiId}`,
      '',
      'Regards,',
      `Accounts · ${seller.legalName}`,
    ];
    const ok = await this.mail.send({
      to,
      cc: input.cc?.length ? input.cc : undefined,
      subject: `Invoice ${inv.number} from ${seller.legalName} — ${finMonthLabel(inv.period)}`,
      text: lines.join('\n'),
      html: lines.map((l) => (l ? `<p style="margin:0 0 6px">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : '<br/>')).join(''),
      attachments: [{ filename: `${inv.number}.pdf`, content: data, contentType: 'application/pdf' }],
    });
    if (!ok) {
      await this.prisma.invoice.update({ where: { id }, data: { lastEmailError: 'The mail server did not accept the message' } });
      await this.audit.record({ action: 'invoice.email_failed', entity: 'Invoice', entityId: id, meta: { to } });
      if (opts.throwOnFail !== false) throw new AppError(502, 'EMAIL_FAILED', `${inv.number} could not be emailed. Check the address and retry.`);
      return this.detail(id);
    }
    await this.prisma.invoice.update({
      where: { id },
      data: { status: inv.status === 'ISSUED' ? 'EMAILED' : inv.status, emailedAt: new Date(), emailTo: to, emailCc: input.cc ?? [], lastEmailError: null },
    });
    await this.audit.record({ action: 'invoice.emailed', entity: 'Invoice', entityId: id, meta: { number: inv.number, to, cc: input.cc ?? [] } });
    return this.detail(id);
  }

  // ── Payments ─────────────────────────────────────────────────────────────

  async recordPayment(id: string, input: PaymentInput): Promise<FinInvoiceDetail> {
    const ctx = requireContext();
    const inv = await this.prisma.invoice.findFirst({ where: { id } });
    if (!inv) throw notFound('Invoice');
    if (!OPEN_INVOICE_STATUSES.includes(inv.status as (typeof OPEN_INVOICE_STATUSES)[number])) throw conflict(inv.status === 'PAID' ? 'This invoice is already paid in full' : 'Payments can only be recorded on issued invoices', 'NOT_OPEN');
    const date = dateOnly(input.date);
    if (inv.invoiceDate && date.getTime() < inv.invoiceDate.getTime()) throw new AppError(422, 'BEFORE_INVOICE', 'Payment date cannot be before the invoice date');
    let out: ReturnType<typeof paymentOutcome>;
    try {
      out = paymentOutcome(inv.totalPaise, inv.balancePaise, input.amountPaise, input.tdsPaise);
    } catch (e) {
      if (e instanceof InvoiceRuleError) throw new AppError(422, e.code, e.message);
      throw e;
    }
    await this.ledger.assertOpen(date);
    const pay = await this.prisma.invoicePayment.create({
      data: { invoiceId: id, date, amountPaise: input.amountPaise, tdsPaise: input.tdsPaise, mode: input.mode, reference: input.reference?.trim() || null, createdByUserId: ctx.userId ?? null } as Prisma.InvoicePaymentUncheckedCreateInput,
    });
    let voucherId: string | null = null;
    try {
      const ar = await this.ledger.clientAccount(inv.clientId, inv.clientName);
      const v = await this.ledger.post({
        type: 'RECEIPT',
        date,
        narration: `Invoice ${inv.number} received${input.reference ? ` · ${input.reference}` : ''}`,
        lines: [
          { accountId: '', systemKey: input.mode === 'CASH' ? 'CASH' : 'BANK', debitPaise: input.amountPaise },
          { accountId: '', systemKey: 'TDS_RECEIVABLE', debitPaise: input.tdsPaise },
          { accountId: ar, creditPaise: input.amountPaise + input.tdsPaise },
        ],
        sourceType: 'INVOICE_PAYMENT',
        sourceId: pay.id,
        sourceRef: inv.number,
      });
      voucherId = v.id;
    } catch (e) {
      await this.prisma.invoicePayment.delete({ where: { id: pay.id } });
      throw e;
    }
    await this.prisma.invoicePayment.update({ where: { id: pay.id }, data: { voucherId } });
    await this.prisma.invoice.update({
      where: { id },
      data: {
        receivedPaise: { increment: input.amountPaise },
        tdsPaise: { increment: input.tdsPaise },
        balancePaise: out.balancePaise,
        status: out.status,
        paidAt: out.status === 'PAID' ? date : null,
      },
    });
    await this.audit.record({ action: 'invoice.payment.recorded', entity: 'Invoice', entityId: id, meta: { number: inv.number, amountPaise: input.amountPaise, tdsPaise: input.tdsPaise, mode: input.mode, balancePaise: out.balancePaise } });
    if (out.status === 'PAID') this.events.emit('invoice.paid', { invoiceId: id });
    return this.detail(id);
  }

  async reversePayment(id: string, paymentId: string): Promise<FinInvoiceDetail> {
    const inv = await this.prisma.invoice.findFirst({ where: { id } });
    const pay = await this.prisma.invoicePayment.findFirst({ where: { id: paymentId, invoiceId: id } });
    if (!inv || !pay) throw notFound('Payment');
    if (inv.status === 'CANCELLED') throw conflict('This invoice is cancelled');
    if (pay.voucherId) await this.ledger.reverse(pay.voucherId, `Payment of ${inv.number} reversed`);
    await this.prisma.invoicePayment.delete({ where: { id: paymentId } });
    const balance = inv.balancePaise + pay.amountPaise + pay.tdsPaise;
    await this.prisma.invoice.update({
      where: { id },
      data: {
        receivedPaise: { decrement: pay.amountPaise },
        tdsPaise: { decrement: pay.tdsPaise },
        balancePaise: balance,
        status: balance >= inv.totalPaise ? (inv.emailedAt ? 'EMAILED' : 'ISSUED') : 'PARTIALLY_PAID',
        paidAt: null,
      },
    });
    await this.audit.record({ action: 'invoice.payment.reversed', entity: 'Invoice', entityId: id, meta: { number: inv.number, amountPaise: pay.amountPaise } });
    return this.detail(id);
  }

  // ── Cancel (credit note) ───────────────────────────────────────────────────

  async cancel(id: string, reason: string): Promise<FinInvoiceDetail> {
    const inv = await this.prisma.invoice.findFirst({ where: { id }, include: fullInclude });
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'DRAFT') throw conflict('Drafts are deleted, not cancelled', 'IS_DRAFT');
    if (inv.status === 'CANCELLED') throw conflict('This invoice is already cancelled', 'CANCELLED');
    if (inv.payments.length) throw conflict('Reverse the recorded payments before cancelling this invoice', 'HAS_PAYMENTS');
    const today = todayDate();
    await this.ledger.assertOpen(today);
    const number = await this.seq.next(CREDIT_NOTE_SEQUENCE.key, { prefix: CREDIT_NOTE_SEQUENCE.prefix, pad: CREDIT_NOTE_SEQUENCE.pad });
    const cn = await this.prisma.invoiceCreditNote.create({
      data: {
        number,
        invoiceId: id,
        date: today,
        reason,
        subtotalPaise: inv.subtotalPaise,
        cgstPaise: inv.cgstPaise,
        sgstPaise: inv.sgstPaise,
        igstPaise: inv.igstPaise,
        roundOffPaise: inv.roundOffPaise,
        totalPaise: inv.totalPaise,
      } as Prisma.InvoiceCreditNoteUncheckedCreateInput,
    });
    const ar = await this.ledger.clientAccount(inv.clientId, inv.clientName);
    const v = await this.ledger.post({
      type: 'CREDIT_NOTE',
      number,
      date: today,
      narration: `Credit note ${number} against ${inv.number}: ${reason}`.slice(0, 500),
      lines: [
        { accountId: '', systemKey: 'SALES_SERVICES', debitPaise: inv.subtotalPaise },
        { accountId: '', systemKey: 'GST_OUTPUT_CGST', debitPaise: inv.cgstPaise },
        { accountId: '', systemKey: 'GST_OUTPUT_SGST', debitPaise: inv.sgstPaise },
        { accountId: '', systemKey: 'GST_OUTPUT_IGST', debitPaise: inv.igstPaise },
        inv.roundOffPaise >= 0 ? { accountId: '', systemKey: 'ROUND_OFF', debitPaise: inv.roundOffPaise } : { accountId: '', systemKey: 'ROUND_OFF', creditPaise: -inv.roundOffPaise },
        { accountId: ar, creditPaise: inv.totalPaise },
      ],
      sourceType: 'CREDIT_NOTE',
      sourceId: cn.id,
      sourceRef: inv.number,
    });
    await this.prisma.invoiceCreditNote.update({ where: { id: cn.id }, data: { voucherId: v.id } });
    await this.prisma.invoiceTimeEntry.deleteMany({ where: { invoiceId: id } }); // hours become billable again
    await this.prisma.invoice.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, balancePaise: 0 } });
    try {
      const pdf = await this.renderCreditNote(inv, cn);
      const f = await this.storage.save({ data: pdf, filename: `${number}.pdf`, mime: 'application/pdf', category: 'invoice-pdf' });
      await this.filing.autoFile({ folderKey: 'SALES_INVOICES', fileId: f.id, title: `${number} · credit note for ${inv.number}.pdf`, tags: [inv.clientName, 'credit-note', fyOf(today)], linkedEntityType: 'INVOICE', linkedEntityId: id, linkedRef: number, docDate: today });
    } catch (e) {
      this.log.error(`Credit note PDF ${number}: ${(e as Error).message}`);
    }
    await this.audit.record({ action: 'invoice.cancelled', entity: 'Invoice', entityId: id, meta: { number: inv.number, creditNote: number, reason } });
    this.events.emit('invoice.cancelled', { invoiceId: id, creditNoteId: cn.id });
    return this.detail(id);
  }

  // ── Detail ───────────────────────────────────────────────────────────────

  async detail(id: string): Promise<FinInvoiceDetail> {
    const inv = await this.prisma.invoice.findFirst({ where: { id }, include: fullInclude });
    if (!inv) throw notFound('Invoice');
    const entries = inv.lines.flatMap((l) => l.timeEntries);
    const voucherIds = [inv.salesVoucherId, ...inv.payments.map((p) => p.voucherId)].filter((x): x is string => !!x);
    const [vouchers, emps, tasks, doc] = await Promise.all([
      voucherIds.length ? this.prisma.voucher.findMany({ where: { id: { in: voucherIds } }, select: { id: true, number: true } }) : [],
      this.prisma.employee.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.employeeId).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } }),
      this.spine.tasks([...new Set(entries.map((e) => e.taskId).filter((x): x is string => !!x))]),
      inv.pdfFileId ? this.prisma.filingDocument.findFirst({ where: { fileId: inv.pdfFileId, deletedAt: null }, select: { id: true } }) : null,
    ]);
    const vNo = new Map(vouchers.map((v) => [v.id, v.number]));
    const empName = new Map(emps.map((e) => [e.id, e.fullName]));
    const taskLabel = new Map(tasks.map((t) => [t.id, `${t.key} ${t.title}`]));
    const agg = new Map<string, { employeeName: string; taskLabel: string; minutes: number }>();
    for (const e of entries) {
      const k = `${e.employeeId}:${e.taskId}`;
      const cur = agg.get(k) ?? { employeeName: empName.get(e.employeeId ?? '') ?? '—', taskLabel: taskLabel.get(e.taskId ?? '') ?? inv.projectName ?? '—', minutes: 0 };
      cur.minutes += e.minutes;
      agg.set(k, cur);
    }
    const timeline: { at: string; label: string }[] = [{ at: inv.createdAt.toISOString(), label: 'Draft created' }];
    if (inv.issuedAt) timeline.push({ at: inv.issuedAt.toISOString(), label: `Issued as ${inv.number}` });
    if (inv.emailedAt) timeline.push({ at: inv.emailedAt.toISOString(), label: `Emailed to ${inv.emailTo.join(', ')}` });
    if (inv.lastEmailError) timeline.push({ at: inv.updatedAt.toISOString(), label: `Email failed: ${inv.lastEmailError}` });
    for (const p of inv.payments) timeline.push({ at: `${dateKeyOf(p.date)}T12:00:00.000Z`, label: `${formatINR(p.amountPaise)} received${p.tdsPaise ? ` (+ ${formatINR(p.tdsPaise)} TDS)` : ''}${p.voucherId && vNo.get(p.voucherId) ? ` · ${vNo.get(p.voucherId)}` : ''}` });
    if (inv.paidAt) timeline.push({ at: `${dateKeyOf(inv.paidAt)}T13:00:00.000Z`, label: 'Paid in full' });
    for (const c of inv.creditNotes) timeline.push({ at: `${dateKeyOf(c.date)}T12:00:00.000Z`, label: `Credit note ${c.number}` });
    if (inv.cancelledAt) timeline.push({ at: inv.cancelledAt.toISOString(), label: `Cancelled: ${inv.cancelReason ?? ''}` });
    timeline.sort((a, b) => a.at.localeCompare(b.at));
    const buyer = inv.buyerSnapshot as unknown as BuyerSnapshot;
    return {
      ...this.toRow(inv),
      ratePaise: inv.ratePaise,
      roundOffPaise: inv.roundOffPaise,
      receivedPaise: inv.receivedPaise,
      tdsPaise: inv.tdsPaise,
      gstRateBp: inv.gstRateBp,
      gstLabel: finGstLabel(inv.supplyType as FinSupplyKind, inv.gstRateBp),
      placeOfSupply: inv.placeOfSupply,
      taxOverrideReason: inv.taxOverrideReason,
      adjustmentNote: inv.adjustmentNote,
      sourceMinutes: inv.sourceMinutes,
      emailTo: inv.emailTo,
      emailCc: inv.emailCc,
      emailedAt: inv.emailedAt?.toISOString() ?? null,
      lastEmailError: inv.lastEmailError,
      paidAt: inv.paidAt ? dateKeyOf(inv.paidAt) : null,
      notes: inv.notes,
      cancelReason: inv.cancelReason,
      buyer: { name: buyer?.name ?? inv.clientName, gstin: buyer?.gstin ?? null, address: buyer?.address ?? null, stateCode: buyer?.stateCode ?? null },
      lines: inv.lines.map((l) => ({ id: l.id, description: l.description, sac: l.sac, hours: finHoursLabel(l.minutes), ratePaise: l.ratePaise, taxablePaise: l.taxablePaise, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, lineTotalPaise: l.lineTotalPaise })),
      payments: inv.payments.map((p) => ({ id: p.id, date: dateKeyOf(p.date), amountPaise: p.amountPaise, tdsPaise: p.tdsPaise, mode: p.mode, reference: p.reference, voucherNumber: p.voucherId ? (vNo.get(p.voucherId) ?? null) : null })),
      creditNotes: inv.creditNotes.map((c) => ({ id: c.id, number: c.number, date: dateKeyOf(c.date), totalPaise: c.totalPaise, reason: c.reason })),
      timeEntries: [...agg.values()].sort((a, b) => b.minutes - a.minutes).map((t) => ({ ...t, hours: finHoursLabel(t.minutes) })),
      timeline,
      salesVoucher: inv.salesVoucherId ? { id: inv.salesVoucherId, number: vNo.get(inv.salesVoucherId) ?? '' } : null,
      hasPdf: inv.status !== 'DRAFT',
      filingDocumentId: doc?.id ?? null,
    };
  }

  // ── Jobs ─────────────────────────────────────────────────────────────────

  /** Invoices that fell overdue yesterday → alert finance users (09:00 IST scan). */
  async notifyNewlyOverdue() {
    const yesterday = addDays(todayDate(), -1);
    const rows = await this.prisma.invoice.findMany({ where: { status: { in: [...OPEN_INVOICE_STATUSES] }, dueDate: yesterday } });
    if (!rows.length) return 0;
    const roles = await this.prisma.role.findMany({ where: { permissions: { has: 'invoices.manage' } }, select: { id: true } });
    const users = await this.prisma.user.findMany({ where: { roleId: { in: roles.map((r) => r.id) } }, select: { id: true } });
    for (const inv of rows) {
      await this.notifications.notify({
        userIds: users.map((u) => u.id),
        type: 'invoice.overdue',
        title: `${inv.number} is overdue`,
        body: `${inv.clientName} · ${formatINR(inv.balancePaise)} was due on ${dateKeyOf(inv.dueDate!)}`,
        link: `/invoices?open=${inv.id}`,
        from: 'Accounts',
      });
    }
    return rows.length;
  }

  async notifyPaid(invoiceId: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId } });
    if (!inv?.createdByUserId || inv.createdByUserId === requireContext().userId) return;
    await this.notifications.notify({ userIds: [inv.createdByUserId], type: 'invoice.paid', title: `${inv.number} paid in full`, body: `${inv.clientName} · ${formatINR(inv.totalPaise)}`, link: `/invoices?open=${inv.id}`, from: 'Accounts' });
  }
}
