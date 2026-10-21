import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AttendanceToday, LatePrompt, PunchResult } from '@lexisora/shared';
import { Modal } from '@/components/ui';
import { HttpError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { dur, hhmmss, tk, useToday } from './api';
import { requestIdlePermission } from './idle';
// The dashboard's PunchCard uses time-* classes (timer, notes): load them with the card, not only
// when an Attendance / Timesheet page happened to be opened first.
import './time.css';

/**
 * Punch controls owned by Time (ARCHITECTURE §8):
 *  - usePunch(): shared state + toggle (server-driven, policy-aware)
 *  - PunchButton: header "Punch in / Punch out"
 *  - PunchCard: dashboard "Today" card
 *  - LatePunchDialog (app shell): "You're late" — the server answers a late first punch-in with
 *    422 LATE_REASON_REQUIRED + the figures (within the month's allowed lates: the reason is the
 *    permission), or 422 LATE_CONFIRM_REQUIRED (beyond the limit: a notice that the first half
 *    becomes half-day leave); the punch is re-sent with the reason / acknowledgement given here.
 * Every punch button shares one busy flag (module store), and each click sends one Idempotency-Key,
 * so a double click / two buttons can't punch twice.
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

// ── shared store: busy flag + the open "You're late" question ─────────────
/** null = cancelled (nothing is punched). */
type LateAnswer = { reason: string | null } | null;
type LateAsk = { prompt: LatePrompt; answer: (a: LateAnswer) => void };
let state: { busy: boolean; late: LateAsk | null } = { busy: false, late: null };
const listeners = new Set<() => void>();
const setState = (patch: Partial<typeof state>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const usePunchStore = () => useSyncExternalStore(subscribe, () => state);

/** Opens the dialog and resolves with the answer (reason, optional beyond the limit), or null when cancelled. */
function askLate(prompt: LatePrompt): Promise<LateAnswer> {
  return new Promise((resolve) => setState({ late: { prompt, answer: (a) => (setState({ late: null }), resolve(a)) } }));
}

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Seconds worked today (closed sessions + the open one), ticking every second. */
function useElapsed(today: AttendanceToday | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  const open = today?.openSessionStart;
  const serverNow = today?.serverNow;
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open]);
  // Server-minus-client clock offset, captured once per response. Recomputing it on every
  // render would cancel out `now` and freeze the timer.
  const offset = useMemo(() => (serverNow ? Date.parse(serverNow) - Date.now() : 0), [serverNow]);
  if (!today) return 0;
  const openSec = open ? Math.max(0, (now + offset - Date.parse(open)) / 1000) : 0;
  return today.workedSecondsClosed + openSec;
}

