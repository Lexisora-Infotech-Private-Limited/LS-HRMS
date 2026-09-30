import { Injectable } from '@nestjs/common';
import type { EmployeePayrollProfile, EmployeeSalary } from '@prisma/client';
import type { PayrollProfileInput, SalaryListRow, SalaryPreview, SalaryPreviewInput, SalaryRevisionInput, SalaryView } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { requireContext } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { badRequest, forbidden, notFound } from '../../../core/http/errors';
import { AuditService } from '../../../core/audit/audit.service';
import { CryptoService } from '../../../core/crypto/crypto.service';
import { dd, dk, periodOf, todayKey } from '../common/dates';
import { buildStructure, type StructureLine } from './salary';
import { esiCovered, ptStateFrom, type Declarations } from './statutory';

export type ResolvedProfile = {
  payType: 'SALARY' | 'STIPEND';
  pfEnabled: boolean;
  pfCeilingOpted: boolean;
  esiMode: string;
  ptStateCode: string;
  taxRegime: 'OLD' | 'NEW';
  declarations: Declarations | null;
  payrollHold: boolean;
  holdReason: string | null;
  idleDeductionExempt: boolean;
  paymentMode: string;
  bankVerified: boolean;
};

/** Profile row or defaults (interns → stipend; PT state from branch; regime from the employee record). */
export function resolveProfile(p: EmployeePayrollProfile | null | undefined, emp: { employmentType: string; taxRegime: string; branch?: { name: string } | null }): ResolvedProfile {
  const intern = emp.employmentType === 'INTERN';
  return {
    payType: (p?.payType as 'SALARY' | 'STIPEND') ?? (intern ? 'STIPEND' : 'SALARY'),
    pfEnabled: p?.pfEnabled ?? !intern,
    pfCeilingOpted: p?.pfCeilingOpted ?? true,
    esiMode: p?.esiMode ?? 'AUTO',
    ptStateCode: p?.ptStateCode ?? ptStateFrom(emp.branch?.name),
    taxRegime: (p?.taxRegime as 'OLD' | 'NEW') ?? (emp.taxRegime as 'OLD' | 'NEW') ?? 'NEW',
    declarations: (p?.declarations as Declarations | null) ?? null,
    payrollHold: p?.payrollHold ?? false,
    holdReason: p?.holdReason ?? null,
    idleDeductionExempt: p?.idleDeductionExempt ?? false,
    paymentMode: p?.paymentMode ?? 'BANK_TRANSFER',
    bankVerified: p?.bankVerified ?? true,
  };
}

