/**
 * Pure business rules for tracker ingest (no Nest / Prisma). Unit-tested in tracker.rules.spec.ts.
 * Shared device/server formulas (summaries, validation, idle mapping) live in
 * packages/shared/src/tracker.ts and are re-exported here for the services.
 */
import {
  SKEW_CORRECT_THRESHOLD_SEC,
  estimateSkewSeconds,
  resolveSegmentKind,
  summarizeSegments,
  validateSegments,
  type IdleResolution,
  type SegmentKind,
  type TrackerEvent,
  type TrackerTimelineBlock,
} from '@lexisora/shared';

export { estimateSkewSeconds, resolveSegmentKind, summarizeSegments, validateSegments, SKEW_CORRECT_THRESHOLD_SEC };

/** Split items into ones not seen before and duplicates (already stored, or repeated in the batch). */
export function partitionByClientId<T extends { clientId: string }>(items: T[], existing: Iterable<string>) {
  const seen = new Set(existing);
  const fresh: T[] = [];
  let duplicates = 0;
  for (const it of items) {
    if (seen.has(it.clientId)) duplicates++;
    else {
      seen.add(it.clientId);
      fresh.push(it);
    }
  }
  return { fresh, duplicates };
}

/**
 * Device times are corrected only when the skew exceeds the threshold (5 min); small NTP-level
 * drift is ignored so a punch stays where the user saw it.
 */
export function correctedInstant(iso: string, skewSec: number, threshold = SKEW_CORRECT_THRESHOLD_SEC): Date {
  const t = Date.parse(iso);
  return new Date(Math.abs(skewSec) > threshold ? t - skewSec * 1000 : t);
}

export function isSkewFlagged(skewSec: number, threshold = SKEW_CORRECT_THRESHOLD_SEC) {
  return Math.abs(skewSec) > threshold;
}

/**
 * Finds the user's answer to the idle dialog for an IDLE segment: an IDLE_RESOLVED event whose
 * idleFrom matches the segment start (± 2 s). Explicit segment.resolution wins.
 */
export function matchIdleResolution(
  seg: { startedAt: string; resolution?: IdleResolution },
  events: Pick<TrackerEvent, 'type' | 'idleFrom' | 'resolution'>[],
): IdleResolution | undefined {
  if (seg.resolution) return seg.resolution;
  const s = Date.parse(seg.startedAt);
  const ev = events.find((e) => e.type === 'IDLE_RESOLVED' && e.idleFrom && e.resolution && Math.abs(Date.parse(e.idleFrom) - s) <= 2000);
  return ev?.resolution;
}

/**
 * Idle-claim reviewer: the project lead of the task's project; for internal/standing tasks or
 * when the lead is the claimant themself, the reporting manager. Never the claimant.
 */
export function pickClaimReviewer(input: {
  employeeId: string;
  projectLeadId?: string | null;
  projectIsInternal?: boolean;
  managerId?: string | null;
}): string | null {
  const { employeeId, projectLeadId, projectIsInternal, managerId } = input;
  if (projectLeadId && !projectIsInternal && projectLeadId !== employeeId) return projectLeadId;
  if (managerId && managerId !== employeeId) return managerId;
  return null;
}

type SegLike = {
  kind: SegmentKind | string;
  idleResolution?: string | null;
  claimStatus?: string | null;
  startAt: Date;
  endAt: Date;
  taskId: string | null;
};

/** Timeline block kind for a stored segment (approved claims show as work). */
export function displayKind(s: Pick<SegLike, 'kind' | 'idleResolution' | 'claimStatus'>): 'WORK' | 'BREAK' | 'IDLE' {
  if (s.kind === 'WORK') return 'WORK';
  if (s.kind === 'BREAK') return 'BREAK';
  if (s.idleResolution === 'AS_BREAK') return 'BREAK';
  if (s.kind === 'IDLE_WORK' && s.claimStatus === 'APPROVED') return 'WORK';
  return 'IDLE';
}

