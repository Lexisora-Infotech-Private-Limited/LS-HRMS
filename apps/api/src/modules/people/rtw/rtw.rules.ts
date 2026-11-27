/**
 * Pure rules for UK right to work checks (no Nest / Prisma imports, unit tested):
 * the computed status of a person's current check, the default re-check date, warnings
 * on a recorded check, input validation and which reminders the daily job sends.
 * Dates are "YYYY-MM-DD" keys.
 */
import { RTW_FOLLOW_UP_WINDOW_DAYS, RTW_SHARE_CODE_RE, normaliseShareCode, type RtwMethod, type RtwResult, type RtwStatus } from '@lexisora/shared';

export type RtwCheckLike = {
  result: RtwResult;
  permissionExpiresOn: string | null;
  followUpOn: string | null;
};

const dayMs = 86_400_000;
const toUtc = (k: string) => Date.parse(`${k}T00:00:00.000Z`);
/** Whole days from `a` to `b` (positive when b is later). */
export const daysFrom = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / dayMs);

/** Re-check date: the date HR entered, else the end of a time-limited permission, else none. */
export function defaultFollowUp(result: RtwResult, permissionExpiresOn: string | null | undefined, followUpOn?: string | null): string | null {
  if (result === 'NO_RIGHT') return null;
  if (followUpOn) return followUpOn;
  if (result === 'TIME_LIMITED') return permissionExpiresOn ?? null;
  return null;
}

/**
 * Status of a person from their current (not superseded) check:
 *  - no check → MISSING
 *  - NO_RIGHT result → NO_RIGHT
 *  - time-limited permission whose end date has passed → EXPIRED
 *  - re-check date within 60 days (or overdue while the permission is still valid) → FOLLOW_UP_DUE
 *  - otherwise CURRENT
 */
export function rtwStatus(check: RtwCheckLike | null, today: string): { status: RtwStatus; daysToFollowUp: number | null } {
  if (!check) return { status: 'MISSING', daysToFollowUp: null };
  if (check.result === 'NO_RIGHT') return { status: 'NO_RIGHT', daysToFollowUp: null };
  const follow = defaultFollowUp(check.result, check.permissionExpiresOn, check.followUpOn);
  const days = follow ? daysFrom(today, follow) : null;
  if (check.result === 'TIME_LIMITED' && check.permissionExpiresOn && check.permissionExpiresOn < today) return { status: 'EXPIRED', daysToFollowUp: days };
  if (days !== null && days <= RTW_FOLLOW_UP_WINDOW_DAYS) return { status: 'FOLLOW_UP_DUE', daysToFollowUp: days };
  return { status: 'CURRENT', daysToFollowUp: days };
}

export type RtwInputLike = {
  method: RtwMethod;
  documentType: string;
  shareCode?: string | null;
  result: RtwResult;
  permissionExpiresOn?: string | null;
  followUpOn?: string | null;
  checkedOn: string;
};

/** Hard errors for a new check (the zod schema covers the shape; these need "today"). */
export function validateRtwCheck(i: RtwInputLike, today: string): string | null {
  if (i.checkedOn > today) return 'The check date cannot be in the future';
  if (i.method === 'SHARE_CODE') {
    const code = normaliseShareCode(i.shareCode);
    if (!code) return 'Enter the share code used for the online check';
    if (!RTW_SHARE_CODE_RE.test(code)) return 'A share code is 9 letters or numbers, e.g. W4K 7RT 2PQ';
  }
  if (i.result === 'TIME_LIMITED' && !i.permissionExpiresOn) return 'Enter the date the permission ends';
  if (i.permissionExpiresOn && i.permissionExpiresOn < i.checkedOn) return 'The permission end date is before the check date';
  if (i.followUpOn && i.followUpOn < i.checkedOn) return 'The re-check date is before the check date';
  return null;
}

/** Soft warnings shown on a check (kept, not blocking). */
export function rtwWarnings(i: RtwInputLike, joiningDate: string | null): string[] {
  const w: string[] = [];
  if (joiningDate && i.checkedOn > joiningDate) {
    w.push(
      i.method === 'MANUAL'
        ? `Manual check done after the start date (${joiningDate}). It must be done on or before the first day of work to give a statutory excuse.`
        : `Check done after the start date (${joiningDate}). Checks must be done before the person starts work.`,
    );
  }
  if (i.method === 'IDSP' && !/passport/i.test(i.documentType)) w.push('A digital ID (IDSP) check only covers valid British and Irish passports.');
  if (i.method === 'MANUAL' && /evisa|settlement|brp|biometric/i.test(i.documentType)) w.push('eVisa, EU Settlement Scheme and BRP holders must be checked online with a share code, not manually.');
  if (i.result === 'NO_RIGHT') w.push('This person has no right to work in the UK. Do not employ them or stop their work now.');
  return w;
}

export type RtwReminder = { kind: 'DUE'; days: 60 | 30 | 7 } | { kind: 'EXPIRED' };

/** Reminder the daily job sends for a check today: 60/30/7 days before the re-check date, and the day after a permission ends. */
export function rtwReminder(check: RtwCheckLike, today: string): RtwReminder | null {
  if (check.result === 'NO_RIGHT') return null;
  if (check.result === 'TIME_LIMITED' && check.permissionExpiresOn && daysFrom(today, check.permissionExpiresOn) === -1) return { kind: 'EXPIRED' };
  const follow = defaultFollowUp(check.result, check.permissionExpiresOn, check.followUpOn);
  if (!follow) return null;
  const d = daysFrom(today, follow);
  return d === 60 || d === 30 || d === 7 ? { kind: 'DUE', days: d } : null;
}

/** An onboarding joiner starts within 3 days (or today) and has no check yet. */
export function missingCheckBeforeStart(joiningDate: string | null, today: string, hasCheck: boolean): boolean {
  if (hasCheck || !joiningDate) return false;
  const d = daysFrom(today, joiningDate);
  return d >= 0 && d <= 3;
}
