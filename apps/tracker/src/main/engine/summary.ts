import { clock } from '@tracker-shared/format';
import type { OpenSegment, Segment, SegmentKind } from './types';

/**
 * Day summary: totals, per-task time and the timeline bar — the same formula the
 * server uses (spec T3 §5):
 *   worked  = Σ WORK + Σ IDLE_WORK (claimed idle, pending review — shown immediately)
 *   break   = Σ BREAK (incl. idle counted as break)
 *   idle    = Σ IDLE (deducted) + pending idle while the prompt is open
 *   span(first punch-in .. last punch-out) = worked + break + idle   (tested)
 */

export interface LiveState {
  open: OpenSegment | null;
  /** Where the open segment currently ends (now, or frozen at lock start). */
  openEnd: number;
  /** Unresolved idle span (prompt open). */
  pendingIdle: { since: number; end: number } | null;
}

export interface DayTotals {
  workedSec: number;
  breakSec: number;
  idleSec: number;
  idleDeductedSec: number;
  idlePendingSec: number;
  claimedSec: number;
  perTask: Map<string | null, number>;
}

const sec = (from: number, to: number) => Math.max(0, (to - from) / 1000);

export function computeTotals(segments: readonly Segment[], live?: LiveState | null): DayTotals {
  const t: DayTotals = {
    workedSec: 0,
    breakSec: 0,
    idleSec: 0,
    idleDeductedSec: 0,
    idlePendingSec: 0,
    claimedSec: 0,
    perTask: new Map(),
  };
  const add = (kind: SegmentKind, taskId: string | null, s: number) => {
    if (s <= 0) return;
    if (kind === 'WORK' || kind === 'IDLE_WORK') {
      t.workedSec += s;
      if (kind === 'IDLE_WORK') t.claimedSec += s;
      t.perTask.set(taskId, (t.perTask.get(taskId) ?? 0) + s);
    } else if (kind === 'BREAK') {
      t.breakSec += s;
    } else {
      t.idleDeductedSec += s;
    }
  };
  for (const s of segments) add(s.kind, s.taskId, sec(s.startedAt, s.endedAt));
  if (live?.open) add(live.open.kind, live.open.taskId, sec(live.open.startedAt, live.openEnd));
  if (live?.pendingIdle) t.idlePendingSec = sec(live.pendingIdle.since, live.pendingIdle.end);
  t.idleSec = t.idleDeductedSec + t.idlePendingSec;
  return t;
}

/** Server baseline (already-synced time from any device) + local delta not yet in it. */
export interface ServerBaseline {
  workedSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  screenshots: number;
  byTask: { taskId: string | null; key: string; title: string; seconds: number }[];
}

export function combine(server: ServerBaseline | null, delta: DayTotals): DayTotals {
  if (!server) return delta;
  const perTask = new Map(delta.perTask);
  for (const b of server.byTask) perTask.set(b.taskId, (perTask.get(b.taskId) ?? 0) + b.seconds);
  const idleDeductedSec = server.idleSeconds + delta.idleDeductedSec;
  return {
    workedSec: server.workedSeconds + delta.workedSec,
    breakSec: server.breakSeconds + delta.breakSec,
    idleDeductedSec,
    idlePendingSec: delta.idlePendingSec,
    idleSec: idleDeductedSec + delta.idlePendingSec,
    claimedSec: delta.claimedSec,
    perTask,
  };
}

/**
 * Largest-remainder rounding: per-task minutes that add up to `targetMin`
 * (default round(Σ/60)). 4 × 20m20s → [20, 20, 20, 21] = 81, not 80.
 */
export function largestRemainderMinutes(seconds: readonly number[], targetMin?: number): number[] {
  const total = seconds.reduce((a, b) => a + b, 0);
  const target = targetMin ?? Math.round(total / 60);
  const exact = seconds.map((s) => s / 60);
  const floors = exact.map((e) => Math.floor(e));
  let remaining = target - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || b.i - a.i);
  const out = [...floors];
  for (let k = 0; remaining > 0 && k < order.length; k++, remaining--) out[order[k].i] += 1;
  // Pathological negative remainder (target below floors) — take from the smallest remainders.
  for (let k = order.length - 1; remaining < 0 && k >= 0; k--) {
    if (out[order[k].i] > 0) {
      out[order[k].i] -= 1;
      remaining++;
    }
  }
  return out;
}

export interface TimelineInput {
  segments: readonly Segment[];
  live?: LiveState | null;
  taskKey: (taskId: string | null) => string;
}

export type Bar = { kind: SegmentKind | 'GAP'; flex: number; label: string };

const KIND_LABEL: Record<SegmentKind, string> = {
  WORK: 'Active',
  BREAK: 'Break',
  IDLE: 'Idle',
  IDLE_WORK: 'Active (claimed)',
};

/** One coloured span of the day (server timeline block or local segment). `label` is the task key. */
export interface TimelineSpan {
  kind: SegmentKind;
  label: string | null;
  from: number;
  to: number;
}

/**
 * Timeline bar from first punch-in to now / last punch-out: adjacent spans of the same
 * kind+task merge, gaps between sessions (> 1 min) are blank.
 */
export function timelineFromSpans(input: readonly TimelineSpan[]): Bar[] {
  const spans = input.filter((s) => s.to > s.from).map((s) => ({ ...s }));
  spans.sort((a, b) => a.from - b.from);

  const merged: TimelineSpan[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && last.kind === s.kind && last.label === s.label && s.from - last.to <= 1000) last.to = Math.max(last.to, s.to);
    else if (last && s.from < last.to) {
      // overlapping spans (server block + a local span it already contains): keep the later part only
      if (s.to > last.to) merged.push({ ...s, from: last.to });
    } else merged.push(s);
  }

  const bars: Bar[] = [];
  let cursor: number | null = null;
  for (const s of merged) {
    if (cursor !== null && s.from - cursor > 60_000) {
      bars.push({ kind: 'GAP', flex: (s.from - cursor) / 1000, label: `${clock(cursor)}–${clock(s.from)} Not tracked` });
    }
    const task = (s.kind === 'WORK' || s.kind === 'IDLE_WORK') && s.label ? ` · ${s.label}` : '';
    bars.push({ kind: s.kind, flex: (s.to - s.from) / 1000, label: `${clock(s.from)}–${clock(s.to)} ${KIND_LABEL[s.kind]}${task}` });
    cursor = cursor === null ? s.to : Math.max(cursor, s.to);
  }
  return bars;
}

/** Local spans (closed segments + the live open segment + an unresolved idle span). */
export function localSpans(segments: readonly Segment[], live: LiveState | null | undefined, taskKey: (taskId: string | null) => string): TimelineSpan[] {
  const label = (kind: SegmentKind, taskId: string | null) => (kind === 'WORK' || kind === 'IDLE_WORK' ? taskKey(taskId) : null);
  const spans: TimelineSpan[] = segments.map((s) => ({ kind: s.kind, label: label(s.kind, s.taskId), from: s.startedAt, to: s.endedAt }));
  if (live?.open && live.openEnd > live.open.startedAt)
    spans.push({ kind: live.open.kind, label: label(live.open.kind, live.open.taskId), from: live.open.startedAt, to: live.openEnd });
  if (live?.pendingIdle && live.pendingIdle.end > live.pendingIdle.since)
    spans.push({ kind: 'IDLE', label: null, from: live.pendingIdle.since, to: live.pendingIdle.end });
  return spans;
}

export function buildTimeline({ segments, live, taskKey }: TimelineInput): Bar[] {
  return timelineFromSpans(localSpans(segments, live, taskKey));
}
