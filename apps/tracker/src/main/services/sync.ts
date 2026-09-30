import type {
  ScreenshotMeta,
  ScreenshotUploadResult,
  TrackerBatch,
  TrackerBatchResult,
  TrackerPunchInput,
  TrackerPunchResult,
} from '@lexisora/shared';
import { backoffDelay } from '../engine/backoff';
import type { OutboxQueue, QueueEntry } from '../engine/queue';
import { ApiError, type ApiClient } from './api-client';

/** The slice of OutboxStore the sync loop needs (lets tests use an in-memory store). */
export interface SyncStore {
  readonly queue: OutboxQueue;
  ack(ids: readonly string[]): number;
  drop(ids: readonly string[], reason: string): void;
  getBlob(clientId: string): Buffer | null;
}

export type SyncApi = Pick<ApiClient, 'punch' | 'sync' | 'uploadScreenshot'>;

export interface SyncHooks {
  onChange(): void;
  /** Entries the server has stored (accepted, duplicate or rejected-with-reason). */
  onAcked(ids: readonly string[]): void;
  onPunch?(input: TrackerPunchInput, result: TrackerPunchResult): void;
  onPunchRejected?(input: TrackerPunchInput, err: ApiError): void;
  onBatch?(result: TrackerBatchResult, sent: number): void;
  onShot?(meta: ScreenshotMeta, result: ScreenshotUploadResult | null): void;
  onAuthLost(err: ApiError): void;
  log(message: string): void;
}

export type FlushResult = { ok: boolean; synced: number; remaining: number };

/**
 * Flushes the offline outbox in a fixed order, one request in flight:
 *   1. punches (POST /tracker/punch) strictly in seq order — the server opens/closes the
 *      attendance session from them, so nothing may overtake a queued punch;
 *   2. events + segments (POST /tracker/sync) in seq order, bounded batches;
 *   3. screenshots oldest first (multipart).
 * Retries with exponential backoff (2 s → 5 min, ±20 % jitter). The server dedupes by
 * clientId, so a request that timed out after the server stored it is safely re-sent.
 * A batch the server refuses as invalid (4xx) is bisected so one bad entry can't block
 * the queue; only the offending entry is dropped.
 */
export class SyncService {
  private running: Promise<FlushResult> | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  lastSyncAt: number | null = null;
  lastError: string | null = null;

  constructor(
    private readonly store: SyncStore,
    private readonly api: SyncApi,
    private readonly isOnline: () => boolean,
    private readonly hooks: SyncHooks,
    private readonly opts: { maxEvents?: number; maxSegments?: number; rand?: () => number } = {},
  ) {}

  get busy() {
    return this.running !== null;
  }

