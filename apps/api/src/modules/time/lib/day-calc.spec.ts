import { describe, expect, it } from 'vitest';
import { computeDay, idleDeductible, isWeeklyOff, lateMark, latePenaltyDays, sourceLabel, summarizeMonth, SOURCE_BITS, type DayInput, type ShiftLike } from './day-calc';
import { istInstant } from './time-utils';

const GENERAL: ShiftLike = {
  name: 'General',
  startMinute: 9 * 60 + 30,
  endMinute: 18 * 60 + 30,
  graceMinutes: 15,
  breakMinutes: 60,
  weeklyOffDays: [6, 0],
  minFullDayMinutes: 450,
  minHalfDayMinutes: 240,
  halfDayIfLateByMinutes: 120,
  earlyOutGraceMinutes: 15,
};
const POLICY = { deductIdleFromPayroll: true, idleDeductionMode: 'SHORTFALL_ONLY', earlyOutCountsAsLate: false };
const at = (d: string, hm: string) => {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return istInstant(d, h * 60 + m);
};
function day(date: string, sessions: [string, string | null, ('WEB' | 'DESKTOP' | 'BIOMETRIC')?][], extra: Partial<DayInput> = {}) {
  return computeDay({
    date,
    today: '2026-09-29',
    now: at('2026-09-29', '11:00'),
    shift: GENERAL,
    holidayName: null,
    leave: null,
    tracker: null,
    policy: POLICY,
    sessions: sessions.map(([a, b, src]) => ({ startedAt: at(date, a), endedAt: b ? at(date, b) : null, source: src ?? 'WEB' })),
    ...extra,
  });
}

describe('lateMark', () => {
  it('is on time within the grace window', () => {
    expect(lateMark(at('2026-09-24', '09:45'), at('2026-09-24', '09:30'), 15)).toEqual({ isLate: false, lateByMinutes: 0 });
  });
  it('marks late after the grace window and reports minutes from shift start', () => {
    expect(lateMark(at('2026-09-24', '09:52'), at('2026-09-24', '09:30'), 15)).toEqual({ isLate: true, lateByMinutes: 22 });
  });
});

describe('computeDay', () => {
  it('present day: first in / last out, break from the gap between sessions', () => {
    const r = day('2026-09-28', [['09:28', '13:15', 'DESKTOP'], ['14:10', '18:42', 'DESKTOP']]);
    expect(r.status).toBe('PRESENT');
    expect(r.isLate).toBe(false);
    expect(r.breakMinutes).toBe(55);
    expect(r.workedMinutes).toBe(554 - 55);
    expect(r.presentFraction).toBe(1);
    expect(r.primarySource).toBe('DESKTOP');
  });

  it('late mark (wireframe Thu 24 Sep 09:52)', () => {
    const r = day('2026-09-24', [['09:52', '13:30'], ['14:20', '18:40']]);
    expect(r.status).toBe('PRESENT');
    expect(r.isLate).toBe(true);
    expect(r.lateByMinutes).toBe(22);
  });

  it('very late arrival caps the day at half day', () => {
    const r = day('2026-09-24', [['11:45', '20:30']]);
    expect(r.isLate).toBe(true);
    expect(r.status).toBe('HALF_DAY');
    expect(r.presentFraction).toBe(0.5);
  });

  it('short presence is a half day, very short is absent', () => {
    expect(day('2026-09-23', [['09:30', '14:00']]).status).toBe('HALF_DAY');
    expect(day('2026-09-23', [['09:30', '11:00']]).status).toBe('ABSENT');
  });

  it('no punches on a past working day is absent', () => {
    expect(day('2026-09-22', []).status).toBe('ABSENT');
  });

  it('weekly off (Saturday) and weekly off worked', () => {
    expect(isWeeklyOff('2026-09-26', GENERAL)).toBe(true);
    expect(day('2026-09-26', []).status).toBe('WEEKLY_OFF');
    expect(day('2026-09-27', [['10:00', '15:30']]).status).toBe('WEEKLY_OFF_WORKED');
  });

  it('holiday and holiday worked', () => {
    expect(day('2026-09-04', [], { holidayName: 'Janmashtami' }).status).toBe('HOLIDAY');
    expect(day('2026-09-04', [['10:00', '15:00']], { holidayName: 'Janmashtami' }).status).toBe('HOLIDAY_WORKED');
    expect(day('2026-09-04', [['10:00', '15:00']], { holidayName: 'Janmashtami' }).isLate).toBe(false);
  });

  it('approved full-day leave wins over missing punches', () => {
    const r = day('2026-09-18', [], { leave: { fraction: 1, typeCode: 'CL', paid: true } });
    expect(r.status).toBe('LEAVE');
    expect(r.leaveFraction).toBe(1);
    expect(r.leaveTypeCode).toBe('CL');
  });

  it('half-day leave + half day worked', () => {
    const r = day('2026-09-17', [['14:00', '18:40']], { leave: { fraction: 0.5, typeCode: 'EL', paid: true } });
    expect(r.status).toBe('HALF_DAY_LEAVE');
    expect(r.presentFraction).toBe(0.5);
    expect(r.leaveFraction).toBe(0.5);
  });

  it('an open session on a past day is a missed punch', () => {
    expect(day('2026-09-21', [['09:30', null]]).status).toBe('MISSED_PUNCH');
  });

  it('today with an open session is pending', () => {
    const r = day('2026-09-29', [['09:20', null]]);
    expect(r.status).toBe('PENDING');
    expect(r.workedMinutes).toBe(100);
  });

  it('tracker summary: worked = sessions − breaks − deducted idle', () => {
    const r = day('2026-09-25', [['09:35', '18:30', 'DESKTOP']], { tracker: { workedSec: 0, breakSec: 60 * 60, idleSec: 45 * 60, idleDeductedSec: 45 * 60 } });
    expect(r.breakMinutes).toBe(60);
    expect(r.idleMinutes).toBe(45);
    expect(r.workedMinutes).toBe(535 - 60 - 45);
  });

  it('a single long session without a recorded break assumes the shift break', () => {
    const r = day('2026-09-23', [['09:30', '18:35', 'BIOMETRIC']]);
    expect(r.breakMinutes).toBe(60);
    expect(r.workedMinutes).toBe(545 - 60);
  });
});

