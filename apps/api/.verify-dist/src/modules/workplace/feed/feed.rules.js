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
    get ALERT_BATCH_MS () {
        return ALERT_BATCH_MS;
    },
    get FEED_PAGE () {
        return FEED_PAGE;
    },
    get MAX_PINNED () {
        return MAX_PINNED;
    },
    get canEditPost () {
        return canEditPost;
    },
    get feedOrder () {
        return feedOrder;
    },
    get postMeta () {
        return postMeta;
    },
    get resolveMentions () {
        return resolveMentions;
    },
    get threadParent () {
        return threadParent;
    }
});
const _shared = require("@lexisora/shared");
const _dates = require("../common/dates");
const MAX_PINNED = 3;
const FEED_PAGE = 10;
const ALERT_BATCH_MS = 15 * 60_000;
function resolveMentions(body, people) {
    const out = new Set();
    for (const token of (0, _shared.mentionTokens)(body)){
        const t = token.toLowerCase();
        const full = people.filter((p)=>p.fullName.toLowerCase() === t);
        if (full.length === 1) {
            out.add(full[0].id);
            continue;
        }
        const first = t.split(' ')[0];
        const byFirst = people.filter((p)=>p.firstName.toLowerCase() === first);
        if (byFirst.length === 1) out.add(byFirst[0].id);
    }
    return [
        ...out
    ];
}
function postMeta(designation, publishedAt, exited) {
    const who = exited ? 'Former employee' : (0, _shared.designationShort)(designation);
    return publishedAt ? `${who} · ${(0, _dates.dayMonth)(publishedAt)}` : `${who} · Draft`;
}
function canEditPost(p, me, publisher) {
    if (p.kind === 'EOTM' || p.kind === 'KUDOS') return false;
    if (p.status === 'DRAFT') return !!me && p.authorEmployeeId === me && publisher;
    if (p.status === 'PUBLISHED') return publisher;
    return false;
}
function threadParent(parent) {
    if (!parent) return null;
    return parent.parentId ?? parent.id;
}
function feedOrder(rows) {
    return [
        ...rows
    ].sort((a, b)=>Number(b.pinned) - Number(a.pinned) || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
}

//# sourceMappingURL=feed.rules.js.map