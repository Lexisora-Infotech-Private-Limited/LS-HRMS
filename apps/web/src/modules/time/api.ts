import { useQuery } from '@tanstack/react-query';
import type {
  ApprovalDetail,
  ApprovalList,
  AttendanceMonth,
  AttendancePolicyDto,
  AttendanceTimeline,
  AttendanceToday,
  BiometricDeviceRow,
  EnrollmentRow,
  HolidayGroup,
  HolidayRow,
  IdCheckRow,
  IdComplianceSummary,
  IdPendingRow,
  LocationDetail,
  LocationRow,
  MyIdCheckCard,
  PeriodLockReadiness,
  PeriodLockRow,
  RawLogRow,
  RegularizationRow,
  ShiftAllocationRow,
  ShiftRow,
  TeamToday,
  TimesheetOptions,
  TimesheetWeek,
} from '@lexisora/shared';
import { get } from '@/lib/api';

/** Query keys (all under 'time' so a single invalidate refreshes the domain). */
export const tk = {
  all: ['time'] as const,
  today: ['time', 'today'] as const,
  month: (who: string, month: string) => ['time', 'month', who, month] as const,
  timeline: (who: string, date: string) => ['time', 'timeline', who, date] as const,
  idMine: ['time', 'id-mine'] as const,
  team: (date: string) => ['time', 'team', date] as const,
  regsMine: ['time', 'regs', 'mine'] as const,
  regs: (status: string) => ['time', 'regs', status] as const,
  week: (ws: string) => ['time', 'week', ws] as const,
  options: ['time', 'ts-options'] as const,
  approvals: (level: number, status: string) => ['time', 'approvals', level, status] as const,
  approval: (id: string, page: number, date: string, task: string) => ['time', 'approval', id, page, date, task] as const,
  shifts: ['time', 'shifts'] as const,
  allocations: ['time', 'allocations'] as const,
  locations: ['time', 'locations'] as const,
  location: (id: string) => ['time', 'location', id] as const,
  policy: ['time', 'policy'] as const,
  holidays: (year: number) => ['time', 'holidays', year] as const,
  id: ['time', 'id'] as const,
  idSummary: (date: string) => ['time', 'id', 'summary', date] as const,
  idChecks: (date: string, filter: string) => ['time', 'id', 'checks', date, filter] as const,
  idPending: (date: string) => ['time', 'id', 'pending', date] as const,
  locks: ['time', 'locks'] as const,
  lockReadiness: (month: string) => ['time', 'locks', 'readiness', month] as const,
  unclaimed: ['time', 'bio-unclaimed'] as const,
  devices: ['time', 'bio-devices'] as const,
  enrollments: ['time', 'bio-enrollments'] as const,
  bioLogs: ['time', 'bio-logs'] as const,
};

export const useToday = (enabled = true) =>
  useQuery({ queryKey: tk.today, queryFn: () => get<AttendanceToday>('/attendance/me/today'), enabled, refetchInterval: 120_000 });

export const useMonth = (employeeId: string | null, month: string) =>
  useQuery({
    queryKey: tk.month(employeeId ?? 'me', month),
    queryFn: () => get<AttendanceMonth>(employeeId ? `/attendance/employees/${employeeId}/month` : '/attendance/me/month', { month }),
  });

export const useTimeline = (employeeId: string | null, date: string) =>
  useQuery({
    queryKey: tk.timeline(employeeId ?? 'me', date),
    queryFn: () => get<AttendanceTimeline>(employeeId ? `/attendance/employees/${employeeId}/timeline` : '/attendance/me/timeline', { date }),
  });

export const useMyIdCheck = () => useQuery({ queryKey: tk.idMine, queryFn: () => get<MyIdCheckCard>('/attendance/me/id-check') });
export const useTeam = (date: string, enabled: boolean) => useQuery({ queryKey: tk.team(date), queryFn: () => get<TeamToday>('/attendance/team', { date }), enabled });
export const useMyRegs = () => useQuery({ queryKey: tk.regsMine, queryFn: () => get<RegularizationRow[]>('/regularizations/mine') });
export const useRegs = (status: string, enabled = true) => useQuery({ queryKey: tk.regs(status), queryFn: () => get<RegularizationRow[]>('/regularizations', { status }), enabled });

export const useWeek = (weekStart: string | null) =>
  useQuery({ queryKey: tk.week(weekStart ?? 'default'), queryFn: () => get<TimesheetWeek>('/timesheets/me/week', weekStart ? { weekStart } : undefined) });
export const useTsOptions = () => useQuery({ queryKey: tk.options, queryFn: () => get<TimesheetOptions>('/timesheets/options'), staleTime: 60_000 });

export const useApprovals = (level: number, status: string, enabled = true) =>
  useQuery({ queryKey: tk.approvals(level, status), queryFn: () => get<ApprovalList>('/timesheet-approvals', { level, status }), enabled });