describe('idle deduction and month summary', () => {
  it('shortfall-only deducts idle only up to the shortfall', () => {
    expect(idleDeductible(30, 480, GENERAL, POLICY, 1)).toBe(0); // required = 9h shift − 60m break
    expect(idleDeductible(30, 460, GENERAL, POLICY, 1)).toBe(20);
    expect(idleDeductible(30, 400, GENERAL, { ...POLICY, idleDeductionMode: 'ALL_IDLE' }, 1)).toBe(30);
    expect(idleDeductible(30, 400, GENERAL, { ...POLICY, deductIdleFromPayroll: false }, 1)).toBe(0);
  });

  it('late marks per penalty', () => {
    expect(latePenaltyDays(2, 3, 0.5)).toBe(0);
    expect(latePenaltyDays(3, 3, 0.5)).toBe(0.5);
    expect(latePenaltyDays(7, 3, 0.5)).toBe(1);
  });

  it('summarizes present days, late marks, active and idle minutes', () => {
    const base = { leaveFraction: 0, lateExcused: false, idleDeductibleMinutes: 0 };
    const s = summarizeMonth([
      { ...base, status: 'PRESENT', presentFraction: 1, isLate: false, workedMinutes: 480, idleMinutes: 20 },
      { ...base, status: 'PRESENT', presentFraction: 1, isLate: true, workedMinutes: 468, idleMinutes: 10 },
      { ...base, status: 'WEEKLY_OFF', presentFraction: 0, isLate: false, workedMinutes: 0, idleMinutes: 0 },
    ]);
    expect(s.presentDays).toBe(2);
    expect(s.lateMarks).toBe(1);
    expect(s.activeMinutes).toBe(948);
    expect(s.idleMinutes).toBe(30);
  });

  it('source label: single source or Mixed', () => {
    expect(sourceLabel(SOURCE_BITS.DESKTOP, 'DESKTOP')).toBe('Desktop');
    expect(sourceLabel(SOURCE_BITS.DESKTOP | SOURCE_BITS.WEB, 'WEB')).toBe('Mixed');
    expect(sourceLabel(0, null)).toBeNull();
  });
});
