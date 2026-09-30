import { Injectable, Logger } from '@nestjs/common';
import type { LeaveType, Prisma } from '@prisma/client';
import {
  EMPLOYMENT_TYPE_LABEL,
  type CompOffRequestInput,
  type CompOffRow,
  type CreditBatchRow,
  type CreditRuleInput,
  type CreditRuleRow,
  type LeaveHolidayRow,
  type LeaveSettings,
  type LeaveTypeInput,
  type LeaveTypeRow,
  type ManualCreditInput,
  type ManualCreditRow,
  type YearEndPreviewRow,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { requireContext } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { AppError, badRequest, forbidden, notFound } from '../../../core/http/errors';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { SettingsService } from '../../../core/settings/settings.service';
import { OrgService } from '../../../core/org/org.service';
import { addDays, dayMonth, dd, diffDays, dk, MONTHS_SHORT, monthBounds, nextPeriod, todayKey, yearOf, type DateKey } from '../common/dates';
import { WorkCalendarService } from '../common/calendar.service';
import { fmtDays, monthlyCreditMonths, prorateYearly, round2, yearEndSplit } from './leave-calc';
import { LeaveLedgerService, type LedgerPost } from './leave-ledger.service';
import { DEFAULT_LEAVE_SETTINGS, LEAVE_SETTINGS_KEY } from './leave.common';
import { LeaveRequestsService } from './leave-requests.service';

const FREQ_LABEL: Record<string, string> = { YEARLY: 'Yearly', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly' };
const ELIGIBLE_STATUSES = ['ACTIVE', 'NOTICE_PERIOD', 'ONBOARDING'] as const;

/** "No" | "Up to 30" | "30" | 30 → cap (null = no carry forward). */
export function parseCarryForward(v: string | number | undefined | null): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  const s = v.trim().toLowerCase();
  if (!s || s === 'no' || s === 'none' || s === '0') return null;
  const m = s.match(/(\d+(\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

export function appliesToLabel(list: string[]): string {
  return list.map((x) => EMPLOYMENT_TYPE_LABEL[x] ?? x).join(', ');
}

export function toLeaveTypeRow(t: LeaveType, hasLedger = false): LeaveTypeRow {
  const onApproval = t.isCompOff || t.accrualFrequency === 'ON_APPROVAL';
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    annualQuota: t.annualQuota,
    quotaLabel: onApproval ? 'On approval' : t.hidden && !t.annualQuota ? '—' : fmtDays(t.annualQuota),
    carryForwardLabel: t.isCompOff ? `${t.expiryDays ?? 60} days` : !t.carryForwardMax ? 'No' : `Up to ${fmtDays(t.carryForwardMax)}`,
    encashable: t.encashable,
    appliesTo: t.appliesTo,
    appliesToLabel: appliesToLabel(t.appliesTo),
    accrualFrequency: t.accrualFrequency,
    isPaid: t.isPaid,
    isCompOff: t.isCompOff,
    allowHalfDay: t.allowHalfDay,
    sandwichWeeklyOffs: t.sandwichWeeklyOffs,
    sandwichHolidays: t.sandwichHolidays,
    minNoticeDays: t.minNoticeDays,
    noticeEnforcement: t.noticeEnforcement,
    backdateLimitDays: t.backdateLimitDays,
    maxConsecutiveDays: t.maxConsecutiveDays,
    expiryDays: t.expiryDays,
    documentRequiredAfterDays: t.documentRequiredAfterDays,
    carryForwardMax: t.carryForwardMax,
    hidden: t.hidden,
    active: t.active,
    hasLedger,
  };
}

/** Period key → months of `year` it credits, and a label. */
function periodInfo(freq: string, periodKey: string) {
  const year = Number(periodKey.slice(0, 4));
  if (freq === 'YEARLY') return { year, month: 1, label: String(year), start: `${year}-01-01`, end: `${year}-12-31` };
  const month = Number(periodKey.slice(5, 7));
  const b = monthBounds(periodKey.slice(0, 7));
  return { year, month, label: `${MONTHS_SHORT[month - 1]} ${year}`, start: b.start, end: freq === 'QUARTERLY' ? monthBounds(`${year}-${String(Math.min(12, month + 2)).padStart(2, '0')}`).end : b.end };
}

export function currentPeriodKey(freq: string, today: DateKey): string {
  if (freq === 'YEARLY') return today.slice(0, 4);
  if (freq === 'QUARTERLY') {
    const m = Number(today.slice(5, 7));
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    return `${today.slice(0, 4)}-${String(q).padStart(2, '0')}`;
  }
  return today.slice(0, 7);
}

/** Days a rule credits an employee for a period (pure). */
export function creditDaysFor(rule: { frequency: string; daysPerPeriod: number; prorateOnJoin: boolean }, periodKey: string, joinDate: DateKey | null): number {
  const { year, month } = periodInfo(rule.frequency, periodKey);
  if (rule.frequency === 'YEARLY') return rule.prorateOnJoin ? prorateYearly(rule.daysPerPeriod, joinDate, year) : joinDate && yearOf(joinDate) > year ? 0 : rule.daysPerPeriod;
  const months = monthlyCreditMonths(rule.prorateOnJoin ? joinDate : joinDate && yearOf(joinDate) === year ? `${year}-${joinDate.slice(5, 7)}-01` : joinDate, year);
  if (rule.frequency === 'MONTHLY') return months.includes(month) ? rule.daysPerPeriod : 0;
  // QUARTERLY: credited if any month of the quarter is a credit month.
  return [month, month + 1, month + 2].some((m) => months.includes(m)) ? rule.daysPerPeriod : 0;
}

@Injectable()
export class LeaveAdminService {
  private readonly log = new Logger('LeaveAdmin');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LeaveLedgerService,
    private readonly requests: LeaveRequestsService,
    private readonly calendar: WorkCalendarService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly org: OrgService,
  ) {}

  private assertHr() {
    if (!hasPerm(requireContext(), 'leave.manage')) throw forbidden();
  }

  // ── leave types ───────────────────────────────────────────────────────

  /** HR sees every type (incl. inactive and HR-only); employees see active, visible types. */
  async types(includeInactive = true): Promise<LeaveTypeRow[]> {
    const rows = await this.prisma.leaveType.findMany({ where: includeInactive ? {} : { active: true, hidden: false }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] });
    const used = await this.prisma.leaveLedgerEntry.groupBy({ by: ['leaveTypeId'], _count: { _all: true } });
    const set = new Set(used.map((u) => u.leaveTypeId));
    return rows.map((t) => toLeaveTypeRow(t, set.has(t.id)));
  }

  private async uniqueCode(name: string, wanted?: string): Promise<string> {
    let base = (wanted || name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('')).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    if (base.length < 2) base = (name.replace(/[^A-Za-z]/g, '').slice(0, 2) || 'LV').toUpperCase();
    let code = base;
    for (let i = 2; await this.prisma.leaveType.findFirst({ where: { code } }); i++) {
      if (wanted) throw badRequest(`Code ${wanted} is already used`, 'DUPLICATE');
      code = `${base.slice(0, 4)}${String.fromCharCode(64 + i)}`;
    }
    return code;
  }

  async createType(input: LeaveTypeInput): Promise<LeaveTypeRow> {
    this.assertHr();
    if (await this.prisma.leaveType.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } } })) throw badRequest('A leave type with this name already exists', 'DUPLICATE');
    const code = await this.uniqueCode(input.name, input.code);
    const isCompOff = input.accrualFrequency === 'ON_APPROVAL';
    const max = await this.prisma.leaveType.aggregate({ _max: { displayOrder: true } });
    const t = await this.prisma.leaveType.create({
      data: {
        code,
        name: input.name,
        shortLabel: code,
        displayOrder: (max._max.displayOrder ?? 0) + 1,
        annualQuota: input.annualQuota,
        accrualFrequency: input.accrualFrequency,
        carryForwardMax: parseCarryForward(input.carryForward) ?? null,
        encashable: input.encashable,
        appliesTo: input.appliesTo,
        isPaid: input.isPaid,
        isCompOff,
        expiryDays: isCompOff ? (input.expiryDays ?? 60) : (input.expiryDays ?? null),
        allowHalfDay: input.allowHalfDay,
        sandwichWeeklyOffs: input.sandwichWeeklyOffs,
        sandwichHolidays: input.sandwichHolidays,
        minNoticeDays: input.minNoticeDays,
        noticeEnforcement: input.noticeEnforcement,
        backdateLimitDays: input.backdateLimitDays,
        maxConsecutiveDays: input.maxConsecutiveDays ?? null,
        documentRequiredAfterDays: input.documentRequiredAfterDays ?? null,
      } as any,
    });
    // A YEARLY/MONTHLY type gets a default credit rule per applicable employment type.
    if (['YEARLY', 'MONTHLY', 'QUARTERLY'].includes(input.accrualFrequency) && input.annualQuota > 0) {
      const per = input.accrualFrequency === 'MONTHLY' ? round2(input.annualQuota / 12) : input.accrualFrequency === 'QUARTERLY' ? round2(input.annualQuota / 4) : input.annualQuota;
      for (const et of input.appliesTo) {
        await this.prisma.leaveCreditRule.create({ data: { leaveTypeId: t.id, employmentType: et, frequency: input.accrualFrequency as any, daysPerPeriod: per, effectiveFrom: dd(`${yearOf(todayKey())}-01-01`) } as any });
      }
    }
    await this.audit.record({ action: 'leave.type.created', entity: 'LeaveType', entityId: t.id, meta: { name: t.name, code } });
    return toLeaveTypeRow(t);
  }

  async updateType(id: string, input: Partial<LeaveTypeInput> & { active?: boolean }): Promise<LeaveTypeRow> {
    this.assertHr();
    const t = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!t) throw notFound('Leave type');
    const data: Prisma.LeaveTypeUpdateInput = {};
    const keys = ['name', 'annualQuota', 'accrualFrequency', 'encashable', 'appliesTo', 'isPaid', 'allowHalfDay', 'sandwichWeeklyOffs', 'sandwichHolidays', 'minNoticeDays', 'noticeEnforcement', 'backdateLimitDays', 'maxConsecutiveDays', 'expiryDays', 'documentRequiredAfterDays', 'active'] as const;
    for (const k of keys) if (input[k] !== undefined) (data as any)[k] = input[k];
    const cf = parseCarryForward(input.carryForward);
    if (cf !== undefined) data.carryForwardMax = cf;
    const saved = await this.prisma.leaveType.update({ where: { id }, data });
    await this.audit.record({ action: input.active === false ? 'leave.type.deactivated' : 'leave.type.updated', entity: 'LeaveType', entityId: id, meta: { changes: Object.keys(data) } });
    return toLeaveTypeRow(saved);
  }

  async deleteType(id: string) {
    this.assertHr();
    const used = await this.prisma.leaveLedgerEntry.count({ where: { leaveTypeId: id } });
    const reqs = await this.prisma.leaveRequest.count({ where: { leaveTypeId: id } });
    if (used || reqs) throw new AppError(409, 'LEAVE_TYPE_IN_USE', 'This leave type has balances or requests; deactivate it instead');
    await this.prisma.leaveCreditRule.deleteMany({ where: { leaveTypeId: id } });
    await this.prisma.leaveBalance.deleteMany({ where: { leaveTypeId: id } });
    await this.prisma.leaveType.delete({ where: { id } });
    await this.audit.record({ action: 'leave.type.deleted', entity: 'LeaveType', entityId: id });
    return { ok: true };
  }

  // ── credit rules / batches ────────────────────────────────────────────

  async rules(): Promise<CreditRuleRow[]> {
    const rules = await this.prisma.leaveCreditRule.findMany({ include: { leaveType: true }, orderBy: [{ leaveType: { displayOrder: 'asc' } }, { employmentType: 'asc' }] });
    const today = todayKey();
    return rules.map((r) => {
      const cur = currentPeriodKey(r.frequency, today);
      const due = r.lastPeriodKey === cur ? (r.frequency === 'YEARLY' ? String(Number(cur) + 1) : r.frequency === 'QUARTERLY' ? nextPeriod(nextPeriod(nextPeriod(cur))) : nextPeriod(cur)) : cur;
      const nextRun = r.frequency === 'YEARLY' ? `1 Jan ${due.slice(0, 4)}` : `${r.creditDay} ${MONTHS_SHORT[Number(due.slice(5, 7)) - 1]} ${due.slice(0, 4)}`;
      return {
        id: r.id,
        leaveTypeId: r.leaveTypeId,
        leaveType: r.leaveType.name,
        employmentType: r.employmentType,
        appliesTo: EMPLOYMENT_TYPE_LABEL[r.employmentType] ?? r.employmentType,
        frequency: r.frequency,
        frequencyLabel: FREQ_LABEL[r.frequency] ?? r.frequency,
        daysPerPeriod: r.daysPerPeriod,
        prorateOnJoin: r.prorateOnJoin,
        lastRun: r.lastRunAt?.toISOString() ?? null,
        lastRunStatus: r.lastRunStatus,
        nextRun,
        nextPeriodKey: due,
        active: r.active,
      };
    });
  }

  async saveRule(input: CreditRuleInput, id?: string) {
    this.assertHr();
    const data = { leaveTypeId: input.leaveTypeId, employmentType: input.employmentType, frequency: input.frequency, daysPerPeriod: input.daysPerPeriod, creditDay: input.creditDay, prorateOnJoin: input.prorateOnJoin, effectiveFrom: dd(input.effectiveFrom), active: input.active };
    const rule = id ? await this.prisma.leaveCreditRule.update({ where: { id }, data }) : await this.prisma.leaveCreditRule.create({ data: data as any });
    await this.audit.record({ action: id ? 'leave.rule.updated' : 'leave.rule.created', entity: 'LeaveCreditRule', entityId: rule.id, meta: { frequency: input.frequency, days: input.daysPerPeriod } });
    return rule;
  }

  async batches(): Promise<CreditBatchRow[]> {
    const rows = await this.prisma.leaveCreditBatch.findMany({ orderBy: { startedAt: 'desc' }, take: 30 });
    const types = new Map((await this.prisma.leaveType.findMany()).map((t) => [t.id, t.name]));
    return rows.map((b) => ({ id: b.id, type: b.type, leaveType: b.leaveTypeId ? (types.get(b.leaveTypeId) ?? null) : null, periodKey: b.periodKey, status: b.status, employeeCount: b.employeeCount, totalDays: b.totalDays, startedAt: b.startedAt.toISOString(), note: b.note }));
  }

  /**
   * Run a credit rule for a period (idempotent per rule period): each eligible employee gets an
   * ACCRUAL (or PRORATED_ACCRUAL) ledger row tied to the batch.
   */
  async runRule(ruleId: string, periodKey?: string, opts: { employeeIds?: string[]; manual?: boolean } = {}) {
    const rule = await this.prisma.leaveCreditRule.findUnique({ where: { id: ruleId }, include: { leaveType: true } });
    if (!rule) throw notFound('Credit rule');
    if (!rule.active || !rule.leaveType.active) throw badRequest('This rule is inactive');
    const key = periodKey ?? currentPeriodKey(rule.frequency, todayKey());
    const info = periodInfo(rule.frequency, key);
    const batchType = rule.frequency === 'YEARLY' ? 'ANNUAL' : rule.frequency === 'QUARTERLY' ? 'QUARTERLY' : 'MONTHLY';
    const batchKey = opts.employeeIds ? `basic:${key}:${Date.now()}` : `${key}:${rule.employmentType}`;
    if (!opts.employeeIds) {
      const existing = await this.prisma.leaveCreditBatch.findFirst({ where: { type: batchType, leaveTypeId: rule.leaveTypeId, periodKey: batchKey, status: 'COMPLETED' } });
      if (existing) throw new AppError(409, 'ALREADY_CREDITED', `${rule.leaveType.name} is already credited for ${info.label}`);
      await this.prisma.leaveCreditBatch.deleteMany({ where: { type: batchType, leaveTypeId: rule.leaveTypeId, periodKey: batchKey } });
    }
    const ctx = requireContext();
    const batch = await this.prisma.leaveCreditBatch.create({ data: { type: batchType, leaveTypeId: rule.leaveTypeId, ruleId: rule.id, periodKey: batchKey, leaveYear: info.year, status: 'RUNNING', triggeredById: ctx.userId ?? null, note: opts.manual ? 'Run manually' : 'Scheduled' } as any });
    try {
      const emps = await this.prisma.employee.findMany({
        where: { status: { in: [...ELIGIBLE_STATUSES] }, employmentType: rule.employmentType as any, ...(opts.employeeIds ? { id: { in: opts.employeeIds } } : {}), OR: [{ joiningDate: null }, { joiningDate: { lte: dd(info.end) } }] },
        select: { id: true, joiningDate: true },
      });
      const entries: LedgerPost[] = [];
      for (const e of emps) {
        const join = e.joiningDate ? dk(e.joiningDate) : null;
        const days = creditDaysFor(rule, key, join);
        if (days <= 0) continue;
        if (opts.employeeIds) {
          // "Basic (annual)" from the credit form: skip employees already credited for this period.
          const dup = await this.prisma.leaveLedgerEntry.count({ where: { employeeId: e.id, leaveTypeId: rule.leaveTypeId, txType: { in: ['ACCRUAL', 'PRORATED_ACCRUAL'] }, effectiveDate: { gte: dd(info.start), lte: dd(info.end) } } });
          if (dup) continue;
        }
        const full = rule.frequency === 'YEARLY' ? rule.daysPerPeriod : days;
        entries.push({ employeeId: e.id, leaveTypeId: rule.leaveTypeId, leaveYear: info.year, txType: days < full ? 'PRORATED_ACCRUAL' : 'ACCRUAL', days, effectiveDate: info.start, batchId: batch.id, note: `${FREQ_LABEL[rule.frequency]} credit · ${info.label}` });
      }
      await this.ledger.post(entries);
      const total = round2(entries.reduce((s, x) => s + x.days, 0));
      await this.prisma.leaveCreditBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', employeeCount: entries.length, totalDays: total, completedAt: new Date() } });
      if (!opts.employeeIds) await this.prisma.leaveCreditRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date(), lastPeriodKey: key, lastRunStatus: 'COMPLETED' } });
      await this.audit.record({ action: 'leave.credit.run', entity: 'LeaveCreditBatch', entityId: batch.id, meta: { rule: rule.id, period: key, employees: entries.length, days: total } });
      return { batchId: batch.id, employees: entries.length, totalDays: total, label: info.label, leaveType: rule.leaveType.name };
    } catch (e) {
      await this.prisma.leaveCreditBatch.update({ where: { id: batch.id }, data: { status: 'FAILED', error: (e as Error).message, completedAt: new Date() } });
      await this.prisma.leaveCreditRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date(), lastRunStatus: 'FAILED' } });
      throw e;
    }
  }

  /** Scheduled: every active rule whose period is due (called by the monthly cron inside a tenant context). */
  async runDueRules(today = todayKey()) {
    const rules = await this.prisma.leaveCreditRule.findMany({ where: { active: true, leaveType: { active: true } } });
    for (const r of rules) {
      const key = currentPeriodKey(r.frequency, today);
      if (r.lastPeriodKey === key) continue;
      if (r.frequency === 'QUARTERLY' && key.slice(5, 7) !== today.slice(5, 7)) continue;
      try {
        await this.runRule(r.id, key);
      } catch (e) {
        if ((e as AppError).getStatus?.() !== 409) this.log.warn(`Credit rule ${r.id} failed: ${(e as Error).message}`);
      }
    }
  }

  // ── manual credit ─────────────────────────────────────────────────────

  async manualCredit(input: ManualCreditInput) {
    this.assertHr();
    const type = await this.prisma.leaveType.findUnique({ where: { id: input.leaveTypeId } });
    if (!type) throw notFound('Leave type');
    const today = todayKey();
    if (input.creditType === 'BASIC') {
      if (type.isCompOff) throw badRequest('Comp-off has no basic credit rule; use Manual credit');
      const emps = await this.prisma.employee.findMany({ where: { id: { in: input.employeeIds } }, select: { employmentType: true } });
      const rules = await this.prisma.leaveCreditRule.findMany({ where: { leaveTypeId: type.id, active: true, employmentType: { in: [...new Set(emps.map((e) => e.employmentType))] } } });
      if (!rules.length) throw badRequest(`${type.name} has no active credit rule for these employees`);
      let employees = 0;
      let days = 0;
      for (const r of rules) {
        const res = await this.runRule(r.id, currentPeriodKey(r.frequency, today), { employeeIds: input.employeeIds, manual: true });
        employees += res.employees;
        days += res.totalDays;
      }
      return { employees, days: round2(days), message: `Credited ${fmtDays(round2(days))} days to ${employees} ${employees === 1 ? 'employee' : 'employees'}` };
    }
    const days = input.days!;
    const ctx = requireContext();
    const batch = await this.prisma.leaveCreditBatch.create({ data: { type: 'MANUAL', leaveTypeId: type.id, periodKey: `manual:${Date.now()}`, leaveYear: yearOf(today), status: 'RUNNING', triggeredById: ctx.userId ?? null, note: input.note } as any });
    const entries: LedgerPost[] = [];
    for (const employeeId of input.employeeIds) {
      if (type.isCompOff) {
        if (days <= 0) throw badRequest('Comp-off credits must be positive');
        const worked = input.workedDate ?? today;
        const grant = await this.prisma.compOffGrant.create({
          data: { employeeId, workedDate: dd(worked), units: days, remaining: days, expiresOn: dd(addDays(worked, type.expiryDays ?? 60)), status: 'APPROVED', source: 'MANUAL', reason: input.note, decidedByName: ctx.userName ?? 'HR', decidedAt: new Date() } as any,
        });
        entries.push({ employeeId, leaveTypeId: type.id, leaveYear: yearOf(worked), txType: 'COMP_OFF_GRANT', days, effectiveDate: worked, compOffGrantId: grant.id, batchId: batch.id, note: input.note });
      } else {
        entries.push({ employeeId, leaveTypeId: type.id, leaveYear: yearOf(today), txType: days >= 0 ? 'MANUAL_CREDIT' : 'MANUAL_DEBIT', days, effectiveDate: today, batchId: batch.id, note: input.note });
      }
    }
    await this.ledger.post(entries);
    await this.prisma.leaveCreditBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', employeeCount: entries.length, totalDays: round2(days * entries.length), completedAt: new Date() } });
    await this.audit.record({ action: 'leave.credit.manual', entity: 'LeaveCreditBatch', entityId: batch.id, meta: { type: type.code, days, employees: input.employeeIds.length } });
    const users = await this.notifications.usersForEmployees(input.employeeIds);
    await this.notifications.notify({ userIds: users, type: 'leave.credit', title: `${fmtDays(Math.abs(days))} ${type.name.toLowerCase()} ${days >= 0 ? 'credited to' : 'debited from'} your balance`, body: input.note, link: '/leave', from: ctx.userName ?? 'HR' });
    const n = input.employeeIds.length;
    return { employees: n, days, message: days >= 0 ? `Credited ${fmtDays(days)} ${days === 1 ? 'day' : 'days'} to ${n} ${n === 1 ? 'employee' : 'employees'}` : `Debited ${fmtDays(-days)} days from ${n} ${n === 1 ? 'employee' : 'employees'}` };
  }

  async manualCredits(): Promise<ManualCreditRow[]> {
    const rows = await this.prisma.leaveLedgerEntry.findMany({
      where: { OR: [{ txType: { in: ['MANUAL_CREDIT', 'MANUAL_DEBIT'] } }, { txType: 'COMP_OFF_GRANT' }] },
      include: { employee: { select: { fullName: true, empCode: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const types = new Map((await this.prisma.leaveType.findMany()).map((t) => [t.id, t.name]));
    return rows.map((r) => ({ id: r.id, date: dk(r.effectiveDate), employeeName: r.employee.fullName, employeeCode: r.employee.empCode, leaveType: types.get(r.leaveTypeId) ?? '—', days: r.days, txType: r.txType, note: r.note, creditedBy: r.createdByName }));
  }

  // ── comp-off ──────────────────────────────────────────────────────────

  private toCompOffRow(g: { id: string; workedDate: Date; units: number; remaining: number; expiresOn: Date; status: string; reason: string | null; source: string; employee: { fullName: string } }): CompOffRow {
    return { id: g.id, employeeName: g.employee.fullName, workedDate: dk(g.workedDate), units: g.units, remaining: g.remaining, expiresOn: dk(g.expiresOn), status: g.status, reason: g.reason, source: g.source };
  }

  async myCompOffs(): Promise<CompOffRow[]> {
    const me = this.org.myEmployeeId();
    const rows = await this.prisma.compOffGrant.findMany({ where: { employeeId: me }, include: { employee: { select: { fullName: true } } }, orderBy: { workedDate: 'desc' }, take: 50 });
    return rows.map((g) => this.toCompOffRow(g));
  }

  async requestCompOff(input: CompOffRequestInput): Promise<CompOffRow> {
    const me = this.org.myEmployeeId();
    const type = await this.prisma.leaveType.findFirst({ where: { isCompOff: true, active: true } });
    if (!type) throw badRequest('Comp-off is not enabled');
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id: me }, select: { id: true, fullName: true, managerId: true, employmentType: true } });
    if (!type.appliesTo.includes(emp.employmentType)) throw forbidden('Comp-off does not apply to your employment type');
    const settings = await this.settings.get<LeaveSettings>(LEAVE_SETTINGS_KEY, DEFAULT_LEAVE_SETTINGS);
    const today = todayKey();
    if (input.workedDate > today) throw badRequest('The worked date must be in the past');
    if (diffDays(today, input.workedDate) > settings.compOffRequestWindowDays) throw badRequest(`Comp-off must be requested within ${settings.compOffRequestWindowDays} days of working`);
    const cal = await this.calendar.forEmployee(me, input.workedDate, input.workedDate);
    const kind = cal.calendar(input.workedDate).kind;
    if (kind === 'WORKING') throw badRequest('Comp-off is only for work on a weekly off or holiday');
    const dup = await this.prisma.compOffGrant.findFirst({ where: { employeeId: me, workedDate: dd(input.workedDate), status: { notIn: ['REJECTED', 'CANCELLED'] } } });
    if (dup) throw badRequest('You already requested comp-off for this date');
    const att = await this.prisma.attendanceDay.findUnique({ where: { employeeId_date: { employeeId: me, date: dd(input.workedDate) } } }).catch(() => null);
    const worked = att?.workedMinutes ?? null;
    const units = input.duration === 'HALF' ? 0.5 : 1;
    if (att && worked !== null) {
      const need = units === 1 ? Math.min(settings.compOffFullDayMinMinutes, cal.shiftNetMinutes) : settings.compOffHalfDayMinMinutes;
      if (worked < need) throw badRequest(`Attendance shows ${Math.floor(worked / 60)}h ${worked % 60}m worked; a ${units === 1 ? 'full' : 'half'} day needs ${Math.round(need / 60)}h`);
    }
    const approver = await this.requests.resolveApprover(emp);
    const g = await this.prisma.compOffGrant.create({
      data: { employeeId: me, workedDate: dd(input.workedDate), units, remaining: 0, expiresOn: dd(addDays(input.workedDate, type.expiryDays ?? 60)), status: 'PENDING', source: 'REQUEST', reason: input.reason, workedMinutes: worked, approverEmployeeId: approver?.id ?? null } as any,
      include: { employee: { select: { fullName: true } } },
    });
    await this.audit.record({ action: 'leave.compoff.requested', entity: 'CompOffGrant', entityId: g.id, meta: { workedDate: input.workedDate, units } });
    const users = await this.notifications.usersForEmployees([approver?.id]);
    await this.notifications.notify({ userIds: users, type: 'leave.compoff', title: `Comp-off request from ${emp.fullName}`, body: `Worked ${dayMonth(input.workedDate)} · ${units === 1 ? 'Full day' : 'Half day'} · ${input.reason}`, link: '/leave?tab=team', from: emp.fullName, email: true });
    return this.toCompOffRow(g);
  }

  async decideCompOff(id: string, approve: boolean, comment?: string): Promise<CompOffRow> {
    const g = await this.prisma.compOffGrant.findUnique({ where: { id }, include: { employee: { select: { fullName: true } } } });
    if (!g) throw notFound('Comp-off request');
    if (g.status !== 'PENDING') throw new AppError(409, 'LEAVE_STATE', 'This comp-off request is no longer pending');
    const ctx = requireContext();
    if (g.employeeId === ctx.employeeId) throw forbidden("You can't approve your own request");
    if (!hasPerm(ctx, 'leave.manage') && g.approverEmployeeId !== ctx.employeeId) throw forbidden('Only the approver can act on this request');
    if (!approve && !comment) throw badRequest('Add a comment for the employee');
    const type = await this.prisma.leaveType.findFirstOrThrow({ where: { isCompOff: true } });
    const expiresOn = addDays(dk(g.workedDate), type.expiryDays ?? 60);
    const saved = await this.prisma.compOffGrant.update({
      where: { id },
      data: approve ? { status: 'APPROVED', remaining: g.units, expiresOn: dd(expiresOn), decidedAt: new Date(), decidedByName: ctx.userName ?? 'Approver', comment: comment ?? null } : { status: 'REJECTED', decidedAt: new Date(), decidedByName: ctx.userName ?? 'Approver', comment: comment ?? null },
      include: { employee: { select: { fullName: true } } },
    });
    if (approve) await this.ledger.post([{ employeeId: g.employeeId, leaveTypeId: type.id, leaveYear: yearOf(todayKey()), txType: 'COMP_OFF_GRANT', days: g.units, effectiveDate: dk(g.workedDate), compOffGrantId: g.id, note: `Worked ${dayMonth(dk(g.workedDate))}` }]);
    await this.audit.record({ action: approve ? 'leave.compoff.approved' : 'leave.compoff.rejected', entity: 'CompOffGrant', entityId: id, meta: { comment: comment ?? null } });
    const users = await this.notifications.usersForEmployees([g.employeeId]);
    await this.notifications.notify({ userIds: users, type: 'leave.compoff', title: approve ? `Comp-off approved · expires ${dayMonth(expiresOn)}` : 'Comp-off request rejected', body: comment, link: '/leave', from: ctx.userName ?? 'Approver' });
    return this.toCompOffRow(saved);
  }

  async cancelGrant(id: string) {
    this.assertHr();
    const g = await this.prisma.compOffGrant.findUnique({ where: { id } });
    if (!g) throw notFound('Comp-off grant');
    if (g.remaining < g.units || !['APPROVED', 'PENDING'].includes(g.status)) throw new AppError(409, 'LEAVE_STATE', 'Only unused grants can be cancelled');
    await this.prisma.compOffGrant.update({ where: { id }, data: { status: 'CANCELLED', remaining: 0 } });
    const type = await this.prisma.leaveType.findFirstOrThrow({ where: { isCompOff: true } });
    if (g.status === 'APPROVED') await this.ledger.post([{ employeeId: g.employeeId, leaveTypeId: type.id, leaveYear: yearOf(todayKey()), txType: 'MANUAL_DEBIT', days: -g.units, effectiveDate: todayKey(), compOffGrantId: g.id, note: 'Grant cancelled' }]);
    await this.audit.record({ action: 'leave.compoff.cancelled', entity: 'CompOffGrant', entityId: id });
    return { ok: true };
  }

  /** Daily: expire comp-off grants past their expiry date. */
  async expireCompOffs(today = todayKey()) {
    const type = await this.prisma.leaveType.findFirst({ where: { isCompOff: true } });
    if (!type) return 0;
    const due = await this.prisma.compOffGrant.findMany({ where: { status: { in: ['APPROVED', 'PARTIALLY_USED'] }, expiresOn: { lt: dd(today) } } });
    for (const g of due) {
      await this.prisma.compOffGrant.update({ where: { id: g.id }, data: { status: 'EXPIRED', remaining: 0 } });
      if (g.remaining > 0) await this.ledger.post([{ employeeId: g.employeeId, leaveTypeId: type.id, leaveYear: yearOf(today), txType: 'EXPIRY', days: -g.remaining, effectiveDate: today, compOffGrantId: g.id, note: `Expired ${dayMonth(dk(g.expiresOn))}` }]);
    }
    return due.length;
  }

  // ── year-end ──────────────────────────────────────────────────────────

  async yearEndPreview(year: number): Promise<YearEndPreviewRow[]> {
    const bals = await this.prisma.leaveBalance.findMany({ where: { year, leaveType: { isCompOff: false, isPaid: true } }, include: { leaveType: true, employee: { select: { fullName: true } } } });
    return bals
      .map((b) => {
        const closing = round2(b.opening + b.accrued + b.credited - b.availed - b.lapsed - b.encashed);
        const s = yearEndSplit(closing, b.leaveType.carryForwardMax, false);
        return { employeeId: b.employeeId, employeeName: b.employee.fullName, leaveType: b.leaveType.name, closing, carry: round2(s.carry), encash: round2(s.encash), lapse: round2(s.lapse), leaveTypeId: b.leaveTypeId };
      })
      .filter((r) => r.closing !== 0)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }

  /** Carry forward (capped) into year+1 and lapse the rest. Idempotent per year. */
  async runYearEnd(year: number) {
    if (year >= yearOf(todayKey())) throw badRequest(`Year-end for ${year} runs on 1 Jan ${year + 1}`);
    const done = await this.prisma.leaveCreditBatch.findFirst({ where: { type: 'YEAR_END', periodKey: `ye:${year}`, status: 'COMPLETED' } });
    if (done) throw new AppError(409, 'ALREADY_CREDITED', `Year-end ${year} has already been processed`);
    const batch = await this.prisma.leaveCreditBatch.create({ data: { type: 'YEAR_END', periodKey: `ye:${year}`, leaveYear: year, status: 'RUNNING', triggeredById: requireContext().userId ?? null } as any });
    const rows = (await this.yearEndPreview(year)) as (YearEndPreviewRow & { leaveTypeId: string })[];
    const entries: LedgerPost[] = [];
    for (const r of rows) {
      const note = `Year-end ${year}`;
      if (r.carry > 0) {
        entries.push({ employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, leaveYear: year, txType: 'CARRY_FORWARD_OUT', days: -r.carry, effectiveDate: `${year}-12-31`, note });
        entries.push({ employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, leaveYear: year + 1, txType: 'CARRY_FORWARD_IN', days: r.carry, effectiveDate: `${year + 1}-01-01`, note });
      } else if (r.carry < 0) {
        entries.push({ employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, leaveYear: year + 1, txType: 'OPENING', days: r.carry, effectiveDate: `${year + 1}-01-01`, note: `${note} (negative carried)` });
      }
      if (r.lapse > 0) entries.push({ employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, leaveYear: year, txType: 'LAPSE', days: -r.lapse, effectiveDate: `${year}-12-31`, note });
    }
    await this.ledger.post(entries.map((e) => ({ ...e, batchId: undefined })));
    await this.prisma.leaveCreditBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', employeeCount: new Set(rows.map((r) => r.employeeId)).size, totalDays: round2(rows.reduce((s, r) => s + r.carry, 0)), completedAt: new Date() } });
    await this.audit.record({ action: 'leave.yearend.run', entity: 'LeaveCreditBatch', entityId: batch.id, meta: { year, rows: rows.length } });
    return { rows: rows.length, carried: round2(rows.reduce((s, r) => s + Math.max(0, r.carry), 0)), lapsed: round2(rows.reduce((s, r) => s + r.lapse, 0)) };
  }

  // ── settings / holidays ───────────────────────────────────────────────

  getSettings() {
    return this.settings.get<LeaveSettings>(LEAVE_SETTINGS_KEY, DEFAULT_LEAVE_SETTINGS);
  }

  async saveSettings(input: LeaveSettings) {
    this.assertHr();
    await this.settings.set(LEAVE_SETTINGS_KEY, input);
    await this.audit.record({ action: 'leave.settings.updated', entity: 'Setting', entityId: LEAVE_SETTINGS_KEY, meta: input as any });
    return input;
  }

  async holidays(year: number): Promise<LeaveHolidayRow[]> {
    const rows = await this.calendar.holidays(`${year}-01-01`, `${year}-12-31`);
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return rows.map((h) => ({ id: h.id, date: h.date, name: h.name, type: h.type, day: DAYS[dd(h.date).getUTCDay()]! }));
  }

  /** employee.created: open balances and credit the joining-year YEARLY quota (pro-rated). */
  async onEmployeeCreated(employeeId: string) {
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, employmentType: true, joiningDate: true } });
    if (!emp) return;
    const year = yearOf(todayKey());
    const rules = await this.prisma.leaveCreditRule.findMany({ where: { active: true, frequency: 'YEARLY', employmentType: emp.employmentType, leaveType: { active: true } } });
    const join = emp.joiningDate ? dk(emp.joiningDate) : null;
    const entries: LedgerPost[] = [];
    for (const r of rules) {
      const already = await this.prisma.leaveLedgerEntry.count({ where: { employeeId, leaveTypeId: r.leaveTypeId, leaveYear: year, txType: { in: ['ACCRUAL', 'PRORATED_ACCRUAL'] } } });
      if (already) continue;
      const days = creditDaysFor(r, String(year), join);
      if (days > 0) entries.push({ employeeId, leaveTypeId: r.leaveTypeId, leaveYear: year, txType: days < r.daysPerPeriod ? 'PRORATED_ACCRUAL' : 'ACCRUAL', days, effectiveDate: join && join > `${year}-01-01` ? join : `${year}-01-01`, note: 'Joining credit' });
    }
    await this.ledger.post(entries);
    await this.ledger.ensureBalances(employeeId, year);
  }
}
