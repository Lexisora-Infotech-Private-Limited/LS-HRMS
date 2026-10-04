import { z } from 'zod';
import { paginationQuery } from '../api';

/**
 * Work domain contracts: clients, projects, team boards, tasks, GitLab, archive, interns.
 * Money = Int paise, durations = Int minutes, dates = "YYYY-MM-DD" (IST business day).
 */

// ── Enums & labels ─────────────────────────────────────────────────────────
export const TASK_STATUSES = ['OPEN', 'ALLOTTED', 'WIP', 'DEV_COMPLETED', 'QA', 'DONE', 'CANCELLED'] as const;
export type TaskStatusKey = (typeof TASK_STATUSES)[number];
/** Kanban columns in order (DONE is shown only with "Show done"). */
export const BOARD_COLUMNS = ['OPEN', 'ALLOTTED', 'WIP', 'DEV_COMPLETED', 'QA'] as const;
export const TASK_STATUS_LABELS: Record<TaskStatusKey, string> = {
  OPEN: 'Open',
  ALLOTTED: 'Alloted',
  WIP: 'WIP',
  DEV_COMPLETED: 'Dev Completed',
  QA: 'QA',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};
export const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED', 'CANCELLED'] as const;
export type ProjectStatusKey = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatusKey, string> = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
  CANCELLED: 'Cancelled',
};
export type ProjectHealthKey = 'NA' | 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK';
export const PROJECT_CATEGORIES = ['WEB', 'MOBILE', 'INTERNAL', 'OTHER'] as const;
export const PROJECT_CATEGORY_LABELS: Record<(typeof PROJECT_CATEGORIES)[number], string> = { WEB: 'Web', MOBILE: 'Mobile', INTERNAL: 'Internal', OTHER: 'Other' };
export const PROJECT_MEMBER_ROLES = ['LEAD', 'MEMBER', 'QA', 'DESIGN'] as const;
export const WORK_DOC_KINDS = ['REQUIREMENT', 'SCOPE', 'DESIGN', 'ASSET', 'CONTRACT', 'NDA', 'SOW', 'OTHER'] as const;
export const ARCHIVE_ACCESS = ['LEADS_ONLY', 'ALL_DEVELOPERS'] as const;
export const ARCHIVE_ACCESS_LABELS: Record<(typeof ARCHIVE_ACCESS)[number], string> = { LEADS_ONLY: 'Leads only', ALL_DEVELOPERS: 'All developers' };
export const CLIENT_GST_REG_TYPES = ['REGULAR', 'COMPOSITION', 'UNREGISTERED', 'SEZ', 'OVERSEAS'] as const;
export const INTERN_TASK_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'DONE', 'NOT_DONE'] as const;
export type InternTaskStatusKey = (typeof INTERN_TASK_STATUSES)[number];

/** GST state codes (place of supply). */
export const CLIENT_GST_STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu & Kashmir' }, { code: '02', name: 'Himachal Pradesh' }, { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' }, { code: '05', name: 'Uttarakhand' }, { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' }, { code: '08', name: 'Rajasthan' }, { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' }, { code: '11', name: 'Sikkim' }, { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' }, { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' }, { code: '17', name: 'Meghalaya' }, { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' }, { code: '20', name: 'Jharkhand' }, { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' }, { code: '23', name: 'Madhya Pradesh' }, { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' }, { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' }, { code: '30', name: 'Goa' }, { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' }, { code: '33', name: 'Tamil Nadu' }, { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' }, { code: '36', name: 'Telangana' }, { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' }, { code: '97', name: 'Other Territory' },
];
export const clientStateName = (code: string | null | undefined) => CLIENT_GST_STATES.find((s) => s.code === code)?.name ?? null;

