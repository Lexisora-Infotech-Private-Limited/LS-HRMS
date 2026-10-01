import { designationShort, mentionTokens } from '@lexisora/shared';
import { dayMonth } from '../common/dates';

/** Company feed rules (spec §3.5). Pure — unit tested. */

export const MAX_PINNED = 3;
export const FEED_PAGE = 10;
/** Posts published within this window share one "new posts" alert. */
export const ALERT_BATCH_MS = 15 * 60_000;

export type Person = { id: string; fullName: string; firstName: string };

/**
 * Resolves "@Priya" / "@Priya Sharma" mentions to employee ids: an exact full-name match
 * wins, else a first name that only one person has.
 */
export function resolveMentions(body: string, people: Person[]): string[] {
  const out = new Set<string>();
  for (const token of mentionTokens(body)) {
    const t = token.toLowerCase();
    const full = people.filter((p) => p.fullName.toLowerCase() === t);
    if (full.length === 1) {
      out.add(full[0]!.id);
      continue;
    }
    const first = t.split(' ')[0]!;
    const byFirst = people.filter((p) => p.firstName.toLowerCase() === first);
    if (byFirst.length === 1) out.add(byFirst[0]!.id);
  }
  return [...out];
}

/** Card meta line: "CEO · 1 Sep", "Former employee · 20 Sep". */
export function postMeta(designation: string | null, publishedAt: Date | null, exited: boolean): string {
  const who = exited ? 'Former employee' : designationShort(designation);
  return publishedAt ? `${who} · ${dayMonth(publishedAt)}` : `${who} · Draft`;
}

export type PostState = { status: string; authorEmployeeId: string; kind: string };

/** Authors edit their drafts; publishers edit published posts (sets editedAt). System posts are not editable. */
export function canEditPost(p: PostState, me: string | null, publisher: boolean): boolean {
  if (p.kind === 'EOTM' || p.kind === 'KUDOS') return false;
  if (p.status === 'DRAFT') return !!me && p.authorEmployeeId === me && publisher;
  if (p.status === 'PUBLISHED') return publisher;
  return false;
}

/** Comments thread one level deep: a reply to a reply attaches to the top-level comment. */
export function threadParent(parent: { id: string; parentId: string | null } | null): string | null {
  if (!parent) return null;
  return parent.parentId ?? parent.id;
}

/** Feed order: pinned first, then newest. */
export function feedOrder<T extends { pinned: boolean; publishedAt: Date | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
}
