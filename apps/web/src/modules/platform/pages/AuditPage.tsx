import { useEffect, useState } from 'react';
import { istDateKey, type AuditQuery, type AuditResult, type AuditRowDto } from '@lexisora/shared';
import { ErrorBlock, Modal, PageHeader, Tabs, Tag, type Tone } from '@/components/ui';
import { DataTable, Pager, type Column } from '@/components/table';
import { download } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { auditExportPath, useAudit, useAuditFacets } from '../api';
import '../platform.css';

type Tab = AuditQuery['tab'];
type Filters = { tab: Tab; from: string; to: string; actor: string; module: string; result: '' | AuditResult; action: string; entityId: string; page: number };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PAGE_SIZE = 25;

/** "29 Sep, 10:12:04" in IST. */
export function auditWhen(iso: string, withYear = false): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]}${withYear ? ` ${parts.year}` : ''}, ${hour}:${parts.minute}:${parts.second}`;
}

const RESULT_TONE: Record<AuditResult, Tone> = { success: 'accent', denied: 'danger', failure: 'outline' };
const RESULT_LABEL: Record<AuditResult, string> = { success: 'Success', denied: 'Denied', failure: 'Failure' };

function defaults(): Filters {
  const now = new Date();
  return { tab: 'all', from: istDateKey(new Date(now.getTime() - 6 * 86_400_000)), to: istDateKey(now), actor: '', module: '', result: '', action: '', entityId: '', page: 1 };
}

/** Audit log (spec M6): every sign-in, permission change and sensitive action in this workspace. */
export default function AuditPage() {
  const { toastError } = useToast();
  const [f, setF] = useState<Filters>(defaults);
  // Free-text filters apply 300 ms after typing stops.
  const [text, setText] = useState({ action: '', entityId: '' });
  useEffect(() => {
    const t = setTimeout(() => setF((s) => (s.action === text.action && s.entityId === text.entityId ? s : { ...s, ...text, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [text]);
  const [open, setOpen] = useState<AuditRowDto | null>(null);
  const [exporting, setExporting] = useState(false);

  const query: Partial<AuditQuery> = {
    tab: f.tab,
    from: f.from || undefined,
    to: f.to || undefined,
    actor: f.actor || undefined,
    module: f.module || undefined,
    result: f.result || undefined,
    action: f.action.trim() || undefined,
    entityId: f.entityId.trim() || undefined,
    page: f.page,
    pageSize: PAGE_SIZE,
  };
  const list = useAudit(query);
  const facets = useAuditFacets();
  const set = (patch: Partial<Filters>) => setF((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const counts = list.data?.counts;

  async function exportCsv() {
    setExporting(true);
    try {
      await download(auditExportPath(query));
    } catch (e) {
      toastError(e);
    } finally {
      setExporting(false);
    }
  }

  const columns: Column<AuditRowDto>[] = [
    { key: 'when', header: 'When', render: (r) => <span className="pf-when">{auditWhen(r.createdAt)}</span> },
    { key: 'actor', header: 'Actor', render: (r) => (r.platform ? <span>{r.actorName} <Tag tone="outline">Lexisora</Tag></span> : r.actorName) },
    { key: 'action', header: 'Action', render: (r) => <span className="pf-mono">{r.action}</span> },
    { key: 'module', header: 'Module', render: (r) => r.module },
    { key: 'entity', header: 'Entity', render: (r) => (<span>{r.entity}{r.entityId && <span className="faint pf-mono"> …{r.entityId.slice(-6)}</span>}</span>) },
    { key: 'summary', header: 'Summary', render: (r) => <span style={{ display: 'inline-block', maxWidth: 380 }}>{r.summary}</span> },
    { key: 'ip', header: 'IP', render: (r) => (r.ip ? <span className="pf-mono">{r.ip}</span> : <span className="faint">—</span>) },
    { key: 'result', header: 'Result', render: (r) => <Tag tone={RESULT_TONE[r.result]}>{RESULT_LABEL[r.result]}</Tag> },
  ];

  const filtered = f.actor || f.module || f.result || f.action || f.entityId || f.from !== defaults().from || f.to !== defaults().to;

  return (
    <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties} data-screen-label="Audit log">
      <PageHeader
        title="Audit log"
        sub="Every sign-in, permission change and sensitive action, tamper-evident."
        actions={
          <button className="btn btn-secondary" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
      />
      <Tabs<Tab>
        tabs={[
          { value: 'all', label: `All${counts ? ` · ${counts.all}` : ''}` },
          { value: 'security', label: `Security${counts ? ` · ${counts.security}` : ''}` },
          { value: 'access', label: `Access changes${counts ? ` · ${counts.access}` : ''}` },
          { value: 'platform', label: `Platform access${counts ? ` · ${counts.platform}` : ''}` },
        ]}
        value={f.tab}
        onChange={(tab) => set({ tab })}
      />
      {f.tab === 'platform' && (
        <div className="note">Actions taken in your workspace by Lexisora staff (support sessions, billing and tenant changes). Lexisora staff never see chats, salaries or documents.</div>
      )}

      <div className="pf-filters">
        <div className="field">
          <label htmlFor="au-from">From</label>
          <input id="au-from" className="input" type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="au-to">To</label>
          <input id="au-to" className="input" type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="au-actor">Actor</label>
          <select id="au-actor" className="input" value={f.actor} onChange={(e) => set({ actor: e.target.value })}>
            <option value="">Everyone</option>
            {(facets.data?.actors ?? []).map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-module">Module</label>
          <select id="au-module" className="input" value={f.module} onChange={(e) => set({ module: e.target.value })}>
            <option value="">All modules</option>
            {(facets.data?.modules ?? []).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-result">Result</label>
          <select id="au-result" className="input" value={f.result} onChange={(e) => set({ result: e.target.value as Filters['result'] })}>
            <option value="">Any result</option>
            <option value="success">Success</option>
            <option value="denied">Denied</option>
            <option value="failure">Failure</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-action">Action</label>
          <input id="au-action" className="input" placeholder="e.g. rbac.permission" value={text.action} onChange={(e) => setText((t) => ({ ...t, action: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="au-entity">Entity id</label>
          <input id="au-entity" className="input" placeholder="Paste an id" value={text.entityId} onChange={(e) => setText((t) => ({ ...t, entityId: e.target.value }))} />
        </div>
        {filtered && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setText({ action: '', entityId: '' });
              setF((s) => ({ ...defaults(), tab: s.tab }));
            }}
          >
            Reset filters
          </button>
        )}
      </div>

      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={list.data?.items}
          rowKey={(r) => r.id}
          loading={list.isLoading}
          onRowClick={setOpen}
          empty="No audit events match these filters. Widen the date range or clear a filter."
        />
      )}
      {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(page) => set({ page })} />}

      {open && (
        <Modal
          title={open.summary}
          onClose={() => setOpen(null)}
          wide
          actions={
            <>
              {open.actorUserId && (
                <button className="btn btn-secondary" onClick={() => { set({ actor: open.actorUserId! }); setOpen(null); }}>
                  More by {open.actorName}
                </button>
              )}
              {open.entityId && (
                <button className="btn btn-secondary" onClick={() => { setText((t) => ({ ...t, entityId: open.entityId! })); setOpen(null); }}>
                  History of this {open.entity}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setOpen(null)}>Close</button>
            </>
          }
        >
          <div className="dialog-body stack">
            <dl className="pf-kv">
              <dt>When</dt>
              <dd className="pf-when">{auditWhen(open.createdAt, true)} IST</dd>
              <dt>Actor</dt>
              <dd>{open.actorName}{open.platform ? ' (Lexisora platform)' : ''}</dd>
              <dt>Action</dt>
              <dd className="pf-mono">{open.action}</dd>
              <dt>Module</dt>
              <dd>{open.module}</dd>
              <dt>Entity</dt>
              <dd>{open.entity}{open.entityId && <span className="pf-mono faint"> {open.entityId}</span>}</dd>
              <dt>IP address</dt>
              <dd className="pf-mono">{open.ip ?? '—'}</dd>
              <dt>Result</dt>
              <dd><Tag tone={RESULT_TONE[open.result]}>{RESULT_LABEL[open.result]}</Tag></dd>
            </dl>
            {open.meta !== null && open.meta !== undefined && (
              <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                <div className="kicker">Details</div>
                <pre className="pf-json">{JSON.stringify(open.meta, null, 2)}</pre>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
