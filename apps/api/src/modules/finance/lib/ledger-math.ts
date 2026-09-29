/**
 * Double-entry rules as pure functions (unit-tested): voucher balance validation, the
 * primary-ledger label on the day book, trial balance and account statements.
 * Balances are debit-positive (credit balances negative).
 */

export type LineInput = { accountId: string; debitPaise?: number; creditPaise?: number; narration?: string | null };
export type NormalLine = { accountId: string; debitPaise: number; creditPaise: number; narration: string | null };

export class VoucherValidationError extends Error {
  constructor(
    public code: 'TOO_FEW_LINES' | 'LINE_SIDE' | 'LINE_AMOUNT' | 'UNBALANCED',
    message: string,
    public differencePaise = 0,
  ) {
    super(message);
  }
}

const inr = (paise: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(paise / 100)}`;

/**
 * Σ debit must equal Σ credit, every line has exactly one positive side, at least two lines.
 * Returns normalized lines and the voucher total.
 */
export function validateVoucherLines(lines: LineInput[]): { lines: NormalLine[]; totalPaise: number } {
  const norm = lines
    .map((l) => ({ accountId: l.accountId, debitPaise: Math.round(l.debitPaise ?? 0), creditPaise: Math.round(l.creditPaise ?? 0), narration: l.narration ?? null }))
    .filter((l) => l.debitPaise !== 0 || l.creditPaise !== 0);
  for (const l of norm) {
    if (l.debitPaise < 0 || l.creditPaise < 0) throw new VoucherValidationError('LINE_AMOUNT', 'Amounts must be positive');
    if (l.debitPaise > 0 && l.creditPaise > 0) throw new VoucherValidationError('LINE_SIDE', 'A line can be either a debit or a credit, not both');
    if (!Number.isSafeInteger(l.debitPaise) || !Number.isSafeInteger(l.creditPaise)) throw new VoucherValidationError('LINE_AMOUNT', 'Amounts must be whole paise');
  }
  if (norm.length < 2) throw new VoucherValidationError('TOO_FEW_LINES', 'A voucher needs at least one debit and one credit line');
  const dr = norm.reduce((s, l) => s + l.debitPaise, 0);
  const cr = norm.reduce((s, l) => s + l.creditPaise, 0);
  if (dr !== cr) {
    const diff = Math.abs(dr - cr);
    throw new VoucherValidationError('UNBALANCED', `Debits and credits don't match. Difference ${inr(diff)}`, dr - cr);
  }
  if (dr === 0) throw new VoucherValidationError('LINE_AMOUNT', 'Voucher amount must be more than zero');
  return { lines: norm, totalPaise: dr };
}

/** Merge lines hitting the same account on the same side (keeps vouchers tidy). */
export function mergeLines(lines: NormalLine[]): NormalLine[] {
  const map = new Map<string, NormalLine>();
  for (const l of lines) {
    const side = l.debitPaise > 0 ? 'D' : 'C';
    const k = `${l.accountId}:${side}`;
    const cur = map.get(k);
    if (cur) {
      cur.debitPaise += l.debitPaise;
      cur.creditPaise += l.creditPaise;
    } else map.set(k, { ...l });
  }
  return [...map.values()];
}

export type AccountMeta = { id: string; name: string; systemKey: string | null; partyType: string | null };
const MONEY_KEYS = new Set(['BANK', 'CASH']);
const TAX_KEYS = /^GST_(INPUT|OUTPUT)_/;

/**
 * Day-book "Ledger" column: the party (client/vendor) account if any, otherwise the single
 * non-bank, non-tax account; "Multiple" when several remain. Debit/Credit show the voucher
 * total on the side of that primary line.
 */
