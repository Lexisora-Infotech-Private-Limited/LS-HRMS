import { IdleMachine, type IdlePhase } from './idle';
import { SegmentBuilder } from './segments';
import { computeTotals, type DayTotals, type LiveState } from './summary';
import {
  DEFAULT_CONFIG,
  EngineError,
  emptyOutput,
  type EngineConfig,
  type EngineEvent,
  type EngineOutput,
  type IdleCause,
  type OpenSegment,
  type Resolution,
  type Segment,
  type Status,
} from './types';

/**
 * The device tracking engine (spec T3 §3):
 *
 *   OUT --punchIn--> WORKING --startBreak--> BREAK --endBreak--> WORKING
 *   WORKING --idle >= threshold | lock/suspend >= threshold--> WORKING + idle prompt
 *   prompt --resolve(WORKING | BREAK | IDLE)--> WORKING
 *   WORKING | BREAK --punchOut--> OUT          (blocked while the idle prompt is open)
 *
 * The engine is pure: callers pass `now` (epoch ms) and the system idle seconds, and
 * persist `snapshot()`; outputs are events + closed segments to queue for the server.
 */
export interface EngineSnapshot {
  v: 1;
  dayKey: string;
  status: Status;
  /** The session was opened elsewhere (biometric / web) — no PUNCH events from this device. */
  attached: boolean;
  activeTaskId: string | null;
  open: OpenSegment | null;
  idle: IdlePhase;
  segments: Segment[];
  shots: number;
  activeSec: number;
  nextShotAtActiveSec: number;
  continuousWorkSec: number;
  breakReminded: boolean;
  breakStartedAt: number | null;
  lastTickAt: number | null;
  quitAt: number | null;
  firstInAt: number | null;
  lastOutAt: number | null;
}

export interface EngineDeps {
  uuid: () => string;
  dayKey: (ms: number) => string;
  config?: Partial<EngineConfig>;
  snapshot?: EngineSnapshot | null;
  now?: number;
}

/** A break of at least this long resets the continuous-work block for reminders. */
export const REMINDER_RESET_BREAK_SEC = 300;
/** Max seconds credited per tick to the shot clock (guards against sleep without events). */
const MAX_TICK_SEC = 10;

export class TrackerEngine {
  private s: EngineSnapshot;
  private cfg: EngineConfig;
  private readonly seg: SegmentBuilder;
  private readonly idle: IdleMachine;

  constructor(private readonly deps: EngineDeps) {
    this.cfg = { ...DEFAULT_CONFIG, ...(deps.config ?? {}) };
    this.seg = new SegmentBuilder(deps.uuid);
    const now = deps.now ?? Date.now();
    this.s = deps.snapshot ? structuredClone(deps.snapshot) : this.fresh(now);
    this.idle = new IdleMachine(this.s.idle);
  }

  private fresh(now: number): EngineSnapshot {
    return {
      v: 1,
      dayKey: this.deps.dayKey(now),
      status: 'OUT',
      attached: false,
      activeTaskId: null,
      open: null,
      idle: { phase: 'ACTIVE' },
      segments: [],
      shots: 0,
      activeSec: 0,
      nextShotAtActiveSec: this.cfg.screenshotIntervalSec,
      continuousWorkSec: 0,
      breakReminded: false,
      breakStartedAt: null,
      lastTickAt: null,
      quitAt: null,
      firstInAt: null,
      lastOutAt: null,
    };
  }

  // ── read side ────────────────────────────────────────────────────────────
  get status(): Status {
    return this.s.status;
  }
  get attached() {
    return this.s.attached;
  }
  get activeTaskId() {
    return this.s.activeTaskId;
  }
  get segments(): readonly Segment[] {
    return this.s.segments;
  }
  get shots() {
    return this.s.shots;
  }
  get config(): EngineConfig {
    return this.cfg;
  }
  get idleState(): IdlePhase {
    return this.idle.state;
  }
  get prompting() {
    return this.idle.prompting;
  }
  get away() {
    return this.idle.away;
  }
  get firstInAt() {
    return this.s.firstInAt;
  }
  get lastOutAt() {
    return this.s.lastOutAt;
  }
  get dayKey() {
    return this.s.dayKey;
  }
  get openSegment(): OpenSegment | null {
    return this.s.open;
  }

