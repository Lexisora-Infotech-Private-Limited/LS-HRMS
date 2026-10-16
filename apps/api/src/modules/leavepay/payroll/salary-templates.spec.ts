import { describe, expect, it } from 'vitest';
import { STANDARD_SALARY_LINES, validateSalaryTemplateLines, type SalaryTemplateLine } from '@lexisora/shared';
import { calculateItem, type CalcInput } from './payroll-calc';
import { buildStructure, lowestWorkingCtc, structureFromGross, pickTemplate, templatesOverlap, type SalaryTemplateData, type TemplateLine } from './salary';

const P = (rupees: number) => rupees * 100;

const line = (over: Partial<SalaryTemplateLine> & Pick<SalaryTemplateLine, 'componentCode' | 'calc'>): SalaryTemplateLine => ({ label: over.componentCode, kind: 'EARNING', ...over });

describe('validateSalaryTemplateLines', () => {
  it('accepts the standard structure', () => {
    expect(validateSalaryTemplateLines(STANDARD_SALARY_LINES)).toEqual([]);
  });

  it('accepts a custom structure with a fixed allowance and a percentage deduction', () => {
    const lines: SalaryTemplateLine[] = [
      line({ componentCode: 'BASIC', calc: 'PERCENT_OF_GROSS', value: 40 }),
      line({ componentCode: 'HRA', calc: 'PERCENT_OF_COMPONENT', value: 40, base: 'BASIC' }),
      line({ componentCode: 'CONV', calc: 'FIXED', value: 1600 }),
      line({ componentCode: 'SPECIAL', calc: 'BALANCING' }),
      line({ componentCode: 'WELFARE', calc: 'PERCENT_OF_COMPONENT', value: 2, base: 'BASIC', kind: 'DEDUCTION' }),
    ];
    expect(validateSalaryTemplateLines(lines)).toEqual([]);
  });

  it('rejects: no Basic, no balancing component, earnings above 100%, bad base, reserved and duplicate codes', () => {
    expect(validateSalaryTemplateLines([line({ componentCode: 'SPECIAL', calc: 'BALANCING' })]).join()).toMatch(/BASIC earning is required/);
    expect(validateSalaryTemplateLines([line({ componentCode: 'BASIC', calc: 'PERCENT_OF_GROSS', value: 50 })]).join()).toMatch(/exactly one balancing/);
    expect(
      validateSalaryTemplateLines([
        line({ componentCode: 'BASIC', calc: 'PERCENT_OF_GROSS', value: 70 }),
        line({ componentCode: 'HRA', calc: 'PERCENT_OF_GROSS', value: 50 }),
        line({ componentCode: 'SPECIAL', calc: 'BALANCING' }),
      ]).join(),
    ).toMatch(/more than 100%/);
    expect(
      validateSalaryTemplateLines([
        line({ componentCode: 'BASIC', calc: 'PERCENT_OF_GROSS', value: 50 }),
        line({ componentCode: 'HRA', calc: 'PERCENT_OF_COMPONENT', value: 50, base: 'CONV' }),
        line({ componentCode: 'SPECIAL', calc: 'BALANCING' }),
      ]).join(),
    ).toMatch(/must be an earning listed above/);
    expect(validateSalaryTemplateLines([...STANDARD_SALARY_LINES, line({ componentCode: 'PF_EE', calc: 'FIXED', value: 1 })]).join()).toMatch(/reserved/);
    expect(validateSalaryTemplateLines([...STANDARD_SALARY_LINES, line({ componentCode: 'HRA', calc: 'FIXED', value: 1 })]).join()).toMatch(/used twice/);
  });

  it('any earning can be a % of gross; a % of another component is always of Basic', () => {
    const asGross = [line({ componentCode: 'BASIC', calc: 'PERCENT_OF_GROSS', value: 40 }), line({ componentCode: 'HRA', calc: 'PERCENT_OF_GROSS', value: 20 }), line({ componentCode: 'SPECIAL', calc: 'BALANCING' })];
    expect(validateSalaryTemplateLines(asGross)).toEqual([]);
    // the shares still have to fit inside the gross
    expect(validateSalaryTemplateLines([line({ componentCode: 'BASIC', calc: 'PERCENT_OF_GROSS', value: 60 }), line({ componentCode: 'HRA', calc: 'PERCENT_OF_GROSS', value: 50 }), line({ componentCode: 'SPECIAL', calc: 'BALANCING' })]).join()).toMatch(/more than 100%/);
    const ofOther = [
      line({ componentCode: 'BASIC', calc: 'PERCENT_OF_GROSS', value: 40 }),
      line({ componentCode: 'HRA', calc: 'PERCENT_OF_COMPONENT', value: 50, base: 'BASIC' }),
      line({ componentCode: 'CONV', calc: 'PERCENT_OF_COMPONENT', value: 10, base: 'HRA' }),
      line({ componentCode: 'SPECIAL', calc: 'BALANCING' }),
    ];
    expect(validateSalaryTemplateLines(ofOther).join()).toMatch(/always of Basic/);
    // % of Basic and fixed amounts are fine, and a company deduction may still be a % of gross
    const ok = [...STANDARD_SALARY_LINES, line({ componentCode: 'CONV', calc: 'FIXED', value: 1600 }), line({ componentCode: 'CUT', calc: 'PERCENT_OF_GROSS', value: 1, kind: 'DEDUCTION' })];
    expect(validateSalaryTemplateLines(ok)).toEqual([]);
  });

  it('rejects company deductions above 50% of gross', () => {
    const lines = [...STANDARD_SALARY_LINES, line({ componentCode: 'BIGCUT', calc: 'PERCENT_OF_GROSS', value: 60, kind: 'DEDUCTION' })];
    expect(validateSalaryTemplateLines(lines).join()).toMatch(/50% of gross/);
  });
});

