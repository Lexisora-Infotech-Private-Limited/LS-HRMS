import { describe, expect, it } from 'vitest';
import { buildTimeline, combine, computeTotals, largestRemainderMinutes } from './summary';
import type { Segment } from './types';

const ist = (hhmm: string) => Date.parse(`2026-09-29T${hhmm}:00+05:30`);
let n = 0;
const seg = (kind: Segment['kind'], taskId: string | null, from: string, to: string): Segment => ({
  clientId: `id-${++n}`,
  kind,
  taskId,
  startedAt: ist(from),
  endedAt: ist(to),
});

describe('computeTotals', () => {
  it('sums worked (incl. claimed idle), break, idle and per-task', () => {
    const t = computeTotals([
      seg('WORK', 'AT-101', '09:30', '11:00'),
      seg('IDLE_WORK', 'AT-101', '11:00', '11:28'),
      seg('BREAK', null, '13:00', '13:55'),
      seg('IDLE', null, '15:00', '15:25'),
      seg('WORK', 'INT', '15:25', '16:00'),
    ]);
    expect(t.workedSec / 60).toBe(90 + 28 + 35);
    expect(t.claimedSec / 60).toBe(28);
    expect(t.breakSec / 60).toBe(55);
    expect(t.idleSec / 60).toBe(25);
    expect(t.perTask.get('AT-101')! / 60).toBe(118);
    expect(t.perTask.get('INT')! / 60).toBe(35);
  });

  it('adds the live open segment and pending idle', () => {
    const open = { clientId: 'o', kind: 'WORK' as const, taskId: 'AT-103', startedAt: ist('10:00') };
    const t = computeTotals([], { open, openEnd: ist('10:30'), pendingIdle: { since: ist('10:30'), end: ist('10:36') } });
    expect(t.workedSec / 60).toBe(30);
    expect(t.idlePendingSec / 60).toBe(6);
    expect(t.idleSec / 60).toBe(6);
  });

  it('combines a server baseline with the local delta', () => {
    const delta = computeTotals([seg('WORK', 'AT-101', '12:00', '12:30')]);
    const c = combine(
      { workedSeconds: 3600, breakSeconds: 600, idleSeconds: 300, screenshots: 6, byTask: [{ taskId: 'AT-101', key: 'AT-101', title: 'x', seconds: 3600 }] },
      delta,
    );
    expect(c.workedSec).toBe(5400);
    expect(c.perTask.get('AT-101')).toBe(5400);
    expect(c.breakSec).toBe(600);
    expect(c.idleSec).toBe(300);
  });
});

describe('largestRemainderMinutes', () => {
  it('4 tasks × 20m20s sum to 81, not 80 (spec T6 acceptance #5)', () => {
    const out = largestRemainderMinutes([1220, 1220, 1220, 1220]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(81);
    expect(out).toEqual([20, 20, 20, 21]);
  });
  it('honours an explicit target', () => {
    // 1.5 + 1.5 min → floors 1 + 1, one extra minute to the tie-broken last row
    expect(largestRemainderMinutes([90, 90], 3)).toEqual([1, 2]);
    expect(largestRemainderMinutes([90, 90], 2)).toEqual([1, 1]);
  });
  it('handles empty input', () => {
    expect(largestRemainderMinutes([])).toEqual([]);
  });
});

describe('buildTimeline', () => {
  it('merges adjacent spans, labels them and inserts gaps between sessions', () => {
    const bars = buildTimeline({
      segments: [
        seg('WORK', 'AT-101', '09:28', '10:00'),
        seg('WORK', 'AT-101', '10:00', '11:00'), // checkpoint split — merged
        seg('WORK', 'AT-103', '11:00', '13:00'),
        seg('BREAK', null, '13:00', '13:55'),
        seg('WORK', 'AT-103', '13:55', '15:00'),
        seg('WORK', 'AT-103', '16:00', '17:00'), // second session after a gap
      ],
      taskKey: (id) => id ?? '—',
    });
    expect(bars.map((b) => b.kind)).toEqual(['WORK', 'WORK', 'BREAK', 'WORK', 'GAP', 'WORK']);
    expect(bars[0].label).toBe('09:28–11:00 Active · AT-101');
    expect(bars[0].flex).toBe(92 * 60);
    expect(bars[4].label).toContain('Not tracked');
  });
});
