import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CLIENT_GST_REG_TYPES, CLIENT_GST_STATES, PROJECT_STATUS_LABELS, formatINR, type ClientDetail, type ClientRow } from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef } from '@/components/form';
import { DataTable, Pager, type Column } from '@/components/table';
import { ConfirmDialog, ErrorBlock, Loading, PageHeader, StatusTag, Tabs, Tag, humanize } from '@/components/ui';
import { workApi, workKeys } from '../api';
import { Drawer, DocumentsList } from '../components';
import '../work.css';

type Status = 'ALL' | 'ACTIVE' | 'INACTIVE';

export default function ClientsPage() {
  const [status, setStatus] = useState<Status>('ALL');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ClientRow | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: [...workKeys.clients, status, q, page], queryFn: () => workApi.clients({ status, q: q || undefined, page, pageSize: 25 }) });
  const c = list.data?.counts;
  const columns: Column<ClientRow>[] = [
    { key: 'n', header: 'Client', render: (r) => <div><div>{r.name}</div><div className="faint" style={{ fontSize: 11.5 }}>{r.code}{r.legalName ? ` · ${r.legalName}` : ''}</div></div> },
    { key: 'g', header: 'GSTIN', render: (r) => (r.isInternal ? <Tag>Internal</Tag> : r.gstin ?? <span className="faint">{humanize(r.gstRegType)}</span>) },
    { key: 's', header: 'State', render: (r) => r.stateName ?? (r.countryCode !== 'IN' ? r.countryCode : '—') },
    { key: 'e', header: 'Billing emails', render: (r) => (r.billingEmails.length ? r.billingEmails.join(', ') : '—') },
    { key: 'r', header: 'Rate / hour', num: true, render: (r) => (r.defaultRatePerHourPaise != null ? formatINR(r.defaultRatePerHourPaise) : '—') },
    { key: 'p', header: 'Projects', num: true, render: (r) => `${r.activeProjects} / ${r.totalProjects}` },
    { key: 'st', header: 'Status', render: (r) => <StatusTag status={r.status} /> },
  ];
  return (
    <div data-screen-label="Clients" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Clients"
        sub="Client master for projects and GST invoices: legal name, GSTIN, place of supply, billing emails and default hourly rate."
        actions={<button className="btn btn-primary" onClick={() => setEditing('new')}>Add client</button>}
      />
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Tabs<Status>
          value={status}
          onChange={(s) => { setStatus(s); setPage(1); }}
          tabs={[
            { value: 'ALL', label: `All${c ? ` · ${c.ALL}` : ''}` },
            { value: 'ACTIVE', label: `Active${c ? ` · ${c.ACTIVE}` : ''}` },
            { value: 'INACTIVE', label: `Inactive${c ? ` · ${c.INACTIVE}` : ''}` },
          ]}
        />
        <input className="input wk-search" placeholder="Search name, code or GSTIN" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      {list.error ? <ErrorBlock error={list.error} retry={() => void list.refetch()} /> : <DataTable columns={columns} rows={list.data?.items} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} empty="No clients yet." />}
      {list.data && <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      {editing && <ClientForm client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {openId && <ClientDrawer id={openId} onClose={() => setOpenId(null)} onEdit={(r) => setEditing(r)} />}
    </div>
  );
}

