import { z } from 'zod';

/**
 * Workplace domain contracts: dashboard, notices, feed, kudos/EOTM, certificates, chat,
 * helpdesk, learning, rooms & visitors, policies, wellness games (pure generators shared by
 * web and API) and CCTV.
 */

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-30');
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 11:00');
const optStr = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

// ── Audience rules (notices, policies, events, course assignments) ──────────
export const WP_AUDIENCE_TYPES = ['ALL', 'DEPARTMENT', 'PROJECT', 'BRANCH', 'EMPLOYEE', 'EMPLOYMENT_TYPE'] as const;
export type WpAudienceType = (typeof WP_AUDIENCE_TYPES)[number];
export const wpAudienceRuleSchema = z.object({
  type: z.enum(WP_AUDIENCE_TYPES),
  refId: z.string().optional().nullable(),
  label: z.string().optional().nullable(),
});
export type WpAudienceRule = z.infer<typeof wpAudienceRuleSchema>;

// ── Dashboard ──────────────────────────────────────────────────────────────
export const todoCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  dueDate: dateStr.optional().nullable(),
  note: optStr(1000),
});
export type TodoCreateInput = z.infer<typeof todoCreateSchema>;
export const todoUpdateSchema = todoCreateSchema.partial();

export const dailyQuoteSchema = z.object({
  text: z.string().trim().min(3).max(280),
  author: optStr(80),
  scheduledFor: dateStr.optional().nullable(),
  active: z.boolean().default(true),
});
export type DailyQuoteInput = z.infer<typeof dailyQuoteSchema>;

export const WP_EVENT_KINDS = ['TOWN_HALL', 'CELEBRATION', 'TRAINING', 'OTHER'] as const;
export const companyEventSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: optStr(1000),
  kind: z.enum(WP_EVENT_KINDS).default('OTHER'),
  startsAt: z.string().min(10),
  endsAt: z.string().optional().nullable(),
  location: optStr(120),
});
export type CompanyEventInput = z.infer<typeof companyEventSchema>;

export type TodoSource = 'SYSTEM' | 'BOARD' | 'PERSONAL';
export type DashboardTodo = {
  id: string;
  source: TodoSource;
  text: string;
  due: string; // "Today", "Wed", "3 Oct", "Overdue"
  dueDate: string | null;
  overdue: boolean;
  link: string | null;
  checkable: boolean;
};
export type DashboardAnnouncement = { id: string; scope: 'Global' | 'Team'; title: string; body: string; date: string; read: boolean };
export type DashboardEvent = { id: string; kind: 'BIRTHDAY' | 'ANNIVERSARY' | 'EVENT'; what: string; when: string; date: string };
export type DashboardResponse = {
  greeting: { kicker: string; dayPart: 'morning' | 'afternoon' | 'evening'; firstName: string; title: string; localDate: string };
  quote: { text: string; author: string | null } | null;
  todos: DashboardTodo[];
  todosMore: number;
  approvals: { key: string; label: string; count: number; link: string }[] | null;
  announcements: DashboardAnnouncement[];
  events: DashboardEvent[];
};

/** "Good morning" before 12:00, afternoon until 16:59, evening after (IST). */
export function dayPartFor(d: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(d));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

/** Deterministic quote index for a local date: daysSinceEpoch mod count. */
export function quoteIndexFor(localDate: string, count: number): number {
  if (count <= 0) return -1;
  const days = Math.floor(Date.UTC(+localDate.slice(0, 4), +localDate.slice(5, 7) - 1, +localDate.slice(8, 10)) / 86_400_000);
  return ((days % count) + count) % count;
}

export const dashboardQuery = z.object({ sections: z.string().max(200).optional() });
export type QuoteRow = { id: string; text: string; author: string | null; scheduledFor: string | null; active: boolean; sortOrder: number; isToday: boolean };
export type PersonalTodoRow = { id: string; title: string; note: string | null; dueDate: string | null; due: string; overdue: boolean; completedAt: string | null };
export type TodosResponse = { items: DashboardTodo[]; personal: PersonalTodoRow[] };
export const eventsQuery = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  days: z.coerce.number().int().min(1).max(366).optional(),
});
export type CompanyEventRow = {
  id: string;
  title: string;
  description: string | null;
  kind: (typeof WP_EVENT_KINDS)[number];
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  /** "3 Oct, 5 pm" (IST) */
  when: string;
  date: string;
  cancelled: boolean;
  canManage: boolean;
};
export const WP_EVENT_KIND_LABEL: Record<(typeof WP_EVENT_KINDS)[number], string> = { TOWN_HALL: 'Town hall', CELEBRATION: 'Celebration', TRAINING: 'Training', OTHER: 'Event' };

