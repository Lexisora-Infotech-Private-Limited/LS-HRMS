import { z } from 'zod';
import { paginationQuery, type Paginated } from '../api';

/**
 * Finance domain contracts: GST invoices, purchases & input GST, double-entry ledger,
 * filing cabinet. Money is integer paise; GST rates are basis points (1800 = 18%).
 */

// ── Shared primitives ───────────────────────────────────────────────────────
export const finDateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
export const finMonthKey = z.string().regex(/^\d{4}-\d{2}$/, 'Use a month like 2026-09');
const optStr = z.string().trim().max(500).optional().nullable();
const paise = z.number().int();

export const FIN_SAC_IT_SERVICES = '998314';
export const FIN_DEFAULT_GST_RATE_BP = 1800;

export const FIN_GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};
export const finPlaceOfSupply = (stateCode: string | null | undefined): string =>
  stateCode ? `${stateCode}-${FIN_GST_STATES[stateCode] ?? 'State'}` : '—';

// ── Pure GST math (shared by the API and the live form preview) ─────────────
export type FinSupplyKind = 'INTRA' | 'INTER';

/** Intra-state (seller state == place of supply) → CGST + SGST, else IGST. */
export function finDeriveSupplyType(sellerStateCode: string | null | undefined, buyerStateCode: string | null | undefined): FinSupplyKind {
  return sellerStateCode && buyerStateCode && sellerStateCode === buyerStateCode ? 'INTRA' : 'INTER';
}

export function finGstLabel(supply: FinSupplyKind, rateBp = FIN_DEFAULT_GST_RATE_BP): string {
  const pct = (bp: number) => `${+(bp / 100).toFixed(2)}%`;
  return supply === 'INTRA' ? `${pct(rateBp / 2)} CGST + ${pct(rateBp / 2)} SGST` : `${pct(rateBp)} IGST`;
}

/** Round half up to an integer (paise). */
export const finRoundHalfUp = (x: number): number => Math.sign(x) * Math.round(Math.abs(x) + 1e-9);

export type FinInvoiceTax = {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
};

/**
 * taxable = minutes/60 × rate; INTRA: CGST = SGST = taxable × rate/2; INTER: IGST = taxable × rate.
 * Each tax rounded half-up to the paisa; the total is rounded to the rupee (difference = round-off).
 */
export function finComputeInvoiceTax(input: { minutes: number; ratePaise: number; supply: FinSupplyKind; gstRateBp?: number; roundToRupee?: boolean }): FinInvoiceTax {
  const rate = input.gstRateBp ?? FIN_DEFAULT_GST_RATE_BP;
  const taxablePaise = finRoundHalfUp((input.minutes * input.ratePaise) / 60);
  return finTaxFromTaxable(taxablePaise, input.supply, rate, input.roundToRupee ?? true);
}

export function finTaxFromTaxable(taxablePaise: number, supply: FinSupplyKind, gstRateBp = FIN_DEFAULT_GST_RATE_BP, roundToRupee = true): FinInvoiceTax {
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  if (supply === 'INTRA') {
    cgstPaise = finRoundHalfUp((taxablePaise * gstRateBp) / 2 / 10000);
    sgstPaise = cgstPaise;
  } else {
    igstPaise = finRoundHalfUp((taxablePaise * gstRateBp) / 10000);
  }
  const taxPaise = cgstPaise + sgstPaise + igstPaise;
  const raw = taxablePaise + taxPaise;
  const totalPaise = roundToRupee ? finRoundHalfUp(raw / 100) * 100 : raw;
  return { taxablePaise, cgstPaise, sgstPaise, igstPaise, taxPaise, roundOffPaise: totalPaise - raw, totalPaise };
}

/** Input GST contained in a GST-inclusive amount: amount × r / (100 + r). */
export function finEstimateInputGst(amountPaise: number, gstRateBp = FIN_DEFAULT_GST_RATE_BP): number {
  return finRoundHalfUp((amountPaise * gstRateBp) / (10000 + gstRateBp));
}

/** Split an input GST total into CGST/SGST (paisa remainder on SGST) or IGST. */
export function finSplitInputGst(totalPaise: number, supply: FinSupplyKind): { cgstPaise: number; sgstPaise: number; igstPaise: number } {
  if (supply === 'INTRA') {
    const cgstPaise = Math.floor(totalPaise / 2);
    return { cgstPaise, sgstPaise: totalPaise - cgstPaise, igstPaise: 0 };
  }
  return { cgstPaise: 0, sgstPaise: 0, igstPaise: totalPaise };
}

