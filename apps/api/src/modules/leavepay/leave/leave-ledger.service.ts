import { Injectable } from '@nestjs/common';
import type { LeaveLedgerTx } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { currentTenantId, getContext } from '../../../core/context/request-context';
import { dd, dk, type DateKey } from '../common/dates';
import { availableOf, round2, scheduledAnnual } from './leave-calc';

/** A tenant-scoped client (the service itself or an interactive-transaction client cast to it). */
export type Tx = PrismaService;

export type LedgerPost = {
  employeeId: string;
  leaveTypeId: string;
  leaveYear: number;
  txType: LeaveLedgerTx;
  days: number;
  effectiveDate: DateKey;
  requestId?: string | null;
  compOffGrantId?: string | null;
  batchId?: string | null;
  note?: string | null;
};

/** Pure: project ledger rows into balance parts. */
export function projectLedger(entries: { txType: string; days: number }[]) {
  const sum = (types: string[]) => round2(entries.filter((e) => types.includes(e.txType)).reduce((s, e) => s + e.days, 0));
  return {
    opening: sum(['OPENING', 'CARRY_FORWARD_IN']),
    accrued: sum(['ACCRUAL', 'PRORATED_ACCRUAL']),
    credited: sum(['MANUAL_CREDIT', 'MANUAL_DEBIT', 'COMP_OFF_GRANT']),
    availed: -sum(['AVAIL', 'AVAIL_REVERSAL']),
    lapsed: -sum(['LAPSE', 'EXPIRY', 'CARRY_FORWARD_OUT']),
    encashed: -sum(['ENCASHMENT']),
  };
}

/** Append-only leave ledger + LeaveBalance projection. */
@Injectable()
export class LeaveLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async post(entries: LedgerPost[], tx: Tx = this.prisma): Promise<void> {
    if (!entries.length) return;
    const ctx = getContext();
    const tenantId = currentTenantId();
    await tx.leaveLedgerEntry.createMany({
      data: entries.map((e) => ({
        tenantId,
        employeeId: e.employeeId,
        leaveTypeId: e.leaveTypeId,
        leaveYear: e.leaveYear,
        txType: e.txType,
        days: round2(e.days),
        effectiveDate: dd(e.effectiveDate),
        requestId: e.requestId ?? null,
        compOffGrantId: e.compOffGrantId ?? null,
        batchId: e.batchId ?? null,
        note: e.note ?? null,
        createdById: ctx?.userId ?? null,
        createdByName: ctx?.userName ?? 'System',
      })),
    });
    const keys = new Set(entries.map((e) => `${e.employeeId}|${e.leaveTypeId}|${e.leaveYear}`));
    for (const k of keys) {
      const [employeeId, leaveTypeId, year] = k.split('|') as [string, string, string];
      await this.recompute(employeeId, leaveTypeId, Number(year), tx);
    }
  }

  /** Pending (reserved) paid units of PENDING requests for a type/year, from each request's day breakdown. */
  async pendingUnits(employeeId: string, leaveTypeId: string, year: number, tx: Tx = this.prisma): Promise<number> {
    const reqs = await tx.leaveRequest.findMany({ where: { employeeId, leaveTypeId, status: 'PENDING' }, select: { dayBreakdown: true } });
    let s = 0;
    for (const r of reqs) {
      for (const d of (r.dayBreakdown as { date: string; units: number; isPaid: boolean }[]) ?? []) {
        if (d.isPaid && Number(d.date.slice(0, 4)) === year) s += d.units;
      }
    }
    return round2(s);
  }

  /** Recompute the LeaveBalance row from ledger + pending requests. */
  async recompute(employeeId: string, leaveTypeId: string, year: number, tx: Tx = this.prisma) {
    const [type, emp, entries, pending] = await Promise.all([
      tx.leaveType.findUniqueOrThrow({ where: { id: leaveTypeId }, include: { creditRules: { where: { active: true } } } }),
      tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { joiningDate: true, employmentType: true } }),
      tx.leaveLedgerEntry.findMany({ where: { employeeId, leaveTypeId, leaveYear: year }, select: { txType: true, days: true } }),
      this.pendingUnits(employeeId, leaveTypeId, year, tx),
    ]);
    const parts = { ...projectLedger(entries), pending };
    const available = availableOf(parts);
    const rule = type.creditRules.find((r) => r.employmentType === emp.employmentType);
    const join = emp.joiningDate ? dk(emp.joiningDate) : null;
    const scheduled = type.isCompOff ? 0 : rule ? scheduledAnnual(rule.frequency, rule.daysPerPeriod, type.annualQuota, join, year) : type.accrualFrequency === 'YEARLY' ? scheduledAnnual('YEARLY', 0, type.annualQuota, join, year) : 0;
    const entitlement = round2(Math.max(scheduled, parts.accrued) + Math.max(0, parts.credited));
    const data = { ...parts, available, entitlement };
    return tx.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
      create: { tenantId: currentTenantId(), employeeId, leaveTypeId, year, ...data },
      update: { ...data, version: { increment: 1 } },
    });
  }

  /** Ensure balance rows exist for every applicable type (e.g. a new joiner). */
  async ensureBalances(employeeId: string, year: number) {
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { employmentType: true } });
    if (!emp) return;
    const types = await this.prisma.leaveType.findMany({ where: { active: true, appliesTo: { has: emp.employmentType } } });
    for (const t of types) await this.recompute(employeeId, t.id, year);
  }
}
