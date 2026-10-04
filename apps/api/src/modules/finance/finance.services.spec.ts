import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithContext, type RequestContext } from '../../core/context/request-context';
import { AppError } from '../../core/http/errors';
import { DEFAULT_FINANCE_SETTINGS, LedgerService } from './ledger.service';
import { InvoiceService } from './invoice.service';

/**
 * Service-level rules with in-memory fakes (no database): invoice numbers are assigned only at
 * issue, drafts never consume a number, Σ debit = Σ credit is enforced before a voucher number
 * is taken, voucher series/financial-year numbering, locked periods and the HR-voucher scope.
 */

const ctx = (perms: string[] = ['*']): RequestContext => ({ tenantId: 't1', userId: 'u1', userName: 'Rohit Verma', permissions: new Set(perms) });
const run = <T>(fn: () => Promise<T>, perms?: string[]) => runWithContext(ctx(perms), fn);
const codeOf = (e: unknown) => ((e as AppError).getResponse() as { code: string }).code;
const statusOf = (e: unknown) => (e as AppError).getStatus();

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T10:30:00+05:30')); // "today" in the demo
});
afterAll(() => vi.useRealTimers());

// ── Ledger ──────────────────────────────────────────────────────────────────

function makeLedger(opts: { lockedUpTo?: string | null; existing?: unknown } = {}) {
  const accounts = [
    { id: 'bank', name: 'HDFC Current A/c', type: 'ASSET', isGroup: false, isActive: true, systemKey: 'BANK' },
    { id: 'nimbus', name: 'Nimbus Retail', type: 'ASSET', isGroup: false, isActive: true, systemKey: null },
    { id: 'rent', name: 'Rent', type: 'EXPENSE', isGroup: false, isActive: true, systemKey: 'RENT' },
    { id: 'ar', name: 'Sundry debtors', type: 'ASSET', isGroup: true, isActive: true, systemKey: 'AR' },
  ];
  const prisma = {
    voucher: {
      findFirst: vi.fn(async () => opts.existing ?? null),
      create: vi.fn(async (a: { data: { number: string } }) => ({ id: 'v1', ...a.data, lines: [] })),
    },
    account: {
      findMany: vi.fn(async (a: { where?: { id?: { in: string[] } } }) => accounts.filter((x) => !a?.where?.id?.in || a.where.id.in.includes(x.id))),
      findFirst: vi.fn(async (a: { where: { id?: string; systemKey?: string } }) => accounts.find((x) => (a.where.id ? x.id === a.where.id : x.systemKey === a.where.systemKey)) ?? null),
    },
  };
  const seq = { next: vi.fn(async (_key: string, o: { prefix: string }) => `${o.prefix}222`) };
  const audit = { record: vi.fn(async () => undefined) };
  const events = { emit: vi.fn() };
  const settings = { get: vi.fn(async () => ({ ...DEFAULT_FINANCE_SETTINGS, booksLockedUpTo: opts.lockedUpTo ?? null })), set: vi.fn() };
  const ledger = new LedgerService(prisma as never, seq as never, audit as never, events as never, settings as never);
  return { ledger, prisma, seq, audit, events };
}

const day = (k: string) => new Date(`${k}T00:00:00.000Z`);

