import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatINR, type SalaryRevisionInput } from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { Check, ErrorBlock, Loading, Modal, Seg, Tag } from '@/components/ui';
import { lpApi, lpKeys } from '../api';
import '../leavepay.css';

const REASONS: { value: SalaryRevisionInput['reason']; label: string }[] = [
  { value: 'APPRAISAL', label: 'Appraisal' },
  { value: 'PROMOTION', label: 'Promotion' },
  { value: 'JOINING', label: 'Joining' },
  { value: 'CORRECTION', label: 'Correction' },
  { value: 'OTHER', label: 'Other' },
];

/** HR salary editor: current structure (Basic/HRA/Special/PF employer/CTC), revisions, and a new revision with live preview. */
export function SalaryEditor({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: lpKeys.salary(employeeId), queryFn: () => lpApi.salary(employeeId) });
  const s = q.data;
  const [mode, setMode] = useState<'CTC' | 'GROSS'>('CTC');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('');
  const [reason, setReason] = useState<SalaryRevisionInput['reason']>('APPRAISAL');
  const [note, setNote] = useState('');
  const payType = s?.payType ?? 'SALARY';
  const paise = Math.round(Number(amount.replace(/[,₹\s]/g, '')) * 100) || 0;
  // With no amount typed, preview the CURRENT CTC under the employee's current PF / ESI settings, so ticking a box shows its
  // effect straight away (the saved structure only changes when a revision is saved).
  const baseCtc = s?.ctcAnnualPaise ?? 0;
  const typed = paise > 0;
  const prevAmount = typed ? paise : baseCtc;
  const prevMode = typed ? mode : 'CTC';
  const preview = useQuery({
    queryKey: ['leavepay', 'salary-preview', employeeId, prevMode, prevAmount, payType, s?.statutory.pfEnabled, s?.statutory.pfCeilingOpted, s?.profile.esiMode],
    queryFn: () => lpApi.salaryPreview(prevMode === 'CTC' ? { ctcAnnualPaise: prevAmount, payType, employeeId, pfCeilingOpted: s?.statutory.pfCeilingOpted ?? true } : { grossMonthlyPaise: prevAmount, payType, employeeId, pfCeilingOpted: s?.statutory.pfCeilingOpted ?? true }),
    enabled: prevAmount > 0 && !!s,
    placeholderData: (p) => p,
  });
  const inv = { invalidate: [lpKeys.salaries, lpKeys.salary(employeeId), lpKeys.payroll] };
  const revise = useAction(() => lpApi.revise(employeeId, { effectiveFrom: from, mode, amountPaise: paise, payType, reason, note: note || undefined }), {
    success: 'Salary revision saved',
    ...inv,
    onSuccess: () => {
      setAmount('');
      setNote('');
    },
  });
  const profile = useAction((body: Parameters<typeof lpApi.updateProfile>[1]) => lpApi.updateProfile(employeeId, body), { success: 'Payroll profile updated', ...inv });
  // Does the live preview differ from the saved structure? (PF / ESI switched, or the structure changed since the revision.)
  const savedByCode = new Map((s?.rows ?? []).map((r) => [r.code, r.monthlyPaise]));
  const changed = !typed && !!preview.data && !!s?.rows.length && (preview.data.rows.length !== s.rows.length || preview.data.rows.some((r) => savedByCode.get(r.code) !== r.monthlyPaise));
  const rows = (typed || changed) && preview.data ? preview.data.rows : s?.rows ?? [];
  return (
    <Modal title={s ? `Salary · ${s.employeeName}` : 'Salary'} onClose={onClose} wide actions={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBlock error={q.error} />}
      {s && (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row">
            <Tag tone="accent">{s.payType === 'STIPEND' ? 'Stipend' : 'Salary'}</Tag>
            {s.effectiveFrom && <span className="faint" style={{ fontSize: 12.5 }}>Effective {s.effectiveFrom}</span>}
            {typed && preview.data && <Tag tone="outline">Preview of new revision</Tag>}
            {changed && <Tag tone="outline">Preview · PF / ESI settings changed</Tag>}
            {paise > 0 && preview.data?.templateName && <Tag tone="outline">Structure: {preview.data.templateName}</Tag>}
          </div>
          <table className="lp-lines">
            <thead>
              <tr><td className="faint">Component</td><td className="num faint">Monthly</td><td className="num faint">Annual</td></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className={r.code === 'CTC' ? 'total' : undefined}><td>{r.kind === 'DEDUCTION' ? `− ${r.label} (company deduction)` : r.label}</td><td className="num">{formatINR(r.monthlyPaise)}</td><td className="num">{formatINR(r.annualPaise)}</td></tr>
              ))}
              {!rows.length && <tr><td colSpan={3} className="faint">No salary structure yet — add one below.</td></tr>}
            </tbody>
          </table>
          {preview.data?.warnings.map((w) => <div key={w} className="field-hint">{w}</div>)}
          {changed && s?.canEdit && (
            <div className="note" style={{ fontSize: 12.5 }}>
              This shows your PF / ESI change on the current CTC. It applies to payroll only once you save a revision.{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => { setMode('CTC'); setAmount(String(baseCtc / 100)); }}>Use the current CTC for a revision</button>
            </div>
          )}

          {s.canEdit && (
            <div className="stack" style={{ gap: 10 }}>
              <h4 style={{ margin: 0 }}>New revision</h4>
              <div className="form-grid">
                <div className="field">
                  <label>Amount as</label>
                  <Seg options={[{ value: 'CTC', label: s.payType === 'STIPEND' ? 'Annual' : 'Annual CTC' }, { value: 'GROSS', label: 'Monthly gross' }]} value={mode} onChange={setMode} />
                </div>
                <div className="field">
                  <label htmlFor="sal-amt">Amount (₹)</label>
                  <input id="sal-amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={mode === 'CTC' ? '10,29,600' : '84,000'} />
                </div>
                <div className="field">
                  <label htmlFor="sal-from">Effective from</label>
                  <input id="sal-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="sal-reason">Reason</label>
                  <select id="sal-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value as SalaryRevisionInput['reason'])}>
                    {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div className="field span-2">
                  <label htmlFor="sal-note">Note</label>
                  <input id="sal-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" disabled={!paise || !from || revise.isPending} onClick={() => revise.mutate(undefined)}>Save revision</button>
              </div>
              <h4 style={{ margin: 0 }}>Statutory &amp; tax</h4>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <label className="row" style={{ gap: 6, fontSize: 13.5 }}>
                  Tax regime
                  <select className="input" style={{ width: 110 }} value={s.statutory.taxRegime} onChange={(e) => profile.mutate({ taxRegime: e.target.value as 'OLD' | 'NEW' })}>
                    <option value="NEW">New</option>
                    <option value="OLD">Old</option>
                  </select>
                </label>
                {/* Check is a bare box (aria-label only), so each one gets visible text beside it. */}
                {([
                  { checked: s.statutory.pfEnabled, label: 'PF applicable', onChange: (x: boolean) => profile.mutate({ pfEnabled: x }) },
                  { checked: s.statutory.pfCeilingOpted, label: 'PF on wage ceiling', onChange: (x: boolean) => profile.mutate({ pfCeilingOpted: x }) },
                  { checked: s.profile.idleDeductionExempt, label: 'Exempt from idle deduction', onChange: (x: boolean) => profile.mutate({ idleDeductionExempt: x }) },
                  { checked: s.profile.payrollHold, label: 'Hold salary', onChange: (x: boolean) => profile.mutate({ payrollHold: x, holdReason: x ? 'Held by HR' : null }) },
                ]).map((c) => (
                  <span key={c.label} className="row" style={{ gap: 6, fontSize: 13.5, alignItems: 'center' }}>
                    <Check checked={c.checked} onChange={c.onChange} label={c.label} />
                    <span onClick={() => c.onChange(!c.checked)} style={{ cursor: 'pointer' }}>{c.label}</span>
                  </span>
                ))}
                <label className="row" style={{ gap: 6, fontSize: 13.5 }}>
                  ESI
                  <select className="input" style={{ width: 150 }} value={s.profile.esiMode} onChange={(e) => profile.mutate({ esiMode: e.target.value as 'AUTO' | 'FORCE_ON' | 'FORCE_OFF' })}>
                    <option value="AUTO">Automatic (by gross)</option>
                    <option value="FORCE_ON">Always on</option>
                    <option value="FORCE_OFF">Off</option>
                  </select>
                </label>
              </div>
              <div className="faint" style={{ fontSize: 12.5 }}>
                UAN {s.statutory.uan ?? '—'} · PT {s.statutory.ptState} · ESI {s.statutory.esiCovered ? 'covered' : 'not applicable'} · PAN {s.statutory.panMasked ?? '—'} · Bank {s.bank.accountMasked ?? 'missing'}
              </div>
            </div>
          )}

          {s.revisions.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <h4 style={{ margin: 0 }}>Revisions</h4>
              {s.revisions.map((r) => (
                <div key={r.id} className="list-row">
                  <span>{r.effectiveFrom} · {r.reason.charAt(0) + r.reason.slice(1).toLowerCase()}{r.by ? ` · ${r.by}` : ''}</span>
                  <span>{formatINR(r.ctcAnnualPaise)} CTC · {formatINR(r.grossMonthlyPaise)}/mo {r.status !== 'ACTIVE' && <Tag>{r.status.toLowerCase()}</Tag>}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
