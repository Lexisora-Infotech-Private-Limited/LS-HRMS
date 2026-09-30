import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NAV, canSee } from '@lexisora/shared';
import { useAuth, useMe } from '@/lib/auth';
import { get } from '@/lib/api';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { Avatar } from '@/components/ui';
import { PunchButton } from '@/modules/time/punch';
import { GlobalSearch } from '@/modules/platform/GlobalSearch';

export function AppShell() {
  const me = useMe();
  const { logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const granted = new Set(me.permissions);

  const count = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => get<{ unread: number }>('/notifications/count'), refetchInterval: 60_000 });
  // Keyed under the workplace notices prefix so reading/publishing a notice refreshes the badge.
  const noticesUnread = useQuery({
    queryKey: ['workplace', 'notices', 'unread'],
    queryFn: () => get<{ unread: number }>('/notices/unread-count'),
    enabled: granted.has('notices.view'),
    refetchInterval: 120_000,
  });
  const badges: Record<string, number | undefined> = { notif: count.data?.unread, notices: noticesUnread.data?.unread };

  useEffect(() => {
    return onRealtime<{ title: string }>('notification', (n) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      toast(n.title);
    });
  }, [qc, toast]);

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => canSee(i, granted)) })).filter((g) => g.items.length);

  return (
    <div className="shell">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <NavLink to="/dashboard" className="brand">
          <span className="brand-name">{me.tenantName}</span>
          <span className="brand-sub">People &amp; Operations</span>
        </NavLink>
        {groups.map((g) => (
          <nav className="nav-group" key={g.group} aria-label={g.group}>
            <div className="nav-group-title">{g.group}</div>
            {g.items.map((it) => (
              <NavLink key={it.id} to={it.path} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <span>{it.label}</span>
                {!!badges[it.id] && <span className="tnum" style={{ color: 'var(--color-accent-700)' }}>{badges[it.id]}</span>}
              </NavLink>
            ))}
          </nav>
        ))}
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header className="topbar">
          <button className="btn btn-secondary btn-icon mobile-nav-toggle" aria-label="Menu" onClick={() => setOpen((o) => !o)}>☰</button>
          <GlobalSearch />
          <div style={{ marginLeft: 'auto' }} />
          <PunchButton />
          <button className="btn btn-secondary" onClick={() => nav('/alerts')}>Alerts · {count.data?.unread ?? 0}</button>
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button className="user-btn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
              <Avatar initials={me.initials} name={me.name} />
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span style={{ fontSize: 13 }}>{me.name}</span>
                <span style={{ fontSize: 11 }} className="faint">{me.roleName}</span>
              </span>
            </button>
            {menu && (
              <div className="menu" role="menu">
                <button onClick={() => { setMenu(false); nav('/me'); }}>My profile &amp; devices</button>
                <button onClick={() => { setMenu(false); nav('/visiting-card'); }}>Visiting card</button>
                <button onClick={() => { setMenu(false); nav('/change-password'); }}>Change password</button>
                <button
                  onClick={async () => {
                    await logout();
                    nav('/login');
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
