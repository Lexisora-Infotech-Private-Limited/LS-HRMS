import { describe, expect, it } from 'vitest';
import { dayPartFor, quoteIndexFor } from '@lexisora/shared';
import { approvalsFor, celebrationsWithin, reviewLink, sortTodos, taskLink, titleLine, weekRangeLabel } from './dashboard.rules';
import { dueLabel, istInstant, longDate, shortTime, weekStartKey } from '../common/dates';

const d = (k: string) => new Date(`${k}T00:00:00.000Z`);
const TODAY = '2026-09-29'; // Tue — the wireframe's "today"

describe('greeting', () => {
  it('uses the IST day part boundaries (morning < 12:00 ≤ afternoon < 17:00 ≤ evening)', () => {
    expect(dayPartFor(istInstant(TODAY, '06:00'))).toBe('morning');
    expect(dayPartFor(istInstant(TODAY, '11:59'))).toBe('morning');
    expect(dayPartFor(istInstant(TODAY, '12:00'))).toBe('afternoon');
    expect(dayPartFor(istInstant(TODAY, '16:59'))).toBe('afternoon');
    expect(dayPartFor(istInstant(TODAY, '17:00'))).toBe('evening');
    expect(dayPartFor(istInstant(TODAY, '23:30'))).toBe('evening');
  });

  it('formats the kicker as "EEEE, d MMMM yyyy" in IST', () => {
    expect(longDate(istInstant(TODAY, '09:00'))).toBe('Tuesday, 29 September 2026');
    // 00:30 IST on the 30th is still the 29th in UTC — the kicker follows IST.
    expect(longDate(istInstant('2026-09-30', '00:30'))).toBe('Wednesday, 30 September 2026');
  });

  it('shows designation · department, dropping a redundant department', () => {
    expect(titleLine('Software Engineer', 'Development')).toBe('Software Engineer · Development');
    expect(titleLine('Project Lead', 'Development')).toBe('Project Lead · Development');
    expect(titleLine('HR Manager', 'HR')).toBe('HR Manager');
    expect(titleLine('Chief Executive Officer', 'Management')).toBe('Chief Executive Officer');
    expect(titleLine(null, 'QA')).toBe('QA');
    expect(titleLine('Intern', null)).toBe('Intern');
  });
});

describe('thought of the day rotation', () => {
  it('is the same for everyone on a date and advances by one each day', () => {
    const a = quoteIndexFor(TODAY, 4);
    expect(quoteIndexFor(TODAY, 4)).toBe(a);
    expect(quoteIndexFor('2026-09-30', 4)).toBe((a + 1) % 4);
    expect(quoteIndexFor('2026-10-01', 4)).toBe((a + 2) % 4);
  });

  it('stays in range for any pool size and handles an empty pool', () => {
    for (const n of [1, 3, 22, 64]) {
      const i = quoteIndexFor(TODAY, n);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(n);
    }
    expect(quoteIndexFor(TODAY, 0)).toBe(-1);
  });
});

describe('birthdays & anniversaries', () => {
  const people = [
    { id: 'rahul', name: 'Rahul Desai', dob: d('1995-09-30'), joined: d('2023-02-20') },
    { id: 'sneha', name: 'Sneha Patel', dob: d('1996-04-14'), joined: d('2023-10-02') },
    { id: 'priya', name: 'Priya Sharma', dob: d('1998-09-30'), joined: d('2024-01-12') },
    { id: 'isha', name: 'Isha Mehra', dob: d('2004-03-12'), joined: d('2026-09-29') },
    { id: 'far', name: 'Far Away', dob: d('1990-10-20'), joined: d('2020-10-21') },
  ];

  it('lists the wireframe rows within 7 days, sorted by date, without the year of birth', () => {
    const rows = celebrationsWithin(people, TODAY, 7, 'priya');
    expect(rows.map((r) => [r.what, r.when])).toEqual([
      ['Rahul Desai · birthday', '30 Sep'],
      ['Sneha Patel · 3 years', '2 Oct'],
    ]);
    expect(rows.every((r) => !/19\d\d|20\d\d/.test(r.what))).toBe(true);
  });

  it('never lists the viewer’s own birthday but shows it to others', () => {
    expect(celebrationsWithin(people, TODAY, 7, 'priya').some((r) => r.id === 'bday:priya')).toBe(false);
    expect(celebrationsWithin(people, TODAY, 7, 'rahul').some((r) => r.id === 'bday:priya')).toBe(true);
  });

  it('needs at least one completed year for an anniversary (joining day is not one)', () => {
    expect(celebrationsWithin(people, TODAY, 0).some((r) => r.id === 'anniv:isha')).toBe(false);
    expect(celebrationsWithin([{ id: 'x', name: 'X', dob: null, joined: d('2025-09-29') }], TODAY, 0)[0]?.what).toBe('X · 1 year');
  });

  it('includes the window end day and excludes the day after', () => {
    expect(celebrationsWithin(people, TODAY, 3).some((r) => r.id === 'anniv:sneha')).toBe(true); // 2 Oct = today + 3
    expect(celebrationsWithin(people, TODAY, 2).some((r) => r.id === 'anniv:sneha')).toBe(false);
  });

  it('shows 29 Feb birthdays on 28 Feb in non-leap years and on 29 Feb in leap years', () => {
    const leapling = [{ id: 'l', name: 'Leap Ling', dob: d('2000-02-29'), joined: null }];
    expect(celebrationsWithin(leapling, '2027-02-27', 3)[0]).toMatchObject({ date: '2027-02-28', when: '28 Feb' });
    expect(celebrationsWithin(leapling, '2028-02-27', 3)[0]).toMatchObject({ date: '2028-02-29', when: '29 Feb' });
  });

  it('wraps the year end', () => {
    const rows = celebrationsWithin([{ id: 'n', name: 'New Year', dob: d('1990-01-02'), joined: null }], '2026-12-30', 7);
    expect(rows[0]).toMatchObject({ date: '2027-01-02', when: '2 Jan' });
  });
});

