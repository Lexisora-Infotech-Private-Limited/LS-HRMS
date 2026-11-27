/**
 * UK payroll rates and thresholds per tax year (6 April – 5 April). Money in pence.
 *
 * These are the published / announced figures used by default. HMRC and DWP change them
 * every April, so a tenant can override any value through the `payroll.uk.rates` setting
 * (deep-merged over the defaults for that tax year) and every run records the version used.
 * Check the figures against GOV.UK "Rates and thresholds for employers" before go-live.
 */
export type TaxBand = { /** Upper limit of the band in pounds of taxable income (null = no limit). */ upTo: number | null; ratePct: number };

export type UkRates = {
  version: string;
  taxYear: number;
  /** Tax bands above the personal allowance (taxable income). */
  bands: { rUK: TaxBand[]; scotland: TaxBand[]; wales: TaxBand[] };
  /** Flat-rate codes: BR, D0.., per regime (S prefix uses the Scottish set). */
  flat: {
    rUK: { BR: number; D0: number; D1: number; D2?: number; D3?: number };
    scotland: { BR: number; D0: number; D1: number; D2: number; D3: number };
  };
  /** Regulatory limit: tax deducted in a period is at most this % of pay (K codes). */
  overridingLimitPct: number;
  ni: {
    /** Monthly thresholds (pence). */
    monthly: { LEL: number; PT: number; ST: number; UEL: number; UST: number; AUST: number; VUST: number; FUST: number; IZUST: number };
    /** Annual thresholds for directors (pence). */
    annual: { LEL: number; PT: number; ST: number; UEL: number; UST: number; AUST: number; VUST: number; FUST: number; IZUST: number };
    employeeMainPct: number;
    employeeUpperPct: number;
    employeeReducedPct: number;
    employerPct: number;
  };
  studentLoan: {
    /** Annual thresholds (pence) and rates. */
    PLAN_1: number;
    PLAN_2: number;
    PLAN_4: number;
    PLAN_5: number;
    planRatePct: number;
    postgraduate: number;
    postgraduateRatePct: number;
  };
  pension: {
    /** Annual qualifying-earnings band and auto-enrolment trigger (pence). */
    lowerQualifying: number;
    upperQualifying: number;
    trigger: number;
    minTotalPct: number;
    minEmployerPct: number;
    statePensionAge: number;
  };
  statutoryPay: {
    /** Weekly flat rates (pence). */
    sspWeekly: number;
    /** SSP is the lower of the flat rate and this % of average weekly earnings. */
    sspPctOfAwe: number;
    /** Days before SSP starts (0 from April 2026: SSP from the first day of sickness). */
    sspWaitingDays: number;
    /** SMP, SAP, SPP, ShPP, SPBP, SNCP flat weekly rate (pence). */
    familyWeekly: number;
    /** % of AWE for the first weeks of SMP / SAP and the cap for the others. */
    familyPctOfAwe: number;
    smpHigherRateWeeks: number;
    smpTotalWeeks: number;
  };
  /** Hourly minimum wage by age (pence) for checks. */
  minimumWage: { age21Plus: number; age18to20: number; under18: number; apprentice: number };
  employmentAllowance: number;
  /** True only once a person has checked every value against GOV.UK for the year. */
  verified: boolean;
  notes: string;
};

const K = 100; // pounds → pence

