import { IDLE_SPAN_REASON_LABEL, type IdleSpanReason } from '@lexisora/shared';
import { istHm } from './time-utils';

/**
 * Web idle spans (no input ≥ autoIdleMinutes while punched in) and the reason picked on
 * return. Pure helpers: clipping a new span against saved ones, and cutting spans out of a
 * session's active time for the day timeline.
 */
export type IdleSpanLike = { startedAt: Date; endedAt: Date; reason: string; note: string | null };
type Span = { startedAt: Date; endedAt: Date };

/** "Idle 10:05–10:23 · Meeting", "Idle 10:05–10:23 · Other: Power cut at home". */
export function idleSpanLabel(s: IdleSpanLike): string {
  const name = IDLE_SPAN_REASON_LABEL[s.reason as IdleSpanReason] ?? s.reason;
  const why = s.note ? `${name}${s.reason === 'OTHER' ? ':' : ' ·'} ${s.note}` : name;
  return `Idle ${istHm(s.startedAt)}–${istHm(s.endedAt)} · ${why}`;
}

/** Split [start, end) into consecutive pieces, each either inside one idle span or outside all of them. */
export function splitByIdle<T extends Span>(start: number, end: number, spans: readonly T[]): { start: number; end: number; idle: T | null }[] {
  const out: { start: number; end: number; idle: T | null }[] = [];
  let cur = start;
  for (const s of [...spans].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) {
    const a = Math.max(cur, s.startedAt.getTime());
    const b = Math.min(end, s.endedAt.getTime());
    if (b <= a) continue;
    if (a > cur) out.push({ start: cur, end: a, idle: null });
    out.push({ start: a, end: b, idle: s });
    cur = b;
  }
  if (cur < end) out.push({ start: cur, end, idle: null });
  return out;
}

/** The longest part of [from, to) not already covered by `taken` (null when nothing is left). */
export function freePart(from: number, to: number, taken: readonly Span[]): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null;
  for (const p of splitByIdle(from, to, taken)) {
    if (!p.idle && (!best || p.end - p.start > best.to - best.from)) best = { from: p.start, to: p.end };
  }
  return best;
}
