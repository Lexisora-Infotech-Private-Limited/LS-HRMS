import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ASSET_CONDITION_LABELS, ASSET_CONDITIONS, ASSET_TABS, formatDate, formatINR, formatMonthYear, type AssetDetail, type AssetInput, type AssetRow } from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef, type FormValues } from '@/components/form';
import { DataTable, Pager, type Column } from '@/components/table';
import { ErrorBlock, Kpis, Loading, Modal, PageHeader, Tabs, Tag, type Tone } from '@/components/ui';
import { lookupsFor, peopleApi, peopleKeys, type AssetTab } from '../api';
import { todayKey } from '../components';
import { PromptModal } from '../recruitment';
import '../people.css';

const TAB_LABELS: Record<AssetTab, string> = { all: 'All', assigned: 'Assigned', in_stock: 'In stock', under_repair: 'Under repair', returned: 'Returned' };
const CONDITIONS = ASSET_CONDITIONS.map((c) => ({ value: c, label: ASSET_CONDITION_LABELS[c] }));

/** Wireframe tones: Assigned "~" accent, In stock "-" neutral, repair/returned/expired "!" outline. */
export function assetTone(r: Pick<AssetRow, 'status' | 'warrantyExpired'>): Tone {
  if (r.warrantyExpired) return 'outline';
  if (r.status === 'ASSIGNED') return 'accent';
  if (r.status === 'UNDER_REPAIR' || r.status === 'RETURNED') return 'outline';
  return 'neutral';
}

