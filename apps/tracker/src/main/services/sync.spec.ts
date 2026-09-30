import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenshotMeta, TrackerBatch, TrackerBatchResult, TrackerPunchInput, TrackerPunchResult, TrackerToday } from '@lexisora/shared';
import { OutboxQueue } from '../engine/queue';
import { ApiError } from './api-client';
import { SyncService, isPermanent, type SyncApi, type SyncHooks, type SyncStore } from './sync';

/** In-memory stand-in for the encrypted OutboxStore. */
class MemStore implements SyncStore {
  readonly queue = new OutboxQueue();
  readonly blobs = new Map<string, Buffer>();
  readonly dropped: { id: string; reason: string }[] = [];
  private t = 0;
  add(kind: 'punch' | 'event' | 'segment' | 'shot', payload: { clientId: string }) {
    return this.queue.append(kind, payload.clientId, payload, ++this.t);
  }
  ack(ids: readonly string[]) {
    return this.queue.ack(ids);
  }
  drop(ids: readonly string[], reason: string) {
    this.queue.ack(ids);
    for (const id of ids) this.dropped.push({ id, reason });
  }
  getBlob(id: string) {
    return this.blobs.get(id) ?? null;
  }
}

const TODAY: TrackerToday = { status: 'WORKING', workedSeconds: 0, breakSeconds: 0, idleSeconds: 0, screenshots: 0, byTask: [], punchedInAt: null };

/** Fake server: stores by clientId (idempotent), records the call order, can be told to fail. */
class FakeServer implements SyncApi {
  readonly calls: string[] = [];
  readonly stored = new Set<string>();
  duplicates = 0;
  /** Throw this for the next N calls (after optionally storing — i.e. the response was lost). */
  failNext: { err: ApiError; times: number; storeFirst?: boolean } | null = null;
  rejectIds = new Set<string>();
  /** `deviceTime` of every /tracker/sync batch received. */
  readonly deviceTimes: string[] = [];

  private maybeFail(ids: string[]) {
    const f = this.failNext;
    if (!f || f.times <= 0) return;
    f.times--;
    if (f.storeFirst) for (const id of ids) this.store(id);
    throw f.err;
  }
  private store(id: string) {
    if (this.stored.has(id)) this.duplicates++;
    else this.stored.add(id);
  }

  async punch(input: TrackerPunchInput): Promise<TrackerPunchResult> {
    this.calls.push(`punch:${input.direction}`);
    this.maybeFail([input.clientId!]);
    if (this.rejectIds.has(input.clientId!)) throw new ApiError(403, 'PUNCH_NOT_ALLOWED', 'Office staff punch with biometric.');
    this.store(input.clientId!);
    return { ok: true, direction: input.direction, at: input.at ?? new Date().toISOString(), today: TODAY };
  }

  async sync(batch: TrackerBatch): Promise<TrackerBatchResult> {
    const ids = [...batch.events.map((e) => e.clientId), ...batch.segments.map((s) => s.clientId)];
    this.calls.push(`sync:${ids.length}`);
    this.deviceTimes.push(batch.deviceTime);
    this.maybeFail(ids);
    if (ids.some((id) => this.rejectIds.has(id))) throw new ApiError(400, 'VALIDATION_FAILED', 'endedAt must be after startedAt');
    for (const id of ids) this.store(id);
    return { accepted: ids.length, duplicates: 0, skewSeconds: 0 };
  }

  async uploadScreenshot(meta: ScreenshotMeta) {
    this.calls.push('shot');
    this.maybeFail([meta.clientId]);
    this.store(meta.clientId);
    return { id: `s-${meta.clientId}`, duplicate: false, blurred: meta.blurred, workDate: '2026-09-29' };
  }
}

