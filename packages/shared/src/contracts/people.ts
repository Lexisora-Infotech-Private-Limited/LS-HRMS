import { z } from 'zod';
import { TEXT_CASES } from './text-case';

/**
 * Shared request/response contracts for the People domain: employees, masters, profile,
 * vault, onboarding + e-sign, recruitment, appraisals, assets, welcome kits, ID cards and
 * visiting cards. Validated server-side with ZodPipe; types used by the web.
 */

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const optDate = dateStr.optional().nullable();
const optStr = z.string().trim().optional().nullable();
const id = z.string().min(1);
const noSpaces = z.string().transform((s) => s.replace(/\s+/g, ''));

// ── Enums (mirrored in prisma) ─────────────────────────────────────────────
export const PEOPLE_EMPLOYMENT_TYPES = ['FULL_TIME', 'INTERN', 'CONTRACT'] as const;
export const PEOPLE_WORK_MODES = ['OFFICE', 'REMOTE', 'HYBRID'] as const;
export const EMPLOYEE_TABS = ['all', 'full_time', 'interns', 'notice', 'exited'] as const;
export const EXIT_TYPES = ['RESIGNATION', 'TERMINATION', 'END_OF_INTERNSHIP', 'ABSCONDING', 'RETIREMENT'] as const;
export const PEOPLE_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export const PEOPLE_WORK_MODE_LABELS: Record<(typeof PEOPLE_WORK_MODES)[number], string> = {
  OFFICE: 'Office',
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
};
export const PEOPLE_EMPLOYMENT_TYPE_LABELS: Record<(typeof PEOPLE_EMPLOYMENT_TYPES)[number], string> = {
  FULL_TIME: 'Full-time',
  INTERN: 'Intern',
  CONTRACT: 'Contract',
};
export const EXIT_TYPE_LABELS: Record<(typeof EXIT_TYPES)[number], string> = {
  RESIGNATION: 'Resignation',
  TERMINATION: 'Termination',
  END_OF_INTERNSHIP: 'End of internship',
  ABSCONDING: 'Absconding',
  RETIREMENT: 'Retirement',
};

// ── Employees ──────────────────────────────────────────────────────────────
export const employeeListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().optional(),
  tab: z.enum(EMPLOYEE_TABS).default('all'),
  departmentId: z.string().optional(),
  workMode: z.enum(PEOPLE_WORK_MODES).optional(),
  managerId: z.string().optional(),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuery>;

export type EmployeeRow = {
  id: string;
  fullName: string;
  empCode: string;
  photoFileId: string | null;
  department: string | null;
  designation: string | null;
  workMode: 'OFFICE' | 'REMOTE' | 'HYBRID';
  manager: string | null;
  employmentType: string;
  status: string;
  statusLabel: string;
  officialEmail: string;
};
export type EmployeeCounts = Record<(typeof EMPLOYEE_TABS)[number], number>;

export const createEmployeeSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  officialEmail: z.string().trim().toLowerCase().email('Enter a valid official email'),
  personalEmail: z.string().trim().toLowerCase().email('Enter a valid personal email').optional().nullable(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{10,18}$/, 'Enter a valid phone number'),
  departmentId: id,
  designationId: id,
  managerId: z.string().optional().nullable(),
  employmentType: z.enum(PEOPLE_EMPLOYMENT_TYPES).default('FULL_TIME'),
  workMode: z.enum(PEOPLE_WORK_MODES).default('OFFICE'),
  joiningDate: dateStr,
  shiftId: z.string().optional().nullable(),
  workLocationId: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  photoFileId: z.string().optional().nullable(),
  empCodeOverride: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,20}$/, 'Use 3–20 letters, digits or dashes')
    .optional()
    .nullable(),
  skipOnboarding: z.boolean().optional().default(false),
  sendInvite: z.boolean().optional().default(true),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  personalEmail: z.string().trim().toLowerCase().email().optional().nullable(),
  phone: z.string().trim().regex(/^\+?[0-9 ()X-]{10,18}$/, 'Enter a valid phone number').optional(),
  departmentId: z.string().optional().nullable(),
  designationId: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  employmentType: z.enum(PEOPLE_EMPLOYMENT_TYPES).optional(),
  workMode: z.enum(PEOPLE_WORK_MODES).optional(),
  joiningDate: dateStr.optional(),
  shiftId: z.string().optional().nullable(),
  workLocationId: z.string().optional().nullable(),
  photoFileId: z.string().optional().nullable(),
  bloodGroup: z.string().optional().nullable(),
  dateOfBirth: optDate,
  gender: optStr,
  maritalStatus: optStr,
  address: optStr,
  emergencyContactName: optStr,
  emergencyContactPhone: optStr,
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

/** Fields an employee may change on their own profile. */
export const updateSelfSchema = z.object({
  phone: z.string().trim().regex(/^\+?[0-9 ()X-]{10,18}$/, 'Enter a valid phone number').optional(),
  personalEmail: z.string().trim().toLowerCase().email().optional().nullable(),
  bloodGroup: z.string().optional().nullable(),
  maritalStatus: optStr,
  address: optStr,
  emergencyContactName: optStr,
  emergencyContactPhone: optStr,
  photoFileId: z.string().optional().nullable(),
});
export type UpdateSelfInput = z.infer<typeof updateSelfSchema>;

export const startExitSchema = z.object({
  exitType: z.enum(EXIT_TYPES),
  resignationDate: dateStr,
  lastWorkingDay: optDate,
  reason: optStr,
});
export type StartExitInput = z.infer<typeof startExitSchema>;

export const completeExitSchema = z.object({ overrideReason: optStr });
export const exitChecklistItemSchema = z.object({ status: z.enum(['PENDING', 'DONE', 'NA']), note: optStr });
export const convertInternSchema = z.object({ effectiveDate: dateStr, designationId: id });

export type ExitChecklistItemDto = {
  key: string;
  label: string;
  ownerRole: string;
  blocking: boolean;
  auto: boolean;
  status: 'PENDING' | 'DONE' | 'NA';
  doneByName: string | null;
  doneAt: string | null;
  note: string | null;
};
export type ExitCaseDto = {
  id: string;
  exitType: string;
  resignationDate: string;
  lastWorkingDay: string;
  noticeShortfallDays: number;
  reason: string | null;
  status: string;
  items: ExitChecklistItemDto[];
  canComplete: boolean;
  blockers: string[];
};

