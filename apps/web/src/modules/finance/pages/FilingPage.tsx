import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatINR, type FilingDocumentRow, type FilingFolderTile, type FinComplianceItem, type FinGstReturnRow, type FinGstReturnStatus } from '@lexisora/shared';
import { Card, ConfirmDialog, ErrorBlock, Loading, Modal, PageHeader, Tag, type Tone } from '@/components/ui';
import { DataTable, Pager, type Column } from '@/components/table';
import { FormModal } from '@/components/form';
import { uploadFile } from '@/lib/api';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { FIN_ALL, finApi, finKeys, fmtBytes, todayKey } from '../api';
import { ChipsInput, DocFrame, errorText, Field, MultiFileDrop, Section, useParamState } from '../components';
import '../finance.css';

const PAGE_SIZE = 25;
const COMPLIANCE_TONE: Record<FinComplianceItem['status'], Tone> = { FILED: 'accent', OVERDUE: 'danger', DUE_SOON: 'outline', UPCOMING: 'neutral' };
const COMPLIANCE_LABEL: Record<FinComplianceItem['status'], string> = { FILED: 'Filed', OVERDUE: 'Overdue', DUE_SOON: 'Due soon', UPCOMING: 'Upcoming' };
const RETURN_TONE: Record<FinGstReturnStatus['status'], Tone> = { FILED: 'accent', OVERDUE: 'danger', DUE: 'outline', OPEN: 'neutral' };
const RETURN_LABEL: Record<FinGstReturnStatus['status'], string> = { FILED: 'Filed', OVERDUE: 'Overdue', DUE: 'Due', OPEN: 'Open' };
const LINK_LABEL: Record<string, string> = { PURCHASE: 'Purchase', INVOICE: 'Invoice', GST_RETURN: 'GST return' };

/** Filing cabinet (GEN.filing): compliance calendar, folder tiles, folder view, search, upload. */
export default function FilingPage() {
  const [folderId, setFolderId] = useParamState('folder');
  const [q, setQ] = useParamState('q');
  const [upload, setUpload] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const tiles = useQuery({ queryKey: finKeys.folders, queryFn: finApi.folders });
  const all = tiles.data?.all ?? [];
  const qc = useQueryClient();
  const { toast } = useToast();
  return (
    <div data-screen-label="Filing cabinet" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Filing cabinet"
        sub="Folders for bills, tax documents, vendor receipts and corporate files."
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setNewFolder(true)}>New folder</button>
            <button className="btn btn-primary" onClick={() => setUpload(true)}>Upload</button>
          </>
        }
      />
      <div className="fin-toolbar">
        <input className="input grow" aria-label="Search documents" placeholder="Search all documents by name, tag or reference (e.g. INV-0412, gst, amazon)" value={q ?? ''} onChange={(e) => setQ(e.target.value || null)} />
      </div>
      {q && !folderId ? (
        <SearchResults q={q} onOpenFolder={(id) => (setQ(null), setFolderId(id))} />
      ) : folderId ? (
        <FolderView id={folderId} q={q ?? ''} onOpenFolder={setFolderId} onBack={() => setFolderId(null)} />
      ) : (
        <>
          <ComplianceCard />
          {tiles.error ? (
            <ErrorBlock error={tiles.error} retry={() => void tiles.refetch()} />
          ) : !tiles.data ? (
            <Loading />
          ) : (
            <FolderTiles folders={tiles.data.folders} onOpen={setFolderId} />
          )}
        </>
      )}
      {upload && <UploadDialog folders={all} defaultFolderId={folderId} onClose={() => setUpload(false)} />}
      {newFolder && (
        <FormModal
          title="New folder"
          fields={[
            { name: 'name', label: 'Folder name', type: 'text', required: true },
            { name: 'parentId', label: 'Inside', type: 'select', options: all.map((f) => ({ value: f.id, label: folderPath(f, all) })), placeholder: 'Filing cabinet (top level)' },
          ]}
          submitLabel="Create"
          initial={{ parentId: folderId ?? '' }}
          onSubmit={async (v) => {
            const r = await finApi.createFolder(v.name, v.parentId || null);
            void qc.invalidateQueries({ queryKey: ['finance', 'filing'] });
            toast('Folder created');
            setFolderId(r.id);
          }}
          onClose={() => setNewFolder(false)}
        />
      )}
    </div>
  );
}

function folderPath(f: FilingFolderTile, all: FilingFolderTile[]): string {
  const names = [f.name];
  let p = f.parentId ? all.find((x) => x.id === f.parentId) : undefined;
  for (let i = 0; p && i < 8; i++) {
    names.unshift(p.name);
    p = p.parentId ? all.find((x) => x.id === p!.parentId) : undefined;
  }
  return names.join(' › ');
}