// ── Notices ────────────────────────────────────────────────────────────────
export const noticeUpsertSchema = z
  .object({
    title: z.string().trim().min(5, 'Title needs at least 5 characters').max(150),
    visibility: z.enum(['GLOBAL', 'TEAM']),
    audiences: z.array(wpAudienceRuleSchema).max(20).default([]),
    bodyHtml: z.string().max(50_000).default(''),
    attachmentFileIds: z.array(z.string()).max(5, 'Up to 5 attachments').default([]),
    publishAt: z.string().optional().nullable(),
    expiresAt: z.string().optional().nullable(),
    pinned: z.boolean().default(false),
    emailRecipients: z.boolean().optional(),
    action: z.enum(['draft', 'publish']).default('publish'),
    force: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.visibility === 'TEAM' && !v.audiences.length) ctx.addIssue({ code: 'custom', path: ['audiences'], message: 'Pick at least one team' });
    if (v.visibility === 'GLOBAL' && v.audiences.length) ctx.addIssue({ code: 'custom', path: ['audiences'], message: 'Global notices reach everyone — remove the team' });
  });
export type NoticeUpsertInput = z.infer<typeof noticeUpsertSchema>;
export const noticeListQuery = z.object({
  tab: z.enum(['all', 'global', 'teams', 'drafts']).default('all'),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type NoticeRow = {
  id: string;
  title: string;
  visibility: 'GLOBAL' | 'TEAM';
  status: string;
  audienceLabel: string;
  publishedAt: string | null;
  publishAt: string | null;
  expiresAt: string | null;
  pinned: boolean;
  hasAttachment: boolean;
  canManage: boolean;
  recipientCount: number;
  readCount: number;
  myRead: boolean | null;
  authorName: string;
};
export type NoticeDetail = NoticeRow & {
  bodyHtml: string;
  attachments: { fileId: string; name: string; sizeBytes: number; mime: string }[];
  audiences: WpAudienceRule[];
  authorEmployeeId: string;
  authorTitle: string | null;
  editedAt: string | null;
  emailRecipients: boolean;
};
export type NoticeTab = 'all' | 'global' | 'teams' | 'drafts';
export type NoticeListResponse = { items: NoticeRow[]; total: number; page: number; pageSize: number; counts: Record<NoticeTab, number> };
export type NoticeReceipt = { employeeId: string; name: string; initials: string; department: string | null; readAt: string | null; exited: boolean };
export type NoticeReceipts = { recipientCount: number; readCount: number; read: NoticeReceipt[]; unread: NoticeReceipt[]; canRemind: boolean; lastRemindedAt: string | null };
export type NoticeAudienceOptions = {
  canGlobal: boolean;
  canTeam: boolean;
  /** May target any department/project (HR/Admin); otherwise only teams the user leads or manages. */
  anyTeam: boolean;
  canPin: boolean;
  departments: { value: string; label: string }[];
  projects: { value: string; label: string }[];
};
/** "Read" column: `read / recipients` for the author and moderators, else my own state. */
export function noticeReadLabel(r: Pick<NoticeRow, 'canManage' | 'readCount' | 'recipientCount' | 'myRead' | 'status'>): { text: string; tone: 'accent' | 'outline' | 'neutral' | 'plain' } {
  if (r.status === 'DRAFT' || r.status === 'SCHEDULED') return { text: '—', tone: 'plain' };
  if (r.canManage) return { text: `${r.readCount} / ${r.recipientCount}`, tone: 'plain' };
  if (r.myRead === null) return { text: '—', tone: 'plain' };
  return r.myRead ? { text: 'Read', tone: 'accent' } : { text: 'New', tone: 'outline' };
}

// ── Feed ───────────────────────────────────────────────────────────────────
export const FEED_EDITOR_TOOLS = ['B', 'I', 'H2', 'Link', 'Image', 'List'] as const;
export const postUpsertSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(150),
  kind: z.enum(['BLOG', 'MILESTONE', 'UPDATE']).default('BLOG'),
  bodyHtml: z.string().max(100_000).default(''),
  coverFileId: z.string().optional().nullable(),
  action: z.enum(['draft', 'publish', 'submit']).default('draft'),
});
export type PostUpsertInput = z.infer<typeof postUpsertSchema>;
export const postCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write a comment').max(2000),
  parentId: z.string().optional().nullable(),
});
export const returnPostSchema = z.object({ note: z.string().trim().min(3).max(500) });
export type FeedPost = {
  id: string;
  kind: string;
  status: string;
  title: string;
  bodyHtml: string;
  excerpt: string;
  author: { employeeId: string; name: string; initials: string; meta: string };
  publishedAt: string | null;
  pinned: boolean;
  likeCount: number;
  liked: boolean;
  commentCount: number;
  certificateId: string | null;
  canModerate: boolean;
  isMine: boolean;
};
export type FeedComment = { id: string; parentId: string | null; body: string; authorName: string; initials: string; createdAt: string; canDelete: boolean; deleted: boolean };
export type FeedSidebar = { eotm: { month: string; name: string; citation: string; certificateId: string | null } | null; kudosThisWeek: { id: string; text: string }[] };

