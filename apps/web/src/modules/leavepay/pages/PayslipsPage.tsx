import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatINR, type PayslipRow } from '@lexisora/shared';
import { useToast } from '@/lib/toast';
import { DataTable, type Column } from '@/components/table';
import { ErrorBlock, Loading, Modal, PageHeader, Tag } from '@/components/ui';
import { fmtDays, fmtHm, lpApi, lpKeys } from '../api';
import '../leavepay.css';

export default function PayslipsPage() {
  const q = useQuery({ queryKey: lpKeys.payslips, queryFn: lpApi.myPayslips });
  const [open, setOpen] = useState<PayslipRow | null>(null);
  const { toastError } = useToast();
  const dl = (p: PayslipRow) => lpApi.downloadPayslip(p.id).catch(toastError);
  const cols: Column<PayslipRow>[] = [
    { key: 'm', header: 'Month', render: (p) => <span>{p.month}{p.runType !== 'REGULAR' && <Tag tone="outline">{p.runType.toLowerCase()}</Tag>}</span> },
    { key: 'w', header: 'Working days', num: true, render: (p) => fmtDays(p.workingDays) },
    { key: 'p', header: 'Paid days', num: true, render: (p) => fmtDays(p.paidDays) },
    { key: 'i', header: 'Idle deduction', num: true, render: (p) => formatINR(p.idleDeductionPaise) },
    { key: 'n', header: 'Net pay', num: true, render: (p) => formatINR(p.netPaise) },
    {
      key: 'd',
      header: 'Payslip',
      render: (p) => (
        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); void dl(p); }}>Download</button>
      ),
    },
  ];
  return (
    <div data-screen-label="My payslips" className="stack" style={{ gap: 18 }}>
      <PageHeader title="My payslips" sub="Calculated from approved attendance, auto-idle time and leave." />
      {q.error ? <ErrorBlock error={q.error} retry={() => q.refetch()} /> : <DataTable columns={cols} rows={q.data} loading={q.isLoading} rowKey={(p) => p.id} onRowClick={setOpen} empty="Your payslips appear here once payroll is finalized." />}
      {open && <PayslipModal row={open} onClose={() => setOpen(null)} onDownload={() => dl(open)} />}
    </div>
  );
}

function PayslipModal({ row, onClose, onDownload }: { row: PayslipRow; onClose: () => void; onDownload: () => void }) {
  const q = useQuery({ queryKey: lpKeys.payslip(row.id), queryFn: () => lpApi.payslip(row.id) });
  const d = q.data;
  return (
    <Modal
      title={`Payslip · ${row.month}`}
      onClose={onClose}
      wide
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={onDownload}>Download PDF</button>
        </>
      }
    >
      {q.isLoading && <Loading />}
      {q.error && <ErrorBlock error={q.error} />}
      {d && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="lp-kv">
            <span>Employee</span><span>{d.employee.name} · {d.employee.code}</span>
            <span>Designation</span><span>{d.employee.designation ?? '—'}{d.employee.department ? ` · ${d.employee.department}` : ''}</span>
            <span>Pay date</span><span>{d.payDate ?? '—'}</span>
            <span>Days</span><span>{fmtDays(d.paidDays)} paid of {fmtDays(d.workingDays)} working{d.lopDays ? ` · ${fmtDays(d.lopDays)} LOP` : ''} · leave {d.leave}</span>
            {d.idleMinutes > 0 && (<><span>Idle deducted</span><span>{fmtHm(d.idleMinutes)} · {formatINR(d.idleDeductionPaise)}</span></>)}
            <span>Bank</span><span>{d.employee.bankMasked ?? '—'}</span>
          </div>
          <div className="lp-two">
            <table className="lp-lines">
              <tbody>
                {d.earnings.map((e) => <tr key={e.label}><td>{e.label}</td><td className="num">{formatINR(e.amountPaise)}</td></tr>)}
                <tr className="total"><td>Total earnings</td><td className="num">{formatINR(d.totalEarningsPaise)}</td></tr>
              </tbody>
            </table>
            <table className="lp-lines">
              <tbody>
                {d.deductions.map((e) => <tr key={e.label}><td>{e.label}</td><td className="num">{formatINR(e.amountPaise)}</td></tr>)}
                {!d.deductions.length && <tr><td className="faint">No deductions</td><td className="num">{formatINR(0)}</td></tr>}
                <tr className="total"><td>Total deductions</td><td className="num">{formatINR(d.totalDeductionsPaise)}</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 24 }}>Net pay {formatINR(d.netPaise)}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>{d.netInWords}</div>
          </div>
          <div className="faint" style={{ fontSize: 12.5 }}>
            Year to date: gross {formatINR(d.ytd.grossPaise)} · TDS {formatINR(d.ytd.tdsPaise)} · PF {formatINR(d.ytd.pfPaise)}{d.taxRegime ? ` · ${d.taxRegime === 'OLD' ? 'Old' : 'New'} tax regime` : ''}
          </div>
        </div>
      )}
    </Modal>
  );
}
