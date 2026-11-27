import { Body, Controller, Get, HttpCode, Injectable, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { PayrollItem, PayrollRun } from '@prisma/client';
import {
  formatSortCode,
  maskNiNumber,
  taxMonthOfPeriod,
  taxYearLabel,
  taxYearStartOfPeriod,
  ukPayrollProfileSchema,
  updateUkPayrollSchema,
  type UkFpsSummary,
  type UkPayrollProfile,
  type UkStatutory,
  type UpdateUkPayrollInput,
} from '@lexisora/shared';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { requireContext } from '../../../../core/context/request-context';
import { AppError, notFound } from '../../../../core/http/errors';
import { AuditService } from '../../../../core/audit/audit.service';
import { CryptoService } from '../../../../core/crypto/crypto.service';
import { NotificationsService } from '../../../../core/notifications/notifications.service';
import { SettingsService } from '../../../../core/settings/settings.service';
import { RequirePerm } from '../../../../core/auth/decorators';
import { ZodPipe } from '../../../../core/http/zod.pipe';
import { currentRegion } from '../../../../core/region/region-cache';
import { dk, monthBounds, periodLabel } from '../../common/dates';
import { UK_RATES_SETTING } from '../payroll-engine.service';
import { defaultUkRates, ukRatesFor } from './uk-rates';
import { clearPayrollPreview } from '../payroll.service';

const FPS_SETTING = 'payroll.uk.fps';
type FpsLog = Record<string, UkFpsSummary['submission']>;

export type UkProfileView = {
  employeeId: string;
  name: string;
  profile: UkPayrollProfile | null;
  niNumberMasked: string;
  hasNiNumber: boolean;
  sortCode: string;
  accountLast4: string | null;
  dateOfBirth: string | null;
};

const nextPeriod = (p: string) => {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * UK-only payroll pieces (region GB): employee PAYE/NI/pension details, the editable rates
 * table, the UK bank payment file, pension enrolment on finalise and the HMRC Full Payment
 * Submission export. Real-time submission to HMRC needs HMRC credentials and recognised
 * software; until then submissions are recorded as STUB_ACCEPTED (like the other adapters).
 */
@Injectable()
export class UkPayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  assertUk() {
    if (currentRegion() !== 'GB') throw new AppError(403, 'NOT_UK', 'This is only available when the company region is United Kingdom (Admin → Region & compliance).');
  }

  // ── employee details ──────────────────────────────────────────────────

  async profile(employeeId: string): Promise<UkProfileView> {
    this.assertUk();
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, include: { leavepayPayrollProfile: true } });
    if (!e) throw notFound('Employee');
    const parsed = ukPayrollProfileSchema.safeParse(e.leavepayPayrollProfile?.ukProfile ?? null);
    return {
      employeeId: e.id,
      name: e.fullName,
      profile: parsed.success ? parsed.data : null,
      niNumberMasked: maskNiNumber(e.niNumberLast4),
      hasNiNumber: !!e.niNumberEnc,
      sortCode: formatSortCode(e.bankSortCode),
      accountLast4: e.bankAccountLast4,
      dateOfBirth: e.dateOfBirth ? dk(e.dateOfBirth) : null,
    };
  }

  async updateProfile(employeeId: string, input: z.infer<typeof updateUkPayrollSchema>): Promise<UkProfileView> {
    this.assertUk();
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, include: { leavepayPayrollProfile: true } });
    if (!e) throw notFound('Employee');
    const { niNumber, sortCode, ...rest } = input;
    const profile = ukPayrollProfileSchema.parse(rest);
    const empData: Record<string, unknown> = {};
    if (niNumber !== undefined) {
      empData.niNumberEnc = niNumber ? this.crypto.encrypt(niNumber) : null;
      empData.niNumberLast4 = niNumber ? niNumber.slice(-4) : null;
    }
    if (sortCode !== undefined) empData.bankSortCode = sortCode || null;
    if (Object.keys(empData).length) await this.prisma.employee.update({ where: { id: employeeId }, data: empData });
    if (e.leavepayPayrollProfile) await this.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { ukProfile: profile as object } });
    else await this.prisma.employeePayrollProfile.create({ data: { employeeId, pfEnabled: false, ukProfile: profile as object } as any });
    // Calculated (not finalised) runs need a re-run for this person.
    const runs = await this.prisma.payrollRun.findMany({ where: { status: 'CALCULATED' }, select: { id: true } });
    if (runs.length) await this.prisma.payrollItem.updateMany({ where: { runId: { in: runs.map((r) => r.id) }, employeeId, status: { not: 'EXCLUDED' } }, data: { status: 'STALE' } });
    clearPayrollPreview();
    await this.audit.record({ action: 'payroll.uk.profile.updated', entity: 'Employee', entityId: employeeId, meta: { taxCode: profile.taxCode, niCategory: profile.niCategory, niNumberChanged: niNumber !== undefined } });
    return this.profile(employeeId);
  }

  // ── rates ─────────────────────────────────────────────────────────────

  async rates(taxYear: number) {
    this.assertUk();
    const overrides = await this.settings.get<Record<string, unknown>>(UK_RATES_SETTING, {});
    return {
      taxYear,
      label: taxYearLabel(taxYear, 'GB'),
      effective: ukRatesFor(taxYear, overrides),
      defaults: defaultUkRates(taxYear),
      overrides: (overrides as Record<string, unknown>)[String(taxYear)] ?? null,
    };
  }

  async setRates(taxYear: number, overrides: Record<string, unknown> | null) {
    this.assertUk();
    const all = { ...(await this.settings.get<Record<string, unknown>>(UK_RATES_SETTING, {})) };
    if (overrides && Object.keys(overrides).length) all[String(taxYear)] = overrides;
    else delete all[String(taxYear)];
    await this.settings.set(UK_RATES_SETTING, all);
    clearPayrollPreview();
    await this.audit.record({ action: 'payroll.uk.rates.updated', entity: 'Setting', entityId: UK_RATES_SETTING, meta: { taxYear, keys: overrides ? Object.keys(overrides) : [] } });
    return this.rates(taxYear);
  }

  // ── pay run hooks (called by PayrollService for GB tenants) ───────────

  /** UK bank payment file (CSV for bulk payment upload): payee, sort code, account, amount, reference. */
  bankCsv(run: PayrollRun, items: (PayrollItem & { employee: { id: string; fullName: string; empCode: string; bankAccountEnc: string | null; bankSortCode: string | null; leavepayPayrollProfile: { paymentMode: string } | null } })[]) {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = ['Payee name,Sort code,Account number,Amount,Reference,Payment date,Employee ID'];
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
      if (!acct || !e.bankSortCode) {
        excluded.push({ employeeId: e.id, name: e.fullName, reason: 'Missing sort code or account number' });
        continue;
      }
      total += i.netPaise;
      // Bank references are limited to 18 characters on BACS.
      lines.push([e.fullName, formatSortCode(e.bankSortCode), acct, (i.netPaise / 100).toFixed(2), `PAY ${run.period}`.slice(0, 18), run.paymentDate ? dk(run.paymentDate) : '', e.empCode].map(esc).join(','));
    }
    return { lines, excluded, total };
  }

  /** After finalising: record automatic enrolments and write the statutory enrolment notice. */
  async afterFinalize(run: PayrollRun, finals: PayrollItem[]) {
    const enrolled = finals.filter((i) => (i.ukStatutory as UkStatutory | null)?.aeAction === 'ENROLLED');
    if (!enrolled.length) return;
    const end = monthBounds(run.period).end;
    for (const i of enrolled) {
      const prof = await this.prisma.employeePayrollProfile.findUnique({ where: { employeeId: i.employeeId } });
      const parsed = ukPayrollProfileSchema.safeParse(prof?.ukProfile ?? null);
      if (!prof || !parsed.success || parsed.data.pension.status === 'ENROLLED') continue;
      const next = { ...parsed.data, pension: { ...parsed.data.pension, status: 'ENROLLED' as const, enrolledOn: end } };
      await this.prisma.employeePayrollProfile.update({ where: { employeeId: i.employeeId }, data: { ukProfile: next as object } });
      const userIds = await this.notifications.usersForEmployees([i.employeeId]);
      await this.notifications.notify({
        userIds,
        type: 'payroll.pension.enrolled',
        title: 'You have been enrolled in the workplace pension',
        body: `From ${periodLabel(run.period)} pay. You can opt out within one month and get back what you paid in — ask HR. Contributions: you ${parsed.data.pension.employeePct}%, employer ${parsed.data.pension.employerPct}%.`,
        link: '/payslips',
        from: 'Payroll',
      });
    }
    await this.audit.record({ action: 'payroll.uk.pension.enrolled', entity: 'PayrollRun', entityId: run.id, meta: { employees: enrolled.length } });
  }

  // ── HMRC Full Payment Submission ──────────────────────────────────────

  private async loadRun(id: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw notFound('Payroll run');
    if (!['FINALIZED', 'PAID'].includes(run.status)) throw new AppError(409, 'RUN_STATE', 'Finalise the pay run before sending the FPS');
    return run;
  }

  async fps(runId: string): Promise<UkFpsSummary> {
    this.assertUk();
    const run = await this.loadRun(runId);
    const items = await this.prisma.payrollItem.findMany({ where: { runId, status: { in: ['FINALIZED', 'PAID'] } } });
    const t = { taxablePayPence: 0, taxPence: 0, niEmployeePence: 0, niEmployerPence: 0, studentLoanPence: 0, postgradLoanPence: 0, statutoryPayPence: 0 };
    for (const i of items) {
      const u = i.ukStatutory as UkStatutory | null;
      if (!u) continue;
      t.taxablePayPence += u.taxablePayPence;
      t.taxPence += u.taxPence;
      t.niEmployeePence += u.niEmployeePence;
      t.niEmployerPence += u.niEmployerPence;
      t.studentLoanPence += u.studentLoanPence;
      t.postgradLoanPence += u.postgradLoanPence;
      t.statutoryPayPence += u.statutoryPay.reduce((s, x) => s + x.amountPence, 0);
    }
    const log = await this.settings.get<FpsLog>(FPS_SETTING, {});
    return {
      runId,
      period: run.period,
      taxYear: taxYearStartOfPeriod(run.period),
      taxMonth: taxMonthOfPeriod(run.period),
      paymentDate: run.paymentDate ? dk(run.paymentDate) : monthBounds(run.period).end,
      employees: items.length,
      totals: t,
      dueToHmrcPence: t.taxPence + t.niEmployeePence + t.niEmployerPence + t.studentLoanPence + t.postgradLoanPence,
      payHmrcBy: `${nextPeriod(run.period)}-22`,
      submission: log[runId] ?? { status: 'NOT_SUBMITTED', at: null, reference: null, note: 'Not sent yet. Send on or before payday.' },
    };
  }

  /** Per-employee FPS data as CSV (for HMRC-recognised filing software or a payroll bureau). */
  async fpsCsv(runId: string): Promise<{ data: Buffer; filename: string }> {
    this.assertUk();
    const run = await this.loadRun(runId);
    const items = await this.prisma.payrollItem.findMany({
      where: { runId, status: { in: ['FINALIZED', 'PAID'] } },
      include: { employee: { select: { empCode: true, firstName: true, lastName: true, niNumberEnc: true, dateOfBirth: true, gender: true, joiningDate: true, exitDate: true, leavepayPayrollProfile: { select: { ukProfile: true } } } } },
      orderBy: { employee: { fullName: 'asc' } },
    });
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const p = (n: number) => (n / 100).toFixed(2);
    const head = ['Payroll ID', 'Surname', 'Forenames', 'NI number', 'Date of birth', 'Gender', 'Start date', 'Leaving date', 'Starter statement', 'Tax code', 'Week1/Month1', 'NI category', 'Payment date', 'Tax month', 'Taxable pay', 'Tax deducted', 'Taxable pay YTD', 'Tax YTD', 'NIable pay', 'Employee NI', 'Employer NI', 'Student loan', 'Student loan plans', 'Postgraduate loan', 'Statutory pay', 'Pension employee', 'Pension employer', 'Net pay'];
    const lines = [head.join(',')];
    for (const i of items) {
      const u = i.ukStatutory as UkStatutory | null;
      if (!u) continue;
      const e = i.employee;
      const prof = ukPayrollProfileSchema.safeParse(e.leavepayPayrollProfile?.ukProfile ?? null);
      let ni = '';
      try {
        ni = e.niNumberEnc ? this.crypto.decrypt(e.niNumberEnc) ?? '' : '';
      } catch {
        ni = '';
      }
      lines.push(
        [
          e.empCode,
          e.lastName,
          e.firstName,
          ni,
          e.dateOfBirth ? dk(e.dateOfBirth) : '',
          e.gender ?? '',
          e.joiningDate ? dk(e.joiningDate) : '',
          e.exitDate && dk(e.exitDate) <= monthBounds(run.period).end ? dk(e.exitDate) : '',
          prof.success ? (prof.data.starterStatement ?? '') : '',
          u.taxCode,
          u.taxBasis === 'NON_CUMULATIVE' ? 'Y' : '',
          u.niCategory,
          run.paymentDate ? dk(run.paymentDate) : monthBounds(run.period).end,
          String(u.taxMonth),
          p(u.taxablePayPence),
          p(u.taxPence),
          p(u.taxablePayYtdPence),
          p(u.taxYtdPence),
          p(u.niablePayPence),
          p(u.niEmployeePence),
          p(u.niEmployerPence),
          p(u.studentLoanPence),
          prof.success ? prof.data.studentLoanPlans.join(' ') : '',
          p(u.postgradLoanPence),
          p(u.statutoryPay.reduce((s, x) => s + x.amountPence, 0)),
          p(u.pensionEmployeePence),
          p(u.pensionEmployerPence),
          p(i.netPaise),
        ]
          .map(esc)
          .join(','),
      );
    }
    await this.audit.record({ action: 'payroll.uk.fps.exported', entity: 'PayrollRun', entityId: runId, meta: { employees: lines.length - 1 } });
    return { data: Buffer.from(lines.join('\r\n') + '\r\n', 'utf8'), filename: `FPS-${run.period}-${run.runNo}.csv` };
  }

  /** Record the FPS as sent. Without HMRC credentials this is a stub acceptance. */
  async submitFps(runId: string): Promise<UkFpsSummary> {
    this.assertUk();
    await this.loadRun(runId);
    const log = { ...(await this.settings.get<FpsLog>(FPS_SETTING, {})) };
    const at = new Date().toISOString();
    log[runId] = {
      status: 'STUB_ACCEPTED',
      at,
      reference: `STUB-${runId.slice(-6).toUpperCase()}-${at.slice(0, 10).replace(/-/g, '')}`,
      note: 'Recorded in Lexisora. Live sending to HMRC needs the company’s HMRC Government Gateway credentials and an RTI connection; until then upload the FPS file with HMRC-recognised software.',
    };
    await this.settings.set(FPS_SETTING, log);
    await this.audit.record({ action: 'payroll.uk.fps.submitted', entity: 'PayrollRun', entityId: runId, meta: { mode: 'stub', by: requireContext().userName ?? null } });
    return this.fps(runId);
  }
}