@Injectable()
export class SalaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  structureOf(row: Pick<EmployeeSalary, 'structureEnc'>): StructureLine[] {
    try {
      return this.crypto.decryptJson<StructureLine[]>(row.structureEnc) ?? [];
    } catch {
      return [];
    }
  }

  /** Earning components only (Basic/HRA/Special or Stipend) — the payroll proration base. */
  earningLines(row: Pick<EmployeeSalary, 'structureEnc'>): StructureLine[] {
    return this.structureOf(row).filter((l) => !['PF_ER', 'ESI_ER', 'CTC'].includes(l.code));
  }

  /** Salary effective on a date (latest non-cancelled revision with effectiveFrom ≤ date). */
  async effectiveOn(employeeIds: string[], date: string): Promise<Map<string, EmployeeSalary>> {
    const rows = await this.prisma.employeeSalary.findMany({ where: { employeeId: { in: employeeIds }, effectiveFrom: { lte: dd(date) }, status: { not: 'CANCELLED' } }, orderBy: { effectiveFrom: 'desc' } });
    const out = new Map<string, EmployeeSalary>();
    for (const r of rows) if (!out.has(r.employeeId)) out.set(r.employeeId, r);
    return out;
  }

  private async assertCanView(employeeId: string) {
    const ctx = requireContext();
    if (ctx.employeeId === employeeId) return;
    if (hasPerm(ctx, 'employees.compensation') || hasPerm(ctx, 'payroll.manage')) return;
    throw forbidden("You don't have access to this employee's compensation");
  }

  async view(employeeId: string): Promise<SalaryView> {
    await this.assertCanView(employeeId);
    const ctx = requireContext();
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, include: { branch: true, leavepayPayrollProfile: true } });
    if (!emp) throw notFound('Employee');
    const revs = await this.prisma.employeeSalary.findMany({ where: { employeeId }, orderBy: { effectiveFrom: 'desc' } });
    const today = todayKey();
    const current = revs.find((r) => dk(r.effectiveFrom) <= today && r.status !== 'CANCELLED') ?? revs[revs.length - 1] ?? null;
    const prof = resolveProfile(emp.leavepayPayrollProfile, emp);
    const lines = current ? this.structureOf(current) : [];
    const rows = lines.length ? [...lines.filter((l) => l.code !== 'CTC'), { code: 'CTC', label: 'CTC', monthlyPaise: Math.round(current!.ctcAnnualPaise / 12), annualPaise: current!.ctcAnnualPaise }] : [];
    if (ctx.employeeId !== employeeId) await this.audit.record({ action: 'salary.viewed', entity: 'Employee', entityId: employeeId });
    let panMasked: string | null = null;
    try {
      const pan = this.crypto.decrypt(emp.panEnc);
      panMasked = pan ? `••••${pan.slice(-4)}` : null;
    } catch {
      panMasked = null;
    }
    return {
      employeeId,
      employeeName: emp.fullName,
      payType: current?.payType ?? prof.payType,
      effectiveFrom: current ? dk(current.effectiveFrom) : null,
      ctcAnnualPaise: current?.ctcAnnualPaise ?? 0,
      grossMonthlyPaise: current?.grossMonthlyPaise ?? 0,
      rows,
      revisions: revs.map((r) => ({ id: r.id, effectiveFrom: dk(r.effectiveFrom), ctcAnnualPaise: r.ctcAnnualPaise, grossMonthlyPaise: r.grossMonthlyPaise, reason: r.reason, by: r.createdByName, status: r.status })),
      statutory: { uan: emp.uan, pfEnabled: prof.pfEnabled, pfCeilingOpted: prof.pfCeilingOpted, esiCovered: current ? prof.payType === 'SALARY' && esiCovered(current.grossMonthlyPaise, prof.esiMode) : false, ptState: prof.ptStateCode, taxRegime: prof.taxRegime, panMasked },
      bank: { accountMasked: emp.bankAccountLast4 ? `XXXX XXXX ${emp.bankAccountLast4}` : null, ifsc: emp.bankIfsc, bankName: emp.bankName, verified: prof.bankVerified },
      profile: { payrollHold: prof.payrollHold, holdReason: prof.holdReason, idleDeductionExempt: prof.idleDeductionExempt, esiMode: prof.esiMode, paymentMode: prof.paymentMode },
      canEdit: hasPerm(ctx, 'payroll.manage'),
    };
  }

  async list(): Promise<SalaryListRow[]> {
    const emps = await this.prisma.employee.findMany({ where: { status: { not: 'EXITED' } }, include: { department: true, branch: true, leavepayPayrollProfile: true }, orderBy: { fullName: 'asc' } });
    const sal = await this.effectiveOn(emps.map((e) => e.id), '2999-12-31');
    const today = todayKey();
    const current = await this.effectiveOn(emps.map((e) => e.id), today);
    return emps.map((e) => {
      const s = current.get(e.id) ?? sal.get(e.id);
      const p = resolveProfile(e.leavepayPayrollProfile, e);
      return { employeeId: e.id, name: e.fullName, code: e.empCode, department: e.department?.name ?? null, employmentType: e.employmentType, payType: s?.payType ?? p.payType, ctcAnnualPaise: s?.ctcAnnualPaise ?? 0, grossMonthlyPaise: s?.grossMonthlyPaise ?? 0, effectiveFrom: s ? dk(s.effectiveFrom) : null, taxRegime: p.taxRegime, hold: p.payrollHold };
    });
  }

  preview(input: SalaryPreviewInput): SalaryPreview {
    const s = buildStructure({ grossMonthlyPaise: input.grossMonthlyPaise, ctcAnnualPaise: input.ctcAnnualPaise }, { payType: input.payType, pfCeilingOpted: input.pfCeilingOpted });
    return { grossMonthlyPaise: s.grossMonthlyPaise, ctcAnnualPaise: s.ctcAnnualPaise, ctcMonthlyPaise: s.ctcMonthlyPaise, rows: s.table, warnings: s.warnings };
  }

  async revise(employeeId: string, input: SalaryRevisionInput) {
    const ctx = requireContext();
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, include: { leavepayPayrollProfile: true, branch: true } });
    if (!emp) throw notFound('Employee');
    const prof = resolveProfile(emp.leavepayPayrollProfile, emp);
    const s = buildStructure(input.mode === 'CTC' ? { ctcAnnualPaise: input.amountPaise } : { grossMonthlyPaise: input.amountPaise }, { payType: input.payType, pfEnabled: prof.pfEnabled, pfCeilingOpted: prof.pfCeilingOpted, esiMode: prof.esiMode });
    if (s.grossMonthlyPaise <= 0) throw badRequest('Enter a valid amount');
    const data = { ctcAnnualPaise: s.ctcAnnualPaise, grossMonthlyPaise: s.grossMonthlyPaise, structureEnc: this.crypto.encryptJson(s.lines)!, payType: input.payType, reason: input.reason, note: input.note ?? null, createdByName: ctx.userName ?? 'HR', status: 'ACTIVE' };
    const row = await this.prisma.employeeSalary.upsert({
      where: { employeeId_effectiveFrom: { employeeId, effectiveFrom: dd(input.effectiveFrom) } },
      create: { employeeId, effectiveFrom: dd(input.effectiveFrom), ...data } as any,
      update: data,
    });
    await this.prisma.employeeSalary.updateMany({ where: { employeeId, id: { not: row.id }, effectiveFrom: { lt: dd(input.effectiveFrom) }, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
    if (!emp.leavepayPayrollProfile) await this.prisma.employeePayrollProfile.create({ data: { employeeId, payType: input.payType, pfEnabled: input.payType === 'SALARY' } as any });
    else if (emp.leavepayPayrollProfile.payType !== input.payType) await this.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { payType: input.payType } });
    // Calculated (not finalized) runs covering the new salary need a re-run.
    const runs = await this.prisma.payrollRun.findMany({ where: { status: 'CALCULATED', period: { gte: periodOf(input.effectiveFrom) } }, select: { id: true } });
    if (runs.length) await this.prisma.payrollItem.updateMany({ where: { runId: { in: runs.map((r) => r.id) }, employeeId, status: { not: 'EXCLUDED' } }, data: { status: 'STALE' } });
    await this.audit.record({ action: 'salary.revision.created', entity: 'EmployeeSalary', entityId: row.id, meta: { employeeId, effectiveFrom: input.effectiveFrom, reason: input.reason } });
    return this.view(employeeId);
  }

  async updateProfile(employeeId: string, input: PayrollProfileInput) {
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!emp) throw notFound('Employee');
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) if (v !== undefined) data[k] = v;
    await this.prisma.employeePayrollProfile.upsert({ where: { employeeId }, create: { employeeId, ...data } as any, update: data });
    await this.audit.record({ action: 'payroll.profile.updated', entity: 'EmployeePayrollProfile', entityId: employeeId, meta: { fields: Object.keys(data) } });
    return this.view(employeeId);
  }
}
