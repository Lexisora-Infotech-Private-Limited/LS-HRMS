import { useState } from 'react';
import { dayMonthYear, type RoleDto, type RoleMemberDto } from '@lexisora/shared';
import { Avatar, ConfirmDialog, Pills, StatusTag } from '@/components/ui';
import { DataTable, type Column } from '@/components/table';
import { FormModal } from '@/components/form';
import { useAction } from '@/lib/query';
import { qk, rolesApi, useAssignable, useRoleMembers } from '../api';

/** Members tab: role picker → members table, "Add members", remove (moves the person to Employee). */
export function RoleMembers({ roles, roleId, onRoleId }: { roles: RoleDto[]; roleId: string | null; onRoleId: (id: string) => void }) {
  const role = roles.find((r) => r.id === roleId) ?? roles[0];
  const members = useRoleMembers(role?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<RoleMemberDto | null>(null);
  const assignable = useAssignable(adding);

  const add = useAction((ids: string[]) => rolesApi.addMembers(role!.id, ids), {
    success: (_r, ids) => `${ids.length === 1 ? '1 person' : `${ids.length} people`} added to ${role?.name}`,
    invalidate: [qk.roles],
  });
  const remove = useAction((m: RoleMemberDto) => rolesApi.removeMember(role!.id, m.userId), {
    success: (_r, m) => `${m.name} moved to Employee`,
    invalidate: [qk.roles],
  });

  if (!role) return null;
  const canRemove = !(role.isSystem && role.key === 'employee');

  const columns: Column<RoleMemberDto>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (m) => (
        <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <Avatar name={m.name} size={28} />
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span>{m.name}</span>
            <span className="faint" style={{ fontSize: 12 }}>{m.email}</span>
          </span>
        </span>
      ),
    },
    { key: 'emp', header: 'Emp ID', render: (m) => m.empCode ?? <span className="faint">—</span> },
    { key: 'dept', header: 'Department', render: (m) => m.department ?? <span className="faint">—</span> },
    { key: 'since', header: 'Assigned on', render: (m) => <span className="pf-when">{dayMonthYear(m.since)}</span> },
    { key: 'by', header: 'Assigned by', render: (m) => m.assignedBy ?? <span className="faint">At setup</span> },
    { key: 'status', header: 'Status', render: (m) => <StatusTag status={m.status} /> },
    {
      key: 'act',
      header: '',
      render: (m) =>
        canRemove ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(m)}>
            Remove
          </button>
        ) : null,
    },
  ];

  const options = (assignable.data ?? []).filter((u) => u.roleName !== role.name).map((u) => ({ value: u.value, label: u.label }));

  return (
    <div className="stack">
      <Pills options={roles.map((r) => ({ value: r.id, label: `${r.shortName} · ${r.memberCount}` }))} value={role.id} onChange={onRoleId} />
      <div className="row-between">
        <div>
          <div className="serif" style={{ fontSize: 18 }}>{role.name}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {role.description ?? (role.isSystem ? 'System role' : 'Custom role')} · {role.permissions.length} permissions · {role.memberCount} {role.memberCount === 1 ? 'member' : 'members'}
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => setAdding(true)}>Add members</button>
      </div>
      <DataTable columns={columns} rows={members.data} rowKey={(m) => m.userId} loading={members.isLoading} empty={`No one has the ${role.name} role yet.`} />
      {!canRemove && <div className="faint" style={{ fontSize: 12 }}>Everyone needs a role. To change someone’s role, add them to another role.</div>}

      {adding && (
        <FormModal
          title={`Add members · ${role.name}`}
          fields={[
            {
              name: 'userIds',
              label: 'People',
              type: 'multiselect',
              span: 2,
              required: true,
              options,
              hint: assignable.isLoading ? 'Loading people…' : 'Each person has one role; adding them here moves them out of their current role.',
            },
          ]}
          onSubmit={(v) => add.mutateAsync(v.userIds as string[])}
          onClose={() => setAdding(false)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name} from ${role.name}?`}
          body={`${removing.name} moves to the Employee role and loses ${role.name} permissions immediately.`}
          confirmLabel="Remove"
          danger
          busy={remove.isPending}
          onClose={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing, { onSuccess: () => setRemoving(null) })}
        />
      )}
    </div>
  );
}
