import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { IdleSpanReason, IdleSpanResult } from '@lexisora/shared';
import { Modal } from '@/components/ui';
import { HttpError, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { dur, timeOf, useToday } from './api';

/**
 * Web idle detection while punched in (spec-time: auto-idle after `autoIdleMinutes` without input).
 *  - IdleWatcher (app shell): after N minutes with no input the open idle span starts; on the first
 *    input after that it asks what you were doing (Break / Meeting / Others + reason) and saves the
 *    span, which the day timeline shows in the idle colour with that reason on hover.
 *  - useIdlePending(): the open idle span (live overlay on your own timeline).
 * Input is seen system-wide when the browser grants idle detection (Chrome / Edge, https or
 * localhost); otherwise only while an HRMS tab is visible. HRMS tabs share state via localStorage.
 */
export type PendingIdle = { clientId: string; since: number; back: number | null };

const TICK_MS = 5_000;
const activityKey = (emp: string) => `lx.idle.activity.${emp}`;
const pendingKey = (emp: string) => `lx.idle.pending.${emp}`;

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage blocked: this tab still works on its own */
  }
}

// ── open idle span (one per signed-in employee, shared by every HRMS tab) ──
let current: PendingIdle | null = null;
const listeners = new Set<() => void>();
function setPending(emp: string, p: PendingIdle | null, persist = true) {
  current = p;
  if (persist) write(pendingKey(emp), p);
  listeners.forEach((l) => l());
}
export function useIdlePending(): PendingIdle | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => current,
  );
}

// ── system-wide idle detection (IdleDetector; not in lib.dom yet) ──
type IdleDetectorLike = EventTarget & {
  userState: 'active' | 'idle' | null;
  screenState: 'locked' | 'unlocked' | null;
  start(o: { threshold: number; signal?: AbortSignal }): Promise<void>;
};
type IdleDetectorApi = { new (): IdleDetectorLike; requestPermission(): Promise<PermissionState> };
const Detector = (globalThis as { IdleDetector?: IdleDetectorApi }).IdleDetector;

/** Ask for system-wide idle detection. Needs a click to show the prompt; a no-op where unsupported. */
export function requestIdlePermission() {
  try {
    void Detector?.requestPermission().catch(() => undefined);
  } catch {
    /* not supported */
  }
}

function useDetectorGranted(): boolean {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    if (!Detector || !navigator.permissions) return;
    let live = true;
    let status: PermissionStatus | null = null;
    const update = () => live && setGranted(status?.state === 'granted');
    navigator.permissions
      .query({ name: 'idle-detection' as PermissionName })
      .then((s) => {
        status = s;
        update();
        s.addEventListener('change', update);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      status?.removeEventListener('change', update);
    };
  }, []);
  return granted;
}

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/**
 * Runs the detector. Returns whether input is seen system-wide (vs. only inside HRMS tabs).
 * `watch` = punched in on a non-desktop session with auto-idle on (server `webIdleWatch`).
 */
