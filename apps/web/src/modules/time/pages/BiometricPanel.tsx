import { useState } from 'react';
import type { BiometricDeviceRow, EnrollmentRow, RawLogRow } from '@lexisora/shared';
import { FormModal, type FieldDef } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { DataTable } from '@/components/table';
import { Card, ConfirmDialog, ErrorBlock, Tabs, Tag } from '@/components/ui';
import { del, get, HttpError, patch, post, put } from '@/lib/api';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { stamp, tk, useBioLogs, useDevices, useEnrollments, useUnclaimed } from '../api';
import '../time.css';

type Tab = 'devices' | 'enrollments' | 'logs' | 'simulator';
const DIRECTION: Record<string, string> = { FIRST_LAST: 'First in · last out', DEVICE_STATUS: 'Device in/out key', ALTERNATE: 'Alternate in/out' };
const STATUS_CODE: Record<number, string> = { 0: 'Check-in', 1: 'Check-out', 2: 'Break out', 3: 'Break in', 4: 'OT in', 5: 'OT out' };
const ERROR_COPY: Record<string, string> = {
  UNKNOWN_PIN: 'Unknown PIN · enrol the employee',
  DUPLICATE: 'Duplicate tap',
  PERIOD_LOCKED: 'Period locked',
  DEVICE_CLOCK: 'Device clock ahead',
  PUNCH_NOT_ALLOWED: 'Punch not allowed',
};
const ICLOCK = '/attendance/biometric/iclock/cdata';

/** Biometric devices (ZKTeco ADMS push): registry, PIN enrolment, raw logs and an HR punch simulator. */
export function BiometricPanel({ focusDevice }: { focusDevice?: string | null }) {
  const [tab, setTab] = useState<Tab>('devices');
  const [logDevice, setLogDevice] = useState(focusDevice ?? '');
  return (
    <div className="time-panel">
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'devices', label: 'Devices' },
          { value: 'enrollments', label: 'PIN enrolment' },
          { value: 'logs', label: 'Raw logs' },
          { value: 'simulator', label: 'Punch simulator' },
        ]}
      />
      {tab === 'devices' && (
        <Devices
          onLogs={(id) => {
            setLogDevice(id);
            setTab('logs');
          }}
        />
      )}
      {tab === 'enrollments' && <Enrollments />}
      {tab === 'logs' && <Logs deviceId={logDevice} setDeviceId={setLogDevice} />}
      {tab === 'simulator' && <Simulator />}
    </div>
  );
}

