import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EMPLOYMENT_TYPE_LABEL, LEAVE_STATUS_LABEL, LEAVE_STATUS_TONE, holidayLocationsOverlap, type CreditRuleRow, type HolidayRow, type LeaveRequestRow, type LeaveTypeRow, type ManualCreditRow } from '@lexisora/shared';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef } from '@/components/form';
import { useLookups, opts } from '@/components/lookups';
import { DataTable, Pager, type Column } from '@/components/table';
import { ConfirmDialog, ErrorBlock, PageHeader, Seg, Tabs, Tag } from '@/components/ui';
import { dur } from '@/modules/time/api';
import { HOLIDAY_CALENDARS, HOLIDAY_DEPENDENTS, LEAVE_ALL, currentPeriod, fmtDays, lpApi, lpKeys, useCompOffRules, type HolidayCalendar } from '../api';
import { RejectModal } from '../components';
import '../leavepay.css';

type Tab = 'types' | 'basic' | 'manual' | 'requests' | 'holidays';

export default function LeaveSetupPage() {
  const can = useCan();
  // Roles & access can grant "Add & edit holidays" without the rest of leave setup.
  const leaveAdmin = can('leave.manage');
  const [tab, setTab] = useState<Tab>(leaveAdmin ? 'types' : 'holidays');
  const [form, setForm] = useState<'credit' | 'type' | LeaveTypeRow | null>(null);
  if (!leaveAdmin) {
    return (
      <div data-screen-label="Holidays" className="stack" style={{ gap: 18 }}>
        <PageHeader title="Holidays" sub="The company holiday calendar used by attendance, timesheets, leave and payroll." />
        <HolidaysTab />
      </div>
    );
  }
  return (
    <div data-screen-label="Leave setup" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Leave setup"
        sub="Leave types, annual credit rules, manual credits and holidays."
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setForm('type')}>Add leave type</button>
            <button className="btn btn-primary" onClick={() => setForm('credit')}>Credit leave</button>
          </>
        }
      />
      <Tabs<Tab>
        tabs={[
          { value: 'types', label: 'Leave types' },
          { value: 'basic', label: 'Basic credit' },
          { value: 'manual', label: 'Manual credit' },
          { value: 'requests', label: 'Requests' },
          { value: 'holidays', label: 'Holidays' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'types' && <TypesTab onEdit={(t) => setForm(t)} />}
      {tab === 'basic' && <BasicTab />}
      {tab === 'manual' && <ManualTab />}
      {tab === 'requests' && <RequestsTab />}
      {tab === 'holidays' && <HolidaysTab />}
      {form === 'credit' && <CreditForm onClose={() => setForm(null)} />}
      {(form === 'type' || (form && typeof form === 'object')) && <TypeForm row={typeof form === 'object' ? form : null} onClose={() => setForm(null)} />}
    </div>
  );
}

