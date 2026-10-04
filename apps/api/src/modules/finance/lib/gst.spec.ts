import { describe, expect, it } from 'vitest';
import { finGstLabel, finRoundHalfUp, finTaxFromTaxable } from '@lexisora/shared';
import { computeInvoiceTax, deriveSupplyType, estimateInputGst, gstinCheckChar, isValidGstin, payrollPostingLines, PurchaseGstError, resolvePurchaseGst, splitInputGst, stateFromGstin, utiliseItc } from './gst';
import { validateVoucherLines } from './ledger-math';

const TENANT_STATE = '24'; // Gujarat (Lexisora, Ahmedabad)

describe('GST supply type (place of supply)', () => {
  it('same state → intra-state (CGST + SGST)', () => {
    expect(deriveSupplyType(TENANT_STATE, '24')).toBe('INTRA');
  });
  it('different state → inter-state (IGST)', () => {
    expect(deriveSupplyType(TENANT_STATE, '27')).toBe('INTER');
    expect(deriveSupplyType(TENANT_STATE, '29')).toBe('INTER');
  });
  it('unknown buyer or seller state → IGST (never guesses intra-state)', () => {
    expect(deriveSupplyType(TENANT_STATE, null)).toBe('INTER');
    expect(deriveSupplyType(null, '24')).toBe('INTER');
  });
  it('labels the split for the form', () => {
    expect(finGstLabel('INTRA')).toBe('9% CGST + 9% SGST');
    expect(finGstLabel('INTER')).toBe('18% IGST');
  });
});

describe('Invoice tax: GST split', () => {
  it('INV-0412 Nimbus Retail 320 h × ₹1,250, intra-state → ₹4,00,000 + ₹36,000 + ₹36,000 = ₹4,72,000', () => {
    const t = computeInvoiceTax({ minutes: 320 * 60, ratePaise: 125000, supply: 'INTRA' });
    expect(t).toEqual({ taxablePaise: 40_000_000, cgstPaise: 3_600_000, sgstPaise: 3_600_000, igstPaise: 0, taxPaise: 7_200_000, roundOffPaise: 0, totalPaise: 47_200_000 });
  });
  it('the same invoice inter-state → IGST ₹72,000 and no CGST/SGST', () => {
    const t = computeInvoiceTax({ minutes: 320 * 60, ratePaise: 125000, supply: 'INTER' });
    expect(t.igstPaise).toBe(7_200_000);
    expect(t.cgstPaise + t.sgstPaise).toBe(0);
    expect(t.totalPaise).toBe(47_200_000);
  });
  it('INV-0413 Zephyr Foods 186 h → GST ₹41,850, total ₹2,74,350', () => {
    const t = computeInvoiceTax({ minutes: 186 * 60, ratePaise: 125000, supply: 'INTER' });
    expect(t.taxablePaise).toBe(23_250_000);
    expect(t.taxPaise).toBe(4_185_000);
    expect(t.totalPaise).toBe(27_435_000);
  });
  it('INV-0414 Crest Labs draft 64 h → ₹80,000 + ₹14,400 = ₹94,400', () => {
    const t = computeInvoiceTax({ minutes: 64 * 60, ratePaise: 125000, supply: 'INTRA' });
    expect([t.taxablePaise, t.taxPaise, t.totalPaise]).toEqual([8_000_000, 1_440_000, 9_440_000]);
  });
  it('fractional hours: taxable = minutes / 60 × rate, rounded to the paisa', () => {
    const t = computeInvoiceTax({ minutes: 380 * 60 + 30, ratePaise: 100000, supply: 'INTER' });
    expect(t.taxablePaise).toBe(38_050_000);
  });
});