// ── Kudos & EOTM ───────────────────────────────────────────────────────────
export const kudosCreateSchema = z.object({
  recipientEmployeeId: z.string().min(1, 'Pick an employee'),
  badgeId: z.string().min(1, 'Pick a badge'),
  message: z.string().trim().min(10, 'Message needs at least 10 characters').max(500),
});
export type KudosCreateInput = z.infer<typeof kudosCreateSchema>;
export const eotmCreateSchema = z.object({
  employeeId: z.string().min(1, 'Pick an employee'),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  citation: z.string().trim().min(20, 'Citation needs at least 20 characters').max(600),
});
export type EotmCreateInput = z.infer<typeof eotmCreateSchema>;
export type KudosRow = { id: string; employee: string; employeeId: string; badge: string; from: string; message: string; date: string; isEotm: boolean; certificateId: string | null; canRevoke: boolean };

// ── Certificates ───────────────────────────────────────────────────────────
export type CertificateVerify = { valid: boolean; status: string; holderName: string; title: string; subtitle: string | null; issuedAt: string; issuer: string; code: string; revokedAt: string | null };

// ── Chat ───────────────────────────────────────────────────────────────────
export const channelCreateSchema = z.object({
  name: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,59}$/, 'Use lowercase letters, numbers and dashes'),
  topic: optStr(200),
  kind: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  memberUserIds: z.array(z.string()).max(500).default([]),
});
export const dmCreateSchema = z.object({ userIds: z.array(z.string()).min(1).max(8) });
export const chatAttachmentSchema = z.object({ fileId: z.string(), name: z.string().max(200), mime: z.string().max(100), size: z.number().int().nonnegative() });
export const messageSendSchema = z
  .object({
    channelId: z.string().min(1),
    body: z.string().max(4000).default(''),
    clientMsgId: z.string().min(6).max(64),
    attachments: z.array(chatAttachmentSchema).max(10).default([]),
    replyToId: z.string().optional().nullable(),
  })
  .refine((m) => m.body.trim().length > 0 || m.attachments.length > 0, { message: 'Type a message', path: ['body'] });
