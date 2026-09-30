import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { PayrollItem, PayrollRun } from '@prisma/client';
import {
  PAYROLL_ITEM_STATUS_LABEL,
  type AdjustmentInput,
  type AdjustmentRow,
  type PayrollItemDetail,
  type PayrollItemRow,
  type PayrollKpis,
  type PayrollPeriodView,
  type PayrollPrecheck,
  type PayrollRunInput,
  type PayrollRunView,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { currentTenantId, requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, notFound } from '../../../core/http/errors';
import { AuditService } from '../../../core/audit/audit.service';
import { CryptoService } from '../../../core/crypto/crypto.service';
import { EventsService } from '../../../core/registry/events.service';
import { JobsService } from '../../../core/jobs/jobs.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { StorageService } from '../../../core/storage/storage.service';
import { addDays, dd, dk, monthBounds, periodLabel, periodOf, prevPeriod, todayKey } from '../common/dates';
import { fmtDays } from '../leave/leave-calc';
import { fmtHm } from './payroll-calc';
import { GATE_OK } from './payroll-days';
import { ADJ_LABEL, PayrollEngineService, type EngineRow } from './payroll-engine.service';
import { PayslipService } from './payslip.service';
import { PeriodLockPort } from './period-lock.port';

const JOB_CALC = 'leavepay.payroll.calculate';
const JOB_PUBLISH = 'leavepay.payslips.publish';
const PREVIEW_TTL_MS = 10 * 60 * 1000;

type ItemLike = Pick<PayrollItem, 'id' | 'employeeId' | 'payType' | 'paidDays' | 'workingDays' | 'leaveLabel' | 'idleMinutesDeductible' | 'idleMinutesRaw' | 'totalEarningsPaise' | 'totalDeductionsPaise' | 'netPaise' | 'status' | 'timesheetGate' | 'errors'> & { name: string; code: string; department: string | null };

function toItemRow(i: ItemLike): PayrollItemRow {
  return {
    id: i.id,
    employeeId: i.employeeId,
    name: i.name,
    code: i.code,
    department: i.department,
    payType: i.payType,
    paidDays: i.paidDays,
    workingDays: i.workingDays,
    leave: i.leaveLabel,
    idleMinutes: i.idleMinutesDeductible,
    idleRawMinutes: i.idleMinutesRaw,
    grossPaise: i.totalEarningsPaise,
    deductionsPaise: i.totalDeductionsPaise,
    netPaise: i.netPaise,
    status: i.status,
    statusLabel: PAYROLL_ITEM_STATUS_LABEL[i.status] ?? i.status,
    timesheetGate: i.timesheetGate,
    errors: (i.errors as string[]) ?? [],
  };
}

function engineToRow(r: EngineRow): PayrollItemRow {
  return toItemRow({
    id: `preview-${r.employeeId}`,
    employeeId: r.employeeId,
    name: r.name,
    code: r.code,
    department: r.department,
    payType: r.payType,
    paidDays: r.result?.paidDays ?? 0,
    workingDays: r.days.workingDays,
    leaveLabel: r.leaveLabel,
    idleMinutesDeductible: r.result?.idleMinutesDeductible ?? 0,
    idleMinutesRaw: r.idleRaw,
    totalEarningsPaise: r.result?.totalEarningsPaise ?? 0,
    totalDeductionsPaise: r.result?.totalDeductionsPaise ?? 0,
    netPaise: r.result?.netPaise ?? 0,
    status: r.status,
    timesheetGate: r.timesheetGate,
    errors: r.errors as any,
  });
}

@Injectable()
export class PayrollService implements OnModuleInit {
  private readonly log = new Logger('Payroll');
  private readonly previewCache = new Map<string, { at: number; rows: EngineRow[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: PayrollEngineService,
    private readonly payslips: PayslipService,
    private readonly lockPort: PeriodLockPort,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
  ) {}

  onModuleInit() {
    this.jobs.register(JOB_CALC, (d: { runId: string; calcVersion: number }) => this.calculateRun(d.runId, d.calcVersion));
    this.jobs.register(JOB_PUBLISH, (d: { runId: string }) => this.payslips.publishRun(d.runId));
  }

  // ── views ─────────────────────────────────────────────────────────────

  private runView(run: PayrollRun, bank: { id: string; fileName: string; entryCount: number; totalPaise: number; status: string; excluded: unknown } | null): PayrollRunView {
    return {
      id: run.id,
      runNo: run.runNo,
      period: run.period,
      periodLabel: periodLabel(run.period),
      status: run.status,
      runType: run.runType,
      attendanceLockDate: run.attendanceLockDate ? dk(run.attendanceLockDate) : null,
      includeIdleDeduction: run.includeIdleDeduction,
      pendingTimesheetMode: run.pendingTimesheetMode as 'EXCLUDE' | 'WAIT',
      paymentDate: run.paymentDate ? dk(run.paymentDate) : null,
      calcVersion: run.calcVersion,
      calculatedAt: run.calculatedAt?.toISOString() ?? null,
      finalizedAt: run.finalizedAt?.toISOString() ?? null,
      finalizedBy: run.finalizedByName,
      paidAt: run.paidAt?.toISOString() ?? null,
      lastError: run.lastError,
      bankFile: bank ? { id: bank.id, fileName: bank.fileName, entryCount: bank.entryCount, totalPaise: bank.totalPaise, status: bank.status, excluded: ((bank.excluded as { name: string; reason: string }[]) ?? []).map((x) => ({ name: x.name, reason: x.reason })) } : null,
    };
  }

  private async currentRun(period: string) {
    return this.prisma.payrollRun.findFirst({ where: { period, runType: 'REGULAR', status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' } });
  }

  private kpisFrom(rows: PayrollItemRow[], prevGross: number | null, period: string): PayrollKpis {
    const counted = rows.filter((r) => r.status !== 'EXCLUDED');
    const gross = counted.reduce((s, r) => s + r.grossPaise, 0);
    return {
      employees: rows.length,
      interns: rows.filter((r) => r.payType === 'STIPEND').length,
      timesheetsApproved: rows.filter((r) => GATE_OK.includes(r.timesheetGate)).length,
      timesheetsPending: rows.filter((r) => !GATE_OK.includes(r.timesheetGate)).length,
      grossPaise: gross,
      grossDeltaPct: prevGross ? Math.round(((gross - prevGross) / prevGross) * 1000) / 10 : null,
      prevPeriodLabel: periodLabel(prevPeriod(period)).split(' ')[0]!,
      idleDeductionPaise: 0,
      idleEmployees: 0,
      deductionsPaise: counted.reduce((s, r) => s + r.deductionsPaise, 0),
      netPaise: counted.reduce((s, r) => s + r.netPaise, 0),
      ready: rows.filter((r) => r.status === 'READY' || r.status === 'FINALIZED' || r.status === 'PAID').length,
    };
  }

  private async previewRows(period: string, refresh = false): Promise<EngineRow[]> {
    const key = `${currentTenantId()}:${period}`;
    const hit = this.previewCache.get(key);
    if (hit && !refresh && Date.now() - hit.at < PREVIEW_TTL_MS) return hit.rows;
    const rows = await this.engine.compute({ period, lockDate: monthBounds(period).end, includeIdle: true });
    this.previewCache.set(key, { at: Date.now(), rows });
    return rows;
  }

  async periodView(period: string, refresh = false): Promise<PayrollPeriodView> {
    const run = await this.currentRun(period);
    const prevRun = await this.prisma.payrollRun.findFirst({ where: { period: prevPeriod(period), runType: 'REGULAR', status: { in: ['FINALIZED', 'PAID'] } } });
    let rows: PayrollItemRow[];
    let idleByItem: { idle: number; count: number };
    if (run && run.status !== 'DRAFT') {
      const items = await this.prisma.payrollItem.findMany({ where: { runId: run.id }, include: { employee: { select: { fullName: true, empCode: true, department: { select: { name: true } } } } }, orderBy: { employee: { fullName: 'asc' } } });
      rows = items.map((i) => toItemRow({ ...i, name: i.employee.fullName, code: i.employee.empCode, department: i.employee.department?.name ?? null }));
      const counted = items.filter((i) => i.status !== 'EXCLUDED');
      idleByItem = { idle: counted.reduce((s, i) => s + i.idleDeductionPaise, 0), count: counted.filter((i) => i.idleDeductionPaise > 0).length };
    } else {
      const eng = await this.previewRows(period, refresh);
      rows = eng.map(engineToRow);
      idleByItem = { idle: eng.reduce((s, r) => s + (r.result?.idleDeductionPaise ?? 0), 0), count: eng.filter((r) => (r.result?.idleDeductionPaise ?? 0) > 0).length };
    }
    const kpis = this.kpisFrom(rows, prevRun?.grossPaise ?? null, period);
    kpis.idleDeductionPaise = idleByItem.idle;
    kpis.idleEmployees = idleByItem.count;
    const bank = run ? await this.prisma.bankTransferFile.findFirst({ where: { runId: run.id, status: { not: 'VOID' } }, orderBy: { generatedAt: 'desc' } }) : null;
    const periods: PayrollPeriodView['periods'] = [];
    let p = periodOf(todayKey());
    const runs = await this.prisma.payrollRun.findMany({ where: { runType: 'REGULAR', status: { not: 'CANCELLED' } }, select: { period: true, status: true } });
    for (let i = 0; i < 8; i++) {
      periods.push({ period: p, label: periodLabel(p), status: runs.find((r) => r.period === p)?.status ?? null });
      p = prevPeriod(p);
    }
    return {
      period,
      periodLabel: periodLabel(period),
      run: run ? this.runView(run, bank) : null,
      isPreview: !run || run.status === 'DRAFT',
      kpis,
      items: rows,
      precheck: await this.precheck(period, rows),
      defaults: { attendanceLockDate: monthBounds(period).end, paymentDate: PayrollEngineService.lastWorkingDay(period), pendingCount: kpis.timesheetsPending, includeIdleDeduction: true },
      periods,
    };
  }

  private async precheck(period: string, rows: PayrollItemRow[]): Promise<PayrollPrecheck> {
    const b = monthBounds(period);
    const out: PayrollPrecheck = [];
    const pendingTs = rows.filter((r) => !GATE_OK.includes(r.timesheetGate)).length;
    if (pendingTs) out.push({ key: 'timesheets', text: `${pendingTs} ${pendingTs === 1 ? 'timesheet' : 'timesheets'} pending RM`, tone: 'outline', action: 'REMIND_RMS' });
    const pendingLeave = await this.prisma.leaveRequest.count({ where: { status: 'PENDING', fromDate: { lte: dd(b.end) }, toDate: { gte: dd(b.start) } } });
    if (pendingLeave) out.push({ key: 'leave', text: `${pendingLeave} leave ${pendingLeave === 1 ? 'request' : 'requests'} pending in period`, tone: 'outline' });
    const ids = rows.map((r) => r.employeeId);
    const noBank = await this.prisma.employee.count({ where: { id: { in: ids }, OR: [{ bankAccountEnc: null }, { bankIfsc: null }] } });
    if (noBank) out.push({ key: 'bank', text: `${noBank} ${noBank === 1 ? 'employee' : 'employees'} missing bank details`, tone: 'outline' });
    const noSalary = rows.filter((r) => r.errors.includes('No salary structure')).length;
    if (noSalary) out.push({ key: 'salary', text: `${noSalary} ${noSalary === 1 ? 'employee' : 'employees'} without salary structure`, tone: 'danger' });
    const joiners = await this.prisma.employee.count({ where: { joiningDate: { gte: dd(b.start), lte: dd(b.end) } } });
    const exits = await this.prisma.employee.count({ where: { exitDate: { gte: dd(b.start), lte: dd(b.end) } } });
    if (joiners || exits) out.push({ key: 'joiners', text: `New joiners ${joiners} · Exits ${exits}`, tone: 'neutral' });
    const adj = await this.prisma.payrollAdjustment.findMany({ where: { status: 'PENDING', forPeriod: { lte: period } }, select: { amountPaise: true } });
    if (adj.length) out.push({ key: 'adjustments', text: `${adj.length} pending ${adj.length === 1 ? 'adjustment' : 'adjustments'} (₹ ${Math.round(adj.reduce((s, a) => s + a.amountPaise, 0) / 100).toLocaleString('en-IN')})`, tone: 'neutral' });
    const holidays = await this.prisma.holiday.count({ where: { date: { gte: dd(`${b.year}-01-01`), lte: dd(`${b.year}-12-31`) } } });
    if (!holidays) out.push({ key: 'holidays', text: `Holiday calendar for ${b.year} is empty`, tone: 'outline' });
    return out;
  }

  async itemDetail(itemId: string): Promise<PayrollItemDetail> {
    const i = await this.prisma.payrollItem.findUnique({ where: { id: itemId }, include: { lines: { orderBy: { order: 'asc' } }, employee: { select: { fullName: true, empCode: true, department: { select: { name: true } } } } } });
    if (!i) throw notFound('Payroll item');
    const slip = await this.prisma.payslip.findUnique({ where: { itemId: i.id }, select: { id: true } });
    const row = toItemRow({ ...i, name: i.employee.fullName, code: i.employee.empCode, department: i.employee.department?.name ?? null });
    const money = (p: number) => `₹ ${Math.round(p / 100).toLocaleString('en-IN')}`;
    return {
      ...row,
      runId: i.runId,
      lines: i.lines.map((l) => ({ code: l.componentCode, label: l.label, kind: l.kind, fullAmountPaise: l.fullAmountPaise, amountPaise: l.amountPaise })),
      inputs: [
        { label: 'Working days', value: fmtDays(i.workingDays) },
        { label: 'Eligible days', value: fmtDays(i.eligibleDays) },
        { label: 'Paid leave', value: fmtDays(i.paidLeaveDays) },
        { label: 'Unpaid leave', value: fmtDays(i.unpaidLeaveDays) },
        { label: 'Absent (LOP)', value: fmtDays(i.absentDays) },
        { label: 'Paid days', value: fmtDays(i.paidDays) },
        { label: 'Projected after lock', value: fmtDays(i.projectedDays) },
        { label: 'Holidays · weekly offs', value: `${i.holidays} · ${i.weeklyOffs}` },
        { label: 'Idle (deducted · allowance)', value: `${fmtHm(i.idleMinutesRaw)} · ${fmtHm(i.idleAllowanceMinutes)}` },
        { label: 'Deductible idle', value: fmtHm(i.idleMinutesDeductible) },
        { label: 'Hourly rate', value: money(i.hourlyRatePaise) },
        { label: 'Per-day rate', value: money(i.perDayRatePaise) },
        { label: 'Fixed gross', value: money(i.grossFixedPaise) },
        { label: 'Tax regime · PT state', value: `${i.taxRegime ?? '—'} · ${i.ptStateCode ?? '—'}` },
        { label: 'Timesheet gate', value: i.timesheetGate.replace(/_/g, ' ').toLowerCase() },
      ],
      trace: (i.trace as string[]) ?? [],
      holdReason: i.holdReason,
      payslipId: slip?.id ?? null,
    };
  }

  // ── run lifecycle ─────────────────────────────────────────────────────

  private async loadRun(id: string) {
    const r = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!r) throw notFound('Payroll run');
    return r;
  }

  async createRun(input: PayrollRunInput) {
    const b = monthBounds(input.period);
    if (input.attendanceLockDate < b.start || input.attendanceLockDate > b.end) throw badRequest('Lock date must fall inside the payroll month', 'LOCK_RANGE');
    if (input.attendanceLockDate > todayKey() && input.attendanceLockDate !== b.end) throw badRequest('A future lock date must be the month end (remaining days are projected)', 'LOCK_RANGE');
    if (input.paymentDate < input.attendanceLockDate) throw badRequest('Payment date must be on or after the lock date');
    if (input.paymentDate > addDays(b.end, 15)) throw badRequest('Payment date must be within 15 days of the month end');
    const existing = await this.currentRun(input.period);
    if (existing) throw new AppError(409, 'RUN_EXISTS', `A payroll run for ${periodLabel(input.period)} already exists (${existing.status.toLowerCase()})`);
    const ctx = requireContext();
    const count = await this.prisma.payrollRun.count({ where: { period: input.period } });
    const run = await this.prisma.payrollRun.create({
      data: {
        runNo: `PR-${input.period}${count ? `-${count + 1}` : ''}`,
        period: input.period,
        periodYear: b.year,
        periodMonth: b.month,
        periodStart: dd(b.start),
        periodEnd: dd(b.end),
        status: 'CALCULATING',
        attendanceLockDate: dd(input.attendanceLockDate),
        includeIdleDeduction: input.includeIdleDeduction,
        pendingTimesheetMode: input.pendingTimesheetMode,
        paymentDate: dd(input.paymentDate),
        calcVersion: 1,
        createdByName: ctx.userName ?? 'HR',
      } as any,
    });
    const warn = await this.lockPort.lock(input.period, input.attendanceLockDate, run.id);
    if (warn) await this.prisma.payrollRun.update({ where: { id: run.id }, data: { lastError: warn } });
    await this.audit.record({ action: 'payroll.run.created', entity: 'PayrollRun', entityId: run.id, meta: { period: input.period, lock: input.attendanceLockDate, idle: input.includeIdleDeduction, mode: input.pendingTimesheetMode } });
    this.previewCache.delete(`${currentTenantId()}:${input.period}`);
    await this.jobs.enqueue(JOB_CALC, { tenantId: currentTenantId(), runId: run.id, calcVersion: 1 });
    return this.runView(await this.loadRun(run.id), null);
  }

  /** Job: calculate every eligible employee for the run's current calcVersion. */
  async calculateRun(runId: string, calcVersion: number, employeeIds?: string[]) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run || run.calcVersion !== calcVersion) return; // superseded
    try {
      const rows = await this.engine.compute({ period: run.period, lockDate: dk(run.attendanceLockDate ?? run.periodEnd), includeIdle: run.includeIdleDeduction, employeeIds });
      const fresh = await this.prisma.payrollRun.findUnique({ where: { id: runId }, select: { calcVersion: true, status: true } });
      if (!fresh || fresh.calcVersion !== calcVersion || fresh.status === 'CANCELLED') return;
      // Preserve manual holds across re-runs.
      const held = await this.prisma.payrollItem.findMany({ where: { runId, status: 'ON_HOLD' }, select: { employeeId: true, holdReason: true } });
      for (const r of rows) {
        const h = held.find((x) => x.employeeId === r.employeeId);
        if (h && r.status !== 'ERROR') {
          r.status = 'ON_HOLD';
          r.holdReason = h.holdReason;
        }
      }
      if (!employeeIds) await this.prisma.payrollItem.deleteMany({ where: { runId, employeeId: { notIn: rows.map((r) => r.employeeId) } } });
      await this.engine.persist(runId, calcVersion, rows);
      await this.aggregate(runId, { status: 'CALCULATED', calculatedAt: new Date(), lastError: run.lastError?.startsWith('Attendance lock') ? run.lastError : null });
      const ready = await this.prisma.payrollItem.count({ where: { runId, status: 'READY' } });
      this.log.log(`Run ${run.runNo} v${calcVersion}: ${rows.length} items, ${ready} ready`);
    } catch (e) {
      this.log.error(`Run ${runId} failed: ${(e as Error).stack}`);
      await this.prisma.payrollRun.update({ where: { id: runId }, data: { status: 'FAILED', lastError: (e as Error).message.slice(0, 500) } });
      const hr = await this.notifications.usersWithPermission('payroll.manage');
      await this.notifications.notify({ userIds: hr, type: 'payroll.failed', title: `Payroll ${periodLabel(run.period)} calculation failed`, body: (e as Error).message.slice(0, 200), link: '/payroll' });
    }
  }

  /** Recompute run totals and KPIs from its items. */
  async aggregate(runId: string, extra: Partial<PayrollRun> = {}) {
    const items = await this.prisma.payrollItem.findMany({ where: { runId } });
    const counted = items.filter((i) => i.status !== 'EXCLUDED');
    const sum = (f: (i: PayrollItem) => number) => counted.reduce((s, i) => s + f(i), 0);
    return this.prisma.payrollRun.update({
      where: { id: runId },
      data: {
        employeeCount: items.length,
        internCount: items.filter((i) => i.payType === 'STIPEND').length,
        timesheetApprovedCount: items.filter((i) => GATE_OK.includes(i.timesheetGate)).length,
        timesheetPendingCount: items.filter((i) => !GATE_OK.includes(i.timesheetGate)).length,
        readyCount: items.filter((i) => ['READY', 'FINALIZED', 'PAID'].includes(i.status)).length,
        errorCount: items.filter((i) => i.status === 'ERROR').length,
        grossPaise: sum((i) => i.totalEarningsPaise),
        deductionsPaise: sum((i) => i.totalDeductionsPaise),
        netPaise: sum((i) => i.netPaise),
        employerContribPaise: sum((i) => i.employerContribPaise),
        employerPfPaise: sum((i) => i.employerPfPaise),
        idleDeductionPaise: sum((i) => i.idleDeductionPaise),
        idleEmployeeCount: counted.filter((i) => i.idleDeductionPaise > 0).length,
        ...(extra as any),
      },
    });
  }

  async updateRun(id: string, input: Partial<PayrollRunInput>) {
    const run = await this.loadRun(id);
    if (!['CALCULATED', 'FAILED'].includes(run.status)) throw new AppError(409, 'RUN_STATE', 'Only a calculated run can be changed');
    const b = monthBounds(run.period);
    if (input.attendanceLockDate && (input.attendanceLockDate < b.start || input.attendanceLockDate > b.end)) throw badRequest('Lock date must fall inside the payroll month', 'LOCK_RANGE');
    const data: Record<string, unknown> = {};
    if (input.attendanceLockDate) data.attendanceLockDate = dd(input.attendanceLockDate);
    if (input.includeIdleDeduction !== undefined) data.includeIdleDeduction = input.includeIdleDeduction;
    if (input.pendingTimesheetMode) data.pendingTimesheetMode = input.pendingTimesheetMode;
    if (input.paymentDate) data.paymentDate = dd(input.paymentDate);
    await this.prisma.payrollRun.update({ where: { id }, data });
    if (input.attendanceLockDate) await this.lockPort.lock(run.period, input.attendanceLockDate, run.id);
    return this.recalculate(id);
  }

  async recalculate(id: string, itemIds?: string[]) {
    const run = await this.loadRun(id);
    if (!['CALCULATED', 'FAILED', 'CALCULATING'].includes(run.status)) throw new AppError(409, 'RUN_STATE', 'Finalized runs cannot be re-run');
    if (itemIds?.length) {
      const items = await this.prisma.payrollItem.findMany({ where: { runId: id, id: { in: itemIds } }, select: { employeeId: true } });
      await this.calculateRun(id, run.calcVersion, items.map((i) => i.employeeId));
      await this.audit.record({ action: 'payroll.run.recalculated', entity: 'PayrollRun', entityId: id, meta: { items: itemIds.length } });
      return this.runView(await this.loadRun(id), null);
    }
    const v = run.calcVersion + 1;
    await this.prisma.payrollRun.update({ where: { id }, data: { status: 'CALCULATING', calcVersion: v, lastError: null } });
    await this.audit.record({ action: 'payroll.run.recalculated', entity: 'PayrollRun', entityId: id, meta: { calcVersion: v } });
    await this.jobs.enqueue(JOB_CALC, { tenantId: currentTenantId(), runId: id, calcVersion: v });
    return this.runView(await this.loadRun(id), null);
  }

  async hold(runId: string, itemId: string, reason: string) {
    const run = await this.loadRun(runId);
    if (run.status !== 'CALCULATED') throw new AppError(409, 'RUN_STATE', 'Holds can only change before finalizing');
    await this.prisma.payrollItem.update({ where: { id: itemId }, data: { status: 'ON_HOLD', holdReason: reason } });
    await this.aggregate(runId);
    await this.audit.record({ action: 'payroll.item.held', entity: 'PayrollItem', entityId: itemId, meta: { reason } });
    return this.itemDetail(itemId);
  }

  async release(runId: string, itemId: string) {
    const run = await this.loadRun(runId);
    if (run.status !== 'CALCULATED') throw new AppError(409, 'RUN_STATE', 'Holds can only change before finalizing');
    const item = await this.prisma.payrollItem.update({ where: { id: itemId }, data: { status: 'STALE', holdReason: null } });
    await this.calculateRun(runId, run.calcVersion, [item.employeeId]);
    await this.audit.record({ action: 'payroll.item.released', entity: 'PayrollItem', entityId: itemId });
    return this.itemDetail(itemId);
  }

  async excludePending(runId: string) {
    const run = await this.loadRun(runId);
    await this.prisma.payrollRun.update({ where: { id: run.id }, data: { pendingTimesheetMode: 'EXCLUDE' } });
    return this.runView(await this.loadRun(runId), null);
  }

  async remindRms(period: string) {
    const run = await this.currentRun(period);
    let employeeIds: string[];
    if (run && run.status !== 'DRAFT') employeeIds = (await this.prisma.payrollItem.findMany({ where: { runId: run.id, timesheetGate: { notIn: GATE_OK } }, select: { employeeId: true } })).map((i) => i.employeeId);
    else employeeIds = (await this.previewRows(period)).filter((r) => !GATE_OK.includes(r.timesheetGate)).map((r) => r.employeeId);
    const emps = await this.prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { fullName: true, managerId: true } });
    const byRm = new Map<string, string[]>();
    for (const e of emps) if (e.managerId) byRm.set(e.managerId, [...(byRm.get(e.managerId) ?? []), e.fullName]);
    for (const [rm, names] of byRm) {
      const users = await this.notifications.usersForEmployees([rm]);
      await this.notifications.notify({ userIds: users, type: 'payroll.timesheets', title: `Approve timesheets for ${periodLabel(period)} payroll`, body: `Pending: ${names.join(', ')}`, link: '/approvals', from: requireContext().userName ?? 'Payroll', email: true });
    }
    await this.audit.record({ action: 'payroll.remind_rms', entity: 'PayrollRun', entityId: run?.id ?? null, meta: { period, managers: byRm.size } });
    return { managers: byRm.size, employees: employeeIds.length };
  }

  async finalize(id: string) {
    const run = await this.loadRun(id);
    if (run.status !== 'CALCULATED') throw new AppError(409, 'RUN_STATE', run.status === 'CALCULATING' ? 'The run is still calculating' : 'Only a calculated run can be finalized');
    const items = await this.prisma.payrollItem.findMany({ where: { runId: id } });
    const blocking = items.filter((i) => i.status === 'ERROR' || i.status === 'STALE');
    if (blocking.length) throw new AppError(409, 'RUN_BLOCKED', `Resolve ${blocking.length} ${blocking.length === 1 ? 'item' : 'items'} with errors or needing a re-run before finalizing`);
    if (run.pendingTimesheetMode === 'WAIT' && items.some((i) => i.status === 'TIMESHEET_PENDING')) throw new AppError(409, 'RUN_BLOCKED', 'Timesheets are still pending RM approval (mode: Wait). Switch to Exclude or wait for approvals');
    const ctx = requireContext();
    await this.prisma.payrollItem.updateMany({ where: { runId: id, status: 'READY' }, data: { status: 'FINALIZED' } });
    await this.prisma.payrollItem.updateMany({ where: { runId: id, status: 'TIMESHEET_PENDING' }, data: { status: 'EXCLUDED' } });
    const finals = await this.prisma.payrollItem.findMany({ where: { runId: id, status: 'FINALIZED' }, include: { lines: { select: { adjustmentId: true } } } });
    const tenantId = currentTenantId();
    for (const i of finals) {
      await this.prisma.payslip.upsert({
        where: { itemId: i.id },
        create: { tenantId, employeeId: i.employeeId, runId: id, itemId: i.id, period: run.period, periodYear: run.periodYear, periodMonth: run.periodMonth, runType: run.runType, workingDays: i.workingDays, paidDays: i.paidDays, lopDays: i.lopDays, idleMinutes: i.idleMinutesDeductible, idleDeductionPaise: i.idleDeductionPaise, grossPaise: i.totalEarningsPaise, deductionsPaise: i.totalDeductionsPaise, netPaise: i.netPaise, status: 'DRAFT' },
        update: { status: 'DRAFT', grossPaise: i.totalEarningsPaise, deductionsPaise: i.totalDeductionsPaise, netPaise: i.netPaise, paidDays: i.paidDays, workingDays: i.workingDays, lopDays: i.lopDays, idleMinutes: i.idleMinutesDeductible, idleDeductionPaise: i.idleDeductionPaise, voidedAt: null },
      });
      const adjIds = i.lines.map((l) => l.adjustmentId).filter((x): x is string => !!x);
      if (adjIds.length) await this.prisma.payrollAdjustment.updateMany({ where: { id: { in: adjIds } }, data: { status: 'APPLIED', appliedRunId: id } });
    }
    const saved = await this.aggregate(id, { status: 'FINALIZED', finalizedAt: new Date(), finalizedByName: ctx.userName ?? 'HR' });
    await this.audit.record({ action: 'payroll.run.finalized', entity: 'PayrollRun', entityId: id, meta: { period: run.period, employees: finals.length, netPaise: saved.netPaise } });
    this.events.emit('payroll.finalized', { runId: id, period: run.period, totals: { grossPaise: saved.grossPaise, netPaise: saved.netPaise, deductionsPaise: saved.deductionsPaise, employerPfPaise: saved.employerPfPaise } });
    await this.jobs.enqueue(JOB_PUBLISH, { tenantId, runId: id });
    return { run: this.runView(saved, null), payslips: finals.length };
  }

  async cancel(id: string, reason: string) {
    const run = await this.loadRun(id);
    if (['FINALIZED', 'PAID', 'CANCELLED'].includes(run.status)) throw new AppError(409, 'RUN_STATE', 'Finalized runs cannot be voided');
    await this.prisma.payrollItem.deleteMany({ where: { runId: id } });
    await this.prisma.payrollRun.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason, calcVersion: { increment: 1 } } });
    await this.lockPort.unlock(run.period, `Payroll run voided: ${reason}`);
    await this.audit.record({ action: 'payroll.run.cancelled', entity: 'PayrollRun', entityId: id, meta: { reason } });
    this.previewCache.delete(`${currentTenantId()}:${run.period}`);
    return { ok: true };
  }

  async markPaid(id: string) {
    const run = await this.loadRun(id);
    if (run.status !== 'FINALIZED') throw new AppError(409, 'RUN_STATE', 'Only a finalized run can be marked paid');
    await this.prisma.payrollItem.updateMany({ where: { runId: id, status: 'FINALIZED' }, data: { status: 'PAID' } });
    const saved = await this.prisma.payrollRun.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
    await this.audit.record({ action: 'payroll.run.paid', entity: 'PayrollRun', entityId: id });
    return this.runView(saved, null);
  }

  // ── bank transfer file ────────────────────────────────────────────────

  async generateBankFile(id: string) {
    const run = await this.loadRun(id);
    if (!['FINALIZED', 'PAID'].includes(run.status)) throw new AppError(409, 'RUN_STATE', 'Finalize the run before generating the bank file');
    const items = await this.prisma.payrollItem.findMany({ where: { runId: id, status: { in: ['FINALIZED', 'PAID'] } }, include: { employee: { include: { leavepayPayrollProfile: true } } }, orderBy: { employee: { fullName: 'asc' } } });
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = ['Beneficiary Name,Account Number,IFSC,Amount,Payment Date,Narration,Employee ID'];
    const excluded: { employeeId: string; name: string; reason: string }[] = [];
    let total = 0;
    for (const i of items) {
      const e = i.employee;
      const mode = e.leavepayPayrollProfile?.paymentMode ?? 'BANK_TRANSFER';
      if (i.netPaise <= 0) continue;
      if (mode !== 'BANK_TRANSFER') {
        excluded.push({ employeeId: e.id, name: e.fullName, reason: `Paid by ${mode.toLowerCase()}` });
        continue;
      }
      let acct: string | null = null;
      try {
        acct = this.crypto.decrypt(e.bankAccountEnc);
      } catch {
        acct = null;
      }
      if (!acct || !e.bankIfsc) {
        excluded.push({ employeeId: e.id, name: e.fullName, reason: 'Missing bank details' });
        continue;
      }
      total += i.netPaise;
      lines.push([e.fullName, acct, e.bankIfsc, (i.netPaise / 100).toFixed(2), run.paymentDate ? dk(run.paymentDate) : '', `Salary ${periodLabel(run.period)}`, e.empCode].map(esc).join(','));
    }
    const csv = Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
    const fileName = `Salary-${run.period}-${run.runNo}.csv`;
    const f = await this.storage.save({ data: csv, filename: fileName, mime: 'text/csv', category: 'payroll-bank', isPrivate: true });
    await this.prisma.bankTransferFile.updateMany({ where: { runId: id, status: { not: 'VOID' } }, data: { status: 'VOID' } });
    const { createHash } = await import('node:crypto');
    const row = await this.prisma.bankTransferFile.create({ data: { runId: id, fileId: f.id, fileName, entryCount: lines.length - 1, totalPaise: total, sha256: createHash('sha256').update(csv).digest('hex'), excluded, generatedBy: requireContext().userName ?? 'HR' } as any });
    await this.audit.record({ action: 'payroll.bankfile.generated', entity: 'BankTransferFile', entityId: row.id, meta: { entries: row.entryCount, totalPaise: total, excluded: excluded.length } });
    return this.runView(run, row);
  }

  async bankFileDownload(id: string) {
    const bank = await this.prisma.bankTransferFile.findFirst({ where: { runId: id, status: { not: 'VOID' } }, orderBy: { generatedAt: 'desc' } });
    if (!bank) throw notFound('Bank file');
    const f = await this.storage.read(bank.fileId);
    await this.prisma.bankTransferFile.update({ where: { id: bank.id }, data: { status: bank.status === 'GENERATED' ? 'DOWNLOADED' : bank.status, downloadedAt: new Date() } });
    await this.audit.record({ action: 'payroll.bankfile.downloaded', entity: 'BankTransferFile', entityId: bank.id });
    return { data: f.data, filename: bank.fileName };
  }

  // ── adjustments ───────────────────────────────────────────────────────

  async adjustments(period?: string): Promise<AdjustmentRow[]> {
    const rows = await this.prisma.payrollAdjustment.findMany({ where: period ? { forPeriod: period } : { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 200 });
    const names = new Map((await this.prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
    return rows.map((a) => ({ id: a.id, employeeName: names.get(a.employeeId) ?? '—', type: ADJ_LABEL[a.type] ?? a.type, forPeriod: a.forPeriod, amountPaise: a.amountPaise, source: a.sourceType, status: a.status, createdBy: a.createdByName, reason: a.reason }));
  }

  async addAdjustment(input: AdjustmentInput) {
    const ctx = requireContext();
    const earning = ['LOP_REVERSAL', 'IDLE_REVERSAL', 'BONUS', 'REIMBURSEMENT', 'MANUAL_EARNING'].includes(input.type);
    const row = await this.prisma.payrollAdjustment.create({
      data: { employeeId: input.employeeId, type: input.type, amountPaise: input.amountPaise, forPeriod: input.forPeriod, taxable: input.type !== 'REIMBURSEMENT', pfApplicable: false, esiApplicable: earning && input.type !== 'REIMBURSEMENT', sourceType: 'MANUAL', sourceId: `m-${Date.now()}`, reason: input.reason, createdByName: ctx.userName ?? 'HR' } as any,
    });
    const run = await this.currentRun(input.forPeriod);
    if (run?.status === 'CALCULATED') await this.prisma.payrollItem.updateMany({ where: { runId: run.id, employeeId: input.employeeId, status: { notIn: ['EXCLUDED'] } }, data: { status: 'STALE' } });
    await this.audit.record({ action: 'payroll.adjustment.created', entity: 'PayrollAdjustment', entityId: row.id, meta: { type: input.type, amountPaise: input.amountPaise, period: input.forPeriod } });
    return row;
  }

  async cancelAdjustment(id: string) {
    const a = await this.prisma.payrollAdjustment.findUnique({ where: { id } });
    if (!a) throw notFound('Adjustment');
    if (a.status !== 'PENDING') throw new AppError(409, 'ADJ_STATE', 'Only pending adjustments can be cancelled');
    await this.prisma.payrollAdjustment.update({ where: { id }, data: { status: 'CANCELLED' } });
    const run = await this.currentRun(a.forPeriod);
    if (run?.status === 'CALCULATED') await this.prisma.payrollItem.updateMany({ where: { runId: run.id, employeeId: a.employeeId }, data: { status: 'STALE' } });
    await this.audit.record({ action: 'payroll.adjustment.cancelled', entity: 'PayrollAdjustment', entityId: id });
    return { ok: true };
  }

  /** timesheet.approved: refresh the employee's pending item in a calculated run covering that week. */
  async onTimesheetApproved(employeeId: string, weekStart: string) {
    const periods = [periodOf(weekStart), periodOf(addDays(weekStart, 6))];
    const runs = await this.prisma.payrollRun.findMany({ where: { period: { in: periods }, status: 'CALCULATED' } });
    for (const run of runs) {
      const item = await this.prisma.payrollItem.findFirst({ where: { runId: run.id, employeeId, status: 'TIMESHEET_PENDING' } });
      if (item) await this.calculateRun(run.id, run.calcVersion, [employeeId]);
    }
    for (const p of periods) this.previewCache.delete(`${currentTenantId()}:${p}`);
  }
}
