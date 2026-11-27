/**
 * UK statutory deductions (pure). Money in pence. Monthly pay periods; tax month 1 = April.
 *   PAYE  — tax codes (L/M/N/T, K, BR, D0–D3, NT, 0T; S = Scotland, C = Wales), cumulative or
 *           Week 1/Month 1, HMRC rounding (free pay up to the penny, taxable pay down to the
 *           pound, band limits up to the pound, tax down to the penny), K-code 50% limit.
 *   NI    — Class 1 by category letter, exact percentage method; directors on the annual method.
 *   Loans — student loan plans 1/2/4/5 (9%) and postgraduate loan (6%), rounded down to £.
 *   Pension auto-enrolment assessment and contributions on qualifying earnings.
 *   Statutory payments — SSP, SMP/SAP (90% for 6 weeks), SPP/ShPP/SPBP/SNCP.
 */
import type { UkNiCategory, UkPensionSettings, UkStatutoryPayCode, UkStudentLoanPlan } from '@lexisora/shared';
import type { TaxBand, UkRates } from './uk-rates';

/** Round to the nearest penny, half a penny rounded down (HMRC exact percentage method). */
export function roundHalfDown(x: number): number {
  const f = Math.floor(x);
  return x - f > 0.5 + 1e-9 ? f + 1 : f;
}

// ── PAYE ────────────────────────────────────────────────────────────────────────

export type TaxRegimeUk = 'rUK' | 'scotland' | 'wales';
export type ParsedTaxCode =
  | { kind: 'ALLOWANCE'; regime: TaxRegimeUk; annualPounds: number; code: string }
  | { kind: 'K'; regime: TaxRegimeUk; annualPounds: number; code: string }
  | { kind: 'FLAT'; regime: TaxRegimeUk; flat: 'BR' | 'D0' | 'D1' | 'D2' | 'D3'; code: string }
  | { kind: 'NT'; regime: TaxRegimeUk; code: string };

export function parseTaxCode(raw: string): ParsedTaxCode {
  const code = raw.trim().toUpperCase().replace(/\s+/g, '').replace(/(W1|M1|X)$/, '');
  let regime: TaxRegimeUk = 'rUK';
  let rest = code;
  if (rest.startsWith('S')) {
    regime = 'scotland';
    rest = rest.slice(1);
  } else if (rest.startsWith('C')) {
    regime = 'wales';
    rest = rest.slice(1);
  }
  if (rest === 'NT') return { kind: 'NT', regime, code };
  if (rest === 'BR' || /^D[0-3]$/.test(rest)) return { kind: 'FLAT', regime, flat: rest as 'BR', code };
  if (rest === '0T') return { kind: 'ALLOWANCE', regime, annualPounds: 0, code };
  const k = /^K(\d{1,6})$/.exec(rest);
  if (k) return { kind: 'K', regime, annualPounds: Number(k[1]) * 10 + 9, code };
  const n = /^(\d{1,6})[LMNTPY]$/.exec(rest);
  if (n) return { kind: 'ALLOWANCE', regime, annualPounds: Number(n[1]) * 10 + 9, code };
  throw new Error(`Unknown tax code "${raw}"`);
}

function bandsFor(rates: UkRates, regime: TaxRegimeUk): TaxBand[] {
  return regime === 'scotland' ? rates.bands.scotland : regime === 'wales' ? rates.bands.wales : rates.bands.rUK;
}

function flatRate(rates: UkRates, regime: TaxRegimeUk, flat: 'BR' | 'D0' | 'D1' | 'D2' | 'D3'): number {
  const set = regime === 'scotland' ? rates.flat.scotland : rates.flat.rUK;
  const v = (set as Record<string, number | undefined>)[flat];
  if (v === undefined) throw new Error(`Tax code ${flat} is not used outside Scotland`);
  return v;
}

/** Tax on cumulative taxable pay (whole pounds) using bands pro-rated to `period` of 12. */
function taxOnBands(taxablePounds: number, bands: TaxBand[], period: number, periods = 12): number {
  let remaining = Math.max(0, taxablePounds);
  let lower = 0;
  let taxPence = 0;
  for (const b of bands) {
    if (remaining <= 0) break;
    const upper = b.upTo === null ? Infinity : Math.ceil((b.upTo * period) / periods);
    const width = upper - lower;
    const inBand = Math.min(remaining, width);
    taxPence += Math.floor((inBand * 100 * b.ratePct) / 100);
    remaining -= inBand;
    lower = upper;
  }
  return taxPence;
}

