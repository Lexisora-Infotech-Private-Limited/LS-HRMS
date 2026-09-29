import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OutboxQueue, type LogRecord, type QueueEntry, type QueueKind } from '../engine/queue';
import { atomicWrite, open, seal } from './crypto-box';

/**
 * Append-only encrypted JSONL outbox under userData:
 *   outbox.jsonl      one AES-256-GCM sealed LogRecord per line (base64)
 *   shots/<id>.bin    sealed JPEG blobs of queued screenshots
 *
 * A torn last line (crash mid-write) or a tampered line fails authentication and is skipped.
 * The log is compacted (rewritten with only pending entries, atomically) when it grows.
 */
export class OutboxStore {
  readonly queue = new OutboxQueue();
  private readonly file: string;
  private readonly shotsDir: string;
  private dead = 0;
  corruptLines = 0;

  constructor(
    private readonly dir: string,
    private readonly key: Buffer,
    private readonly now: () => number = Date.now,
  ) {
    this.file = join(dir, 'outbox.jsonl');
    this.shotsDir = join(dir, 'shots');
    mkdirSync(this.shotsDir, { recursive: true });
    this.load();
  }

  private load() {
    if (!existsSync(this.file)) return;
    const lines = readFileSync(this.file, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(open(this.key, Buffer.from(line, 'base64')).toString('utf8')) as LogRecord;
        this.queue.apply(rec);
        if (rec.op !== 'add') this.dead += rec.ids.length;
      } catch {
        this.corruptLines++;
      }
    }
    // A single torn line is normal after a crash; many unreadable lines means a key
    // mismatch — keep the file untouched rather than destroying queued time.
    if (this.corruptLines <= 1) this.compact();
  }

  private write(rec: LogRecord) {
    appendFileSync(this.file, seal(this.key, JSON.stringify(rec)).toString('base64') + '\n');
  }

  append<T>(kind: QueueKind, clientId: string, payload: T): QueueEntry<T> | null {
    const e = this.queue.append(kind, clientId, payload, this.now());
    if (e) this.write({ op: 'add', entry: e });
    return e;
  }

  ack(ids: readonly string[]) {
    if (!ids.length) return 0;
    const n = this.queue.ack(ids);
    this.write({ op: 'ack', ids: [...ids] });
    for (const id of ids) this.deleteBlob(id);
    this.dead += ids.length;
    if (this.dead > 500) this.compact();
    return n;
  }

  drop(ids: readonly string[], reason: string) {
    if (!ids.length) return;
    this.queue.ack(ids);
    this.write({ op: 'drop', ids: [...ids], reason });
    for (const id of ids) this.deleteBlob(id);
    this.dead += ids.length;
  }

  /** Retention (policy.offlineRetentionDays). Returns dropped entries. */
  prune(days: number): QueueEntry[] {
    const dropped = this.queue.prune(this.now(), days);
    if (dropped.length) {
      this.write({ op: 'drop', ids: dropped.map((d) => d.clientId), reason: 'RETENTION' });
      for (const d of dropped) this.deleteBlob(d.clientId);
      this.compact();
    }
    return dropped;
  }

  compact() {
    const recs = this.queue.compacted();
    const body = recs.map((r) => seal(this.key, JSON.stringify(r)).toString('base64')).join('\n');
    atomicWrite(this.file, body ? body + '\n' : '');
    this.queue.forgetDone();
    this.dead = 0;
  }

  /** Delete everything (unpair with discard). */
  clear() {
    this.queue.ack(this.queue.pending().map((e) => e.clientId));
    rmSync(this.shotsDir, { recursive: true, force: true });
    mkdirSync(this.shotsDir, { recursive: true });
    this.compact();
  }

  putBlob(clientId: string, data: Buffer) {
    atomicWrite(this.blobPath(clientId), seal(this.key, data));
  }

  getBlob(clientId: string): Buffer | null {
    try {
      return open(this.key, readFileSync(this.blobPath(clientId)));
    } catch {
      return null;
    }
  }

  private deleteBlob(clientId: string) {
    const p = this.blobPath(clientId);
    if (existsSync(p)) rmSync(p, { force: true });
  }

  private blobPath(clientId: string) {
    return join(this.shotsDir, `${clientId.replace(/[^a-zA-Z0-9-]/g, '')}.bin`);
  }

  fileSize() {
    try {
      return statSync(this.file).size;
    } catch {
      return 0;
    }
  }
}
