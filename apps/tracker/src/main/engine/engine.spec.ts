import { describe, expect, it } from 'vitest';
import { istDayKey } from '@tracker-shared/format';
import { TrackerEngine } from './engine';
import type { EngineOutput, Segment } from './types';

/** 29 Sep 2026, IST wall-clock → epoch ms. */
const ist = (hhmm: string, ss = 0) => Date.parse(`2026-09-29T${hhmm}:${String(ss).padStart(2, '0')}+05:30`);
const MIN = 60_000;

function make(config: Partial<ConstructorParameters<typeof TrackerEngine>[0]['config']> = {}) {
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  return new TrackerEngine({
    uuid,
    dayKey: istDayKey,
    now: ist('09:00'),
    config: { idleThresholdSec: 300, screenshotIntervalSec: 600, breakReminderSec: 7200, checkpointSec: 900, ...config },
  });
}

/** Tick every `stepSec` from `from` (exclusive) to `to` (inclusive) with the given system idle. */
function run(e: TrackerEngine, from: number, to: number, idle: (t: number) => number = () => 0, stepSec = 5) {
  const outs: EngineOutput[] = [];
  for (let t = from + stepSec * 1000; t <= to; t += stepSec * 1000) outs.push(e.tick(t, idle(t)));
  return outs;
}

const mins = (sec: number) => Math.round(sec / 60);
const spanInvariant = (e: TrackerEngine, now: number) => {
  const t = e.totals(now);
  return t.workedSec + t.breakSec + t.idleSec;
};
const noOverlap = (segs: readonly Segment[]) => {
  const s = [...segs].sort((a, b) => a.startedAt - b.startedAt);
  for (let i = 1; i < s.length; i++) expect(s[i].startedAt).toBeGreaterThanOrEqual(s[i - 1].endedAt);
};

describe('TrackerEngine — punch, task switching, breaks (spec T3 acceptance #1)', () => {
  it('produces the per-task, break and worked totals and keeps span = worked + break + idle', () => {
    const e = make();
    const ev = [
      ...e.punchIn(ist('09:28'), 'AT-101').events,
    ];
    run(e, ist('09:28'), ist('11:00'));
    ev.push(...e.switchTask(ist('11:00'), 'AT-103').events);
    run(e, ist('11:00'), ist('13:00'));
    ev.push(...e.startBreak(ist('13:00')).events);
    run(e, ist('13:00'), ist('13:55'), () => 3000);
    ev.push(...e.endBreak(ist('13:55')).events);
    run(e, ist('13:55'), ist('18:42'));
    ev.push(...e.punchOut(ist('18:42')).events);

    const t = e.totals(ist('18:42'));
    expect(mins(t.perTask.get('AT-101')!)).toBe(92); // 1h32m
    expect(mins(t.perTask.get('AT-103')!)).toBe(407); // 6h47m
    expect(mins(t.breakSec)).toBe(55);
    expect(mins(t.workedSec)).toBe(499); // 8h19m
    expect(t.idleSec).toBe(0);
    expect((ist('18:42') - ist('09:28')) / 1000).toBe(spanInvariant(e, ist('18:42')));
    expect(ev.map((x) => x.type)).toEqual(['PUNCH_IN', 'TASK_SWITCH', 'BREAK_START', 'BREAK_END', 'PUNCH_OUT']);
    noOverlap(e.segments);
    // Checkpointing split long segments but never changed totals.
    expect(e.segments.length).toBeGreaterThan(4);
    expect(e.status).toBe('OUT');
  });

  it('switching task mid-segment splits exactly at the switch moment', () => {
    const e = make();
    e.punchIn(ist('10:00'), 'AT-101');
    const out = e.switchTask(ist('10:17', 30), 'AT-110');
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]).toMatchObject({ kind: 'WORK', taskId: 'AT-101', startedAt: ist('10:00'), endedAt: ist('10:17', 30) });
    expect(out.events[0]).toMatchObject({ type: 'TASK_SWITCH', taskId: 'AT-110' });
    const t = e.totals(ist('10:30'));
    expect(t.perTask.get('AT-101')).toBe(17.5 * 60);
    expect(t.perTask.get('AT-110')).toBe(12.5 * 60);
    // same task again is a no-op
    expect(e.switchTask(ist('10:31'), 'AT-110').events).toHaveLength(0);
  });

  it('switching task during a break applies to the work after the break', () => {
    const e = make();
    e.punchIn(ist('10:00'), 'AT-101');
    e.startBreak(ist('11:00'));
    const out = e.switchTask(ist('11:05'), 'AT-103');
    expect(out.segments).toHaveLength(0);
    e.endBreak(ist('11:10'));
    e.punchOut(ist('11:40'));
    const t = e.totals(ist('11:40'));
    expect(mins(t.perTask.get('AT-101')!)).toBe(60);
    expect(mins(t.perTask.get('AT-103')!)).toBe(30);
    expect(mins(t.breakSec)).toBe(10);
  });

  it('break toggling emits BREAK_START/BREAK_END and rejects invalid transitions', () => {
    const e = make();
    expect(() => e.startBreak(ist('09:00'))).toThrow(/Punch in/);
    e.punchIn(ist('09:30'), 'AT-101');
    expect(() => e.endBreak(ist('09:31'))).toThrow();
    expect(e.toggleBreak(ist('10:00')).events[0].type).toBe('BREAK_START');
    expect(e.status).toBe('BREAK');
    expect(() => e.startBreak(ist('10:01'))).toThrow();
    expect(e.toggleBreak(ist('10:15')).events[0].type).toBe('BREAK_END');
    expect(e.status).toBe('WORKING');
    expect(mins(e.totals(ist('10:15')).breakSec)).toBe(15);
  });

  it('never detects idle while on break', () => {
    const e = make();
    e.punchIn(ist('09:30'), 'AT-101');
    e.startBreak(ist('10:00'));
    const outs = run(e, ist('10:00'), ist('10:30'), () => 1800);
    expect(outs.some((o) => o.idleStarted)).toBe(false);
    expect(e.prompting).toBe(false);
  });
});