// ── CSV import ─────────────────────────────────────────────────────────────
export const EMPLOYEE_CSV_HEADERS = [
  'full_name',
  'official_email',
  'phone',
  'department',
  'designation',
  'manager_email',
  'employment_type',
  'work_mode',
  'joining_date',
  'personal_email',
  'branch',
] as const;
/** The columns of the Excel / CSV employee import. Required columns have a red heading in the Excel template, optional ones black. */
export const EMPLOYEE_IMPORT_COLUMNS = [
  { key: 's_no', header: 'S.No', required: false, hint: 'Serial number of the row. It is shown next to any problem so you can find the row quickly. If you leave it empty, the row position is used.', example: '1' },
  { key: 'full_name', header: 'Full Name', required: true, hint: "The employee's full name", example: 'Aditya Kulkarni' },
  { key: 'official_email', header: 'Official Email', required: true, hint: 'Work email address. It must be unique.', example: 'aditya.kulkarni@company.com' },
  { key: 'phone', header: 'Phone', required: true, hint: 'At least 10 digits, for example +91 98250 11111', example: '+91 98250 11111' },
  { key: 'department', header: 'Department', required: true, hint: 'Must match a department name (choose from the list)', example: 'Development' },
  { key: 'designation', header: 'Designation', required: true, hint: 'Must match a designation name (choose from the list)', example: 'React Developer' },
  { key: 'joining_date', header: 'Joining Date', required: true, hint: 'DD-MM-YYYY or YYYY-MM-DD', example: '12-10-2026' },
  { key: 'manager_email', header: 'Manager Email', required: false, hint: 'Official email of the reporting manager. Optional.', example: 'neha.kapoor@company.com' },
  { key: 'employment_type', header: 'Employment Type', required: false, hint: 'Full-time (default), Intern or Contract', example: 'Full-time' },
  { key: 'work_mode', header: 'Work Mode', required: false, hint: 'Office (default), Remote or Hybrid', example: 'Office' },
  { key: 'personal_email', header: 'Personal Email', required: false, hint: 'Personal email address. Optional.', example: 'aditya.k@gmail.com' },
  { key: 'branch', header: 'Branch', required: false, hint: 'Must match a branch name if given. Optional.', example: 'Ahmedabad' },
] as const;
export type ImportRowError = { row: number; sNo?: string; field?: string; message: string };
export type ImportPreview = {
  id: string;
  filename: string;
  totalRows: number;
  validRows: number;
  errors: ImportRowError[];
  preview: { row: number; sNo?: string; fullName: string; officialEmail: string; department: string; employmentType: string; ok: boolean }[];
  status: string;
  importedRows: number;
};
export const importCommitSchema = z.object({
  sendInvites: z.boolean().default(true),
  createMissingMasters: z.boolean().default(false),
});

// ── Masters ────────────────────────────────────────────────────────────────
export const departmentSchema = z.object({
  name: z.string().trim().min(2).max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}$/, 'Code is 2 to 6 uppercase letters')
    .optional()
    .nullable(),
  leadEmployeeId: z.string().optional().nullable(),
});
export const designationSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const branchSchema = z.object({ name: z.string().trim().min(2).max(60), address: optStr });
export const interviewRoundSchema = z.object({
  name: z.string().trim().min(2).max(60),
  defaultDurationMin: z.coerce.number().int().min(15).max(480).default(60),
  criteria: z.array(z.string().trim().min(2)).default([]),
});
export const assetCategorySchema = z.object({ name: z.string().trim().min(2).max(60), requiresSerial: z.boolean().default(true) });
export const kitItemSchema = z.object({
  name: z.string().trim().min(2).max(60),
  sizes: z.array(z.string().trim().min(1)).default([]),
  stock: z.record(z.coerce.number().int()).default({}),
  lowStockThreshold: z.coerce.number().int().min(0).default(5),
  isActive: z.boolean().default(true),
});
export type PeopleMasterRow = { id: string; name: string; code?: string | null; address?: string | null; lead?: string | null; leadEmployeeId?: string | null; employees: number; extra?: Record<string, unknown> };

// ── Profile ────────────────────────────────────────────────────────────────
export const PROFILE_TABS = ['overview', 'documents', 'assets', 'pay', 'attendance', 'devices'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export type ProfileDto = {
  id: string;
  isSelf: boolean;
  fullName: string;
  initials: string;
  photoFileId: string | null;
  empCode: string;
  designation: string | null;
  designationId: string | null;
  department: string | null;
  departmentId: string | null;
  manager: string | null;
  managerId: string | null;
  branchId: string | null;
  workMode: 'OFFICE' | 'REMOTE' | 'HYBRID';
  employmentType: string;
  status: string;
  statusLabel: string;
  joiningDate: string | null;
  badges: string[];
  moreBadges: number;
  visibleTabs: ProfileTab[];
  canEdit: boolean;
  canEditSelf: boolean;
  canLifecycle: boolean;
  exitedOn: string | null;
  overview: { label: string; value: string }[];
  editable: Record<string, unknown>;
  exitCase: ExitCaseDto | null;
};

export type ProfileDocumentRow = { id: string; title: string; category: string; categoryLabel: string; docType: string; status: string; statusLabel: string; uploadedAt: string; fileId: string; rejectionReason: string | null; canVerify: boolean };
export type ProfileAssetRow = { id: string; item: string; serial: string; assigned: string; status: string; statusLabel: string; acknowledged?: boolean; assignmentId?: string };
export type ProfilePayRow = { component: string; monthlyPaise: number; annualPaise: number; isTotal?: boolean };
export type ProfileAttendanceRow = { month: string; present: number; leave: number; idleMinutes: number; late: number };

// ── Vault / documents ──────────────────────────────────────────────────────
export const DOC_CATEGORIES = ['OFFER_COMPENSATION', 'GOVERNMENT_ID', 'EDUCATION', 'EMPLOYMENT', 'LEGAL', 'BANK_TAX', 'CAREER', 'EXIT', 'CERTIFICATE', 'OTHER'] as const;
export const DOC_CATEGORY_LABELS: Record<(typeof DOC_CATEGORIES)[number], string> = {
  OFFER_COMPENSATION: 'Offer & compensation',
  GOVERNMENT_ID: 'Government ID',
  EDUCATION: 'Education',
  EMPLOYMENT: 'Employment',
  LEGAL: 'Legal',
  BANK_TAX: 'Bank & tax',
  CAREER: 'Career',
  EXIT: 'Exit',
  CERTIFICATE: 'Certificates',
  OTHER: 'Other',
};
export const DOC_TYPES = [
  'OFFER_LETTER', 'NDA', 'COMPENSATION_BREAKDOWN', 'PAN', 'AADHAAR', 'PASSPORT', 'MARKSHEET_10', 'MARKSHEET_12', 'DEGREE', 'PREV_EMPLOYMENT',
  'RELIEVING_LETTER', 'EXPERIENCE_LETTER', 'CANCELLED_CHEQUE', 'RESUME', 'POLICY_ACK', 'CERTIFICATE', 'OTHER',
] as const;
export type PeopleDocType = (typeof DOC_TYPES)[number];
/** Document types an employee can upload from the vault ("Folder / category"). */
export const VAULT_UPLOAD_TYPES: { value: PeopleDocType; label: string }[] = [
  { value: 'PAN', label: 'Government ID · PAN card' },
  { value: 'AADHAAR', label: 'Government ID · Aadhaar card' },
  { value: 'PASSPORT', label: 'Government ID · Passport' },
  { value: 'MARKSHEET_10', label: 'Education · 10th marksheet' },
  { value: 'MARKSHEET_12', label: 'Education · 12th marksheet' },
  { value: 'DEGREE', label: 'Education · Degree / marksheets' },
  { value: 'PREV_EMPLOYMENT', label: 'Employment · Previous employment letter' },
  { value: 'EXPERIENCE_LETTER', label: 'Employment · Experience letter' },
  { value: 'CANCELLED_CHEQUE', label: 'Bank & tax · Cancelled cheque' },
  { value: 'RESUME', label: 'Career · Resume' },
  { value: 'CERTIFICATE', label: 'Certificates · Certificate' },
  { value: 'OTHER', label: 'Other' },
];
export const vaultUploadSchema = z.object({
  docType: z.enum(DOC_TYPES),
  fileId: id,
  title: optStr,
  tags: z.string().trim().optional().nullable(),
});
export type VaultUploadInput = z.infer<typeof vaultUploadSchema>;
export const vaultVerifySchema = z.object({
  decision: z.enum(['VERIFIED', 'REJECTED']),
  reason: z.string().trim().max(300).optional().nullable(),
});
export type VaultRow = { id: string; title: string; category: string; categoryLabel: string; docType: string; uploadedAt: string; status: string; statusLabel: string; fileId: string; rejectionReason: string | null; canDelete: boolean; version: number };

// ── Onboarding ─────────────────────────────────────────────────────────────
export const ONBOARDING_STEP_KEYS = ['offer', 'nda', 'docs', 'bank', 'kit'] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];
export const ONBOARDING_STEP_LABELS: Record<OnboardingStepKey, string> = {
  offer: 'Offer letter',
  nda: 'NDA',
  docs: 'Personal documents',
  bank: 'Bank & tax',
  kit: 'Welcome kit',
};
export const TSHIRT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;

