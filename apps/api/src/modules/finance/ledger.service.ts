import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FIN_VOUCHER_TYPE_LABEL,
  finMonthLabel,
  type AccountStatement,
  type CreateVoucherInput,
  type FinAccountRow,
  type LedgerKpis,
  type LedgerLineRow,
  type Paginated,
  type TrialBalance,
  type VoucherDetail,
  type VoucherListQuery,
  type VoucherRow,
} from '@lexisora/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SequenceService } from '../../core/registry/sequence.service';
import { AuditService } from '../../core/audit/audit.service';
import { EventsService } from '../../core/registry/events.service';
import { SettingsService } from '../../core/settings/settings.service';
import { requireContext, type RequestContext } from '../../core/context/request-context';
import { hasPerm } from '../../core/auth/decorators';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../core/http/errors';
import { paginated, pageArgs } from '../../core/http/paginate';
import { CHART_OF_ACCOUNTS } from './lib/coa';
import { computeTrialBalance, primaryLedger, reverseLines, runningStatement, validateVoucherLines, VoucherValidationError, type AccountMeta, type LineInput } from './lib/ledger-math';
import { currentMonthKey, dateKeyOf, dateOnly, fyOf, fyStart, monthRange, todayDate, voucherSequence, type VoucherKind } from './lib/money';

export const FINANCE_SETTINGS_KEY = 'finance.settings';
export type FinanceSettings = {
  booksLockedUpTo: string | null;
  defaultPaymentTermsDays: number;
  bank: { bankName: string; accountName: string; accountNo: string; ifsc: string; branch: string; upiId: string };
  signatory: string;
};
export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  booksLockedUpTo: null,
  defaultPaymentTermsDays: 15,
  bank: { bankName: 'HDFC Bank', accountName: 'Lexisora Infotech Pvt Ltd', accountNo: '50200012345678', ifsc: 'HDFC0000123', branch: 'Satellite, Ahmedabad', upiId: 'lexisora@hdfcbank' },
  signatory: 'Rohit Verma, Director',
};

export type PostLine = LineInput & { systemKey?: string };
export type PostInput = {
  type: VoucherKind;
  date: Date;
  narration: string;
  lines: PostLine[];
  sourceType?: 'MANUAL' | 'INVOICE' | 'INVOICE_PAYMENT' | 'PURCHASE' | 'CREDIT_NOTE' | 'PAYROLL_RUN' | 'REVERSAL';
  sourceId?: string | null;
  sourceRef?: string | null;
  employeeId?: string | null;
  attachmentFileId?: string | null;
  /** Use a fixed number (credit notes reuse the CN number). */
  number?: string;
  /** Skip the "not in the future" rule (system postings dated by their source). */
  allowFuture?: boolean;
};

const voucherInclude = { lines: { orderBy: { sortOrder: 'asc' as const }, include: { account: true } } } satisfies Prisma.VoucherInclude;
type VoucherWithLines = Prisma.VoucherGetPayload<{ include: typeof voucherInclude }>;

/**
 * Double-entry ledger. Every posting — manual vouchers, invoices, receipts, purchases,
 * payroll — goes through `post()`, which validates Σ debit = Σ credit, resolves system
 * accounts, numbers the voucher per financial year and is idempotent on (sourceType, sourceId).
 */