describe('idle state machine — threshold transitions', () => {
  it('stays working just below the threshold and opens the prompt at it', () => {
    const e = make();
    e.punchIn(ist('11:00'), 'AT-101');
    run(e, ist('11:00'), ist('11:42'));
    // No input from 11:42. At 11:46:59 idle = 299 s → still working.
    const below = e.tick(ist('11:46', 59), 299);
    expect(below.idleStarted).toBe(false);
    const at = e.tick(ist('11:47'), 300);
    expect(at.idleStarted).toBe(true);
    expect(at.events[0]).toMatchObject({ type: 'IDLE_START', at: ist('11:42') });
    // The work segment is closed retroactively at the last input.
    expect(at.segments.at(-1)).toMatchObject({ kind: 'WORK', endedAt: ist('11:42') });
    expect(e.prompting).toBe(true);
    // Idle is excluded from worked until chosen and shows as idle.
    const t = e.totals(ist('11:49'));
    expect(mins(t.workedSec)).toBe(42);
    expect(mins(t.idlePendingSec)).toBe(7);
    expect(e.shotsPaused).toBe(true);
  });

  it('respects a disabled threshold (0)', () => {
    const e = make({ idleThresholdSec: 0 });
    e.punchIn(ist('11:00'), 'AT-101');
    expect(e.tick(ist('12:00'), 3600).idleStarted).toBe(false);
  });

  it('blocks punch-out, breaks and task switches while the prompt is open', () => {
    const e = make();
    e.punchIn(ist('11:00'), 'AT-101');
    e.tick(ist('11:10'), 300);
    expect(() => e.punchOut(ist('11:11'))).toThrow(/idle/);
    expect(() => e.startBreak(ist('11:11'))).toThrow(/idle/);
    expect(() => e.switchTask(ist('11:11'), 'AT-103')).toThrow(/idle/);
  });
});