describe('Invoice tax: rounding', () => {
  it('rounds half up, symmetric for negatives', () => {
    expect(finRoundHalfUp(4.5)).toBe(5);
    expect(finRoundHalfUp(4.4999)).toBe(4);
    expect(finRoundHalfUp(-2.5)).toBe(-3);
    expect(finRoundHalfUp(2.675 * 100)).toBe(268);
  });
  it('each head is rounded on its own: CGST = SGST = round(taxable × 9%)', () => {
    // ₹0.50 taxable: 9% = 4.5 paise → 5 each; IGST 18% = 9 paise.
    expect(finTaxFromTaxable(50, 'INTRA', 1800, false)).toMatchObject({ cgstPaise: 5, sgstPaise: 5, igstPaise: 0, taxPaise: 10 });
    expect(finTaxFromTaxable(50, 'INTER', 1800, false)).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 9, taxPaise: 9 });
  });
  it('1 minute at ₹1,250/h: taxable ₹20.83; CGST/SGST ₹1.87 each, IGST ₹3.75 — totals round to the rupee', () => {
    const intra = computeInvoiceTax({ minutes: 1, ratePaise: 125000, supply: 'INTRA' });
    expect(intra).toMatchObject({ taxablePaise: 2083, cgstPaise: 187, sgstPaise: 187, totalPaise: 2500, roundOffPaise: 43 });
    const inter = computeInvoiceTax({ minutes: 1, ratePaise: 125000, supply: 'INTER' });
    expect(inter).toMatchObject({ taxablePaise: 2083, igstPaise: 375, totalPaise: 2500, roundOffPaise: 42 });
  });
  it('round-off can be negative; taxable + tax + round-off = total', () => {
    const up = finTaxFromTaxable(10050, 'INTER');
    expect(up).toMatchObject({ igstPaise: 1809, totalPaise: 11900, roundOffPaise: 41 });
    const down = finTaxFromTaxable(10010, 'INTER');
    expect(down).toMatchObject({ igstPaise: 1802, totalPaise: 11800, roundOffPaise: -12 });
    for (const t of [up, down]) expect(t.taxablePaise + t.taxPaise + t.roundOffPaise).toBe(t.totalPaise);
  });
  it('can keep paise when rupee rounding is off', () => {
    expect(finTaxFromTaxable(10010, 'INTER', 1800, false)).toMatchObject({ totalPaise: 11812, roundOffPaise: 0 });
  });
});

describe('Input GST on purchases', () => {
  it('estimates GST inside a GST-inclusive amount as amount × 18/118 (wireframe rows)', () => {
    expect(estimateInputGst(2_490_000)).toBe(379_831); // Flipkart ₹24,900 → ₹3,798.31
    expect(estimateInputGst(14_200_000)).toBe(2_166_102); // Dell ₹1,42,000 → ₹21,661.02
    expect(estimateInputGst(846_000)).toBe(129_051); // Amazon ₹8,460 → ₹1,290.51
    expect(estimateInputGst(105_000, 500)).toBe(5_000); // 5% slab: ₹1,050 → ₹50
  });
  it('splits input GST into CGST/SGST (odd paisa on SGST) or IGST', () => {
    expect(splitInputGst(129_051, 'INTRA')).toEqual({ cgstPaise: 64_525, sgstPaise: 64_526, igstPaise: 0 });
    expect(splitInputGst(129_051, 'INTER')).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 129_051 });
  });
  const base = { gstRateBp: 1800, tenantStateCode: TENANT_STATE, itcEligibleDefault: true };
  it('uses the OCR value when the bill has one (Amazon IN-8843 → ₹1,290, intra-state)', () => {
    const g = resolvePurchaseGst({ ...base, amountPaise: 846_000, inputGstPaise: 129_000, source: 'OCR', vendorStateCode: '24', vendorGstin: '24AAICA3918J1ZE' });
    expect(g).toEqual({ taxablePaise: 717_000, inputGstPaise: 129_000, cgstPaise: 64_500, sgstPaise: 64_500, igstPaise: 0, source: 'OCR', itcEligible: true });
  });
  it('falls back to the 18/118 estimate and flags it, IGST for an out-of-state vendor', () => {
    const g = resolvePurchaseGst({ ...base, amountPaise: 2_490_000, vendorStateCode: null, vendorGstin: '29AABCF8078M1ZX' });
    expect(g).toMatchObject({ source: 'ESTIMATED', inputGstPaise: 379_831, igstPaise: 379_831, cgstPaise: 0, taxablePaise: 2_110_169 });
  });
  it('a hand-edited GST is MANUAL', () => {
    expect(resolvePurchaseGst({ ...base, amountPaise: 100_000, inputGstPaise: 15_000, source: null, vendorStateCode: '24', vendorGstin: '24AAICA3918J1ZE' }).source).toBe('MANUAL');
  });
  it('blocks ITC for Sec 17(5) categories and unregistered vendors', () => {
    expect(resolvePurchaseGst({ ...base, itcEligibleDefault: false, amountPaise: 48_000, vendorStateCode: '24', vendorGstin: '24AAGCM4562K1ZX' }).itcEligible).toBe(false);
    expect(resolvePurchaseGst({ ...base, amountPaise: 48_000, vendorStateCode: '24', vendorGstin: null }).itcEligible).toBe(false);
  });
  it('rejects GST above the highest slab (28%) or negative', () => {
    expect(() => resolvePurchaseGst({ ...base, amountPaise: 100_000, inputGstPaise: 30_000, source: 'MANUAL', vendorStateCode: '24', vendorGstin: null })).toThrow(PurchaseGstError);
    expect(() => resolvePurchaseGst({ ...base, amountPaise: 100_000, inputGstPaise: -1, source: 'MANUAL', vendorStateCode: '24', vendorGstin: null })).toThrow(PurchaseGstError);
  });
});

