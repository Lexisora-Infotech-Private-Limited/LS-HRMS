import type { LeaveSettings, LeaveRequestStatusKey, LeaveRequestRow } from '@lexisora/shared';
import { LEAVE_STATUS_LABEL } from '@lexisora/shared';
import { dayMonth, dk, rangeLabel } from '../common/dates';

export const LEAVE_SETTINGS_KEY = 'leave.settings';
export const DEFAULT_LEAVE_SETTINGS: LeaveSettings = {
  excessBalanceAction: 'REJECT',
  escalateAfterDays: 3,
  pendingReminderHours: 24,
  compOffHalfDayMinMinutes: 240,
  compOffFullDayMinMinutes: 420,
  compOffRequestWindowDays: 30,
  teamOverlapWarnPct: 30,
};

/** Active statuses whose days block the calendar (overlap) and feed sandwich coverage. */
export const ACTIVE_STATUSES = ['PENDING', 'APPROVED', 'CANCELLATION_PENDING'] as const;

export type BreakdownDay = { date: string; kind: 'WORKING' | 'WEEKLY_OFF' | 'HOLIDAY'; session: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF'; units: number; isSandwich: boolean; isPaid: boolean; holidayName?: string };

export const HALF_LABEL: Record<string, string> = { FIRST_HALF: 'first half', SECOND_HALF: 'second half' };

/** "14 – 16 Oct", "2 Jul · first half". */
export function requestDatesLabel(from: Date | string, to: Date | string, halfDay: string): string {
  const f = dk(from);
  const t = dk(to);
  if (f === t && halfDay !== 'NONE') return `${dayMonth(f)} · ${HALF_LABEL[halfDay] ?? ''}`;
  return rangeLabel(f, t);
}

export type RequestWithRefs = {
  id: string;
  requestNo: string;
  employeeId: string;
  leaveTypeId: string;
  fromDate: Date;
  toDate: Date;
  halfDay: string;
  days: number;
  lopDays: number;
  reason: string | null;
  status: string;
  approverEmployeeId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
  employee: { fullName: string; empCode: string; department: { name: string } | null };
  leaveType: { code: string; name: string };
};

export type Viewer = { employeeId: string | null; isHr: boolean; today: string };

export function toRequestRow(r: RequestWithRefs, approverName: string | null, viewer: Viewer): LeaveRequestRow {
  const status = r.status as LeaveRequestStatusKey;
  const own = viewer.employeeId === r.employeeId;
  const isApprover = !!viewer.employeeId && viewer.employeeId === r.approverEmployeeId && !own;
  const canDecide = (isApprover || (viewer.isHr && !own));
  const from = dk(r.fromDate);
  return {
    id: r.id,
    requestNo: r.requestNo,
    employeeId: r.employeeId,
    employeeName: r.employee.fullName,
    employeeCode: r.employee.empCode,
    department: r.employee.department?.name ?? null,
    leaveTypeId: r.leaveTypeId,
    typeCode: r.leaveType.code,
    typeName: r.leaveType.name,
    fromDate: from,
    toDate: dk(r.toDate),
    dates: requestDatesLabel(r.fromDate, r.toDate, r.halfDay),
    days: r.days,
    lopDays: r.lopDays,
    reason: r.reason,
    status,
    statusLabel: LEAVE_STATUS_LABEL[status] ?? status,
    approverId: r.approverEmployeeId,
    approverName,
    appliedOn: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    can: {
      withdraw: own && status === 'PENDING',
      cancel: (own || viewer.isHr) && status === 'APPROVED' && (from > viewer.today || viewer.isHr),
      requestCancel: own && !viewer.isHr && status === 'APPROVED' && from <= viewer.today,
      approve: canDecide && status === 'PENDING',
      reject: canDecide && status === 'PENDING',
      decideCancellation: canDecide && status === 'CANCELLATION_PENDING',
    },
  };
}

export const requestInclude = { employee: { select: { fullName: true, empCode: true, department: { select: { name: true } } } }, leaveType: { select: { code: true, name: true } } } as const;
