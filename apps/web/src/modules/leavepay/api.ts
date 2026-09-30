import type {
  AdjustmentRow,
  CreditBatchRow,
  CreditRuleRow,
  LeaveApplyInput,
  LeaveBalanceView,
  LeaveHolidayRow,
  LeavePreview,
  LeaveRequestDetail,
  LeaveRequestRow,
  LeaveTypeInput,
  LeaveTypeRow,
  ManualCreditInput,
  ManualCreditRow,
  Paginated,
  PayrollItemDetail,
  PayrollProfileInput,
  PayrollPeriodView,
  PayrollRunInput,
  PayrollRunView,
  PayslipDetail,
  PayslipRow,
  SalaryListRow,
  SalaryPreview,
  SalaryPreviewInput,
  SalaryRevisionInput,
  SalaryView,
  TeamRequestRow,
  UpcomingItem,
} from '@lexisora/shared';
import { del, download, get, patch, post } from '@/lib/api';

/** Leave + payroll API (docs/specs/spec-leavepay.md). */

export const lpKeys = {
  balances: ['leavepay', 'balances'] as const,
  myRequests: ['leavepay', 'my-requests'] as const,
  upcoming: ['leavepay', 'upcoming'] as const,
  team: ['leavepay', 'team'] as const,
  request: (id: string) => ['leavepay', 'request', id] as const,
  types: ['leavepay', 'types'] as const,
  rules: ['leavepay', 'rules'] as const,
  batches: ['leavepay', 'batches'] as const,
  credits: ['leavepay', 'credits'] as const,
  admin: ['leavepay', 'admin-requests'] as const,
  holidays: ['leavepay', 'holidays'] as const,
  period: (p: string) => ['leavepay', 'payroll', p] as const,
  payroll: ['leavepay', 'payroll'] as const,
  item: (id: string) => ['leavepay', 'payroll-item', id] as const,
  salaries: ['leavepay', 'salaries'] as const,
  salary: (id: string) => ['leavepay', 'salary', id] as const,
  payslips: ['leavepay', 'payslips'] as const,
  payslip: (id: string) => ['leavepay', 'payslip', id] as const,
  adjustments: ['leavepay', 'adjustments'] as const,
};

/** Every leave query (invalidate after a leave mutation). */
export const LEAVE_ALL = ['leavepay'] as const;

export type AdminRequests = Paginated<LeaveRequestRow> & { counts: Record<string, number> };

