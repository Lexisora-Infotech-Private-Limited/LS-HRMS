import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PayslipDetail, PayslipRow } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { getContext, requireContext } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { forbidden, notFound } from '../../../core/http/errors';
import { AuditService } from '../../../core/audit/audit.service';
import { CryptoService } from '../../../core/crypto/crypto.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PdfService, PDF_COLORS } from '../../../core/pdf/pdf.service';
import { StorageService } from '../../../core/storage/storage.service';
import { dk, fyPriorPeriods, periodLabel } from '../common/dates';
import { rupeesInWords } from './num-words';
import { fmtHm } from './payroll-calc';

/** "Rs. 78,420.00" — built-in PDF fonts have no ₹ glyph. */
export const pdfMoney = (paise: number) => `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

  render(d: PayslipDetail): Promise<Buffer> {
    return this.pdf.render((doc) => {
      this.pdf.header(doc, d.company.name, `Payslip · ${periodLabel(d.period, true)}`);
      if (d.company.address) doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(d.company.address).moveDown(0.8);
      doc.fillColor(PDF_COLORS.ink);
      const left = doc.page.margins.left;
      const half = (doc.page.width - left - doc.page.margins.right) / 2;
      const top = doc.y;
      const kv = (rows: [string, string][], x: number) => {
        let y = top;
        for (const [k, v] of rows) {
          doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(k, x, y, { width: 95 });
          doc.font('Helvetica').fontSize(9.5).fillColor(PDF_COLORS.ink).text(v, x + 95, y, { width: half - 105 });
          y += 15;
        }
        return y;
      };
      const y1 = kv(
        [
          ['Employee', d.employee.name],
          ['Employee ID', d.employee.code],
          ['Designation', d.employee.designation ?? '—'],
          ['Department', d.employee.department ?? '—'],
          ['Date of joining', d.employee.joiningDate ?? '—'],
          ['PAN', d.employee.panMasked ?? '—'],
          ['UAN', d.employee.uan ?? '—'],
        ],
        left,
      );
      const y2 = kv(
        [
          ['Pay period', periodLabel(d.period, true)],
          ['Pay date', d.payDate ?? '—'],
          ['Working days', String(d.workingDays)],
          ['Paid days', String(d.paidDays)],
          ['LOP days', String(d.lopDays)],
          ['Leave', d.leave],
          ['Bank account', d.employee.bankMasked ? `${d.employee.bankMasked}${d.employee.ifsc ? ` · ${d.employee.ifsc}` : ''}` : '—'],
        ],
        left + half,
      );
      doc.y = Math.max(y1, y2) + 12;
      doc.x = left;
      this.pdf.table(doc, ['Earnings', 'Full month', 'Earned'], [...d.earnings.map((e) => [e.label, e.fullPaise !== null ? pdfMoney(e.fullPaise) : '', pdfMoney(e.amountPaise)]), ['Total earnings', '', pdfMoney(d.totalEarningsPaise)]], [0.5, 0.25, 0.25], [1, 2]);
      this.pdf.table(doc, ['Deductions', 'Amount'], [...(d.deductions.length ? d.deductions.map((e) => [e.label, pdfMoney(e.amountPaise)]) : [['No deductions', pdfMoney(0)]]), ['Total deductions', pdfMoney(d.totalDeductionsPaise)]], [0.75, 0.25], [1]);
      doc.font('Times-Bold').fontSize(16).fillColor(PDF_COLORS.ink).text(`Net pay  ${pdfMoney(d.netPaise)}`, left);
      doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text(d.netInWords);
      doc.moveDown(0.8);
      if (d.idleMinutes > 0) doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(`Deducted idle time this month: ${fmtHm(d.idleMinutes)} (monthly allowance applied before any deduction).`);
      if (d.employer.length) doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted).text(`Employer contributions (not part of net pay): ${d.employer.map((e) => `${e.label} ${pdfMoney(e.amountPaise)}`).join(' · ')}`);
      doc.text(`Year to date: gross ${pdfMoney(d.ytd.grossPaise)} · TDS ${pdfMoney(d.ytd.tdsPaise)} · PF ${pdfMoney(d.ytd.pfPaise)}${d.taxRegime ? ` · ${d.taxRegime === 'NEW' ? 'New' : 'Old'} tax regime` : ''}`);
      doc.moveDown(2);
      doc.font('Helvetica').fontSize(7.5).fillColor(PDF_COLORS.muted).text('This is a computer-generated payslip and does not require a signature.', { align: 'center' });
    });
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
    return { data: await this.render(d), filename: this.fileName(d) };
  }

  /** Render + store + publish every draft payslip of a run; notify each employee. */
  async publishRun(runId: string): Promise<number> {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const slips = await this.prisma.payslip.findMany({ where: { runId, status: 'DRAFT' }, include: { employee: { select: { userId: true } } } });
    let n = 0;
    for (const s of slips) {
      try {
        const d = await this.build(s.id);
        const data = await this.render(d);
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