  get retrying() {
    return this.retryTimer !== null;
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.debounce) clearTimeout(this.debounce);
    this.retryTimer = null;
    this.debounce = null;
  }

  resume() {
    this.stopped = false;
  }

  /** Debounced flush after new entries are queued (no-op while offline / backing off). */
  trigger(delayMs = 1_500) {
    if (this.stopped || !this.isOnline() || this.retryTimer) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.flush();
    }, delayMs);
  }

  /** Flush now (cancels a pending backoff). Concurrent callers share the same run. */
  flush(): Promise<FlushResult> {
    if (this.stopped) return Promise.resolve({ ok: false, synced: 0, remaining: this.store.queue.size });
    if (this.running) return this.running;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    this.running = this.doFlush().finally(() => {
      this.running = null;
      this.hooks.onChange();
    });
    this.hooks.onChange();
    return this.running;
  }

  private ack(ids: readonly string[]) {
    if (!ids.length) return;
    this.store.ack(ids);
    this.hooks.onAcked(ids);
  }

  private async doFlush(): Promise<FlushResult> {
    let synced = 0;
    const q = this.store.queue;
    try {
      // 1. punches, strictly in order
      for (let p = q.nextPunch(); p; p = q.nextPunch()) {
        const input = p.payload as TrackerPunchInput;
        try {
          const r = await this.api.punch(input);
          this.ack([p.clientId]);
          synced++;
          this.hooks.onPunch?.(input, r);
        } catch (e) {
          if (!isPermanent(e)) throw e;
          this.store.drop([p.clientId], (e as ApiError).code);
          this.hooks.onPunchRejected?.(input, e as ApiError);
        }
      }

      // 2. events + segments
      for (;;) {
        const batch = q.takeBatch(this.opts.maxEvents ?? 500, this.opts.maxSegments ?? 1000);
        if (!batch.ids.length) break;
        const entries = [...batch.events, ...batch.segments].sort((a, b) => a.seq - b.seq);
        synced += await this.sendEntries(entries);
      }

      // 3. screenshots, oldest first
      for (let next = q.nextShot(); next; next = q.nextShot()) {
        const meta = next.payload as ScreenshotMeta;
        const blob = this.store.getBlob(next.clientId);
        if (!blob) {
          this.store.drop([next.clientId], 'LOST');
          this.hooks.log('A queued screenshot could not be read and was skipped');
          continue;
        }
        try {
          const r = await this.api.uploadScreenshot(meta, blob);
          this.ack([next.clientId]);
          synced++;
          this.hooks.onShot?.(meta, r);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            this.ack([next.clientId]); // already uploaded
            this.hooks.onShot?.(meta, null);
            continue;
          }
          if (!isPermanent(e)) throw e;
          this.store.drop([next.clientId], (e as ApiError).code);
          this.hooks.log(`Screenshot rejected: ${(e as ApiError).message}`);
        }
      }

      this.attempt = 0;
      this.lastSyncAt = Date.now();
      this.lastError = null;
      return { ok: true, synced, remaining: q.size };
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'NETWORK', String(e), true);
      this.lastError = err.message;
      if (err.authLost) {
        this.hooks.onAuthLost(err);
        return { ok: false, synced, remaining: q.size };
      }
      if (!err.retryable) this.hooks.log(`Sync postponed: ${err.message}`);
      this.scheduleRetry();
      return { ok: false, synced, remaining: q.size };
    }
  }

  /** Sends one batch; on a validation error bisects it until the bad entry is isolated. Returns entries delivered. */
  private async sendEntries(entries: QueueEntry[]): Promise<number> {
    const body: TrackerBatch = {
      deviceTime: new Date().toISOString(),
      events: entries.filter((e) => e.kind === 'event').map((e) => e.payload as TrackerBatch['events'][number]),
      segments: entries.filter((e) => e.kind === 'segment').map((e) => e.payload as TrackerBatch['segments'][number]),
      queueDepth: Math.max(0, this.store.queue.size - entries.length),
    };
    const ids = entries.map((e) => e.clientId);
    try {
      const r = await this.api.sync(body);
      this.ack(ids);
      this.hooks.onBatch?.(r, ids.length);
      if (r.rejected?.length) {
        const reasons = [...new Set(r.rejected.map((x) => x.reason))].join(', ');
        this.hooks.log(`${r.rejected.length} ${r.rejected.length === 1 ? 'entry was' : 'entries were'} refused by the server (${reasons})`);
      }
      return ids.length;
    } catch (e) {
      if (!isPermanent(e)) throw e;
      if (entries.length > 1) {
        const mid = Math.ceil(entries.length / 2);
        return (await this.sendEntries(entries.slice(0, mid))) + (await this.sendEntries(entries.slice(mid)));
      }
      this.store.drop(ids, (e as ApiError).code);
      this.hooks.log(`An entry was refused by the server: ${(e as ApiError).message}`);
      return 0;
    }
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const delay = backoffDelay(this.attempt++, this.opts.rand);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }
}

/** 4xx validation-style errors can never succeed — drop instead of blocking the queue. */
export function isPermanent(e: unknown): e is ApiError {
  return (
    e instanceof ApiError &&
    !e.network &&
    !e.authLost &&
    e.status >= 400 &&
    e.status < 500 &&
    ![401, 404, 405, 408, 429].includes(e.status)
  );
}
