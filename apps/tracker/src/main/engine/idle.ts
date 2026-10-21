import type { IdleCause } from './types';

/**
 * Idle state machine (orthogonal to punch/break status; only consulted while WORKING).
 *
 *   ACTIVE --no input >= threshold--------------------------> PROMPT(NO_INPUT, since = now - idleSec)
 *   ACTIVE --lock-screen / suspend---------------------------> AWAY(since = min(lastInput, now))
 *   AWAY   --resume to a locked screen-----------------------> AWAY          (still away until it unlocks)
 *   AWAY   --unlock / resume, away < threshold---------------> ACTIVE        (voided: counts as work)
 *   AWAY   --unlock, away >= threshold-----------------------> PROMPT(LOCK|SUSPEND, inputAt = now)
 *   AWAY   --resume, away >= threshold-----------------------> PROMPT(LOCK|SUSPEND, inputAt = first input)
 *   (startup) gap since last tick >= threshold --------------> PROMPT(APP_NOT_RUNNING, inputAt = now)
 *   PROMPT --first input seen on an unlocked screen----------> PROMPT(inputAt set; idle span ends there)
 *   PROMPT --lock-screen / suspend---------------------------> PROMPT(away again: inputAt cleared; a stretch
 *                                                              of >= 1 min back at the PC is kept as work)
 *   PROMPT --user choice-------------------------------------> ACTIVE
 *
 * While PROMPT is open the idle span [since, inputAt ?? now) is excluded from worked time,
 * and time after the first input is held back until the choice is made (then it counts as work).
 * Waking the PC is not the user coming back: a resume to the lock screen waits for the unlock,
 * and a resume without one waits for real keyboard / mouse input.
 */
export type BackSpan = { from: number; to: number };

export type IdlePhase =
  | { phase: 'ACTIVE' }
  | { phase: 'AWAY'; since: number; cause: 'LOCK' | 'SUSPEND'; locked?: boolean }
  | {
      phase: 'PROMPT';
      since: number;
      cause: IdleCause;
      detectedAt: number;
      inputAt: number | null;
      /** The screen is locked: input there is not the user coming back. */
      locked?: boolean;
      /** Stretches the user was back at the PC before going away again (counted as work). */
      back?: BackSpan[];
    };

/** System idle below this means "the user touched something". */
export const INPUT_EPSILON_SEC = 2;
/** Back at the PC for less than this before going away again is folded into the idle span. */
export const MIN_BACK_MS = 60_000;
/** Input this long after going away, on a screen known to be unlocked, means a lost unlock / resume signal. */
export const MISSED_SIGNAL_GRACE_MS = 10_000;

type Prompt = Extract<IdlePhase, { phase: 'PROMPT' }>;

/** Input can't end the idle span before its start or before the user last went away again. */
const floorOf = (s: Prompt) => Math.max(s.since, s.back?.at(-1)?.to ?? s.since);

export class IdleMachine {
  constructor(public state: IdlePhase = { phase: 'ACTIVE' }) {}

  get prompting() {
    return this.state.phase === 'PROMPT';
  }
  get away() {
    return this.state.phase === 'AWAY';
  }

  /**
   * Poll result from powerMonitor.getSystemIdleTime(). `screenLocked` comes from
   * powerMonitor.getSystemIdleState(): null when the OS can't tell.
   */
  tick(now: number, idleSec: number, thresholdSec: number, screenLocked: boolean | null = null): 'DETECTED' | 'INPUT' | null {
    const s = this.state;
    if (s.phase === 'ACTIVE') {
      if (thresholdSec > 0 && idleSec >= thresholdSec) {
        this.state = { phase: 'PROMPT', since: now - idleSec * 1000, cause: 'NO_INPUT', detectedAt: now, inputAt: null };
        return 'DETECTED';
      }
      return null;
    }
    if (s.phase === 'PROMPT' && s.inputAt === null && idleSec < INPUT_EPSILON_SEC) {
      if (screenLocked === true || (s.locked && screenLocked !== false)) return null;
      s.locked = false;
      s.inputAt = Math.max(floorOf(s), now - idleSec * 1000);
      return 'INPUT';
    }
    return null;
  }

