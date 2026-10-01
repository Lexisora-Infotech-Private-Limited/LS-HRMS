import type {
  BadgeRow,
  BadgeUpsertInput,
  CertificateRow,
  EmployeeBadge,
  EotmCreateInput,
  EotmOptions,
  EotmRow,
  FeedComment,
  FeedDraftRow,
  FeedListResponse,
  FeedPostView,
  FeedSidebar,
  HelpdeskMeta,
  HelpdeskSettings,
  KudosCreateInput,
  KudosListResponse,
  KudosRow,
  KudosTab,
  PolicyComplianceRow,
  PolicyCompliancePerson,
  PolicyDetail,
  PolicyListResponse,
  PostUpsertInput,
  SupportGroupInput,
  TicketCategoryInput,
  TicketCreateInput,
  TicketDetail,
  TicketListResponse,
  TicketTab,
  WpHolidayList,
  CompanyEventInput,
  CompanyEventRow,
  DailyQuoteInput,
  DashboardEvent,
  DashboardResponse,
  NoticeAudienceOptions,
  NoticeDetail,
  NoticeListResponse,
  NoticeReceipts,
  NoticeTab,
  NoticeUpsertInput,
  PersonalTodoRow,
  QuoteRow,
  TaskCreateInput,
  TodoCreateInput,
  TodosResponse,
} from '@lexisora/shared';
import { del, fileUrl, get, patch, post, put } from '@/lib/api';

/** Query keys — everything under ['workplace', …] so one invalidation refreshes the domain. */
export const wpKeys = {
  all: ['workplace'] as const,
  dashboard: ['workplace', 'dashboard'] as const,
  todos: ['workplace', 'todos'] as const,
  notices: ['workplace', 'notices'] as const,
  noticeList: (tab: NoticeTab, page: number) => ['workplace', 'notices', 'list', tab, page] as const,
  notice: (id: string) => ['workplace', 'notices', 'detail', id] as const,
  receipts: (id: string) => ['workplace', 'notices', 'receipts', id] as const,
  noticeAudiences: ['workplace', 'notices', 'audiences'] as const,
  unread: ['workplace', 'notices', 'unread'] as const,
  events: ['workplace', 'events'] as const,
  celebrations: ['workplace', 'celebrations'] as const,
  quotes: ['workplace', 'quotes'] as const,
  feed: ['workplace', 'feed'] as const,
  feedDrafts: ['workplace', 'feed', 'drafts'] as const,
  feedSidebar: ['workplace', 'feed', 'sidebar'] as const,
  comments: (postId: string) => ['workplace', 'feed', 'comments', postId] as const,
  kudos: ['workplace', 'kudos'] as const,
  kudosList: (tab: KudosTab, page: number) => ['workplace', 'kudos', 'list', tab, page] as const,
  badges: ['workplace', 'kudos', 'badges'] as const,
  eotm: ['workplace', 'kudos', 'eotm'] as const,
  policies: ['workplace', 'policies'] as const,
  policyList: (tab: string) => ['workplace', 'policies', 'list', tab] as const,
  policy: (id: string) => ['workplace', 'policies', 'detail', id] as const,
  compliance: ['workplace', 'policies', 'compliance'] as const,
  compliancePeople: (id: string, state: string) => ['workplace', 'policies', 'compliance', id, state] as const,
  holidays: (year: number | null) => ['workplace', 'policies', 'holidays', year] as const,
  helpdesk: ['workplace', 'helpdesk'] as const,
  ticketList: (q: Record<string, unknown>) => ['workplace', 'helpdesk', 'list', q] as const,
  ticket: (id: string) => ['workplace', 'helpdesk', 'ticket', id] as const,
  helpdeskMeta: ['workplace', 'helpdesk', 'meta'] as const,
  helpdeskSettings: ['workplace', 'helpdesk', 'settings'] as const,
};

export type NoticeSave = NoticeUpsertInput;

