import type { ScreenshotMeta, TrackerBatch } from '@lexisora/shared';
import { backoffDelay, type Connectivity } from '../engine/backoff';
import { ApiError, type ApiClient } from './api-client';
import type { OutboxStore } from './outbox-store';

export interface SyncHooks {
  onChange(): void;
  onReconnected(synced: number): void;
  onWentOffline(): void;
  onRejected(message: string): void;
  onAuthLost(err: ApiError): void;
  log(message: string): void;
}

/**
 * Flushes the outbox: events + segments in seq order (one batch in flight), then
 * screenshots oldest first. Retries with exponential backoff; the server dedupes by
 * clientId, so a batch that timed out after the server stored it is safely re-sent.
 */
export class SyncService {
  private running: Promise<boolean> | null = null;
  private attempt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private stopped = false;
  lastSyncAt: number | null = null;

  constructor(
    private readonly store: OutboxStore,
    private readonly api: ApiClient,
    private readonly conn: Connectivity,
    private readonly hooks: SyncHooks,
  ) {}

  get busy() {
    return this.running !== null;
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.debounce) clearTimeout(this.debounce);
  }

  resume() {
    this.stopped = false;
  }

  /** Debounced flush after new entries are queued. */
  trigger(delayMs = 2_000) {
    if (this.stopped || !this.conn.online || this.retryTimer) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.flush();
    }, delayMs);
  }

  /** Flush now; resolves true when the queue is empty afterwards. */
  flush(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (this.running) return this.running;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.running = this.doFlush().finally(() => {
      this.running = null;
      this.hooks.onChange();
    });
    this.hooks.onChange();
    return this.running;
  }

  private async doFlush(): Promise<boolean> {
    let synced = 0;
    const q = this.store.queue;
    try {
      // 1. events + segments
      for (;;) {
        const batch = q.takeBatch(500, 1000);
        if (!batch.ids.length) break;
        const body: TrackerBatch = {
          deviceTime: new Date().toISOString(),
          events: batch.events.map((e) => e.payload as TrackerBatch['events'][number]),
          segments: batch.segments.map((e) => e.payload as TrackerBatch['segments'][number]),
        };
        try {
          await this.api.sync(body);
          this.store.ack(batch.ids);
          synced += batch.ids.length;
        } catch (e) {
          if (this.isPermanent(e)) {
            this.store.drop(batch.ids, (e as ApiError).code);
            this.hooks.onRejected(`${batch.ids.length} entries rejected: ${(e as ApiError).message}`);
            continue;
          }
          throw e;
        }
      }
      // 2. screenshots, oldest first
      for (let next = q.nextShot(); next; next = q.nextShot()) {
        const meta = next.payload as ScreenshotMeta;
        const blob = this.store.getBlob(next.clientId);
        if (!blob) {
          this.store.drop([next.clientId], 'LOST');
          continue;
        }
        try {
          await this.api.uploadScreenshot(meta, blob);
          this.store.ack([next.clientId]);
          synced++;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            this.store.ack([next.clientId]); // already uploaded
            continue;
          }
          if (this.isPermanent(e)) {
            this.store.drop([next.clientId], (e as ApiError).code);
            this.hooks.log(`Screenshot rejected: ${(e as ApiError).message}`);
            continue;
          }
          throw e;
        }
      }
      this.attempt = 0;
      this.lastSyncAt = Date.now();
      const { justReconnected } = this.conn.success();
      if (justReconnected) this.hooks.onReconnected(synced);
      return q.size === 0;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'NETWORK', String(e), true);
      if (err.status === 401 || (err.status === 403 && /REVOKED|DEVICE/i.test(err.code))) {
        this.hooks.onAuthLost(err);
        return false;
      }
      if (err.network || err.status >= 500) {
        const { wentOffline } = this.conn.failure();
        if (wentOffline) this.hooks.onWentOffline();
      } else {
        this.hooks.log(`Sync postponed: ${err.message}`);
      }
      this.scheduleRetry();
      return false;
    }
  }

  /** 4xx validation errors can never succeed — drop instead of blocking the queue. 404/405/429 are retried. */
  private isPermanent(e: unknown) {
    return (
      e instanceof ApiError &&
      !e.network &&
      e.status >= 400 &&
      e.status < 500 &&
      ![401, 403, 404, 405, 408, 429].includes(e.status)
    );
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const delay = backoffDelay(this.attempt++);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }
}
