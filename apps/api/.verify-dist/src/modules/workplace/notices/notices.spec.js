"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const _noticesrules = require("./notices.rules");
const now = new Date('2026-09-29T04:30:00.000Z'); // 10:00 IST
const mins = (m)=>new Date(now.getTime() + m * 60_000);
(0, _vitest.describe)('notice state machine', ()=>{
    (0, _vitest.it)('allows only the documented transitions', ()=>{
        (0, _vitest.expect)((0, _noticesrules.canTransition)('DRAFT', 'PUBLISHED')).toBe(true);
        (0, _vitest.expect)((0, _noticesrules.canTransition)('DRAFT', 'SCHEDULED')).toBe(true);
        (0, _vitest.expect)((0, _noticesrules.canTransition)('SCHEDULED', 'DRAFT')).toBe(true);
        (0, _vitest.expect)((0, _noticesrules.canTransition)('SCHEDULED', 'PUBLISHED')).toBe(true);
        (0, _vitest.expect)((0, _noticesrules.canTransition)('PUBLISHED', 'EXPIRED')).toBe(true);
        (0, _vitest.expect)((0, _noticesrules.canTransition)('PUBLISHED', 'ARCHIVED')).toBe(true);
        (0, _vitest.expect)((0, _noticesrules.canTransition)('EXPIRED', 'ARCHIVED')).toBe(true);
        (0, _vitest.expect)((0, _noticesrules.canTransition)('PUBLISHED', 'DRAFT')).toBe(false);
        (0, _vitest.expect)((0, _noticesrules.canTransition)('ARCHIVED', 'PUBLISHED')).toBe(false);
        (0, _vitest.expect)((0, _noticesrules.canTransition)('EXPIRED', 'PUBLISHED')).toBe(false);
    });
    (0, _vitest.it)('publishes now unless publishAt is more than a minute ahead (then schedules)', ()=>{
        (0, _vitest.expect)((0, _noticesrules.publishTarget)(null, now)).toBe('PUBLISHED');
        (0, _vitest.expect)((0, _noticesrules.publishTarget)(mins(-5), now)).toBe('PUBLISHED');
        (0, _vitest.expect)((0, _noticesrules.publishTarget)(mins(1), now)).toBe('PUBLISHED');
        (0, _vitest.expect)((0, _noticesrules.publishTarget)(mins(2), now)).toBe('SCHEDULED');
    });
    (0, _vitest.it)('requires expiry after the publish time (or now)', ()=>{
        (0, _vitest.expect)((0, _noticesrules.datesError)(null, null, now)).toBeNull();
        (0, _vitest.expect)((0, _noticesrules.datesError)(null, mins(60), now)).toBeNull();
        (0, _vitest.expect)((0, _noticesrules.datesError)(null, mins(-60), now)).toBe('Expiry must be after the publish time');
        (0, _vitest.expect)((0, _noticesrules.datesError)(mins(120), mins(60), now)).toBe('Expiry must be after the publish time');
        (0, _vitest.expect)((0, _noticesrules.datesError)(mins(60), mins(120), now)).toBeNull();
        (0, _vitest.expect)((0, _noticesrules.datesError)(new Date('nope'), null, now)).toBe('Publish at is not a valid date');
    });
});
(0, _vitest.describe)('team scope for publishers without "any team"', ()=>{
    const scope = {
        departmentIds: [
            'dev'
        ],
        projectIds: [
            'atlas'
        ]
    };
    (0, _vitest.it)('accepts departments and projects the publisher leads', ()=>{
        (0, _vitest.expect)((0, _noticesrules.outOfScope)([
            {
                type: 'DEPARTMENT',
                refId: 'dev'
            },
            {
                type: 'PROJECT',
                refId: 'atlas'
            }
        ], scope)).toEqual([]);
    });
    (0, _vitest.it)('rejects other teams and non-team rules (NOTICE_AUDIENCE_OUT_OF_SCOPE)', ()=>{
        const bad = (0, _noticesrules.outOfScope)([
            {
                type: 'DEPARTMENT',
                refId: 'qa'
            },
            {
                type: 'PROJECT',
                refId: 'atlas'
            },
            {
                type: 'ALL'
            },
            {
                type: 'EMPLOYEE',
                refId: 'e1'
            }
        ], scope);
        (0, _vitest.expect)(bad.map((r)=>r.type)).toEqual([
            'DEPARTMENT',
            'ALL',
            'EMPLOYEE'
        ]);
    });
    (0, _vitest.it)('identifies an audience independent of order and drops duplicates', ()=>{
        (0, _vitest.expect)((0, _noticesrules.audienceKey)([
            {
                type: 'PROJECT',
                refId: 'atlas'
            },
            {
                type: 'DEPARTMENT',
                refId: 'dev'
            }
        ])).toBe((0, _noticesrules.audienceKey)([
            {
                type: 'DEPARTMENT',
                refId: 'dev'
            },
            {
                type: 'PROJECT',
                refId: 'atlas'
            }
        ]));
        (0, _vitest.expect)((0, _noticesrules.audienceKey)([
            {
                type: 'DEPARTMENT',
                refId: 'dev'
            }
        ])).not.toBe((0, _noticesrules.audienceKey)([
            {
                type: 'DEPARTMENT',
                refId: 'qa'
            }
        ]));
        (0, _vitest.expect)((0, _noticesrules.dedupeRules)([
            {
                type: 'DEPARTMENT',
                refId: 'dev'
            },
            {
                type: 'DEPARTMENT',
                refId: 'dev'
            },
            {
                type: 'PROJECT',
                refId: 'dev'
            }
        ])).toHaveLength(2);
    });
});
(0, _vitest.describe)('who can open a notice', ()=>{
    const live = (visibility, status = 'PUBLISHED')=>({
            status,
            visibility,
            authorEmployeeId: 'arjun',
            deletedAt: null
        });
    const qa = {
        employeeId: 'karan',
        isRecipient: false,
        moderator: false
    };
    const dev = {
        employeeId: 'priya',
        isRecipient: true,
        moderator: false
    };
    const hr = {
        employeeId: 'kavya',
        isRecipient: false,
        moderator: true
    };
    const author = {
        employeeId: 'arjun',
        isRecipient: false,
        moderator: false
    };
    (0, _vitest.it)('Global notices are open to everyone once live', ()=>{
        (0, _vitest.expect)((0, _noticesrules.canViewNotice)(live('GLOBAL'), qa)).toBe(true);
        (0, _vitest.expect)((0, _noticesrules.canViewNotice)(live('GLOBAL', 'EXPIRED'), qa)).toBe(true);
    });
    (0, _vitest.it)('Team notices reach recipients, the author and moderators only (acceptance §2.9-2)', ()=>{
        (0, _vitest.expect)((0, _noticesrules.canViewNotice)(live('TEAM'), dev)).toBe(true);
        (0, _vitest.expect)((0, _noticesrules.canViewNotice)(live('TEAM'), qa)).toBe(false);
        (0, _vitest.expect)((0, _noticesrules.canViewNotice)(live('TEAM'), hr)).toBe(true);
        (0, _vitest.expect)((0, _noticesrules.canViewNotice)(live('TEAM'), author)).toBe(true);
    });
    (0, _vitest.it)('drafts, scheduled and archived notices are private to author and moderators; deleted to nobody', ()=>{
        for (const s of [
            'DRAFT',
            'SCHEDULED',
            'ARCHIVED'
        ]){
            (0, _vitest.expect)((0, _noticesrules.canViewNotice)(live('GLOBAL', s), dev)).toBe(false);
            (0, _vitest.expect)((0, _noticesrules.canViewNotice)(live('GLOBAL', s), author)).toBe(true);
            (0, _vitest.expect)((0, _noticesrules.canViewNotice)(live('GLOBAL', s), hr)).toBe(true);
        }
        (0, _vitest.expect)((0, _noticesrules.canViewNotice)({
            ...live('GLOBAL'),
            deletedAt: now
        }, hr)).toBe(false);
    });
});
(0, _vitest.describe)('dashboard announcement line', ()=>{
    (0, _vitest.it)('prefixes team notices with their audience (wireframe copy)', ()=>{
        (0, _vitest.expect)((0, _noticesrules.announcementBody)('TEAM', 'Development · Atlas', 'Merges close Wednesday EOD.')).toBe('Visible to Development · Atlas. Merges close Wednesday EOD.');
        (0, _vitest.expect)((0, _noticesrules.announcementBody)('GLOBAL', 'Everyone', 'New per-km rates apply from 1 October.')).toBe('New per-km rates apply from 1 October.');
    });
    (0, _vitest.it)('truncates to 160 characters with an ellipsis', ()=>{
        const long = 'x'.repeat(400);
        const out = (0, _noticesrules.announcementBody)('GLOBAL', 'Everyone', long);
        (0, _vitest.expect)(out).toHaveLength(160);
        (0, _vitest.expect)(out.endsWith('…')).toBe(true);
    });
});
(0, _vitest.describe)('read receipts', ()=>{
    (0, _vitest.it)('shows "read / recipients" to the author and moderators, my own state to everyone else', ()=>{
        const base = {
            readCount: 112,
            recipientCount: 128,
            status: 'PUBLISHED'
        };
        (0, _vitest.expect)((0, _shared.noticeReadLabel)({
            ...base,
            canManage: true,
            myRead: null
        })).toEqual({
            text: '112 / 128',
            tone: 'plain'
        });
        (0, _vitest.expect)((0, _shared.noticeReadLabel)({
            ...base,
            canManage: false,
            myRead: true
        })).toEqual({
            text: 'Read',
            tone: 'accent'
        });
        (0, _vitest.expect)((0, _shared.noticeReadLabel)({
            ...base,
            canManage: false,
            myRead: false
        })).toEqual({
            text: 'New',
            tone: 'outline'
        });
        (0, _vitest.expect)((0, _shared.noticeReadLabel)({
            ...base,
            status: 'DRAFT',
            canManage: true,
            myRead: null
        }).text).toBe('—');
    });
    (0, _vitest.it)('throttles "Remind unread" to once per 24 hours', ()=>{
        (0, _vitest.expect)((0, _noticesrules.canRemind)(null, now)).toBe(true);
        (0, _vitest.expect)((0, _noticesrules.canRemind)(new Date(now.getTime() - _noticesrules.REMIND_THROTTLE_MS + 60_000), now)).toBe(false);
        (0, _vitest.expect)((0, _noticesrules.canRemind)(new Date(now.getTime() - _noticesrules.REMIND_THROTTLE_MS), now)).toBe(true);
    });
});
(0, _vitest.describe)('publish form validation (FORMS.notice)', ()=>{
    const ok = {
        title: 'Atlas CRM release freeze',
        visibility: 'TEAM',
        audiences: [
            {
                type: 'DEPARTMENT',
                refId: 'dev'
            }
        ],
        bodyHtml: '<p>Merges close Wednesday EOD.</p>'
    };
    (0, _vitest.it)('accepts a team notice with an audience', ()=>{
        (0, _vitest.expect)(_shared.noticeUpsertSchema.safeParse(ok).success).toBe(true);
    });
    (0, _vitest.it)('rejects short titles and team notices without a team', ()=>{
        (0, _vitest.expect)(_shared.noticeUpsertSchema.safeParse({
            ...ok,
            title: 'Hi'
        }).success).toBe(false);
        (0, _vitest.expect)(_shared.noticeUpsertSchema.safeParse({
            ...ok,
            audiences: []
        }).success).toBe(false);
    });
    (0, _vitest.it)('rejects a Global notice that names an audience', ()=>{
        (0, _vitest.expect)(_shared.noticeUpsertSchema.safeParse({
            ...ok,
            visibility: 'GLOBAL'
        }).success).toBe(false);
        (0, _vitest.expect)(_shared.noticeUpsertSchema.safeParse({
            ...ok,
            visibility: 'GLOBAL',
            audiences: []
        }).success).toBe(true);
    });
});

//# sourceMappingURL=notices.spec.js.map