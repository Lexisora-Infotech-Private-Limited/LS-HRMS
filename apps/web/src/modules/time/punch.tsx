import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AttendanceToday, PunchResult } from '@lexisora/shared';
import { HttpError, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { hhmmss, tk, useToday } from './api';

/**
 * Punch controls owned by Time (ARCHITECTURE §8):
 *  - usePunch(): shared state + toggle (server-driven, policy-aware)
 *  - PunchButton: header "Punch in / Punch out"
 *  - PunchCard: dashboard "Today" card
 */

function getGeo(): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

/** Seconds worked today (closed sessions + the open one), ticking every second. */
function useElapsed(today: AttendanceToday | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  const open = today?.openSessionStart;
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open]);
  if (!today) return 0;
  // Correct for client clock skew using the server's clock at fetch time.
  const skew = today.serverNow ? Date.now() - new Date(today.serverNow).getTime() : 0;
  const openSec = open ? Math.max(0, (now - skew - new Date(open).getTime()) / 1000) : 0;
  return today.workedSecondsClosed + openSec;
}

export function usePunch() {
  const { user } = useAuth();
  const enabled = !!user?.employeeId && (user?.permissions ?? []).includes('attendance.self');
  const q = useToday(enabled);
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [busy, setBusy] = useState(false);
  const today = q.data;
  const elapsedSec = useElapsed(today);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => void qc.invalidateQueries({ queryKey: tk.today });
    const offs = [onRealtime('attendance.punched', refresh), onRealtime('policy.updated', refresh)];
    return () => offs.forEach((o) => o());
  }, [enabled, qc]);

  const punchedIn = today?.state === 'IN';
  const blocked = !!today && !punchedIn && !today.webPunchAllowed;
  const label = punchedIn ? 'Punch out' : 'Punch in';

  async function toggle() {
    if (!today || busy) return;
    if (blocked) {
      toast(today.blockReason ?? 'Office mode: punch in with the biometric sensor');
      return;
    }
    if (punchedIn && !today.canPunchOut) {
      toast(today.blockReason ?? 'Punch out at the biometric sensor');
      return;
    }
    setBusy(true);
    const direction = punchedIn ? 'OUT' : 'IN';
    const send = (geo?: { lat: number; lng: number; accuracyM: number } | null) => post<PunchResult>('/attendance/me/punch', { direction, ...(geo ?? {}) });
    try {
      let res: PunchResult;
      try {
        res = await send();
      } catch (e) {
        if (e instanceof HttpError && (e.code === 'GEO_REQUIRED' || e.code === 'GEO_LOW_ACCURACY')) {
          const geo = await getGeo();
          if (!geo) throw new HttpError(403, 'GEO_REQUIRED', 'Location permission required · allow location access and try again');
          res = await send(geo);
        } else throw e;
      }
      qc.setQueryData(tk.today, res.today);
      void qc.invalidateQueries({ queryKey: ['time', 'month'] });
      void qc.invalidateQueries({ queryKey: ['time', 'timeline'] });
      toast(res.message);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return {
    today,
    loading: q.isLoading,
    enabled,
    punchedIn,
    blocked,
    busy,
    label,
    title: today?.title ?? 'Not punched in',
    elapsed: hhmmss(elapsedSec),
    elapsedSec,
    toggle,
  };
}

/** Header button. Hidden when the viewer has no employee record (platform admin). */
export function PunchButton() {
  const p = usePunch();
  if (!p.enabled || !p.today) return null;
  return (
    <button
      className={`btn btn-sm ${p.punchedIn ? 'btn-secondary' : 'btn-primary'}`}
      onClick={() => void p.toggle()}
      disabled={p.busy}
      title={p.blocked ? (p.today.blockReason ?? 'Office mode: punch in with the biometric sensor') : p.punchedIn ? `Worked ${p.elapsed}` : undefined}
    >
      {p.punchedIn ? `${p.label} · ${p.elapsed.slice(0, 5)}` : p.label}
    </button>
  );
}

/** Dashboard "Today" card: state, live timer, shift + mode note, punch button. */
export function PunchCard() {
  const p = usePunch();
  if (!p.enabled) return null;
  const t = p.today;
  return (
    <div className="card" data-screen-label="Today">
      <div className="card-kicker">Today</div>
      <div className="card-title">{p.title}</div>
      <div className="time-elapsed">{p.elapsed}</div>
      <div className="card-meta">
        {t ? `Shift ${t.shift.start} – ${t.shift.end} · ${t.modeNote}` : 'Loading…'}
      </div>
      {t && p.blocked ? (
        <div className="time-blocked">{t.blockReason ?? 'Web punch disabled. Use the fingerprint sensor at the office entrance.'}</div>
      ) : (
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => void p.toggle()} disabled={!t || p.busy}>
          {p.label}
        </button>
      )}
    </div>
  );
}
