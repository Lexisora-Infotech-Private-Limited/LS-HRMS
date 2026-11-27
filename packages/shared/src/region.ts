/**
 * Region (country) support. A tenant runs in exactly one region. India ('IN') is the
 * default and the original behaviour: every helper below returns exactly what the
 * India-only code returned before when the active region is 'IN'.
 *
 * The active region is ambient: the API registers a resolver that reads the tenant of the
 * current request/job; the web app registers one that returns the signed-in tenant's region.
 * With no resolver registered (unit tests, scripts) the region is 'IN'.
 */
export const REGION_CODES = ['IN', 'GB'] as const;
export type RegionCode = (typeof REGION_CODES)[number];

export type CurrencyCode = 'INR' | 'GBP';

export type RegionConfig = {
  code: RegionCode;
  /** Country name shown in settings. */
  name: string;
  currency: CurrencyCode;
  /** Symbol used on screen. */
  currencySymbol: string;
  /** Prefix used in PDFs (built-in PDF fonts cannot draw ₹). */
  pdfCurrencyPrefix: string;
  /** Intl locale for numbers. */
  locale: string;
  /** IANA time zone of the business day. */
  timezone: string;
  /** First day of the tax year (month 1-12, day). India: 1 April. UK: 6 April. */
  taxYearStart: { month: number; day: number };
  /** Name of the sales tax on invoices. */
  salesTax: 'GST' | 'VAT';
  /** Standard sales-tax rate in basis points. */
  salesTaxStandardBp: number;
  dialCode: string;
  /** Postal code label. */
  postcodeLabel: string;
};

export const REGIONS: Record<RegionCode, RegionConfig> = {
  IN: {
    code: 'IN',
    name: 'India',
    currency: 'INR',
    currencySymbol: '₹',
    pdfCurrencyPrefix: 'Rs.',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    taxYearStart: { month: 4, day: 1 },
    salesTax: 'GST',
    salesTaxStandardBp: 1800,
    dialCode: '+91',
    postcodeLabel: 'PIN code',
  },
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    currency: 'GBP',
    currencySymbol: '£',
    pdfCurrencyPrefix: '£',
    locale: 'en-GB',
    timezone: 'Europe/London',
    taxYearStart: { month: 4, day: 6 },
    salesTax: 'VAT',
    salesTaxStandardBp: 2000,
    dialCode: '+44',
    postcodeLabel: 'Postcode',
  },
};

export function isRegionCode(v: unknown): v is RegionCode {
  return v === 'IN' || v === 'GB';
}

type Resolver = () => RegionCode | null | undefined;
let resolver: Resolver = () => 'IN';

/** Register how the current region is found (API: from the request tenant; web: from the session). */
export function setRegionResolver(fn: Resolver): void {
  resolver = fn;
}

/** The region of the current tenant/request. Falls back to India. */
export function activeRegion(): RegionCode {
  try {
    const r = resolver();
    return isRegionCode(r) ? r : 'IN';
  } catch {
    return 'IN';
  }
}

export function regionConfig(code: RegionCode = activeRegion()): RegionConfig {
  return REGIONS[code] ?? REGIONS.IN;
}

export const isUk = (code: RegionCode = activeRegion()): boolean => code === 'GB';

export function activeTimezone(): string {
  return regionConfig().timezone;
}

export function activeCurrency(): CurrencyCode {
  return regionConfig().currency;
}

export function currencySymbol(code: RegionCode = activeRegion()): string {
  return regionConfig(code).currencySymbol;
}

// ── Money in pounds (pence are stored in the same integer "paise" columns) ──────────

/**
 * Pence → "£2,999.34". Without `decimals`, whole pounds print without pence ("£4,000")
 * and anything else keeps its pence, so payroll amounts never lose precision.
 */
export function formatGBP(pence: number | bigint | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (pence === null || pence === undefined) return '—';
  const p = Number(pence);
  const pounds = p / 100;
  const showPence = opts.decimals === true || (opts.decimals !== false && Math.round(p) % 100 !== 0);
  const s = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: showPence ? 2 : 0,
    maximumFractionDigits: showPence ? 2 : 0,
  }).format(Math.abs(pounds));
  return (pounds < 0 ? '- ' : '') + '£' + s;
}

