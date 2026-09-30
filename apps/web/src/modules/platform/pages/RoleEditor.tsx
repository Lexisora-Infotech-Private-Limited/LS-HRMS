import { PLAN_LABELS, groupBulkKeys, type RoleDto, type RolesResponse } from '@lexisora/shared';
import { Check, Tag } from '@/components/ui';

type Group = RolesResponse['groups'][number];
export type RoleEditorAction = 'rename' | 'describe' | 'duplicate' | 'members' | 'delete';

/**
 * Per-role permission editor ("All permissions" focused on one role): the full catalogue grouped
 * like the sidebar, one card per group with a group-level "Turn all on / off".
 */
export function RoleEditor({
  role,
  groups,
  filter,
  pending,
  labelOf,
  onKey,
  onGroup,
  onAction,
}: {
  role: RoleDto;
  groups: Group[];
  filter: string;
  pending: Set<string>;
  labelOf: (k: string) => string;
  onKey: (key: string, enabled: boolean) => void;
  onGroup: (group: string, keys: string[], enabled: boolean) => void;
  onAction: (a: RoleEditorAction) => void;
}) {
  const held = new Set(role.permissions);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const inCatalogue = groups.reduce((n, g) => n + g.items.filter((i) => held.has(i.key)).length, 0);
  const f = filter.trim().toLowerCase();

  return (
    <div className="stack" data-role-editor={role.key}>
      <div className="row-between">
        <div>
          <div className="serif" style={{ fontSize: 18 }}>
            {role.name} {role.isSystem ? <Tag tone="outline">System role</Tag> : <Tag>Custom role</Tag>}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {role.description ?? (role.isSystem ? 'Seeded with every workspace. It can be renamed and edited, not deleted.' : 'Created in this workspace.')} · {inCatalogue} of {total} permissions ·{' '}
            {role.memberCount} {role.memberCount === 1 ? 'member' : 'members'}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => onAction('rename')}>Rename</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onAction('describe')}>Description</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onAction('duplicate')}>Duplicate</button>
          <button className="btn btn-secondary btn-sm" onClick={() => onAction('members')}>Members · {role.memberCount}</button>
          {!role.isSystem && role.memberCount === 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => onAction('delete')}>Delete</button>
          )}
        </div>
      </div>

      <div className="pf-perm-groups">
        {groups.map((g) => {
          const shown = g.items.filter((i) => !f || i.label.toLowerCase().includes(f) || i.key.includes(f) || g.group.toLowerCase().includes(f));
          if (!shown.length) return null;
          const on = g.items.filter((i) => held.has(i.key)).length;
          const bulk = groupBulkKeys(role, g.items);
          const busy = pending.has(`${role.id}|bulk:${g.group}`);
          return (
            <div className="card pf-perm-card" key={g.group}>
              <div className="row-between" style={{ gap: 8 }}>
                <div className="card-kicker">{g.group}</div>
                <span className="row" style={{ gap: 8 }}>
                  <span className="faint tnum" style={{ fontSize: 12 }}>
                    {on}/{g.items.length}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy || !bulk.keys.length}
                    title={!bulk.keys.length ? 'Nothing to change in this group' : undefined}
                    onClick={() => onGroup(g.group, bulk.keys, !bulk.allOn)}
                  >
                    {bulk.allOn ? 'Turn all off' : 'Turn all on'}
                  </button>
                </span>
              </div>
              {shown.map((i) => {
                const isOn = held.has(i.key);
                const selfLock = i.key === 'roles.manage' && role.isMine && isOn;
                const lockedOff = i.locked && !isOn;
                return (
                  <div className="pf-perm-item" key={i.key}>
                    <span title={selfLock ? 'You can’t remove Roles & access from your own role' : lockedOff ? `Needs the ${PLAN_LABELS[i.minPlan ?? 'GROWTH']} plan` : undefined}>
                      <Check checked={isOn} label={i.label} disabled={lockedOff || selfLock || busy || pending.has(`${role.id}|key:${i.key}`)} onChange={(v) => onKey(i.key, v)} />
                    </span>
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
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