function TypesTab({ onEdit }: { onEdit: (t: LeaveTypeRow) => void }) {
  const q = useQuery({ queryKey: lpKeys.types, queryFn: lpApi.types });
  const [removing, setRemoving] = useState<LeaveTypeRow | null>(null);
  const toggle = useAction((t: LeaveTypeRow) => lpApi.updateType(t.id, { active: !t.active }), { success: (r) => `${r.name} ${r.active ? 'activated' : 'deactivated'}`, invalidate: [LEAVE_ALL, ['lookups']] });
  const remove = useAction((t: LeaveTypeRow) => lpApi.deleteType(t.id), { success: 'Leave type deleted', invalidate: [LEAVE_ALL, ['lookups']], onSuccess: () => setRemoving(null) });
  const cols: Column<LeaveTypeRow>[] = [
    { key: 'n', header: 'Leave type', render: (t) => <div><div>{t.name} {!t.active && <Tag>Inactive</Tag>} {t.hidden && <Tag>HR only</Tag>}</div><div className="faint" style={{ fontSize: 11.5 }}>{t.code}{t.isPaid ? '' : ' · unpaid'}{t.allowHalfDay ? ' · half day' : ''}{t.sandwichWeeklyOffs ? ' · sandwich' : ''}{t.minNoticeDays ? ` · ${t.minNoticeDays}d notice` : ''}</div></div> },
    { key: 'q', header: 'Annual quota', render: (t) => t.quotaLabel },
    { key: 'c', header: 'Carry forward', render: (t) => t.carryForwardLabel },
    { key: 'e', header: 'Encashable', render: (t) => (t.encashable ? 'Yes' : 'No') },
    { key: 'a', header: 'Applies to', render: (t) => t.appliesToLabel },
    {
      key: 'x',
      header: '',
      render: (t) => (
        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(t)}>Edit</button>
          <button className="btn btn-ghost btn-sm" onClick={() => toggle.mutate(t)}>{t.active ? 'Deactivate' : 'Activate'}</button>
          {!t.hasLedger && <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(t)}>Delete</button>}
        </div>
      ),
    },
  ];
  if (q.error) return <ErrorBlock error={q.error} retry={() => q.refetch()} />;
  return (
    <>
      <DataTable columns={cols} rows={q.data} loading={q.isLoading} rowKey={(t) => t.id} onRowClick={onEdit} empty="No leave types yet — add one." />
      {removing && <ConfirmDialog title={`Delete ${removing.name}?`} body="It has no balances or requests yet, so it can be removed completely." confirmLabel="Delete" danger busy={remove.isPending} onConfirm={() => remove.mutate(removing)} onClose={() => setRemoving(null)} />}
    </>
  );
}

function TypeForm({ row, onClose }: { row: LeaveTypeRow | null; onClose: () => void }) {
  const save = useAction((v: Record<string, any>) => {
    const body = {
      name: v.name,
      code: v.code || undefined,
      annualQuota: Number(v.annualQuota || 0),
      carryForward: v.carryForward || 'No',
      accrualFrequency: v.accrualFrequency,
      appliesTo: v.appliesTo?.length ? v.appliesTo : ['FULL_TIME'],
      encashable: !!v.encashable,
      isPaid: v.isPaid !== false,
      allowHalfDay: !!v.allowHalfDay,
      sandwichWeeklyOffs: !!v.sandwichWeeklyOffs,
      sandwichHolidays: !!v.sandwichHolidays,
      minNoticeDays: Number(v.minNoticeDays || 0),
      maxConsecutiveDays: v.maxConsecutiveDays ? Number(v.maxConsecutiveDays) : null,
      expiryDays: v.expiryDays ? Number(v.expiryDays) : null,
    };
    return row ? lpApi.updateType(row.id, body as any) : lpApi.createType(body as any);
  }, { success: row ? 'Leave type updated' : 'Leave type added', invalidate: [LEAVE_ALL, ['lookups']] });
  const fields: FieldDef[] = [
    { name: 'name', label: 'Name', type: 'text', span: 2, required: true },
    { name: 'annualQuota', label: 'Annual quota', type: 'number', placeholder: '12' },
    { name: 'carryForward', label: 'Carry forward', type: 'text', placeholder: 'No / Up to 30' },
    { name: 'code', label: 'Code', type: 'text', placeholder: 'EL', hint: '2–6 letters; generated when blank', disabled: !!row },
    { name: 'accrualFrequency', label: 'Credit', type: 'select', required: true, options: [{ value: 'YEARLY', label: 'Yearly (1 Jan)' }, { value: 'MONTHLY', label: 'Monthly accrual' }, { value: 'QUARTERLY', label: 'Quarterly' }, { value: 'ON_APPROVAL', label: 'On approval (comp-off)' }, { value: 'NONE', label: 'Manual only' }] },
    { name: 'appliesTo', label: 'Applies to', type: 'multiselect', span: 2, options: Object.entries(EMPLOYMENT_TYPE_LABEL).map(([value, label]) => ({ value, label })) },
    { name: 'minNoticeDays', label: 'Notice (days)', type: 'number' },
    { name: 'maxConsecutiveDays', label: 'Max consecutive days', type: 'number' },
    { name: 'expiryDays', label: 'Expires after (days)', type: 'number', hint: 'Comp-off: 60' },
    { name: 'encashable', label: 'Encashable', type: 'checkbox' },
    { name: 'isPaid', label: 'Paid leave', type: 'checkbox' },
    { name: 'allowHalfDay', label: 'Allow half day', type: 'checkbox' },
    { name: 'sandwichWeeklyOffs', label: 'Sandwich weekly offs', type: 'checkbox' },
    { name: 'sandwichHolidays', label: 'Sandwich holidays', type: 'checkbox' },
  ];
  const initial = row
    ? { name: row.name, annualQuota: row.annualQuota, carryForward: row.carryForwardLabel, code: row.code, accrualFrequency: row.accrualFrequency, appliesTo: row.appliesTo, minNoticeDays: row.minNoticeDays, maxConsecutiveDays: row.maxConsecutiveDays ?? '', expiryDays: row.expiryDays ?? '', encashable: row.encashable, isPaid: row.isPaid, allowHalfDay: row.allowHalfDay, sandwichWeeklyOffs: row.sandwichWeeklyOffs, sandwichHolidays: row.sandwichHolidays }
    : { accrualFrequency: 'YEARLY', appliesTo: ['FULL_TIME'], isPaid: true, allowHalfDay: true, carryForward: 'No' };
  return <FormModal title={row ? `Edit ${row.name}` : 'Add leave type'} fields={fields} initial={initial} submitLabel="Save" onSubmit={(v) => save.mutateAsync(v)} onClose={onClose} wide />;
}

