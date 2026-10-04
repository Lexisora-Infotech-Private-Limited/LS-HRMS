"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const _kudosrules = require("./kudos.rules");
const _feedrules = require("../feed/feed.rules");
const _html = require("../common/html");
const ist = (s)=>new Date(`${s}:00+05:30`);
(0, _vitest.describe)('kudos limits', ()=>{
    const now = ist('2026-09-29T10:00');
    const base = {
        giverId: 'neha',
        recipientId: 'rahul',
        badgeId: 'star',
        recipientName: 'Rahul Desai',
        now
    };
    (0, _vitest.it)('rejects self-kudos with 422', ()=>{
        (0, _vitest.expect)((0, _kudosrules.kudosLimitError)({
            ...base,
            recipientId: 'neha',
            recent: []
        })?.status).toBe(422);
    });
    (0, _vitest.it)('allows the same badge to the same person once per 7 days (429 otherwise)', ()=>{
        const recent = [
            {
                recipientEmployeeId: 'rahul',
                badgeId: 'star',
                createdAt: ist('2026-09-26T11:00')
            }
        ];
        const err = (0, _kudosrules.kudosLimitError)({
            ...base,
            recent
        });
        (0, _vitest.expect)(err?.status).toBe(429);
        (0, _vitest.expect)(err?.code).toBe('KUDOS_LIMIT');
        (0, _vitest.expect)((0, _kudosrules.kudosLimitError)({
            ...base,
            badgeId: 'team',
            recent
        })).toBeNull();
        (0, _vitest.expect)((0, _kudosrules.kudosLimitError)({
            ...base,
            recent: [
                {
                    ...recent[0],
                    createdAt: ist('2026-09-21T11:00')
                }
            ]
        })).toBeNull();
    });
    (0, _vitest.it)('caps a giver at 10 kudos per 7 days', ()=>{
        const recent = Array.from({
            length: 10
        }, (_, i)=>({
                recipientEmployeeId: `p${i}`,
                badgeId: 'team',
                createdAt: ist('2026-09-25T10:00')
            }));
        (0, _vitest.expect)((0, _kudosrules.kudosLimitError)({
            ...base,
            recent
        })?.message).toMatch(/10 kudos a week/);
        (0, _vitest.expect)((0, _kudosrules.kudosLimitError)({
            ...base,
            recent: recent.slice(0, 9)
        })).toBeNull();
    });
});
(0, _vitest.describe)('Employee of the Month', ()=>{
    (0, _vitest.it)('offers the current month and the previous two', ()=>{
        (0, _vitest.expect)((0, _kudosrules.eotmMonthOptions)('2026-09-29')).toEqual([
            '2026-09',
            '2026-08',
            '2026-07'
        ]);
        (0, _vitest.expect)((0, _kudosrules.eotmMonthOptions)('2026-01-05')).toEqual([
            '2026-01',
            '2025-12',
            '2025-11'
        ]);
        (0, _vitest.expect)((0, _kudosrules.shiftMonth)('2026-12', 1)).toBe('2027-01');
    });
    (0, _vitest.it)('rejects future and stale months', ()=>{
        (0, _vitest.expect)((0, _kudosrules.eotmMonthError)('2026-09', '2026-09-29')).toBeNull();
        (0, _vitest.expect)((0, _kudosrules.eotmMonthError)('2026-10', '2026-09-29')?.code).toBe('EOTM_FUTURE');
        (0, _vitest.expect)((0, _kudosrules.eotmMonthError)('2026-05', '2026-09-29')?.code).toBe('EOTM_MONTH');
    });
    (0, _vitest.it)('requires the recipient to be on the rolls during the month', ()=>{
        (0, _vitest.expect)((0, _kudosrules.eotmEligible)({
            status: 'ACTIVE',
            joiningDate: new Date('2024-01-12T00:00:00Z')
        }, '2026-09')).toBe(true);
        (0, _vitest.expect)((0, _kudosrules.eotmEligible)({
            status: 'ONBOARDING',
            joiningDate: new Date('2026-10-06T00:00:00Z')
        }, '2026-09')).toBe(false);
        (0, _vitest.expect)((0, _kudosrules.eotmEligible)({
            status: 'ACTIVE',
            joiningDate: new Date('2026-10-01T00:00:00Z')
        }, '2026-09')).toBe(false);
        (0, _vitest.expect)((0, _kudosrules.eotmEligible)({
            status: 'ACTIVE',
            joiningDate: new Date('2026-09-15T00:00:00Z')
        }, '2026-09')).toBe(true);
        (0, _vitest.expect)((0, _kudosrules.eotmEligible)({
            status: 'EXITED',
            joiningDate: null
        }, '2026-09')).toBe(false);
    });
    (0, _vitest.it)('builds a pronoun-neutral, escaped post body', ()=>{
        (0, _vitest.expect)((0, _kudosrules.eotmPostBody)('Shipped <b>billing</b> early.')).toBe('<p>Shipped &lt;b&gt;billing&lt;/b&gt; early.</p><p>The certificate is ready to download.</p>');
    });
    (0, _vitest.it)('formats sidebar names and the top badge', ()=>{
        (0, _vitest.expect)((0, _kudosrules.shortName)('Rahul Desai')).toBe('Rahul D.');
        (0, _vitest.expect)((0, _kudosrules.shortName)('Priya')).toBe('Priya');
        const t = (0, _kudosrules.topBadge)([
            {
                badge: 'Star Coder',
                createdAt: ist('2026-09-26T10:00')
            },
            {
                badge: 'Bug Hunter',
                createdAt: ist('2026-09-22T10:00')
            },
            {
                badge: 'Bug Hunter',
                createdAt: ist('2026-09-02T10:00')
            }
        ]);
        (0, _vitest.expect)(t).toEqual({
            name: 'Bug Hunter',
            count: 2
        });
        (0, _vitest.expect)((0, _kudosrules.topBadge)([])).toBeNull();
    });
});
(0, _vitest.describe)('feed rules', ()=>{
    const people = [
        {
            id: 'priya',
            fullName: 'Priya Sharma',
            firstName: 'Priya'
        },
        {
            id: 'kavya',
            fullName: 'Kavya Iyer',
            firstName: 'Kavya'
        },
        {
            id: 'meera',
            fullName: 'Meera Iyer',
            firstName: 'Meera'
        },
        {
            id: 'rahul',
            fullName: 'Rahul Desai',
            firstName: 'Rahul'
        },
        {
            id: 'rahul2',
            fullName: 'Rahul Verma',
            firstName: 'Rahul'
        }
    ];
    (0, _vitest.it)('parses and resolves @mentions', ()=>{
        (0, _vitest.expect)((0, _shared.mentionTokens)('Great work @Priya Sharma and @kavya!')).toEqual([
            'Priya Sharma',
            'kavya'
        ]);
        (0, _vitest.expect)((0, _feedrules.resolveMentions)('Great work @Priya and @Kavya', people).sort()).toEqual([
            'kavya',
            'priya'
        ]);
        (0, _vitest.expect)((0, _feedrules.resolveMentions)('cc @Rahul Desai', people)).toEqual([
            'rahul'
        ]);
        (0, _vitest.expect)((0, _feedrules.resolveMentions)('cc @Rahul', people)).toEqual([]); // ambiguous first name
        (0, _vitest.expect)((0, _feedrules.resolveMentions)('mail me at a@b.com', people)).toEqual([]);
    });
    (0, _vitest.it)('shortens designations for the meta line', ()=>{
        (0, _vitest.expect)((0, _shared.designationShort)('Chief Executive Officer')).toBe('CEO');
        (0, _vitest.expect)((0, _shared.designationShort)('HR Manager')).toBe('HR');
        (0, _vitest.expect)((0, _shared.designationShort)('Project Lead')).toBe('Project Lead');
        (0, _vitest.expect)((0, _feedrules.postMeta)('Chief Executive Officer', ist('2026-09-01T10:00'), false)).toBe('CEO · 1 Sep');
        (0, _vitest.expect)((0, _feedrules.postMeta)('Project Lead', ist('2026-09-20T17:00'), true)).toBe('Former employee · 20 Sep');
    });
    (0, _vitest.it)('limits editing to drafts by their author and publishers on live posts', ()=>{
        (0, _vitest.expect)((0, _feedrules.canEditPost)({
            status: 'DRAFT',
            authorEmployeeId: 'kavya',
            kind: 'BLOG'
        }, 'kavya', true)).toBe(true);
        (0, _vitest.expect)((0, _feedrules.canEditPost)({
            status: 'DRAFT',
            authorEmployeeId: 'kavya',
            kind: 'BLOG'
        }, 'rohit', true)).toBe(false);
        (0, _vitest.expect)((0, _feedrules.canEditPost)({
            status: 'PUBLISHED',
            authorEmployeeId: 'kavya',
            kind: 'BLOG'
        }, 'rohit', true)).toBe(true);
        (0, _vitest.expect)((0, _feedrules.canEditPost)({
            status: 'PUBLISHED',
            authorEmployeeId: 'rohit',
            kind: 'EOTM'
        }, 'rohit', true)).toBe(false);
        (0, _vitest.expect)((0, _feedrules.canEditPost)({
            status: 'PUBLISHED',
            authorEmployeeId: 'priya',
            kind: 'BLOG'
        }, 'priya', false)).toBe(false);
    });
    (0, _vitest.it)('threads replies one level deep and orders pinned posts first', ()=>{
        (0, _vitest.expect)((0, _feedrules.threadParent)(null)).toBeNull();
        (0, _vitest.expect)((0, _feedrules.threadParent)({
            id: 'c1',
            parentId: null
        })).toBe('c1');
        (0, _vitest.expect)((0, _feedrules.threadParent)({
            id: 'c2',
            parentId: 'c1'
        })).toBe('c1');
        const rows = (0, _feedrules.feedOrder)([
            {
                id: 'p2',
                pinned: false,
                publishedAt: ist('2026-09-25T11:30')
            },
            {
                id: 'p3',
                pinned: false,
                publishedAt: ist('2026-09-20T17:00')
            },
            {
                id: 'p1',
                pinned: true,
                publishedAt: ist('2026-09-01T10:00')
            }
        ]);
        (0, _vitest.expect)(rows.map((r)=>r.id)).toEqual([
            'p1',
            'p2',
            'p3'
        ]);
    });
    (0, _vitest.it)('sanitises composer HTML (toolbar output survives, scripts and handlers do not)', ()=>{
        const html = (0, _html.sanitizeHtml)('<h2>Timelines</h2><ul><li><b>1 Oct</b></li></ul><a href="https://x.dev" onclick="evil()">KRA</a><img src="/api/v1/files/abc123?access_token=t" onerror="x()"><script>alert(1)</script>');
        (0, _vitest.expect)(html).toBe('<h2>Timelines</h2><ul><li><strong>1 Oct</strong></li></ul><a href="https://x.dev" rel="noopener nofollow" target="_blank">KRA</a><img src="/api/v1/files/abc123" alt="">');
    });
});

//# sourceMappingURL=kudos.spec.js.map