/** Minutes → "320" or "186.5" hours for the invoice table. */
export const finHoursLabel = (minutes: number): string => String(+(minutes / 60).toFixed(2));

const FIN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09" → "Sep 2026" (fixed names: newer ICU builds print "Sept" for en-GB). */
export function finMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${FIN_MONTHS[((m ?? 1) - 1 + 12) % 12]} ${y}`;
}

/** KPI money: ₹ 42.6 L / ₹ 1.84 L / ₹ 28,140. */
export function formatINRKpi(paise: number): string {
  const r = paise / 100;
  const a = Math.abs(r);
  const sign = r < 0 ? '- ' : '';
  if (a >= 1e7) return `${sign}₹ ${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e6) return `${sign}₹ ${(a / 1e5).toFixed(1)} L`;
  if (a >= 1e5) return `${sign}₹ ${(a / 1e5).toFixed(2)} L`;
  return `${sign}₹ ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(a)}`;
}

// ── Ledger ──────────────────────────────────────────────────────────────────
export const FIN_ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type FinAccountTypeKey = (typeof FIN_ACCOUNT_TYPES)[number];
export const FIN_VOUCHER_TYPES = ['PAYMENT', 'RECEIPT', 'JOURNAL', 'HR', 'SALES', 'PURCHASE', 'CREDIT_NOTE', 'PAYROLL'] as const;
export type VoucherTypeKey = (typeof FIN_VOUCHER_TYPES)[number];
export const FIN_MANUAL_VOUCHER_TYPES = ['PAYMENT', 'RECEIPT', 'JOURNAL', 'HR'] as const;
export const FIN_VOUCHER_TYPE_LABEL: Record<VoucherTypeKey, string> = {
  PAYMENT: 'Payment', RECEIPT: 'Receipt', JOURNAL: 'Journal', HR: 'HR voucher', SALES: 'Sales', PURCHASE: 'Purchase', CREDIT_NOTE: 'Credit note', PAYROLL: 'Payroll',
};

export const finLedgerTabs = ['daybook', 'income', 'expenses', 'hr', 'trial'] as const;
export const voucherListQuery = paginationQuery.extend({
  tab: z.enum(['daybook', 'income', 'expenses', 'hr']).default('daybook'),
  from: finDateKey.optional(),
  to: finDateKey.optional(),
  accountId: z.string().optional(),
  type: z.enum(FIN_VOUCHER_TYPES).optional(),
  source: z.enum(['MANUAL', 'INVOICE', 'INVOICE_PAYMENT', 'PURCHASE', 'CREDIT_NOTE', 'PAYROLL_RUN', 'REVERSAL']).optional(),
});
export type VoucherListQuery = z.infer<typeof voucherListQuery>;
export const FIN_VOUCHER_SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  INVOICE: 'Sales invoice',
  INVOICE_PAYMENT: 'Invoice receipt',
  PURCHASE: 'Purchase',
  CREDIT_NOTE: 'Credit note',
  PAYROLL_RUN: 'Payroll',
  REVERSAL: 'Reversal',
};

export const voucherLineInput = z.object({
  accountId: z.string().min(1, 'Pick an account'),
  debitPaise: paise.min(0).default(0),
  creditPaise: paise.min(0).default(0),
  narration: optStr,
});
export const createVoucherSchema = z
  .object({
    type: z.enum(FIN_MANUAL_VOUCHER_TYPES),
    date: finDateKey,
    narration: z.string().trim().min(2, 'Narration is required').max(500),
    /** Ledger (Payment / Receipt / HR voucher). */
    accountId: z.string().optional().nullable(),
    amountPaise: paise.positive('Amount must be more than zero').optional().nullable(),
    /** Bank / Cash (Payment, Receipt) or Paid from / Payable (HR voucher). Defaults to the bank account. */
    counterAccountId: z.string().optional().nullable(),
    employeeId: z.string().optional().nullable(),
    attachmentFileId: z.string().optional().nullable(),
    /** Journal lines. */
    lines: z.array(voucherLineInput).max(40).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'JOURNAL') {
      if (!v.lines || v.lines.length < 2) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'A journal needs at least two lines' });
    } else {
      if (!v.accountId) ctx.addIssue({ code: 'custom', path: ['accountId'], message: 'Ledger is required' });
      if (!v.amountPaise) ctx.addIssue({ code: 'custom', path: ['amountPaise'], message: 'Amount is required' });
    }
  });
