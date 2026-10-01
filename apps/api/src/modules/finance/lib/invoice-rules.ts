/**
 * Invoice state rules (pure; unit-tested): which statuses are open, derived "Overdue",
 * display labels and the effect of a payment on the balance.
 */
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'EMAILED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

/** Issued and awaiting (part) payment. */
export const OPEN_INVOICE_STATUSES = ['ISSUED', 'EMAILED', 'PARTIALLY_PAID'] as const;

export class InvoiceRuleError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const inr = (paise: number) => `₹ ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(paise / 100)}`;

/** Overdue is derived: due date before today while the invoice is still open. */
export function isInvoiceOverdue(inv: { status: string; dueDate: Date | null }, today: Date): boolean {
  return !!inv.dueDate && (OPEN_INVOICE_STATUSES as readonly string[]).includes(inv.status) && inv.dueDate.getTime() < today.getTime();
}

const LABEL: Record<InvoiceStatus, string> = { DRAFT: 'Draft', ISSUED: 'Issued', EMAILED: 'Emailed', PARTIALLY_PAID: 'Partially paid', PAID: 'Paid', CANCELLED: 'Cancelled' };
export function invoiceDisplayStatus(status: InvoiceStatus, overdue: boolean): string {
  return overdue ? 'Overdue' : LABEL[status];
}

/**
 * settled = received + TDS deducted by the client; balance = total − Σ settled.
 * Balance 0 → PAID; otherwise PARTIALLY_PAID. Overpayment is rejected (advances are P3).
 */
export function paymentOutcome(totalPaise: number, balancePaise: number, amountPaise: number, tdsPaise = 0): { balancePaise: number; status: 'PAID' | 'PARTIALLY_PAID'; settledPaise: number } {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new InvoiceRuleError('AMOUNT', 'Amount must be more than zero');
  if (!Number.isInteger(tdsPaise) || tdsPaise < 0) throw new InvoiceRuleError('TDS', 'TDS cannot be negative');
  const settled = amountPaise + tdsPaise;
  if (settled > balancePaise) throw new InvoiceRuleError('OVERPAYMENT', `Payment is more than the balance due (${inr(balancePaise)})`);
  const balance = balancePaise - settled;
  return { balancePaise: balance, status: balance === 0 ? 'PAID' : 'PARTIALLY_PAID', settledPaise: settled };
}

/** Allowed user actions per status (drives buttons and API guards). */
export function invoiceActions(status: InvoiceStatus, hasPayments: boolean): { edit: boolean; delete: boolean; issue: boolean; email: boolean; pay: boolean; cancel: boolean } {
  const open = (OPEN_INVOICE_STATUSES as readonly string[]).includes(status);
  return {
    edit: status === 'DRAFT',
    delete: status === 'DRAFT',
    issue: status === 'DRAFT',
    email: open || status === 'PAID',
    pay: open,
    cancel: open && !hasPayments,
  };
}
