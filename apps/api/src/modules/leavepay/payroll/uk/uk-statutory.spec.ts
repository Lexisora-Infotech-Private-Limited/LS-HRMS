import { describe, expect, it } from 'vitest';
import { ukPayrollProfileSchema } from '@lexisora/shared';
import { UK_RATES_2026, ukRatesFor } from './uk-rates';
import {
  ageOn,
  assessAutoEnrolment,
  computeDirectorNi,
  computeNi,
  computePaye,
  computePension,
  computeStatutoryPay,
  computeStudentLoans,
  parseTaxCode,
  roundHalfDown,
} from './uk-statutory';
import { calculateItemUk, type UkCalcInput } from './uk-calc';

const R = UK_RATES_2026;
const paye = (taxCode: string, pay: number, month = 1, prevPay = 0, prevTax = 0, cumulative = true) =>
  computePaye({ taxCode, cumulative, taxMonth: month, taxablePayPence: pay, previousTaxablePayPence: prevPay, previousTaxPence: prevTax, rates: R }).taxPence;

describe('tax codes', () => {
  it('parses allowance, K, flat and regional codes', () => {
    expect(parseTaxCode('1257L')).toMatchObject({ kind: 'ALLOWANCE', regime: 'rUK', annualPounds: 12579 });
    expect(parseTaxCode('S1257L')).toMatchObject({ kind: 'ALLOWANCE', regime: 'scotland' });
    expect(parseTaxCode('C1257L')).toMatchObject({ kind: 'ALLOWANCE', regime: 'wales' });
    expect(parseTaxCode('K475')).toMatchObject({ kind: 'K', annualPounds: 4759 });
    expect(parseTaxCode('BR')).toMatchObject({ kind: 'FLAT', flat: 'BR' });
    expect(parseTaxCode('SD1')).toMatchObject({ kind: 'FLAT', regime: 'scotland', flat: 'D1' });
    expect(parseTaxCode('0T')).toMatchObject({ kind: 'ALLOWANCE', annualPounds: 0 });
    expect(parseTaxCode('1257L M1')).toMatchObject({ kind: 'ALLOWANCE', annualPounds: 12579 });
    expect(() => parseTaxCode('XYZ')).toThrow();
  });
  it('validates codes in the profile schema', () => {
    expect(ukPayrollProfileSchema.safeParse({ taxCode: '1257l' }).success).toBe(true);
    expect(ukPayrollProfileSchema.safeParse({ taxCode: 'S1257L' }).success).toBe(true);
    expect(ukPayrollProfileSchema.safeParse({ taxCode: '12A57' }).success).toBe(false);
  });
});

describe('PAYE', () => {
  it('1257L, £4,000 in month 1 (HMRC: £590.20)', () => {
    expect(paye('1257L', 400_000)).toBe(59_020);
  });
  it('cumulative month 2 on the same pay', () => {
    expect(paye('1257L', 400_000, 2, 400_000, 59_020)).toBe(59_040);
  });
  it('Month 1 basis ignores earlier pay', () => {
    expect(paye('1257L', 400_000, 6, 2_000_000, 0, false)).toBe(59_020);
  });
  it('no tax under the monthly free pay', () => {
    expect(paye('1257L', 100_000)).toBe(0);
  });
  it('refunds over-deducted tax on a cumulative code', () => {
    // Month 2 with nothing paid this month after £590.20 was taken in month 1 on £4,000.
    expect(paye('1257L', 0, 2, 400_000, 59_020)).toBeLessThan(0);
  });
  it('higher rate above the basic band', () => {
    // £8,000 in month 1: taxable £6,951; basic band £3,142 at 20% + £3,809 at 40%.
    expect(paye('1257L', 800_000)).toBe(314_200 * 0.2 + 380_900 * 0.4);
  });
  it('flat codes BR and D0', () => {
    expect(paye('BR', 200_000)).toBe(40_000);
    expect(paye('D0', 200_000)).toBe(80_000);
    expect(paye('NT', 900_000)).toBe(0);
  });
  it('K code adds pay and is capped at 50% of pay', () => {
    // K475: £396.59 added; taxable £2,396 at 20% = £479.20.
    expect(paye('K475', 200_000)).toBe(47_920);
    // A large K code on small pay hits the 50% limit.
    expect(paye('K9999', 100_000)).toBe(50_000);
  });
  it('Scottish bands', () => {
    // S1257L £3,000: taxable £1,951 → 236×19% + 1,008×20% + 707×21%.
    expect(paye('S1257L', 300_000)).toBe(4_484 + 20_160 + 14_847);
  });
});

