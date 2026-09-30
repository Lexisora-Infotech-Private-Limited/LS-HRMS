import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeviceRow, DevicesQuery } from '@lexisora/shared';
import { onRealtime } from '@/lib/socket';
import { DataTable, Pager, type Column } from '@/components/table';
import { Avatar, ErrorBlock, Kpis, PageHeader, Tabs, Tag } from '@/components/ui';
import { formatDate } from '@lexisora/shared';
import { ago, trackerApi, trackerKeys } from '../api';
import { DeviceStatusTag, HrDecisionDialog, RevokeDeviceDialog } from '../components';
import '../tracker.css';

type Tab = DevicesQuery['tab'];
const TABS: Tab[] = ['all', 'active', 'pending', 'stale', 'revoked'];
const TAB_LABEL: Record<Tab, string> = { all: 'All', active: 'Active', pending: 'Awaiting HR', stale: 'Not seen 7 days', revoked: 'Revoked' };

/** HR / Admin fleet view of desktop trackers: pending approvals, stale devices, revoke. */
export default function DevicesAdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'all') as Tab;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [revoking, setRevoking] = useState<DeviceRow | null>(null);
  const [deciding, setDeciding] = useState<DeviceRow | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const off = onRealtime('notification', () => void qc.invalidateQueries({ queryKey: trackerKeys.admin }));
    return off;
  }, [qc]);

  const query = useQuery({
    queryKey: [...trackerKeys.admin, tab, page, q],
    queryFn: () => trackerApi.adminDevices({ tab, page, pageSize: 25, q: q || undefined }),
    placeholderData: keepPreviousData,
  });
  const d = query.data;
  const c = d?.counts;
  const invalidate = [trackerKeys.admin];

  const columns: Column<DeviceRow>[] = [
    {
      key: 'emp',
      header: 'Employee',
      render: (r) =>
        r.employee ? (
          <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
            <Avatar name={r.employee.name} size={28} />
            <div className="trk-device">
              <span>{r.employee.name}</span>
              <small>
                {r.employee.empCode} · {r.employee.workMode === 'OFFICE' ? 'Office' : r.employee.workMode === 'HYBRID' ? 'Hybrid' : 'Remote'}
              </small>
            </div>
          </div>
        ) : (
          '—'
        ),
    },
    { key: 'device', header: 'Device', render: (r) => <strong style={{ letterSpacing: '0.02em' }}>{r.hostname}</strong> },
    { key: 'os', header: 'OS', render: (r) => r.os },
    {
      key: 'ver',
      header: 'Version',
      render: (r) => (
        <span className="row" style={{ gap: 6 }}>
          v{r.appVersion} {r.outdated && <Tag tone="outline">Update available</Tag>}
        </span>
      ),
    },
    { key: 'paired', header: 'Paired', render: (r) => (r.pairedAt ? formatDate(r.pairedAt) : '—') },
    { key: 'seen', header: 'Last seen', render: (r) => (r.status === 'ACTIVE' ? ago(r.lastSeenAt) : r.revokedAt ? formatDate(r.revokedAt) : '—') },
    { key: 'queue', header: 'Queue', num: true, render: (r) => (r.status === 'ACTIVE' ? r.queueDepth : '—') },
    { key: 'status', header: 'Status', render: (r) => <span title={r.revokeReason ?? undefined}><DeviceStatusTag d={r} /></span> },
    {
      key: 'act',
      header: '',
      render: (r) =>
        r.status === 'AWAITING_HR' ? (
          <button className="btn btn-primary btn-sm" onClick={() => setDeciding(r)}>
            Review
          </button>
        ) : r.status === 'ACTIVE' ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setRevoking(r)}>
            Revoke
          </button>
        ) : null,
    },
  ];

  return (
    <div className="stack" style={{ '--gap': '20px' } as React.CSSProperties} data-screen-label="Tracker devices">
      <PageHeader
        title="Tracker devices"
        sub="Desktop trackers paired to employee accounts. Approve pairings over the 2-device limit, spot laptops that stopped syncing and revoke lost or returned ones."
      />
      <Kpis
        items={[
          { label: 'Active devices', value: c?.active ?? '—', sub: d?.latestVersion ? `Latest v${d.latestVersion}` : undefined },
          { label: 'Awaiting HR', value: c?.pending ?? '—', sub: 'Over the device limit' },
          { label: 'Not seen 7 days', value: c?.stale ?? '—', sub: 'Active but silent' },
          { label: 'Revoked', value: c?.revoked ?? '—', sub: 'Kept for history' },
        ]}
      />
      <div className="row-between">
        <Tabs
          tabs={TABS.map((t) => ({ value: t, label: `${TAB_LABEL[t]} · ${c ? c[t] : '…'}` }))}
          value={tab}
          onChange={(t) => {
            setPage(1);
            const p = new URLSearchParams(params);
            if (t === 'all') p.delete('tab');
            else p.set('tab', t);
            setParams(p, { replace: true });
          }}
        />
        <input className="input trk-search" type="search" placeholder="Search employee or device" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search devices" />
      </div>
      {query.error ? (
        <ErrorBlock error={query.error} retry={() => void query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={d?.items}
          loading={query.isLoading}
          rowKey={(r) => r.id}
          empty={tab === 'pending' ? 'No pairing requests are waiting for HR.' : 'No devices match.'}
        />
      )}
      {d && <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />}
      <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>
        Employees pair their own laptops from Profile → Devices using the code the tracker shows. Revoking signs the tracker out within seconds; events recorded before the revoke still sync.
      </p>
      {revoking && <RevokeDeviceDialog device={revoking} reasonRequired invalidate={invalidate} onClose={() => setRevoking(null)} />}
      {deciding && <HrDecisionDialog device={deciding} invalidate={invalidate} onClose={() => setDeciding(null)} />}
    </div>
  );
}
