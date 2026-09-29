import { z } from 'zod';

/**
 * Shared request/response contracts for the leavepay domain (leave, payroll, payslips).
 * Money is integer paise; day counts are numbers in 0.5 steps; dates are "YYYY-MM-DD".
 */

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-09');
const halfStep = (msg: string) => z.coerce.number().refine((n) => Math.abs(n * 2 - Math.round(n * 2)) < 1e-9, msg);

// ── Enums / labels ─────────────────────────────────────────────────────────

export const LEAVE_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLATION_PENDING', 'CANCELLED'] as const;
export type LeaveRequestStatusKey = (typeof LEAVE_REQUEST_STATUSES)[number];

/** Status copy on the Time off screen (wireframe tags). */
export const LEAVE_STATUS_LABEL: Record<LeaveRequestStatusKey, string> = {
  PENDING: 'Pending RM',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  CANCELLATION_PENDING: 'Cancellation pending',
  CANCELLED: 'Cancelled',
};
/** Wireframe tones: Pending (outline), Approved (accent), Rejected/Withdrawn/Cancelled (neutral). */
export const LEAVE_STATUS_TONE: Record<LeaveRequestStatusKey, 'accent' | 'outline' | 'neutral'> = {
  PENDING: 'outline',
  APPROVED: 'accent',
  REJECTED: 'neutral',
  WITHDRAWN: 'neutral',
  CANCELLATION_PENDING: 'outline',
  CANCELLED: 'neutral',
};

export const HALF_DAY_OPTIONS = [
  { value: 'NONE', label: 'No' },
  { value: 'FIRST_HALF', label: 'First half' },
  { value: 'SECOND_HALF', label: 'Second half' },
] as const;

export const EMPLOYMENT_TYPE_LABEL: Record<string, string> = { FULL_TIME: 'Full-time', INTERN: 'Interns', CONTRACT: 'Contract' };

// ── Leave: apply / decide ──────────────────────────────────────────────────

export const leaveApplySchema = z
  .object({
    leaveTypeId: z.string().min(1, 'Choose a leave type'),
    fromDate: dateKey,
    toDate: dateKey,
    halfDay: z.enum(['NONE', 'FIRST_HALF', 'SECOND_HALF']).default('NONE'),
    fromSession: z.enum(['FULL', 'SECOND_HALF']).default('FULL'),
    toSession: z.enum(['FULL', 'FIRST_HALF']).default('FULL'),
    notifyEmployeeIds: z.array(z.string()).max(10).default([]),
    reason: z.string().trim().max(500).default(''),
    attachmentFileId: z.string().nullish(),
    /** Accept that the excess over balance becomes unpaid (CONVERT_TO_LOP setting). */
    acceptLop: z.boolean().default(false),
  })
  .refine((v) => v.fromDate <= v.toDate, { message: 'To date must be on or after From date', path: ['toDate'] });
export type LeaveApplyInput = z.infer<typeof leaveApplySchema>;

export const leaveOnBehalfSchema = z
  .object({
    employeeId: z.string().min(1),
    leaveTypeId: z.string().min(1),
    fromDate: dateKey,
    toDate: dateKey,
    halfDay: z.enum(['NONE', 'FIRST_HALF', 'SECOND_HALF']).default('NONE'),
    fromSession: z.enum(['FULL', 'SECOND_HALF']).default('FULL'),
    toSession: z.enum(['FULL', 'FIRST_HALF']).default('FULL'),
    notifyEmployeeIds: z.array(z.string()).max(10).default([]),
    reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
    attachmentFileId: z.string().nullish(),
    acceptLop: z.boolean().default(true),
    /** Approve immediately (HR entering an already-agreed leave). */
    autoApprove: z.boolean().default(true),
  })
  .refine((v) => v.fromDate <= v.toDate, { message: 'To date must be on or after From date', path: ['toDate'] });
export type LeaveOnBehalfInput = z.infer<typeof leaveOnBehalfSchema>;

export const leaveDecisionSchema = z.object({ comment: z.string().trim().max(500).optional() });
export const leaveRejectSchema = z.object({ comment: z.string().trim().min(3, 'Add a comment for the employee').max(500) });
export const leaveCancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const leaveListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: z.string().optional(),
  q: z.string().trim().optional(),
  departmentId: z.string().optional(),
  leaveTypeId: z.string().optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
});
export type LeaveListQuery = z.infer<typeof leaveListQuery>;