function useIdleEngine(emp: string | null, watch: boolean, thresholdMs: number, sessionStart: string | null): boolean {
  const granted = useDetectorGranted();
  const det = useRef<{ state: 'active' | 'idle' | null; idleSince: number }>({ state: null, idleSince: 0 });
  // Only idle observed while this page is open counts, so start from "now".
  const lastLocal = useRef(Date.now());
  const lastWrite = useRef(0);

  // This employee's open idle span (from another tab or before a reload), kept in sync across tabs.
  useEffect(() => {
    if (!emp) return;
    setPending(emp, read<PendingIdle>(pendingKey(emp)), false);
    const onStorage = (e: StorageEvent) => {
      if (e.key === pendingKey(emp)) setPending(emp, read<PendingIdle>(pendingKey(emp)), false);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      setPending(emp, null, false);
    };
  }, [emp]);

  // Input in this tab (or the tab coming back into view) is activity; the first one after idle ends it.
  useEffect(() => {
    if (!emp) return;
    const touch = () => {
      const t = Date.now();
      if (current && current.back === null && t > current.since) setPending(emp, { ...current, back: t });
      if (t - lastLocal.current < 1_000) return;
      lastLocal.current = t;
      if (t - lastWrite.current > TICK_MS) {
        lastWrite.current = t;
        write(activityKey(emp), t);
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && touch();
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [emp]);

  // System-wide detector: "active" anywhere on the PC counts; a locked screen counts as away.
  useEffect(() => {
    if (!emp || !watch || !granted || !Detector) return;
    const ctl = new AbortController();
    const d = new Detector();
    const onChange = () => {
      const active = d.userState === 'active' && d.screenState !== 'locked';
      if (!active && det.current.state !== 'idle') {
        // userState flips to idle `threshold` after the last input; a lock is away from now.
        det.current.idleSince = d.userState === 'idle' ? Date.now() - thresholdMs : Date.now();
      }
      det.current.state = d.userState === null ? null : active ? 'active' : 'idle';
      if (active && current && current.back === null) setPending(emp, { ...current, back: Date.now() });
    };
    d.addEventListener('change', onChange);
    d.start({ threshold: Math.max(60_000, thresholdMs), signal: ctl.signal }).then(onChange, () => undefined);
    return () => {
      ctl.abort();
      d.removeEventListener('change', onChange);
      det.current.state = null;
    };
  }, [emp, watch, granted, thresholdMs]);

  // Every few seconds: open an idle span once there has been no input for the threshold.
  useEffect(() => {
    if (!emp || !watch) return;
    const startMs = sessionStart ? Date.parse(sessionStart) : 0;
    const tick = () => {
      if (current) return;
      const now = Date.now();
      const d = det.current;
      let lastActive: number;
      if (d.state === 'active') lastActive = now;
      else if (d.state === 'idle') lastActive = d.idleSince;
      // Without the detector a hidden tab can't see the user (they may be working in another app).
      else if (document.visibilityState !== 'visible') return;
      else lastActive = Math.max(lastLocal.current, read<number>(activityKey(emp)) ?? 0);
      lastActive = Math.max(lastActive, startMs);
      if (now - lastActive >= thresholdMs) setPending(emp, { clientId: uuid(), since: lastActive, back: null });
    };
    const t = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(t);
  }, [emp, watch, thresholdMs, sessionStart]);

  return granted && !!Detector;
}

/** Mounted once in the app shell. */
export function IdleWatcher() {
  const { user } = useAuth();
  const emp = user?.employeeId && (user.permissions ?? []).includes('attendance.self') ? user.employeeId : null;
  const today = useToday(!!emp).data;
  const watch = !!emp && today?.state === 'IN' && today.webIdleWatch;
  const thresholdMs = Math.max(1, today?.idleThresholdMinutes ?? 5) * 60_000;
  const systemWide = useIdleEngine(emp, watch, thresholdMs, today?.openSessionStart ?? null);
  const pending = useIdlePending();
  if (!emp || !pending || pending.back === null) return null;
  return <IdleReasonDialog key={pending.clientId} emp={emp} pending={{ ...pending, back: pending.back }} systemWide={systemWide} />;
}

const CHOICES: { reason: Exclude<IdleSpanReason, 'OTHER'>; label: string }[] = [
  { reason: 'BREAK', label: 'Break' },
  { reason: 'MEETING', label: 'Meeting' },
];

/** "You were idle for 18m": Break / Meeting save at once; Others asks for the reason first. No dismiss. */
function IdleReasonDialog({ emp, pending, systemWide }: { emp: string; pending: PendingIdle & { back: number }; systemWide: boolean }) {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [other, setOther] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const from = timeOf(new Date(pending.since).toISOString());
  const to = timeOf(new Date(pending.back).toISOString());
  const minutes = Math.max(1, Math.round((pending.back - pending.since) / 60_000));
  const noteOk = note.trim().length >= 3;

  const save = async (reason: IdleSpanReason) => {
    if (busy || (reason === 'OTHER' && !noteOk)) return;
    setBusy(true);
    try {
      const r = await post<IdleSpanResult>('/attendance/me/idle', {
        clientId: pending.clientId,
        startedAt: new Date(pending.since).toISOString(),
        endedAt: new Date(pending.back).toISOString(),
        reason,
        ...(reason === 'OTHER' ? { note: note.trim() } : {}),
      });
      // Refresh the timeline first so the saved span replaces the live one without a flicker.
      await qc.invalidateQueries({ queryKey: ['time', 'timeline'] }).catch(() => undefined);
      setPending(emp, null);
      toast(r.message);
    } catch (e) {
      // A span the server will never take (no session then, locked period) is dropped, not asked again.
      if (e instanceof HttpError && [403, 404, 409, 422].includes(e.status)) setPending(emp, null);
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`You were idle for ${dur(minutes)}`} onClose={() => undefined}>
      <div className="dialog-body">
        No activity from {from} to {to}. What were you doing? It shows on your attendance timeline with this reason.
      </div>
      {other ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="field">
            <label htmlFor="idle-note">Reason</label>
            <input
              id="idle-note"
              className="input"
              maxLength={200}
              autoFocus
              value={note}
              placeholder="e.g. Power cut at home"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save('OTHER')}
            />
          </div>
          <div className="dialog-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setOther(false)}>Back</button>
            <button className="btn btn-primary" disabled={busy || !noteOk} onClick={() => void save('OTHER')}>Save</button>
          </div>
        </div>
      ) : (
        <div className="time-idle-choices">
          {CHOICES.map((c) => (
            <button key={c.reason} className="btn btn-secondary" disabled={busy} onClick={() => void save(c.reason)}>
              {c.label}
            </button>
          ))}
          <button className="btn btn-secondary" disabled={busy} onClick={() => setOther(true)}>Others</button>
        </div>
      )}
      {!systemWide && (
        <div className="faint" style={{ fontSize: 12 }}>
          Only activity in HRMS tabs is seen here, so work in other apps can show as idle.
          {Detector && (
            <>
              {' '}
              <button className="btn btn-ghost btn-sm" onClick={requestIdlePermission}>Allow idle detection</button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
