import type { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { FIN_SAC_IT_SERVICES, finDeriveSupplyType, finHoursLabel, finMonthLabel, finPlaceOfSupply, finTaxFromTaxable, formatINR, type FinSupplyKind } from '@lexisora/shared';
import type { SeedCtx } from './core';
import { PdfService } from '../../src/core/pdf/pdf.service';
import { CHART_OF_ACCOUNTS, PURCHASE_CATEGORIES, SYSTEM_FOLDERS } from '../../src/modules/finance/lib/coa';
import { gstinCheckChar, payrollPostingLines, resolvePurchaseGst, utiliseItc } from '../../src/modules/finance/lib/gst';
import { validateVoucherLines } from '../../src/modules/finance/lib/ledger-math';
import { fyOf, voucherSequence, type VoucherKind } from '../../src/modules/finance/lib/money';
import { simpleTextPdf } from '../../src/modules/finance/adapters/bill-ocr';
import { renderInvoicePdf, type InvoicePdfData } from '../../src/modules/finance/invoice-pdf';

/**
 * Finance demo data (wireframe GEN.ledger / invoices / purchases / filing, "today" = Tue 29 Sep 2026):
 *  - chart of accounts with opening balances (books migrated on 1 Aug 2026), client / vendor sub-ledgers;
 *  - GST invoices INV-0398…0413 (INV-0412 Nimbus 320 h paid via RCPT-221, INV-0413 Zephyr 186 h emailed,
 *    two overdue) + the Crest Labs 64 h draft (shows "Draft"; the next issued number is INV-0414);
 *  - 23 September bills (Amazon IN-8843 ₹8,460 / GST ₹1,290 → PMT-310, Flipkart ₹24,900, Dell ₹1,42,000)
 *    so Purchases (Sep) = ₹1.84 L · 23 bills and Input GST claimable = ₹28,140;
 *  - vouchers so Income (Sep) ≈ ₹42.6 L (12 invoices), Expenses (Sep) ≈ ₹31.1 L incl. payroll,
 *    with the day book's RCPT-221, PMT-310, HRV-044 and PMT-309 (rent ₹2,10,000);
 *  - payroll accruals from the leavepay runs (Aug finalized + paid, Sep accrual), Aug PF/PT/TDS and GST paid;
 *  - filing cabinet folders with the wireframe counts (412 / 36 / 18 / 64 / 9 / 27), invoice PDFs and bills
 *    auto-filed, compliance filings and the GSTR-3B working for Aug.
 * Numbers continue through the sequences, so the next voucher is PMT-311 / RCPT-222 / HRV-045.
 */

const TODAY = '2026-09-29';
const FY = '2026-27';
const BANK_DETAILS = { bankName: 'HDFC Bank', accountName: 'Lexisora Infotech Pvt Ltd', accountNo: '50200012345678', ifsc: 'HDFC0000123', branch: 'Satellite, Ahmedabad', upiId: 'lexisora@hdfcbank' };
const SIGNATORY = 'Rohit Verma, Director';

type VType = VoucherKind;
type Src = 'MANUAL' | 'INVOICE' | 'INVOICE_PAYMENT' | 'PURCHASE' | 'CREDIT_NOTE' | 'PAYROLL_RUN' | 'REVERSAL';
type VLine = { key?: string; accountId?: string; dr?: number; cr?: number; narration?: string | null };
type VSpec = { id: string; type: VType; date: string; time: string; narration: string; lines: VLine[]; sourceType: Src; sourceId?: string | null; sourceRef?: string | null; employeeId?: string | null; attachmentFileId?: string | null; by: 'rohit' | 'kavya' };

const P = (rupees: number) => Math.round(rupees * 100);
const day = (k: string) => new Date(`${k}T00:00:00.000Z`);
const at = (k: string, hhmm = '11:00') => new Date(`${k}T${hhmm}:00.000+05:30`);
const addDays = (k: string, n: number) => new Date(day(k).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const newId = () => `c${randomBytes(12).toString('hex')}`;
const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthKeyAdd = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const monLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export async function seed_finance(prisma: PrismaClient, ctx: SeedCtx): Promise<void> {
  const tenantId = ctx.tenantId;
  if (await prisma.account.count({ where: { tenantId } })) return; // already seeded
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return;
  const storageRoot = resolve(process.env.STORAGE_DIR || './storage');
  const users = { rohit: ctx.user.rohit ?? null, kavya: ctx.user.kavya ?? null };
  const names = { rohit: 'Rohit Verma', kavya: 'Kavya Iyer' };
  const emp = (k: string) => ctx.emp[k] ?? null;
  const pdf = new PdfService();

  // ── Files (deterministic storage keys: re-seeding overwrites instead of piling up) ──
  const fileRows: Prisma.FileObjectCreateManyInput[] = [];
  async function saveFile(key: string, filename: string, mime: string, category: string, buf: Buffer, createdAt: Date, owner: string | null) {
    const storageKey = `seed/finance/${key}`;
    const path = join(storageRoot, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
    const id = newId();
    fileRows.push({ id, tenantId, ownerUserId: owner, storageKey, filename, mime, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), category, isPrivate: true, createdAt });
    return { id, size: buf.length };
  }

  // ── Chart of accounts (opening balances as migrated on 1 Aug 2026; debit-positive) ──
  const OPENING: Record<string, number> = { '1110': P(4850000), '1120': P(35000), '1150': P(185000), '1210': P(1840000), '1220': P(620000), '3100': -P(2000000), '3200': -P(5530000) };
  const byCode = new Map<string, string>();
  const byKey = new Map<string, string>();
  const accName = new Map<string, string>();
  for (const e of CHART_OF_ACCOUNTS) {
    const row = await prisma.account.create({
      data: { tenantId, code: e.code, name: e.name, type: e.type, isGroup: !!e.group, systemKey: e.key ?? null, isSystem: true, parentId: e.parent ? (byCode.get(e.parent) ?? null) : null, openingPaise: OPENING[e.code] ?? 0, createdAt: at('2026-08-01', '09:00') },
    });
    byCode.set(e.code, row.id);
    if (e.key) byKey.set(e.key, row.id);
    accName.set(row.id, e.name);
  }
  const partyNo = { CLIENT: 0, VENDOR: 0 };
  const partyAcc = new Map<string, string>();
  async function partyAccount(partyType: 'CLIENT' | 'VENDOR', partyId: string, name: string) {
    const k = `${partyType}:${partyId}`;
    if (partyAcc.has(k)) return partyAcc.get(k)!;
    const parentCode = partyType === 'CLIENT' ? '1130' : '2100';
    const row = await prisma.account.create({
      data: { tenantId, code: `${parentCode}${String(++partyNo[partyType]).padStart(3, '0')}`, name, type: partyType === 'CLIENT' ? 'ASSET' : 'LIABILITY', parentId: byCode.get(parentCode)!, partyType, partyId, isSystem: true, createdAt: at('2026-08-01', '09:05') },
    });
    partyAcc.set(k, row.id);
    accName.set(row.id, name);
    return row.id;
  }

  // ── Vouchers are collected first, then numbered per series in date order ──
  const vouchers: VSpec[] = [];
  const voucher = (v: Omit<VSpec, 'id'> & { id?: string }) => {
    const x: VSpec = { ...v, id: v.id ?? newId() };
    vouchers.push(x);
    return x.id;
  };

  // ── Filing folders ──
  const folderId = new Map<string, string>();
  let order = 0;
  for (const f of SYSTEM_FOLDERS) {
    const row = await prisma.filingFolder.create({ data: { tenantId, name: f.name, systemKey: f.key, isSystem: true, sortOrder: ++order, parentId: f.parent ? (folderId.get(f.parent) ?? null) : null, createdAt: at('2026-08-01', '09:00') } });
    folderId.set(f.key, row.id);
  }
  const docRows: Prisma.FilingDocumentCreateManyInput[] = [];
  const fileDoc = (folderKey: string, d: { fileId: string; title: string; mime?: string; size: number; tags: string[]; docDate: string; linkedEntityType?: string; linkedEntityId?: string; linkedRef?: string; by?: 'rohit' | 'kavya' | 'system' }) => {
    docRows.push({
      id: newId(),
      tenantId,
      folderId: folderId.get(folderKey)!,
      fileId: d.fileId,
      title: d.title,
      mime: d.mime ?? 'application/pdf',
      sizeBytes: d.size,
      tags: [...new Set(d.tags.map((t) => t.toLowerCase().slice(0, 32)))].slice(0, 10),
      fy: fyOf(day(d.docDate)),
      docDate: day(d.docDate),
      linkedEntityType: d.linkedEntityType ?? null,
      linkedEntityId: d.linkedEntityId ?? null,
      linkedRef: d.linkedRef ?? null,
      uploadedByUserId: d.by === 'kavya' ? users.kavya : d.by === 'system' ? null : users.rohit,
      uploadedByName: d.by === 'kavya' ? names.kavya : d.by === 'system' ? 'System' : names.rohit,
      uploadedAt: at(d.docDate, '17:30'),
    });
  };

  // ── Purchase categories & vendors ──
  const categoryRows = PURCHASE_CATEGORIES.map((c, i) => ({ id: newId(), tenantId, name: c.name, accountId: byKey.get(c.key)!, defaultGstRateBp: c.rateBp, itcEligibleDefault: c.itc, createsAsset: !!c.asset, sortOrder: i + 1 }));
  await prisma.purchaseCategory.createMany({ data: categoryRows });
  const cat = new Map(categoryRows.map((c) => [c.name, c]));
  const VENDORS: { name: string; legal: string; g14: string; email?: string }[] = [
    { name: 'Amazon', legal: 'Amazon Seller Services Pvt Ltd', g14: '24AAICA3918J1Z', email: 'business-invoices@amazon.in' },
    { name: 'Flipkart', legal: 'Flipkart Internet Pvt Ltd', g14: '29AABCF8078M1Z' },
    { name: 'Dell India', legal: 'Dell International Services India Pvt Ltd', g14: '29AAACD5613R1Z', email: 'in_business_billing@dell.com' },
    { name: 'Croma', legal: 'Infiniti Retail Ltd', g14: '24AABCI4569F1Z' },
    { name: 'Chai Point', legal: 'Mountain Trail Foods Pvt Ltd', g14: '24AAGCM4562K1Z' },
    { name: 'Uber India', legal: 'Uber India Systems Pvt Ltd', g14: '24AABCU7531E1Z' },
    { name: 'Swiggy Instamart', legal: 'Bundl Technologies Pvt Ltd', g14: '24AAFCB7707D1Z' },
    { name: 'Reliance Jio', legal: 'Reliance Jio Infocomm Ltd', g14: '24AABCR1718E1Z' },
    { name: 'Urban Company', legal: 'UrbanClap Technologies India Pvt Ltd', g14: '24AAECU5412B1Z' },
    { name: 'Airtel', legal: 'Bharti Airtel Ltd', g14: '24AAACB2894G1Z', email: 'ebill@airtel.com' },
  ];
  const vendorRows = VENDORS.map((v) => {
    const g = gstin(v.g14);
    return { id: newId(), tenantId, name: v.name, gstin: g, pan: g.slice(2, 12), stateCode: g.slice(0, 2), email: v.email ?? null, createdAt: at('2026-08-01', '10:00') };
  });
  await prisma.vendor.createMany({ data: vendorRows });
  const vendor = new Map(vendorRows.map((v) => [v.name, { ...v, legal: VENDORS.find((x) => x.name === v.name)!.legal }]));

  // ── Purchases (bills uploaded, GST captured, voucher posted, bill auto-filed) ──
  type Bill = { date: string; vendor: string; no: string; category: string; amount: number; paid: 'BANK' | 'CASH' | 'UNPAID'; ocrGst?: number; notes?: string; item: string; itcPeriod?: string };
  const BILLS: Bill[] = [
    // August
    { date: '2026-08-12', vendor: 'Amazon', no: 'IN-8122', category: 'Stationery', amount: 2340, paid: 'BANK', item: 'Printer cartridges and sticky notes' },
    { date: '2026-08-18', vendor: 'Croma', no: 'CR-54871', category: 'Peripherals', amount: 1899, paid: 'BANK', item: 'Webcam for the meeting room' },
    { date: '2026-08-26', vendor: 'Swiggy Instamart', no: 'SW-29110', category: 'Staff welfare / Food', amount: 1240, paid: 'BANK', item: 'Pantry restock' },
    // September — 23 bills (₹1,84,000)
    { date: '2026-09-01', vendor: 'Chai Point', no: 'CP-10231', category: 'Staff welfare / Food', amount: 480, paid: 'CASH', item: 'Tea & snacks – client meeting' },
    { date: '2026-09-02', vendor: 'Uber India', no: 'UB-88412', category: 'Travel', amount: 386, paid: 'BANK', item: 'Cab – bank visit' },
    { date: '2026-09-03', vendor: 'Croma', no: 'CR-55102', category: 'Peripherals', amount: 699, paid: 'BANK', item: 'USB-C hub' },
    { date: '2026-09-04', vendor: 'Swiggy Instamart', no: 'SW-30981', category: 'Staff welfare / Food', amount: 612, paid: 'BANK', item: 'Pantry restock' },
    { date: '2026-09-05', vendor: 'Reliance Jio', no: 'JIO-7781', category: 'Internet & telecom', amount: 399, paid: 'BANK', item: 'JioFi backup data pack' },
    { date: '2026-09-07', vendor: 'Amazon', no: 'IN-8710', category: 'Stationery', amount: 545, paid: 'BANK', item: 'Whiteboard markers' },
    { date: '2026-09-08', vendor: 'Uber India', no: 'UB-88954', category: 'Travel', amount: 342, paid: 'BANK', item: 'Cab – GST office' },
    { date: '2026-09-09', vendor: 'Chai Point', no: 'CP-10388', category: 'Staff welfare / Food', amount: 520, paid: 'CASH', item: 'Tea & snacks – sprint review' },
    { date: '2026-09-10', vendor: 'Urban Company', no: 'UC-22019', category: 'Repairs', amount: 449, paid: 'BANK', item: 'Electrician – conference room' },
    { date: '2026-09-11', vendor: 'Croma', no: 'CR-55290', category: 'Peripherals', amount: 349, paid: 'BANK', item: 'HDMI cable' },
    { date: '2026-09-12', vendor: 'Swiggy Instamart', no: 'SW-31502', category: 'Staff welfare / Food', amount: 388, paid: 'BANK', item: 'Pantry restock' },
    { date: '2026-09-14', vendor: 'Amazon', no: 'IN-8768', category: 'Stationery', amount: 299, paid: 'BANK', item: 'Notebooks' },
    { date: '2026-09-15', vendor: 'Uber India', no: 'UB-89430', category: 'Travel', amount: 415, paid: 'BANK', item: 'Cab – client office' },
    { date: '2026-09-16', vendor: 'Flipkart', no: 'FK-21877', category: 'Stationery', amount: 330, paid: 'BANK', item: 'Desk organisers' },
    { date: '2026-09-17', vendor: 'Chai Point', no: 'CP-10562', category: 'Staff welfare / Food', amount: 465, paid: 'CASH', item: 'Tea & snacks – interviews' },
    { date: '2026-09-18', vendor: 'Dell India', no: 'DL-5521', category: 'Laptops', amount: 142000, paid: 'UNPAID', notes: 'Dell Latitude 5450 × 2 – new joiners', item: 'Dell Latitude 5450 (i7, 16 GB) × 2' },
    { date: '2026-09-18', vendor: 'Urban Company', no: 'UC-22410', category: 'Repairs', amount: 399, paid: 'BANK', item: 'Plumber – pantry' },
    { date: '2026-09-19', vendor: 'Reliance Jio', no: 'JIO-7920', category: 'Internet & telecom', amount: 299, paid: 'BANK', item: 'JioFi backup data pack' },
    { date: '2026-09-20', vendor: 'Swiggy Instamart', no: 'SW-32044', category: 'Staff welfare / Food', amount: 436, paid: 'BANK', item: 'Pantry restock' },
    { date: '2026-09-21', vendor: 'Uber India', no: 'UB-90011', category: 'Travel', amount: 378, paid: 'BANK', item: 'Cab – courier drop' },
    { date: '2026-09-22', vendor: 'Flipkart', no: 'FK-22019', category: 'Peripherals', amount: 24900, paid: 'BANK', notes: 'Flipkart – keyboard & mouse combos (6)', item: 'Logitech MK270 keyboard & mouse combo × 6' },
    { date: '2026-09-23', vendor: 'Croma', no: 'CR-55511', category: 'Peripherals', amount: 450, paid: 'BANK', item: 'Laptop stand' },
    { date: '2026-09-27', vendor: 'Amazon', no: 'IN-8843', category: 'Stationery', amount: 8460, paid: 'BANK', ocrGst: 1290, notes: 'Amazon order – stationery', item: 'A4 paper (10 reams), pens, notebooks' },
  ];
  const tenantState = tenant.stateCode ?? '24';
  const purchaseRows: Prisma.PurchaseCreateManyInput[] = [];
  const itcSep = () => purchaseRows.filter((p) => p.itcEligible && p.itcPeriod === '2026-09').reduce((s, p) => s + p.inputGstPaise, 0);
  async function recordBill(b: Bill) {
    const v = vendor.get(b.vendor)!;
    const c = cat.get(b.category)!;
    const amountPaise = P(b.amount);
    const g = resolvePurchaseGst({ amountPaise, gstRateBp: c.defaultGstRateBp, inputGstPaise: b.ocrGst !== undefined ? P(b.ocrGst) : null, source: b.ocrGst !== undefined ? 'OCR' : null, vendorStateCode: v.stateCode, vendorGstin: v.gstin, tenantStateCode: tenantState, itcEligibleDefault: c.itcEligibleDefault });
    const rupee = (p: number) => `Rs. ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const [y, m, d] = b.date.split('-');
    const intra = finDeriveSupplyType(tenantState, v.stateCode) === 'INTRA';
    const lines =
      b.ocrGst !== undefined
        ? ['Tax Invoice', `Sold by: ${v.legal}`, `GSTIN: ${v.gstin}`, `Invoice No: ${b.no}`, `Invoice Date: ${d}/${m}/${y}`, `Bill to: ${tenant!.legalName ?? tenant!.name}, Ahmedabad`, `Item: ${b.item}`, `Taxable value: ${rupee(g.taxablePaise)}`, ...(intra ? [`CGST @ 9%: ${rupee(g.cgstPaise)}`, `SGST @ 9%: ${rupee(g.sgstPaise)}`] : [`IGST @ 18%: ${rupee(g.igstPaise)}`]), `Grand Total: ${rupee(amountPaise)}`]
        : ['Retail invoice', `Seller: ${v.legal}`, `GSTIN: ${v.gstin}`, `Order No: ${b.no}`, `Date: ${d}/${m}/${y}`, `Item: ${b.item}`, `Amount payable: ${rupee(amountPaise)} (inclusive of all taxes)`];
    const file = await saveFile(`bills/${slug(`${b.vendor}-${b.no}`)}.pdf`, `${b.vendor} ${b.no}.pdf`, 'application/pdf', 'bill', simpleTextPdf(lines, `${b.vendor} ${b.no}`), at(b.date, '12:00'), users.rohit);
    const id = newId();
    const itcPeriod = b.itcPeriod ?? b.date.slice(0, 7);
    purchaseRows.push({
      id,
      tenantId,
      vendorId: v.id,
      vendorInvoiceNo: b.no,
      billDate: day(b.date),
      fy: fyOf(day(b.date)),
      categoryId: c.id,
      amountPaise,
      taxablePaise: g.taxablePaise,
      gstRateBp: c.defaultGstRateBp,
      cgstPaise: g.cgstPaise,
      sgstPaise: g.sgstPaise,
      igstPaise: g.igstPaise,
      inputGstPaise: g.inputGstPaise,
      gstSource: g.source,
      ocrConfidence: b.ocrGst !== undefined ? 1 : null,
      itcEligible: g.itcEligible,
      itcPeriod,
      paidVia: b.paid,
      billFileId: file.id,
      notes: b.notes ?? null,
      createdByUserId: users.rohit,
      createdAt: at(b.date, '12:05'),
    });
    const paid = b.paid !== 'UNPAID';
    const voucherId = voucher({
      type: paid ? 'PAYMENT' : 'PURCHASE',
      date: b.date,
      time: b.date === '2026-09-27' ? '15:20' : '12:05',
      narration: b.notes ?? `${b.vendor} ${b.no} – ${c.name.toLowerCase()}`,
      lines: [
        { accountId: c.accountId, dr: g.taxablePaise + (g.itcEligible ? 0 : g.inputGstPaise), narration: `${b.vendor} ${b.no}` },
        ...(g.itcEligible ? [{ key: 'GST_INPUT_CGST', dr: g.cgstPaise }, { key: 'GST_INPUT_SGST', dr: g.sgstPaise }, { key: 'GST_INPUT_IGST', dr: g.igstPaise }] : []),
        paid ? { key: b.paid === 'CASH' ? 'CASH' : 'BANK', cr: amountPaise } : { accountId: await partyAccount('VENDOR', v.id, v.name), cr: amountPaise },
      ],
      sourceType: 'PURCHASE',
      sourceId: id,
      sourceRef: b.no,
      attachmentFileId: file.id,
      by: 'rohit',
    });
    purchaseRows[purchaseRows.length - 1]!.voucherId = voucherId;
    fileDoc('BILLS', { fileId: file.id, title: `${b.vendor} ${b.no}.pdf`, size: file.size, tags: [b.vendor, b.category, fyOf(day(b.date))], docDate: b.date, linkedEntityType: 'PURCHASE', linkedEntityId: id, linkedRef: b.no, by: 'system' });
  }
  for (const b of BILLS) await recordBill(b);
  // Airtel's August bill reached us in September: its ITC is claimed in the Sep return, which brings
  // "Input GST claimable" to exactly ₹28,140 (wireframe).
  const residual = P(28140) - itcSep();
  if (residual > 0) {
    const taxable = Math.round((residual * 10000) / 1800);
    await recordBill({ date: '2026-08-30', vendor: 'Airtel', no: 'AIR-55021', category: 'Internet & telecom', amount: (taxable + residual) / 100, paid: 'BANK', ocrGst: residual / 100, itcPeriod: '2026-09', notes: 'Airtel postpaid – Aug (bill received 2 Sep, ITC claimed in Sep)', item: 'Postpaid mobile plans – August' });
  }
  await prisma.purchase.createMany({ data: purchaseRows });

  // ── GST invoices ──
  const clients = await prisma.client.findMany({ where: { tenantId, isInternal: false } });
  const projects = await prisma.project.findMany({ where: { tenantId, key: { in: ['AT', 'KS'] } }, select: { id: true, key: true, name: true } });
  const clientBy = new Map(clients.map((c) => [c.name, c]));
  const projectBy = new Map(projects.map((p) => [p.key, p]));
  const seller: InvoicePdfData['seller'] = {
    legalName: tenant.legalName || tenant.name,
    address: [tenant.address, tenant.city, tenant.stateName].filter(Boolean).join(', '),
    gstin: tenant.gstin,
    pan: tenant.pan,
    stateCode: tenant.stateCode,
    phone: tenant.phone,
    email: null,
  };
  type Pay = { date: string; amount?: number; tds?: boolean; mode?: string; ref?: string };
  type Inv = { no: number | null; client: string; projectKey?: string; projectName?: string; period: string; hours: number; rate: number; issued?: string; status: 'PAID' | 'EMAILED' | 'PARTIALLY_PAID' | 'DRAFT'; pays?: Pay[]; note?: string };
  const INVOICES: Inv[] = [
    { no: 398, client: 'Nimbus Retail', projectKey: 'AT', period: '2026-07', hours: 312, rate: 1250, issued: '2026-08-03', status: 'PAID', pays: [{ date: '2026-08-28', tds: true, ref: 'NEFT N280826118' }] },
    { no: 399, client: 'Zephyr Foods', projectKey: 'KS', period: '2026-07', hours: 198, rate: 1100, issued: '2026-08-05', status: 'PAID', pays: [{ date: '2026-08-19', ref: 'IMPS 422819' }] },
    { no: 400, client: 'Crest Labs', projectName: 'Pulse analytics', period: '2026-07', hours: 150, rate: 1400, issued: '2026-08-06', status: 'PAID', pays: [{ date: '2026-09-02', tds: true, ref: 'NEFT C020926331' }] },
    { no: 401, client: 'Ardent Co.', projectName: 'Helix storefront', period: '2026-07', hours: 210, rate: 1000, issued: '2026-08-20', status: 'EMAILED' },
    { no: 402, client: 'Ardent Co.', projectName: 'Helix storefront', period: '2026-08', hours: 420, rate: 1000, issued: '2026-09-01', status: 'PAID', pays: [{ date: '2026-09-23', tds: true, ref: 'RTGS A230926902' }] },
    { no: 403, client: 'Crest Labs', projectName: 'Pulse analytics', period: '2026-08', hours: 260, rate: 1400, issued: '2026-09-01', status: 'PAID', pays: [{ date: '2026-09-15', tds: true, ref: 'NEFT C150926118' }] },
    { no: 404, client: 'Nimbus Retail', projectName: 'Atlas CRM — store rollout support', period: '2026-08', hours: 300, rate: 1250, issued: '2026-09-02', status: 'PAID', pays: [{ date: '2026-09-18', tds: true, ref: 'NEFT N180926552' }] },
    { no: 405, client: 'Zephyr Foods', projectName: 'Kestrel — design sprint', period: '2026-08', hours: 220, rate: 1100, issued: '2026-09-02', status: 'PAID', pays: [{ date: '2026-09-16', ref: 'IMPS 516214' }] },
    { no: 406, client: 'Nimbus Retail', projectName: 'Atlas CRM — reports module', period: '2026-08', hours: 360, rate: 1250, issued: '2026-09-03', status: 'PARTIALLY_PAID', pays: [{ date: '2026-09-23', amount: 250000, ref: 'NEFT N230926071' }] },
    { no: 407, client: 'Ardent Co.', projectName: 'Helix — payment gateway', period: '2026-08', hours: 380, rate: 1000, issued: '2026-09-04', status: 'EMAILED' },
    { no: 408, client: 'Crest Labs', projectName: 'Pulse — QA automation', period: '2026-08', hours: 240, rate: 1400, issued: '2026-09-04', status: 'PAID', pays: [{ date: '2026-09-22', tds: true, ref: 'NEFT C220926540' }] },
    { no: 409, client: 'Zephyr Foods', projectName: 'Kestrel — backend APIs', period: '2026-08', hours: 300, rate: 1100, issued: '2026-09-05', status: 'EMAILED' },
    { no: 410, client: 'Nimbus Retail', projectName: 'Atlas CRM — data migration', period: '2026-08', hours: 280, rate: 1250, issued: '2026-09-07', status: 'PAID', pays: [{ date: '2026-09-21', tds: true, ref: 'NEFT N210926330' }] },
    { no: 411, client: 'Ardent Co.', projectName: 'Helix — admin console', period: '2026-08', hours: 380.5, rate: 1000, issued: '2026-09-07', status: 'EMAILED' },
    { no: 412, client: 'Nimbus Retail', projectKey: 'AT', period: '2026-08', hours: 320, rate: 1250, issued: '2026-09-08', status: 'PAID', pays: [{ date: '2026-09-28', tds: true }] },
    { no: 413, client: 'Zephyr Foods', projectKey: 'KS', period: '2026-08', hours: 186, rate: 1250, issued: '2026-09-21', status: 'EMAILED' },
    { no: null, client: 'Crest Labs', period: '2026-09', hours: 64, rate: 1250, status: 'DRAFT', note: 'Fixed-scope QA support for Sep — 64 hours agreed with Crest Labs' },
  ];
  const invoiceRows: Prisma.InvoiceCreateManyInput[] = [];
  const invoiceLineRows: Prisma.InvoiceLineCreateManyInput[] = [];
  const paymentRows: Prisma.InvoicePaymentCreateManyInput[] = [];
  const gstByMonth = new Map<string, { igst: number; cgst: number; sgst: number }>();
  for (const inv of INVOICES) {
    const c = clientBy.get(inv.client);
    if (!c) continue;
    const project = inv.projectKey ? projectBy.get(inv.projectKey) : undefined;
    const projectName = project?.name ?? inv.projectName ?? null;
    const minutes = Math.round(inv.hours * 60);
    const ratePaise = P(inv.rate);
    const supply: FinSupplyKind = finDeriveSupplyType(tenant.stateCode, c.stateCode);
    const tax = finTaxFromTaxable(Math.round((minutes * ratePaise) / 60), supply);
    const label = finMonthLabel(inv.period);
    const [py, pm] = inv.period.split('-').map(Number) as [number, number];
    const id = newId();
    const lineId = newId();
    const number = inv.no ? `INV-${String(inv.no).padStart(4, '0')}` : null;
    const issued = inv.issued ?? null;
    const terms = c.paymentTermsDays ?? 15;
    const due = issued ? addDays(issued, terms) : null;
    const buyer = { name: c.legalName || c.name, displayName: c.name, gstin: c.gstin, pan: c.pan, address: [c.address, c.city, c.pincode].filter(Boolean).join(', ') || null, stateCode: c.stateCode, emails: c.billingEmails };
    const description = `Software development services — ${projectName ?? c.name} — ${label} (${finHoursLabel(minutes)} hrs @ ${formatINR(ratePaise)}/hr)`;
    const line = { description, sac: FIN_SAC_IT_SERVICES, minutes, ratePaise, taxablePaise: tax.taxablePaise, cgstPaise: tax.cgstPaise, sgstPaise: tax.sgstPaise, igstPaise: tax.igstPaise, lineTotalPaise: tax.taxablePaise + tax.taxPaise };
    invoiceLineRows.push({ id: lineId, tenantId, invoiceId: id, sortOrder: 0, gstRateBp: 1800, projectId: project?.id ?? null, ...line });

    // Payments → receipts (TDS 2% u/s 194J where the client deducts it).
    let balance = tax.totalPaise;
    let received = 0;
    let tdsTotal = 0;
    let paidAt: string | null = null;
    const ar = issued ? await partyAccount('CLIENT', c.id, c.name) : null;
    for (const p of inv.pays ?? []) {
      const tds = p.tds ? Math.round((tax.taxablePaise * 0.02) / 100) * 100 : 0;
      const amount = p.amount !== undefined ? P(p.amount) : balance - tds;
      const payId = newId();
      const vId = voucher({
        type: 'RECEIPT',
        date: p.date,
        time: p.date === '2026-09-28' ? '14:40' : '15:00',
        narration: `Invoice ${number} received${p.ref ? ` · ${p.ref}` : ''}`,
        lines: [
          { key: 'BANK', dr: amount },
          { key: 'TDS_RECEIVABLE', dr: tds },
          { accountId: ar!, cr: amount + tds },
        ],
        sourceType: 'INVOICE_PAYMENT',
        sourceId: payId,
        sourceRef: number,
        by: 'rohit',
      });
      paymentRows.push({ id: payId, tenantId, invoiceId: id, date: day(p.date), amountPaise: amount, tdsPaise: tds, mode: p.mode ?? 'BANK', reference: p.ref ?? null, voucherId: vId, createdByUserId: users.rohit, createdAt: at(p.date, '15:00') });
      balance -= amount + tds;
      received += amount;
      tdsTotal += tds;
      if (balance === 0) paidAt = p.date;
    }

    // Issued: SALES voucher (Dr client, Cr sales + output GST), PDF, auto-filed.
    let salesVoucherId: string | null = null;
    let pdfFileId: string | null = null;
    if (issued && number) {
      salesVoucherId = voucher({
        type: 'SALES',
        date: issued,
        time: '10:15',
        narration: `Invoice ${number} – ${projectName ?? c.name} (${label})`,
        lines: [
          { accountId: ar!, dr: tax.totalPaise, narration: `${number} · ${c.name}` },
          { key: 'SALES_SERVICES', cr: tax.taxablePaise, narration: `${projectName ?? c.name} · ${label}` },
          { key: 'GST_OUTPUT_CGST', cr: tax.cgstPaise },
          { key: 'GST_OUTPUT_SGST', cr: tax.sgstPaise },
          { key: 'GST_OUTPUT_IGST', cr: tax.igstPaise },
        ],
        sourceType: 'INVOICE',
        sourceId: id,
        sourceRef: number,
        by: 'rohit',
      });
      const m = issued.slice(0, 7);
      const g = gstByMonth.get(m) ?? { igst: 0, cgst: 0, sgst: 0 };
      gstByMonth.set(m, { igst: g.igst + tax.igstPaise, cgst: g.cgst + tax.cgstPaise, sgst: g.sgst + tax.sgstPaise });
      const status = inv.status;
      const buf = await renderInvoicePdf(pdf, {
        number,
        status,
        invoiceDate: day(issued),
        dueDate: day(due!),
        period: inv.period,
        supplyType: supply,
        gstRateBp: 1800,
        placeOfSupplyState: c.stateCode,
        seller,
        buyer: { name: buyer.name, address: buyer.address, gstin: buyer.gstin, stateCode: buyer.stateCode },
        lines: [line],
        subtotalPaise: tax.taxablePaise,
        cgstPaise: tax.cgstPaise,
        sgstPaise: tax.sgstPaise,
        igstPaise: tax.igstPaise,
        roundOffPaise: tax.roundOffPaise,
        totalPaise: tax.totalPaise,
        notes: null,
        bank: BANK_DETAILS,
        signatory: SIGNATORY,
      });
      const f = await saveFile(`invoices/${number}.pdf`, `${number}.pdf`, 'application/pdf', 'invoice-pdf', buf, at(issued, '10:15'), users.rohit);
      pdfFileId = f.id;
      fileDoc('SALES_INVOICES', { fileId: f.id, title: `${number} · ${c.name} · ${label}.pdf`, size: f.size, tags: [c.name, 'invoice', FY], docDate: issued, linkedEntityType: 'INVOICE', linkedEntityId: id, linkedRef: number, by: 'system' });
    }
    invoiceRows.push({
      id,
      tenantId,
      number,
      fy: issued ? fyOf(day(issued)) : null,
      clientId: c.id,
      clientName: c.name,
      projectId: project?.id ?? null,
      projectName,
      period: inv.period,
      periodStart: new Date(Date.UTC(py, pm - 1, 1)),
      periodEnd: new Date(Date.UTC(py, pm, 0)),
      invoiceDate: issued ? day(issued) : null,
      dueDate: due ? day(due) : null,
      paymentTermsDays: terms,
      placeOfSupply: finPlaceOfSupply(c.stateCode),
      supplyType: supply,
      gstRateBp: 1800,
      sellerSnapshot: issued ? (seller as unknown as Prisma.InputJsonValue) : undefined,
      buyerSnapshot: buyer as unknown as Prisma.InputJsonValue,
      minutes,
      sourceMinutes: inv.note ? 0 : minutes,
      adjustmentNote: inv.note ?? null,
      ratePaise,
      subtotalPaise: tax.taxablePaise,
      cgstPaise: tax.cgstPaise,
      sgstPaise: tax.sgstPaise,
      igstPaise: tax.igstPaise,
      roundOffPaise: tax.roundOffPaise,
      totalPaise: tax.totalPaise,
      receivedPaise: received,
      tdsPaise: tdsTotal,
      balancePaise: balance,
      status: inv.status,
      emailTo: c.billingEmails,
      emailCc: [],
      emailedAt: issued ? at(issued, '10:25') : null,
      paidAt: paidAt ? day(paidAt) : null,
      pdfFileId,
      salesVoucherId,
      createdByUserId: users.rohit,
      issuedAt: issued ? at(issued, '10:15') : null,
      createdAt: issued ? at(issued, '09:40') : at('2026-09-28', '17:10'),
    });
  }
  await prisma.invoice.createMany({ data: invoiceRows });
  await prisma.invoiceLine.createMany({ data: invoiceLineRows });
  await prisma.invoicePayment.createMany({ data: paymentRows });

  // ── Payroll accruals from the leavepay runs (finalized Aug + paid; Sep accrual as calculated) ──
  type Run = { id: string; period: string; status: string; grossPaise: number; netPaise: number; deductionsPaise: number; employerPfPaise: number; employeeCount: number; paidAt: Date | null };
  const db = prisma as unknown as { payrollRun?: { findMany(a: unknown): Promise<Run[]> } };
  const runs: Run[] = (await db.payrollRun?.findMany({ where: { tenantId, period: { in: ['2026-08', '2026-09'] }, runType: 'REGULAR' } }).catch(() => [])) ?? [];
  const statutory: { pf: number; pt: number; tds: number } = { pf: 0, pt: 0, tds: 0 };
  for (const r of runs.sort((a, b) => a.period.localeCompare(b.period))) {
    if (!r.grossPaise) continue;
    const isSep = r.period === '2026-09';
    const lines = payrollPostingLines({ grossPaise: r.grossPaise, netPaise: r.netPaise, deductionsPaise: r.deductionsPaise, employerPfPaise: r.employerPfPaise, employeeCount: r.employeeCount });
    const date = isSep ? TODAY : '2026-08-31';
    voucher({
      type: 'PAYROLL',
      date,
      time: isSep ? '12:30' : '12:40',
      narration: `Payroll ${finMonthLabel(r.period)} (${r.employeeCount} employees)`,
      lines: lines.map((l) => ({ key: l.key, dr: l.debitPaise, cr: l.creditPaise, narration: l.narration })),
      sourceType: 'PAYROLL_RUN',
      sourceId: r.id,
      sourceRef: `${r.period} payroll`,
      by: 'kavya',
    });
    if (!isSep) {
      voucher({ type: 'PAYMENT', date: '2026-08-31', time: '16:00', narration: `Salary payout ${finMonthLabel(r.period)}`, lines: [{ key: 'SALARY_PAYABLE', dr: r.netPaise }, { key: 'BANK', cr: r.netPaise }], sourceType: 'PAYROLL_RUN', sourceId: `${r.id}:paid`, sourceRef: `${r.period} payroll`, by: 'kavya' });
      for (const l of lines) {
        if (l.key === 'PF_PAYABLE') statutory.pf += l.creditPaise;
        if (l.key === 'PT_PAYABLE') statutory.pt += l.creditPaise;
        if (l.key === 'TDS_PAYABLE') statutory.tds += l.creditPaise;
      }
    }
  }

  // ── Manual payment / HR vouchers (August & September) ──
  const pmt = (date: string, key: string, rupees: number, narration: string, time = '11:30') => voucher({ type: 'PAYMENT', date, time, narration, lines: [{ key, dr: P(rupees) }, { key: 'BANK', cr: P(rupees) }], sourceType: 'MANUAL', by: 'rohit' });
  const hrv = (date: string, key: string, rupees: number, narration: string, counter: string, employee: string | null, time = '12:00') =>
    voucher({ type: 'HR', date, time, narration, lines: [{ key, dr: P(rupees) }, { key: counter, cr: P(rupees) }], sourceType: 'MANUAL', employeeId: employee ? emp(employee) : null, by: 'kavya' });
  // August
  pmt('2026-08-01', 'SOFTWARE', 231400, 'AWS cloud hosting – Jul');
  pmt('2026-08-04', 'ELECTRICITY', 61800, 'Torrent Power – Jul bill (HQ)');
  pmt('2026-08-05', 'INTERNET', 23600, 'Tata Tele leased line – Aug');
  pmt('2026-08-08', 'SOFTWARE', 96400, 'GitLab Premium + Figma seats – Aug');
  pmt('2026-08-12', 'PROFESSIONAL_FEES', 45000, 'CA retainer – Aug (Shah & Mehta LLP)');
  hrv('2026-08-14', 'STAFF_WELFARE', 9800, 'Independence Day celebration – snacks & decor', 'CASH', null);
  pmt('2026-08-24', 'RENT', 210000, 'Ahmedabad HQ – Sep', '16:00');
  // September (everything after 24 Sep is the wireframe's day-book rows)
  pmt('2026-09-01', 'SOFTWARE', 248600, 'AWS cloud hosting – Aug');
  pmt('2026-09-03', 'ELECTRICITY', 64300, 'Torrent Power – Aug bill (HQ)');
  pmt('2026-09-05', 'INTERNET', 23600, 'Tata Tele leased line – Sep');
  if (statutory.tds) voucher({ type: 'PAYMENT', date: '2026-09-07', time: '11:00', narration: 'TDS on salary – Aug (challan 281)', lines: [{ key: 'TDS_PAYABLE', dr: statutory.tds }, { key: 'BANK', cr: statutory.tds }], sourceType: 'MANUAL', by: 'rohit' });
  pmt('2026-09-08', 'SOFTWARE', 96400, 'GitLab Premium + Figma seats – Sep');
  pmt('2026-09-12', 'PROFESSIONAL_FEES', 45000, 'CA retainer – Sep (Shah & Mehta LLP)');
  hrv('2026-09-12', 'STAFF_WELFARE', 18500, 'Onam celebration – lunch & decor', 'BANK', null);
  if (statutory.pf) voucher({ type: 'PAYMENT', date: '2026-09-14', time: '11:00', narration: 'PF – Aug (ECR)', lines: [{ key: 'PF_PAYABLE', dr: statutory.pf }, { key: 'BANK', cr: statutory.pf }], sourceType: 'MANUAL', by: 'kavya' });
  if (statutory.pt) voucher({ type: 'PAYMENT', date: '2026-09-15', time: '11:00', narration: 'Professional tax – Aug (Gujarat)', lines: [{ key: 'PT_PAYABLE', dr: statutory.pt }, { key: 'BANK', cr: statutory.pt }], sourceType: 'MANUAL', by: 'kavya' });
  hrv('2026-09-16', 'TRAVEL', 38450, 'Client visit Mumbai – Rahul (flights, cab, hotel)', 'REIMB_PAYABLE', 'rahul');
  pmt('2026-09-17', 'SUBCONTRACT', 385000, 'TestPro Labs – Helix regression QA (Aug)');
  pmt('2026-09-18', 'REPAIRS', 14200, 'AC servicing – HQ (Cool Breeze AMC)');
  pmt('2026-09-20', 'PROFESSIONAL_FEES', 78000, 'Naukri RMS job slots – Q3');
  hrv('2026-09-22', 'STAFF_WELFARE', 6400, 'Birthday cakes – Sep', 'CASH', null);
  pmt('2026-09-23', 'BANK_CHARGES', 1180, 'Bank charges – Sep (HDFC)', '17:00');
  pmt('2026-09-24', 'RENT', 210000, 'Ahmedabad HQ – Oct', '16:10');
  hrv('2026-09-25', 'STAFF_WELFARE', 12000, 'Team dinner reimbursement', 'BANK', 'neha', '18:20');

  // GST for August (GSTR-3B filed 19 Sep): ITC set-off journal + cash payment.
  const augOut = gstByMonth.get('2026-08') ?? { igst: 0, cgst: 0, sgst: 0 };
  const augItc = purchaseRows.filter((p) => p.itcEligible && p.itcPeriod === '2026-08').reduce((s, p) => ({ igst: s.igst + (p.igstPaise ?? 0), cgst: s.cgst + (p.cgstPaise ?? 0), sgst: s.sgst + (p.sgstPaise ?? 0) }), { igst: 0, cgst: 0, sgst: 0 });
  const u = utiliseItc(augOut, augItc);
  const HEAD = { IGST: 'IGST', CGST: 'CGST', SGST: 'SGST' } as const;
  if (u.steps.length) {
    voucher({
      type: 'JOURNAL',
      date: '2026-09-19',
      time: '15:30',
      narration: 'GST set-off – Aug 2026 (GSTR-3B)',
      lines: u.steps.flatMap((s) => [
        { key: `GST_OUTPUT_${HEAD[s.to]}`, dr: s.amountPaise },
        { key: `GST_INPUT_${HEAD[s.from]}`, cr: s.amountPaise },
      ]),
      sourceType: 'MANUAL',
      by: 'rohit',
    });
  }
  const augCash = u.payable.igst + u.payable.cgst + u.payable.sgst;
  if (augCash > 0) {
    voucher({
      type: 'PAYMENT',
      date: '2026-09-19',
      time: '15:40',
      narration: 'GST paid – Aug 2026 (GSTR-3B)',
      lines: [{ key: 'GST_OUTPUT_IGST', dr: u.payable.igst }, { key: 'GST_OUTPUT_CGST', dr: u.payable.cgst }, { key: 'GST_OUTPUT_SGST', dr: u.payable.sgst }, { key: 'BANK', cr: augCash }],
      sourceType: 'MANUAL',
      by: 'rohit',
    });
  }

  // Subcontracting balances September expenses to the wireframe's ₹31.1 L (incl. payroll).
  const resolveAcc = (l: VLine) => l.accountId ?? byKey.get(l.key!)!;
  const expenseIds = new Set((await prisma.account.findMany({ where: { tenantId, type: 'EXPENSE' }, select: { id: true } })).map((a) => a.id));
  const sepExpenses = vouchers.filter((v) => v.date.startsWith('2026-09')).flatMap((v) => v.lines).filter((l) => expenseIds.has(resolveAcc(l))).reduce((s, l) => s + (l.dr ?? 0) - (l.cr ?? 0), 0);
  const pixel = Math.min(P(900000), Math.max(P(150000), Math.round((P(3110000) - sepExpenses) / 10000) * 10000));
  pmt('2026-09-10', 'SUBCONTRACT', pixel / 100, 'Pixelcraft Studio – Kestrel iOS build (Aug)');

  // ── Number, validate and insert every voucher ──
  const ANCHOR_LAST: Record<string, number> = { 'RCPT-': 221, 'PMT-': 310, 'HRV-': 44 };
  const FIRST: Record<string, number> = { 'JV-': 11, 'SV-': 27, 'PV-': 12, 'CN-': 1 };
  const series = new Map<string, VSpec[]>();
  vouchers.forEach((v) => {
    const p = voucherSequence(v.type).prefix;
    series.set(p, [...(series.get(p) ?? []), v]);
  });
  const numbers = new Map<string, string>();
  const nextValue = new Map<string, { key: string; next: number }>();
  for (const [prefix, list] of series) {
    list.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
    const sq = voucherSequence(list[0]!.type);
    const first = ANCHOR_LAST[prefix] !== undefined ? ANCHOR_LAST[prefix]! - list.length + 1 : (FIRST[prefix] ?? 1);
    list.forEach((v, i) => numbers.set(v.id, `${prefix}${String(first + i).padStart(sq.pad, '0')}`));
    nextValue.set(prefix, { key: sq.key, next: first + list.length });
  }
  const voucherRows: Prisma.VoucherCreateManyInput[] = [];
  const voucherLineRows: Prisma.VoucherLineCreateManyInput[] = [];
  for (const v of vouchers) {
    const resolved = v.lines.map((l) => ({ accountId: resolveAcc(l), debitPaise: l.dr ?? 0, creditPaise: l.cr ?? 0, narration: l.narration ?? null }));
    const ok = validateVoucherLines(resolved); // throws when a seeded voucher is unbalanced
    voucherRows.push({
      id: v.id,
      tenantId,
      number: numbers.get(v.id)!,
      type: v.type,
      date: day(v.date),
      fy: fyOf(day(v.date)),
      narration: v.narration,
      sourceType: v.sourceType,
      sourceId: v.sourceId ?? null,
      sourceRef: v.sourceRef ?? null,
      employeeId: v.employeeId ?? null,
      attachmentFileId: v.attachmentFileId ?? null,
      status: 'POSTED',
      totalPaise: ok.totalPaise,
      postedByUserId: users[v.by],
      postedByName: names[v.by],
      createdAt: at(v.date, v.time),
    });
    ok.lines.forEach((l, i) => voucherLineRows.push({ id: newId(), tenantId, voucherId: v.id, accountId: l.accountId, debitPaise: l.debitPaise, creditPaise: l.creditPaise, narration: l.narration, sortOrder: i }));
  }
  await prisma.voucher.createMany({ data: voucherRows });
  await prisma.voucherLine.createMany({ data: voucherLineRows });

  // Sequences continue after the seeded documents (next: PMT-311, RCPT-222, HRV-045, INV-0414).
  const seqRows = [...nextValue.values()].map((s) => ({ key: s.key, period: FY, next: s.next }));
  seqRows.push({ key: 'invoice.gst', period: '', next: Math.max(0, ...INVOICES.map((i) => i.no ?? 0)) + 1 });
  for (const s of seqRows) {
    await prisma.numberSequence.upsert({
      where: { tenantId_key_period: { tenantId, key: s.key, period: s.period } },
      create: { id: `seq_${tenantId}_${s.key}_${s.period}`, tenantId, key: s.key, period: s.period, nextValue: s.next },
      update: { nextValue: s.next },
    });
  }

  // ── Filing cabinet: archived documents so the tiles match the wireframe counts ──
  const synth = async (folderKey: string, title: string, docDate: string, tags: string[], body: string[], by: 'rohit' | 'kavya' = 'rohit') => {
    const buf = simpleTextPdf([title.replace(/\.pdf$/, ''), ...body, `Filed: ${docDate}`, 'Lexisora Infotech Private Limited · Filing cabinet'], title);
    const f = await saveFile(`filing/${slug(folderKey)}/${slug(title)}.pdf`, title, 'application/pdf', 'filing', buf, at(docDate, '17:00'), by === 'kavya' ? users.kavya : users.rohit);
    fileDoc(folderKey, { fileId: f.id, title, size: f.size, tags, docDate, by });
  };
  const months = Array.from({ length: 16 }, (_, i) => monthKeyAdd('2025-04', i)); // Apr 2025 … Jul 2026
  // Sales invoices archive INV-0310 … INV-0397 (imported from Tally).
  const clientNames = ['Nimbus Retail', 'Zephyr Foods', 'Crest Labs', 'Ardent Co.'];
  for (let n = 310; n <= 397; n++) {
    const i = n - 310;
    const m = months[Math.min(months.length - 1, Math.floor(i / 5.5))]!;
    const dd = String(3 + ((i * 3) % 20)).padStart(2, '0');
    const client = clientNames[i % 4]!;
    await synth('SALES_INVOICES', `INV-0${n} · ${client} · ${monLabel(monthKeyAdd(m, -1))}.pdf`, `${m}-${dd}`, [client, 'invoice', fyOf(day(`${m}-${dd}`))], ['Tax invoice (archived copy)', `Client: ${client}`]);
  }
  // Bills & receipts archive: recurring monthly bills + one-offs (282).
  const RECURRING: [string, string, string][] = [
    ['Airtel', 'Postpaid bill', 'internet & telecom'],
    ['Tata Tele', 'Leased line invoice', 'internet & telecom'],
    ['Torrent Power', 'Electricity bill', 'electricity'],
    ['AWS', 'Cloud hosting invoice', 'software & saas'],
    ['GitLab', 'Premium seats invoice', 'software & saas'],
    ['Figma', 'Professional seats invoice', 'software & saas'],
    ['Swiggy Instamart', 'Pantry order', 'staff welfare / food'],
    ['Swiggy Instamart', 'Pantry order (2)', 'staff welfare / food'],
    ['Uber India', 'Trip receipts', 'travel'],
    ['Uber India', 'Trip receipts (2)', 'travel'],
    ['Amazon', 'Order invoice', 'stationery'],
    ['Amazon', 'Order invoice (2)', 'stationery'],
    ['Chai Point', 'Tea & snacks bill', 'staff welfare / food'],
    ['Urban Company', 'Service invoice', 'repairs'],
    ['Titanium City Centre', 'Rent invoice', 'rent'],
    ['Shah & Mehta LLP', 'CA retainer invoice', 'professional fees'],
    ['HDFC Bank', 'Bank charges advice', 'bank charges'],
  ];
  let billN = 0;
  for (const m of months) {
    for (const [v, what, c] of RECURRING) {
      const dd = String(2 + ((billN * 7) % 25)).padStart(2, '0');
      billN++;
      await synth('BILLS', `${v} – ${what} – ${monLabel(m)}.pdf`, `${m}-${dd}`, [v, c, fyOf(day(`${m}-${dd}`))], [`${what}`, `Vendor: ${v}`, `Period: ${monLabel(m)}`]);
    }
  }
  const ONE_OFF: [string, string, string][] = [
    ['2025-04-18', 'Dell India – Latitude 5440 × 4 invoice', 'laptops'],
    ['2025-06-09', 'Godrej Interio – workstations invoice', 'furniture'],
    ['2025-07-21', 'Croma – conference room display invoice', 'peripherals'],
    ['2025-09-30', 'Dell India – Latitude 5440 × 2 invoice', 'laptops'],
    ['2025-11-12', 'Blue Star – AC installation invoice', 'repairs'],
    ['2026-01-08', 'Apple Store – MacBook Air (design) invoice', 'laptops'],
    ['2026-02-17', 'Flipkart – monitors × 4 invoice', 'peripherals'],
    ['2026-03-25', 'Godrej – fire safety cabinet invoice', 'furniture'],
    ['2026-05-14', 'Dell India – Latitude 5450 × 3 invoice', 'laptops'],
    ['2026-07-02', 'Canon – printer service invoice', 'repairs'],
  ];
  for (const [d, t, c] of ONE_OFF) await synth('BILLS', `${t}.pdf`, d, [c, fyOf(day(d))], [t]);
  // GST returns: 17 months × (GSTR-1 + GSTR-3B) acknowledgements + GSTR-9 + Aug working (36).
  const gstMonths = Array.from({ length: 17 }, (_, i) => monthKeyAdd('2025-04', i)); // Apr 2025 … Aug 2026
  for (const m of gstMonths) {
    const n = monthKeyAdd(m, 1);
    await synth('GST_RETURNS', `GSTR-1 ${monLabel(m)} – acknowledgement.pdf`, `${n}-11`, ['gstr-1', m, fyOf(day(`${m}-01`))], ['GSTR-1 filed', `Return period: ${monLabel(m)}`, `ARN: AA24${n.slice(5, 7)}${n.slice(2, 4)}0${String(1000 + gstMonths.indexOf(m)).padStart(6, '0')}`]);
    await synth('GST_RETURNS', `GSTR-3B ${monLabel(m)} – acknowledgement.pdf`, m === '2026-08' ? '2026-09-19' : `${n}-20`, ['gstr-3b', m, fyOf(day(`${m}-01`))], ['GSTR-3B filed', `Return period: ${monLabel(m)}`]);
  }
  await synth('GST_RETURNS', 'GSTR-9 FY 2024-25 – annual return.pdf', '2025-12-29', ['gstr-9', 'annual', '2024-25'], ['Annual return FY 2024-25']);
  {
    const s = augOut;
    const buf = simpleTextPdf(
      [
        'GSTR-3B working · Aug 2026',
        `GSTIN: ${tenant.gstin ?? ''}`,
        `3.1(a) Outward taxable supplies: IGST Rs. ${(s.igst / 100).toFixed(2)} · CGST Rs. ${(s.cgst / 100).toFixed(2)} · SGST Rs. ${(s.sgst / 100).toFixed(2)}`,
        `4(A)(5) ITC: IGST Rs. ${(augItc.igst / 100).toFixed(2)} · CGST Rs. ${(augItc.cgst / 100).toFixed(2)} · SGST Rs. ${(augItc.sgst / 100).toFixed(2)}`,
        `6.1 Net payable in cash: Rs. ${(augCash / 100).toFixed(2)}`,
      ],
      'GSTR-3B Aug 2026 (working)',
    );
    const f = await saveFile('filing/gst-returns/gstr-3b-2026-08-working.pdf', 'GSTR-3B-2026-08.pdf', 'application/pdf', 'filing', buf, at('2026-09-18', '18:00'), users.rohit);
    fileDoc('GST_RETURNS', { fileId: f.id, title: 'GSTR-3B Aug 2026 (working).pdf', size: f.size, tags: ['gstr-3b', '2026-08', FY], docDate: '2026-08-31', linkedEntityType: 'GST_RETURN', linkedEntityId: 'GSTR3B:2026-08', linkedRef: 'GSTR-3B Aug 2026', by: 'rohit' });
  }
  // Income tax (18).
  const IT: [string, string, string[]][] = [
    ['ITR-6 FY 2024-25 – acknowledgement.pdf', '2025-10-29', ['itr', '2024-25']],
    ['Tax audit report 3CA-3CD FY 2024-25.pdf', '2025-09-27', ['tax-audit', '2024-25']],
    ['Form 26AS FY 2024-25.pdf', '2025-06-15', ['26as', '2024-25']],
    ['Form 26AS FY 2025-26.pdf', '2026-06-16', ['26as', '2025-26']],
    ['Advance tax challan – Jun 2025.pdf', '2025-06-14', ['advance-tax', '2025-26']],
    ['Advance tax challan – Sep 2025.pdf', '2025-09-13', ['advance-tax', '2025-26']],
    ['Advance tax challan – Dec 2025.pdf', '2025-12-13', ['advance-tax', '2025-26']],
    ['Advance tax challan – Mar 2026.pdf', '2026-03-14', ['advance-tax', '2025-26']],
    ['Advance tax challan – Jun 2026.pdf', '2026-06-13', ['advance-tax', '2026-27']],
    ['Advance tax challan – Sep 2026.pdf', '2026-09-14', ['advance-tax', '2026-27']],
    ['TDS return 24Q – Q4 FY 2025-26.pdf', '2026-05-28', ['tds-return', '24q']],
    ['TDS return 26Q – Q4 FY 2025-26.pdf', '2026-05-28', ['tds-return', '26q']],
    ['TDS return 24Q – Q1 FY 2026-27.pdf', '2026-07-29', ['tds-return', '24q']],
    ['TDS return 26Q – Q1 FY 2026-27.pdf', '2026-07-29', ['tds-return', '26q']],
    ['Form 16 – FY 2025-26 (all employees).pdf', '2026-06-12', ['form-16', '2025-26']],
    ['ITR-6 FY 2025-26 – tax computation (draft).pdf', '2026-09-24', ['itr', '2025-26', 'draft']],
    ['Tax audit FY 2025-26 – document checklist.pdf', '2026-09-10', ['tax-audit', '2025-26']],
    ['Lower TDS certificate (Sec 197) FY 2026-27.pdf', '2026-04-22', ['tds', '2026-27']],
  ];
  for (const [t, d, tags] of IT) await synth('INCOME_TAX', t, d, tags, ['Income tax record']);
  // Contracts & NDAs (64): client MSAs / SOWs / NDAs, employee NDAs, subcontractor agreements.
  const CLIENT_DOCS: [string, string][] = [['Master services agreement', '2024-04-10'], ['SOW FY 2025-26', '2025-04-02'], ['SOW FY 2026-27', '2026-04-03'], ['Mutual NDA', '2024-03-28']];
  for (const c of clientNames) for (const [t, d] of CLIENT_DOCS) await synth('CONTRACTS', `${c} – ${t}.pdf`, d, [c, 'client', t.split(' ')[0]!.toLowerCase()], [`${t} with ${c}`]);
  const people = ['Rohit Verma', 'Kavya Iyer', 'Neha Kapoor', 'Arjun Mehta', 'Priya Sharma', 'Rahul Desai', 'Sneha Patel', 'Vikram Joshi', 'Ananya Rao', 'Isha Mehra', 'Karan Shah', 'Divya Nair', 'Meera Iyer'];
  for (const [i, p] of people.entries()) await synth('CONTRACTS', `NDA – ${p}.pdf`, `2024-${String(1 + (i % 12)).padStart(2, '0')}-1${i % 9}`, ['nda', 'employee'], [`Confidentiality agreement signed by ${p}`], 'kavya');
  const ALUMNI = ['Aakash Gupta', 'Bhavna Desai', 'Chirag Patel', 'Deepa Menon', 'Farhan Qureshi', 'Gauri Kulkarni', 'Harsh Vora', 'Ira Banerjee', 'Jay Trivedi', 'Kriti Malhotra', 'Lalit Rana', 'Mansi Shah', 'Nikhil Bose', 'Ojas Pandya', 'Pooja Rathod', 'Quasim Ali', 'Riya Thakkar', 'Sahil Arora', 'Tanvi Jain', 'Uday Kamath', 'Varun Sethi', 'Wasim Khan', 'Yash Doshi', 'Zoya Mirza', 'Aditi Joshi', 'Bharat Solanki', 'Chetan Raval', 'Disha Parekh', 'Esha Nanda'];
  for (const [i, p] of ALUMNI.entries()) await synth('CONTRACTS', `NDA – ${p} (alumni).pdf`, `202${3 + (i % 2)}-${String(1 + (i % 12)).padStart(2, '0')}-0${1 + (i % 9)}`, ['nda', 'alumni'], [`Confidentiality agreement signed by ${p}`], 'kavya');
  const SUBS: [string, string][] = [['Pixelcraft Studio – subcontractor NDA', '2026-03-12'], ['TestPro Labs – subcontractor NDA', '2026-02-20'], ['Consultant agreement – UX audit (Mira Shah)', '2025-08-04'], ['Consultant agreement – security review (Arvind K)', '2025-11-19'], ['Consultant agreement – Tally migration (Nilesh Modi)', '2026-06-22'], ['Consultant agreement – data engineering (Ravi Iyer)', '2026-07-15']];
  for (const [t, d] of SUBS) await synth('CONTRACTS', `${t}.pdf`, d, ['consultant'], [t]);
  // Company registration (9).
  const REG: [string, string][] = [
    ['Certificate of incorporation', '2019-06-14'],
    ['Memorandum of association', '2019-06-14'],
    ['Articles of association', '2019-06-14'],
    ['PAN card – company', '2019-06-20'],
    ['TAN allotment letter', '2019-07-02'],
    ['GST registration certificate (REG-06)', '2019-07-18'],
    ['Udyam registration certificate', '2021-02-11'],
    ['Shops & establishment licence – Ahmedabad', '2024-04-01'],
    ['Professional tax registration (Gujarat)', '2019-08-05'],
  ];
  for (const [t, d] of REG) await synth('REGISTRATION', `${t}.pdf`, d, ['registration'], [t, `CIN U72900GJ2019PTC108765`]);
  // Vendor agreements (27).
  const VA: [string, string][] = [
    ['Office lease – Titanium City Centre (2024-27)', '2024-03-15'],
    ['Office lease – addendum (parking)', '2025-01-10'],
    ['AWS customer agreement', '2023-09-01'],
    ['GitLab Premium subscription terms', '2025-04-01'],
    ['Figma organisation agreement', '2025-04-01'],
    ['Google Workspace agreement', '2023-07-12'],
    ['Tata Tele leased line contract', '2024-05-20'],
    ['Airtel corporate postpaid agreement', '2024-06-03'],
    ['Pixelcraft Studio – master subcontract', '2026-03-12'],
    ['Pixelcraft Studio – SOW Kestrel iOS', '2026-06-30'],
    ['TestPro Labs – master subcontract', '2026-02-20'],
    ['TestPro Labs – SOW Helix QA', '2026-07-01'],
    ['Housekeeping AMC – CleanPro', '2025-10-01'],
    ['AC AMC – Cool Breeze', '2025-12-01'],
    ['Security services – SecureGuard', '2025-04-01'],
    ['Printer lease – Canon', '2024-08-16'],
    ['Water & pantry – Bisleri', '2025-05-05'],
    ['Swiggy corporate account terms', '2025-06-18'],
    ['Uber for Business terms', '2025-06-18'],
    ['Dell business account terms', '2024-04-02'],
    ['Amazon Business account terms', '2024-04-02'],
    ['Flipkart Wholesale account terms', '2024-11-11'],
    ['CA engagement letter – Shah & Mehta LLP', '2025-04-01'],
    ['Legal retainer – Desai & Associates', '2025-07-01'],
    ['Group health insurance – policy schedule', '2026-04-01'],
    ['Office insurance – fire & burglary', '2026-04-01'],
    ['Naukri RMS subscription', '2026-07-01'],
  ];
  for (const [t, d] of VA) await synth('VENDOR_AGREEMENTS', `${t}.pdf`, d, ['agreement', t.split(' ')[0]!.toLowerCase()], [t]);

  await prisma.fileObject.createMany({ data: fileRows });
  await prisma.filingDocument.createMany({ data: docRows });

  // ── Settings: bank details for the invoice PDF, books locked after the Aug return; compliance filings ──
  const settings = { booksLockedUpTo: '2026-08-31', defaultPaymentTermsDays: 15, bank: BANK_DETAILS, signatory: SIGNATORY };
  const filings: Record<string, { ref: string | null; filedOn: string; by: string | null }> = {};
  const filed = (form: string, period: string, filedOn: string, ref: string | null, by = names.rohit) => (filings[`${form}:${period}`] = { ref, filedOn, by });
  for (const [i, m] of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].entries()) {
    const n = monthKeyAdd(m, 1);
    filed('GSTR1', m, `${n}-${m === '2026-08' ? '11' : '10'}`, `AA24${n.slice(5, 7)}260${String(41000 + i * 37).padStart(7, '0')}`);
    filed('GSTR3B', m, m === '2026-08' ? '2026-09-19' : `${n}-19`, `AA24${n.slice(5, 7)}260${String(52000 + i * 41).padStart(7, '0')}`);
  }
  for (const m of ['2026-06', '2026-07', '2026-08']) {
    const n = monthKeyAdd(m, 1);
    filed('TDS_DEPOSIT', m, `${n}-07`, `CIN 0510308${n.slice(5, 7)}07${String(10000 + Number(m.slice(5)) * 13)}`);
    filed('PF_ECR', m, `${n}-14`, `TRRN ${3100000000 + Number(m.slice(5)) * 7919}`, names.kavya);
    filed('PT', m, `${n}-15`, null, names.kavya);
  }
  filed('ADVANCE_TAX', `${FY}-1`, '2026-06-13', 'CIN 05103080613001');
  filed('ADVANCE_TAX', `${FY}-2`, '2026-09-14', 'CIN 05103080914002');
  filed('TDS_RETURN', `${FY}-Q1`, '2026-07-29', 'Token 482910337651');
  await prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: 'finance.settings' } }, create: { tenantId, key: 'finance.settings', value: settings }, update: { value: settings } });
  await prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: 'finance.compliance' } }, create: { tenantId, key: 'finance.compliance', value: { filings } }, update: { value: { filings } } });

  ctx.extra.finance = { invoices: Object.fromEntries(invoiceRows.filter((i) => i.number).map((i) => [i.number!, i.id])), voucherCount: voucherRows.length };
}
