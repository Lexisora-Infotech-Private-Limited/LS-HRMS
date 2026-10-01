import { useState } from 'react';
import { formatDate, formatTime, type PrivacyOverview } from '@lexisora/shared';
import { Card, ErrorBlock, Loading, PageHeader, Tag } from '@/components/ui';
import { DataTable, type Column } from '@/components/table';
import { usePrivacy } from '../api';
import '../platform.css';

type Row = PrivacyOverview['rows'][number];
type Access = PrivacyOverview['platformAccess'][number];

/** Data privacy guarantee (wireframe GEN "privacy"): who can see what, enforced controls, platform access log. */
export default function PrivacyPage() {
  const p = usePrivacy();
  const [showTables, setShowTables] = useState(false);
  if (p.isLoading) return <Loading />;
  if (p.error || !p.data) return <ErrorBlock error={p.error} retry={() => void p.refetch()} />;
  const d = p.data;

  const columns: Column<Row>[] = [
    { key: 'data', header: 'Data', render: (r) => r.data },
    { key: 'tenant', header: 'Tenant admin', render: (r) => r.tenantAdmin },
    { key: 'platform', header: 'Lexisora super-admin', render: (r) => <Tag tone={r.platformTone}>{r.platformAdmin}</Tag> },
    { key: 'enc', header: 'Encryption', render: (r) => r.encryption },
  ];
  const accessCols: Column<Access>[] = [
    { key: 'when', header: 'When', render: (a) => <span className="pf-when">{formatDate(a.createdAt)} · {formatTime(a.createdAt)}</span> },
    { key: 'who', header: 'Who', render: (a) => a.actorName },
    { key: 'what', header: 'What', render: (a) => a.summary },
  ];

  return (
    <div data-screen-label="Data privacy" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Data privacy guarantee"
        sub="The platform super-admin cannot read a tenant's chats, salaries or personal documents. These controls are enforced, not optional."
      />
      <DataTable columns={columns} rows={d.rows} rowKey={(r) => r.data} />

      <div className="grid-2-1" style={{ alignItems: 'start' }}>
        <Card kicker="Enforced in code" title="How the guarantee is kept">
          {d.controls.map((c) => (
            <div key={c.title} className="list-row" style={{ alignItems: 'flex-start' }}>
              <span className="grow">
                <strong style={{ fontWeight: 600 }}>{c.title}</strong>
                <div className="muted" style={{ fontSize: 13 }}>{c.detail}</div>
              </span>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowTables((v) => !v)} aria-expanded={showTables}>
            {showTables ? 'Hide' : 'Show'} the {d.blockedModels.length} restricted tables
          </button>
          {showTables && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {d.blockedModels.map((m) => (
                <span key={m} className="pf-key">{m}</span>
              ))}
            </div>
          )}
        </Card>
        <div className="stack" style={{ gap: 16 }}>
          <Card kicker="Encryption key" title={d.key.algorithm}>
            <div className="kv-row"><span>Key</span><span>{d.key.provider}</span></div>
            <div className="kv-row"><span>Version</span><span>{d.key.version}</span></div>
            <button className="btn btn-secondary btn-sm" disabled title="Available on Enterprise" style={{ alignSelf: 'flex-start' }}>Rotate key</button>
            <div className="field-hint">Per-tenant keys and rotation · Available on Enterprise</div>
          </Card>
          <Card kicker="Available on Enterprise" title="More controls">
            {d.upcoming.map((u) => (
              <div key={u.title} className="list-row" style={{ alignItems: 'flex-start' }}>
                <span className="grow">
                  {u.title}
                  <div className="muted" style={{ fontSize: 12.5 }}>{u.detail}</div>
                </span>
                <button className="btn btn-secondary btn-sm" disabled title="Available on Enterprise">Request</button>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <Card kicker="Last 90 days" title="Platform access log">
        <div className="muted" style={{ fontSize: 13 }}>Every action Lexisora staff took on this workspace. The same rows are in Audit log → Platform.</div>
        <DataTable columns={accessCols} rows={d.platformAccess} rowKey={(a) => a.id} empty="Lexisora staff haven’t accessed this workspace in the last 90 days." />
      </Card>
    </div>
  );
}