export const esignSchema = z
  .object({
    signatureType: z.enum(['DRAWN', 'TYPED']),
    drawnPng: z.string().max(280_000, 'Signature image is too large').optional().nullable(),
    typedName: z.string().trim().max(80).optional().nullable(),
    typedFont: z.enum(['Times-Italic', 'Helvetica-Oblique', 'Courier-Oblique']).optional().nullable(),
    consent: z.literal(true, { errorMap: () => ({ message: 'Tick “I have read and agree to this document” to sign' }) }),
  })
  .refine((v) => (v.signatureType === 'DRAWN' ? !!v.drawnPng && v.drawnPng.startsWith('data:image/png;base64,') : !!v.typedName && v.typedName.length >= 2), {
    message: 'Draw or type your signature',
  });
export type EsignInput = z.infer<typeof esignSchema>;

export const docsStepSchema = z.object({
  // PAN / Aadhaar / marksheets are optional so a resubmit can carry only the rejected documents;
  // the service enforces which ones are actually required from the vault state.
  panNumber: z.string().trim().toUpperCase().optional(),
  panFileId: id.optional(),
  aadhaarNumber: noSpaces.optional(),
  aadhaarFileId: id.optional(),
  marksheetFileIds: z.array(id).optional(),
  prevEmploymentFileId: z.string().optional().nullable(),
  declaration: z.literal(true, { errorMap: () => ({ message: 'Confirm the declaration' }) }),
});
export type DocsStepInput = z.infer<typeof docsStepSchema>;
export const bankStepSchema = z.object({
  holderName: z.string().trim().min(2),
  accountNumber: noSpaces,
  confirmAccountNumber: noSpaces,
  ifsc: z.string().trim().toUpperCase(),
  taxRegime: z.enum(['NEW', 'OLD']).default('NEW'),
  uan: z.string().trim().regex(/^(\d{12})?$/, 'UAN must be exactly 12 digits').optional().nullable(),
  chequeFileId: z.string().optional().nullable(),
});
export type BankStepInput = z.infer<typeof bankStepSchema>;
export const kitStepSchema = z.object({
  tshirtSize: z.enum(TSHIRT_SIZES),
  delivery: z.enum(['HANDOVER', 'SHIPPED']).default('HANDOVER'),
  address: optStr,
});
export type KitStepInput = z.infer<typeof kitStepSchema>;
export const peopleReasonSchema = z.object({ reason: z.string().trim().min(2, 'Give a reason').max(500) });
export const peopleOptionalReasonSchema = z.object({ reason: z.string().trim().max(500).optional().nullable() });

export type OnboardingStepDto = {
  key: OnboardingStepKey;
  order: number;
  label: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'NEEDS_ATTENTION' | 'SKIPPED';
  note: string | null;
  completedAt: string | null;
  envelopeId: string | null;
  data: Record<string, unknown> | null;
};
export type OnboardingDto = {
  id: string;
  employeeId: string;
  employeeName: string;
  empCode: string;
  designation: string | null;
  joiningDate: string | null;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'COMPLETED' | 'CANCELLED';
  steps: OnboardingStepDto[];
  currentStep: OnboardingStepKey | null;
  canFinish: boolean;
  incomplete: OnboardingStepKey[];
  submittedAt: string | null;
  completedAt: string | null;
  bankVerified: boolean;
  documents: VaultRow[];
  workMode: string;
  offerDoc: { title: string; body: string };
  ndaDoc: { title: string; body: string };
};
export type OnboardingListRow = {
  employeeId: string;
  name: string;
  empCode: string;
  joiningDate: string | null;
  stepsDone: number;
  docsPending: number;
  bank: string;
  status: string;
  statusLabel: string;
};
export const onboardingTemplatesSchema = z.object({
  offerBody: z.string().trim().min(20).max(4000),
  ndaBody: z.string().trim().min(20).max(4000),
  signatoryName: z.string().trim().min(2).max(80),
  signatoryTitle: z.string().trim().min(2).max(80),
});
export type OnboardingTemplates = z.infer<typeof onboardingTemplatesSchema>;

export type EnvelopeDto = {
  id: string;
  title: string;
  purpose: string;
  status: string;
  signerName: string;
  signedAt: string | null;
  signedSha256: string | null;
  originalSha256: string;
  events: { type: string; at: string; ip: string | null; actorEmail: string | null }[];
};

