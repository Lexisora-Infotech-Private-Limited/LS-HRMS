import { describe, expect, it } from 'vitest';
import { FORWARD_CONFIRM_MS, TrustedClock, formatDrift } from './clock';

const H = 3_600_000;

/** Fake wall + monotonic clocks: `advance` is real time passing, `setClock` is the user changing the PC clock. */
function fake(startWall = Date.parse('2026-09-29T11:00:00+05:30')) {
  let wall = startWall;
  let mono = 1_000;
  return {
    src: { wall: () => wall, mono: () => mono },
    advance(ms: number) {
      wall += ms;
      mono += ms;
    },
    setClock(deltaMs: number) {
      wall += deltaMs;
    },
    /** Sleep: the wall clock always moves; the monotonic clock may not count it. */
    sleep(ms: number, monoCounts = false) {
      wall += ms;
      if (monoCounts) mono += ms;
    },
  };
}

describe('TrustedClock · clock change detection (spec T5 §5)', () => {
  it('follows the PC clock while nothing changes', () => {
    const f = fake();
    const c = new TrustedClock(f.src);
    f.advance(1_000);
    expect(c.now()).toBe(f.src.wall());
    f.advance(59_000);
    expect(c.now()).toBe(f.src.wall());
    expect(c.takeChanges()).toEqual([]);
    expect(c.adjusted).toBe(false);
  });

  it('ignores NTP-sized corrections (≤ 30 s)', () => {
    const f = fake();
    const c = new TrustedClock(f.src);
    f.setClock(20_000);
    f.advance(1_000);
    expect(c.now()).toBe(f.src.wall());
    expect(c.takeChanges()).toEqual([]);
  });

  it('clock set back 2 h → CLOCK_CHANGE −7200 at once and the timeline stays continuous', () => {
    const f = fake();
    const c = new TrustedClock(f.src);
    f.advance(1_000);
    const before = c.now();
    f.setClock(-2 * H);
    f.advance(1_000);
    const after = c.now();
    expect(after).toBe(before + 1_000);
    expect(c.takeChanges()).toEqual([{ at: after, driftSec: -7200, cause: 'JUMP' }]);
    expect(c.adjusted).toBe(true);
    f.advance(5_000);
    expect(c.now()).toBe(before + 6_000);
  });

  it('clock set forward 2 h → no stretched time; reported once no resume follows', () => {
    const f = fake();
    const c = new TrustedClock(f.src);
    f.advance(1_000);
    const before = c.now();
    f.setClock(2 * H);
    f.advance(1_000);
    expect(c.now()).toBe(before + 1_000);
    expect(c.takeChanges()).toEqual([]); // waiting: could still be sleep without a suspend signal
    f.advance(FORWARD_CONFIRM_MS);
    expect(c.takeChanges()).toEqual([{ at: before + 1_000, driftSec: 7200, cause: 'JUMP' }]);
    expect(c.now()).toBe(before + 1_000 + FORWARD_CONFIRM_MS);
  });

  it('putting the clock back where it was ends the adjustment', () => {
    const f = fake();
    const c = new TrustedClock(f.src);
    f.advance(1_000);
    f.setClock(-2 * H);
    f.advance(1_000);
    c.now();
    expect(c.takeChanges().map((x) => x.driftSec)).toEqual([-7200]);
    f.setClock(2 * H);
    f.advance(1_000);
    expect(c.now()).toBe(f.src.wall());
    expect(c.adjusted).toBe(false);
    f.advance(FORWARD_CONFIRM_MS);
    expect(c.takeChanges().map((x) => x.driftSec)).toEqual([7200]);
  });

  it('sleep with suspend/resume signals is elapsed time, not a clock change', () => {
    const f = fake();
    const c = new TrustedClock(f.src);
    f.advance(1_000);
    c.notePower('SUSPEND');
    f.sleep(H); // monotonic clock did not count the sleep
    c.notePower('RESUME');
    f.advance(1_000);
    expect(c.now()).toBe(f.src.wall());
    expect(c.takeChanges()).toEqual([]);
    expect(c.adjusted).toBe(false);
  });

  it('sleep counted by the monotonic clock needs no signal at all', () => {
    const f = fake();
    const c = new TrustedClock(f.src);
    f.sleep(H, true);
    expect(c.now()).toBe(f.src.wall());
    expect(c.takeChanges()).toEqual([]);
  });

  it('resume without the matching suspend gives the jump back as elapsed time', () => {
    const f = fake();
    const c = new TrustedClock(f.src);
    f.advance(1_000);
    const before = c.now();
    f.sleep(H);
    f.advance(1_000);
    expect(c.now()).toBe(before + 1_000); // looks like a forward jump for a moment
    c.notePower('RESUME');
    expect(c.now()).toBe(f.src.wall()); // the caller now sees a 1 h gap and handles it as sleep
    expect(c.adjusted).toBe(false);
    f.advance(FORWARD_CONFIRM_MS);
    expect(c.takeChanges()).toEqual([]);
  });

  it('a server-verified time ends a lag at once (time moves forward)', () => {
    const f = fake();
    const c = new TrustedClock(f.src);
    f.advance(1_000);
    f.sleep(H); // both power signals missed
    f.advance(1_000);
    c.now();
    f.advance(FORWARD_CONFIRM_MS);
    expect(c.takeChanges().map((x) => x.driftSec)).toEqual([3600]);
    expect(c.offsetMs).toBe(-H);
    expect(c.verify(f.src.wall() + 40_000, false)).toBe(false); // server disagrees by more than 30 s
    expect(c.verify(f.src.wall() + 2_000, false)).toBe(true);
    expect(c.now()).toBe(f.src.wall());
  });

  it('a timeline ahead of the server is only corrected while not tracking, and never runs backwards', () => {
    const f = fake();
    const c = new TrustedClock(f.src);
    f.advance(1_000);
    f.setClock(-10 * 60_000); // e.g. a PC that ran 10 min fast was put right mid-session
    f.advance(1_000);
    const held = c.now();
    expect(c.offsetMs).toBe(10 * 60_000);
    expect(c.verify(f.src.wall(), false)).toBe(false);
    expect(c.verify(f.src.wall(), true)).toBe(true);
    expect(c.now()).toBe(held); // holds still instead of going back
    f.advance(5 * 60_000);
    expect(c.now()).toBe(held);
    f.advance(6 * 60_000);
    expect(c.now()).toBe(f.src.wall());
  });

  it('start-up with the PC clock behind the last recorded time → RESTART change, timeline continues', () => {
    const f = fake();
    const c = new TrustedClock(f.src);
    const last = f.src.wall() + 2 * H;
    const ch = c.resumeFrom(last);
    expect(ch).toEqual({ at: last, driftSec: -7200, cause: 'RESTART' });
    expect(c.now()).toBe(last);
    f.advance(5_000);
    expect(c.now()).toBe(last + 5_000);
    expect(c.takeChanges()).toEqual([ch]);

    expect(new TrustedClock(f.src).resumeFrom(f.src.wall() - 60_000)).toBeNull(); // clock moved on normally
    expect(new TrustedClock(f.src).resumeFrom(f.src.wall() + 20_000)).toBeNull(); // within tolerance
    expect(new TrustedClock(f.src).resumeFrom(null)).toBeNull();
  });

  it('formats drift for logs', () => {
    expect(formatDrift(-7200)).toBe('−2h 00m');
    expect(formatDrift(2700)).toBe('+45m');
    expect(formatDrift(-45)).toBe('−45s');
    expect(formatDrift(5430)).toBe('+1h 30m');
  });
});
