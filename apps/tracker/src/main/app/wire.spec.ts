import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { activitySegmentSchema, trackerEventSchema, trackerPunchSchema } from '@lexisora/shared';
import type { EngineEvent, Segment } from '../engine/types';
import { clockChangeEvent, eventToWire, isPunchEvent, punchInput, segmentToWire, wireCause } from './wire';

const ist = (hhmm: string) => Date.parse(`2026-09-29T${hhmm}:00+05:30`);
const seg = (over: Partial<Segment>): Segment => ({ clientId: randomUUID(), kind: 'WORK', taskId: 't1', startedAt: ist('11:42'), endedAt: ist('11:50'), ...over });

describe('engine → wire payloads (validated with the shared API contract)', () => {
  it('work and break segments pass the server schema unchanged', () => {
    for (const kind of ['WORK', 'BREAK'] as const) {
      const w = segmentToWire(seg({ kind, taskId: kind === 'BREAK' ? null : 't1' }));
      expect(() => activitySegmentSchema.parse(w)).not.toThrow();
      expect(w.kind).toBe(kind);
      expect(w.resolution).toBeUndefined();
    }
  });

  it('"I was working" → IDLE_WORK + WORKING with the note (idle claim for the Project Lead)', () => {
    const w = segmentToWire(seg({ kind: 'IDLE_WORK', resolution: 'WORKING', cause: 'NO_INPUT', note: 'Client call' }));
    expect(activitySegmentSchema.parse(w)).toMatchObject({ kind: 'IDLE_WORK', resolution: 'WORKING', idleCause: 'NO_INPUT', note: 'Client call', taskId: 't1' });
  });

  it('"Count it as a break" → IDLE + BREAK, so HR sees the break came from the idle dialog', () => {
    const w = segmentToWire(seg({ kind: 'BREAK', taskId: null, resolution: 'BREAK', cause: 'LOCK' }));
    expect(activitySegmentSchema.parse(w)).toMatchObject({ kind: 'IDLE', resolution: 'BREAK', idleCause: 'LOCK' });
  });

  it('"Mark as idle" → IDLE + IDLE (deducted); suspend is sent as SLEEP', () => {
    const w = segmentToWire(seg({ kind: 'IDLE', taskId: null, resolution: 'IDLE', cause: 'SUSPEND' }));
    expect(activitySegmentSchema.parse(w)).toMatchObject({ kind: 'IDLE', resolution: 'IDLE', idleCause: 'SLEEP' });
    expect(wireCause('SUSPEND')).toBe('SLEEP');
    expect(wireCause('APP_NOT_RUNNING')).toBe('APP_NOT_RUNNING');
    expect(wireCause(undefined)).toBeUndefined();
    // a note is only sent with a claim
    expect(segmentToWire(seg({ kind: 'IDLE', resolution: 'IDLE', note: 'x' })).note).toBeUndefined();
  });

  it('events carry ISO times and the idle resolution; punches map to /tracker/punch', () => {
    const ev: EngineEvent = { clientId: randomUUID(), type: 'IDLE_RESOLVED', at: ist('11:51'), resolution: 'WORKING', idleFrom: ist('11:42'), taskId: 't1', note: 'Standup' };
    const w = trackerEventSchema.parse(eventToWire(ev));
    expect(w).toMatchObject({ type: 'IDLE_RESOLVED', resolution: 'WORKING', note: 'Standup', taskId: 't1' });
    expect(Date.parse(w.idleFrom!)).toBe(ist('11:42'));

    const pin: EngineEvent = { clientId: randomUUID(), type: 'PUNCH_IN', at: ist('09:28'), taskId: 't1' };
    expect(isPunchEvent(pin)).toBe(true);
    expect(isPunchEvent(ev)).toBe(false);
    const p = trackerPunchSchema.parse(punchInput(pin));
    expect(p).toMatchObject({ direction: 'IN', clientId: pin.clientId, taskId: 't1' });
    expect(punchInput({ ...pin, type: 'PUNCH_OUT' }).direction).toBe('OUT');
  });

  it('CLOCK_CHANGE carries driftSec in the payload the server reads for the integrity flag', () => {
    const id = randomUUID();
    const w = trackerEventSchema.parse(clockChangeEvent({ at: ist('11:00'), driftSec: -7200, cause: 'JUMP' }, 't1', id));
    expect(w).toMatchObject({ clientId: id, type: 'CLOCK_CHANGE', taskId: 't1', payload: { driftSec: -7200, cause: 'JUMP' } });
    expect(Date.parse(w.at)).toBe(ist('11:00'));
  });
});
