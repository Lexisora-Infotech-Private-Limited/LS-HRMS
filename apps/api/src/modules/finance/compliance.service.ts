import { Injectable } from '@nestjs/common';
import { finMonthLabel, istDateKey, type FinComplianceItem, type FinGstReturnRow, type FinMarkFiledInput } from '@lexisora/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SettingsService } from '../../core/settings/settings.service';
import { AuditService } from '../../core/audit/audit.service';
import { requireContext } from '../../core/context/request-context';
import { badRequest } from '../../core/http/errors';
import { PurchaseService } from './purchase.service';
import { complianceCalendar, filingKey, gstReturnStatus, type ComplianceFiling } from './lib/compliance';
import { currentMonthKey, recentMonths } from './lib/money';

export const COMPLIANCE_SETTINGS_KEY = 'finance.compliance';
export type ComplianceSettings = { filings: Record<string, ComplianceFiling> };

/** Filing cabinet header: statutory compliance calendar + GST returns register (GSTR-1 / GSTR-3B). */
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
    return complianceCalendar(istDateKey(), await this.filings());
  }

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