describe('GSTIN', () => {
  it('validates format and the mod-36 check character', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27aapfu0939f1zv')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZW')).toBe(false);
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
    expect(isValidGstin(null)).toBe(false);
  });
  it('reads the state from the first two digits', () => {
    expect(stateFromGstin('29AABCF8078M1ZX')).toBe('29');
    expect(stateFromGstin(null)).toBeNull();
  });
});

describe('GSTR-3B ITC utilisation', () => {
  it('IGST credit first; CGST and SGST credits never cross', () => {
    const u = utiliseItc({ igst: 100, cgst: 50, sgst: 50 }, { igst: 30, cgst: 80, sgst: 10 });
    expect(u.steps).toEqual([
      { from: 'IGST', to: 'IGST', amountPaise: 30 },
      { from: 'CGST', to: 'CGST', amountPaise: 50 },
      { from: 'CGST', to: 'IGST', amountPaise: 30 },
      { from: 'SGST', to: 'SGST', amountPaise: 10 },
    ]);
    expect(u.payable).toEqual({ igst: 40, cgst: 0, sgst: 40 });
    expect(u.carryForward).toEqual({ igst: 0, cgst: 0, sgst: 0 });
  });
  it('excess IGST credit spills to CGST then SGST; the rest carries forward', () => {
    const u = utiliseItc({ igst: 10, cgst: 20, sgst: 20 }, { igst: 45, cgst: 0, sgst: 0 });
    expect(u.payable).toEqual({ igst: 0, cgst: 0, sgst: 5 });
    expect(u.carryForward.igst).toBe(0);
    const v = utiliseItc({ igst: 0, cgst: 0, sgst: 0 }, { igst: 5, cgst: 6, sgst: 7 });
    expect(v.carryForward).toEqual({ igst: 5, cgst: 6, sgst: 7 });
  });
});

describe('Payroll accrual (payroll.finalized → salary JV)', () => {
  it('Dr salaries + employer PF; Cr net pay, PF, PT, TDS — balanced', () => {
    const lines = payrollPostingLines({ grossPaise: 1_000_000, netPaise: 850_000, deductionsPaise: 150_000, employerPfPaise: 60_000, employeeCount: 2 });
    const by = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(by.SALARY_EXPENSE!.debitPaise).toBe(1_000_000);
    expect(by.EMPLOYER_PF_EXPENSE!.debitPaise).toBe(60_000);
    expect(by.SALARY_PAYABLE!.creditPaise).toBe(850_000);
    expect(by.PF_PAYABLE!.creditPaise).toBe(120_000); // employee 12% + employer 12%
    expect(by.PT_PAYABLE!.creditPaise).toBe(40_000); // ₹200 × 2
    expect(by.TDS_PAYABLE!.creditPaise).toBe(50_000);
    expect(() => validateVoucherLines(lines.map((l) => ({ accountId: l.key, debitPaise: l.debitPaise, creditPaise: l.creditPaise })))).not.toThrow();
  });
  it('uses explicit statutory splits and stays balanced when producer totals disagree', () => {
    const lines = payrollPostingLines({ grossPaise: 500_000, netPaise: 430_001, deductionsPaise: 70_000, employerPfPaise: 0, employeePfPaise: 50_000, ptPaise: 20_000, tdsPaise: 0 });
    const dr = lines.reduce((s, l) => s + l.debitPaise, 0);
    const cr = lines.reduce((s, l) => s + l.creditPaise, 0);
    expect(dr).toBe(cr);
    expect(lines.find((l) => l.key === 'TDS_PAYABLE')).toBeUndefined(); // zero lines are dropped
  });
});
