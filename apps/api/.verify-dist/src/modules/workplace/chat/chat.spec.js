"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _chatrules = require("./chat.rules");
const members = [
    {
        userId: 'u-neha',
        name: 'Neha Kapoor'
    },
    {
        userId: 'u-priya',
        name: 'Priya Sharma'
    },
    {
        userId: 'u-kavya',
        name: 'Kavya Iyer'
    },
    {
        userId: 'u-meera',
        name: 'Meera Iyer'
    },
    {
        userId: 'u-rahul',
        name: 'Rahul Desai'
    }
];
(0, _vitest.describe)('comms hub rules', ()=>{
    (0, _vitest.it)('DM keys are order-independent and de-duplicated', ()=>{
        (0, _vitest.expect)((0, _chatrules.dmKeyFor)([
            'b',
            'a'
        ])).toBe('a:b');
        (0, _vitest.expect)((0, _chatrules.dmKeyFor)([
            'a',
            'b',
            'a'
        ])).toBe((0, _chatrules.dmKeyFor)([
            'b',
            'a'
        ]));
        (0, _vitest.expect)((0, _chatrules.dmKeyFor)([
            'me'
        ])).toBe('me');
    });
    (0, _vitest.it)('labels channels and DMs', ()=>{
        (0, _vitest.expect)((0, _chatrules.channelLabel)('PUBLIC', 'general')).toBe('# general');
        (0, _vitest.expect)((0, _chatrules.channelLabel)('DM', null, [
            'Neha Kapoor'
        ])).toBe('Neha Kapoor');
        (0, _vitest.expect)((0, _chatrules.channelLabel)('GROUP_DM', null, [
            'Neha Kapoor',
            'Rahul Desai'
        ])).toBe('Neha Kapoor, Rahul Desai');
        (0, _vitest.expect)((0, _chatrules.channelLabel)('DM', null, [])).toBe('Notes to self');
    });
    (0, _vitest.it)('slugs project and department names', ()=>{
        (0, _vitest.expect)((0, _chatrules.channelSlug)('Atlas CRM')).toBe('atlas-crm');
        (0, _vitest.expect)((0, _chatrules.channelSlug)('QA', 'team')).toBe('qa-team');
    });
    (0, _vitest.it)('resolves full-name and unambiguous first-name mentions', ()=>{
        (0, _vitest.expect)((0, _chatrules.resolveMentions)('@Priya Sharma can you pair with Rahul?', members)).toEqual([
            'u-priya'
        ]);
        (0, _vitest.expect)((0, _chatrules.resolveMentions)('thanks @Neha and @rahul', members).sort()).toEqual([
            'u-neha',
            'u-rahul'
        ]);
        (0, _vitest.expect)((0, _chatrules.resolveMentions)('ping @priya.sharma', members)).toEqual([
            'u-priya'
        ]);
    });
    (0, _vitest.it)('ignores ambiguous or unknown mentions', ()=>{
        (0, _vitest.expect)((0, _chatrules.resolveMentions)('hello @Iyer', members)).toEqual([]);
        (0, _vitest.expect)((0, _chatrules.resolveMentions)('hi @Vikram', members)).toEqual([]);
    });
    (0, _vitest.it)('unread badges cap at 99+', ()=>{
        (0, _vitest.expect)((0, _chatrules.unreadBadge)(0)).toBe('');
        (0, _vitest.expect)((0, _chatrules.unreadBadge)(3)).toBe('3');
        (0, _vitest.expect)((0, _chatrules.unreadBadge)(99)).toBe('99');
        (0, _vitest.expect)((0, _chatrules.unreadBadge)(140)).toBe('99+');
    });
    (0, _vitest.it)('messages are editable for 15 minutes', ()=>{
        const sent = new Date('2026-09-29T04:32:00Z');
        (0, _vitest.expect)((0, _chatrules.canEditMessage)(sent, new Date(sent.getTime() + 14 * 60_000))).toBe(true);
        (0, _vitest.expect)((0, _chatrules.canEditMessage)(sent, new Date(sent.getTime() + 16 * 60_000))).toBe(false);
    });
    (0, _vitest.it)('call summaries read like the spec', ()=>{
        const start = new Date('2026-09-28T06:00:00Z');
        (0, _vitest.expect)((0, _chatrules.callSummaryText)('VIDEO', start, new Date(start.getTime() + 23 * 60_000), 4)).toBe('Call · 23 min · 4 participants');
        (0, _vitest.expect)((0, _chatrules.callSummaryText)('SCREEN', start, new Date(start.getTime() + 20_000), 1)).toBe('Screen share · 1 min · 1 participant');
        (0, _vitest.expect)((0, _chatrules.callSummaryText)('AUDIO', start, new Date(start.getTime() + 5 * 60_000), 2)).toBe('Audio call · 5 min · 2 participants');
    });
    (0, _vitest.it)('#announcements accepts posts from publishers only; archived channels from nobody', ()=>{
        (0, _vitest.expect)((0, _chatrules.canPostIn)('ADMINS_ONLY', false, false)).toBe(false);
        (0, _vitest.expect)((0, _chatrules.canPostIn)('ADMINS_ONLY', true, false)).toBe(true);
        (0, _vitest.expect)((0, _chatrules.canPostIn)('ALL_MEMBERS', false, false)).toBe(true);
        (0, _vitest.expect)((0, _chatrules.canPostIn)('ALL_MEMBERS', true, true)).toBe(false);
    });
    (0, _vitest.it)('normalizes composer text', ()=>{
        (0, _vitest.expect)((0, _chatrules.normalizeBody)('  hi\r\n\n\n\nthere  ')).toBe('hi\n\nthere');
    });
});

//# sourceMappingURL=chat.spec.js.map