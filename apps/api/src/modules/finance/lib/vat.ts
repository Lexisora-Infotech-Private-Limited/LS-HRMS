/**
 * UK VAT and UK payroll-journal rules (pure; unit-tested). Used only for region GB tenants —
 * India keeps lib/gst.ts unchanged. Invoice VAT maths lives in @lexisora/shared
 * (contracts/uk-finance.ts) so the web form preview uses the same numbers.
 *
 * Column reuse: the single VAT amount is stored in the IGST column (CGST/SGST = 0), the rate
 * in `gstRateBp`, VAT numbers in the `gstin` columns, and "VAT reclaimable" in `itcEligible`.
 */
import {
  isValidUkVatNumber,
  ukComputeInvoiceVat,
  ukDeriveVatTreatment,
  ukEstimateInputVat,
  ukVatDueDate,
  ukVatFromTaxable,
  ukVatQuarterOf,
  ukVatReturnBoxes,
  UK_VAT_STANDARD_BP,
  type UkStatutory,
  type UkVatBoxes,
} from '@lexisora/shared';
import type { PayrollPosting } from './gst';

export { isValidUkVatNumber, ukComputeInvoiceVat, ukDeriveVatTreatment, ukEstimateInputVat, ukVatDueDate, ukVatFromTaxable, ukVatQuarterOf, ukVatReturnBoxes };

// ── Purchases: input VAT ─────────────────────────────────────────────────────────────

export type PurchaseVatInput = {
  amountPaise: number;
  vatRateBp: number;
  /** Explicit value from OCR or a manual edit; null → estimated from the gross amount. */
  inputVatPaise?: number | null;
  source?: 'OCR' | 'ESTIMATED' | 'MANUAL' | null;
  vendorVatNumber: string | null;
  /** Category default (false for business entertainment, which is never reclaimable). */
  reclaimableDefault: boolean;
};
export type PurchaseVat = {
  taxablePaise: number;
  inputGstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  source: 'OCR' | 'ESTIMATED' | 'MANUAL';
  /** VAT can be reclaimed (stored in Purchase.itcEligible). */
  itcEligible: boolean;
};

export class PurchaseVatError extends Error {}

/**
 * Input VAT on a VAT-inclusive bill:
 *  - explicit OCR/manual value, else gross × r / (100% + r) flagged "estimated";
 *  - one VAT amount (IGST column), never split;
 *  - VAT can't exceed gross × 20/120 (standard rate is the highest UK rate);
 *  - reclaimable only when the category allows it and the supplier gave a VAT number.
 */
export function resolvePurchaseVat(i: PurchaseVatInput): PurchaseVat {
  const explicit = i.inputVatPaise !== null && i.inputVatPaise !== undefined;
  const vat = explicit ? Math.round(i.inputVatPaise!) : ukEstimateInputVat(i.amountPaise, i.vatRateBp);
  const source: PurchaseVat['source'] = explicit ? (i.source === 'OCR' ? 'OCR' : 'MANUAL') : 'ESTIMATED';
  if (vat < 0) throw new PurchaseVatError('Input VAT cannot be negative');
  if (vat > Math.floor((i.amountPaise * UK_VAT_STANDARD_BP) / (10000 + UK_VAT_STANDARD_BP)) + 1) throw new PurchaseVatError('Input VAT is more than 20% VAT allows for this amount');
  const hasVatNo = !!i.vendorVatNumber?.trim();
  return { taxablePaise: i.amountPaise - vat, inputGstPaise: vat, cgstPaise: 0, sgstPaise: 0, igstPaise: vat, source, itcEligible: i.reclaimableDefault && hasVatNo && vat > 0 };
}

// ── VAT return ───────────────────────────────────────────────────────────────────────

/**
 * Boxes for one VAT quarter from ledger-side totals:
 *  Box 1 = VAT on invoices − VAT on credit notes; Box 4 = reclaimable input VAT;
 *  Box 6 = net sales (all rates, incl. zero-rated, exempt and outside-scope services) less credit notes;
 *  Box 7 = net purchases (bill amount less VAT, reclaimable or not).
 */
export function ukVatReturnFromTotals(t: { invoiceNetPence: number; invoiceVatPence: number; creditNetPence: number; creditVatPence: number; billNetPence: number; reclaimableVatPence: number }): { boxes: UkVatBoxes; netPence: number } {
  const boxes = ukVatReturnBoxes({
    outputVatPence: t.invoiceVatPence - t.creditVatPence,
    salesNetPence: t.invoiceNetPence - t.creditNetPence,
    inputVatPence: t.reclaimableVatPence,
    purchasesNetPence: t.billNetPence,
  });
  return { boxes, netPence: boxes.box3 - boxes.box4 };
}

