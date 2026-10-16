/**
 * Salary structure resolution (pure). "Standard FT" template:
 *   BASIC = 50% × G, HRA = 50% × BASIC, SPECIAL = G − BASIC − HRA (balancing),
 *   PF_ER = 12% × min(BASIC, 15,000) (ceiling opted), CTC/month = G + PF_ER (+ ESI_ER if covered).
 * Interns: a single STIPEND component; CTC = stipend.
 */
import type { EsiSettings, PfSettings } from '@lexisora/shared';
import { ESI_CONFIG, PF_CONFIG, esiCovered } from './statutory';

/** `kind` DEDUCTION = a company deduction from the template (not part of gross or CTC); absent = earning / employer line. */
export type StructureLine = { code: string; label: string; monthlyPaise: number; annualPaise: number; kind?: 'EARNING' | 'DEDUCTION' };
export type TemplateLine = { componentCode: string; label?: string; kind?: 'EARNING' | 'DEDUCTION'; calc: 'PERCENT_OF_GROSS' | 'PERCENT_OF_COMPONENT' | 'BALANCING' | 'FIXED' | 'STATUTORY'; value?: number; base?: string };

export const COMPONENT_LABELS: Record<string, string> = {
  BASIC: 'Basic',
  DA: 'Dearness allowance',
  HRA: 'HRA',
  SPECIAL: 'Special allowance',
  STIPEND: 'Stipend',
  PF_ER: 'PF (employer)',
  ESI_ER: 'ESI (employer)',
  CTC: 'CTC',
};

export const STANDARD_FT: TemplateLine[] = [
  { componentCode: 'BASIC', calc: 'PERCENT_OF_GROSS', value: 50 },
  { componentCode: 'HRA', calc: 'PERCENT_OF_COMPONENT', value: 50, base: 'BASIC' },
  { componentCode: 'SPECIAL', calc: 'BALANCING' },
  { componentCode: 'PF_ER', calc: 'STATUTORY' },
];
export const INTERN_STIPEND: TemplateLine[] = [{ componentCode: 'STIPEND', calc: 'FIXED' }];

/** Round half-up to the rupee (paise in, paise out). */
export const toRupee = (p: number) => Math.round(p / 100) * 100;

export type StructureOpts = { payType: 'SALARY' | 'STIPEND'; pfEnabled?: boolean; pfCeilingOpted?: boolean; esiMode?: string; template?: TemplateLine[]; /** PF rates from the structure (null/absent = statutory defaults). */ pf?: PfSettings | null; /** ESI settings from the structure (null/absent = statutory defaults). */ esi?: EsiSettings | null };

/** ESI settings as the rates the payroll maths uses (undefined = statutory defaults). */
export function esiRatesOf(esi?: EsiSettings | null) {
  return esi ? { enabled: esi.enabled, eeRate: esi.employeePct / 100, erRate: esi.employerPct / 100, thresholdPaise: esi.grossLimit * 100 } : undefined;
}

/** PF settings as the rates the payroll maths uses (undefined = statutory defaults). */
export function pfRates(pf?: PfSettings | null) {
  return pf ? { eeRate: pf.employeePct / 100, erRate: pf.employerPct / 100, wageCeilingPaise: pf.wageCeiling * 100 } : undefined;
}

