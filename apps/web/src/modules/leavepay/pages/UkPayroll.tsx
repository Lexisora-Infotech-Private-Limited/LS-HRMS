import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  formatINR,
  formatDate,
  taxYearLabel,
  taxYearStartOfPeriod,
  UK_NI_CATEGORIES,
  UK_NI_CATEGORY_LABELS,
  UK_PENSION_SCHEME_LABELS,
  UK_PENSION_SCHEMES,
  UK_PENSION_STATUS_LABELS,
  UK_PENSION_STATUSES,
  UK_STARTER_STATEMENT_LABELS,
  UK_STARTER_STATEMENTS,
  UK_STUDENT_LOAN_LABELS,
  UK_STUDENT_LOAN_PLANS,
  type UkFpsSummary,
  type UkPayrollProfile,
  type UpdateUkPayrollInput,
} from '@lexisora/shared';
import { Card, ErrorBlock, Loading, Tag } from '@/components/ui';
import { download, get, patch, post, put } from '@/lib/api';
import { useAction } from '@/lib/query';

/** UK (region GB) payroll screens: employee PAYE details, HMRC FPS for a run, rates table. */

type UkProfileView = {
  employeeId: string;
  name: string;
  profile: UkPayrollProfile | null;
  niNumberMasked: string;
  hasNiNumber: boolean;
  sortCode: string;
  accountLast4: string | null;
  dateOfBirth: string | null;
};

const ukKeys = {
  profile: (id: string) => ['leavepay', 'uk', 'profile', id] as const,
  fps: (runId: string) => ['leavepay', 'uk', 'fps', runId] as const,
  rates: (y: number) => ['leavepay', 'uk', 'rates', y] as const,
};

const DEFAULT_PROFILE: UkPayrollProfile = {
  taxCode: '1257L',
  taxBasis: 'CUMULATIVE',
  niCategory: 'A',
  studentLoanPlans: [],
  postgraduateLoan: false,
  starterStatement: null,
  previousPayPence: 0,
  previousTaxPence: 0,
  previousTaxYear: null,
  director: false,
  irregularHours: false,
  pension: { status: 'AUTO', scheme: 'RELIEF_AT_SOURCE', basis: 'QUALIFYING', employeePct: 5, employerPct: 3, postponedUntil: null, enrolledOn: null, optedOutOn: null },
};

const pounds = (pence: number) => (pence ? (pence / 100).toFixed(2) : '');
const pence = (s: string) => Math.round(Number(String(s).replace(/[,£\s]/g, '')) * 100) || 0;