const ev = (type = 'TASK_SWITCH') => ({ clientId: randomUUID(), type, at: '2026-09-29T05:00:00.000Z', taskId: 't1' });
const segP = () => ({ clientId: randomUUID(), kind: 'WORK', taskId: 't1', startedAt: '2026-09-29T04:00:00.000Z', endedAt: '2026-09-29T04:15:00.000Z', keyboardEvents: 0, mouseEvents: 0 });
const punchP = (direction: 'IN' | 'OUT') => ({ clientId: randomUUID(), direction, at: '2026-09-29T04:00:00.000Z', taskId: 't1' });
const shotP = () => ({ clientId: randomUUID(), capturedAt: '2026-09-29T04:40:00.000Z', taskId: 't1', monitorCount: 1, blurred: false });

function setup(opts: { online?: () => boolean; maxEvents?: number; maxSegments?: number; now?: () => number } = {}) {
  const store = new MemStore();
  const api = new FakeServer();
  const hooks = {
    onChange: vi.fn(),
    onAcked: vi.fn(),
    onPunch: vi.fn(),
    onPunchRejected: vi.fn(),
    onBatch: vi.fn(),
    onShot: vi.fn(),
    onAuthLost: vi.fn(),
    log: vi.fn(),
  } satisfies SyncHooks;
  const sync = new SyncService(store, api, opts.online ?? (() => true), hooks, {
    maxEvents: opts.maxEvents,
    maxSegments: opts.maxSegments,
    rand: () => 0.5,
    now: opts.now,
  });
  return { store, api, hooks, sync };
}

describe('SyncService — clock', () => {
  it("stamps each batch with the tracker's trusted clock, not the (changed) PC clock", async () => {
    const trusted = Date.parse('2026-09-29T11:00:00+05:30');
    const { store, api, sync } = setup({ now: () => trusted });
    store.add('event', ev());
    await sync.flush();
    expect(api.deviceTimes).toEqual([new Date(trusted).toISOString()]);
    expect(sync.lastSyncAt).toBe(trusted);
  });
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SyncService — offline replay order', () => {
  it('delivers punches first (in order), then events + segments, then screenshots', async () => {
    const { store, api, sync, hooks } = setup();
    const shot = shotP();
    store.add('shot', shot);
    store.blobs.set(shot.clientId, Buffer.from('jpeg'));
    store.add('segment', segP());
    store.add('punch', punchP('IN'));
    store.add('event', ev());
    store.add('punch', punchP('OUT'));
    store.add('segment', segP());

    const r = await sync.flush();
    expect(r).toMatchObject({ ok: true, synced: 6, remaining: 0 });
    expect(api.calls).toEqual(['punch:IN', 'punch:OUT', 'sync:3', 'shot']);
    expect(hooks.onPunch).toHaveBeenCalledTimes(2);
    expect(hooks.onAcked.mock.calls.map((c) => c[1])).toEqual(['punch', 'punch', 'segment', 'shot']);
    expect(store.queue.size).toBe(0);
  });

  it('splits large queues into bounded batches, preserving order', async () => {
    const { store, api, sync } = setup({ maxEvents: 2, maxSegments: 2 });
    for (let i = 0; i < 5; i++) store.add('segment', segP());
    await sync.flush();
    expect(api.calls).toEqual(['sync:2', 'sync:2', 'sync:1']);
    expect(store.queue.size).toBe(0);
  });
});