export type LeaveBalanceView = {
  leaveTypeId: string;
  code: string;
  name: string;
  /** Card big number ("left"). */
  available: number;
  /** Card "/ total". */
  total: number;
  pending: number;
  availed: number;
  opening: number;
  isCompOff: boolean;
  allowHalfDay: boolean;
  /** "1 expires 18 Nov", "incl. 0.5 carried forward", "4.5 more accruing by Dec". */
  meta: string | null;
};

export type LeaveDayView = {
  date: string;
  kind: 'WORKING' | 'WEEKLY_OFF' | 'HOLIDAY';
  session: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';
  units: number;
  isSandwich: boolean;
  isPaid: boolean;
  holidayName?: string;
};

export type LeavePreview = {
  totalDays: number;
  paidDays: number;
  lopDays: number;
  sandwichDays: number;
  days: LeaveDayView[];
  available: number;
  balanceAfter: number;
  summary: string;
  warnings: string[];
  blocks: string[];
  approver: { id: string; name: string } | null;
};

export type LeaveRequestRow = {
  id: string;
  requestNo: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string | null;
  leaveTypeId: string;
  typeCode: string;
  typeName: string;
  fromDate: string;
  toDate: string;
  /** "14 – 16 Oct", "2 Jul · first half" */
  dates: string;
  days: number;
  lopDays: number;
  reason: string | null;
  status: LeaveRequestStatusKey;
  statusLabel: string;
  approverId: string | null;
  approverName: string | null;
  appliedOn: string;
  decidedAt: string | null;
  decisionNote: string | null;
  /** Actions the viewer may take. */
  can: { withdraw: boolean; cancel: boolean; requestCancel: boolean; approve: boolean; reject: boolean; decideCancellation: boolean };
};

export type LeaveRequestDetail = LeaveRequestRow & {
  breakdown: LeaveDayView[];
  notify: { id: string; name: string }[];
  timeline: { at: string; text: string }[];
  attachmentFileId: string | null;
  balanceAfter: number | null;
  teamOverlap: number;
};

export type TeamRequestRow = LeaveRequestRow & {
  kind: 'LEAVE' | 'COMP_OFF';
  balanceAfter: number | null;
  teamOverlap: number;
  evidence: string | null;
};

export type UpcomingItem = { kind: 'HOLIDAY' | 'LEAVE'; label: string; dates: string; date: string; status?: string };

// ── Leave setup ────────────────────────────────────────────────────────────

export const leaveTypeSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(60),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, 'Code is 2–6 letters').optional(),
  annualQuota: z.coerce.number().min(0).max(365).default(0),
  /** "No" | "Up to 30" | number — the wireframe field; parsed server-side. */
  carryForward: z.union([z.string(), z.number()]).optional(),
  accrualFrequency: z.enum(['YEARLY', 'MONTHLY', 'QUARTERLY', 'ON_APPROVAL', 'NONE']).default('YEARLY'),
  encashable: z.boolean().default(false),
  appliesTo: z.array(z.enum(['FULL_TIME', 'INTERN', 'CONTRACT'])).min(1).default(['FULL_TIME']),
  isPaid: z.boolean().default(true),
  allowHalfDay: z.boolean().default(true),
  sandwichWeeklyOffs: z.boolean().default(false),
  sandwichHolidays: z.boolean().default(false),
  minNoticeDays: z.coerce.number().int().min(0).max(90).default(0),
  noticeEnforcement: z.enum(['WARN', 'BLOCK']).default('WARN'),
  backdateLimitDays: z.coerce.number().int().min(0).max(60).default(0),
  maxConsecutiveDays: z.coerce.number().min(0.5).max(365).nullish(),
  expiryDays: z.coerce.number().int().min(1).max(365).nullish(),
  documentRequiredAfterDays: z.coerce.number().min(0.5).max(60).nullish(),
});
export type LeaveTypeInput = z.infer<typeof leaveTypeSchema>;
export const leaveTypePatchSchema = leaveTypeSchema.partial().extend({ active: z.boolean().optional() });

export type LeaveTypeRow = {
  id: string;
  code: string;
  name: string;
  annualQuota: number;
  /** Wireframe column copy: "12" / "On approval". */
  quotaLabel: string;
  /** "No" / "Up to 30" / "60 days". */
  carryForwardLabel: string;
  encashable: boolean;
  appliesTo: string[];
  appliesToLabel: string;
  accrualFrequency: string;
  isPaid: boolean;
  isCompOff: boolean;
  allowHalfDay: boolean;
  sandwichWeeklyOffs: boolean;
  sandwichHolidays: boolean;
  minNoticeDays: number;
  noticeEnforcement: string;
  backdateLimitDays: number;
  maxConsecutiveDays: number | null;
  expiryDays: number | null;
  documentRequiredAfterDays: number | null;
  carryForwardMax: number | null;
  hidden: boolean;
  active: boolean;
  hasLedger: boolean;
};

