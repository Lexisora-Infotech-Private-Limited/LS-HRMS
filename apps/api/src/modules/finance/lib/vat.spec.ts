import { describe, expect, it } from 'vitest';
import {
  formatUkVatNumber,
  isValidUkVatNumber,
  normalizeUkVatNumber,
  ukCreatePurchaseSchema,
  ukClientInput,
  ukComputeInvoiceVat,
  ukDeriveVatTreatment,
  ukVatAnalysis,
  ukVatChecksumOk,
  ukVatDueDate,
  ukVatFromTaxable,
  ukVatQuarterOf,
  ukVatReturnBoxes,
  UK_REVERSE_CHARGE_NOTE,
} from '@lexisora/shared';
import { aggregateUkPayroll, PurchaseVatError, resolvePurchaseVat, ukPayrollPostingLines, ukVatReturnFromTotals } from './vat';
import { validateVoucherLines } from './ledger-math';
import { amountInWordsGBP, pdfGBP } from './money';
import { parseBillText } from '../adapters/bill-ocr';

describe('UK VAT on invoices', () => {
  it('160 h × £75 at 20% standard → net £12,000, VAT £2,400, total £14,400 (VAT in the IGST column)', () => {
    const t = ukComputeInvoiceVat({ minutes: 160 * 60, ratePaise: 7500, treatment: 'STANDARD' });
    expect(t).toEqual({ taxablePaise: 1_200_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 240_000, taxPaise: 240_000, roundOffPaise: 0, totalPaise: 1_440_000 });
  });
  it('reduced 5%, zero-rated, exempt and outside the scope', () => {
    expect(ukVatFromTaxable(10_000, 'REDUCED')).toMatchObject({ igstPaise: 500, totalPaise: 10_500 });
    expect(ukVatFromTaxable(10_000, 'ZERO')).toMatchObject({ igstPaise: 0, totalPaise: 10_000 });
    expect(ukVatFromTaxable(10_000, 'EXEMPT')).toMatchObject({ igstPaise: 0, totalPaise: 10_000 });
    expect(ukVatFromTaxable(10_000, 'OUTSIDE_SCOPE')).toMatchObject({ igstPaise: 0, totalPaise: 10_000 });
    expect(ukVatFromTaxable(10_000, 'NOT_REGISTERED')).toMatchObject({ igstPaise: 0, totalPaise: 10_000 });
  });
  it('rounds VAT half up to the penny per line; total is never rounded to the pound', () => {
    expect(ukVatFromTaxable(3, 'STANDARD').igstPaise).toBe(1); // 0.6p → 1p
    expect(ukVatFromTaxable(2, 'STANDARD').igstPaise).toBe(0); // 0.4p → 0p
    expect(ukVatFromTaxable(50, 'REDUCED').igstPaise).toBe(3); // 2.5p → 3p
    const t = ukComputeInvoiceVat({ minutes: 1, ratePaise: 7550, treatment: 'STANDARD' }); // 125.83p → 126p net
    expect(t).toMatchObject({ taxablePaise: 126, igstPaise: 25, totalPaise: 151, roundOffPaise: 0 });
  });
  it('summarises net and VAT per rate', () => {
    const a = ukVatAnalysis([
      { netPence: 1000, vatPence: 200, treatment: 'STANDARD', rateBp: 2000 },
      { netPence: 500, vatPence: 100, treatment: 'STANDARD', rateBp: 2000 },
      { netPence: 400, vatPence: 20, treatment: 'REDUCED', rateBp: 500 },
    ]);
    expect(a).toEqual([
      { label: '20% VAT', treatment: 'STANDARD', rateBp: 2000, netPence: 1500, vatPence: 300 },
      { label: '5% VAT', treatment: 'REDUCED', rateBp: 500, netPence: 400, vatPence: 20 },
    ]);
  });
});

