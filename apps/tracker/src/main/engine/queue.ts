/**
 * Offline outbox (pure, in-memory state). The encrypted JSONL file store replays its
 * log into this structure on start, so replay order and idempotency are defined here:
 *
 *  - every entry carries a client-generated UUID (`clientId`); appending the same id twice is a no-op;
 *  - entries get a monotonically increasing `seq`; batches are taken in seq order;
 *  - acked entries (ACCEPTED or DUPLICATE on the server) leave the queue; acking twice is harmless;
 *  - entries older than the retention window are dropped (reported so the UI can warn).
 */
export type QueueKind = 'event' | 'segment' | 'shot';

export interface QueueEntry<T = unknown> {
  seq: number;
  kind: QueueKind;
  clientId: string;
  createdAt: number;
  payload: T;
}

export type LogRecord =
  | { op: 'add'; entry: QueueEntry }
  | { op: 'ack'; ids: string[] }
  | { op: 'drop'; ids: string[]; reason: string };

export class OutboxQueue {
  private readonly items = new Map<string, QueueEntry>();
  private readonly done = new Set<string>();
  private seq = 0;

  get size() {
    return this.items.size;
  }

  counts() {
    let event = 0;
    let segment = 0;
    let shot = 0;
    for (const e of this.items.values()) {
      if (e.kind === 'event') event++;
      else if (e.kind === 'segment') segment++;
      else shot++;
    }
    return { event, segment, shot, total: event + segment + shot };
  }

  has(clientId: string) {
    return this.items.has(clientId);
  }

  /** Returns the new entry, or null if this clientId was already queued/acked (idempotent). */
  append<T>(kind: QueueKind, clientId: string, payload: T, now: number): QueueEntry<T> | null {
    if (this.items.has(clientId) || this.done.has(clientId)) return null;
    const entry: QueueEntry<T> = { seq: ++this.seq, kind, clientId, createdAt: now, payload };
    this.items.set(clientId, entry);
    return entry;
  }

  /** Apply a persisted log record (used when replaying the file on start). */
  apply(rec: LogRecord) {
    if (rec.op === 'add') {
      const e = rec.entry;
      if (this.items.has(e.clientId) || this.done.has(e.clientId)) return;
      this.items.set(e.clientId, e);
      this.seq = Math.max(this.seq, e.seq);
    } else {
      for (const id of rec.ids) {
        this.items.delete(id);
        this.done.add(id);
      }
    }
  }

  /** Mark entries as delivered. Returns how many were actually pending. */
  ack(ids: readonly string[]): number {
    let n = 0;
    for (const id of ids) {
      if (this.items.delete(id)) n++;
      this.done.add(id);
    }
    return n;
  }

  /** Pending entries in replay (seq) order. */
  pending(kind?: QueueKind): QueueEntry[] {
    const all = [...this.items.values()].filter((e) => !kind || e.kind === kind);
    return all.sort((a, b) => a.seq - b.seq);
  }

  /** Next /tracker/sync batch: events + segments in seq order, bounded by the contract limits. */
  takeBatch(maxEvents = 500, maxSegments = 1000): { events: QueueEntry[]; segments: QueueEntry[]; ids: string[] } {
    const events: QueueEntry[] = [];
    const segments: QueueEntry[] = [];
    for (const e of this.pending()) {
      if (e.kind === 'shot') continue;
      if (e.kind === 'event') {
        if (events.length >= maxEvents) break;
        events.push(e);
      } else {
        if (segments.length >= maxSegments) break;
        segments.push(e);
      }
    }
    return { events, segments, ids: [...events, ...segments].sort((a, b) => a.seq - b.seq).map((e) => e.clientId) };
  }

  /** Oldest pending screenshot. */
  nextShot(): QueueEntry | null {
    return this.pending('shot')[0] ?? null;
  }

  oldestCreatedAt(): number | null {
    const p = this.pending();
    return p.length ? Math.min(...p.map((e) => e.createdAt)) : null;
  }

  /** Retention: drop entries older than `days`. Returns the dropped entries. */
  prune(now: number, days: number): QueueEntry[] {
    const cutoff = now - days * 86_400_000;
    const dropped = this.pending().filter((e) => e.createdAt < cutoff);
    for (const e of dropped) {
      this.items.delete(e.clientId);
      this.done.add(e.clientId);
    }
    return dropped;
  }

  /** Records that reproduce the current pending state (used for compaction). */
  compacted(): LogRecord[] {
    return this.pending().map((entry) => ({ op: 'add' as const, entry }));
  }

  /** Forget delivered ids (after compaction the file no longer mentions them). */
  forgetDone() {
    this.done.clear();
  }
}