// ── Payroll journal (payroll.finalized) ─────────────────────────────────────────────

export type UkPayrollTotals = {
  grossPence: number;
  netPence: number;
  taxPence: number;
  niEmployeePence: number;
  niEmployerPence: number;
  pensionEmployeePence: number;
  pensionEmployerPence: number;
  studentLoanPence: number;
  postgradLoanPence: number;
  employeeCount: number;
};

/** One payroll item of a UK run (PayrollItem columns + ukStatutory). */
export type UkPayrollItemInput = { totalEarningsPaise: number; netPaise: number; tdsPaise: number; ukStatutory: unknown };

/**
 * Sum a run's items. `ukStatutory` (written by the UK payroll engine) gives tax, NI, pension
 * and loans; an item without it falls back to PAYE = `tdsPaise`. Gross is the item's
 * total earnings (the engine's gross pay when earnings are missing).
 */
export function aggregateUkPayroll(items: UkPayrollItemInput[]): UkPayrollTotals {
  const t: UkPayrollTotals = { grossPence: 0, netPence: 0, taxPence: 0, niEmployeePence: 0, niEmployerPence: 0, pensionEmployeePence: 0, pensionEmployerPence: 0, studentLoanPence: 0, postgradLoanPence: 0, employeeCount: items.length };
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);
  for (const it of items) {
    const uk = (it.ukStatutory && typeof it.ukStatutory === 'object' ? it.ukStatutory : null) as Partial<UkStatutory> | null;
    t.grossPence += n(it.totalEarningsPaise) || n(uk?.grossPayPence);
    t.netPence += n(it.netPaise);
    if (uk) {
      t.taxPence += n(uk.taxPence);
      t.niEmployeePence += n(uk.niEmployeePence);
      t.niEmployerPence += n(uk.niEmployerPence);
      t.pensionEmployeePence += n(uk.pensionEmployeePence);
      t.pensionEmployerPence += n(uk.pensionEmployerPence);
      t.studentLoanPence += n(uk.studentLoanPence);
      t.postgradLoanPence += n(uk.postgradLoanPence);
    } else {
      t.taxPence += n(it.tdsPaise);
    }
  }
  return t;
}

/**
 * Aggregated UK payroll accrual (never per employee):
 *  Dr Wages & salaries (gross), Dr Employer's NI, Dr Employer pension contributions;
 *  Cr PAYE/NI payable to HMRC (PAYE + employee NI + employer NI + student & postgraduate loans),
 *  Cr Pension contributions payable (employee + employer), Cr Net wages payable (net pay).
 * Any other deductions or rounding difference lands on net wages payable so the voucher balances.
 */
export function ukPayrollPostingLines(t: UkPayrollTotals): PayrollPosting {
  const r = (x: number) => Math.max(0, Math.round(x));
  const gross = r(t.grossPence);
  const erNi = r(t.niEmployerPence);
  const erPension = r(t.pensionEmployerPence);
  const hmrc = r(t.taxPence) + r(t.niEmployeePence) + erNi + r(t.studentLoanPence) + r(t.postgradLoanPence);
  const pension = r(t.pensionEmployeePence) + erPension;
  const lines: PayrollPosting = [
    { key: 'SALARY_EXPENSE', debitPaise: gross, creditPaise: 0, narration: 'Gross wages & salaries' },
    { key: 'EMPLOYER_NI_EXPENSE', debitPaise: erNi, creditPaise: 0, narration: "Employer's National Insurance" },
    { key: 'EMPLOYER_PENSION_EXPENSE', debitPaise: erPension, creditPaise: 0, narration: 'Employer pension contributions' },
    { key: 'PAYE_NI_PAYABLE', debitPaise: 0, creditPaise: hmrc, narration: 'PAYE, NI and student loans due to HMRC' },
    { key: 'PENSION_PAYABLE', debitPaise: 0, creditPaise: pension, narration: 'Pension contributions (employee + employer)' },
    { key: 'SALARY_PAYABLE', debitPaise: 0, creditPaise: r(t.netPence), narration: 'Net wages' },
  ];
  const diff = lines.reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
  const net = lines[5]!;
  if (diff > 0) net.creditPaise += diff;
  else if (diff < 0) {
    // Credits exceed debits (producer gross lower than its parts): absorb on net wages first,
    // then raise the wages expense so the journal still balances.
    const take = Math.min(net.creditPaise, -diff);
    net.creditPaise -= take;
    lines[0]!.debitPaise += -diff - take;
  }
  return lines.filter((l) => l.debitPaise > 0 || l.creditPaise > 0);
}