export type MessageSendInput = z.infer<typeof messageSendSchema>;
export const messageEditSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export const messagesQuery = z.object({
  beforeSeq: z.coerce.number().int().optional(),
  afterSeq: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const callStartSchema = z.object({ kind: z.enum(['AUDIO', 'VIDEO', 'SCREEN']) });
export type ChatChannelRow = { id: string; kind: string; name: string; label: string; topic: string | null; unread: number; muted: boolean; canPost: boolean; postingNote: string | null; memberCount: number; lastMessageAt: string | null; dmUserId: string | null };
export type ChatMessageRow = { id: string; channelId: string; seq: number; kind: string; senderUserId: string | null; who: string; init: string; t: string; body: string | null; attachments: { fileId: string; name: string; mime: string; size: number }[]; mentions: string[]; createdAt: string; editedAt: string | null; deleted: boolean; mine: boolean };
export type CallJoin = { callId: string; roomName: string; kind: string; provider: 'livekit' | 'local'; url: string | null; token: string | null; recording: boolean; notice: string | null };

// ── Helpdesk ───────────────────────────────────────────────────────────────
export const HELPDESK_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const HELPDESK_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED', 'CANCELLED'] as const;
export type HelpdeskTicketStatus = (typeof HELPDESK_STATUSES)[number];
export const ticketCreateSchema = z.object({
  categoryId: z.string().min(1, 'Pick a category'),
  priority: z.enum(HELPDESK_PRIORITIES).default('MEDIUM'),
  subject: z.string().trim().min(5, 'Subject needs at least 5 characters').max(150),
  description: z.string().trim().min(10, 'Describe the issue (at least 10 characters)').max(5000),
  attachmentFileIds: z.array(z.string()).max(5).default([]),
});
export type TicketCreateInput = z.infer<typeof ticketCreateSchema>;
export const ticketUpdateSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING']).optional(),
  priority: z.enum(HELPDESK_PRIORITIES).optional(),
  assigneeEmployeeId: z.string().nullable().optional(),
  categoryId: z.string().optional(),
});
export const ticketCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write a reply').max(5000),
  visibility: z.enum(['PUBLIC', 'INTERNAL']).default('PUBLIC'),
  fileIds: z.array(z.string()).max(5).default([]),
});
export const ticketResolveSchema = z.object({ note: z.string().trim().min(3, 'Add a resolution note').max(2000) });
export const ticketCsatSchema = z.object({ score: z.number().int().min(1).max(5), comment: optStr(500) });
export const ticketListQuery = z.object({
  tab: z.enum(['mine', 'assigned', 'all', 'escalations']).default('mine'),
  status: z.string().optional(),
  categoryId: z.string().optional(),
  priority: z.string().optional(),
  sla: z.string().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type TicketRow = { id: string; code: string; subject: string; category: string; priority: string; assignee: string; status: string; slaState: string; slaLabel: string; updatedAt: string; restricted: boolean };

// ── Learning ───────────────────────────────────────────────────────────────
export const courseCreateSchema = z.object({
  title: z.string().trim().min(3).max(150),
  description: optStr(2000),
  category: z.enum(['REQUIRED', 'OPTIONAL', 'ONBOARDING']).default('REQUIRED'),
  certificateOnCompletion: z.boolean().default(true),
  videoFileId: z.string().optional().nullable(),
  lessonTitle: optStr(150),
  durationMin: z.number().int().min(1).max(600).default(10),
  assignTo: wpAudienceRuleSchema.extend({ type: z.enum([...WP_AUDIENCE_TYPES, 'NEW_JOINERS']) }).optional().nullable(),
  dueInDays: z.number().int().min(1).max(365).optional().nullable(),
  publish: z.boolean().default(true),
});
export type CourseCreateInput = z.infer<typeof courseCreateSchema>;
export const lessonCreateSchema = z.object({
  title: z.string().trim().min(2).max(150),
  type: z.enum(['VIDEO', 'DOCUMENT']).default('VIDEO'),
  fileId: z.string().optional().nullable(),
  durationMin: z.number().int().min(1).max(600).default(5),
  content: optStr(5000),
});
export const courseAssignmentSchema = z.object({
  audienceType: z.enum([...WP_AUDIENCE_TYPES, 'NEW_JOINERS']),
  refId: z.string().optional().nullable(),
  label: z.string().optional().nullable(),
  required: z.boolean().default(true),
  dueInDays: z.number().int().min(1).max(365).optional().nullable(),
});
export const lessonProgressSchema = z.object({ positionSec: z.number().min(0), playbackRate: z.number().min(0.5).max(2).default(1) });
export type CourseTile = {
  courseId: string;
  enrollmentId: string | null;
  kicker: string;
  title: string;
  status: string;
  statusLine: string;
  cta: 'Start' | 'Continue' | 'Download certificate' | 'Review' | 'Enroll';
  lessonsDone: number;
  lessonsTotal: number;
  progressPct: number;
  dueLabel: string | null;
  overdue: boolean;
  certificateId: string | null;
};

// ── Rooms & visitors ───────────────────────────────────────────────────────
export const bookingCreateSchema = z.object({
  roomId: z.string().min(1, 'Pick a room'),
  date: dateStr,
  from: timeStr,
  to: timeStr,
  purpose: z.string().trim().min(2, 'Purpose is required').max(120),
  attendeeEmployeeIds: z.array(z.string()).max(50).default([]),
});
export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;
export const bookingUpdateSchema = z.object({ date: dateStr, from: timeStr, to: timeStr });
export const wpCancelSchema = z.object({ reason: optStr(300) });
export const roomUpsertSchema = z.object({
  name: z.string().trim().min(2).max(60),
  capacity: z.number().int().min(1).max(500).default(4),
  amenities: z.array(z.string()).default([]),
  branchId: z.string().optional().nullable(),
  active: z.boolean().default(true),
});
export const visitorCreateSchema = z.object({
  name: z.string().trim().min(2, 'Visitor name is required').max(100),
  company: optStr(100),
  hostEmployeeId: z.string().optional().nullable(),
  date: dateStr,
  expectedTime: timeStr.default('10:00'),
  phone: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/[\s-]/g, '') : null))
    .refine((v) => !v || /^(\+91)?[6-9]\d{9}$/.test(v), 'Enter a valid Indian mobile number'),
  email: z.string().trim().email().optional().nullable().or(z.literal('').transform(() => null)),
  purpose: z.string().trim().min(2).max(160).default('Visit'),
  sendVia: z.enum(['WHATSAPP', 'EMAIL', 'BOTH']).default('WHATSAPP'),
});
export type VisitorCreateInput = z.infer<typeof visitorCreateSchema>;
export const visitorLookupSchema = z.object({ code: z.string().trim().min(4).max(80) });
export type FacilityRow = { id: string; kind: 'booking' | 'visitor'; name: string; date: string; time: string; host: string; hostEmployeeId: string; purpose: string; status: string; canCancel: boolean; canCheckIn: boolean; canCheckOut: boolean; passLink?: string | null; shortCode?: string | null };

// ── Policies ───────────────────────────────────────────────────────────────
export const WP_POLICY_CATEGORIES = ['HANDBOOK', 'HR', 'LEAVE_ATTENDANCE', 'IT_SECURITY', 'POSH', 'HOLIDAY_LIST', 'COMPLIANCE', 'OTHER'] as const;
export const policyCreateSchema = z.object({
  title: z.string().trim().min(3).max(150),
  fileId: z.string().min(1, 'Attach the policy PDF'),
  requiresAck: z.boolean().default(true),
  category: z.enum(WP_POLICY_CATEGORIES).default('HR'),
  ackDueDays: z.number().int().min(1).max(90).default(7),
  effectiveFrom: dateStr.optional().nullable(),
  changeSummary: optStr(1000),
});
export type PolicyCreateInput = z.infer<typeof policyCreateSchema>;
export const policyVersionSchema = z.object({
  fileId: z.string().min(1, 'Attach the policy PDF'),
  effectiveFrom: dateStr.optional().nullable(),
  changeSummary: optStr(1000),
  requiresReack: z.boolean().default(true),
});
export const policyAckSchema = z.object({ versionId: z.string().min(1), readSeconds: z.number().int().min(0).max(86_400).default(0) });
export type PolicyRow = { id: string; title: string; category: string; updated: string; requiresAck: boolean; myState: 'ACKNOWLEDGED' | 'PENDING' | 'NA'; acknowledgedAt: string | null; versionId: string | null; version: number; fileId: string | null; compliance: string | null; isHolidayList: boolean };