export type CreateVoucherInput = z.infer<typeof createVoucherSchema>;

export const reverseVoucherSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) });
export const finDateRangeQuery = z.object({ from: finDateKey.optional(), to: finDateKey.optional() });
export const ledgerKpiQuery = z.object({ month: finMonthKey.optional() });
export const finCreateAccountSchema = z.object({
  code: z.string().trim().regex(/^\d{3,6}$/, 'Use a numeric code, e.g. 5310'),
  name: z.string().trim().min(2).max(120),
  type: z.enum(FIN_ACCOUNT_TYPES),
  parentId: z.string().optional().nullable(),
  openingPaise: paise.optional().default(0),
});
export const finUpdateAccountSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), isActive: z.boolean().optional() });
export const lockBooksSchema = z.object({ upTo: finDateKey });

export type FinAccountRow = {
  id: string;
  code: string;
  name: string;
  type: FinAccountTypeKey;
  parentId: string | null;
  isGroup: boolean;
  systemKey: string | null;
  partyType: string | null;
  isSystem: boolean;
  isActive: boolean;
  /** Debit-positive closing balance (today). */
  balancePaise: number;
};

export type VoucherRow = {
  id: string;
  number: string;
  type: VoucherTypeKey;
  date: string;
  narration: string;
  /** Primary counter-ledger ("Multiple" for multi-line journals). */
  ledger: string;
  debitPaise: number;
  creditPaise: number;
  status: 'POSTED' | 'REVERSED';
  sourceType: string;
  sourceRef: string | null;
  isReversal: boolean;
};
export type LedgerLineRow = {
  id: string;
  voucherId: string;
  number: string;
  date: string;
  accountId: string;
  account: string;
  narration: string;
  debitPaise: number;
  creditPaise: number;
};
export type VoucherDetail = VoucherRow & {
  fy: string;
  totalPaise: number;
  employeeName: string | null;
  attachmentFileId: string | null;
  postedByName: string | null;
  createdAt: string;
  reversalOf: { id: string; number: string } | null;
  reversedBy: { id: string; number: string } | null;
  source: { type: string; id: string | null; ref: string | null; link: string | null };
  lines: { id: string; accountId: string; accountCode: string; account: string; debitPaise: number; creditPaise: number; narration: string | null }[];
};
export type LedgerKpis = {
  month: string;
  monthLabel: string;
  incomePaise: number;
  expensesPaise: number;
  balancePaise: number;
  invoiceCount: number;
  /** A payroll accrual is posted in the month (KPI sub-copy "incl. payroll"). */
  payrollPosted: boolean;
  booksLockedUpTo: string | null;
};
export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: FinAccountTypeKey;
  openingPaise: number;
  debitPaise: number;
  creditPaise: number;
  closingPaise: number;
};
export type TrialBalance = {
  from: string;
  to: string;
  rows: TrialBalanceRow[];
  totals: { openingDr: number; openingCr: number; debitPaise: number; creditPaise: number; closingDr: number; closingCr: number };
  balanced: boolean;
};
export type AccountStatement = {
  account: { id: string; code: string; name: string; type: FinAccountTypeKey };
  from: string;
  to: string;
  openingPaise: number;
  closingPaise: number;
  rows: { voucherId: string; number: string; date: string; narration: string; debitPaise: number; creditPaise: number; balancePaise: number }[];
};

// ── Invoices ────────────────────────────────────────────────────────────────
export const FIN_INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'EMAILED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
export type FinInvoiceStatusKey = (typeof FIN_INVOICE_STATUSES)[number];
export const finInvoiceTabs = ['all', 'draft', 'emailed', 'paid', 'overdue'] as const;
export const finInvoiceListQuery = paginationQuery.extend({ tab: z.enum(finInvoiceTabs).default('all'), clientId: z.string().optional() });

export const finInvoicePreviewQuery = z.object({
  clientId: z.string().min(1),
  projectId: z.string().min(1),
  period: finMonthKey,
  excludeInvoiceId: z.string().optional(),
});