export type PayeInput = {
  taxCode: string;
  cumulative: boolean;
  /** Tax month 1–12. */
  taxMonth: number;
  /** Taxable pay this period (after net-pay pension and salary sacrifice). */
  taxablePayPence: number;
  /** Taxable pay and tax in earlier periods of this tax year (incl. P45 from a previous job). */
  previousTaxablePayPence: number;
  previousTaxPence: number;
  rates: UkRates;
};
export type PayeResult = { taxPence: number; taxablePayYtdPence: number; taxYtdPence: number; freePayToDatePence: number; trace: string };

export function computePaye(i: PayeInput): PayeResult {
  const parsed = parseTaxCode(i.taxCode);
  const m = i.cumulative ? i.taxMonth : 1;
  const payToDate = (i.cumulative ? i.previousTaxablePayPence : 0) + i.taxablePayPence;
  const paidToDate = i.cumulative ? i.previousTaxPence : 0;
  let taxToDate = 0;
  let freePay = 0;
  let detail = '';

  if (parsed.kind === 'NT') {
    taxToDate = paidToDate;
    detail = 'NT: no tax';
  } else if (parsed.kind === 'FLAT') {
    const pct = flatRate(i.rates, parsed.regime, parsed.flat);
    // Flat codes are always worked on this period's pay only.
    const tax = Math.floor((i.taxablePayPence * pct) / 100);
    return {
      taxPence: tax,
      taxablePayYtdPence: i.previousTaxablePayPence + i.taxablePayPence,
      taxYtdPence: i.previousTaxPence + tax,
      freePayToDatePence: 0,
      trace: `PAYE ${parsed.code}: ${pct}% of £${(i.taxablePayPence / 100).toFixed(2)} = £${(tax / 100).toFixed(2)}`,
    };
  } else {
    // Free pay (or additional pay for K codes) to date, rounded up to the penny.
    freePay = Math.ceil((parsed.annualPounds * 100 * m) / 12);
    const taxablePounds = Math.floor((parsed.kind === 'K' ? payToDate + freePay : payToDate - freePay) / 100);
    taxToDate = taxOnBands(Math.max(0, taxablePounds), bandsFor(i.rates, parsed.regime), m);
    detail = `${parsed.kind === 'K' ? 'add' : 'free pay'} £${(freePay / 100).toFixed(2)}, taxable to date £${Math.max(0, taxablePounds)}`;
  }

  let tax = taxToDate - paidToDate;
  if (parsed.kind === 'K') {
    const limit = Math.floor((i.taxablePayPence * i.rates.overridingLimitPct) / 100);
    if (tax > limit) {
      detail += `, capped at ${i.rates.overridingLimitPct}% of pay`;
      tax = limit;
    }
  }
  if (!i.cumulative && tax < 0) tax = 0;
  return {
    taxPence: tax,
    taxablePayYtdPence: i.previousTaxablePayPence + i.taxablePayPence,
    taxYtdPence: i.previousTaxPence + tax,
    freePayToDatePence: freePay,
    trace: `PAYE ${parsed.code} ${i.cumulative ? `cumulative month ${m}` : 'month 1 basis'}: ${detail}; tax to date £${(taxToDate / 100).toFixed(2)} − paid £${(paidToDate / 100).toFixed(2)} = £${(tax / 100).toFixed(2)}`,
  };
}

// ── National Insurance ─────────────────────────────────────────────────────────

type NiThresholds = UkRates['ni']['monthly'];
type EmployerRelief = 'UST' | 'AUST' | 'VUST' | 'FUST' | 'IZUST';
type EmployeeKind = 'MAIN' | 'REDUCED' | 'DEFERRED' | 'NONE';