export function usePunch() {
  const { user } = useAuth();
  const enabled = !!user?.employeeId && (user?.permissions ?? []).includes('attendance.self');
  const q = useToday(enabled);
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const { busy } = usePunchStore();
  const today = q.data;
  const elapsedSec = useElapsed(today);

  // Punches from any source (web tab, desktop tracker, biometric) and recomputed days refresh every screen.
  useEffect(() => {
    if (!enabled) return;
    const refreshToday = () => void qc.invalidateQueries({ queryKey: tk.today });
    const refreshDays = () => {
      refreshToday();
      void qc.invalidateQueries({ queryKey: ['time', 'month'] });
      void qc.invalidateQueries({ queryKey: ['time', 'timeline'] });
    };
    const offs = [onRealtime('attendance.state', refreshDays), onRealtime('attendance.day.updated', refreshDays), onRealtime('policy.updated', refreshToday)];
    return () => offs.forEach((o) => o());
  }, [enabled, qc]);

  const punchedIn = today?.state === 'IN';
  const blocked = !!today && !punchedIn && !today.webPunchAllowed;
  /** Punched in somewhere the web can't close (biometric): punch out there. */
  const outElsewhere = !!today && punchedIn && !today.canPunchOut;
  const label = punchedIn ? 'Punch out' : 'Punch in';

  async function toggle() {
    if (!today || state.busy) return;
    if (blocked) {
      toast(today.blockReason ?? 'Web punch is not allowed for you right now');
      return;
    }
    if (outElsewhere) {
      toast(today.blockReason ?? `Punch out where you punched in (${(today.openSessionSource ?? 'device').toLowerCase()})`);
      return;
    }
    // The browser only shows this prompt on a click; with it, idle sees input in other apps too.
    if (!punchedIn) requestIdlePermission();
    setState({ busy: true });
    const direction = punchedIn ? 'OUT' : 'IN';
    const key = newKey();
    let geo: { lat: number; lng: number; accuracyM: number } | null = null;
    let lateReason: string | null = null;
    let lateAck = false;
    let lateAnswered = false;
    const send = () =>
      api<PunchResult>('/attendance/me/punch', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { direction, ...(geo ?? {}), ...(lateReason ? { lateReason } : {}), ...(lateAck ? { lateAck: true } : {}) },
      });
    try {
      let res: PunchResult | null = null;
      // At most: location retry, then late reason retry.
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try {
          res = await send();
        } catch (e) {
          if (e instanceof HttpError && (e.code === 'GEO_REQUIRED' || e.code === 'GEO_LOW_ACCURACY') && !geo) {
            geo = await getGeo();
            if (!geo) throw new HttpError(403, 'GEO_REQUIRED', 'Location permission required · allow location access and try again');
            continue;
          }
          if (e instanceof HttpError && (e.code === 'LATE_REASON_REQUIRED' || e.code === 'LATE_CONFIRM_REQUIRED') && !lateAnswered && e.details) {
            const prompt = e.details as LatePrompt;
            const a = await askLate(prompt);
            if (!a) return; // cancelled: nothing was punched
            lateAnswered = true;
            lateReason = a.reason;
            lateAck = prompt.overLimit;
            continue;
          }
          throw e;
        }
      }
      if (!res) return;
      qc.setQueryData(tk.today, res.today);
      void qc.invalidateQueries({ queryKey: ['time', 'month'] });
      void qc.invalidateQueries({ queryKey: ['time', 'timeline'] });
      if (res.today.late.lateHalfDay && direction === 'IN') void qc.invalidateQueries({ queryKey: ['leavepay'] });
      toast(res.message);
    } catch (e) {
      toastError(e);
    } finally {
      setState({ busy: false });
    }
  }

  return {
    today,
    loading: q.isLoading,
    error: q.error,
    retry: () => void q.refetch(),
    enabled,
    punchedIn,
    blocked,
    outElsewhere,
    busy,
    label,
    title: today?.title ?? 'Not punched in',
    elapsed: hhmmss(elapsedSec),
    elapsedSec,
    toggle,
  };
}

/** "Late by 1h 12m" tag text for today (null when on time / not in yet). */
export function lateText(t: AttendanceToday | undefined): string | null {
  const l = t?.late;
  if (!l?.isLate || l.lateByMinutes <= 0) return null;
  const count = l.lateAllowed > 0 && l.lateCount > 0 ? (l.lateOverLimit ? ` · late ${l.lateCount} this month (${l.lateAllowed} allowed)` : ` · ${l.lateCount} of ${l.lateAllowed} allowed`) : '';
  return `Late by ${dur(l.lateByMinutes)}${count}${l.lateHalfDay ? ' · half day' : ''}`;
}