export const useApproval = (stepId: string | null, page: number, date: string, taskKey: string) =>
  useQuery({
    queryKey: tk.approval(stepId ?? '', page, date, taskKey),
    queryFn: () => get<ApprovalDetail>(`/timesheet-approvals/${stepId}`, { page, date: date || undefined, taskKey: taskKey || undefined }),
    enabled: !!stepId,
  });

export const useShifts = () => useQuery({ queryKey: tk.shifts, queryFn: () => get<ShiftRow[]>('/shifts') });
export const useAllocations = () => useQuery({ queryKey: tk.allocations, queryFn: () => get<ShiftAllocationRow[]>('/shifts/allocations') });
export const useLocations = () => useQuery({ queryKey: tk.locations, queryFn: () => get<LocationRow[]>('/locations') });
export const useLocation = (id: string | null) => useQuery({ queryKey: tk.location(id ?? ''), queryFn: () => get<LocationDetail>(`/locations/${id}`), enabled: !!id });
export const usePolicy = () => useQuery({ queryKey: tk.policy, queryFn: () => get<{ office: AttendancePolicyDto; remote: AttendancePolicyDto }>('/attendance-policy') });
export const useHolidays = (year: number) => useQuery({ queryKey: tk.holidays(year), queryFn: () => get<HolidayRow[]>('/holidays', { year }) });
export const useUpcomingHolidays = () => useQuery({ queryKey: ['time', 'holidays-upcoming'], queryFn: () => get<HolidayGroup[]>('/holidays/upcoming') });

export const useIdSummary = (date: string) => useQuery({ queryKey: tk.idSummary(date), queryFn: () => get<IdComplianceSummary>('/id-compliance/summary', { date }) });
export const useIdChecks = (date: string, wearing: string) =>
  useQuery({ queryKey: tk.idChecks(date, wearing), queryFn: () => get<IdCheckRow[]>('/id-compliance/checks', { date, wearing: wearing || undefined }) });
export const useIdPending = (date: string) => useQuery({ queryKey: tk.idPending(date), queryFn: () => get<IdPendingRow[]>('/id-compliance/pending', { date }) });

export const useLocks = (enabled = true) => useQuery({ queryKey: tk.locks, queryFn: () => get<PeriodLockRow[]>('/period-locks'), enabled });
export const useLockReadiness = (month: string) => useQuery({ queryKey: tk.lockReadiness(month), queryFn: () => get<PeriodLockReadiness>('/period-locks/readiness', { month }) });
export const useDevices = (enabled = true) => useQuery({ queryKey: tk.devices, queryFn: () => get<BiometricDeviceRow[]>('/attendance/biometric/devices'), enabled, refetchInterval: 60_000 });
export const useUnclaimed = (enabled = true) =>
  useQuery({ queryKey: tk.unclaimed, queryFn: () => get<{ serialNumber: string; firstSeenAt: string; lastSeenAt: string; ip: string | null; model: string | null }[]>('/attendance/biometric/unclaimed'), enabled });
export const useEnrollments = (enabled = true) => useQuery({ queryKey: tk.enrollments, queryFn: () => get<EnrollmentRow[]>('/attendance/biometric/enrollments'), enabled });
export const useBioLogs = (deviceId: string, enabled = true) =>
  useQuery({ queryKey: [...tk.bioLogs, deviceId], queryFn: () => get<RawLogRow[]>('/attendance/biometric/logs', { deviceId: deviceId || undefined }), enabled });

// ── formatting helpers ─────────────────────────────────────────────────────
/** 2480 → "41h 20m" */
export function hm(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
/** 55 → "55m", 130 → "2h 10m", 8520 → "142h" */
export function dur(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 && h < 100 ? `${h}h ${m % 60}m` : `${h}h`;
}
/** Grid cell: 270 → "4:30", 0 → "–" */
export function hmm(min: number): string {
  if (!min) return '–';
  const sign = min < 0 ? '-' : '';
  const m = Math.abs(min);
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
/** "4:30" | "4.5" | "270m" → minutes; null when unparseable. */
export function parseHmm(v: string): number | null {
  const s = v.trim();
  if (!s || s === '–' || s === '-') return 0;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2})(?:\.(\d+))?h?$/.exec(s);
  if (m) return Math.round(Number(s.replace('h', '')) * 60);
  m = /^(\d{1,4})m$/.exec(s);
  if (m) return Number(m[1]);
  return null;
}
export function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}
export function addDaysKey(key: string, n: number): string {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function hhmmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
/** "2026-09-29" → "Tue 29 Sep" */
export function dayKeyLabel(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
/** ISO instant → "29 Sep, 09:41" (IST). */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return `${d.getUTCDate()} ${d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}, ${d.toISOString().slice(11, 16)}`;
}
export function timeOf(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(11, 16);
}
