import { describe, expect, it } from 'vitest';
import { computeTrialBalance, mergeLines, primaryLedger, profitAndLoss, reverseLines, runningStatement, validateVoucherLines, VoucherValidationError, type AccountMeta, type TbAccount } from './ledger-math';

const err = (fn: () => unknown): VoucherValidationError => {
  try {
    fn();
  } catch (e) {
    return e as VoucherValidationError;
  }
  throw new Error('expected a validation error');
};

describe('Voucher balance validation (Σ debit = Σ credit)', () => {
  it('accepts a balanced payment and returns the voucher total', () => {
    const v = validateVoucherLines([
      { accountId: 'rent', debitPaise: 21_000_000 },
      { accountId: 'bank', creditPaise: 21_000_000 },
    ]);
    expect(v.totalPaise).toBe(21_000_000);
    expect(v.lines).toHaveLength(2);
  });
  it('accepts a multi-line journal (sales voucher with output GST)', () => {
    const v = validateVoucherLines([
      { accountId: 'nimbus', debitPaise: 47_200_000 },
      { accountId: 'sales', creditPaise: 40_000_000 },
      { accountId: 'cgst', creditPaise: 3_600_000 },
      { accountId: 'sgst', creditPaise: 3_600_000 },
      { accountId: 'igst', creditPaise: 0 },
    ]);
    expect(v.totalPaise).toBe(47_200_000);
    expect(v.lines).toHaveLength(4); // zero lines are dropped
  });
  it('rejects an unbalanced voucher with the signed difference', () => {
    const e = err(() =>
      validateVoucherLines([
        { accountId: 'a', debitPaise: 10_000 },
        { accountId: 'b', creditPaise: 9_000 },
      ]),
    );
    expect(e).toBeInstanceOf(VoucherValidationError);
    expect(e.code).toBe('UNBALANCED');
    expect(e.differencePaise).toBe(1_000);
    expect(e.message).toContain('Difference ₹10');
  });
  it('rejects a line with both sides, negative amounts, fractional paise and single-line vouchers', () => {
    expect(err(() => validateVoucherLines([{ accountId: 'a', debitPaise: 5, creditPaise: 5 }, { accountId: 'b', creditPaise: 0 }])).code).toBe('LINE_SIDE');
    expect(err(() => validateVoucherLines([{ accountId: 'a', debitPaise: -5 }, { accountId: 'b', creditPaise: -5 }])).code).toBe('LINE_AMOUNT');
    expect(err(() => validateVoucherLines([{ accountId: 'a', debitPaise: 100 }])).code).toBe('TOO_FEW_LINES');
    expect(err(() => validateVoucherLines([{ accountId: 'a', debitPaise: 0 }, { accountId: 'b', creditPaise: 0 }])).code).toBe('TOO_FEW_LINES');
  });
  it('rounds stray fractions to whole paise before checking', () => {
    expect(validateVoucherLines([{ accountId: 'a', debitPaise: 100.4 }, { accountId: 'b', creditPaise: 100 }]).totalPaise).toBe(100);
  });
  it('a reversal swaps every side and still balances', () => {
    const lines = validateVoucherLines([
      { accountId: 'staff', debitPaise: 1_200_000 },
      { accountId: 'bank', creditPaise: 1_200_000 },
    ]).lines;
    const rev = reverseLines(lines);
    expect(rev).toEqual([
      { accountId: 'staff', debitPaise: 0, creditPaise: 1_200_000, narration: null },
      { accountId: 'bank', debitPaise: 1_200_000, creditPaise: 0, narration: null },
    ]);
    expect(validateVoucherLines(rev).totalPaise).toBe(1_200_000);
  });
  it('merges same-account same-side lines', () => {
    const m = mergeLines([
      { accountId: 'a', debitPaise: 10, creditPaise: 0, narration: null },
      { accountId: 'a', debitPaise: 5, creditPaise: 0, narration: null },
      { accountId: 'b', debitPaise: 0, creditPaise: 15, narration: null },
    ]);
    expect(m).toHaveLength(2);
    expect(m[0]!.debitPaise).toBe(15);
  });
});