const NI_CATEGORY: Record<UkNiCategory, { ee: EmployeeKind; er: EmployerRelief | 'NONE' | 'STD' }> = {
  A: { ee: 'MAIN', er: 'STD' },
  B: { ee: 'REDUCED', er: 'STD' },
  C: { ee: 'NONE', er: 'STD' },
  D: { ee: 'DEFERRED', er: 'IZUST' },
  E: { ee: 'REDUCED', er: 'IZUST' },
  F: { ee: 'MAIN', er: 'FUST' },
  H: { ee: 'MAIN', er: 'AUST' },
  I: { ee: 'REDUCED', er: 'FUST' },
  J: { ee: 'DEFERRED', er: 'STD' },
  K: { ee: 'NONE', er: 'IZUST' },
  L: { ee: 'DEFERRED', er: 'FUST' },
  M: { ee: 'MAIN', er: 'UST' },
  N: { ee: 'MAIN', er: 'IZUST' },
  S: { ee: 'NONE', er: 'FUST' },
  V: { ee: 'MAIN', er: 'VUST' },
  X: { ee: 'NONE', er: 'NONE' },
  Z: { ee: 'DEFERRED', er: 'UST' },
};

export type NiResult = { employeePence: number; employerPence: number; trace: string };

/** Class 1 NI on one period's NIable pay against the period thresholds. */
export function computeNi(category: UkNiCategory, niablePence: number, t: NiThresholds, rates: UkRates['ni']): NiResult {
  const c = NI_CATEGORY[category] ?? NI_CATEGORY.A;
  const pay = Math.max(0, niablePence);
  const main = Math.max(0, Math.min(pay, t.UEL) - t.PT);
  const upper = Math.max(0, pay - t.UEL);
  let ee = 0;
  if (c.ee === 'MAIN') ee = (main * rates.employeeMainPct) / 100 + (upper * rates.employeeUpperPct) / 100;
  else if (c.ee === 'REDUCED') ee = (main * rates.employeeReducedPct) / 100 + (upper * rates.employeeUpperPct) / 100;
  else if (c.ee === 'DEFERRED') ee = ((main + upper) * rates.employeeUpperPct) / 100;
  let er = 0;
  if (c.er !== 'NONE') {
    const from = c.er === 'STD' ? t.ST : Math.max(t.ST, t[c.er]);
    er = (Math.max(0, pay - from) * rates.employerPct) / 100;
  }
  const employeePence = roundHalfDown(ee);
  const employerPence = roundHalfDown(er);
  return {
    employeePence,
    employerPence,
    trace: `NI category ${category} on £${(pay / 100).toFixed(2)}: employee £${(employeePence / 100).toFixed(2)}, employer £${(employerPence / 100).toFixed(2)}`,
  };
}

/** Directors: annual earnings period, NI on pay to date minus NI already paid this year. */
export function computeDirectorNi(
  category: UkNiCategory,
  niablePence: number,
  ytd: { niablePence: number; employeePence: number; employerPence: number },
  rates: UkRates['ni'],
): NiResult {
  const total = computeNi(category, ytd.niablePence + niablePence, rates.annual, rates);
  const employeePence = total.employeePence - ytd.employeePence;
  const employerPence = total.employerPence - ytd.employerPence;
  return {
    employeePence,
    employerPence,
    trace: `Director NI (annual method) on £${((ytd.niablePence + niablePence) / 100).toFixed(2)} to date: employee £${(employeePence / 100).toFixed(2)}, employer £${(employerPence / 100).toFixed(2)}`,
  };
}

// ── Student and postgraduate loans ─────────────────────────────────────────────

export function computeStudentLoans(
  niablePence: number,
  plans: UkStudentLoanPlan[],
  postgraduate: boolean,
  rates: UkRates['studentLoan'],
): { studentLoanPence: number; postgradLoanPence: number; trace: string } {
  let sl = 0;
  const notes: string[] = [];
  if (plans.length) {
    // With more than one plan the deduction is worked against the lowest threshold.
    const threshold = Math.min(...plans.map((p) => rates[p]));
    const monthly = threshold / 12;
    if (niablePence > monthly) sl = Math.floor(((niablePence - monthly) * rates.planRatePct) / 100 / 100) * 100;
    notes.push(`student loan (${plans.join('+')}) £${(sl / 100).toFixed(0)}`);
  }
  let pgl = 0;
  if (postgraduate) {
    const monthly = rates.postgraduate / 12;
    if (niablePence > monthly) pgl = Math.floor(((niablePence - monthly) * rates.postgraduateRatePct) / 100 / 100) * 100;
    notes.push(`postgraduate loan £${(pgl / 100).toFixed(0)}`);
  }
  return { studentLoanPence: sl, postgradLoanPence: pgl, trace: notes.join(', ') };
}

