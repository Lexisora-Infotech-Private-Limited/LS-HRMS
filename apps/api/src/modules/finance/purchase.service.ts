import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  finDeriveSupplyType,
  finEstimateInputGst,
  finMonthLabel,
  formatDate,
  formatINR,
  type BillExtraction,
  type CreatePurchaseInput,
  type FinVendorRow,
  type Gstr3bSummary,
  type Paginated,
  type PurchaseCategoryRow,
  type PurchaseDetail,
  type PurchaseFormOptions,
  type PurchaseKpis,
  type PurchaseRow,
} from '@lexisora/shared';
import type { z } from 'zod';
import type { finCreateCategorySchema, finCreateVendorSchema, finUpdateCategorySchema, purchaseListQuery } from '@lexisora/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { EventsService } from '../../core/registry/events.service';
import { StorageService } from '../../core/storage/storage.service';
import { PdfService } from '../../core/pdf/pdf.service';
import { requireContext } from '../../core/context/request-context';
import { AppError, badRequest, conflict, notFound } from '../../core/http/errors';
import { paginated, pageArgs } from '../../core/http/paginate';
import { LedgerService, type PostLine } from './ledger.service';
import { FilingService } from './filing.service';
import { TextLayerBillOcr, type BillOcrAdapter } from './adapters/bill-ocr';
import { PURCHASE_CATEGORIES } from './lib/coa';
import { isValidGstin, PurchaseGstError, resolvePurchaseGst, stateFromGstin, utiliseItc } from './lib/gst';
import { currentMonthKey, dateKeyOf, dateOnly, fyOf, monthKeyOf, monthRange, pdfINR, todayDate } from './lib/money';

type ListQuery = z.infer<typeof purchaseListQuery>;
type VendorInput = z.infer<typeof finCreateVendorSchema>;
type CategoryInput = z.infer<typeof finCreateCategorySchema>;
type CategoryUpdate = z.infer<typeof finUpdateCategorySchema>;

const BILL_MIME = /^(application\/pdf|image\/(png|jpe?g|webp|heic))$/;
const purchaseInclude = { vendor: true, category: true } satisfies Prisma.PurchaseInclude;
type PurchaseRec = Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>;

/**
 * Purchases & input GST: bill upload → text-layer OCR (or 18/118 estimate flagged
 * "estimated") → recorded purchase → PURCHASE/PAYMENT voucher → bill auto-filed.
 * GSTR-3B summary nets outward tax against eligible ITC in the statutory order.
 */