/** "£19.2k", "£1.4m" for KPI tiles. */
export function formatGBPCompact(pence: number | bigint): string {
  const r = Number(pence) / 100;
  if (Math.abs(r) >= 1e6) return `£${(r / 1e6).toFixed(1)}m`;
  if (Math.abs(r) >= 1e4) return `£${(r / 1e3).toFixed(1)}k`;
  return formatGBP(pence, { decimals: false });
}

// ── Time zones ──────────────────────────────────────────────────────────────────────

const IST_OFFSET = 330;
const fmtCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Offset (minutes east of UTC) of `tz` at `instant`. India is a fixed +330 and is
 * returned without touching Intl, so IST maths stays exactly as before.
 */
export function zoneOffsetMinutes(instant: Date, tz: string = activeTimezone()): number {
  if (tz === 'Asia/Kolkata') return IST_OFFSET;
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  const parts = f.formatToParts(instant);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  const whole = instant.getTime() - (instant.getTime() % 1000);
  return Math.round((asUtc - whole) / 60_000);
}

/**
 * Local date key + minute of day → instant, in the active zone. Handles DST: the offset is
 * taken at the resulting instant (a second pass fixes days when the clocks change).
 */
export function zonedInstant(key: string, minute: number, tz: string = activeTimezone()): Date {
  const naive = new Date(`${key}T00:00:00.000Z`).getTime() + minute * 60_000;
  const first = naive - zoneOffsetMinutes(new Date(naive), tz) * 60_000;
  const second = naive - zoneOffsetMinutes(new Date(first), tz) * 60_000;
  return new Date(second);
}

/** Instant → local business-day key "YYYY-MM-DD" in the active zone. */
export function zonedDateKey(instant: Date = new Date(), tz: string = activeTimezone()): string {
  return new Date(instant.getTime() + zoneOffsetMinutes(instant, tz) * 60_000).toISOString().slice(0, 10);
}

// ── Tax year ────────────────────────────────────────────────────────────────────────

/**
 * Tax-year start year for a payroll period "YYYY-MM". India: April–March. UK: the tax year
 * starts 6 April; a monthly pay period is assigned to the tax month of its payday, which
 * Lexisora assumes falls on or after the 6th (normal for month-end pay), so April is
 * tax month 1 in both regions.
 */
export function taxYearStartOfPeriod(period: string): number {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
}

/** Tax month 1..12 for a payroll period (April = 1). */
export function taxMonthOfPeriod(period: string): number {
  const m = Number(period.slice(5, 7));
  return ((m - 4 + 12) % 12) + 1;
}

/** "2026/27" (UK style) or "2026-27" (India style). */
export function taxYearLabel(startYear: number, code: RegionCode = activeRegion()): string {
  const next = String((startYear + 1) % 100).padStart(2, '0');
  return code === 'GB' ? `${startYear}/${next}` : `${startYear}-${next}`;
}

// ── Words ───────────────────────────────────────────────────────────────────────────

/**
 * On-screen wording that differs in the UK. Keys are the India (original) text; anything
 * not listed is shown unchanged in every region.
 */
export const REGION_TEXT: Record<string, Partial<Record<RegionCode, string>>> = {
  'Punch in': { GB: 'Clock in' },
  'Punch out': { GB: 'Clock out' },
  'Punched in': { GB: 'Clocked in' },
  'Not punched in': { GB: 'Not clocked in' },
  'Time off': { GB: 'Holiday & absence' },
  'Leave setup': { GB: 'Holiday & absence setup' },
  'Payroll run': { GB: 'Pay run (PAYE)' },
  'Salary structures': { GB: 'Pay structures' },
  'GST invoices': { GB: 'VAT invoices' },
  'Purchases & input GST': { GB: 'Purchases & input VAT' },
  'Appraisals': { GB: 'Performance reviews' },
  'Shifts': { GB: 'Rotas' },
  'ID & visiting card': { GB: 'ID & business card' },
  'Visiting card designer': { GB: 'Business card designer' },
  'Intern task sheets': { GB: 'Apprentice & placement logs' },
  'Reporting manager': { GB: 'Line manager' },
  'Reporting Manager': { GB: 'Line manager' },
  'CTC': { GB: 'Annual salary' },
  'Annual CTC': { GB: 'Annual salary' },
  'PIN code': { GB: 'Postcode' },
  'Pincode': { GB: 'Postcode' },
  'State': { GB: 'County' },
  'GSTIN': { GB: 'VAT number' },
  'GST': { GB: 'VAT' },
  'IFSC': { GB: 'Sort code' },
  'LOP': { GB: 'Unpaid' },
  'Loss of pay': { GB: 'Unpaid leave' },
};

