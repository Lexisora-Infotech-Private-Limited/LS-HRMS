import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TSHIRT_SIZES, formatDate, type KitItemDto, type KitRow } from '@lexisora/shared';
import { HttpError } from '@/lib/api';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { FormModal, type FieldDef } from '@/components/form';
import { DataTable, type Column } from '@/components/table';
import { Check, ConfirmDialog, ErrorBlock, Loading, Modal, PageHeader, Pills } from '@/components/ui';
import { lookupsFor, peopleApi, peopleKeys, type KitItemInput, type KitList } from '../api';
import { todayKey } from '../components';
import '../people.css';

type Filter = 'all' | 'PENDING' | 'PARTIAL' | 'ISSUED';
type Toggle = { row: KitRow; item: KitItemDto; issued: boolean; size?: string | null; force?: boolean };

export default function WelcomeKitsPage() {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [issuing, setIssuing] = useState(false);
  const [stock, setStock] = useState(false);
  const [needSize, setNeedSize] = useState<Toggle | null>(null);
  const [outOfStock, setOutOfStock] = useState<Toggle | null>(null);
  const key = [...peopleKeys.kits, filter] as const;
  const list = useQuery({ queryKey: key, queryFn: () => peopleApi.kits(filter === 'all' ? undefined : filter) });

  async function toggle(t: Toggle) {
    // Optimistic tick: flip the cell now, reconcile with the server after.
    const prev = qc.getQueryData<KitList>(key);
    qc.setQueryData<KitList>(key, (old) =>
      old ? { ...old, rows: old.rows.map((r) => (r.id === t.row.id ? { ...r, lines: r.lines.map((l) => (l.itemId === t.item.id ? { ...l, issued: t.issued } : l)) } : r)) } : old,
    );
    try {
      await peopleApi.toggleKitLine(t.row.id, t.item.id, { issued: t.issued, size: t.size ?? null, force: t.force });
      toast(t.issued ? `${t.item.name} issued to ${t.row.name}` : `${t.item.name} marked as not issued`);
    } catch (e) {
      qc.setQueryData(key, prev);
      if (e instanceof HttpError && e.code === 'SIZE_REQUIRED') setNeedSize(t);
      else if (e instanceof HttpError && e.code === 'OUT_OF_STOCK') setOutOfStock(t);
      else toastError(e);
    } finally {
      void qc.invalidateQueries({ queryKey: peopleKeys.kits });
      void qc.invalidateQueries({ queryKey: ['people', 'profile'] });
    }
  }

  const items = list.data?.items ?? [];
  const columns: Column<KitRow>[] = [
    { key: 'n', header: 'New joiner', render: (r) => r.name },
    { key: 'j', header: 'Joined', render: (r) => (r.joined ? formatDate(r.joined) : '—') },
    ...items.map(
      (it): Column<KitRow> => ({
        key: it.id,
        header: it.name,
        render: (r) => {
          const l = r.lines.find((x) => x.itemId === it.id);
          const size = it.sizes.length ? (l?.size ?? r.tshirtSize) : null;
          return (
            <span className="row" style={{ gap: 6 }} title={size ? `Size ${size}` : undefined}>
              <Check checked={!!l?.issued} label={`${it.name} for ${r.name}`} onChange={(v) => void toggle({ row: r, item: it, issued: v })} />
              {size && <span className="faint" style={{ fontSize: 12 }}>{size}</span>}
            </span>
          );
        },
      }),
    ),
    { key: 'b', header: 'Issued by', render: (r) => r.issuedBy ?? <span className="faint">—</span> },
  ];

  return (
    <div data-screen-label="Welcome kits" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Welcome kits"
        sub="Items handed to new joiners on day one."
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setStock(true)}>Kit items & stock</button>
            <button className="btn btn-primary" onClick={() => setIssuing(true)}>Issue kit</button>
          </>
        }
      />
      <Pills<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'PENDING', label: 'Pending' },
          { value: 'PARTIAL', label: 'Partially issued' },
          { value: 'ISSUED', label: 'Issued' },
        ]}
      />
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={columns} rows={list.data?.rows} loading={list.isLoading} rowKey={(r) => r.id} empty="No welcome kits in this view. Kits are created when an employee is added." />
      )}
      {issuing && <IssueKitModal items={items} onClose={() => setIssuing(false)} />}
      {stock && <StockModal onClose={() => setStock(false)} />}
      {needSize && (
        <SizeModal
          t={needSize}
          onClose={() => setNeedSize(null)}
          onPick={(size) => {
            const t = needSize;
            setNeedSize(null);
            void toggle({ ...t, size });
          }}
        />
      )}
      {outOfStock && (
        <ConfirmDialog
          title={`${outOfStock.item.name} is out of stock`}
          body="Issue it anyway (for example from a box not yet counted)? Stock goes negative until you restock in Kit items & stock."
          confirmLabel="Issue anyway"
          onConfirm={() => {
            const t = outOfStock;
            setOutOfStock(null);
            void toggle({ ...t, force: true });
          }}
          onClose={() => setOutOfStock(null)}
        />
      )}
    </div>
  );
}

