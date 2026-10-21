import { describe, expect, it } from 'vitest';
import { computeDay, countsAsLateMark, idleDeductible, isOverLateLimit, isWeeklyOff, lateMark, latePenaltyDays, punchLateness, sourceLabel, summarizeMonth, SOURCE_BITS, type DayInput, type ShiftLike } from './day-calc';
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

describe('punchLateness (the "You\'re late" dialog)', () => {
  const base = { date: '2026-09-24', shift: GENERAL, offDay: false, plannedFirstHalf: false };
  it('inside the grace window is not late', () => {
    expect(punchLateness({ ...base, at: at('2026-09-24', '09:45') }).isLate).toBe(false);
  });
  it('after the grace window: late by minutes from shift start', () => {
    expect(punchLateness({ ...base, at: at('2026-09-24', '10:30') })).toMatchObject({ isLate: true, lateByMinutes: 60, lateHalfDay: false });
  });
  it('2 hours or more: half day', () => {
    expect(punchLateness({ ...base, at: at('2026-09-24', '11:30') })).toMatchObject({ isLate: true, lateByMinutes: 120, lateHalfDay: true });
  });
  it('weekly offs / holidays are never late', () => {
    expect(punchLateness({ ...base, offDay: true, at: at('2026-09-24', '13:00') }).isLate).toBe(false);
  });
  it('planned first-half leave: measured from mid-shift, never a late half day', () => {
    const r = punchLateness({ ...base, plannedFirstHalf: true, at: at('2026-09-24', '16:30') });
    expect(r).toMatchObject({ isLate: true, lateByMinutes: 150, lateHalfDay: false });
  });
});

