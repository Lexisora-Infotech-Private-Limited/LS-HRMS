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
  const preview = useQuery({
    queryKey: ['leavepay', 'salary-preview', mode, paise, payType, s?.statutory.pfCeilingOpted],
    queryFn: () => lpApi.salaryPreview(mode === 'CTC' ? { ctcAnnualPaise: paise, payType, pfCeilingOpted: s?.statutory.pfCeilingOpted ?? true } : { grossMonthlyPaise: paise, payType, pfCeilingOpted: s?.statutory.pfCeilingOpted ?? true }),
    enabled: paise > 0 && !!s,
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
  const rows = paise > 0 && preview.data ? preview.data.rows : s?.rows ?? [];
  return (
    <Modal title={s ? `Salary · ${s.employeeName}` : 'Salary'} onClose={onClose} wide actions={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBlock error={q.error} />}
      {s && (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row">
            <Tag tone="accent">{s.payType === 'STIPEND' ? 'Stipend' : 'Salary'}</Tag>
            {s.effectiveFrom && <span className="faint" style={{ fontSize: 12.5 }}>Effective {s.effectiveFrom}</span>}
            {paise > 0 && preview.data && <Tag tone="outline">Preview of new revision</Tag>}
          </div>
          <table className="lp-lines">
            <thead>
              <tr><td className="faint">Component</td><td className="num faint">Monthly</td><td className="num faint">Annual</td></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className={r.code === 'CTC' ? 'total' : undefined}><td>{r.label}</td><td className="num">{formatINR(r.monthlyPaise)}</td><td className="num">{formatINR(r.annualPaise)}</td></tr>
              ))}
              {!rows.length && <tr><td colSpan={3} className="faint">No salary structure yet — add one below.</td></tr>}
            </tbody>
          </table>
          {preview.data?.warnings.map((w) => <div key={w} className="field-hint">{w}</div>)}

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
              <div className="row" style={{ gap: 16 }}>
                <label className="row" style={{ gap: 6, fontSize: 13.5 }}>
                  Tax regime
                  <select className="input" style={{ width: 110 }} value={s.statutory.taxRegime} onChange={(e) => profile.mutate({ taxRegime: e.target.value as 'OLD' | 'NEW' })}>
                    <option value="NEW">New</option>
                    <option value="OLD">Old</option>
                  </select>
                </label>
                <Check checked={s.statutory.pfEnabled} onChange={(x) => profile.mutate({ pfEnabled: x })} label="PF applicable" />
                <Check checked={s.statutory.pfCeilingOpted} onChange={(x) => profile.mutate({ pfCeilingOpted: x })} label="PF on ₹15,000 ceiling" />
                <Check checked={s.profile.idleDeductionExempt} onChange={(x) => profile.mutate({ idleDeductionExempt: x })} label="Exempt from idle deduction" />
                <Check checked={s.profile.payrollHold} onChange={(x) => profile.mutate({ payrollHold: x, holdReason: x ? 'Held by HR' : null })} label="Hold salary" />
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
