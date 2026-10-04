/**
 * Pure business rules for the People domain (no Nest / Prisma imports) so they are unit
 * tested in isolation: employee codes, statutory validation, CSV import rows, the onboarding
 * step state machine, exit/notice rules, appraisal scoring, interview results, ICS, asset
 * warranty thresholds, welcome-kit status, ID-card completeness and vCards.
 */

// ── Employee codes ─────────────────────────────────────────────────────────

export type EmpType = 'FULL_TIME' | 'INTERN' | 'CONTRACT';

/** Sequence key + format per series: STAFF (LX-0161) for full-time/contract, INTERN (LX-I-024). */
export function empCodeSeries(type: EmpType): { key: string; prefix: string; pad: number } {
  return type === 'INTERN' ? { key: 'employee.intern', prefix: 'LX-I-', pad: 3 } : { key: 'employee.fulltime', prefix: 'LX-', pad: 4 };
}

export function formatEmpCode(type: EmpType, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error('Sequence value must be a positive integer');
  const s = empCodeSeries(type);
  return s.prefix + String(n).padStart(s.pad, '0');
}

/** Highest numeric suffix used by existing codes of a series (to seed sequences). */
export function maxCodeNumber(codes: string[], type: EmpType): number {
  const re = type === 'INTERN' ? /^LX-I-(\d+)$/ : /^LX-(\d+)$/;
  return codes.reduce((m, c) => {
    const x = re.exec(c);
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
}

// ── Statutory validation ───────────────────────────────────────────────────

export function isValidPan(pan: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) && pan[3] === 'P';
}

const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(num: string): boolean {
  if (!/^\d+$/.test(num)) return false;
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = VD[c]![VP[i % 8]![digits[i]!]!]!;
  return c === 0;
}

/** Append a Verhoeff check digit (used by tests/seed to build valid Aadhaar numbers). */
export function verhoeffDigit(num: string): number {
  const inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = VD[c]![VP[(i + 1) % 8]![digits[i]!]!]!;
  return inv[c]!;
}

export function isValidAadhaar(a: string): boolean {
  return /^[2-9]\d{11}$/.test(a) && verhoeffValid(a);
}

export function isValidIfsc(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc);
}

export function validateBank(i: { accountNumber: string; confirmAccountNumber: string; ifsc: string }): string | null {
  if (!/^\d{9,18}$/.test(i.accountNumber)) return 'Account number must be 9 to 18 digits';
  if (i.accountNumber !== i.confirmAccountNumber) return 'Account numbers do not match';
  if (!isValidIfsc(i.ifsc)) return 'Enter a valid IFSC (e.g. HDFC0001234)';
  return null;
}

export const maskPan = (pan: string | null | undefined) => (pan && pan.length === 10 ? `XXXXX${pan.slice(5, 9)}X` : '—');
export const maskAadhaar = (last4: string | null | undefined) => (last4 ? `XXXX XXXX ${last4}` : '—');
export const maskAccount = (last4: string | null | undefined) => (last4 ? `XXXXXX${last4}` : '—');

/** Bundled IFSC → bank lookup (stub adapter; real adapter would call ifsc.razorpay.com). */
const IFSC_BANKS: Record<string, string> = {
  HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', SBIN: 'State Bank of India', UTIB: 'Axis Bank', KKBK: 'Kotak Mahindra Bank',
  PUNB: 'Punjab National Bank', BARB: 'Bank of Baroda', CNRB: 'Canara Bank', UBIN: 'Union Bank of India', IDIB: 'Indian Bank',
  YESB: 'Yes Bank', INDB: 'IndusInd Bank', IDFB: 'IDFC First Bank', FDRL: 'Federal Bank', BKID: 'Bank of India',
  MAHB: 'Bank of Maharashtra', CBIN: 'Central Bank of India', IOBA: 'Indian Overseas Bank', RATN: 'RBL Bank', AUBL: 'AU Small Finance Bank',
};
export function lookupIfsc(ifsc: string): { bank: string; branch: string } | null {
  if (!isValidIfsc(ifsc)) return null;
  const bank = IFSC_BANKS[ifsc.slice(0, 4)];
  return bank ? { bank, branch: `Branch ${ifsc.slice(5)}` } : { bank: `${ifsc.slice(0, 4)} Bank`, branch: `Branch ${ifsc.slice(5)}` };
}