export const lpApi = {
  // leave — self
  balances: () => get<LeaveBalanceView[]>('/leave/me/balances'),
  myRequests: (q: { page?: number; pageSize?: number; year?: number } = {}) => get<Paginated<LeaveRequestRow>>('/leave/me/requests', { pageSize: 50, ...q }),
  upcoming: () => get<UpcomingItem[]>('/leave/me/upcoming'),
  preview: (body: LeaveApplyInput) => post<LeavePreview>('/leave/requests/preview', body),
  apply: (body: LeaveApplyInput) => post<LeaveRequestRow>('/leave/requests', body),
  detail: (id: string) => get<LeaveRequestDetail>(`/leave/requests/${id}`),
  withdraw: (id: string) => post<LeaveRequestRow>(`/leave/requests/${id}/withdraw`),
  cancel: (id: string, reason?: string) => post<LeaveRequestRow>(`/leave/requests/${id}/cancel`, { reason }),
  // leave — approvals
  team: (tab: 'PENDING' | 'HISTORY') => get<TeamRequestRow[]>('/leave/team/requests', { tab }),
  approve: (id: string, comment?: string) => post<LeaveRequestRow>(`/leave/requests/${id}/approve`, { comment }),
  reject: (id: string, comment: string) => post<LeaveRequestRow>(`/leave/requests/${id}/reject`, { comment }),
  decideCancellation: (id: string, approve: boolean) => post<LeaveRequestRow>(`/leave/requests/${id}/cancellation/${approve ? 'approve' : 'reject'}`),
  approveCompOff: (id: string) => post(`/leave/comp-off/requests/${id}/approve`, {}),
  rejectCompOff: (id: string, comment: string) => post(`/leave/comp-off/requests/${id}/reject`, { comment }),
  // leave — setup
  types: () => get<LeaveTypeRow[]>('/leave/types'),
  createType: (body: Partial<LeaveTypeInput>) => post<LeaveTypeRow>('/leave/types', body),
  updateType: (id: string, body: Partial<LeaveTypeInput> & { active?: boolean }) => patch<LeaveTypeRow>(`/leave/types/${id}`, body),
  deleteType: (id: string) => del(`/leave/types/${id}`),
  rules: () => get<CreditRuleRow[]>('/leave/rules'),
  runRule: (id: string) => post<{ employees?: number; totalDays?: number }>(`/leave/rules/${id}/run`, {}),
  batches: () => get<CreditBatchRow[]>('/leave/batches'),
  credits: () => get<ManualCreditRow[]>('/leave/credits'),
  credit: (body: ManualCreditInput) => post<{ employees?: number }>('/leave/credits', body),
  adminRequests: (q: Record<string, unknown>) => get<AdminRequests>('/leave/admin/requests', q),
  holidays: () => get<LeaveHolidayRow[]>('/leave/holidays'),
  // payroll
  period: (period: string, refresh = false) => get<PayrollPeriodView>(`/payroll/period/${period}`, refresh ? { refresh: true } : undefined),
  createRun: (body: PayrollRunInput) => post<PayrollRunView>('/payroll/runs', body),
  updateRun: (id: string, body: Partial<PayrollRunInput>) => patch<PayrollRunView>(`/payroll/runs/${id}`, body),
  recalculate: (id: string) => post<PayrollRunView>(`/payroll/runs/${id}/recalculate`, {}),
  finalize: (id: string) => post<{ run: PayrollRunView; payslips: number }>(`/payroll/runs/${id}/finalize`),
  cancelRun: (id: string, reason: string) => post(`/payroll/runs/${id}/cancel`, { reason }),
  markPaid: (id: string) => post<PayrollRunView>(`/payroll/runs/${id}/mark-paid`),
  item: (id: string) => get<PayrollItemDetail>(`/payroll/items/${id}`),
  hold: (runId: string, itemId: string, reason: string) => post<PayrollItemDetail>(`/payroll/runs/${runId}/items/${itemId}/hold`, { reason }),
  release: (runId: string, itemId: string) => post<PayrollItemDetail>(`/payroll/runs/${runId}/items/${itemId}/release`),
  remindRms: (period: string) => post<{ managers: number; employees: number }>('/payroll/remind-rms', { period }),
  adjustments: (period?: string) => get<AdjustmentRow[]>('/payroll/adjustments', period ? { period } : undefined),
  // salary
  salaries: () => get<SalaryListRow[]>('/salary/employees'),
  salary: (employeeId: string) => get<SalaryView>(`/salary/employee/${employeeId}`),
  salaryPreview: (body: SalaryPreviewInput) => post<SalaryPreview>('/salary/preview', body),
  revise: (employeeId: string, body: SalaryRevisionInput) => post<SalaryView>(`/salary/employee/${employeeId}/revisions`, body),
  updateProfile: (employeeId: string, body: PayrollProfileInput) => patch<SalaryView>(`/salary/employee/${employeeId}/profile`, body),
  // payslips
  myPayslips: () => get<PayslipRow[]>('/payslips/me'),
  payslip: (id: string) => get<PayslipDetail>(`/payslips/${id}`),
  downloadPayslip: (id: string, filename?: string) => download(`/payslips/${id}/pdf`, filename),
};

/** "2026-09" for today's IST month. */
export function currentPeriod(): string {
  const d = new Date(Date.now() + 330 * 60_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

export function fmtHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h${m ? ` ${m}m` : ''}`;
}