describe('Day book "Ledger" column', () => {
  const accounts = new Map<string, AccountMeta>([
    ['bank', { id: 'bank', name: 'HDFC Current A/c', systemKey: 'BANK', partyType: null }],
    ['tds', { id: 'tds', name: 'TDS receivable', systemKey: 'TDS_RECEIVABLE', partyType: null }],
    ['nimbus', { id: 'nimbus', name: 'Nimbus Retail', systemKey: null, partyType: 'CLIENT' }],
    ['office', { id: 'office', name: 'Office supplies', systemKey: 'OFFICE_SUPPLIES', partyType: null }],
    ['cgst', { id: 'cgst', name: 'Input CGST', systemKey: 'GST_INPUT_CGST', partyType: null }],
    ['sgst', { id: 'sgst', name: 'Input SGST', systemKey: 'GST_INPUT_SGST', partyType: null }],
    ['salary', { id: 'salary', name: 'Salaries & wages', systemKey: 'SALARY_EXPENSE', partyType: null }],
    ['pf', { id: 'pf', name: 'PF payable', systemKey: 'PF_PAYABLE', partyType: null }],
    ['net', { id: 'net', name: 'Salary payable', systemKey: 'SALARY_PAYABLE', partyType: null }],
  ]);
  it('RCPT-221: the client is the ledger, amount on the credit side', () => {
    const r = primaryLedger(
      [
        { accountId: 'bank', debitPaise: 46_400_000, creditPaise: 0 },
        { accountId: 'tds', debitPaise: 800_000, creditPaise: 0 },
        { accountId: 'nimbus', debitPaise: 0, creditPaise: 47_200_000 },
      ],
      accounts,
    );
    expect(r).toEqual({ ledger: 'Nimbus Retail', debitPaise: 0, creditPaise: 47_200_000 });
  });
  it('PMT-310: the expense is the ledger (input GST and bank are ignored), amount on the debit side', () => {
    const r = primaryLedger(
      [
        { accountId: 'office', debitPaise: 717_000, creditPaise: 0 },
        { accountId: 'cgst', debitPaise: 64_500, creditPaise: 0 },
        { accountId: 'sgst', debitPaise: 64_500, creditPaise: 0 },
        { accountId: 'bank', debitPaise: 0, creditPaise: 846_000 },
      ],
      accounts,
    );
    expect(r).toEqual({ ledger: 'Office supplies', debitPaise: 846_000, creditPaise: 0 });
  });
  it('several ledgers on both sides → "Multiple"', () => {
    const r = primaryLedger(
      [
        { accountId: 'salary', debitPaise: 1_000, creditPaise: 0 },
        { accountId: 'net', debitPaise: 0, creditPaise: 800 },
        { accountId: 'pf', debitPaise: 0, creditPaise: 200 },
      ],
      accounts,
    );
    expect(r.ledger).toBe('Multiple');
    expect(r.debitPaise).toBe(1_000);
  });
});

describe('Trial balance', () => {
  const accounts: TbAccount[] = [
    { id: 'g', code: '1000', name: 'Assets', type: 'ASSET', openingPaise: 0, isGroup: true },
    { id: 'bank', code: '1110', name: 'Bank', type: 'ASSET', openingPaise: 500_000, isGroup: false },
    { id: 'cap', code: '3100', name: 'Capital', type: 'EQUITY', openingPaise: -500_000, isGroup: false },
    { id: 'sales', code: '4100', name: 'Sales', type: 'INCOME', openingPaise: 0, isGroup: false },
    { id: 'rent', code: '5200', name: 'Rent', type: 'EXPENSE', openingPaise: 0, isGroup: false },
    { id: 'idle', code: '5999', name: 'Unused', type: 'EXPENSE', openingPaise: 0, isGroup: false },
  ];
  it('computes opening, movements and closing per ledger and balances', () => {
    const before = [
      { accountId: 'bank', debitPaise: 100_000, creditPaise: 0 },
      { accountId: 'sales', debitPaise: 0, creditPaise: 100_000 },
    ];
    const within = [
      { accountId: 'bank', debitPaise: 300_000, creditPaise: 50_000 },
      { accountId: 'sales', debitPaise: 0, creditPaise: 300_000 },
      { accountId: 'rent', debitPaise: 50_000, creditPaise: 0 },
    ];
    const tb = computeTrialBalance(accounts, before, within);
    expect(tb.rows.map((r) => r.code)).toEqual(['1110', '3100', '4100', '5200']); // groups and empty ledgers omitted
    const bank = tb.rows.find((r) => r.accountId === 'bank')!;
    expect(bank).toMatchObject({ openingPaise: 600_000, debitPaise: 300_000, creditPaise: 50_000, closingPaise: 850_000 });
    const sales = tb.rows.find((r) => r.accountId === 'sales')!;
    expect(sales).toMatchObject({ openingPaise: -100_000, closingPaise: -400_000 });
    expect(tb.totals).toEqual({ openingDr: 600_000, openingCr: 600_000, debitPaise: 350_000, creditPaise: 350_000, closingDr: 900_000, closingCr: 900_000 });
    expect(tb.balanced).toBe(true);
  });
  it('flags an out-of-balance book (e.g. a corrupted one-sided line)', () => {
    const tb = computeTrialBalance(accounts, [], [{ accountId: 'rent', debitPaise: 1_000, creditPaise: 0 }]);
    expect(tb.balanced).toBe(false);
  });
});

describe('Statements and P&L', () => {
  it('keeps a running debit-positive balance', () => {
    const s = runningStatement(10_000, [
      { debitPaise: 5_000, creditPaise: 0 },
      { debitPaise: 0, creditPaise: 20_000 },
    ]);
    expect(s.rows.map((r) => r.balancePaise)).toEqual([15_000, -5_000]);
    expect(s.closingPaise).toBe(-5_000);
  });
  it('income − expenses = balance', () => {
    expect(
      profitAndLoss([
        { type: 'INCOME', debitPaise: 1_000, creditPaise: 426_000 },
        { type: 'EXPENSE', debitPaise: 311_000, creditPaise: 0 },
        { type: 'ASSET', debitPaise: 9_999, creditPaise: 0 },
      ]),
    ).toEqual({ incomePaise: 425_000, expensesPaise: 311_000, balancePaise: 114_000 });
  });
});
