import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  HIGH_RISK_KEYS,
  PLAN_LABELS,
  TOP_LEVEL_ROLE_KEYS,
  alsoEnabledCopy,
  matrixCell,
  type MatrixCellState,
  type RoleDto,
  type RolesResponse,
} from '@lexisora/shared';
import { Check, ConfirmDialog, ErrorBlock, Loading, Modal, PageHeader, Tabs } from '@/components/ui';
import { FormModal, type FieldDef } from '@/components/form';
import { HttpError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { qk, rolesApi, useRoles } from '../api';
import { RoleMembers } from './RoleMembers';
import { RoleEditor, type RoleEditorAction } from './RoleEditor';
import '../platform.css';

type Row = { label: string; keys: string[] };
type Change =
  | { kind: 'row'; role: RoleDto; row: Row; enabled: boolean }
  | { kind: 'key'; role: RoleDto; key: string; enabled: boolean; cascade?: boolean }
  | { kind: 'bulk'; role: RoleDto; group: string; keys: string[]; enabled: boolean };
type KeyChange = Extract<Change, { kind: 'key' }>;
type PermItem = RolesResponse['groups'][number]['items'][number];

type ModalState =
  | null
  | { kind: 'add' }
  | { kind: 'rename' | 'describe' | 'duplicate' | 'delete'; role: RoleDto }
  | { kind: 'confirm'; change: Change; title: string; body: string; label: string; danger: boolean }
  | { kind: 'cascade'; change: KeyChange; message: string }
  | { kind: 'detail'; roleId: string; row: Row };

type Tab = 'matrix' | 'members' | 'all';
type Undo = { roleId: string; previous: string[]; text: string; until: number };

const NONE = '__none__';
const isHighRisk = (k: string) => (HIGH_RISK_KEYS as readonly string[]).includes(k);

/** Tri-state matrix checkbox: ✓ all keys of the row, half-fill some, empty none. */
function TriCheck({ state, onClick, disabled, label }: { state: MatrixCellState; onClick?: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      className={`check${state === 'some' ? ' pf-some' : ''}`}
      role="checkbox"
      aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
      aria-label={label}
      title={state === 'some' ? 'Some permissions in this row — click to see which' : label}
      disabled={disabled || !onClick}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {state === 'all' ? '✓' : ''}
    </button>
  );
}

export default function RolesPage() {
  const roles = useRoles();
  const qc = useQueryClient();
  const { reload } = useAuth();
  const { toast, toastError } = useToast();
  const [tab, setTab] = useState<Tab>('matrix');
  const [modal, setModal] = useState<ModalState>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [membersRole, setMembersRole] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<Undo | null>(null);
  const [filter, setFilter] = useState('');
  // "All permissions" shows every role side by side, or one role's full editor.
  const [focus, setFocus] = useState<string | null>(null);
  const close = () => setModal(null);

  // Role header menu closes on any outside click.
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.pf-head-wrap')) setMenuFor(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuFor]);

  // "Saved · Undo" stays for 10 seconds.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), Math.max(0, undo.until - Date.now()));
    return () => clearTimeout(t);
  }, [undo]);

  // Another admin changed a role: refetch (last write wins). While our own toggles are in flight
  // their responses update the cache, so a refetch then would only flicker the optimistic cells.
  const inFlight = useRef(0);
  useEffect(
    () =>
      onRealtime('rbac.roles.changed', () => {
        if (inFlight.current === 0) void qc.invalidateQueries({ queryKey: qk.roles });
      }),
    [qc],
  );

  const data = roles.data;
  const items = useMemo(() => {
    const m = new Map<string, PermItem & { group: string }>();
    for (const g of data?.groups ?? []) for (const i of g.items) m.set(i.key, { ...i, group: g.group });
    return m;
  }, [data]);
  const labelOf = (k: string) => items.get(k)?.label ?? k;

  const setRoleInCache = (role: RoleDto) =>
    qc.setQueryData<RolesResponse>(qk.roles, (d) => (d ? { ...d, roles: d.roles.map((r) => (r.id === role.id ? role : r)) } : d));
  const patchPerms = (roleId: string, fn: (p: string[]) => string[]) =>
    qc.setQueryData<RolesResponse>(qk.roles, (d) => (d ? { ...d, roles: d.roles.map((r) => (r.id === roleId ? { ...r, permissions: fn(r.permissions) } : r)) } : d));

  const createRole = useAction((b: { name: string; copyFromRoleId: string | null; description?: string | null }) => rolesApi.create(b), {
    success: 'Role created',
    invalidate: [qk.roles],
  });
  const updateRole = useAction((b: { id: string; name?: string; description?: string | null }) => rolesApi.update(b.id, { name: b.name, description: b.description }), {
    success: (_r, b) => (b.name ? 'Role renamed' : 'Saved'),
    invalidate: [qk.roles],
  });
  const deleteRole = useAction((id: string) => rolesApi.remove(id), { success: 'Role deleted', invalidate: [qk.roles] });

  if (roles.isLoading) return <Loading label="Loading roles…" />;
  if (roles.error || !data) return <ErrorBlock error={roles.error} retry={() => void roles.refetch()} />;
  const list = data.roles;
  const employeeRole = list.find((r) => r.key === 'employee' && r.isSystem) ?? list[0];

  const pendingKey = (c: Change) => `${c.role.id}|${c.kind === 'row' ? `row:${c.row.label}` : c.kind === 'bulk' ? `bulk:${c.group}` : `key:${c.key}`}`;
  const whatOf = (c: Change) => (c.kind === 'row' ? c.row.label : c.kind === 'bulk' ? `all ${c.group} permissions` : labelOf(c.key));
  const keysOf = (c: Change) => (c.kind === 'row' ? c.row.keys : c.kind === 'bulk' ? c.keys : [c.key]);

  /** High-risk rows/keys and Mobile for non-top-level roles ask first. */
  function request(c: Change) {
    const keys = keysOf(c);
    // Only keys whose state actually changes count (a group "Turn all on" skips what is already on).
    const changing = keys.filter((k) => c.role.permissions.includes(k) !== c.enabled);
    if (!changing.some(isHighRisk)) return void run(c);
    const what = whatOf(c);
    if (c.enabled) {
      const mobileWarn = changing.includes('mobile.access') && !(TOP_LEVEL_ROLE_KEYS as readonly string[]).includes(c.role.key);
      setModal({
        kind: 'confirm',
        change: c,
        title: `Turn on ${what} for ${c.role.name}?`,
        body: mobileWarn
          ? `Mobile access should be enabled only for top-level roles. All ${c.role.memberCount} member(s) of ${c.role.name} will be able to sign in from the mobile app.`
          : `This is a high-risk permission. All ${c.role.memberCount} member(s) of ${c.role.name} get it immediately.`,
        label: 'Turn on',
        danger: mobileWarn,
      });
    } else {
      setModal({ kind: 'confirm', change: c, title: `Turn off ${what} for ${c.role.name}?`, body: `Members of ${c.role.name} lose this access immediately.`, label: 'Turn off', danger: true });
    }
  }

  async function run(c: Change) {
    const id = pendingKey(c);
    const keys = keysOf(c);
    const previous = c.role.permissions;
    const flip = (p: string[]) => (c.enabled ? [...new Set([...p, ...keys])] : p.filter((k) => !keys.includes(k)));
    inFlight.current += 1;
    setPending((s) => new Set(s).add(id));
    // Optimistic: flip the cell right away; the server response (with any dependencies) replaces it.
    patchPerms(c.role.id, flip);
    try {
      const r =
        c.kind === 'row'
          ? await rolesApi.setMatrixRow(c.role.id, c.row.label, c.enabled)
          : c.kind === 'bulk'
            ? await rolesApi.setAll(c.role.id, flip(previous), c.group)
            : await rolesApi.setPermission(c.role.id, c.key, c.enabled, c.cascade);
      setRoleInCache(r.role);
      if (c.kind === 'bulk' && !c.enabled) {
        // A group "Turn all off" keeps keys that permissions in other groups still need.
        const kept = keys.filter((k) => r.role.permissions.includes(k));
        if (kept.length) toast(`Kept ${kept.map(labelOf).join(', ')} — other permissions of ${c.role.shortName} need them`);
      }
      if (r.added.length || r.removed.length) {
        const also = alsoEnabledCopy(r.added, keys);
        const cascaded = r.removed.filter((k) => !keys.includes(k));
        if (also) toast(also);
        else if (cascaded.length) toast(`Also turned off: ${cascaded.map(labelOf).join(', ')}`);
        setUndo({ roleId: c.role.id, previous, text: `${c.enabled ? 'Turned on' : 'Turned off'} ${whatOf(c)} for ${c.role.shortName}`, until: Date.now() + 10_000 });
        if (c.role.isMine) void reload().catch(() => undefined);
      }
    } catch (e) {
      void qc.invalidateQueries({ queryKey: qk.roles });
      if (e instanceof HttpError && e.code === 'PERMISSION_REQUIRED_BY' && c.kind === 'key') setModal({ kind: 'cascade', change: c, message: e.message });
      else toastError(e);
    } finally {
      inFlight.current -= 1;
      setPending((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function doUndo() {
    if (!undo) return;
    const u = undo;
    setUndo(null);
    try {
      const r = await rolesApi.setAll(u.roleId, u.previous);
      setRoleInCache(r.role);
      toast('Change undone');
      if (r.role.isMine) void reload().catch(() => undefined);
    } catch (e) {
      void qc.invalidateQueries({ queryKey: qk.roles });
      toastError(e);
    }
  }

  function onMenu(role: RoleDto, action: RoleEditorAction | 'permissions') {
    setMenuFor(null);
    if (action === 'members') {
      setMembersRole(role.id);
      setTab('members');
    } else if (action === 'permissions') {
      setFocus(role.id);
      setTab('all');
    } else setModal({ kind: action, role });
  }

  const head = (r: RoleDto) => (
    <span className="pf-head-wrap">
      <button type="button" className="pf-role-head" aria-haspopup="menu" aria-expanded={menuFor === r.id} onClick={() => setMenuFor((m) => (m === r.id ? null : r.id))} title={r.description ?? r.name}>
        {r.shortName}
        {r.isMine && <span className="pf-mine">· you</span>}
      </button>
      {menuFor === r.id && (
        <div className="menu" role="menu">
          <button onClick={() => onMenu(r, 'rename')}>Rename</button>
          <button onClick={() => onMenu(r, 'describe')}>Description</button>
          <button onClick={() => onMenu(r, 'duplicate')}>Duplicate</button>
          <button onClick={() => onMenu(r, 'members')}>Members · {r.memberCount}</button>
          <button onClick={() => onMenu(r, 'permissions')}>Edit all permissions</button>
          {r.isSystem ? (
            <button disabled title="System roles can’t be deleted. You can rename them or change their permissions.">Delete</button>
          ) : r.memberCount > 0 ? (
            <button onClick={() => onMenu(r, 'members')}>Reassign members…</button>
          ) : (
            <button onClick={() => onMenu(r, 'delete')}>Delete</button>
          )}
        </div>
      )}
    </span>
  );

  const detailRole = modal?.kind === 'detail' ? list.find((r) => r.id === modal.roleId) : undefined;
  const focusRole = focus ? list.find((r) => r.id === focus) : undefined;
  const f = filter.trim().toLowerCase();

  return (
    <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties} data-screen-label="Roles & access">
      <PageHeader
        title="Roles & access"
        sub="Module permissions per role. Mobile access is off by default and should be enabled only for top-level roles."
        actions={<button className="btn btn-primary" onClick={() => setModal({ kind: 'add' })}>Add role</button>}
      />
      <Tabs<Tab>
        tabs={[
          { value: 'matrix', label: 'Matrix' },
          { value: 'members', label: 'Members' },
          { value: 'all', label: 'All permissions' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {undo && (
        <div className="pf-undo" role="status">
          <span>Saved · {undo.text}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => void doUndo()}>Undo</button>
        </div>
      )}

      {tab === 'matrix' && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="table pf-matrix">
              <thead>
                <tr>
                  <th>Module</th>
                  {list.map((r) => (
                    <th key={r.id} className="pf-rc">{head(r)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.matrix.map((row) => {
                  const lockedAll = row.keys.every((k) => items.get(k)?.locked);
                  const minPlan = items.get(row.keys[0]!)?.minPlan;
                  return (
                    <tr key={row.label}>
                      <td>
                        {row.label}
                        {lockedAll && minPlan && <span className="pf-lock" style={{ marginLeft: 8 }} title={`Needs the ${PLAN_LABELS[minPlan]} plan`}>{PLAN_LABELS[minPlan]}</span>}
                      </td>
                      {list.map((r) => {
                        const st = matrixCell(r.permissions, row);
                        const busy = pending.has(`${r.id}|row:${row.label}`);
                        return (
                          <td key={r.id} className="pf-rc">
                            <TriCheck
                              state={st}
                              label={`${row.label} · ${r.name}`}
                              disabled={busy || (lockedAll && st === 'none')}
                              onClick={() => (st === 'some' ? setModal({ kind: 'detail', roleId: r.id, row }) : request({ kind: 'row', role: r, row, enabled: st === 'none' }))}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pf-legend">
            <span className="pf-cell"><TriCheck state="all" /> Every permission in the row</span>
            <span className="pf-cell"><TriCheck state="some" /> Some — click to see which</span>
            <span>Click a role name to rename, duplicate, see members or delete it. Changes apply immediately to everyone in the role.</span>
          </div>
        </>
      )}

      {tab === 'members' && <RoleMembers roles={list} roleId={membersRole ?? list[0]?.id ?? null} onRoleId={setMembersRole} />}

      {tab === 'all' && (
        <div className="stack">
          <div className="row-between">
            <div className="row" style={{ gap: 8, flex: '1 1 320px' }}>
              <input className="input" placeholder="Filter permissions" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 260, flex: '1 1 160px' }} aria-label="Filter permissions" />
              <select className="input" style={{ maxWidth: 220, flex: '1 1 140px' }} value={focusRole?.id ?? ''} onChange={(e) => setFocus(e.target.value || null)} aria-label="Show roles">
                <option value="">All roles side by side</option>
                {list.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="faint" style={{ fontSize: 12 }}>
              Turning a permission on also turns on what it needs.{data.plan !== 'INTERNAL' && data.plan !== 'ENTERPRISE' ? ` Your plan: ${PLAN_LABELS[data.plan]}.` : ''}
            </span>
          </div>
          {focusRole ? (
            <RoleEditor
              role={focusRole}
              groups={data.groups}
              filter={filter}
              pending={pending}
              labelOf={labelOf}
              onKey={(key, enabled) => request({ kind: 'key', role: focusRole, key, enabled })}
              onGroup={(group, keys, enabled) => request({ kind: 'bulk', role: focusRole, group, keys, enabled })}
              onAction={(a) => onMenu(focusRole, a)}
            />
          ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table pf-matrix">
              <thead>
                <tr>
                  <th>Permission</th>
                  {list.map((r) => (
                    <th key={r.id} className="pf-rc">{head(r)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g) => {
                  const shown = g.items.filter((i) => !f || i.label.toLowerCase().includes(f) || i.key.includes(f) || g.group.toLowerCase().includes(f));
                  if (!shown.length) return null;
                  return (
                    <Fragment key={g.group}>
                      <tr className="pf-group-row">
                        <td colSpan={list.length + 1}>{g.group}</td>
                      </tr>
                      {shown.map((i) => (
                        <tr key={i.key}>
                          <td>
                            <div className="pf-perm-label">
                              <span>
                                {i.label}
                                {i.locked && i.minPlan && <span className="pf-lock" style={{ marginLeft: 8 }}>{PLAN_LABELS[i.minPlan]}</span>}
                                {i.highRisk && <span className="pf-lock" style={{ marginLeft: 8 }} title="Asks for confirmation">High risk</span>}
                              </span>
                              <small>
                                <span className="pf-key">{i.key}</span>
                                {i.requires.length > 0 && ` · needs ${i.requires.map(labelOf).join(', ')}`}
                              </small>
                            </div>
                          </td>
                          {list.map((r) => {
                            const on = r.permissions.includes(i.key);
                            const selfLock = i.key === 'roles.manage' && r.isMine && on;
                            return (
                              <td key={r.id} className="pf-rc">
                                <span title={selfLock ? 'You can’t remove Roles & access from your own role' : i.locked && !on ? `Needs the ${PLAN_LABELS[i.minPlan ?? 'GROWTH']} plan` : undefined}>
                                  <Check
                                    checked={on}
                                    label={`${i.label} · ${r.name}`}
                                    disabled={(i.locked && !on) || selfLock || pending.has(`${r.id}|key:${i.key}`)}
                                    onChange={(v) => request({ kind: 'key', role: r, key: i.key, enabled: v })}
                                  />
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {modal?.kind === 'add' && (
        <FormModal
          title="Add role"
          fields={roleFields(list)}
          initial={{ copyFromRoleId: employeeRole?.id ?? NONE }}
          onSubmit={(v) => createRole.mutateAsync({ name: v.name, copyFromRoleId: v.copyFromRoleId === NONE ? null : v.copyFromRoleId })}
          onClose={close}
        />
      )}
      {modal?.kind === 'duplicate' && (
        <FormModal
          title={`Duplicate ${modal.role.name}`}
          fields={[{ name: 'name', label: 'Role name', type: 'text', span: 2, required: true }]}
          initial={{ name: `${modal.role.name} copy`.slice(0, 40) }}
          intro={<span className="muted">The new role starts with the same {modal.role.permissions.length} permissions and no members.</span>}
          onSubmit={(v) => createRole.mutateAsync({ name: v.name, copyFromRoleId: modal.role.id, description: modal.role.description })}
          onClose={close}
        />
      )}
      {modal?.kind === 'rename' && (
        <FormModal
          title={`Rename ${modal.role.name}`}
          fields={[{ name: 'name', label: 'Role name', type: 'text', span: 2, required: true }]}
          initial={{ name: modal.role.name }}
          onSubmit={(v) => updateRole.mutateAsync({ id: modal.role.id, name: v.name })}
          onClose={close}
        />
      )}
      {modal?.kind === 'describe' && (
        <FormModal
          title={`Description · ${modal.role.name}`}
          fields={[{ name: 'description', label: 'Description', type: 'area', span: 2, placeholder: 'Who should have this role and why' }]}
          initial={{ description: modal.role.description ?? '' }}
          onSubmit={(v) => updateRole.mutateAsync({ id: modal.role.id, description: v.description ?? null })}
          onClose={close}
        />
      )}
      {modal?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${modal.role.name}?`}
          body="The role has no members. This can’t be undone."
          confirmLabel="Delete role"
          danger
          busy={deleteRole.isPending}
          onClose={close}
          onConfirm={() => deleteRole.mutate(modal.role.id, { onSuccess: close })}
        />
      )}
      {modal?.kind === 'confirm' && (
        <ConfirmDialog
          title={modal.title}
          body={modal.body}
          confirmLabel={modal.label}
          danger={modal.danger}
          onClose={close}
          onConfirm={() => {
            const c = modal.change;
            close();
            void run(c);
          }}
        />
      )}
      {modal?.kind === 'cascade' && (
        <ConfirmDialog
          title="Turn off dependent permissions too?"
          body={`${modal.message}. Turning it off also turns those off for ${modal.change.role.name}.`}
          confirmLabel="Turn off all"
          danger
          onClose={close}
          onConfirm={() => {
            const c = modal.change;
            close();
            void run({ ...c, cascade: true });
          }}
        />
      )}
      {modal?.kind === 'detail' && detailRole && (
        <Modal title={`${modal.row.label} · ${detailRole.name}`} onClose={close} actions={<button className="btn btn-secondary" onClick={close}>Done</button>}>
          <div className="dialog-body stack">
            <span className="muted" style={{ fontSize: 13 }}>This row bundles {modal.row.keys.length} permissions. Turn them on or off one by one.</span>
            {modal.row.keys.map((k) => {
              const it = items.get(k);
              const on = detailRole.permissions.includes(k);
              return (
                <div key={k} className="row-between" style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 8 }}>
                  <div className="pf-perm-label">
                    <span>
                      {it?.label ?? k}
                      {it?.locked && it.minPlan && <span className="pf-lock" style={{ marginLeft: 8 }}>{PLAN_LABELS[it.minPlan]}</span>}
                    </span>
                    <small className="pf-key">{k}</small>
                  </div>
                  <Check
                    checked={on}
                    label={it?.label ?? k}
                    disabled={(!!it?.locked && !on) || pending.has(`${detailRole.id}|key:${k}`)}
                    onChange={(v) => request({ kind: 'key', role: detailRole, key: k, enabled: v })}
                  />
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}

function roleFields(list: RoleDto[]): FieldDef[] {
  return [
    { name: 'name', label: 'Role name', type: 'text', span: 2, required: true, placeholder: 'e.g. Facility Manager' },
    {
      name: 'copyFromRoleId',
      label: 'Copy permissions from',
      type: 'select',
      span: 2,
      required: true,
      options: [...list.map((r) => ({ value: r.id, label: r.name })), { value: NONE, label: 'None (empty)' }],
      hint: 'You can change individual permissions after the role is created.',
    },
  ];
}
