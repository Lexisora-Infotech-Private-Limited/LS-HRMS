import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runWithContext, type RequestContext } from '../../core/context/request-context';
import { cacheRegion } from '../../core/region/region-cache';
import { AppError } from '../../core/http/errors';
import { LedgerService, UK_DEFAULT_FINANCE_SETTINGS } from './ledger.service';
import { InvoiceService } from './invoice.service';
import { UK_CHART_OF_ACCOUNTS } from './lib/coa';

/** UK (region GB) service paths with in-memory fakes. Tenant "uk1" is GB; "t1" stays India. */

const ctx = (tenantId = 'uk1'): RequestContext => ({ tenantId, userId: 'u1', userName: 'Amelia Hart', permissions: new Set(['*']) });
const run = <T>(fn: () => Promise<T>, tenantId = 'uk1') => runWithContext(ctx(tenantId), fn);
const codeOf = (e: unknown) => ((e as AppError).getResponse() as { code: string }).code;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T10:30:00Z'));
  cacheRegion('uk1', 'GB');
});
afterAll(() => {
  vi.useRealTimers();
  cacheRegion('uk1', 'IN');
});

function makeInvoices(opts: { tenantVat?: string | null; country?: string } = {}) {
  let rec: Record<string, unknown> | null = null;
  const prisma = {
    invoice: {
      findFirst: vi.fn(async () => rec),
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        rec = { id: 'inv-new', ...a.data, lines: [{ id: 'line-1' }] };
        return rec;
      }),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => ({ ...rec!, ...a.data })),
      delete: vi.fn(),
    },
    invoiceTimeEntry: { findMany: vi.fn(async () => []), createMany: vi.fn() },
    raw: { tenant: { findUniqueOrThrow: vi.fn(async () => ({ id: 'uk1', name: 'Lexisora UK', legalName: 'Lexisora UK Ltd', gstin: opts.tenantVat === undefined ? 'GB980780684' : opts.tenantVat, stateCode: null, stateName: null, address: '1 King St', city: 'London', pan: null, phone: null })) } },
  };
  const seq = { next: vi.fn(async () => 'INV-0001') };
  const audit = { record: vi.fn(async () => undefined) };
  const ledger = { assertOpen: vi.fn(async () => undefined), financeSettings: vi.fn(async () => UK_DEFAULT_FINANCE_SETTINGS), clientAccount: vi.fn(async () => 'ar-thames'), post: vi.fn(async () => ({ id: 'v1' })) };
  const spine = {
    client: vi.fn(async () => ({ id: 'thames', code: 'TD', name: 'Thames Digital', legalName: 'Thames Digital Ltd', isInternal: false, gstin: null, pan: null, address: '2 Bank St', city: 'London', pincode: 'E14 5AB', stateCode: null, countryCode: opts.country ?? 'GB', billingEmails: ['ap@thames.co.uk'], defaultRatePerHourPaise: 7500, paymentTermsDays: 30, status: 'ACTIVE' })),
    project: vi.fn(async () => null),
    cellSheetStatus: vi.fn(async () => new Map()),
    billableCells: vi.fn(),
  };
  const svc = new InvoiceService(prisma as never, seq as never, audit as never, { emit: vi.fn() } as never, {} as never, {} as never, {} as never, {} as never, ledger as never, {} as never, spine as never);
  (svc as unknown as { detail: unknown }).detail = vi.fn(async () => rec);
  return { svc, prisma, ledger, setRec: (r: Record<string, unknown>) => (rec = r) };
}

const body = { clientId: 'thames', projectId: null, period: '2026-09', billableHours: 160, ratePaise: 7500, gstMode: 'AUTO' as const, overrideReason: null, adjustmentNote: 'Fixed monthly retainer', emailTo: [], emailCc: [], notes: null, action: 'draft' as const };