@Injectable()
export class PurchaseService {
  private readonly log = new Logger('Purchases');
  private readonly ocr: BillOcrAdapter = new TextLayerBillOcr();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
    private readonly ledger: LedgerService,
    private readonly filing: FilingService,
  ) {}

  private tenant() {
    return this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: requireContext().tenantId } });
  }

  // ── Masters ──────────────────────────────────────────────────────────────

  async ensureCategories() {
    const existing = await this.prisma.purchaseCategory.findMany({ select: { name: true } });
    if (existing.length) return;
    let order = 0;
    for (const c of PURCHASE_CATEGORIES) {
      const accountId = await this.ledger.accountIdByKey(c.key);
      await this.prisma.purchaseCategory.create({
        data: { name: c.name, accountId, defaultGstRateBp: c.rateBp, itcEligibleDefault: c.itc, createsAsset: !!c.asset, sortOrder: ++order } as Prisma.PurchaseCategoryUncheckedCreateInput,
      });
    }
  }

  async options(): Promise<PurchaseFormOptions> {
    await this.ensureCategories();
    const [vendors, categories, accounts] = await Promise.all([
      this.prisma.vendor.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.purchaseCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.account.findMany({ select: { id: true, name: true } }),
    ]);
    const acc = new Map(accounts.map((a) => [a.id, a.name]));
    return {
      vendors: vendors.map((v) => ({ id: v.id, name: v.name, gstin: v.gstin, stateCode: v.stateCode })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, defaultGstRateBp: c.defaultGstRateBp, itcEligibleDefault: c.itcEligibleDefault, accountName: acc.get(c.accountId) ?? '—' })),
    };
  }

  async categories(): Promise<PurchaseCategoryRow[]> {
    await this.ensureCategories();
    const [rows, accounts, counts] = await Promise.all([
      this.prisma.purchaseCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.account.findMany({ select: { id: true, name: true } }),
      this.prisma.purchase.groupBy({ by: ['categoryId'], where: { status: 'RECORDED' }, _count: { _all: true } }),
    ]);
    const acc = new Map(accounts.map((a) => [a.id, a.name]));
    const n = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    return rows.map((c) => ({ id: c.id, name: c.name, accountId: c.accountId, accountName: acc.get(c.accountId) ?? '—', defaultGstRateBp: c.defaultGstRateBp, itcEligibleDefault: c.itcEligibleDefault, createsAsset: c.createsAsset, isActive: c.isActive, bills: n.get(c.id) ?? 0 }));
  }

  private async checkCategoryAccount(accountId: string) {
    const a = await this.prisma.account.findFirst({ where: { id: accountId } });
    if (!a || a.isGroup) throw badRequest('Pick a ledger (not a group) for this category');
    if (!['EXPENSE', 'ASSET'].includes(a.type)) throw badRequest('Purchases post to an expense or fixed-asset ledger');
  }

  async createCategory(input: CategoryInput) {
    await this.checkCategoryAccount(input.accountId);
    if (await this.prisma.purchaseCategory.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } } })) throw conflict(`A category named “${input.name}” already exists`);
    const row = await this.prisma.purchaseCategory.create({ data: { ...input, sortOrder: 100 } as Prisma.PurchaseCategoryUncheckedCreateInput });
    await this.audit.record({ action: 'purchase_category.created', entity: 'PurchaseCategory', entityId: row.id, meta: { name: row.name } });
    return row;
  }

  async updateCategory(id: string, input: CategoryUpdate) {
    const c = await this.prisma.purchaseCategory.findFirst({ where: { id } });
    if (!c) throw notFound('Category');
    if (input.accountId) await this.checkCategoryAccount(input.accountId);
    const row = await this.prisma.purchaseCategory.update({ where: { id }, data: input });
    await this.audit.record({ action: 'purchase_category.updated', entity: 'PurchaseCategory', entityId: id, meta: input });
    return row;
  }

  async vendors(): Promise<FinVendorRow[]> {
    const [vendors, agg] = await Promise.all([
      this.prisma.vendor.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.purchase.groupBy({ by: ['vendorId'], where: { status: 'RECORDED' }, _count: { _all: true }, _sum: { amountPaise: true } }),
    ]);
    const m = new Map(agg.map((a) => [a.vendorId, a]));
    return vendors.map((v) => ({ id: v.id, name: v.name, gstin: v.gstin, pan: v.pan, stateCode: v.stateCode, email: v.email, bills: m.get(v.id)?._count._all ?? 0, spendPaise: Number(m.get(v.id)?._sum.amountPaise ?? 0) }));
  }

  private vendorData(input: VendorInput) {
    const gstin = input.gstin ? input.gstin.toUpperCase() : null;
    if (gstin && !isValidGstin(gstin)) throw new AppError(422, 'GSTIN_CHECKSUM', 'This GSTIN fails the check digit — please re-check it', { fieldErrors: { gstin: ['Invalid GSTIN'] } });
    return { name: input.name, gstin, pan: input.pan || (gstin ? gstin.slice(2, 12) : null), stateCode: input.stateCode || stateFromGstin(gstin), email: input.email || null };
  }

  async createVendor(input: VendorInput) {
    if (await this.prisma.vendor.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } } })) throw conflict(`${input.name} is already in the vendor master`);
    const row = await this.prisma.vendor.create({ data: this.vendorData(input) as Prisma.VendorUncheckedCreateInput });
    await this.audit.record({ action: 'vendor.created', entity: 'Vendor', entityId: row.id, meta: { name: row.name, gstin: row.gstin } });
    return row;
  }

  async updateVendor(id: string, input: VendorInput) {
    const v = await this.prisma.vendor.findFirst({ where: { id } });
    if (!v) throw notFound('Vendor');
    const dup = await this.prisma.vendor.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, NOT: { id } } });
    if (dup) throw conflict(`${input.name} is already in the vendor master`);
    const row = await this.prisma.vendor.update({ where: { id }, data: this.vendorData(input) });
    await this.audit.record({ action: 'vendor.updated', entity: 'Vendor', entityId: id, meta: { name: row.name, gstin: row.gstin } });
    return row;
  }

  // ── Lists ────────────────────────────────────────────────────────────────

  private async toRows(rows: PurchaseRec[]): Promise<PurchaseRow[]> {
    const ids = rows.map((r) => r.voucherId).filter((x): x is string => !!x);
    const vouchers = ids.length ? await this.prisma.voucher.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } }) : [];
    const vn = new Map(vouchers.map((v) => [v.id, v.number]));
    return rows.map((p) => ({
      id: p.id,
      billDate: dateKeyOf(p.billDate),
      vendorId: p.vendorId,
      vendorName: p.vendor.name,
      vendorInvoiceNo: p.vendorInvoiceNo,
      categoryId: p.categoryId,
      category: p.category.name,
      amountPaise: p.amountPaise,
      taxablePaise: p.taxablePaise,
      inputGstPaise: p.inputGstPaise,
      cgstPaise: p.cgstPaise,
      sgstPaise: p.sgstPaise,
      igstPaise: p.igstPaise,
      gstSource: p.gstSource,
      itcEligible: p.itcEligible,
      paidVia: p.paidVia,
      billFileId: p.billFileId,
      status: p.status,
      voucherId: p.voucherId,
      voucherNumber: p.voucherId ? (vn.get(p.voucherId) ?? null) : null,
    }));
  }

  async list(q: ListQuery): Promise<Paginated<PurchaseRow>> {
    const range = q.month ? monthRange(q.month) : null;
    const where: Prisma.PurchaseWhereInput = {
      ...(range ? { billDate: { gte: range.start, lte: range.end } } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.itc === 'eligible' ? { itcEligible: true } : q.itc === 'ineligible' ? { itcEligible: false } : {}),
      ...(q.q ? { OR: [{ vendorInvoiceNo: { contains: q.q, mode: 'insensitive' } }, { vendor: { name: { contains: q.q, mode: 'insensitive' } } }, { notes: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchase.findMany({ where, include: purchaseInclude, orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }], ...pageArgs(q) }),
      this.prisma.purchase.count({ where }),
    ]);
    return paginated(await this.toRows(rows), total, q);
  }

  async kpis(month = currentMonthKey()): Promise<PurchaseKpis> {
    const { start, end } = monthRange(month);
    const [bills, itc] = await Promise.all([
      this.prisma.purchase.aggregate({ where: { status: 'RECORDED', billDate: { gte: start, lte: end } }, _sum: { amountPaise: true }, _count: { _all: true } }),
      this.prisma.purchase.aggregate({ where: { status: 'RECORDED', itcEligible: true, itcPeriod: month }, _sum: { inputGstPaise: true } }),
    ]);
    return { month, monthLabel: finMonthLabel(month), purchasesPaise: Number(bills._sum.amountPaise ?? 0), bills: bills._count._all, itcClaimablePaise: Number(itc._sum.inputGstPaise ?? 0) };
  }

  async detail(id: string): Promise<PurchaseDetail> {
    const p = await this.prisma.purchase.findFirst({ where: { id }, include: purchaseInclude });
    if (!p) throw notFound('Purchase');
    const [row] = await this.toRows([p]);
    const [tenant, doc] = await Promise.all([this.tenant(), p.billFileId ? this.prisma.filingDocument.findFirst({ where: { fileId: p.billFileId, deletedAt: null }, select: { id: true } }) : null]);
    return {
      ...row!,
      vendorGstin: p.vendor.gstin,
      vendorStateCode: p.vendor.stateCode,
      gstRateBp: p.gstRateBp,
      ocrConfidence: p.ocrConfidence,
      fy: p.fy,
      itcPeriod: p.itcPeriod,
      notes: p.notes,
      createdAt: p.createdAt.toISOString(),
      supplyType: p.igstPaise > 0 ? 'INTER' : p.cgstPaise > 0 ? 'INTRA' : finDeriveSupplyType(tenant.stateCode, p.vendor.stateCode || stateFromGstin(p.vendor.gstin)),
      filingDocumentId: doc?.id ?? null,
    };
  }

  // ── Bill OCR ─────────────────────────────────────────────────────────────

  async extract(input: { fileId: string; categoryId?: string | null }): Promise<BillExtraction> {
    const { row, data } = await this.storage.read(input.fileId);
    if (!BILL_MIME.test(row.mime)) throw new AppError(422, 'FILE_TYPE', 'Upload the bill as a PDF or an image (PNG, JPG)');
    if (row.size > 15 * 1024 * 1024) throw new AppError(422, 'FILE_TOO_LARGE', 'Bills can be at most 15 MB');
    const r = await this.ocr.extract({ buffer: data, mime: row.mime });
    const cat = input.categoryId ? await this.prisma.purchaseCategory.findFirst({ where: { id: input.categoryId } }) : null;
    const gstin = r.vendorGstin && isValidGstin(r.vendorGstin) ? r.vendorGstin : null;
    const vendors = await this.prisma.vendor.findMany({ where: { isActive: true } });
    const ocrName = (r.vendorName ?? '').toLowerCase();
    const vendor = (gstin ? vendors.find((v) => v.gstin === gstin) : undefined) ?? (ocrName ? vendors.find((v) => ocrName.includes(v.name.toLowerCase())) : undefined) ?? null;
    const amountPaise = r.totalPaise ?? null;
    const ocrGst = r.textFound && r.gstPaise !== undefined && r.gstPaise > 0 ? r.gstPaise : null;
    const inputGstPaise = ocrGst ?? (amountPaise ? finEstimateInputGst(amountPaise, cat?.defaultGstRateBp ?? 1800) : null);
    const billDate = r.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(r.invoiceDate) ? r.invoiceDate : null;
    let duplicateOf: BillExtraction['duplicateOf'] = null;
    if (vendor && r.invoiceNo) {
      const d = await this.prisma.purchase.findFirst({ where: { vendorId: vendor.id, vendorInvoiceNo: { equals: r.invoiceNo, mode: 'insensitive' }, fy: fyOf(billDate ? dateOnly(billDate) : todayDate()) } });
      if (d) duplicateOf = { id: d.id, vendorInvoiceNo: d.vendorInvoiceNo };
    }
    await this.audit.record({ action: 'purchase.bill_extracted', entity: 'FileObject', entityId: row.id, meta: { textFound: r.textFound, confidence: r.confidence } });
    return {
      source: ocrGst !== null ? 'OCR' : 'ESTIMATED',
      confidence: r.confidence,
      vendorName: vendor?.name ?? r.vendorName?.slice(0, 120) ?? null,
      vendorId: vendor?.id ?? null,
      vendorGstin: gstin ?? vendor?.gstin ?? null,
      invoiceNo: r.invoiceNo ?? null,
      billDate,
      amountPaise,
      inputGstPaise,
      duplicateOf,
      textFound: r.textFound,
    };
  }

  // ── Record / cancel ──────────────────────────────────────────────────────

  async create(input: CreatePurchaseInput): Promise<PurchaseDetail> {
    const ctx = requireContext();
    await this.ensureCategories();
    const cat = await this.prisma.purchaseCategory.findFirst({ where: { id: input.categoryId } });
    if (!cat || !cat.isActive) throw badRequest('Pick a category');
    const billDate = dateOnly(input.billDate);
    if (billDate.getTime() > todayDate().getTime()) throw new AppError(422, 'FUTURE_DATE', 'Bill date cannot be in the future');
    await this.ledger.assertOpen(billDate);
    const file = await this.prisma.fileObject.findFirst({ where: { id: input.billFileId } });
    if (!file) throw badRequest('Upload the bill');
    if (!BILL_MIME.test(file.mime)) throw new AppError(422, 'FILE_TYPE', 'Upload the bill as a PDF or an image (PNG, JPG)');
    const gstin = input.vendorGstin ? input.vendorGstin.toUpperCase() : null;
    if (gstin && !isValidGstin(gstin)) throw new AppError(422, 'GSTIN_CHECKSUM', 'This GSTIN fails the check digit — please re-check it', { fieldErrors: { vendorGstin: ['Invalid GSTIN'] } });
    const name = input.vendorName.trim();
    let vendor = (await this.prisma.vendor.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) ?? (gstin ? await this.prisma.vendor.findFirst({ where: { gstin } }) : null);
    if (!vendor) {
      vendor = await this.prisma.vendor.create({ data: { name, gstin, pan: gstin ? gstin.slice(2, 12) : null, stateCode: stateFromGstin(gstin) } as Prisma.VendorUncheckedCreateInput });
      await this.audit.record({ action: 'vendor.created', entity: 'Vendor', entityId: vendor.id, meta: { name, gstin, via: 'purchase' } });
    } else if (gstin && !vendor.gstin) {
      vendor = await this.prisma.vendor.update({ where: { id: vendor.id }, data: { gstin, stateCode: vendor.stateCode ?? stateFromGstin(gstin), pan: vendor.pan ?? gstin.slice(2, 12) } });
    }
    const fy = fyOf(billDate);
    const invoiceNo = input.vendorInvoiceNo.trim();
    const dup = await this.prisma.purchase.findFirst({ where: { vendorId: vendor.id, vendorInvoiceNo: { equals: invoiceNo, mode: 'insensitive' }, fy } });
    if (dup) throw new AppError(409, 'DUPLICATE_BILL', `${vendor.name} bill ${dup.vendorInvoiceNo} is already recorded (${formatDate(dateKeyOf(dup.billDate))})`, { purchaseId: dup.id });
    const tenant = await this.tenant();
    let g: ReturnType<typeof resolvePurchaseGst>;
    try {
      g = resolvePurchaseGst({
        amountPaise: input.amountPaise,
        gstRateBp: cat.defaultGstRateBp,
        inputGstPaise: input.inputGstPaise,
        source: input.gstSource,
        vendorStateCode: vendor.stateCode,
        vendorGstin: vendor.gstin,
        tenantStateCode: tenant.stateCode,
        itcEligibleDefault: cat.itcEligibleDefault,
      });
    } catch (e) {
      if (e instanceof PurchaseGstError) throw new AppError(422, 'INPUT_GST', e.message, { fieldErrors: { inputGstPaise: [e.message] } });
      throw e;
    }
    const p = await this.prisma.purchase.create({
      data: {
        vendorId: vendor.id,
        vendorInvoiceNo: invoiceNo,
        billDate,
        fy,
        categoryId: cat.id,
        amountPaise: input.amountPaise,
        taxablePaise: g.taxablePaise,
        gstRateBp: cat.defaultGstRateBp,
        cgstPaise: g.cgstPaise,
        sgstPaise: g.sgstPaise,
        igstPaise: g.igstPaise,
        inputGstPaise: g.inputGstPaise,
        gstSource: g.source,
        ocrConfidence: input.ocrConfidence ?? null,
        itcEligible: g.itcEligible,
        itcPeriod: monthKeyOf(billDate),
        paidVia: input.paidVia,
        billFileId: file.id,
        notes: input.notes?.trim() || null,
        createdByUserId: ctx.userId ?? null,
      } as Prisma.PurchaseUncheckedCreateInput,
    });
    await this.audit.record({ action: 'purchase.recorded', entity: 'Purchase', entityId: p.id, meta: { vendor: vendor.name, invoiceNo, amountPaise: p.amountPaise, inputGstPaise: p.inputGstPaise, gstSource: p.gstSource } });
    if (g.source === 'MANUAL') {
      await this.audit.record({ action: 'purchase.gst_overridden', entity: 'Purchase', entityId: p.id, meta: { estimatedPaise: finEstimateInputGst(input.amountPaise, cat.defaultGstRateBp), usedPaise: g.inputGstPaise } });
    }
    try {
      await this.ensureVoucher(p.id);
    } catch (e) {
      this.log.error(`Voucher for purchase ${invoiceNo} failed: ${(e as Error).message}`);
    }
    await this.filing.autoFile({ folderKey: 'BILLS', fileId: file.id, title: `${vendor.name} ${invoiceNo}${/\.\w{2,4}$/.test(file.filename) ? file.filename.slice(file.filename.lastIndexOf('.')) : '.pdf'}`, tags: [vendor.name, cat.name, fy], linkedEntityType: 'PURCHASE', linkedEntityId: p.id, linkedRef: invoiceNo, docDate: billDate });
    this.events.emit('purchase.recorded', { purchaseId: p.id });
    if (cat.createsAsset) this.events.emit('purchase.asset_candidate', { purchaseId: p.id, item: `${cat.name} · ${vendor.name}`, quantity: 1, billDate: dateKeyOf(billDate), amountPerUnitPaise: p.amountPaise });
    return this.detail(p.id);
  }

  /** Dr category ledger (+ GST when ITC is blocked) and Input GST; Cr Bank/Cash (paid) or the vendor (unpaid). */
  async ensureVoucher(purchaseId: string) {
    const p = await this.prisma.purchase.findFirst({ where: { id: purchaseId }, include: purchaseInclude });
    if (!p || p.status !== 'RECORDED') return null;
    if (p.voucherId) return p.voucherId;
    const paid = p.paidVia !== 'UNPAID';
    const credit: PostLine = paid ? { accountId: '', systemKey: p.paidVia === 'CASH' ? 'CASH' : 'BANK', creditPaise: p.amountPaise } : { accountId: await this.ledger.vendorAccount(p.vendorId, p.vendor.name), creditPaise: p.amountPaise };
    const lines: PostLine[] = [
      { accountId: p.category.accountId, debitPaise: p.taxablePaise + (p.itcEligible ? 0 : p.inputGstPaise), narration: `${p.vendor.name} ${p.vendorInvoiceNo}` },
      ...(p.itcEligible
        ? [
            { accountId: '', systemKey: 'GST_INPUT_CGST', debitPaise: p.cgstPaise },
            { accountId: '', systemKey: 'GST_INPUT_SGST', debitPaise: p.sgstPaise },
            { accountId: '', systemKey: 'GST_INPUT_IGST', debitPaise: p.igstPaise },
          ]
        : []),
      credit,
    ];
    const v = await this.ledger.post({
      type: paid ? 'PAYMENT' : 'PURCHASE',
      date: p.billDate,
      narration: p.notes || `${p.vendor.name} ${p.vendorInvoiceNo} – ${p.category.name.toLowerCase()}`,
      lines,
      sourceType: 'PURCHASE',
      sourceId: p.id,
      sourceRef: p.vendorInvoiceNo,
      attachmentFileId: p.billFileId,
    });
    await this.prisma.purchase.update({ where: { id: p.id }, data: { voucherId: v.id } });
    return v.id;
  }

  async cancel(id: string, reason: string): Promise<PurchaseDetail> {
    const p = await this.prisma.purchase.findFirst({ where: { id } });
    if (!p) throw notFound('Purchase');
    if (p.status === 'CANCELLED') throw conflict('This purchase is already cancelled');
    if (p.voucherId) await this.ledger.reverse(p.voucherId, `Purchase ${p.vendorInvoiceNo} cancelled: ${reason}`);
    await this.prisma.purchase.update({
      where: { id },
      data: { status: 'CANCELLED', vendorInvoiceNo: `${p.vendorInvoiceNo} (cancelled)`.slice(0, 60), notes: [p.notes, `Cancelled: ${reason}`].filter(Boolean).join(' · ') },
    });
    await this.audit.record({ action: 'purchase.cancelled', entity: 'Purchase', entityId: id, meta: { invoiceNo: p.vendorInvoiceNo, reason } });
    return this.detail(id);
  }

  // ── GSTR-3B ──────────────────────────────────────────────────────────────

  async gstr3b(month = currentMonthKey()): Promise<Gstr3bSummary> {
    const { start, end } = monthRange(month);
    const [inv, cn, itc, inel] = await Promise.all([
      this.prisma.invoice.aggregate({ where: { status: { not: 'DRAFT' }, invoiceDate: { gte: start, lte: end } }, _sum: { subtotalPaise: true, igstPaise: true, cgstPaise: true, sgstPaise: true }, _count: { _all: true } }),
      this.prisma.invoiceCreditNote.aggregate({ where: { date: { gte: start, lte: end } }, _sum: { subtotalPaise: true, igstPaise: true, cgstPaise: true, sgstPaise: true }, _count: { _all: true } }),
      this.prisma.purchase.aggregate({ where: { status: 'RECORDED', itcEligible: true, itcPeriod: month }, _sum: { igstPaise: true, cgstPaise: true, sgstPaise: true, inputGstPaise: true }, _count: { _all: true } }),
      this.prisma.purchase.aggregate({ where: { status: 'RECORDED', itcEligible: false, itcPeriod: month }, _sum: { inputGstPaise: true } }),
    ]);
    const n = (x: number | null | undefined) => Number(x ?? 0);
    const outward = {
      taxablePaise: n(inv._sum.subtotalPaise) - n(cn._sum.subtotalPaise),
      igstPaise: n(inv._sum.igstPaise) - n(cn._sum.igstPaise),
      cgstPaise: n(inv._sum.cgstPaise) - n(cn._sum.cgstPaise),
      sgstPaise: n(inv._sum.sgstPaise) - n(cn._sum.sgstPaise),
      invoices: inv._count._all,
      creditNotes: cn._count._all,
    };
    const credit = { igst: n(itc._sum.igstPaise), cgst: n(itc._sum.cgstPaise), sgst: n(itc._sum.sgstPaise) };
    const u = utiliseItc({ igst: Math.max(0, outward.igstPaise), cgst: Math.max(0, outward.cgstPaise), sgst: Math.max(0, outward.sgstPaise) }, credit);
    return {
      month,
      monthLabel: finMonthLabel(month),
      outward,
      itc: { igstPaise: credit.igst, cgstPaise: credit.cgst, sgstPaise: credit.sgst, totalPaise: n(itc._sum.inputGstPaise), bills: itc._count._all },
      ineligibleItcPaise: n(inel._sum.inputGstPaise),
      payable: { igstPaise: u.payable.igst, cgstPaise: u.payable.cgst, sgstPaise: u.payable.sgst, totalPaise: u.payable.igst + u.payable.cgst + u.payable.sgst },
      utilisation: u.steps,
      carryForward: { igstPaise: u.carryForward.igst, cgstPaise: u.carryForward.cgst, sgstPaise: u.carryForward.sgst },
    };
  }

  async gstr3bCsv(month = currentMonthKey()) {
    const s = await this.gstr3b(month);
    const r = (p: number) => (p / 100).toFixed(2);
    const rows = [
      ['Section', 'Description', 'Taxable value', 'IGST', 'CGST', 'SGST'],
      ['3.1(a)', `Outward taxable supplies (${s.outward.invoices} invoices, ${s.outward.creditNotes} credit notes)`, r(s.outward.taxablePaise), r(s.outward.igstPaise), r(s.outward.cgstPaise), r(s.outward.sgstPaise)],
      ['4(A)(5)', `All other ITC (${s.itc.bills} bills)`, '', r(s.itc.igstPaise), r(s.itc.cgstPaise), r(s.itc.sgstPaise)],
      ['4(D)(2)', 'Ineligible ITC — Sec 17(5)', '', r(s.ineligibleItcPaise), '', ''],
      ['6.1', 'Net tax payable in cash', '', r(s.payable.igstPaise), r(s.payable.cgstPaise), r(s.payable.sgstPaise)],
      ['—', 'ITC carried forward', '', r(s.carryForward.igstPaise), r(s.carryForward.cgstPaise), r(s.carryForward.sgstPaise)],
    ];
    await this.audit.record({ action: 'gstr3b.exported', entity: 'Gstr3b', meta: { month } });
    return { filename: `GSTR-3B-${month}.csv`, csv: rows.map((x) => x.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') };
  }

  /** Save the GSTR-3B working as a PDF into Filing › GST returns (replaces the previous copy). */
  async fileGstr3b(month = currentMonthKey()) {
    const s = await this.gstr3b(month);
    const tenant = await this.tenant();
    const buf = await this.pdf.render((doc) => {
      this.pdf.header(doc, (tenant.legalName || tenant.name).replace(/[^\x20-\x7e]/g, ''), `GSTR-3B working · ${s.monthLabel}`);
      this.pdf.keyValues(doc, [
        ['GSTIN', tenant.gstin ?? '—'],
        ['Return period', s.monthLabel],
        ['Prepared on', formatDate(new Date())],
      ]);
      doc.moveDown(0.6);
      this.pdf.table(
        doc,
        ['Section', 'Description', 'Taxable', 'IGST', 'CGST', 'SGST'],
        [
          ['3.1(a)', 'Outward taxable supplies', pdfINR(s.outward.taxablePaise), pdfINR(s.outward.igstPaise), pdfINR(s.outward.cgstPaise), pdfINR(s.outward.sgstPaise)],
          ['4(A)(5)', 'All other ITC', '', pdfINR(s.itc.igstPaise), pdfINR(s.itc.cgstPaise), pdfINR(s.itc.sgstPaise)],
          ['4(D)(2)', 'Ineligible ITC (17(5))', '', pdfINR(s.ineligibleItcPaise), '', ''],
          ['6.1', 'Net payable in cash', '', pdfINR(s.payable.igstPaise), pdfINR(s.payable.cgstPaise), pdfINR(s.payable.sgstPaise)],
          ['', 'ITC carried forward', '', pdfINR(s.carryForward.igstPaise), pdfINR(s.carryForward.cgstPaise), pdfINR(s.carryForward.sgstPaise)],
        ],
        [0.1, 0.3, 0.15, 0.15, 0.15, 0.15],
        [2, 3, 4, 5],
      );
      doc.font('Helvetica').fontSize(8.5).fillColor('#605d5d').text('Utilisation order: IGST credit → IGST, CGST, SGST; CGST credit → CGST, IGST; SGST credit → SGST, IGST. Working paper — file the return on the GST portal.');
    });
    const f = await this.storage.save({ data: buf, filename: `GSTR-3B-${month}.pdf`, mime: 'application/pdf', category: 'filing' });
    await this.prisma.filingDocument.updateMany({ where: { linkedEntityType: 'GST_RETURN', linkedEntityId: `GSTR3B:${month}`, deletedAt: null }, data: { deletedAt: new Date() } });
    const doc = await this.filing.autoFile({ folderKey: 'GST_RETURNS', fileId: f.id, title: `GSTR-3B ${s.monthLabel} (working).pdf`, tags: ['gstr-3b', month, fyOf(monthRange(month).end)], linkedEntityType: 'GST_RETURN', linkedEntityId: `GSTR3B:${month}`, linkedRef: `GSTR-3B ${s.monthLabel}`, docDate: monthRange(month).end.getTime() > todayDate().getTime() ? todayDate() : monthRange(month).end });
    await this.audit.record({ action: 'gstr3b.filed', entity: 'Gstr3b', entityId: doc.id, meta: { month, payablePaise: s.payable.totalPaise } });
    return { documentId: doc.id, folderId: doc.folderId, title: doc.title, payable: formatINR(s.payable.totalPaise) };
  }
}
