import { useState } from 'react';
import type { AttendancePolicyDto, LocationRow, PolicyUpdateResult, ShiftAllocationRow, ShiftRow } from '@lexisora/shared';
import { FormModal, MultiSelect, type FieldDef } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { DataTable } from '@/components/table';
import { Check, ConfirmDialog, ErrorBlock, Loading, Modal, PageHeader, Tabs, Tag } from '@/components/ui';
import { del, patch, post } from '@/lib/api';
import { useAction } from '@/lib/query';
import { istToday, tk, useAllocations, useLocation, useLocations, usePolicy, useShifts } from '../api';
import '../time.css';

// ── Shifts ────────────────────────────────────────────────────────────────────
const WEEKLY_OFF_OPTIONS = [
  { value: '6,0', label: 'Sat, Sun' },
  { value: '0', label: 'Sun' },
  { value: '5,6', label: 'Fri, Sat' },
  { value: '6', label: 'Sat' },
  { value: '', label: 'None (rotational)' },
];
const offKey = (days: number[]) => {
  const k = [...days].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)).join(',');
  return WEEKLY_OFF_OPTIONS.some((o) => o.value === k) ? k : '6,0';
};

export function ShiftsPage() {
  const [tab, setTab] = useState<'master' | 'alloc'>('master');
  const [form, setForm] = useState<{ edit: ShiftRow | null } | null>(null);
  const [allocOpen, setAllocOpen] = useState(false);
  const [archive, setArchive] = useState<ShiftRow | null>(null);
  const shifts = useShifts();
  const allocs = useAllocations();
  const removeAlloc = useAction((id: string) => del(`/shifts/allocations/${id}`), { success: 'Allocation removed', invalidate: [tk.all, ['lookups']] });
  const archiveShift = useAction((id: string) => del(`/shifts/${id}`), { success: 'Shift archived', invalidate: [tk.all, ['lookups']], onSuccess: () => setArchive(null) });

  return (
    <div data-screen-label="Shifts" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Shifts"
        sub="Shift master and employee shift allocation."
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setAllocOpen(true)}>Allocate shift</button>
            <button className="btn btn-primary" onClick={() => setForm({ edit: null })}>Add shift</button>
          </>
        }
      />
      <Tabs
        tabs={[
          { value: 'master', label: 'Shift master' },
          { value: 'alloc', label: 'Allocation' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'master' &&
        (shifts.isError ? (
          <ErrorBlock error={shifts.error} retry={() => void shifts.refetch()} />
        ) : (
          <DataTable<ShiftRow>
            loading={shifts.isLoading}
            rows={shifts.data}
            rowKey={(r) => r.id}
            onRowClick={(r) => setForm({ edit: r })}
            columns={[
              { key: 'n', header: 'Shift', render: (r) => <span>{r.name} {r.isDefault && <Tag tone="outline">Default</Tag>}</span> },
              { key: 't', header: 'Timing', render: (r) => r.timing },
              { key: 'g', header: 'Grace', render: (r) => `${r.graceMinutes} min` },
              { key: 'b', header: 'Break', render: (r) => `${r.breakMinutes} min` },
              { key: 'w', header: 'Weekly off', render: (r) => r.weeklyOff },
              { key: 'e', header: 'Employees', render: (r) => r.employees, num: true },
              {
                key: 'x',
                header: '',
                render: (r) =>
                  !r.isDefault && (
                    <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setArchive(r); }}>Archive</button>
                  ),
              },
            ]}
          />
        ))}
      {tab === 'alloc' &&
        (allocs.isError ? (
          <ErrorBlock error={allocs.error} />
        ) : (
          <DataTable<ShiftAllocationRow>
            loading={allocs.isLoading}
            rows={allocs.data}
            rowKey={(r) => r.id}
            empty="No shift allocations yet. Employees without one follow the default shift."
            columns={[
              { key: 'e', header: 'Employee', render: (r) => r.employeeName },
              { key: 'd', header: 'Department', render: (r) => r.department ?? '—' },
              { key: 's', header: 'Shift', render: (r) => r.shiftName },
              { key: 'f', header: 'From', render: (r) => r.from },
              { key: 't', header: 'To', render: (r) => r.to ?? 'Ongoing' },
              { key: 'b', header: 'Allocated by', render: (r) => r.allocatedBy ?? '—' },
              { key: 'c', header: 'Status', render: (r) => <Tag tone={r.current ? 'accent' : 'neutral'}>{r.current ? 'Current' : r.from > istToday() ? 'Upcoming' : 'Past'}</Tag> },
              { key: 'x', header: '', render: (r) => <button className="btn btn-ghost btn-sm" disabled={removeAlloc.isPending} onClick={() => removeAlloc.mutate(r.id)}>Remove</button> },
            ]}
          />
        ))}
      {form && <ShiftForm edit={form.edit} onClose={() => setForm(null)} />}
      {allocOpen && <AllocateForm onClose={() => setAllocOpen(false)} />}
      {archive && (
        <ConfirmDialog
          title={`Archive ${archive.name}?`}
          body={archive.employees ? `${archive.employees} employees move to the default shift.` : 'The shift will no longer be available for allocation.'}
          confirmLabel="Archive"
          danger
          busy={archiveShift.isPending}
          onConfirm={() => archiveShift.mutate(archive.id)}
          onClose={() => setArchive(null)}
        />
      )}
    </div>
  );
}