function deviceFields(locations: { value: string; label: string }[], edit: boolean): FieldDef[] {
  return [
    { name: 'serialNumber', label: 'Serial number', type: 'text', required: true, disabled: edit, placeholder: 'e.g. CQZ7232560019', hint: 'Printed on the device label (System → Device info).' },
    { name: 'name', label: 'Device name', type: 'text', required: true, placeholder: 'Ahmedabad HQ · Main entrance' },
    { name: 'locationId', label: 'Work location', type: 'select', options: [{ value: '', label: 'Not set' }, ...locations] },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'SpeedFace-V5L' },
    { name: 'directionMode', label: 'Direction mode', type: 'select', required: true, options: Object.entries(DIRECTION).map(([value, label]) => ({ value, label })), hint: 'First in · last out suits single-door offices.' },
    ...(edit ? [{ name: 'status', label: 'Status', type: 'select' as const, required: true, options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled' }] }] : []),
  ];
}

function Devices({ onLogs }: { onLogs: (deviceId: string) => void }) {
  const q = useDevices();
  const unclaimed = useUnclaimed();
  const lookups = useLookups(['locations']);
  const locations = opts(lookups.data, 'locations');
  const { toast, toastError } = useToast();
  const [form, setForm] = useState<{ edit: BiometricDeviceRow | null; sn?: string } | null>(null);
  const [remove, setRemove] = useState<BiometricDeviceRow | null>(null);
  const [check, setCheck] = useState<{ sn: string; ok: boolean; text: string } | null>(null);
  const endpoint = `${window.location.origin}/api/v1${ICLOCK}`;

  const save = useAction(
    (v: Record<string, any>) => {
      const body = { name: v.name, locationId: v.locationId || null, model: v.model || null, directionMode: v.directionMode, ...(form?.edit ? { status: v.status } : { serialNumber: v.serialNumber }) };
      return form?.edit ? patch(`/attendance/biometric/devices/${form.edit.id}`, body) : post('/attendance/biometric/devices', body);
    },
    { success: form?.edit ? 'Device updated' : 'Device registered · it can push punches now', invalidate: [tk.devices, tk.unclaimed], onSuccess: () => setForm(null) },
  );
  const removeAct = useAction((id: string) => del(`/attendance/biometric/devices/${id}`), { success: 'Device removed', invalidate: [tk.devices], onSuccess: () => setRemove(null) });

  async function checkEndpoint(sn: string) {
    try {
      const text = await get<string>(ICLOCK, { SN: sn, probe: 1 });
      const ok = typeof text === 'string' && text.startsWith('GET OPTION FROM');
      setCheck({ sn, ok, text: String(text) });
      if (ok) toast('Endpoint reachable · handshake OK');
    } catch (e) {
      setCheck({ sn, ok: false, text: e instanceof HttpError ? `${e.status} ${e.message}` : 'Could not reach the endpoint' });
      toastError(e);
    }
  }

  return (
    <>
      <div className="row-between">
        <span className="faint" style={{ fontSize: 13 }}>Office staff punch on these devices. Each push is stored raw, matched to an enrolled PIN and turned into a punch.</span>
        <button className="btn btn-primary" onClick={() => setForm({ edit: null })}>Register device</button>
      </div>
      {q.isError ? (
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      ) : (
        <DataTable
          loading={q.isLoading}
          rows={q.data}
          rowKey={(r) => r.id}
          onRowClick={(r) => setForm({ edit: r })}
          empty="No biometric devices registered yet."
          columns={[
            { key: 'n', header: 'Device name', render: (r) => <span><span style={{ display: 'block' }}>{r.name}</span><span className="faint" style={{ fontSize: 11.5 }}>{r.locationName ?? 'No location'}</span></span> },
            { key: 's', header: 'Serial no.', render: (r) => <code style={{ fontSize: 12 }}>{r.serialNumber}</code> },
            { key: 'm', header: 'Model / firmware', render: (r) => [r.model, r.firmware].filter(Boolean).join(' · ') || '—' },
            { key: 'd', header: 'Direction mode', render: (r) => DIRECTION[r.directionMode] ?? r.directionMode },
            { key: 'l', header: 'Last seen', render: (r) => (r.lastSeenAt ? stamp(r.lastSeenAt) : 'Never') },
            { key: 'st', header: 'Status', render: (r) => <Tag tone={r.status === 'Online' ? 'accent' : r.status === 'Offline' ? 'outline' : 'neutral'}>{r.status}</Tag> },
            {
              key: 'u',
              header: 'Waiting logs',
              num: true,
              render: (r) =>
                r.unprocessed ? (
                  <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onLogs(r.id); }}>{r.unprocessed}</button>
                ) : (
                  '0'
                ),
            },
            {
              key: 'x',
              header: '',
              render: (r) => (
                <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); void checkEndpoint(r.serialNumber); }}>Check endpoint</button>
                  <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onLogs(r.id); }}>Logs</button>
                  <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setRemove(r); }}>Remove</button>
                </span>
              ),
            },
          ]}
        />
      )}

      <div className="grid-2-1">
        <Card kicker="ADMS push setup">
          <div className="stack" style={{ gap: 8, fontSize: 13 }}>
            <div>On the device open <b>Comm → Cloud server setting</b>, enter this server's address and enable <b>HTTPS</b> if your proxy terminates TLS. The device then calls:</div>
            <div className="time-code">{endpoint}?SN=&lt;serial&gt;</div>
            <div className="faint" style={{ fontSize: 12.5 }}>ZKTeco firmware always calls <code>/iclock/cdata</code> at the server root; the reverse proxy forwards <code>/iclock/</code> to the path above. Unknown serial numbers are listed below for you to register.</div>
            {check && (
              <div className="stack" style={{ gap: 4 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Tag tone={check.ok ? 'accent' : 'danger'}>{check.ok ? 'Handshake OK' : 'No handshake'}</Tag>
                  <span className="faint" style={{ fontSize: 12 }}>SN {check.sn}</span>
                </div>
                <div className="time-code">{check.text}</div>
                {!check.ok && check.text === 'OK' && <div className="faint" style={{ fontSize: 12 }}>The endpoint answered, but this serial is not registered or is disabled, so the device would get no options.</div>}
              </div>
            )}
          </div>
        </Card>
        <Card kicker="Unregistered devices calling in">
          {unclaimed.data?.length ? (
            unclaimed.data.map((u) => (
              <div key={u.serialNumber} className="time-item" style={{ alignItems: 'center' }}>
                <span>
                  <code style={{ fontSize: 12 }}>{u.serialNumber}</code>
                  <span className="faint" style={{ display: 'block', fontSize: 11.5 }}>Last call {stamp(u.lastSeenAt)}{u.ip ? ` · ${u.ip}` : ''}</span>
                </span>
                <button className="btn btn-secondary btn-sm" onClick={() => setForm({ edit: null, sn: u.serialNumber })}>Register</button>
              </div>
            ))
          ) : (
            <div className="faint" style={{ fontSize: 13 }}>None. A new device shows up here after its first call.</div>
          )}
        </Card>
      </div>

      {form && (
        <FormModal
          title={form.edit ? `Edit ${form.edit.name}` : 'Register biometric device'}
          fields={deviceFields(locations, !!form.edit)}
          submitLabel={form.edit ? 'Save' : 'Register'}
          initial={
            form.edit
              ? { serialNumber: form.edit.serialNumber, name: form.edit.name, locationId: form.edit.locationId ?? '', model: form.edit.model ?? '', directionMode: form.edit.directionMode, status: form.edit.status === 'Disabled' ? 'DISABLED' : 'ACTIVE' }
              : { serialNumber: form.sn ?? '', directionMode: 'FIRST_LAST' }
          }
          onSubmit={(v) => save.mutateAsync(v)}
          onClose={() => setForm(null)}
        />
      )}
      {remove && (
        <ConfirmDialog
          title={`Remove ${remove.name}?`}
          body="A device that already sent punches is disabled instead of deleted, so its history stays available."
          confirmLabel="Remove"
          danger
          busy={removeAct.isPending}
          onConfirm={() => removeAct.mutate(remove.id)}
          onClose={() => setRemove(null)}
        />
      )}
    </>
  );
}