function CreditForm({ onClose }: { onClose: () => void }) {
  const look = useLookups(['leaveTypes', 'employees']);
  const save = useAction((v: Record<string, any>) => lpApi.credit({ creditType: v.creditType, leaveTypeId: v.leaveTypeId, days: v.creditType === 'BASIC' ? undefined : Number(v.days), employeeIds: v.employeeIds ?? [], note: v.note ?? '' }), {
    success: (r: any) => r?.message ?? 'Leave credited',
    invalidate: [LEAVE_ALL],
  });
  const fields: FieldDef[] = [
    { name: 'creditType', label: 'Credit type', type: 'select', span: 2, required: true, options: [{ value: 'MANUAL', label: 'Manual credit' }, { value: 'BASIC', label: 'Basic (annual)' }] },
    { name: 'leaveTypeId', label: 'Leave type', type: 'select', required: true, options: opts(look.data, 'leaveTypes') },
    { name: 'days', label: 'Days', type: 'text', placeholder: '1 or -0.5', showIf: (v) => v.creditType !== 'BASIC', required: true },
    { name: 'employeeIds', label: 'Employees', type: 'multiselect', span: 2, required: true, options: opts(look.data, 'employees') },
    { name: 'note', label: 'Note', type: 'area', required: true, placeholder: 'Why this credit is given (visible in the employee ledger)' },
  ];
  if (look.isLoading) return null;
  return <FormModal title="Credit leave" fields={fields} submitLabel="Credit" onSubmit={(v) => save.mutateAsync(v as any)} onClose={onClose} />;
}