const finInvoiceBody = z.object({
  clientId: z.string().min(1, 'Client is required'),
  /** Optional only for clients without a billable project (manual hours need an adjustment note). */
  projectId: z.string().optional().nullable(),
  period: finMonthKey,
  billableHours: z.number().positive('Billable hours must be more than zero').max(20000),
  ratePaise: paise.positive('Rate must be more than zero'),
  /** AUTO = derived from state codes. INTRA/INTER overrides need a reason. */
  gstMode: z.enum(['AUTO', 'INTRA', 'INTER']).default('AUTO'),
  overrideReason: optStr,
  adjustmentNote: optStr,
  emailTo: z.array(z.string().trim().email('Enter valid email addresses')).max(10).default([]),
  emailCc: z.array(z.string().trim().email()).max(10).default([]),
  notes: optStr,
});
export const finCreateInvoiceSchema = finInvoiceBody.extend({ action: z.enum(['draft', 'issue', 'issue_and_email']).default('issue_and_email') });
export type FinCreateInvoiceInput = z.infer<typeof finCreateInvoiceSchema>;
export const finUpdateInvoiceSchema = finInvoiceBody;
export const finEmailInvoiceSchema = z.object({
  to: z.array(z.string().trim().email('Enter valid email addresses')).min(1, 'Add at least one recipient').max(10),
  cc: z.array(z.string().trim().email()).max(10).default([]),
  message: optStr,
});
export const finRecordPaymentSchema = z.object({
  date: finDateKey,
  amountPaise: paise.positive('Amount must be more than zero'),
  tdsPaise: paise.min(0).default(0),
  mode: z.enum(['BANK', 'CASH', 'UPI', 'CHEQUE']).default('BANK'),
  reference: optStr,
});
export const finCancelInvoiceSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) });

export type FinInvoiceRow = {
  id: string;
  number: string | null;
  projectId: string | null;
  label: string; // number or "Draft"
  clientId: string;
  clientName: string;
  projectName: string | null;
  period: string;
  periodLabel: string;
  hours: string;
  minutes: number;
  taxablePaise: number;
  gstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  balancePaise: number;
  status: FinInvoiceStatusKey;
  /** Display status incl. derived "Overdue". */
  displayStatus: string;
  overdue: boolean;
  invoiceDate: string | null;
  dueDate: string | null;
  supplyType: FinSupplyKind;
};
export type FinInvoiceDetail = FinInvoiceRow & {
  ratePaise: number;
  roundOffPaise: number;
  receivedPaise: number;
  tdsPaise: number;
  gstRateBp: number;
  gstLabel: string;
  placeOfSupply: string | null;
  taxOverrideReason: string | null;
  adjustmentNote: string | null;
  sourceMinutes: number;
  emailTo: string[];
  emailCc: string[];
  emailedAt: string | null;
  lastEmailError: string | null;
  paidAt: string | null;
  notes: string | null;
  cancelReason: string | null;
  buyer: { name: string; gstin: string | null; address: string | null; stateCode: string | null };
  lines: { id: string; description: string; sac: string; hours: string; ratePaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; lineTotalPaise: number }[];
  payments: { id: string; date: string; amountPaise: number; tdsPaise: number; mode: string; reference: string | null; voucherNumber: string | null }[];
  creditNotes: { id: string; number: string; date: string; totalPaise: number; reason: string }[];
  timeEntries: { employeeName: string; taskLabel: string; minutes: number; hours: string }[];
  timeline: { at: string; label: string }[];
  salesVoucher: { id: string; number: string } | null;
  hasPdf: boolean;
  filingDocumentId: string | null;
};
export type FinInvoiceList = Paginated<FinInvoiceRow> & { counts: Record<(typeof finInvoiceTabs)[number], number> };
export type FinInvoicePreview = {
  approvedMinutes: number;
  approvedHours: string;
  pendingMinutes: number;
  pendingTimesheets: number;
  cellCount: number;
  ratePaise: number;
  supplyType: FinSupplyKind;
  gstLabel: string;
  placeOfSupply: string;
  emailTo: string[];
  paymentTermsDays: number;
  tax: FinInvoiceTax;
  guidance: string | null;
};
export type FinInvoiceFormOptions = {
  sellerStateCode: string | null;
  clients: { id: string; name: string; stateCode: string | null; gstin: string | null; billingEmails: string[]; defaultRatePaise: number | null; paymentTermsDays: number }[];
  /** `unbilled`: months (newest first, last 6) with approved billable hours not yet on an invoice. */
  projects: { id: string; clientId: string; name: string; ratePaise: number | null; status: string; unbilled: { period: string; minutes: number }[] }[];
  periods: { value: string; label: string }[];
};
export const finCreateCategorySchema = z.object({
  name: z.string().trim().min(2, 'Category name is required').max(80),
  accountId: z.string().min(1, 'Pick the expense ledger'),
  defaultGstRateBp: z.number().int().min(0).max(2800).default(1800),
  itcEligibleDefault: z.boolean().default(true),
  createsAsset: z.boolean().default(false),
});
export const finUpdateCategorySchema = finCreateCategorySchema.partial().extend({ isActive: z.boolean().optional() });
export type FinLedgerOptions = {
  ledgers: { value: string; label: string; code: string; type: FinAccountTypeKey; systemKey: string | null }[];
  counters: { value: string; label: string; systemKey: string | null }[];
  canManage: boolean;
};
export type FinInvoiceKpis = { outstandingPaise: number; overduePaise: number; overdueCount: number; invoicedMonthPaise: number; invoicedMonthCount: number; monthLabel: string };