describe('UK invoices (GB tenant)', () => {
  it('a UK customer is charged 20% VAT, stored in the IGST column; no SAC, no place of supply', async () => {
    const { svc, prisma } = makeInvoices();
    await run(() => svc.create(body));
    const data = prisma.invoice.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ subtotalPaise: 1_200_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 240_000, roundOffPaise: 0, totalPaise: 1_440_000, gstRateBp: 2000, supplyType: 'INTER', placeOfSupply: null });
    expect(data.buyerSnapshot).toMatchObject({ countryCode: 'GB', vatTreatment: 'STANDARD', vatNote: null });
    expect((data.lines as { create: { sac: string }[] }).create[0]!.sac).toBe('');
  });
  it('the picked 5% rate is applied', async () => {
    const { svc, prisma } = makeInvoices();
    await run(() => svc.create({ ...body, vatTreatment: 'REDUCED' }));
    expect(prisma.invoice.create.mock.calls[0]![0].data).toMatchObject({ igstPaise: 60_000, gstRateBp: 500, totalPaise: 1_260_000 });
  });
  it('an overseas business customer is outside the scope (0%) with the reverse-charge note', async () => {
    const { svc, prisma } = makeInvoices({ country: 'US' });
    await run(() => svc.create(body));
    const data = prisma.invoice.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ igstPaise: 0, totalPaise: 1_200_000, gstRateBp: 0 });
    expect((data.buyerSnapshot as { vatNote: string }).vatNote).toContain('Reverse charge: customer to account for VAT');
  });
  it('a company without a VAT number invoices with no VAT and can issue without GSTIN/state', async () => {
    const { svc, prisma, setRec } = makeInvoices({ tenantVat: null });
    await run(() => svc.create(body));
    const data = prisma.invoice.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ igstPaise: 0, totalPaise: 1_200_000 });
    expect((data.buyerSnapshot as { vatTreatment: string }).vatTreatment).toBe('NOT_REGISTERED');
    const internals = svc as unknown as { storePdf: unknown; ensureSalesVoucher: unknown };
    internals.storePdf = vi.fn(async () => ({ id: 'f1' }));
    internals.ensureSalesVoucher = vi.fn(async () => 'sv1');
    setRec({ ...(data as object), id: 'inv1', number: null, status: 'DRAFT', minutes: 9600, lines: [{ timeEntries: [] }] });
    await run(() => svc.issue('inv1'));
    expect(prisma.invoice.update.mock.calls[0]![0].data).toMatchObject({ number: 'INV-0001', status: 'ISSUED' });
  });
  it('the sales voucher posts VAT to the output VAT account (no GST heads)', async () => {
    const { svc, ledger, setRec } = makeInvoices();
    setRec({ id: 'inv1', number: 'INV-0001', status: 'ISSUED', salesVoucherId: null, clientId: 'thames', clientName: 'Thames Digital', projectName: null, period: '2026-09', subtotalPaise: 1_200_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 240_000, roundOffPaise: 0, totalPaise: 1_440_000, invoiceDate: new Date('2026-09-29T00:00:00Z') });
    await run(() => svc.ensureSalesVoucher('inv1'));
    const lines = (ledger.post.mock.calls[0] as unknown as [{ lines: { systemKey?: string; accountId: string; debitPaise?: number; creditPaise?: number }[] }])[0].lines;
    const keys = lines.filter((l) => (l.debitPaise ?? 0) || (l.creditPaise ?? 0)).map((l) => [l.systemKey ?? l.accountId, l.debitPaise ?? 0, l.creditPaise ?? 0]);
    expect(keys).toEqual([
      ['ar-thames', 1_440_000, 0],
      ['SALES_SERVICES', 0, 1_200_000],
      ['VAT_OUTPUT', 0, 240_000],
    ]);
  });
  it('TDS on a payment is refused for UK tenants', async () => {
    const { svc, setRec } = makeInvoices();
    setRec({ id: 'inv1', number: 'INV-0001', status: 'ISSUED', totalPaise: 1_440_000, balancePaise: 1_440_000, invoiceDate: new Date('2026-09-01T00:00:00Z') });
    const e = await run(() => svc.recordPayment('inv1', { date: '2026-09-28', amountPaise: 1_000_000, tdsPaise: 100, mode: 'BANK', reference: null })).catch((x) => x);
    expect(codeOf(e)).toBe('NO_TDS');
  });
});

