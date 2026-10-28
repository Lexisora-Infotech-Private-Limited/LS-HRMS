import { Injectable, Logger } from '@nestjs/common';
import type { AttendancePolicy } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { getContext, runAsTenant } from '../../../core/context/request-context';
import { KeyedLock } from '../../time/lib/keyed-lock';
import { dayMonth, dd, dk, yearOf } from '../common/dates';
import { LeaveRequestsService, type ApplyCore } from './leave-requests.service';
import { LATE_ARRIVAL } from './leave.common';

/** lateOverLimit: the half day comes from the shift's monthly late limit (late number N+1 or later), not from how late. */
export type DayComputed = { employeeId: string; date: string; status: string; lateHalfDay: boolean; lateByMinutes: number; lateOverLimit?: boolean; lateAllowed?: number; audience: 'OFFICE' | 'REMOTE' };

/** "2h 10m" */
function dur(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
}

/**
 * Late by the shift's half-day threshold (attendance: AttendanceDay.lateHalfDay) → the first half of
 * the day is booked as approved half-day leave: the policy's leave type (leave settings
 * latePenaltyLeaveCode, CL) while it has balance, else the unpaid type (LWP). It shows in Time off and
 * the leave balance like any leave. Kept in step with the day on every recompute: excusing the late
 * mark or correcting the punch-in removes it again. Policy: AttendancePolicy.lateHalfDayAsLeave +
 * latePenaltySource (NONE = never book), only for days on/after lateHalfDayLeaveFrom.
 */
@Injectable()
export class LeaveLateArrivalService {
  private readonly log = new Logger('LateArrivalLeave');
  private readonly lock = new KeyedLock();

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: LeaveRequestsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** attendance.dayComputed handler. Runs as the system (not as whoever triggered the recompute). */
  async sync(p: DayComputed): Promise<void> {
    const tenantId = getContext()?.tenantId;
    if (!tenantId || !p?.employeeId || !p.date) return;
    await runAsTenant(tenantId, () => this.lock.run(`${p.employeeId}|${p.date}`, () => this.syncNow(p)));
  }

  private async syncNow(p: DayComputed): Promise<void> {
    const existing = await this.prisma.leaveRequest.findFirst({ where: { employeeId: p.employeeId, fromDate: dd(p.date), autoReason: LATE_ARRIVAL, status: { in: ['PENDING', 'APPROVED', 'CANCELLATION_PENDING'] } } });
    if (!p.lateHalfDay) {
      // The reason went away (late mark excused, punch-in corrected): give the half day back.
      if (existing) {
        await this.requests.cancelSystem(existing.id, 'Late arrival excused or corrected');
        await this.audit.record({ action: 'leave.late_arrival.removed', entity: 'LeaveRequest', entityId: existing.id, meta: { date: p.date } });
      }
      return;
    }
    if (existing) return;
    const policy = await this.prisma.attendancePolicy.findFirst({ where: { audience: p.audience } });
    if (!policy || !policy.lateHalfDayAsLeave || policy.latePenaltySource === 'NONE' || p.date < dk(policy.lateHalfDayLeaveFrom)) return;
    await this.book(p, policy).catch((e) => this.log.warn(`late half day ${p.employeeId} ${p.date} not booked: ${(e as Error).message}`));
  }

  private async book(p: DayComputed, policy: AttendancePolicy): Promise<void> {
    // Leave already on the day (approved, or still waiting for a decision) — nothing to add now. If a
    // pending one is rejected / withdrawn, leave.decided recomputes the day and this books it then.
    const covered = await this.prisma.leaveRequest.count({ where: { employeeId: p.employeeId, status: { in: ['PENDING', 'APPROVED', 'CANCELLATION_PENDING'] }, fromDate: { lte: dd(p.date) }, toDate: { gte: dd(p.date) } } });
    if (covered) return;
    const emp = await this.prisma.employee.findUnique({ where: { id: p.employeeId }, select: { employmentType: true, userId: true } });
    if (!emp) return;
    const settings = await this.requests.leaveSettings();
    const code = settings.latePenaltyLeaveCode || 'CL';
    const types = await this.prisma.leaveType.findMany({ where: { active: true, isCompOff: false, allowHalfDay: true }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] });
    const fits = (t: (typeof types)[number]) => t.appliesTo.includes(emp.employmentType);
    const paid = policy.latePenaltySource === 'LEAVE_THEN_LOP' ? types.find((t) => t.code === code && t.isPaid && fits(t)) : undefined;
    const unpaid = types.find((t) => !t.isPaid && fits(t));
    let type = paid && (await this.requests.availableFor(p.employeeId, paid.id, yearOf(p.date))) >= 0.5 ? paid : unpaid;
    if (!type) {
      // No unpaid type configured: attendance still counts only the second half (half-day LOP in payroll).
      this.log.warn(`no ${code}/unpaid leave type for late half day of ${p.employeeId} on ${p.date}`);
      return;
    }
    const late = dur(p.lateByMinutes);
    const overLimit = !!p.lateOverLimit && (p.lateAllowed ?? 0) > 0;
    const why = overLimit ? `late more than ${p.lateAllowed} ${p.lateAllowed === 1 ? 'time' : 'times'} this month` : `${late} late`;
    const input: ApplyCore = { leaveTypeId: type.id, fromDate: p.date, toDate: p.date, halfDay: 'FIRST_HALF', fromSession: 'FULL', toSession: 'FULL', reason: `Late arrival · ${why}`, acceptLop: true };
    let row;
    try {
      row = await this.requests.applySystem(p.employeeId, input, LATE_ARRIVAL, 'System · late arrival');
    } catch (e) {
      // CL ran out between the check and the booking: fall back to the unpaid type.
      if (type === unpaid || !unpaid) throw e;
      type = unpaid;
      row = await this.requests.applySystem(p.employeeId, { ...input, leaveTypeId: unpaid.id }, LATE_ARRIVAL, 'System · late arrival');
    }
    await this.audit.record({ action: 'leave.late_arrival.booked', entity: 'LeaveRequest', entityId: row.id, meta: { date: p.date, lateByMinutes: p.lateByMinutes, overLimit, type: type.code } });
    if (emp.userId) {
      const as = type.isPaid ? type.name : 'leave without pay';
      await this.notifications.notify({
        userIds: [emp.userId],
        type: 'leave.lateArrival',
        title: overLimit ? `Half-day ${type.name.toLowerCase()} booked · late more than ${p.lateAllowed} times this month` : `Half-day ${type.name.toLowerCase()} booked · late by ${late}`,
        body: overLimit
          ? `${dayMonth(p.date)}: ${p.lateAllowed} late ${p.lateAllowed === 1 ? 'arrival is' : 'arrivals are'} allowed a month and this was one more (${late} late), so the first half is counted as ${as}. If your manager agreed to it, ask for “Excuse late mark” in My attendance — the half day is then removed.`
          : `${dayMonth(p.date)}: you punched in ${late} after your shift started, so the first half is counted as ${as}. If your manager agreed to it, ask for “Excuse late mark” in My attendance — the half day is then removed.`,
        link: '/leave',
      });
    }
  }
}
