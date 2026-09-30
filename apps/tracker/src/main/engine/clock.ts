/**
 * Trusted device time (spec T5 §5 "Clock change detection", T8 "Clock changed").
 *
 * Every read compares how far the wall clock moved with how far the monotonic clock moved
 * since the previous read:
 *
 *     drift = Δwall − Δmono
 *
 * |drift| > 30 s outside a suspend/resume window means somebody changed the PC clock. The
 * tracker then keeps its own timeline continuous by carrying an offset
 * (trusted = wall + offset): segments never overlap (clock set back) or stretch (clock set
 * forward), and the change is reported once as CLOCK_CHANGE {driftSec} for the integrity view.
 *
 * The offset ends when
 *   - a later change brings the PC clock back in line with the tracker's timeline, or
 *   - a server-verified time (heartbeat / sync `serverTime`) agrees with the PC clock again.
 *     A correction that would move time backwards waits until nothing is being tracked.
 *
 * Sleep is not a clock change. The monotonic clock may not count time spent asleep, so
 *   - detection stays quiet around suspend / resume signals, and
 *   - a forward jump is only confirmed after a short wait: a resume signal arriving in that
 *     window (Windows sometimes delivers resume without the matching suspend) turns it back
 *     into elapsed time, which the caller then handles as a sleep gap.
 * A backward jump can't be sleep and is reported at once. Handed-out time never runs
 * backwards (a clamp is the last-resort guard).
 *
 * Pure: the time source is injected, so every rule is unit-tested with fake clocks.
 */
export interface TimeSource {
  /** Epoch ms (Date.now). */
  wall(): number;
  /** Monotonic ms (performance.now). */
  mono(): number;
}

export const CLOCK_CHANGE_THRESHOLD_MS = 30_000;
/** Detection stays quiet this long (monotonic) after a suspend / resume signal. */
export const POWER_QUIET_MS = 15_000;
/** A forward jump is confirmed as a clock change when no resume signal follows within this time. */
export const FORWARD_CONFIRM_MS = 10_000;

export type ClockChange = {
  /** Trusted time at which the change was noticed. */
  at: number;
  /** Wall-clock jump relative to real elapsed time, seconds (negative = set back). */
  driftSec: number;
  /** JUMP = while running; RESTART = the PC clock is behind the last time recorded before a restart. */
  cause: 'JUMP' | 'RESTART';
};

type PendingForward = { change: ClockChange; driftMs: number; untilMono: number };

export class TrustedClock {
  private offset = 0;
  private lastWall: number;
  private lastMono: number;
  private floor = Number.NEGATIVE_INFINITY;
  private quietUntilMono = Number.NEGATIVE_INFINITY;
  private pending: PendingForward | null = null;
  private readonly changes: ClockChange[] = [];

  constructor(
    private readonly src: TimeSource,
    private readonly thresholdMs = CLOCK_CHANGE_THRESHOLD_MS,
  ) {
    this.lastWall = src.wall();
    this.lastMono = src.mono();
  }

  /** True while the tracker's time differs from the (changed) PC clock. */
  get adjusted(): boolean {
    return this.offset !== 0;
  }

  /** trusted − wall, ms. */
  get offsetMs(): number {
    return this.offset;
  }

  /** A forward jump is waiting for confirmation (it may still turn out to be sleep). */
  get unsettled(): boolean {
    this.observe();
    return this.pending !== null;
  }

  /** Trusted epoch ms; never lower than a value already handed out. */
  now(): number {
    this.observe();
    const t = this.src.wall() + this.offset;
    if (t > this.floor) this.floor = t;
    return this.floor;
  }

  /** Confirmed changes since the last call (the caller reports them to the server). */
  takeChanges(): ClockChange[] {
    this.observe();
    return this.changes.splice(0, this.changes.length);
  }

  /**
   * powerMonitor suspend / resume. Time asleep is not a clock change: detection pauses briefly,
   * and on resume a forward jump that is still unconfirmed is given back as elapsed time.
   */
  notePower(kind: 'SUSPEND' | 'RESUME') {
    this.observe();
    if (kind === 'RESUME' && this.pending) {
      this.offset = this.settleOffset(this.offset + this.pending.driftMs);
      this.pending = null;
    }
    this.quietUntilMono = this.src.mono() + POWER_QUIET_MS;
  }

  /**
   * A server-verified time (ms). Ends the adjustment once the PC clock agrees with the server
   * again. Moving time backwards (the tracker's timeline was ahead) only happens when
   * `allowBackwards` — i.e. nothing is being tracked; even then handed-out time holds still
   * rather than decreasing. Returns true when the adjustment ended.
   */
  verify(serverMs: number, allowBackwards: boolean): boolean {
    if (!Number.isFinite(serverMs)) return false;
    this.observe();
    if (this.offset === 0) return false;
    if (Math.abs(this.src.wall() - serverMs) > this.thresholdMs) return false;
    if (this.offset > 0 && !allowBackwards) return false;
    this.offset = 0;
    return true;
  }

  /**
   * Start-up check: the PC clock is behind the last time the tracker recorded before it was
   * closed → it was set back while the tracker wasn't running. The timeline continues from
   * that point (the unknown downtime counts as zero until the server corrects the skew).
   */
  resumeFrom(lastRecorded: number | null | undefined): ClockChange | null {
    if (!lastRecorded || !Number.isFinite(lastRecorded)) return null;
    this.observe();
    const behind = lastRecorded - (this.src.wall() + this.offset);
    if (behind <= this.thresholdMs) return null;
    this.offset += behind;
    const change: ClockChange = { at: this.now(), driftSec: -Math.round(behind / 1000), cause: 'RESTART' };
    this.changes.push(change);
    return change;
  }

  private settleOffset(offset: number): number {
    // Within the threshold of the PC clock → follow the PC clock again.
    return Math.abs(offset) <= this.thresholdMs ? 0 : offset;
  }

  private observe() {
    const wall = this.src.wall();
    const mono = this.src.mono();
    const drift = wall - this.lastWall - (mono - this.lastMono);
    this.lastWall = wall;
    this.lastMono = mono;
    if (mono >= this.quietUntilMono && Math.abs(drift) > this.thresholdMs) {
      this.offset = this.settleOffset(this.offset - drift);
      const change: ClockChange = { at: Math.max(wall + this.offset, this.floor), driftSec: Math.round(drift / 1000), cause: 'JUMP' };
      if (drift > 0) {
        if (this.pending) this.changes.push(this.pending.change);
        this.pending = { change, driftMs: drift, untilMono: mono + FORWARD_CONFIRM_MS };
      } else {
        this.changes.push(change);
      }
    }
    if (this.pending && mono >= this.pending.untilMono) {
      this.changes.push(this.pending.change);
      this.pending = null;
    }
  }
}

/** "−2h 00m" / "+45s" for logs and notices. */
export function formatDrift(driftSec: number): string {
  const sign = driftSec < 0 ? '−' : '+';
  const abs = Math.abs(Math.round(driftSec));
  if (abs < 60) return `${sign}${abs}s`;
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  return h ? `${sign}${h}h ${String(m).padStart(2, '0')}m` : `${sign}${m}m`;
}
