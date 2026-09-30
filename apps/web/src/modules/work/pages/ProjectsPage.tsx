import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatINRCompact, type ProjectRow } from '@lexisora/shared';
import { useCan } from '@/lib/auth';
import { DataTable, Pager, type Column } from '@/components/table';
import { ErrorBlock, Kpis, PageHeader, Tabs, Tag, type Tone } from '@/components/ui';
import { hours, workApi, workKeys } from '../api';
import { CreateProjectModal, Progress } from '../components';
import '../work.css';

const toneOf = (r: ProjectRow): Tone => {
  if (r.status === 'ACTIVE') return r.health === 'AT_RISK' || r.health === 'OFF_TRACK' ? 'outline' : 'accent';
  if (r.status === 'COMPLETED') return 'accent';
  if (r.status === 'CANCELLED') return 'danger';
  return 'neutral';
};

type Tab = 'live' | 'active' | 'planning' | 'closed';
const TAB_STATUS: Record<Tab, string | undefined> = { live: undefined, active: 'ACTIVE', planning: 'PLANNING,ON_HOLD', closed: 'COMPLETED,CANCELLED' };

export default function ProjectsPage() {
  const nav = useNavigate();
  const can = useCan();
  const [tab, setTab] = useState<Tab>('live');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const kpis = useQuery({ queryKey: workKeys.kpis, queryFn: workApi.kpis });
  const list = useQuery({
    queryKey: [...workKeys.projects, tab, q, page],
    queryFn: () => workApi.projects({ status: TAB_STATUS[tab], q: q || undefined, page, pageSize: 25 }),
  });
  const k = kpis.data;
  const columns: Column<ProjectRow>[] = [
    {
      key: 'name',
      header: 'Project',
      render: (r) => (
        <div>
          <div>{r.name}</div>
          <div className="faint" style={{ fontSize: 11.5 }}>{r.key}{r.deadline ? ` · due ${new Date(r.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</div>
        </div>
      ),
    },
    { key: 'client', header: 'Client', render: (r) => r.clientName },
    { key: 'lead', header: 'Lead', render: (r) => r.leadName ?? '—' },
    { key: 'progress', header: 'Progress', render: (r) => <Progress pct={r.progressPct} /> },
    { key: 'hours', header: 'Estimated vs logged', render: (r) => <span className="tnum">{hours(r.estimatedMinutes, '0h')} / {hours(r.loggedMinutes, '0h')}</span> },
    { key: 'status', header: 'Status', render: (r) => <span title={r.healthReason ?? undefined}><Tag tone={toneOf(r)}>{r.statusLabel}</Tag></span> },
  ];
  return (
    <div data-screen-label="Projects" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Projects"
        sub="Every client and internal project, with its modules, team and estimate."
        actions={
          <>
            {can('clients.manage') && <button className="btn btn-secondary" onClick={() => nav('/clients')}>Clients</button>}
            {can('projects.manage') && <button className="btn btn-primary" onClick={() => setCreating(true)}>Create project</button>}
          </>
        }
      />
      {kpis.error ? (
        <ErrorBlock error={kpis.error} retry={() => void kpis.refetch()} />
      ) : (
        <Kpis
          items={[
            { label: 'Active', value: k ? k.active : '…', sub: k ? `${k.dueThisMonth} due this month` : '' },
            {
              label: `Billable hours (${k ? k.monthLabel.split(' ')[0] : '…'})`,
              value: k ? Math.round(k.billableMinutes / 60).toLocaleString('en-IN') : '…',
              sub: k ? (
                <span title={k.rateMissing.length ? `No rate set: ${k.rateMissing.join(', ')}` : `Source: ${k.billableSource}`}>
                  {formatINRCompact(k.billablePaise)} billable{k.rateMissing.length ? ' · rate missing' : ''}
                </span>
              ) : '',
            },
            { label: 'On track', value: k ? k.onTrack : '…', sub: k ? `${k.atRisk} at risk` : '' },
          ]}
        />
      )}
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Tabs<Tab>
          value={tab}
          onChange={(t) => { setTab(t); setPage(1); }}
          tabs={[{ value: 'live', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'planning', label: 'Planning & on hold' }, { value: 'closed', label: 'Closed' }]}
        />
        <input className="input wk-search" placeholder="Search project, key or client" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={columns} rows={list.data?.items} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => nav(`/projects/${r.id}`)} empty="No projects match." />
      )}
      {list.data && <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      {creating && <CreateProjectModal onClose={() => setCreating(false)} />}
    </div>
  );
}