describe('UK VAT treatment: reverse charge / outside the scope', () => {
  it('B2B services to an overseas customer are outside the scope, 0%, with the reverse-charge note', () => {
    const v = ukDeriveVatTreatment({ vatRegistered: true, clientCountryCode: 'US' });
    expect(v).toMatchObject({ treatment: 'OUTSIDE_SCOPE', rateBp: 0, reverseCharge: true });
    expect(v.note).toContain(UK_REVERSE_CHARGE_NOTE);
    // A picked rate does not override an overseas customer.
    expect(ukDeriveVatTreatment({ vatRegistered: true, clientCountryCode: 'de', requested: 'STANDARD' }).treatment).toBe('OUTSIDE_SCOPE');
  });
  it('UK customers: 20% by default, or the picked rate', () => {
    expect(ukDeriveVatTreatment({ vatRegistered: true, clientCountryCode: 'GB' })).toMatchObject({ treatment: 'STANDARD', rateBp: 2000, note: null, reverseCharge: false });
    expect(ukDeriveVatTreatment({ vatRegistered: true, clientCountryCode: null })).toMatchObject({ treatment: 'STANDARD' });
    expect(ukDeriveVatTreatment({ vatRegistered: true, clientCountryCode: 'GB', requested: 'REDUCED' })).toMatchObject({ treatment: 'REDUCED', rateBp: 500 });
    expect(ukDeriveVatTreatment({ vatRegistered: true, clientCountryCode: 'GB', requested: 'EXEMPT' })).toMatchObject({ treatment: 'EXEMPT', rateBp: 0 });
    expect(ukDeriveVatTreatment({ vatRegistered: true, clientCountryCode: 'GB', requested: 'OUTSIDE_SCOPE' }).treatment).toBe('STANDARD');
  });
  it('a company that is not VAT registered charges no VAT', () => {
    expect(ukDeriveVatTreatment({ vatRegistered: false, clientCountryCode: 'GB', requested: 'STANDARD' })).toMatchObject({ treatment: 'NOT_REGISTERED', rateBp: 0, note: null });
  });
});

describe('UK VAT numbers', () => {
  it('accepts GB + 9 or 12 digits, GBGD / GBHA and normalizes spaces and the missing prefix', () => {
    expect(isValidUkVatNumber('GB980780684')).toBe(true);
    expect(isValidUkVatNumber('gb 980 7806 84')).toBe(true);
    expect(isValidUkVatNumber('980780684')).toBe(true);
    expect(normalizeUkVatNumber('980 7806 84')).toBe('GB980780684');
    expect(isValidUkVatNumber('GB980780684001')).toBe(true);
    expect(isValidUkVatNumber('GBGD001')).toBe(true);
    expect(isValidUkVatNumber('GBHA599')).toBe(true);
    expect(isValidUkVatNumber('XI980780684')).toBe(true);
  });
  it('rejects other formats', () => {
    expect(isValidUkVatNumber('GBGD500')).toBe(false);
    expect(isValidUkVatNumber('GBHA499')).toBe(false);
    expect(isValidUkVatNumber('GB98078068')).toBe(false);
    expect(isValidUkVatNumber('FR12345678901')).toBe(false);
    expect(isValidUkVatNumber('24AAECL1234F1Z1')).toBe(false);
    expect(isValidUkVatNumber(null)).toBe(false);
  });
  it('checksum is only a soft check (format-valid numbers with a bad check digit still pass validation)', () => {
    expect(ukVatChecksumOk('GB980780684')).toBe(true);
    expect(ukVatChecksumOk('GB980780685')).toBe(false);
    expect(isValidUkVatNumber('GB980780685')).toBe(true);
    expect(formatUkVatNumber('GB980780684')).toBe('GB 980 7806 84');
  });
  it('UK schemas: client VAT number optional and UK-checked; overseas clients keep foreign numbers', () => {
    const base = { name: 'Thames Digital', billingEmails: [] };
    expect(ukClientInput.parse({ ...base })).toMatchObject({ countryCode: 'GB', gstin: null, gstRegType: 'UNREGISTERED', stateCode: null, pan: null });
    expect(ukClientInput.parse({ ...base, gstin: '980 7806 84' })).toMatchObject({ gstin: 'GB980780684', gstRegType: 'REGULAR' });
    expect(ukClientInput.safeParse({ ...base, gstin: 'GB123' }).success).toBe(false);
    expect(ukClientInput.parse({ ...base, countryCode: 'de', gstin: 'DE 123456789' })).toMatchObject({ countryCode: 'DE', gstin: 'DE123456789', gstRegType: 'OVERSEAS' });
    const purchase = { vendorName: 'Acme Ltd', vendorInvoiceNo: 'A-1', billDate: '2026-10-12', amountPaise: 12_000, categoryId: 'c1', billFileId: 'f1' };
    expect(ukCreatePurchaseSchema.parse({ ...purchase, vendorGstin: 'gb980780684' }).vendorGstin).toBe('GB980780684');
    expect(ukCreatePurchaseSchema.safeParse({ ...purchase, vendorGstin: '24AAECL1234F1Z1' }).success).toBe(false);
  });
});

