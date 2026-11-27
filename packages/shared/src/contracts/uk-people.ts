import { z } from 'zod';
import { UK_NI_NUMBER_RE, UK_STARTER_STATEMENTS, UK_STUDENT_LOAN_PLANS } from './uk-payroll';

/**
 * UK (region GB) People contracts: right to work checks and the UK versions of the
 * onboarding "Personal documents" and "Bank & tax" steps. India tenants never use these;
 * they keep docsStepSchema / bankStepSchema in people.ts.
 */

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const id = z.string().min(1);

// ── Right to work ───────────────────────────────────────────────────────────

/** How the check was done (Home Office guidance: three ways to check). */
export const RTW_METHODS = ['SHARE_CODE', 'IDSP', 'MANUAL'] as const;
export type RtwMethod = (typeof RTW_METHODS)[number];
export const RTW_METHOD_LABELS: Record<RtwMethod, string> = {
  SHARE_CODE: 'Online check (share code)',
  IDSP: 'Digital ID check (IDSP)',
  MANUAL: 'Manual document check',
};
export const RTW_METHOD_HELP: Record<RtwMethod, string> = {
  SHARE_CODE:
    'For eVisa holders and the EU Settlement Scheme. The worker gives you a 9-character share code and date of birth; you check it on GOV.UK "View a job applicant\'s right to work details" and save the profile page as evidence.',
  IDSP:
    'For British and Irish citizens with a valid passport. A certified identity service provider checks the document digitally and sends you the result to keep.',
  MANUAL:
    'You see the original document (e.g. British or Irish passport, or birth certificate with NI number) with the worker present, check it is genuine, and keep a dated copy. Do it on or before the first day of work.',
};

export const RTW_RESULTS = ['UNLIMITED', 'TIME_LIMITED', 'NO_RIGHT'] as const;
export type RtwResult = (typeof RTW_RESULTS)[number];
export const RTW_RESULT_LABELS: Record<RtwResult, string> = {
  UNLIMITED: 'Unlimited right to work',
  TIME_LIMITED: 'Time-limited permission',
  NO_RIGHT: 'No right to work',
};

/** Common documents / statuses seen in a check (free text is also allowed). */
export const RTW_DOCUMENT_TYPES = [
  'British passport',
  'Irish passport',
  'Birth certificate + NI number',
  'eVisa',
  'EU Settlement Scheme · settled',
  'EU Settlement Scheme · pre-settled',
  'Skilled Worker visa',
  'Graduate visa',
  'Student visa',
  'Indefinite leave to remain',
  'Biometric residence permit (BRP)',
  'Other',
] as const;

/** Computed status of a person's right to work. */
export const RTW_STATUSES = ['CURRENT', 'FOLLOW_UP_DUE', 'EXPIRED', 'MISSING', 'NO_RIGHT'] as const;
export type RtwStatus = (typeof RTW_STATUSES)[number];
export const RTW_STATUS_LABELS: Record<RtwStatus, string> = {
  CURRENT: 'Checked',
  FOLLOW_UP_DUE: 'Re-check due',
  EXPIRED: 'Permission expired',
  MISSING: 'Not checked',
  NO_RIGHT: 'No right to work',
};
/** A follow-up check is "due soon" this many days before the re-check date. */
export const RTW_FOLLOW_UP_WINDOW_DAYS = 60;

/** Share code: 9 letters/digits, shown as "W4K 7RT 2PQ", stored without spaces. */
export const RTW_SHARE_CODE_RE = /^[A-Z0-9]{9}$/;
export const normaliseShareCode = (s: string | null | undefined): string => (s ?? '').toUpperCase().replace(/[\s-]/g, '');
export function formatShareCode(s: string | null | undefined): string {
  const c = normaliseShareCode(s);
  return c.length === 9 ? `${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6)}` : c;
}

const shareCodeField = z
  .string()
  .transform((s) => normaliseShareCode(s))
  .refine((s) => s === '' || RTW_SHARE_CODE_RE.test(s), 'A share code is 9 letters or numbers, e.g. W4K 7RT 2PQ');