// ── Recruitment ────────────────────────────────────────────────────────────
export const JOB_TYPES = ['FULL_TIME', 'INTERNSHIP', 'CONTRACT', 'PART_TIME'] as const;
export const JOB_TYPE_LABELS: Record<(typeof JOB_TYPES)[number], string> = {
  FULL_TIME: 'Full-time',
  INTERNSHIP: 'Internship',
  CONTRACT: 'Contract',
  PART_TIME: 'Part-time',
};
export const JOB_STATUSES = ['DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED'] as const;
export const jobSchema = z.object({
  title: z.string().trim().min(2, 'Enter the position').max(100),
  departmentId: id,
  designationId: z.string().optional().nullable(),
  jobType: z.enum(JOB_TYPES).default('FULL_TIME'),
  openings: z.coerce.number().int().min(1, 'At least one opening').max(500),
  branchId: z.string().optional().nullable(),
  description: z.string().trim().max(8000).optional().nullable(),
  experienceMinYrs: z.coerce.number().int().min(0).max(40).optional().nullable(),
  experienceMaxYrs: z.coerce.number().int().min(0).max(40).optional().nullable(),
  hiringManagerId: z.string().optional().nullable(),
  roundNames: z.array(z.string()).default([]),
  status: z.enum(['DRAFT', 'OPEN']).default('OPEN'),
});
export type JobInput = z.infer<typeof jobSchema>;
export const jobStatusSchema = z.object({ status: z.enum(JOB_STATUSES), reason: optStr });
export type JobRow = { id: string; code: string; title: string; department: string; departmentId: string; jobType: string; typeLabel: string; openings: number; branch: string; applicants: number; hired: number; status: string; statusLabel: string; description: string | null };

export const CANDIDATE_SOURCES = ['LINKEDIN', 'REFERRAL', 'NAUKRI', 'CAMPUS', 'CAREERS_PAGE', 'AGENCY', 'WALK_IN', 'OTHER'] as const;
export const CANDIDATE_SOURCE_LABELS: Record<(typeof CANDIDATE_SOURCES)[number], string> = {
  LINKEDIN: 'LinkedIn',
  REFERRAL: 'Referral',
  NAUKRI: 'Naukri',
  CAMPUS: 'Campus',
  CAREERS_PAGE: 'Careers page',
  AGENCY: 'Agency',
  WALK_IN: 'Walk-in',
  OTHER: 'Other',
};
export const APPLICATION_STAGES = ['SCREENING', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED', 'OFFER_DECLINED', 'WITHDRAWN'] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export const CANDIDATE_TABS = ['all', 'screening', 'interview', 'offered', 'rejected'] as const;
export const candidateSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the candidate name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{10,18}$/, 'Enter a valid phone number'),
  jobId: id,
  source: z.enum(CANDIDATE_SOURCES),
  resumeFileId: z.string().min(1, 'Attach the resume'),
  referredByEmployeeId: z.string().optional().nullable(),
  currentCtcPaise: z.coerce.number().int().min(0).optional().nullable(),
  expectedCtcPaise: z.coerce.number().int().min(0).optional().nullable(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  totalExpYears: z.coerce.number().min(0).max(50).optional().nullable(),
  location: optStr,
  tags: z.string().trim().optional().nullable(),
  consent: z.boolean().optional(),
});
export type CandidateInput = z.infer<typeof candidateSchema>;
export const stageChangeSchema = z.object({ to: z.enum(APPLICATION_STAGES), reason: optStr });
export const addApplicationSchema = z.object({ jobId: id });
export const jobOfferSchema = z.object({
  designationId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  employmentType: z.enum(PEOPLE_EMPLOYMENT_TYPES).default('FULL_TIME'),
  annualCtcPaise: z.coerce.number().int().min(1, 'Enter the annual CTC'),
  joiningDate: dateStr,
  expiresOn: dateStr,
});
export type JobOfferInput = z.infer<typeof jobOfferSchema>;
export const hireSchema = z.object({
  officialEmail: z.string().trim().toLowerCase().email('Enter the official email'),
  managerId: z.string().optional().nullable(),
  workMode: z.enum(PEOPLE_WORK_MODES).default('OFFICE'),
  shiftId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  designationId: z.string().optional().nullable(),
  joiningDate: dateStr.optional().nullable(),
});
export type HireInput = z.infer<typeof hireSchema>;
export type CandidateRow = { applicationId: string; candidateId: string; name: string; email: string; appliedFor: string; jobId: string; source: string; sourceLabel: string; score: number | null; stage: string; stageLabel: string; resumeFileId: string | null };
export type CandidateDetail = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  location: string | null;
  source: string;
  sourceLabel: string;
  tags: string[];
  resumeFileId: string | null;
  currentCtcPaise: number | null;
  expectedCtcPaise: number | null;
  noticePeriodDays: number | null;
  applications: {
    id: string;
    jobId: string;
    jobTitle: string;
    stage: string;
    stageLabel: string;
    score: number | null;
    employeeId: string | null;
    offer: { annualCtcPaise: number; joiningDate: string; expiresOn: string; status: string; designationId: string | null; departmentId: string | null; branchId: string | null; employmentType: string } | null;
    events: { from: string | null; to: string; by: string | null; reason: string | null; at: string }[];
    interviews: { id: string; round: string; when: string; interviewer: string; result: string; scores: { by: string; overall: number | null; recommendation: string | null; status: string }[] }[];
  }[];
  canManage: boolean;
  canHire: boolean;
};

export const INTERVIEW_MODES = ['VIDEO', 'IN_OFFICE', 'PHONE'] as const;
export const INTERVIEW_MODE_LABELS: Record<(typeof INTERVIEW_MODES)[number], string> = { VIDEO: 'Video', IN_OFFICE: 'In office', PHONE: 'Phone' };
export const INTERVIEW_RESULTS = ['PENDING', 'SELECTED', 'REJECTED', 'ON_HOLD'] as const;
export const scheduleInterviewSchema = z.object({
  applicationId: id,
  roundName: z.string().trim().min(2, 'Pick a round'),
  interviewerId: id,
  panelistIds: z.array(z.string()).default([]),
  date: dateStr,
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a time'),
  mode: z.enum(INTERVIEW_MODES).default('VIDEO'),
  durationMin: z.coerce.number().int().min(15).max(480).default(60),
  notesToCandidate: optStr,
});
export type ScheduleInterviewInput = z.infer<typeof scheduleInterviewSchema>;
export const rescheduleInterviewSchema = z.object({ date: dateStr, time: z.string().regex(/^\d{2}:\d{2}$/), durationMin: z.coerce.number().int().min(15).max(480).optional() });
export const RECOMMENDATIONS = ['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE'] as const;
export const scorecardSchema = z.object({
  ratings: z.array(z.object({ key: z.string(), label: z.string(), rating: z.coerce.number().int().min(1).max(5).nullable(), comment: z.string().max(1000).optional().nullable() })),
  overall: z.coerce.number().min(0).max(10).optional().nullable(),
  recommendation: z.enum(RECOMMENDATIONS).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  submit: z.boolean().default(true),
});
export type ScorecardInput = z.infer<typeof scorecardSchema>;
export const interviewResultSchema = z.object({
  result: z.enum(INTERVIEW_RESULTS),
  /** HR only: why a Selected/Rejected result is recorded while panel scorecards are still missing. */
  overrideReason: z.string().trim().min(5, 'Give a short reason (at least 5 characters)').max(300).optional().nullable(),
});
export type InterviewRow = { id: string; candidate: string; candidateId: string; applicationId: string; jobTitle: string; round: string; interviewer: string; interviewerIds: string[]; startsAt: string; when: string; mode: string; modeLabel: string; status: string; result: string; resultLabel: string; isPanelist: boolean; scorecardStatus: string | null };
export type InterviewDetail = InterviewRow & {
  durationMin: number;
  notesToCandidate: string | null;
  candidateEmail: string;
  resumeFileId: string | null;
  panelists: { employeeId: string; name: string; role: string; scorecard: { overall: number | null; recommendation: string | null; status: string } | null }[];
  myScorecard: { ratings: { key: string; label: string; rating: number | null; comment: string | null }[]; overall: number | null; recommendation: string | null; notes: string | null; status: string } | null;
  criteria: { key: string; label: string }[];
  canManage: boolean;
  suggestedResult: string | null;
  icsSequence: number;
};