export const wpApi = {
  dashboard: (sections?: string[]) => get<Partial<DashboardResponse>>('/dashboard', sections?.length ? { sections: sections.join(',') } : undefined),

  // to-dos
  todos: () => get<TodosResponse>('/todos'),
  createTodo: (b: TodoCreateInput) => post<PersonalTodoRow>('/todos', b),
  updateTodo: (id: string, b: Partial<TodoCreateInput>) => patch<PersonalTodoRow>(`/todos/${id}`, b),
  completeTodo: (id: string) => post<PersonalTodoRow>(`/todos/${id}/complete`),
  reopenTodo: (id: string) => post<PersonalTodoRow>(`/todos/${id}/reopen`),
  deleteTodo: (id: string) => del<{ ok: true }>(`/todos/${id}`),
  /** Board task — owned by the Work domain; the dashboard just calls its endpoint. */
  createTask: (b: TaskCreateInput) => post<{ id: string; key: string }>('/tasks', b),

  // notices
  notices: (q: { tab: NoticeTab; page?: number; pageSize?: number; q?: string }) => get<NoticeListResponse>('/notices', q),
  notice: (id: string) => get<NoticeDetail>(`/notices/${id}`),
  readNotice: (id: string) => post<{ ok: true; counted: boolean }>(`/notices/${id}/read`),
  unread: () => get<{ unread: number }>('/notices/unread-count'),
  noticeAudiences: () => get<NoticeAudienceOptions>('/notices/audiences'),
  createNotice: (b: NoticeSave) => post<NoticeDetail>('/notices', b),
  updateNotice: (id: string, b: NoticeSave) => patch<NoticeDetail>(`/notices/${id}`, b),
  publishNotice: (id: string, force = false) => post<NoticeDetail>(`/notices/${id}/publish`, { force }),
  unscheduleNotice: (id: string) => post<NoticeDetail>(`/notices/${id}/unschedule`),
  archiveNotice: (id: string) => post<{ ok: true }>(`/notices/${id}/archive`),
  deleteNotice: (id: string) => del<{ ok: true }>(`/notices/${id}`),
  pinNotice: (id: string, pinned: boolean) => (pinned ? post<{ ok: true }>(`/notices/${id}/pin`) : del<{ ok: true }>(`/notices/${id}/pin`)),
  receipts: (id: string) => get<NoticeReceipts>(`/notices/${id}/receipts`),
  remindUnread: (id: string) => post<{ reminded: number }>(`/notices/${id}/remind-unread`),

  // events & celebrations
  events: (days = 60) => get<CompanyEventRow[]>('/events', { days }),
  celebrations: (days = 14) => get<DashboardEvent[]>('/events/celebrations', { days }),
  createEvent: (b: CompanyEventInput) => post<CompanyEventRow>('/events', b),
  updateEvent: (id: string, b: CompanyEventInput) => patch<CompanyEventRow>(`/events/${id}`, b),
  cancelEvent: (id: string) => post<CompanyEventRow>(`/events/${id}/cancel`),

  // thought of the day
  quotes: () => get<QuoteRow[]>('/quotes'),
  createQuote: (b: DailyQuoteInput) => post<QuoteRow>('/quotes', b),
  updateQuote: (id: string, b: Partial<DailyQuoteInput>) => patch<QuoteRow>(`/quotes/${id}`, b),
  deleteQuote: (id: string) => del<{ ok: true }>(`/quotes/${id}`),

  // company feed
  feed: (q: { kind?: string; page: number; pageSize?: number }) => get<FeedListResponse>('/feed/posts', q),
  post: (id: string) => get<FeedPostView>(`/feed/posts/${id}`),
  feedDrafts: () => get<FeedDraftRow[]>('/feed/drafts'),
  feedSidebar: () => get<FeedSidebar>('/feed/sidebar'),
  createPost: (b: PostUpsertInput) => post<FeedPostView>('/feed/posts', b),
  updatePost: (id: string, b: PostUpsertInput) => put<FeedPostView>(`/feed/posts/${id}`, b),
  publishPost: (id: string) => post<FeedPostView>(`/feed/posts/${id}/publish`),
  archivePost: (id: string) => post<{ ok: true }>(`/feed/posts/${id}/archive`),
  pinPost: (id: string, pinned: boolean) => post<{ ok: true; pinned: boolean }>(`/feed/posts/${id}/pin`, { pinned }),
  deleteDraft: (id: string) => del<{ ok: true }>(`/feed/posts/${id}`),
  like: (id: string, on: boolean) => (on ? put<{ liked: boolean; likeCount: number }>(`/feed/posts/${id}/like`) : del<{ liked: boolean; likeCount: number }>(`/feed/posts/${id}/like`)),
  comments: (id: string) => get<FeedComment[]>(`/feed/posts/${id}/comments`),
  addComment: (id: string, body: string, parentId?: string | null) => post<FeedComment[]>(`/feed/posts/${id}/comments`, { body, parentId: parentId ?? null }),
  deleteComment: (id: string) => del<{ ok: true; commentCount: number }>(`/feed/comments/${id}`),

  // kudos & EOTM & certificates
  kudos: (q: { tab: KudosTab; page: number; pageSize?: number }) => get<KudosListResponse>('/kudos', q),
  giveKudos: (b: KudosCreateInput) => post<KudosRow>('/kudos', b),
  revokeKudos: (id: string, reason?: string | null) => post<{ ok: true }>(`/kudos/${id}/revoke`, { reason: reason ?? null }),
  badges: () => get<BadgeRow[]>('/kudos/badges'),
  createBadge: (b: BadgeUpsertInput) => post<BadgeRow[]>('/kudos/badges', b),
  updateBadge: (id: string, b: BadgeUpsertInput) => patch<BadgeRow[]>(`/kudos/badges/${id}`, b),
  employeeBadges: (employeeId: string) => get<EmployeeBadge[]>(`/kudos/employees/${employeeId}/badges`),
  eotmList: () => get<EotmRow[]>('/eotm'),
  eotmOptions: () => get<EotmOptions>('/eotm/options'),
  announceEotm: (b: EotmCreateInput) => post<EotmRow>('/eotm', b),
  revokeEotm: (id: string, reason: string) => post<{ ok: true }>(`/eotm/${id}/revoke`, { reason }),
  myCertificates: () => get<CertificateRow[]>('/certificates/mine'),
  certificatePdfPath: (id: string) => `/certificates/${id}/pdf`,

  // policies
  policies: (tab: string) => get<PolicyListResponse>('/policies', { tab }),
  policy: (id: string) => get<PolicyDetail>(`/policies/${id}`),
  createPolicy: (b: Record<string, unknown>) => post<PolicyDetail>('/policies', b),
  newPolicyVersion: (id: string, b: Record<string, unknown>) => post<PolicyDetail>(`/policies/${id}/versions`, b),
  archivePolicy: (id: string) => post<{ ok: true }>(`/policies/${id}/archive`),
  restorePolicy: (id: string) => post<PolicyDetail>(`/policies/${id}/restore`),
  acknowledge: (versionId: string, readSeconds: number) => post<PolicyDetail>(`/policies/versions/${versionId}/ack`, { readSeconds }),
  compliance: () => get<PolicyComplianceRow[]>('/policies/compliance'),
  compliancePeople: (id: string, state: string) => get<PolicyCompliancePerson[]>(`/policies/${id}/compliance`, { state }),
  remindPolicy: (id: string) => post<{ reminded: number; skipped: number }>(`/policies/${id}/remind`),
  holidays: (year?: number | null) => get<WpHolidayList>('/policies/holidays', year ? { year } : undefined),

  // helpdesk
  helpdeskMeta: () => get<HelpdeskMeta>('/helpdesk/meta'),
  tickets: (q: { tab: TicketTab; page: number; pageSize?: number; status?: string; categoryId?: string; priority?: string; sla?: string; q?: string }) => get<TicketListResponse>('/helpdesk/tickets', q),
  ticket: (id: string) => get<TicketDetail>(`/helpdesk/tickets/${id}`),
  raiseTicket: (b: TicketCreateInput) => post<TicketDetail>('/helpdesk/tickets', b),
  updateTicket: (id: string, b: { status?: 'OPEN' | 'IN_PROGRESS' | 'WAITING'; priority?: 'HIGH' | 'MEDIUM' | 'LOW'; assigneeEmployeeId?: string | null; categoryId?: string }) => patch<TicketDetail>(`/helpdesk/tickets/${id}`, b),
  ticketComment: (id: string, b: { body: string; visibility: 'PUBLIC' | 'INTERNAL'; fileIds: string[] }) => post<TicketDetail>(`/helpdesk/tickets/${id}/comments`, b),
  resolveTicket: (id: string, note: string) => post<TicketDetail>(`/helpdesk/tickets/${id}/resolve`, { note }),
  reopenTicket: (id: string) => post<TicketDetail>(`/helpdesk/tickets/${id}/reopen`),
  cancelTicket: (id: string) => post<TicketDetail>(`/helpdesk/tickets/${id}/cancel`),
  closeTicket: (id: string) => post<TicketDetail>(`/helpdesk/tickets/${id}/close`),
  escalateTicket: (id: string, note?: string | null) => post<TicketDetail>(`/helpdesk/tickets/${id}/escalate`, { note: note ?? null }),
  rateTicket: (id: string, score: number, comment?: string | null) => post<TicketDetail>(`/helpdesk/tickets/${id}/csat`, { score, comment: comment ?? null }),
  helpdeskSettings: () => get<HelpdeskSettings>('/helpdesk/settings'),
  saveGroup: (id: string | null, b: SupportGroupInput) => (id ? patch<HelpdeskSettings>(`/helpdesk/groups/${id}`, b) : post<HelpdeskSettings>('/helpdesk/groups', b)),
  saveCategory: (id: string | null, b: TicketCategoryInput) => (id ? patch<HelpdeskSettings>(`/helpdesk/categories/${id}`, b) : post<HelpdeskSettings>('/helpdesk/categories', b)),
  saveSla: (priority: string, b: { firstResponseMins: number; resolutionMins: number }) => put<HelpdeskSettings>(`/helpdesk/sla/${priority}`, b),
  saveAutoClose: (days: number) => put<HelpdeskSettings>('/helpdesk/auto-close', { days }),
};

