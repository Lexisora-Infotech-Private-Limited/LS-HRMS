import { useQuery } from '@tanstack/react-query';
import type {
  AlertDto,
  AuditFacets,
  AuditQuery,
  AuditRowDto,
  Paginated,
  RoleChangeResult,
  RoleDto,
  RoleMemberDto,
  RolesResponse,
  SearchGroupDto,
  BillingCycleKey,
  BillingOverview,
  BillingProfileInput,
  BrandingDto,
  CheckoutDetailDto,
  CheckoutDto,
  ContactSalesInput,
  DomainCheckDto,
  PrivacyOverview,
  ProvisionResultDto,
  PublishBrandingInput,
  QuoteDto,
  SaasInvoiceDto,
  SeatChangeResult,
  SeatQuoteDto,
  SupportListResponse,
  SupportStatusKey,
  SupportTab,
  SupportTicketDetailDto,
  SupportTicketRowDto,
  TenantDetailDto,
  TenantRowDto,
  TenantsResponse,
  TenantTab,
} from '@lexisora/shared';
import { del, get, patch, post, put } from '@/lib/api';

/** Query keys (invalidate with the prefix). */
export const qk = {
  roles: ['platform', 'roles'] as const,
  members: (roleId: string) => ['platform', 'roles', roleId, 'members'] as const,
  assignable: ['platform', 'roles', 'assignable'] as const,
  audit: (q: Partial<AuditQuery>) => ['platform', 'audit', q] as const,
  auditFacets: ['platform', 'audit', 'facets'] as const,
  // Core notifications: AppShell invalidates ['notifications'] on every realtime alert.
  alerts: ['notifications', 'list'] as const,
  search: (q: string) => ['platform', 'search', q] as const,
};

// ── Roles & access ──────────────────────────────────────────────────────────

export const useRoles = () => useQuery({ queryKey: qk.roles, queryFn: () => get<RolesResponse>('/roles') });
export const useRoleMembers = (roleId: string | null) =>
  useQuery({ queryKey: qk.members(roleId ?? ''), queryFn: () => get<RoleMemberDto[]>(`/roles/${roleId}/members`), enabled: !!roleId });
export const useAssignable = (enabled: boolean) =>
  useQuery({ queryKey: qk.assignable, queryFn: () => get<{ value: string; label: string; roleName: string }[]>('/roles/assignable'), enabled });

export const rolesApi = {
  create: (b: { name: string; copyFromRoleId: string | null; description?: string | null }) => post<RoleDto>('/roles', b),
  update: (id: string, b: { name?: string; description?: string | null }) => patch<RoleDto>(`/roles/${id}`, b),
  remove: (id: string) => del<void>(`/roles/${id}`),
  setPermission: (id: string, key: string, enabled: boolean, cascade?: boolean) =>
    put<RoleChangeResult>(`/roles/${id}/permissions/${encodeURIComponent(key)}`, { enabled, cascade }),
  setMatrixRow: (id: string, row: string, enabled: boolean) => put<RoleChangeResult>(`/roles/${id}/matrix`, { row, enabled }),
  /** Replace the whole set: Undo, or a group "Turn all on / off" in the per-role editor. */
  setAll: (id: string, permissions: string[], group?: string) =>
    put<RoleChangeResult>(`/roles/${id}/permissions`, group ? { permissions, reason: 'group', group } : { permissions, reason: 'undo' }),
  addMembers: (id: string, userIds: string[]) => post<RoleMemberDto[]>(`/roles/${id}/members`, { userIds }),
  removeMember: (id: string, userId: string) => del<RoleMemberDto[]>(`/roles/${id}/members/${userId}`),
};

// ── Audit log ───────────────────────────────────────────────────────────────

export type AuditListResponse = Paginated<AuditRowDto> & { counts: Record<string, number> };
export const useAudit = (q: Partial<AuditQuery>) =>
  useQuery({ queryKey: qk.audit(q), queryFn: () => get<AuditListResponse>('/audit', q), placeholderData: (prev) => prev });
export const useAuditFacets = () => useQuery({ queryKey: qk.auditFacets, queryFn: () => get<AuditFacets>('/audit/facets'), staleTime: 60_000 });

/** `/audit/export?…` for the current filter (empty values dropped). */
export function auditExportPath(q: Partial<AuditQuery>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '' && k !== 'page' && k !== 'pageSize') p.set(k, String(v));
  const s = p.toString();
  return `/audit/export${s ? `?${s}` : ''}`;
}

// ── Alerts (core /notifications) ────────────────────────────────────────────

export const useAlerts = () => useQuery({ queryKey: qk.alerts, queryFn: () => get<AlertDto[]>('/notifications') });
export const alertsApi = {
  read: (id: string) => post<void>(`/notifications/${id}/read`),
  readAll: () => post<void>('/notifications/read-all'),
};

// ── Global search (core /search) ────────────────────────────────────────────

export const searchApi = (q: string) => get<SearchGroupDto[]>('/search', { q });
export const useSearch = (q: string) =>
  useQuery({ queryKey: qk.search(q), queryFn: () => searchApi(q), enabled: q.trim().length >= 2, staleTime: 30_000, placeholderData: (prev) => prev });

// ── Subscription & billing ─────────────────────────────────────────────────

export const saasKeys = {
  billing: ['platform', 'billing'] as const,
  overview: ['platform', 'billing', 'overview'] as const,
  invoices: ['platform', 'billing', 'invoices'] as const,
  checkout: (orderId: string) => ['platform', 'billing', 'checkout', orderId] as const,
  branding: ['platform', 'branding'] as const,
  tenants: (q: Record<string, unknown>) => ['platform', 'tenants', q] as const,
  tenantsAll: ['platform', 'tenants'] as const,
  tenant: (id: string) => ['platform', 'tenants', 'detail', id] as const,
  privacy: ['platform', 'privacy'] as const,
  support: (q: Record<string, unknown>) => ['platform', 'support', q] as const,
  supportAll: ['platform', 'support'] as const,
  ticket: (id: string, view: string) => ['platform', 'support', 'ticket', id, view] as const,
};