  snapshot(): EngineSnapshot {
    this.s.idle = this.idle.state;
    return structuredClone(this.s);
  }

  live(now: number): LiveState {
    const st = this.idle.state;
    return {
      open: this.s.open,
      openEnd: st.phase === 'AWAY' ? Math.max(this.s.open?.startedAt ?? st.since, st.since) : now,
      pendingIdle: st.phase === 'PROMPT' ? { since: st.since, end: Math.min(now, st.inputAt ?? now) } : null,
    };
  }

  totals(now: number): DayTotals {
    return computeTotals(this.s.segments, this.live(now));
  }

  /** Seconds of active time until the next screenshot, or null if screenshots don't apply. */
  nextShotInSec(): number | null {
    if (!this.cfg.screenshotsEnabled || this.s.status === 'OUT') return null;
    return Math.max(0, Math.ceil(this.s.nextShotAtActiveSec - this.s.activeSec));
  }

  /** Screenshot clock paused (break, idle prompt, locked). */
  get shotsPaused() {
    return this.s.status !== 'WORKING' || this.idle.state.phase !== 'ACTIVE';
  }

  // ── configuration (policy push) ─────────────────────────────────────────
  setConfig(next: Partial<EngineConfig>) {
    const prevInterval = this.cfg.screenshotIntervalSec;
    this.cfg = { ...this.cfg, ...next };
    if (next.screenshotIntervalSec !== undefined && next.screenshotIntervalSec !== prevInterval) {
      // Spec T2: the new interval applies to the remaining countdown as min(remaining, newInterval).
      const remaining = Math.min(Math.max(0, this.s.nextShotAtActiveSec - this.s.activeSec), next.screenshotIntervalSec);
      this.s.nextShotAtActiveSec = this.s.activeSec + remaining;
    }
  }

  // ── commands ────────────────────────────────────────────────────────────
  private ev(e: Omit<EngineEvent, 'clientId'>): EngineEvent {
    return { clientId: this.deps.uuid(), ...e };
  }

  private push(out: EngineOutput, seg: Segment | null) {
    if (seg) {
      this.s.segments.push(seg);
      out.segments.push(seg);
    }
  }

  /** Start a new business day's local totals (only while not punched in). */
  rollDay(now: number): boolean {
    const key = this.deps.dayKey(now);
    if (this.s.status !== 'OUT' || key === this.s.dayKey) return false;
    const keepTask = this.s.activeTaskId;
    this.s = this.fresh(now);
    this.s.activeTaskId = keepTask;
    this.idle.reset();
    return true;
  }

  punchIn(now: number, taskId: string | null, opts: { attached?: boolean } = {}): EngineOutput {
    if (this.s.status !== 'OUT') throw new EngineError('ALREADY_PUNCHED_IN', 'You are already punched in');
    this.rollDay(now);
    const out = emptyOutput();
    this.s.status = 'WORKING';
    this.s.attached = !!opts.attached;
    this.s.activeTaskId = taskId ?? this.s.activeTaskId;
    this.s.open = this.seg.open('WORK', this.s.activeTaskId, now);
    this.idle.reset();
    this.s.firstInAt ??= now;
    this.s.nextShotAtActiveSec = this.s.activeSec + this.cfg.screenshotIntervalSec;
    this.s.continuousWorkSec = 0;
    this.s.breakReminded = false;
    this.s.quitAt = null;
    this.s.lastTickAt = now;
    if (!this.s.attached) out.events.push(this.ev({ type: 'PUNCH_IN', at: now, taskId: this.s.activeTaskId }));
    return out;
  }

