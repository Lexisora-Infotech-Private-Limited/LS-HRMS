import { describe, expect, it } from 'vitest';
import { annualTax, computeEsi, computePf, computePt, esiCovered, monthlyTds, taxableIncome } from './statutory';
import { buildStructure, grossFromCtc } from './salary';
import { rupeesInWords } from './num-words';

const P = (rupees: number) => rupees * 100;

describe('PF', () => {
  it('caps the wage at ₹15,000: 12% = ₹1,800 employee and employer', () => {
    const pf = computePf(P(42_000), { enabled: true, ceilingOpted: true });
    expect(pf.eePaise).toBe(P(1_800));
    expect(pf.erPaise).toBe(P(1_800));
    expect(pf.epsPaise).toBe(P(1_250));
    expect(pf.epfErPaise).toBe(P(550));
  });
  it('uses the actual wage below the ceiling', () => {
    expect(computePf(P(10_000), { enabled: true, ceilingOpted: true }).eePaise).toBe(P(1_200));
  });
  it('uncapped when the employee opted out of the ceiling', () => {
    expect(computePf(P(42_000), { enabled: true, ceilingOpted: false }).eePaise).toBe(P(5_040));
  });
  it('is skipped when disabled', () => {
    expect(computePf(P(42_000), { enabled: false, ceilingOpted: true }).eePaise).toBe(0);
  });
});

describe('ESI', () => {
  it('covers gross up to ₹21,000 only', () => {
    expect(esiCovered(P(21_000))).toBe(true);
    expect(esiCovered(P(21_001))).toBe(false);
    expect(esiCovered(P(84_000))).toBe(false);
  });
  it('0.75% employee / 3.25% employer rounded up to the rupee', () => {
    const e = computeEsi(P(20_000), true, 22);
    expect(e.eePaise).toBe(P(150));
    expect(e.erPaise).toBe(P(650));
  });
  it('employee share is nil when the daily average wage is ≤ ₹176', () => {
    const e = computeEsi(P(3_500), true, 22);
    expect(e.eePaise).toBe(0);
    expect(e.erPaise).toBe(P(114));
  });
});

describe('Professional tax', () => {
  it('Gujarat: ₹200 at ₹12,000 and above, nil below', () => {
    expect(computePt('GJ', P(84_000), 9)).toBe(P(200));
    expect(computePt('GJ', P(12_000), 9)).toBe(P(200));
    expect(computePt('GJ', P(11_999), 9)).toBe(0);
    expect(computePt('GJ', 0, 9)).toBe(0);
  });
  it('Maharashtra male: ₹200, ₹300 in February; slabs below', () => {
    expect(computePt('MH', P(30_000), 9, 'M')).toBe(P(200));
    expect(computePt('MH', P(30_000), 2, 'M')).toBe(P(300));
    expect(computePt('MH', P(9_000), 9, 'M')).toBe(P(175));
    expect(computePt('MH', P(7_000), 9, 'M')).toBe(0);
  });
  it('Maharashtra female: nil up to ₹25,000', () => {
    expect(computePt('MH', P(25_000), 9, 'F')).toBe(0);
    expect(computePt('MH', P(30_000), 9, 'F')).toBe(P(200));
  });
});