export const useBillingOverview = () => useQuery({ queryKey: saasKeys.overview, queryFn: () => get<BillingOverview>('/billing/overview') });
export const useSaasInvoices = () => useQuery({ queryKey: saasKeys.invoices, queryFn: () => get<SaasInvoiceDto[]>('/billing/invoices') });
export const useCheckout = (orderId: string) => useQuery({ queryKey: saasKeys.checkout(orderId), queryFn: () => get<CheckoutDetailDto>(`/billing/checkout/${orderId}`) });

export const billingApi = {
  quote: (cycle: BillingCycleKey, quantity: number) => post<QuoteDto>('/billing/quote', { planCode: 'GROWTH', cycle, quantity }),
  checkout: (cycle: BillingCycleKey, quantity: number) => post<CheckoutDto>('/billing/checkout', { planCode: 'GROWTH', cycle, quantity }),
  confirm: (orderId: string, outcome: 'success' | 'fail') => post<{ status: string; message: string }>(`/billing/checkout/${orderId}/confirm`, { outcome }),
  seatQuote: (quantity: number) => post<SeatQuoteDto>('/billing/seats/quote', { quantity }),
  seats: (quantity: number) => post<SeatChangeResult>('/billing/seats', { quantity }),
  downgrade: () => post<{ message: string }>('/billing/downgrade'),
  cancelDowngrade: () => post<{ message: string }>('/billing/downgrade/cancel'),
  promo: (code: string) => post<{ message: string }>('/billing/promo', { code }),
  contactSales: (b: ContactSalesInput) => post<{ message: string }>('/billing/contact-sales', b),
  profile: (b: BillingProfileInput) => patch<BillingOverview>('/billing/profile', b),
  pay: (invoiceId: string) => post<CheckoutDto>(`/billing/invoices/${invoiceId}/pay`),
};

// ── Branding ────────────────────────────────────────────────────────────────

export const useBranding = () => useQuery({ queryKey: saasKeys.branding, queryFn: () => get<BrandingDto>('/branding') });
export const brandingApi = {
  publish: (b: PublishBrandingInput) => post<BrandingDto>('/branding/publish', b),
  restore: (versionId: string) => post<BrandingDto>(`/branding/versions/${versionId}/restore`),
  domainCheck: (domain: string) => get<DomainCheckDto>('/branding/domain-check', { domain }),
};

// ── Tenants (platform admins) ───────────────────────────────────────────────

export const useTenants = (q: { tab: TenantTab; q?: string; page: number }, enabled = true) =>
  useQuery({ queryKey: saasKeys.tenants(q), queryFn: () => get<TenantsResponse>('/tenants', { ...q, pageSize: 50 }), enabled, placeholderData: (prev) => prev });
export const useTenant = (id: string | null) => useQuery({ queryKey: saasKeys.tenant(id ?? ''), queryFn: () => get<TenantDetailDto>(`/tenants/${id}`), enabled: !!id });
export const tenantsApi = {
  create: (b: Record<string, unknown>) => post<ProvisionResultDto>('/tenants', b),
  domainCheck: (domain: string) => get<DomainCheckDto>('/tenants/domain-check', { domain }),
  suspend: (id: string, reason?: string | null) => post<TenantRowDto>(`/tenants/${id}/suspend`, { reason: reason ?? null }),
  reactivate: (id: string) => post<TenantRowDto>(`/tenants/${id}/reactivate`),
  extendGrace: (id: string, days: number) => post<TenantRowDto>(`/tenants/${id}/extend-grace`, { days }),
  resendInvite: (id: string) => post<{ message: string }>(`/tenants/${id}/resend-invite`),
};

// ── Data privacy ────────────────────────────────────────────────────────────

export const usePrivacy = () => useQuery({ queryKey: saasKeys.privacy, queryFn: () => get<PrivacyOverview>('/privacy/overview') });

// ── Lexisora support ────────────────────────────────────────────────────────

export const useSupportTickets = (q: { tab: SupportTab; scope: 'tenant' | 'all'; page: number; q?: string }) =>
  useQuery({ queryKey: saasKeys.support(q), queryFn: () => get<SupportListResponse>('/support/tickets', { ...q, pageSize: 25 }), placeholderData: (prev) => prev });
export const useSupportTicket = (id: string | null, view: 'tenant' | 'platform') =>
  useQuery({ queryKey: saasKeys.ticket(id ?? '', view), queryFn: () => get<SupportTicketDetailDto>(`/support/tickets/${id}`, { view }), enabled: !!id });
export const supportApi = {
  create: (b: Record<string, unknown>) => post<SupportTicketRowDto>('/support/tickets', b),
  reply: (id: string, body: string, opts: { internal?: boolean; asPlatform?: boolean } = {}) => post<SupportTicketDetailDto>(`/support/tickets/${id}/messages`, { body, ...opts }),
  update: (id: string, b: { status?: SupportStatusKey; assignToMe?: boolean }) => patch<SupportTicketDetailDto>(`/support/tickets/${id}`, b),
  resolve: (id: string) => post<SupportTicketDetailDto>(`/support/tickets/${id}/resolve`),
  reopen: (id: string) => post<SupportTicketDetailDto>(`/support/tickets/${id}/reopen`),
  rate: (id: string, score: number) => post<SupportTicketDetailDto>(`/support/tickets/${id}/csat`, { score }),
};
