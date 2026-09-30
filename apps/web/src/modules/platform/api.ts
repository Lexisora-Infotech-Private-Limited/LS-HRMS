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