// ── Appraisals ─────────────────────────────────────────────────────────────
export const APPRAISAL_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SELF_REVIEW: 'Self review',
  MANAGER_REVIEW: 'In review',
  CALIBRATION: 'Calibration',
  CLOSED: 'Closed',
};
export const appraisalCycleSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the cycle name').max(60),
    periodFrom: dateStr,
    periodTo: dateStr,
    templateId: id,
    selfReviewDue: optDate,
    managerReviewDue: optDate,
    minTenureDays: z.coerce.number().int().min(0).max(730).default(90),
    employmentTypes: z.array(z.enum(PEOPLE_EMPLOYMENT_TYPES)).default(['FULL_TIME']),
  })
  .refine((v) => v.periodTo >= v.periodFrom, { message: 'The end date must be after the start date', path: ['periodTo'] });
export type AppraisalCycleInput = z.infer<typeof appraisalCycleSchema>;
export const kraTemplateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  items: z
    .array(
      z.object({
        title: z.string().trim().min(2),
        description: z.string().trim().optional().nullable(),
        measurement: z.string().trim().optional().nullable(),
        weight: z.coerce.number().min(0).max(100),
      }),
    )
    .min(1, 'Add at least one KRA'),
  publish: z.boolean().default(false),
});
export type KraTemplateInput = z.infer<typeof kraTemplateSchema>;
export const addParticipantsSchema = z.object({ employeeIds: z.array(z.string()).default([]), departmentId: z.string().optional().nullable() });
export const updateParticipantSchema = z.object({ reviewerEmployeeId: z.string().optional(), templateId: z.string().optional() });
export const appraisalReviewSchema = z.object({
  ratings: z.record(z.object({ rating: z.coerce.number().int().min(1).max(5).nullable().optional(), comment: z.string().max(2000).optional().nullable() })),
  submit: z.boolean().default(false),
});
export type AppraisalReviewInput = z.infer<typeof appraisalReviewSchema>;
export const appraisalCalibrateSchema = z.object({ score: z.coerce.number().min(1).max(5), note: optStr });
export const appraisalAcknowledgeSchema = z.object({ comment: optStr });
export type AppraisalCycleRow = { id: string; name: string; period: string; reviewers: number; selfPct: number; managerPct: number; status: string; statusLabel: string; participants: number; templateId: string; templateName: string; periodFrom: string; periodTo: string; selfReviewDue: string; managerReviewDue: string };
export type ParticipantRow = { id: string; employeeId: string; employee: string; department: string | null; reviewer: string; reviewerEmployeeId: string; template: string; selfStatus: string; managerStatus: string; finalScore: number | null; band: string | null; status: string; eligible: boolean };
export type ReviewDetail = {
  id: string;
  cycleName: string;
  cycleStatus: string;
  employee: string;
  reviewer: string;
  isSelf: boolean;
  isReviewer: boolean;
  canCalibrate: boolean;
  items: { id: string; title: string; description: string | null; measurement: string | null; weight: number; selfRating: number | null; selfComment: string | null; managerRating: number | null; managerComment: string | null }[];
  selfStatus: string;
  managerStatus: string;
  selfScore: number | null;
  managerScore: number | null;
  finalScore: number | null;
  band: string | null;
  acknowledgedAt: string | null;
  employeeComment: string | null;
  showSelfToReviewer: boolean;
};

// ── Assets ─────────────────────────────────────────────────────────────────
export const ASSET_TABS = ['all', 'assigned', 'in_stock', 'under_repair', 'returned'] as const;
export const ASSET_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'DAMAGED'] as const;
export const assetSchema = z.object({
  name: z.string().trim().min(2, 'Enter the item').max(120),
  serialNo: z.string().trim().toUpperCase().max(60).optional().nullable(),
  warrantyTill: optDate,
  assignToId: z.string().optional().nullable(),
  assignedOn: optDate,
  categoryId: z.string().optional().nullable(),
  make: optStr,
  model: optStr,
  purchaseDate: optDate,
  purchaseCostPaise: z.coerce.number().int().min(0).optional().nullable(),
  vendor: optStr,
  branchId: z.string().optional().nullable(),
  condition: z.enum(ASSET_CONDITIONS).default('NEW'),
  notes: optStr,
});
export type AssetInput = z.infer<typeof assetSchema>;
export const assignAssetSchema = z.object({ employeeId: id, assignedOn: dateStr });
export const returnAssetSchema = z.object({ condition: z.enum(ASSET_CONDITIONS).default('GOOD'), notes: optStr, returnedOn: optDate });
export const inspectAssetSchema = z.object({ to: z.enum(['IN_STOCK', 'UNDER_REPAIR', 'RETIRED']) });
export const repairAssetSchema = z.object({ issue: z.string().trim().min(2), vendor: optStr, expectedBack: optDate });
export const repairCompleteSchema = z.object({ costPaise: z.coerce.number().int().min(0).optional().nullable() });
export const lostAssetSchema = z.object({ note: z.string().trim().min(2, 'Add a note') });
export type AssetRow = { id: string; assetTag: string; item: string; serialNo: string | null; assignedTo: string | null; assignedToId: string | null; assignedOn: string | null; warrantyTill: string | null; warrantyExpired: boolean; warrantyExpiringSoon: boolean; status: string; statusLabel: string; displayStatus: string; category: string | null };
export type AssetDetail = AssetRow & {
  make: string | null;
  model: string | null;
  purchaseDate: string | null;
  purchaseCostPaise: number | null;
  vendor: string | null;
  condition: string;
  notes: string | null;
  history: { at: string; text: string }[];
};

