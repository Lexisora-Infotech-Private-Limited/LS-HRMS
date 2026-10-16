import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_ESI_SETTINGS,
  DEFAULT_PF_SETTINGS,
  EMPLOYMENT_TYPE_LABEL,
  SALARY_CALC_KINDS,
  SALARY_CALC_LABELS,
  STANDARD_SALARY_LINES,
  formatINR,
  validateSalaryTemplateLines,
  type SalaryTemplateInput,
  type SalaryTemplateLine,
  type SalaryTemplateRow,
} from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { DataTable, type Column } from '@/components/table';
import { ConfirmDialog, ErrorBlock, Modal, PageHeader, Tag } from '@/components/ui';
import { lpApi, lpKeys } from '../api';
import '../leavepay.css';

const EMP_TYPES = ['FULL_TIME', 'CONTRACT', 'INTERN'] as const;
const digits = (v: string) => v.replace(/\D/g, '');
const pct = (v: string) => {
  const m = /^\d{0,3}(\.\d{0,2})?/.exec(v.replace(/[^\d.]/g, ''));
  return m ? m[0] : '';
};
const rupeesToPaise = (v: string) => (v === '' ? null : Number(v) * 100);
const slug = (label: string) => {
  const c = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  return c.length < 2 ? '' : /^\d/.test(c) ? `C_${c}`.slice(0, 24) : c;
};

/** The range as the CTCs it actually covers: the lower limit is included, the upper limit is not (so it shows one rupee less). */
function rangeText(t: Pick<SalaryTemplateRow, 'minCtcPaise' | 'maxCtcPaise'>) {
  const { minCtcPaise: lo, maxCtcPaise: hi } = t;
  if (lo == null && hi == null) return 'Any CTC';
  if (hi == null) return `${formatINR(lo!)} and above`;
  if (lo == null) return `Up to ${formatINR(hi - 100)}`;
  return `${formatINR(lo)} – ${formatINR(hi - 100)}`;
}

function summarise(lines: SalaryTemplateLine[]) {
  const name = (code?: string) => lines.find((l) => l.componentCode === code)?.label ?? code ?? '';
  return lines.map((l) => {
    const how = l.calc === 'PERCENT_OF_GROSS' ? `${l.value}%` : l.calc === 'PERCENT_OF_COMPONENT' ? `${l.value}% of ${name(l.base)}` : l.calc === 'FIXED' ? `₹${l.value}` : 'balance';
    return `${l.kind === 'DEDUCTION' ? '− ' : ''}${l.label} ${how}`;
  });
}

