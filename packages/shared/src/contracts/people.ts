import { z } from 'zod';

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
export type ImportRowError = { row: number; field?: string; message: string };
export type ImportPreview = {
  id: string;
  filename: string;
  totalRows: number;
  validRows: number;
  errors: ImportRowError[];
  preview: { row: number; fullName: string; officialEmail: string; department: string; employmentType: string; ok: boolean }[];
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
  panNumber: z.string().trim().toUpperCase(),
  panFileId: id,
  aadhaarNumber: noSpaces,
  aadhaarFileId: id,
  marksheetFileIds: z.array(id).min(1, 'Upload at least one education marksheet'),
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
  uan: z.string().trim().optional().nullable(),
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
export const interviewResultSchema = z.object({ result: z.enum(INTERVIEW_RESULTS) });
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
export const idCardElementSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['TEXT', 'PHOTO', 'QR', 'LOGO', 'STATIC', 'SHAPE', 'SIGNATURE']),
  label: z.string().optional(),
  binding: z.enum(IDCARD_BINDINGS).optional().nullable(),
  text: z.string().max(200).optional().nullable(),
  xMm: z.number().min(-5).max(100),
  yMm: z.number().min(-5).max(100),
  wMm: z.number().min(1).max(100),
  hMm: z.number().min(1).max(100),
  font: z
    .object({
      size: z.number().min(4).max(40).default(10),
      weight: z.enum(['normal', 'bold']).default('normal'),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#201f1d'),
      align: z.enum(['left', 'center', 'right']).default('center'),
      family: z.enum(['serif', 'sans']).default('sans'),
    })
    .optional(),
  fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  z: z.number().int().default(0),
});
export type IdCardElement = z.infer<typeof idCardElementSchema>;
export const idCardTemplateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  orientation: z.enum(['PORTRAIT', 'LANDSCAPE']).default('PORTRAIT'),
  front: z.array(idCardElementSchema).max(40),
  back: z.array(idCardElementSchema).max(40),
  frontBgFileId: z.string().optional().nullable(),
  backBgFileId: z.string().optional().nullable(),
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