// ── Welcome kits ───────────────────────────────────────────────────────────
export const issueKitSchema = z.object({ employeeId: id, itemIds: z.array(z.string()).min(1, 'Pick at least one item'), issuedOn: dateStr, force: z.boolean().optional() });
export const kitLineSchema = z.object({ issued: z.boolean(), size: z.string().optional().nullable(), force: z.boolean().optional() });
export type KitRow = { id: string; employeeId: string; name: string; joined: string | null; status: string; tshirtSize: string | null; issuedBy: string | null; lines: { itemId: string; issued: boolean; size: string | null }[] };
export type KitItemDto = { id: string; name: string; sizes: string[]; stock: Record<string, number>; lowStockThreshold: number; isActive: boolean };

// ── ID cards ───────────────────────────────────────────────────────────────
export const IDCARD_BINDINGS = [
  'employee.full_name',
  'employee.emp_code',
  'employee.designation',
  'employee.department',
  'employee.blood_group',
  'employee.photo',
  'employee.emergency_contact',
  'employee.joining_date',
  'employee.dob',
  'employee.mobile',
  'employee.email',
  'employee.address',
  'employee.code_blood',
  'card.serial',
  'qr.verify_url',
  'tenant.name',
  'tenant.logo',
  'tenant.address',
  'settings.return_address',
  'settings.emergency_line',
] as const;
export type IdCardBinding = (typeof IDCARD_BINDINGS)[number];
/** How the employee's photo sits in its frame: zoom, and the point of the picture kept in view (0 = top / left, 50 = middle, 100 = bottom / right). */
export const idCardPhotoFrameSchema = z.object({
  /** FILL covers the frame (the picture's edges may be cut); FIT shows the whole picture inside it. */
  fit: z.enum(['FILL', 'FIT']).default('FILL'),
  zoom: z.number().min(100).max(400).default(100),
  fx: z.number().min(0).max(100).default(50),
  fy: z.number().min(0).max(100).default(20),
});
export type IdCardPhotoFrame = z.infer<typeof idCardPhotoFrameSchema>;
/** Faces sit near the top of most photos, so the default keeps the top of the picture in view. */
export const DEFAULT_ID_CARD_PHOTO_FRAME: IdCardPhotoFrame = { fit: 'FILL', zoom: 100, fx: 50, fy: 0 };
/** Where the photo is drawn inside its frame (mm, relative to the frame's top-left corner; the frame clips it). */
export function idCardPhotoPlacement(img: { w: number; h: number }, box: { w: number; h: number }, f: IdCardPhotoFrame): { x: number; y: number; w: number; h: number } {
  const s = (f.fit === 'FIT' ? Math.min(box.w / img.w, box.h / img.h) : Math.max(box.w / img.w, box.h / img.h)) * (f.zoom / 100);
  const w = img.w * s;
  const h = img.h * s;
  return { x: (box.w - w) * (f.fx / 100), y: (box.h - h) * (f.fy / 100), w, h };
}
/** Items on the same layer are drawn shapes first, then pictures and photos, then text, QR codes and logos, so a big photo never covers a name. */
export const idCardLayerRank = (type: string): number => (type === 'SHAPE' ? 0 : type === 'PHOTO' || type === 'IMAGE' ? 1 : 2);
export const idCardDrawOrder = <T extends { type: string; z?: number | null }>(els: T[]): T[] => [...els].sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || idCardLayerRank(a.type) - idCardLayerRank(b.type));
/** Whether a text item shrinks to fit its box: its own setting, else yes for employee fields and the logo's name fallback, no for typed text. */
export const idCardShrinks = (el: { type: string; binding?: string | null; shrink?: boolean | null }): boolean => el.shrink ?? ((el.type === 'TEXT' && !!el.binding) || el.type === 'LOGO');
/**
 * Fonts an ID card can use. Each one is installed on the server and loaded in the designer, so the printed card matches
 * the designer. `avg` is the average letter width (in em) used to wrap and fit text.
 */
