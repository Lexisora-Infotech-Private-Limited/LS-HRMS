import { describe, expect, it } from 'vitest';
import { designationShort, mentionTokens } from '@lexisora/shared';
import { eotmEligible, eotmMonthError, eotmMonthOptions, eotmPostBody, kudosLimitError, shiftMonth, shortName, topBadge } from './kudos.rules';
import { canEditPost, feedOrder, postMeta, resolveMentions, threadParent } from '../feed/feed.rules';
import { sanitizeHtml } from '../common/html';

const ist = (s: string) => new Date(`${s}:00+05:30`);

describe('kudos limits', () => {
  const now = ist('2026-09-29T10:00');
  const base = { giverId: 'neha', recipientId: 'rahul', badgeId: 'star', recipientName: 'Rahul Desai', now };

  it('rejects self-kudos with 422', () => {
    expect(kudosLimitError({ ...base, recipientId: 'neha', recent: [] })?.status).toBe(422);
  });

  it('allows the same badge to the same person once per 7 days (429 otherwise)', () => {
    const recent = [{ recipientEmployeeId: 'rahul', badgeId: 'star', createdAt: ist('2026-09-26T11:00') }];
    const err = kudosLimitError({ ...base, recent });
    expect(err?.status).toBe(429);
    expect(err?.code).toBe('KUDOS_LIMIT');
    expect(kudosLimitError({ ...base, badgeId: 'team', recent })).toBeNull();
    expect(kudosLimitError({ ...base, recent: [{ ...recent[0]!, createdAt: ist('2026-09-21T11:00') }] })).toBeNull();
  });

  it('caps a giver at 10 kudos per 7 days', () => {
    const recent = Array.from({ length: 10 }, (_, i) => ({ recipientEmployeeId: `p${i}`, badgeId: 'team', createdAt: ist('2026-09-25T10:00') }));
    expect(kudosLimitError({ ...base, recent })?.message).toMatch(/10 kudos a week/);
    expect(kudosLimitError({ ...base, recent: recent.slice(0, 9) })).toBeNull();
  });
});