describe('structure from a custom template', () => {
  const custom: TemplateLine[] = [
    { componentCode: 'BASIC', label: 'Basic', calc: 'PERCENT_OF_GROSS', value: 40 },
    { componentCode: 'HRA', label: 'HRA', calc: 'PERCENT_OF_COMPONENT', value: 50, base: 'BASIC' },
    { componentCode: 'CONV', label: 'Conveyance', calc: 'FIXED', value: 1600 },
    { componentCode: 'SPECIAL', label: 'Special allowance', calc: 'BALANCING' },
    { componentCode: 'WELFARE', label: 'Welfare fund', kind: 'DEDUCTION', calc: 'PERCENT_OF_COMPONENT', value: 2, base: 'BASIC' },
  ];

  it('splits gross by the template and keeps deductions out of gross and CTC', () => {
    const s = buildStructure({ grossMonthlyPaise: P(100_000) }, { payType: 'SALARY', template: custom });
    const by = Object.fromEntries(s.lines.map((l) => [l.code, l]));
    expect(by.BASIC!.monthlyPaise).toBe(P(40_000));
    expect(by.HRA!.monthlyPaise).toBe(P(20_000));
    expect(by.CONV!.monthlyPaise).toBe(P(1_600));
    expect(by.SPECIAL!.monthlyPaise).toBe(P(38_400)); // 100,000 − 40,000 − 20,000 − 1,600
    expect(by.WELFARE!.kind).toBe('DEDUCTION');
    expect(by.WELFARE!.monthlyPaise).toBe(P(800)); // 2% of Basic
    const earnings = s.lines.filter((l) => l.kind !== 'DEDUCTION' && l.code !== 'PF_ER' && l.code !== 'ESI_ER');
    expect(earnings.reduce((a, l) => a + l.monthlyPaise, 0)).toBe(P(100_000));
    expect(s.ctcMonthlyPaise).toBe(P(100_000) + by.PF_ER!.monthlyPaise);
  });

  it('the default (no template) split is unchanged: 50 / 50% of Basic / balance', () => {
    const s = buildStructure({ grossMonthlyPaise: P(84_000) }, { payType: 'SALARY' });
    const by = Object.fromEntries(s.lines.map((l) => [l.code, l.monthlyPaise]));
    expect(by).toMatchObject({ BASIC: P(42_000), HRA: P(21_000), SPECIAL: P(21_000), PF_ER: P(1_800) });
  });

  it('solves gross from an annual CTC with a custom template', () => {
    const s = buildStructure({ ctcAnnualPaise: P(9_00_000) }, { payType: 'SALARY', template: custom });
    expect(Math.abs(s.ctcAnnualPaise - P(9_00_000))).toBeLessThan(P(24));
  });
});