const WORK_GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const WORK_GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** GSTIN format + mod-36 check digit. */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = WORK_GST_CHARS.indexOf(first14[i]!.toUpperCase());
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return WORK_GST_CHARS[(36 - (sum % 36)) % 36]!;
}
export function isValidClientGstin(gstin: string): boolean {
  const g = gstin.toUpperCase();
  if (!WORK_GSTIN_RE.test(g)) return false;
  return gstinCheckDigit(g.slice(0, 14)) === g[14];
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optDate = z.union([dateStr, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));
const optText = (max = 500) => z.union([z.string().trim().max(max), z.null()]).optional().transform((v) => (v ? v : null));

// ── Clients ────────────────────────────────────────────────────────────────
export const clientInput = z
  .object({
    name: z.string().trim().min(2, 'Client name is required').max(120),
    legalName: optText(200),
    isInternal: z.boolean().optional().default(false),
    gstRegType: z.enum(CLIENT_GST_REG_TYPES).default('REGULAR'),
    gstin: z.union([z.string().trim().toUpperCase(), z.null()]).optional().transform((v) => (v ? v : null)),
    pan: optText(10),
    address: optText(400),
    city: optText(80),
    pincode: optText(10),
    stateCode: optText(2),
    countryCode: z.string().trim().length(2).default('IN'),
    billingEmails: z.array(z.string().trim().toLowerCase().email('Enter valid billing emails')).max(10).default([]),
    defaultRatePerHourPaise: z.number().int().min(0).nullable().optional(),
    paymentTermsDays: z.number().int().min(0).max(180).default(15),
    contactName: optText(120),
    contactPhone: optText(30),
  })
  .superRefine((v, ctx) => {
    if (v.gstin && !isValidClientGstin(v.gstin)) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'Enter a valid GSTIN' });
    if (v.gstin && v.stateCode && v.gstin.slice(0, 2) !== v.stateCode) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GSTIN state mismatch' });
    if (!v.isInternal && (v.gstRegType === 'REGULAR' || v.gstRegType === 'SEZ') && !v.gstin) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GSTIN is required for regular and SEZ registrations' });
    if (!v.isInternal && v.gstRegType !== 'OVERSEAS' && !v.stateCode) ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'State is required' });
  });
export type ClientInput = z.infer<typeof clientInput>;
export const clientListQuery = paginationQuery.extend({ status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ALL') });
export const clientStatusInput = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });

export type ClientRow = {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  isInternal: boolean;
  gstRegType: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  stateName: string | null;
  countryCode: string;
  billingEmails: string[];
  defaultRatePerHourPaise: number | null;
  paymentTermsDays: number;
  contactName: string | null;
  contactPhone: string | null;
  status: string;
  activeProjects: number;
  totalProjects: number;
  documents: number;
};
export type ClientDetail = ClientRow & {
  projects: { id: string; key: string; name: string; status: ProjectStatusKey }[];
  vault: ProjectDocumentRow[];
};

// ── Documents ──────────────────────────────────────────────────────────────
export const projectDocumentInput = z.object({
  fileId: z.string().min(1),
  title: z.string().trim().max(200).optional(),
  kind: z.enum(WORK_DOC_KINDS).default('REQUIREMENT'),
});
export type ProjectDocumentRow = { id: string; fileId: string; title: string; kind: string; sizeBytes: number; mime: string | null; uploadedBy: string | null; createdAt: string; scope: 'PROJECT' | 'CLIENT' };

// ── Projects ───────────────────────────────────────────────────────────────
export const projectKeySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, 'Key must be 2–6 letters (A–Z)');
export const projectCreateInput = z
  .object({
    name: z.string().trim().min(2, 'Project name is required').max(120),
    key: projectKeySchema.optional(),
    clientId: z.string().min(1, 'Client is required'),
    leadEmployeeId: z.string().min(1, 'Project lead is required'),
    startDate: dateStr,
    deadline: dateStr,
    billable: z.boolean().default(true),
    gitRepoUrl: z.union([z.string().trim().url('Enter a valid repository URL'), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
    documentFileIds: z.array(z.string()).max(20).default([]),
    category: z.enum(PROJECT_CATEGORIES).default('WEB'),
    techStack: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    ratePerHourPaise: z.number().int().min(0).nullable().optional(),
    estimatedHours: z.number().min(0).max(100000).nullable().optional(),
    boardDepartmentIds: z.array(z.string()).max(10).default([]),
    modules: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
    description: optText(4000),
    status: z.enum(['PLANNING', 'ACTIVE']).default('ACTIVE'),
  })
  .refine((v) => v.deadline >= v.startDate, { path: ['deadline'], message: 'Deadline must be on or after the start date' });
export type ProjectCreateInput = z.infer<typeof projectCreateInput>;

export const projectUpdateInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    key: projectKeySchema,
    clientId: z.string().min(1),
    leadEmployeeId: z.string().min(1),
    startDate: dateStr,
    deadline: dateStr,
    billable: z.boolean(),
    gitRepoUrl: z.union([z.string().trim().url('Enter a valid repository URL'), z.literal(''), z.null()]).transform((v) => (v ? v : null)),
    gitTargetBranch: z.string().trim().min(1).max(100),
    category: z.enum(PROJECT_CATEGORIES),
    techStack: z.array(z.string().trim().min(1).max(40)).max(20),
    ratePerHourPaise: z.number().int().min(0).nullable(),
    estimatedHours: z.number().min(0).max(100000).nullable(),
    boardDepartmentIds: z.array(z.string()).max(10),
    description: z.string().max(4000).nullable(),
  })
  .partial();
