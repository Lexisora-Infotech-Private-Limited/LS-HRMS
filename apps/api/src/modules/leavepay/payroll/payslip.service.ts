import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_PAYSLIP_TEMPLATE, canvasFromBlockDesign, payslipCanvasPreset, payslipCanvasSchema, payslipDesignSchema, payslipTemplateSchema, type PayslipCanvas, type PayslipDesign, type PayslipDetail, type PayslipRow, type PayslipTemplate, type PayslipTemplateDto, type PayslipTemplatesView } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { getContext, requireContext } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { badRequest, forbidden, notFound } from '../../../core/http/errors';
import { AuditService } from '../../../core/audit/audit.service';
import { CryptoService } from '../../../core/crypto/crypto.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PdfService } from '../../../core/pdf/pdf.service';
import { SettingsService } from '../../../core/settings/settings.service';
import { StorageService } from '../../../core/storage/storage.service';
import { dk, fyPriorPeriods, periodLabel, periodOf, todayKey } from '../common/dates';
import { rupeesInWords } from './num-words';
import { logoFromDataUrl, pdfMoney, renderPayslip, samplePayslip } from './payslip-render';

export { pdfMoney };

/** The earlier single-design setting, read once to carry an existing design over as the first saved template. */
const OLD_TEMPLATE_KEY = 'payroll.payslipTemplate';
const TEMPLATES_KEY = 'payroll.payslipTemplates';
type StoredPayslipTemplate = { id: string; name: string; design: PayslipCanvas };
/** `byStructure` maps a salary structure to the payslip template it uses; anything not listed uses the default. */
type StoredPayslipTemplates = { items: StoredPayslipTemplate[]; defaultId: string; byStructure: Record<string, string> };

/** Pay component names the editor offers for renaming or always showing: those in the salary structures, plus the standard statutory deductions. */
function componentNames(structureLines: unknown[]): { earnings: string[]; deductions: string[] } {
  const earnings: string[] = [];
  const deductions: string[] = ['Provident fund', 'ESI', 'Professional tax', 'Income tax (TDS)'];
  const add = (list: string[], name: string) => {
    if (name && !list.some((x) => x.toLowerCase() === name.toLowerCase())) list.push(name);
  };
  for (const lines of structureLines) {
    for (const l of Array.isArray(lines) ? (lines as { componentCode?: string; label?: string; kind?: string }[]) : []) {
      add(l.kind === 'DEDUCTION' ? deductions : earnings, (l.label ?? l.componentCode ?? '').trim());
    }
  }
  return { earnings, deductions };
}

export function toPayslipRow(p: { id: string; period: string; runType: string; workingDays: number; paidDays: number; idleDeductionPaise: number; netPaise: number; grossPaise: number; status: string }): PayslipRow {
  return { id: p.id, period: p.period, month: periodLabel(p.period), runType: p.runType, workingDays: p.workingDays, paidDays: p.paidDays, idleDeductionPaise: p.idleDeductionPaise, netPaise: p.netPaise, grossPaise: p.grossPaise, status: p.status };
}

@Injectable()
export class PayslipService {
  private readonly log = new Logger('Payslips');

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  async myPayslips(fy?: string): Promise<PayslipRow[]> {
    const ctx = requireContext();
    if (!ctx.employeeId) return [];
    return this.forEmployee(ctx.employeeId, fy, true);
  }