function BasicTab() {
  const rules = useQuery({ queryKey: lpKeys.rules, queryFn: lpApi.rules });
  const batches = useQuery({ queryKey: lpKeys.batches, queryFn: lpApi.batches });
  const run = useAction((r: CreditRuleRow) => lpApi.runRule(r.id), { success: (x: any) => (x?.employees !== undefined ? `Credited ${fmtDays(x.totalDays ?? 0)} days to ${x.employees} employees` : 'Credit run completed'), invalidate: [LEAVE_ALL] });
  const cols: Column<CreditRuleRow>[] = [
    { key: 't', header: 'Leave type', render: (r) => r.leaveType },
    { key: 'a', header: 'Applies to', render: (r) => r.appliesTo },
    { key: 'f', header: 'Frequency', render: (r) => r.frequencyLabel },
    { key: 'd', header: 'Days / period', num: true, render: (r) => fmtDays(r.daysPerPeriod) },
    { key: 'l', header: 'Last run', render: (r) => (r.lastRun ? <span>{r.lastRun} {r.lastRunStatus && <Tag tone={r.lastRunStatus === 'COMPLETED' ? 'accent' : 'danger'}>{r.lastRunStatus === 'COMPLETED' ? 'Done' : 'Failed'}</Tag>}</span> : <span className="faint">Never</span>) },
    { key: 'n', header: 'Next due', render: (r) => r.nextRun },
    { key: 'x', header: '', render: (r) => <button className="btn btn-secondary btn-sm" disabled={!r.active || run.isPending} onClick={() => run.mutate(r)}>Run {r.nextPeriodKey}</button> },
  ];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="note">Credits run automatically on the credit day (Earned leave 1.5 days on the 1st of every month; Casual and Sick leave once a year on 1 Jan, pro-rated for joiners). Running a period twice never double-credits.</div>
      {rules.error ? <ErrorBlock error={rules.error} /> : <DataTable columns={cols} rows={rules.data} loading={rules.isLoading} rowKey={(r) => r.id} empty="No credit rules." />}
      <h4 style={{ margin: 0 }}>Credit runs</h4>
      <DataTable
        columns={[
          { key: 'd', header: 'Started', render: (b) => new Date(b.startedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) },
          { key: 't', header: 'Run', render: (b) => `${b.leaveType ?? '—'} · ${b.periodKey}` },
          { key: 'k', header: 'Type', render: (b) => b.type.replace(/_/g, ' ').toLowerCase() },
          { key: 'e', header: 'Employees', num: true, render: (b) => b.employeeCount },
          { key: 's', header: 'Days', num: true, render: (b) => fmtDays(b.totalDays) },
          { key: 'st', header: 'Status', render: (b) => <Tag tone={b.status === 'COMPLETED' ? 'accent' : b.status === 'FAILED' ? 'danger' : 'outline'}>{b.status === 'COMPLETED' ? 'Completed' : b.status === 'FAILED' ? 'Failed' : 'Running'}</Tag> },
        ]}
        rows={batches.data}
        loading={batches.isLoading}
        rowKey={(b) => b.id}
        empty="No credit runs yet."
      />
    </div>
  );
}

function ManualTab() {
  const q = useQuery({ queryKey: lpKeys.credits, queryFn: lpApi.credits });
  const cols: Column<ManualCreditRow>[] = [
    { key: 'd', header: 'Date', render: (r) => r.date },
    { key: 'e', header: 'Employee', render: (r) => <div><div>{r.employeeName}</div><div className="faint" style={{ fontSize: 11.5 }}>{r.employeeCode}</div></div> },
    { key: 't', header: 'Leave type', render: (r) => r.leaveType },
    { key: 'n', header: 'Days', num: true, render: (r) => (r.days > 0 ? `+${fmtDays(r.days)}` : fmtDays(r.days)) },
    { key: 'x', header: 'Note', render: (r) => r.note ?? '—' },
    { key: 'b', header: 'By', render: (r) => r.creditedBy ?? '—' },
  ];
  if (q.error) return <ErrorBlock error={q.error} retry={() => q.refetch()} />;
  return <DataTable columns={cols} rows={q.data} loading={q.isLoading} rowKey={(r) => r.id} empty="No manual credits yet. Use “Credit leave” to add days." />;
}

const REQ_TABS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

