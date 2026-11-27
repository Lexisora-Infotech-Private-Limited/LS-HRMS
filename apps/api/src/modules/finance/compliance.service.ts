import { Injectable } from '@nestjs/common';
import { finMonthLabel, istDateKey, ukVatQuarterOf, type FinComplianceItem, type FinGstReturnRow, type FinMarkFiledInput, type FinVatReturnRow } from '@lexisora/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SettingsService } from '../../core/settings/settings.service';
import { AuditService } from '../../core/audit/audit.service';
import { requireContext } from '../../core/context/request-context';
import { badRequest } from '../../core/http/errors';
import { currentRegion } from '../../core/region/region-cache';
import { PurchaseService } from './purchase.service';
import { complianceCalendar, filingKey, gstReturnStatus, type ComplianceFiling } from './lib/compliance';
import { ukComplianceCalendar, ukVatReturnStatus } from './lib/compliance-uk';
import { currentMonthKey, recentMonths } from './lib/money';

export const COMPLIANCE_SETTINGS_KEY = 'finance.compliance';
/** UK (GB) calendar settings: VAT quarter stagger, company year end, confirmation statement review date. */
export type UkComplianceSettings = { vatStaggerEndMonth?: number; yearEndMonth?: number; yearEndDay?: number; confirmationMonth?: number | null; confirmationDay?: number | null };
export type ComplianceSettings = { filings: Record<string, ComplianceFiling>; uk?: UkComplianceSettings };

