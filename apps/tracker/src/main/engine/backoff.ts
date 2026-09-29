/** Exponential backoff 2 s → 5 min with ±20 % jitter (spec T5 §3). */
export const BACKOFF_MIN_MS = 2_000;
export const BACKOFF_MAX_MS = 300_000;

export function backoffDelay(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempt));
  const jitter = 1 + (rand() * 0.4 - 0.2);
  return Math.round(Math.min(BACKOFF_MAX_MS * 1.2, Math.max(BACKOFF_MIN_MS * 0.8, base * jitter)));
}

/**
 * Connectivity tracker: offline after 2 consecutive network/5xx failures, online on the
 * first success. `justReconnected` lets the caller toast "Back online · N entries synced".
 */
export class Connectivity {
  failures = 0;
  online = true;
  forcedOffline = false;

  success(): { justReconnected: boolean } {
    const was = this.online;
    this.failures = 0;
    this.online = true;
    return { justReconnected: !was };
  }

  failure(): { wentOffline: boolean } {
    this.failures++;
    const was = this.online;
    if (this.failures >= 2) this.online = false;
    return { wentOffline: was && !this.online };
  }

  forceOffline(on: boolean) {
    this.forcedOffline = on;
    if (on) {
      this.online = false;
      this.failures = Math.max(this.failures, 2);
    }
  }
}