describe('LedgerService.post', () => {
  it('numbers a balanced receipt RCPT-### in the financial-year series and audits it', async () => {
    const { ledger, prisma, seq, audit } = makeLedger();
    const v = await run(() =>
      ledger.post({
        type: 'RECEIPT',
        date: day('2026-09-28'),
        narration: 'Invoice INV-0412 received',
        lines: [
          { accountId: 'bank', debitPaise: 47_200_000 },
          { accountId: 'nimbus', creditPaise: 47_200_000 },
        ],
        sourceType: 'INVOICE_PAYMENT',
        sourceId: 'pay1',
      }),
    );
    expect(seq.next).toHaveBeenCalledWith('voucher.rcpt', { prefix: 'RCPT-', pad: 3, period: '2026-27' });
    expect(v.number).toBe('RCPT-222');
    const data = prisma.voucher.create.mock.calls[0]![0].data as unknown as { totalPaise: number; fy: string; lines: { create: { tenantId: string }[] } };
    expect(data.totalPaise).toBe(47_200_000);
    expect(data.fy).toBe('2026-27');
    expect(data.lines.create.every((l) => l.tenantId === 't1')).toBe(true); // nested rows carry the tenant
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'voucher.posted' }));
  });

  it('rejects an unbalanced voucher (422 UNBALANCED) before a number is consumed', async () => {
    const { ledger, prisma, seq } = makeLedger();
    const e = await run(() =>
      ledger.post({ type: 'PAYMENT', date: day('2026-09-24'), narration: 'Rent', lines: [{ accountId: 'rent', debitPaise: 21_000_000 }, { accountId: 'bank', creditPaise: 20_000_000 }] }),
    ).catch((x) => x);
    expect(statusOf(e)).toBe(422);
    expect(codeOf(e)).toBe('UNBALANCED');
    expect(seq.next).not.toHaveBeenCalled();
    expect(prisma.voucher.create).not.toHaveBeenCalled();
  });

  it('refuses dates inside locked books and in the future', async () => {
    const { ledger } = makeLedger({ lockedUpTo: '2026-08-31' });
    const lines = [{ accountId: 'rent', debitPaise: 100 }, { accountId: 'bank', creditPaise: 100 }];
    const locked = await run(() => ledger.post({ type: 'PAYMENT', date: day('2026-08-20'), narration: 'Old bill', lines })).catch((x) => x);
    expect(codeOf(locked)).toBe('PERIOD_LOCKED');
    const future = await run(() => ledger.post({ type: 'PAYMENT', date: day('2026-10-01'), narration: 'Advance', lines })).catch((x) => x);
    expect(codeOf(future)).toBe('FUTURE_DATE');
  });

  it('refuses posting to a group account', async () => {
    const { ledger } = makeLedger();
    const e = await run(() => ledger.post({ type: 'JOURNAL', date: day('2026-09-20'), narration: 'x', lines: [{ accountId: 'ar', debitPaise: 100 }, { accountId: 'bank', creditPaise: 100 }] })).catch((x) => x);
    expect(codeOf(e)).toBe('GROUP_ACCOUNT');
  });

  it('auto-postings are idempotent per source', async () => {
    const existing = { id: 'old', number: 'SV-031', lines: [] };
    const { ledger, prisma, seq } = makeLedger({ existing });
    const v = await run(() => ledger.post({ type: 'SALES', date: day('2026-09-21'), narration: 'x', lines: [{ accountId: 'nimbus', debitPaise: 1 }, { accountId: 'rent', creditPaise: 1 }], sourceType: 'INVOICE', sourceId: 'inv1' }));
    expect(v).toBe(existing);
    expect(seq.next).not.toHaveBeenCalled();
    expect(prisma.voucher.create).not.toHaveBeenCalled();
  });
});

describe('LedgerService.createManual (New voucher form)', () => {
  it('adds the balancing Bank line: payment = Dr ledger / Cr bank, HRV- series for HR vouchers', async () => {
    const { ledger, prisma, seq } = makeLedger();
    await run(() => ledger.createManual({ type: 'HR', date: '2026-09-25', narration: 'Team dinner reimbursement', accountId: 'rent', amountPaise: 1_200_000, counterAccountId: 'bank' }, ctx(['ledger.hrvoucher'])), ['ledger.hrvoucher']);
    expect(seq.next.mock.calls[0]![1]).toMatchObject({ prefix: 'HRV-' });
    const lines = (prisma.voucher.create.mock.calls[0]![0].data as unknown as { lines: { create: { accountId: string; debitPaise: number; creditPaise: number }[] } }).lines.create;
    expect(lines.map((l) => [l.accountId, l.debitPaise, l.creditPaise])).toEqual([
      ['rent', 1_200_000, 0],
      ['bank', 0, 1_200_000],
    ]);
  });
  it('receipt = Dr bank / Cr ledger', async () => {
    const { ledger, prisma } = makeLedger();
    await run(() => ledger.createManual({ type: 'RECEIPT', date: '2026-09-28', narration: 'Refund', accountId: 'nimbus', amountPaise: 5_000 }, ctx()));
    const lines = (prisma.voucher.create.mock.calls[0]![0].data as unknown as { lines: { create: { accountId: string; debitPaise: number }[] } }).lines.create;
    expect(lines[0]).toMatchObject({ accountId: 'bank', debitPaise: 5_000 });
  });
  it('HR users (ledger.hrvoucher only) cannot raise other voucher types', async () => {
    const { ledger } = makeLedger();
    const e = await run(() => ledger.createManual({ type: 'PAYMENT', date: '2026-09-25', narration: 'Rent', accountId: 'rent', amountPaise: 100 }, ctx(['ledger.hrvoucher'])), ['ledger.hrvoucher']).catch((x) => x);
    expect(statusOf(e)).toBe(403);
  });
});

