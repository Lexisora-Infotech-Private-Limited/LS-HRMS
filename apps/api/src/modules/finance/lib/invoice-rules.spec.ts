import { describe, expect, it } from 'vitest';
import { invoiceActions, invoiceDisplayStatus, InvoiceRuleError, isInvoiceOverdue, paymentOutcome } from './invoice-rules';
import { amountInWords, dateOnly, fyOf, fyStart, monthRange, recentMonths, voucherSequence, INVOICE_SEQUENCE, CREDIT_NOTE_SEQUENCE } from './money';

const today = dateOnly('2026-09-29');

describe('Invoice payments', () => {
  it('full payment net of TDS settles the invoice (INV-0412: ₹4,64,000 + ₹8,000 TDS)', () => {
    expect(paymentOutcome(47_200_000, 47_200_000, 46_400_000, 800_000)).toEqual({ balancePaise: 0, status: 'PAID', settledPaise: 47_200_000 });
  });
  it('a part payment leaves a balance', () => {
    expect(paymentOutcome(53_100_000, 53_100_000, 25_000_000)).toEqual({ balancePaise: 28_100_000, status: 'PARTIALLY_PAID', settledPaise: 25_000_000 });
  });
  it('rejects overpayment, zero and negative TDS', () => {
    expect(() => paymentOutcome(1_000, 500, 501)).toThrow(InvoiceRuleError);
    expect(() => paymentOutcome(1_000, 500, 400, 101)).toThrow(/more than the balance/);
    expect(() => paymentOutcome(1_000, 1_000, 0)).toThrow(InvoiceRuleError);
    expect(() => paymentOutcome(1_000, 1_000, 100, -1)).toThrow(InvoiceRuleError);
  });
});

describe('Invoice status', () => {
  it('overdue is derived from the due date while the invoice is open', () => {
    expect(isInvoiceOverdue({ status: 'EMAILED', dueDate: dateOnly('2026-09-28') }, today)).toBe(true);
    expect(isInvoiceOverdue({ status: 'PARTIALLY_PAID', dueDate: dateOnly('2026-09-01') }, today)).toBe(true);
    expect(isInvoiceOverdue({ status: 'EMAILED', dueDate: dateOnly('2026-09-29') }, today)).toBe(false); // due today
    expect(isInvoiceOverdue({ status: 'PAID', dueDate: dateOnly('2026-09-01') }, today)).toBe(false);
    expect(isInvoiceOverdue({ status: 'DRAFT', dueDate: null }, today)).toBe(false);
  });
  it('labels: Draft / Emailed / Paid, Overdue wins while open', () => {
    expect(invoiceDisplayStatus('DRAFT', false)).toBe('Draft');
    expect(invoiceDisplayStatus('EMAILED', false)).toBe('Emailed');
    expect(invoiceDisplayStatus('PAID', false)).toBe('Paid');
    expect(invoiceDisplayStatus('EMAILED', true)).toBe('Overdue');
  });
  it('drafts are editable; issued invoices are immutable (credit note instead)', () => {
    expect(invoiceActions('DRAFT', false)).toEqual({ edit: true, delete: true, issue: true, email: false, pay: false, cancel: false });
    expect(invoiceActions('EMAILED', false)).toMatchObject({ edit: false, delete: false, issue: false, email: true, pay: true, cancel: true });
    expect(invoiceActions('PARTIALLY_PAID', true).cancel).toBe(false); // reverse payments first
    expect(invoiceActions('PAID', true)).toMatchObject({ pay: false, email: true, cancel: false });
  });
});

describe('Document numbering', () => {
  it('voucher series per type (RCPT- / PMT- / JV- / HRV- / SV- / PV-), payroll accruals are journals', () => {
    expect(voucherSequence('RECEIPT')).toEqual({ key: 'voucher.rcpt', prefix: 'RCPT-', pad: 3 });
    expect(voucherSequence('PAYMENT').prefix).toBe('PMT-');
    expect(voucherSequence('JOURNAL').prefix).toBe('JV-');
    expect(voucherSequence('PAYROLL')).toEqual(voucherSequence('JOURNAL'));
    expect(voucherSequence('HR').prefix).toBe('HRV-');
    expect(voucherSequence('SALES').prefix).toBe('SV-');
    expect(voucherSequence('PURCHASE').prefix).toBe('PV-');
    expect(voucherSequence('CREDIT_NOTE')).toEqual({ key: 'voucher.cn', prefix: 'CN-', pad: 4 });
  });
  it('invoices are one continuous INV-0000 series; credit notes CN-0000', () => {
    expect(INVOICE_SEQUENCE).toEqual({ key: 'invoice.gst', prefix: 'INV-', pad: 4 });
    expect(CREDIT_NOTE_SEQUENCE.prefix).toBe('CN-');
  });
  it('voucher numbers reset per Indian financial year (April–March)', () => {
    expect(fyOf(dateOnly('2026-09-29'))).toBe('2026-27');
    expect(fyOf(dateOnly('2026-04-01'))).toBe('2026-27');
    expect(fyOf(dateOnly('2026-03-31'))).toBe('2025-26');
    expect(fyOf(dateOnly('2099-12-31'))).toBe('2099-00');
    expect(fyStart(dateOnly('2027-02-10')).toISOString().slice(0, 10)).toBe('2026-04-01');
  });
});

describe('Dates and words', () => {
  it('month ranges and recent months', () => {
    const r = monthRange('2026-09');
    expect([r.start.toISOString().slice(0, 10), r.end.toISOString().slice(0, 10)]).toEqual(['2026-09-01', '2026-09-30']);
    expect(monthRange('2028-02').end.toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(recentMonths('2026-02', 3)).toEqual(['2026-02', '2026-01', '2025-12']);
  });
  it('total in words (Indian numbering) for the invoice PDF', () => {
    expect(amountInWords(47_200_000)).toBe('Rupees Four Lakh Seventy-Two Thousand Only');
    expect(amountInWords(27_435_050)).toBe('Rupees Two Lakh Seventy-Four Thousand Three Hundred Fifty and Fifty Paise Only');
    expect(amountInWords(1_234_567_891)).toBe('Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Ninety-One Paise Only');
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });
});