/** Earnings + employer lines for a monthly gross. Returns lines (without CTC) and the CTC. */
export function structureFromGross(grossMonthlyPaise: number, opts: StructureOpts): { lines: StructureLine[]; ctcMonthlyPaise: number; warnings: string[] } {
  const warnings: string[] = [];
  const g = toRupee(grossMonthlyPaise);
  if (opts.payType === 'STIPEND') {
    const lines = [line('STIPEND', g)];
    return { lines, ctcMonthlyPaise: g, warnings };
  }
  const tpl = opts.template ?? STANDARD_FT;
  const isDeduction = (t: TemplateLine) => t.kind === 'DEDUCTION';
  const vals: Record<string, number> = {};
  let assigned = 0;
  for (const t of tpl) {
    if (t.calc === 'PERCENT_OF_GROSS') vals[t.componentCode] = toRupee((g * (t.value ?? 0)) / 100);
    else if (t.calc === 'PERCENT_OF_COMPONENT') vals[t.componentCode] = toRupee(((vals[t.base ?? 'BASIC'] ?? 0) * (t.value ?? 0)) / 100);
    else if (t.calc === 'FIXED') vals[t.componentCode] = toRupee((t.value ?? 0) * 100);
    if (t.calc !== 'BALANCING' && t.calc !== 'STATUTORY' && !isDeduction(t)) assigned += vals[t.componentCode]!;
  }
  const bal = tpl.find((t) => t.calc === 'BALANCING' && !isDeduction(t));
  if (bal) {
    vals[bal.componentCode] = g - assigned;
    if (vals[bal.componentCode]! < 0) warnings.push(`${bal.label ?? COMPONENT_LABELS[bal.componentCode] ?? bal.componentCode} would be negative; gross is too low for this template`);
  }
  const earnings = tpl.filter((t) => t.calc !== 'STATUTORY' && !isDeduction(t)).map((t) => line(t.componentCode, vals[t.componentCode] ?? 0, t.label));
  const deductions = tpl.filter(isDeduction).map((t) => ({ ...line(t.componentCode, vals[t.componentCode] ?? 0, t.label), kind: 'DEDUCTION' as const }));
  const basicDa = (vals.BASIC ?? 0) + (vals.DA ?? 0);
  if (basicDa < g * 0.5 - 1) warnings.push('Basic + DA is below 50% of gross (wage-code rule); PF wages will add back the shortfall');
  const pfEr = pfEmployerMonthly(basicDa, opts);
  const esiRates = esiRatesOf(opts.esi);
  const esiEr = esiRates?.enabled !== false && esiCovered(g, opts.esiMode, esiRates?.thresholdPaise) ? Math.ceil((g * (esiRates?.erRate ?? ESI_CONFIG.erRate)) / 100 - 1e-9) * 100 : 0;
  const lines = [...earnings];
  if (pfEr) lines.push(line('PF_ER', pfEr));
  if (esiEr) lines.push(line('ESI_ER', esiEr));
  lines.push(...deductions);
  return { lines, ctcMonthlyPaise: g + pfEr + esiEr, warnings };
}

export function pfEmployerMonthly(basicDaPaise: number, opts: { pfEnabled?: boolean; pfCeilingOpted?: boolean; pf?: PfSettings | null }): number {
  if (opts.pfEnabled === false) return 0;
  const r = pfRates(opts.pf);
  const wage = opts.pfCeilingOpted === false ? basicDaPaise : Math.min(basicDaPaise, r?.wageCeilingPaise ?? PF_CONFIG.wageCeilingPaise);
  return toRupee(wage * (r?.erRate ?? PF_CONFIG.erRate));
}

/** Solve G from annual CTC: G + PF_ER(G) + ESI_ER(G) = CTC / 12 (monotonic → bisection to the rupee). */
export function grossFromCtc(ctcAnnualPaise: number, opts: StructureOpts): number {
  const target = ctcAnnualPaise / 12;
  if (opts.payType === 'STIPEND') return toRupee(target);
  let lo = 0;
  let hi = Math.ceil(target / 100) * 100 + 100;
  for (let i = 0; i < 60 && hi - lo > 100; i++) {
    const mid = Math.floor((lo + hi) / 200) * 100;
    if (structureFromGross(mid, opts).ctcMonthlyPaise < target) lo = mid;
    else hi = mid;
  }
  const best = [lo, hi].reduce((a, b) => (Math.abs(structureFromGross(a, opts).ctcMonthlyPaise - target) <= Math.abs(structureFromGross(b, opts).ctcMonthlyPaise - target) ? a : b));
  return best;
}

/** Full structure table (Basic, HRA, Special, PF (employer), CTC) from either input. */
export function buildStructure(input: { grossMonthlyPaise?: number; ctcAnnualPaise?: number }, opts: StructureOpts) {
  const gross = input.grossMonthlyPaise ?? grossFromCtc(input.ctcAnnualPaise ?? 0, opts);
  const s = structureFromGross(gross, opts);
  return {
    grossMonthlyPaise: toRupee(gross),
    ctcMonthlyPaise: s.ctcMonthlyPaise,
    ctcAnnualPaise: s.ctcMonthlyPaise * 12,
    lines: s.lines,
    table: [...s.lines.filter((l) => l.kind !== 'DEDUCTION'), line('CTC', s.ctcMonthlyPaise), ...s.lines.filter((l) => l.kind === 'DEDUCTION')],
    warnings: s.warnings,
  };
}