// ── Wellness ───────────────────────────────────────────────────────────────
export const GAME_KEYS = ['queens', 'sudoku6', 'wordladder'] as const;
export type GameKey = (typeof GAME_KEYS)[number];
export const gameCompleteSchema = z.object({
  startToken: z.string().min(8),
  solution: z.unknown(),
  hintsUsed: z.number().int().min(0).max(2).default(0),
  moves: z.number().int().min(0).max(10_000).optional(),
  revealed: z.boolean().default(false),
});

// ── CCTV ───────────────────────────────────────────────────────────────────
export const cameraUpsertSchema = z.object({
  name: z.string().trim().min(2).max(60),
  location: z.string().trim().min(2).max(80),
  branchId: z.string().optional().nullable(),
  rtspUrl: z.string().trim().regex(/^rtsps?:\/\//, 'RTSP URL must start with rtsp://').optional().nullable(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
export type CameraRow = { id: string; name: string; location: string; status: string; lastSeen: string | null; enabled: boolean; rtspMasked: string | null; hlsUrl: string | null; sortOrder: number };

// ═════════════════════════════════════════════════════════════════════════
// Wellness puzzle generators (pure, deterministic; identical on web and API)
// ═════════════════════════════════════════════════════════════════════════

/** cyrb128 string hash → four 32-bit seeds. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32 PRNG seeded from a string; returns floats in [0,1). */
export function seededRng(seed: string): () => number {
  let [a, b, c, d] = cyrb128(seed);
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export const puzzleSeed = (tenantId: string, game: GameKey, date: string, attempt = 0) => `${tenantId}:${game}:${date}:${attempt}`;

// ── Queens ────────────────────────────────────────────────────────────────
export type QueensPuzzle = { n: number; regions: number[][]; solution: number[] /* col per row */; unique: boolean };

/** Counts solutions (stops at `limit`): one queen per row, column and region; no two touching. */
export function countQueensSolutions(regions: number[][], limit = 2): number {
  const n = regions.length;
  const cols = new Array<boolean>(n).fill(false);
  const regs = new Array<boolean>(n).fill(false);
  let count = 0;
  const place: number[] = [];
  const rec = (r: number) => {
    if (count >= limit) return;
    if (r === n) {
      count++;
      return;
    }
    for (let c = 0; c < n; c++) {
      const g = regions[r]![c]!;
      if (cols[c] || regs[g]) continue;
      if (r > 0 && Math.abs(place[r - 1]! - c) <= 1) continue;
      cols[c] = regs[g] = true;
      place[r] = c;
      rec(r + 1);
      cols[c] = regs[g] = false;
    }
  };
  rec(0);
  return count;
}

export function validateQueens(regions: number[][], cols: unknown): boolean {
  const n = regions.length;
  if (!Array.isArray(cols) || cols.length !== n) return false;
  const usedC = new Set<number>();
  const usedR = new Set<number>();
  for (let r = 0; r < n; r++) {
    const c = cols[r];
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= n) return false;
    if (usedC.has(c)) return false;
    const g = regions[r]![c]!;
    if (usedR.has(g)) return false;
    if (r > 0 && Math.abs((cols[r - 1] as number) - c) <= 1) return false;
    usedC.add(c);
    usedR.add(g);
  }
  return true;
}

function generateQueensAttempt(rnd: () => number, n: number): QueensPuzzle | null {
  // 1. Place queens: one per row/col, no touching (seeded backtracking).
  const sol: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const rec = (r: number): boolean => {
    if (r === n) return true;
    for (const c of shuffle([...Array(n).keys()], rnd)) {
      if (used[c] || (r > 0 && Math.abs(sol[r - 1]! - c) <= 1)) continue;
      used[c] = true;
      sol[r] = c;
      if (rec(r + 1)) return true;
      used[c] = false;
    }
    return false;
  };
  if (!rec(0)) return null;
  // 2. Grow regions from each queen, always extending one of the smallest regions.
  const reg: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(-1));
  const sizes = new Array<number>(n).fill(1);
  sol.forEach((c, r) => (reg[r]![c] = r));
  let filled = n;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (filled < n * n) {
    const order = [...Array(n).keys()].sort((a, b) => sizes[a]! - sizes[b]! || rnd() - 0.5);
    let grew = false;
    for (const g of order) {
      const frontier: [number, number][] = [];
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
          if (reg[r]![c] === g)
            for (const [dr, dc] of dirs) {
              const rr = r + dr!,
                cc = c + dc!;
              if (rr >= 0 && rr < n && cc >= 0 && cc < n && reg[rr]![cc] === -1) frontier.push([rr, cc]);
            }
      if (!frontier.length) continue;
      const [rr, cc] = frontier[Math.floor(rnd() * frontier.length)]!;
      reg[rr]![cc] = g;
      sizes[g]!++;
      filled++;
      grew = true;
      if (rnd() < 0.55) break; // bias towards growing the smallest region
    }
    if (!grew) return null;
  }
  // 3. Refine: while another solution exists, move one of its queen cells into a neighbouring
  //    region (keeping every region contiguous). The planted solution always stays valid.
  for (let iter = 0; iter < 400; iter++) {
    const other = findOtherQueens(reg, sol);
    if (!other) return { n, regions: reg, solution: sol, unique: true };
    const rows = shuffle([...Array(n).keys()].filter((r) => other[r] !== sol[r]), rnd);
    let moved = false;
    for (const r of rows) {
      const c = other[r]!;
      const from = reg[r]![c]!;
      const nbRegions = shuffle(
        dirs
          .map(([dr, dc]) => [r + dr!, c + dc!] as const)
          .filter(([rr, cc]) => rr >= 0 && rr < n && cc >= 0 && cc < n && reg[rr]![cc] !== from)
          .map(([rr, cc]) => reg[rr]![cc]!),
        rnd,
      );
      for (const to of nbRegions) {
        reg[r]![c] = to;
        if (regionConnected(reg, from)) {
          moved = true;
          break;
        }
        reg[r]![c] = from;
      }
      if (moved) break;
    }
    if (!moved) break;
  }
  return { n, regions: reg, solution: sol, unique: countQueensSolutions(reg, 2) === 1 };
}

function findOtherQueens(regions: number[][], planted: number[]): number[] | null {
  const n = regions.length;
  const cols = new Array<boolean>(n).fill(false);
  const regs = new Array<boolean>(n).fill(false);
  const place: number[] = [];
  let found: number[] | null = null;
  const rec = (r: number) => {
    if (found) return;
    if (r === n) {
      if (place.some((c, i) => c !== planted[i])) found = place.slice();
      return;
    }
    for (let c = 0; c < n && !found; c++) {
      const g = regions[r]![c]!;
      if (cols[c] || regs[g] || (r > 0 && Math.abs(place[r - 1]! - c) <= 1)) continue;
      cols[c] = regs[g] = true;
      place[r] = c;
      rec(r + 1);
      cols[c] = regs[g] = false;
    }
  };
  rec(0);
  return found;
}

function regionConnected(regions: number[][], g: number): boolean {
  const n = regions.length;
  const cells: [number, number][] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (regions[r]![c] === g) cells.push([r, c]);
  if (!cells.length) return false;
  const seen = new Set<number>([cells[0]![0] * n + cells[0]![1]]);
  const q = [cells[0]!];
  while (q.length) {
    const [r, c] = q.shift()!;
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const rr = r + dr!,
        cc = c + dc!;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && regions[rr]![cc] === g && !seen.has(rr * n + cc)) {
        seen.add(rr * n + cc);
        q.push([rr, cc]);
      }
    }
  }
  return seen.size === cells.length;
}

