import { describe, expect, it } from 'vitest';
import {
  availableOf,
  consumeCompOff,
  expandLeaveDays,
  leaveSummaryLabel,
  monthlyCreditMonths,
  prorateYearly,
  scheduledAnnual,
  sessionsConflict,
  splitPaid,
  yearEndSplit,
  type CalendarFn,
  type Session,
} from './leave-calc';
import { dow } from '../common/dates';

const HOLIDAYS: Record<string, string> = { '2026-10-20': 'Dussehra', '2026-11-08': 'Diwali', '2026-11-09': 'Diwali' };
const cal: CalendarFn = (date) => {
  if (HOLIDAYS[date]) return { date, kind: 'HOLIDAY', holidayName: HOLIDAYS[date] };
  const d = dow(date);
  return { date, kind: d === 0 || d === 6 ? 'WEEKLY_OFF' : 'WORKING' };
};
const base = { calendar: cal, sandwichWeeklyOffs: false, sandwichHolidays: false };

describe('leave day counting', () => {
  it('EL Wed 14 – Fri 16 Oct 2026 = 3 days', () => {
    expect(expandLeaveDays({ ...base, from: '2026-10-14', to: '2026-10-16' }).totalDays).toBe(3);
  });

  it('holidays are excluded: EL 19–21 Oct with Dussehra on 20 Oct = 2 days', () => {
    const r = expandLeaveDays({ ...base, sandwichWeeklyOffs: true, from: '2026-10-19', to: '2026-10-21' });
    expect(r.totalDays).toBe(2);
    expect(r.excluded).toEqual([{ date: '2026-10-20', kind: 'HOLIDAY', holidayName: 'Dussehra' }]);
  });

  it('weekly offs are excluded without the sandwich rule: Fri 9 – Mon 12 Oct = 2', () => {
    expect(expandLeaveDays({ ...base, from: '2026-10-09', to: '2026-10-12' }).totalDays).toBe(2);
  });

  it('sandwich rule counts the weekend: Fri 9 – Mon 12 Oct = 4', () => {
    const r = expandLeaveDays({ ...base, sandwichWeeklyOffs: true, from: '2026-10-09', to: '2026-10-12' });
    expect(r.totalDays).toBe(4);
    expect(r.sandwichDays).toBe(2);
  });

  it('sandwich with an earlier approved Friday: a new Monday request = 3 (weekend charged here)', () => {
    const existing = (d: string): Session | null => (d === '2026-10-09' ? 'FULL' : null);
    const r = expandLeaveDays({ ...base, sandwichWeeklyOffs: true, from: '2026-10-12', to: '2026-10-12', existingCoverage: existing });
    expect(r.totalDays).toBe(3);
    expect(r.days.filter((d) => d.isSandwich).map((d) => d.date)).toEqual(['2026-10-10', '2026-10-11']);
  });

  it('no sandwich when the Friday is only a first half', () => {
    const r = expandLeaveDays({ ...base, sandwichWeeklyOffs: true, from: '2026-10-09', to: '2026-10-12', fromSession: 'SECOND_HALF' });
    expect(r.totalDays).toBe(4 - 0.5);
    const r2 = expandLeaveDays({ ...base, sandwichWeeklyOffs: true, from: '2026-10-09', to: '2026-10-09', halfDay: 'FIRST_HALF' });
    expect(r2.totalDays).toBe(0.5);
  });

  it('leading or trailing weekends are never counted', () => {
    expect(expandLeaveDays({ ...base, sandwichWeeklyOffs: true, from: '2026-10-10', to: '2026-10-13' }).totalDays).toBe(2);
    expect(expandLeaveDays({ ...base, sandwichWeeklyOffs: true, from: '2026-10-08', to: '2026-10-11' }).totalDays).toBe(2);
  });

  it('holiday sandwiching follows sandwichHolidays only', () => {
    // Diwali Sun 8 + Mon 9 Nov, with Sat 7: Fri 6 – Tue 10 → block Sat–Mon.
    const off = expandLeaveDays({ ...base, sandwichWeeklyOffs: true, sandwichHolidays: false, from: '2026-11-06', to: '2026-11-10' });
    expect(off.totalDays).toBe(2 + 1); // Fri, Tue + Sat (weekly off); Sun is a holiday (not sandwiched)
    const on = expandLeaveDays({ ...base, sandwichWeeklyOffs: true, sandwichHolidays: true, from: '2026-11-06', to: '2026-11-10' });
    expect(on.totalDays).toBe(5);
  });

  it('half day units: CL 7 Oct first half = 0.5', () => {
    expect(expandLeaveDays({ ...base, from: '2026-10-07', to: '2026-10-07', halfDay: 'FIRST_HALF' }).totalDays).toBe(0.5);
  });

  it('multi-day with start from second half and end at first half', () => {
    const r = expandLeaveDays({ ...base, from: '2026-10-05', to: '2026-10-07', fromSession: 'SECOND_HALF', toSession: 'FIRST_HALF' });
    expect(r.totalDays).toBe(2);
    expect(r.days.map((d) => d.session)).toEqual(['SECOND_HALF', 'FULL', 'FIRST_HALF']);
  });

  it('rejects ranges without working days and half days on non-working days', () => {
    expect(expandLeaveDays({ ...base, from: '2026-10-10', to: '2026-10-11' }).error).toBe('No working days in range');
    expect(expandLeaveDays({ ...base, from: '2026-10-20', to: '2026-10-20', halfDay: 'FIRST_HALF' }).error).toBe('A half day must be on a working day');
    expect(expandLeaveDays({ ...base, from: '2026-10-12', to: '2026-10-09' }).error).toMatch(/on or before/);
  });

  it('complementary halves do not conflict; same halves do', () => {
    expect(sessionsConflict('FIRST_HALF', 'SECOND_HALF')).toBe(false);
    expect(sessionsConflict('FIRST_HALF', 'FIRST_HALF')).toBe(true);
    expect(sessionsConflict('FULL', 'SECOND_HALF')).toBe(true);
  });
});

