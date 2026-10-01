import type {
  AccountStatement,
  BillExtraction,
  CreatePurchaseInput,
  CreateVoucherInput,
  FilingDocumentRow,
  FilingFolderDetail,
  FilingFolderTile,
  FinAccountRow,
  FinComplianceItem,
  FinCreateInvoiceInput,
  FinGstReturnRow,
  FinInvoiceDetail,
  FinInvoiceFormOptions,
  FinInvoiceKpis,
  FinInvoiceList,
  FinInvoicePreview,
  FinLedgerOptions,
  FinMarkFiledInput,
  FinVendorRow,
  Gstr3bSummary,
  LedgerKpis,
  LedgerLineRow,
  Paginated,
  PurchaseCategoryRow,
  PurchaseDetail,
  PurchaseFormOptions,
  PurchaseKpis,
  PurchaseRow,
  TrialBalance,
  VoucherDetail,
  VoucherRow,
} from '@lexisora/shared';
import { authUrl, del, download, get, patch, post, put } from '@/lib/api';

/** Finance API (docs/specs/spec-workfin.md Modules G–J). */

type Q = Record<string, unknown>;

export const finKeys = {
  all: ['finance'] as const,
  ledgerKpis: (month?: string) => ['finance', 'ledger', 'kpis', month ?? ''] as const,
  vouchers: (q: Q) => ['finance', 'ledger', 'vouchers', q] as const,
  voucher: (id: string) => ['finance', 'ledger', 'voucher', id] as const,
  ledgerOptions: ['finance', 'ledger', 'options'] as const,
  trial: (from?: string, to?: string) => ['finance', 'ledger', 'trial', from ?? '', to ?? ''] as const,
  accounts: ['finance', 'ledger', 'accounts'] as const,
  statement: (id: string, from?: string, to?: string) => ['finance', 'ledger', 'statement', id, from ?? '', to ?? ''] as const,
  ledgerSettings: ['finance', 'ledger', 'settings'] as const,
  invoices: (q: Q) => ['finance', 'invoices', 'list', q] as const,
  invoiceKpis: ['finance', 'invoices', 'kpis'] as const,
  invoice: (id: string) => ['finance', 'invoices', 'detail', id] as const,
  invoiceOptions: ['finance', 'invoices', 'options'] as const,
  invoicePreview: (q: Q) => ['finance', 'invoices', 'preview', q] as const,
  purchases: (q: Q) => ['finance', 'purchases', 'list', q] as const,
  purchaseKpis: (month?: string) => ['finance', 'purchases', 'kpis', month ?? ''] as const,
  purchase: (id: string) => ['finance', 'purchases', 'detail', id] as const,
  purchaseOptions: ['finance', 'purchases', 'options'] as const,
  categories: ['finance', 'purchases', 'categories'] as const,
  vendors: ['finance', 'purchases', 'vendors'] as const,
  gstr3b: (month?: string) => ['finance', 'purchases', 'gstr3b', month ?? ''] as const,
  folders: ['finance', 'filing', 'folders'] as const,
  folder: (id: string, q: Q) => ['finance', 'filing', 'folder', id, q] as const,
  docSearch: (q: Q) => ['finance', 'filing', 'search', q] as const,
  compliance: ['finance', 'filing', 'compliance'] as const,
  gstReturns: ['finance', 'filing', 'gst-returns'] as const,
};

/** Invalidate everything finance after a posting (ledger, invoices, purchases and filing are linked). */
export const FIN_ALL = [finKeys.all];