  /**
   * Punch out (user) or detach (the session was closed elsewhere: web punch-out,
   * biometric out, HR revoke). Detach auto-deducts an unresolved idle span.
   */
  punchOut(now: number, opts: { detach?: boolean } = {}): EngineOutput {
    if (this.s.status === 'OUT') throw new EngineError('NOT_PUNCHED_IN', 'You are not punched in');
    const out = emptyOutput();
    if (this.idle.prompting) {
      if (!opts.detach) throw new EngineError('IDLE_UNRESOLVED', 'Choose how to count your idle time first');
      const r = this.resolveIdle(now, 'IDLE');
      out.events.push(...r.events);
      out.segments.push(...r.segments);
    }
    let end = now;
    const st = this.idle.state;
    if (st.phase === 'AWAY') end = Math.max(st.since, this.s.open?.startedAt ?? st.since);
    if (this.s.open) this.push(out, this.seg.close(this.s.open, end));
    this.s.open = null;
    this.idle.reset();
    this.s.status = 'OUT';
    this.s.attached = false;
    this.s.lastOutAt = end;
    this.s.breakStartedAt = null;
    if (!opts.detach) out.events.push(this.ev({ type: 'PUNCH_OUT', at: now, taskId: this.s.activeTaskId }));
    return out;
  }

  startBreak(now: number): EngineOutput {
    if (this.s.status === 'OUT') throw new EngineError('NOT_PUNCHED_IN', 'Punch in first');
    if (this.s.status === 'BREAK') throw new EngineError('ON_BREAK', 'You are already on a break');
    if (this.idle.prompting) throw new EngineError('IDLE_UNRESOLVED', 'Choose how to count your idle time first');
    const out = emptyOutput();
    this.idle.reset();
    if (this.s.open) this.push(out, this.seg.close(this.s.open, now));
    this.s.open = this.seg.open('BREAK', null, now);
    this.s.status = 'BREAK';
    this.s.breakStartedAt = now;
    out.events.push(this.ev({ type: 'BREAK_START', at: now, taskId: this.s.activeTaskId }));
    return out;
  }

  endBreak(now: number): EngineOutput {
    if (this.s.status !== 'BREAK') throw new EngineError('NOT_ON_BREAK', 'You are not on a break');
    const out = emptyOutput();
    if (this.s.open) this.push(out, this.seg.close(this.s.open, now));
    this.s.open = this.seg.open('WORK', this.s.activeTaskId, now);
    this.s.status = 'WORKING';
    if (this.s.breakStartedAt !== null && now - this.s.breakStartedAt >= REMINDER_RESET_BREAK_SEC * 1000) {
      this.s.continuousWorkSec = 0;
      this.s.breakReminded = false;
    }
    this.s.breakStartedAt = null;
    this.s.lastTickAt = now;
    this.idle.reset();
    out.events.push(this.ev({ type: 'BREAK_END', at: now, taskId: this.s.activeTaskId }));
    return out;
  }

  toggleBreak(now: number): EngineOutput {
    return this.s.status === 'BREAK' ? this.endBreak(now) : this.startBreak(now);
  }

  switchTask(now: number, taskId: string | null): EngineOutput {
    const out = emptyOutput();
    if (taskId === this.s.activeTaskId) return out;
    if (this.s.status === 'OUT') {
      this.s.activeTaskId = taskId;
      return out;
    }
    if (this.idle.prompting) throw new EngineError('IDLE_UNRESOLVED', 'Choose how to count your idle time first');
    this.s.activeTaskId = taskId;
    if (this.s.status === 'WORKING' && this.s.open) {
      const { closed, next } = this.seg.split(this.s.open, now, taskId);
      this.push(out, closed);
      this.s.open = next;
    }
    out.events.push(this.ev({ type: 'TASK_SWITCH', at: now, taskId }));
    return out;
  }

