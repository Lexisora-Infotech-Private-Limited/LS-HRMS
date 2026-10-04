"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get callSummaryText () {
        return callSummaryText;
    },
    get canEditMessage () {
        return canEditMessage;
    },
    get canPostIn () {
        return canPostIn;
    },
    get channelLabel () {
        return channelLabel;
    },
    get channelSlug () {
        return channelSlug;
    },
    get dmKeyFor () {
        return dmKeyFor;
    },
    get normalizeBody () {
        return normalizeBody;
    },
    get resolveMentions () {
        return resolveMentions;
    },
    get unreadBadge () {
        return unreadBadge;
    }
});
const _shared = require("@lexisora/shared");
function dmKeyFor(userIds) {
    return [
        ...new Set(userIds.filter(Boolean))
    ].sort().join(':');
}
function channelSlug(name, suffix = '') {
    const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    const slug = `${base || 'channel'}${suffix ? `-${suffix}` : ''}`;
    return /^[a-z0-9]/.test(slug) ? slug.slice(0, 60) : `c-${slug}`.slice(0, 60);
}
function channelLabel(kind, name, dmNames = []) {
    if (kind === 'DM' || kind === 'GROUP_DM') return dmNames.length ? dmNames.join(', ') : 'Notes to self';
    return `# ${name ?? 'channel'}`;
}
function resolveMentions(body, members) {
    const out = new Set();
    const norm = (s)=>s.toLowerCase().replace(/[.'-]+/g, ' ').replace(/\s+/g, ' ').trim();
    for (const raw of (0, _shared.mentionTokens)(body)){
        const tok = norm(raw);
        if (!tok) continue;
        const full = members.filter((m)=>norm(m.name) === tok);
        if (full.length) {
            full.forEach((m)=>out.add(m.userId));
            continue;
        }
        // "@Neha Kapoor" can be captured as "Neha Kapoor" or just "Neha" depending on case — try the first word.
        const first = tok.split(' ')[0];
        const byFirst = members.filter((m)=>norm(m.name).split(' ')[0] === first);
        if (byFirst.length === 1) out.add(byFirst[0].userId);
    }
    return [
        ...out
    ];
}
function unreadBadge(n) {
    if (!n || n < 0) return '';
    return n > 99 ? '99+' : String(n);
}
function canEditMessage(createdAt, now = new Date(), windowMin = _shared.CHAT_EDIT_WINDOW_MIN) {
    return now.getTime() - createdAt.getTime() <= windowMin * 60_000;
}
function callSummaryText(kind, startedAt, endedAt, participants) {
    const mins = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
    const what = kind === 'SCREEN' ? 'Screen share' : kind === 'AUDIO' ? 'Audio call' : 'Call';
    return `${what} · ${mins} min · ${participants} participant${participants === 1 ? '' : 's'}`;
}
function canPostIn(policy, isPublisher, archived) {
    if (archived) return false;
    return policy !== 'ADMINS_ONLY' || isPublisher;
}
function normalizeBody(body) {
    return body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

//# sourceMappingURL=chat.rules.js.map