/** 2026/27 (6 April 2026 – 5 April 2027). */
export const UK_RATES_2026: UkRates = {
  version: '2026-27.1',
  taxYear: 2026,
  bands: {
    // England & Northern Ireland: basic 20% to £37,700, higher 40% to £125,140, additional 45%.
    rUK: [
      { upTo: 37_700, ratePct: 20 },
      { upTo: 125_140, ratePct: 40 },
      { upTo: null, ratePct: 45 },
    ],
    // Scotland (bands of taxable income above the personal allowance). Starter/basic bands
    // follow the Scottish Budget; confirm the year's figures and override if they differ.
    scotland: [
      { upTo: 2_827, ratePct: 19 },
      { upTo: 14_921, ratePct: 20 },
      { upTo: 31_092, ratePct: 21 },
      { upTo: 62_430, ratePct: 42 },
      { upTo: 112_570, ratePct: 45 },
      { upTo: null, ratePct: 48 },
    ],
    // Wales: Welsh rates are currently the same as England.
    wales: [
      { upTo: 37_700, ratePct: 20 },
      { upTo: 125_140, ratePct: 40 },
      { upTo: null, ratePct: 45 },
    ],
  },
  flat: {
    rUK: { BR: 20, D0: 40, D1: 45 },
    scotland: { BR: 20, D0: 21, D1: 42, D2: 45, D3: 48 },
  },
  overridingLimitPct: 50,
  ni: {
    monthly: { LEL: 559 * K, PT: 1_048 * K, ST: 417 * K, UEL: 4_189 * K, UST: 4_189 * K, AUST: 4_189 * K, VUST: 4_189 * K, FUST: 2_083 * K, IZUST: 2_083 * K },
    annual: { LEL: 6_708 * K, PT: 12_570 * K, ST: 5_000 * K, UEL: 50_270 * K, UST: 50_270 * K, AUST: 50_270 * K, VUST: 50_270 * K, FUST: 25_000 * K, IZUST: 25_000 * K },
    employeeMainPct: 8,
    employeeUpperPct: 2,
    employeeReducedPct: 1.85,
    employerPct: 15,
  },
  studentLoan: {
    PLAN_1: 26_900 * K,
    PLAN_2: 29_385 * K,
    PLAN_4: 33_795 * K,
    PLAN_5: 25_000 * K,
    planRatePct: 9,
    postgraduate: 21_000 * K,
    postgraduateRatePct: 6,
  },
  pension: {
    lowerQualifying: 6_240 * K,
    upperQualifying: 50_270 * K,
    trigger: 10_000 * K,
    minTotalPct: 8,
    minEmployerPct: 3,
    statePensionAge: 66,
  },
  statutoryPay: {
    sspWeekly: 12_325,
    sspPctOfAwe: 80,
    sspWaitingDays: 0,
    familyWeekly: 19_432,
    familyPctOfAwe: 90,
    smpHigherRateWeeks: 6,
    smpTotalWeeks: 39,
  },
  minimumWage: { age21Plus: 1_271, age18to20: 1_085, under18: 800, apprentice: 800 },
  employmentAllowance: 10_500 * K,
  verified: false,
  notes:
    'Announced 2026/27 figures. Personal allowance £12,570 (code 1257L), NI 8%/2% employee and 15% employer above £5,000, SSP from day one (Employment Rights Act 2025). Check every value on GOV.UK before the first live pay run and override any that differ in Payroll → UK rates.',
};

const DEFAULTS: Record<number, UkRates> = { 2026: UK_RATES_2026 };

/** Default rates for a tax year (the nearest earlier year when a year is not in the table). */
export function defaultUkRates(taxYear: number): UkRates {
  if (DEFAULTS[taxYear]) return DEFAULTS[taxYear]!;
  const years = Object.keys(DEFAULTS).map(Number).sort((a, b) => a - b);
  const pick = [...years].reverse().find((y) => y <= taxYear) ?? years[0]!;
  return { ...DEFAULTS[pick]!, taxYear, version: `${DEFAULTS[pick]!.version}→${taxYear}`, verified: false };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(over)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) {
    const cur = out[k];
    out[k] = isObj(cur) && isObj(v) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

/**
 * Rates for a tax year with a tenant's overrides applied. `overrides` is the stored setting:
 * `{ "2026": { ...partial UkRates } }`.
 */
export function ukRatesFor(taxYear: number, overrides?: unknown): UkRates {
  const base = defaultUkRates(taxYear);
  const o = isObj(overrides) ? overrides[String(taxYear)] : undefined;
  if (!isObj(o)) return base;
  const merged = deepMerge(base, o);
  return { ...merged, taxYear, version: `${base.version}+tenant` };
}