describe('idle resolutions', () => {
  /** Spec T3 acceptance #2: no input 11:42, dialog 11:47, mouse 11:50, choice 11:51. */
  function scenario() {
    const e = make();
    e.punchIn(ist('11:00'), 'AT-101');
    run(e, ist('11:00'), ist('11:42'));
    e.tick(ist('11:47'), 300);
    e.tick(ist('11:48'), 360);
    e.tick(ist('11:50'), 0); // first input
    e.tick(ist('11:50', 30), 1);
    return e;
  }

  it('"Mark as idle & resume" → IDLE 11:42–11:50 deducted, 11:50–11:51 active', () => {
    const e = scenario();
    const out = e.resolveIdle(ist('11:51'), 'IDLE');
    expect(out.segments.map((s) => [s.kind, s.startedAt, s.endedAt])).toEqual([
      ['IDLE', ist('11:42'), ist('11:50')],
      ['WORK', ist('11:50'), ist('11:51')],
    ]);
    expect(out.events[0]).toMatchObject({ type: 'IDLE_RESOLVED', resolution: 'IDLE', idleFrom: ist('11:42') });
    const t = e.totals(ist('11:51'));
    expect(mins(t.idleDeductedSec)).toBe(8);
    expect(mins(t.workedSec)).toBe(43);
    expect(e.prompting).toBe(false);
    expect(e.status).toBe('WORKING');
  });

  it('"I was working" → IDLE_WORK on the active task, counted as worked, pending review', () => {
    const e = scenario();
    const out = e.resolveIdle(ist('11:51'), 'WORKING', 'Client call');
    expect(out.segments[0]).toMatchObject({ kind: 'IDLE_WORK', taskId: 'AT-101', startedAt: ist('11:42'), endedAt: ist('11:50') });
    expect(out.events[0]).toMatchObject({ resolution: 'WORKING', note: 'Client call' });
    const t = e.totals(ist('11:51'));
    expect(mins(t.workedSec)).toBe(51);
    expect(mins(t.claimedSec)).toBe(8);
    expect(t.idleSec).toBe(0);
    expect(mins(t.perTask.get('AT-101')!)).toBe(51);
  });

  it('"Count it as a break" → BREAK segment, status back to working', () => {
    const e = scenario();
    const out = e.resolveIdle(ist('11:51'), 'BREAK');
    expect(out.segments[0]).toMatchObject({ kind: 'BREAK', taskId: null });
    const t = e.totals(ist('11:51'));
    expect(mins(t.breakSec)).toBe(8);
    expect(e.status).toBe('WORKING');
    expect((ist('11:51') - ist('11:00')) / 1000).toBe(spanInvariant(e, ist('11:51')));
  });

  it('without input the idle span runs until the choice', () => {
    const e = make();
    e.punchIn(ist('11:00'), 'AT-101');
    e.tick(ist('11:30'), 300);
    const out = e.resolveIdle(ist('11:40'), 'IDLE');
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]).toMatchObject({ kind: 'IDLE', startedAt: ist('11:25'), endedAt: ist('11:40') });
  });

  it('resolving without a prompt is an error', () => {
    const e = make();
    e.punchIn(ist('11:00'), 'AT-101');
    expect(() => e.resolveIdle(ist('11:01'), 'IDLE')).toThrow();
  });
});

describe('lock / suspend / app gaps', () => {
  it('lock 13:05–13:52 prompts on unlock and "Count it as a break" adds 47 min (acceptance #4)', () => {
    const e = make();
    e.punchIn(ist('09:30'), 'AT-101');
    const lk = e.lock(ist('13:05'), 'LOCK', ist('13:05'));
    expect(lk.events[0].type).toBe('LOCK');
    expect(e.away).toBe(true);
    expect(e.shotsPaused).toBe(true);
    // Ticks while locked don't move anything.
    expect(e.tick(ist('13:30'), 1500).idleStarted).toBe(false);
    expect(mins(e.totals(ist('13:30')).workedSec)).toBe(215); // frozen at 13:05
    const un = e.unlock(ist('13:52'), 'UNLOCK');
    expect(un.idleStarted).toBe(true);
    expect(e.idleCause()).toBe('LOCK');
    e.resolveIdle(ist('13:52', 20), 'BREAK');
    const t = e.totals(ist('13:52', 20));
    expect(mins(t.breakSec)).toBe(47);
  });

  it('a short lock is voided back to work', () => {
    const e = make();
    e.punchIn(ist('09:30'), 'AT-101');
    e.lock(ist('10:00'), 'LOCK');
    const un = e.unlock(ist('10:02'), 'UNLOCK');
    expect(un.idleStarted).toBe(false);
    expect(e.prompting).toBe(false);
    expect(mins(e.totals(ist('10:10')).workedSec)).toBe(40);
  });

  it('suspend/resume behaves like lock with cause SUSPEND', () => {
    const e = make();
    e.punchIn(ist('09:30'), 'AT-101');
    e.lock(ist('12:00'), 'SUSPEND');
    const r = e.unlock(ist('12:20'), 'RESUME');
    expect(r.events.map((x) => x.type)).toEqual(['RESUME', 'IDLE_START']);
    expect(e.idleCause()).toBe('SUSPEND');
  });

  it('app quit then restart after the threshold → "Tracker wasn\'t running" prompt', () => {
    const e = make();
    e.punchIn(ist('09:30'), 'AT-101');
    const q = e.appQuit(ist('17:10'));
    expect(q.events[0].type).toBe('APP_QUIT');
    expect(q.segments[0]).toMatchObject({ endedAt: ist('17:10') });
    const restored = new TrackerEngine({ uuid: () => crypto.randomUUID(), dayKey: istDayKey, snapshot: e.snapshot(), config: e.config });
    const r = restored.recover(ist('17:55'));
    expect(r.idleStarted).toBe(true);
    expect(restored.idleCause()).toBe('APP_NOT_RUNNING');
    const res = restored.resolveIdle(ist('17:56'), 'IDLE');
    expect(res.segments[0]).toMatchObject({ kind: 'IDLE', startedAt: ist('17:10'), endedAt: ist('17:55') });
  });

  it('a crash with a short gap counts the gap as work', () => {
    const e = make();
    e.punchIn(ist('09:30'), 'AT-101');
    e.tick(ist('09:40'), 0);
    const restored = new TrackerEngine({ uuid: () => crypto.randomUUID(), dayKey: istDayKey, snapshot: e.snapshot(), config: e.config });
    const r = restored.recover(ist('09:42'));
    expect(r.idleStarted).toBe(false);
    expect(r.segments[0]).toMatchObject({ startedAt: ist('09:30'), endedAt: ist('09:40') });
    expect(mins(restored.totals(ist('10:10')).workedSec)).toBe(40);
  });
});