describe('balance checks', () => {
  it('fully paid within balance', () => {
    expect(splitPaid(3, 14, { isPaidType: true })).toEqual({ paid: 3, lop: 0, blocked: false });
  });
  it('REJECT blocks a request beyond balance', () => {
    expect(splitPaid(5, 4, { isPaidType: true, excessAction: 'REJECT' }).blocked).toBe(true);
  });
  it('CONVERT_TO_LOP splits paid 4 + LOP 1', () => {
    expect(splitPaid(5, 4, { isPaidType: true, excessAction: 'CONVERT_TO_LOP' })).toEqual({ paid: 4, lop: 1, blocked: false });
  });
  it('negative balance within the limit is allowed', () => {
    expect(splitPaid(5, 4, { isPaidType: true, allowNegative: true, negativeLimit: 2 }).blocked).toBe(false);
  });
  it('LWP is always unpaid', () => {
    expect(splitPaid(2, 0, { isPaidType: false })).toEqual({ paid: 0, lop: 2, blocked: false });
  });
  it('available = opening + accrued + credited − availed − lapsed − encashed − pending', () => {
    expect(availableOf({ opening: 0.5, accrued: 13.5, credited: 0, availed: 0, pending: 3, lapsed: 0, encashed: 0 })).toBe(11);
  });
});

describe('accrual and pro-ration', () => {
  it('joining 10 Sep 2026 → CL round_half(12 × 4/12) = 4; joining 20 Sep → 3', () => {
    expect(prorateYearly(12, '2026-09-10', 2026)).toBe(4);
    expect(prorateYearly(12, '2026-09-20', 2026)).toBe(3);
    expect(prorateYearly(12, '2024-01-12', 2026)).toBe(12);
    expect(prorateYearly(8, '2026-09-15', 2026)).toBe(2.5); // 8 × 4/12 = 2.67 → nearest 0.5
  });
  it('EL monthly 1.5: full year = 18; a 20 Sep joiner accrues from October', () => {
    expect(scheduledAnnual('MONTHLY', 1.5, 18, '2024-01-12', 2026)).toBe(18);
    expect(monthlyCreditMonths('2026-09-20', 2026)).toEqual([10, 11, 12]);
    expect(monthlyCreditMonths('2026-09-15', 2026)).toEqual([9, 10, 11, 12]);
    expect(scheduledAnnual('MONTHLY', 1.5, 18, '2026-09-20', 2026)).toBe(4.5);
  });
  it('comp-off consumes FIFO by expiry and never after expiry', () => {
    const grants = [
      { id: 'late', remaining: 1, expiresOn: '2026-12-02' },
      { id: 'early', remaining: 1, expiresOn: '2026-11-10' },
    ];
    expect(consumeCompOff(grants, 1.5, '2026-11-05')).toEqual({ consumed: [{ grantId: 'early', units: 1 }, { grantId: 'late', units: 0.5 }], shortfall: 0 });
    expect(consumeCompOff(grants, 1, '2026-11-20')).toEqual({ consumed: [{ grantId: 'late', units: 1 }], shortfall: 0 });
  });
});

describe('year-end', () => {
  it('EL closing 34 with cap 30 → carry 30, lapse 4', () => {
    expect(yearEndSplit(34, 30)).toEqual({ carry: 30, encash: 0, lapse: 4 });
  });
  it('CL closing 5 with no carry forward → lapse 5', () => {
    expect(yearEndSplit(5, null)).toEqual({ carry: 0, encash: 0, lapse: 5 });
  });
  it('encash the excess when enabled', () => {
    expect(yearEndSplit(34, 30, true, true)).toEqual({ carry: 30, encash: 4, lapse: 0 });
  });
  it('payroll leave label', () => {
    expect(leaveSummaryLabel([{ code: 'CL', days: 0.5 }, { code: 'LWP', days: 1 }])).toBe('0.5 CL · 1 LWP');
    expect(leaveSummaryLabel([])).toBe('0');
  });
});