describe('Income tax FY 2026-27', () => {
  it('NEW: ₹12.1 L taxable gets marginal relief → ₹10,400', () => {
    expect(annualTax(12_10_000, 'NEW')).toBe(10_400);
  });
  it('NEW: full rebate up to ₹12 L', () => {
    expect(annualTax(12_00_000, 'NEW')).toBe(0);
    expect(annualTax(9_33_000, 'NEW')).toBe(0);
  });
  it('NEW: ₹17.25 L taxable → ₹1,50,800', () => {
    expect(annualTax(17_25_000, 'NEW')).toBe(1_50_800);
  });
  it('OLD: 87A rebate up to ₹5 L; 20% slab above', () => {
    expect(annualTax(5_00_000, 'OLD')).toBe(0);
    expect(annualTax(6_00_000, 'OLD')).toBe(Math.round((12_500 + 20_000) * 1.04 * 100) / 100);
  });
  it('NEW regime: ₹1,50,000/month from April → monthly TDS ₹12,567', () => {
    const t = monthlyTds({
      regime: 'NEW', monthsRemaining: 12, missingPriorMonths: 0, ytdMonths: 0,
      ytdTaxablePaise: 0, ytdTdsPaise: 0, ytdPfEePaise: 0, ytdPtPaise: 0,
      currentTaxablePaise: P(1_50_000), fixedMonthlyTaxablePaise: P(1_50_000),
      currentBasicPaise: P(75_000), fixedBasicPaise: P(75_000), fixedHraPaise: P(37_500), pfEeMonthlyPaise: P(1_800), ptMonthlyPaise: P(200),
    });
    expect(t.annualTaxRupees).toBe(1_50_800);
    expect(t.tdsPaise).toBe(P(12_567));
  });
  it('NEW regime: ₹84,000/month stays under the rebate → TDS 0', () => {
    const t = monthlyTds({
      regime: 'NEW', monthsRemaining: 7, missingPriorMonths: 0, ytdMonths: 5,
      ytdTaxablePaise: P(84_000 * 5), ytdTdsPaise: 0, ytdPfEePaise: P(9_000), ytdPtPaise: P(1_000),
      currentTaxablePaise: P(84_000), fixedMonthlyTaxablePaise: P(84_000),
      currentBasicPaise: P(42_000), fixedBasicPaise: P(42_000), fixedHraPaise: P(21_000), pfEeMonthlyPaise: P(1_800), ptMonthlyPaise: P(200),
    });
    expect(t.tdsPaise).toBe(0);
  });
  it('OLD regime with HRA, 80C and 80D declarations (Priya) → ₹3,580/month', () => {
    const t = monthlyTds({
      regime: 'OLD', monthsRemaining: 10, missingPriorMonths: 2, ytdMonths: 0,
      ytdTaxablePaise: 0, ytdTdsPaise: 0, ytdPfEePaise: 0, ytdPtPaise: 0,
      currentTaxablePaise: P(84_000), fixedMonthlyTaxablePaise: P(84_000),
      currentBasicPaise: P(42_000), fixedBasicPaise: P(42_000), fixedHraPaise: P(21_000), pfEeMonthlyPaise: P(1_800), ptMonthlyPaise: P(200),
      declarations: { sec80CPaise: P(1_50_000), sec80DPaise: P(25_000), rentMonthlyPaise: P(15_580), metro: false },
    });
    expect(t.tdsPaise).toBe(P(3_580));
  });
  it('OLD regime deductions: HRA exemption is the least of the three limits', () => {
    const { deductions } = taxableIncome({
      regime: 'OLD', annualGrossPaise: P(10_08_000), annualBasicPaise: P(5_04_000), annualHraPaise: P(2_52_000), annualPfEePaise: P(21_600), annualPtPaise: P(2_400),
      declarations: { rentMonthlyPaise: P(15_580), metro: false },
    });
    expect(deductions.hraExemption).toBe(1_86_960 - 50_400);
    expect(deductions.sec80C).toBe(21_600);
  });
});

describe('Salary structure', () => {
  it('CTC ₹10,29,600 → gross ₹84,000: Basic 42,000, HRA 21,000, Special 21,000, PF 1,800, CTC 85,800', () => {
    const s = buildStructure({ ctcAnnualPaise: P(10_29_600) }, { payType: 'SALARY' });
    expect(s.grossMonthlyPaise).toBe(P(84_000));
    const m = Object.fromEntries(s.table.map((l) => [l.code, l.monthlyPaise / 100]));
    expect(m).toEqual({ BASIC: 42_000, HRA: 21_000, SPECIAL: 21_000, PF_ER: 1_800, CTC: 85_800 });
    expect(s.ctcAnnualPaise).toBe(P(10_29_600));
  });
  it('gross from CTC is the inverse of CTC from gross', () => {
    for (const g of [20_000, 62_000, 1_12_000]) {
      const s = buildStructure({ grossMonthlyPaise: P(g) }, { payType: 'SALARY' });
      expect(grossFromCtc(s.ctcAnnualPaise, { payType: 'SALARY' })).toBe(P(g));
    }
  });
  it('low gross is ESI-covered and adds employer ESI to CTC', () => {
    const s = buildStructure({ grossMonthlyPaise: P(20_000) }, { payType: 'SALARY' });
    expect(s.ctcMonthlyPaise).toBe(P(20_000 + 1_200 + 650));
  });
  it('stipend has a single component and CTC = stipend', () => {
    const s = buildStructure({ grossMonthlyPaise: P(15_000) }, { payType: 'STIPEND' });
    expect(s.lines.map((l) => l.code)).toEqual(['STIPEND']);
    expect(s.ctcAnnualPaise).toBe(P(1_80_000));
  });
});

describe('Amount in words (Indian system)', () => {
  it('formats lakhs and thousands', () => {
    expect(rupeesInWords(P(82_000))).toBe('Eighty-two thousand rupees only');
    expect(rupeesInWords(P(78_420))).toBe('Seventy-eight thousand four hundred and twenty rupees only');
    expect(rupeesInWords(P(1_02_880))).toBe('One lakh two thousand eight hundred and eighty rupees only');
    expect(rupeesInWords(P(1_005))).toBe('One thousand and five rupees only');
  });
});