export const creditRuleSchema = z.object({
  leaveTypeId: z.string().min(1),
  employmentType: z.enum(['FULL_TIME', 'INTERN', 'CONTRACT']),
  frequency: z.enum(['YEARLY', 'MONTHLY', 'QUARTERLY']),
  daysPerPeriod: halfStep('Days must be in 0.5 steps').pipe(z.number().min(0.5).max(60)),
  creditDay: z.coerce.number().int().min(1).max(28).default(1),
  prorateOnJoin: z.boolean().default(true),
  effectiveFrom: dateKey,
  active: z.boolean().default(true),
});
export type CreditRuleInput = z.infer<typeof creditRuleSchema>;

export type CreditRuleRow = {
  id: string;
  leaveTypeId: string;
  leaveType: string;
  employmentType: string;
  appliesTo: string;
  frequency: string;
  frequencyLabel: string;
  daysPerPeriod: number;
  prorateOnJoin: boolean;
  lastRun: string | null;
  lastRunStatus: string | null;
  nextRun: string;
  nextPeriodKey: string;
  active: boolean;
};

export const creditRunSchema = z.object({ ruleId: z.string().min(1), periodKey: z.string().regex(/^\d{4}(-\d{2})?$/).optional() });

export const manualCreditSchema = z
  .object({
    creditType: z.enum(['MANUAL', 'BASIC']).default('MANUAL'),
    leaveTypeId: z.string().min(1, 'Choose a leave type'),
    days: halfStep('Days must be in 0.5 steps').pipe(z.number().min(-365).max(365)).optional(),
    employeeIds: z.array(z.string()).min(1, 'Select employees'),
    note: z.string().trim().min(5, 'Note must be at least 5 characters').max(500),
    workedDate: dateKey.optional(),
  })
  .refine((v) => v.creditType === 'BASIC' || (v.days !== undefined && v.days !== 0), { message: 'Enter the days to credit', path: ['days'] });
export type ManualCreditInput = z.infer<typeof manualCreditSchema>;

export type ManualCreditRow = { id: string; date: string; employeeName: string; employeeCode: string; leaveType: string; days: number; txType: string; note: string | null; creditedBy: string | null };

export type CreditBatchRow = { id: string; type: string; leaveType: string | null; periodKey: string; status: string; employeeCount: number; totalDays: number; startedAt: string; note: string | null };

export const compOffRequestSchema = z.object({
  workedDate: dateKey,
  duration: z.enum(['FULL', 'HALF']).default('FULL'),
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(300),
});
export type CompOffRequestInput = z.infer<typeof compOffRequestSchema>;

export type CompOffRow = { id: string; employeeName: string; workedDate: string; units: number; remaining: number; expiresOn: string; status: string; reason: string | null; source: string };

export const yearEndSchema = z.object({ year: z.coerce.number().int().min(2020).max(2100) });
export type YearEndPreviewRow = { employeeId: string; employeeName: string; leaveType: string; closing: number; carry: number; encash: number; lapse: number };

export const leaveSettingsSchema = z.object({
  excessBalanceAction: z.enum(['REJECT', 'CONVERT_TO_LOP']),
  escalateAfterDays: z.coerce.number().int().min(1).max(30),
  pendingReminderHours: z.coerce.number().int().min(4).max(240),
  compOffHalfDayMinMinutes: z.coerce.number().int().min(60).max(600),
  compOffFullDayMinMinutes: z.coerce.number().int().min(120).max(720),
  compOffRequestWindowDays: z.coerce.number().int().min(1).max(120),
  teamOverlapWarnPct: z.coerce.number().int().min(0).max(100),
});
export type LeaveSettings = z.infer<typeof leaveSettingsSchema>;

export type LeaveHolidayRow = { id: string; date: string; name: string; type: string; day: string };

// ── Salary ─────────────────────────────────────────────────────────────────

export type SalaryLineView = { code: string; label: string; monthlyPaise: number; annualPaise: number };