  /** Real input on a screen known to be unlocked while still AWAY: the unlock / resume signal never came. */
  inputWhileAway(now: number, idleSec: number, screenLocked: boolean | null): boolean {
    const s = this.state;
    return s.phase === 'AWAY' && screenLocked === false && idleSec < INPUT_EPSILON_SEC && now - s.since >= MISSED_SIGNAL_GRACE_MS;
  }

  /** lock-screen / suspend. Returns true when the user just went away from active work. */
  goAway(now: number, cause: 'LOCK' | 'SUSPEND', lastInputAt?: number): boolean {
    const s = this.state;
    if (s.phase === 'ACTIVE') {
      const since = Math.min(now, lastInputAt ?? now);
      this.state = { phase: 'AWAY', since, cause, locked: cause === 'LOCK' };
      return true;
    }
    if (s.phase === 'AWAY') {
      if (cause === 'LOCK') s.locked = true;
      return false;
    }
    // Away again with the idle dialog still open: the idle span goes on.
    if (s.inputAt !== null) {
      const to = Math.max(s.inputAt, Math.min(now, lastInputAt ?? now));
      if (to - s.inputAt >= MIN_BACK_MS) s.back = [...(s.back ?? []), { from: s.inputAt, to }];
      s.inputAt = null;
    }
    if (cause === 'LOCK') s.locked = true;
    return false;
  }

  /** unlock-screen / resume. */
  comeBack(now: number, thresholdSec: number, kind: 'UNLOCK' | 'RESUME' = 'UNLOCK'): 'VOID' | 'PROMPT' | null {
    const s = this.state;
    if (s.phase === 'PROMPT') {
      if (kind === 'UNLOCK') {
        s.locked = false;
        if (s.inputAt === null) s.inputAt = Math.max(floorOf(s), now);
      }
      return null;
    }
    if (s.phase !== 'AWAY') return null;
    // Woke up to the lock screen: nobody is back until it unlocks.
    if (kind === 'RESUME' && s.locked) return null;
    if (thresholdSec <= 0 || now - s.since < thresholdSec * 1000) {
      this.state = { phase: 'ACTIVE' };
      return 'VOID';
    }
    // An unlock means someone signed in; a resume alone doesn't, so wait for real input.
    this.state = { phase: 'PROMPT', since: s.since, cause: s.cause, detectedAt: now, inputAt: kind === 'UNLOCK' ? now : null };
    return 'PROMPT';
  }

  /** The app wasn't running between `since` and `now` while punched in. */
  gap(since: number, now: number, thresholdSec: number): 'VOID' | 'PROMPT' {
    if (thresholdSec <= 0 || now - since < thresholdSec * 1000) return 'VOID';
    this.state = { phase: 'PROMPT', since, cause: 'APP_NOT_RUNNING', detectedAt: now, inputAt: now };
    return 'PROMPT';
  }

  /** Dev/prototype: pretend there was no input since `since`; the user is back now. */
  force(since: number, now: number) {
    this.state = { phase: 'PROMPT', since, cause: 'NO_INPUT', detectedAt: now, inputAt: now };
  }

  /** Close the prompt. Returns the idle span to classify and the stretches back at the PC inside it. */
  resolve(now: number): { since: number; end: number; cause: IdleCause; back: BackSpan[] } | null {
    const s = this.state;
    if (s.phase !== 'PROMPT') return null;
    const end = Math.min(now, Math.max(floorOf(s), s.inputAt ?? now));
    this.state = { phase: 'ACTIVE' };
    return { since: s.since, end, cause: s.cause, back: (s.back ?? []).filter((b) => b.to <= end) };
  }

  reset() {
    this.state = { phase: 'ACTIVE' };
  }
}