// ── Purchases ──────────────────────────────────────────────────────────────
export const finPurchaseTabs = ['purchases', 'gstr3b', 'vendors'] as const;
export const purchaseListQuery = paginationQuery.extend({
  month: finMonthKey.optional(),
  categoryId: z.string().optional(),
  vendorId: z.string().optional(),
  itc: z.enum(['all', 'eligible', 'ineligible']).optional(),
});
export const purchaseKpiQuery = z.object({ month: finMonthKey.optional() });
export const extractBillSchema = z.object({ fileId: z.string().min(1), categoryId: z.string().optional().nullable() });
export const createPurchaseSchema = z.object({
  vendorName: z.string().trim().min(2, 'Vendor is required').max(120),
  vendorGstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')
    .optional()
    .nullable()
    .or(z.literal('')),
  vendorInvoiceNo: z.string().trim().min(1, 'Invoice no. is required').max(40),
  billDate: finDateKey,
  amountPaise: paise.positive('Amount must be more than zero'),
  /** Null/undefined = auto (OCR value or amount × 18/118). */
  inputGstPaise: paise.min(0).optional().nullable(),
  gstSource: z.enum(['OCR', 'ESTIMATED', 'MANUAL']).optional().nullable(),
  ocrConfidence: z.number().min(0).max(1).optional().nullable(),
  categoryId: z.string().min(1, 'Category is required'),
  billFileId: z.string().min(1, 'Upload the bill'),
  paidVia: z.enum(['UNPAID', 'BANK', 'CASH']).default('BANK'),
  notes: optStr,
});
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export const cancelPurchaseSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const finCreateVendorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  gstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN').optional().nullable().or(z.literal('')),
  pan: z.string().trim().toUpperCase().optional().nullable(),
  stateCode: z.string().trim().regex(/^\d{2}$/).optional().nullable().or(z.literal('')),
  email: z.string().trim().email().optional().nullable().or(z.literal('')),
});
export const gstr3bQuery = z.object({ month: finMonthKey.optional() });

export type PurchaseRow = {
  id: string;
  billDate: string;
  vendorId: string;
  vendorName: string;
  vendorInvoiceNo: string;
  categoryId: string;
  category: string;
  amountPaise: number;
  taxablePaise: number;
  inputGstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  gstSource: 'OCR' | 'ESTIMATED' | 'MANUAL';
  itcEligible: boolean;
  paidVia: string;
  billFileId: string | null;
  status: string;
  voucherId: string | null;
  voucherNumber: string | null;
};
export type PurchaseDetail = PurchaseRow & {
  vendorGstin: string | null;
  vendorStateCode: string | null;
  gstRateBp: number;
  ocrConfidence: number | null;
  fy: string;
  itcPeriod: string;
  notes: string | null;
  createdAt: string;
  supplyType: FinSupplyKind;
  filingDocumentId: string | null;
};
export type PurchaseCategoryRow = { id: string; name: string; accountId: string; accountName: string; defaultGstRateBp: number; itcEligibleDefault: boolean; createsAsset: boolean; isActive: boolean; bills: number };
export type PurchaseKpis = { month: string; monthLabel: string; purchasesPaise: number; bills: number; itcClaimablePaise: number };
export type BillExtraction = {
  source: 'OCR' | 'ESTIMATED';
  confidence: number;
  vendorName: string | null;
  vendorId: string | null;
  vendorGstin: string | null;
  invoiceNo: string | null;
  billDate: string | null;
  amountPaise: number | null;
  inputGstPaise: number | null;
  duplicateOf: { id: string; vendorInvoiceNo: string } | null;
  textFound: boolean;
};
export type PurchaseFormOptions = {
  /** Tenant GST state (CGST+SGST vs IGST preview). */
  tenantStateCode: string | null;
  vendors: { id: string; name: string; gstin: string | null; stateCode: string | null }[];
  categories: { id: string; name: string; defaultGstRateBp: number; itcEligibleDefault: boolean; accountName: string }[];
};
export type FinVendorRow = { id: string; name: string; gstin: string | null; pan: string | null; stateCode: string | null; email: string | null; bills: number; spendPaise: number };
export type Gstr3bSummary = {
  month: string;
  monthLabel: string;
  outward: { taxablePaise: number; igstPaise: number; cgstPaise: number; sgstPaise: number; invoices: number; creditNotes: number };
  itc: { igstPaise: number; cgstPaise: number; sgstPaise: number; totalPaise: number; bills: number };
  ineligibleItcPaise: number;
  payable: { igstPaise: number; cgstPaise: number; sgstPaise: number; totalPaise: number };
  /** ITC utilisation (credit head → liability head). */
  utilisation: { from: 'IGST' | 'CGST' | 'SGST'; to: 'IGST' | 'CGST' | 'SGST'; amountPaise: number }[];
  carryForward: { igstPaise: number; cgstPaise: number; sgstPaise: number };
};