/** Salary structures (Admin/CEO and HR): how an annual CTC splits into earnings and company deductions, per CTC range. */
export default function SalaryStructuresPage() {
  const q = useQuery({ queryKey: lpKeys.templates, queryFn: lpApi.templates });
  const [editing, setEditing] = useState<null | 'new' | 'standard' | SalaryTemplateRow>(null);
  const [removing, setRemoving] = useState<SalaryTemplateRow | null>(null);
  const remove = useAction((t: SalaryTemplateRow) => lpApi.deleteTemplate(t.id), {
    success: (r) => (r.deactivated ? 'Structure deactivated (it is used by existing salaries)' : 'Structure deleted'),
    invalidate: [lpKeys.templates],
    onSuccess: () => setRemoving(null),
  });
  const rows = q.data ?? [];
  const cols: Column<SalaryTemplateRow>[] = [
    { key: 'n', header: 'Structure', render: (t) => <div>{t.name} {t.isDefault && <Tag tone="accent">Default</Tag>} {!t.active && <Tag>Inactive</Tag>}</div> },
    {
      key: 'a',
      header: 'Applies to',
      render: (t) => (
        <div>
          <div>{rangeText(t)}</div>
          <div className="faint" style={{ fontSize: 11.5 }}>{t.employmentTypes.length ? t.employmentTypes.map((e) => EMPLOYMENT_TYPE_LABEL[e] ?? e).join(', ') : 'All employee types'}</div>
        </div>
      ),
    },
    { key: 'c', header: 'Components', render: (t) => <span className="faint" style={{ fontSize: 12.5 }}>{[...summarise(t.lines), `PF ${t.pf.employerPct}% employer / ${t.pf.employeePct}% employee up to ${formatINR(t.pf.wageCeiling * 100)}`, t.esi.enabled ? `ESI ${t.esi.employerPct}% / ${t.esi.employeePct}% up to ${formatINR(t.esi.grossLimit * 100)}` : 'ESI off'].join(' · ')}</span> },
    { key: 'u', header: 'Last changed', render: (t) => <span className="faint" style={{ fontSize: 12 }}>{t.updatedByName ?? '—'}<br />{t.updatedAt.slice(0, 10)}</span> },
    {
      key: 'x',
      header: '',
      render: (t) => (
        <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>Edit</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(t)}>Delete</button>
        </span>
      ),
    },
  ];
  return (
    <div data-screen-label="Salary structures" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Salary structures"
        sub="How an annual CTC splits into earnings and company deductions, chosen by CTC range."
        actions={<button className="btn btn-primary" onClick={() => setEditing('new')}>Add structure</button>}
      />
      <div className="note" style={{ fontSize: 13 }}>
        A structure applies to <b>new salary revisions</b> whose annual CTC falls in its range — existing salaries are not changed. PF, ESI, professional tax and income tax
        always follow the statutory rules; use a structure for your own allowances and company deductions.
      </div>
      {q.error ? (
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      ) : (
        <DataTable columns={cols} rows={q.data ? rows : undefined} loading={q.isLoading} rowKey={(t) => t.id} onRowClick={(t) => setEditing(t)} empty="No custom structure yet." />
      )}
      {q.data && !rows.length && (
        <div className="card" style={{ padding: 16 }}>
          <div className="stack" style={{ gap: 8 }}>
            <div>No custom structure yet, so the <b>built-in Standard</b> applies to every salary: Basic 50% of gross, HRA 50% of Basic, Special allowance = the balance.</div>
            <div><button className="btn btn-secondary" onClick={() => setEditing('standard')}>Start from the Standard structure</button></div>
          </div>
        </div>
      )}
      {editing && <TemplateEditor row={typeof editing === 'object' ? editing : null} fromStandard={editing === 'standard'} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Delete “${removing.name}”?`}
          body="If existing salaries were created with it, it is only deactivated so their history stays intact. Salaries already set are not changed either way."
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

type EditorLine = { code: string; locked: boolean; label: string; kind: 'EARNING' | 'DEDUCTION'; calc: (typeof SALARY_CALC_KINDS)[number]; value: string; base: string };

/** Basic is always a % of gross. Any other earning can be a % of gross, a % of Basic, a fixed amount, or the balance; deductions can be a % of gross, a % of Basic or fixed. */
const methodsFor = (l: Pick<EditorLine, 'kind' | 'code'>): EditorLine['calc'][] =>
  l.kind === 'DEDUCTION' ? ['PERCENT_OF_GROSS', 'PERCENT_OF_COMPONENT', 'FIXED'] : l.code === 'BASIC' ? ['PERCENT_OF_GROSS'] : ['PERCENT_OF_GROSS', 'PERCENT_OF_COMPONENT', 'FIXED', 'BALANCING'];

const toEditor = (l: SalaryTemplateLine): EditorLine => ({ code: l.componentCode, locked: true, label: l.label, kind: l.kind, calc: l.calc, value: l.value != null ? String(l.value) : '', base: l.calc === 'PERCENT_OF_COMPONENT' ? 'BASIC' : (l.base ?? '') });
const toLine = (e: EditorLine): SalaryTemplateLine => ({ componentCode: e.code, label: e.label.trim(), kind: e.kind, calc: e.calc, ...(e.calc === 'BALANCING' ? {} : { value: e.value === '' ? undefined : Number(e.value) }), ...(e.calc === 'PERCENT_OF_COMPONENT' ? { base: 'BASIC' } : {}) });

function TemplateEditor({ row, fromStandard, onClose }: { row: SalaryTemplateRow | null; fromStandard: boolean; onClose: () => void }) {
  const [name, setName] = useState(row?.name ?? (fromStandard ? 'Standard' : ''));
  const [types, setTypes] = useState<string[]>(row?.employmentTypes ?? []);
  const [minR, setMinR] = useState(row?.minCtcPaise != null ? String(row.minCtcPaise / 100) : '');
  const [maxR, setMaxR] = useState(row?.maxCtcPaise != null ? String(row.maxCtcPaise / 100) : '');
  const [isDefault, setIsDefault] = useState(row?.isDefault ?? fromStandard);
  const [active, setActive] = useState(row?.active ?? true);
  const [lines, setLines] = useState<EditorLine[]>((row?.lines ?? (fromStandard || !row ? STANDARD_SALARY_LINES : [])).map(toEditor));
  const [eePct, setEePct] = useState(String((row?.pf ?? DEFAULT_PF_SETTINGS).employeePct));
  const [erPct, setErPct] = useState(String((row?.pf ?? DEFAULT_PF_SETTINGS).employerPct));
  const [ceiling, setCeiling] = useState(String((row?.pf ?? DEFAULT_PF_SETTINGS).wageCeiling));
  const [esiOn, setEsiOn] = useState((row?.esi ?? DEFAULT_ESI_SETTINGS).enabled);
  const [esiEr, setEsiEr] = useState(String((row?.esi ?? DEFAULT_ESI_SETTINGS).employerPct));
  const [esiEe, setEsiEe] = useState(String((row?.esi ?? DEFAULT_ESI_SETTINGS).employeePct));
  const [esiLimit, setEsiLimit] = useState(String((row?.esi ?? DEFAULT_ESI_SETTINGS).grossLimit));
  const [sample, setSample] = useState(row?.minCtcPaise ? String(Math.max(row.minCtcPaise / 100, 100000)) : '600000');

  const payload = useMemo(() => lines.map(toLine), [lines]);
  const problems = useMemo(() => validateSalaryTemplateLines(payload), [payload]);
  const minP = rupeesToPaise(minR);
  const maxP = rupeesToPaise(maxR);
  const rangeBad = minP != null && maxP != null && minP >= maxP;
  const blank = lines.some((l) => !l.label.trim() || !l.code);
  const pfProblems = [
    eePct === '' || Number(eePct) > 25 ? 'Employee PF % must be between 0 and 25' : '',
    erPct === '' || Number(erPct) > 25 ? 'Employer PF % must be between 0 and 25' : '',
    Number(ceiling) < 1000 || Number(ceiling) > 100000 ? 'PF wage ceiling must be between 1,000 and 1,00,000' : '',
  ].filter(Boolean);
  const esiProblems = esiOn
    ? [
        esiEr === '' || Number(esiEr) > 10 ? 'Employer ESI % must be between 0 and 10' : '',
        esiEe === '' || Number(esiEe) > 10 ? 'Employee ESI % must be between 0 and 10' : '',
        Number(esiLimit) < 1000 || Number(esiLimit) > 100000 ? 'ESI gross limit must be between 1,000 and 1,00,000' : '',
      ].filter(Boolean)
    : [];
  const esi = useMemo(() => ({ enabled: esiOn, employeePct: Number(esiEe) || 0, employerPct: Number(esiEr) || 0, grossLimit: Number(esiLimit) || 21000 }), [esiOn, esiEe, esiEr, esiLimit]);
  const pf = useMemo(() => ({ employeePct: Number(eePct) || 0, employerPct: Number(erPct) || 0, wageCeiling: Number(ceiling) || 0 }), [eePct, erPct, ceiling]);
  const ready = name.trim().length >= 2 && !blank && !problems.length && !rangeBad && !pfProblems.length && !esiProblems.length;

  // Live preview (debounced) of the monthly breakup for a sample CTC.
  const [debounced, setDebounced] = useState({ payload, sample, pf, esi });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ payload, sample, pf, esi }), 350);
    return () => clearTimeout(t);
  }, [payload, sample, pf, esi]);
  const samplePaise = Number(sample) * 100;
  const previewable = samplePaise > 0 && !blank && lines.length > 0;
  const preview = useQuery({
    queryKey: ['leavepay', 'template-preview', JSON.stringify(debounced.payload), debounced.sample, JSON.stringify(debounced.pf), JSON.stringify(debounced.esi)],
    queryFn: () => lpApi.previewTemplate({ ctcAnnualPaise: Number(debounced.sample) * 100, lines: debounced.payload, pfCeilingOpted: true, pf: debounced.pf, esi: debounced.esi }),
    enabled: previewable && !problems.length && !pfProblems.length && !esiProblems.length,
    placeholderData: (p) => p,
  });

  // The lowest CTC at which no component goes negative (from the preview); the range must start at or above it.
  const floor = !problems.length && !pfProblems.length && !esiProblems.length ? preview.data?.lowestCtcPaise ?? 0 : 0;
  const floorBad = floor > 0 && (minP ?? 0) < floor;
  const save = useAction(
    () => {
      const body: SalaryTemplateInput = { name: name.trim(), employmentTypes: types as SalaryTemplateInput['employmentTypes'], minCtcPaise: minP, maxCtcPaise: maxP, isDefault, active, pf, esi, lines: payload };
      return row ? lpApi.updateTemplate(row.id, body) : lpApi.createTemplate(body);
    },
    { success: row ? 'Structure saved' : 'Structure added', invalidate: [lpKeys.templates], onSuccess: onClose },
  );

  const setLine = (i: number, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const rename = (i: number, label: string) =>
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        if (l.locked) return { ...l, label };
        let code = slug(label);
        const taken = new Set(ls.filter((_, k) => k !== i).map((x) => x.code));
        for (let n = 2; code && taken.has(code); n++) code = `${slug(label).slice(0, 21)}_${n}`;
        return { ...l, label, code };
      }),
    );

  return (
    <Modal
      title={row ? `Edit “${row.name}”` : 'Add salary structure'}
      onClose={onClose}
      wide
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!ready || floorBad || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending ? 'Saving…' : 'Save structure'}</button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="st-name">Structure name</label>
            <input id="st-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Executive (₹6L and above)" />
          </div>
          <div className="field">
            <label htmlFor="st-min">CTC from (₹ per year, optional)</label>
            <input id="st-min" className="input" inputMode="numeric" value={minR} onChange={(e) => setMinR(digits(e.target.value))} placeholder="0" />
          </div>
          <div className="field">
            <label htmlFor="st-max">CTC up to, not including (₹ per year, optional)</label>
            <input id="st-max" className="input" inputMode="numeric" value={maxR} onChange={(e) => setMaxR(digits(e.target.value))} placeholder="no upper limit" aria-invalid={rangeBad || undefined} />
            {rangeBad && <div className="field-error">The upper CTC must be higher than the lower CTC</div>}
          </div>
          {!rangeBad && (minP != null || maxP != null) && (
            <div className="faint span-2" style={{ fontSize: 12.5 }}>
              Applies to a CTC {minP != null && maxP != null ? `from ${formatINR(minP)} to ${formatINR(maxP - 100)}` : minP != null ? `of ${formatINR(minP)} and above` : `up to ${formatINR(maxP! - 100)}`}
              {maxP != null && <> — a CTC of exactly {formatINR(maxP)} falls to the next structure.</>}
            </div>
          )}
          {floorBad && (
            <div className="field-error span-2">
              This structure only works from an annual CTC of about {formatINR(floor)}: below that the balancing component would go negative. Raise “CTC from” to at least {formatINR(floor)}, or reduce the fixed amounts.
            </div>
          )}
          <div className="field span-2">
            <label>Employee types (none selected = all)</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {EMP_TYPES.map((t) => (
                <button key={t} type="button" className={`btn btn-sm ${types.includes(t) ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTypes((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))}>
                  {EMPLOYMENT_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <label className="radio" style={{ gridColumn: 'span 2' }}>
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            <span className="dot" style={{ borderRadius: 3 }} />
            Default structure — used when no CTC range matches
          </label>
          {row && (
            <label className="radio" style={{ gridColumn: 'span 2' }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span className="dot" style={{ borderRadius: 3 }} />
              Active
            </label>
          )}
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="kicker">Components</div>
          <div className="faint" style={{ fontSize: 12.5 }}>
            Earnings add up to the monthly gross. Company deductions are taken from pay after PF, ESI and tax. Keep exactly one “Balance” earning so the parts add up.
          </div>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px,1.4fr) 110px minmax(150px,1.3fr) 100px minmax(120px,1fr) 32px', gap: 8, alignItems: 'center' }}>
              <input className="input" aria-label="Component name" value={l.label} maxLength={40} onChange={(e) => rename(i, e.target.value)} placeholder="Component name" />
              <select className="input" aria-label="Type" value={l.kind} onChange={(e) => {
                const kind = e.target.value as EditorLine['kind'];
                const allowed = methodsFor({ kind, code: l.code });
                setLine(i, { kind, ...(allowed.includes(l.calc) ? {} : { calc: allowed[0]!, base: allowed[0] === 'PERCENT_OF_COMPONENT' ? 'BASIC' : '' }) });
              }}>
                <option value="EARNING">Earning</option>
                <option value="DEDUCTION">Deduction</option>
              </select>
              <select className="input" aria-label="Method" value={l.calc} onChange={(e) => setLine(i, { calc: e.target.value as EditorLine['calc'], base: e.target.value === 'PERCENT_OF_COMPONENT' ? 'BASIC' : '' })}>
                {methodsFor(l).map((k) => <option key={k} value={k}>{SALARY_CALC_LABELS[k]}</option>)}
              </select>
              {l.calc === 'BALANCING' ? (
                <span className="faint" style={{ fontSize: 12 }}>the rest</span>
              ) : (
                <input className="input" aria-label={l.calc === 'FIXED' ? 'Amount in rupees' : 'Percentage'} inputMode="decimal" value={l.value} onChange={(e) => setLine(i, { value: l.calc === 'FIXED' ? digits(e.target.value) : pct(e.target.value) })} placeholder={l.calc === 'FIXED' ? '₹ / month' : '%'} />
              )}
              {l.calc === 'PERCENT_OF_COMPONENT' ? <span className="faint" style={{ fontSize: 12 }}>of Basic</span> : l.calc === 'PERCENT_OF_GROSS' ? <span className="faint" style={{ fontSize: 12 }}>of gross</span> : <span />}
              <button className="btn btn-ghost btn-sm" aria-label={`Remove ${l.label || 'component'}`} title="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={l.code === 'BASIC'}>✕</button>
            </div>
          ))}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, { code: '', locked: false, label: '', kind: 'EARNING', calc: 'FIXED', value: '', base: '' }])}>+ Add earning</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, { code: '', locked: false, label: '', kind: 'DEDUCTION', calc: 'PERCENT_OF_GROSS', value: '', base: '' }])}>+ Add company deduction</button>
          </div>
          {problems.map((p) => <div key={p} className="field-error">{p}</div>)}
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="kicker">Provident fund (PF)</div>
          <div className="faint" style={{ fontSize: 12.5 }}>
            PF is added automatically from Basic using these rates. Defaults are the statutory 12% + 12% on a ₹15,000 wage ceiling. To switch PF off for one employee, untick <b>PF applicable</b> in that employee&apos;s salary screen.
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pf-er">Employer contribution (% of Basic)</label>
              <input id="pf-er" className="input" inputMode="decimal" value={erPct} onChange={(e) => setErPct(pct(e.target.value))} aria-invalid={Number(erPct) > 25 || erPct === '' || undefined} />
            </div>
            <div className="field">
              <label htmlFor="pf-ee">Employee contribution (% of Basic)</label>
              <input id="pf-ee" className="input" inputMode="decimal" value={eePct} onChange={(e) => setEePct(pct(e.target.value))} aria-invalid={Number(eePct) > 25 || eePct === '' || undefined} />
            </div>
            <div className="field span-2">
              <label htmlFor="pf-ceil">Monthly wage ceiling (₹) — PF is calculated on Basic up to this amount</label>
              <input id="pf-ceil" className="input" inputMode="numeric" value={ceiling} onChange={(e) => setCeiling(digits(e.target.value))} />
            </div>
          </div>
          {pfProblems.map((p) => <div key={p} className="field-error">{p}</div>)}
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="kicker">Employees' State Insurance (ESI)</div>
          <div className="faint" style={{ fontSize: 12.5 }}>
            ESI is added automatically when the monthly gross is at or below the limit below (employer share is part of the CTC; the employee share is deducted in payroll). Defaults are the statutory 3.25% + 0.75% up to ₹21,000. To override it for one employee, set <b>ESI</b> to Always on or Off in that employee&apos;s salary screen.
          </div>
          <label className="radio">
            <input type="checkbox" checked={esiOn} onChange={(e) => setEsiOn(e.target.checked)} />
            <span className="dot" style={{ borderRadius: 3 }} />
            Apply ESI under this structure
          </label>
          {esiOn && (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="esi-er">Employer contribution (% of gross)</label>
                <input id="esi-er" className="input" inputMode="decimal" value={esiEr} onChange={(e) => setEsiEr(pct(e.target.value))} aria-invalid={Number(esiEr) > 10 || esiEr === '' || undefined} />
              </div>
              <div className="field">
                <label htmlFor="esi-ee">Employee contribution (% of gross)</label>
                <input id="esi-ee" className="input" inputMode="decimal" value={esiEe} onChange={(e) => setEsiEe(pct(e.target.value))} aria-invalid={Number(esiEe) > 10 || esiEe === '' || undefined} />
              </div>
              <div className="field span-2">
                <label htmlFor="esi-limit">Monthly gross limit (₹) — ESI applies when gross is at or below this</label>
                <input id="esi-limit" className="input" inputMode="numeric" value={esiLimit} onChange={(e) => setEsiLimit(digits(e.target.value))} />
              </div>
            </div>
          )}
          {esiProblems.map((p) => <div key={p} className="field-error">{p}</div>)}
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="row-between">
            <div className="kicker">Preview</div>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <label htmlFor="st-sample" className="faint" style={{ fontSize: 12.5 }}>For an annual CTC of ₹</label>
              <input id="st-sample" className="input" style={{ width: 130 }} inputMode="numeric" value={sample} onChange={(e) => setSample(digits(e.target.value))} />
            </div>
          </div>
          {preview.data && !problems.length ? (
            <table className="lp-lines">
              <thead>
                <tr><td className="faint">Component</td><td className="num faint">Monthly</td><td className="num faint">Annual</td></tr>
              </thead>
              <tbody>
                {preview.data.rows.filter((r) => r.kind !== 'DEDUCTION').map((r) => (
                  <tr key={r.code} className={r.code === 'CTC' ? 'total' : undefined}><td>{r.label}</td><td className="num">{formatINR(r.monthlyPaise)}</td><td className="num">{formatINR(r.annualPaise)}</td></tr>
                ))}
                {preview.data.rows.some((r) => r.kind === 'DEDUCTION') && <tr><td colSpan={3} className="faint" style={{ paddingTop: 10 }}>Company deductions (taken from pay)</td></tr>}
                {preview.data.rows.filter((r) => r.kind === 'DEDUCTION').map((r) => (
                  <tr key={r.code}><td>− {r.label}</td><td className="num">{formatINR(r.monthlyPaise)}</td><td className="num">{formatINR(r.annualPaise)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="faint" style={{ fontSize: 12.5 }}>{problems.length ? 'Fix the issues above to see the preview.' : 'Enter an annual CTC to see the monthly breakup.'}</div>
          )}
          {preview.data?.warnings.filter((w) => !problems.includes(w)).map((w) => <div key={w} className="field-hint">{w}</div>)}
        </div>
      </div>
    </Modal>
  );
}