function Enrollments() {
  const q = useEnrollments();
  const [filter, setFilter] = useState('');
  const rows = (q.data ?? []).filter((r) => !filter || `${r.name} ${r.empCode} ${r.pin ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <div className="row-between">
        <span className="faint" style={{ fontSize: 13 }}>The PIN is the user ID enrolled on the device (fingerprint / face). Saving a PIN reprocesses logs that were waiting for it.</span>
        <input className="input" placeholder="Search name, code or PIN" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 240 }} />
      </div>
      {q.isError ? (
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      ) : (
        <DataTable
          loading={q.isLoading}
          rows={rows}
          rowKey={(r) => r.employeeId}
          empty="No employees match."
          columns={[
            { key: 'n', header: 'Employee', render: (r) => r.name },
            { key: 'c', header: 'Code', render: (r) => r.empCode },
            { key: 'm', header: 'Work mode', render: (r) => r.workMode.charAt(0) + r.workMode.slice(1).toLowerCase() },
            { key: 'p', header: 'Device PIN', render: (r) => <PinInput row={r} /> },
          ]}
        />
      )}
    </>
  );
}

function PinInput({ row }: { row: EnrollmentRow }) {
  const [pin, setPin] = useState(row.pin ?? '');
  const save = useAction(() => put<{ reprocessed: number }>('/attendance/biometric/enrollments', { employeeId: row.employeeId, pin: pin.trim() }), {
    success: (r) => (r.reprocessed ? `PIN saved · ${r.reprocessed} waiting log${r.reprocessed === 1 ? '' : 's'} processed` : 'PIN saved'),
    invalidate: [tk.enrollments, tk.bioLogs, tk.devices],
  });
  const dirty = pin.trim() !== (row.pin ?? '') && /^\d{1,9}$/.test(pin.trim());
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <input
        className="input"
        inputMode="numeric"
        aria-label={`Device PIN for ${row.name}`}
        style={{ width: 110 }}
        placeholder="Not enrolled"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 9))}
        onKeyDown={(e) => e.key === 'Enter' && dirty && save.mutate(undefined)}
      />
      {dirty && <button className="btn btn-secondary btn-sm" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Save</button>}
    </span>
  );
}

function Logs({ deviceId, setDeviceId }: { deviceId: string; setDeviceId: (v: string) => void }) {
  const devices = useDevices();
  const q = useBioLogs(deviceId);
  const reprocess = useAction(() => post<{ message: string }>('/attendance/biometric/logs/reprocess', { deviceId: deviceId || null }), {
    success: (r) => r.message,
    invalidate: [tk.bioLogs, tk.devices, tk.all],
  });
  const waiting = (q.data ?? []).filter((r) => !r.processed).length;
  return (
    <>
      <div className="row-between">
        <div className="row" style={{ gap: 8 }}>
          <label htmlFor="log-dev" style={{ fontSize: 13 }}>Device</label>
          <select id="log-dev" className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={{ width: 240 }}>
            <option value="">All devices</option>
            {devices.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <button className="btn btn-secondary" disabled={reprocess.isPending} onClick={() => reprocess.mutate(undefined)}>
          Reprocess waiting logs{waiting ? ` · ${waiting}` : ''}
        </button>
      </div>
      {q.isError ? (
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      ) : (
        <DataTable<RawLogRow>
          loading={q.isLoading}
          rows={q.data}
          rowKey={(r) => r.id}
          empty="No pushes received yet. Use the punch simulator to test the pipeline."
          columns={[
            { key: 'r', header: 'Received', render: (r) => stamp(r.receivedAt) },
            { key: 'p', header: 'PIN', render: (r) => r.pin },
            { key: 'e', header: 'Employee', render: (r) => r.employeeName ?? <span className="faint">—</span> },
            { key: 't', header: 'Punch time (device)', render: (r) => r.punchedAtLocal.slice(0, 16) },
            { key: 's', header: 'Key', render: (r) => (r.statusCode != null ? STATUS_CODE[r.statusCode] ?? r.statusCode : '—') },
            {
              key: 'x',
              header: 'Result',
              render: (r) =>
                r.processed && !r.error ? (
                  <Tag tone="accent">Punch recorded</Tag>
                ) : r.error ? (
                  <Tag tone={r.processed ? 'neutral' : 'danger'}>{ERROR_COPY[r.error] ?? r.error}</Tag>
                ) : (
                  <Tag tone="outline">Waiting</Tag>
                ),
            },
          ]}
        />
      )}
    </>
  );
}

function nowLocal(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16);
}

function Simulator() {
  const devices = useDevices();
  const enr = useEnrollments();
  const active = (devices.data ?? []).filter((d) => d.status !== 'Disabled');
  const enrolled = (enr.data ?? []).filter((e) => e.pin);
  const [sn, setSn] = useState('');
  const [pin, setPin] = useState('');
  const [at, setAt] = useState(nowLocal());
  const [status, setStatus] = useState('0');
  const [result, setResult] = useState<{ received: number; accepted: number; log: RawLogRow | null } | null>(null);
  const device = sn || active[0]?.serialNumber || '';
  const run = useAction(
    () => post<{ received: number; accepted: number; log: RawLogRow | null }>('/attendance/biometric/simulate', { serialNumber: device, pin: pin.trim(), at: at.replace('T', ' '), status: Number(status) }),
    {
      success: (r) => (r.accepted ? 'Punch received from device' : 'Log stored · see the result below'),
      invalidate: [tk.all],
      onSuccess: (r) => setResult(r),
    },
  );
  return (
    <div className="grid-2-1">
      <Card kicker="Send a test punch">
        <div className="stack" style={{ gap: 10 }}>
          <div className="faint" style={{ fontSize: 12.5 }}>Pushes one ATTLOG line through the same pipeline as a real device: raw log → PIN match → punch → attendance day.</div>
          <div className="field">
            <label htmlFor="sim-dev">Device</label>
            <select id="sim-dev" className="input" value={device} onChange={(e) => setSn(e.target.value)}>
              {!active.length && <option value="">Register a device first</option>}
              {active.map((d) => <option key={d.id} value={d.serialNumber}>{d.name} · {d.serialNumber}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sim-emp">Employee</label>
            <select id="sim-emp" className="input" value={enrolled.some((e) => e.pin === pin) ? pin : ''} onChange={(e) => setPin(e.target.value)}>
              <option value="">Pick an enrolled employee…</option>
              {enrolled.map((e) => <option key={e.employeeId} value={e.pin!}>{e.name} · PIN {e.pin}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sim-pin">PIN</label>
            <input id="sim-pin" className="input" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="Or type any PIN (unknown PINs are kept for review)" />
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="sim-at">Device time (IST)</label>
              <input id="sim-at" className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </div>
            <div className="field" style={{ width: 150 }}>
              <label htmlFor="sim-st">Key</label>
              <select id="sim-st" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                {[0, 1, 2, 3].map((k) => <option key={k} value={k}>{STATUS_CODE[k]}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={!device || !pin || !at || run.isPending} onClick={() => run.mutate(undefined)}>Send punch</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAt(nowLocal())}>Now</button>
          </div>
        </div>
      </Card>
      <Card kicker="Result">
        {result ? (
          <div className="stack" style={{ gap: 6, fontSize: 13 }}>
            <div>Lines received {result.received} · punches created {result.accepted}</div>
            {result.log && (
              <>
                <div>PIN {result.log.pin} · {result.log.employeeName ?? 'unknown employee'} · {result.log.punchedAtLocal.slice(0, 16)}</div>
                <div>{result.log.processed && !result.log.error ? <Tag tone="accent">Punch recorded</Tag> : <Tag tone="danger">{ERROR_COPY[result.log.error ?? ''] ?? result.log.error ?? 'Waiting'}</Tag>}</div>
              </>
            )}
            <div className="faint" style={{ fontSize: 12 }}>Office employees see the punch on their Attendance card (source Biometric).</div>
          </div>
        ) : (
          <div className="faint" style={{ fontSize: 13 }}>Nothing sent yet.</div>
        )}
      </Card>
    </div>
  );
}
