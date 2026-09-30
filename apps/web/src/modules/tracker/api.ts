import type {
  DaySummaryRow,
  DeviceApproveResult,
  DeviceRow,
  DevicesAdminResponse,
  DevicesQuery,
  EmployeeDevicesResponse,
  IdleClaimDecideInput,
  IdleClaimRow,
  IdleClaimsQuery,
  IntegrityEventRow,
  MyDevicesResponse,
  PairingLookup,
  ScreenshotRow,
  ScreenshotsQuery,
} from '@lexisora/shared';
import { get, post } from '@/lib/api';

/** Tracker domain API client (web side). Query keys all start with 'tracker'. */
export const trackerApi = {
  myDevices: () => get<MyDevicesResponse>('/devices/me'),
  employeeDevices: (employeeId: string) => get<EmployeeDevicesResponse>(`/devices/employee/${employeeId}`),
  adminDevices: (q: Partial<DevicesQuery>) => get<DevicesAdminResponse>('/devices', q as Record<string, unknown>),
  lookup: (code: string) => post<PairingLookup>('/devices/lookup', { code }),
  approve: (code: string, decision: 'APPROVE' | 'REJECT') => post<DeviceApproveResult>('/devices/approve', { code, decision }),
  revoke: (id: string, reason?: string) => post<DeviceRow>(`/devices/${id}/revoke`, { reason: reason || undefined }),
  hrDecision: (id: string, decision: 'APPROVE' | 'REJECT', reason?: string) => post<DeviceRow>(`/devices/${id}/hr-decision`, { decision, reason: reason || undefined }),

  idleClaims: (q: Partial<IdleClaimsQuery>) => get<IdleClaimRow[]>('/tracker/idle-claims', q as Record<string, unknown>),
  decideClaim: (id: string, input: IdleClaimDecideInput) => post<IdleClaimRow>(`/tracker/idle-claims/${id}/decide`, input),
  screenshots: (q: Partial<ScreenshotsQuery>) =>
    get<{ items: ScreenshotRow[]; total: number; intervalMin: number | null }>('/tracker/screenshots', q as Record<string, unknown>),
  daySummaries: (q: { employeeId?: string; from: string; to: string }) => get<DaySummaryRow[]>('/tracker/day-summaries', q),
  integrity: (employeeId: string, week?: string) => get<IntegrityEventRow[]>('/tracker/integrity', { employeeId, week }),
  acknowledge: (id: string, comment?: string) => post<{ ok: true }>(`/tracker/integrity/${id}/ack`, { comment }),
};

export const trackerKeys = {
  myDevices: ['tracker', 'devices', 'me'] as const,
  employeeDevices: (id: string) => ['tracker', 'devices', 'employee', id] as const,
  admin: ['tracker', 'devices', 'admin'] as const,
  claims: ['tracker', 'idle-claims'] as const,
  screenshots: ['tracker', 'screenshots'] as const,
  summaries: ['tracker', 'day-summaries'] as const,
  integrity: ['tracker', 'integrity'] as const,
};

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export const DEVICE_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  REVOKED: 'Revoked',
  PENDING: 'Pending',
  AWAITING_HR: 'Awaiting HR',
};
