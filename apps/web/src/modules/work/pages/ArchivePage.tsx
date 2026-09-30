import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ARCHIVE_ACCESS, ARCHIVE_ACCESS_LABELS, TASK_STATUS_LABELS, formatDate, type ArchiveRow, type ProjectDocumentRow, type TaskStatusKey } from '@lexisora/shared';
import { download } from '@/lib/api';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { DataTable, Pager, type Column } from '@/components/table';
import { ConfirmDialog, Empty, ErrorBlock, Loading, Modal, PageHeader, Tabs, Tag, humanize } from '@/components/ui';
import { hours, workApi, workKeys } from '../api';
import { DocumentsList, Drawer } from '../components';
import '../work.css';

type Tab = 'all' | 'web' | 'mobile' | 'internal';

export default function ArchivePage() {
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const list = useQuery({ queryKey: [...workKeys.archive, tab, q, page], queryFn: () => workApi.archive({ tab, q: q || undefined, page, pageSize: 25 }) });
  const c = list.data?.counts;
  const columns: Column<ArchiveRow>[] = [
    { key: 'p', header: 'Project', render: (r) => <div><div>{r.name}</div><div className="faint" style={{ fontSize: 11.5 }}>{r.key}</div></div> },
    { key: 'c', header: 'Client', render: (r) => r.clientName },
    { key: 'cl', header: 'Closed', render: (r) => r.closedLabel },
    { key: 'd', header: 'Documents', render: (r) => `${r.documents} file${r.documents === 1 ? '' : 's'}` },
    { key: 't', header: 'Tech', render: (r) => r.techStack.join(', ') || '—' },
    { key: 'a', header: 'Access', render: (r) => <Tag>{ARCHIVE_ACCESS_LABELS[r.archiveAccess as keyof typeof ARCHIVE_ACCESS_LABELS] ?? humanize(r.archiveAccess)}</Tag> },
  ];
  return (
    <div data-screen-label="Project archive & client vault" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Project archive & client vault"
        sub="Completed projects with original requirements, assets and scope documents, searchable for future reference."
        actions={list.data?.canManage ? <button className="btn btn-primary" onClick={() => setArchiving(true)}>Archive project</button> : undefined}
      />
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Tabs<Tab>
          value={tab}
          onChange={(t) => { setTab(t); setPage(1); }}
          tabs={[
            { value: 'all', label: `All${c ? ` · ${c.all}` : ''}` },
            { value: 'web', label: `Web${c ? ` · ${c.web}` : ''}` },
            { value: 'mobile', label: `Mobile${c ? ` · ${c.mobile}` : ''}` },
            { value: 'internal', label: `Internal${c ? ` · ${c.internal}` : ''}` },
          ]}
        />
        <input className="input wk-search" placeholder="Search project, client, tech or document" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={columns} rows={list.data?.items} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} empty="No archived projects match." />
      )}
      {list.data && <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      {openId && <ArchiveDrawer id={openId} onClose={() => setOpenId(null)} />}
      {archiving && list.data && <ArchiveDialog options={list.data.archivable} onClose={() => setArchiving(false)} />}
    </div>
  );
}

function ArchiveDialog({ options, onClose }: { options: { value: string; label: string }[]; onClose: () => void }) {
  const [id, setId] = useState(options[0]?.value ?? '');
  const archive = useAction(() => workApi.archiveProject(id), { success: (r) => (r as { message?: string }).message ?? 'Project archived', invalidate: [workKeys.archive, workKeys.projects], onSuccess: onClose });
  return (
    <Modal
      title="Archive project"
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!id || archive.isPending} onClick={() => archive.mutate(undefined)}>Archive</button>
        </>
      }
    >
      {options.length ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="field">
            <label htmlFor="arch-p">Completed project</label>
            <select id="arch-p" className="input" value={id} onChange={(e) => setId(e.target.value)}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>The project becomes read-only; its documents move to the vault with “Leads only” access until you change it.</p>
        </div>
      ) : (
        <Empty>No completed projects to archive. Mark a project completed from its detail page first.</Empty>
      )}
    </Modal>
  );
}

function ArchiveDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: workKeys.archiveItem(id), queryFn: () => workApi.archiveItem(id) });
  const { toastError } = useToast();
  const [restore, setRestore] = useState(false);
  const inv = [workKeys.archiveItem(id), workKeys.archive];
  const access = useAction((a: string) => workApi.setArchiveAccess(id, a), { success: 'Archive access updated', invalidate: inv });
  const addDoc = useAction((d: { fileId: string; title?: string; kind: string }) => workApi.addArchiveDoc(id, d), { success: 'Document added to the archive', invalidate: inv });
  const unarchive = useAction(() => workApi.unarchiveProject(id), { success: 'Project restored to Completed', invalidate: [...inv, workKeys.projects], onSuccess: onClose });
  const d = q.data;
  const dl = (doc: ProjectDocumentRow) => void download(`/archive/${id}/documents/${doc.id}/download`, doc.title).catch(toastError);
  return (
    <Drawer onClose={onClose} label="Archived project">
      {q.isLoading ? (
        <Loading />
      ) : q.error || !d ? (
        <ErrorBlock error={q.error} />
      ) : (
        <>
          <div className="wk-drawer-head">
            <div>
              <div className="kicker">{d.key} · {d.clientName} · closed {d.closedLabel}</div>
              <h3 className="serif" style={{ margin: '4px 0 0', fontSize: 22 }}>{d.name}</h3>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
          </div>
          {d.description && <p style={{ margin: 0, fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{d.description}</p>}
          <div className="wk-kv">
            <span>Project lead</span><span>{d.leadName ?? '—'}</span>
            <span>Category</span><span>{humanize(d.category)}</span>
            <span>Tech</span><span>{d.techStack.join(', ') || '—'}</span>
            <span>Estimated vs logged</span><span>{hours(d.estimatedMinutes, '0h')} / {hours(d.loggedMinutes, '0h')}</span>
            <span>Closed</span><span>{d.closedAt ? formatDate(d.closedAt) : d.closedLabel}</span>
            <span>Modules</span><span>{d.modules.join(', ') || '—'}</span>
            <span>Team</span><span>{d.members.map((m) => `${m.name} (${humanize(m.role)})`).join(', ') || '—'}</span>
            <span>Tasks</span><span>{Object.entries(d.tasksByStatus).map(([s, n]) => `${TASK_STATUS_LABELS[s as TaskStatusKey] ?? s} ${n}`).join(' · ') || '—'}</span>
            <span>Access</span>
            {d.canManage ? (
              <select className="input" value={d.archiveAccess} onChange={(e) => access.mutate(e.target.value)}>
                {ARCHIVE_ACCESS.map((a) => <option key={a} value={a}>{ARCHIVE_ACCESS_LABELS[a]}</option>)}
              </select>
            ) : (
              <span>{ARCHIVE_ACCESS_LABELS[d.archiveAccess as keyof typeof ARCHIVE_ACCESS_LABELS]}</span>
            )}
          </div>
          <div>
            <div className="wk-section-title">Project documents · {d.projectDocuments.length}</div>
            <DocList docs={d.projectDocuments} onDownload={dl} />
            {d.canManage && <div style={{ marginTop: 8 }}><DocumentsList docs={[]} emptyText="" onUpload={(x) => addDoc.mutateAsync(x)} /></div>}
          </div>
          <div>
            <div className="wk-section-title">Client vault · {d.clientDocuments.length}</div>
            <DocList docs={d.clientDocuments} onDownload={dl} />
          </div>
          {d.canManage && (
            <div className="row">
              <button className="btn btn-secondary" onClick={() => setRestore(true)}>Restore to Completed</button>
            </div>
          )}
          {restore && <ConfirmDialog title={`Restore ${d.name}?`} body="The project leaves the archive and becomes editable again." onClose={() => setRestore(false)} onConfirm={() => unarchive.mutate(undefined)} />}
        </>
      )}
    </Drawer>
  );
}

function DocList({ docs, onDownload }: { docs: ProjectDocumentRow[]; onDownload: (d: ProjectDocumentRow) => void }) {
  if (!docs.length) return <div className="faint" style={{ fontSize: 13 }}>No documents.</div>;
  return (
    <div>
      {docs.map((doc) => (
        <div key={doc.id} className="list-row" style={{ alignItems: 'center' }}>
          <div>
            <div>{doc.title}</div>
            <div className="faint" style={{ fontSize: 12 }}>{humanize(doc.kind)} · {formatDate(doc.createdAt)}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => onDownload(doc)}>Download</button>
        </div>
      ))}
    </div>
  );
}