describe('punch-out closes segments', () => {
  it('punching out during a break closes the break at punch-out', () => {
    const e = make();
    e.punchIn(ist('09:30'), 'AT-101');
    e.startBreak(ist('18:00'));
    const out = e.punchOut(ist('18:20'));
    expect(out.segments).toEqual([expect.objectContaining({ kind: 'BREAK', startedAt: ist('18:00'), endedAt: ist('18:20') })]);
    expect(out.events.map((x) => x.type)).toEqual(['PUNCH_OUT']);
    expect(e.openSegment).toBeNull();
    expect(e.status).toBe('OUT');
  });

  it('detach (session closed from web/biometric) auto-deducts an open idle prompt', () => {
    const e = make();
    e.punchIn(ist('09:30'), null, { attached: true });
    e.tick(ist('12:00'), 600);
    const out = e.punchOut(ist('12:05'), { detach: true });
    expect(out.events.map((x) => x.type)).toEqual(['IDLE_RESOLVED']);
    expect(out.segments[0]).toMatchObject({ kind: 'IDLE', startedAt: ist('11:50') });
    expect(e.status).toBe('OUT');
  });

  it('attached sessions emit no PUNCH_IN', () => {
    const e = make();
    expect(e.punchIn(ist('09:30'), 'AT-101', { attached: true }).events).toHaveLength(0);
  });

  it('a new day resets local totals at the next punch-in', () => {
    const e = make();
    e.punchIn(ist('09:30'), 'AT-101');
    e.punchOut(ist('18:30'));
    e.punchIn(Date.parse('2026-09-30T09:30:00+05:30'), null);
    expect(e.segments).toHaveLength(0);
    expect(e.activeTaskId).toBe('AT-101');
  });
});

describe('screenshot clock and break reminders', () => {
  it('fires every interval of active time, pauses on break and idle', () => {
    const e = make({ screenshotIntervalSec: 600 });
    e.punchIn(ist('10:00'), 'AT-101');
    const outs = run(e, ist('10:00'), ist('11:00'), () => 0, 1);
    expect(outs.filter((o) => o.shotDue)).toHaveLength(6); // acceptance T4 #1
    e.startBreak(ist('11:00'));
    expect(run(e, ist('11:00'), ist('11:30'), () => 0, 1).some((o) => o.shotDue)).toBe(false);
    expect(e.nextShotInSec()).toBe(600);
  });

  it('a new interval applies as min(remaining, newInterval)', () => {
    const e = make({ screenshotIntervalSec: 600 });
    e.punchIn(ist('10:00'), 'AT-101');
    run(e, ist('10:00'), ist('10:08'), () => 0, 1); // 480 s active → 120 s remaining
    e.setConfig({ screenshotIntervalSec: 900 });
    expect(e.nextShotInSec()).toBe(120);
    e.setConfig({ screenshotIntervalSec: 60 });
    expect(e.nextShotInSec()).toBe(60);
  });

  it('reminds once per continuous block; a 5-min break resets it', () => {
    const e = make({ breakReminderSec: 7200 });
    e.punchIn(ist('09:00'), 'AT-101');
    const first = run(e, ist('09:00'), ist('11:30'), () => 0, 5);
    expect(first.filter((o) => o.breakReminderDue)).toHaveLength(1);
    e.startBreak(ist('11:30'));
    e.endBreak(ist('11:33')); // 3 min — does not reset
    expect(run(e, ist('11:33'), ist('13:00'), () => 0, 5).some((o) => o.breakReminderDue)).toBe(false);
    e.startBreak(ist('13:00'));
    e.endBreak(ist('13:10'));
    expect(run(e, ist('13:10'), ist('15:15'), () => 0, 5).filter((o) => o.breakReminderDue)).toHaveLength(1);
  });

  it('simulated idle (dev) opens the prompt with the threshold span', () => {
    const e = make();
    e.punchIn(ist('10:00'), 'AT-101');
    const out = e.simulateIdle(ist('11:00'));
    expect(out.events[0]).toMatchObject({ type: 'IDLE_START', at: ist('10:55') });
    expect(e.prompting).toBe(true);
  });
});