/** Compacts segments into contiguous timeline blocks (merging same kind + task with ≤ 60 s gaps). */
export function buildTimeline(segments: SegLike[], keyOf: (taskId: string | null) => string | null): TrackerTimelineBlock[] {
  const sorted = [...segments].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const out: (TrackerTimelineBlock & { _s: number; _e: number })[] = [];
  for (const s of sorted) {
    const kind = displayKind(s);
    const taskKey = kind === 'WORK' ? keyOf(s.taskId) : null;
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.taskKey === taskKey && s.startAt.getTime() - last._e <= 60_000) {
      last._e = Math.max(last._e, s.endAt.getTime());
      last.endAt = new Date(last._e).toISOString();
    } else {
      out.push({ kind, taskKey, startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), _s: s.startAt.getTime(), _e: s.endAt.getTime() });
    }
  }
  return out.map(({ _s, _e, ...b }) => b);
}

/**
 * Gaps in tracking while the employee was punched in: spans inside a work session not covered
 * by any segment, longer than `minGapSec` (default 15 min). Sessions without an end use `now`.
 */
export function findTrackingGaps(
  segments: { startAt: Date; endAt: Date }[],
  sessions: { startedAt: Date; endedAt: Date | null }[],
  opts: { now: Date; minGapSec?: number },
): { from: Date; to: Date; seconds: number }[] {
  const min = (opts.minGapSec ?? 900) * 1000;
  const segs = [...segments].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  if (!segs.length) return [];
  const gaps: { from: Date; to: Date; seconds: number }[] = [];
  for (const ses of sessions) {
    const sStart = ses.startedAt.getTime();
    // an open session only counts up to the last tracked instant (the device may not have synced yet)
    const lastSeg = segs[segs.length - 1]!.endAt.getTime();
    const sEnd = ses.endedAt ? ses.endedAt.getTime() : Math.min(opts.now.getTime(), lastSeg);
    const inside = segs.filter((g) => g.endAt.getTime() > sStart && g.startAt.getTime() < sEnd);
    if (!inside.length) continue; // device not used in this session (e.g. biometric day without tracker)
    let cursor = Math.max(sStart, inside[0]!.startAt.getTime());
    for (const g of inside) {
      const gs = Math.max(g.startAt.getTime(), sStart);
      if (gs - cursor >= min) gaps.push({ from: new Date(cursor), to: new Date(gs), seconds: Math.round((gs - cursor) / 1000) });
      cursor = Math.max(cursor, Math.min(g.endAt.getTime(), sEnd));
    }
    if (ses.endedAt && sEnd - cursor >= min) gaps.push({ from: new Date(cursor), to: new Date(sEnd), seconds: Math.round((sEnd - cursor) / 1000) });
  }
  return gaps;
}

/** Expected vs actual screenshots — flag when ≥ 3 are missing (T4/T8). */
export function missingScreenshots(workedSec: number, intervalMin: number, actual: number): number {
  if (intervalMin <= 0) return 0;
  const expected = Math.floor(workedSec / (intervalMin * 60));
  return Math.max(0, expected - actual);
}

/** Monday (YYYY-MM-DD) of the ISO week containing the date key. */
export function weekStartOf(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function addDays(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** @db.Date value for an IST date key (UTC midnight of that date). */
export const dbDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
export const dateKeyOf = (d: Date) => d.toISOString().slice(0, 10);

/** "09:30" from minutes after midnight. */
export const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Compare dotted versions ("1.4.2" < "1.4.10"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Wrong pairing codes allowed per user per window before lookups are blocked. */
export const PAIR_MAX_WRONG = 5;
export const PAIR_WINDOW_MIN = 15;
export const PAIR_CODE_TTL_MIN = 10;
export const PAIR_SESSION_TTL_MIN = 15;
export const MAX_ACTIVE_DEVICES = 2;

export function isRateLimited(wrongAttemptsInWindow: number, max = PAIR_MAX_WRONG) {
  return wrongAttemptsInWindow >= max;
}
