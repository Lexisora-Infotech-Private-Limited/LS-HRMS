/**
 * Pure rules for the UK (region GB) onboarding "Bank & tax" step: the starting tax code
 * from the HMRC new starter checklist and the merge into EmployeePayrollProfile.ukProfile.
 */
import { ukPayrollProfileSchema, type UkPayrollProfile } from '@lexisora/shared';

export type StarterStatement = 'A' | 'B' | 'C';

/**
 * Starting tax code for a new joiner, decided from the starter checklist statement:
 *  - A (first job since 6 April, no benefits/pension): 1257L on the normal cumulative basis;
 *  - B (only job now, but had another job/benefits since 6 April): 1257L "Month 1" (non-cumulative),
 *    because the earlier pay is not known;
 *  - C (has another job or a pension): 1257L non-cumulative as a safe start. HMRC's table says BR
 *    for C, and HR / Payroll should change the code when HMRC sends a coding notice (P6/P9).
 * Payroll can always change the code later on the employee's UK payroll profile.
 */
export function ukStarterTax(statement: StarterStatement): { taxCode: string; taxBasis: 'CUMULATIVE' | 'NON_CUMULATIVE' } {
  return { taxCode: '1257L', taxBasis: statement === 'A' ? 'CUMULATIVE' : 'NON_CUMULATIVE' };
}

/** UK tax year (start year) that a date falls in: 6 April to 5 April. */
export function ukTaxYearOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return m > 4 || (m === 4 && d >= 6) ? y : y - 1;
}

export type UkBankTaxFields = {
  starterStatement: StarterStatement;
  studentLoanPlans: ('PLAN_1' | 'PLAN_2' | 'PLAN_4' | 'PLAN_5')[];
  postgraduateLoan: boolean;
  hasP45: boolean;
  previousPayPence?: number | null;
  previousTaxPence?: number | null;
};

/**
 * Merge the joiner's answers into the existing ukProfile (if any) and return a valid
 * ukPayrollProfileSchema object. A tax code Payroll already set is kept; otherwise the
 * starter checklist default is used. P45 figures are for the current tax year.
 */
export function mergeUkProfile(existing: unknown, i: UkBankTaxFields, today: string): UkPayrollProfile {
  const prev = ukPayrollProfileSchema.safeParse(existing);
  const base: Partial<UkPayrollProfile> = prev.success ? prev.data : {};
  const starter = ukStarterTax(i.starterStatement);
  return ukPayrollProfileSchema.parse({
    ...base,
    taxCode: base.taxCode ?? starter.taxCode,
    taxBasis: base.taxCode ? base.taxBasis : starter.taxBasis,
    starterStatement: i.starterStatement,
    studentLoanPlans: [...new Set(i.studentLoanPlans)],
    postgraduateLoan: i.postgraduateLoan,
    previousPayPence: i.hasP45 ? (i.previousPayPence ?? 0) : 0,
    previousTaxPence: i.hasP45 ? (i.previousTaxPence ?? 0) : 0,
    previousTaxYear: i.hasP45 ? ukTaxYearOf(today) : null,
  });
}