// ── Dates ──────────────────────────────────────────────────────────────────

/** Accepts YYYY-MM-DD or DD-MM-YYYY (also with /) → "YYYY-MM-DD" or null. */
export function parseFlexibleDate(s: string | null | undefined): string | null {
  const v = (s ?? '').trim();
  let y: number, m: number, d: number;
  let x = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v);
  if (x) [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
  else if ((x = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(v))) [d, m, y] = [Number(x[1]), Number(x[2]), Number(x[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(s: string, n: number): string {
  const d = dateOnly(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86400_000);
}

// ── CSV import rows ────────────────────────────────────────────────────────

export type CsvLookupCtx = {
  departments: Map<string, string>; // lower(name) → id
  designations: Map<string, string>;
  branches: Map<string, string>;
  managersByEmail: Map<string, string>; // lower(email) → employeeId
  existingEmails: Set<string>; // lower(official email) already in tenant
  createMissingMasters?: boolean;
  today: string;
};
export type NormalisedImportRow = {
  row: number;
  fullName: string;
  officialEmail: string;
  personalEmail: string | null;
  phone: string;
  department: string;
  departmentId: string | null;
  designation: string;
  designationId: string | null;
  managerEmail: string | null;
  managerId: string | null;
  employmentType: EmpType;
  workMode: 'OFFICE' | 'REMOTE' | 'HYBRID';
  joiningDate: string;
  branch: string | null;
  branchId: string | null;
};

const TYPE_MAP: Record<string, EmpType> = { 'full-time': 'FULL_TIME', fulltime: 'FULL_TIME', full_time: 'FULL_TIME', ft: 'FULL_TIME', intern: 'INTERN', internship: 'INTERN', contract: 'CONTRACT' };
const MODE_MAP: Record<string, 'OFFICE' | 'REMOTE' | 'HYBRID'> = { office: 'OFFICE', remote: 'REMOTE', wfh: 'REMOTE', hybrid: 'HYBRID' };

/**
 * Validate one CSV row (row numbers are 1-based data rows, header excluded). Manager
 * references to other rows in the same file are resolved by the caller in a second pass
 * via `fileEmails`.
 */
export function validateCsvRow(
  raw: Record<string, string | undefined>,
  row: number,
  ctx: CsvLookupCtx,
  fileEmails: Set<string> = new Set(),
): { ok: boolean; errors: { row: number; field?: string; message: string }[]; value?: NormalisedImportRow } {
  const errors: { row: number; field?: string; message: string }[] = [];
  const g = (k: string) => (raw[k] ?? '').trim();
  const fullName = g('full_name');
  const officialEmail = g('official_email').toLowerCase();
  const personalEmail = g('personal_email').toLowerCase() || null;
  const phone = g('phone');
  const department = g('department');
  const designation = g('designation');
  const managerEmail = g('manager_email').toLowerCase() || null;
  const typeRaw = g('employment_type').toLowerCase() || 'full-time';
  const modeRaw = g('work_mode').toLowerCase() || 'office';
  const branch = g('branch') || null;

  if (fullName.length < 2) errors.push({ row, field: 'full_name', message: 'Full name is required' });
  if (!/^\S+@\S+\.\S+$/.test(officialEmail)) errors.push({ row, field: 'official_email', message: 'Official email is invalid' });
  else if (ctx.existingEmails.has(officialEmail)) errors.push({ row, field: 'official_email', message: `${officialEmail} already exists` });
  if (personalEmail && !/^\S+@\S+\.\S+$/.test(personalEmail)) errors.push({ row, field: 'personal_email', message: 'Personal email is invalid' });
  if (!/^\+?[0-9 ()-]{10,18}$/.test(phone)) errors.push({ row, field: 'phone', message: 'Phone must have at least 10 digits' });

  const departmentId = ctx.departments.get(department.toLowerCase()) ?? null;
  if (!department) errors.push({ row, field: 'department', message: 'Department is required' });
  else if (!departmentId && !ctx.createMissingMasters) errors.push({ row, field: 'department', message: `Unknown department "${department}"` });
  const designationId = ctx.designations.get(designation.toLowerCase()) ?? null;
  if (!designation) errors.push({ row, field: 'designation', message: 'Designation is required' });
  else if (!designationId && !ctx.createMissingMasters) errors.push({ row, field: 'designation', message: `Unknown designation "${designation}"` });
  const branchId = branch ? (ctx.branches.get(branch.toLowerCase()) ?? null) : null;
  if (branch && !branchId && !ctx.createMissingMasters) errors.push({ row, field: 'branch', message: `Unknown branch "${branch}"` });

  const employmentType = TYPE_MAP[typeRaw];
  if (!employmentType) errors.push({ row, field: 'employment_type', message: 'Employment type must be Full-time, Intern or Contract' });
  const workMode = MODE_MAP[modeRaw];
  if (!workMode) errors.push({ row, field: 'work_mode', message: 'Work mode must be Office, Remote or Hybrid' });
  const joiningDate = parseFlexibleDate(g('joining_date'));
  if (!joiningDate) errors.push({ row, field: 'joining_date', message: 'Joining date must be YYYY-MM-DD or DD-MM-YYYY' });
  else if (daysBetween(joiningDate, ctx.today) > 365) errors.push({ row, field: 'joining_date', message: 'Joining date is more than a year ago' });

  let managerId: string | null = null;
  if (managerEmail) {
    managerId = ctx.managersByEmail.get(managerEmail) ?? null;
    if (!managerId && !fileEmails.has(managerEmail)) errors.push({ row, field: 'manager_email', message: `Manager ${managerEmail} not found` });
    if (managerEmail === officialEmail) errors.push({ row, field: 'manager_email', message: 'An employee cannot report to themselves' });
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors,
    value: { row, fullName, officialEmail, personalEmail, phone, department, departmentId, designation, designationId, managerEmail, managerId, employmentType: employmentType!, workMode: workMode!, joiningDate: joiningDate!, branch, branchId },
  };
}

/** Validate all rows; duplicate emails inside the file are rejected after the first. */
export function validateCsvRows(rows: Record<string, string | undefined>[], ctx: CsvLookupCtx) {
  const fileEmails = new Set(rows.map((r) => (r.official_email ?? '').trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const valid: NormalisedImportRow[] = [];
  const errors: { row: number; field?: string; message: string }[] = [];
  rows.forEach((raw, i) => {
    const row = i + 1;
    const email = (raw.official_email ?? '').trim().toLowerCase();
    if (email && seen.has(email)) {
      errors.push({ row, field: 'official_email', message: `${email} appears more than once in the file` });
      return;
    }
    seen.add(email);
    const r = validateCsvRow(raw, row, ctx, fileEmails);
    if (r.ok && r.value) valid.push(r.value);
    else errors.push(...r.errors);
  });
  // Rows whose manager is another row that failed validation cannot be resolved.
  const validEmails = new Set(valid.map((v) => v.officialEmail));
  const final: NormalisedImportRow[] = [];
  for (const v of valid) {
    if (v.managerEmail && !v.managerId && !validEmails.has(v.managerEmail)) {
      errors.push({ row: v.row, field: 'manager_email', message: `Manager ${v.managerEmail} is not valid in this file` });
    } else final.push(v);
  }
  errors.sort((a, b) => a.row - b.row);
  return { valid: final, errors };
}

/** Order rows so managers defined in the same file are created before their reports. */
export function orderByManager(rows: NormalisedImportRow[]): NormalisedImportRow[] {
  const byEmail = new Map(rows.map((r) => [r.officialEmail, r]));
  const out: NormalisedImportRow[] = [];
  const done = new Set<string>();
  const visit = (r: NormalisedImportRow, depth = 0) => {
    if (done.has(r.officialEmail) || depth > 50) return;
    if (r.managerEmail && !r.managerId && byEmail.has(r.managerEmail)) visit(byEmail.get(r.managerEmail)!, depth + 1);
    if (!done.has(r.officialEmail)) {
      done.add(r.officialEmail);
      out.push(r);
    }
  };
  rows.forEach((r) => visit(r));
  return out;
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Onboarding step state machine ──────────────────────────────────────────

export const OB_KEYS = ['offer', 'nda', 'docs', 'bank', 'kit'] as const;
export type ObKey = (typeof OB_KEYS)[number];
export type ObStepStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'NEEDS_ATTENTION' | 'SKIPPED';
export type ObStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'COMPLETED' | 'CANCELLED';
export type ObEvent =
  | { type: 'STEP_DONE'; key: ObKey }
  | { type: 'FINISH' }
  | { type: 'DOC_REJECTED' }
  | { type: 'REOPEN'; key: ObKey }
  | { type: 'ALL_VERIFIED' }
  | { type: 'OVERRIDE' }
  | { type: 'CANCEL' };

export class OnboardingRuleError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Steps 1–4 must be DONE (or SKIPPED) before Finish; kit data is captured by Finish itself. */
export function incompleteSteps(steps: Record<ObKey, ObStepStatus>, upTo: ObKey[] = ['offer', 'nda', 'docs', 'bank']): ObKey[] {
  return upTo.filter((k) => steps[k] !== 'DONE' && steps[k] !== 'SKIPPED');
}

/** First step that still needs the joiner (for the "Now" marker). */
export function currentStep(steps: Record<ObKey, ObStepStatus>): ObKey | null {
  return OB_KEYS.find((k) => steps[k] === 'NEEDS_ATTENTION') ?? OB_KEYS.find((k) => steps[k] !== 'DONE' && steps[k] !== 'SKIPPED') ?? null;
}

/**
 * Apply an event to the onboarding. Returns the new overall status and step statuses, or
 * throws OnboardingRuleError (mapped to 409/422 by the service).
 */
export function applyOnboardingEvent(
  status: ObStatus,
  steps: Record<ObKey, ObStepStatus>,
  ev: ObEvent,
): { status: ObStatus; steps: Record<ObKey, ObStepStatus> } {
  const next = { ...steps };
  if (status === 'CANCELLED') throw new OnboardingRuleError('ONBOARDING_CANCELLED', 'This onboarding was cancelled');
  switch (ev.type) {
    case 'STEP_DONE': {
      if (status === 'COMPLETED') throw new OnboardingRuleError('ONBOARDING_COMPLETED', 'Onboarding is already complete');
      if (status === 'SUBMITTED' && steps[ev.key] !== 'NEEDS_ATTENTION') {
        throw new OnboardingRuleError('ONBOARDING_SUBMITTED', 'Onboarding is submitted; HR must reopen a step before you can change it');
      }
      if (ev.key === 'kit' && steps.kit !== 'NEEDS_ATTENTION') {
        throw new OnboardingRuleError('USE_FINISH', 'Confirm your T-shirt size with “Finish onboarding”');
      }
      if ((ev.key === 'nda' || ev.key === 'docs' || ev.key === 'bank') && steps.offer !== 'DONE' && steps.offer !== 'SKIPPED') {
        throw new OnboardingRuleError('OFFER_FIRST', 'Sign the offer letter first');
      }
      next[ev.key] = 'DONE';
      // A joiner fixing a step after submission goes straight back to SUBMITTED once nothing is open.
      const resubmitted = next.kit === 'DONE' && !incompleteSteps(next).length && !OB_KEYS.some((k) => next[k] === 'NEEDS_ATTENTION');
      return { status: resubmitted ? 'SUBMITTED' : 'IN_PROGRESS', steps: next };
    }
    case 'FINISH': {
      if (status === 'SUBMITTED' || status === 'COMPLETED') throw new OnboardingRuleError('ALREADY_SUBMITTED', 'Onboarding is already submitted');
      const missing = incompleteSteps(next);
      if (missing.length) throw new OnboardingRuleError('STEPS_INCOMPLETE', 'Finish the earlier steps first', missing);
      next.kit = 'DONE';
      return { status: 'SUBMITTED', steps: next };
    }
    case 'DOC_REJECTED': {
      next.docs = 'NEEDS_ATTENTION';
      return { status: status === 'NOT_STARTED' ? 'NOT_STARTED' : 'IN_PROGRESS', steps: next };
    }
    case 'REOPEN': {
      next[ev.key] = 'NEEDS_ATTENTION';
      return { status: 'IN_PROGRESS', steps: next };
    }
    case 'ALL_VERIFIED': {
      if (status !== 'SUBMITTED') return { status, steps: next };
      return { status: 'COMPLETED', steps: next };
    }
    case 'OVERRIDE': {
      for (const k of OB_KEYS) if (next[k] !== 'DONE') next[k] = 'SKIPPED';
      return { status: 'COMPLETED', steps: next };
    }
    case 'CANCEL':
      return { status: 'CANCELLED', steps: next };
  }
}

// ── Lifecycle: notice & exit ───────────────────────────────────────────────

export function defaultNoticeDays(type: EmpType, joiningDate: string | null, today: string): number {
  if (type === 'INTERN') return 7;
  if (type === 'CONTRACT') return 15;
  if (joiningDate && daysBetween(joiningDate, today) < 183) return 15; // on probation
  return 30;
}

/** LWD = resignation + notice − 1; shortfall when HR picks an earlier LWD. */
export function computeLwd(resignationDate: string, noticeDays: number, chosenLwd?: string | null): { lastWorkingDay: string; shortfallDays: number } {
  const def = addDays(resignationDate, noticeDays - 1);
  if (!chosenLwd) return { lastWorkingDay: def, shortfallDays: 0 };
  if (chosenLwd < resignationDate) throw new Error('Last working day cannot be before the resignation date');
  return { lastWorkingDay: chosenLwd, shortfallDays: Math.max(0, daysBetween(chosenLwd, def)) };
}

export const EXIT_CHECKLIST: { key: string; label: string; ownerRole: string; blocking: boolean; auto: boolean }[] = [
  { key: 'ASSET_RETURN', label: 'Return company assets', ownerRole: 'HR / IT', blocking: true, auto: true },
  { key: 'IDCARD_SURRENDER', label: 'Surrender ID card', ownerRole: 'HR', blocking: true, auto: false },
  { key: 'KT_HANDOVER', label: 'Knowledge transfer & handover', ownerRole: 'Manager', blocking: true, auto: false },
  { key: 'ACCESS_REVOKE', label: 'Revoke system access', ownerRole: 'IT', blocking: false, auto: true },
  { key: 'FNF_SETTLEMENT', label: 'Full & final settlement', ownerRole: 'Payroll', blocking: false, auto: false },
  { key: 'RELIEVING_LETTER', label: 'Relieving letter issued', ownerRole: 'HR', blocking: false, auto: false },
  { key: 'EXIT_INTERVIEW', label: 'Exit interview (optional)', ownerRole: 'HR', blocking: false, auto: false },
];

/** Blocking checklist items still pending (ASSET_RETURN is derived from assigned assets). */
export function exitBlockers(items: { key: string; status: string; blocking: boolean }[], assignedAssets: number): string[] {
  const out: string[] = [];
  for (const i of items) {
    if (!i.blocking) continue;
    if (i.key === 'ASSET_RETURN') {
      if (assignedAssets > 0) out.push(`${assignedAssets} asset${assignedAssets === 1 ? '' : 's'} not returned`);
    } else if (i.status === 'PENDING') out.push(EXIT_CHECKLIST.find((e) => e.key === i.key)?.label ?? i.key);
  }
  return out;
}

export function employeeStatusLabel(status: string, type: string): string {
  if (status === 'ONBOARDING') return 'Onboarding';
  if (status === 'NOTICE_PERIOD') return 'Notice period';
  if (status === 'EXITED') return 'Exited';
  return type === 'INTERN' ? 'Intern' : 'Active';
}

// ── Appraisals ─────────────────────────────────────────────────────────────

export function templateWeightsValid(weights: number[]): boolean {
  if (!weights.length) return false;
  const sum = weights.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 100) <= 0.01;
}

/** Σ(weight × rating) / Σ weight, 2 decimals; null when any KRA is unrated. */
export function weightedScore(items: { weight: number; rating: number | null | undefined }[]): number | null {
  if (!items.length || items.some((i) => i.rating === null || i.rating === undefined)) return null;
  const w = items.reduce((a, i) => a + i.weight, 0);
  if (w <= 0) return null;
  const s = items.reduce((a, i) => a + i.weight * (i.rating as number), 0) / w;
  return Math.round(s * 100) / 100;
}

export function bandFor(score: number | null | undefined): string | null {
  if (score === null || score === undefined) return null;
  if (score >= 4.5) return 'Outstanding';
  if (score >= 3.5) return 'Exceeds expectations';
  if (score >= 2.5) return 'Meets expectations';
  if (score >= 1.5) return 'Needs improvement';
  return 'Unsatisfactory';
}

export function pct(part: number, whole: number): number {
  return whole ? Math.round((100 * part) / whole) : 0;
}

/** Indian FY half-year name for a date: H1 = Apr–Sep, H2 = Oct–Mar ("H1 FY26-27"). */
export function suggestCycleName(d: string): { name: string; from: string; to: string } {
  const [y, m] = d.split('-').map(Number) as [number, number];
  const fyStart = m >= 4 ? y : y - 1;
  const fy = `FY${String(fyStart % 100).padStart(2, '0')}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  if (m >= 4 && m <= 9) return { name: `H1 ${fy}`, from: `${fyStart}-04-01`, to: `${fyStart}-09-30` };
  return { name: `H2 ${fy}`, from: `${fyStart}-10-01`, to: `${fyStart + 1}-03-31` };
}

export function eligibleForCycle(e: { status: string; employmentType: string; joiningDate: string | null }, cyc: { periodTo: string; minTenureDays: number; types: string[] }): boolean {
  if (e.status !== 'ACTIVE') return false;
  if (!cyc.types.includes(e.employmentType)) return false;
  if (!e.joiningDate) return false;
  return e.joiningDate <= addDays(cyc.periodTo, -cyc.minTenureDays);
}

export const CYCLE_FLOW: Record<string, string | null> = { DRAFT: 'SELF_REVIEW', SELF_REVIEW: 'MANAGER_REVIEW', MANAGER_REVIEW: 'CALIBRATION', CALIBRATION: 'CLOSED', CLOSED: null };

// ── Recruitment ────────────────────────────────────────────────────────────

export function resultFromRecommendation(rec: string | null | undefined): 'SELECTED' | 'REJECTED' | 'PENDING' {
  if (rec === 'STRONG_HIRE' || rec === 'HIRE') return 'SELECTED';
  if (rec === 'NO_HIRE' || rec === 'STRONG_NO_HIRE') return 'REJECTED';
  return 'PENDING';
}

/** Majority of submitted recommendations (ties → ON_HOLD). */
export function suggestResult(recs: (string | null | undefined)[]): 'SELECTED' | 'REJECTED' | 'ON_HOLD' | null {
  const r = recs.map(resultFromRecommendation).filter((x) => x !== 'PENDING');
  if (!r.length) return null;
  const sel = r.filter((x) => x === 'SELECTED').length;
  const rej = r.length - sel;
  return sel > rej ? 'SELECTED' : rej > sel ? 'REJECTED' : 'ON_HOLD';
}

/** Recording a result completes the interview; resetting it to PENDING re-opens a completed one. */
export function interviewStatusAfterResult<S extends string>(status: S, result: string): S | 'SCHEDULED' | 'COMPLETED' {
  if (result !== 'PENDING') return 'COMPLETED';
  return status === 'COMPLETED' ? 'SCHEDULED' : status;
}

export function applicationScore(overalls: (number | null | undefined)[]): number | null {
  const v = overalls.filter((x): x is number => typeof x === 'number');
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

/** Overall /10 derived from 1–5 criteria ratings when the interviewer leaves it blank. */
export function overallFromRatings(ratings: (number | null | undefined)[]): number | null {
  const v = ratings.filter((x): x is number => typeof x === 'number');
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 2 * 10) / 10;
}

export const STAGE_TRANSITIONS: Record<string, string[]> = {
  SCREENING: ['INTERVIEW', 'OFFERED', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['SCREENING', 'OFFERED', 'REJECTED', 'WITHDRAWN'],
  OFFERED: ['HIRED', 'OFFER_DECLINED', 'REJECTED', 'WITHDRAWN', 'INTERVIEW'],
  HIRED: [],
  REJECTED: ['SCREENING'],
  OFFER_DECLINED: ['SCREENING'],
  WITHDRAWN: ['SCREENING'],
};
export function canMoveStage(from: string, to: string): boolean {
  return (STAGE_TRANSITIONS[from] ?? []).includes(to);
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function icsLocal(d: Date): string {
  // Wall-clock time in Asia/Kolkata (UTC+05:30, no DST).
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** RFC 5545 calendar invite for an interview (REQUEST or CANCEL). */
export function buildIcs(i: {
  uid: string;
  sequence: number;
  method: 'REQUEST' | 'CANCEL';
  start: Date;
  durationMin: number;
  summary: string;
  description?: string;
  location?: string;
  organizer: { name: string; email: string };
  attendees: { name: string; email: string }[];
  now?: Date;
}): string {
  const end = new Date(i.start.getTime() + i.durationMin * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Lexisora HRMS//Interviews//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${i.method}`,
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Kolkata',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0530',
    'TZOFFSETTO:+0530',
    'TZNAME:IST',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${i.uid}`,
    `SEQUENCE:${i.sequence}`,
    `DTSTAMP:${icsDate(i.now ?? new Date())}`,
    `DTSTART;TZID=Asia/Kolkata:${icsLocal(i.start)}`,
    `DTEND;TZID=Asia/Kolkata:${icsLocal(end)}`,
    `SUMMARY:${icsText(i.summary)}`,
    ...(i.description ? [`DESCRIPTION:${icsText(i.description)}`] : []),
    ...(i.location ? [`LOCATION:${icsText(i.location)}`] : []),
    `ORGANIZER;CN=${icsText(i.organizer.name)}:mailto:${i.organizer.email}`,
    ...i.attendees.map((a) => `ATTENDEE;CN=${icsText(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`),
    `STATUS:${i.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Interview reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** "2026-09-30" + "11:00" (IST) → UTC Date. */
export function istDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:30`);
}

// ── Assets ─────────────────────────────────────────────────────────────────

/** Which warranty alert threshold (30/7/0 days) applies today, if any. */
export function warrantyThreshold(warrantyTill: string | null, today: string): 30 | 7 | 0 | null {
  if (!warrantyTill) return null;
  const d = daysBetween(today, warrantyTill);
  if (d === 0) return 0;
  if (d > 0 && d <= 7) return 7;
  if (d > 7 && d <= 30) return 30;
  return null;
}

export const ASSET_TRANSITIONS: Record<string, string[]> = {
  IN_STOCK: ['ASSIGNED', 'UNDER_REPAIR', 'RETIRED', 'LOST'],
  ASSIGNED: ['RETURNED', 'UNDER_REPAIR', 'LOST'],
  RETURNED: ['IN_STOCK', 'UNDER_REPAIR', 'RETIRED', 'LOST'],
  UNDER_REPAIR: ['IN_STOCK', 'ASSIGNED', 'LOST'],
  RETIRED: ['LOST'],
  LOST: [],
};
export function canAssetMove(from: string, to: string): boolean {
  return (ASSET_TRANSITIONS[from] ?? []).includes(to);
}

// ── Welcome kits ───────────────────────────────────────────────────────────

export function kitStatus(lines: { issued: boolean }[]): 'PENDING' | 'PARTIAL' | 'ISSUED' {
  const n = lines.filter((l) => l.issued).length;
  if (!lines.length || n === 0) return 'PENDING';
  return n === lines.length ? 'ISSUED' : 'PARTIAL';
}

export function stockKey(sizes: string[], size: string | null | undefined): string {
  return sizes.length ? (size ?? '') : '_';
}

// ── ID cards ───────────────────────────────────────────────────────────────

export function idCardMissing(e: { photoFileId?: string | null; bloodGroup?: string | null; designation?: string | null; fullName?: string | null }, requireBloodGroup: boolean): string[] {
  const m: string[] = [];
  if (!e.photoFileId) m.push('employee.photo');
  if (requireBloodGroup && !e.bloodGroup) m.push('employee.blood_group');
  if (!e.designation) m.push('employee.designation');
  if (!e.fullName) m.push('employee.full_name');
  return m;
}

export const MISSING_LABELS: Record<string, string> = {
  'employee.photo': 'photo',
  'employee.blood_group': 'blood group',
  'employee.designation': 'designation',
  'employee.full_name': 'name',
};

// ── Visiting card ──────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

export function buildVcf(c: { name: string; org: string; title?: string | null; email: string; phone?: string | null; url?: string | null; address?: string | null; linkedin?: string | null }): string {
  const parts = c.name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
  const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1');
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(c.name)}`,
    `N:${esc(last ?? '')};${esc(first ?? '')};;;`,
    `ORG:${esc(c.org)}`,
    ...(c.title ? [`TITLE:${esc(c.title)}`] : []),
    `EMAIL;TYPE=WORK,INTERNET:${c.email}`,
    ...(c.phone ? [`TEL;TYPE=WORK,CELL:${c.phone}`] : []),
    ...(c.url ? [`URL:${c.url}`] : []),
    ...(c.address ? [`ADR;TYPE=WORK:;;${esc(c.address)};;;;`] : []),
    ...(c.linkedin ? [`X-SOCIALPROFILE;TYPE=linkedin:${c.linkedin}`] : []),
    'END:VCARD',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** wa.me deep link for sharing the card (phone digits only; empty = picker). */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  const p = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}

// ── Compensation split (offer Annexure A when Payroll has no structure yet) ─

/**
 * Split an annual CTC into the wireframe's components: employer PF is 12% of basic capped
 * at ₹1,800/month; the rest is gross, split Basic 50% · HRA 25% · Special allowance 25%.
 * ₹10,29,600 → Basic 42,000 · HRA 21,000 · Special 21,000 · PF 1,800 · CTC 85,800 a month.
 */
export function splitCtc(annualPaise: number): { code: string; label: string; monthlyPaise: number; annualPaise: number }[] {
  const monthly = Math.round(annualPaise / 12);
  let pf = 180_000;
  let gross = monthly - pf;
  if (Math.round(gross * 0.5 * 0.12) < pf) {
    // Low salaries: PF = 12% of basic where basic = 50% of gross → gross = monthly / 1.06
    gross = Math.round(monthly / 1.06);
    pf = monthly - gross;
  }
  const basic = Math.round(gross * 0.5);
  const hra = Math.round(gross * 0.25);
  const special = gross - basic - hra;
  const rows = [
    { code: 'BASIC', label: 'Basic', monthlyPaise: basic },
    { code: 'HRA', label: 'HRA', monthlyPaise: hra },
    { code: 'SPECIAL', label: 'Special allowance', monthlyPaise: special },
    { code: 'PF_ER', label: 'PF (employer)', monthlyPaise: pf },
  ];
  return rows.map((r) => ({ ...r, annualPaise: r.monthlyPaise * 12 }));
}

/** Loose holder-name match for bank details (token overlap), flags for HR attention. */
export function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter((x) => x.length > 1);
  const A = new Set(norm(a));
  const B = norm(b);
  if (!A.size || !B.length) return false;
  const hit = B.filter((x) => A.has(x)).length;
  return hit / Math.max(A.size, B.length) >= 0.5;
}