describe('payroll takes company deductions', () => {
  it('subtracts the template deduction from net pay', () => {
    const custom: TemplateLine[] = [...(STANDARD_SALARY_LINES as TemplateLine[]), { componentCode: 'WELFARE', label: 'Welfare fund', kind: 'DEDUCTION', calc: 'FIXED', value: 500 }];
    const s = buildStructure({ grossMonthlyPaise: P(84_000) }, { payType: 'SALARY', template: custom });
    const base: CalcInput = {
      period: '2026-09',
      payType: 'SALARY',
      structure: s.lines.filter((l) => l.kind !== 'DEDUCTION' && l.code !== 'PF_ER' && l.code !== 'ESI_ER'),
      customDeductions: s.lines.filter((l) => l.kind === 'DEDUCTION'),
      grossFixedPaise: s.grossMonthlyPaise,
      days: { workingDays: 22, eligibleDays: 22, paidLeaveDays: 0, unpaidLeaveDays: 0, absentDays: 0, projectedDays: 0 },
      idle: { apply: true, rawMinutes: 0, allowanceMinutes: 60, shiftNetMinutes: 480 },
      profile: { pfEnabled: true, pfCeilingOpted: true, esiMode: 'AUTO', ptStateCode: 'GJ', taxRegime: 'NEW' },
      tax: { ytdMonths: 5, missingPriorMonths: 0, ytdTaxablePaise: P(84_000 * 5), ytdTdsPaise: 0, ytdPfEePaise: P(9_000), ytdPtPaise: P(1_000) },
    };
    const withCut = calculateItem(base);
    const without = calculateItem({ ...base, customDeductions: [] });
    expect(without.netPaise - withCut.netPaise).toBe(P(500));
    expect(withCut.lines.find((l) => l.componentCode === 'WELFARE')).toMatchObject({ kind: 'DEDUCTION', amountPaise: P(500) });
    expect(withCut.totalDeductionsPaise - without.totalDeductionsPaise).toBe(P(500));
    // No paid days → nothing is deducted.
    expect(calculateItem({ ...base, days: { ...base.days, eligibleDays: 0 } }).lines.some((l) => l.componentCode === 'WELFARE')).toBe(false);
  });
});