const FILE_IMG = /(<img[^>]+src=")\/api\/v1\/files\/([A-Za-z0-9_-]+)(?:\?[^"]*)?"/g;

/** Feed/notice HTML stores tenant images as /api/v1/files/:id — add the access token for <img>. */
export function withFileTokens(html: string): string {
  return (html ?? '').replace(FILE_IMG, (_m, pre: string, id: string) => `${pre}${fileUrl(id) ?? ''}"`);
}

/** "29 Sep 2026" (IST) */
export function longDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = new Date(new Date(iso).getTime() + 330 * 60_000);
  return `${s.getUTCDate()} ${MONTHS_SHORT[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
}

/** "just now" / "12 m ago" / "3 h ago" / "2 d ago" / "27 Sep" */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  return dayMonthOf(iso);
}

/** Fixed month names — recent CLDR renders en-GB September as "Sept"; the product copy uses "Sep". */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27 Sep" (IST) from an ISO instant. */
export function dayMonthOf(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = new Date(new Date(iso).getTime() + 330 * 60_000);
  return `${s.getUTCDate()} ${MONTHS_SHORT[s.getUTCMonth()]}`;
}

/** "2 Oct, 10:00" (IST). */
export function dayMonthTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const dm = dayMonthOf(iso);
  const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(d);
  return `${dm}, ${t}`;
}

/** ISO instant → value for <input type="datetime-local"> in IST. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (IST wall clock) → ISO instant. */
export function fromLocalInput(v: string | null | undefined): string | null {
  if (!v) return null;
  return new Date(`${v}:00+05:30`).toISOString();
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
