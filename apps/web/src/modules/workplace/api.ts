import type {
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
import { del, get, patch, post } from '@/lib/api';

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
};

/** "27 Sep" (IST) from an ISO instant. */
export function dayMonthOf(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
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