describe('pickTemplate / templatesOverlap', () => {
  const t = (id: string, over: Partial<SalaryTemplateData>): SalaryTemplateData => ({ id, name: id, payType: 'SALARY', employmentTypes: [], minCtcPaise: null, maxCtcPaise: null, isDefault: false, active: true, lines: [], ...over });
  const A = t('A', { minCtcPaise: P(0), maxCtcPaise: P(3_00_000) });
  const B = t('B', { minCtcPaise: P(3_00_000), maxCtcPaise: P(6_00_000) });
  const C = t('C', { minCtcPaise: P(6_00_000), maxCtcPaise: null });
  const D = t('D', { isDefault: true });

  it('chooses the structure whose CTC range contains the CTC (lower bound inclusive, upper exclusive)', () => {
    const all = [A, B, C, D];
    expect(pickTemplate(all, { payType: 'SALARY', ctcAnnualPaise: P(2_99_999) })?.id).toBe('A');
    expect(pickTemplate(all, { payType: 'SALARY', ctcAnnualPaise: P(3_00_000) })?.id).toBe('B');
    expect(pickTemplate(all, { payType: 'SALARY', ctcAnnualPaise: P(12_00_000) })?.id).toBe('C');
  });

  it('falls back to the default, then to nothing (built-in Standard)', () => {
    expect(pickTemplate([A, D], { payType: 'SALARY', ctcAnnualPaise: P(9_00_000) })?.id).toBe('D');
    expect(pickTemplate([A], { payType: 'SALARY', ctcAnnualPaise: P(9_00_000) })).toBeNull();
  });

  it('ignores inactive templates and respects employment type', () => {
    expect(pickTemplate([{ ...A, active: false }, D], { payType: 'SALARY', ctcAnnualPaise: P(1_00_000) })?.id).toBe('D');
    const contractOnly = t('K', { employmentTypes: ['CONTRACT'], minCtcPaise: 0, maxCtcPaise: P(10_00_000) });
    expect(pickTemplate([contractOnly, D], { payType: 'SALARY', employmentType: 'FULL_TIME', ctcAnnualPaise: P(5_00_000) })?.id).toBe('D');
    expect(pickTemplate([contractOnly, D], { payType: 'SALARY', employmentType: 'CONTRACT', ctcAnnualPaise: P(5_00_000) })?.id).toBe('K');
  });

  it('detects overlapping ranges but allows touching ones', () => {
    expect(templatesOverlap(A, B)).toBe(false); // [0,3L) and [3L,6L)
    expect(templatesOverlap(B, { minCtcPaise: P(5_00_000), maxCtcPaise: P(8_00_000), employmentTypes: [] })).toBe(true);
    expect(templatesOverlap({ ...A, employmentTypes: ['INTERN'] }, { minCtcPaise: P(1_00_000), maxCtcPaise: P(2_00_000), employmentTypes: ['CONTRACT'] })).toBe(false);
  });
});

describe('configurable PF rate and wage ceiling', () => {
  const pf = { employeePct: 10, employerPct: 10, wageCeiling: 20000 };

  it('the structure uses the configured employer PF: 10% of Basic up to a 20,000 ceiling', () => {
    const s = buildStructure({ grossMonthlyPaise: P(84_000) }, { payType: 'SALARY', pf });
    expect(s.lines.find((l) => l.code === 'PF_ER')!.monthlyPaise).toBe(P(2_000)); // Basic 42,000 → capped 20,000 × 10%
    const d = buildStructure({ grossMonthlyPaise: P(84_000) }, { payType: 'SALARY' });
    expect(d.lines.find((l) => l.code === 'PF_ER')!.monthlyPaise).toBe(P(1_800)); // statutory default unchanged
  });

  it('payroll deducts the configured employee PF and shows the employer share', () => {
    const s = buildStructure({ grossMonthlyPaise: P(84_000) }, { payType: 'SALARY', pf });
    const base: CalcInput = {
      period: '2026-09',
      payType: 'SALARY',
      structure: s.lines.filter((l) => l.code !== 'PF_ER' && l.code !== 'ESI_ER'),
      pfConfig: pf,
      grossFixedPaise: s.grossMonthlyPaise,
      days: { workingDays: 22, eligibleDays: 22, paidLeaveDays: 0, unpaidLeaveDays: 0, absentDays: 0, projectedDays: 0 },
      idle: { apply: true, rawMinutes: 0, allowanceMinutes: 60, shiftNetMinutes: 480 },
      profile: { pfEnabled: true, pfCeilingOpted: true, esiMode: 'AUTO', ptStateCode: 'GJ', taxRegime: 'NEW' },
      tax: { ytdMonths: 5, missingPriorMonths: 0, ytdTaxablePaise: P(84_000 * 5), ytdTdsPaise: 0, ytdPfEePaise: P(9_000), ytdPtPaise: P(1_000) },
    };
    const r = calculateItem(base);
    expect(r.pfEePaise).toBe(P(2_000));
    expect(r.pfErPaise).toBe(P(2_000));
    // Without the config the statutory 12% on 15,000 applies.
    expect(calculateItem({ ...base, pfConfig: undefined }).pfEePaise).toBe(P(1_800));
    // PF switched off for the employee: no PF at all, whatever the structure says.
    expect(calculateItem({ ...base, profile: { ...base.profile, pfEnabled: false } }).pfEePaise).toBe(0);
  });
});