describe('SyncService — idempotent retries and backoff', () => {
  it('a lost response is retried with the same clientIds; the server keeps one copy', async () => {
    const { store, api, sync } = setup();
    const a = segP();
    const b = segP();
    store.add('segment', a);
    store.add('segment', b);
    api.failNext = { err: new ApiError(0, 'NETWORK', 'timeout', true), times: 1, storeFirst: true };

    const first = await sync.flush();
    expect(first.ok).toBe(false);
    expect(store.queue.size).toBe(2); // nothing acked locally
    expect(sync.retrying).toBe(true);

    // backoff 2 s (rand 0.5 → no jitter) → the retry flushes the same entries again
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.calls).toEqual(['sync:2', 'sync:2']);
    expect(store.queue.size).toBe(0);
    expect(api.stored.size).toBe(2);
    expect(api.duplicates).toBe(2);
  });

  it('backs off exponentially while the server keeps failing (2 s, 4 s, 8 s…)', async () => {
    const { store, api, sync } = setup();
    store.add('event', ev());
    api.failNext = { err: new ApiError(503, 'HTTP_503', 'down'), times: 3 };
    await sync.flush();
    expect(api.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(api.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.calls.length).toBe(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(api.calls.length).toBe(3);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(api.calls.length).toBe(4);
    expect(store.queue.size).toBe(0);
  });

  it('does not auto-sync while offline; a manual flush still goes through the queue in order', async () => {
    let online = false;
    const { store, api, sync } = setup({ online: () => online });
    store.add('event', ev());
    sync.trigger(10);
    await vi.advanceTimersByTimeAsync(100);
    expect(api.calls).toEqual([]);
    online = true;
    sync.trigger(10);
    await vi.advanceTimersByTimeAsync(10);
    expect(api.calls).toEqual(['sync:1']);
  });
});

describe('SyncService — permanent failures never block the queue', () => {
  it('bisects a refused batch and drops only the bad entry', async () => {
    const { store, api, sync, hooks } = setup();
    const entries = [segP(), segP(), segP(), segP(), segP()];
    for (const e of entries) store.add('segment', e);
    api.rejectIds.add(entries[3].clientId);
    const r = await sync.flush();
    expect(r.ok).toBe(true);
    expect(store.dropped).toEqual([{ id: entries[3].clientId, reason: 'VALIDATION_FAILED' }]);
    expect(api.stored.size).toBe(4);
    expect(store.queue.size).toBe(0);
    expect(hooks.log).toHaveBeenCalled();
  });

  it('a punch the server refuses for good is dropped and reported; the rest continues', async () => {
    const { store, api, sync, hooks } = setup();
    const p = punchP('IN');
    store.add('punch', p);
    store.add('event', ev());
    api.rejectIds.add(p.clientId);
    await sync.flush();
    expect(hooks.onPunchRejected).toHaveBeenCalledTimes(1);
    expect(hooks.onPunchRejected.mock.calls[0][1].code).toBe('PUNCH_NOT_ALLOWED');
    expect(api.calls).toEqual(['punch:IN', 'sync:1']);
    expect(store.queue.size).toBe(0);
  });

  it('401 (device revoked) stops syncing and keeps the queue for a re-pair', async () => {
    const { store, api, sync, hooks } = setup();
    store.add('event', ev());
    api.failNext = { err: new ApiError(401, 'DEVICE_REVOKED', 'This device was revoked'), times: 1 };
    const r = await sync.flush();
    expect(r.ok).toBe(false);
    expect(hooks.onAuthLost).toHaveBeenCalledTimes(1);
    expect(sync.retrying).toBe(false);
    expect(store.queue.size).toBe(1);
  });

  it('a screenshot already on the server (409) counts as delivered; a missing blob is skipped', async () => {
    const { store, api, sync } = setup();
    const s1 = shotP();
    const s2 = shotP();
    store.add('shot', s1);
    store.add('shot', s2);
    store.blobs.set(s2.clientId, Buffer.from('jpeg'));
    api.failNext = { err: new ApiError(409, 'DUPLICATE', 'exists'), times: 1 };
    await sync.flush();
    expect(store.dropped.map((d) => d.reason)).toEqual(['LOST']);
    expect(store.queue.size).toBe(0);
  });

  it('classifies permanent vs retryable errors', () => {
    expect(isPermanent(new ApiError(400, 'VALIDATION_FAILED', 'x'))).toBe(true);
    expect(isPermanent(new ApiError(422, 'OVERLAP', 'x'))).toBe(true);
    expect(isPermanent(new ApiError(429, 'RATE', 'x'))).toBe(false);
    expect(isPermanent(new ApiError(503, 'DOWN', 'x'))).toBe(false);
    expect(isPermanent(new ApiError(401, 'UNAUTHORIZED', 'x'))).toBe(false);
    expect(isPermanent(new ApiError(0, 'NETWORK', 'x', true))).toBe(false);
  });
});
