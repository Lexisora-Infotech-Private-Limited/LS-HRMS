/**
 * Statutory compliance calendar (pure; unit-tested). Monthly GST/TDS/PF/PT due dates,
 * quarterly TDS returns and advance tax, annual tax audit / ITR / GSTR-9.
 * Filing status comes from the tenant's "mark filed" records keyed `${form}:${period}`.
 */
export type ComplianceForm = 'GSTR1' | 'GSTR3B' | 'TDS_DEPOSIT' | 'PF_ECR' | 'PT' | 'TDS_RETURN' | 'ADVANCE_TAX' | 'TAX_AUDIT' | 'ITR' | 'GSTR9';
export type ComplianceStatus = 'FILED' | 'OVERDUE' | 'DUE_SOON' | 'UPCOMING';
export type ComplianceFiling = { ref: string | null; filedOn: string; by?: string | null };
export type ComplianceItem = {
  key: string;
  form: ComplianceForm;
  label: string;
  period: string;
  periodLabel: string;
  dueDate: string;
  status: ComplianceStatus;
  daysLeft: number;
  filedOn: string | null;
  ref: string | null;
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const monthLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const addMonths = (ym: string, n: number) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${pad(((m % 12) + 12) % 12 + 1)}`;
};
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const dayDiff = (a: string, b: string) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86_400_000);
/** FY label of a month: 2026-09 → "2026-27". */
export const fyOfMonth = (ym: string) => {
  const y = Number(ym.slice(5, 7)) >= 4 ? Number(ym.slice(0, 4)) : Number(ym.slice(0, 4)) - 1;
  return `${y}-${pad((y + 1) % 100)}`;
};

export const COMPLIANCE_LABEL: Record<ComplianceForm, string> = {
  GSTR1: 'GSTR-1',
  GSTR3B: 'GSTR-3B',
  TDS_DEPOSIT: 'TDS deposit (Challan 281)',
  PF_ECR: 'PF ECR & challan',
  PT: 'Professional tax (Gujarat)',
  TDS_RETURN: 'TDS return 24Q / 26Q',
  ADVANCE_TAX: 'Advance tax instalment',
  TAX_AUDIT: 'Tax audit report (3CA/3CD)',
  ITR: 'Income-tax return (ITR-6)',
  GSTR9: 'GSTR-9 annual return',
};

type Raw = { form: ComplianceForm; period: string; periodLabel: string; dueDate: string };

/** All obligations whose period touches the months around `todayKey`. */
export function obligations(todayKey: string): Raw[] {
  const cur = todayKey.slice(0, 7);
  const out: Raw[] = [];
  for (let i = -3; i <= 3; i++) {
    const p = addMonths(cur, i);
    const n = addMonths(p, 1);
    out.push({ form: 'GSTR1', period: p, periodLabel: monthLabel(p), dueDate: `${n}-11` });
    out.push({ form: 'GSTR3B', period: p, periodLabel: monthLabel(p), dueDate: `${n}-20` });
    // TDS for March is due 30 April; other months the 7th of the next month.
    out.push({ form: 'TDS_DEPOSIT', period: p, periodLabel: monthLabel(p), dueDate: p.endsWith('-03') ? `${n}-30` : `${n}-07` });
    out.push({ form: 'PF_ECR', period: p, periodLabel: monthLabel(p), dueDate: `${n}-15` });
    out.push({ form: 'PT', period: p, periodLabel: monthLabel(p), dueDate: `${n}-15` });
  }
  const y = Number(cur.slice(0, 4));
  for (const yy of [y - 1, y, y + 1]) {
    // Quarterly TDS returns: Q1 Apr–Jun → 31 Jul, Q2 → 31 Oct, Q3 → 31 Jan (next year), Q4 → 31 May (next year).
    const fy = `${yy}-${pad((yy + 1) % 100)}`;
    out.push({ form: 'TDS_RETURN', period: `${fy}-Q1`, periodLabel: `Q1 FY ${fy}`, dueDate: `${yy}-07-31` });
    out.push({ form: 'TDS_RETURN', period: `${fy}-Q2`, periodLabel: `Q2 FY ${fy}`, dueDate: `${yy}-10-31` });
    out.push({ form: 'TDS_RETURN', period: `${fy}-Q3`, periodLabel: `Q3 FY ${fy}`, dueDate: `${yy + 1}-01-31` });
    out.push({ form: 'TDS_RETURN', period: `${fy}-Q4`, periodLabel: `Q4 FY ${fy}`, dueDate: `${yy + 1}-05-31` });
    // Advance tax instalments 15 Jun / 15 Sep / 15 Dec / 15 Mar.
    out.push({ form: 'ADVANCE_TAX', period: `${fy}-1`, periodLabel: `1st instalment FY ${fy}`, dueDate: `${yy}-06-15` });
    out.push({ form: 'ADVANCE_TAX', period: `${fy}-2`, periodLabel: `2nd instalment FY ${fy}`, dueDate: `${yy}-09-15` });
    out.push({ form: 'ADVANCE_TAX', period: `${fy}-3`, periodLabel: `3rd instalment FY ${fy}`, dueDate: `${yy}-12-15` });
    out.push({ form: 'ADVANCE_TAX', period: `${fy}-4`, periodLabel: `4th instalment FY ${fy}`, dueDate: `${yy + 1}-03-15` });
    // Annual (previous FY): tax audit 30 Sep, ITR-6 31 Oct, GSTR-9 31 Dec.
    const prev = `${yy - 1}-${pad(yy % 100)}`;
    out.push({ form: 'TAX_AUDIT', period: prev, periodLabel: `FY ${prev}`, dueDate: `${yy}-09-30` });
    out.push({ form: 'ITR', period: prev, periodLabel: `FY ${prev}`, dueDate: `${yy}-10-31` });
    out.push({ form: 'GSTR9', period: prev, periodLabel: `FY ${prev}`, dueDate: `${yy}-12-31` });
  }
  return out.map((o) => ({ ...o, dueDate: clampDay(o.dueDate) }));
}

function clampDay(key: string): string {
  const ym = key.slice(0, 7);
  const d = Math.min(Number(key.slice(8, 10)), lastDay(ym));
  return `${ym}-${pad(d)}`;
}

export const filingKey = (form: ComplianceForm, period: string) => `${form}:${period}`;

/**
 * Calendar card: unfiled items that fell due in the last `pastDays` (OVERDUE), plus items due
 * within `horizonDays` (DUE_SOON when ≤ 7 days), plus recently filed ones; earliest first.
 */
export function complianceCalendar(todayKey: string, filings: Record<string, ComplianceFiling>, opts: { horizonDays?: number; pastDays?: number; limit?: number } = {}): ComplianceItem[] {
  const horizon = opts.horizonDays ?? 45;
  const past = opts.pastDays ?? 60;
  const items: ComplianceItem[] = [];
  for (const o of obligations(todayKey)) {
    const key = filingKey(o.form, o.period);
    const f = filings[key];
    const daysLeft = dayDiff(o.dueDate, todayKey);
    if (daysLeft > horizon || daysLeft < -past) continue;
    let status: ComplianceStatus;
    if (f) status = 'FILED';
    else if (daysLeft < 0) status = 'OVERDUE';
    else if (daysLeft <= 7) status = 'DUE_SOON';
    else status = 'UPCOMING';
    if (status === 'FILED' && daysLeft < -10) continue; // keep the card focused on what's next
    items.push({ key, form: o.form, label: COMPLIANCE_LABEL[o.form], period: o.period, periodLabel: o.periodLabel, dueDate: o.dueDate, status, daysLeft, filedOn: f?.filedOn ?? null, ref: f?.ref ?? null });
  }
  const rank: Record<ComplianceStatus, number> = { OVERDUE: 0, DUE_SOON: 1, UPCOMING: 2, FILED: 3 };
  items.sort((a, b) => rank[a.status] - rank[b.status] || a.dueDate.localeCompare(b.dueDate));
  return items.slice(0, opts.limit ?? 8);
}

/** GSTR-1 / GSTR-3B status for one return period. */
export function gstReturnStatus(form: 'GSTR1' | 'GSTR3B', period: string, todayKey: string, filings: Record<string, ComplianceFiling>) {
  const due = `${addMonths(period, 1)}-${form === 'GSTR1' ? '11' : '20'}`;
  const f = filings[filingKey(form, period)];
  if (f) return { status: 'FILED' as const, dueDate: due, filedOn: f.filedOn, ref: f.ref };
  if (period >= todayKey.slice(0, 7)) return { status: 'OPEN' as const, dueDate: due, filedOn: null, ref: null };
  return { status: (todayKey > due ? 'OVERDUE' : 'DUE') as 'OVERDUE' | 'DUE', dueDate: due, filedOn: null, ref: null };
}