// ── Workplace pension (automatic enrolment) ────────────────────────────────────

export type AeAssessment = 'ELIGIBLE_JOBHOLDER' | 'NON_ELIGIBLE_JOBHOLDER' | 'ENTITLED_WORKER' | 'NOT_ASSESSED';

/** Monthly band figure: the annual value / 12 to the nearest pound (as TPR publishes them). */
const monthlyPounds = (annualPence: number) => Math.round(annualPence / 12 / 100) * 100;

export function assessAutoEnrolment(ageYears: number | null, qualifyingPence: number, rates: UkRates['pension']): AeAssessment {
  if (ageYears === null) return 'NOT_ASSESSED';
  const trigger = monthlyPounds(rates.trigger);
  const lqe = monthlyPounds(rates.lowerQualifying);
  if (ageYears >= 22 && ageYears < rates.statePensionAge && qualifyingPence > trigger) return 'ELIGIBLE_JOBHOLDER';
  if (ageYears >= 16 && ageYears < 75 && qualifyingPence > lqe) return 'NON_ELIGIBLE_JOBHOLDER';
  if (ageYears >= 16 && ageYears < 75) return 'ENTITLED_WORKER';
  return 'NOT_ASSESSED';
}

export type PensionResult = {
  member: boolean;
  action: 'NONE' | 'ENROLLED' | 'POSTPONED' | 'CONTINUING' | 'OPTED_OUT';
  assessment: AeAssessment;
  pensionablePence: number;
  /** Gross employee contribution before tax relief. */
  employeeGrossPence: number;
  /** Amount taken from pay (80% of gross under relief at source; 0 under salary sacrifice). */
  employeeDeductedPence: number;
  employerPence: number;
  /** Pay given up under salary sacrifice. */
  sacrificePence: number;
  trace: string;
};

export function computePension(input: {
  settings: UkPensionSettings;
  ageYears: number | null;
  /** Earnings in the period that count for auto-enrolment (gross incl. statutory pay, before sacrifice). */
  qualifyingEarningsPence: number;
  periodEnd: string;
  rates: UkRates['pension'];
  /** Basic-rate tax %, for relief at source. */
  basicRatePct: number;
}): PensionResult {
  const s = input.settings;
  const assessment = assessAutoEnrolment(input.ageYears, input.qualifyingEarningsPence, input.rates);
  let member = false;
  let action: PensionResult['action'] = 'NONE';
  if (s.status === 'ENROLLED' || s.status === 'OPTED_IN') {
    member = true;
    action = 'CONTINUING';
  } else if (s.status === 'OPTED_OUT' || s.status === 'CEASED' || s.status === 'NOT_ELIGIBLE') {
    action = s.status === 'OPTED_OUT' ? 'OPTED_OUT' : 'NONE';
  } else if (s.status === 'POSTPONED' && s.postponedUntil && input.periodEnd < s.postponedUntil) {
    action = 'POSTPONED';
  } else if (assessment === 'ELIGIBLE_JOBHOLDER') {
    member = true;
    action = 'ENROLLED';
  }
  if (!member) {
    return { member, action, assessment, pensionablePence: 0, employeeGrossPence: 0, employeeDeductedPence: 0, employerPence: 0, sacrificePence: 0, trace: `Pension: ${assessment.toLowerCase().replace(/_/g, ' ')}, ${action.toLowerCase()}` };
  }
  const lqe = monthlyPounds(input.rates.lowerQualifying);
  const uqe = monthlyPounds(input.rates.upperQualifying);
  const pensionable =
    s.basis === 'QUALIFYING'
      ? Math.max(0, Math.min(input.qualifyingEarningsPence, uqe) - lqe)
      : Math.max(0, input.qualifyingEarningsPence);
  const eeGross = roundHalfDown((pensionable * s.employeePct) / 100);
  let er = roundHalfDown((pensionable * s.employerPct) / 100);
  let deducted = eeGross;
  let sacrifice = 0;
  if (s.scheme === 'RELIEF_AT_SOURCE') deducted = roundHalfDown((eeGross * (100 - input.basicRatePct)) / 100);
  if (s.scheme === 'SALARY_SACRIFICE') {
    sacrifice = eeGross;
    deducted = 0;
    er += eeGross;
  }
  return {
    member,
    action,
    assessment,
    pensionablePence: pensionable,
    employeeGrossPence: eeGross,
    employeeDeductedPence: deducted,
    employerPence: er,
    sacrificePence: sacrifice,
    trace: `Pension (${s.scheme.toLowerCase().replace(/_/g, ' ')}, ${s.basis === 'QUALIFYING' ? 'qualifying earnings' : 'all pay'} £${(pensionable / 100).toFixed(2)}): employee ${s.employeePct}% £${(eeGross / 100).toFixed(2)}${deducted !== eeGross ? ` (£${(deducted / 100).toFixed(2)} from pay)` : ''}, employer ${s.employerPct}% £${(er / 100).toFixed(2)}`,
  };
}

