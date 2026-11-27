import { z } from 'zod';

/**
 * UK payroll (region GB) contracts: the employee's PAYE / NI / student loan / pension
 * settings (EmployeePayrollProfile.ukProfile) and the per-pay-run statutory breakdown
 * (PayrollItem.ukStatutory). Money is in pence (same integer columns as paise).
 */

/** National Insurance category letters (HMRC). A is the standard letter. */
export const UK_NI_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'F', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'S', 'V', 'X', 'Z'] as const;
export type UkNiCategory = (typeof UK_NI_CATEGORIES)[number];
export const UK_NI_CATEGORY_LABELS: Record<UkNiCategory, string> = {
  A: 'A · Standard',
  B: 'B · Married women / widows (reduced rate)',
  C: 'C · Over State Pension age',
  D: 'D · Investment zone, deferred',
  E: 'E · Investment zone, reduced rate',
  F: 'F · Freeport',
  H: 'H · Apprentice under 25',
  I: 'I · Freeport, reduced rate',
  J: 'J · Deferred (another job pays NI)',
  K: 'K · Investment zone, over State Pension age',
  L: 'L · Freeport, deferred',
  M: 'M · Under 21',
  N: 'N · Investment zone',
  S: 'S · Freeport, over State Pension age',
  V: 'V · Veteran (first civilian job)',
  X: 'X · Not liable (e.g. under 16)',
  Z: 'Z · Under 21, deferred',
};

export const UK_STUDENT_LOAN_PLANS = ['PLAN_1', 'PLAN_2', 'PLAN_4', 'PLAN_5'] as const;
export type UkStudentLoanPlan = (typeof UK_STUDENT_LOAN_PLANS)[number];
export const UK_STUDENT_LOAN_LABELS: Record<UkStudentLoanPlan, string> = {
  PLAN_1: 'Plan 1',
  PLAN_2: 'Plan 2',
  PLAN_4: 'Plan 4 (Scotland)',
  PLAN_5: 'Plan 5',
};

/** New starter checklist statement (replaces the old P46). */
export const UK_STARTER_STATEMENTS = ['A', 'B', 'C'] as const;
export const UK_STARTER_STATEMENT_LABELS: Record<(typeof UK_STARTER_STATEMENTS)[number], string> = {
  A: 'A · First job since 6 April, no benefits or pension',
  B: 'B · Only job now, but had another job or benefits since 6 April',
  C: 'C · Has another job or a pension',
};

/** Automatic enrolment status of the worker in the workplace pension. */
export const UK_PENSION_STATUSES = ['AUTO', 'ENROLLED', 'OPTED_IN', 'POSTPONED', 'OPTED_OUT', 'CEASED', 'NOT_ELIGIBLE'] as const;
export type UkPensionStatus = (typeof UK_PENSION_STATUSES)[number];
export const UK_PENSION_STATUS_LABELS: Record<UkPensionStatus, string> = {
  AUTO: 'Assess every pay run',
  ENROLLED: 'Enrolled',
  OPTED_IN: 'Opted in',
  POSTPONED: 'Postponed',
  OPTED_OUT: 'Opted out',
  CEASED: 'Stopped (ceased membership)',
  NOT_ELIGIBLE: 'Not in the scheme',
};

/** How employee contributions get tax relief. */
export const UK_PENSION_SCHEMES = ['RELIEF_AT_SOURCE', 'NET_PAY', 'SALARY_SACRIFICE'] as const;
export const UK_PENSION_SCHEME_LABELS: Record<(typeof UK_PENSION_SCHEMES)[number], string> = {
  RELIEF_AT_SOURCE: 'Relief at source (deducted after tax)',
  NET_PAY: 'Net pay arrangement (deducted before tax)',
  SALARY_SACRIFICE: 'Salary sacrifice (reduces pay before tax and NI)',
};

