/**
 * Pure helpers for finance: dates (IST business days), financial years, INR words,
 * voucher numbering and PDF-safe money formatting.
 */
import { istDateKey } from '@lexisora/shared';

/** "2026-09-29" → Date at UTC midnight (how @db.Date columns are stored). */
export function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}
/** Today's IST business day as a @db.Date value. */
export function todayDate(now: Date = new Date()): Date {
  return dateOnly(istDateKey(now));
}
export function dateKeyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
/** "2026-09" → [1 Sep, 30 Sep] as @db.Date values. */
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start, end };
}
export function monthKeyOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}
export function currentMonthKey(now: Date = new Date()): string {
  return istDateKey(now).slice(0, 7);
}
/** Previous months, newest first: ("2026-09", 3) → ["2026-09","2026-08","2026-07"]. */
export function recentMonths(fromMonth: string, count: number): string[] {
  const [y, m] = fromMonth.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** Indian FY label for a @db.Date (UTC-midnight) value: 29 Sep 2026 → "2026-27". */
export function fyOf(d: Date): string {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
/** First day of the FY containing `d`. */
export function fyStart(d: Date): Date {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return new Date(Date.UTC(y, 3, 1));
}

// ── Voucher numbering ───────────────────────────────────────────────────────
export type VoucherKind = 'PAYMENT' | 'RECEIPT' | 'JOURNAL' | 'HR' | 'SALES' | 'PURCHASE' | 'CREDIT_NOTE' | 'PAYROLL';
const PREFIX: Record<VoucherKind, string> = {
  PAYMENT: 'PMT',
  RECEIPT: 'RCPT',
  JOURNAL: 'JV',
  PAYROLL: 'JV',
  HR: 'HRV',
  SALES: 'SV',
  PURCHASE: 'PV',
  CREDIT_NOTE: 'CN',
};
export function voucherPrefix(type: VoucherKind): string {
  return PREFIX[type];
}
/** Sequence key + formatting for a voucher number (sequence resets per financial year). */
export function voucherSequence(type: VoucherKind): { key: string; prefix: string; pad: number } {
  const p = PREFIX[type];
  return { key: `voucher.${p.toLowerCase()}`, prefix: `${p}-`, pad: p === 'CN' ? 4 : 3 };
}
export function formatDocNumber(prefix: string, n: number, pad: number): string {
  return `${prefix}${String(n).padStart(pad, '0')}`;
}
export const INVOICE_SEQUENCE = { key: 'invoice.gst', prefix: 'INV-', pad: 4 } as const;
export const CREDIT_NOTE_SEQUENCE = { key: 'invoice.credit_note', prefix: 'CN-', pad: 4 } as const;

// ── Amounts ─────────────────────────────────────────────────────────────────
/** PDF-safe INR (Helvetica has no ₹ glyph): "Rs. 4,72,000.00". */
export function pdfINR(paise: number, decimals = true): string {
  const r = paise / 100;
  const s = new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 }).format(Math.abs(r));
  return `${r < 0 ? '-' : ''}Rs. ${s}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  const o = n % 10;
  return o ? `${t}-${ONES[o]}` : t;
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/** Indian numbering in words: 4,72,000 → "Four Lakh Seventy-Two Thousand". */
export function integerInWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${crore >= 100 ? integerInWords(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(' ');
}

/** "Rupees Four Lakh Seventy-Two Thousand Only" (paise appended when non-zero). */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  return `Rupees ${integerInWords(rupees)}${p ? ` and ${twoDigits(p)} Paise` : ''} Only`;
}
