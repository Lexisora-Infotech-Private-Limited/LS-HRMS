import type { ReactNode } from 'react';
import type { PermissionKey } from '@lexisora/shared';
import { useCan } from '@/lib/auth';

/** Route-level permission gate. Shows a polite no-access page instead of the screen. */
export function Guard({ perm, children }: { perm: PermissionKey | PermissionKey[]; children: ReactNode }) {
  const can = useCan();
  if (!can(perm)) return <NoAccess />;
  return <>{children}</>;
}

export function NoAccess() {
  return (
    <div className="note" style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
      <div className="serif" style={{ fontSize: 22 }}>You don't have access to this screen</div>
      <div className="muted" style={{ fontSize: 13.5 }}>Your role doesn't include this module. Ask your admin to update Roles &amp; access.</div>
    </div>
  );
}

/** Wrap an element in a Guard (for route definitions). */
export const guard = (perm: PermissionKey | PermissionKey[], el: ReactNode) => <Guard perm={perm}>{el}</Guard>;