describe('UK input VAT on purchases', () => {
  const base = { vatRateBp: 2000, vendorVatNumber: 'GB980780684', reclaimableDefault: true };
  it('estimates VAT inside a VAT-inclusive amount as gross × 20/120 (one amount, reclaimable)', () => {
    expect(resolvePurchaseVat({ ...base, amountPaise: 12_000 })).toEqual({ taxablePaise: 10_000, inputGstPaise: 2_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 2_000, source: 'ESTIMATED', itcEligible: true });
  });
  it('uses the OCR / manual value', () => {
    expect(resolvePurchaseVat({ ...base, amountPaise: 12_000, inputVatPaise: 1_999, source: 'OCR' })).toMatchObject({ inputGstPaise: 1_999, source: 'OCR' });
    expect(resolvePurchaseVat({ ...base, amountPaise: 12_000, inputVatPaise: 1_500 }).source).toBe('MANUAL');
  });
  it('business entertainment and suppliers without a VAT number are not reclaimable', () => {
    expect(resolvePurchaseVat({ ...base, amountPaise: 12_000, reclaimableDefault: false }).itcEligible).toBe(false);
    expect(resolvePurchaseVat({ ...base, amountPaise: 12_000, vendorVatNumber: null }).itcEligible).toBe(false);
    expect(resolvePurchaseVat({ ...base, amountPaise: 12_000, vatRateBp: 0 })).toMatchObject({ inputGstPaise: 0, itcEligible: false });
  });
  it('rejects VAT above 20/120 of the gross or negative', () => {
    expect(() => resolvePurchaseVat({ ...base, amountPaise: 12_000, inputVatPaise: 2_100, source: 'MANUAL' })).toThrow(PurchaseVatError);
    expect(() => resolvePurchaseVat({ ...base, amountPaise: 12_000, inputVatPaise: -1, source: 'MANUAL' })).toThrow(PurchaseVatError);
  });
});

describe('UK payroll journal (payroll.finalized → JV)', () => {
  const items = [
    { totalEarningsPaise: 300_000, netPaise: 228_000, tdsPaise: 40_000, ukStatutory: { grossPayPence: 300_000, taxPence: 40_000, niEmployeePence: 15_000, niEmployerPence: 30_000, pensionEmployeePence: 12_000, pensionEmployerPence: 7_200, studentLoanPence: 5_000, postgradLoanPence: 0 } },
    { totalEarningsPaise: 250_000, netPaise: 198_000, tdsPaise: 30_000, ukStatutory: { grossPayPence: 250_000, taxPence: 30_000, niEmployeePence: 10_000, niEmployerPence: 22_000, pensionEmployeePence: 10_000, pensionEmployerPence: 6_000, studentLoanPence: 0, postgradLoanPence: 2_000 } },
  ];
  it('Dr wages + employer NI + employer pension; Cr HMRC, pension, net wages — balanced', () => {
    const t = aggregateUkPayroll(items);
    expect(t).toMatchObject({ grossPence: 550_000, netPence: 426_000, taxPence: 70_000, niEmployeePence: 25_000, niEmployerPence: 52_000, pensionEmployeePence: 22_000, pensionEmployerPence: 13_200, studentLoanPence: 5_000, postgradLoanPence: 2_000, employeeCount: 2 });
    const lines = ukPayrollPostingLines(t);
    const by = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(by.SALARY_EXPENSE!.debitPaise).toBe(550_000);
    expect(by.EMPLOYER_NI_EXPENSE!.debitPaise).toBe(52_000);
    expect(by.EMPLOYER_PENSION_EXPENSE!.debitPaise).toBe(13_200);
    expect(by.PAYE_NI_PAYABLE!.creditPaise).toBe(70_000 + 25_000 + 52_000 + 5_000 + 2_000);
    expect(by.PENSION_PAYABLE!.creditPaise).toBe(35_200);
    expect(by.SALARY_PAYABLE!.creditPaise).toBe(426_000);
    expect(() => validateVoucherLines(lines.map((l) => ({ accountId: l.key, debitPaise: l.debitPaise, creditPaise: l.creditPaise })))).not.toThrow();
    expect(lines.some((l) => /GST|PF|TDS|PT_/.test(l.key))).toBe(false);
  });
  it('falls back to PAYE = tdsPaise when an item has no ukStatutory; other deductions stay balanced', () => {
    const t = aggregateUkPayroll([{ totalEarningsPaise: 200_000, netPaise: 159_000, tdsPaise: 40_000, ukStatutory: null }]);
    const lines = ukPayrollPostingLines(t);
    const dr = lines.reduce((s, l) => s + l.debitPaise, 0);
    const cr = lines.reduce((s, l) => s + l.creditPaise, 0);
    expect(dr).toBe(cr);
    expect(lines.find((l) => l.key === 'PAYE_NI_PAYABLE')!.creditPaise).toBe(40_000);
    expect(lines.find((l) => l.key === 'SALARY_PAYABLE')!.creditPaise).toBe(160_000); // £10 other deduction lands on net wages
    expect(lines.find((l) => l.key === 'PENSION_PAYABLE')).toBeUndefined();
  });
  it('stays balanced when the parts exceed the gross', () => {
    const lines = ukPayrollPostingLines({ grossPence: 100_000, netPence: 90_000, taxPence: 20_000, niEmployeePence: 0, niEmployerPence: 0, pensionEmployeePence: 0, pensionEmployerPence: 0, studentLoanPence: 0, postgradLoanPence: 0, employeeCount: 1 });
    expect(lines.reduce((s, l) => s + l.debitPaise - l.creditPaise, 0)).toBe(0);
  });
});