export type ProjectUpdateInput = z.infer<typeof projectUpdateInput>;

export const projectStatusInput = z.object({
  status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']),
  reason: z.string().trim().max(500).optional(),
  cancelRemaining: z.boolean().optional(),
});
export const projectListQuery = paginationQuery.extend({
  status: z.string().optional(),
  clientId: z.string().optional(),
  leadEmployeeId: z.string().optional(),
  includeClosed: z.coerce.boolean().optional(),
});
export const projectKpiQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
export const projectModuleInput = z.object({ name: z.string().trim().min(1).max(60), estimatedHours: z.number().min(0).max(10000).nullable().optional() });
export const projectModuleUpdateInput = z.object({ name: z.string().trim().min(1).max(60).optional(), estimatedHours: z.number().min(0).max(10000).nullable().optional(), isArchived: z.boolean().optional() });
export const projectMemberInput = z.object({ employeeId: z.string().min(1), role: z.enum(PROJECT_MEMBER_ROLES).default('MEMBER'), allocationPct: z.number().int().min(0).max(100).nullable().optional() });

export type ProjectRow = {
  id: string;
  key: string;
  name: string;
  clientId: string | null;
  clientName: string;
  isInternal: boolean;
  leadEmployeeId: string | null;
  leadName: string | null;
  progressPct: number;
  estimatedMinutes: number;
  loggedMinutes: number;
  status: ProjectStatusKey;
  health: ProjectHealthKey;
  healthReason: string | null;
  /** Wireframe Status column: health when ACTIVE, else the status label. */
  statusLabel: string;
  deadline: string | null;
  billable: boolean;
  category: string;
};
export type ProjectKpis = {
  month: string;
  monthLabel: string;
  active: number;
  dueThisMonth: number;
  billableMinutes: number;
  billablePaise: number;
  billableSource: 'timesheets' | 'tracker' | 'tasks';
  rateMissing: string[];
  onTrack: number;
  atRisk: number;
};
export type BoardInfo = {
  departmentId: string;
  name: string;
  locked: boolean;
  leadEmployeeId: string | null;
  leadName: string | null;
  memberCount: number | null;
  canManage: boolean;
};
export type ProjectDetail = ProjectRow & {
  description: string | null;
  startDate: string | null;
  ratePerHourPaise: number | null;
  effectiveRatePaise: number | null;
  techStack: string[];
  openingLoggedMinutes: number;
  taskEstimateMinutes: number;
  tasksByStatus: Record<string, number>;
  gitRepoUrl: string | null;
  gitTargetBranch: string;
  gitLinkStatus: string;
  gitLinkError: string | null;
  archiveAccess: string;
  closedAt: string | null;
  archivedAt: string | null;
  taskSeq: number;
  modules: { id: string; name: string; estimatedMinutes: number | null; isArchived: boolean; tasks: number; loggedMinutes: number }[];
  members: { id: string; employeeId: string; name: string; department: string | null; designation: string | null; role: string; allocationPct: number | null; joinedAt: string }[];
  boards: BoardInfo[];
  documents: ProjectDocumentRow[];
  recentGit: { taskId: string; key: string; title: string; branch: string | null; branchUrl: string | null; mrUrl: string | null; mrState: string | null; syncStatus: string }[];
  canManage: boolean;
  canArchive: boolean;
};

// ── Boards & tasks ─────────────────────────────────────────────────────────
export const boardQuery = z.object({ includeDone: z.coerce.boolean().optional() });
export const boardMemberInput = z.object({ employeeId: z.string().min(1) });