/** Filing cabinet header: statutory compliance calendar + GST returns register (GSTR-1 / GSTR-3B); UK: VAT returns. */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly purchases: PurchaseService,
  ) {}

  private async filings(): Promise<Record<string, ComplianceFiling>> {
    const s = await this.settings.get<ComplianceSettings>(COMPLIANCE_SETTINGS_KEY, { filings: {} });
    return s.filings ?? {};
  }

  async calendar(): Promise<FinComplianceItem[]> {
    if (currentRegion() === 'GB') return this.ukCalendar();
    return complianceCalendar(istDateKey(), await this.filings());
  }

  // ── UK (GB) ──────────────────────────────────────────────────────────────

  async ukSettings(): Promise<Required<Pick<UkComplianceSettings, 'vatStaggerEndMonth' | 'yearEndMonth' | 'yearEndDay'>> & { confirmationMonth: number | null; confirmationDay: number | null }> {
    const s = await this.settings.get<ComplianceSettings>(COMPLIANCE_SETTINGS_KEY, { filings: {} });
    const u = s.uk ?? {};
    return { vatStaggerEndMonth: u.vatStaggerEndMonth ?? 3, yearEndMonth: u.yearEndMonth ?? 3, yearEndDay: u.yearEndDay ?? 31, confirmationMonth: u.confirmationMonth ?? null, confirmationDay: u.confirmationDay ?? null };
  }

  async setUkSettings(input: UkComplianceSettings) {
    const s = await this.settings.get<ComplianceSettings>(COMPLIANCE_SETTINGS_KEY, { filings: {} });
    const uk = { ...(s.uk ?? {}), ...input };
    await this.settings.set(COMPLIANCE_SETTINGS_KEY, { ...s, filings: s.filings ?? {}, uk });
    await this.audit.record({ action: 'compliance.uk_settings', entity: 'Compliance', meta: { ...input } });
    return this.ukSettings();
  }

  private async ukCalendar(): Promise<FinComplianceItem[]> {
    const [u, filings, tenant] = await Promise.all([this.ukSettings(), this.filings(), this.prisma.raw.tenant.findUnique({ where: { id: requireContext().tenantId }, select: { gstin: true } })]);
    return ukComplianceCalendar(istDateKey(), filings, {
      vatStaggerEndMonth: u.vatStaggerEndMonth,
      yearEnd: { month: u.yearEndMonth, day: u.yearEndDay },
      confirmationDate: u.confirmationMonth && u.confirmationDay ? { month: u.confirmationMonth, day: u.confirmationDay } : undefined,
      vatRegistered: !!tenant?.gstin?.trim(),
    });
  }

  /** VAT returns register: the last `quarters` VAT quarters (current quarter first, "Open"). */
  async vatReturns(quarters = 4): Promise<FinVatReturnRow[]> {
    const today = istDateKey();
    const [filings, u] = await Promise.all([this.filings(), this.ukSettings()]);
    const periods: string[] = [];
    for (const m of recentMonths(currentMonthKey(), quarters * 3 + 2)) {
      const q = ukVatQuarterOf(m, u.vatStaggerEndMonth).period;
      if (!periods.includes(q)) periods.push(q);
    }
    const keep = periods.slice(0, quarters);
    const docs = await this.prisma.filingDocument.findMany({ where: { linkedEntityType: 'VAT_RETURN', linkedEntityId: { in: keep.map((p) => `VAT:${p}`) }, deletedAt: null }, select: { id: true, linkedEntityId: true } });
    const docBy = new Map(docs.map((d) => [d.linkedEntityId, d.id]));
    const rows: FinVatReturnRow[] = [];
    for (const p of keep) {
      const r = await this.purchases.vatReturn(p);
      rows.push({
        period: r.period,
        periodLabel: r.periodLabel,
        start: r.start,
        end: r.end,
        box1: r.boxes.box1,
        box4: r.boxes.box4,
        box5: r.boxes.box5,
        netPence: r.netPence,
        box6: r.boxes.box6,
        invoices: r.invoices,
        bills: r.bills,
        status: ukVatReturnStatus(r.period, today, filings),
        workingDocumentId: docBy.get(`VAT:${p}`) ?? null,
      });
    }
    return rows;
  }

  // ── Filed marks ──────────────────────────────────────────────────────────

  async markFiled(input: FinMarkFiledInput) {
    if (input.filedOn > istDateKey()) throw badRequest('Filing date cannot be in the future');
    const s = await this.settings.get<ComplianceSettings>(COMPLIANCE_SETTINGS_KEY, { filings: {} });
    const key = filingKey(input.form, input.period);
    const filings = { ...(s.filings ?? {}), [key]: { ref: input.ref?.trim() || null, filedOn: input.filedOn, by: requireContext().userName ?? null } };
    await this.settings.set(COMPLIANCE_SETTINGS_KEY, { ...s, filings });
    await this.audit.record({ action: 'compliance.filed', entity: 'Compliance', entityId: key, meta: { ...input } });
    return { key, ...filings[key] };
  }

  async unmarkFiled(form: FinMarkFiledInput['form'], period: string) {
    const s = await this.settings.get<ComplianceSettings>(COMPLIANCE_SETTINGS_KEY, { filings: {} });
    const key = filingKey(form, period);
    const filings = { ...(s.filings ?? {}) };
    delete filings[key];
    await this.settings.set(COMPLIANCE_SETTINGS_KEY, { ...s, filings });
    await this.audit.record({ action: 'compliance.unfiled', entity: 'Compliance', entityId: key });
    return { ok: true };
  }

  /** GST returns register: last `months` return periods (current month first, "Open"). */
  async gstReturns(months = 6): Promise<FinGstReturnRow[]> {
    const today = istDateKey();
    const filings = await this.filings();
    const periods = recentMonths(currentMonthKey(), months);
    const docs = await this.prisma.filingDocument.findMany({
      where: { linkedEntityType: 'GST_RETURN', linkedEntityId: { in: periods.map((p) => `GSTR3B:${p}`) }, deletedAt: null },
      select: { id: true, linkedEntityId: true },
    });
    const docBy = new Map(docs.map((d) => [d.linkedEntityId, d.id]));
    const rows: FinGstReturnRow[] = [];
    for (const p of periods) {
      const s = await this.purchases.gstr3b(p);
      const out = s.outward.igstPaise + s.outward.cgstPaise + s.outward.sgstPaise;
      rows.push({
        period: p,
        periodLabel: finMonthLabel(p),
        taxablePaise: s.outward.taxablePaise,
        outputTaxPaise: out,
        itcPaise: s.itc.totalPaise,
        netPayablePaise: s.payable.totalPaise,
        invoices: s.outward.invoices,
        bills: s.itc.bills,
        gstr1: gstReturnStatus('GSTR1', p, today, filings),
        gstr3b: gstReturnStatus('GSTR3B', p, today, filings),
        workingDocumentId: docBy.get(`GSTR3B:${p}`) ?? null,
      });
    }
    return rows;
  }
}
