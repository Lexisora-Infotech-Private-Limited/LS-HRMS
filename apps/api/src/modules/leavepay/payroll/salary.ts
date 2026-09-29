/**
 * Salary structure resolution (pure). "Standard FT" template:
 *   BASIC = 50% × G, HRA = 50% × BASIC, SPECIAL = G − BASIC − HRA (balancing),
 *   PF_ER = 12% × min(BASIC, 15,000) (ceiling opted), CTC/month = G + PF_ER (+ ESI_ER if covered).
 * Interns: a single STIPEND component; CTC = stipend.
 */
import { ESI_CONFIG, PF_CONFIG, esiCovered } from './statutory';

export type StructureLine = { code: string; label: string; monthlyPaise: number; annualPaise: number };
export type TemplateLine = { componentCode: string; label?: string; calc: 'PERCENT_OF_GROSS' | 'PERCENT_OF_COMPONENT' | 'BALANCING' | 'FIXED' | 'STATUTORY'; value?: number; base?: string };

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

export type StructureOpts = { payType: 'SALARY' | 'STIPEND'; pfEnabled?: boolean; pfCeilingOpted?: boolean; esiMode?: string; template?: TemplateLine[] };

/** Earnings + employer lines for a monthly gross. Returns lines (without CTC) and the CTC. */
export function structureFromGross(grossMonthlyPaise: number, opts: StructureOpts): { lines: StructureLine[]; ctcMonthlyPaise: number; warnings: string[] } {
  const warnings: string[] = [];
  const g = toRupee(grossMonthlyPaise);
  if (opts.payType === 'STIPEND') {
    const lines = [line('STIPEND', g)];
    return { lines, ctcMonthlyPaise: g, warnings };
  }
  const tpl = opts.template ?? STANDARD_FT;
  const vals: Record<string, number> = {};
  let assigned = 0;
  for (const t of tpl) {
    if (t.calc === 'PERCENT_OF_GROSS') vals[t.componentCode] = toRupee((g * (t.value ?? 0)) / 100);
    else if (t.calc === 'PERCENT_OF_COMPONENT') vals[t.componentCode] = toRupee(((vals[t.base ?? 'BASIC'] ?? 0) * (t.value ?? 0)) / 100);
    else if (t.calc === 'FIXED') vals[t.componentCode] = toRupee((t.value ?? 0) * 100);
    if (t.calc !== 'BALANCING' && t.calc !== 'STATUTORY') assigned += vals[t.componentCode]!;
  }
  const bal = tpl.find((t) => t.calc === 'BALANCING');
  if (bal) {
    vals[bal.componentCode] = g - assigned;
    if (vals[bal.componentCode]! < 0) warnings.push('Special allowance would be negative; gross is too low for this template');
  }
  const earnings = tpl.filter((t) => t.calc !== 'STATUTORY').map((t) => line(t.componentCode, vals[t.componentCode] ?? 0));
  const basicDa = (vals.BASIC ?? 0) + (vals.DA ?? 0);
  if (basicDa < g * 0.5 - 1) warnings.push('Basic + DA is below 50% of gross (wage-code rule); PF wages will add back the shortfall');
  const pfEr = pfEmployerMonthly(basicDa, opts);
  const esiEr = esiCovered(g, opts.esiMode) ? Math.ceil((g * ESI_CONFIG.erRate) / 100 - 1e-9) * 100 : 0;
  const lines = [...earnings];
  if (pfEr) lines.push(line('PF_ER', pfEr));
  if (esiEr) lines.push(line('ESI_ER', esiEr));
  return { lines, ctcMonthlyPaise: g + pfEr + esiEr, warnings };
}

export function pfEmployerMonthly(basicDaPaise: number, opts: { pfEnabled?: boolean; pfCeilingOpted?: boolean }): number {
  if (opts.pfEnabled === false) return 0;
  const wage = opts.pfCeilingOpted === false ? basicDaPaise : Math.min(basicDaPaise, PF_CONFIG.wageCeilingPaise);
  return toRupee(wage * PF_CONFIG.erRate);
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
    table: [...s.lines, line('CTC', s.ctcMonthlyPaise)],
    warnings: s.warnings,
  };
}

function line(code: string, monthly: number): StructureLine {
  return { code, label: COMPONENT_LABELS[code] ?? code, monthlyPaise: monthly, annualPaise: monthly * 12 };
}
