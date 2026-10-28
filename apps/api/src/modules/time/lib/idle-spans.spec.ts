import { describe, expect, it } from 'vitest';
import { freePart, idleSpanLabel, splitByIdle } from './idle-spans';
import { istInstant } from './time-utils';

const at = (hm: string) => {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return istInstant('2026-10-13', h * 60 + m);
};
const span = (from: string, to: string, reason = 'MEETING', note: string | null = null) => ({ startedAt: at(from), endedAt: at(to), reason, note });
const hm = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(11, 16);

describe('idle spans', () => {
  it('labels each reason, with the typed text for Other', () => {
    expect(idleSpanLabel(span('10:05', '10:23', 'BREAK'))).toBe('Idle 10:05–10:23 · Break');
    expect(idleSpanLabel(span('10:05', '10:23', 'MEETING'))).toBe('Idle 10:05–10:23 · Meeting');
    expect(idleSpanLabel(span('10:05', '10:23', 'OTHER', 'Power cut at home'))).toBe('Idle 10:05–10:23 · Other: Power cut at home');
  });

  it('cuts idle spans out of active time and clips them to it', () => {
    const pieces = splitByIdle(at('09:30').getTime(), at('13:00').getTime(), [span('12:40', '13:30'), span('10:05', '10:23')]);
    expect(pieces.map((p) => `${hm(p.start)}-${hm(p.end)}${p.idle ? ' idle' : ''}`)).toEqual([
      '09:30-10:05',
      '10:05-10:23 idle',
      '10:23-12:40',
      '12:40-13:00 idle',
    ]);
  });

  it('ignores idle outside the range and handles overlapping spans', () => {
    expect(splitByIdle(at('09:30').getTime(), at('10:00').getTime(), [span('08:00', '09:00')])).toHaveLength(1);
    const pieces = splitByIdle(at('09:00').getTime(), at('11:00').getTime(), [span('09:30', '10:15'), span('10:00', '10:30')]);
    expect(pieces.map((p) => `${hm(p.start)}-${hm(p.end)}${p.idle ? ' idle' : ''}`)).toEqual(['09:00-09:30', '09:30-10:15 idle', '10:15-10:30 idle', '10:30-11:00']);
  });

  it('keeps only time not already saved, or nothing', () => {
    const free = freePart(at('10:00').getTime(), at('10:30').getTime(), [span('09:50', '10:10')]);
    expect(free && `${hm(free.from)}-${hm(free.to)}`).toBe('10:10-10:30');
    expect(freePart(at('10:00').getTime(), at('10:30').getTime(), [span('09:00', '11:00')])).toBeNull();
  });
});