function line(code: string, monthly: number, label?: string): StructureLine {
  return { code, label: label ?? COMPONENT_LABELS[code] ?? code, monthlyPaise: monthly, annualPaise: monthly * 12 };
}


/** A salary-structure template as stored (lines are the editable components). */
export type SalaryTemplateData = {
  id: string;
  name: string;
  payType: 'SALARY' | 'STIPEND';
  employmentTypes: string[];
  minCtcPaise: number | null;
  maxCtcPaise: number | null;
  isDefault: boolean;
  active: boolean;
  lines: TemplateLine[];
  pf?: PfSettings | null;
  esi?: EsiSettings | null;
};

/**
 * Choose the structure for an annual CTC: an active template whose CTC range contains it (and whose employment
 * types include the employee's), the narrowest match first; otherwise the default (or a template with no range).
 * Returns null when nothing matches — the built-in Standard structure then applies.
 */
export function pickTemplate(templates: SalaryTemplateData[], q: { payType: 'SALARY' | 'STIPEND'; employmentType?: string | null; ctcAnnualPaise: number }): SalaryTemplateData | null {
  const fits = templates.filter((t) => t.active && t.payType === q.payType && (!t.employmentTypes.length || !q.employmentType || t.employmentTypes.includes(q.employmentType)));
  const ranged = fits.filter((t) => (t.minCtcPaise != null || t.maxCtcPaise != null) && (t.minCtcPaise == null || q.ctcAnnualPaise >= t.minCtcPaise) && (t.maxCtcPaise == null || q.ctcAnnualPaise < t.maxCtcPaise));
  const width = (t: SalaryTemplateData) => (t.maxCtcPaise ?? Number.MAX_SAFE_INTEGER) - (t.minCtcPaise ?? 0);
  if (ranged.length) return [...ranged].sort((a, b) => Number(!!b.employmentTypes.length) - Number(!!a.employmentTypes.length) || width(a) - width(b))[0]!;
  const open = fits.filter((t) => t.minCtcPaise == null && t.maxCtcPaise == null);
  return open.find((t) => t.isDefault) ?? open[0] ?? null;
}

/** Two templates overlap when they can both apply to the same CTC and employment type. */
export function templatesOverlap(a: Pick<SalaryTemplateData, 'minCtcPaise' | 'maxCtcPaise' | 'employmentTypes'>, b: Pick<SalaryTemplateData, 'minCtcPaise' | 'maxCtcPaise' | 'employmentTypes'>): boolean {
  const aLo = a.minCtcPaise ?? 0;
  const aHi = a.maxCtcPaise ?? Number.MAX_SAFE_INTEGER;
  const bLo = b.minCtcPaise ?? 0;
  const bHi = b.maxCtcPaise ?? Number.MAX_SAFE_INTEGER;
  const sharesType = !a.employmentTypes.length || !b.employmentTypes.length || a.employmentTypes.some((t) => b.employmentTypes.includes(t));
  return sharesType && aLo < bHi && bLo < aHi;
}


/**
 * The lowest annual CTC (paise) at which a structure produces no negative earning — fixed amounts leave less and less
 * for the balancing component as the salary falls. Returns 0 when it works at any CTC. Rounded up to the next Rs 1,000.
 */
export function lowestWorkingCtc(opts: StructureOpts): number {
  const negative = (ctc: number) => buildStructure({ ctcAnnualPaise: ctc }, opts).lines.some((l) => l.kind !== 'DEDUCTION' && l.monthlyPaise < 0);
  const HIGH = 100_00_00_000 * 100; // Rs 100 crore a year
  if (!negative(100_00)) return 0; // already fine at Rs 100 a year → fine everywhere above
  if (negative(HIGH)) return HIGH;
  let lo = 100_00;
  let hi = HIGH;
  for (let i = 0; i < 60 && hi - lo > 100; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (negative(mid)) lo = mid;
    else hi = mid;
  }
  return Math.ceil(hi / 100_000) * 100_000;
}