const ratesBody = z.object({ taxYear: z.number().int().min(2020).max(2100), overrides: z.record(z.unknown()).nullable() });

function send(res: Response, data: Buffer, filename: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(data);
}

@Controller('payroll/uk')
@RequirePerm('payroll.manage')
export class UkPayrollController {
  constructor(private readonly uk: UkPayrollService) {}

  @Get('profile/:employeeId')
  profile(@Param('employeeId') employeeId: string) {
    return this.uk.profile(employeeId);
  }

  @Patch('profile/:employeeId')
  updateProfile(@Param('employeeId') employeeId: string, @Body(new ZodPipe(updateUkPayrollSchema)) dto: UpdateUkPayrollInput) {
    return this.uk.updateProfile(employeeId, dto as z.infer<typeof updateUkPayrollSchema>);
  }

  @Get('rates')
  rates(@Query('taxYear') taxYear?: string) {
    const y = Number(taxYear) || taxYearStartOfPeriod(new Date().toISOString().slice(0, 7));
    return this.uk.rates(y);
  }

  @Put('rates')
  setRates(@Body(new ZodPipe(ratesBody)) dto: z.infer<typeof ratesBody>) {
    return this.uk.setRates(dto.taxYear, dto.overrides as Record<string, unknown> | null);
  }

  @Get('runs/:id/fps')
  fps(@Param('id') id: string) {
    return this.uk.fps(id);
  }

  @Get('runs/:id/fps.csv')
  async fpsCsv(@Param('id') id: string, @Res() res: Response) {
    const f = await this.uk.fpsCsv(id);
    send(res, f.data, f.filename);
  }

  @Post('runs/:id/fps/submit')
  @HttpCode(200)
  submitFps(@Param('id') id: string) {
    return this.uk.submitFps(id);
  }
}
