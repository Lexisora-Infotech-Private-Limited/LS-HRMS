import type { OpenSegment, Segment, SegmentKind } from './types';

/**
 * Segment builder: the only place segments are opened, closed and split.
 * Invariants: segments never overlap, never have negative length, and zero-length
 * segments are dropped (so rapid toggles don't produce noise on the server).
 */
export class SegmentBuilder {
  constructor(private readonly uuid: () => string) {}

  open(kind: 'WORK' | 'BREAK', taskId: string | null, at: number): OpenSegment {
    return { clientId: this.uuid(), kind, taskId, startedAt: at };
  }

  /** Close an open segment at `at` (clamped to its start). Returns null for a zero-length span. */
  close(seg: OpenSegment, at: number): Segment | null {
    const end = Math.max(at, seg.startedAt);
    if (end <= seg.startedAt) return null;
    return { clientId: seg.clientId, kind: seg.kind, taskId: seg.taskId, startedAt: seg.startedAt, endedAt: end };
  }

  /** A closed span of any kind (used for idle resolutions). */
  span(kind: SegmentKind, taskId: string | null, from: number, to: number): Segment | null {
    if (to <= from) return null;
    return { clientId: this.uuid(), kind, taskId, startedAt: from, endedAt: to };
  }

  /** Close `seg` at `at` and reopen the same kind/task there. */
  split(seg: OpenSegment, at: number, taskId: string | null = seg.taskId): { closed: Segment | null; next: OpenSegment } {
    const closed = this.close(seg, at);
    const next = this.open(seg.kind, taskId, Math.max(at, seg.startedAt));
    return { closed, next };
  }
}

export const durationSec = (s: { startedAt: number; endedAt: number }) => Math.max(0, (s.endedAt - s.startedAt) / 1000);

export function toWire(s: Segment) {
  return {
    clientId: s.clientId,
    kind: s.kind,
    taskId: s.taskId,
    startedAt: new Date(s.startedAt).toISOString(),
    endedAt: new Date(s.endedAt).toISOString(),
    keyboardEvents: 0,
    mouseEvents: 0,
  };
}