/** Contributions on qualifying earnings (band) or on all pensionable pay. */
export const UK_PENSION_BASES = ['QUALIFYING', 'PENSIONABLE_PAY'] as const;

/**
 * Tax code: optional S (Scotland) / C (Wales) prefix, then a number + suffix letter (1257L),
 * K + number, or a fixed code (BR, D0, D1, D2, D3, NT, 0T). " M1"/" W1" is entered as the
 * non-cumulative basis, not in the code.
 */
export const UK_TAX_CODE_RE = /^(S|C)?((\d{1,6}[LMNTPY])|(K\d{1,6})|BR|D[0-3]|NT|0T)$/;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ukPensionSettingsSchema = z.object({
  status: z.enum(UK_PENSION_STATUSES).default('AUTO'),
  scheme: z.enum(UK_PENSION_SCHEMES).default('RELIEF_AT_SOURCE'),
  basis: z.enum(UK_PENSION_BASES).default('QUALIFYING'),
  /** Employee contribution, % (statutory minimum total is 8%, employer at least 3%). */
  employeePct: z.number().min(0).max(100).default(5),
  employerPct: z.number().min(0).max(100).default(3),
  /** Postponement end (up to 3 months from the start/eligibility date). */
  postponedUntil: dateKey.nullable().optional(),
  enrolledOn: dateKey.nullable().optional(),
  optedOutOn: dateKey.nullable().optional(),
});
export type UkPensionSettings = z.infer<typeof ukPensionSettingsSchema>;

export const ukPayrollProfileSchema = z.object({
  taxCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(UK_TAX_CODE_RE, 'Enter a valid tax code, e.g. 1257L, S1257L, BR, K475'),
  /** NON_CUMULATIVE = "Week 1 / Month 1" emergency basis. */
  taxBasis: z.enum(['CUMULATIVE', 'NON_CUMULATIVE']).default('CUMULATIVE'),
  niCategory: z.enum(UK_NI_CATEGORIES).default('A'),
  studentLoanPlans: z.array(z.enum(UK_STUDENT_LOAN_PLANS)).max(3).default([]),
  postgraduateLoan: z.boolean().default(false),
  starterStatement: z.enum(UK_STARTER_STATEMENTS).nullable().optional(),
  /** P45 from an earlier job in this tax year: pay and tax to date there (pence). */
  previousPayPence: z.number().int().min(0).default(0),
  previousTaxPence: z.number().int().default(0),
  /** Tax year the P45 figures belong to (start year, e.g. 2026 for 2026/27). */
  previousTaxYear: z.number().int().min(2000).max(2100).nullable().optional(),
  /** Company directors pay NI on an annual basis. */
  director: z.boolean().default(false),
  /** Paid irregular hours / part-year: holiday accrues at 12.07% of hours worked. */
  irregularHours: z.boolean().default(false),
  pension: ukPensionSettingsSchema.default({}),
});
export type UkPayrollProfile = z.infer<typeof ukPayrollProfileSchema>;

/** PATCH body for /salary/employee/:id/uk-profile (NI number and sort code live on the employee). */
export const updateUkPayrollSchema = ukPayrollProfileSchema.extend({
  niNumber: z
    .string()
    .trim()
    .toUpperCase()
    .transform((s) => s.replace(/\s+/g, ''))
    .refine((s) => s === '' || UK_NI_NUMBER_RE.test(s), 'Enter a valid National Insurance number, e.g. AB123456C')
    .optional(),
  sortCode: z
    .string()
    .trim()
    .transform((s) => s.replace(/[\s-]/g, ''))
    .refine((s) => s === '' || /^\d{6}$/.test(s), 'Sort code is 6 digits, e.g. 20-00-00')
    .optional(),
});
export type UpdateUkPayrollInput = z.input<typeof updateUkPayrollSchema>;

