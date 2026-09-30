import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatINR, formatINRCompact, type PayrollItemRow, type PayrollPeriodView, type SalaryListRow } from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef } from '@/components/form';
import { DataTable, type Column } from '@/components/table';
import { ConfirmDialog, ErrorBlock, Kpis, Loading, Modal, PageHeader, Tabs, Tag, type Tone } from '@/components/ui';
import { currentPeriod, fmtDays, fmtHm, lpApi, lpKeys } from '../api';
import { SalaryEditor } from './SalaryEditor';
import '../leavepay.css';

const ITEM_TONE: Record<string, Tone> = { READY: 'accent', FINALIZED: 'accent', PAID: 'accent', TIMESHEET_PENDING: 'outline', ON_HOLD: 'outline', STALE: 'outline', EXCLUDED: 'neutral', ERROR: 'danger' };
const RUN_LABEL: Record<string, string> = { CALCULATING: 'Calculating', CALCULATED: 'Calculated · review', FINALIZED: 'Finalized', PAID: 'Paid', FAILED: 'Failed', DRAFT: 'Draft', CANCELLED: 'Voided' };

type Tab = 'run' | 'salaries';

export default function PayrollPage() {
  const [tab, setTab] = useState<Tab>('run');
  const [period, setPeriod] = useState(currentPeriod());
  const q = useQuery({
    queryKey: lpKeys.period(period),
    queryFn: () => lpApi.period(period),
    refetchInterval: (query) => (query.state.data?.run?.status === 'CALCULATING' ? 2000 : false),
  });
  const v = q.data;
  const short = v?.periodLabel ?? period;
  const [form, setForm] = useState(false);
  const [confirm, setConfirm] = useState<'finalize' | 'paid' | 'void' | null>(null);
  const run = v?.run ?? null;
  const editable = !run || ['CALCULATED', 'FAILED'].includes(run.status);

  return (
    <div data-screen-label="Payroll run" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Payroll run"
        sub="Payroll uses RM-approved timesheets, leave and idle deductions. Lock attendance before running."
        actions={
          tab === 'run' && v ? (
            <>
              <select className="input" style={{ width: 150 }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Payroll month">
                {v.periods.map((p) => (
                  <option key={p.period} value={p.period}>{p.label}{p.status ? ` · ${RUN_LABEL[p.status] ?? p.status}` : ''}</option>
                ))}
              </select>
              {editable && <button className={`btn ${run ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setForm(true)}>Run payroll · {short}</button>}
              {run?.status === 'CALCULATING' && <button className="btn btn-secondary" disabled>Calculating…</button>}
              {run && ['CALCULATED', 'FAILED', 'CALCULATING'].includes(run.status) && <button className="btn btn-ghost" onClick={() => setConfirm('void')}>Void run</button>}
              {run?.status === 'CALCULATED' && <button className="btn btn-primary" onClick={() => setConfirm('finalize')}>Finalize &amp; publish payslips</button>}
              {run?.status === 'FINALIZED' && <button className="btn btn-primary" onClick={() => setConfirm('paid')}>Mark as paid</button>}
            </>
          ) : undefined
        }
      />
      <Tabs<Tab> tabs={[{ value: 'run', label: 'Run' }, { value: 'salaries', label: 'Salary structures' }]} value={tab} onChange={setTab} />
      {tab === 'salaries' ? (
        <SalariesTab />
      ) : q.isLoading ? (
        <Loading label="Calculating payroll preview…" />
      ) : q.error ? (
        <ErrorBlock error={q.error} retry={() => q.refetch()} />
      ) : v ? (
        <RunView v={v} />
      ) : null}
      {form && v && <RunForm v={v} onClose={() => setForm(false)} />}
      {confirm && v && run && <RunConfirm kind={confirm} v={v} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function RunView({ v }: { v: PayrollPeriodView }) {
  const [open, setOpen] = useState<PayrollItemRow | null>(null);
  const k = v.kpis;
  const run = v.run;
  const remind = useAction(() => lpApi.remindRms(v.period), { success: (r) => `Reminder sent to ${r.managers} ${r.managers === 1 ? 'manager' : 'managers'}` });
  const delta = k.grossDeltaPct === null ? 'first run on record' : `${k.grossDeltaPct >= 0 ? '+' : ''}${k.grossDeltaPct}% vs ${k.prevPeriodLabel}`;
  const cols: Column<PayrollItemRow>[] = [
    { key: 'e', header: 'Employee', render: (r) => <div><div>{r.name}</div><div className="faint" style={{ fontSize: 11.5 }}>{r.code}{r.department ? ` · ${r.department}` : ''}{r.payType === 'STIPEND' ? ' · stipend' : ''}</div></div> },
    { key: 'p', header: 'Paid days', num: true, render: (r) => <span title={`${fmtDays(r.workingDays)} working days`}>{fmtDays(r.paidDays)}</span> },
    { key: 'l', header: 'Leave', render: (r) => r.leave },
    { key: 'i', header: 'Idle', render: (r) => <span title={r.idleRawMinutes !== r.idleMinutes ? `${fmtHm(r.idleRawMinutes)} idle before allowance` : undefined}>{fmtHm(r.idleRawMinutes)}</span> },
    { key: 'g', header: 'Gross', num: true, render: (r) => formatINR(r.grossPaise) },
    { key: 'd', header: 'Deductions', num: true, render: (r) => formatINR(r.deductionsPaise) },
    { key: 'n', header: 'Net', num: true, render: (r) => formatINR(r.netPaise) },
    { key: 's', header: 'Status', render: (r) => <Tag tone={ITEM_TONE[r.status] ?? 'neutral'} title={r.errors.join(' · ') || undefined}>{r.statusLabel}</Tag> },
  ];
  return (
    <div className="stack" style={{ gap: 18 }}>
      <Kpis
        items={[
          { label: 'Employees', value: k.employees, sub: `${k.interns} ${k.interns === 1 ? 'intern' : 'interns'} on stipend` },
          { label: 'Timesheets approved', value: k.timesheetsApproved, sub: `${k.timesheetsPending} pending RM` },
          { label: 'Gross', value: formatINRCompact(k.grossPaise), sub: delta },
          { label: 'Idle deductions', value: formatINR(k.idleDeductionPaise), sub: `from ${k.idleEmployees} ${k.idleEmployees === 1 ? 'employee' : 'employees'}` },
        ]}
      />
      <div className="lp-precheck">
        {run ? (
          <Tag tone={run.status === 'FAILED' ? 'danger' : run.status === 'CALCULATED' ? 'outline' : 'accent'}>{RUN_LABEL[run.status] ?? run.status}</Tag>
        ) : (
          <Tag tone="neutral">Preview · not run yet</Tag>
        )}
        {run && <span className="faint" style={{ fontSize: 12.5 }}>{run.runNo}{run.attendanceLockDate ? ` · attendance locked to ${run.attendanceLockDate}` : ''}{run.paymentDate ? ` · pay date ${run.paymentDate}` : ''}{run.finalizedAt ? ` · finalized by ${run.finalizedBy ?? 'HR'}` : ''}</span>}
        {v.precheck.map((p) => (
          <span key={p.key} className="row" style={{ gap: 4 }}>
            <Tag tone={p.tone}>{p.text}</Tag>
            {p.action === 'REMIND_RMS' && (!run || run.status === 'CALCULATED') && (
              <button className="btn btn-ghost btn-sm" disabled={remind.isPending} onClick={() => remind.mutate(undefined)}>Remind RMs</button>
            )}
          </span>
        ))}
      </div>
      {run?.lastError && <div className="note">{run.lastError}</div>}
      <DataTable
        columns={cols}
        rows={v.items}
        rowKey={(r) => r.id}
        onRowClick={v.isPreview ? undefined : setOpen}
        empty="No employees are due for payroll this month."
        footer={
          v.items.length ? (
            <tr>
              <td colSpan={4} className="faint">Total ({k.employees - v.items.filter((i) => i.status === 'EXCLUDED').length} paid)</td>
              <td className="num">{formatINR(k.grossPaise)}</td>
              <td className="num">{formatINR(k.deductionsPaise)}</td>
              <td className="num">{formatINR(k.netPaise)}</td>
              <td />
            </tr>
          ) : undefined
        }
      />
      {v.isPreview && <div className="faint" style={{ fontSize: 12.5 }}>Preview from attendance, approved leave and idle so far; days after today are projected as present. Run payroll to lock attendance and calculate.</div>}
      {open && run && <ItemModal runId={run.id} runStatus={run.status} itemId={open.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RunForm({ v, onClose }: { v: PayrollPeriodView; onClose: () => void }) {
  const run = v.run;
  const save = useAction(
    (x: Record<string, any>) => {
      const body = { period: v.period, attendanceLockDate: x.lock, includeIdleDeduction: x.idle !== 'NO', pendingTimesheetMode: x.pending, paymentDate: x.pay };
      return run ? lpApi.updateRun(run.id, body) : lpApi.createRun(body);
    },
    { success: `Payroll for ${v.periodLabel} is calculating — review it, then finalize to publish payslips`, invalidate: [lpKeys.payroll] },
  );
  const fields: FieldDef[] = [
    { name: 'lock', label: 'Lock attendance up to', type: 'date', span: 2, required: true, hint: 'Days after the lock are paid as projected present days' },
    { name: 'idle', label: 'Include idle deduction', type: 'select', required: true, options: [{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }] },
    { name: 'pending', label: 'Pending timesheets', type: 'select', required: true, options: [{ value: 'EXCLUDE', label: `Exclude (${v.defaults.pendingCount})` }, { value: 'WAIT', label: 'Wait' }] },
    { name: 'pay', label: 'Payment date', type: 'date', span: 2, required: true },
  ];
  const initial = {
    lock: run?.attendanceLockDate ?? v.defaults.attendanceLockDate,
    idle: (run?.includeIdleDeduction ?? v.defaults.includeIdleDeduction) ? 'YES' : 'NO',
    pending: run?.pendingTimesheetMode ?? 'EXCLUDE',
    pay: run?.paymentDate ?? v.defaults.paymentDate,
  };
  return (
    <FormModal
      title={`Run payroll · ${longLabel(v.period)}`}
      fields={fields}
      initial={initial}
      submitLabel={run ? 'Re-run payroll' : 'Run payroll'}
      intro={<span className="faint">Locks attendance and leave up to the lock date, then calculates PF, ESI, professional tax, TDS, LOP and idle deductions for every employee.</span>}
      onSubmit={(x) => save.mutateAsync(x)}
      onClose={onClose}
    />
  );
}

function RunConfirm({ kind, v, onClose }: { kind: 'finalize' | 'paid' | 'void'; v: PayrollPeriodView; onClose: () => void }) {
  const run = v.run!;
  const [reason, setReason] = useState('');
  const inv = { invalidate: [lpKeys.payroll, lpKeys.payslips], onSuccess: onClose };
  const finalize = useAction(() => lpApi.finalize(run.id), { success: (r) => `Payslips generated for ${r.payslips} employees`, ...inv });
  const paid = useAction(() => lpApi.markPaid(run.id), { success: `${v.periodLabel} payroll marked as paid`, ...inv });
  const voidRun = useAction(() => lpApi.cancelRun(run.id, reason), { success: `${v.periodLabel} run voided; attendance unlocked`, ...inv });
  if (kind === 'void')
    return (
      <Modal
        title={`Void ${run.runNo}?`}
        onClose={onClose}
        actions={
          <>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" disabled={reason.trim().length < 3 || voidRun.isPending} onClick={() => voidRun.mutate(undefined)}>Void run</button>
          </>
        }
      >
        <div className="dialog-body">The calculated items are discarded and the attendance lock is released. You can run payroll again afterwards.</div>
        <div className="field">
          <label htmlFor="void-r">Reason</label>
          <input id="void-r" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Late leave approvals" />
        </div>
      </Modal>
    );
  const k = v.kpis;
  if (kind === 'paid') return <ConfirmDialog title={`Mark ${v.periodLabel} as paid?`} body={`Net ${formatINR(k.netPaise)} has been transferred to employees.`} confirmLabel="Mark as paid" busy={paid.isPending} onConfirm={() => paid.mutate(undefined)} onClose={onClose} />;
  const excluded = v.items.filter((i) => i.status === 'TIMESHEET_PENDING').length;
  return (
    <ConfirmDialog
      title={`Finalize ${v.periodLabel} payroll?`}
      body={`${k.ready} employees · gross ${formatINR(k.grossPaise)} · net ${formatINR(k.netPaise)}.${excluded ? ` ${excluded} with pending timesheets will be excluded and paid in a later run.` : ''} Payslip PDFs are generated and every employee is notified. This can't be undone.`}
      confirmLabel="Finalize & publish"
      busy={finalize.isPending}
      onConfirm={() => finalize.mutate(undefined)}
      onClose={onClose}
    />
  );
}

function ItemModal({ runId, runStatus, itemId, onClose }: { runId: string; runStatus: string; itemId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: lpKeys.item(itemId), queryFn: () => lpApi.item(itemId) });
  const [holdReason, setHoldReason] = useState('');
  const [holding, setHolding] = useState(false);
  const inv = { invalidate: [lpKeys.payroll, lpKeys.item(itemId)] };
  const hold = useAction(() => lpApi.hold(runId, itemId, holdReason), { success: 'Salary put on hold', ...inv, onSuccess: () => setHolding(false) });
  const release = useAction(() => lpApi.release(runId, itemId), { success: 'Hold released and recalculated', ...inv });
  const d = q.data;
  const earn = d?.lines.filter((l) => l.kind === 'EARNING') ?? [];
  const ded = d?.lines.filter((l) => l.kind === 'DEDUCTION') ?? [];
  const emp = d?.lines.filter((l) => l.kind === 'EMPLOYER') ?? [];
  return (
    <Modal
      title={d ? `${d.name} · ${d.code}` : 'Payroll item'}
      onClose={onClose}
      wide
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          {d?.payslipId && <button className="btn btn-secondary" onClick={() => lpApi.downloadPayslip(d.payslipId!)}>Payslip PDF</button>}
          {runStatus === 'CALCULATED' && d && d.status === 'ON_HOLD' && <button className="btn btn-primary" disabled={release.isPending} onClick={() => release.mutate(undefined)}>Release hold</button>}
          {runStatus === 'CALCULATED' && d && d.status !== 'ON_HOLD' && d.status !== 'EXCLUDED' && <button className="btn btn-secondary" onClick={() => setHolding(true)}>Hold salary</button>}
        </>
      }
    >
      {q.isLoading && <Loading />}
      {q.error && <ErrorBlock error={q.error} />}
      {d && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row">
            <Tag tone={ITEM_TONE[d.status] ?? 'neutral'}>{d.statusLabel}</Tag>
            {d.holdReason && <span className="faint">{d.holdReason}</span>}
            {d.errors.map((e) => <Tag key={e} tone="danger">{e}</Tag>)}
          </div>
          <div className="lp-two">
            <table className="lp-lines">
              <tbody>
                {earn.map((l) => (
                  <tr key={l.code + l.label}><td>{l.label}</td><td className="num">{formatINR(l.amountPaise)}</td></tr>
                ))}
                <tr className="total"><td>Total earnings</td><td className="num">{formatINR(d.grossPaise)}</td></tr>
              </tbody>
            </table>
            <table className="lp-lines">
              <tbody>
                {ded.map((l) => (
                  <tr key={l.code + l.label}><td>{l.label}</td><td className="num">{formatINR(l.amountPaise)}</td></tr>
                ))}
                {!ded.length && <tr><td className="faint">No deductions</td><td className="num">{formatINR(0)}</td></tr>}
                <tr className="total"><td>Total deductions</td><td className="num">{formatINR(d.deductionsPaise)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="row-between">
            <strong style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>Net {formatINR(d.netPaise)}</strong>
            {emp.length > 0 && <span className="faint" style={{ fontSize: 12.5 }}>Employer: {emp.map((l) => `${l.label} ${formatINR(l.amountPaise)}`).join(' · ')}</span>}
          </div>
          <div className="lp-kv">
            {d.inputs.map((i) => (
              <span key={i.label} style={{ display: 'contents' }}><span>{i.label}</span><span>{i.value}</span></span>
            ))}
          </div>
          {d.trace.length > 0 && <div className="lp-trace">{d.trace.join('\n')}</div>}
          {holding && (
            <div className="field">
              <label htmlFor="hold-r">Hold reason</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input id="hold-r" className="input" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} placeholder="e.g. Exit clearance pending" />
                <button className="btn btn-primary" disabled={holdReason.trim().length < 3 || hold.isPending} onClick={() => hold.mutate(undefined)}>Hold</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function SalariesTab() {
  const q = useQuery({ queryKey: lpKeys.salaries, queryFn: lpApi.salaries });
  const [open, setOpen] = useState<SalaryListRow | null>(null);
  const cols: Column<SalaryListRow>[] = [
    { key: 'e', header: 'Employee', render: (r) => <div><div>{r.name} {r.hold && <Tag tone="outline">On hold</Tag>}</div><div className="faint" style={{ fontSize: 11.5 }}>{r.code}{r.department ? ` · ${r.department}` : ''}</div></div> },
    { key: 't', header: 'Pay type', render: (r) => (r.payType === 'STIPEND' ? 'Stipend' : 'Salary') },
    { key: 'c', header: 'CTC / year', num: true, render: (r) => (r.ctcAnnualPaise ? formatINR(r.ctcAnnualPaise) : <Tag tone="danger">No structure</Tag>) },
    { key: 'g', header: 'Gross / month', num: true, render: (r) => (r.grossMonthlyPaise ? formatINR(r.grossMonthlyPaise) : '—') },
    { key: 'f', header: 'Effective from', render: (r) => r.effectiveFrom ?? '—' },
    { key: 'r', header: 'Tax regime', render: (r) => (r.payType === 'STIPEND' ? '—' : r.taxRegime === 'OLD' ? 'Old' : 'New') },
  ];
  return (
    <>
      {q.error ? <ErrorBlock error={q.error} retry={() => q.refetch()} /> : <DataTable columns={cols} rows={q.data} loading={q.isLoading} rowKey={(r) => r.employeeId} onRowClick={setOpen} empty="No employees." />}
      {open && <SalaryEditor employeeId={open.employeeId} onClose={() => setOpen(null)} />}
    </>
  );
}

function longLabel(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
