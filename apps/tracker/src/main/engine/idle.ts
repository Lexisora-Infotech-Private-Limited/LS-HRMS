import type { IdleCause } from './types';

/**
 * Idle state machine (orthogonal to punch/break status; only consulted while WORKING).
 *
 *   ACTIVE --no input >= threshold--------------------------> PROMPT(NO_INPUT, since = now - idleSec)
 *   ACTIVE --lock-screen / suspend---------------------------> AWAY(since = min(lastInput, now))
 *   AWAY   --unlock / resume, away < threshold---------------> ACTIVE        (voided: counts as work)
 *   AWAY   --unlock / resume, away >= threshold--------------> PROMPT(LOCK|SUSPEND, inputAt = now)
 *   (startup) gap since last tick >= threshold --------------> PROMPT(APP_NOT_RUNNING, inputAt = now)
 *   PROMPT --first input seen--------------------------------> PROMPT(inputAt set; idle span ends there)
 *   PROMPT --user choice-------------------------------------> ACTIVE
 *
 * While PROMPT is open the idle span [since, inputAt ?? now) is excluded from worked time,
 * and time after the first input is held back until the choice is made (then it counts as work).
 */
export type IdlePhase =
  | { phase: 'ACTIVE' }
  | { phase: 'AWAY'; since: number; cause: 'LOCK' | 'SUSPEND' }
  | { phase: 'PROMPT'; since: number; cause: IdleCause; detectedAt: number; inputAt: number | null };

/** System idle below this means "the user touched something". */
export const INPUT_EPSILON_SEC = 2;

export class IdleMachine {
  constructor(public state: IdlePhase = { phase: 'ACTIVE' }) {}

  get prompting() {
    return this.state.phase === 'PROMPT';
  }
  get away() {
    return this.state.phase === 'AWAY';
  }

  /** Poll result from powerMonitor.getSystemIdleTime(). */
  tick(now: number, idleSec: number, thresholdSec: number): 'DETECTED' | 'INPUT' | null {
    const s = this.state;
    if (s.phase === 'ACTIVE') {
      if (thresholdSec > 0 && idleSec >= thresholdSec) {
        this.state = { phase: 'PROMPT', since: now - idleSec * 1000, cause: 'NO_INPUT', detectedAt: now, inputAt: null };
        return 'DETECTED';
      }
      return null;
    }
    if (s.phase === 'PROMPT' && s.inputAt === null && idleSec < INPUT_EPSILON_SEC) {
      s.inputAt = Math.max(s.since, now - idleSec * 1000);
      return 'INPUT';
    }
    return null;
  }

  /** lock-screen / suspend. */
  goAway(now: number, cause: 'LOCK' | 'SUSPEND', lastInputAt?: number): boolean {
    if (this.state.phase !== 'ACTIVE') return false;
    const since = Math.min(now, lastInputAt ?? now);
    this.state = { phase: 'AWAY', since, cause };
    return true;
  }

  /** unlock-screen / resume. */
  comeBack(now: number, thresholdSec: number): 'VOID' | 'PROMPT' | null {
    const s = this.state;
    if (s.phase !== 'AWAY') return null;
    if (thresholdSec <= 0 || now - s.since < thresholdSec * 1000) {
      this.state = { phase: 'ACTIVE' };
      return 'VOID';
    }
    this.state = { phase: 'PROMPT', since: s.since, cause: s.cause, detectedAt: now, inputAt: now };
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

  /** Close the prompt. Returns the idle span to classify. */
  resolve(now: number): { since: number; end: number; cause: IdleCause } | null {
    const s = this.state;
    if (s.phase !== 'PROMPT') return null;
    const end = Math.min(now, Math.max(s.since, s.inputAt ?? now));
    this.state = { phase: 'ACTIVE' };
    return { since: s.since, end, cause: s.cause };
  }

  reset() {
    this.state = { phase: 'ACTIVE' };
  }
}