export const finApi = {
  // Ledger
  ledgerKpis: (month?: string) => get<LedgerKpis>('/ledger/kpis', { month }),
  vouchers: (q: Q) => get<Paginated<VoucherRow | LedgerLineRow>>('/ledger/vouchers', q),
  voucher: (id: string) => get<VoucherDetail>(`/vouchers/${id}`),
  createVoucher: (body: CreateVoucherInput) => post<{ id: string; number: string }>('/vouchers', body),
  reverseVoucher: (id: string, reason: string) => post<{ id: string; number: string }>(`/vouchers/${id}/reverse`, { reason }),
  ledgerOptions: () => get<FinLedgerOptions>('/ledger/options'),
  trialBalance: (from?: string, to?: string) => get<TrialBalance>('/ledger/trial-balance', { from, to }),
  exportLedger: (kind: 'daybook' | 'trial', from?: string, to?: string) => download(`/ledger/export?kind=${kind}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`),
  lockBooks: (upTo: string) => post<{ booksLockedUpTo: string; draftInvoicesInPeriod: number }>('/ledger/lock', { upTo }),
  ledgerSettings: () => get<{ booksLockedUpTo: string | null; defaultPaymentTermsDays: number; bank: Record<string, string>; signatory: string }>('/ledger/settings'),
  accounts: () => get<FinAccountRow[]>('/accounts'),
  createAccount: (body: { code: string; name: string; type: string; parentId?: string | null; openingPaise?: number }) => post('/accounts', body),
  updateAccount: (id: string, body: { name?: string; isActive?: boolean }) => patch(`/accounts/${id}`, body),
  statement: (id: string, from?: string, to?: string) => get<AccountStatement>(`/accounts/${id}/statement`, { from, to }),

  // Invoices
  invoices: (q: Q) => get<FinInvoiceList>('/invoices', q),
  invoiceKpis: () => get<FinInvoiceKpis>('/invoices/kpis'),
  invoiceOptions: () => get<FinInvoiceFormOptions>('/invoices/options'),
  invoicePreview: (q: { clientId: string; projectId: string; period: string; excludeInvoiceId?: string }) => get<FinInvoicePreview>('/invoices/preview', q),
  invoice: (id: string) => get<FinInvoiceDetail>(`/invoices/${id}`),
  createInvoice: (body: FinCreateInvoiceInput) => post<FinInvoiceDetail>('/invoices', body),
  updateInvoice: (id: string, body: Omit<FinCreateInvoiceInput, 'action'>) => put<FinInvoiceDetail>(`/invoices/${id}`, body),
  deleteInvoice: (id: string) => del(`/invoices/${id}`),
  issueInvoice: (id: string) => post<FinInvoiceDetail>(`/invoices/${id}/issue`),
  emailInvoice: (id: string, body: { to: string[]; cc: string[]; message?: string | null }) => post<FinInvoiceDetail>(`/invoices/${id}/email`, body),
  recordPayment: (id: string, body: { date: string; amountPaise: number; tdsPaise: number; mode: string; reference?: string | null }) => post<FinInvoiceDetail>(`/invoices/${id}/payments`, body),
  reversePayment: (id: string, paymentId: string) => del<FinInvoiceDetail>(`/invoices/${id}/payments/${paymentId}`),
  cancelInvoice: (id: string, reason: string) => post<FinInvoiceDetail>(`/invoices/${id}/cancel`, { reason }),
  invoicePdfUrl: (id: string) => authUrl(`/invoices/${id}/pdf?inline=1`),
  downloadInvoicePdf: (id: string) => download(`/invoices/${id}/pdf`),
  downloadCreditNote: (id: string, cnId: string) => download(`/invoices/${id}/credit-notes/${cnId}/pdf`),

  // Purchases
  purchases: (q: Q) => get<Paginated<PurchaseRow>>('/purchases', q),
  purchaseKpis: (month?: string) => get<PurchaseKpis>('/purchases/kpis', { month }),
  purchaseOptions: () => get<PurchaseFormOptions>('/purchases/options'),
  purchase: (id: string) => get<PurchaseDetail>(`/purchases/${id}`),
  extractBill: (fileId: string, categoryId?: string | null) => post<BillExtraction>('/purchases/extract', { fileId, categoryId }),
  createPurchase: (body: CreatePurchaseInput) => post<PurchaseDetail>('/purchases', body),
  cancelPurchase: (id: string, reason: string) => post<PurchaseDetail>(`/purchases/${id}/cancel`, { reason }),
  categories: () => get<PurchaseCategoryRow[]>('/purchases/categories'),
  createCategory: (body: Record<string, unknown>) => post('/purchases/categories', body),
  updateCategory: (id: string, body: Record<string, unknown>) => patch(`/purchases/categories/${id}`, body),
  vendors: () => get<FinVendorRow[]>('/vendors'),
  createVendor: (body: Record<string, unknown>) => post('/vendors', body),
  updateVendor: (id: string, body: Record<string, unknown>) => patch(`/vendors/${id}`, body),
  gstr3b: (month?: string) => get<Gstr3bSummary>('/purchases/gstr3b', { month }),
  gstr3bCsv: (month: string) => download(`/purchases/gstr3b/csv?month=${month}`),
  fileGstr3b: (month: string) => post<{ documentId: string; folderId: string; title: string; payable: string }>('/purchases/gstr3b/file', { month }),

  // Filing
  folders: () => get<{ folders: FilingFolderTile[]; all: FilingFolderTile[] }>('/filing/folders'),
  folder: (id: string, q: Q) => get<FilingFolderDetail>(`/filing/folders/${id}`, q),
  createFolder: (name: string, parentId?: string | null) => post<{ id: string }>('/filing/folders', { name, parentId }),
  deleteFolder: (id: string) => del(`/filing/folders/${id}`),
  searchDocs: (q: Q) => get<Paginated<FilingDocumentRow>>('/filing/documents', q),
  uploadDocs: (body: { folderId: string; fileIds: string[]; tags: string[]; docDate?: string | null }) => post<{ count: number; ids: string[] }>('/filing/documents', body),
  updateDoc: (id: string, body: { title?: string; tags?: string[]; folderId?: string }) => patch(`/filing/documents/${id}`, body),
  deleteDoc: (id: string) => del(`/filing/documents/${id}`),
  docUrl: (id: string) => authUrl(`/filing/documents/${id}/download?inline=1`),
  downloadDoc: (id: string) => download(`/filing/documents/${id}/download`),
  compliance: () => get<FinComplianceItem[]>('/filing/compliance'),
  markFiled: (body: FinMarkFiledInput) => post('/filing/compliance/filed', body),
  unmarkFiled: (form: string, period: string) => post('/filing/compliance/unfiled', { form, period }),
  gstReturns: () => get<FinGstReturnRow[]>('/filing/gst-returns'),
};

/** Rupee text → paise (accepts "1,42,000", "₹ 8,460.50"). Returns NaN for junk. */
export function rupeesToPaise(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(String(v).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
/** Paise → editable rupee text ("8460" / "8460.5"). */
export const paiseToRupeesText = (p: number | null | undefined) => (p === null || p === undefined ? '' : String(+(p / 100).toFixed(2)));

/** "2026-09-29" in IST. */
export function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export const monthKeyNow = () => todayKey().slice(0, 7);
/** Newest-first month keys: ("2026-09", 6) → 2026-09 … 2026-04. */
export function lastMonths(from: string, n: number): string[] {
  const [y, m] = from.split('-').map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
}
/** First day of the Indian FY containing `key`. */
export function fyStartKey(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