describe('ESI on/off, rates and gross limit', () => {
  const noPf = { employeePct: 0, employerPct: 0, wageCeiling: 15000 };
  const esiOn = { enabled: true, employeePct: 1, employerPct: 2, grossLimit: 30000 };

  it('default ESI: employer 3.25% of gross when gross is within 21,000 (CTC 1,80,000 → gross 14,527 + ESI 473)', () => {
    const s = buildStructure({ ctcAnnualPaise: P(180_000) }, { payType: 'SALARY', pf: noPf });
    expect(s.lines.find((l) => l.code === 'ESI_ER')!.monthlyPaise).toBe(P(473));
    expect(s.grossMonthlyPaise).toBe(P(14_527));
  });

  it('a structure can switch ESI off: no ESI line and the whole CTC becomes gross', () => {
    const s = buildStructure({ ctcAnnualPaise: P(180_000) }, { payType: 'SALARY', pf: noPf, esi: { ...esiOn, enabled: false } });
    expect(s.lines.some((l) => l.code === 'ESI_ER')).toBe(false);
    expect(s.grossMonthlyPaise).toBe(P(15_000));
  });

  it('custom employer % and gross limit: 2% up to 30,000 covers a 25,000 gross that the default would not', () => {
    const custom = buildStructure({ grossMonthlyPaise: P(25_000) }, { payType: 'SALARY', pf: noPf, esi: esiOn });
    expect(custom.lines.find((l) => l.code === 'ESI_ER')!.monthlyPaise).toBe(P(500));
    const dflt = buildStructure({ grossMonthlyPaise: P(25_000) }, { payType: 'SALARY', pf: noPf });
    expect(dflt.lines.some((l) => l.code === 'ESI_ER')).toBe(false);
  });

  it('payroll applies the configured ESI, and honours Off / the structure switch', () => {
    const s = buildStructure({ grossMonthlyPaise: P(25_000) }, { payType: 'SALARY', pf: noPf, esi: esiOn });
    const base: CalcInput = {
      period: '2026-09',
      payType: 'SALARY',
      structure: s.lines.filter((l) => l.code !== 'PF_ER' && l.code !== 'ESI_ER'),
      esiConfig: esiOn,
      grossFixedPaise: s.grossMonthlyPaise,
      days: { workingDays: 22, eligibleDays: 22, paidLeaveDays: 0, unpaidLeaveDays: 0, absentDays: 0, projectedDays: 0 },
      idle: { apply: true, rawMinutes: 0, allowanceMinutes: 60, shiftNetMinutes: 480 },
      profile: { pfEnabled: false, pfCeilingOpted: true, esiMode: 'AUTO', ptStateCode: 'GJ', taxRegime: 'NEW' },
      tax: { ytdMonths: 5, missingPriorMonths: 0, ytdTaxablePaise: P(25_000 * 5), ytdTdsPaise: 0, ytdPfEePaise: 0, ytdPtPaise: P(1_000) },
    };
    const on = calculateItem(base);
    expect(on.esiEePaise).toBe(P(250)); // 1% of 25,000
    expect(on.esiErPaise).toBe(P(500)); // 2% of 25,000
    expect(calculateItem({ ...base, esiConfig: undefined }).esiEePaise).toBe(0); // default limit 21,000 → not covered
    expect(calculateItem({ ...base, esiConfig: { ...esiOn, enabled: false } }).esiEePaise).toBe(0); // structure switch
    expect(calculateItem({ ...base, profile: { ...base.profile, esiMode: 'FORCE_OFF' } }).esiEePaise).toBe(0); // per employee Off
    // Always on with the default limit still applies ESI above 21,000
    expect(calculateItem({ ...base, esiConfig: undefined, profile: { ...base.profile, esiMode: 'FORCE_ON' } }).esiEePaise).toBeGreaterThan(0);
  });
});

