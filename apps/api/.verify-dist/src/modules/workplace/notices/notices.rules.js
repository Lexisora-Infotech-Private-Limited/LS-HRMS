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
    get REMIND_THROTTLE_MS () {
        return REMIND_THROTTLE_MS;
    },
    get announcementBody () {
        return announcementBody;
    },
    get audienceKey () {
        return audienceKey;
    },
    get canRemind () {
        return canRemind;
    },
    get canTransition () {
        return canTransition;
    },
    get canViewNotice () {
        return canViewNotice;
    },
    get datesError () {
        return datesError;
    },
    get dedupeRules () {
        return dedupeRules;
    },
    get outOfScope () {
        return outOfScope;
    },
    get publishTarget () {
        return publishTarget;
    }
});
const TRANSITIONS = {
    DRAFT: [
        'SCHEDULED',
        'PUBLISHED'
    ],
    SCHEDULED: [
        'DRAFT',
        'PUBLISHED'
    ],
    PUBLISHED: [
        'EXPIRED',
        'ARCHIVED'
    ],
    EXPIRED: [
        'ARCHIVED'
    ],
    ARCHIVED: []
};
function canTransition(from, to) {
    return TRANSITIONS[from].includes(to);
}
function publishTarget(publishAt, now) {
    return publishAt && publishAt.getTime() > now.getTime() + 60_000 ? 'SCHEDULED' : 'PUBLISHED';
}
function datesError(publishAt, expiresAt, now) {
    if (publishAt && Number.isNaN(publishAt.getTime())) return 'Publish at is not a valid date';
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return 'Expires on is not a valid date';
    const start = publishAt && publishAt > now ? publishAt : now;
    if (expiresAt && expiresAt <= start) return 'Expiry must be after the publish time';
    return null;
}
function outOfScope(rules, scope) {
    return rules.filter((r)=>!(r.type === 'DEPARTMENT' && !!r.refId && scope.departmentIds.includes(r.refId)) && !(r.type === 'PROJECT' && !!r.refId && scope.projectIds.includes(r.refId)));
}
function audienceKey(rules) {
    return rules.map((r)=>`${r.type}:${r.refId ?? ''}`).sort().join('|');
}
function dedupeRules(rules) {
    const seen = new Set();
    return rules.filter((r)=>{
        const k = `${r.type}:${r.refId ?? ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}
function canViewNotice(n, v) {
    if (n.deletedAt) return false;
    const own = !!v.employeeId && v.employeeId === n.authorEmployeeId;
    if (own || v.moderator) return true;
    if (n.status !== 'PUBLISHED' && n.status !== 'EXPIRED') return false;
    return n.visibility === 'GLOBAL' || v.isRecipient;
}
function announcementBody(visibility, audienceLabel, excerpt, max = 160) {
    const text = visibility === 'TEAM' ? `Visible to ${audienceLabel}. ${excerpt}`.trim() : excerpt;
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
const REMIND_THROTTLE_MS = 24 * 3_600_000;
function canRemind(lastRemindedAt, now) {
    return !lastRemindedAt || now.getTime() - lastRemindedAt.getTime() >= REMIND_THROTTLE_MS;
}

//# sourceMappingURL=notices.rules.js.map