export default function AssetsPage() {
  const [tab, setTab] = useState<AssetTab>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [categories, setCategories] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: [...peopleKeys.assets, tab, q, page], queryFn: () => peopleApi.assets({ tab, q: q || undefined, page, pageSize: 50 }), placeholderData: (p) => p });
  const c = list.data?.counts;
  const k = list.data?.kpis;

  const columns: Column<AssetRow>[] = [
    { key: 'i', header: 'Item', render: (r) => <div><div>{r.item}</div><div className="pp-sub">{r.assetTag}{r.category ? ` · ${r.category}` : ''}</div></div> },
    { key: 's', header: 'Serial no.', render: (r) => <span className="tnum">{r.serialNo ?? '—'}</span> },
    { key: 'a', header: 'Assigned to', render: (r) => r.assignedTo ?? '—' },
    { key: 'o', header: 'Assigned on', render: (r) => (r.assignedOn ? formatDate(r.assignedOn) : '—') },
    {
      key: 'w',
      header: 'Warranty till',
      render: (r) => (
        <span>
          {r.warrantyTill ? formatMonthYear(r.warrantyTill) : '—'}
          {r.warrantyExpiringSoon && <span className="pp-warn"> · expiring in 30d</span>}
        </span>
      ),
    },
    { key: 'st', header: 'Status', render: (r) => <Tag tone={assetTone(r)}>{r.displayStatus}</Tag> },
  ];

  return (
    <div data-screen-label="Assets & inventory" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Assets & inventory"
        sub="Every item issued to employees with serial numbers, warranty and return status."
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setCategories(true)}>Categories</button>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>Add asset</button>
          </>
        }
      />
      <Kpis
        items={[
          { label: 'Total', value: k ? k.total : '—', sub: 'Excluding disposed' },
          { label: 'Assigned', value: k ? k.assigned : '—', sub: 'With employees' },
          { label: 'In stock', value: k ? k.inStock : '—', sub: 'Ready to issue' },
          { label: 'Warranty ≤ 30 days', value: k ? k.expiring30 : '—', sub: 'Renew or plan replacement' },
        ]}
      />
      <div className="row-between" style={{ gap: 10 }}>
        <Tabs<AssetTab>
          value={tab}
          onChange={(t) => {
            setTab(t);
            setPage(1);
          }}
          tabs={ASSET_TABS.map((t) => ({ value: t, label: `${TAB_LABELS[t]}${c && (t === 'all' || c[t]) ? ` · ${c[t]}` : ''}` }))}
        />
        <input
          className="input pp-search"
          placeholder="Search item, serial, tag or person"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={columns} rows={list.data?.items} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} empty={q ? `Nothing matches “${q}”.` : 'No assets in this tab.'} />
      )}
      {list.data && <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      {adding && <AssetFormModal onClose={() => setAdding(false)} />}
      {categories && <CategoriesModal onClose={() => setCategories(false)} />}
      {openId && <AssetDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** FORMS.asset (+ category, make/model, purchase, vendor, condition). */
function AssetFormModal({ asset, onClose }: { asset?: AssetDetail; onClose: () => void }) {
  const lk = useQuery({ queryKey: ['lookups', 'people', 'asset-form'], queryFn: () => lookupsFor(['assetCategories', 'employees', 'branches']) });
  const save = useAction((b: AssetInput) => peopleApi.saveAsset(asset?.id ?? null, b), {
    success: (r) => (asset ? 'Asset updated' : r.assignedTo ? `${r.item} added · assigned to ${r.assignedTo}` : `${r.item} added to stock`),
    invalidate: [peopleKeys.assets, ['people', 'profile']],
  });
  if (lk.isLoading) return null;
  const d = lk.data ?? {};
  const fields: FieldDef[] = [
    { name: 'name', label: 'Item', type: 'text', span: 2, required: true, placeholder: 'Dell Latitude 5440' },
    { name: 'serialNo', label: 'Serial no.', type: 'text' },
    { name: 'warrantyTill', label: 'Warranty till', type: 'date' },
    ...(asset
      ? []
      : ([
          { name: 'assignToId', label: 'Assign to', type: 'select', options: d.employees ?? [], placeholder: 'Keep in stock' },
          { name: 'assignedOn', label: 'Assigned on', type: 'date', showIf: (v) => !!v.assignToId },
        ] as FieldDef[])),
    { name: 'categoryId', label: 'Category', type: 'select', options: d.assetCategories ?? [] },
    { name: 'condition', label: 'Condition', type: 'select', required: true, options: CONDITIONS },
    { name: 'make', label: 'Make', type: 'text', placeholder: 'Dell' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Latitude 5440' },
    { name: 'purchaseDate', label: 'Purchase date', type: 'date' },
    { name: 'purchaseCostPaise', label: 'Purchase cost (₹)', type: 'money' },
    { name: 'vendor', label: 'Vendor', type: 'text' },
    { name: 'branchId', label: 'Branch', type: 'select', options: d.branches ?? [] },
    { name: 'notes', label: 'Notes', type: 'area' },
  ];
  const initial: FormValues = asset
    ? {
        name: asset.item,
        serialNo: asset.serialNo ?? '',
        warrantyTill: asset.warrantyTill ?? '',
        categoryId: (d.assetCategories ?? []).find((o) => o.label === asset.category)?.value ?? '',
        condition: asset.condition,
        make: asset.make ?? '',
        model: asset.model ?? '',
        purchaseDate: asset.purchaseDate ?? '',
        purchaseCostPaise: asset.purchaseCostPaise != null ? String(asset.purchaseCostPaise / 100) : '',
        vendor: asset.vendor ?? '',
        notes: asset.notes ?? '',
      }
    : { condition: 'NEW', assignedOn: todayKey(), categoryId: d.assetCategories?.[0]?.value ?? '' };
  return (
    <FormModal
      title={asset ? `Edit ${asset.item}` : 'Add asset'}
      fields={fields}
      initial={initial}
      wide
      onClose={onClose}
      onSubmit={(v) => {
        const b = { ...v } as AssetInput & Record<string, unknown>;
        if (!b.assignToId) b.assignedOn = null;
        return save.mutateAsync(b);
      }}
    />
  );
}

function AssetDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: [...peopleKeys.assets, 'detail', id], queryFn: () => peopleApi.asset(id) });
  const [dialog, setDialog] = useState<null | 'edit' | 'assign' | 'return' | 'repair' | 'repairDone' | 'lost'>(null);
  const inv = [peopleKeys.assets, ['people', 'profile']];
  const assign = useAction((b: { employeeId: string; assignedOn: string }) => peopleApi.assignAsset(id, b.employeeId, b.assignedOn), { success: (r) => `Assigned to ${r.assignedTo ?? 'employee'} · acknowledgement requested`, invalidate: inv });
  const ret = useAction((b: { condition: string; notes?: string | null; returnedOn?: string | null }) => peopleApi.returnAsset(id, b), {
    success: (r) => (r.suggestRepair ? 'Returned damaged · send it to repair from here' : 'Asset returned'),
    invalidate: inv,
  });
  const inspect = useAction((to: 'IN_STOCK' | 'UNDER_REPAIR' | 'RETIRED') => peopleApi.inspectAsset(id, to), { success: (_r, to) => (to === 'RETIRED' ? 'Asset retired' : to === 'IN_STOCK' ? 'Back in stock' : 'Sent to repair'), invalidate: inv });
  const repair = useAction((b: { issue: string; vendor?: string | null; expectedBack?: string | null }) => peopleApi.repairAsset(id, b), { success: 'Sent to repair', invalidate: inv });
  const repairDone = useAction((cost: number | null) => peopleApi.repairDone(id, cost), { success: 'Repair completed', invalidate: inv });
  const lost = useAction((note: string) => peopleApi.lostAsset(id, note), { success: 'Marked as lost', invalidate: inv });
  const lk = useQuery({ queryKey: ['lookups', 'people', 'employees'], queryFn: () => lookupsFor(['employees']), enabled: dialog === 'assign' });
  const a = q.data;
  const st = a?.status;
  return (
    <Modal
      title={a ? a.item : 'Asset'}
      wide
      onClose={onClose}
      actions={
        a && (
          <>
            <button className="btn btn-ghost" onClick={() => setDialog('edit')}>Edit</button>
            {(st === 'IN_STOCK' || st === 'ASSIGNED' || st === 'RETURNED' || st === 'RETIRED') && <button className="btn btn-ghost" onClick={() => setDialog('lost')}>Mark lost</button>}
            {st === 'RETURNED' && <button className="btn btn-secondary" onClick={() => inspect.mutate('IN_STOCK')}>Inspected · back to stock</button>}
            {(st === 'RETURNED' || st === 'IN_STOCK') && <button className="btn btn-secondary" onClick={() => inspect.mutate('RETIRED')}>Retire</button>}
            {(st === 'IN_STOCK' || st === 'ASSIGNED' || st === 'RETURNED') && <button className="btn btn-secondary" onClick={() => setDialog('repair')}>Send to repair</button>}
            {st === 'UNDER_REPAIR' && <button className="btn btn-primary" onClick={() => setDialog('repairDone')}>Repair complete</button>}
            {st === 'ASSIGNED' && <button className="btn btn-primary" onClick={() => setDialog('return')}>Return</button>}
            {st === 'IN_STOCK' && <button className="btn btn-primary" onClick={() => setDialog('assign')}>Assign</button>}
          </>
        )
      }
    >
      {!a ? (
        <Loading />
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 6 }}>
            <Tag tone={assetTone(a)}>{a.displayStatus}</Tag>
            {a.warrantyExpired && <Tag tone="neutral">{a.statusLabel}</Tag>}
            <span className="faint" style={{ fontSize: 13 }}>{a.assetTag}{a.category ? ` · ${a.category}` : ''} · condition {ASSET_CONDITION_LABELS[a.condition as keyof typeof ASSET_CONDITION_LABELS] ?? a.condition}</span>
          </div>
          <div className="pp-kv">
            <div>Serial no.</div><div className="tnum">{a.serialNo ?? '—'}</div>
            <div>Make / model</div><div>{[a.make, a.model].filter(Boolean).join(' ') || '—'}</div>
            <div>Assigned to</div><div>{a.assignedTo ? `${a.assignedTo} · since ${formatDate(a.assignedOn)}` : '—'}</div>
            <div>Warranty till</div><div>{a.warrantyTill ? formatDate(a.warrantyTill) : '—'}{a.warrantyExpired ? ' · expired' : a.warrantyExpiringSoon ? ' · expiring within 30 days' : ''}</div>
            <div>Purchased</div><div>{a.purchaseDate ? `${formatDate(a.purchaseDate)}${a.vendor ? ` · ${a.vendor}` : ''}${a.purchaseCostPaise != null ? ` · ${formatINR(a.purchaseCostPaise)}` : ''}` : '—'}</div>
            {a.notes && (<><div>Notes</div><div>{a.notes}</div></>)}
          </div>
          <div>
            <div className="kicker" style={{ marginBottom: 4 }}>History</div>
            {a.history.length ? (
              <div className="pp-history">
                {a.history.map((h, i) => (
                  <div key={i} className="pp-history-row">
                    <span className="faint tnum">{formatDate(h.at)}</span>
                    <span>{h.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="faint" style={{ fontSize: 13 }}>No history yet.</div>
            )}
          </div>
        </div>
      )}
      {a && dialog === 'edit' && <AssetFormModal asset={a} onClose={() => setDialog(null)} />}
      {a && dialog === 'assign' && !lk.isLoading && (
        <FormModal
          title={`Assign ${a.item}`}
          fields={[
            { name: 'employeeId', label: 'Employee', type: 'select', span: 2, required: true, options: lk.data?.employees ?? [] },
            { name: 'assignedOn', label: 'Assigned on', type: 'date', span: 2, required: true },
          ]}
          initial={{ assignedOn: todayKey() }}
          submitLabel="Assign"
          onClose={() => setDialog(null)}
          onSubmit={(v) => assign.mutateAsync({ employeeId: String(v.employeeId), assignedOn: String(v.assignedOn) })}
        />
      )}
      {a && dialog === 'return' && (
        <FormModal
          title={`Return ${a.item} from ${a.assignedTo ?? 'employee'}`}
          fields={[
            { name: 'condition', label: 'Condition', type: 'select', required: true, options: CONDITIONS },
            { name: 'returnedOn', label: 'Returned on', type: 'date', required: true },
            { name: 'notes', label: 'Notes', type: 'area' },
          ]}
          initial={{ condition: 'GOOD', returnedOn: todayKey() }}
          submitLabel="Record return"
          onClose={() => setDialog(null)}
          onSubmit={(v) => ret.mutateAsync({ condition: String(v.condition), notes: (v.notes as string) || null, returnedOn: (v.returnedOn as string) || null })}
        />
      )}
      {a && dialog === 'repair' && (
        <FormModal
          title={`Send ${a.item} to repair`}
          fields={[
            { name: 'issue', label: 'Issue', type: 'text', span: 2, required: true, placeholder: 'Keyboard keys not responding' },
            { name: 'vendor', label: 'Repair vendor', type: 'text' },
            { name: 'expectedBack', label: 'Expected back', type: 'date' },
          ]}
          submitLabel="Send to repair"
          onClose={() => setDialog(null)}
          onSubmit={(v) => repair.mutateAsync({ issue: String(v.issue), vendor: (v.vendor as string) || null, expectedBack: (v.expectedBack as string) || null })}
        />
      )}
      {a && dialog === 'repairDone' && (
        <FormModal
          title={`Repair complete · ${a.item}`}
          fields={[{ name: 'cost', label: 'Repair cost (₹, optional)', type: 'money', span: 2 }]}
          submitLabel="Complete repair"
          onClose={() => setDialog(null)}
          onSubmit={(v) => repairDone.mutateAsync(v.cost == null ? null : Number(v.cost))}
        />
      )}
      {a && dialog === 'lost' && <PromptModal title={`Mark ${a.item} as lost`} label="What happened?" area submitLabel="Mark lost" onClose={() => setDialog(null)} onSubmit={(note) => lost.mutateAsync(note)} />}
    </Modal>
  );
}

function CategoriesModal({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: [...peopleKeys.assets, 'categories'], queryFn: () => peopleApi.assetCategories() });
  const [adding, setAdding] = useState(false);
  const create = useAction((b: FormValues) => peopleApi.createAssetCategory({ name: String(b.name), requiresSerial: !!b.requiresSerial }), { success: 'Category added', invalidate: [[...peopleKeys.assets, 'categories'], ['lookups']] });
  return (
    <Modal title="Asset categories" onClose={onClose} actions={<><button className="btn btn-secondary" onClick={() => setAdding(true)}>Add category</button><button className="btn btn-primary" onClick={onClose}>Done</button></>}>
      {q.isLoading ? (
        <Loading />
      ) : (
        <div>
          {(q.data ?? []).map((c) => (
            <div key={c.id} className="list-row">
              <span>{c.name}{c.requiresSerial ? <span className="faint"> · serial required</span> : null}</span>
              <span className="tnum faint">{c.assets}</span>
            </div>
          ))}
          {!q.data?.length && <div className="empty">No categories yet.</div>}
        </div>
      )}
      {adding && (
        <FormModal
          title="Add asset category"
          fields={[
            { name: 'name', label: 'Name', type: 'text', span: 2, required: true },
            { name: 'requiresSerial', label: 'Serial number required', type: 'checkbox', span: 2 },
          ]}
          initial={{ requiresSerial: true }}
          onClose={() => setAdding(false)}
          onSubmit={(v) => create.mutateAsync(v)}
        />
      )}
    </Modal>
  );
}