  async forEmployee(employeeId: string, fy?: string, publishedOnly = true): Promise<PayslipRow[]> {
    const where: any = { employeeId, status: publishedOnly ? 'PUBLISHED' : { not: 'VOID' } };
    if (fy) {
      const y = Number(fy.slice(0, 4));
      where.OR = [{ periodYear: y, periodMonth: { gte: 4 } }, { periodYear: y + 1, periodMonth: { lte: 3 } }];
    }
    const rows = await this.prisma.payslip.findMany({ where, orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }] });
    return rows.map(toPayslipRow);
  }

  private async access(p: { employeeId: string; status: string }) {
    const ctx = getContext();
    if (!ctx || ctx.permissions.has('*')) return;
    if (ctx.employeeId === p.employeeId) {
      if (p.status !== 'PUBLISHED') throw notFound('Payslip');
      return;
    }
    if (hasPerm(ctx, 'payroll.manage')) {
      await this.audit.record({ action: 'payslip.viewed_by_other', entity: 'Payslip', entityId: (p as any).id });
      return;
    }
    throw forbidden('You can only view your own payslips');
  }

  async detail(id: string): Promise<PayslipDetail> {
    const p = await this.prisma.payslip.findUnique({ where: { id } });
    if (!p) throw notFound('Payslip');
    await this.access(p);
    return this.build(p.id);
  }

  /** Assemble the payslip view (no access check). */
  async build(id: string): Promise<PayslipDetail> {
    const p = await this.prisma.payslip.findUniqueOrThrow({ where: { id } });
    const item = await this.prisma.payrollItem.findUniqueOrThrow({ where: { id: p.itemId }, include: { lines: { orderBy: { order: 'asc' } }, run: true } });
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id: p.employeeId }, include: { department: true, designation: true } });
    const tenant = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: p.tenantId } });
    let panMasked: string | null = null;
    try {
      const pan = this.crypto.decrypt(emp.panEnc);
      panMasked = pan ? `${pan.slice(0, 2)}••••${pan.slice(-4)}` : null;
    } catch {
      panMasked = null;
    }
    // FY-to-date (published payslips of this FY up to and including this period).
    const periods = [...fyPriorPeriods(p.period), p.period];
    const fyItems = await this.prisma.payrollItem.findMany({ where: { employeeId: p.employeeId, status: { in: ['FINALIZED', 'PAID'] }, run: { period: { in: periods }, status: { in: ['FINALIZED', 'PAID'] } } }, select: { grossEarnedPaise: true, tdsPaise: true, pfEePaise: true } });
    const earnings = item.lines.filter((l) => l.kind === 'EARNING').map((l) => ({ label: l.label, fullPaise: l.fullAmountPaise, amountPaise: l.amountPaise }));
    const deductions = item.lines.filter((l) => l.kind === 'DEDUCTION').map((l) => ({ label: l.label, amountPaise: l.amountPaise }));
    const employer = item.lines.filter((l) => l.kind === 'EMPLOYER').map((l) => ({ label: l.label, amountPaise: l.amountPaise }));
    return {
      ...toPayslipRow(p),
      employee: { name: emp.fullName, code: emp.empCode, designation: emp.designation?.name ?? null, department: emp.department?.name ?? null, joiningDate: emp.joiningDate ? dk(emp.joiningDate) : null, panMasked, uan: emp.uan, bankMasked: emp.bankAccountLast4 ? `XXXX XXXX ${emp.bankAccountLast4}` : null, ifsc: emp.bankIfsc },
      company: { name: tenant.legalName ?? tenant.name, address: [tenant.address, tenant.city].filter(Boolean).join(', ') || null, pan: tenant.pan },
      payDate: item.run.paymentDate ? dk(item.run.paymentDate) : null,
      taxRegime: item.taxRegime,
      lopDays: p.lopDays,
      leave: item.leaveLabel,
      idleMinutes: p.idleMinutes,
      earnings,
      deductions,
      employer,
      totalEarningsPaise: earnings.reduce((s, e) => s + e.amountPaise, 0),
      totalDeductionsPaise: deductions.reduce((s, e) => s + e.amountPaise, 0),
      netInWords: rupeesInWords(p.netPaise),
      ytd: { grossPaise: fyItems.reduce((s, i) => s + i.grossEarnedPaise, 0), tdsPaise: fyItems.reduce((s, i) => s + i.tdsPaise, 0), pfPaise: fyItems.reduce((s, i) => s + i.pfEePaise, 0) },
    };
  }

  /** The single design older companies saved (a v3 canvas, a v2 block design, or the settings-style template). */
  private async oldTemplate(): Promise<PayslipTemplate | PayslipDesign | PayslipCanvas> {
    const raw = await this.settings.get<unknown>(OLD_TEMPLATE_KEY, null);
    const version = raw && typeof raw === 'object' ? (raw as { version?: number }).version : undefined;
    if (version === 3) {
      const r = payslipCanvasSchema.safeParse(raw);
      if (r.success) return r.data;
    }
    if (version === 2) {
      const r = payslipDesignSchema.safeParse(raw);
      if (r.success) return r.data;
    }
    const r = payslipTemplateSchema.safeParse(raw ?? {});
    return r.success ? r.data : DEFAULT_PAYSLIP_TEMPLATE;
  }

  private async loadTemplates(): Promise<StoredPayslipTemplates> {
    const saved = await this.settings.get<StoredPayslipTemplates | null>(TEMPLATES_KEY, null);
    // Designs saved before an option existed lack its field; parsing fills the default so editing and the PDF never meet a missing one.
    if (saved?.items?.length) return { items: saved.items.map((t) => ({ ...t, design: payslipCanvasSchema.safeParse(t.design).data ?? t.design })), defaultId: saved.defaultId, byStructure: saved.byStructure ?? {} };
    // First use: the design the company already had becomes "Default", next to the branded starter.
    const t = await this.oldTemplate();
    const design: PayslipCanvas = 'elements' in t ? t : 'blocks' in t ? canvasFromBlockDesign(t) : { ...payslipCanvasPreset(t.layout, t.accentColor), logoMode: t.logoMode, customLogo: t.customLogo };
    return { items: [{ id: 'default', name: 'Default', design }, { id: 'branded', name: 'Branded summary', design: payslipCanvasPreset('BRANDED') }], defaultId: 'default', byStructure: {} };
  }

  private async persistTemplates(v: StoredPayslipTemplates) {
    await this.settings.set(TEMPLATES_KEY, v);
  }

  /** The template a payslip is drawn with: the one set for the employee's salary structure at that time, else the default. */
  private pickTemplate(set: StoredPayslipTemplates, structureId: string | null | undefined): StoredPayslipTemplate {
    const id = structureId ? set.byStructure[structureId] : undefined;
    return set.items.find((t) => t.id === id) ?? set.items.find((t) => t.id === set.defaultId) ?? set.items[0]!;
  }

  private async structureOf(employeeId: string, year: number, month: number): Promise<string | null> {
    const end = new Date(Date.UTC(year, month, 0));
    const sal = await this.prisma.employeeSalary.findFirst({ where: { employeeId, effectiveFrom: { lte: end } }, orderBy: { effectiveFrom: 'desc' }, select: { templateId: true } });
    return sal?.templateId ?? null;
  }

  async templatesView(): Promise<PayslipTemplatesView> {
    const set = await this.loadTemplates();
    const structures = await this.prisma.salaryTemplate.findMany({ where: { active: true }, select: { id: true, name: true, lines: true }, orderBy: { name: 'asc' } });
    const logoBytes = await this.logoFor({ logoMode: 'COMPANY', customLogo: null });
    const isPng = logoBytes?.subarray(0, 4).toString('hex') === '89504e47';
    const isJpg = logoBytes?.subarray(0, 2).toString('hex') === 'ffd8';
    const companyLogo = logoBytes && (isPng || isJpg) ? `data:image/${isPng ? 'png' : 'jpeg'};base64,${logoBytes.toString('base64')}` : null;
    return {
      templates: set.items.map((t): PayslipTemplateDto => ({ id: t.id, name: t.name, isDefault: t.id === set.defaultId, design: t.design })),
      structures: structures.map((st) => ({ id: st.id, name: st.name, templateId: set.byStructure[st.id] && set.items.some((t) => t.id === set.byStructure[st.id]) ? set.byStructure[st.id]! : null })),
      components: componentNames(structures.map((st) => st.lines)),
      companyLogo,
      company: await this.companyInfo(),
    };
  }

  private async companyInfo(): Promise<{ name: string; address: string | null; pan: string | null }> {
    const tenant = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: requireContext().tenantId } });
    return { name: tenant.legalName ?? tenant.name, address: [tenant.address, tenant.city].filter(Boolean).join(', ') || null, pan: tenant.pan };
  }

  async createTemplate(name: string, design: PayslipCanvas): Promise<PayslipTemplatesView> {
    const set = await this.loadTemplates();
    if (set.items.length >= 20) throw badRequest('You can keep up to 20 payslip templates', 'PAYSLIP_TEMPLATE_LIMIT');
    const t = { id: randomBytes(6).toString('hex'), name, design };
    await this.persistTemplates({ ...set, items: [...set.items, t] });
    await this.audit.record({ action: 'payslip.template.created', entity: 'Setting', entityId: t.id, meta: { name, elements: design.elements.length } });
    return this.templatesView();
  }

  async saveTemplate(id: string, name: string, design: PayslipCanvas): Promise<PayslipTemplatesView> {
    const set = await this.loadTemplates();
    if (!set.items.some((t) => t.id === id)) throw notFound('Payslip template');
    await this.persistTemplates({ ...set, items: set.items.map((t) => (t.id === id ? { id, name, design } : t)) });
    await this.audit.record({ action: 'payslip.template.updated', entity: 'Setting', entityId: id, meta: { name, elements: design.elements.length, logoMode: design.logoMode, accentColor: design.accentColor } });
    return this.templatesView();
  }

  async setDefaultTemplate(id: string): Promise<PayslipTemplatesView> {
    const set = await this.loadTemplates();
    if (!set.items.some((t) => t.id === id)) throw notFound('Payslip template');
    await this.persistTemplates({ ...set, defaultId: id });
    await this.audit.record({ action: 'payslip.template.default', entity: 'Setting', entityId: id });
    return this.templatesView();
  }

  async removeTemplate(id: string): Promise<PayslipTemplatesView> {
    const set = await this.loadTemplates();
    if (!set.items.some((t) => t.id === id)) throw notFound('Payslip template');
    if (set.defaultId === id) throw badRequest('Choose another default template before deleting this one', 'PAYSLIP_TEMPLATE_IS_DEFAULT');
    // Salary structures that used it fall back to the default.
    const byStructure = Object.fromEntries(Object.entries(set.byStructure).filter(([, tid]) => tid !== id));
    await this.persistTemplates({ items: set.items.filter((t) => t.id !== id), defaultId: set.defaultId, byStructure });
    await this.audit.record({ action: 'payslip.template.deleted', entity: 'Setting', entityId: id });
    return this.templatesView();
  }

  /** Choose the payslip template one salary structure uses (null = the default template). */
  async assignTemplate(salaryTemplateId: string, templateId: string | null): Promise<PayslipTemplatesView> {
    const set = await this.loadTemplates();
    if (templateId && !set.items.some((t) => t.id === templateId)) throw notFound('Payslip template');
    if (!(await this.prisma.salaryTemplate.findUnique({ where: { id: salaryTemplateId }, select: { id: true } }))) throw notFound('Salary structure');
    const byStructure = { ...set.byStructure };
    if (templateId) byStructure[salaryTemplateId] = templateId;
    else delete byStructure[salaryTemplateId];
    await this.persistTemplates({ ...set, byStructure });
    await this.audit.record({ action: 'payslip.template.assigned', entity: 'SalaryTemplate', entityId: salaryTemplateId, meta: { templateId } });
    return this.templatesView();
  }

  /** The logo bytes the design asks for: the uploaded one, the company logo from Branding, or none. */
  async logoFor(tpl: { logoMode: PayslipTemplate['logoMode']; customLogo: string | null }): Promise<Buffer | null> {
    if (tpl.logoMode === 'CUSTOM') return logoFromDataUrl(tpl.customLogo);
    if (tpl.logoMode !== 'COMPANY') return null;
    const tenantId = requireContext().tenantId;
    const t = await this.prisma.raw.tenant.findUnique({ where: { id: tenantId }, select: { logoFileId: true } });
    if (!t?.logoFileId) return null;
    try {
      return (await this.storage.read(t.logoFileId, tenantId)).data;
    } catch {
      return null;
    }
  }

  render(d: PayslipDetail, tpl: PayslipTemplate | PayslipDesign | PayslipCanvas = DEFAULT_PAYSLIP_TEMPLATE, logo: Buffer | null = null): Promise<Buffer> {
    return renderPayslip(this.pdf, d, tpl, logo);
  }

  /** A sample payslip in the design being edited (nothing is saved). */
  async previewPdf(input: PayslipCanvas): Promise<Buffer> {
    const company = await this.companyInfo();
    return this.render(samplePayslip(company, periodOf(todayKey())), input, await this.logoFor(input));
  }

  fileName(d: { employee: { code: string }; period: string }) {
    return `Payslip-${d.employee.code}-${d.period}.pdf`;
  }

  async pdfFor(id: string): Promise<{ data: Buffer; filename: string }> {
    const p = await this.prisma.payslip.findUnique({ where: { id } });
    if (!p) throw notFound('Payslip');
    await this.access(p);
    const d = await this.build(id);
    if (p.fileId) {
      try {
        const f = await this.storage.read(p.fileId);
        return { data: f.data, filename: this.fileName(d) };
      } catch {
        /* regenerate below */
      }
    }
    const tpl = this.pickTemplate(await this.loadTemplates(), await this.structureOf(p.employeeId, p.periodYear, p.periodMonth));
    return { data: await this.render(d, tpl.design, await this.logoFor(tpl.design)), filename: this.fileName(d) };
  }

  /** Render + store + publish every draft payslip of a run; notify each employee. */
  async publishRun(runId: string): Promise<number> {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const slips = await this.prisma.payslip.findMany({ where: { runId, status: 'DRAFT' }, include: { employee: { select: { userId: true } } } });
    const set = await this.loadTemplates();
    const logos = new Map<string, Buffer | null>();
    let n = 0;
    for (const s of slips) {
      try {
        const d = await this.build(s.id);
        const tpl = this.pickTemplate(set, await this.structureOf(s.employeeId, s.periodYear, s.periodMonth));
        if (!logos.has(tpl.id)) logos.set(tpl.id, await this.logoFor(tpl.design));
        const data = await this.render(d, tpl.design, logos.get(tpl.id) ?? null);
        const file = await this.storage.save({ data, filename: this.fileName(d), mime: 'application/pdf', category: 'payslip', isPrivate: true, tenantId: s.tenantId, ownerUserId: s.employee.userId });
        await this.prisma.payslip.update({ where: { id: s.id }, data: { fileId: file.id, fileSha256: createHash('sha256').update(data).digest('hex'), status: 'PUBLISHED', publishedAt: new Date() } });
        if (s.employee.userId) await this.notifications.notify({ userIds: [s.employee.userId], type: 'payslip.published', title: `Payslip for ${periodLabel(run.period)} is ready`, body: `Net pay ${pdfMoney(s.netPaise).replace('Rs. ', '₹ ').replace(/\.00$/, '')}`, link: '/payslips', from: 'Payroll', email: true });
        n++;
      } catch (e) {
        this.log.error(`Payslip ${s.id} failed: ${(e as Error).message}`);
      }
    }
    return n;
  }
}
