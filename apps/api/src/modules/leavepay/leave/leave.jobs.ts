import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { runAsTenant } from '../../../core/context/request-context';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { AuditService } from '../../../core/audit/audit.service';
import { todayKey, yearOf } from '../common/dates';
import { LeaveAdminService } from './leave-admin.service';
import { LeaveRequestsService } from './leave-requests.service';

/** Leave schedules: monthly/annual credits, year-end, comp-off expiry, approver reminders + escalation. */
@Injectable()
export class LeaveJobs {
  private readonly log = new Logger('LeaveJobs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: LeaveAdminService,
    private readonly requests: LeaveRequestsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private async eachTenant(name: string, fn: () => Promise<unknown>) {
    const tenants = await this.prisma.raw.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const t of tenants) {
      try {
        await runAsTenant(t.id, fn);
      } catch (e) {
        this.log.error(`${name} failed for tenant ${t.id}: ${(e as Error).message}`);
      }
    }
  }

  /** 00:30 IST on the 1st: due credit rules (monthly EL 1.5, quarterly, and yearly on 1 Jan) + year-end on 1 Jan. */
  @Cron('30 0 1 * *', { timeZone: 'Asia/Kolkata' })
  async monthlyCredits() {
    const today = todayKey();
    await this.eachTenant('leave.credits', async () => {
      if (today.slice(5, 10) === '01-01') {
        try {
          await this.admin.runYearEnd(yearOf(today) - 1);
        } catch (e) {
          this.log.warn(`Year-end: ${(e as Error).message}`);
        }
      }
      await this.admin.runDueRules(today);
    });
  }

  /** 01:15 IST daily: expire comp-off grants. */
  @Cron('15 1 * * *', { timeZone: 'Asia/Kolkata' })
  async compOffExpiry() {
    await this.eachTenant('leave.compOffExpiry', () => this.admin.expireCompOffs());
  }

  /** 10:00 IST daily: remind approvers of stale requests; escalate past `escalateAfterDays`. */
  @Cron('0 10 * * *', { timeZone: 'Asia/Kolkata' })
  async reminders() {
    await this.eachTenant('leave.reminders', async () => {
      const s = await this.requests.leaveSettings();
      const now = Date.now();
      const pending = await this.prisma.leaveRequest.findMany({ where: { status: 'PENDING' }, include: { employee: { select: { fullName: true } }, leaveType: { select: { name: true } } } });
      for (const r of pending) {
        const ageH = (now - r.createdAt.getTime()) / 3_600_000;
        if (ageH >= s.escalateAfterDays * 24 && r.approverSource !== 'ESCALATED' && r.approverEmployeeId) {
          const approver = await this.prisma.employee.findUnique({ where: { id: r.approverEmployeeId }, select: { id: true, managerId: true } });
          const next = approver ? await this.requests.resolveApprover({ id: approver.id, managerId: approver.managerId }) : null;
          if (next && next.id !== r.employeeId && next.id !== r.approverEmployeeId) {
            await this.prisma.leaveRequest.update({ where: { id: r.id }, data: { approverEmployeeId: next.id, approverSource: 'ESCALATED' } });
            await this.audit.record({ action: 'leave.request.escalated', entity: 'LeaveRequest', entityId: r.id, meta: { from: r.approverEmployeeId, to: next.id } });
            const users = await this.notifications.usersForEmployees([next.id, r.approverEmployeeId, r.employeeId]);
            await this.notifications.notify({ userIds: users, type: 'leave.escalated', title: `Time-off request escalated: ${r.employee.fullName}`, body: `${r.leaveType.name} request ${r.requestNo} is now with ${next.name}`, link: '/leave?tab=team', email: true });
            continue;
          }
        }
        if (ageH >= s.pendingReminderHours) {
          const users = await this.notifications.usersForEmployees([r.approverEmployeeId]);
          await this.notifications.notify({ userIds: users, type: 'leave.reminder', title: `Reminder: ${r.employee.fullName}'s time-off request is waiting`, body: `${r.leaveType.name} · ${r.requestNo}`, link: '/leave?tab=team' });
        }
      }
    });
  }
}