/** GET /salary/employee/:id — Profile "Offer & pay" tab and the payroll salary editor. */
export type SalaryView = {
  employeeId: string;
  employeeName: string;
  payType: 'SALARY' | 'STIPEND';
  effectiveFrom: string | null;
  ctcAnnualPaise: number;
  grossMonthlyPaise: number;
  /** Wireframe rows: Basic, HRA, Special allowance, PF (employer), CTC. */
  rows: SalaryLineView[];
  revisions: { id: string; effectiveFrom: string; ctcAnnualPaise: number; grossMonthlyPaise: number; reason: string; by: string | null; status: string }[];
  statutory: { uan: string | null; pfEnabled: boolean; pfCeilingOpted: boolean; esiCovered: boolean; ptState: string; taxRegime: 'OLD' | 'NEW'; panMasked: string | null };
  bank: { accountMasked: string | null; ifsc: string | null; bankName: string | null; verified: boolean };
  profile: { payrollHold: boolean; holdReason: string | null; idleDeductionExempt: boolean; esiMode: string; paymentMode: string };
  canEdit: boolean;
};

export const salaryPreviewSchema = z
  .object({
    ctcAnnualPaise: z.coerce.number().int().positive().optional(),
    grossMonthlyPaise: z.coerce.number().int().positive().optional(),
    payType: z.enum(['SALARY', 'STIPEND']).default('SALARY'),
    pfCeilingOpted: z.boolean().default(true),
  })
  .refine((v) => v.ctcAnnualPaise || v.grossMonthlyPaise, { message: 'Enter annual CTC or monthly gross' });
export type SalaryPreviewInput = z.infer<typeof salaryPreviewSchema>;
export type SalaryPreview = { grossMonthlyPaise: number; ctcAnnualPaise: number; ctcMonthlyPaise: number; rows: SalaryLineView[]; warnings: string[] };

export const salaryRevisionSchema = z.object({
  effectiveFrom: dateKey,
  mode: z.enum(['CTC', 'GROSS']).default('CTC'),
  amountPaise: z.coerce.number().int().positive('Enter an amount'),
  payType: z.enum(['SALARY', 'STIPEND']).default('SALARY'),
  reason: z.enum(['JOINING', 'APPRAISAL', 'PROMOTION', 'CORRECTION', 'OTHER']).default('APPRAISAL'),
  note: z.string().trim().max(300).optional(),
});
export type SalaryRevisionInput = z.infer<typeof salaryRevisionSchema>;

export const payrollProfileSchema = z.object({
  pfEnabled: z.boolean().optional(),
  pfCeilingOpted: z.boolean().optional(),
  esiMode: z.enum(['AUTO', 'FORCE_ON', 'FORCE_OFF']).optional(),
  ptStateCode: z.enum(['GJ', 'MH', 'KA', 'NONE']).optional(),
  taxRegime: z.enum(['OLD', 'NEW']).optional(),
  payrollHold: z.boolean().optional(),
  holdReason: z.string().trim().max(200).nullish(),
  idleDeductionExempt: z.boolean().optional(),
  paymentMode: z.enum(['BANK_TRANSFER', 'CHEQUE', 'CASH']).optional(),
  bankVerified: z.boolean().optional(),
  declarations: z
    .object({
      sec80CPaise: z.coerce.number().int().min(0).optional(),
      sec80DPaise: z.coerce.number().int().min(0).optional(),
      rentMonthlyPaise: z.coerce.number().int().min(0).optional(),
      metro: z.boolean().optional(),
      homeLoanInterestPaise: z.coerce.number().int().min(0).optional(),
    })
    .nullish(),
});
export type PayrollProfileInput = z.infer<typeof payrollProfileSchema>;

export type SalaryListRow = { employeeId: string; name: string; code: string; department: string | null; employmentType: string; payType: string; ctcAnnualPaise: number; grossMonthlyPaise: number; effectiveFrom: string | null; taxRegime: string; hold: boolean };

// ── Payroll run ────────────────────────────────────────────────────────────

export const PAYROLL_ITEM_STATUS_LABEL: Record<string, string> = {
  READY: 'Ready',
  TIMESHEET_PENDING: 'Timesheet pending',
  EXCLUDED: 'Excluded',
  ON_HOLD: 'On hold',
  ERROR: 'Error',
  STALE: 'Needs re-run',
  FINALIZED: 'Finalized',
  PAID: 'Paid',
};

export const payrollRunSchema = z.object({
  period,
  attendanceLockDate: dateKey,
  includeIdleDeduction: z.boolean().default(true),
  pendingTimesheetMode: z.enum(['EXCLUDE', 'WAIT']).default('EXCLUDE'),
  paymentDate: dateKey,
});
export type PayrollRunInput = z.infer<typeof payrollRunSchema>;