function SizeModal({ t, onPick, onClose }: { t: Toggle; onPick: (s: string) => void; onClose: () => void }) {
  const sizes = t.item.sizes.length ? t.item.sizes : [...TSHIRT_SIZES];
  const [size, setSize] = useState(sizes[1] ?? sizes[0]!);
  return (
    <Modal title={`${t.item.name} size for ${t.row.name}`} onClose={onClose} actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onPick(size)}>Issue {size}</button></>}>
      <div className="dialog-body">The joiner has not picked a size during onboarding. Choose one:</div>
      <div className="pp-sizes">
        {sizes.map((s) => (
          <button key={s} type="button" className={`btn ${s === size ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSize(s)}>{s}{t.item.stock[s] != null ? <span className="faint"> · {t.item.stock[s]}</span> : null}</button>
        ))}
      </div>
    </Modal>
  );
}

/** FORMS.kit — "Issue". */
function IssueKitModal({ items, onClose }: { items: KitItemDto[]; onClose: () => void }) {
  const lk = useQuery({ queryKey: ['lookups', 'people', 'newJoiners'], queryFn: () => lookupsFor(['newJoiners', 'employees']) });
  const save = useAction((b: { employeeId: string; itemIds: string[]; issuedOn: string }) => peopleApi.issueKit(b), {
    success: (r) => (r.warnings.length ? `Kit issued · ${r.warnings.length} item${r.warnings.length === 1 ? '' : 's'} skipped: ${r.warnings[0]}` : 'Welcome kit issued'),
    invalidate: [peopleKeys.kits, ['lookups'], ['people', 'profile']],
  });
  if (lk.isLoading) return null;
  const joiners = lk.data?.newJoiners?.length ? lk.data.newJoiners : (lk.data?.employees ?? []);
  const fields: FieldDef[] = [
    { name: 'employeeId', label: 'New joiner', type: 'select', span: 2, required: true, options: joiners },
    { name: 'itemIds', label: 'Items', type: 'multiselect', span: 2, required: true, options: items.map((i) => ({ value: i.id, label: i.name })) },
    { name: 'issuedOn', label: 'Issued on', type: 'date', span: 2, required: true },
  ];
  return (
    <FormModal
      title="Issue welcome kit"
      fields={fields}
      submitLabel="Issue"
      initial={{ itemIds: items.map((i) => i.id), issuedOn: todayKey() }}
      onClose={onClose}
      onSubmit={(v) => save.mutateAsync({ employeeId: String(v.employeeId), itemIds: v.itemIds as string[], issuedOn: String(v.issuedOn) })}
    />
  );
}

/** Kit items master: sizes, stock per size, low-stock threshold. */
function StockModal({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: [...peopleKeys.kits, 'items'], queryFn: () => peopleApi.kitItems() });
  const [editing, setEditing] = useState<KitItemDto | 'new' | null>(null);
  return (
    <Modal title="Kit items & stock" wide onClose={onClose} actions={<><button className="btn btn-secondary" onClick={() => setEditing('new')}>Add item</button><button className="btn btn-primary" onClick={onClose}>Done</button></>}>
      {q.isLoading ? (
        <Loading />
      ) : (
        <table className="table">
          <thead>
            <tr><th>Item</th><th>Stock</th><th>Low-stock alert below</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((it) => (
              <tr key={it.id}>
                <td>{it.name}</td>
                <td className="tnum">
                  {it.sizes.length
                    ? it.sizes.map((s) => <span key={s} className={(it.stock[s] ?? 0) < it.lowStockThreshold ? 'pp-err' : undefined}>{s} {it.stock[s] ?? 0}{'  '}</span>)
                    : <span className={(it.stock._ ?? 0) < it.lowStockThreshold ? 'pp-err' : undefined}>{it.stock._ ?? 0}</span>}
                </td>
                <td className="tnum">{it.lowStockThreshold}</td>
                <td>{it.isActive ? 'Active' : <span className="faint">Inactive</span>}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => setEditing(it)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <KitItemForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Modal>
  );
}

function KitItemForm({ item, onClose }: { item: KitItemDto | null; onClose: () => void }) {
  const save = useAction((b: KitItemInput) => peopleApi.saveKitItem(item?.id ?? null, b), { success: item ? 'Stock updated' : 'Kit item added', invalidate: [peopleKeys.kits, ['lookups']] });
  const sized = item ? item.sizes.length > 0 : false;
  const sizes = item?.sizes ?? [];
  const fields: FieldDef[] = [
    { name: 'name', label: 'Item', type: 'text', span: 2, required: true },
    ...(item ? [] : [{ name: 'sized', label: 'Comes in T-shirt sizes (S–XXL)', type: 'checkbox', span: 2 } as FieldDef]),
    ...(sized ? sizes.map((s): FieldDef => ({ name: `s_${s}`, label: `Stock · ${s}`, type: 'number' })) : [{ name: 'qty', label: 'Stock', type: 'number', showIf: (v: Record<string, unknown>) => !v.sized } as FieldDef]),
    { name: 'lowStockThreshold', label: 'Alert when stock falls below', type: 'number' },
    { name: 'isActive', label: 'Active (shown as a column)', type: 'checkbox' },
  ];
  const initial: Record<string, unknown> = { name: item?.name ?? '', lowStockThreshold: item?.lowStockThreshold ?? 5, isActive: item?.isActive ?? true, qty: item?.stock._ ?? 0 };
  for (const s of sizes) initial[`s_${s}`] = item?.stock[s] ?? 0;
  return (
    <FormModal
      title={item ? `Edit ${item.name}` : 'Add kit item'}
      fields={fields}
      initial={initial}
      onClose={onClose}
      onSubmit={(v) => {
        const isSized = item ? sized : !!v.sized;
        const sz = item ? sizes : isSized ? [...TSHIRT_SIZES] : [];
        const stock: Record<string, number> = isSized ? Object.fromEntries(sz.map((s) => [s, Number(v[`s_${s}`] ?? 0) || 0])) : { _: Number(v.qty ?? 0) || 0 };
        return save.mutateAsync({ name: String(v.name), sizes: sz, stock, lowStockThreshold: Number(v.lowStockThreshold ?? 5) || 0, isActive: !!v.isActive });
      }}
    />
  );
}
