import { describe, expect, it } from 'vitest';
import {
  adjacentColumns,
  formatEstimate,
  formatSpent,
  isOverdue,
  liveSpentSeconds,
  showsProgress,
  sortBoardCards,
  spentProgress,
  timerStateLabel,
} from './work';

describe('board formatting', () => {
  it('estimate chip: whole hours, hours + minutes, minutes only', () => {
    expect(formatEstimate(480)).toBe('8h');
    expect(formatEstimate(90)).toBe('1h 30m');
    expect(formatEstimate(45)).toBe('45m');
    expect(formatEstimate(null)).toBe('—');
    expect(formatEstimate(0)).toBe('—');
  });

  it('spent time is H:MM with minutes rounded down', () => {
    expect(formatSpent(9 * 3600 + 45 * 60 + 59)).toBe('9:45');
    expect(formatSpent(4 * 3600 + 50 * 60)).toBe('4:50');
    expect(formatSpent(59)).toBe('0:00');
    expect(formatSpent(-5)).toBe('0:00');
  });
});

describe('overdue', () => {
  const today = '2026-10-20';
  it('is overdue only when the due date is before today and the task is not done', () => {
    expect(isOverdue('2026-10-19', 'WIP', today)).toBe(true);
    expect(isOverdue('2026-10-20', 'WIP', today)).toBe(false); // due today is not overdue
    expect(isOverdue('2026-10-19', 'DONE', today)).toBe(false);
    expect(isOverdue('2026-10-19', 'CANCELLED', today)).toBe(false);
    expect(isOverdue(null, 'OPEN', today)).toBe(false);
  });
});

describe('column order', () => {
  it('overdue first, then due date (none last), then task key numerically', () => {
    const cards = [
      { key: 'AT-110', overdue: false, dueDate: null },
      { key: 'AT-104', overdue: false, dueDate: '2026-10-23' },
      { key: 'AT-9', overdue: false, dueDate: '2026-10-21' },
      { key: 'AT-102', overdue: true, dueDate: '2026-10-15' },
      { key: 'AT-10', overdue: false, dueDate: '2026-10-21' },
      { key: 'AT-101', overdue: true, dueDate: '2026-10-12' },
    ];
    expect(sortBoardCards(cards).map((c) => c.key)).toEqual(['AT-101', 'AT-102', 'AT-9', 'AT-10', 'AT-104', 'AT-110']);
  });
});

describe('spent and progress', () => {
  it('adds the running part of a live timer from the server-sent start', () => {
    const since = '2026-10-20T04:00:00.000Z';
    const now = Date.parse(since) + 90_000;
    expect(liveSpentSeconds({ spentSeconds: 600, timer: { since } }, now)).toBe(690);
    expect(liveSpentSeconds({ spentSeconds: 600, timer: null }, now)).toBe(600);
    // A clock slightly behind the start never subtracts time.
    expect(liveSpentSeconds({ spentSeconds: 600, timer: { since } }, Date.parse(since) - 5000)).toBe(600);
  });

  it('bar width = spent ÷ estimate capped at 100 %, red only when over', () => {
    expect(spentProgress(4 * 3600 + 50 * 60, 360)).toEqual({ pct: (290 / 360) * 100, over: false });
    expect(spentProgress(9 * 3600 + 45 * 60, 480)).toEqual({ pct: 100, over: true });
    expect(spentProgress(8 * 3600, 480)).toEqual({ pct: 100, over: false });
    expect(spentProgress(3600, null)).toEqual({ pct: 0, over: false });
  });

  it('shows the progress line for In progress cards or any tracked time', () => {
    expect(showsProgress({ status: 'WIP', spentSeconds: 0, timer: null })).toBe(true);
    expect(showsProgress({ status: 'ALLOTTED', spentSeconds: 0, timer: null })).toBe(false);
    expect(showsProgress({ status: 'QA', spentSeconds: 60, timer: null })).toBe(true);
  });

  it('labels the timer: mine running, someone else running, otherwise paused', () => {
    expect(timerStateLabel({ timer: { mine: true, short: 'Priya S.' } })).toBe('Running');
    expect(timerStateLabel({ timer: { mine: false, short: 'Rahul D.' } })).toBe('On Rahul D.’s tracker');
    expect(timerStateLabel({ timer: null })).toBe('Paused');
  });
});

describe('adjacent columns', () => {
  it('first column has no back step, Done has no forward step', () => {
    expect(adjacentColumns('OPEN')).toEqual({ back: null, forward: 'ALLOTTED' });
    expect(adjacentColumns('WIP')).toEqual({ back: 'ALLOTTED', forward: 'DEV_COMPLETED' });
    expect(adjacentColumns('QA')).toEqual({ back: 'DEV_COMPLETED', forward: 'DONE' });
    expect(adjacentColumns('DONE')).toEqual({ back: 'QA', forward: null });
    expect(adjacentColumns('CANCELLED')).toEqual({ back: null, forward: null });
  });
});
