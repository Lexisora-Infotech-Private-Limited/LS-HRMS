import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DOC_CATEGORIES, DOC_CATEGORY_LABELS, VAULT_UPLOAD_TYPES, formatDate, type VaultRow } from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { FormModal } from '@/components/form';
import { DataTable, type Column } from '@/components/table';
import { ConfirmDialog, ErrorBlock, PageHeader, Pills } from '@/components/ui';
import { peopleApi, peopleKeys } from '../api';
import { DocStatus, openDoc } from '../components';
import '../people.css';

/** My digital vault — own documents by category with HR verification status. */
export default function VaultPage() {
  const [cat, setCat] = useState<string>('ALL');
  const [uploading, setUploading] = useState<null | { docType?: string }>(null);
  const [removing, setRemoving] = useState<VaultRow | null>(null);
  const q = useQuery({ queryKey: peopleKeys.vault, queryFn: () => peopleApi.vault() });
  const inv = [peopleKeys.vault, ['people', 'profile']];
  const up = useAction((b: Record<string, unknown>) => peopleApi.uploadVault(b as never), { success: 'Uploaded', invalidate: inv });
  const rm = useAction((r: VaultRow) => peopleApi.removeDoc(r.id), { success: (_x, r) => `${r.title} deleted`, invalidate: inv, onSuccess: () => setRemoving(null) });

  const present = new Set((q.data ?? []).map((d) => d.category));
  const cats = DOC_CATEGORIES.filter((c) => present.has(c));
  const rows = (q.data ?? []).filter((d) => cat === 'ALL' || d.category === cat);

  const cols: Column<VaultRow>[] = [
    {
      key: 'd',
      header: 'Document',
      render: (r) => (
        <div>
          <div>{r.title}{r.version > 1 && <span className="faint"> · v{r.version}</span>}</div>
          {r.status === 'REJECTED' && r.rejectionReason && <div className="pp-err">{r.rejectionReason}</div>}
        </div>
      ),
    },
    { key: 'c', header: 'Category', render: (r) => r.categoryLabel },
    { key: 'u', header: 'Uploaded', render: (r) => formatDate(r.uploadedAt) },
    { key: 's', header: 'Verified by HR', render: (r) => <DocStatus status={r.status} label={r.statusLabel} /> },
    {
      key: 'a',
      header: '',
      render: (r) => (
        <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-ghost btn-sm" onClick={() => openDoc(r.id)}>View</button>
          {r.status === 'REJECTED' && <button className="btn btn-secondary btn-sm" onClick={() => setUploading({ docType: r.docType })}>Re-upload</button>}
          {r.canDelete && <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(r)}>Delete</button>}
        </span>
      ),
    },
  ];

  return (
    <div data-screen-label="My digital vault" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="My digital vault"
        sub="Your personal documents, offer letter and compensation. Visible only to you and HR."
        actions={<button className="btn btn-primary" onClick={() => setUploading({})}>Upload document</button>}
      />
      {cats.length > 1 && (
        <Pills<string>
          value={cat}
          onChange={setCat}
          options={[{ value: 'ALL', label: `All · ${q.data?.length ?? 0}` }, ...cats.map((c) => ({ value: c, label: `${DOC_CATEGORY_LABELS[c]} · ${(q.data ?? []).filter((d) => d.category === c).length}` }))]}
        />
      )}
      {q.error ? <ErrorBlock error={q.error} retry={() => void q.refetch()} /> : <DataTable columns={cols} rows={q.data ? rows : undefined} loading={q.isLoading} rowKey={(r) => r.id} onRowClick={(r) => openDoc(r.id)} empty="No documents yet. Upload your PAN, Aadhaar and education documents." />}
      {uploading && (
        <FormModal
          title="Upload document"
          fields={[
            { name: 'docType', label: 'Folder / category', type: 'select', required: true, span: 2, options: VAULT_UPLOAD_TYPES },
            { name: 'fileId', label: 'File', type: 'file', required: true, category: 'vault', accept: '.pdf,image/*' },
            { name: 'title', label: 'Title', type: 'text', span: 2, placeholder: 'Defaults to the document type' },
            { name: 'tags', label: 'Tags', type: 'text', span: 2, placeholder: 'e.g. 2024, original' },
          ]}
          initial={uploading.docType ? { docType: uploading.docType } : undefined}
          submitLabel="Upload"
          intro={<span className="faint" style={{ fontSize: 12.5 }}>PDF, JPG or PNG up to 10 MB. Government ID and education documents are verified by HR.</span>}
          onClose={() => setUploading(null)}
          onSubmit={(v) => up.mutateAsync(v)}
        />
      )}
      {removing && (
        <ConfirmDialog title={`Delete ${removing.title}?`} body="The file is removed from your vault. HR keeps an audit record." danger confirmLabel="Delete" busy={rm.isPending} onClose={() => setRemoving(null)} onConfirm={() => rm.mutate(removing)} />
      )}
    </div>
  );
}
