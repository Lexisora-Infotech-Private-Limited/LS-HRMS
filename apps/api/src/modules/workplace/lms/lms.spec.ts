import { describe, expect, it } from 'vitest';
import { assignmentLabel, bucketCount, courseProgressPct, courseTile, creditBuckets, dueAtFor, dueInfo, isVideoComplete, lessonFraction, type TileInput } from './lms.rules';

const base: TileInput = {
  courseId: 'c1',
  title: 'Secure coding guidelines',
  description: null,
  category: 'REQUIRED',
  totalDurationSec: 40 * 60,
  certificateOnCompletion: true,
  firstLessonType: 'VIDEO',
  lessonsTotal: 5,
  enrollment: null,
};
const enr = (p: Partial<NonNullable<TileInput['enrollment']>>): NonNullable<TileInput['enrollment']> => ({ id: 'e1', status: 'NOT_STARTED', lessonsDone: 0, progressPct: 0, dueAt: null, required: true, certificateId: null, certificateDownloadedAt: null, ...p });
const NOW = new Date('2026-09-29T04:10:00Z');

describe('video progress', () => {
  it('credits buckets only for real playback', () => {
    expect(bucketCount(95)).toBe(10);
    expect(creditBuckets([], 0, 15, 1, 100)).toEqual({ buckets: [0, 1], credited: true });
    expect(creditBuckets([0, 1], 15, 300, 1, 600).credited).toBe(false); // a seek
    expect(creditBuckets([], 0, 30, 1.5, 600).credited).toBe(true); // 1.5× playback
    expect(creditBuckets([], 0, 40, 1, 600).credited).toBe(false);
  });
  it('merges parallel tabs as a set union', () => {
    expect(creditBuckets([0, 1, 5], 20, 30, 1, 100).buckets).toEqual([0, 1, 2, 5]);
  });
  it('completes a video at 90 % of its buckets', () => {
    expect(isVideoComplete([0, 1, 2, 3, 4, 5, 6, 7, 8], 100)).toBe(true);
    expect(isVideoComplete([0, 1, 2, 3, 4, 5, 6, 7], 100)).toBe(false);
  });
  it('counts completed lessons as 1 and partial videos by share (max 0.9)', () => {
    expect(lessonFraction({ type: 'VIDEO', durationSec: 100 }, { completedAt: new Date(), watchedBuckets: [] })).toBe(1);
    expect(lessonFraction({ type: 'VIDEO', durationSec: 100 }, { completedAt: null, watchedBuckets: [0, 1, 2, 3, 4] })).toBe(0.5);
    expect(lessonFraction({ type: 'DOCUMENT', durationSec: 0 }, { completedAt: null, watchedBuckets: [] })).toBe(0);
    expect(courseProgressPct([1, 1, 1, 0.5, 0])).toBe(70);
    expect(courseProgressPct([])).toBe(0);
  });
});

describe('due dates', () => {
  it('ends at 23:59:59 IST, N days later', () => {
    expect(dueAtFor(new Date('2026-09-28T04:30:00Z'), 14).toISOString()).toBe('2026-10-12T18:29:59.000Z');
  });
  it('labels and flags overdue', () => {
    const due = new Date('2026-10-12T18:29:59Z');
    expect(dueInfo(due, false, NOW)).toEqual({ label: 'Due 12 Oct', overdue: false });
    expect(dueInfo(new Date('2026-09-28T18:29:59Z'), false, NOW).overdue).toBe(true);
    expect(dueInfo(new Date('2026-09-28T18:29:59Z'), true, NOW).overdue).toBe(false);
  });
});

describe('course tiles (wireframe states)', () => {
  it('in progress: "3 of 5 lessons done" → Continue', () => {
    const t = courseTile({ ...base, enrollment: enr({ status: 'IN_PROGRESS', lessonsDone: 3, progressPct: 60, dueAt: new Date('2026-10-12T18:29:59Z') }) }, NOW);
    expect(t.kicker).toBe('Required · 40 min');
    expect(t.statusLine).toBe('3 of 5 lessons done');
    expect(t.cta).toBe('Continue');
    expect(t.dueLabel).toBe('Due 12 Oct');
  });
  it('completed with an undownloaded certificate → "Completed · certificate ready"', () => {
    const t = courseTile({ ...base, title: 'Git workflow at Lexisora', category: 'ONBOARDING', totalDurationSec: 25 * 60, enrollment: enr({ status: 'COMPLETED', lessonsDone: 3, progressPct: 100, certificateId: 'cert' }) }, NOW);
    expect(t.kicker).toBe('Onboarding · 25 min');
    expect(t.statusLine).toBe('Completed · certificate ready');
    expect(t.cta).toBe('Download certificate');
  });
  it('completed and downloaded → "Completed" with Download certificate', () => {
    const t = courseTile({ ...base, enrollment: enr({ status: 'COMPLETED', certificateId: 'cert', certificateDownloadedAt: new Date() }) }, NOW);
    expect(t.statusLine).toBe('Completed');
    expect(t.cta).toBe('Download certificate');
  });
  it('not started → Start; optional 70 min → "Optional · 1h 10m"', () => {
    const t = courseTile({ ...base, category: 'OPTIONAL', totalDurationSec: 70 * 60, enrollment: enr({}) }, NOW);
    expect(t.kicker).toBe('Optional · 1h 10m');
    expect(t.statusLine).toBe('Not started');
    expect(t.cta).toBe('Start');
  });
  it('catalogue course without enrollment → Enroll; overdue enrollment flagged', () => {
    expect(courseTile(base, NOW).cta).toBe('Enroll');
    const t = courseTile({ ...base, enrollment: enr({ status: 'IN_PROGRESS', lessonsDone: 1, dueAt: new Date('2026-09-20T18:29:59Z') }) }, NOW);
    expect(t.status).toBe('OVERDUE');
    expect(t.overdue).toBe(true);
  });
  it('assignment labels', () => {
    expect(assignmentLabel({ audienceType: 'ALL', label: null })).toBe('All employees');
    expect(assignmentLabel({ audienceType: 'NEW_JOINERS', label: null })).toBe('New joiners');
    expect(assignmentLabel({ audienceType: 'DEPARTMENT', label: 'All developers' })).toBe('All developers');
  });
});
