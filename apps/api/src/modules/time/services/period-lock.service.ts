import { Injectable } from '@nestjs/common';
import type { PeriodLockReadiness, PeriodLockRow } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { EventsService } from '../../../core/registry/events.service';
import { getContext } from '../../../core/context/request-context';
import { AppError } from '../../../core/http/errors';
import { dateOf, keyOf, monthOf, monthRange } from '../lib/time-utils';

/**
 * Attendance / payroll period locks (MASTER D9: one PeriodLock, owned by Time; error code
 * PERIOD_LOCKED). Exported for leavepay: the payroll run calls `lock(month, upTo)` first.
 */
@Injectable()
export class PeriodLockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /** True when the IST date (Date or "YYYY-MM-DD") falls in an active lock. */
  async isLocked(date: Date | string): Promise<boolean> {
    const key = typeof date === 'string' ? date : keyOf(date);
    const lock = await this.prisma.periodLock.findFirst({ where: { month: monthOf(key), unlockedAt: null, lockedUpTo: { gte: dateOf(key) } } });
    return !!lock;
  }

  async assertOpen(date: Date | string, what = 'This date') {
    if (await this.isLocked(date)) throw new AppError(409, 'PERIOD_LOCKED', `${what} is in a locked attendance period`);
  }

  /** Lock a month up to (and including) `upTo` (default: month end). */
  async lock(month: string, upTo?: Date | string, payrollRunId?: string): Promise<PeriodLockRow> {
    const range = monthRange(month);
    const upKey = upTo ? (typeof upTo === 'string' ? upTo : keyOf(upTo)) : range.to;
    if (monthOf(upKey) !== month) throw new AppError(422, 'LOCK_RANGE', 'Lock date must fall in the chosen month');
    const ctx = getContext();
    const row = await this.prisma.periodLock.upsert({
      where: { tenantId_month: { tenantId: ctx!.tenantId, month } },
      create: { month, lockedUpTo: dateOf(upKey), lockedByName: ctx?.userName ?? 'System', payrollRunId: payrollRunId ?? null } as any,
      update: { lockedUpTo: dateOf(upKey), lockedByName: ctx?.userName ?? 'System', lockedAt: new Date(), unlockedAt: null, unlockReason: null, ...(payrollRunId ? { payrollRunId } : {}) },
    });
    await this.prisma.attendanceDay.updateMany({ where: { date: { gte: dateOf(range.from), lte: dateOf(upKey) } }, data: { isLocked: true } });
    await this.audit.record({ action: 'attendance.period.locked', entity: 'PeriodLock', entityId: row.id, meta: { month, upTo: upKey } });
    this.events.emit('attendance.period.locked', { month, upTo: upKey });
    return toRow(row);
  }

  async unlock(month: string, reason: string): Promise<PeriodLockRow> {
    const row = await this.prisma.periodLock.findFirst({ where: { month } });
    if (!row || row.unlockedAt) throw new AppError(404, 'NOT_FOUND', 'This month is not locked');
    const range = monthRange(month);
    const saved = await this.prisma.periodLock.update({ where: { id: row.id }, data: { unlockedAt: new Date(), unlockReason: reason } });
    await this.prisma.attendanceDay.updateMany({ where: { date: { gte: dateOf(range.from), lte: dateOf(range.to) } }, data: { isLocked: false } });
    await this.audit.record({ action: 'attendance.period.unlocked', entity: 'PeriodLock', entityId: row.id, meta: { month, reason } });
    return toRow(saved);
  }

  async list(): Promise<PeriodLockRow[]> {
    const rows = await this.prisma.periodLock.findMany({ orderBy: { month: 'desc' }, take: 24 });
    return rows.map(toRow);
  }

  /** "Before you lock" checklist for a month: open items that would be frozen by the lock. */
  async readiness(month: string): Promise<PeriodLockReadiness> {
    const { from, to } = monthRange(month);
    const range = { gte: dateOf(from), lte: dateOf(to) };
    const [lock, pendingCorrections, missedPunchDays, openSessions, sheets, days] = await Promise.all([
      this.prisma.periodLock.findFirst({ where: { month } }),
      this.prisma.attendanceRegularization.count({ where: { date: range, status: 'PENDING' } }),
      this.prisma.attendanceDay.count({ where: { date: range, status: 'MISSED_PUNCH' } }),
      this.prisma.workSession.count({ where: { attendanceDate: range, endedAt: null } }),
      // Weeks overlapping the month (Mon start can fall in the previous month).
      this.prisma.timesheet.groupBy({ by: ['status'], where: { weekEnd: { gte: dateOf(from) }, weekStart: { lte: dateOf(to) } }, _count: { _all: true } }),
      this.prisma.attendanceDay.count({ where: { date: range } }),
    ]);
    const count = (s: string[]) => sheets.filter((x) => s.includes(x.status)).reduce((n, x) => n + x._count._all, 0);
    return {
      month,
      lock: lock ? toRow(lock) : null,
      attendanceDays: days,
      pendingCorrections,
      missedPunchDays,
      openSessions,
      timesheetsPending: count(['DRAFT', 'SUBMITTED', 'PENDING_RM', 'RETURNED']),
      timesheetsApproved: count(['APPROVED', 'LOCKED']),
    };
  }
}

function toRow(r: { month: string; lockedUpTo: Date; lockedByName: string | null; lockedAt: Date; unlockedAt: Date | null; unlockReason: string | null }): PeriodLockRow {
  return {
    month: r.month,
    lockedUpTo: keyOf(r.lockedUpTo),
    lockedBy: r.lockedByName,
    lockedAt: r.lockedAt.toISOString(),
    unlockedAt: r.unlockedAt?.toISOString() ?? null,
    unlockReason: r.unlockReason,
    active: !r.unlockedAt,
  };
}