/** National Insurance number: 2 letters, 6 digits, suffix A–D (HMRC prefix rules). */
export const UK_NI_NUMBER_RE = /^(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/;

export function formatSortCode(s: string | null | undefined): string {
  const d = (s ?? '').replace(/\D/g, '');
  return d.length === 6 ? `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}` : d;
}

export function maskNiNumber(last4: string | null | undefined): string {
  return last4 ? `•• •• ${last4}` : '—';
}

/**
 * UK leave type codes whose days are paid by a statutory payment instead of salary.
 * The leave types themselves are created by the UK holiday & absence pack.
 */
export const UK_STATUTORY_PAY_BY_LEAVE: Record<string, UkStatutoryPayCode> = {
  SICK: 'SSP',
  MAT: 'SMP',
  PAT: 'SPP',
  SPL: 'SHPP',
  ADOPT: 'SAP',
  BRV: 'SPBP',
  NEO: 'SNCP',
};
export const UK_STATUTORY_PAY_CODES = ['SSP', 'SMP', 'SPP', 'SHPP', 'SAP', 'SPBP', 'SNCP'] as const;
export type UkStatutoryPayCode = (typeof UK_STATUTORY_PAY_CODES)[number];
export const UK_STATUTORY_PAY_LABELS: Record<UkStatutoryPayCode, string> = {
  SSP: 'Statutory Sick Pay',
  SMP: 'Statutory Maternity Pay',
  SPP: 'Statutory Paternity Pay',
  SHPP: 'Statutory Shared Parental Pay',
  SAP: 'Statutory Adoption Pay',
  SPBP: 'Statutory Parental Bereavement Pay',
  SNCP: 'Statutory Neonatal Care Pay',
};

/** Per-employee UK breakdown of one pay run (PayrollItem.ukStatutory). Pence. */
export type UkStatutory = {
  taxYear: number;
  taxMonth: number;
  taxCode: string;
  taxBasis: 'CUMULATIVE' | 'NON_CUMULATIVE';
  niCategory: UkNiCategory;
  grossPayPence: number;
  taxablePayPence: number;
  niablePayPence: number;
  taxPence: number;
  niEmployeePence: number;
  niEmployerPence: number;
  pensionablePayPence: number;
  pensionEmployeePence: number;
  pensionEmployerPence: number;
  pensionScheme: (typeof UK_PENSION_SCHEMES)[number];
  /** Auto-enrolment assessment this period. */
  aeAssessment: 'ELIGIBLE_JOBHOLDER' | 'NON_ELIGIBLE_JOBHOLDER' | 'ENTITLED_WORKER' | 'NOT_ASSESSED';
  aeAction: 'NONE' | 'ENROLLED' | 'POSTPONED' | 'CONTINUING' | 'OPTED_OUT';
  studentLoanPence: number;
  postgradLoanPence: number;
  statutoryPay: { code: UkStatutoryPayCode; days: number; amountPence: number }[];
  salarySacrificePence: number;
  /** Year to date after this period (including P45 pay/tax from a previous job). */
  taxablePayYtdPence: number;
  taxYtdPence: number;
  /** HMRC rates table version used. */
  ratesVersion: string;
};

/** HMRC Full Payment Submission export for one pay run (stub submission). */
export type UkFpsSummary = {
  runId: string;
  period: string;
  taxYear: number;
  taxMonth: number;
  paymentDate: string;
  employees: number;
  totals: {
    taxablePayPence: number;
    taxPence: number;
    niEmployeePence: number;
    niEmployerPence: number;
    studentLoanPence: number;
    postgradLoanPence: number;
    statutoryPayPence: number;
  };
  /** Total due to HMRC for the month (tax + NI + loans, before Employment Allowance). */
  dueToHmrcPence: number;
  /** Due date for paying HMRC electronically (22nd after the tax month ends). */
  payHmrcBy: string;
  submission: { status: 'NOT_SUBMITTED' | 'STUB_ACCEPTED' | 'ACCEPTED' | 'REJECTED'; at: string | null; reference: string | null; note: string };
};