export const taskCreateInput = z.object({
  title: z.string().trim().min(2, 'Title is required').max(200),
  projectId: z.string().min(1, 'Project is required'),
  moduleName: optText(60),
  assigneeEmployeeId: z.union([z.string().min(1), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  estimatedHours: z.number().min(0.25, 'Minimum 0.25h').max(200, 'Estimate over 200h — split the task').nullable().optional(),
  dueDate: optDate,
  departmentId: z.string().min(1, 'Team board is required'),
  description: optText(8000),
});
export type TaskCreateInput = z.infer<typeof taskCreateInput>;
export const taskUpdateInput = z
  .object({
    title: z.string().trim().min(2).max(200),
    moduleName: z.string().trim().max(60).nullable(),
    assigneeEmployeeId: z.string().min(1).nullable(),
    estimatedHours: z.number().min(0.25).max(200, 'Estimate over 200h — split the task').nullable(),
    dueDate: z.union([dateStr, z.null()]),
    description: z.string().max(8000).nullable(),
  })
  .partial();
export type TaskUpdateInput = z.infer<typeof taskUpdateInput>;
export const taskMoveInput = z.object({
  toStatus: z.enum(['OPEN', 'ALLOTTED', 'WIP', 'DEV_COMPLETED', 'QA', 'DONE']),
  version: z.number().int().optional(),
  reason: z.string().trim().max(500).optional(),
  /** Place before this task in the target column (drag position). */
  beforeTaskId: z.string().optional(),
});
export type TaskMoveInput = z.infer<typeof taskMoveInput>;
export const taskCommentInput = z.object({ body: z.string().trim().min(1, 'Write a comment').max(4000) });

export type TaskCard = {
  id: string;
  key: string;
  title: string;
  moduleName: string | null;
  status: TaskStatusKey;
  assigneeEmployeeId: string | null;
  assigneeName: string | null;
  /** "Priya S." or "—" */
  assigneeShort: string;
  estimatedMinutes: number | null;
  loggedMinutes: number;
  dueDate: string | null;
  overdue: boolean;
  gitBranch: string | null;
  gitMrUrl: string | null;
  gitMrIid: number | null;
  gitMrState: string | null;
  gitSyncStatus: string;
  version: number;
  canMove: boolean;
};
export type BoardView = {
  project: { id: string; key: string; name: string; status: ProjectStatusKey; locked: boolean };
  board: BoardInfo;
  columns: { status: TaskStatusKey; label: string; count: number; cards: TaskCard[] }[];
  members: { employeeId: string; name: string; isLead: boolean }[];
};
export type BoardLocked = { locked: true; department: string; departmentId: string };
export type TaskDetail = TaskCard & {
  projectId: string;
  projectKey: string;
  projectName: string;
  departmentId: string | null;
  departmentName: string | null;
  description: string | null;
  reporterName: string | null;
  isStanding: boolean;
  gitBranchUrl: string | null;
  gitSyncError: string | null;
  pipelineStatus: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  devCompletedAt: string | null;
  doneAt: string | null;
  comments: { id: string; authorName: string; body: string; createdAt: string }[];
  history: { id: string; kind: string; fromStatus: string | null; toStatus: string | null; note: string | null; byName: string; at: string }[];
  commits: { sha: string; message: string; authorName: string | null; committedAt: string; url: string | null }[];
  assigneeOptions: { value: string; label: string }[];
  moduleOptions: string[];
  canEdit: boolean;
};
export type TaskMoveResult = { task: TaskCard; message: string; git?: { action: 'branch' | 'mr' | 'none'; branch?: string | null; mrUrl?: string | null; status: string; error?: string | null } };
export type MyTask = { id: string; key: string; title: string; projectId: string; projectName: string; moduleName: string | null; status: TaskStatusKey; estimatedMinutes: number | null; loggedMinutes: number; dueDate: string | null; isStanding: boolean };

// ── GitLab ─────────────────────────────────────────────────────────────────
export const gitIntegrationInput = z.object({
  baseUrl: z.string().trim().url().default('https://gitlab.com'),
  token: z.string().trim().min(8).optional(),
  defaultTargetBranch: z.string().trim().min(1).max(100).default('develop'),
  branchPattern: z.string().trim().min(1).max(100).refine((s) => s.includes('{key}'), 'Pattern must contain {key}').default('feature/{key}'),
  mrTitlePattern: z.string().trim().min(1).max(200).default('{KEY}: {title}'),
});
export type GitIntegrationView = {
  configured: boolean;
  mode: 'gitlab' | 'stub';
  baseUrl: string;
  tokenLast4: string | null;
  defaultTargetBranch: string;
  branchPattern: string;
  mrTitlePattern: string;
  status: string;
  lastCheckedAt: string | null;
  webhookUrl: string;
  /** Only returned right after a rotate. */
  webhookSecret?: string;
};

// ── Archive ────────────────────────────────────────────────────────────────
export const archiveQuery = paginationQuery.extend({ tab: z.enum(['all', 'web', 'mobile', 'internal']).default('all') });
export const archiveAccessInput = z.object({ archiveAccess: z.enum(ARCHIVE_ACCESS) });
export type ArchiveRow = { id: string; key: string; name: string; clientName: string; closedAt: string | null; closedLabel: string; documents: number; techStack: string[]; archiveAccess: string; category: string; isInternal: boolean };
export type ArchiveDetail = ArchiveRow & {
  description: string | null;
  leadName: string | null;
  estimatedMinutes: number;
  loggedMinutes: number;
  progressPct: number;
  tasksByStatus: Record<string, number>;
  members: { name: string; role: string }[];
  modules: string[];
  projectDocuments: ProjectDocumentRow[];
  clientDocuments: ProjectDocumentRow[];
  canManage: boolean;
};

// ── Interns ────────────────────────────────────────────────────────────────
export const internSheetQuery = z.object({ date: dateStr.optional(), mentorEmployeeId: z.string().optional() });
export const internTaskInput = z.object({
  internEmployeeId: z.string().min(1, 'Intern is required'),
  date: dateStr,
  title: z.string().trim().min(2, 'Task is required').max(1000),
  description: optText(4000),
  estimatedHours: z.number().min(0.25).max(12).nullable().optional(),
  linkedTaskId: z.union([z.string().min(1), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
});
export type InternTaskInput = z.infer<typeof internTaskInput>;
export const internTaskUpdateInput = z
  .object({
    status: z.enum(INTERN_TASK_STATUSES),
    hours: z.number().min(0).max(12, 'Hours must be between 0 and 12').nullable(),
    internNote: z.string().max(2000).nullable(),
    title: z.string().trim().min(2).max(1000),
    description: z.string().max(4000).nullable(),
    date: dateStr,
    mentorScore: z.number().min(0, 'Score must be 0–10').max(10, 'Score must be 0–10').multipleOf(0.5).nullable(),
    mentorFeedback: z.string().max(2000).nullable(),
  })
  .partial();
export type InternTaskUpdateInput = z.infer<typeof internTaskUpdateInput>;
export const internWeekScoreInput = z.object({
  weekStart: dateStr,
  score: z.number().min(0, 'Score must be 0–10').max(10, 'Score must be 0–10').multipleOf(0.5),
  feedback: optText(2000),
});
export type InternTaskRow = {
  id: string;
  date: string;
  title: string;
  description: string | null;
  status: InternTaskStatusKey;
  hours: number | null;
  estimatedHours: number | null;
  internNote: string | null;
  mentorScore: number | null;
  mentorFeedback: string | null;
  linkedTaskKey: string | null;
  carriedFromId: string | null;
};
export type InternSheetRow = {
  internEmployeeId: string;
  internName: string;
  empCode: string;
  department: string | null;
  mentorEmployeeId: string | null;
  mentorName: string | null;
  todayTask: string | null;
  todayMore: number;
  hours: number;
  /** DONE | IN_PROGRESS | NOT_ASSIGNED | NOT_DONE | ASSIGNED */
  status: string;
  statusLabel: string;
  weekScore: number | null;
  tasks: InternTaskRow[];
};
export type InternContext = { isIntern: boolean; isMentor: boolean; canAssign: boolean; canViewAll: boolean; mentees: { value: string; label: string }[]; today: string; lastSheetDate: string | null };
export type InternWeek = {
  intern: { id: string; name: string; empCode: string; mentorName: string | null; department: string | null };
  weekStart: string;
  days: { date: string; label: string; tasks: InternTaskRow[] }[];
  totals: { hours: number; done: number; total: number; avgTaskScore: number | null };
  weekScore: { score: number; feedback: string | null; scoredBy: string | null } | null;
  effectiveScore: number | null;
  trend: { weekStart: string; score: number | null }[];
  canScore: boolean;
  canEditOwn: boolean;
};
