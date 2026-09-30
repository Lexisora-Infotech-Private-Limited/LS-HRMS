import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, TRACKER_FOOTER_NOTE, type DeviceRow } from '@lexisora/shared';
import { useMe } from '@/lib/auth';
import { onRealtime } from '@/lib/socket';
import { DataTable, type Column } from '@/components/table';
import { Card, ErrorBlock, Loading } from '@/components/ui';
import { ago, trackerApi, trackerKeys } from './api';
import { DeviceStatusTag, HrDecisionDialog, PairDeviceModal, RevokeDeviceDialog } from './components';
import './tracker.css';

/**
 * Profile → Devices: enter the 6-digit code shown by the desktop tracker to pair it,
 * list and revoke paired devices. Implemented by the Tracker module; used on the profile.
 *
 * - Own profile (no employeeId, or my own): "Pair device", revoke (reason optional).
 * - HR (devices.manage) on another profile: approve/reject AWAITING_HR, revoke with a mandatory reason.
 * - Reporting manager on a report's profile: read-only.
 */
export function DevicesPanel({ employeeId }: { employeeId?: string }) {
  const me = useMe();
  const own = !employeeId || employeeId === me.employeeId;
  return own ? <OwnDevices /> : <EmployeeDevices employeeId={employeeId!} />;
}

function OwnDevices() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: trackerKeys.myDevices, queryFn: trackerApi.myDevices });
  const [pairing, setPairing] = useState(false);
  const [revoking, setRevoking] = useState<DeviceRow | null>(null);
  const [waitingHost, setWaitingHost] = useState<string | null>(null);

  useEffect(() => {
    const offs = [
      onRealtime<{ hostname: string }>('device.pairing.requested', (p) => {
        setWaitingHost(p.hostname);
        void qc.invalidateQueries({ queryKey: trackerKeys.myDevices });
      }),
      onRealtime('device.paired', () => {
        setWaitingHost(null);
        void qc.invalidateQueries({ queryKey: trackerKeys.myDevices });
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [qc]);

  const waiting = waitingHost ?? q.data?.waiting[0]?.hostname ?? null;
  const invalidate = [trackerKeys.myDevices];
  const columns: Column<DeviceRow>[] = [
    { key: 'device', header: 'Device', render: (d) => <strong style={{ letterSpacing: '0.02em' }}>{d.hostname}</strong> },
    { key: 'os', header: 'OS', render: (d) => d.os },
    { key: 'ver', header: 'App version', render: (d) => `v${d.appVersion}` },
    { key: 'paired', header: 'Paired', render: (d) => (d.pairedAt ? formatDate(d.pairedAt) : '—') },
    { key: 'seen', header: 'Last seen', render: (d) => (d.status === 'ACTIVE' ? ago(d.lastSeenAt) : d.revokedAt ? `Revoked ${formatDate(d.revokedAt)}` : '—') },
    { key: 'status', header: 'Status', render: (d) => <DeviceStatusTag d={d} /> },
    {
      key: 'act',
      header: '',
      render: (d) =>
        d.status === 'ACTIVE' ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setRevoking(d)}>
            Revoke
          </button>
        ) : null,
    },
  ];

  return (
    <div className="stack" data-screen-label="Profile · Devices">
      <Card
        kicker="Devices"
        title="Desktop tracker"
        style={{ gap: 12 }}
      >
        <div className="row-between">
          <p className="faint" style={{ margin: 0, fontSize: 13, maxWidth: 620 }}>
            Laptops paired to your account. Sign in to Lexisora Tracker, then enter the 6-digit code it shows here. {TRACKER_FOOTER_NOTE}
          </p>
          <button className="btn btn-primary" onClick={() => setPairing(true)}>
            Pair device
          </button>
        </div>
        {waiting && (
          <div className="note row-between" role="status">
            <span>A device ({waiting}) is waiting — enter the code shown on it.</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setPairing(true)}>
              Enter code
            </button>
          </div>
        )}
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBlock error={q.error} retry={() => void q.refetch()} />
        ) : (
          <DataTable columns={columns} rows={q.data?.items} rowKey={(d) => d.id} empty="No devices paired yet. Install Lexisora Tracker, sign in and pair it with the code it shows." />
        )}
      </Card>
      {pairing && (
        <PairDeviceModal
          invalidate={invalidate}
          onClose={() => {
            setPairing(false);
            setWaitingHost(null);
          }}
        />
      )}
      {revoking && <RevokeDeviceDialog device={revoking} reasonRequired={false} invalidate={invalidate} onClose={() => setRevoking(null)} />}
    </div>
  );
}

function EmployeeDevices({ employeeId }: { employeeId: string }) {
  const q = useQuery({ queryKey: trackerKeys.employeeDevices(employeeId), queryFn: () => trackerApi.employeeDevices(employeeId) });
  const [revoking, setRevoking] = useState<DeviceRow | null>(null);
  const [deciding, setDeciding] = useState<DeviceRow | null>(null);
  const canManage = !!q.data?.canManage;
  const invalidate = [trackerKeys.employeeDevices(employeeId), trackerKeys.admin];
  const columns: Column<DeviceRow>[] = [
    { key: 'device', header: 'Device', render: (d) => <strong style={{ letterSpacing: '0.02em' }}>{d.hostname}</strong> },
    { key: 'os', header: 'OS', render: (d) => d.os },
    { key: 'ver', header: 'App version', render: (d) => `v${d.appVersion}` },
    { key: 'paired', header: 'Paired', render: (d) => (d.pairedAt ? formatDate(d.pairedAt) : '—') },
    { key: 'seen', header: 'Last seen', render: (d) => (d.status === 'ACTIVE' ? ago(d.lastSeenAt) : '—') },
    { key: 'status', header: 'Status', render: (d) => <DeviceStatusTag d={d} /> },
    ...(canManage
      ? [
          {
            key: 'act',
            header: '',
            render: (d: DeviceRow) =>
              d.status === 'ACTIVE' ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setRevoking(d)}>
                  Revoke
                </button>
              ) : d.status === 'AWAITING_HR' ? (
                <button className="btn btn-secondary btn-sm" onClick={() => setDeciding(d)}>
                  Review
                </button>
              ) : null,
          },
        ]
      : []),
  ];
  return (
    <div className="stack" data-screen-label="Profile · Devices">
      <Card kicker="Devices" title="Desktop tracker">
        <p className="faint" style={{ margin: '0 0 8px', fontSize: 13 }}>
          {canManage ? 'Tracker devices paired to this employee. Revoking signs the tracker out within seconds.' : 'Tracker devices paired to this employee (read-only).'}
        </p>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBlock error={q.error} retry={() => void q.refetch()} />
        ) : (
          <DataTable columns={columns} rows={q.data?.items} rowKey={(d) => d.id} empty="No tracker devices paired." />
        )}
      </Card>
      {revoking && <RevokeDeviceDialog device={revoking} reasonRequired invalidate={invalidate} onClose={() => setRevoking(null)} />}
      {deciding && <HrDecisionDialog device={deciding} invalidate={invalidate} onClose={() => setDeciding(null)} />}
    </div>
  );
}