/** Header button. Hidden when the viewer has no employee record (platform admin). */
export function PunchButton() {
  const p = usePunch();
  if (!p.enabled || !p.today) return null;
  const why = p.blocked || p.outElsewhere ? (p.today.blockReason ?? (p.outElsewhere ? 'Punch out where you punched in' : 'Web punch is not allowed')) : undefined;
  return (
    <button
      className={`btn btn-sm topbar-punch ${p.punchedIn ? 'btn-secondary' : 'btn-primary'}`}
      onClick={() => void p.toggle()}
      disabled={p.busy}
      aria-disabled={!!why}
      title={why ?? (p.punchedIn ? `Worked ${p.elapsed}` : `Shift ${p.today.shift.start} · late after ${p.today.late.lateAfter}`)}
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
  const late = lateText(t);
  return (
    <div className="card" data-screen-label="Today">
      <div className="card-kicker">Today</div>
      <div className="card-title">{p.title}</div>
      <div className="time-elapsed">{p.elapsed}</div>
      {p.error && !t ? (
        <div className="time-blocked">
          Couldn't load today's attendance. <button className="btn btn-ghost btn-sm" onClick={p.retry}>Retry</button>
        </div>
      ) : (
        <div className="card-meta">
          {t ? `Shift ${t.shift.start} – ${t.shift.end}${t.late.workingDay ? ` · late after ${t.late.lateAfter}` : ''} · ${t.modeNote}` : 'Loading…'}
        </div>
      )}
      {late && <div className="time-late-note">{late}{t?.late.reason ? ` · “${t.late.reason}”` : ''}</div>}
      {t && (p.blocked || p.outElsewhere) ? (
        <div className="time-blocked">{t.blockReason ?? (p.outElsewhere ? 'Punch out where you punched in.' : 'Web punch is not allowed for you right now.')}</div>
      ) : (
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => void p.toggle()} disabled={!t || p.busy}>
          {p.busy ? 'Saving…' : p.label}
        </button>
      )}
    </div>
  );
}

/**
 * "You're late" — opened by a LATE_REASON_REQUIRED / LATE_CONFIRM_REQUIRED reply to a punch-in.
 * Shows the shift start, grace, the punch time, which late of the month this is and what it costs.
 * Within the month's allowed lates the reason is the permission (required); beyond the limit there is
 * nothing to permit: it is a notice (the first half becomes half-day leave) with an optional note.
 */
export function LatePunchDialog() {
  const { late } = usePunchStore();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setReason('');
    setErr(null);
  }, [late]);
  if (!late) return null;
  const p = late.prompt;
  const go = () => {
    const r = reason.trim();
    if (p.reasonRequired && r.length < 5) return setErr('Write the reason (at least 5 characters)');
    if (r && r.length < 5) return setErr('Write at least 5 characters, or leave the note empty');
    late.answer({ reason: r || null });
  };
  const title = p.overLimit
    ? `Late ${p.lateCount} times this month — half day`
    : p.halfDay
      ? `You're ${dur(p.lateByMinutes)} late — half day`
      : `You're ${dur(p.lateByMinutes)} late`;
  return (
    <Modal
      title={title}
      onClose={() => late.answer(null)}
      actions={
        <>
          <button className="btn btn-secondary" onClick={() => late.answer(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={go}>{p.overLimit ? 'OK, punch in' : 'Punch in'}</button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="kv-row"><span>Shift starts</span><span className="tnum">{p.shiftStart}</span></div>
        <div className="kv-row"><span>Grace</span><span className="tnum">{p.graceMinutes} min · until {p.lateAfter}</span></div>
        <div className="kv-row"><span>Punching in at</span><span className="tnum">{p.punchAt}</span></div>
        <div className="kv-row"><span>Late by</span><span className="tnum" style={{ fontWeight: 600 }}>{dur(p.lateByMinutes)}</span></div>
        {p.lateAllowed > 0 && (
          <div className="kv-row">
            <span>Late this month</span>
            <span className="tnum" style={{ fontWeight: 600 }}>{p.overLimit ? `${p.lateCount} · only ${p.lateAllowed} allowed` : `${p.lateCount} of ${p.lateAllowed} allowed`}</span>
          </div>
        )}
        <div className={p.halfDay ? 'time-late-warn' : 'note'}>{p.consequence}</div>
        <div className="field">
          <label htmlFor="late-reason">{p.reasonRequired ? 'Why are you late?' : 'Note (optional)'}</label>
          <textarea id="late-reason" className="input" autoFocus value={reason} maxLength={300} placeholder="e.g. Train delayed by an hour / Hospital visit in the morning" onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && go()} />
          <div className="field-hint">Your manager sees this with your attendance.</div>
        </div>
        {err && <div className="field-error">{err}</div>}
      </div>
    </Modal>
  );
}
