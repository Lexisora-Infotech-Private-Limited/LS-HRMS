import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PeopleMasterRow } from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { DataTable, type Column } from '@/components/table';
import { ConfirmDialog, ErrorBlock, PageHeader, Tabs } from '@/components/ui';
import { peopleApi, peopleKeys, type MasterKind } from '../api';
import '../people.css';

const LABEL: Record<MasterKind, { one: string; many: string }> = {
  departments: { one: 'department', many: 'Departments' },
  designations: { one: 'designation', many: 'Designations' },
  branches: { one: 'branch', many: 'Branches' },
};

/** Masters (audit G8): departments, designations and branches used across the app. */
export default function MastersPage() {
  const nav = useNavigate();
  const [kind, setKind] = useState<MasterKind>('departments');
  const [editing, setEditing] = useState<PeopleMasterRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<PeopleMasterRow | null>(null);
  const q = useQuery({ queryKey: peopleKeys.masters, queryFn: peopleApi.masters });
  const lk = useLookups(['employees']);
  const invalidate = [peopleKeys.masters, ['lookups'], peopleKeys.employees];
  const save = useAction((b: { id: string | null; body: Record<string, unknown> }) => peopleApi.saveMaster(kind, b.id, b.body), {
    success: (_r, b) => (b.id ? `${cap(LABEL[kind].one)} updated` : `${cap(LABEL[kind].one)} added`),
    invalidate,
  });
  const remove = useAction((r: PeopleMasterRow) => peopleApi.removeMaster(kind, r.id), { success: (_x, r) => `${r.name} removed`, invalidate, onSuccess: () => setRemoving(null) });

  const rows = q.data?.[kind];
  const columns: Column<PeopleMasterRow>[] = [
    { key: 'n', header: 'Name', render: (r) => r.name },
    ...(kind === 'departments'
      ? [
          { key: 'c', header: 'Code', render: (r: PeopleMasterRow) => r.code ?? '—' },
          { key: 'l', header: 'Lead', render: (r: PeopleMasterRow) => r.lead ?? '—' },
        ]
      : []),
    ...(kind === 'branches' ? [{ key: 'a', header: 'Address', render: (r: PeopleMasterRow) => r.address ?? '—' }] : []),
    { key: 'e', header: 'Employees', num: true, render: (r) => r.employees },
    {
      key: 'x',
      header: '',
      render: (r) => (
        <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(r)}>Edit</button>
          <button className="btn btn-ghost btn-sm" disabled={r.employees > 0} title={r.employees > 0 ? 'Move its employees first' : undefined} onClick={() => setRemoving(r)}>Delete</button>
        </span>
      ),
    },
  ];

  const fields: FieldDef[] =
    kind === 'departments'
      ? [
          { name: 'name', label: 'Department name', type: 'text', required: true },
          { name: 'code', label: 'Code', type: 'text', placeholder: 'DEV', hint: '2 to 6 uppercase letters' },
          { name: 'leadEmployeeId', label: 'Department lead', type: 'select', options: opts(lk.data, 'employees'), span: 2 },
        ]
      : kind === 'designations'
        ? [{ name: 'name', label: 'Designation', type: 'text', required: true, span: 2 }]
        : [
            { name: 'name', label: 'Branch name', type: 'text', required: true, span: 2 },
            { name: 'address', label: 'Address', type: 'area' },
          ];

  return (
    <div data-screen-label="Masters" className="stack" style={{ gap: 18 }}>
      <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/employees')}>← Employees</button>
      <PageHeader
        title="Masters"
        sub="Departments, designations and branches used in employee records, jobs, rosters and reports."
        actions={<button className="btn btn-primary" onClick={() => setEditing('new')}>Add {LABEL[kind].one}</button>}
      />
      <Tabs<MasterKind>
        value={kind}
        onChange={setKind}
        tabs={(Object.keys(LABEL) as MasterKind[]).map((k) => ({ value: k, label: `${LABEL[k].many}${q.data ? ` · ${q.data[k].length}` : ''}` }))}
      />
      {q.error ? <ErrorBlock error={q.error} retry={() => void q.refetch()} /> : <DataTable columns={columns} rows={rows} loading={q.isLoading} rowKey={(r) => r.id} empty={`No ${LABEL[kind].many.toLowerCase()} yet.`} />}
      {editing && (
        <FormModal
          key={kind + (editing === 'new' ? 'new' : editing.id)}
          title={editing === 'new' ? `Add ${LABEL[kind].one}` : `Edit ${editing.name}`}
          fields={fields}
          initial={editing === 'new' ? {} : { name: editing.name, code: editing.code, leadEmployeeId: editing.leadEmployeeId, address: editing.address }}
          onClose={() => setEditing(null)}
          onSubmit={(v) => save.mutateAsync({ id: editing === 'new' ? null : editing.id, body: v })}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Delete ${removing.name}?`}
          body={`This ${LABEL[kind].one} is removed from dropdowns. It has no employees assigned.`}
          danger
          confirmLabel="Delete"
          busy={remove.isPending}
          onClose={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing)}
        />
      )}
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