describe('monthly late limit (shift: 3 lates allowed a month)', () => {
  const LIMIT3: ShiftLike = { ...GENERAL, lateMarksAllowed: 3, lateMarksAllowedFrom: '2026-09-01' };
  const lateDay = (ordinal: number, inAt = '10:00', extra: Partial<DayInput> = {}) =>
    day('2026-09-24', [[inAt, '19:00']], { shift: LIMIT3, lateOrdinal: ordinal, ...extra });

  it('lates 1–3 are permitted: present, no half day', () => {
    for (const n of [1, 2, 3]) expect(lateDay(n)).toMatchObject({ status: 'PRESENT', isLate: true, lateHalfDay: false, lateOverLimit: false });
  });
  it('the 4th late of the month is a first-half half day, however short the delay', () => {
    expect(lateDay(4)).toMatchObject({ status: 'HALF_DAY', presentFraction: 0.5, isLate: true, lateByMinutes: 30, lateHalfDay: true, lateOverLimit: true });
    expect(lateDay(7).lateHalfDay).toBe(true);
  });
  it('an excused late is never a half day', () => {
    expect(lateDay(5, '10:00', { lateExcused: true })).toMatchObject({ lateHalfDay: false, lateOverLimit: false });
  });
  it('2h+ late is a half day even within the allowed number (the shift\'s half-day rule)', () => {
    expect(lateDay(1, '11:45')).toMatchObject({ lateHalfDay: true, lateOverLimit: false });
  });
  it('no limit (0) keeps the old behaviour: only 2h+ lates are half days', () => {
    expect(day('2026-09-24', [['10:00', '19:00']], { shift: { ...GENERAL, lateMarksAllowed: 0 }, lateOrdinal: 9 })).toMatchObject({ status: 'PRESENT', lateHalfDay: false });
  });
  it('days before the limit took effect are never turned into half days', () => {
    const fromLater: ShiftLike = { ...LIMIT3, lateMarksAllowedFrom: '2026-09-25' };
    expect(isOverLateLimit(4, '2026-09-24', fromLater)).toBe(false);
    expect(isOverLateLimit(4, '2026-09-25', fromLater)).toBe(true);
  });
  it('the punch-in dialog knows the 4th late is over the limit', () => {
    const base = { date: '2026-09-24', shift: LIMIT3, offDay: false, plannedFirstHalf: false, at: at('2026-09-24', '10:00') };
    expect(punchLateness({ ...base, ordinal: 3 })).toMatchObject({ isLate: true, lateHalfDay: false, overLimit: false });
    expect(punchLateness({ ...base, ordinal: 4 })).toMatchObject({ isLate: true, lateHalfDay: true, overLimit: true });
  });
  it('"Late marks" counts every late; the payroll penalty never charges a half day again', () => {
    const d = (lateHalfDay: boolean) => ({ status: (lateHalfDay ? 'HALF_DAY' : 'PRESENT') as 'PRESENT', presentFraction: lateHalfDay ? 0.5 : 1, leaveFraction: 0, isLate: true, lateExcused: false, lateHalfDay, workedMinutes: 480, idleMinutes: 0, idleDeductibleMinutes: 0 });
    const month = [d(false), d(false), d(false), d(true), d(true), d(true)]; // the screenshot: 6 lates
    const s = summarizeMonth(month);
    expect(s.lateMarks).toBe(6);
    expect(s.lateHalfDays).toBe(3);
    expect(s.penaltyLateMarks).toBe(3);
    expect(latePenaltyDays(s.penaltyLateMarks, 1, 0.5, 3)).toBe(0); // the 3 allowed cost nothing
    expect(month.filter(countsAsLateMark)).toHaveLength(3);
  });
});

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

  it('late by exactly the half-day threshold (2h) is a half day; 1h 59m is only a late mark', () => {
    const two = day('2026-09-24', [['11:30', '20:30']]);
    expect(two.lateByMinutes).toBe(120);
    expect(two.lateHalfDay).toBe(true);
    expect(two.status).toBe('HALF_DAY');
    const under = day('2026-09-24', [['11:29', '20:30']]);
    expect(under.isLate).toBe(true);
    expect(under.lateHalfDay).toBe(false);
    expect(under.status).toBe('PRESENT');
  });

  it('an excused late arrival is never a half day', () => {
    const r = day('2026-09-24', [['11:45', '20:30']], { lateExcused: true });
    expect(r.lateExcused).toBe(true);
    expect(r.lateHalfDay).toBe(false);
    expect(r.status).toBe('PRESENT');
  });

  it('the half-day rule is off when the shift has no threshold', () => {
    const r = day('2026-09-24', [['11:45', '20:30']], { shift: { ...GENERAL, halfDayIfLateByMinutes: null } });
    expect(r.lateHalfDay).toBe(false);
    expect(r.status).toBe('PRESENT');
  });

  it('a planned first-half leave moves the expected start to mid-shift', () => {
    // Shift 09:30–18:30 → second half from 14:00; in at 14:10 is on time (grace 15).
    const leave = { fraction: 0.5, typeCode: 'CL', paid: true, plannedFirstHalf: true };
    const onTime = day('2026-09-24', [['14:10', '18:30']], { leave });
    expect(onTime.isLate).toBe(false);
    expect(onTime.status).toBe('HALF_DAY_LEAVE');
    const late = day('2026-09-24', [['14:40', '18:30']], { leave });
    expect(late.isLate).toBe(true);
    expect(late.lateByMinutes).toBe(40);
    expect(late.lateHalfDay).toBe(false);
  });

  it("the late-arrival half day booked as leave doesn't move the start (it stays a late half day)", () => {
    const auto = { fraction: 0.5, typeCode: 'CL', paid: true, plannedFirstHalf: false };
    const r = day('2026-09-24', [['11:45', '20:30']], { leave: auto });
    expect(r.lateHalfDay).toBe(true);
    expect(r.status).toBe('HALF_DAY_LEAVE');
    expect(r.presentFraction).toBe(0.5);
    expect(r.leaveFraction).toBe(0.5);
  });

  it('a planned second-half leave moves the early-out check to mid-shift', () => {
    const leave = { fraction: 0.5, typeCode: 'CL', paid: true, plannedSecondHalf: true };
    expect(day('2026-09-24', [['09:30', '14:00']], { leave }).isEarlyOut).toBe(false);
    expect(day('2026-09-24', [['09:30', '13:00']], { leave }).isEarlyOut).toBe(true);
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

  it('a late half day shows as a late mark but is charged once: as a half day, not also by the late-mark penalty', () => {
    const base = { leaveFraction: 0, idleDeductibleMinutes: 0, workedMinutes: 0, idleMinutes: 0, lateExcused: false };
    const s = summarizeMonth([
      { ...base, status: 'PRESENT', presentFraction: 1, isLate: true },
      { ...base, status: 'HALF_DAY_LEAVE', presentFraction: 0.5, leaveFraction: 0.5, isLate: true, lateHalfDay: true },
    ]);
    expect(s.lateMarks).toBe(2);
    expect(s.penaltyLateMarks).toBe(1);
    expect(s.lateHalfDays).toBe(1);
  });

  it('late marks per penalty', () => {
    expect(latePenaltyDays(2, 3, 0.5)).toBe(0);
    expect(latePenaltyDays(3, 3, 0.5)).toBe(0.5);
    expect(latePenaltyDays(7, 3, 0.5)).toBe(1);
  });

  it('late marks allowed by the shift are free; the penalty counts the ones after them', () => {
    expect(latePenaltyDays(3, 1, 0.5, 3)).toBe(0);
    expect(latePenaltyDays(4, 1, 0.5, 3)).toBe(0.5);
    expect(latePenaltyDays(6, 1, 0.5, 3)).toBe(1.5);
    expect(latePenaltyDays(8, 3, 0.5, 2)).toBe(1);
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

  it('late marks skip excused days and full absences', () => {
    const base = { presentFraction: 1, leaveFraction: 0, isLate: true, workedMinutes: 0, idleMinutes: 0, idleDeductibleMinutes: 0 };
    const s = summarizeMonth([
      { ...base, status: 'PRESENT', lateExcused: false },
      { ...base, status: 'HALF_DAY', lateExcused: false },
      { ...base, status: 'MISSED_PUNCH', lateExcused: false },
      { ...base, status: 'PRESENT', lateExcused: true },
      { ...base, status: 'ABSENT', presentFraction: 0, lateExcused: false },
    ]);
    expect(s.lateMarks).toBe(3);
  });

  it('source label: single source or Mixed', () => {
    expect(sourceLabel(SOURCE_BITS.DESKTOP, 'DESKTOP')).toBe('Desktop');
    expect(sourceLabel(SOURCE_BITS.DESKTOP | SOURCE_BITS.WEB, 'WEB')).toBe('Mixed');
    expect(sourceLabel(0, null)).toBeNull();
  });
});