function ClientForm({ client, onClose }: { client: ClientRow | null; onClose: () => void }) {
  const save = useAction(
    (b: Record<string, unknown>) => (client ? workApi.updateClient(client.id, b) : workApi.createClient(b)),
    { success: (r) => (client ? 'Client updated' : 'Client added') + (r.warning ? ` · ${r.warning}` : ''), invalidate: [workKeys.clients, ['work', 'client'], ['lookups']] },
  );
  const fields: FieldDef[] = [
    { name: 'name', label: 'Client name', type: 'text', required: true },
    { name: 'legalName', label: 'Legal name', type: 'text' },
    { name: 'isInternal', label: 'Internal (non-billable, no GST)', type: 'checkbox', span: 2 },
    { name: 'gstRegType', label: 'GST registration', type: 'select', options: CLIENT_GST_REG_TYPES.map((t) => ({ value: t, label: humanize(t) })), required: true, showIf: (v) => !v.isInternal },
    { name: 'gstin', label: 'GSTIN', type: 'text', placeholder: '24ABCDE1234F1Z5', showIf: (v) => !v.isInternal && v.gstRegType !== 'UNREGISTERED' && v.gstRegType !== 'OVERSEAS' },
    { name: 'stateCode', label: 'State (place of supply)', type: 'select', options: CLIENT_GST_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` })), showIf: (v) => !v.isInternal && v.gstRegType !== 'OVERSEAS' },
    { name: 'pan', label: 'PAN', type: 'text', showIf: (v) => !v.isInternal },
    { name: 'address', label: 'Billing address', type: 'area', span: 2 },
    { name: 'city', label: 'City', type: 'text' },
    { name: 'pincode', label: 'PIN code', type: 'text' },
    { name: 'billingEmails', label: 'Billing emails', type: 'text', span: 2, placeholder: 'accounts@client.com, cfo@client.com', showIf: (v) => !v.isInternal },
    { name: 'rate', label: 'Default rate per hour (₹)', type: 'money', showIf: (v) => !v.isInternal },
    { name: 'paymentTermsDays', label: 'Payment terms (days)', type: 'number' },
    { name: 'contactName', label: 'Contact person', type: 'text' },
    { name: 'contactPhone', label: 'Contact phone', type: 'text' },
  ];
  return (
    <FormModal
      title={client ? `Edit ${client.name}` : 'Add client'}
      submitLabel={client ? 'Save' : 'Add client'}
      wide
      fields={fields}
      initial={
        client
          ? {
              ...client,
              billingEmails: client.billingEmails.join(', '),
              rate: client.defaultRatePerHourPaise != null ? String(client.defaultRatePerHourPaise / 100) : '',
              paymentTermsDays: String(client.paymentTermsDays),
            }
          : { gstRegType: 'REGULAR', paymentTermsDays: '15' }
      }
      onSubmit={(v) =>
        save.mutateAsync({
          name: v.name,
          legalName: v.legalName,
          isInternal: !!v.isInternal,
          gstRegType: v.isInternal ? 'UNREGISTERED' : v.gstRegType,
          gstin: v.isInternal ? null : v.gstin,
          stateCode: v.isInternal ? null : v.stateCode,
          countryCode: client?.countryCode ?? 'IN',
          pan: v.pan,
          address: v.address,
          city: v.city,
          pincode: v.pincode,
          billingEmails: v.isInternal ? [] : String(v.billingEmails ?? '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
          defaultRatePerHourPaise: v.isInternal ? null : (v.rate ?? null),
          paymentTermsDays: v.paymentTermsDays ?? 15,
          contactName: v.contactName,
          contactPhone: v.contactPhone,
        })
      }
      onClose={onClose}
    />
  );
}

function ClientDrawer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (r: ClientRow) => void }) {
  const q = useQuery({ queryKey: workKeys.client(id), queryFn: () => workApi.client(id) });
  const inv = [workKeys.client(id), workKeys.clients];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const setStatus = useAction((s: 'ACTIVE' | 'INACTIVE') => workApi.setClientStatus(id, s), { success: (_r, s) => (s === 'ACTIVE' ? 'Client reactivated' : 'Client deactivated'), invalidate: inv });
  const remove = useAction(() => workApi.removeClient(id), { success: 'Client deleted', invalidate: [workKeys.clients], onSuccess: onClose });
  const addDoc = useAction((d: { fileId: string; title?: string; kind: string }) => workApi.addClientDoc(id, d), { success: 'Added to client vault', invalidate: inv });
  const removeDoc = useAction((docId: string) => workApi.removeClientDoc(id, docId), { success: 'Document removed', invalidate: inv });
  const c: ClientDetail | undefined = q.data;
  return (
    <Drawer onClose={onClose} label="Client">
      {q.isLoading ? (
        <Loading />
      ) : q.error || !c ? (
        <ErrorBlock error={q.error} />
      ) : (
        <>
          <div className="wk-drawer-head">
            <div>
              <div className="kicker">{c.code}{c.isInternal ? ' · Internal' : ''}</div>
              <h3 className="serif" style={{ margin: '4px 0 0', fontSize: 22 }}>{c.name}</h3>
              {c.legalName && <div className="faint" style={{ fontSize: 13 }}>{c.legalName}</div>}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="wk-kv">
            <span>Status</span><span><StatusTag status={c.status} /></span>
            <span>GST</span><span>{c.isInternal ? 'Not applicable' : `${humanize(c.gstRegType)}${c.gstin ? ` · ${c.gstin}` : ''}`}</span>
            <span>Place of supply</span><span>{c.stateName ? `${c.stateCode} · ${c.stateName}` : '—'}</span>
            <span>PAN</span><span>{c.pan ?? '—'}</span>
            <span>Address</span><span>{[c.address, c.city, c.pincode].filter(Boolean).join(', ') || '—'}</span>
            <span>Billing emails</span><span>{c.billingEmails.join(', ') || '—'}</span>
            <span>Default rate</span><span>{c.defaultRatePerHourPaise != null ? `${formatINR(c.defaultRatePerHourPaise)} / hour` : '—'}</span>
            <span>Payment terms</span><span>{c.paymentTermsDays} days</span>
            <span>Contact</span><span>{[c.contactName, c.contactPhone].filter(Boolean).join(' · ') || '—'}</span>
          </div>
          <div>
            <div className="wk-section-title">Projects · {c.projects.length}</div>
            {c.projects.map((p) => (
              <div key={p.id} className="list-row">
                <Link to={p.status === 'ARCHIVED' ? '/archive' : `/projects/${p.id}`}>{p.name} · {p.key}</Link>
                <StatusTag status={p.status} label={PROJECT_STATUS_LABELS[p.status]} />
              </div>
            ))}
            {!c.projects.length && <div className="faint" style={{ fontSize: 13 }}>No projects yet.</div>}
          </div>
          <div>
            <div className="wk-section-title">Client vault (MSA, NDA, SOW)</div>
            <DocumentsList docs={c.vault} uploadCategory="client-vault" onUpload={(d) => addDoc.mutateAsync({ ...d, kind: d.kind === 'REQUIREMENT' ? 'CONTRACT' : d.kind })} onRemove={(d) => removeDoc.mutate(d.id)} removeClientDocs emptyText="No vault documents yet." />
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={() => onEdit(c)}>Edit</button>
            <button className="btn btn-secondary" onClick={() => setStatus.mutate(c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}>{c.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</button>
            {c.totalProjects === 0 && <button className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>Delete</button>}
          </div>
          {confirmDelete && <ConfirmDialog title={`Delete ${c.name}?`} body="Only clients without projects or invoices can be deleted." danger confirmLabel="Delete" onClose={() => setConfirmDelete(false)} onConfirm={() => remove.mutate(undefined)} />}
        </>
      )}
    </Drawer>
  );
}