/**
 * UK phrases inside longer text (titles, buttons, table headers, form labels). Longest
 * phrases first; word boundaries so "Shifts" changes but "shifted" does not.
 */
const UK_PHRASES: [RegExp, string][] = (
  [
    ['Not punched in', 'Not clocked in'],
    ['Punched in', 'Clocked in'],
    ['Punched out', 'Clocked out'],
    ['punched in', 'clocked in'],
    ['punched out', 'clocked out'],
    ['Punch in', 'Clock in'],
    ['Punch out', 'Clock out'],
    ['punch in', 'clock in'],
    ['punch out', 'clock out'],
    ['Punches', 'Clock-ins'],
    ['punches', 'clock-ins'],
    ['Punch', 'Clock'],
    ['punch', 'clock'],
    ['Apply time off', 'Book holiday'],
    ['Apply leave', 'Book holiday'],
    ['Time off', 'Holiday & absence'],
    ['time off', 'holiday & absence'],
    ['Leave setup', 'Holiday & absence setup'],
    ['Leave balances', 'Holiday balances'],
    ['Leave balance', 'Holiday balance'],
    ['Leave history', 'Absence history'],
    ['Leave requests', 'Absence requests'],
    ['Leave request', 'Absence request'],
    ['Leave types', 'Absence types'],
    ['Leave type', 'Absence type'],
    ['Appraisal cycles', 'Review cycles'],
    ['Appraisal cycle', 'Review cycle'],
    ['Appraisals', 'Performance reviews'],
    ['Appraisal', 'Performance review'],
    ['appraisals', 'performance reviews'],
    ['appraisal', 'performance review'],
    ['Shift master', 'Shift patterns'],
    ['shift allocation', 'rota allocation'],
    ['Shifts', 'Rotas'],
    ['Visiting card designer', 'Business card designer'],
    ['Visiting cards', 'Business cards'],
    ['Visiting card', 'Business card'],
    ['visiting cards', 'business cards'],
    ['visiting card', 'business card'],
    ['Intern task sheets', 'Apprentice & placement logs'],
    ['Intern task sheet', 'Apprentice & placement log'],
    ['Salary structures', 'Pay structures'],
    ['Salary structure', 'Pay structure'],
    ['salary structures', 'pay structures'],
    ['salary structure', 'pay structure'],
    ['Payroll run', 'Pay run'],
    ['Annual CTC', 'Annual salary'],
    ['annual CTC', 'annual salary'],
    ['CTC', 'Salary'],
    ['Loss of pay', 'Unpaid leave'],
    ['loss of pay', 'unpaid leave'],
    ['LOP', 'Unpaid'],
    ['GST invoices', 'VAT invoices'],
    ['input GST', 'input VAT'],
    ['GSTIN', 'VAT number'],
    ['GST', 'VAT'],
    ['Reporting managers', 'Line managers'],
    ['Reporting manager', 'Line manager'],
    ['Reporting Manager', 'Line manager'],
    ['reporting manager', 'line manager'],
    ['PIN code', 'Postcode'],
    ['Pincode', 'Postcode'],
    ['IFSC', 'Sort code'],
    ['Organization', 'Organisation'],
    ['organization', 'organisation'],
  ] as [string, string][]
).map(([from, to]) => [new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}\\b`, 'g'), to]);

/** Text in UK wording (phrases replaced inside longer text). India text is returned untouched. */
export function ukText(text: string): string {
  let s = text;
  for (const [re, to] of UK_PHRASES) s = s.replace(re, to);
  return s;
}

/** UK wording for a label, or the label itself (India: always the label itself). */
export function regionText(text: string, code: RegionCode = activeRegion()): string {
  if (code === 'IN' || !text) return text;
  return REGION_TEXT[text]?.[code] ?? ukText(text);
}
