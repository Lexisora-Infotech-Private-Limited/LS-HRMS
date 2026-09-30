import { Module, OnModuleInit } from '@nestjs/common';
import { TimeModule } from '../time/time.module';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LookupsService } from '../../core/lookups/lookups';
import { ApprovalCountsService, SearchService } from '../../core/registry/registries';
import { EventsService } from '../../core/registry/events.service';
import { getContext, requireContext } from '../../core/context/request-context';
import { fileAccessCheckers } from '../../core/storage/files.controller';
import { WorkCalendarService } from './common/calendar.service';
import { LeaveLedgerService } from './leave/leave-ledger.service';
import { LeaveRequestsService } from './leave/leave-requests.service';
import { LeaveAdminService } from './leave/leave-admin.service';
import { LeaveController } from './leave/leave.controller';
import { LeaveJobs } from './leave/leave.jobs';
import { SalaryService } from './payroll/salary.service';
import { PayrollEngineService } from './payroll/payroll-engine.service';
import { PayrollService } from './payroll/payroll.service';
import { PayslipService } from './payroll/payslip.service';
import { PeriodLockPort } from './payroll/period-lock.port';
import { PayrollController, PayslipsController, SalaryController } from './payroll/payroll.controller';
import { periodLabel } from './common/dates';

/**
 * Leave + payroll domain (docs/specs/spec-leavepay.md). Imports TimeModule for
 * PeriodLockService (ARCHITECTURE §5), resolved lazily through PeriodLockPort.
 */
@Module({
  imports: [TimeModule],
  controllers: [LeaveController, PayrollController, PayslipsController, SalaryController],
  providers: [WorkCalendarService, LeaveLedgerService, LeaveRequestsService, LeaveAdminService, LeaveJobs, SalaryService, PayrollEngineService, PayrollService, PayslipService, PeriodLockPort],
  exports: [LeaveRequestsService, SalaryService],
})
export class LeavepayModule implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: LookupsService,
    private readonly approvals: ApprovalCountsService,
    private readonly search: SearchService,
    private readonly events: EventsService,
    private readonly requests: LeaveRequestsService,
    private readonly admin: LeaveAdminService,
    private readonly payroll: PayrollService,
  ) {}

  onModuleInit() {
    this.lookups.register('leaveTypes', async () => {
      const ctx = getContext();
      const hr = !!ctx && (ctx.permissions.has('*') || ctx.permissions.has('leave.manage'));
      const rows = await this.prisma.leaveType.findMany({ where: { active: true, ...(hr ? {} : { hidden: false }) }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] });
      return rows.map((t) => ({ value: t.id, label: t.name }));
    });

    // Dashboard "Awaiting your approval" → "Time-off requests N".
    this.approvals.register(async (ctx) => {
      if (!ctx.employeeId) return null;
      const can = ctx.permissions.has('leave.approve') || ctx.permissions.has('leave.manage');
      const count = await this.requests.pendingCountFor(ctx.employeeId);
      if (!can && !count) return null;
      return { key: 'leave', label: 'Time-off requests', count, link: '/leave?tab=team' };
    });

    this.search.register('Payslips', async (q, ctx) => {
      if (!ctx.employeeId || !/payslip|salary|pay/i.test(q)) return [];
      const rows = await this.prisma.payslip.findMany({ where: { employeeId: ctx.employeeId, status: 'PUBLISHED' }, orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }], take: 3 });
      return rows.map((p) => ({ type: 'Payslips', id: p.id, title: `Payslip · ${periodLabel(p.period)}`, subtitle: 'My payslips', link: '/payslips' }));
    });

    // Private files this domain references: payslip PDFs (owner or payroll), bank files (payroll), leave attachments (approver/HR).
    fileAccessCheckers.push(async (fileId) => {
      const ctx = requireContext();
      const payroll = ctx.permissions.has('payroll.manage');
      const slip = await this.prisma.payslip.findFirst({ where: { fileId }, select: { employeeId: true, status: true } });
      if (slip) return payroll || (slip.employeeId === ctx.employeeId && slip.status === 'PUBLISHED');
      if (payroll && (await this.prisma.bankTransferFile.count({ where: { fileId } }))) return true;
      const req = await this.prisma.leaveRequest.findFirst({ where: { attachmentFileId: fileId }, select: { employeeId: true, approverEmployeeId: true } });
      if (req) return ctx.permissions.has('leave.manage') || req.employeeId === ctx.employeeId || req.approverEmployeeId === ctx.employeeId;
      return false;
    });

    this.events.on('employee.created', async (p: { employeeId: string }) => this.admin.onEmployeeCreated(p.employeeId));
    this.events.on('timesheet.approved', async (p: { employeeId: string; weekStart: string | Date }) => {
      const wk = typeof p.weekStart === 'string' ? p.weekStart.slice(0, 10) : p.weekStart.toISOString().slice(0, 10);
      await this.payroll.onTimesheetApproved(p.employeeId, wk);
    });
  }
}
