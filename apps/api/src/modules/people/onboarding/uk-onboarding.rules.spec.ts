import { describe, expect, it } from 'vitest';
import { ukBankStepSchema, ukDocsStepSchema } from '@lexisora/shared';
import { mergeUkProfile, ukStarterTax, ukTaxYearOf } from './uk-onboarding.rules';

describe('UK onboarding · starter tax code', () => {
  it('A is 1257L cumulative, B and C are 1257L non-cumulative', () => {
    expect(ukStarterTax('A')).toEqual({ taxCode: '1257L', taxBasis: 'CUMULATIVE' });
    expect(ukStarterTax('B')).toEqual({ taxCode: '1257L', taxBasis: 'NON_CUMULATIVE' });
    expect(ukStarterTax('C')).toEqual({ taxCode: '1257L', taxBasis: 'NON_CUMULATIVE' });
  });
  it('tax year starts on 6 April', () => {
    expect(ukTaxYearOf('2026-04-05')).toBe(2025);
    expect(ukTaxYearOf('2026-04-06')).toBe(2026);
    expect(ukTaxYearOf('2027-01-15')).toBe(2026);
  });
});

describe('UK onboarding · ukProfile merge', () => {
  const answers = { starterStatement: 'B' as const, studentLoanPlans: ['PLAN_2' as const], postgraduateLoan: true, hasP45: true, previousPayPence: 1_250_000, previousTaxPence: 120_000 };

  it('builds a valid profile with defaults for a new joiner', () => {
    const p = mergeUkProfile(null, answers, '2026-11-27');
    expect(p).toMatchObject({ taxCode: '1257L', taxBasis: 'NON_CUMULATIVE', niCategory: 'A', starterStatement: 'B', studentLoanPlans: ['PLAN_2'], postgraduateLoan: true, previousPayPence: 1_250_000, previousTaxPence: 120_000, previousTaxYear: 2026 });
    expect(p.pension.status).toBe('AUTO');
  });

  it('keeps a tax code and other settings Payroll already set', () => {
    const p = mergeUkProfile({ taxCode: 'S1257L', taxBasis: 'CUMULATIVE', niCategory: 'M', director: true }, { ...answers, hasP45: false }, '2026-11-27');
    expect(p).toMatchObject({ taxCode: 'S1257L', taxBasis: 'CUMULATIVE', niCategory: 'M', director: true, previousPayPence: 0, previousTaxPence: 0, previousTaxYear: null });
  });
});

describe('UK onboarding · step schemas', () => {
  it('bank: sort code 6 digits, account 8 digits, NI number format, matching account', () => {
    const ok = ukBankStepSchema.safeParse({ holderName: 'Amelia Hart', sortCode: '20-00-00', accountNumber: '12345678', confirmAccountNumber: '1234 5678', niNumber: 'ab 12 34 56 c', starterStatement: 'A' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ sortCode: '200000', niNumber: 'AB123456C', studentLoanPlans: [], postgraduateLoan: false });
    expect(ukBankStepSchema.safeParse({ holderName: 'A H', sortCode: '2000', accountNumber: '12345678', confirmAccountNumber: '12345678', starterStatement: 'A' }).success).toBe(false);
    expect(ukBankStepSchema.safeParse({ holderName: 'A H', sortCode: '200000', accountNumber: '1234567', confirmAccountNumber: '1234567', starterStatement: 'A' }).success).toBe(false);
    expect(ukBankStepSchema.safeParse({ holderName: 'A H', sortCode: '200000', accountNumber: '12345678', confirmAccountNumber: '12345679', starterStatement: 'A' }).success).toBe(false);
    expect(ukBankStepSchema.safeParse({ holderName: 'A H', sortCode: '200000', accountNumber: '12345678', confirmAccountNumber: '12345678', niNumber: 'GB123456A', starterStatement: 'A' }).success).toBe(false);
  });
  it('docs: share code needed unless British or Irish', () => {
    expect(ukDocsStepSchema.safeParse({ idFileId: 'f1', nationality: 'BRITISH_IRISH', declaration: true }).success).toBe(true);
    expect(ukDocsStepSchema.safeParse({ idFileId: 'f1', nationality: 'OTHER', declaration: true }).success).toBe(false);
    const r = ukDocsStepSchema.safeParse({ idFileId: 'f1', nationality: 'OTHER', shareCode: 'w4k 7rt 2pq', declaration: true });
    expect(r.success && r.data.shareCode).toBe('W4K7RT2PQ');
  });
});