/** Daily Queens board. Tries up to 60 seeded attempts for a unique solution. */
export function generateQueens(tenantId: string, date: string, n = 7): QueensPuzzle {
  let fallback: QueensPuzzle | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const p = generateQueensAttempt(seededRng(puzzleSeed(tenantId, 'queens', date, attempt)), n);
    if (!p) continue;
    if (p.unique) return p;
    fallback ??= p;
  }
  return fallback!;
}

// ── Mini Sudoku 6×6 (boxes 2 rows × 3 cols) ────────────────────────────────
export type SudokuPuzzle = { size: 6; givens: number[][] /* 0 = empty */; solution: number[][] };

function sudokuCandidates(g: number[][], r: number, c: number): number[] {
  const used = new Set<number>();
  for (let i = 0; i < 6; i++) {
    used.add(g[r]![i]!);
    used.add(g[i]![c]!);
  }
  const br = Math.floor(r / 2) * 2,
    bc = Math.floor(c / 3) * 3;
  for (let i = br; i < br + 2; i++) for (let j = bc; j < bc + 3; j++) used.add(g[i]![j]!);
  return [1, 2, 3, 4, 5, 6].filter((d) => !used.has(d));
}

export function countSudokuSolutions(grid: number[][], limit = 2): number {
  const g = grid.map((r) => r.slice());
  let count = 0;
  const rec = (): void => {
    if (count >= limit) return;
    let best: [number, number, number[]] | null = null;
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 6; c++)
        if (!g[r]![c]) {
          const cand = sudokuCandidates(g, r, c);
          if (!best || cand.length < best[2].length) best = [r, c, cand];
        }
    if (!best) {
      count++;
      return;
    }
    const [r, c, cand] = best;
    for (const d of cand) {
      g[r]![c] = d;
      rec();
      g[r]![c] = 0;
      if (count >= limit) return;
    }
  };
  rec();
  return count;
}