@Injectable()
export class LedgerService {
  private readonly log = new Logger('Ledger');

  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly settings: SettingsService,
  ) {}

  financeSettings(): Promise<FinanceSettings> {
    return this.settings.get<FinanceSettings>(FINANCE_SETTINGS_KEY, DEFAULT_FINANCE_SETTINGS);
  }

  // ── Chart of accounts ────────────────────────────────────────────────────

  /** Create any missing seeded accounts for the current tenant (idempotent). */
  async ensureChart(): Promise<void> {
    const existing = await this.prisma.account.findMany({ select: { id: true, code: true, systemKey: true } });
    const byCode = new Map(existing.map((a) => [a.code, a.id]));
    const keys = new Set(existing.map((a) => a.systemKey).filter(Boolean));
    for (const e of CHART_OF_ACCOUNTS) {
      if (byCode.has(e.code) || (e.key && keys.has(e.key))) continue;
      const row = await this.prisma.account.create({
        data: { code: e.code, name: e.name, type: e.type, isGroup: !!e.group, systemKey: e.key ?? null, isSystem: true, parentId: e.parent ? (byCode.get(e.parent) ?? null) : null } as Prisma.AccountUncheckedCreateInput,
      });
      byCode.set(e.code, row.id);
    }
  }

  async accountIdByKey(key: string): Promise<string> {
    let a = await this.prisma.account.findFirst({ where: { systemKey: key }, select: { id: true } });
    if (!a) {
      await this.ensureChart();
      a = await this.prisma.account.findFirst({ where: { systemKey: key }, select: { id: true } });
    }
    if (!a) throw new AppError(500, 'ACCOUNT_MISSING', `System account ${key} is missing from the chart of accounts`);
    return a.id;
  }

  /** Receivable sub-ledger for a client (created lazily under Sundry debtors). */
  async clientAccount(clientId: string, clientName: string): Promise<string> {
    const found = await this.prisma.account.findFirst({ where: { partyType: 'CLIENT', partyId: clientId }, select: { id: true } });
    if (found) return found.id;
    const parentId = await this.accountIdByKey('AR');
    const siblings = await this.prisma.account.findMany({ where: { parentId }, select: { code: true } });
    const used = new Set(siblings.map((s) => s.code));
    let n = 1131;
    while (used.has(String(n))) n++;
    const row = await this.prisma.account.create({
      data: { code: String(n), name: clientName, type: 'ASSET', parentId, partyType: 'CLIENT', partyId: clientId, isSystem: true } as Prisma.AccountUncheckedCreateInput,
    });
    return row.id;
  }

  // ── Posting ──────────────────────────────────────────────────────────────

  private async assertOpenPeriod(date: Date, allowFuture = false) {
    const s = await this.financeSettings();
    if (s.booksLockedUpTo && dateKeyOf(date) <= s.booksLockedUpTo) {
      throw new AppError(422, 'PERIOD_LOCKED', `Books are locked up to ${s.booksLockedUpTo}. Pick a later date.`);
    }
    if (!allowFuture && date.getTime() > todayDate().getTime()) throw new AppError(422, 'FUTURE_DATE', 'Voucher date cannot be in the future');
  }

  async post(input: PostInput): Promise<VoucherWithLines> {
    const ctx = requireContext();
    const sourceType = input.sourceType ?? 'MANUAL';
    if (input.sourceId) {
      const dup = await this.prisma.voucher.findFirst({ where: { sourceType, sourceId: input.sourceId }, include: voucherInclude });
      if (dup) return dup; // idempotent auto-posting
    }
    await this.assertOpenPeriod(input.date, input.allowFuture);
    // Resolve system keys → account ids.
    const resolved: LineInput[] = [];
    for (const l of input.lines) {
      const accountId = l.accountId || (l.systemKey ? await this.accountIdByKey(l.systemKey) : '');
      if (!accountId) throw badRequest('Every line needs an account');
      resolved.push({ ...l, accountId });
    }
    let v: ReturnType<typeof validateVoucherLines>;
    try {
      v = validateVoucherLines(resolved);
    } catch (e) {
      if (e instanceof VoucherValidationError) throw new AppError(422, e.code, e.message, { differencePaise: e.differencePaise });
      throw e;
    }
    const accounts = await this.prisma.account.findMany({ where: { id: { in: [...new Set(v.lines.map((l) => l.accountId))] } } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    for (const l of v.lines) {
      const a = byId.get(l.accountId);
      if (!a) throw badRequest('Unknown account on a voucher line');
      if (a.isGroup) throw new AppError(422, 'GROUP_ACCOUNT', `${a.name} is a group — post to one of its ledgers`);
      if (!a.isActive) throw new AppError(422, 'INACTIVE_ACCOUNT', `${a.name} is inactive`);
    }
    const fy = fyOf(input.date);
    const sq = voucherSequence(input.type);
    const number = input.number ?? (await this.seq.next(sq.key, { prefix: sq.prefix, pad: sq.pad, period: fy }));
    const tenantId = ctx.tenantId;
    const voucher = await this.prisma.voucher.create({
      data: {
        number,
        type: input.type,
        date: input.date,
        fy,
        narration: input.narration.trim(),
        sourceType,
        sourceId: input.sourceId ?? null,
        sourceRef: input.sourceRef ?? null,
        employeeId: input.employeeId ?? null,
        attachmentFileId: input.attachmentFileId ?? null,
        reversalOfId: sourceType === 'REVERSAL' ? (input.sourceId ?? null) : null,
        totalPaise: v.totalPaise,
        postedByUserId: ctx.userId ?? null,
        postedByName: ctx.userName ?? 'System',
        lines: { create: v.lines.map((l, i) => ({ tenantId, accountId: l.accountId, debitPaise: l.debitPaise, creditPaise: l.creditPaise, narration: l.narration, sortOrder: i })) },
      } as Prisma.VoucherUncheckedCreateInput,
      include: voucherInclude,
    });
    await this.audit.record({ action: 'voucher.posted', entity: 'Voucher', entityId: voucher.id, meta: { number, type: input.type, totalPaise: v.totalPaise, sourceType, sourceRef: input.sourceRef ?? null } });
    this.events.emit('voucher.posted', { voucherId: voucher.id, number, type: input.type });
    return voucher;
  }

  /** Reverse a posted voucher: a JV with swapped sides; the original becomes REVERSED. */
  async reverse(voucherId: string, reason: string, date?: Date): Promise<VoucherWithLines> {
    const orig = await this.prisma.voucher.findFirst({ where: { id: voucherId }, include: voucherInclude });
    if (!orig) throw notFound('Voucher');
    if (orig.status === 'REVERSED') throw conflict('This voucher has already been reversed', 'ALREADY_REVERSED');
    if (orig.reversalOfId) throw conflict('A reversal cannot be reversed — post a new voucher instead', 'REVERSAL_OF_REVERSAL');
    const when = date ?? todayDate();
    const rev = await this.post({
      type: 'JOURNAL',
      date: when.getTime() < orig.date.getTime() ? orig.date : when,
      narration: `Reversal of ${orig.number}: ${reason}`.slice(0, 500),
      lines: reverseLines(orig.lines.map((l) => ({ accountId: l.accountId, debitPaise: l.debitPaise, creditPaise: l.creditPaise, narration: l.narration }))),
      sourceType: 'REVERSAL',
      sourceId: orig.id,
      sourceRef: orig.number,
      employeeId: orig.employeeId,
    });
    await this.prisma.voucher.update({ where: { id: orig.id }, data: { status: 'REVERSED', reversedById: rev.id } });
    await this.audit.record({ action: 'voucher.reversed', entity: 'Voucher', entityId: orig.id, meta: { number: orig.number, reversal: rev.number, reason } });
    return rev;
  }

  /** "New voucher" form → balanced voucher with an automatic Bank/Cash counter line. */
  async createManual(input: CreateVoucherInput, ctx: RequestContext) {
    const full = hasPerm(ctx, 'ledger.manage');
    if (!full && input.type !== 'HR') throw forbidden('You can raise HR vouchers only');
    const date = dateOnly(input.date);
    let lines: PostLine[];
    if (input.type === 'JOURNAL') {
      lines = (input.lines ?? []).map((l) => ({ accountId: l.accountId, debitPaise: l.debitPaise, creditPaise: l.creditPaise, narration: l.narration ?? null }));
    } else {
      const ledger = await this.prisma.account.findFirst({ where: { id: input.accountId! } });
      if (!ledger) throw badRequest('Pick a ledger');
      if (!full && ledger.type !== 'EXPENSE') throw forbidden('HR vouchers can only be booked to expense ledgers');
      const counterKey = input.type === 'HR' && input.employeeId && !input.counterAccountId ? 'REIMB_PAYABLE' : 'BANK';
      const counterId = input.counterAccountId || (await this.accountIdByKey(counterKey));
      const counter = await this.prisma.account.findFirst({ where: { id: counterId } });
      if (!counter) throw badRequest('Pick the bank / cash account');
      if (!full && !['BANK', 'CASH', 'REIMB_PAYABLE'].includes(counter.systemKey ?? '')) throw forbidden('HR vouchers are paid from Bank, Cash or Reimbursements payable');
      if (counter.id === ledger.id) throw badRequest('Ledger and bank/cash account must be different');
      const amt = input.amountPaise!;
      lines =
        input.type === 'RECEIPT'
          ? [
              { accountId: counter.id, debitPaise: amt },
              { accountId: ledger.id, creditPaise: amt },
            ]
          : [
              { accountId: ledger.id, debitPaise: amt },
              { accountId: counter.id, creditPaise: amt },
            ];
    }
    const v = await this.post({ type: input.type, date, narration: input.narration, lines, sourceType: 'MANUAL', employeeId: input.employeeId ?? null, attachmentFileId: input.attachmentFileId ?? null });
    return { id: v.id, number: v.number };
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  private metaMap(accounts: { id: string; name: string; systemKey: string | null; partyType: string | null }[]) {
    return new Map<string, AccountMeta>(accounts.map((a) => [a.id, a]));
  }

  toRow(v: VoucherWithLines): VoucherRow {
    const meta = this.metaMap(v.lines.map((l) => l.account));
    const p = primaryLedger(v.lines, meta);
    return {
      id: v.id,
      number: v.number,
      type: v.type,
      date: dateKeyOf(v.date),
      narration: v.narration,
      ledger: p.ledger,
      debitPaise: p.debitPaise,
      creditPaise: p.creditPaise,
      status: v.status as VoucherRow['status'],
      sourceType: v.sourceType,
      sourceRef: v.sourceRef,
      isReversal: !!v.reversalOfId,
    };
  }

  async list(q: VoucherListQuery, ctx: RequestContext): Promise<Paginated<VoucherRow | LedgerLineRow>> {
    const tab = hasPerm(ctx, 'ledger.manage') ? q.tab : 'hr';
    const dateWhere = q.from || q.to ? { date: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lte: dateOnly(q.to) } : {}) } } : {};
    if (tab === 'income' || tab === 'expenses') {
      const where: Prisma.VoucherLineWhereInput = {
        account: { type: tab === 'income' ? 'INCOME' : 'EXPENSE' },
        voucher: { ...dateWhere, ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { narration: { contains: q.q, mode: 'insensitive' } }] } : {}) },
        ...(q.accountId ? { accountId: q.accountId } : {}),
      };
      const [rows, total] = await Promise.all([
        this.prisma.voucherLine.findMany({ where, include: { voucher: true, account: true }, orderBy: [{ voucher: { date: 'desc' } }, { voucher: { createdAt: 'desc' } }], ...pageArgs(q) }),
        this.prisma.voucherLine.count({ where }),
      ]);
      return paginated(
        rows.map((l) => ({
          id: l.id,
          voucherId: l.voucherId,
          number: l.voucher.number,
          date: dateKeyOf(l.voucher.date),
          accountId: l.accountId,
          account: l.account.name,
          narration: l.narration || l.voucher.narration,
          debitPaise: l.debitPaise,
          creditPaise: l.creditPaise,
        })),
        total,
        q,
      );
    }
    const where: Prisma.VoucherWhereInput = {
      ...dateWhere,
      ...(tab === 'hr' ? { type: 'HR' } : q.type ? { type: q.type } : {}),
      ...(q.accountId ? { lines: { some: { accountId: q.accountId } } } : {}),
      ...(q.q
        ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { narration: { contains: q.q, mode: 'insensitive' } }, { sourceRef: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.voucher.findMany({ where, include: voucherInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], ...pageArgs(q) }),
      this.prisma.voucher.count({ where }),
    ]);
    return paginated(rows.map((v) => this.toRow(v)), total, q);
  }

  async detail(id: string, ctx: RequestContext): Promise<VoucherDetail> {
    const v = await this.prisma.voucher.findFirst({ where: { id }, include: voucherInclude });
    if (!v) throw notFound('Voucher');
    if (!hasPerm(ctx, 'ledger.manage') && v.type !== 'HR') throw forbidden();
    const [emp, revOf, revBy] = await Promise.all([
      v.employeeId ? this.prisma.employee.findFirst({ where: { id: v.employeeId }, select: { fullName: true } }) : null,
      v.reversalOfId ? this.prisma.voucher.findFirst({ where: { id: v.reversalOfId }, select: { id: true, number: true } }) : null,
      v.reversedById ? this.prisma.voucher.findFirst({ where: { id: v.reversedById }, select: { id: true, number: true } }) : null,
    ]);
    let link: string | null = null;
    if (v.sourceType === 'INVOICE' && v.sourceId) link = `/invoices?open=${v.sourceId}`;
    else if (v.sourceType === 'INVOICE_PAYMENT' && v.sourceId) {
      const p = await this.prisma.invoicePayment.findFirst({ where: { id: v.sourceId }, select: { invoiceId: true } });
      link = p ? `/invoices?open=${p.invoiceId}` : null;
    } else if (v.sourceType === 'CREDIT_NOTE' && v.sourceId) {
      const cn = await this.prisma.invoiceCreditNote.findFirst({ where: { id: v.sourceId }, select: { invoiceId: true } });
      link = cn ? `/invoices?open=${cn.invoiceId}` : null;
    } else if (v.sourceType === 'PURCHASE' && v.sourceId) link = `/purchases?open=${v.sourceId}`;
    else if (v.sourceType === 'PAYROLL_RUN') link = '/payroll';
    return {
      ...this.toRow(v),
      fy: v.fy,
      totalPaise: v.totalPaise,
      employeeName: emp?.fullName ?? null,
      attachmentFileId: v.attachmentFileId,
      postedByName: v.postedByName,
      createdAt: v.createdAt.toISOString(),
      reversalOf: revOf,
      reversedBy: revBy,
      source: { type: v.sourceType, id: v.sourceId, ref: v.sourceRef, link },
      lines: v.lines.map((l) => ({ id: l.id, accountId: l.accountId, accountCode: l.account.code, account: l.account.name, debitPaise: l.debitPaise, creditPaise: l.creditPaise, narration: l.narration })),
    };
  }

  /** Σ debit/credit per account for a date range (raw SQL: sums can exceed Int). */
  private async sums(from: Date | null, to: Date | null, opts: { before?: boolean } = {}) {
    const tenantId = requireContext().tenantId;
    const conds: Prisma.Sql[] = [Prisma.sql`l."tenantId" = ${tenantId}`];
    if (opts.before && from) conds.push(Prisma.sql`v."date" < ${from}`);
    else {
      if (from) conds.push(Prisma.sql`v."date" >= ${from}`);
      if (to) conds.push(Prisma.sql`v."date" <= ${to}`);
    }
    const rows = await this.prisma.raw.$queryRaw<{ accountId: string; dr: bigint | null; cr: bigint | null }[]>`
      SELECT l."accountId" AS "accountId", SUM(l."debitPaise")::bigint AS dr, SUM(l."creditPaise")::bigint AS cr
      FROM "VoucherLine" l JOIN "Voucher" v ON v."id" = l."voucherId"
      WHERE ${Prisma.join(conds, ' AND ')}
      GROUP BY l."accountId"`;
    return rows.map((r) => ({ accountId: r.accountId, debitPaise: Number(r.dr ?? 0), creditPaise: Number(r.cr ?? 0) }));
  }

  async kpis(month = currentMonthKey()): Promise<LedgerKpis> {
    const { start, end } = monthRange(month);
    const [sums, accounts, invoiceCount, s] = await Promise.all([
      this.sums(start, end),
      this.prisma.account.findMany({ select: { id: true, type: true } }),
      this.prisma.invoice.count({ where: { invoiceDate: { gte: start, lte: end }, status: { notIn: ['DRAFT', 'CANCELLED'] } } }),
      this.financeSettings(),
    ]);
    const type = new Map(accounts.map((a) => [a.id, a.type]));
    let income = 0;
    let expenses = 0;
    for (const x of sums) {
      const t = type.get(x.accountId);
      if (t === 'INCOME') income += x.creditPaise - x.debitPaise;
      if (t === 'EXPENSE') expenses += x.debitPaise - x.creditPaise;
    }
    return { month, monthLabel: finMonthLabel(month), incomePaise: income, expensesPaise: expenses, balancePaise: income - expenses, invoiceCount, booksLockedUpTo: s.booksLockedUpTo };
  }

  async trialBalance(fromKey?: string, toKey?: string): Promise<TrialBalance> {
    const to = toKey ? dateOnly(toKey) : todayDate();
    const from = fromKey ? dateOnly(fromKey) : fyStart(to);
    if (from.getTime() > to.getTime()) throw badRequest('From date must be before To date');
    const [accounts, before, within] = await Promise.all([
      this.prisma.account.findMany({ select: { id: true, code: true, name: true, type: true, openingPaise: true, isGroup: true } }),
      this.sums(from, null, { before: true }),
      this.sums(from, to),
    ]);
    const tb = computeTrialBalance(accounts, before, within);
    return { from: dateKeyOf(from), to: dateKeyOf(to), ...tb };
  }

  async statement(accountId: string, fromKey?: string, toKey?: string): Promise<AccountStatement> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId } });
    if (!account) throw notFound('Account');
    const to = toKey ? dateOnly(toKey) : todayDate();
    const from = fromKey ? dateOnly(fromKey) : fyStart(to);
    const before = (await this.sums(from, null, { before: true })).find((s) => s.accountId === accountId);
    const opening = account.openingPaise + (before ? before.debitPaise - before.creditPaise : 0);
    const lines = await this.prisma.voucherLine.findMany({
      where: { accountId, voucher: { date: { gte: from, lte: to } } },
      include: { voucher: true },
      orderBy: [{ voucher: { date: 'asc' } }, { voucher: { createdAt: 'asc' } }],
      take: 2000,
    });
    const st = runningStatement(
      opening,
      lines.map((l) => ({ voucherId: l.voucherId, number: l.voucher.number, date: dateKeyOf(l.voucher.date), narration: l.narration || l.voucher.narration, debitPaise: l.debitPaise, creditPaise: l.creditPaise })),
    );
    return { account: { id: account.id, code: account.code, name: account.name, type: account.type }, from: dateKeyOf(from), to: dateKeyOf(to), openingPaise: opening, closingPaise: st.closingPaise, rows: st.rows };
  }

  async accounts(): Promise<FinAccountRow[]> {
    await this.ensureChart();
    const [accounts, sums] = await Promise.all([this.prisma.account.findMany({ orderBy: { code: 'asc' } }), this.sums(null, todayDate())]);
    const bal = new Map(sums.map((s) => [s.accountId, s.debitPaise - s.creditPaise]));
    const rows = accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      parentId: a.parentId,
      isGroup: a.isGroup,
      systemKey: a.systemKey,
      partyType: a.partyType,
      isSystem: a.isSystem,
      isActive: a.isActive,
      balancePaise: a.openingPaise + (bal.get(a.id) ?? 0),
    }));
    // Roll group balances up from their ledgers.
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of rows.filter((x) => !x.isGroup)) {
      let p = r.parentId ? byId.get(r.parentId) : undefined;
      while (p) {
        if (p.isGroup) p.balancePaise += r.balancePaise;
        p = p.parentId ? byId.get(p.parentId) : undefined;
      }
    }
    return rows;
  }

  async createAccount(input: { code: string; name: string; type: FinAccountRow['type']; parentId?: string | null; openingPaise?: number }) {
    if (input.parentId) {
      const parent = await this.prisma.account.findFirst({ where: { id: input.parentId } });
      if (!parent) throw badRequest('Parent group not found');
      if (!parent.isGroup) throw badRequest('Parent must be a group account');
      if (parent.type !== input.type) throw badRequest(`A ${input.type.toLowerCase()} account can't sit under ${parent.name}`);
    }
    if (await this.prisma.account.findFirst({ where: { code: input.code } })) throw conflict(`Account code ${input.code} is already used`);
    const row = await this.prisma.account.create({ data: { code: input.code, name: input.name, type: input.type, parentId: input.parentId ?? null, openingPaise: input.openingPaise ?? 0 } as Prisma.AccountUncheckedCreateInput });
    await this.audit.record({ action: 'account.created', entity: 'Account', entityId: row.id, meta: { code: row.code, name: row.name } });
    return row;
  }

  async updateAccount(id: string, input: { name?: string; isActive?: boolean }) {
    const a = await this.prisma.account.findFirst({ where: { id } });
    if (!a) throw notFound('Account');
    if (a.isSystem && input.isActive === false) throw badRequest('System accounts cannot be deactivated');
    const row = await this.prisma.account.update({ where: { id }, data: input });
    await this.audit.record({ action: 'account.updated', entity: 'Account', entityId: id, meta: input });
    return row;
  }

  async lockBooks(upTo: string) {
    const s = await this.financeSettings();
    if (dateOnly(upTo).getTime() > todayDate().getTime()) throw badRequest('You can only lock books up to today');
    const drafts = await this.prisma.invoice.count({ where: { status: 'DRAFT', periodEnd: { lte: dateOnly(upTo) } } });
    await this.settings.set(FINANCE_SETTINGS_KEY, { ...s, booksLockedUpTo: upTo });
    await this.audit.record({ action: 'period.locked', entity: 'Ledger', meta: { upTo } });
    return { booksLockedUpTo: upTo, draftInvoicesInPeriod: drafts };
  }

  /** Day book or trial balance as CSV. */
  async exportCsv(kind: 'daybook' | 'trial', fromKey?: string, toKey?: string, ctx?: RequestContext): Promise<{ filename: string; csv: string }> {
    const esc = (s: unknown) => {
      const t = String(s ?? '');
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const rupees = (p: number) => (p ? (p / 100).toFixed(2) : '');
    let lines: string[];
    if (kind === 'trial') {
      const tb = await this.trialBalance(fromKey, toKey);
      lines = [
        'Code,Account,Type,Opening Dr,Opening Cr,Debit,Credit,Closing Dr,Closing Cr',
        ...tb.rows.map((r) =>
          [r.code, r.name, r.type, rupees(Math.max(0, r.openingPaise)), rupees(Math.max(0, -r.openingPaise)), rupees(r.debitPaise), rupees(r.creditPaise), rupees(Math.max(0, r.closingPaise)), rupees(Math.max(0, -r.closingPaise))].map(esc).join(','),
        ),
        ['', 'Total', '', rupees(tb.totals.openingDr), rupees(tb.totals.openingCr), rupees(tb.totals.debitPaise), rupees(tb.totals.creditPaise), rupees(tb.totals.closingDr), rupees(tb.totals.closingCr)].map(esc).join(','),
      ];
      await this.audit.record({ action: 'ledger.export', entity: 'Ledger', meta: { kind, from: tb.from, to: tb.to } });
      return { filename: `trial-balance-${tb.from}-to-${tb.to}.csv`, csv: lines.join('\n') };
    }
    const to = toKey ? dateOnly(toKey) : todayDate();
    const from = fromKey ? dateOnly(fromKey) : fyStart(to);
    const hrOnly = ctx ? !hasPerm(ctx, 'ledger.manage') : false;
    const vouchers = await this.prisma.voucher.findMany({ where: { date: { gte: from, lte: to }, ...(hrOnly ? { type: 'HR' } : {}) }, include: voucherInclude, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], take: 20000 });
    lines = ['Date,Voucher,Type,Ledger,Narration,Debit,Credit,Status'];
    for (const v of vouchers) {
      const r = this.toRow(v);
      lines.push([r.date, r.number, FIN_VOUCHER_TYPE_LABEL[r.type], r.ledger, r.narration, rupees(r.debitPaise), rupees(r.creditPaise), r.status].map(esc).join(','));
    }
    await this.audit.record({ action: 'ledger.export', entity: 'Ledger', meta: { kind, from: dateKeyOf(from), to: dateKeyOf(to) } });
    return { filename: `day-book-${dateKeyOf(from)}-to-${dateKeyOf(to)}.csv`, csv: lines.join('\n') };
  }

  /** Postable ledgers for the voucher form (HR: expense ledgers + payment sources only). */
  async ledgerOptions(ctx: RequestContext) {
    await this.ensureChart();
    const full = hasPerm(ctx, 'ledger.manage');
    const rows = await this.prisma.account.findMany({ where: { isGroup: false, isActive: true }, orderBy: { code: 'asc' } });
    const money = rows.filter((a) => ['BANK', 'CASH'].includes(a.systemKey ?? '') || (!full && a.systemKey === 'REIMB_PAYABLE') || (full && a.systemKey === 'REIMB_PAYABLE'));
    const ledgers = full ? rows : rows.filter((a) => a.type === 'EXPENSE');
    return {
      ledgers: ledgers.map((a) => ({ value: a.id, label: `${a.name}`, code: a.code, type: a.type, systemKey: a.systemKey })),
      counters: money.map((a) => ({ value: a.id, label: a.name, systemKey: a.systemKey })),
      canManage: full,
    };
  }
}