  /** Called every second with powerMonitor.getSystemIdleTime(). */
  tick(now: number, idleSec: number): EngineOutput {
    const out = emptyOutput();
    const prev = this.s.lastTickAt ?? now;
    this.s.lastTickAt = now;
    if (this.s.status !== 'WORKING') return out;
    if (this.idle.away) return out;
    if (this.idle.prompting) {
      this.idle.tick(now, idleSec, this.cfg.idleThresholdSec);
      return out;
    }
    const r = this.idle.tick(now, idleSec, this.cfg.idleThresholdSec);
    if (r === 'DETECTED') {
      const st = this.idle.state as Extract<IdlePhase, { phase: 'PROMPT' }>;
      if (this.s.open) {
        st.since = Math.max(st.since, this.s.open.startedAt);
        this.push(out, this.seg.close(this.s.open, st.since));
        this.s.open = null;
      }
      out.events.push(this.ev({ type: 'IDLE_START', at: st.since, taskId: this.s.activeTaskId }));
      out.idleStarted = true;
      return out;
    }

    const dt = Math.min(MAX_TICK_SEC, Math.max(0, (now - prev) / 1000));
    this.s.activeSec += dt;
    this.s.continuousWorkSec += dt;
    if (this.cfg.screenshotsEnabled && this.s.activeSec >= this.s.nextShotAtActiveSec) {
      out.shotDue = true;
      this.s.nextShotAtActiveSec = this.s.activeSec + this.cfg.screenshotIntervalSec;
    }
    if (this.cfg.breakReminderSec > 0 && !this.s.breakReminded && this.s.continuousWorkSec >= this.cfg.breakReminderSec) {
      out.breakReminderDue = true;
      this.s.breakReminded = true;
    }
    // Checkpoint long WORK segments at the last input moment, so a later idle span never overlaps a closed segment.
    if (this.s.open && this.s.open.kind === 'WORK') {
      const lastInput = now - idleSec * 1000;
      if (lastInput - this.s.open.startedAt >= this.cfg.checkpointSec * 1000) {
        const { closed, next } = this.seg.split(this.s.open, lastInput);
        this.push(out, closed);
        this.s.open = next;
      }
    }
    return out;
  }

  /** Close the open WORK segment now and reopen it (used by "Add to weekly timesheet"). */
  checkpoint(now: number): EngineOutput {
    const out = emptyOutput();
    if (this.s.status === 'OUT' || !this.s.open || this.idle.state.phase !== 'ACTIVE') return out;
    const { closed, next } = this.seg.split(this.s.open, now);
    this.push(out, closed);
    this.s.open = next;
    return out;
  }

  /** lock-screen / suspend. */
  lock(now: number, cause: 'LOCK' | 'SUSPEND', lastInputAt?: number): EngineOutput {
    const out = emptyOutput();
    if (this.s.status === 'OUT') return out;
    out.events.push(this.ev({ type: cause === 'LOCK' ? 'LOCK' : 'SUSPEND', at: now, taskId: this.s.activeTaskId }));
    if (this.s.status === 'WORKING') this.idle.goAway(now, cause, lastInputAt);
    return out;
  }

  /** unlock-screen / resume. */
  unlock(now: number, kind: 'UNLOCK' | 'RESUME'): EngineOutput {
    const out = emptyOutput();
    if (this.s.status === 'OUT') return out;
    out.events.push(this.ev({ type: kind, at: now, taskId: this.s.activeTaskId }));
    const r = this.idle.comeBack(now, this.cfg.idleThresholdSec);
    this.s.lastTickAt = now;
    if (r === 'PROMPT') {
      const st = this.idle.state as Extract<IdlePhase, { phase: 'PROMPT' }>;
      if (this.s.open) {
        st.since = Math.max(st.since, this.s.open.startedAt);
        this.push(out, this.seg.close(this.s.open, st.since));
        this.s.open = null;
      }
      out.events.push(this.ev({ type: 'IDLE_START', at: st.since, taskId: this.s.activeTaskId }));
      out.idleStarted = true;
    }
    return out;
  }

  /**
   * The user's choice in the idle dialog:
   *   WORKING → IDLE_WORK segment (claimed; pending Project Lead review)
   *   BREAK   → BREAK segment
   *   IDLE    → IDLE segment (deducted)
   * Time after the first input (while the dialog was open) counts as WORK on the active task.
   */
  resolveIdle(now: number, resolution: Resolution, note?: string): EngineOutput {
    if (!this.idle.prompting) throw new EngineError('NO_IDLE', 'There is no idle time to classify');
    const out = emptyOutput();
    const span = this.idle.resolve(now)!;
    const kind = resolution === 'WORKING' ? 'IDLE_WORK' : resolution === 'BREAK' ? 'BREAK' : 'IDLE';
    const taskId = kind === 'IDLE_WORK' ? this.s.activeTaskId : null;
    this.push(out, this.seg.span(kind, taskId, span.since, span.end));
    if (span.end < now) this.push(out, this.seg.span('WORK', this.s.activeTaskId, span.end, now));
    this.s.open = this.seg.open('WORK', this.s.activeTaskId, now);
    this.s.status = 'WORKING';
    this.s.continuousWorkSec = 0;
    this.s.breakReminded = false;
    this.s.lastTickAt = now;
    out.events.push(
      this.ev({
        type: 'IDLE_RESOLVED',
        at: now,
        resolution,
        idleFrom: span.since,
        taskId: this.s.activeTaskId,
        ...(note ? { note } : {}),
      }),
    );
    return out;
  }

