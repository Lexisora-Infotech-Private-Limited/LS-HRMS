import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setRegionResolver, type LoginInput, type LoginResponse, type PermissionKey, type RegionCode, type SessionUser } from '@lexisora/shared';
import { api, onSessionRefreshed, post, refreshSession, setAccessToken, setSessionExpiredHandler } from './api';
import { applyBranding } from './branding';
import { connectSocket, disconnectSocket } from './socket';

/**
 * Region of the signed-in tenant. Shared formatters (money, dates, times) read it through the
 * resolver, so every screen shows pounds and UK time for UK tenants and is unchanged for India.
 */
let sessionRegion: RegionCode = 'IN';
setRegionResolver(() => sessionRegion);
function applyRegion(u: SessionUser | null) {
  sessionRegion = u?.region === 'GB' ? 'GB' : 'IN';
}

type AuthState = {
  user: SessionUser | null;
  ready: boolean;
  login: (input: Omit<LoginInput, 'client'>) => Promise<SessionUser>;
  logout: () => Promise<void>;
  /** Re-fetch /auth/me (after profile/role changes). */
  reload: () => Promise<void>;
  acceptSession: (r: LoginResponse) => void;
  can: (perm: PermissionKey | PermissionKey[]) => boolean;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  const acceptSession = useCallback((r: LoginResponse) => {
    setAccessToken(r.accessToken);
    applyRegion(r.user);
    setUser(r.user);
    applyBranding(r.user.branding);
    connectSocket(r.accessToken);
  }, []);

  useEffect(() => {
    const off = onSessionRefreshed((d) => {
      applyRegion(d.user);
      setUser(d.user);
      // Page reload restores the session here (not via login): the tenant theme must be applied too.
      applyBranding(d.user.branding);
      connectSocket(d.accessToken);
    });
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      applyRegion(null);
      setUser(null);
      disconnectSocket();
    });
    // Restore the session from the refresh cookie on page load.
    refreshSession().finally(() => setReady(true));
    return () => {
      off();
    };
  }, []);

  // Proactively refresh a minute before the 15-minute access token expires.
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => void refreshSession(), 13 * 60 * 1000);
    return () => clearInterval(t);
  }, [user]);

  const login = useCallback(
    async (input: Omit<LoginInput, 'client'>) => {
      const r = await post<LoginResponse>('/auth/login', { ...input, client: 'web' });
      acceptSession(r);
      try {
        localStorage.setItem('lx.workspace', input.workspace);
      } catch {}
      return r.user;
    },
    [acceptSession],
  );

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setAccessToken(null);
      applyRegion(null);
      setUser(null);
      disconnectSocket();
      qc.clear();
    }
  }, [qc]);

  const reload = useCallback(async () => {
    const me = await api<SessionUser>('/auth/me');
    applyRegion(me);
    setUser(me);
    applyBranding(me.branding);
  }, []);

  const perms = useMemo(() => new Set(user?.permissions ?? []), [user]);
  const can = useCallback(
    (p: PermissionKey | PermissionKey[]) => (Array.isArray(p) ? p.some((x) => perms.has(x)) : perms.has(p)),
    [perms],
  );

  const value = useMemo<AuthState>(() => ({ user, ready, login, logout, reload, acceptSession, can }), [user, ready, login, logout, reload, acceptSession, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

/** The signed-in user (only use inside authenticated routes). */
export function useMe(): SessionUser {
  const { user } = useAuth();
  if (!user) throw new Error('Not signed in');
  return user;
}

export function useCan() {
  return useAuth().can;
}