export const payrollItemsQuery = z.object({
  status: z.string().optional(),
  q: z.string().trim().optional(),
  departmentId: z.string().optional(),
  payType: z.enum(['SALARY', 'STIPEND']).optional(),
});

export const payrollHoldSchema = z.object({ reason: z.string().trim().min(3, 'Add a reason').max(200) });
export const payrollCancelSchema = z.object({ reason: z.string().trim().min(3, 'Add a reason').max(200) });

export type PayrollKpis = {
  employees: number;
  interns: number;
  timesheetsApproved: number;
  timesheetsPending: number;
  grossPaise: number;
  grossDeltaPct: number | null;
  prevPeriodLabel: string;
  idleDeductionPaise: number;
  idleEmployees: number;
  deductionsPaise: number;
  netPaise: number;
  ready: number;
};

export type PayrollItemRow = {
  id: string;
  employeeId: string;
  name: string;
  code: string;
  department: string | null;
  payType: 'SALARY' | 'STIPEND';
  paidDays: number;
  workingDays: number;
  leave: string;
  idleMinutes: number;
  idleRawMinutes: number;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  status: string;
  statusLabel: string;
  timesheetGate: string;
  errors: string[];
};

export type PayrollRunView = {
  id: string;
  runNo: string;
  period: string;
  periodLabel: string;
  status: string;
  runType: string;
  attendanceLockDate: string | null;
  includeIdleDeduction: boolean;
  pendingTimesheetMode: 'EXCLUDE' | 'WAIT';
  paymentDate: string | null;
  calcVersion: number;
  calculatedAt: string | null;
  finalizedAt: string | null;
  finalizedBy: string | null;
  paidAt: string | null;
  lastError: string | null;
  bankFile: { id: string; fileName: string; entryCount: number; totalPaise: number; status: string; excluded: { name: string; reason: string }[] } | null;
};

export type PayrollPrecheck = { key: string; text: string; tone: 'outline' | 'neutral' | 'danger'; action?: 'REMIND_RMS' }[];

/** GET /payroll/period/:period — everything the Payroll run screen shows. */
export type PayrollPeriodView = {
  period: string;
  periodLabel: string;
  run: PayrollRunView | null;
  /** True when no run exists and the table is a dry-run preview. */
  isPreview: boolean;
  kpis: PayrollKpis;
  items: PayrollItemRow[];
  precheck: PayrollPrecheck;
  defaults: { attendanceLockDate: string; paymentDate: string; pendingCount: number; includeIdleDeduction: boolean };
  periods: { period: string; label: string; status: string | null }[];
};

export type PayrollItemDetail = PayrollItemRow & {
  runId: string;
  lines: { code: string; label: string; kind: string; fullAmountPaise: number | null; amountPaise: number }[];
  inputs: { label: string; value: string }[];
  trace: string[];
  holdReason: string | null;
  payslipId: string | null;
};

export const adjustmentSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(['LOP_REVERSAL', 'LOP_RECOVERY', 'IDLE_REVERSAL', 'IDLE_RECOVERY', 'BONUS', 'RECOVERY', 'REIMBURSEMENT', 'MANUAL_EARNING', 'MANUAL_DEDUCTION']),
  amountPaise: z.coerce.number().int().positive('Enter an amount'),
  forPeriod: period,
  reason: z.string().trim().min(3).max(300),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type AdjustmentRow = { id: string; employeeName: string; type: string; forPeriod: string; amountPaise: number; source: string; status: string; createdBy: string | null; reason: string };

// ── Payslips ───────────────────────────────────────────────────────────────

export type PayslipRow = {
  id: string;
  period: string;
  /** "Aug 2026" */
  month: string;
  runType: string;
  workingDays: number;
  paidDays: number;
  idleDeductionPaise: number;
  netPaise: number;
  grossPaise: number;
  status: string;
};

export type PayslipDetail = PayslipRow & {
  employee: { name: string; code: string; designation: string | null; department: string | null; joiningDate: string | null; panMasked: string | null; uan: string | null; bankMasked: string | null; ifsc: string | null };
  company: { name: string; address: string | null; pan: string | null };
  payDate: string | null;
  taxRegime: string | null;
  lopDays: number;
  leave: string;
  idleMinutes: number;
  earnings: { label: string; fullPaise: number | null; amountPaise: number }[];
  deductions: { label: string; amountPaise: number }[];
  employer: { label: string; amountPaise: number }[];
  totalEarningsPaise: number;
  totalDeductionsPaise: number;
  netInWords: string;
  ytd: { grossPaise: number; tdsPaise: number; pfPaise: number };
};

export const payslipListQuery = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() });
