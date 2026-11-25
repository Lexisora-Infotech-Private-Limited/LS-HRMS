import { describe, expect, it } from 'vitest';
import { makeCalendar, shiftNetMinutesOf, shiftResolver, weeklyOffsOf, type ShiftLite } from './calendar.service';

const shift = (id: string, weeklyOffDays: number[]): ShiftLite => ({ id, weeklyOffDays, startMinute: 570, endMinute: 1110, breakMinutes: 60 });
const SAT_SUN = shift('general', [0, 6]);
const SUN_ONLY = shift('early', [0]);
const NONE = shift('seven-day', []);
const byId = new Map([SAT_SUN, SUN_ONLY, NONE].map((s) => [s.id, s]));

// 2026-11-21 = Saturday, 2026-11-22 = Sunday, 2026-11-23 = Monday.
describe('leave calendar weekly offs (must match attendance)', () => {
  it('a shift with weekly off "None" keeps Saturday and Sunday as working days', () => {
    const cal = makeCalendar(weeklyOffsOf(NONE), [], null);
    expect(cal('2026-11-21').kind).toBe('WORKING');
    expect(cal('2026-11-22').kind).toBe('WORKING');
  });

  it('falls back to Saturday + Sunday only when the tenant has no shift at all', () => {
    const cal = makeCalendar(weeklyOffsOf(null), [], null);
    expect(cal('2026-11-21').kind).toBe('WEEKLY_OFF');
    expect(cal('2026-11-22').kind).toBe('WEEKLY_OFF');
    expect(cal('2026-11-23').kind).toBe('WORKING');
  });

  it('uses the shift assigned for each date, like attendance', () => {
    // Own shift Sat+Sun; from 22 Nov a dated assignment moves the employee to the Sunday-only shift.
    const shiftOn = shiftResolver([{ shiftId: 'early', effectiveFrom: '2026-11-22', effectiveTo: null }], byId, 'general', null);
    const cal = makeCalendar((d) => weeklyOffsOf(shiftOn(d)), [], null);
    expect(cal('2026-11-14').kind).toBe('WEEKLY_OFF'); // Sat, before the assignment → own Sat+Sun shift
    expect(cal('2026-11-28').kind).toBe('WORKING'); // Sat, under the Sunday-only assignment
    expect(cal('2026-11-29').kind).toBe('WEEKLY_OFF'); // Sun
  });

  it('an ended assignment falls back to the own shift, then the tenant default', () => {
    const ended = [{ shiftId: 'seven-day', effectiveFrom: '2026-11-01', effectiveTo: '2026-11-15' }];
    expect(shiftResolver(ended, byId, 'early', SAT_SUN)('2026-11-10')?.id).toBe('seven-day');
    expect(shiftResolver(ended, byId, 'early', SAT_SUN)('2026-11-20')?.id).toBe('early');
    expect(shiftResolver(ended, byId, null, SAT_SUN)('2026-11-20')?.id).toBe('general');
  });

  it('the latest overlapping assignment wins', () => {
    const rows = [
      { shiftId: 'general', effectiveFrom: '2026-10-01', effectiveTo: null },
      { shiftId: 'early', effectiveFrom: '2026-11-10', effectiveTo: null },
    ];
    expect(shiftResolver(rows, byId, null, null)('2026-11-20')?.id).toBe('early');
    expect(shiftResolver(rows, byId, null, null)('2026-10-20')?.id).toBe('general');
  });

  it('holidays still win over weekly offs', () => {
    const cal = makeCalendar(weeklyOffsOf(NONE), [{ id: 'h', date: '2026-11-23', name: 'Test holiday', type: 'MANDATORY', locationIds: [] }], null);
    expect(cal('2026-11-23')).toMatchObject({ kind: 'HOLIDAY', holidayName: 'Test holiday' });
  });

  it('net shift minutes: span minus break, 8h default without a shift', () => {
    expect(shiftNetMinutesOf(SAT_SUN)).toBe(480);
    expect(shiftNetMinutesOf(null)).toBe(480);
  });
});