describe('pending to-do merge', () => {
  type T = { id: string; overdue: boolean; sortDate: string; prio: number; createdAt: number };
  const t = (id: string, sortDate: string, prio: number, createdAt = 0, overdue = sortDate < TODAY): T => ({ id, overdue, sortDate, prio, createdAt });

  it('sorts overdue first, then by due date, then system → board → personal, then age', () => {
    const rows = sortTodos([
      t('personal-today', TODAY, 2, 5),
      t('board-wed', '2026-09-30', 1),
      t('system-today', TODAY, 0),
      t('personal-overdue', '2026-09-25', 2),
      t('personal-today-older', TODAY, 2, 1),
      t('anytime', '9999-12-31', 2),
      t('system-overdue', '2026-09-28', 0),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['personal-overdue', 'system-overdue', 'system-today', 'personal-today-older', 'personal-today', 'board-wed', 'anytime']);
  });

  it('labels due dates the way the card shows them', () => {
    expect(dueLabel(TODAY, TODAY)).toBe('Today');
    expect(dueLabel('2026-09-30', TODAY)).toBe('Wed');
    expect(dueLabel('2026-10-05', TODAY)).toBe('Mon');
    expect(dueLabel('2026-10-06', TODAY)).toBe('6 Oct');
    expect(dueLabel('2026-09-28', TODAY)).toBe('Overdue');
    expect(dueLabel(null, TODAY)).toBe('Anytime');
  });

  it('names last week for the timesheet reminder ("Submit timesheet for 21–27 Sep")', () => {
    expect(weekStartKey(TODAY)).toBe('2026-09-28');
    expect(weekRangeLabel('2026-09-21')).toBe('21–27 Sep');
    expect(weekRangeLabel('2026-09-28')).toBe('28 Sep – 4 Oct');
  });

  it('deep-links board tasks to the task drawer on their team board', () => {
    expect(taskLink({ id: 't1', projectId: 'p1', departmentId: 'd1' })).toBe('/board?project=p1&board=d1&task=t1');
    expect(taskLink({ id: 't1', projectId: 'p1', departmentId: null })).toBe('/board?project=p1&task=t1');
  });
});

describe('awaiting your approval', () => {
  const rows = [
    { key: 'timesheets', label: 'Timesheets', count: 0, link: '/approvals' },
    { key: 'leave', label: 'Time-off requests', count: 3, link: '/leave?tab=approvals' },
    { key: 'helpdesk', label: 'Helpdesk escalations', count: 1, link: '/helpdesk?tab=escalated' },
  ];

  it('"Review now" goes to the first queue with work waiting', () => {
    expect(reviewLink(rows)).toBe('/leave?tab=approvals');
    expect(reviewLink(rows.map((r) => ({ ...r, count: 0 })))).toBe('/approvals');
    expect(reviewLink([])).toBeNull();
  });

  it('hides the card for employees with nothing waiting and when no queue applies', () => {
    expect(approvalsFor('employee', rows.map((r) => ({ ...r, count: 0 })))).toBeNull();
    expect(approvalsFor('employee', [])).toBeNull();
    expect(approvalsFor('manager', [])).toBeNull();
    expect(approvalsFor('manager', rows.map((r) => ({ ...r, count: 0 })))).toHaveLength(3);
    expect(approvalsFor('hr', rows.slice(1))?.map((r) => r.label)).toEqual(['Time-off requests', 'Helpdesk escalations']);
  });
});

describe('event times', () => {
  it('renders "3 Oct, 5 pm" style times in IST', () => {
    expect(shortTime(istInstant('2026-10-03', '17:00'))).toBe('5 pm');
    expect(shortTime(istInstant('2026-10-03', '10:30'))).toBe('10:30 am');
  });
});