function ShiftForm({ edit, onClose }: { edit: ShiftRow | null; onClose: () => void }) {
  const save = useAction((v: Record<string, unknown>) => (edit ? patch(`/shifts/${edit.id}`, v) : post('/shifts', v)), {
    success: edit ? 'Shift updated' : 'Shift added',
    invalidate: [tk.all, ['lookups']],
  });
  const fields: FieldDef[] = [
    { name: 'name', label: 'Shift name', type: 'text', span: 2, required: true },
    { name: 'start', label: 'Start', type: 'time', required: true },
    { name: 'end', label: 'End', type: 'time', required: true },
    { name: 'graceMinutes', label: 'Grace (min)', type: 'number', required: true },
    { name: 'breakMinutes', label: 'Break (min)', type: 'number', required: true },
    { name: 'weeklyOff', label: 'Weekly off', type: 'select', span: 2, options: WEEKLY_OFF_OPTIONS },
    { name: 'minFullDayMinutes', label: 'Full day after (min worked)', type: 'number' },
    { name: 'minHalfDayMinutes', label: 'Half day after (min worked)', type: 'number' },
    { name: 'isDefault', label: 'Default shift for new employees', type: 'checkbox', span: 2 },
  ];
  return (
    <FormModal
      title={edit ? `Edit shift · ${edit.name}` : 'Add shift'}
      fields={fields}
      initial={
        edit
          ? { ...edit, weeklyOff: offKey(edit.weeklyOffDays) }
          : { start: '09:30', end: '18:30', graceMinutes: 15, breakMinutes: 60, weeklyOff: '6,0', minFullDayMinutes: 480, minHalfDayMinutes: 240 }
      }
      onSubmit={(v) => {
        const { weeklyOff, ...rest } = v;
        return save.mutateAsync({
          ...rest,
          isDefault: !!v.isDefault,
          minFullDayMinutes: v.minFullDayMinutes ?? undefined,
          minHalfDayMinutes: v.minHalfDayMinutes ?? undefined,
          weeklyOffDays: String(weeklyOff ?? '').split(',').filter((x) => x !== '').map(Number),
        });
      }}
      onClose={onClose}
    />
  );
}

function AllocateForm({ onClose }: { onClose: () => void }) {
  const lk = useLookups(['employees', 'shifts']);
  const save = useAction((v: Record<string, unknown>) => post('/shifts/allocate', v), { success: 'Shift allocated', invalidate: [tk.all, ['lookups']] });
  if (lk.isLoading) return null;
  const fields: FieldDef[] = [
    { name: 'employeeIds', label: 'Employees', type: 'multiselect', span: 2, required: true, options: opts(lk.data, 'employees') },
    { name: 'shiftId', label: 'Shift', type: 'select', required: true, options: opts(lk.data, 'shifts') },
    { name: 'effectiveFrom', label: 'From date', type: 'date', required: true },
    { name: 'effectiveTo', label: 'To date (optional)', type: 'date' },
  ];
  return <FormModal title="Allocate shift" fields={fields} submitLabel="Allocate" initial={{ effectiveFrom: istToday() }} onSubmit={(v) => save.mutateAsync(v)} onClose={onClose} />;
}

