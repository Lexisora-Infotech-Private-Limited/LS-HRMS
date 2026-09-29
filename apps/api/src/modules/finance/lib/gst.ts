/**
 * GST business rules (pure; unit-tested). Invoice tax math lives in @lexisora/shared so the
 * web form preview uses exactly the same numbers.
 */
import {
  finComputeInvoiceTax,
  finDeriveSupplyType,
  finEstimateInputGst,
  finSplitInputGst,
  type FinSupplyKind,
} from '@lexisora/shared';

export { finComputeInvoiceTax as computeInvoiceTax, finDeriveSupplyType as deriveSupplyType, finEstimateInputGst as estimateInputGst, finSplitInputGst as splitInputGst };
export type SupplyKind = FinSupplyKind;

/** State code of a GSTIN (first two digits) — fallback when a vendor has no state. */
export function stateFromGstin(gstin: string | null | undefined): string | null {
  return gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
}

export type PurchaseGstInput = {
  amountPaise: number;
  gstRateBp: number;
  /** Explicit value from OCR or a manual edit; null → estimated from the amount. */
  inputGstPaise?: number | null;
  source?: 'OCR' | 'ESTIMATED' | 'MANUAL' | null;
  vendorStateCode: string | null;
  vendorGstin: string | null;
  tenantStateCode: string | null;
  itcEligibleDefault: boolean;
};
export type PurchaseGst = {
  taxablePaise: number;
  inputGstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  source: 'OCR' | 'ESTIMATED' | 'MANUAL';
  itcEligible: boolean;
};

export class PurchaseGstError extends Error {}

/**
 * Input GST on a GST-inclusive bill:
 *  - explicit OCR/manual value, else amount × r / (100 + r) flagged "estimated";
 *  - split CGST/SGST when the vendor is in the tenant's state (else IGST);
 *  - GST can't exceed amount × 28/128 (highest slab).
 * ITC is eligible only when the category allows it (Sec 17(5) blocks e.g. staff welfare) and
 * the vendor is GST-registered (has a GSTIN).
 */
export function resolvePurchaseGst(i: PurchaseGstInput): PurchaseGst {
  const explicit = i.inputGstPaise !== null && i.inputGstPaise !== undefined;
  const gst = explicit ? Math.round(i.inputGstPaise!) : finEstimateInputGst(i.amountPaise, i.gstRateBp);
  const source: PurchaseGst['source'] = explicit ? (i.source === 'OCR' ? 'OCR' : 'MANUAL') : 'ESTIMATED';
  if (gst < 0) throw new PurchaseGstError('Input GST cannot be negative');
  if (gst > Math.floor((i.amountPaise * 28) / 128) + 1) throw new PurchaseGstError('Input GST is more than the highest GST slab allows for this amount');
  const vendorState = i.vendorStateCode || stateFromGstin(i.vendorGstin);
  const supply: SupplyKind = finDeriveSupplyType(i.tenantStateCode, vendorState);
  const split = finSplitInputGst(gst, supply);
  return { taxablePaise: i.amountPaise - gst, inputGstPaise: gst, ...split, source, itcEligible: i.itcEligibleDefault && !!i.vendorGstin?.trim() };
}

type Heads = { igst: number; cgst: number; sgst: number };

/**
 * GSTR-3B ITC utilisation (Sec 49/49A/49B order):
 *  IGST credit → IGST, then CGST, then SGST; CGST credit → CGST, then IGST;
 *  SGST credit → SGST, then IGST. CGST and SGST credits never cross.
 */
export function utiliseItc(liability: Heads, credit: Heads) {
  const L = { ...liability };
  const C = { ...credit };
  const steps: { from: 'IGST' | 'CGST' | 'SGST'; to: 'IGST' | 'CGST' | 'SGST'; amountPaise: number }[] = [];
  const use = (from: keyof Heads, to: keyof Heads) => {
    const amt = Math.min(C[from], L[to]);
    if (amt > 0) {
      C[from] -= amt;
      L[to] -= amt;
      steps.push({ from: from.toUpperCase() as 'IGST', to: to.toUpperCase() as 'IGST', amountPaise: amt });
    }
  };
  use('igst', 'igst');
  use('igst', 'cgst');
  use('igst', 'sgst');
  use('cgst', 'cgst');
  use('cgst', 'igst');
  use('sgst', 'sgst');
  use('sgst', 'igst');
  return { payable: L, carryForward: C, steps };
}

/** Payroll accrual (aggregated per run; never per employee). */
export type PayrollTotals = {
  grossPaise: number;
  netPaise: number;
  deductionsPaise: number;
  employerPfPaise?: number;
  employeePfPaise?: number;
  ptPaise?: number;
  tdsPaise?: number;
  employeeCount?: number;
};
export type PayrollPosting = { key: string; debitPaise: number; creditPaise: number; narration: string }[];

/**
 * Dr Salary expense (gross) + Dr Employer PF expense; Cr Salary payable (net), Cr PF payable
 * (employee + employer), Cr PT payable, Cr TDS payable. When the producer sends only a
 * deductions total, employee PF defaults to the employer share (12% both sides), PT to
 * ₹200 per head (Gujarat) and TDS takes the remainder.
 */
export function payrollPostingLines(t: PayrollTotals): PayrollPosting {
  const gross = Math.max(0, Math.round(t.grossPaise));
  const net = Math.max(0, Math.round(t.netPaise));
  const ded = Math.max(0, Math.round(t.deductionsPaise ?? gross - net));
  const erPf = Math.max(0, Math.round(t.employerPfPaise ?? 0));
  let empPf = t.employeePfPaise ?? Math.min(erPf, ded);
  let pt = t.ptPaise ?? Math.min(ded - empPf, (t.employeeCount ?? 0) * 20000);
  empPf = Math.max(0, Math.min(empPf, ded));
  pt = Math.max(0, Math.min(pt, ded - empPf));
  const tds = t.tdsPaise ?? ded - empPf - pt;
  const other = ded - empPf - pt - tds;
  const lines: PayrollPosting = [
    { key: 'SALARY_EXPENSE', debitPaise: gross, creditPaise: 0, narration: 'Gross salaries' },
    { key: 'EMPLOYER_PF_EXPENSE', debitPaise: erPf, creditPaise: 0, narration: 'Employer PF contribution' },
    { key: 'SALARY_PAYABLE', debitPaise: 0, creditPaise: net, narration: 'Net pay' },
    { key: 'PF_PAYABLE', debitPaise: 0, creditPaise: empPf + erPf, narration: 'PF (employee + employer)' },
    { key: 'PT_PAYABLE', debitPaise: 0, creditPaise: pt, narration: 'Professional tax' },
    { key: 'TDS_PAYABLE', debitPaise: 0, creditPaise: Math.max(0, tds) + Math.max(0, other), narration: 'TDS on salary (192)' },
  ];
  // Rounding / inconsistent producer totals: keep the voucher balanced on salary payable.
  const diff = lines.reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
  if (diff !== 0) lines[2]!.creditPaise += diff;
  return lines.filter((l) => l.debitPaise > 0 || l.creditPaise > 0);
}