export function primaryLedger(
  lines: { accountId: string; debitPaise: number; creditPaise: number }[],
  accounts: Map<string, AccountMeta>,
): { ledger: string; debitPaise: number; creditPaise: number } {
  const total = lines.reduce((s, l) => s + l.debitPaise, 0);
  const meta = (id: string) => accounts.get(id);
  const party = lines.find((l) => meta(l.accountId)?.partyType);
  const others = lines.filter((l) => {
    const m = meta(l.accountId);
    return m && !MONEY_KEYS.has(m.systemKey ?? '') && !TAX_KEYS.test(m.systemKey ?? '') && m.systemKey !== 'ROUND_OFF';
  });
  let pick = party ?? (others.length === 1 ? others[0] : undefined);
  if (!pick && others.length > 1) {
    // Several ledgers: when all sit on one side, show "Multiple" on that side.
    const debitSide = others.every((l) => l.debitPaise > 0);
    const creditSide = others.every((l) => l.creditPaise > 0);
    if (debitSide || creditSide) return { ledger: 'Multiple', debitPaise: debitSide ? total : 0, creditPaise: creditSide ? total : 0 };
    return { ledger: 'Multiple', debitPaise: total, creditPaise: 0 };
  }
  if (!pick) pick = lines.find((l) => l.debitPaise > 0) ?? lines[0];
  if (!pick) return { ledger: '—', debitPaise: 0, creditPaise: 0 };
  const name = meta(pick.accountId)?.name ?? '—';
  return pick.debitPaise > 0 ? { ledger: name, debitPaise: total, creditPaise: 0 } : { ledger: name, debitPaise: 0, creditPaise: total };
}

export type TbAccount = { id: string; code: string; name: string; type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'; openingPaise: number; isGroup: boolean };
export type TbSums = { accountId: string; debitPaise: number; creditPaise: number };

/**
 * Trial balance for a range: opening = account opening + net movement before `from`;
 * debit/credit = movements within the range; closing = opening + debit − credit.
 * Rows with no balance and no movement are omitted. `balanced` ⇔ Σ Dr closings = Σ Cr closings.
 */
export function computeTrialBalance(accounts: TbAccount[], before: TbSums[], within: TbSums[]) {
  const pre = new Map(before.map((s) => [s.accountId, s.debitPaise - s.creditPaise]));
  const mov = new Map(within.map((s) => [s.accountId, s]));
  const rows = accounts
    .filter((a) => !a.isGroup)
    .map((a) => {
      const openingPaise = a.openingPaise + (pre.get(a.id) ?? 0);
      const m = mov.get(a.id);
      const debitPaise = m?.debitPaise ?? 0;
      const creditPaise = m?.creditPaise ?? 0;
      return { accountId: a.id, code: a.code, name: a.name, type: a.type, openingPaise, debitPaise, creditPaise, closingPaise: openingPaise + debitPaise - creditPaise };
    })
    .filter((r) => r.openingPaise !== 0 || r.debitPaise !== 0 || r.creditPaise !== 0)
    .sort((x, y) => x.code.localeCompare(y.code));
  const totals = rows.reduce(
    (t, r) => ({
      openingDr: t.openingDr + Math.max(0, r.openingPaise),
      openingCr: t.openingCr + Math.max(0, -r.openingPaise),
      debitPaise: t.debitPaise + r.debitPaise,
      creditPaise: t.creditPaise + r.creditPaise,
      closingDr: t.closingDr + Math.max(0, r.closingPaise),
      closingCr: t.closingCr + Math.max(0, -r.closingPaise),
    }),
    { openingDr: 0, openingCr: 0, debitPaise: 0, creditPaise: 0, closingDr: 0, closingCr: 0 },
  );
  return { rows, totals, balanced: totals.closingDr === totals.closingCr && totals.debitPaise === totals.creditPaise };
}

/** Running balance statement (debit-positive). */
export function runningStatement<T extends { debitPaise: number; creditPaise: number }>(openingPaise: number, rows: T[]) {
  let bal = openingPaise;
  const out = rows.map((r) => {
    bal += r.debitPaise - r.creditPaise;
    return { ...r, balancePaise: bal };
  });
  return { rows: out, closingPaise: bal };
}

/** Month P&L KPIs from per-type sums. */
export function profitAndLoss(sums: { type: string; debitPaise: number; creditPaise: number }[]) {
  const income = sums.filter((s) => s.type === 'INCOME').reduce((t, s) => t + s.creditPaise - s.debitPaise, 0);
  const expenses = sums.filter((s) => s.type === 'EXPENSE').reduce((t, s) => t + s.debitPaise - s.creditPaise, 0);
  return { incomePaise: income, expensesPaise: expenses, balancePaise: income - expenses };
}

/** Swap sides for a reversal voucher. */
export function reverseLines(lines: NormalLine[]): NormalLine[] {
  return lines.map((l) => ({ ...l, debitPaise: l.creditPaise, creditPaise: l.debitPaise }));
}