export function validateSudoku(givens: number[][], sol: unknown): boolean {
  if (!Array.isArray(sol) || sol.length !== 6) return false;
  for (let r = 0; r < 6; r++) {
    const row = sol[r];
    if (!Array.isArray(row) || row.length !== 6) return false;
    for (let c = 0; c < 6; c++) {
      const v = row[c];
      if (typeof v !== 'number' || v < 1 || v > 6) return false;
      if (givens[r]![c] && givens[r]![c] !== v) return false;
    }
  }
  const g = sol as number[][];
  for (let i = 0; i < 6; i++) {
    const row = new Set(g[i]);
    const col = new Set(g.map((r) => r[i]));
    if (row.size !== 6 || col.size !== 6) return false;
  }
  for (let br = 0; br < 6; br += 2)
    for (let bc = 0; bc < 6; bc += 3) {
      const s = new Set<number>();
      for (let i = br; i < br + 2; i++) for (let j = bc; j < bc + 3; j++) s.add(g[i]![j]!);
      if (s.size !== 6) return false;
    }
  return true;
}

export function generateSudoku(tenantId: string, date: string): SudokuPuzzle {
  const rnd = seededRng(puzzleSeed(tenantId, 'sudoku6', date));
  const g: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  const fill = (i: number): boolean => {
    if (i === 36) return true;
    const r = Math.floor(i / 6),
      c = i % 6;
    for (const d of shuffle(sudokuCandidates(g, r, c), rnd)) {
      g[r]![c] = d;
      if (fill(i + 1)) return true;
      g[r]![c] = 0;
    }
    return false;
  };
  fill(0);
  const solution = g.map((r) => r.slice());
  const givens = g.map((r) => r.slice());
  let count = 36;
  for (const i of shuffle([...Array(36).keys()], rnd)) {
    if (count <= 14) break;
    const r = Math.floor(i / 6),
      c = i % 6;
    const keep = givens[r]![c]!;
    givens[r]![c] = 0;
    if (countSudokuSolutions(givens, 2) !== 1) givens[r]![c] = keep;
    else count--;
  }
  return { size: 6, givens, solution };
}

// ── Word ladder ───────────────────────────────────────────────────────────
const WORDS_RAW = `able acid aged also area army away baby back bake ball band bank bare bark barn base bath bead beak beam bean bear beat beef been beer bell belt bend best bike bill bind bird bite blow blue boat body bold bolt bone book boot bore born boss both bowl bulk bull burn bush busy cake calm came camp cane card care cart case cash cast cave cell chat chin chip city clap clay clip club coal coat code coin cold come cone cook cool cope copy cord core corn cost crew crop cube cure curl cute damp dare dark dart dash data date dawn deal dear debt deck deep deer desk dial dice diet dime dine dirt dish dive dock dome done door dose dove down drag draw drew drip drop drum duck dull dune dust duty each earn ease east easy edge even ever exam face fact fade fail fair fake fall fame farm fast fate fear feed feel feet fell felt file fill film find fine fire firm fish fist five flag flat fled flew flip flow foam fold folk fond food fool foot ford fork form fort four free frog from fuel full fund gain game gate gave gaze gear gift girl give glad glow glue goal goat gold golf gone good gown grab gray grew grid grin grip grow gulf hail hair half hall halt hand hang hard hare harm have hawk head heal heap hear heat heel held helm help herb herd here hero hide high hike hill hint hire hold hole home hood hook hope horn hose host hour huge hull hung hunt hurt idea inch into iron item jazz join joke jump just keen keep kept kick kind king kite knee knew knit knot know lace lack lady laid lake lamb lamp land lane last late lawn lazy lead leaf lean leap left lend lens less lick life lift like lime line link lion list live load loaf loan lock loft long look loop lord lose loss lost loud love luck lump lung made mail main make male mall many mark mask mass mast mate maze meal mean meat meet melt memo menu mere mesh mild mile milk mill mind mine mint miss mist mode mold mole mood moon more most move much mule must name navy near neat neck need nest news next nice nine node none noon nose note oath obey odds once only onto open oven over pace pack page paid pain pair pale palm pane park part pass past path peak pear peel pest pick pier pile pill pine pink pipe plan play plot plug plum plus poem poet pole poll pond pony pool poor pore pork port pose post pour pray pull pump pure push race rack rage rail rain rake ramp rang rank rare rate read real rear rely rent rest rice rich ride ring rise risk road roam roar robe rock rode role roll roof room root rope rose ruby rude rule rush rust safe sage said sail sake sale salt same sand sang save seal seat seed seek seem seen self sell send sent shed ship shoe shop shot show shut sick side sign silk sing sink site size skin slip slow snap snow soap sock soft soil sold sole some song soon sort soul soup sour spin spot star stay stem step stir stop such suit sung sunk sure swim tail take tale talk tall tame tank tape task team tear tell tend tent term test text than that them then they thin this tide tidy tile till time tiny tire toad told toll tone took tool tour town trap tray tree trim trip true tube tuck tune turn twin type unit upon used user vast verb very vest view vote wade wage wait wake walk wall want ward warm warn wash wave weak wear weed week well went were west what when wide wife wild will wind wine wing wink wipe wire wise wish with wolf wood wool word wore work worm worn wrap yard yarn year yell your zero zone bold bolt boil coil foil soil toil tail mail nail pail rail sail wail bail fail hail jail hale kale pale sale tale vale bale gale male mane cane lane pane sane vane wane bane dane`;
export const LADDER_WORDS: readonly string[] = [...new Set(WORDS_RAW.split(/\s+/).filter((w) => /^[a-z]{4}$/.test(w)))].sort();
const WORD_SET = new Set(LADDER_WORDS);