// ── Invoices: number at issue ─────────────────────────────────────────────

function makeInvoices(invoice: Record<string, unknown> | null) {
  let rec = invoice ? { ...invoice } : null;
  const prisma = {
    invoice: {
      findFirst: vi.fn(async () => rec),
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        rec = { id: 'inv-new', ...a.data, lines: [{ id: 'line-1' }] };
        return rec;
      }),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => {
        rec = { ...rec!, ...a.data };
        return rec;
      }),
      delete: vi.fn(),
    },
    invoiceTimeEntry: { findMany: vi.fn(async () => []), createMany: vi.fn() },
    raw: { tenant: { findUniqueOrThrow: vi.fn(async () => ({ id: 't1', name: 'Lexisora', legalName: 'Lexisora Infotech Pvt Ltd', gstin: '24AAECL1234F1Z1', stateCode: '24', stateName: 'Gujarat', address: 'SG Highway', city: 'Ahmedabad', pan: 'AAECL1234F', phone: null })) } },
  };
  const seq = { next: vi.fn(async () => 'INV-0414') };
  const audit = { record: vi.fn(async () => undefined) };
  const events = { emit: vi.fn() };
  const ledger = { assertOpen: vi.fn(async () => undefined), financeSettings: vi.fn(async () => DEFAULT_FINANCE_SETTINGS) };
  const spine = {
    client: vi.fn(async () => ({ id: 'crest', code: 'CR', name: 'Crest Labs', legalName: 'Crest Labs Pvt Ltd', isInternal: false, gstin: null, pan: null, address: 'Pune', stateCode: '24', billingEmails: ['ap@crestlabs.in'], defaultRatePerHourPaise: 125000, paymentTermsDays: 15, status: 'ACTIVE' })),
    project: vi.fn(async () => null),
    cellSheetStatus: vi.fn(async () => new Map()),
    billableCells: vi.fn(),
  };
  const svc = new InvoiceService(prisma as never, seq as never, audit as never, events as never, {} as never, {} as never, {} as never, {} as never, ledger as never, {} as never, spine as never);
  const internals = svc as unknown as { storePdf: unknown; detail: unknown; ensureSalesVoucher: unknown };
  internals.storePdf = vi.fn(async () => ({ id: 'f1' }));
  internals.ensureSalesVoucher = vi.fn(async () => 'sv1');
  internals.detail = vi.fn(async () => rec);
  return { svc, prisma, seq, events, internals, current: () => rec };
}

const DRAFT = {
  id: 'inv1',
  number: null,
  status: 'DRAFT',
  clientId: 'crest',
  clientName: 'Crest Labs',
  minutes: 64 * 60,
  ratePaise: 125000,
  totalPaise: 9_440_000,
  paymentTermsDays: 15,
  buyerSnapshot: { stateCode: '24' },
  lines: [{ timeEntries: [] }],
};

