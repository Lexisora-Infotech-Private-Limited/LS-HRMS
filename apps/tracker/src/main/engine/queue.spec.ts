import { describe, expect, it } from 'vitest';
import { backoffDelay, BACKOFF_MAX_MS, Connectivity } from './backoff';
import { OutboxQueue, type LogRecord } from './queue';
import { fitFrames, stitchHorizontal } from './stitch';

describe('OutboxQueue — offline replay order and idempotency', () => {
  it('replays in append (seq) order across kinds and ignores duplicate clientIds', () => {
    const q = new OutboxQueue();
    q.append('event', 'e1', { type: 'PUNCH_IN' }, 1);
    q.append('segment', 's1', { kind: 'WORK' }, 2);
    q.append('shot', 'p1', { file: 'a' }, 3);
    q.append('event', 'e2', { type: 'BREAK_START' }, 4);
    expect(q.append('event', 'e1', { type: 'PUNCH_IN' }, 5)).toBeNull();
    const b = q.takeBatch();
    expect(b.ids).toEqual(['e1', 's1', 'e2']);
    expect(b.events.map((e) => e.clientId)).toEqual(['e1', 'e2']);
    expect(q.nextShot()?.clientId).toBe('p1');
    expect(q.counts()).toEqual({ event: 2, segment: 1, shot: 1, total: 4 });
  });

  it('acked ids leave the queue, and re-appending or re-acking them is a no-op', () => {
    const q = new OutboxQueue();
    q.append('event', 'e1', {}, 1);
    q.append('event', 'e2', {}, 1);
    expect(q.ack(['e1'])).toBe(1);
    expect(q.ack(['e1'])).toBe(0);
    expect(q.append('event', 'e1', {}, 2)).toBeNull();
    expect(q.pending().map((e) => e.clientId)).toEqual(['e2']);
  });

  it('rebuilds identical state from its log (replay after restart), including out-of-order acks', () => {
    const a = new OutboxQueue();
    const log: LogRecord[] = [];
    for (let i = 1; i <= 5; i++) {
      const e = a.append(i % 2 ? 'event' : 'segment', `id${i}`, { i }, i)!;
      log.push({ op: 'add', entry: e });
    }
    a.ack(['id2', 'id4']);
    log.push({ op: 'ack', ids: ['id2', 'id4'] });
    // A duplicate add after the ack must not resurrect the entry.
    log.push({ op: 'add', entry: { seq: 9, kind: 'event', clientId: 'id2', createdAt: 9, payload: {} } });

    const b = new OutboxQueue();
    for (const r of log) b.apply(r);
    expect(b.pending().map((e) => e.clientId)).toEqual(['id1', 'id3', 'id5']);
    // New appends continue the sequence after replay.
    const next = b.append('event', 'id6', {}, 10)!;
    expect(next.seq).toBeGreaterThan(5);
  });

  it('bounds batches and keeps order when a batch is partially filled', () => {
    const q = new OutboxQueue();
    for (let i = 0; i < 7; i++) q.append('event', `e${i}`, {}, i);
    const b = q.takeBatch(3, 10);
    expect(b.ids).toEqual(['e0', 'e1', 'e2']);
    q.ack(b.ids);
    expect(q.takeBatch(3, 10).ids).toEqual(['e3', 'e4', 'e5']);
  });

  it('prunes entries past the retention window', () => {
    const q = new OutboxQueue();
    const day = 86_400_000;
    q.append('event', 'old', {}, 0);
    q.append('event', 'new', {}, 7 * day);
    const dropped = q.prune(8 * day, 7);
    expect(dropped.map((e) => e.clientId)).toEqual(['old']);
    expect(q.pending().map((e) => e.clientId)).toEqual(['new']);
  });
});

describe('backoff + connectivity', () => {
  it('grows exponentially from 2 s and caps at 5 min with ±20 % jitter', () => {
    expect(backoffDelay(0, () => 0.5)).toBe(2000);
    expect(backoffDelay(1, () => 0.5)).toBe(4000);
    expect(backoffDelay(20, () => 0.5)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(0, () => 0)).toBe(1600);
    expect(backoffDelay(0, () => 1)).toBe(2400);
  });

  it('goes offline after 2 consecutive failures and reports reconnects', () => {
    const c = new Connectivity();
    expect(c.failure().wentOffline).toBe(false);
    expect(c.failure().wentOffline).toBe(true);
    expect(c.online).toBe(false);
    expect(c.success().justReconnected).toBe(true);
    expect(c.success().justReconnected).toBe(false);
  });
});

describe('screenshot stitching', () => {
  it('places frames side by side', () => {
    const red = { buf: new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255]), width: 2, height: 1 };
    const blue = { buf: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]), width: 1, height: 3 };
    const s = stitchHorizontal([red, blue]);
    expect(s.width).toBe(3);
    expect(s.height).toBe(3);
    expect([...s.buf.subarray(0, 12)]).toEqual([0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255]);
    // padding under the shorter frame is opaque black
    expect([...s.buf.subarray(12, 16)]).toEqual([0, 0, 0, 255]);
  });

  it('fits multiple displays within 3840×1080', () => {
    const out = fitFrames([
      { width: 2560, height: 1440 },
      { width: 1920, height: 1080 },
    ]);
    expect(out.every((s) => s.height <= 1080)).toBe(true);
    expect(out.reduce((a, s) => a + s.width, 0)).toBeLessThanOrEqual(3840);
  });
});
