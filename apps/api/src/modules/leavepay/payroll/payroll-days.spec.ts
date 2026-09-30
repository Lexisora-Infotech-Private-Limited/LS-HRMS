import { describe, expect, it } from 'vitest';
import { classifyDays, GATE_OK, timesheetGate, type AttendanceOnDay, type DayClassInput, type LeaveOnDay } from './payroll-days';
import type { CalendarFn } from '../leave/leave-calc';
import { dow } from '../common/dates';

// September 2026: 22 weekdays; Janmashtami (Fri 4 Sep) is a holiday → 21 working days.
const HOLIDAYS: Record<string, string> = { '2026-09-04': 'Janmashtami' };
const cal: CalendarFn = (date) => {
  if (HOLIDAYS[date]) return { date, kind: 'HOLIDAY', holidayName: HOLIDAYS[date] };
  const d = dow(date);
  return { date, kind: d === 0 || d === 6 ? 'WEEKLY_OFF' : 'WORKING' };
};

function input(over: Partial<DayClassInput> = {}): DayClassInput {
  return { period: '2026-09', lockDate: '2026-09-30', joinDate: '2024-01-12', exitDate: null, calendar: cal, leave: new Map(), attendance: new Map(), ...over };
}
const att = (rows: Record<string, Partial<AttendanceOnDay>>) =>
  new Map(Object.entries(rows).map(([d, a]) => [d, { status: 'PRESENT', presentFraction: 1, idleDeductibleMinutes: 0, ...a }]));
const lv = (rows: Record<string, LeaveOnDay[]>) => new Map(Object.entries(rows));

describe('payroll day classification', () => {
  it('counts working days net of weekly offs and holidays', () => {
    const r = classifyDays(input());
    expect(r).toMatchObject({ workingDays: 21, eligibleDays: 21, holidays: 1, weeklyOffs: 8, absentDays: 0, paidLeaveDays: 0 });
  });

  it('paid leave keeps the day paid; an ABSENT day is LOP', () => {
    const r = classifyDays(input({ leave: lv({ '2026-09-18': [{ units: 1, isPaid: true, code: 'SL' }] }), attendance: att({ '2026-09-18': { status: 'LEAVE' }, '2026-09-22': { status: 'ABSENT', presentFraction: 0 } }) }));
    expect(r.paidLeaveDays).toBe(1);
    expect(r.absentDays).toBe(1);
    expect(r.leaveSummary).toEqual([{ code: 'SL', days: 1 }]);
  });

  it('a half day without leave is 0.5 LOP; a half-day leave covers the other half', () => {
    const half = classifyDays(input({ attendance: att({ '2026-09-08': { status: 'HALF_DAY', presentFraction: 0.5 } }) }));
    expect(half.absentDays).toBe(0.5);
    const covered = classifyDays(input({ leave: lv({ '2026-09-08': [{ units: 0.5, isPaid: true, code: 'CL' }] }), attendance: att({ '2026-09-08': { status: 'HALF_DAY_LEAVE', presentFraction: 0.5 } }) }));
    expect(covered.absentDays).toBe(0);
    expect(covered.paidLeaveDays).toBe(0.5);
  });

  it('unpaid leave (LWP) is counted separately from absence', () => {
    const r = classifyDays(input({ leave: lv({ '2026-09-09': [{ units: 1, isPaid: false, code: 'LWP' }] }) }));
    expect(r.unpaidLeaveDays).toBe(1);
    expect(r.absentDays).toBe(0);
  });

  it('days after the attendance lock are projected, never LOP', () => {
    const r = classifyDays(input({ lockDate: '2026-09-25', attendance: att({ '2026-09-29': { status: 'ABSENT', presentFraction: 0 } }) }));
    expect(r.projectedDays).toBe(3); // 28, 29, 30 Sep
    expect(r.absentDays).toBe(0);
  });

  it('mid-month joiner is eligible only from the joining date', () => {
    const r = classifyDays(input({ joinDate: '2026-09-15' }));
    expect(r.workingDays).toBe(21);
    expect(r.eligibleDays).toBe(12);
  });

  it('idle on an LOP day is dropped (no double penalty)', () => {
    const r = classifyDays(input({ attendance: att({ '2026-09-07': { idleDeductibleMinutes: 25 }, '2026-09-08': { status: 'ABSENT', presentFraction: 0, idleDeductibleMinutes: 30 } }) }));
    expect(r.idleMinutes).toBe(25);
  });

  it('falls back to tracker idle when there are no attendance rows', () => {
    expect(classifyDays(input({ fallbackIdleMinutes: 130 })).idleMinutes).toBe(130);
  });
});

describe('timesheet gate', () => {
  it('interns are not required to submit weekly timesheets', () => {
    expect(timesheetGate({ required: false, statuses: ['DRAFT'] })).toBe('NOT_REQUIRED');
  });
  it('approved (or locked) sheets for every overlapping week pass the gate', () => {
    expect(timesheetGate({ required: true, statuses: ['APPROVED', 'LOCKED'] })).toBe('APPROVED');
  });
  it('weeks without a timesheet row do not block', () => {
    expect(timesheetGate({ required: true, statuses: [] })).toBe('APPROVED');
  });
  it('the least advanced pending week decides the gate', () => {
    expect(timesheetGate({ required: true, statuses: ['APPROVED', 'PENDING_RM'] })).toBe('PENDING_RM');
    expect(timesheetGate({ required: true, statuses: ['PENDING_RM', 'SUBMITTED'] })).toBe('PENDING_PL');
    expect(timesheetGate({ required: true, statuses: ['RETURNED', 'SUBMITTED'] })).toBe('SENT_BACK');
    expect(timesheetGate({ required: true, statuses: ['APPROVED', 'DRAFT'] })).toBe('NOT_SUBMITTED');
  });
  it('only APPROVED and NOT_REQUIRED let an item be READY', () => {
    expect(GATE_OK).toEqual(['APPROVED', 'NOT_REQUIRED']);
  });
});