// ── Statutory payments ─────────────────────────────────────────────────────────

/** Weekly rate of a statutory payment in a given week of the absence (0-based). */
export function statutoryWeeklyRate(code: UkStatutoryPayCode, weekIndex: number, aweP: number, rates: UkRates['statutoryPay']): number {
  if (code === 'SSP') return Math.min(rates.sspWeekly, roundHalfDown((aweP * rates.sspPctOfAwe) / 100));
  const ninety = roundHalfDown((aweP * rates.familyPctOfAwe) / 100);
  if (code === 'SMP' || code === 'SAP') {
    if (weekIndex >= rates.smpTotalWeeks) return 0;
    if (weekIndex < rates.smpHigherRateWeeks) return ninety;
  }
  return Math.min(rates.familyWeekly, ninety);
}

export type StatutoryDay = { date: string; code: UkStatutoryPayCode; units: number; absenceStart: string };

/**
 * Statutory pay for the absence days in a period. Days are the working days of the absence
 * (from leave requests); each working day is 1/`qualifyingDaysPerWeek` of the weekly rate.
 */
export function computeStatutoryPay(days: StatutoryDay[], aweP: number, rates: UkRates['statutoryPay'], qualifyingDaysPerWeek = 5): { lines: { code: UkStatutoryPayCode; days: number; amountPence: number }[]; trace: string[] } {
  const by = new Map<UkStatutoryPayCode, { days: number; amount: number }>();
  const trace: string[] = [];
  const dayMs = 86_400_000;
  // SSP waiting days: the first N qualifying days of each sickness absence are unpaid.
  const sspSeen = new Map<string, number>();
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const weekIndex = Math.floor((Date.parse(`${d.date}T00:00:00Z`) - Date.parse(`${d.absenceStart}T00:00:00Z`)) / dayMs / 7);
    if (d.code === 'SSP' && rates.sspWaitingDays > 0) {
      const n = (sspSeen.get(d.absenceStart) ?? 0) + d.units;
      sspSeen.set(d.absenceStart, n);
      if (n <= rates.sspWaitingDays) continue;
    }
    const weekly = statutoryWeeklyRate(d.code, weekIndex, aweP, rates);
    const amount = (weekly / qualifyingDaysPerWeek) * d.units;
    const cur = by.get(d.code) ?? { days: 0, amount: 0 };
    cur.days += d.units;
    cur.amount += amount;
    by.set(d.code, cur);
  }
  const lines = [...by.entries()].map(([code, v]) => {
    const amountPence = roundHalfDown(v.amount);
    trace.push(`${code} ${v.days} day(s) = £${(amountPence / 100).toFixed(2)} (AWE £${(aweP / 100).toFixed(2)})`);
    return { code, days: v.days, amountPence };
  });
  return { lines, trace };
}

/** Whole years of age on a date. */
export function ageOn(dob: string | null | undefined, on: string): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [Y, M, D] = on.slice(0, 10).split('-').map(Number) as [number, number, number];
  let age = Y - y;
  if (M < m || (M === m && D < d)) age--;
  return age;
}