export const isLadderWord = (w: string) => WORD_SET.has(w.toLowerCase());
export const oneLetterApart = (a: string, b: string) => a.length === b.length && [...a].filter((ch, i) => ch !== b[i]).length === 1;

function neighbours(w: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 4; i++)
    for (let k = 97; k <= 122; k++) {
      const ch = String.fromCharCode(k);
      if (ch === w[i]) continue;
      const cand = w.slice(0, i) + ch + w.slice(i + 1);
      if (WORD_SET.has(cand)) out.push(cand);
    }
  return out;
}

/** BFS shortest path between two words (null if unreachable). */
export function ladderPath(from: string, to: string): string[] | null {
  const prev = new Map<string, string | null>([[from, null]]);
  const q = [from];
  while (q.length) {
    const w = q.shift()!;
    if (w === to) {
      const path: string[] = [];
      for (let x: string | null = w; x; x = prev.get(x) ?? null) path.unshift(x);
      return path;
    }
    for (const nb of neighbours(w)) if (!prev.has(nb)) {
      prev.set(nb, w);
      q.push(nb);
    }
  }
  return null;
}

export type LadderPuzzle = { start: string; target: string; par: number /* moves */; example: string[] };

export function generateLadder(tenantId: string, date: string): LadderPuzzle {
  const rnd = seededRng(puzzleSeed(tenantId, 'wordladder', date));
  const starts = shuffle([...LADDER_WORDS], rnd);
  for (const start of starts.slice(0, 80)) {
    // BFS distances from start.
    const dist = new Map<string, number>([[start, 0]]);
    const q = [start];
    while (q.length) {
      const w = q.shift()!;
      const d = dist.get(w)!;
      if (d >= 6) continue;
      for (const nb of neighbours(w)) if (!dist.has(nb)) {
        dist.set(nb, d + 1);
        q.push(nb);
      }
    }
    const targets = [...dist.entries()].filter(([, d]) => d >= 4 && d <= 6).map(([w]) => w).sort();
    if (targets.length) {
      const target = targets[Math.floor(rnd() * targets.length)]!;
      const example = ladderPath(start, target)!;
      return { start, target, par: example.length - 1, example };
    }
  }
  const example = ladderPath('cold', 'warm')!;
  return { start: 'cold', target: 'warm', par: example.length - 1, example };
}

/** Valid ladder: starts at start, ends at target, every step changes one letter to a dictionary word. */
export function validateLadder(p: Pick<LadderPuzzle, 'start' | 'target'>, words: unknown): boolean {
  if (!Array.isArray(words) || words.length < 2 || words.length > 40) return false;
  const w = words.map((x) => String(x).toLowerCase());
  if (w[0] !== p.start || w[w.length - 1] !== p.target) return false;
  for (let i = 1; i < w.length; i++) if (!isLadderWord(w[i]!) || !oneLetterApart(w[i - 1]!, w[i]!)) return false;
  return true;
}

// ── Scoring ───────────────────────────────────────────────────────────────
export const GAME_STEP_SEC: Record<GameKey, number> = { queens: 20, sudoku6: 30, wordladder: 12 };

/** points = revealed ? 0 : 10 + speedBonus − 3 × hints (floor 2); ladder ±par adjustment. */
export function scoreGame(game: GameKey, p: { elapsedSec: number; hintsUsed: number; revealed: boolean; steps?: number; par?: number }): number {
  if (p.revealed) return 0;
  const speed = Math.max(0, 10 - Math.floor(p.elapsedSec / GAME_STEP_SEC[game]));
  let pts = 10 + speed - 3 * p.hintsUsed;
  if (game === 'wordladder' && p.steps !== undefined && p.par !== undefined) pts += p.steps <= p.par ? 3 : -(p.steps - p.par);
  return Math.max(2, pts);
}

/** The puzzle date: today (IST) once past the unlock time (default 00:00). */
export function puzzleDateFor(now: Date = new Date(), unlock = '00:00'): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  const today = `${g('year')}-${g('month')}-${g('day')}`;
  const hm = `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
  if (hm >= unlock) return today;
  const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - 86_400_000);
  return d.toISOString().slice(0, 10);
}