// ── Work locations ───────────────────────────────────────────────────────────
export function LocationsPage() {
  const q = useLocations();
  const [form, setForm] = useState<{ edit: LocationRow | null } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  return (
    <div data-screen-label="Work locations" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Work locations"
        sub="Offices and their punch rules. Biometric-only locations block web punch for employees assigned there."
        actions={<button className="btn btn-primary" onClick={() => setForm({ edit: null })}>Add location</button>}
      />
      {q.isError ? (
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      ) : (
        <DataTable<LocationRow>
          loading={q.isLoading}
          rows={q.data}
          rowKey={(r) => r.id}
          onRowClick={(r) => setDetail(r.id)}
          columns={[
            { key: 'n', header: 'Location', render: (r) => r.name },
            { key: 'a', header: 'Address', render: (r) => r.address ?? '—' },
            { key: 'g', header: 'Geo radius', render: (r) => r.geoRadius },
            { key: 'p', header: 'Punch mode', render: (r) => <Tag tone={r.punchMode === 'BIOMETRIC_ONLY' ? 'accent' : 'outline'}>{r.punchModeLabel}</Tag> },
            { key: 'e', header: 'Employees', render: (r) => r.employees, num: true },
          ]}
        />
      )}
      {form && <LocationForm edit={form.edit} onClose={() => setForm(null)} />}
      {detail && (
        <LocationDetailModal
          id={detail}
          onClose={() => setDetail(null)}
          onEdit={(r) => {
            setDetail(null);
            setForm({ edit: r });
          }}
        />
      )}
    </div>
  );
}

function LocationForm({ edit, onClose }: { edit: LocationRow | null; onClose: () => void }) {
  const save = useAction((v: Record<string, unknown>) => (edit ? patch(`/locations/${edit.id}`, v) : post('/locations', v)), {
    success: edit ? 'Location updated' : 'Location added',
    invalidate: [tk.all, ['lookups']],
  });
  const fields: FieldDef[] = [
    { name: 'name', label: 'Name', type: 'text', span: 2, required: true },
    { name: 'address', label: 'Address', type: 'area', span: 2 },
    { name: 'geoRadiusM', label: 'Geo radius (m)', type: 'number' },
    {
      name: 'punchMode',
      label: 'Punch mode',
      type: 'select',
      required: true,
      options: [
        { value: 'BIOMETRIC_ONLY', label: 'Biometric only' },
        { value: 'WEB_DESKTOP_ALLOWED', label: 'Web / desktop allowed' },
      ],
    },
    { name: 'lat', label: 'Latitude (optional)', type: 'text' },
    { name: 'lng', label: 'Longitude (optional)', type: 'text' },
    { name: 'geoFenceWebPunch', label: 'Check geo radius on web punch', type: 'checkbox', span: 2, showIf: (v) => v.punchMode === 'WEB_DESKTOP_ALLOWED' },
  ];
  return (
    <FormModal
      title={edit ? `Edit location · ${edit.name}` : 'Add work location'}
      fields={fields}
      initial={edit ? { ...edit, lat: edit.lat ?? '', lng: edit.lng ?? '' } : { punchMode: 'BIOMETRIC_ONLY', geoRadiusM: 150 }}
      onSubmit={(v) =>
        save.mutateAsync({
          ...v,
          lat: v.lat === null || v.lat === '' ? null : Number(v.lat),
          lng: v.lng === null || v.lng === '' ? null : Number(v.lng),
          geoFenceWebPunch: !!v.geoFenceWebPunch,
        })
      }
      onClose={onClose}
    />
  );
}