describe('UK VAT return (9 boxes)', () => {
  it('nets credit notes, reclaims input VAT and shows boxes 6–7 in whole pounds', () => {
    const r = ukVatReturnFromTotals({ invoiceNetPence: 1_000_000, invoiceVatPence: 200_000, creditNetPence: 100_000, creditVatPence: 20_000, billNetPence: 300_050, reclaimableVatPence: 50_000 });
    expect(r.boxes).toEqual({ box1: 180_000, box2: 0, box3: 180_000, box4: 50_000, box5: 130_000, box6: 900_000, box7: 300_000, box8: 0, box9: 0 });
    expect(r.netPence).toBe(130_000);
  });
  it('repayment: box 5 is the difference, the net is negative', () => {
    const b = ukVatReturnBoxes({ outputVatPence: 10_000, salesNetPence: 50_000, inputVatPence: 25_000, purchasesNetPence: 125_099 });
    expect(b.box5).toBe(15_000);
    expect(b.box7).toBe(125_000);
    expect(ukVatReturnFromTotals({ invoiceNetPence: 50_000, invoiceVatPence: 10_000, creditNetPence: 0, creditVatPence: 0, billNetPence: 125_000, reclaimableVatPence: 25_000 }).netPence).toBe(-15_000);
  });
  it('VAT quarters (default Mar/Jun/Sep/Dec and other staggers) and the 1 month + 7 days deadline', () => {
    expect(ukVatQuarterOf('2026-11')).toEqual({ period: '2026-12', start: '2026-10-01', end: '2026-12-31', label: 'Oct–Dec 2026' });
    expect(ukVatQuarterOf('2026-01')).toMatchObject({ period: '2026-03', start: '2026-01-01', end: '2026-03-31' });
    expect(ukVatQuarterOf('2026-11', 1)).toMatchObject({ period: '2027-01', start: '2026-11-01', end: '2027-01-31' });
    expect(ukVatQuarterOf('2026-12', 2)).toMatchObject({ period: '2027-02', start: '2026-12-01', end: '2027-02-28' });
    expect(ukVatDueDate('2026-09')).toBe('2026-11-07');
    expect(ukVatDueDate('2026-03')).toBe('2026-05-07');
    expect(ukVatDueDate('2026-12')).toBe('2027-02-07');
    expect(ukVatDueDate('2027-01')).toBe('2027-03-07');
  });
});

describe('UK money on PDFs and bill OCR', () => {
  it('amount in words in pounds and pence (no lakh/crore)', () => {
    expect(amountInWordsGBP(472_050)).toBe('Four Thousand Seven Hundred and Twenty Pounds and Fifty Pence');
    expect(amountInWordsGBP(100_000_500)).toBe('One Million and Five Pounds');
    expect(amountInWordsGBP(100)).toBe('One Pound');
    expect(amountInWordsGBP(1_250_000_00)).toBe('One Million Two Hundred and Fifty Thousand Pounds');
    expect(pdfGBP(1_440_050)).toBe('£14,400.50');
  });
  it('reads VAT labels and the VAT number only for UK tenants (India parsing unchanged)', () => {
    const text = ['Acme Supplies Ltd', 'VAT Reg No: GB 980 7806 84', 'Invoice No: AC-1001', 'Date: 12/10/2026', 'Net £100.00', 'VAT @ 20%: £20.00', 'Total £120.00'].join('\n');
    const uk = parseBillText(text, { vat: true });
    expect(uk).toMatchObject({ vendorVatNumber: 'GB980780684', invoiceNo: 'AC-1001', invoiceDate: '2026-10-12', totalPaise: 12_000, gstPaise: 2_000 });
    const india = parseBillText(text);
    expect(india.gstPaise).toBeUndefined();
    expect(india.vendorVatNumber).toBeUndefined();
  });
});