describe('InvoiceService: numbering at issue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a draft lists as "Draft" and has no number', () => {
    const { svc } = makeInvoices(null);
    const row = svc.toRow({ ...DRAFT, projectId: null, projectName: null, period: '2026-09', subtotalPaise: 8_000_000, cgstPaise: 720_000, sgstPaise: 720_000, igstPaise: 0, balancePaise: 9_440_000, dueDate: null, invoiceDate: null, supplyType: 'INTRA' } as never);
    expect(row.label).toBe('Draft');
    expect(row.number).toBeNull();
    expect(row.displayStatus).toBe('Draft');
    expect([row.hours, row.taxablePaise, row.gstPaise, row.totalPaise]).toEqual(['64', 8_000_000, 1_440_000, 9_440_000]);
  });

  it('saving a draft never consumes an invoice number', async () => {
    const { svc, prisma, seq } = makeInvoices(null);
    await run(() =>
      svc.create({ clientId: 'crest', projectId: null, period: '2026-09', billableHours: 64, ratePaise: 125000, gstMode: 'AUTO', overrideReason: null, adjustmentNote: 'Fixed-scope QA support', emailTo: [], emailCc: [], notes: null, action: 'draft' }),
    );
    expect(seq.next).not.toHaveBeenCalled();
    const data = prisma.invoice.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.status).toBe('DRAFT');
    expect(data.number).toBeUndefined();
    expect(data).toMatchObject({ subtotalPaise: 8_000_000, cgstPaise: 720_000, sgstPaise: 720_000, igstPaise: 0, totalPaise: 9_440_000, supplyType: 'INTRA', emailTo: ['ap@crestlabs.in'] });
    expect((data.lines as { create: { tenantId: string; sac: string }[] }).create[0]).toMatchObject({ tenantId: 't1', sac: '998314' });
  });

  it('manual hours that differ from approved hours need an adjustment note', async () => {
    const { svc } = makeInvoices(null);
    const e = await run(() => svc.create({ clientId: 'crest', projectId: null, period: '2026-09', billableHours: 64, ratePaise: 125000, gstMode: 'AUTO', overrideReason: null, adjustmentNote: null, emailTo: [], emailCc: [], notes: null, action: 'draft' })).catch((x) => x);
    expect(codeOf(e)).toBe('ADJUSTMENT_NOTE');
  });

  it('overriding the derived GST needs a reason', async () => {
    const { svc } = makeInvoices(null);
    const e = await run(() => svc.create({ clientId: 'crest', projectId: null, period: '2026-09', billableHours: 64, ratePaise: 125000, gstMode: 'INTER', overrideReason: '', adjustmentNote: 'x', emailTo: [], emailCc: [], notes: null, action: 'draft' })).catch((x) => x);
    expect(codeOf(e)).toBe('OVERRIDE_REASON');
  });

  it('issue assigns the next INV- number, dates the invoice today and sets the due date from terms', async () => {
    const { svc, prisma, seq, events, internals } = makeInvoices(DRAFT);
    await run(() => svc.issue('inv1'));
    expect(seq.next).toHaveBeenCalledWith('invoice.gst', { prefix: 'INV-', pad: 4 });
    const data = prisma.invoice.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.number).toBe('INV-0414');
    expect(data.status).toBe('ISSUED');
    expect(data.fy).toBe('2026-27');
    expect((data.invoiceDate as Date).toISOString().slice(0, 10)).toBe('2026-09-29');
    expect((data.dueDate as Date).toISOString().slice(0, 10)).toBe('2026-10-14');
    expect(internals.ensureSalesVoucher).toHaveBeenCalledWith('inv1');
    expect(internals.storePdf).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith('invoice.issued', { invoiceId: 'inv1' });
  });

  it('an issued invoice cannot be issued again (no second number)', async () => {
    const { svc, seq } = makeInvoices({ ...DRAFT, status: 'EMAILED', number: 'INV-0413' });
    const e = await run(() => svc.issue('inv1')).catch((x) => x);
    expect(statusOf(e)).toBe(409);
    expect(seq.next).not.toHaveBeenCalled();
  });

  it('issuing fails before numbering when reserved hours are no longer approved', async () => {
    const { svc, seq } = makeInvoices({ ...DRAFT, lines: [{ timeEntries: [{ timesheetCellId: 'cell-1' }, { timesheetCellId: 'cell-2' }] }] });
    const e = await run(() => svc.issue('inv1')).catch((x) => x);
    expect(codeOf(e)).toBe('HOURS_CHANGED');
    expect(seq.next).not.toHaveBeenCalled();
  });
});
