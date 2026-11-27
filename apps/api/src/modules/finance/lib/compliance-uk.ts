/**
 * UK (region GB) statutory compliance calendar (pure; unit-tested). India keeps
 * lib/compliance.ts unchanged; ComplianceService picks this one for GB tenants.
 *
 *  - VAT return + payment: 1 month and 7 days after each VAT quarter (stagger configurable,
 *    default quarters ending Mar/Jun/Sep/Dec).
 *  - PAYE/NI payment to HMRC: 22nd of the month after the pay month (electronic payment).
 *  - FPS: on or before payday (informational; month-end payday assumed).
 *  - EPS: by the 19th of the month after the pay month.
 *  - P60 to employees: 31 May; P11D / P11D(b): 6 July; Class 1A NIC payment: 22 July.
 *  - Corporation tax: payment 9 months + 1 day after the year end; CT600 12 months after.
 *  - Companies House: annual accounts 9 months after the year end (private company);
 *    confirmation statement 14 days after its review date (default: the year-end date).
 */
import { ukVatDueDate, ukVatQuarterOf, type FinComplianceItem } from '@lexisora/shared';
import { filingKey, type ComplianceFiling } from './compliance';

export type UkComplianceForm = 'VAT_RETURN' | 'PAYE_PAYMENT' | 'FPS' | 'EPS' | 'P60' | 'P11D' | 'CLASS_1A' | 'CT_PAYMENT' | 'CT600' | 'CONFIRMATION_STATEMENT' | 'ANNUAL_ACCOUNTS';

export const UK_COMPLIANCE_LABEL: Record<UkComplianceForm, string> = {
  VAT_RETURN: 'VAT return & payment',
  PAYE_PAYMENT: 'PAYE & NI payment to HMRC',
  FPS: 'Full Payment Submission (FPS, on or before payday)',
  EPS: 'Employer Payment Summary (EPS)',
  P60: 'P60s to employees',
  P11D: 'P11D & P11D(b) benefits return',
  CLASS_1A: 'Class 1A NIC payment',
  CT_PAYMENT: 'Corporation tax payment',
  CT600: 'Corporation tax return (CT600)',
  CONFIRMATION_STATEMENT: 'Confirmation statement (Companies House)',
  ANNUAL_ACCOUNTS: 'Annual accounts (Companies House)',
};

export type UkComplianceOptions = {
  /** Last month of a VAT quarter (3 → Mar/Jun/Sep/Dec, 1 → Jan/Apr/Jul/Oct, 2 → Feb/May/Aug/Nov). */
  vatStaggerEndMonth?: number;
  /** Company accounting year end (default 31 March). */
  yearEnd?: { month: number; day: number };
  /** Confirmation statement review date (default: the year-end date). */
  confirmationDate?: { month: number; day: number };
  /** No VAT number → no VAT returns. */
  vatRegistered?: boolean;
};

