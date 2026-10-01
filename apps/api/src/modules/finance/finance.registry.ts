import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { finMonthLabel, formatINR } from '@lexisora/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventsService } from '../../core/registry/events.service';
import { LookupsService } from '../../core/lookups/lookups';
import { SearchService, type SearchHit } from '../../core/registry/registries';
import { fileAccessCheckers } from '../../core/storage/files.controller';
import { getContext, runAsTenant, type RequestContext } from '../../core/context/request-context';
import { hasPerm } from '../../core/auth/decorators';
import { LedgerService } from './ledger.service';
import { InvoiceService } from './invoice.service';
import { PurchaseService } from './purchase.service';
import type { PayrollTotals } from './lib/gst';

/**
 * Finance wiring (ARCHITECTURE §6/§7): event consumers that post vouchers, dropdown lookups,
 * header search providers, private-file access for finance documents and the daily
 * overdue-invoice scan.
 */
@Injectable()
export class FinanceRegistry implements OnModuleInit {
  private readonly log = new Logger('Finance');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly lookups: LookupsService,
    private readonly search: SearchService,
    private readonly ledger: LedgerService,
    private readonly invoices: InvoiceService,
    private readonly purchases: PurchaseService,
  ) {}

  onModuleInit() {
    // ── Events → ledger ───────────────────────────────────────────────────
    this.events.on('payroll.finalized', async (p: { runId: string; period: string; totals: PayrollTotals }) => {
      if (!p?.runId || !p.period || !p.totals) return;
      const v = await this.ledger.postPayroll({ runId: p.runId, period: p.period, totals: p.totals });
      this.log.log(`Payroll ${p.period} → ${v.number}`);
    });
    this.events.on('payroll.paid', async (p: { runId: string; period: string; netPaise?: number; paidAt?: string }) => {
      if (!p?.runId || !p.period) return;
      let net = p.netPaise;
      if (net === undefined) {
        const agg = await this.prisma.payslip.aggregate({ where: { runId: p.runId, status: { not: 'VOID' } }, _sum: { netPaise: true } });
        net = Number(agg._sum.netPaise ?? 0);
      }
      if (net > 0) await this.ledger.postPayrollPayment({ runId: p.runId, period: p.period, netPaise: net, paidAt: p.paidAt });
    });
    this.events.on('invoice.issued', async (p: { invoiceId: string }) => {
      if (p?.invoiceId) await this.invoices.ensureSalesVoucher(p.invoiceId);
    });
    this.events.on('invoice.paid', async (p: { invoiceId: string }) => {
      if (p?.invoiceId) await this.invoices.notifyPaid(p.invoiceId);
    });
    this.events.on('purchase.recorded', async (p: { purchaseId: string }) => {
      if (p?.purchaseId) await this.purchases.ensureVoucher(p.purchaseId);
    });

    // ── Lookups (voucher / category forms) ─────────────────────────────────
    this.lookups.register('ledgers', async () => {
      const rows = await this.prisma.account.findMany({ where: { isGroup: false, isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } });
      return rows.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
    });
    this.lookups.register('vendors', async () => {
      const rows = await this.prisma.vendor.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
      return rows.map((v) => ({ value: v.id, label: v.name }));
    });

    // ── Header search ──────────────────────────────────────────────────────
    this.search.register('Invoices', async (q, ctx) => (hasPerm(ctx, 'invoices.manage') ? this.searchInvoices(q) : []));
    this.search.register('Vouchers', async (q, ctx) => (hasPerm(ctx, 'ledger.manage') || hasPerm(ctx, 'ledger.hrvoucher') ? this.searchVouchers(q, ctx) : []));
    this.search.register('Purchases', async (q, ctx) => (hasPerm(ctx, 'purchases.manage') ? this.searchPurchases(q) : []));
    this.search.register('Documents', async (q, ctx) => (hasPerm(ctx, 'filing.manage') ? this.searchDocuments(q) : []));

    // ── Private files referenced by finance records ────────────────────────
    fileAccessCheckers.push((fileId) => this.canOpenFile(fileId).catch(() => false));
  }

  private async searchInvoices(q: string): Promise<SearchHit[]> {
    const rows = await this.prisma.invoice.findMany({
      where: { OR: [{ number: { contains: q, mode: 'insensitive' } }, { clientName: { contains: q, mode: 'insensitive' } }, { projectName: { contains: q, mode: 'insensitive' } }] },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    return rows.map((i) => ({ type: 'Invoices', id: i.id, title: `${i.number ?? 'Draft'} · ${i.clientName}`, subtitle: `${finMonthLabel(i.period)} · ${formatINR(i.totalPaise)}`, link: `/invoices?open=${i.id}` }));
  }

  private async searchVouchers(q: string, ctx: RequestContext): Promise<SearchHit[]> {
    const rows = await this.prisma.voucher.findMany({
      where: {
        ...(hasPerm(ctx, 'ledger.manage') ? {} : { type: 'HR' as const }),
        OR: [{ number: { contains: q, mode: 'insensitive' } }, { narration: { contains: q, mode: 'insensitive' } }, { sourceRef: { contains: q, mode: 'insensitive' } }],
      },
      orderBy: { date: 'desc' },
      take: 6,
    });
    return rows.map((v) => ({ type: 'Vouchers', id: v.id, title: `${v.number} · ${v.narration}`, subtitle: `${v.date.toISOString().slice(0, 10)} · ${formatINR(v.totalPaise)}`, link: `/ledger?voucher=${v.id}` }));
  }

  private async searchPurchases(q: string): Promise<SearchHit[]> {
    const rows = await this.prisma.purchase.findMany({
      where: { OR: [{ vendorInvoiceNo: { contains: q, mode: 'insensitive' } }, { vendor: { name: { contains: q, mode: 'insensitive' } } }] },
      include: { vendor: true },
      orderBy: { billDate: 'desc' },
      take: 6,
    });
    return rows.map((p) => ({ type: 'Purchases', id: p.id, title: `${p.vendor.name} · ${p.vendorInvoiceNo}`, subtitle: `${p.billDate.toISOString().slice(0, 10)} · ${formatINR(p.amountPaise)}`, link: `/purchases?open=${p.id}` }));
  }

  private async searchDocuments(q: string): Promise<SearchHit[]> {
    const rows = await this.prisma.filingDocument.findMany({
      where: { deletedAt: null, OR: [{ title: { contains: q, mode: 'insensitive' } }, { tags: { has: q.toLowerCase() } }, { linkedRef: { contains: q, mode: 'insensitive' } }] },
      include: { folder: true },
      orderBy: { uploadedAt: 'desc' },
      take: 6,
    });
    return rows.map((d) => ({ type: 'Documents', id: d.id, title: d.title, subtitle: d.folder.name, link: `/filing?folder=${d.folderId}&q=${encodeURIComponent(d.title)}` }));
  }

  /** Finance admins may open bills, invoice PDFs, voucher attachments and filed documents. */
  private async canOpenFile(fileId: string): Promise<boolean> {
    const ctx = getContext();
    if (!ctx) return false;
    const any = (...keys: Parameters<typeof hasPerm>[1][]) => keys.some((k) => hasPerm(ctx, k));
    if (any('filing.manage') && (await this.prisma.filingDocument.findFirst({ where: { fileId, deletedAt: null }, select: { id: true } }))) return true;
    if (any('purchases.manage', 'ledger.manage') && (await this.prisma.purchase.findFirst({ where: { billFileId: fileId }, select: { id: true } }))) return true;
    if (any('invoices.manage', 'ledger.manage') && (await this.prisma.invoice.findFirst({ where: { pdfFileId: fileId }, select: { id: true } }))) return true;
    if (any('ledger.manage') && (await this.prisma.voucher.findFirst({ where: { attachmentFileId: fileId }, select: { id: true } }))) return true;
    if (any('ledger.hrvoucher') && (await this.prisma.voucher.findFirst({ where: { attachmentFileId: fileId, type: 'HR' }, select: { id: true } }))) return true;
    return false;
  }

  /** 09:00 IST daily: invoices that became overdue yesterday → alert finance admins. */
  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async overdueScan() {
    const tenants = await this.prisma.raw.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const t of tenants) {
      try {
        const n = await runAsTenant(t.id, () => this.invoices.notifyNewlyOverdue());
        if (n) this.log.log(`Overdue invoices alerted for tenant ${t.id}: ${n}`);
      } catch (e) {
        this.log.error(`Overdue scan failed for tenant ${t.id}: ${(e as Error).message}`);
      }
    }
  }
}