  /** Dev "Trigger 5-min idle": no input for the threshold; the user is back now. */
  simulateIdle(now: number): EngineOutput {
    const out = emptyOutput();
    if (this.s.status !== 'WORKING' || this.idle.state.phase !== 'ACTIVE') return out;
    const since = Math.max(now - Math.max(60, this.cfg.idleThresholdSec) * 1000, this.s.open?.startedAt ?? now);
    if (this.s.open) this.push(out, this.seg.close(this.s.open, since));
    this.s.open = null;
    this.idle.force(since, now);
    out.events.push(this.ev({ type: 'IDLE_START', at: since, taskId: this.s.activeTaskId }));
    out.idleStarted = true;
    return out;
  }

  /** Quit / shutdown while punched in: close what's open; the gap is prompted on next start. */
  appQuit(now: number): EngineOutput {
    const out = emptyOutput();
    if (this.s.status === 'OUT') return out;
    const st = this.idle.state;
    if (this.s.open) {
      const end = st.phase === 'AWAY' ? Math.max(st.since, this.s.open.startedAt) : now;
      this.push(out, this.seg.close(this.s.open, end));
      this.s.open = null;
      this.s.quitAt = end;
    } else {
      this.s.quitAt = now;
    }
    if (st.phase === 'AWAY') this.idle.reset();
    out.events.push(this.ev({ type: 'APP_QUIT', at: now, taskId: this.s.activeTaskId }));
    return out;
  }

  /**
   * App start with a persisted open session. A gap >= threshold becomes an
   * APP_NOT_RUNNING idle prompt ("Tracker wasn't running from 17:10 to 17:55");
   * a short gap is counted as work. A break simply continues.
   */
  recover(now: number): EngineOutput {
    const out = emptyOutput();
    if (this.s.status === 'OUT') {
      this.rollDay(now);
      this.s.lastTickAt = now;
      return out;
    }
    let lastSeen = this.s.quitAt ?? this.s.lastTickAt ?? now;
    const st = this.idle.state;
    if (st.phase === 'AWAY') {
      lastSeen = Math.min(lastSeen, st.since);
      this.idle.reset();
    }
    const openKind = this.s.open?.kind ?? (this.s.status === 'BREAK' ? 'BREAK' : 'WORK');
    if (this.s.open) {
      // Crash: the open segment never got closed — end it at the last tick we saw.
      this.push(out, this.seg.close(this.s.open, lastSeen));
      this.s.open = null;
    }
    this.s.quitAt = null;
    this.s.lastTickAt = now;
    if (this.idle.prompting) return out;
    if (this.s.status === 'BREAK' || openKind === 'BREAK') {
      this.s.open = this.seg.open('BREAK', null, lastSeen);
      return out;
    }
    const r = this.idle.gap(lastSeen, now, this.cfg.idleThresholdSec);
    if (r === 'VOID') {
      this.s.open = this.seg.open('WORK', this.s.activeTaskId, lastSeen);
    } else {
      out.events.push(this.ev({ type: 'IDLE_START', at: lastSeen, taskId: this.s.activeTaskId }));
      out.idleStarted = true;
    }
    return out;
  }

  shotTaken() {
    this.s.shots += 1;
  }

  get lastTickAt() {
    return this.s.lastTickAt;
  }

  idleCause(): IdleCause | null {
    const st = this.idle.state;
    return st.phase === 'PROMPT' ? st.cause : null;
  }
}