function LocationDetailModal({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (r: LocationRow) => void }) {
  const q = useLocation(id);
  const lk = useLookups(['employees']);
  const [pick, setPick] = useState<string[]>([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const assign = useAction((ids: string[]) => post(`/locations/${id}/employees`, { employeeIds: ids }), {
    success: 'Employees assigned',
    invalidate: [tk.all],
    onSuccess: () => setPick([]),
  });
  const remove = useAction(() => del(`/locations/${id}`), { success: 'Location removed', invalidate: [tk.all, ['lookups']], onSuccess: onClose });
  const d = q.data;
  return (
    <Modal
      wide
      title={d?.name ?? 'Location'}
      onClose={onClose}
      actions={
        d && (
          <>
            {!d.isSystem && (
              <button className="btn btn-ghost" onClick={() => setConfirmDel(true)} disabled={d.employees > 0} title={d.employees > 0 ? 'Move its employees first' : undefined}>
                Delete
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => onEdit(d)}>Edit</button>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </>
        )
      }
    >
      {!d ? (
        q.isError ? <ErrorBlock error={q.error} /> : <Loading />
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="kv-row"><span>Address</span><span>{d.address ?? '—'}</span></div>
          <div className="kv-row"><span>Punch mode</span><span>{d.punchModeLabel}</span></div>
          <div className="kv-row"><span>Geo radius</span><span>{d.geoRadius}{d.geoFenceWebPunch ? ' · checked on web punch' : ''}</span></div>
          <div className="kv-row"><span>Biometric devices</span><span>{d.devices.length ? d.devices.map((x) => `${x.name} (${x.status})`).join(', ') : 'None'}</span></div>
          <div className="time-label">Employees · {d.employeeList.length}</div>
          <div style={{ maxHeight: 220, overflow: 'auto' }}>
            {d.employeeList.map((e) => (
              <div key={e.id} className="kv-row" style={{ fontSize: 13 }}>
                <span>{e.name} <span className="faint">{e.empCode}</span></span>
                <span className="faint">{e.department ?? ''} · {e.workMode.toLowerCase()}</span>
              </div>
            ))}
            {d.employeeList.length === 0 && <div className="faint" style={{ fontSize: 13 }}>No one is assigned here yet.</div>}
          </div>
          <div className="field">
            <label>Assign employees</label>
            <MultiSelect options={opts(lk.data, 'employees')} value={pick} onChange={setPick} />
          </div>
          <div>
            <button className="btn btn-secondary btn-sm" disabled={!pick.length || assign.isPending} onClick={() => assign.mutate(pick)}>Assign {pick.length || ''}</button>
          </div>
        </div>
      )}
      {confirmDel && d && (
        <ConfirmDialog title={`Delete ${d.name}?`} confirmLabel="Delete" danger busy={remove.isPending} onConfirm={() => remove.mutate(undefined)} onClose={() => setConfirmDel(false)} />
      )}
    </Modal>
  );
}

// ── Attendance policy ─────────────────────────────────────────────────────────
type BoolKey = { [K in keyof AttendancePolicyDto]: AttendancePolicyDto[K] extends boolean ? K : never }[keyof AttendancePolicyDto];
type NumKey = 'autoIdleMinutes' | 'screenshotIntervalMinutes' | 'monthlyIdleAllowanceMinutes' | 'breakReminderMinutes' | 'offlineRetentionDays' | 'screenshotRetentionDays' | 'lateMarksPerPenalty' | 'missedPunchAutoCloseHours' | 'maxRegularizationsPerMonth' | 'regularizationWindowDays';

export function PolicyPage() {
  const q = usePolicy();
  const save = useAction(
    (a: { audience: 'office' | 'remote'; patch: Record<string, unknown> }) => patch<PolicyUpdateResult>(`/attendance-policy/${a.audience}`, a.patch),
    {
      success: (r) =>
        `Policy saved · pushed to ${r.pushedTo} tracker${r.pushedTo === 1 ? '' : 's'}${r.autoCleared.length ? ` · also turned off: ${r.autoCleared.join(', ')}` : ''}`,
      invalidate: [tk.policy, tk.today],
    },
  );
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  const { office, remote } = q.data;
  const set = (aud: 'office' | 'remote', key: string, value: unknown) => {
    const p = aud === 'office' ? office : remote;
    save.mutate({ audience: aud, patch: { [key]: value, expectedVersion: p.version } });
  };

  const bool = (label: string, key: BoolKey) => (
    <div className="rw" key={key}>
      <span>{label}</span>
      <span><Check checked={office[key] as boolean} disabled={save.isPending} onChange={(v) => set('office', key, v)} /></span>
      <span><Check checked={remote[key] as boolean} disabled={save.isPending} onChange={(v) => set('remote', key, v)} /></span>
    </div>
  );
  const num = (label: string, key: NumKey, unit: string) => (
    <div className="rw" key={key}>
      <span>{label}</span>
      <span><NumInput value={office[key]} unit={unit} onSave={(v) => set('office', key, v)} /></span>
      <span><NumInput value={remote[key]} unit={unit} onSave={(v) => set('remote', key, v)} /></span>
    </div>
  );

  return (
    <div data-screen-label="Attendance policy" className="stack" style={{ gap: 18 }}>
      <PageHeader title="Attendance policy" sub="Controls how and where employees can punch in, plus desktop tracker rules." />
      <div className="time-matrix">
        <div className="hd"><span>Rule</span><span>Office employees</span><span>Remote / WFH employees</span></div>
        {bool('Biometric punch mandatory', 'biometricMandatory')}
        {bool('Allow web punch-in', 'allowWebPunch')}
        {bool('Allow desktop app punch-in', 'allowDesktopPunch')}
        {bool(`Auto-idle after ${remote.autoIdleMinutes} min without input`, 'autoIdleEnabled')}
        {bool(`Screenshot every ${remote.screenshotIntervalMinutes} min`, 'screenshotsEnabled')}
        {bool('Blur screenshots', 'blurScreenshots')}
        {bool('Deduct idle time from payroll', 'deductIdleFromPayroll')}
      </div>
      <h4 style={{ margin: '8px 0 0' }}>Limits &amp; tracker settings</h4>
      <div className="time-matrix">
        <div className="hd"><span>Setting</span><span>Office employees</span><span>Remote / WFH employees</span></div>
        {num('Auto-idle threshold', 'autoIdleMinutes', 'min')}
        {num('Screenshot interval', 'screenshotIntervalMinutes', 'min')}
        {num('Monthly idle allowance before deduction', 'monthlyIdleAllowanceMinutes', 'min')}
        {num('Break reminder after continuous work', 'breakReminderMinutes', 'min')}
        {num('Screenshot retention', 'screenshotRetentionDays', 'days')}
        {num('Offline data retention on device', 'offlineRetentionDays', 'days')}
        {num('Late marks per penalty', 'lateMarksPerPenalty', 'marks')}
        {num('Auto-close open session after shift end', 'missedPunchAutoCloseHours', 'h')}
        {num('Correction requests per month', 'maxRegularizationsPerMonth', '')}
        {num('Correction window', 'regularizationWindowDays', 'days')}
        {bool('Early punch-out counts as late mark', 'earlyOutCountsAsLate')}
        {bool('Weekly timesheet required', 'timesheetRequired')}
        {bool('Desktop tracker required while punched in', 'trackerRequired')}
        {bool('Punch-in reminder at shift start', 'punchInReminder')}
      </div>
      <div className="faint" style={{ fontSize: 12 }}>
        Last changed {new Date(remote.updatedAt > office.updatedAt ? remote.updatedAt : office.updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        {(remote.updatedAt > office.updatedAt ? remote.updatedByName : office.updatedByName) ? ` by ${remote.updatedAt > office.updatedAt ? remote.updatedByName : office.updatedByName}` : ''}. Changes reach desktop trackers immediately.
      </div>
    </div>
  );
}

function NumInput({ value, unit, onSave }: { value: number; unit: string; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setV(String(value));
  }
  const commit = () => {
    const n = Number(v);
    if (!Number.isFinite(n) || v.trim() === '') return setV(String(value));
    if (n !== value) onSave(n);
  };
  return (
    <span className="row" style={{ gap: 6 }}>
      <input className="input time-num-input" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <span className="faint" style={{ fontSize: 12 }}>{unit}</span>
    </span>
  );
}
