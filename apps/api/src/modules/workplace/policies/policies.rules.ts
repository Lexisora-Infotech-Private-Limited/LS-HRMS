import { addDaysKey, dateOnly, DAY_MS, istInstant, todayKey } from '../common/dates';

/**
 * Policies & rulebook rules (spec §9): acknowledgement due dates, overdue, reminder days,
 * compliance counts, carry-over between versions. Pure — unit tested.
 */

/** dueAt = max(effectiveFrom, today) + ackDueDays, at the end of the business day (18:30 IST). */
export function ackDueAt(effectiveFromKey: string | null, now: Date, ackDueDays: number): Date {
  const today = todayKey(now);
  const base = effectiveFromKey && effectiveFromKey > today ? effectiveFromKey : today;
  return istInstant(addDaysKey(base, ackDueDays), '18:30');
}

export function isOverdue(a: { dueAt: Date; acknowledgedAt: Date | null }, now: Date): boolean {
  return !a.acknowledgedAt && a.dueAt.getTime() < now.getTime();
}

const daysBetween = (a: string, b: string) => Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / DAY_MS);

/**
 * Reminder days: day 3 after the requirement started (if before the due day), the due day,
 * then every 3 days while overdue. Throttled to one reminder per 24 hours.
 */
export function reminderDue(a: { startKey: string; dueAt: Date; acknowledgedAt: Date | null; lastRemindedAt: Date | null }, now: Date): boolean {
  if (a.acknowledgedAt) return false;
  if (a.lastRemindedAt && now.getTime() - a.lastRemindedAt.getTime() < DAY_MS - 60_000) return false;
  const today = todayKey(now);
  const due = todayKey(a.dueAt);
  if (today === due) return true;
  if (today < due) return today === addDaysKey(a.startKey, 3);
  return daysBetween(due, today) % 3 === 0;
}

export type AckLike = { employeeId: string; dueAt: Date; acknowledgedAt: Date | null };

/** Compliance for one policy version; exited employees are excluded by the caller. */
export function complianceCounts(acks: AckLike[], now: Date) {
  const required = acks.length;
  const acknowledged = acks.filter((a) => a.acknowledgedAt).length;
  const overdue = acks.filter((a) => isOverdue(a, now)).length;
  return { required, acknowledged, pending: required - acknowledged, overdue, pct: required ? Math.round((acknowledged / required) * 100) : 100 };
}

/**
 * Requirements for a newly published version: copies acknowledgements from the previous
 * version when re-acknowledgement is not required, otherwise everyone starts pending.
 */
export function requirementsForVersion(input: {
  audience: string[];
  previous: AckLike[];
  requiresReack: boolean;
  isFirst: boolean;
  dueAt: Date;
}): { employeeId: string; dueAt: Date; acknowledgedAt: Date | null; carried: boolean }[] {
  const prev = new Map(input.previous.map((p) => [p.employeeId, p]));
  return input.audience.map((employeeId) => {
    const p = prev.get(employeeId);
    if (!input.isFirst && !input.requiresReack && p) return { employeeId, dueAt: p.dueAt, acknowledgedAt: p.acknowledgedAt, carried: true };
    return { employeeId, dueAt: input.dueAt, acknowledgedAt: null, carried: false };
  });
}

/** "Leave & attendance policy" → "leave & attendance policy"; acronyms (IT, POSH) are kept. */
export function lowerTitle(title: string): string {
  const [first = '', ...rest] = title.split(' ');
  const keep = first.length > 1 && first === first.toUpperCase();
  return [keep ? first : first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(' ');
}

/** Pages in a PDF (counts page objects); null when it cannot be read. */
export function pdfPageCount(buf: Buffer | null | undefined): number | null {
  if (!buf?.length) return null;
  const m = buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g);
  return m ? m.length : null;
}