type Raw = { form: UkComplianceForm; period: string; periodLabel: string; dueDate: string };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const monthLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const addMonths = (ym: string, n: number) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${pad((((m % 12) + 12) % 12) + 1)}`;
};
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const dayDiff = (a: string, b: string) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86_400_000);
const addDaysKey = (key: string, n: number) => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) + n * 86_400_000).toISOString().slice(0, 10);
const fmtDay = (key: string) => `${Number(key.slice(8, 10))} ${MON[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** Date key `months` calendar months after `key`, day clamped to the month end (31 Mar + 9 → 31 Dec). */
export function addMonthsToDate(key: string, months: number): string {
  const ym = addMonths(key.slice(0, 7), months);
  const srcIsMonthEnd = Number(key.slice(8, 10)) === lastDay(key.slice(0, 7));
  const d = srcIsMonthEnd ? lastDay(ym) : Math.min(Number(key.slice(8, 10)), lastDay(ym));
  return `${ym}-${pad(d)}`;
}

/** Year-end date in calendar year `y`. */
const yearEndIn = (y: number, ye: { month: number; day: number }) => `${y}-${pad(ye.month)}-${pad(Math.min(ye.day, lastDay(`${y}-${pad(ye.month)}`)))}`;

/** All UK obligations whose period touches the months around `todayKey`. */
export function ukObligations(todayKey: string, opts: UkComplianceOptions = {}): Raw[] {
  const cur = todayKey.slice(0, 7);
  const stagger = opts.vatStaggerEndMonth ?? 3;
  const ye = opts.yearEnd ?? { month: 3, day: 31 };
  const cs = opts.confirmationDate ?? ye;
  const out: Raw[] = [];
  // Monthly PAYE (pay month p).
  for (let i = -3; i <= 3; i++) {
    const p = addMonths(cur, i);
    const n = addMonths(p, 1);
    out.push({ form: 'PAYE_PAYMENT', period: p, periodLabel: monthLabel(p), dueDate: `${n}-22` });
    out.push({ form: 'FPS', period: p, periodLabel: monthLabel(p), dueDate: `${p}-${pad(lastDay(p))}` });
    out.push({ form: 'EPS', period: p, periodLabel: monthLabel(p), dueDate: `${n}-19` });
  }
  // VAT quarters around today.
  if (opts.vatRegistered !== false) {
    const seen = new Set<string>();
    for (let i = -6; i <= 3; i++) {
      const q = ukVatQuarterOf(addMonths(cur, i), stagger);
      if (seen.has(q.period)) continue;
      seen.add(q.period);
      out.push({ form: 'VAT_RETURN', period: q.period, periodLabel: q.label, dueDate: ukVatDueDate(q.period) });
    }
  }
  const y = Number(cur.slice(0, 4));
  for (const yy of [y - 1, y, y + 1]) {
    // Employer year end: tax year 6 April (yy-1) – 5 April yy.
    const ty = `${yy - 1}/${pad(yy % 100)}`;
    out.push({ form: 'P60', period: ty, periodLabel: `Tax year ${ty}`, dueDate: `${yy}-05-31` });
    out.push({ form: 'P11D', period: ty, periodLabel: `Tax year ${ty}`, dueDate: `${yy}-07-06` });
    out.push({ form: 'CLASS_1A', period: ty, periodLabel: `Tax year ${ty}`, dueDate: `${yy}-07-22` });
  }
  for (const yy of [y - 2, y - 1, y, y + 1]) {
    // Company accounting period ending on the year end in calendar year yy.
    const end = yearEndIn(yy, ye);
    const label = `Year ended ${fmtDay(end)}`;
    out.push({ form: 'CT_PAYMENT', period: end, periodLabel: label, dueDate: addDaysKey(addMonthsToDate(end, 9), 1) });
    out.push({ form: 'CT600', period: end, periodLabel: label, dueDate: addMonthsToDate(end, 12) });
    out.push({ form: 'ANNUAL_ACCOUNTS', period: end, periodLabel: label, dueDate: addMonthsToDate(end, 9) });
    const review = yearEndIn(yy, cs);
    out.push({ form: 'CONFIRMATION_STATEMENT', period: review, periodLabel: `Review date ${fmtDay(review)}`, dueDate: addDaysKey(review, 14) });
  }
  return out;
}

/**
 * Calendar card for a UK tenant — same rules as India: overdue items from the last `pastDays`,
 * items due within `horizonDays` (DUE_SOON ≤ 7 days), recently filed ones; earliest first.
 */
export function ukComplianceCalendar(todayKey: string, filings: Record<string, ComplianceFiling>, opts: UkComplianceOptions & { horizonDays?: number; pastDays?: number; limit?: number } = {}): FinComplianceItem[] {
  const horizon = opts.horizonDays ?? 45;
  const past = opts.pastDays ?? 60;
  const items: FinComplianceItem[] = [];
  for (const o of ukObligations(todayKey, opts)) {
    const key = filingKey(o.form, o.period);
    const f = filings[key];
    const daysLeft = dayDiff(o.dueDate, todayKey);
    if (daysLeft > horizon || daysLeft < -past) continue;
    let status: FinComplianceItem['status'];
    if (f) status = 'FILED';
    else if (daysLeft < 0) status = 'OVERDUE';
    else if (daysLeft <= 7) status = 'DUE_SOON';
    else status = 'UPCOMING';
    if (status === 'FILED' && daysLeft < -10) continue;
    items.push({ key, form: o.form, label: UK_COMPLIANCE_LABEL[o.form], period: o.period, periodLabel: o.periodLabel, dueDate: o.dueDate, status, daysLeft, filedOn: f?.filedOn ?? null, ref: f?.ref ?? null });
  }
  const rank: Record<FinComplianceItem['status'], number> = { OVERDUE: 0, DUE_SOON: 1, UPCOMING: 2, FILED: 3 };
  items.sort((a, b) => rank[a.status] - rank[b.status] || a.dueDate.localeCompare(b.dueDate));
  return items.slice(0, opts.limit ?? 8);
}

/** VAT return status for one quarter (register in Filing › VAT returns). */
export function ukVatReturnStatus(period: string, todayKey: string, filings: Record<string, ComplianceFiling>) {
  const due = ukVatDueDate(period);
  const f = filings[filingKey('VAT_RETURN', period)];
  if (f) return { status: 'FILED' as const, dueDate: due, filedOn: f.filedOn, ref: f.ref };
  if (period >= todayKey.slice(0, 7)) return { status: 'OPEN' as const, dueDate: due, filedOn: null, ref: null };
  return { status: (todayKey > due ? 'OVERDUE' : 'DUE') as 'OVERDUE' | 'DUE', dueDate: due, filedOn: null, ref: null };
}