export const rtwCheckSchema = z
  .object({
    employeeId: id,
    method: z.enum(RTW_METHODS),
    documentType: z.string().trim().min(2, 'Pick the document checked').max(120),
    shareCode: shareCodeField.optional().nullable(),
    result: z.enum(RTW_RESULTS),
    permissionExpiresOn: dateKey.optional().nullable(),
    /** Defaults to the permission end date. */
    followUpOn: dateKey.optional().nullable(),
    checkedOn: dateKey,
    sponsored: z.boolean().default(false),
    evidenceFileId: z.string().optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.method === 'SHARE_CODE' && !v.shareCode) ctx.addIssue({ code: 'custom', path: ['shareCode'], message: 'Enter the share code used for the online check' });
    if (v.result === 'TIME_LIMITED' && !v.permissionExpiresOn) ctx.addIssue({ code: 'custom', path: ['permissionExpiresOn'], message: 'Enter the date the permission ends' });
    if (v.permissionExpiresOn && v.permissionExpiresOn < v.checkedOn) ctx.addIssue({ code: 'custom', path: ['permissionExpiresOn'], message: 'The permission end date is before the check date' });
  });
export type RtwCheckInput = z.input<typeof rtwCheckSchema>;
export type RtwCheckData = z.infer<typeof rtwCheckSchema>;

export type RtwCheckDto = {
  id: string;
  employeeId: string;
  method: RtwMethod;
  methodLabel: string;
  documentType: string;
  shareCode: string | null;
  result: RtwResult;
  resultLabel: string;
  permissionExpiresOn: string | null;
  followUpOn: string | null;
  checkedOn: string;
  checkedBy: string | null;
  evidenceFileId: string | null;
  sponsored: boolean;
  notes: string | null;
  supersededAt: string | null;
  createdAt: string;
  /** Warnings worked out when the check was read (e.g. manual check after the start date). */
  warnings: string[];
};

export type RtwPersonRow = {
  employeeId: string;
  name: string;
  empCode: string;
  employeeStatus: string;
  joiningDate: string | null;
  check: RtwCheckDto | null;
  status: RtwStatus;
  statusLabel: string;
  /** Days until the re-check date (negative = overdue). */
  daysToFollowUp: number | null;
};

export type RtwList = {
  items: RtwPersonRow[];
  counts: { total: number; checked: number; followUpDue: number; missing: number; expired: number; noRight: number; sponsored: number };
};

export type RtwHistory = { employeeId: string; name: string; empCode: string; joiningDate: string | null; status: RtwStatus; statusLabel: string; checks: RtwCheckDto[] };

// ── UK onboarding steps ─────────────────────────────────────────────────────

export const UK_ID_DOCUMENTS = ['PASSPORT', 'PHOTO_ID'] as const;
export const UK_ID_DOCUMENT_LABELS: Record<(typeof UK_ID_DOCUMENTS)[number], string> = {
  PASSPORT: 'Passport',
  PHOTO_ID: 'Photo ID card (e.g. EU national ID)',
};
export const UK_NATIONALITY_GROUPS = ['BRITISH_IRISH', 'OTHER'] as const;
export const UK_NATIONALITY_LABELS: Record<(typeof UK_NATIONALITY_GROUPS)[number], string> = {
  BRITISH_IRISH: 'British or Irish citizen',
  OTHER: 'Other nationality (eVisa / EU Settlement Scheme)',
};

/** UK "Personal documents" step: passport or ID, right to work share code, optional extras. */
export const ukDocsStepSchema = z
  .object({
    idDocument: z.enum(UK_ID_DOCUMENTS).default('PASSPORT'),
    /** Optional on a resubmit when the ID already in the vault was not rejected. */
    idFileId: id.optional(),
    nationality: z.enum(UK_NATIONALITY_GROUPS),
    shareCode: shareCodeField.optional().nullable(),
    /** Optional proof of status (eVisa screenshot, BRP). */
    rtwProofFileId: z.string().optional().nullable(),
    addressProofFileId: z.string().optional().nullable(),
    qualificationFileIds: z.array(id).max(5).optional(),
    prevEmploymentFileId: z.string().optional().nullable(),
    declaration: z.literal(true, { errorMap: () => ({ message: 'Confirm the declaration' }) }),
  })
  .superRefine((v, ctx) => {
    if (v.nationality === 'OTHER' && !v.shareCode) ctx.addIssue({ code: 'custom', path: ['shareCode'], message: 'Enter your right to work share code (from GOV.UK "Prove your right to work")' });
  });