/** Tax code, NI, student loans, pension and bank details for one employee (inside the salary editor). */
export function UkEmployeePayroll({ employeeId }: { employeeId: string }) {
  const q = useQuery({ queryKey: ukKeys.profile(employeeId), queryFn: () => get<UkProfileView>(`/payroll/uk/profile/${employeeId}`) });
  const [p, setP] = useState<UkPayrollProfile>(DEFAULT_PROFILE);
  const [ni, setNi] = useState('');
  const [sort, setSort] = useState('');
  const [prevPay, setPrevPay] = useState('');
  const [prevTax, setPrevTax] = useState('');
  useEffect(() => {
    if (!q.data) return;
    const prof = q.data.profile ?? DEFAULT_PROFILE;
    setP(prof);
    setSort(q.data.sortCode);
    setPrevPay(pounds(prof.previousPayPence));
    setPrevTax(pounds(prof.previousTaxPence));
  }, [q.data]);
  const save = useAction(
    (body: UpdateUkPayrollInput) => patch<UkProfileView>(`/payroll/uk/profile/${employeeId}`, body),
    { success: 'UK payroll details saved', invalidate: [ukKeys.profile(employeeId), ['leavepay']], onSuccess: () => setNi('') },
  );
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  const d = q.data;
  const set = <K extends keyof UkPayrollProfile>(k: K, v: UkPayrollProfile[K]) => setP((x) => ({ ...x, [k]: v }));
  const setPension = <K extends keyof UkPayrollProfile['pension']>(k: K, v: UkPayrollProfile['pension'][K]) => setP((x) => ({ ...x, pension: { ...x.pension, [k]: v } }));
  const togglePlan = (plan: (typeof UK_STUDENT_LOAN_PLANS)[number]) =>
    set('studentLoanPlans', p.studentLoanPlans.includes(plan) ? p.studentLoanPlans.filter((x) => x !== plan) : [...p.studentLoanPlans, plan]);
  const submit = () => {
    const body: UpdateUkPayrollInput = { ...p, previousPayPence: pence(prevPay), previousTaxPence: pence(prevTax), sortCode: sort };
    if (ni.trim()) body.niNumber = ni;
    save.mutate(body);
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <h4 style={{ margin: 0 }}>
        PAYE, National Insurance &amp; pension {!d.profile && <Tag tone="danger">Not set up</Tag>}
      </h4>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="uk-code">Tax code</label>
          <input id="uk-code" className="input" value={p.taxCode} onChange={(e) => set('taxCode', e.target.value.toUpperCase())} placeholder="1257L" />
        </div>
        <div className="field">
          <label htmlFor="uk-basis">Basis</label>
          <select id="uk-basis" className="input" value={p.taxBasis} onChange={(e) => set('taxBasis', e.target.value as UkPayrollProfile['taxBasis'])}>
            <option value="CUMULATIVE">Cumulative</option>
            <option value="NON_CUMULATIVE">Week 1 / Month 1 (emergency)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="uk-nicat">NI category</label>
          <select id="uk-nicat" className="input" value={p.niCategory} onChange={(e) => set('niCategory', e.target.value as UkPayrollProfile['niCategory'])}>
            {UK_NI_CATEGORIES.map((c) => (
              <option key={c} value={c}>{UK_NI_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="uk-ni">National Insurance number</label>
          <input id="uk-ni" className="input" value={ni} onChange={(e) => setNi(e.target.value.toUpperCase())} placeholder={d.hasNiNumber ? `${d.niNumberMasked} (type to change)` : 'AB123456C'} />
        </div>
        <div className="field">
          <label htmlFor="uk-sort">Sort code</label>
          <input id="uk-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value)} placeholder="20-00-00" />
          <div className="field-hint">Account ending {d.accountLast4 ?? '— (add in onboarding)'}</div>
        </div>
        <div className="field">
          <label htmlFor="uk-starter">Starter checklist</label>
          <select id="uk-starter" className="input" value={p.starterStatement ?? ''} onChange={(e) => set('starterStatement', (e.target.value || null) as UkPayrollProfile['starterStatement'])}>
            <option value="">Not given / has P45</option>
            {UK_STARTER_STATEMENTS.map((s) => (
              <option key={s} value={s}>{UK_STARTER_STATEMENT_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="uk-p45pay">P45: pay to date (£)</label>
          <input id="uk-p45pay" className="input" inputMode="decimal" value={prevPay} onChange={(e) => setPrevPay(e.target.value)} placeholder="0.00" />
        </div>
        <div className="field">
          <label htmlFor="uk-p45tax">P45: tax to date (£)</label>
          <input id="uk-p45tax" className="input" inputMode="decimal" value={prevTax} onChange={(e) => setPrevTax(e.target.value)} placeholder="0.00" />
        </div>
        <div className="field span-2">
          <span className="field-label">Student loans</span>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap', fontSize: 13.5 }}>
            {UK_STUDENT_LOAN_PLANS.map((plan) => (
              <label key={plan} className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={p.studentLoanPlans.includes(plan)} onChange={() => togglePlan(plan)} /> {UK_STUDENT_LOAN_LABELS[plan]}
              </label>
            ))}
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={p.postgraduateLoan} onChange={(e) => set('postgraduateLoan', e.target.checked)} /> Postgraduate loan
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={p.director} onChange={(e) => set('director', e.target.checked)} /> Company director (annual NI)
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={p.irregularHours} onChange={(e) => set('irregularHours', e.target.checked)} /> Irregular hours (holiday 12.07%)
            </label>
          </div>
        </div>
        <div className="field">
          <label htmlFor="uk-pstatus">Workplace pension</label>
          <select id="uk-pstatus" className="input" value={p.pension.status} onChange={(e) => setPension('status', e.target.value as UkPayrollProfile['pension']['status'])}>
            {UK_PENSION_STATUSES.map((s) => (
              <option key={s} value={s}>{UK_PENSION_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="uk-pscheme">Tax relief</label>
          <select id="uk-pscheme" className="input" value={p.pension.scheme} onChange={(e) => setPension('scheme', e.target.value as UkPayrollProfile['pension']['scheme'])}>
            {UK_PENSION_SCHEMES.map((s) => (
              <option key={s} value={s}>{UK_PENSION_SCHEME_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="uk-pee">Employee %</label>
          <input id="uk-pee" className="input" inputMode="decimal" value={p.pension.employeePct} onChange={(e) => setPension('employeePct', Number(e.target.value) || 0)} />
        </div>
        <div className="field">
          <label htmlFor="uk-per">Employer %</label>
          <input id="uk-per" className="input" inputMode="decimal" value={p.pension.employerPct} onChange={(e) => setPension('employerPct', Number(e.target.value) || 0)} />
          {p.pension.employerPct < 3 && <div className="field-error">Employers must pay at least 3% on qualifying earnings</div>}
        </div>
        {p.pension.status === 'POSTPONED' && (
          <div className="field">
            <label htmlFor="uk-ppost">Postponed until</label>
            <input id="uk-ppost" type="date" className="input" value={p.pension.postponedUntil ?? ''} onChange={(e) => setPension('postponedUntil', e.target.value || null)} />
          </div>
        )}
      </div>
      {!d.dateOfBirth && <div className="field-error">Date of birth is missing: pension auto-enrolment and minimum wage checks need it.</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={save.isPending} onClick={submit}>
          Save UK payroll details
        </button>
      </div>
    </div>
  );
}

/** HMRC Full Payment Submission for a finalised UK pay run. */
export function UkFpsCard({ runId }: { runId: string }) {
  const q = useQuery({ queryKey: ukKeys.fps(runId), queryFn: () => get<UkFpsSummary>(`/payroll/uk/runs/${runId}/fps`) });
  const submit = useAction(() => post<UkFpsSummary>(`/payroll/uk/runs/${runId}/fps/submit`), { success: 'FPS recorded as sent', invalidate: [ukKeys.fps(runId)] });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  const f = q.data;
  const sent = f.submission.status !== 'NOT_SUBMITTED';
  return (
    <Card
      kicker={`Tax year ${taxYearLabel(f.taxYear, 'GB')} · month ${f.taxMonth}`}
      title={
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
          HMRC Full Payment Submission <Tag tone={sent ? 'accent' : 'danger'}>{sent ? 'Sent' : 'Not sent'}</Tag>
        </span>
      }
      actions={
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => void download(`/payroll/uk/runs/${runId}/fps.csv`, `FPS-${f.period}.csv`)}>
            Download FPS data
          </button>
          {!sent && (
            <button className="btn btn-primary btn-sm" disabled={submit.isPending} onClick={() => submit.mutate(undefined)}>
              Mark FPS as sent
            </button>
          )}
        </>
      }
    >
      <div className="grid-1-1">
        <div className="stack" style={{ gap: 4, fontSize: 13.5 }}>
          <div className="list-row"><span>Employees</span><strong>{f.employees}</strong></div>
          <div className="list-row"><span>Taxable pay</span><strong>{formatINR(f.totals.taxablePayPence, { decimals: true })}</strong></div>
          <div className="list-row"><span>PAYE tax</span><strong>{formatINR(f.totals.taxPence, { decimals: true })}</strong></div>
          <div className="list-row"><span>Employee NI</span><strong>{formatINR(f.totals.niEmployeePence, { decimals: true })}</strong></div>
          <div className="list-row"><span>Employer NI</span><strong>{formatINR(f.totals.niEmployerPence, { decimals: true })}</strong></div>
          <div className="list-row"><span>Student &amp; postgraduate loans</span><strong>{formatINR(f.totals.studentLoanPence + f.totals.postgradLoanPence, { decimals: true })}</strong></div>
          <div className="list-row"><span>Statutory pay (SSP, SMP…)</span><strong>{formatINR(f.totals.statutoryPayPence, { decimals: true })}</strong></div>
        </div>
        <div className="stack" style={{ gap: 8, fontSize: 13.5 }}>
          <div>
            Send on or before payday: <strong>{formatDate(f.paymentDate)}</strong>
          </div>
          <div>
            Pay HMRC <strong>{formatINR(f.dueToHmrcPence, { decimals: true })}</strong> by <strong>{formatDate(f.payHmrcBy)}</strong> (before any Employment Allowance).
          </div>
          <div className="faint" style={{ fontSize: 12.5 }}>
            {f.submission.note}
            {f.submission.reference ? ` Reference ${f.submission.reference}.` : ''}
          </div>
        </div>
      </div>
    </Card>
  );
}

type RatesView = { taxYear: number; label: string; effective: Record<string, unknown> & { verified: boolean; notes: string; version: string }; overrides: Record<string, unknown> | null };

/** View the HMRC rates used for a tax year and override any of them (changes every April). */
export function UkRatesCard() {
  const year = taxYearStartOfPeriod(new Date().toISOString().slice(0, 7));
  const [y, setY] = useState(year);
  const q = useQuery({ queryKey: ukKeys.rates(y), queryFn: () => get<RatesView>('/payroll/uk/rates', { taxYear: y }) });
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setText(q.data.overrides ? JSON.stringify(q.data.overrides, null, 2) : '');
  }, [q.data]);
  const save = useAction((overrides: Record<string, unknown> | null) => put<RatesView>('/payroll/uk/rates', { taxYear: y, overrides }), { success: 'Rates saved. Re-run any calculated pay run.', invalidate: [ukKeys.rates(y)] });
  const submit = () => {
    setErr(null);
    if (!text.trim()) return save.mutate(null);
    try {
      const v = JSON.parse(text) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Enter a JSON object');
      save.mutate(v as Record<string, unknown>);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Card
      kicker="HMRC rates and thresholds"
      title={
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
          Tax year {taxYearLabel(y, 'GB')} {q.data && <Tag tone={q.data.effective.verified ? 'accent' : 'danger'}>{q.data.effective.verified ? 'Checked' : 'Check against GOV.UK'}</Tag>}
        </span>
      }
      actions={
        <select className="input" style={{ width: 130 }} value={y} onChange={(e) => setY(Number(e.target.value))} aria-label="Tax year">
          {[year - 1, year, year + 1].map((t) => (
            <option key={t} value={t}>{taxYearLabel(t, 'GB')}</option>
          ))}
        </select>
      }
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error || !q.data ? (
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="faint" style={{ fontSize: 13 }}>{q.data.effective.notes}</div>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13.5 }}>Rates in use (version {q.data.effective.version})</summary>
            <pre style={{ fontSize: 12, maxHeight: 320, overflow: 'auto', background: 'var(--surface-2, #f6f4ef)', padding: 10 }}>{JSON.stringify(q.data.effective, null, 2)}</pre>
          </details>
          <div className="field">
            <label htmlFor="uk-rates">Your overrides (JSON, only the values that differ; money in pence)</label>
            <textarea id="uk-rates" className="input" rows={6} style={{ fontFamily: 'monospace', fontSize: 12.5 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'{ "statutoryPay": { "sspWeekly": 12325 } }'} />
            {err && <div className="field-error">{err}</div>}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={save.isPending} onClick={submit}>
              Save overrides
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