// ── Filing cabinet ─────────────────────────────────────────────────────────
export const finCreateFolderSchema = z.object({ name: z.string().trim().min(2, 'Folder name is required').max(80), parentId: z.string().optional().nullable() });
export const finUploadDocumentsSchema = z.object({
  folderId: z.string().min(1, 'Pick a folder'),
  fileIds: z.array(z.string().min(1)).min(1, 'Add at least one file').max(20),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(10).default([]),
  docDate: finDateKey.optional().nullable(),
});
export const finUpdateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(10).optional(),
  folderId: z.string().optional(),
});
export const filingDocsQuery = paginationQuery.extend({ tag: z.string().trim().optional(), fy: z.string().optional() });
export const finStatementQuery = z.object({ from: finDateKey.optional(), to: finDateKey.optional() });
export const finExportQuery = z.object({ kind: z.enum(['daybook', 'trial']).default('daybook'), from: finDateKey.optional(), to: finDateKey.optional() });

export type FilingFolderTile = { id: string; name: string; systemKey: string | null; isSystem: boolean; parentId: string | null; files: number };
export type FilingDocumentRow = {
  id: string;
  folderId: string;
  folderName: string;
  fileId: string;
  title: string;
  mime: string;
  sizeBytes: number;
  tags: string[];
  fy: string | null;
  docDate: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  linkedRef: string | null;
  locked: boolean;
};
export type FilingFolderDetail = {
  folder: FilingFolderTile;
  breadcrumb: { id: string; name: string }[];
  subfolders: FilingFolderTile[];
  documents: FilingDocumentRow[];
  total: number;
  page: number;
  pageSize: number;
  tags: string[];
  fys: string[];
};

// ── Compliance calendar & GST returns ──────────────────────────────────────
export const FIN_COMPLIANCE_FORMS = ['GSTR1', 'GSTR3B', 'TDS_DEPOSIT', 'PF_ECR', 'PT', 'TDS_RETURN', 'ADVANCE_TAX', 'TAX_AUDIT', 'ITR', 'GSTR9'] as const;
export type FinComplianceForm = (typeof FIN_COMPLIANCE_FORMS)[number];
export type FinComplianceItem = {
  key: string;
  form: FinComplianceForm;
  label: string;
  period: string;
  periodLabel: string;
  dueDate: string;
  status: 'FILED' | 'OVERDUE' | 'DUE_SOON' | 'UPCOMING';
  daysLeft: number;
  filedOn: string | null;
  ref: string | null;
};
export const finMarkFiledSchema = z.object({
  form: z.enum(FIN_COMPLIANCE_FORMS),
  period: z.string().trim().min(4).max(20),
  ref: z.string().trim().max(40).optional().nullable(),
  filedOn: finDateKey,
});
export type FinMarkFiledInput = z.infer<typeof finMarkFiledSchema>;
export type FinGstReturnStatus = { status: 'FILED' | 'OVERDUE' | 'DUE' | 'OPEN'; dueDate: string; filedOn: string | null; ref: string | null };
export type FinGstReturnRow = {
  period: string;
  periodLabel: string;
  taxablePaise: number;
  outputTaxPaise: number;
  itcPaise: number;
  netPayablePaise: number;
  invoices: number;
  bills: number;
  gstr1: FinGstReturnStatus;
  gstr3b: FinGstReturnStatus;
  workingDocumentId: string | null;
};
