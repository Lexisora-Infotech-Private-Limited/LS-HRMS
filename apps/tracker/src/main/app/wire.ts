import type { ActivitySegmentInput, IdleCause as WireIdleCause, TrackerEvent, TrackerPunchInput } from '@lexisora/shared';
import type { EngineEvent, IdleCause, Segment } from '../engine/types';

/**
 * Engine (epoch ms, device-local types) → wire payloads of packages/shared/src/tracker.ts.
 * The outbox stores the wire form, so a replay after an app update re-sends exactly
 * what was recorded.
 */

const iso = (ms: number) => new Date(ms).toISOString();

/** The engine says SUSPEND; the contract calls it SLEEP. */
export function wireCause(c: IdleCause | undefined): WireIdleCause | undefined {
  if (!c) return undefined;
  return c === 'SUSPEND' ? 'SLEEP' : c;
}

export function isPunchEvent(e: EngineEvent): e is EngineEvent & { type: 'PUNCH_IN' | 'PUNCH_OUT' } {
  return e.type === 'PUNCH_IN' || e.type === 'PUNCH_OUT';
}

export function punchInput(e: EngineEvent): TrackerPunchInput {
  return {
    direction: e.type === 'PUNCH_IN' ? 'IN' : 'OUT',
    clientId: e.clientId,
    at: iso(e.at),
    taskId: e.taskId ?? null,
  };
}

export function eventToWire(e: EngineEvent): TrackerEvent {
  const out: TrackerEvent = { clientId: e.clientId, type: e.type, at: iso(e.at), taskId: e.taskId ?? null };
  if (e.resolution) out.resolution = e.resolution;
  if (e.idleFrom !== undefined) out.idleFrom = iso(e.idleFrom);
  if (e.note) out.note = e.note.slice(0, 500);
  return out;
}

/**
 * Idle spans carry how the user classified them (spec: kind IDLE + resolution BREAK is stored
 * as idle counted as break, so HR can see the break came from the idle dialog):
 *   "I was working"       → IDLE_WORK + WORKING (+ note) → idle claim for the Project Lead
 *   "Count it as a break" → IDLE + BREAK
 *   "Mark as idle"        → IDLE + IDLE (deducted)
 */
export function segmentToWire(s: Segment): ActivitySegmentInput {
  const base: ActivitySegmentInput = {
    clientId: s.clientId,
    kind: s.kind,
    taskId: s.taskId,
    startedAt: iso(s.startedAt),
    endedAt: iso(s.endedAt),
    keyboardEvents: 0,
    mouseEvents: 0,
  };
  if (s.resolution) {
    if (s.resolution === 'BREAK') base.kind = 'IDLE';
    base.resolution = s.resolution;
    const cause = wireCause(s.cause);
    if (cause) base.idleCause = cause;
    if (s.note && s.resolution === 'WORKING') base.note = s.note.slice(0, 140);
  } else if (s.kind === 'IDLE') {
    base.resolution = 'IDLE';
  }
  return base;
}