describe('lowest CTC at which a structure works', () => {
  // The structure from the review: Basic 50% of gross, HRA ₹4,500 and Special ₹1,500 fixed, Conveyance = balance, PF 5%, ESI off.
  const lines: TemplateLine[] = [
    { componentCode: 'BASIC', label: 'Basic', calc: 'PERCENT_OF_GROSS', value: 50 },
    { componentCode: 'HRA', label: 'HRA', calc: 'FIXED', value: 4500 },
    { componentCode: 'SPECIAL', label: 'Special allowance', calc: 'FIXED', value: 1500 },
    { componentCode: 'CONV', label: 'Conveyance', calc: 'BALANCING' },
  ];
  const opts = { payType: 'SALARY' as const, template: lines, pf: { employeePct: 5, employerPct: 5, wageCeiling: 15000 }, esi: { enabled: false, employeePct: 0.75, employerPct: 3.25, grossLimit: 21000 } };
  const negative = (ctc: number) => buildStructure({ ctcAnnualPaise: ctc }, opts).lines.some((l) => l.kind !== 'DEDUCTION' && l.monthlyPaise < 0);

  it('finds the floor (about ₹1,48,000) and the structure is negative below it and fine from it', () => {
    const floor = lowestWorkingCtc(opts);
    expect(floor).toBeGreaterThan(P(1_46_000));
    expect(floor).toBeLessThan(P(1_50_000));
    expect(floor % P(1_000)).toBe(0); // rounded up to the next ₹1,000
    expect(negative(P(1_00_000))).toBe(true); // the case in the screenshot: Conveyance −₹1,935
    expect(negative(floor)).toBe(false);
    expect(negative(floor - P(5_000))).toBe(true);
  });

  it('names the real balance component in the warning (not always "Special allowance")', () => {
    const s = buildStructure({ ctcAnnualPaise: P(1_00_000) }, opts);
    expect(s.warnings.join()).toMatch(/Conveyance would be negative/);
  });

  it('a structure with percentages only (no fixed amounts) works at any CTC', () => {
    expect(lowestWorkingCtc({ payType: 'SALARY', template: STANDARD_SALARY_LINES as TemplateLine[] })).toBe(0);
  });
});

describe('allowances as a % of gross', () => {
  it('HRA 20% of gross is 20% of the monthly gross, not of Basic', () => {
    const tpl: TemplateLine[] = [
      { componentCode: 'BASIC', label: 'Basic', calc: 'PERCENT_OF_GROSS', value: 40 },
      { componentCode: 'HRA', label: 'HRA', calc: 'PERCENT_OF_GROSS', value: 20 },
      { componentCode: 'SPECIAL', label: 'Special allowance', calc: 'BALANCING' },
    ];
    const s = structureFromGross(10_000_000, { payType: 'SALARY', template: tpl }); // gross Rs 1,00,000
    const by = Object.fromEntries(s.lines.map((l) => [l.code, l.monthlyPaise]));
    expect(by.BASIC).toBe(4_000_000);
    expect(by.HRA).toBe(2_000_000); // 20% of the gross (it would be 8,00,000 paise if it were 20% of Basic)
    expect(by.SPECIAL).toBe(4_000_000); // the balance
  });
});