export const ID_CARD_FONTS = {
  sans: { label: 'Arial', css: "Arial, 'Liberation Sans', Helvetica, sans-serif", avg: 0.52 },
  serif: { label: 'Times New Roman', css: "'Times New Roman', 'Liberation Serif', Times, serif", avg: 0.52 },
  courier: { label: 'Courier New', css: "'Courier New', 'Liberation Mono', Courier, monospace", avg: 0.6 },
  calibri: { label: 'Calibri', css: "Calibri, Carlito, 'Segoe UI', sans-serif", avg: 0.49 },
  cambria: { label: 'Cambria', css: "Cambria, Caladea, Georgia, serif", avg: 0.52 },
  opensans: { label: 'Open Sans', css: "'Open Sans', sans-serif", avg: 0.55 },
  roboto: { label: 'Roboto', css: "Roboto, sans-serif", avg: 0.5 },
  lato: { label: 'Lato', css: "Lato, sans-serif", avg: 0.5 },
} as const;
export type IdCardFontKey = keyof typeof ID_CARD_FONTS;
export const idCardFontCss = (k: string | null | undefined): string => (ID_CARD_FONTS as Record<string, { css: string }>)[k ?? 'sans']?.css ?? ID_CARD_FONTS.sans.css;
export const idCardFontAvg = (k: string | null | undefined): number => (ID_CARD_FONTS as Record<string, { avg: number }>)[k ?? 'sans']?.avg ?? 0.52;
export const ID_CARD_FONT_KEYS = ['sans', 'serif', 'courier', 'calibri', 'cambria', 'opensans', 'roboto', 'lato'] as const;
export const idCardElementSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['TEXT', 'PHOTO', 'QR', 'LOGO', 'STATIC', 'SHAPE', 'SIGNATURE', 'IMAGE']),
  label: z.string().optional(),
  binding: z.enum(IDCARD_BINDINGS).optional().nullable(),
  text: z.string().max(400).optional().nullable(),
  /** TEXT / STATIC: letter case applied to the final text (as saved, UPPERCASE, lowercase, Title Case). */
  textCase: z.enum(TEXT_CASES).optional().nullable(),
  /** TEXT / STATIC: where the text sits in a tall box (default MIDDLE). */
  valign: z.enum(['TOP', 'MIDDLE', 'BOTTOM']).optional().nullable(),
  /** TEXT / STATIC: shrink the text so it fits its box (default: on for employee fields such as names, off for typed text). */
  shrink: z.boolean().optional().nullable(),
  /** PHOTO: how the picture is framed. */
  photo: idCardPhotoFrameSchema.optional().nullable(),
  /** IMAGE: a picture the company uploaded (an icon, a logo variant…). */
  fileId: z.string().optional().nullable(),
  xMm: z.number().min(-5).max(100),
  yMm: z.number().min(-5).max(100),
  wMm: z.number().min(0.2).max(100),
  hMm: z.number().min(0.2).max(100),
  font: z
    .object({
      size: z.number().min(4).max(40).default(10),
      weight: z.enum(['normal', 'bold']).default('normal'),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#201f1d'),
      align: z.enum(['left', 'center', 'right']).default('center'),
      family: z.enum(ID_CARD_FONT_KEYS).default('sans'),
    })
    .optional(),
  fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  z: z.number().int().default(0),
});
export type IdCardElement = z.infer<typeof idCardElementSchema>;
/** How a card's background picture sits on the card: FILL covers it (may crop), FIT shows it whole, STRETCH matches the card exactly; then zoom and move. */
export const idCardBgFitSchema = z.object({
  fit: z.enum(['FILL', 'FIT', 'STRETCH']).default('FILL'),
  zoom: z.number().min(50).max(300).default(100),
  x: z.number().min(-100).max(100).default(0),
  y: z.number().min(-100).max(100).default(0),
});
export type IdCardBgFit = z.infer<typeof idCardBgFitSchema>;
export const DEFAULT_ID_CARD_BG_FIT: IdCardBgFit = { fit: 'FILL', zoom: 100, x: 0, y: 0 };
/** Where the picture is drawn on the card, in mm (x / y can be negative or run past the card, the card clips it). */
export function idCardBgPlacement(img: { w: number; h: number }, card: { w: number; h: number }, f: IdCardBgFit): { x: number; y: number; w: number; h: number } {
  const z = f.zoom / 100;
  let w: number;
  let h: number;
  if (f.fit === 'STRETCH') {
    w = card.w * z;
    h = card.h * z;
  } else {
    const s = f.fit === 'FIT' ? Math.min(card.w / img.w, card.h / img.h) : Math.max(card.w / img.w, card.h / img.h);
    w = img.w * s * z;
    h = img.h * s * z;
  }
  return { x: (card.w - w) / 2 + (f.x / 100) * card.w, y: (card.h - h) / 2 + (f.y / 100) * card.h, w, h };
}
export const idCardTemplateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  orientation: z.enum(['PORTRAIT', 'LANDSCAPE']).default('PORTRAIT'),
  front: z.array(idCardElementSchema).max(40),
  back: z.array(idCardElementSchema).max(40),
  frontBgFileId: z.string().optional().nullable(),
  backBgFileId: z.string().optional().nullable(),
  frontBgFit: idCardBgFitSchema.optional().nullable(),
  backBgFit: idCardBgFitSchema.optional().nullable(),
  isDefault: z.boolean().optional(),
});
export type IdCardTemplateInput = z.infer<typeof idCardTemplateSchema>;
export type IdCardTemplateDto = IdCardTemplateInput & { id: string; widthMm: number; heightMm: number; version: number; isDefault: boolean };
export const idCardSettingsSchema = z.object({
  printVendorEmail: z.string().trim().email('Enter the print vendor email'),
  printVendorName: optStr,
  returnAddress: z.string().trim().max(200).optional().nullable(),
  emergencyLine: z.string().trim().max(60).optional().nullable(),
  autoGenerate: z.boolean().default(true),
  requireBloodGroup: z.boolean().default(true),
});
export type IdCardSettings = z.infer<typeof idCardSettingsSchema>;
export const generateCardsSchema = z.object({ cardIds: z.array(z.string()).optional(), allGeneratable: z.boolean().optional() });
export const printBatchSchema = z.object({ cardIds: z.array(z.string()).optional(), allReady: z.boolean().optional() });
export type IdCardRow = { id: string; employeeId: string; employee: string; empCode: string; template: string | null; status: string; statusLabel: string; missing: string[]; generatedAt: string | null; printBatch: string | null; serial: string };
export type IdCardPreviewData = Record<IdCardBinding, string | null>;

// ── Visiting card ──────────────────────────────────────────────────────────
export const vcardSettingsSchema = z.object({
  showPhone: z.boolean().optional(),
  workPhone: z.string().trim().max(20).optional().nullable(),
  linkedinUrl: z.string().trim().url('Enter a valid URL').optional().nullable().or(z.literal('')),
  isPublic: z.boolean().optional(),
});
export const vcardEmailSchema = z.object({
  to: z.array(z.string().trim().toLowerCase().email('Enter valid emails')).min(1, 'Add a recipient').max(10, 'Up to 10 recipients'),
  message: z.string().trim().max(1000).optional().nullable(),
});
export const vcardWhatsappSchema = z.object({ phone: z.string().trim().regex(/^\+?[0-9 ]{10,16}$/, 'Enter a valid WhatsApp number').optional().nullable().or(z.literal('')) });
export type VCardDto = {
  name: string;
  title: string;
  designation: string | null;
  department: string | null;
  email: string;
  phone: string | null;
  company: string;
  address: string | null;
  publicUrl: string;
  qrDataUrl: string;
  showPhone: boolean;
  workPhone: string | null;
  linkedinUrl: string | null;
  isPublic: boolean;
};

// ── Search / misc ──────────────────────────────────────────────────────────
export type PeopleUpcomingEvent = { type: 'BIRTHDAY' | 'ANNIVERSARY'; employeeId: string; name: string; date: string; label: string };

