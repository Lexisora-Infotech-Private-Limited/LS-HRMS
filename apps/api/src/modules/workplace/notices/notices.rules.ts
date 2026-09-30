import type { WpAudienceRule } from '@lexisora/shared';

/** Pure notice-board rules (unit-tested in notices.spec.ts). */

export type NoticeState = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'EXPIRED' | 'ARCHIVED';

const TRANSITIONS: Record<NoticeState, NoticeState[]> = {
  DRAFT: ['SCHEDULED', 'PUBLISHED'],
  SCHEDULED: ['DRAFT', 'PUBLISHED'],
  PUBLISHED: ['EXPIRED', 'ARCHIVED'],
  EXPIRED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransition(from: NoticeState, to: NoticeState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A publish request goes live now unless `publishAt` is meaningfully in the future. */
export function publishTarget(publishAt: Date | null, now: Date): 'PUBLISHED' | 'SCHEDULED' {
  return publishAt && publishAt.getTime() > now.getTime() + 60_000 ? 'SCHEDULED' : 'PUBLISHED';
}

/** `expiresAt` must be later than the publish time (or now). */
export function datesError(publishAt: Date | null, expiresAt: Date | null, now: Date): string | null {
  if (publishAt && Number.isNaN(publishAt.getTime())) return 'Publish at is not a valid date';
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return 'Expires on is not a valid date';
  const start = publishAt && publishAt > now ? publishAt : now;
  if (expiresAt && expiresAt <= start) return 'Expiry must be after the publish time';
  return null;
}

/**
 * Team-scope check for publishers without "any team" rights: every rule must be a
 * department or project the publisher leads/manages. Returns the offending rules.
 */
export function outOfScope(rules: WpAudienceRule[], scope: { departmentIds: string[]; projectIds: string[] }): WpAudienceRule[] {
  return rules.filter(
    (r) =>
      !(r.type === 'DEPARTMENT' && !!r.refId && scope.departmentIds.includes(r.refId)) &&
      !(r.type === 'PROJECT' && !!r.refId && scope.projectIds.includes(r.refId)),
  );
}

/** Stable identity of an audience (order-insensitive) — used to lock the audience after publish. */
export function audienceKey(rules: Pick<WpAudienceRule, 'type' | 'refId'>[]): string {
  return rules
    .map((r) => `${r.type}:${r.refId ?? ''}`)
    .sort()
    .join('|');
}

/** Drop duplicate rules (same type + refId). */
export function dedupeRules<T extends Pick<WpAudienceRule, 'type' | 'refId'>>(rules: T[]): T[] {
  const seen = new Set<string>();
  return rules.filter((r) => {
    const k = `${r.type}:${r.refId ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type ViewerFacts = { employeeId: string | null; isRecipient: boolean; moderator: boolean };
export type NoticeFacts = { status: NoticeState; visibility: 'GLOBAL' | 'TEAM'; authorEmployeeId: string; deletedAt: Date | null };

/**
 * Who may open a notice: drafts/scheduled/archived → author or moderator; live notices →
 * everyone for Global, recipients (audience) for Team, plus author and moderators.
 */
export function canViewNotice(n: NoticeFacts, v: ViewerFacts): boolean {
  if (n.deletedAt) return false;
  const own = !!v.employeeId && v.employeeId === n.authorEmployeeId;
  if (own || v.moderator) return true;
  if (n.status !== 'PUBLISHED' && n.status !== 'EXPIRED') return false;
  return n.visibility === 'GLOBAL' || v.isRecipient;
}

/** Dashboard announcement line: Team notices say who they are for, then a 160-char excerpt. */
export function announcementBody(visibility: 'GLOBAL' | 'TEAM', audienceLabel: string, excerpt: string, max = 160): string {
  const text = visibility === 'TEAM' ? `Visible to ${audienceLabel}. ${excerpt}`.trim() : excerpt;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** "Remind unread" is throttled to once per 24 hours per notice. */
export const REMIND_THROTTLE_MS = 24 * 3_600_000;
export function canRemind(lastRemindedAt: Date | null, now: Date): boolean {
  return !lastRemindedAt || now.getTime() - lastRemindedAt.getTime() >= REMIND_THROTTLE_MS;
}