export type UkDocsStepInput = z.input<typeof ukDocsStepSchema>;
export type UkDocsStepData = z.infer<typeof ukDocsStepSchema>;

const digits = z.string().transform((s) => s.replace(/[\s-]/g, ''));

/** UK "Bank & tax" step: bank account, NI number and the HMRC starter checklist. */
export const ukBankStepSchema = z
  .object({
    holderName: z.string().trim().min(2, 'Enter the account holder name'),
    sortCode: digits.refine((s) => /^\d{6}$/.test(s), 'Sort code is 6 digits, e.g. 20-00-00'),
    accountNumber: digits.refine((s) => /^\d{8}$/.test(s), 'Account number is 8 digits'),
    confirmAccountNumber: digits,
    /** Optional: a new starter may still be waiting for one. */
    niNumber: z
      .string()
      .transform((s) => s.toUpperCase().replace(/\s+/g, ''))
      .refine((s) => s === '' || UK_NI_NUMBER_RE.test(s), 'Enter a valid National Insurance number, e.g. AB 12 34 56 C')
      .optional()
      .nullable(),
    starterStatement: z.enum(UK_STARTER_STATEMENTS, { errorMap: () => ({ message: 'Pick the starter checklist statement that applies to you' }) }),
    studentLoanPlans: z.array(z.enum(UK_STUDENT_LOAN_PLANS)).max(3).default([]),
    postgraduateLoan: z.boolean().default(false),
    /** P45 from the last job in this tax year (pence). */
    hasP45: z.boolean().default(false),
    previousPayPence: z.number().int().min(0).optional().nullable(),
    previousTaxPence: z.number().int().optional().nullable(),
    p45FileId: z.string().optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.accountNumber !== v.confirmAccountNumber) ctx.addIssue({ code: 'custom', path: ['confirmAccountNumber'], message: 'Account numbers do not match' });
  });
export type UkBankStepInput = z.input<typeof ukBankStepSchema>;
export type UkBankStepData = z.infer<typeof ukBankStepSchema>;

/** Vault upload choices for UK tenants (existing document types, UK titles). */
export const UK_VAULT_UPLOAD_TYPES: { key: string; docType: 'PASSPORT' | 'DEGREE' | 'PREV_EMPLOYMENT' | 'EXPERIENCE_LETTER' | 'RESUME' | 'CERTIFICATE' | 'OTHER'; label: string; title?: string }[] = [
  { key: 'PASSPORT', docType: 'PASSPORT', label: 'Identity · Passport' },
  { key: 'PHOTO_ID', docType: 'OTHER', label: 'Identity · Photo ID card', title: 'Photo ID card' },
  { key: 'RTW_PROOF', docType: 'OTHER', label: 'Right to work · eVisa / BRP / share code proof', title: 'Right to work proof' },
  { key: 'ADDRESS', docType: 'OTHER', label: 'Proof of address (utility bill, bank statement)', title: 'Proof of address' },
  { key: 'P45', docType: 'OTHER', label: 'Tax · P45 from previous employer', title: 'P45' },
  { key: 'DEGREE', docType: 'DEGREE', label: 'Education · Qualification certificate' },
  { key: 'PREV_EMPLOYMENT', docType: 'PREV_EMPLOYMENT', label: 'Employment · Previous employment letter' },
  { key: 'EXPERIENCE_LETTER', docType: 'EXPERIENCE_LETTER', label: 'Employment · Reference letter' },
  { key: 'RESUME', docType: 'RESUME', label: 'Career · CV' },
  { key: 'CERTIFICATE', docType: 'CERTIFICATE', label: 'Certificates · Certificate' },
  { key: 'OTHER', docType: 'OTHER', label: 'Other' },
];
