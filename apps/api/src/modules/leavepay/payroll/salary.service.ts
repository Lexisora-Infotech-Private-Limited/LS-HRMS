import { Injectable } from '@nestjs/common';
import { Prisma, type EmployeePayrollProfile, type EmployeeSalary, type SalaryTemplate } from '@prisma/client';
import { DEFAULT_ESI_SETTINGS, DEFAULT_PF_SETTINGS, formatINR, validateSalaryTemplateLines, type EsiSettings, type PfSettings, type PayrollProfileInput, type SalaryListRow, type SalaryPreview, type SalaryPreviewInput, type SalaryRevisionInput, type SalaryTemplateInput, type SalaryTemplatePreviewInput, type SalaryTemplateRow, type SalaryView } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { requireContext } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../../core/http/errors';
import { AuditService } from '../../../core/audit/audit.service';
import { CryptoService } from '../../../core/crypto/crypto.service';
import { dd, dk, periodOf, todayKey } from '../common/dates';
import { buildStructure, lowestWorkingCtc, pickTemplate, templatesOverlap, type SalaryTemplateData, type StructureLine, type TemplateLine } from './salary';
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
    return this.structureOf(row).filter((l) => !['PF_ER', 'ESI_ER', 'CTC'].includes(l.code) && l.kind !== 'DEDUCTION');
  }

  /** Company deductions from the template (flat monthly amounts, taken at payroll after statutory lines). */
  deductionLines(row: Pick<EmployeeSalary, 'structureEnc'>): StructureLine[] {
    return this.structureOf(row).filter((l) => l.kind === 'DEDUCTION');
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
    const rows = lines.length ? [...lines.filter((l) => l.code !== 'CTC' && l.kind !== 'DEDUCTION'), { code: 'CTC', label: 'CTC', monthlyPaise: Math.round(current!.ctcAnnualPaise / 12), annualPaise: current!.ctcAnnualPaise }, ...lines.filter((l) => l.kind === 'DEDUCTION')] : [];
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
      statutory: { uan: emp.uan, pfEnabled: prof.pfEnabled, pfCeilingOpted: prof.pfCeilingOpted, esiCovered: current ? prof.payType === 'SALARY' && (current.esiConfig as unknown as EsiSettings | null)?.enabled !== false && esiCovered(current.grossMonthlyPaise, prof.esiMode, ((current.esiConfig as unknown as EsiSettings | null)?.grossLimit ?? 21000) * 100) : false, ptState: prof.ptStateCode, taxRegime: prof.taxRegime, panMasked },
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

  async preview(input: SalaryPreviewInput): Promise<SalaryPreview> {
    const emp = input.employeeId ? await this.prisma.employee.findUnique({ where: { id: input.employeeId }, include: { leavepayPayrollProfile: true, branch: true } }) : null;
    // With an employee, preview exactly what a revision would produce: their PF / ESI switches and ceiling choice apply.
    const prof = emp ? resolveProfile(emp.leavepayPayrollProfile, emp) : null;
    const tpl = await this.templateFor(input.payType, emp?.employmentType ?? null, input.ctcAnnualPaise ?? (input.grossMonthlyPaise ?? 0) * 12);
    const s = buildStructure(
      { grossMonthlyPaise: input.grossMonthlyPaise, ctcAnnualPaise: input.ctcAnnualPaise },
      { payType: input.payType, pfEnabled: prof?.pfEnabled, pfCeilingOpted: prof?.pfCeilingOpted ?? input.pfCeilingOpted, esiMode: prof?.esiMode, template: tpl?.lines, pf: tpl?.pf, esi: tpl?.esi },
    );
    return { grossMonthlyPaise: s.grossMonthlyPaise, ctcAnnualPaise: s.ctcAnnualPaise, ctcMonthlyPaise: s.ctcMonthlyPaise, rows: s.table, warnings: s.warnings, templateName: input.payType === 'SALARY' ? tpl?.name ?? 'Standard (built-in)' : null };
  }

  async revise(employeeId: string, input: SalaryRevisionInput) {
    const ctx = requireContext();
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, include: { leavepayPayrollProfile: true, branch: true } });
    if (!emp) throw notFound('Employee');
    const prof = resolveProfile(emp.leavepayPayrollProfile, emp);
    const tpl = await this.templateFor(input.payType, emp.employmentType, input.mode === 'CTC' ? input.amountPaise : input.amountPaise * 12);
    const s = buildStructure(input.mode === 'CTC' ? { ctcAnnualPaise: input.amountPaise } : { grossMonthlyPaise: input.amountPaise }, { payType: input.payType, pfEnabled: prof.pfEnabled, pfCeilingOpted: prof.pfCeilingOpted, esiMode: prof.esiMode, template: tpl?.lines, pf: tpl?.pf, esi: tpl?.esi });
    if (s.grossMonthlyPaise <= 0) throw badRequest('Enter a valid amount');
    // A structure whose fixed amounts exceed the salary leaves the balancing component negative: never save that.
    const negative = s.lines.find((l) => l.kind !== 'DEDUCTION' && l.monthlyPaise < 0);
    if (negative) throw badRequest(`${negative.label} would be negative at this ${input.mode === 'CTC' ? 'CTC' : 'gross'} with the “${tpl?.name ?? 'Standard'}” structure. Enter a higher amount, or ask an admin to lower the structure's fixed amounts or raise its minimum CTC.`, 'STRUCTURE_NEGATIVE');
    const data = { ctcAnnualPaise: s.ctcAnnualPaise, grossMonthlyPaise: s.grossMonthlyPaise, structureEnc: this.crypto.encryptJson(s.lines)!, payType: input.payType, templateId: tpl?.id ?? null, pfConfig: tpl?.pf ? (tpl.pf as unknown as Prisma.InputJsonValue) : Prisma.DbNull, esiConfig: tpl?.esi ? (tpl.esi as unknown as Prisma.InputJsonValue) : Prisma.DbNull, reason: input.reason, note: input.note ?? null, createdByName: ctx.userName ?? 'HR', status: 'ACTIVE' };
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

  // ── Salary structure templates (Admin/CEO and HR edit these; applied to new salary revisions) ──────────

  private toData(t: SalaryTemplate): SalaryTemplateData {
    return { id: t.id, name: t.name, payType: t.payType as 'SALARY' | 'STIPEND', employmentTypes: t.employmentTypes, minCtcPaise: t.minCtcPaise, maxCtcPaise: t.maxCtcPaise, isDefault: t.isDefault, active: t.active, lines: (t.lines as unknown as TemplateLine[]) ?? [], pf: (t.pf as unknown as PfSettings | null) ?? null, esi: (t.esi as unknown as EsiSettings | null) ?? null };
  }

  private row(t: SalaryTemplate): SalaryTemplateRow {
    return { id: t.id, name: t.name, employmentTypes: t.employmentTypes, minCtcPaise: t.minCtcPaise, maxCtcPaise: t.maxCtcPaise, isDefault: t.isDefault, active: t.active, pf: (t.pf as unknown as PfSettings | null) ?? DEFAULT_PF_SETTINGS, esi: (t.esi as unknown as EsiSettings | null) ?? DEFAULT_ESI_SETTINGS, lines: (t.lines as unknown as SalaryTemplateRow['lines']) ?? [], updatedByName: t.updatedByName, updatedAt: t.updatedAt.toISOString() };
  }

  /** The structure that applies to this CTC, or null → the built-in Standard structure. */
  async templateFor(payType: 'SALARY' | 'STIPEND', employmentType: string | null, ctcAnnualPaise: number): Promise<SalaryTemplateData | null> {
    if (payType !== 'SALARY') return null;
    const rows = await this.prisma.salaryTemplate.findMany({ where: { active: true, payType: 'SALARY' } });
    return pickTemplate(rows.map((r) => this.toData(r)), { payType, employmentType, ctcAnnualPaise });
  }

  async listTemplates(): Promise<SalaryTemplateRow[]> {
    const rows = await this.prisma.salaryTemplate.findMany({ orderBy: [{ active: 'desc' }, { minCtcPaise: 'asc' }, { name: 'asc' }] });
    return rows.map((r) => this.row(r));
  }

  private async assertTemplate(input: SalaryTemplateInput, selfId?: string) {
    const problems = validateSalaryTemplateLines(input.lines);
    if (problems.length) throw new AppError(422, 'TEMPLATE_INVALID', problems.join(' · '), { problems });
    if (input.active) {
      // The balancing component must never go negative anywhere in the structure's CTC range.
      const floor = lowestWorkingCtc({ payType: 'SALARY', template: input.lines as TemplateLine[], pf: input.pf, esi: input.esi });
      if (floor > 0 && (input.minCtcPaise ?? 0) < floor) {
        const balance = input.lines.find((l) => l.calc === 'BALANCING')?.label ?? 'The balancing component';
        const from = input.minCtcPaise == null ? 'it has no lower CTC limit' : `its lower CTC limit is ${formatINR(input.minCtcPaise)}`;
        throw new AppError(422, 'TEMPLATE_INVALID', `“${balance}” would go negative: this structure only works from an annual CTC of about ${formatINR(floor)}, but ${from}. Raise “CTC from” to at least ${formatINR(floor)}, or reduce the fixed amounts.`, { lowestCtcPaise: floor });
      }

      const others = await this.prisma.salaryTemplate.findMany({ where: { active: true, payType: 'SALARY', ...(selfId ? { id: { not: selfId } } : {}) } });
      const clash = others.find((o) => templatesOverlap({ minCtcPaise: input.minCtcPaise ?? null, maxCtcPaise: input.maxCtcPaise ?? null, employmentTypes: input.employmentTypes }, o) && (o.minCtcPaise != null || o.maxCtcPaise != null) && (input.minCtcPaise != null || input.maxCtcPaise != null));
      if (clash) throw conflict(`The CTC range overlaps “${clash.name}”. Two structures can't apply to the same salary — adjust one of the ranges.`, 'TEMPLATE_OVERLAP');
    }
  }

  async createTemplate(input: SalaryTemplateInput): Promise<SalaryTemplateRow> {
    const ctx = requireContext();
    await this.assertTemplate(input);
    if (await this.prisma.salaryTemplate.findFirst({ where: { name: input.name } })) throw conflict(`A structure named “${input.name}” already exists`, 'DUPLICATE_NAME');
    if (input.isDefault) await this.prisma.salaryTemplate.updateMany({ where: { payType: 'SALARY' }, data: { isDefault: false } });
    const t = await this.prisma.salaryTemplate.create({
      data: { name: input.name, payType: 'SALARY', employmentTypes: input.employmentTypes, minCtcPaise: input.minCtcPaise ?? null, maxCtcPaise: input.maxCtcPaise ?? null, isDefault: input.isDefault, active: input.active, pf: input.pf as unknown as object, esi: input.esi as unknown as object, lines: input.lines as unknown as object, updatedByName: ctx.userName ?? null } as any,
    });
    await this.audit.record({ action: 'salary.template.created', entity: 'SalaryTemplate', entityId: t.id, meta: { name: t.name, range: [t.minCtcPaise, t.maxCtcPaise], lines: input.lines.length } });
    return this.row(t);
  }

  async updateTemplate(id: string, input: SalaryTemplateInput): Promise<SalaryTemplateRow> {
    const ctx = requireContext();
    const cur = await this.prisma.salaryTemplate.findFirst({ where: { id } });
    if (!cur) throw notFound('Salary structure');
    await this.assertTemplate(input, id);
    const dup = await this.prisma.salaryTemplate.findFirst({ where: { name: input.name, id: { not: id } } });
    if (dup) throw conflict(`A structure named “${input.name}” already exists`, 'DUPLICATE_NAME');
    if (input.isDefault) await this.prisma.salaryTemplate.updateMany({ where: { payType: 'SALARY', id: { not: id } }, data: { isDefault: false } });
    const t = await this.prisma.salaryTemplate.update({
      where: { id },
      data: { name: input.name, employmentTypes: input.employmentTypes, minCtcPaise: input.minCtcPaise ?? null, maxCtcPaise: input.maxCtcPaise ?? null, isDefault: input.isDefault, active: input.active, pf: input.pf as unknown as object, esi: input.esi as unknown as object, lines: input.lines as unknown as object, updatedByName: ctx.userName ?? null },
    });
    await this.audit.record({ action: 'salary.template.updated', entity: 'SalaryTemplate', entityId: id, meta: { name: t.name, before: { range: [cur.minCtcPaise, cur.maxCtcPaise], lines: cur.lines }, after: { range: [t.minCtcPaise, t.maxCtcPaise], lines: input.lines } } as any });
    return this.row(t);
  }

  /** A structure already used by a salary revision is only deactivated (history keeps pointing at it); an unused one is deleted. */
  async removeTemplate(id: string): Promise<{ ok: true; deactivated: boolean }> {
    const cur = await this.prisma.salaryTemplate.findFirst({ where: { id } });
    if (!cur) throw notFound('Salary structure');
    const used = await this.prisma.employeeSalary.count({ where: { templateId: id } });
    if (used) {
      await this.prisma.salaryTemplate.update({ where: { id }, data: { active: false, isDefault: false } });
    } else {
      await this.prisma.salaryTemplate.delete({ where: { id } });
    }
    await this.audit.record({ action: 'salary.template.removed', entity: 'SalaryTemplate', entityId: id, meta: { name: cur.name, deactivated: used > 0 } });
    return { ok: true, deactivated: used > 0 };
  }

  /** Live preview of a template being edited: monthly breakup for a sample CTC. */
  previewTemplate(input: SalaryTemplatePreviewInput) {
    const problems = validateSalaryTemplateLines(input.lines);
    const s = buildStructure({ ctcAnnualPaise: input.ctcAnnualPaise }, { payType: 'SALARY', pfCeilingOpted: input.pfCeilingOpted, template: input.lines as TemplateLine[], pf: input.pf, esi: input.esi });
    const lowestCtcPaise = problems.length ? 0 : lowestWorkingCtc({ payType: 'SALARY', template: input.lines as TemplateLine[], pf: input.pf, esi: input.esi });
    return { grossMonthlyPaise: s.grossMonthlyPaise, ctcAnnualPaise: s.ctcAnnualPaise, ctcMonthlyPaise: s.ctcMonthlyPaise, rows: s.table, warnings: [...problems, ...s.warnings], lowestCtcPaise };
  }
}
