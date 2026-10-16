import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DEFAULT_PAYSLIP_TEMPLATE, canvasFromBlockDesign, payslipCanvasPreset, payslipCanvasSchema, payslipDesignSchema, payslipTemplateSchema, type PayslipCanvas, type PayslipDesign, type PayslipDetail, type PayslipRow, type PayslipTemplate } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { getContext, requireContext } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { forbidden, notFound } from '../../../core/http/errors';
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

const TEMPLATE_KEY = 'payroll.payslipTemplate';

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

  /**
   * The company's stored design: a v3 canvas design, a v2 block design, or the older settings-style template (also the
   * default until they customise). Payslips keep rendering with whichever is stored, so nothing changes until a company
   * saves a new design.
   */
  async template(): Promise<PayslipTemplate | PayslipDesign | PayslipCanvas> {
    const raw = await this.settings.get<unknown>(TEMPLATE_KEY, null);
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

  /** The design for the editor, always as a canvas. `legacy` = still an older design (the editor starts from its closest template). */
  async designView(): Promise<{ design: PayslipCanvas; legacy: boolean; companyLogo: string | null; company: { name: string; address: string | null; pan: string | null } }> {
    const t = await this.template();
    const design = 'elements' in t ? t : 'blocks' in t ? canvasFromBlockDesign(t) : payslipCanvasPreset(t.layout, t.accentColor);
    const logoBytes = await this.logoFor({ logoMode: 'COMPANY', customLogo: null });
    const isPng = logoBytes?.subarray(0, 4).toString('hex') === '89504e47';
    const isJpg = logoBytes?.subarray(0, 2).toString('hex') === 'ffd8';
    const companyLogo = logoBytes && (isPng || isJpg) ? `data:image/${isPng ? 'png' : 'jpeg'};base64,${logoBytes.toString('base64')}` : null;
    return { design: !('elements' in t) && !('blocks' in t) ? { ...design, logoMode: t.logoMode, customLogo: t.customLogo } : design, legacy: !('elements' in t), companyLogo, company: await this.companyInfo() };
  }

  private async companyInfo(): Promise<{ name: string; address: string | null; pan: string | null }> {
    const tenant = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: requireContext().tenantId } });
    return { name: tenant.legalName ?? tenant.name, address: [tenant.address, tenant.city].filter(Boolean).join(', ') || null, pan: tenant.pan };
  }

  async saveTemplate(input: PayslipCanvas) {
    await this.settings.set(TEMPLATE_KEY, input);
    await this.audit.record({ action: 'payslip.template.updated', entity: 'Setting', entityId: TEMPLATE_KEY, meta: { version: 3, elements: input.elements.length, logoMode: input.logoMode, accentColor: input.accentColor } });
    return this.designView();
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
    const tpl = await this.template();
    return { data: await this.render(d, tpl, await this.logoFor(tpl)), filename: this.fileName(d) };
  }

  /** Render + store + publish every draft payslip of a run; notify each employee. */
  async publishRun(runId: string): Promise<number> {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const slips = await this.prisma.payslip.findMany({ where: { runId, status: 'DRAFT' }, include: { employee: { select: { userId: true } } } });
    const tpl = await this.template();
    const logo = await this.logoFor(tpl);
    let n = 0;
    for (const s of slips) {
      try {
        const d = await this.build(s.id);
        const data = await this.render(d, tpl, logo);
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
