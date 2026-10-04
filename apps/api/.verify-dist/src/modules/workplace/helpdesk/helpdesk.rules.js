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
    get AUTO_CLOSE_DAYS_DEFAULT () {
        return AUTO_CLOSE_DAYS_DEFAULT;
    },
    get OPEN_STATES () {
        return OPEN_STATES;
    },
    get REOPEN_WINDOW_DAYS () {
        return REOPEN_WINDOW_DAYS;
    },
    get canReopen () {
        return canReopen;
    },
    get canTransition () {
        return canTransition;
    },
    get dueDatesFor () {
        return dueDatesFor;
    },
    get elapsedBusinessMinutes () {
        return elapsedBusinessMinutes;
    },
    get escalationTargets () {
        return escalationTargets;
    },
    get evaluateSla () {
        return evaluateSla;
    },
    get isOpenStatus () {
        return isOpenStatus;
    },
    get pickAssignee () {
        return pickAssignee;
    },
    get resolvedSlaState () {
        return resolvedSlaState;
    },
    get resumeClock () {
        return resumeClock;
    },
    get slaLabel () {
        return slaLabel;
    }
});
const _shared = require("@lexisora/shared");
const _businesshours = require("./business-hours");
const OPEN_STATES = [
    'OPEN',
    'IN_PROGRESS',
    'WAITING'
];
const isOpenStatus = (s)=>OPEN_STATES.includes(s);
function dueDatesFor(createdAt, policy, cal = _businesshours.DEFAULT_CALENDAR) {
    return {
        firstResponseDueAt: (0, _businesshours.addBusinessMinutes)(createdAt, policy.firstResponseMins, cal),
        resolutionDueAt: (0, _businesshours.addBusinessMinutes)(createdAt, policy.resolutionMins, cal)
    };
}
function canTransition(from, to, actor) {
    if (from === to) return false;
    if (actor === 'agent') {
        if (to === 'IN_PROGRESS') return from === 'OPEN' || from === 'WAITING';
        if (to === 'WAITING') return from === 'OPEN' || from === 'IN_PROGRESS';
        if (to === 'OPEN') return from === 'IN_PROGRESS' || from === 'WAITING';
        if (to === 'RESOLVED') return isOpenStatus(from);
        if (to === 'CLOSED') return from === 'RESOLVED';
        return false;
    }
    // requester
    if (to === 'CANCELLED') return from === 'OPEN';
    if (to === 'IN_PROGRESS') return from === 'RESOLVED' || from === 'WAITING'; // reopen / reply while waiting
    if (to === 'CLOSED') return from === 'RESOLVED';
    return false;
}
const REOPEN_WINDOW_DAYS = 7;
function canReopen(resolvedAt, now, status) {
    return status === 'RESOLVED' && !!resolvedAt && now.getTime() - resolvedAt.getTime() <= REOPEN_WINDOW_DAYS * 86_400_000;
}
function elapsedBusinessMinutes(t, now, cal = _businesshours.DEFAULT_CALENDAR) {
    const end = t.status === 'RESOLVED' || t.status === 'CLOSED' ? t.resolvedAt ?? now : now;
    const gross = (0, _businesshours.businessMinutesBetween)(t.createdAt, end, cal);
    const current = t.pausedSince ? (0, _businesshours.businessMinutesBetween)(t.pausedSince, end, cal) : 0;
    return Math.max(0, gross - t.pausedMins - current);
}
function evaluateSla(t, policy, now, cal = _businesshours.DEFAULT_CALENDAR) {
    const elapsedMins = elapsedBusinessMinutes(t, now, cal);
    const pct = policy.resolutionMins > 0 ? elapsedMins / policy.resolutionMins : 0;
    const firstResponseBreached = !t.firstRespondedAt && !t.pausedSince && now.getTime() > t.firstResponseDueAt.getTime();
    const level = pct >= 1.5 ? 2 : pct >= 1 || firstResponseBreached ? 1 : 0;
    const state = level > 0 ? 'BREACHED' : pct >= 0.8 ? 'AT_RISK' : 'ON_TRACK';
    return {
        state,
        pct,
        elapsedMins,
        firstResponseBreached,
        level
    };
}
function resolvedSlaState(t, resolvedAt) {
    const frOk = (t.firstRespondedAt ?? resolvedAt).getTime() <= t.firstResponseDueAt.getTime();
    return frOk && resolvedAt.getTime() <= t.resolutionDueAt.getTime() ? 'MET' : 'BREACHED';
}
function resumeClock(t, now, cal = _businesshours.DEFAULT_CALENDAR, since = t.pausedSince) {
    if (!since) return {
        pausedMins: t.pausedMins,
        firstResponseDueAt: t.firstResponseDueAt,
        resolutionDueAt: t.resolutionDueAt,
        added: 0
    };
    const added = (0, _businesshours.businessMinutesBetween)(since, now, cal);
    return {
        added,
        pausedMins: t.pausedMins + added,
        firstResponseDueAt: t.firstRespondedAt ? t.firstResponseDueAt : shiftBusiness(t.firstResponseDueAt, added, cal),
        resolutionDueAt: shiftBusiness(t.resolutionDueAt, added, cal)
    };
}
function shiftBusiness(due, mins, cal) {
    return mins > 0 ? (0, _businesshours.addBusinessMinutes)(due, mins, cal) : due;
}
function slaLabel(t, policy, now, cal = _businesshours.DEFAULT_CALENDAR) {
    if (t.status === 'CANCELLED') return {
        state: t.slaState,
        label: '—'
    };
    if (t.status === 'RESOLVED' || t.status === 'CLOSED') return {
        state: t.slaState,
        label: t.slaState === 'MET' ? 'Met' : 'Breached'
    };
    if (t.pausedSince) return {
        state: t.slaState,
        label: 'Paused'
    };
    const ev = evaluateSla(t, policy, now, cal);
    const left = policy.resolutionMins - ev.elapsedMins;
    if (left < 0) return {
        state: 'BREACHED',
        label: `Breached ${(0, _shared.formatBizMinutes)(-left)}`
    };
    if (ev.firstResponseBreached) return {
        state: 'BREACHED',
        label: 'Response overdue'
    };
    return {
        state: ev.state,
        label: `Due in ${(0, _shared.formatBizMinutes)(left)}`
    };
}
function escalationTargets(input) {
    if (input.level <= 0) return [];
    const out = new Set();
    if (input.groupLeadId) out.add(input.groupLeadId);
    const rm = input.hasAssignee ? input.assigneeManagerId : input.requesterManagerId;
    if (rm) out.add(rm);
    if (input.level >= 2) {
        for (const id of input.deskHolderIds)out.add(id);
        if (input.isItCategory) for (const id of input.adminIds)out.add(id);
    }
    out.delete(input.requesterId);
    return [
        ...out
    ];
}
function pickAssignee(members, openCounts) {
    let best = null;
    let bestCount = Infinity;
    for (const m of members){
        const c = openCounts.get(m) ?? 0;
        if (c < bestCount) {
            best = m;
            bestCount = c;
        }
    }
    return best;
}
const AUTO_CLOSE_DAYS_DEFAULT = 7;

//# sourceMappingURL=helpdesk.rules.js.map