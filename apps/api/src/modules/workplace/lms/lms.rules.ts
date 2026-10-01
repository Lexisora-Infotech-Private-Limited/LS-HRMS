import { courseDurationLabel, WP_COURSE_CATEGORY_LABEL, type CourseTile } from '@lexisora/shared';
import { MONTHS_SHORT } from '../common/dates';

/** Pure learning rules (spec §7.3/§7.5): watch buckets, completion, progress, tiles, due dates. */

export const BUCKET_SEC = 10;
/** A video lesson completes once 90 % of its 10-second buckets were watched. */
export const VIDEO_COMPLETE_SHARE = 0.9;
/** Heartbeats come every 15 s; a jump bigger than 20 s × playback rate is a seek, not watching. */
export const MAX_CREDIT_SEC = 20;

export function bucketCount(durationSec: number): number {
  return Math.max(1, Math.ceil(Math.max(0, durationSec) / BUCKET_SEC));
}

/**
 * Credits the buckets between the last reported position and the new one, only when the
 * delta looks like real playback (0 < delta ≤ 20 s × rate, with 2 s of network slack).
 * Bitmaps from parallel tabs merge as a set union, so nothing is double counted.
 */
export function creditBuckets(existing: number[], lastPos: number, newPos: number, rate: number, durationSec: number): { buckets: number[]; credited: boolean } {
  const total = bucketCount(durationSec);
  const set = new Set(existing.filter((b) => b >= 0 && b < total));
  const delta = newPos - lastPos;
  const credited = delta > 0 && delta <= MAX_CREDIT_SEC * Math.max(0.5, rate) + 2;
  if (credited) {
    const from = Math.max(0, Math.floor(lastPos / BUCKET_SEC));
    const to = Math.min(total - 1, Math.floor(Math.max(newPos - 0.001, 0) / BUCKET_SEC));
    for (let b = from; b <= to; b++) set.add(b);
  }
  return { buckets: [...set].sort((a, b) => a - b), credited };
}

export function videoWatchedShare(buckets: number[], durationSec: number): number {
  const total = bucketCount(durationSec);
  return Math.min(1, new Set(buckets.filter((b) => b >= 0 && b < total)).size / total);
}

export function isVideoComplete(buckets: number[], durationSec: number): boolean {
  return videoWatchedShare(buckets, durationSec) >= VIDEO_COMPLETE_SHARE - 1e-9;
}

/** Completed lessons count 1; an unfinished video counts its watched share (max 0.9); documents 0. */
export function lessonFraction(l: { type: string; durationSec: number }, p: { completedAt: Date | null; watchedBuckets: number[] } | null | undefined): number {
  if (p?.completedAt) return 1;
  if (!p || l.type !== 'VIDEO') return 0;
  return Math.min(VIDEO_COMPLETE_SHARE, videoWatchedShare(p.watchedBuckets, l.durationSec));
}

export function courseProgressPct(fractions: number[]): number {
  if (!fractions.length) return 0;
  return Math.round((100 * fractions.reduce((a, b) => a + b, 0)) / fractions.length);
}

/** End of the IST calendar day `days` after `from` (stored as an instant). */
export function dueAtFor(from: Date, days: number): Date {
  const ist = new Date(from.getTime() + 330 * 60_000);
  const endIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days, 23, 59, 59);
  return new Date(endIst - 330 * 60_000);
}

export function dueInfo(dueAt: Date | null | undefined, completed: boolean, now: Date = new Date()): { label: string | null; overdue: boolean } {
  if (!dueAt) return { label: null, overdue: false };
  const ist = new Date(dueAt.getTime() + 330 * 60_000);
  return { label: `Due ${ist.getUTCDate()} ${MONTHS_SHORT[ist.getUTCMonth()]}`, overdue: !completed && dueAt.getTime() < now.getTime() };
}

export type TileInput = {
  courseId: string;
  title: string;
  description: string | null;
  category: 'REQUIRED' | 'OPTIONAL' | 'ONBOARDING';
  totalDurationSec: number;
  certificateOnCompletion: boolean;
  firstLessonType: string | null;
  lessonsTotal: number;
  enrollment: {
    id: string;
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
    lessonsDone: number;
    progressPct: number;
    dueAt: Date | null;
    required: boolean;
    certificateId: string | null;
    certificateDownloadedAt: Date | null;
  } | null;
};

/** The wireframe tile: kicker "Required · 40 min", status line and CTA by state (spec §7.1 table). */
export function courseTile(t: TileInput, now: Date = new Date()): CourseTile {
  const e = t.enrollment;
  const kicker = `${WP_COURSE_CATEGORY_LABEL[t.category]} · ${courseDurationLabel(t.totalDurationSec)}`;
  let statusLine = 'Not started';
  let cta: CourseTile['cta'] = e ? 'Start' : 'Enroll';
  if (!e) statusLine = `${t.lessonsTotal} lesson${t.lessonsTotal === 1 ? '' : 's'} · not enrolled`;
  else if (e.status === 'IN_PROGRESS') {
    statusLine = `${e.lessonsDone} of ${t.lessonsTotal} lessons done`;
    cta = 'Continue';
  } else if (e.status === 'COMPLETED') {
    if (e.certificateId) {
      statusLine = e.certificateDownloadedAt ? 'Completed' : 'Completed · certificate ready';
      cta = 'Download certificate';
    } else {
      statusLine = 'Completed';
      cta = 'Review';
    }
  }
  const due = dueInfo(e?.dueAt, e?.status === 'COMPLETED', now);
  return {
    courseId: t.courseId,
    enrollmentId: e?.id ?? null,
    kicker,
    title: t.title,
    status: e ? (due.overdue ? 'OVERDUE' : e.status) : 'NOT_ENROLLED',
    statusLine,
    cta,
    lessonsDone: e?.lessonsDone ?? 0,
    lessonsTotal: t.lessonsTotal,
    progressPct: e?.progressPct ?? 0,
    dueLabel: e?.status === 'COMPLETED' ? null : due.label,
    overdue: due.overdue,
    certificateId: e?.certificateId ?? null,
    category: t.category,
    required: e?.required ?? t.category !== 'OPTIONAL',
    media: t.firstLessonType === 'DOCUMENT' ? 'Document' : 'Video',
    description: t.description,
  };
}

/** "All developers" style labels for course assignments. */
export function assignmentLabel(a: { audienceType: string; label: string | null }): string {
  if (a.audienceType === 'ALL') return 'All employees';
  if (a.audienceType === 'NEW_JOINERS') return 'New joiners';
  if (a.audienceType === 'EMPLOYMENT_TYPE') return a.label ?? 'Employment type';
  return a.label ?? a.audienceType;
}