// ── List queries / extra DTOs (web ↔ api) ──────────────────────────────────
export const candidateListQuery = z.object({
  tab: z.enum(CANDIDATE_TABS).default('all'),
  q: z.string().trim().optional(),
  jobId: z.string().optional(),
});
export type CandidateListQuery = z.infer<typeof candidateListQuery>;
export const INTERVIEW_TABS = ['upcoming', 'past', 'all'] as const;
export const interviewListQuery = z.object({
  tab: z.enum(INTERVIEW_TABS).default('all'),
  mine: z.coerce.boolean().optional(),
});
export const assetListQuery = z.object({
  tab: z.enum(ASSET_TABS).default('all'),
  q: z.string().trim().optional(),
  categoryId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const cancelInterviewSchema = z.object({ reason: optStr });
export type KraTemplateDto = { id: string; name: string; version: number; status: string; items: { id: string; title: string; description: string | null; measurement: string | null; weight: number }[]; cycles: number };
export type MyReviewRow = { id: string; cycleName: string; cycleStatus: string; employee: string; role: 'SELF' | 'REVIEWER'; selfStatus: string; managerStatus: string; finalScore: number | null; band: string | null; due: string | null };
export type ProfileKitSummary = { issued: number; total: number; date: string | null } | null;
export type PeopleSearchHit = { type: string; id: string; title: string; subtitle?: string; link: string };
export const exitStatusSchema = z.object({ status: z.enum(['PENDING', 'DONE', 'NA']), note: optStr });
export const verifyBankSchema = z.object({ decision: z.enum(['VERIFIED', 'REJECTED']), reason: optStr });
export const reopenStepSchema = z.object({ key: z.enum(ONBOARDING_STEP_KEYS), reason: z.string().trim().min(2, 'Give a reason').max(500) });
export const kitSizeSchema = z.object({ tshirtSize: z.enum(TSHIRT_SIZES) });

// ── UI labels shared by web screens (phase 2) ──────────────────────────────
export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  OFFERED: 'Offered',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
  OFFER_DECLINED: 'Offer declined',
  WITHDRAWN: 'Withdrawn',
};
/** Allowed manual stage moves (HIRED only through "Convert to employee"). Mirrors people.rules STAGE_TRANSITIONS. */
export const APPLICATION_STAGE_TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  SCREENING: ['INTERVIEW', 'OFFERED', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['SCREENING', 'OFFERED', 'REJECTED', 'WITHDRAWN'],
  OFFERED: ['HIRED', 'OFFER_DECLINED', 'REJECTED', 'WITHDRAWN', 'INTERVIEW'],
  HIRED: [],
  REJECTED: ['SCREENING'],
  OFFER_DECLINED: ['SCREENING'],
  WITHDRAWN: ['SCREENING'],
};
export const CANDIDATE_REJECT_REASONS = ['Skills mismatch', 'Experience mismatch', 'Salary expectations', 'Culture fit', 'Position filled', 'Not reachable', 'Other'] as const;
export const INTERVIEW_RECOMMENDATION_LABELS: Record<(typeof RECOMMENDATIONS)[number], string> = {
  STRONG_HIRE: 'Strong hire',
  HIRE: 'Hire',
  NO_HIRE: 'No hire',
  STRONG_NO_HIRE: 'Strong no hire',
};
export const INTERVIEW_RESULT_LABELS: Record<string, string> = { PENDING: 'Pending', SELECTED: 'Selected', REJECTED: 'Rejected', ON_HOLD: 'On hold', CANCELLED: 'Cancelled', NO_SHOW: 'No-show' };
export const KRA_RATING_LABELS = ['Unsatisfactory', 'Needs improvement', 'Meets expectations', 'Exceeds expectations', 'Outstanding'] as const;
export const ASSET_CONDITION_LABELS: Record<(typeof ASSET_CONDITIONS)[number], string> = { NEW: 'New', GOOD: 'Good', FAIR: 'Fair', DAMAGED: 'Damaged' };
export const IDCARD_BINDING_LABELS: Record<IdCardBinding, string> = {
  'employee.full_name': 'Full name',
  'employee.emp_code': 'Employee ID',
  'employee.designation': 'Designation',
  'employee.department': 'Department',
  'employee.blood_group': 'Blood group',
  'employee.photo': 'Photo',
  'employee.emergency_contact': 'Emergency contact (personal)',
  'employee.joining_date': 'Joining date',
  'employee.dob': 'Date of birth',
  'employee.mobile': 'Mobile number',
  'employee.email': 'Email',
  'employee.address': 'Address',
  'employee.code_blood': 'Employee ID · Blood group',
  'card.serial': 'Card serial',
  'qr.verify_url': 'QR verify link',
  'tenant.name': 'Company name',
  'tenant.logo': 'Company logo',
  'tenant.address': 'Company address',
  'settings.return_address': 'Return address',
  'settings.emergency_line': 'Emergency line',
};
/** Typed text on an ID card can hold employee values as {{employee.dob}}; the editor shows and accepts them as [Date of birth]. */
const IDCARD_LABEL_TO_KEY = new Map(Object.entries(IDCARD_BINDING_LABELS).map(([k, l]) => [l.toLowerCase(), k]));
export const idCardFieldLabel = (key: string): string => `[${(IDCARD_BINDING_LABELS as Record<string, string>)[key] ?? key}]`;
export const idCardTextToLabels = (text: string): string => text.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (m, k: string) => ((IDCARD_BINDING_LABELS as Record<string, string>)[k] ? idCardFieldLabel(k) : m));
export const idCardLabelsToText = (text: string): string => text.replace(/\[([^\][]{1,60})\]/g, (m, l: string) => (IDCARD_LABEL_TO_KEY.has(l.trim().toLowerCase()) ? `{{${IDCARD_LABEL_TO_KEY.get(l.trim().toLowerCase())}}}` : m));
/** Fill {{field}} in typed text from the card data (an unknown or empty field becomes blank). */
export const fillIdCardText = (text: string, data: Record<string, string | null | undefined>): string => text.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_, k: string) => data[k] ?? '');
/**
 * Lay typed card text out in its box (mm): when the box is tall enough for two lines the text wraps at word
 * boundaries (an address); otherwise a long line is shrunk to fit its width (a name). Used by both the editor and
 * the PNG / PDF renderer so they always agree.
 */
export function layoutIdCardText(raw: string, sizePt: number, wMm: number, hMm: number, shrink = true, avg = 0.52): { lines: string[]; sizePt: number } {
  const MM = 25.4 / 72;
  const width = (t: string, s: number) => t.length * s * avg * MM;
  const wrap = (s: number) => {
    const out: string[] = [];
    for (const para of raw.split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${word}` : word;
        if (cur && width(next, s) > wMm) {
          out.push(cur);
          cur = word;
        } else cur = next;
      }
      out.push(cur);
    }
    return out;
  };
  const lineH = (s: number) => s * MM * 1.25;
  // Not shrinking: the size is exactly what was chosen. The text wraps at the box width and may run past the box's height.
  if (!shrink) return { lines: wrap(sizePt), sizePt };
  if (hMm >= lineH(sizePt) * 2 - 0.01) {
    for (let s = sizePt; s >= 5; s = Math.round((s - 0.5) * 10) / 10) {
      const lines = wrap(s);
      if (lines.length * lineH(s) <= hMm + 0.01 || s <= 5) return { lines, sizePt: s };
    }
  }
  const lines = raw.split('\n');
  const fit = Math.min(...lines.map((l) => (!l || width(l, sizePt) <= wMm ? sizePt : Math.max(5, Math.floor(((sizePt * wMm) / width(l, sizePt)) * 10) / 10))));
  return { lines, sizePt: fit };
}
/** Indian FY half-year for a date: H1 = Apr–Sep, H2 = Oct–Mar ("H1 FY26-27"). */
export function suggestAppraisalCycle(d: string): { name: string; from: string; to: string } {
  const [y, m] = d.split('-').map(Number) as [number, number];
  const fyStart = m >= 4 ? y : y - 1;
  const fy = `FY${String(fyStart % 100).padStart(2, '0')}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  if (m >= 4 && m <= 9) return { name: `H1 ${fy}`, from: `${fyStart}-04-01`, to: `${fyStart}-09-30` };
  return { name: `H2 ${fy}`, from: `${fyStart}-10-01`, to: `${fyStart + 1}-03-31` };
}