describe('National Insurance', () => {
  const m = R.ni.monthly;
  it('category A on £4,000 a month', () => {
    expect(computeNi('A', 400_000, m, R.ni)).toMatchObject({ employeePence: 23_616, employerPence: 53_745 });
  });
  it('2% above the upper earnings limit', () => {
    // £6,000: 8% × (4,189 − 1,048) + 2% × 1,811 = 251.28 + 36.22.
    expect(computeNi('A', 600_000, m, R.ni).employeePence).toBe(25_128 + 3_622);
  });
  it('nothing below the thresholds', () => {
    expect(computeNi('A', 40_000, m, R.ni)).toMatchObject({ employeePence: 0, employerPence: 0 });
  });
  it('under 21 (M): no employer NI up to the upper threshold', () => {
    expect(computeNi('M', 300_000, m, R.ni).employerPence).toBe(0);
    expect(computeNi('M', 500_000, m, R.ni).employerPence).toBe(roundHalfDown((500_000 - 418_900) * 0.15));
  });
  it('over State Pension age (C): employer only', () => {
    expect(computeNi('C', 300_000, m, R.ni)).toMatchObject({ employeePence: 0, employerPence: roundHalfDown((300_000 - 41_700) * 0.15) });
  });
  it('X pays no NI', () => {
    expect(computeNi('X', 900_000, m, R.ni)).toMatchObject({ employeePence: 0, employerPence: 0 });
  });
  it('directors pay on the annual method (nothing until the annual threshold)', () => {
    const first = computeDirectorNi('A', 500_000, { niablePence: 0, employeePence: 0, employerPence: 0 }, R.ni);
    expect(first.employeePence).toBe(0);
    const later = computeDirectorNi('A', 500_000, { niablePence: 1_500_000, employeePence: 0, employerPence: 0 }, R.ni);
    expect(later.employeePence).toBe(roundHalfDown((2_000_000 - 1_257_000) * 0.08));
  });
});

describe('student loans', () => {
  it('Plan 2 rounds down to whole pounds', () => {
    // £2,500 − £2,448.75 = £51.25 × 9% = £4.61 → £4.
    expect(computeStudentLoans(250_000, ['PLAN_2'], false, R.studentLoan).studentLoanPence).toBe(400);
  });
  it('lowest threshold when two plans', () => {
    const one = computeStudentLoans(300_000, ['PLAN_1'], false, R.studentLoan).studentLoanPence;
    expect(computeStudentLoans(300_000, ['PLAN_1', 'PLAN_2'], false, R.studentLoan).studentLoanPence).toBe(one);
  });
  it('postgraduate loan at 6%', () => {
    // £3,000 − £1,750 = £1,250 × 6% = £75.
    expect(computeStudentLoans(300_000, [], true, R.studentLoan).postgradLoanPence).toBe(7_500);
  });
});