describe('UK ledger (GB tenant)', () => {
  function makeLedger(items: unknown[] = []) {
    const created: { code: string; name: string; systemKey: string | null }[] = [];
    const posted: unknown[] = [];
    const prisma = {
      account: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async (a: { data: { code: string; name: string; systemKey: string | null } }) => {
          created.push(a.data);
          return { id: `acc-${a.data.code}` };
        }),
      },
      payslip: { count: vi.fn(async () => items.length) },
      payrollItem: { findMany: vi.fn(async () => items) },
    };
    const settings = { get: vi.fn(async (_k: string, d: unknown) => d), set: vi.fn() };
    const ledger = new LedgerService(prisma as never, {} as never, {} as never, {} as never, settings as never);
    (ledger as unknown as { post: unknown }).post = vi.fn(async (p: unknown) => {
      posted.push(p);
      return { id: 'v1', number: 'JV-001' };
    });
    return { ledger, created, posted };
  }

  it('seeds the UK chart (VAT, PAYE/NI, pension accounts) and keeps the shared keys', async () => {
    const { ledger, created } = makeLedger();
    await run(() => ledger.ensureChart());
    expect(created).toHaveLength(UK_CHART_OF_ACCOUNTS.length);
    const keys = created.map((c) => c.systemKey);
    for (const k of ['BANK', 'CASH', 'AR', 'AP', 'SALES_SERVICES', 'ROUND_OFF', 'SALARY_EXPENSE', 'SALARY_PAYABLE', 'REIMB_PAYABLE', 'VAT_OUTPUT', 'VAT_INPUT', 'PAYE_NI_PAYABLE', 'PENSION_PAYABLE', 'EMPLOYER_NI_EXPENSE', 'EMPLOYER_PENSION_EXPENSE']) expect(keys).toContain(k);
    expect(keys.some((k) => k && /^GST_|^PF_|^PT_|^TDS_/.test(k))).toBe(false);
    expect(created.find((c) => c.systemKey === 'BANK')!.name).toBe('Bank current account');
  });
  it('India tenants still get the India chart', async () => {
    const { ledger, created } = makeLedger();
    await run(() => ledger.ensureChart(), 't1');
    expect(created.find((c) => c.systemKey === 'BANK')!.name).toBe('HDFC Current A/c');
    expect(created.some((c) => c.systemKey === 'GST_OUTPUT_IGST')).toBe(true);
  });
  it('payroll.finalized posts the UK journal from the items’ ukStatutory', async () => {
    const items = [{ totalEarningsPaise: 300_000, netPaise: 228_000, tdsPaise: 40_000, ukStatutory: { taxPence: 40_000, niEmployeePence: 15_000, niEmployerPence: 30_000, pensionEmployeePence: 12_000, pensionEmployerPence: 7_200, studentLoanPence: 5_000, postgradLoanPence: 0 } }];
    const { ledger, posted } = makeLedger(items);
    await run(() => ledger.postPayroll({ runId: 'run1', period: '2026-09', totals: { grossPaise: 300_000, netPaise: 228_000, deductionsPaise: 72_000 } }));
    const lines = (posted[0] as { lines: { systemKey: string; debitPaise: number; creditPaise: number }[] }).lines.map((l) => [l.systemKey, l.debitPaise, l.creditPaise]);
    expect(lines).toEqual([
      ['SALARY_EXPENSE', 300_000, 0],
      ['EMPLOYER_NI_EXPENSE', 30_000, 0],
      ['EMPLOYER_PENSION_EXPENSE', 7_200, 0],
      ['PAYE_NI_PAYABLE', 0, 90_000],
      ['PENSION_PAYABLE', 0, 19_200],
      ['SALARY_PAYABLE', 0, 228_000],
    ]);
  });
});
