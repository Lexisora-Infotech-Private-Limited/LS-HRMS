import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DOC_CATEGORY_LABELS,
  EXIT_TYPE_LABELS,
  EXIT_TYPES,
  VAULT_UPLOAD_TYPES,
  formatDate,
  formatHm,
  formatINR,
  type ExitCaseDto,
  type ProfileAssetRow,
  type ProfileAttendanceRow,
  type ProfileDto,
  type ProfilePayRow,
  type ProfileTab,
} from '@lexisora/shared';
import { fileUrl } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { DataTable, type Column } from '@/components/table';
import { ConfirmDialog, ErrorBlock, Loading, Modal, Tag } from '@/components/ui';
import { DevicesPanel } from '@/modules/tracker/DevicesPanel';
import { peopleApi, peopleKeys } from '../api';
import { DocumentsTable, EmployeeFormModal, SelfEditModal, WORK_MODE_SHORT, statusTone, todayKey } from '../components';
import '../people.css';

const TAB_LABEL: Record<ProfileTab, string> = { overview: 'Overview', documents: 'Documents', assets: 'Assets', pay: 'Offer & pay', attendance: 'Attendance', devices: 'Devices' };

/** Employee profile (/employees/:id) and own profile (/me). */
export default function ProfilePage({ self }: { self?: boolean }) {
  const params = useParams();
  const id = self ? 'me' : params.id!;
  const nav = useNavigate();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const [dialog, setDialog] = useState<null | 'edit' | 'exit' | 'convert' | 'invite'>(null);
  const q = useQuery({ queryKey: peopleKeys.profile(id), queryFn: () => peopleApi.profile(id) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  const p = q.data;
  const tab = (p.visibleTabs.includes(sp.get('tab') as ProfileTab) ? sp.get('tab') : 'overview') as ProfileTab;
  const setTab = (t: ProfileTab) => setSp(t === 'overview' ? {} : { tab: t }, { replace: true });
  const joined = p.joiningDate ? formatDate(p.joiningDate) : null;

  return (
    <div data-screen-label={self ? 'My profile' : 'Employee profile'} className="stack" style={{ gap: 18 }}>
      {!self && can('employees.view') && <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/employees')}>← Employees</button>}
      <div className="pp-prof-head">
        <div className="pp-prof-photo">{p.photoFileId ? <img src={fileUrl(p.photoFileId)} alt="" /> : p.initials}</div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0 }}>{p.fullName}</h2>
          <div className="pp-prof-meta">{[p.designation, p.department, p.empCode, p.manager ? `Reports to ${p.manager}` : null].filter(Boolean).join(' · ')}</div>
          <div className="pp-tags">
            <Tag tone="accent">{WORK_MODE_SHORT[p.workMode]}</Tag>
            {joined && <Tag tone="neutral">{p.status === 'ONBOARDING' ? `Joins ${joined}` : `Joined ${joined}`}</Tag>}
            {p.status !== 'ACTIVE' && <Tag tone={statusTone(p.status)}>{p.statusLabel}</Tag>}
            {p.badges.map((b) => <Tag key={b} tone="outline">{b}</Tag>)}
            {p.moreBadges > 0 && <Tag tone="outline">+{p.moreBadges} more</Tag>}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {can('idcard.manage') ? (
            <button className="btn btn-secondary" onClick={() => nav(`/id-card?employee=${p.id}`)}>ID card</button>
          ) : p.isSelf && can('vcard.self') ? (
            <button className="btn btn-secondary" onClick={() => nav('/visiting-card')}>Visiting card</button>
          ) : null}
          {p.canLifecycle && p.status === 'ONBOARDING' && <button className="btn btn-secondary" onClick={() => setDialog('invite')}>Resend invite</button>}
          {p.canLifecycle && p.employmentType === 'INTERN' && p.status === 'ACTIVE' && <button className="btn btn-secondary" onClick={() => setDialog('convert')}>Convert to full-time</button>}
          {p.canLifecycle && (p.status === 'ACTIVE' || p.status === 'ONBOARDING') && <button className="btn btn-secondary" onClick={() => setDialog('exit')}>Start exit</button>}
          {(p.canEdit || p.canEditSelf) && <button className="btn btn-primary" onClick={() => setDialog('edit')}>Edit</button>}
        </div>
      </div>

      <div className="tabs" role="tablist" style={{ display: 'flex', gap: 18, borderBottom: '1px solid var(--color-divider)', flexWrap: 'wrap' }}>
        {p.visibleTabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{ font: 'inherit', fontSize: 14, padding: '8px 0', border: 0, background: 'transparent', cursor: 'pointer', color: tab === t ? 'var(--color-accent-700)' : 'var(--color-text)', borderBottom: `2px solid ${tab === t ? 'var(--color-accent)' : 'transparent'}`, marginBottom: -1 }}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview p={p} />}
      {tab === 'documents' && <DocumentsTab p={p} />}
      {tab === 'assets' && <AssetsTab id={p.id} />}
      {tab === 'pay' && <PayTab id={p.id} />}
      {tab === 'attendance' && <AttendanceTab id={p.id} />}
      {tab === 'devices' && <DevicesPanel employeeId={p.id} />}

      {dialog === 'edit' && (p.canEdit ? <EmployeeFormModal profile={p} onClose={() => setDialog(null)} /> : <SelfEditModal profile={p} onClose={() => setDialog(null)} />)}
      {dialog === 'exit' && <StartExitModal p={p} onClose={() => setDialog(null)} />}
      {dialog === 'convert' && <ConvertModal p={p} onClose={() => setDialog(null)} />}
      {dialog === 'invite' && <ResendInvite p={p} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Overview({ p }: { p: ProfileDto }) {
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="pp-kv">
        <div className="kicker" style={{ fontSize: 11 }}>Field</div>
        <div className="kicker" style={{ fontSize: 11 }}>Value</div>
        {p.overview.map((r) => [<div key={`${r.label}-l`}>{r.label}</div>, <div key={`${r.label}-v`}>{r.value}</div>])}
      </div>
      {p.exitCase && p.exitCase.status !== 'WITHDRAWN' && <ExitPanel p={p} ec={p.exitCase} />}
    </div>
  );
}

function ExitPanel({ p, ec }: { p: ProfileDto; ec: ExitCaseDto }) {
  const [confirm, setConfirm] = useState<null | 'withdraw' | 'complete'>(null);
  const [override, setOverride] = useState('');
  const inv = [['people', 'profile'], peopleKeys.employees];
  const item = useAction((a: { key: string; status: 'PENDING' | 'DONE' | 'NA' }) => peopleApi.updateChecklist(p.id, a.key, a.status), { success: 'Checklist updated', invalidate: inv });
  const withdraw = useAction(() => peopleApi.withdrawExit(p.id), { success: 'Exit withdrawn · employee is active again', invalidate: inv, onSuccess: () => setConfirm(null) });
  const complete = useAction(() => peopleApi.completeExit(p.id, override || null), { success: `${p.fullName} marked as exited`, invalidate: inv, onSuccess: () => setConfirm(null) });
  const closed = ec.status === 'COMPLETED' || p.status === 'EXITED';
  return (
    <div className="pp-exit">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="kicker">Exit · {EXIT_TYPE_LABELS[ec.exitType as keyof typeof EXIT_TYPE_LABELS] ?? ec.exitType}</div>
          <div style={{ fontSize: 13.5, marginTop: 4 }}>
            Resigned {formatDate(ec.resignationDate)} · last working day <b>{formatDate(ec.lastWorkingDay)}</b>
            {ec.noticeShortfallDays > 0 && <span className="faint"> · notice shortfall {ec.noticeShortfallDays} day{ec.noticeShortfallDays === 1 ? '' : 's'}</span>}
          </div>
          {ec.reason && <div className="faint" style={{ fontSize: 12.5 }}>{ec.reason}</div>}
        </div>
        {p.canLifecycle && !closed && (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirm('withdraw')}>Withdraw</button>
            <button className="btn btn-primary btn-sm" onClick={() => setConfirm('complete')}>Complete exit</button>
          </div>
        )}
      </div>
      <div>
        {ec.items.map((i) => (
          <div key={i.key} className="pp-check-row">
            <div>
              {i.label} {i.blocking && <Tag tone="outline">Required</Tag>}
              <div className="faint" style={{ fontSize: 12 }}>{i.ownerRole}{i.doneByName ? ` · ${i.status === 'NA' ? 'marked N/A' : 'done'} by ${i.doneByName}${i.doneAt ? ` on ${formatDate(i.doneAt)}` : ''}` : ''}</div>
            </div>
            {p.canLifecycle && !closed && !i.auto ? (
              <select className="input" value={i.status} onChange={(e) => item.mutate({ key: i.key, status: e.target.value as 'PENDING' | 'DONE' | 'NA' })}>
                <option value="PENDING">Pending</option>
                <option value="DONE">Done</option>
                <option value="NA">Not applicable</option>
              </select>
            ) : (
              <Tag tone={i.status === 'DONE' ? 'accent' : i.status === 'NA' ? 'neutral' : 'outline'}>{i.status === 'DONE' ? 'Done' : i.status === 'NA' ? 'N/A' : 'Pending'}</Tag>
            )}
          </div>
        ))}
      </div>
      {!closed && ec.blockers.length > 0 && <div className="note" style={{ fontSize: 12.5 }}>Before completing: {ec.blockers.join(' · ')}</div>}
      {confirm === 'withdraw' && (
        <ConfirmDialog title="Withdraw this exit?" body={`${p.fullName} goes back to active and the checklist is closed.`} confirmLabel="Withdraw exit" busy={withdraw.isPending} onClose={() => setConfirm(null)} onConfirm={() => withdraw.mutate(undefined)} />
      )}
      {confirm === 'complete' && (
        <Modal
          title={`Complete exit for ${p.fullName}`}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" disabled={complete.isPending || (!ec.canComplete && override.trim().length < 2)} onClick={() => complete.mutate(undefined)}>Mark as exited</button>
            </>
          }
        >
          <div className="dialog-body">Login is disabled, tracker devices are revoked and the employee moves to the Exited tab.</div>
          {!ec.canComplete && (
            <div className="field">
              <label htmlFor="ov">Override reason (checklist still open: {ec.blockers.join(', ')})</label>
              <textarea id="ov" className="input" value={override} onChange={(e) => setOverride(e.target.value)} />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function StartExitModal({ p, onClose }: { p: ProfileDto; onClose: () => void }) {
  const start = useAction((b: Record<string, unknown>) => peopleApi.startExit(p.id, b as never), { success: `${p.fullName} moved to notice period`, invalidate: [['people', 'profile'], peopleKeys.employees] });
  const fields: FieldDef[] = [
    { name: 'exitType', label: 'Exit type', type: 'select', required: true, options: EXIT_TYPES.map((t) => ({ value: t, label: EXIT_TYPE_LABELS[t] })) },
    { name: 'resignationDate', label: 'Resignation / notice date', type: 'date', required: true },
    { name: 'lastWorkingDay', label: 'Last working day', type: 'date', hint: 'Leave blank to apply the notice period from policy' },
    { name: 'reason', label: 'Reason / notes', type: 'area' },
  ];
  return (
    <FormModal
      title={`Start exit · ${p.fullName}`}
      fields={fields}
      initial={{ exitType: p.employmentType === 'INTERN' ? 'END_OF_INTERNSHIP' : 'RESIGNATION', resignationDate: todayKey() }}
      submitLabel="Start notice period"
      intro={<span className="faint" style={{ fontSize: 12.5 }}>Creates the exit checklist (asset return, knowledge transfer, full & final). The manager and HR are notified.</span>}
      onClose={onClose}
      onSubmit={(v) => start.mutateAsync(v)}
    />
  );
}

function ConvertModal({ p, onClose }: { p: ProfileDto; onClose: () => void }) {
  const lk = useLookups(['designations']);
  const conv = useAction((b: { effectiveDate: string; designationId: string }) => peopleApi.convertIntern(p.id, b.effectiveDate, b.designationId), { success: `${p.fullName} converted to full-time`, invalidate: [['people', 'profile'], peopleKeys.employees] });
  if (lk.isLoading) return null;
  return (
    <FormModal
      title={`Convert ${p.fullName} to full-time`}
      fields={[
        { name: 'effectiveDate', label: 'Effective date', type: 'date', required: true },
        { name: 'designationId', label: 'New designation', type: 'select', required: true, options: opts(lk.data, 'designations') },
      ]}
      initial={{ effectiveDate: todayKey() }}
      submitLabel="Convert"
      intro={<span className="faint" style={{ fontSize: 12.5 }}>A new full-time Emp ID is issued; the intern ID stays on record.</span>}
      onClose={onClose}
      onSubmit={(v) => conv.mutateAsync(v as { effectiveDate: string; designationId: string })}
    />
  );
}

function ResendInvite({ p, onClose }: { p: ProfileDto; onClose: () => void }) {
  const send = useAction(() => peopleApi.resendInvite(p.id), { success: (r) => (r.inviteSent ? 'Invite sent' : 'Invite could not be emailed'), onSuccess: onClose });
  return <ConfirmDialog title="Resend onboarding invite?" body={`A fresh set-password link (valid 7 days) is emailed to ${p.fullName}. The previous link stops working.`} confirmLabel="Resend invite" busy={send.isPending} onClose={onClose} onConfirm={() => send.mutate(undefined)} />;
}

function DocumentsTab({ p }: { p: ProfileDto }) {
  const nav = useNavigate();
  const can = useCan();
  const [uploading, setUploading] = useState(false);
  const q = useQuery({ queryKey: ['people', 'profile', p.id, 'documents'], queryFn: () => peopleApi.profileDocuments(p.id) });
  const up = useAction((b: Record<string, unknown>) => peopleApi.uploadFor(p.id, b as never), { success: 'Uploaded', invalidate: [['people', 'profile', p.id, 'documents'], peopleKeys.vault] });
  if (q.error) return <ErrorBlock error={q.error} />;
  const hr = can('employees.manage') && !p.isSelf;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row-between">
        <span className="faint" style={{ fontSize: 12.5 }}>Visible only to {p.isSelf ? 'you' : p.fullName.split(' ')[0]} and HR.</span>
        {p.isSelf ? <button className="btn btn-secondary btn-sm" onClick={() => nav('/vault')}>Open my vault</button> : hr && <button className="btn btn-secondary btn-sm" onClick={() => setUploading(true)}>Upload document</button>}
      </div>
      <DocumentsTable rows={q.data} loading={q.isLoading} employeeId={p.id} />
      {uploading && (
        <FormModal
          title={`Upload document for ${p.fullName}`}
          fields={[
            { name: 'docType', label: 'Folder / category', type: 'select', required: true, span: 2, options: [{ value: 'COMPENSATION_BREAKDOWN', label: `${DOC_CATEGORY_LABELS.OFFER_COMPENSATION} · Compensation breakdown` }, { value: 'RELIEVING_LETTER', label: 'Employment · Relieving letter' }, ...VAULT_UPLOAD_TYPES] },
            { name: 'title', label: 'Title', type: 'text', span: 2, placeholder: 'Defaults to the document type' },
            { name: 'fileId', label: 'File', type: 'file', required: true, category: 'vault', accept: '.pdf,image/*' },
            { name: 'tags', label: 'Tags', type: 'text', span: 2 },
          ]}
          submitLabel="Upload"
          onClose={() => setUploading(false)}
          onSubmit={(v) => up.mutateAsync(v)}
        />
      )}
    </div>
  );
}

function AssetsTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['people', 'profile', id, 'assets'], queryFn: () => peopleApi.profileAssets(id) });
  const cols: Column<ProfileAssetRow>[] = [
    { key: 'i', header: 'Item', render: (r) => r.item },
    { key: 's', header: 'Serial', render: (r) => r.serial },
    { key: 'a', header: 'Assigned', render: (r) => r.assigned },
    { key: 't', header: 'Status', render: (r) => <Tag tone={statusTone(r.status)}>{r.statusLabel}</Tag> },
  ];
  if (q.error) return <ErrorBlock error={q.error} />;
  return <DataTable columns={cols} rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} empty="No assets assigned." />;
}

function PayTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['people', 'profile', id, 'pay'], queryFn: () => peopleApi.profilePay(id) });
  const cols: Column<ProfilePayRow>[] = [
    { key: 'c', header: 'Component', render: (r) => (r.isTotal ? <b>{r.component}</b> : r.component) },
    { key: 'm', header: 'Monthly', num: true, render: (r) => (r.isTotal ? <b>{formatINR(r.monthlyPaise)}</b> : formatINR(r.monthlyPaise)) },
    { key: 'a', header: 'Annual', num: true, render: (r) => (r.isTotal ? <b>{formatINR(r.annualPaise)}</b> : formatINR(r.annualPaise)) },
  ];
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {q.data?.effectiveFrom && <span className="faint" style={{ fontSize: 12.5 }}>Salary structure effective {formatDate(q.data.effectiveFrom)}. Visible only to the employee and Payroll/HR.</span>}
      <DataTable columns={cols} rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.component} empty="No salary structure has been set up yet." />
    </div>
  );
}

function AttendanceTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['people', 'profile', id, 'attendance'], queryFn: () => peopleApi.profileAttendance(id) });
  const cols: Column<ProfileAttendanceRow>[] = [
    { key: 'm', header: 'Month', render: (r) => r.month },
    { key: 'p', header: 'Present', num: true, render: (r) => r.present },
    { key: 'l', header: 'Leave', num: true, render: (r) => r.leave },
    { key: 'i', header: 'Idle', num: true, render: (r) => formatHm(r.idleMinutes * 60) },
    { key: 't', header: 'Late', num: true, render: (r) => r.late },
  ];
  if (q.error) return <ErrorBlock error={q.error} />;
  return <DataTable columns={cols} rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.month} empty="No attendance recorded yet." />;
}