describe('workplace pension', () => {
  const base = { status: 'AUTO' as const, scheme: 'RELIEF_AT_SOURCE' as const, basis: 'QUALIFYING' as const, employeePct: 5, employerPct: 3 };
  it('assesses workers', () => {
    expect(assessAutoEnrolment(30, 300_000, R.pension)).toBe('ELIGIBLE_JOBHOLDER');
    expect(assessAutoEnrolment(20, 300_000, R.pension)).toBe('NON_ELIGIBLE_JOBHOLDER');
    expect(assessAutoEnrolment(30, 60_000, R.pension)).toBe('NON_ELIGIBLE_JOBHOLDER');
    expect(assessAutoEnrolment(30, 40_000, R.pension)).toBe('ENTITLED_WORKER');
    expect(assessAutoEnrolment(null, 300_000, R.pension)).toBe('NOT_ASSESSED');
  });
  it('auto-enrols an eligible jobholder: relief at source on qualifying earnings', () => {
    const r = computePension({ settings: base, ageYears: 35, qualifyingEarningsPence: 400_000, periodEnd: '2026-11-30', rates: R.pension, basicRatePct: 20 });
    // Qualifying earnings £4,000 − £520 = £3,480: 5% = £174.00 gross, £139.20 from pay; employer 3% = £104.40.
    expect(r).toMatchObject({ member: true, action: 'ENROLLED', pensionablePence: 348_000, employeeGrossPence: 17_400, employeeDeductedPence: 13_920, employerPence: 10_440 });
  });
  it('respects opt-out and postponement', () => {
    expect(computePension({ settings: { ...base, status: 'OPTED_OUT' }, ageYears: 35, qualifyingEarningsPence: 400_000, periodEnd: '2026-11-30', rates: R.pension, basicRatePct: 20 }).member).toBe(false);
    const post = computePension({ settings: { ...base, status: 'POSTPONED', postponedUntil: '2027-03-01' }, ageYears: 35, qualifyingEarningsPence: 400_000, periodEnd: '2026-11-30', rates: R.pension, basicRatePct: 20 });
    expect(post).toMatchObject({ member: false, action: 'POSTPONED' });
  });
  it('salary sacrifice moves the employee share to the employer', () => {
    const r = computePension({ settings: { ...base, scheme: 'SALARY_SACRIFICE' }, ageYears: 35, qualifyingEarningsPence: 400_000, periodEnd: '2026-11-30', rates: R.pension, basicRatePct: 20 });
    expect(r).toMatchObject({ sacrificePence: 17_400, employeeDeductedPence: 0, employerPence: 17_400 + 10_440 });
  });
});

describe('statutory payments', () => {
  it('SSP is the lower of the flat rate and 80% of AWE, per qualifying day', () => {
    const r = computeStatutoryPay(
      [1, 2, 3].map((d) => ({ date: `2026-11-0${d + 1}`, code: 'SSP' as const, units: 1, absenceStart: '2026-11-02' })),
      46_154,
      R.statutoryPay,
    );
    expect(r.lines[0]).toMatchObject({ code: 'SSP', days: 3, amountPence: roundHalfDown((12_325 / 5) * 3) });
  });
  it('SSP for a low earner is 80% of AWE', () => {
    const r = computeStatutoryPay([{ date: '2026-11-02', code: 'SSP', units: 1, absenceStart: '2026-11-02' }], 10_000, R.statutoryPay);
    expect(r.lines[0]!.amountPence).toBe(1_600);
  });
  it('SMP: 90% of AWE for 6 weeks, then the flat rate', () => {
    const early = computeStatutoryPay([{ date: '2026-11-02', code: 'SMP', units: 5, absenceStart: '2026-11-02' }], 60_000, R.statutoryPay);
    expect(early.lines[0]!.amountPence).toBe(54_000);
    const later = computeStatutoryPay([{ date: '2027-01-04', code: 'SMP', units: 5, absenceStart: '2026-11-02' }], 60_000, R.statutoryPay);
    expect(later.lines[0]!.amountPence).toBe(19_432);
  });
});

describe('rates', () => {
  it('tenant overrides are merged for the tax year', () => {
    const r = ukRatesFor(2026, { '2026': { statutoryPay: { sspWeekly: 12_000 } } });
    expect(r.statutoryPay.sspWeekly).toBe(12_000);
    expect(r.statutoryPay.familyWeekly).toBe(R.statutoryPay.familyWeekly);
    expect(r.version).toContain('tenant');
  });
  it('falls back to the latest known year', () => {
    expect(ukRatesFor(2027).taxYear).toBe(2027);
  });
  it('age on a date', () => {
    expect(ageOn('1990-12-01', '2026-11-30')).toBe(35);
    expect(ageOn('1990-11-30', '2026-11-30')).toBe(36);
  });
});

