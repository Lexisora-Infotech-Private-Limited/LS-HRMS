import { CHAT_EDIT_WINDOW_MIN, mentionTokens } from '@lexisora/shared';

/** Pure comms-hub rules (spec §5): DM keys, mentions, unread badges, edit window, call summaries. */

/** Stable key for a DM / group DM: the sorted, de-duplicated member user ids. */
export function dmKeyFor(userIds: string[]): string {
  return [...new Set(userIds.filter(Boolean))].sort().join(':');
}

/** Channel slug from a department / project name: "Atlas CRM" → "atlas-crm", department "QA" → "qa-team". */
export function channelSlug(name: string, suffix = ''): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  const slug = `${base || 'channel'}${suffix ? `-${suffix}` : ''}`;
  return /^[a-z0-9]/.test(slug) ? slug.slice(0, 60) : `c-${slug}`.slice(0, 60);
}

/** "# general" for channels, the other person's name for DMs. */
export function channelLabel(kind: string, name: string | null, dmNames: string[] = []): string {
  if (kind === 'DM' || kind === 'GROUP_DM') return dmNames.length ? dmNames.join(', ') : 'Notes to self';
  return `# ${name ?? 'channel'}`;
}

export type MentionCandidate = { userId: string; name: string };

/**
 * Resolves "@Neha", "@Neha Kapoor" or "@neha.kapoor" against the channel members.
 * A first name only matches when it is unambiguous within the channel.
 */
export function resolveMentions(body: string, members: MentionCandidate[]): string[] {
  const out = new Set<string>();
  const norm = (s: string) => s.toLowerCase().replace(/[.'-]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const raw of mentionTokens(body)) {
    const tok = norm(raw);
    if (!tok) continue;
    const full = members.filter((m) => norm(m.name) === tok);
    if (full.length) {
      full.forEach((m) => out.add(m.userId));
      continue;
    }
    // "@Neha Kapoor" can be captured as "Neha Kapoor" or just "Neha" depending on case — try the first word.
    const first = tok.split(' ')[0]!;
    const byFirst = members.filter((m) => norm(m.name).split(' ')[0] === first);
    if (byFirst.length === 1) out.add(byFirst[0]!.userId);
  }
  return [...out];
}

/** Unread badge: "" (none), "1"…"99", then "99+". */
export function unreadBadge(n: number): string {
  if (!n || n < 0) return '';
  return n > 99 ? '99+' : String(n);
}

/** Senders may edit their own message within the edit window (default 15 minutes). */
export function canEditMessage(createdAt: Date, now: Date = new Date(), windowMin = CHAT_EDIT_WINDOW_MIN): boolean {
  return now.getTime() - createdAt.getTime() <= windowMin * 60_000;
}

/** "Call · 23 min · 4 participants" */
export function callSummaryText(kind: string, startedAt: Date, endedAt: Date, participants: number): string {
  const mins = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
  const what = kind === 'SCREEN' ? 'Screen share' : kind === 'AUDIO' ? 'Audio call' : 'Call';
  return `${what} · ${mins} min · ${participants} participant${participants === 1 ? '' : 's'}`;
}

/** Posting policy: ADMINS_ONLY channels (#announcements) accept posts from publishers only. */
export function canPostIn(policy: string, isPublisher: boolean, archived: boolean): boolean {
  if (archived) return false;
  return policy !== 'ADMINS_ONLY' || isPublisher;
}

/** Keeps the composer body sane: trims trailing whitespace, collapses >2 blank lines. */
export function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
