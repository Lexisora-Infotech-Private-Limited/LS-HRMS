import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LookupsService } from '../../core/lookups/lookups';
import { ApprovalCountsService } from '../../core/registry/registries';
import { EventsService } from '../../core/registry/events.service';
import { JobsService } from '../../core/jobs/jobs.service';
import { hasPerm } from '../../core/auth/decorators';
import { requireContext, runAsTenant } from '../../core/context/request-context';
import { fileAccessCheckers } from '../../core/storage/files.controller';
import { CrossReader } from './cross';
import { addDays, istKeyOf, keyOf } from './lib/time-utils';
import { ApprovalService } from './services/approval.service';
import { AttendanceService } from './services/attendance.service';
import { IdCheckService } from './services/idcheck.service';
import { MastersService } from './services/masters.service';
import { PolicyService } from './services/policy.service';
import { RegularizationService } from './services/regularization.service';
import { TimesheetService } from './services/timesheet.service';

/**
 * Registries, event consumers, jobs and schedules of the time domain.
 *  - lookups: shifts, locations
 *  - approval counts: timesheets (L1/L2 steps routed to me), attendance corrections
 *  - events: tracker.segmentsIngested / idle.claimDecided → recompute days + rebuild timesheets;
 *            leave.decided → recompute days; employee.created → shift/location defaults;
 *            payroll.finalized → lock approved sheets
 *  - crons: auto-close open sessions (6 h after shift end), Friday timesheet reminders, overdue approvals
 */
@Injectable()
export class TimeRegistry implements OnModuleInit {
  private readonly log = new Logger('TimeRegistry');
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: LookupsService,
    private readonly approvalCounts: ApprovalCountsService,
    private readonly events: EventsService,
    private readonly jobs: JobsService,
    private readonly cross: CrossReader,
    private readonly attendance: AttendanceService,
    private readonly masters: MastersService,
    private readonly policies: PolicyService,
    private readonly sheets: TimesheetService,
    private readonly approvals: ApprovalService,
    private readonly regs: RegularizationService,
    private readonly idchecks: IdCheckService,
  ) {}

  onModuleInit() {
    this.lookups.register('shifts', () => this.masters.shiftOptions());
    this.lookups.register('locations', () => this.masters.locationOptions());

    this.approvalCounts.register(async (ctx) => {
      if (!hasPerm(ctx, 'timesheet.approve.l1') && !hasPerm(ctx, 'timesheet.approve.l2')) return null;
      const c = await this.approvals.pendingCounts(ctx);
      return { key: 'timesheets', label: 'Timesheets', count: c.l1 + c.l2, link: '/approvals' };
    });
    this.approvalCounts.register(async (ctx) => {
      if (!hasPerm(ctx, 'attendance.regularize.approve') && !hasPerm(ctx, 'attendance.manage')) return null;
      return { key: 'regularizations', label: 'Attendance corrections', count: await this.regs.pendingCount(ctx), link: '/approvals?tab=corrections' };
    });

    fileAccessCheckers.push((fileId) => this.idchecks.canOpenPhoto(fileId).catch(() => false));
    fileAccessCheckers.push(async (fileId) => {
      const ctx = requireContext();
      const r = await this.prisma.attendanceRegularization.findFirst({ where: { attachmentFileId: fileId }, select: { employeeId: true, approverEmployeeId: true } });
      if (!r) return false;
      return r.employeeId === ctx.employeeId || r.approverEmployeeId === ctx.employeeId || hasPerm(ctx, 'attendance.manage');
    });

    this.jobs.register('time.recomputeRange', async (d: { employeeIds: string[] | null; from: string; to: string }) => {
      await this.attendance.recomputeRange(d.employeeIds, d.from, d.to);
    });
    this.jobs.register('time.rebuildTimesheets', async (d: { employeeId: string; dates: string[] }) => {
      await this.sheets.rebuildForDates(d.employeeId, d.dates);
    });

    const onSegments = async (p: { employeeId: string; workDates?: string[]; workDate?: string }) => {
      const dates = [...new Set([...(p.workDates ?? []), ...(p.workDate ? [p.workDate] : [])].map((d) => String(d).slice(0, 10)))];
      if (!p.employeeId || !dates.length) return;
      const today = istKeyOf(new Date());
      for (const d of dates) if (d <= today) await this.attendance.recomputeDay(p.employeeId, d);
      await this.sheets.rebuildForDates(p.employeeId, dates);
    };
    this.events.on('tracker.segmentsIngested', onSegments);
    this.events.on('idle.claimDecided', onSegments);

    this.events.on('leave.decided', async (p: { requestId: string; employeeId: string }) => {
      const req = await this.cross.leaveRequest(p.requestId);
      if (!req) return;
      const today = istKeyOf(new Date());
      const from = keyOf(req.fromDate);
      const to = keyOf(req.toDate);
      if (from > today) return;
      await this.attendance.recomputeRange([req.employeeId], from, to < today ? to : today);
    });

    this.events.on('employee.created', async (p: { employeeId: string }) => {
      const e = await this.prisma.employee.findFirst({ where: { id: p.employeeId }, select: { id: true, shiftId: true, workLocationId: true, workMode: true } });
      if (!e) return;
      const data: { shiftId?: string; workLocationId?: string } = {};
      if (!e.shiftId) {
        const s = await this.policies.defaultShift();
        if (s) data.shiftId = s.id;
      }
      if (!e.workLocationId) {
        const loc = e.workMode === 'REMOTE' ? await this.policies.remoteLocation() : await this.prisma.workLocation.findFirst({ where: { isRemote: false, archivedAt: null }, orderBy: { createdAt: 'asc' } });
        if (loc) data.workLocationId = loc.id;
      }
      if (Object.keys(data).length) await this.prisma.employee.update({ where: { id: e.id }, data });
    });

    this.events.on('payroll.finalized', async (p: { period: string }) => {
      if (p?.period) await this.sheets.lockForPeriod(p.period);
    });
  }

  private async forEachTenant(fn: () => Promise<unknown>) {
    const tenants = await this.prisma.raw.tenant.findMany({ select: { id: true } });
    for (const t of tenants) {
      try {
        await runAsTenant(t.id, fn);
      } catch (e) {
        this.log.error(`tenant ${t.id}: ${(e as Error).message}`);
      }
    }
  }

  /** Close sessions left open past shift end + policy.missedPunchAutoCloseHours (default 6 h). */
  @Cron('*/30 * * * *')
  async autoClose() {
    await this.forEachTenant(() => this.attendance.autoCloseDue());
  }

  /** Friday 16:00 IST: remind employees to submit this week's timesheet. */
  @Cron('0 16 * * 5', { timeZone: 'Asia/Kolkata' })
  async fridayReminders() {
    await this.forEachTenant(() => this.sheets.remindUnsubmitted());
  }

  /** Hourly: overdue approval steps. */
  @Cron('15 * * * *')
  async overdueApprovals() {
    await this.forEachTenant(() => this.approvals.remindOverdue());
  }

  /** 00:30 IST: materialise yesterday's attendance days (absences, weekly offs) for everyone. */
  @Cron('30 0 * * *', { timeZone: 'Asia/Kolkata' })
  async closeYesterday() {
    const y = addDays(istKeyOf(new Date()), -1);
    await this.forEachTenant(() => this.attendance.recomputeRange(null, y, y));
  }
}