function RequestsTab() {
  const [status, setStatus] = useState<(typeof REQ_TABS)[number]>('ALL');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const look = useLookups(['leaveTypes', 'departments']);
  const [typeId, setTypeId] = useState('');
  const [deptId, setDeptId] = useState('');
  const list = useQuery({
    queryKey: [...lpKeys.admin, status, q, page, typeId, deptId],
    queryFn: () => lpApi.adminRequests({ status: status === 'ALL' ? undefined : status === 'CANCELLED' ? 'CANCELLED,WITHDRAWN,CANCELLATION_PENDING' : status, q: q || undefined, page, pageSize: 25, leaveTypeId: typeId || undefined, departmentId: deptId || undefined }),
  });
  const approve = useAction((r: LeaveRequestRow) => lpApi.approve(r.id), { success: (_x, r) => `${r.typeName} for ${r.employeeName} approved`, invalidate: [LEAVE_ALL, ['approvals']] });
  const [rejecting, setRejecting] = useState<LeaveRequestRow | null>(null);
  const c = list.data?.counts ?? {};
  const cols: Column<LeaveRequestRow>[] = [
    { key: 'e', header: 'Employee', render: (r) => <div><div>{r.employeeName}</div><div className="faint" style={{ fontSize: 11.5 }}>{r.employeeCode}{r.department ? ` · ${r.department}` : ''}</div></div> },
    { key: 't', header: 'Type', render: (r) => r.typeName },
    { key: 'd', header: 'Dates', render: (r) => r.dates },
    { key: 'n', header: 'Days', num: true, render: (r) => fmtDays(r.days) },
    { key: 'r', header: 'Reason', render: (r) => r.reason ?? '—' },
    { key: 'a', header: 'Approver', render: (r) => r.approverName ?? '—' },
    { key: 's', header: 'Status', render: (r) => <Tag tone={LEAVE_STATUS_TONE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</Tag> },
    {
      key: 'x',
      header: '',
      render: (r) =>
        r.can.approve ? (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setRejecting(r)}>Reject</button>
            <button className="btn btn-secondary btn-sm" disabled={approve.isPending} onClick={() => approve.mutate(r)}>Approve</button>
          </div>
        ) : null,
    },
  ];
  const count = (k: string) => (k === 'CANCELLED' ? (c.CANCELLED ?? 0) + (c.WITHDRAWN ?? 0) + (c.CANCELLATION_PENDING ?? 0) : (c[k] ?? 0));
  const label = (k: string, text: string) => `${text}${list.data ? ` · ${count(k)}` : ''}`;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="lp-toolbar">
        <Tabs
          tabs={REQ_TABS.map((s) => ({ value: s, label: label(s, s === 'ALL' ? 'All' : s === 'CANCELLED' ? 'Withdrawn / cancelled' : LEAVE_STATUS_LABEL[s]) }))}
          value={status}
          onChange={(s) => { setStatus(s); setPage(1); }}
        />
        <span className="spacer" />
        <select className="input" style={{ width: 160 }} value={typeId} onChange={(e) => { setTypeId(e.target.value); setPage(1); }}>
          <option value="">All leave types</option>
          {opts(look.data, 'leaveTypes').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="input" style={{ width: 160 }} value={deptId} onChange={(e) => { setDeptId(e.target.value); setPage(1); }}>
          <option value="">All departments</option>
          {opts(look.data, 'departments').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input className="input" style={{ width: 200 }} placeholder="Search name or request no." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      {list.error ? <ErrorBlock error={list.error} retry={() => list.refetch()} /> : <DataTable columns={cols} rows={list.data?.items} loading={list.isLoading} rowKey={(r) => r.id} empty="No requests match." />}
      {list.data && <Pager page={page} pageSize={25} total={list.data.total} onPage={setPage} />}
      {rejecting && <RejectModal row={{ id: rejecting.id, employeeName: rejecting.employeeName, typeName: rejecting.typeName, status: rejecting.status }} onClose={() => setRejecting(null)} />}
    </div>
  );
}

const HOLIDAY_TYPES = [
  { value: 'MANDATORY', label: 'Mandatory (office closed)' },
  { value: 'OPTIONAL', label: 'Optional (restricted)' },
];

function HolidaysTab() {
  const can = useCan();
  const manage = can('holidays.manage');
  const thisYear = Number(currentPeriod().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [form, setForm] = useState<'add' | HolidayRow | null>(null);
  const [tool, setTool] = useState<'import' | 'copy' | null>(null);
  const [removing, setRemoving] = useState<HolidayRow | null>(null);
  const q = useQuery({ queryKey: lpKeys.holidays(year), queryFn: () => lpApi.holidays(year) });
  const rules = useCompOffRules();
  const remove = useAction((h: HolidayRow) => lpApi.deleteHoliday(h.id), { success: (_r, h) => `${h.name} removed from the calendar`, invalidate: HOLIDAY_DEPENDENTS, onSuccess: () => setRemoving(null) });
  const copy = useAction((toYear: number) => lpApi.copyHolidays({ fromYear: toYear - 1, toYear }), {
    success: (r, toYear) =>
      (r.count ? `${r.count} holidays copied to ${toYear}` : `Nothing to copy — ${toYear - 1} has no holidays missing from ${toYear}`) +
      (r.skipped ? ` · ${r.skipped} skipped (that date already has a holiday)` : ''),
    invalidate: HOLIDAY_DEPENDENTS,
    onSuccess: () => setTool(null),
  });
  // Holidays added before the one-per-date rule can still clash: flag them so HR deletes the extra one.
  const clashWith = (h: HolidayRow) => (q.data ?? []).find((o) => o.id !== h.id && o.date === h.date && holidayLocationsOverlap(o.locationIds, h.locationIds));
  const clashDates = [...new Set((q.data ?? []).filter((h) => clashWith(h)).map((h) => h.dateLabel))];
  const cols: Column<HolidayRow>[] = [
    { key: 'd', header: 'Date', render: (h) => <span className="tnum">{h.date}</span> },
    { key: 'w', header: 'Day', render: (h) => h.weekday },
    {
      key: 'n',
      header: 'Holiday',
      render: (h) => {
        const other = clashWith(h);
        return (
          <span>
            {h.name}{' '}
            {other && (
              <Tag tone="danger" title="Two holidays on one date for the same people — keep one and delete the other">
                Same date as {other.name}
              </Tag>
            )}
          </span>
        );
      },
    },
    { key: 't', header: 'Type', render: (h) => <Tag tone={h.type === 'MANDATORY' ? 'accent' : 'outline'}>{h.type === 'MANDATORY' ? 'Mandatory' : 'Optional'}</Tag> },
    { key: 'l', header: 'Locations', render: (h) => h.locations },
    ...(manage
      ? [
          {
            key: 'x',
            header: '',
            render: (h: HolidayRow) => (
              <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-ghost btn-sm" onClick={() => setForm(h)}>Edit</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(h)}>Delete</button>
              </div>
            ),
          },
        ]
      : []),
  ];
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="lp-toolbar">
        {manage && (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => setForm('add')}>Add holiday</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setTool('import')}>Import list</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setTool('copy')}>Copy from {year - 1}</button>
          </>
        )}
        <span className="spacer" />
        <Seg options={[thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) }))} value={String(year)} onChange={(v) => setYear(Number(v))} />
      </div>
      <div className="note">
        Mandatory holidays are paid days off: they are skipped in leave day counts, attendance and payroll working days. Optional holidays stay working days — employees take them as leave.{' '}
        {rules.data &&
          (rules.data.enabled
          ? `Anyone called in to work on a holiday or weekly off logs the hours in their timesheet; when the timesheet gets final approval, comp-off is credited automatically — 1 day for ${dur(rules.data.fullDayMinutes)} or more (capped at the shift length), ½ day for ${dur(rules.data.halfDayMinutes)} or more — valid for ${rules.data.expiryDays} days.`
          : 'Comp-off is switched off (no active comp-off leave type), so holiday work is not credited.')}
      </div>
      {clashDates.length > 0 && (
        <div className="note" style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
          {clashDates.join(', ')} {clashDates.length === 1 ? 'has' : 'have'} two holidays for the same people. Keep one and delete the other — only one holiday per date is allowed.
        </div>
      )}
      {q.error ? (
        <ErrorBlock error={q.error} retry={() => q.refetch()} />
      ) : (
        <DataTable columns={cols} rows={q.data} loading={q.isLoading} rowKey={(h) => h.id} onRowClick={manage ? (h) => setForm(h) : undefined} empty={manage ? `No holidays for ${year} yet — add one or import a ready-made list.` : `No holidays published for ${year} yet.`} />
      )}
      {form && <HolidayForm row={form === 'add' ? null : form} onClose={() => setForm(null)} />}
      {tool === 'import' && <HolidayImportForm year={year} onClose={() => setTool(null)} />}
      {tool === 'copy' && (
        <ConfirmDialog
          title={`Copy ${year - 1} holidays to ${year}?`}
          body={`Every ${year - 1} holiday is added on the same date in ${year}. Holidays already on the ${year} calendar are skipped. Festivals that move every year (Diwali, Holi, Eid…) need their dates corrected afterwards.`}
          confirmLabel="Copy holidays"
          busy={copy.isPending}
          onConfirm={() => copy.mutate(year)}
          onClose={() => setTool(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Delete ${removing.name}?`}
          body={`${removing.dateLabel} becomes a normal working day again. Attendance for past dates is recalculated.`}
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

function HolidayForm({ row, onClose }: { row: HolidayRow | null; onClose: () => void }) {
  const look = useLookups(['locations']);
  const save = useAction(
    (v: Record<string, any>): Promise<{ ok: boolean; count?: number }> => {
      const body = { name: v.name, date: v.date, type: v.type, locationIds: v.locationIds ?? [] };
      return row ? lpApi.updateHoliday(row.id, body) : lpApi.createHoliday({ ...body, endDate: v.endDate || null });
    },
    { success: (r) => (row ? 'Holiday updated' : (r.count ?? 1) > 1 ? `${r.count} holiday days added` : 'Holiday added'), invalidate: HOLIDAY_DEPENDENTS },
  );
  const fields: FieldDef[] = [
    { name: 'name', label: 'Holiday name', type: 'text', span: 2, required: true, placeholder: 'Diwali' },
    { name: 'date', label: row ? 'Date' : 'From date', type: 'date', required: true },
    ...(row ? [] : [{ name: 'endDate', label: 'To date', type: 'date', hint: 'Only for holidays longer than one day' } satisfies FieldDef]),
    { name: 'type', label: 'Type', type: 'select', required: true, options: HOLIDAY_TYPES },
    { name: 'locationIds', label: 'Locations', type: 'multiselect', span: 2, options: opts(look.data, 'locations'), hint: 'Leave empty to apply to every location' },
  ];
  if (look.isLoading) return null;
  return (
    <FormModal
      title={row ? `Edit ${row.name}` : 'Add holiday'}
      fields={fields}
      initial={row ? { name: row.name, date: row.date, type: row.type, locationIds: row.locationIds } : { type: 'MANDATORY' }}
      submitLabel={row ? 'Save' : 'Add holiday'}
      onSubmit={(v) => {
        if (v.endDate && v.endDate < v.date) throw new Error('To date must be on or after the from date');
        return save.mutateAsync(v);
      }}
      onClose={onClose}
    />
  );
}

function HolidayImportForm({ year, onClose }: { year: number; onClose: () => void }) {
  const run = useAction((v: { calendar: HolidayCalendar }) => lpApi.importHolidays({ year, calendar: v.calendar }), {
    success: (r) =>
      (r.count ? `${r.count} holidays imported` : 'Every holiday in that list is already on the calendar') + (r.skipped && r.count ? ` · ${r.skipped} skipped (that date already has a holiday)` : ''),
    invalidate: HOLIDAY_DEPENDENTS,
  });
  const fields: FieldDef[] = [{ name: 'calendar', label: 'Holiday list', type: 'select', span: 2, required: true, options: HOLIDAY_CALENDARS.map((c) => ({ value: c, label: c === 'National' ? 'National (all India)' : `${c} (national + state)` })) }];
  return (
    <FormModal
      title={`Import ${year} holidays`}
      intro="Adds the built-in list for the year. Holidays already on the calendar are skipped, so importing twice is safe."
      fields={fields}
      submitLabel="Import"
      onSubmit={(v) => run.mutateAsync(v as { calendar: HolidayCalendar })}
      onClose={onClose}
    />
  );
}