describe('Employee of the Month', () => {
  it('offers the current month and the previous two', () => {
    expect(eotmMonthOptions('2026-09-29')).toEqual(['2026-09', '2026-08', '2026-07']);
    expect(eotmMonthOptions('2026-01-05')).toEqual(['2026-01', '2025-12', '2025-11']);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('rejects future and stale months', () => {
    expect(eotmMonthError('2026-09', '2026-09-29')).toBeNull();
    expect(eotmMonthError('2026-10', '2026-09-29')?.code).toBe('EOTM_FUTURE');
    expect(eotmMonthError('2026-05', '2026-09-29')?.code).toBe('EOTM_MONTH');
  });

  it('requires the recipient to be on the rolls during the month', () => {
    expect(eotmEligible({ status: 'ACTIVE', joiningDate: new Date('2024-01-12T00:00:00Z') }, '2026-09')).toBe(true);
    expect(eotmEligible({ status: 'ONBOARDING', joiningDate: new Date('2026-10-06T00:00:00Z') }, '2026-09')).toBe(false);
    expect(eotmEligible({ status: 'ACTIVE', joiningDate: new Date('2026-10-01T00:00:00Z') }, '2026-09')).toBe(false);
    expect(eotmEligible({ status: 'ACTIVE', joiningDate: new Date('2026-09-15T00:00:00Z') }, '2026-09')).toBe(true);
    expect(eotmEligible({ status: 'EXITED', joiningDate: null }, '2026-09')).toBe(false);
  });

  it('builds a pronoun-neutral, escaped post body', () => {
    expect(eotmPostBody('Shipped <b>billing</b> early.')).toBe('<p>Shipped &lt;b&gt;billing&lt;/b&gt; early.</p><p>The certificate is ready to download.</p>');
  });

  it('formats sidebar names and the top badge', () => {
    expect(shortName('Rahul Desai')).toBe('Rahul D.');
    expect(shortName('Priya')).toBe('Priya');
    const t = topBadge([
      { badge: 'Star Coder', createdAt: ist('2026-09-26T10:00') },
      { badge: 'Bug Hunter', createdAt: ist('2026-09-22T10:00') },
      { badge: 'Bug Hunter', createdAt: ist('2026-09-02T10:00') },
    ]);
    expect(t).toEqual({ name: 'Bug Hunter', count: 2 });
    expect(topBadge([])).toBeNull();
  });
});

describe('feed rules', () => {
  const people = [
    { id: 'priya', fullName: 'Priya Sharma', firstName: 'Priya' },
    { id: 'kavya', fullName: 'Kavya Iyer', firstName: 'Kavya' },
    { id: 'meera', fullName: 'Meera Iyer', firstName: 'Meera' },
    { id: 'rahul', fullName: 'Rahul Desai', firstName: 'Rahul' },
    { id: 'rahul2', fullName: 'Rahul Verma', firstName: 'Rahul' },
  ];

  it('parses and resolves @mentions', () => {
    expect(mentionTokens('Great work @Priya Sharma and @kavya!')).toEqual(['Priya Sharma', 'kavya']);
    expect(resolveMentions('Great work @Priya and @Kavya', people).sort()).toEqual(['kavya', 'priya']);
    expect(resolveMentions('cc @Rahul Desai', people)).toEqual(['rahul']);
    expect(resolveMentions('cc @Rahul', people)).toEqual([]); // ambiguous first name
    expect(resolveMentions('mail me at a@b.com', people)).toEqual([]);
  });

  it('shortens designations for the meta line', () => {
    expect(designationShort('Chief Executive Officer')).toBe('CEO');
    expect(designationShort('HR Manager')).toBe('HR');
    expect(designationShort('Project Lead')).toBe('Project Lead');
    expect(postMeta('Chief Executive Officer', ist('2026-09-01T10:00'), false)).toBe('CEO · 1 Sep');
    expect(postMeta('Project Lead', ist('2026-09-20T17:00'), true)).toBe('Former employee · 20 Sep');
  });

  it('limits editing to drafts by their author and publishers on live posts', () => {
    expect(canEditPost({ status: 'DRAFT', authorEmployeeId: 'kavya', kind: 'BLOG' }, 'kavya', true)).toBe(true);
    expect(canEditPost({ status: 'DRAFT', authorEmployeeId: 'kavya', kind: 'BLOG' }, 'rohit', true)).toBe(false);
    expect(canEditPost({ status: 'PUBLISHED', authorEmployeeId: 'kavya', kind: 'BLOG' }, 'rohit', true)).toBe(true);
    expect(canEditPost({ status: 'PUBLISHED', authorEmployeeId: 'rohit', kind: 'EOTM' }, 'rohit', true)).toBe(false);
    expect(canEditPost({ status: 'PUBLISHED', authorEmployeeId: 'priya', kind: 'BLOG' }, 'priya', false)).toBe(false);
  });

  it('threads replies one level deep and orders pinned posts first', () => {
    expect(threadParent(null)).toBeNull();
    expect(threadParent({ id: 'c1', parentId: null })).toBe('c1');
    expect(threadParent({ id: 'c2', parentId: 'c1' })).toBe('c1');
    const rows = feedOrder([
      { id: 'p2', pinned: false, publishedAt: ist('2026-09-25T11:30') },
      { id: 'p3', pinned: false, publishedAt: ist('2026-09-20T17:00') },
      { id: 'p1', pinned: true, publishedAt: ist('2026-09-01T10:00') },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('sanitises composer HTML (toolbar output survives, scripts and handlers do not)', () => {
    const html = sanitizeHtml('<h2>Timelines</h2><ul><li><b>1 Oct</b></li></ul><a href="https://x.dev" onclick="evil()">KRA</a><img src="/api/v1/files/abc123?access_token=t" onerror="x()"><script>alert(1)</script>');
    expect(html).toBe('<h2>Timelines</h2><ul><li><strong>1 Oct</strong></li></ul><a href="https://x.dev" rel="noopener nofollow" target="_blank">KRA</a><img src="/api/v1/files/abc123" alt="">');
  });
});