describe('UK pay item', () => {
  const input = (over: Partial<UkCalcInput> = {}): UkCalcInput => ({
    period: '2026-11',
    periodEnd: '2026-11-30',
    taxYear: 2026,
    taxMonth: 1,
    structure: [{ code: 'BASIC', label: 'Basic salary', monthlyPaise: 400_000, annualPaise: 4_800_000 }],
    grossFixedPaise: 400_000,
    days: { workingDays: 21, eligibleDays: 21, paidLeaveDays: 0, unpaidLeaveDays: 0, absentDays: 0, projectedDays: 0 },
    profile: ukPayrollProfileSchema.parse({ taxCode: '1257L' }),
    dateOfBirth: '1990-01-15',
    ytd: { taxablePayPence: 0, taxPence: 0, niablePayPence: 0, niEmployeePence: 0, niEmployerPence: 0 },
    statutoryDays: [],
    shiftNetMinutes: 450,
    rates: R,
    ...over,
  });

  it('£48,000 a year: tax, NI and pension', () => {
    const r = calculateItemUk(input());
    expect(r.errors).toEqual([]);
    expect(r.tdsPaise).toBe(59_020);
    expect(r.ukStatutory).toMatchObject({ niEmployeePence: 23_616, niEmployerPence: 53_745, pensionEmployeePence: 17_400, pensionEmployerPence: 10_440, aeAction: 'ENROLLED' });
    expect(r.netPaise).toBe(400_000 - 59_020 - 23_616 - 13_920);
    expect(r.employerContribPaise).toBe(53_745 + 10_440);
    expect(r.roundingPaise).toBe(0);
    expect(r.lines.map((l) => l.componentCode)).toEqual(['BASIC', 'PAYE', 'NI_EE', 'PENSION_EE', 'NI_ER', 'PENSION_ER']);
  });

  it('sick days are unpaid salary plus SSP, and both are taxed', () => {
    const r = calculateItemUk(
      input({
        days: { workingDays: 20, eligibleDays: 20, paidLeaveDays: 0, unpaidLeaveDays: 2, absentDays: 0, projectedDays: 0 },
        statutoryDays: [
          { date: '2026-11-02', code: 'SSP', units: 1, absenceStart: '2026-11-02' },
          { date: '2026-11-03', code: 'SSP', units: 1, absenceStart: '2026-11-02' },
        ],
      }),
    );
    expect(r.grossEarnedPaise).toBe(360_000);
    const ssp = r.lines.find((l) => l.componentCode === 'SSP');
    expect(ssp?.amountPaise).toBe(roundHalfDown((12_325 / 5) * 2));
    expect(r.ukStatutory.niablePayPence).toBe(360_000 + ssp!.amountPaise);
  });

  it('salary sacrifice lowers taxable and NIable pay', () => {
    const profile = ukPayrollProfileSchema.parse({ taxCode: '1257L', pension: { scheme: 'SALARY_SACRIFICE' } });
    const r = calculateItemUk(input({ profile }));
    expect(r.ukStatutory.niablePayPence).toBe(400_000 - 17_400);
    expect(r.lines.find((l) => l.componentCode === 'PENSION_SS')?.amountPaise).toBe(17_400);
  });

  it('uses P45 figures from earlier in the same tax year', () => {
    const profile = ukPayrollProfileSchema.parse({ taxCode: '1257L', previousPayPence: 1_200_000, previousTaxPence: 150_000, previousTaxYear: 2026 });
    const r = calculateItemUk(input({ profile, taxMonth: 4 }));
    expect(r.ukStatutory.taxablePayYtdPence).toBe(1_600_000);
  });

  it('flags an invalid tax code and pay below the minimum wage', () => {
    expect(calculateItemUk(input({ profile: { ...ukPayrollProfileSchema.parse({ taxCode: '1257L' }), taxCode: 'BAD' } })).errors[0]).toContain('Invalid tax code');
    const low = calculateItemUk(input({ structure: [{ code: 'BASIC', label: 'Basic', monthlyPaise: 100_000, annualPaise: 1_200_000 }], grossFixedPaise: 100_000 }));
    expect(low.warnings.join(' ')).toContain('minimum wage');
  });

  it('student loan and postgraduate loan lines', () => {
    const profile = ukPayrollProfileSchema.parse({ taxCode: '1257L', studentLoanPlans: ['PLAN_2'], postgraduateLoan: true });
    const r = calculateItemUk(input({ profile }));
    expect(r.lines.some((l) => l.componentCode === 'SL')).toBe(true);
    expect(r.lines.some((l) => l.componentCode === 'PGL')).toBe(true);
  });
});