function FolderTiles({ folders, onOpen }: { folders: FilingFolderTile[]; onOpen: (id: string) => void }) {
  if (!folders.length) return <div className="fin-muted">No folders yet.</div>;
  return (
    <div className="fin-tiles">
      {folders.map((f) => (
        <button key={f.id} className="card fin-tile" onClick={() => onOpen(f.id)}>
          <div className="card-kicker">Folder</div>
          <div className="card-title">{f.name}</div>
          <div className="card-body">{f.files} {f.files === 1 ? 'file' : 'files'}</div>
        </button>
      ))}
    </div>
  );
}

// ── Compliance calendar ──────────────────────────────────────────────────────

function ComplianceCard() {
  const q = useQuery({ queryKey: finKeys.compliance, queryFn: finApi.compliance });
  const [filing, setFiling] = useState<FinComplianceItem | null>(null);
  const unfile = useAction((i: FinComplianceItem) => finApi.unmarkFiled(i.form, i.period), { success: 'Marked as not filed', invalidate: FIN_ALL });
  const items = (q.data ?? []).slice(0, 8);
  return (
    <Card kicker="Compliance calendar" title="Upcoming statutory due dates">
      {q.error ? (
        <ErrorBlock error={q.error} />
      ) : !q.data ? (
        <Loading />
      ) : !items.length ? (
        <div className="fin-muted fin-small">Nothing due in the next weeks.</div>
      ) : (
        <div className="fin-cal">
          {items.map((i) => (
            <div key={i.key} className="fin-cal-row">
              <span className="fin-cal-date">{formatDate(i.dueDate)}</span>
              <span>
                {i.label} · {i.periodLabel}
                {i.ref && <span className="fin-muted fin-small"> · {i.ref}</span>}
              </span>
              <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                <Tag tone={COMPLIANCE_TONE[i.status]}>
                  {i.status === 'FILED' ? `Filed ${i.filedOn ? formatDate(i.filedOn) : ''}` : i.status === 'OVERDUE' ? `${COMPLIANCE_LABEL[i.status]} · ${-i.daysLeft}d` : i.daysLeft === 0 ? 'Due today' : `${COMPLIANCE_LABEL[i.status]} · ${i.daysLeft}d`}
                </Tag>
                {i.status === 'FILED' ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => unfile.mutate(i)}>Undo</button>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => setFiling(i)}>Mark filed</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {filing && <MarkFiledDialog form={filing.form} period={filing.period} label={`${filing.label} · ${filing.periodLabel}`} onClose={() => setFiling(null)} />}
    </Card>
  );
}

function MarkFiledDialog({ form, period, label, onClose }: { form: FinComplianceItem['form']; period: string; label: string; onClose: () => void }) {
  const [ref, setRef] = useState('');
  const [filedOn, setFiledOn] = useState(todayKey());
  const save = useAction(() => finApi.markFiled({ form, period, ref: ref.trim() || null, filedOn }), { success: `${label} marked filed`, invalidate: FIN_ALL, onSuccess: onClose });
  return (
    <Modal
      title={`Mark filed · ${label}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!filedOn || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending ? 'Saving…' : 'Mark filed'}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="ARN / challan / acknowledgement no." htmlFor="mf-ref">
          <input id="mf-ref" className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. AA2409260012345" />
        </Field>
        <Field label="Filed on" htmlFor="mf-date">
          <input id="mf-date" type="date" className="input" max={todayKey()} value={filedOn} onChange={(e) => setFiledOn(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────

function useDocColumns(onPreview: (d: FilingDocumentRow) => void, onEdit: (d: FilingDocumentRow) => void, onDelete: (d: FilingDocumentRow) => void, showFolder: boolean): Column<FilingDocumentRow>[] {
  const navigate = useNavigate();
  const link = (d: FilingDocumentRow) => {
    if (d.linkedEntityType === 'INVOICE' && d.linkedEntityId) return () => navigate(`/invoices?open=${d.linkedEntityId}`);
    if (d.linkedEntityType === 'PURCHASE' && d.linkedEntityId) return () => navigate(`/purchases?open=${d.linkedEntityId}`);
    return null;
  };
  return [
    {
      key: 'name',
      header: 'Name',
      render: (d) => (
        <div>
          <button
            className="fin-link"
            style={{ textAlign: 'left' }}
            onClick={(e) => {
              e.stopPropagation();
              onPreview(d);
            }}
          >
            {d.title}
          </button>
          {showFolder && <div className="fin-muted fin-small">{d.folderName}</div>}
        </div>
      ),
    },
    { key: 'tags', header: 'Tags', render: (d) => <span className="row" style={{ gap: 4 }}>{d.tags.slice(0, 4).map((t) => <Tag key={t} tone="neutral">{t}</Tag>)}</span> },
    { key: 'fy', header: 'FY', render: (d) => d.fy ?? '—' },
    { key: 'date', header: 'Date', render: (d) => formatDate(d.docDate ?? d.uploadedAt) },
    { key: 'by', header: 'Uploaded by', render: (d) => d.uploadedByName ?? '—' },
    { key: 'size', header: 'Size', num: true, render: (d) => fmtBytes(d.sizeBytes) },
    {
      key: 'linked',
      header: 'Linked to',
      render: (d) => {
        if (!d.linkedEntityType) return '—';
        const go = link(d);
        const text = `${LINK_LABEL[d.linkedEntityType] ?? d.linkedEntityType} ${d.linkedRef ?? ''}`.trim();
        return go ? (
          <button
            className="fin-link"
            onClick={(e) => {
              e.stopPropagation();
              go();
            }}
          >
            {text}
          </button>
        ) : (
          text
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: (d) => (
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-ghost btn-sm" onClick={() => void finApi.downloadDoc(d.id)}>Download</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(d)}>Edit</button>
          <button className="btn btn-ghost btn-sm" disabled={d.locked} title={d.locked ? 'Linked to a posted record — kept for 8 years (GST record retention)' : undefined} onClick={() => onDelete(d)}>Delete</button>
        </span>
      ),
    },
  ];
}

function useDocActions() {
  const [preview, setPreview] = useState<FilingDocumentRow | null>(null);
  const [edit, setEdit] = useState<FilingDocumentRow | null>(null);
  const [del, setDel] = useState<FilingDocumentRow | null>(null);
  const remove = useAction((id: string) => finApi.deleteDoc(id), { success: 'Document deleted', invalidate: FIN_ALL, onSuccess: () => setDel(null) });
  const dialogs = (folders: FilingFolderTile[]) => (
    <>
      {preview && (
        <Modal
          wide
          title={preview.title}
          onClose={() => setPreview(null)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setPreview(null)}>Close</button>
              <button className="btn btn-primary" onClick={() => void finApi.downloadDoc(preview.id)}>Download</button>
            </>
          }
        >
          {/^(application\/pdf|image\/)/.test(preview.mime) ? <DocFrame src={finApi.docUrl(preview.id)} title={preview.title} /> : <div className="placeholder-media">No preview for this file type — download it to open.</div>}
        </Modal>
      )}
      {edit && <EditDocDialog doc={edit} folders={folders} onClose={() => setEdit(null)} />}
      {del && (
        <ConfirmDialog
          title={`Delete ${del.title}?`}
          body="The document is removed from the filing cabinet (kept in the audit trail)."
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(del.id)}
          onClose={() => setDel(null)}
        />
      )}
    </>
  );
  return { setPreview, setEdit, setDel, dialogs };
}

function FolderView({ id, q, onOpenFolder, onBack }: { id: string; q: string; onOpenFolder: (id: string) => void; onBack: () => void }) {
  const [tag, setTag] = useState('');
  const [fy, setFy] = useState('');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const { toast } = useToast();
  const query = { q: q.trim() || undefined, tag: tag || undefined, fy: fy || undefined, page, pageSize: PAGE_SIZE };
  const f = useQuery({ queryKey: finKeys.folder(id, query), queryFn: () => finApi.folder(id, query), placeholderData: keepPreviousData });
  const tiles = useQuery({ queryKey: finKeys.folders, queryFn: finApi.folders });
  const actions = useDocActions();
  const columns = useDocColumns(actions.setPreview, actions.setEdit, actions.setDel, false);
  const [deleting, setDeleting] = useState(false);
  const d = f.data;
  if (f.error) return <ErrorBlock error={f.error} retry={() => void f.refetch()} />;
  if (!d) return <Loading />;
  const canDelete = !d.folder.isSystem && d.folder.files === 0 && d.subfolders.length === 0;
  return (
    <div className="stack" style={{ gap: 14 }} data-screen-label="Filing folder">
      <div className="fin-crumbs">
        <button onClick={onBack}>Filing cabinet</button>
        {d.breadcrumb.map((b, i) => (
          <span key={b.id} className="row" style={{ gap: 6 }}>
            <span className="fin-muted">›</span>
            {i === d.breadcrumb.length - 1 ? <strong>{b.name}</strong> : <button onClick={() => onOpenFolder(b.id)}>{b.name}</button>}
          </span>
        ))}
        <span className="spacer" style={{ flex: 1 }} />
        {canDelete && <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(true)}>Delete folder</button>}
      </div>
      {d.folder.systemKey === 'GST_RETURNS' && <GstReturnsCard />}
      {d.subfolders.length > 0 && <FolderTiles folders={d.subfolders} onOpen={onOpenFolder} />}
      <div className="fin-toolbar">
        <select className="input" aria-label="Tag" value={tag} onChange={(e) => (setTag(e.target.value), setPage(1))}>
          <option value="">All tags</option>
          {d.tags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className="input" aria-label="Financial year" value={fy} onChange={(e) => (setFy(e.target.value), setPage(1))}>
          <option value="">All years</option>
          {d.fys.map((y) => (
            <option key={y} value={y}>FY {y}</option>
          ))}
        </select>
        <span className="fin-muted fin-small">{d.total} {d.total === 1 ? 'document' : 'documents'} here{d.folder.files !== d.total && !q && !tag && !fy ? ` · ${d.folder.files} incl. subfolders` : ''}</span>
      </div>
      <DataTable columns={columns} rows={d.documents} rowKey={(r) => r.id} onRowClick={actions.setPreview} empty={q || tag || fy ? 'No documents match.' : 'This folder is empty. Upload documents into it.'} />
      <Pager page={page} pageSize={PAGE_SIZE} total={d.total} onPage={setPage} />
      {actions.dialogs(tiles.data?.all ?? [])}
      {deleting && (
        <ConfirmDialog
          title={`Delete the ${d.folder.name} folder?`}
          confirmLabel="Delete folder"
          danger
          onConfirm={async () => {
            try {
              await finApi.deleteFolder(id);
              void qc.invalidateQueries({ queryKey: ['finance', 'filing'] });
              toast('Folder deleted');
              setDeleting(false);
              onBack();
            } catch (e) {
              toast(errorText(e));
            }
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

function SearchResults({ q, onOpenFolder }: { q: string; onOpenFolder: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const query = { q, page, pageSize: PAGE_SIZE };
  const r = useQuery({ queryKey: finKeys.docSearch(query), queryFn: () => finApi.searchDocs(query), placeholderData: keepPreviousData });
  const tiles = useQuery({ queryKey: finKeys.folders, queryFn: finApi.folders });
  const actions = useDocActions();
  const columns = useDocColumns(actions.setPreview, actions.setEdit, actions.setDel, true);
  return (
    <div className="stack" style={{ gap: 12 }}>
      {r.error ? (
        <ErrorBlock error={r.error} retry={() => void r.refetch()} />
      ) : (
        <DataTable columns={columns} rows={r.data?.items} rowKey={(d) => d.id} onRowClick={(d) => onOpenFolder(d.folderId)} loading={r.isLoading} empty={`No documents match “${q}”.`} />
      )}
      {r.data && <Pager page={page} pageSize={PAGE_SIZE} total={r.data.total} onPage={setPage} />}
      {actions.dialogs(tiles.data?.all ?? [])}
    </div>
  );
}

function EditDocDialog({ doc, folders, onClose }: { doc: FilingDocumentRow; folders: FilingFolderTile[]; onClose: () => void }) {
  const [title, setTitle] = useState(doc.title);
  const [tags, setTags] = useState<string[]>(doc.tags);
  const [folderId, setFolderId] = useState(doc.folderId);
  const save = useAction(() => finApi.updateDoc(doc.id, { title: title.trim(), tags, folderId }), { success: 'Saved', invalidate: FIN_ALL, onSuccess: onClose });
  return (
    <Modal
      title="Edit document"
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!title.trim() || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field span2 label="Name" htmlFor="doc-title">
          <input id="doc-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field span2 label="Tags" htmlFor="doc-tags">
          <ChipsInput id="doc-tags" value={tags} onChange={setTags} lower placeholder="Add tags" />
        </Field>
        <Field span2 label="Folder" htmlFor="doc-folder" hint={doc.locked ? 'Linked documents can be moved but not deleted' : undefined}>
          <select id="doc-folder" className="input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{folderPath(f, folders)}</option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

// ── Upload (FORMS.upload) ────────────────────────────────────────────────────

function UploadDialog({ folders, defaultFolderId, onClose }: { folders: FilingFolderTile[]; defaultFolderId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const ordered = useMemo(() => [...folders].sort((a, b) => folderPath(a, folders).localeCompare(folderPath(b, folders))), [folders]);
  const [folderId, setFolderId] = useState(defaultFolderId ?? ordered.find((f) => f.systemKey === 'BILLS')?.id ?? ordered[0]?.id ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [docDate, setDocDate] = useState(todayKey());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!folderId) return setErr('Pick a folder');
    if (!files.length) return setErr('Add at least one file');
    setBusy(true);
    setErr(null);
    try {
      const ids: string[] = [];
      for (const f of files) ids.push((await uploadFile(f, 'filing')).id);
      await finApi.uploadDocs({ folderId, fileIds: ids, tags, docDate: docDate || null });
      void qc.invalidateQueries({ queryKey: ['finance', 'filing'] });
      toast('Uploaded');
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Upload document"
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Uploading…' : 'Upload'}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field span2 label="Folder / category" htmlFor="up-folder">
          <select id="up-folder" className="input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            {ordered.map((f) => (
              <option key={f.id} value={f.id}>{folderPath(f, folders)}</option>
            ))}
          </select>
        </Field>
        <Field span2 label="File">
          <MultiFileDrop files={files} onFiles={setFiles} accept="application/pdf,image/*,.csv,.txt,.zip,.doc,.docx,.xls,.xlsx" />
        </Field>
        <Field span2 label="Tags" htmlFor="up-tags" hint="Press Enter or comma after each tag">
          <ChipsInput id="up-tags" value={tags} onChange={setTags} lower placeholder="e.g. gst, fy 2026-27, amazon" />
        </Field>
        <Field label="Document date" htmlFor="up-date" hint="Sets the financial year">
          <input id="up-date" type="date" className="input" max={todayKey()} value={docDate} onChange={(e) => setDocDate(e.target.value)} />
        </Field>
      </div>
      {err && <div className="field-error" role="alert">{err}</div>}
    </Modal>
  );
}

// ── GST returns register (inside the GST returns folder) ─────────────────────

function GstReturnsCard() {
  const q = useQuery({ queryKey: finKeys.gstReturns, queryFn: finApi.gstReturns });
  const prepare = useAction((period: string) => finApi.fileGstr3b(period), { success: (r) => `GSTR-3B working saved · ${r.title}`, invalidate: FIN_ALL });
  const [mark, setMark] = useState<{ form: 'GSTR1' | 'GSTR3B'; row: FinGstReturnRow } | null>(null);
  const statusTag = (s: FinGstReturnStatus) => (
    <Tag tone={RETURN_TONE[s.status]} title={s.ref ? `ARN ${s.ref}` : `Due ${formatDate(s.dueDate)}`}>
      {s.status === 'FILED' ? `Filed ${s.filedOn ? formatDate(s.filedOn) : ''}` : `${RETURN_LABEL[s.status]} · ${formatDate(s.dueDate)}`}
    </Tag>
  );
  return (
    <Card kicker="Returns" title="GST returns">
      <Section title="GSTR-1 and GSTR-3B by period">
        {q.error ? (
          <ErrorBlock error={q.error} />
        ) : !q.data ? (
          <Loading />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="fin-lines">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>GSTR-1</th>
                  <th>GSTR-3B</th>
                  <th className="num">Output tax</th>
                  <th className="num">ITC</th>
                  <th className="num">Net payable</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.period}>
                    <td>
                      {r.periodLabel}
                      <div className="fin-muted fin-small">{r.invoices} invoices · {r.bills} bills</div>
                    </td>
                    <td>{statusTag(r.gstr1)}</td>
                    <td>{statusTag(r.gstr3b)}</td>
                    <td className="num">{formatINR(r.outputTaxPaise)}</td>
                    <td className="num">{formatINR(r.itcPaise)}</td>
                    <td className="num">{formatINR(r.netPayablePaise)}</td>
                    <td className="num">
                      <span className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" disabled={prepare.isPending} onClick={() => prepare.mutate(r.period)}>{r.workingDocumentId ? 'Re-prepare' : 'Prepare'}</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => void finApi.gstr3bCsv(r.period)}>CSV</button>
                        {r.gstr1.status !== 'FILED' && <button className="btn btn-ghost btn-sm" onClick={() => setMark({ form: 'GSTR1', row: r })}>GSTR-1 filed</button>}
                        {r.gstr3b.status !== 'FILED' && <button className="btn btn-ghost btn-sm" onClick={() => setMark({ form: 'GSTR3B', row: r })}>3B filed</button>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {mark && <MarkFiledDialog form={mark.form} period={mark.row.period} label={`${mark.form === 'GSTR1' ? 'GSTR-1' : 'GSTR-3B'} · ${mark.row.periodLabel}`} onClose={() => setMark(null)} />}
    </Card>
  );
}
