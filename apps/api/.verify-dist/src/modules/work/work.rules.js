/**
 * Pure business rules for the work domain (unit-tested in work.rules.spec.ts):
 * progress, project health, task transitions + git side effects, board access, intern aggregates.
 */ "use strict";
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
    get COLUMN_ORDER () {
        return COLUMN_ORDER;
    },
    get DAY_MS () {
        return DAY_MS;
    },
    get DEFAULT_HEALTH () {
        return DEFAULT_HEALTH;
    },
    get PROGRESS_WEIGHTS () {
        return PROGRESS_WEIGHTS;
    },
    get STATUS_LABEL () {
        return STATUS_LABEL;
    },
    get addDays () {
        return addDays;
    },
    get boardAccess () {
        return boardAccess;
    },
    get branchName () {
        return branchName;
    },
    get canMoveTask () {
        return canMoveTask;
    },
    get computeHealth () {
        return computeHealth;
    },
    get computeProgress () {
        return computeProgress;
    },
    get internDayStatus () {
        return internDayStatus;
    },
    get meanScore () {
        return meanScore;
    },
    get moveMessage () {
        return moveMessage;
    },
    get mrTitle () {
        return mrTitle;
    },
    get nextWorkingDay () {
        return nextWorkingDay;
    },
    get planTransition () {
        return planTransition;
    },
    get projectStatusLabel () {
        return projectStatusLabel;
    },
    get shortName () {
        return shortName;
    },
    get suggestKey () {
        return suggestKey;
    },
    get taskKeysIn () {
        return taskKeysIn;
    },
    get weekStartOf () {
        return weekStartOf;
    }
});
const COLUMN_ORDER = [
    'OPEN',
    'ALLOTTED',
    'WIP',
    'DEV_COMPLETED',
    'QA',
    'DONE'
];
const STATUS_LABEL = {
    OPEN: 'Open',
    ALLOTTED: 'Alloted',
    WIP: 'WIP',
    DEV_COMPLETED: 'Dev Completed',
    QA: 'QA',
    DONE: 'Done',
    CANCELLED: 'Cancelled'
};
const PROGRESS_WEIGHTS = {
    OPEN: 0,
    ALLOTTED: 0,
    WIP: 0.25,
    DEV_COMPLETED: 0.7,
    QA: 0.9,
    DONE: 1,
    CANCELLED: 0
};
const DAY_MS = 86_400_000;
function computeProgress(tasks, budgetMinutes = 0) {
    const live = tasks.filter((t)=>t.status !== 'CANCELLED' && !t.isStanding);
    if (!live.length) return 0;
    const sumEst = live.reduce((s, t)=>s + (t.estimatedMinutes ?? 0), 0);
    if (sumEst <= 0) {
        const w = live.reduce((s, t)=>s + PROGRESS_WEIGHTS[t.status], 0);
        return Math.round(w / live.length * 100);
    }
    const earned = live.reduce((s, t)=>s + (t.estimatedMinutes ?? 0) * PROGRESS_WEIGHTS[t.status], 0);
    const denom = Math.max(sumEst, budgetMinutes || 0);
    return Math.min(100, Math.round(earned / denom * 100 + 1e-9));
}
const DEFAULT_HEALTH = {
    burnGap: 0.15,
    nearDays: 14,
    nearProgressPct: 80,
    elapsedGap: 0.15
};
function computeHealth(p, today, opts = DEFAULT_HEALTH) {
    if (p.status !== 'ACTIVE') return {
        health: 'NA',
        reason: null
    };
    const progress = p.progressPct / 100;
    const burn = p.estimatedMinutes > 0 ? p.loggedMinutes / p.estimatedMinutes : null;
    const daysLeft = p.deadline ? Math.round((p.deadline.getTime() - today.getTime()) / DAY_MS) : null;
    const pct = (x)=>`${Math.round(x * 100)}%`;
    if (daysLeft !== null && daysLeft < 0 && p.progressPct < 100) {
        return {
            health: 'OFF_TRACK',
            reason: `Deadline passed ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago at ${p.progressPct}% progress`
        };
    }
    if (burn !== null && burn > 1 && progress < 0.9) {
        return {
            health: 'OFF_TRACK',
            reason: `Logged ${pct(burn)} of estimate vs ${p.progressPct}% progress`
        };
    }
    if (burn !== null && burn - progress > opts.burnGap + 1e-9) {
        return {
            health: 'AT_RISK',
            reason: `Logged ${pct(burn)} of estimate vs ${p.progressPct}% progress`
        };
    }
    if (daysLeft !== null && daysLeft <= opts.nearDays && p.progressPct < opts.nearProgressPct) {
        return {
            health: 'AT_RISK',
            reason: `Deadline in ${daysLeft} day${daysLeft === 1 ? '' : 's'} with ${p.progressPct}% progress`
        };
    }
    if (p.startDate && p.deadline && daysLeft !== null && daysLeft <= 30) {
        const span = p.deadline.getTime() - p.startDate.getTime();
        if (span > 0) {
            const elapsed = Math.min(1, Math.max(0, (today.getTime() - p.startDate.getTime()) / span));
            if (elapsed - progress > opts.elapsedGap + 1e-9) {
                return {
                    health: 'AT_RISK',
                    reason: `${pct(elapsed)} of the schedule elapsed vs ${p.progressPct}% progress`
                };
            }
        }
    }
    return {
        health: 'ON_TRACK',
        reason: null
    };
}
function projectStatusLabel(status, health) {
    if (status === 'ACTIVE') {
        if (health === 'AT_RISK') return 'At risk';
        if (health === 'OFF_TRACK') return 'Off track';
        return 'On track';
    }
    return ({
        PLANNING: 'Planning',
        ON_HOLD: 'On hold',
        COMPLETED: 'Completed',
        ARCHIVED: 'Archived',
        CANCELLED: 'Cancelled',
        ACTIVE: 'Active'
    })[status];
}
function branchName(key, pattern = 'feature/{key}') {
    const raw = pattern.replace(/\{key\}/g, key.toLowerCase()).replace(/\{KEY\}/g, key.toLowerCase());
    return raw.toLowerCase().replace(/[^a-z0-9._/-]+/g, '-').replace(/\/{2,}/g, '/').replace(/^[-/]+|[-/]+$/g, '').slice(0, 100);
}
function mrTitle(key, title, pattern = '{KEY}: {title}') {
    return pattern.replace(/\{KEY\}/g, key).replace(/\{key\}/g, key.toLowerCase()).replace(/\{title\}/g, title).slice(0, 255);
}
function taskKeysIn(text) {
    const out = new Set();
    for (const m of text.matchAll(/\b([A-Za-z]{2,6})-(\d{1,6})\b/g))out.add(`${m[1].toUpperCase()}-${m[2]}`);
    return [
        ...out
    ];
}
function planTransition(input) {
    const { from, to, now } = input;
    const set = {};
    if (to === 'WIP' && !input.startedAt) set.startedAt = now;
    if (to === 'DEV_COMPLETED') set.devCompletedAt = now;
    if (to === 'QA') set.qaAt = now;
    if (to === 'DONE') set.doneAt = now;
    if (from === 'DONE' && to !== 'DONE') set.doneAt = null;
    if (to === 'OPEN') set.assigneeEmployeeId = null;
    else if (!input.assigneeEmployeeId && input.moverEmployeeId) set.assigneeEmployeeId = input.moverEmployeeId;
    let git = 'none';
    if (input.hasRepo && from !== to) {
        if (to === 'WIP' && from !== 'DEV_COMPLETED' && from !== 'QA' && from !== 'DONE') git = 'branch';
        else if (to === 'DEV_COMPLETED') git = 'mr';
    }
    const backward = COLUMN_ORDER.indexOf(to) < COLUMN_ORDER.indexOf(from);
    return {
        git,
        set,
        backward
    };
}
function moveMessage(key, to, git) {
    if (to === 'DONE') return `${key} closed`;
    if (git.action === 'mr') {
        if (git.status === 'SYNCED') return `${key} → Dev Completed · pushed to GitLab (${git.branch})`;
        if (git.status === 'FAILED') return `${key} → Dev Completed · GitLab sync failed, retry from the card`;
    }
    if (git.action === 'branch' && git.status === 'SYNCED') return `${key} → WIP · branch ${git.branch} created from ${git.targetBranch ?? 'develop'}`;
    return `${key} → ${STATUS_LABEL[to]}`;
}
function boardAccess(a) {
    const canView = a.viewAll || a.isDeptLead || a.isAllocated;
    return {
        canView,
        canManage: a.viewAll || a.isDeptLead || a.isProjectLead && canView,
        canAllocate: a.viewAll || a.isDeptLead
    };
}
function canMoveTask(input) {
    if (!input.canView) return false;
    if (input.canManage) return true;
    if (!input.me) return false;
    return input.assigneeEmployeeId === null || input.assigneeEmployeeId === input.me;
}
function shortName(full) {
    if (!full) return '—';
    const [first, ...rest] = full.trim().split(/\s+/);
    const last = rest.pop();
    return last ? `${first} ${last[0].toUpperCase()}.` : first;
}
function suggestKey(name, taken = new Set()) {
    const letters = name.toUpperCase().replace(/[^A-Z ]/g, '');
    const words = letters.split(/\s+/).filter(Boolean);
    const candidates = [];
    const first = words[0] ?? 'PR';
    candidates.push(first.slice(0, 2));
    if (words.length > 1) candidates.push(words.map((w)=>w[0]).join('').slice(0, 4));
    candidates.push(first.slice(0, 3), first.slice(0, 4));
    for (const c of candidates)if (c.length >= 2 && !taken.has(c)) return c;
    for(let i = 0; i < 26; i++){
        const c = first.slice(0, 2) + String.fromCharCode(65 + i);
        if (!taken.has(c)) return c;
    }
    return 'PRJ';
}
function internDayStatus(statuses, opts) {
    if (!statuses.length) return {
        key: 'NOT_ASSIGNED',
        label: 'Not assigned'
    };
    if (statuses.every((s)=>s === 'DONE')) return {
        key: 'DONE',
        label: 'Done'
    };
    if (statuses.some((s)=>s === 'NOT_DONE')) return {
        key: 'NOT_DONE',
        label: 'Not done'
    };
    if ((opts.isPastDay || opts.afterCutoff) && statuses.some((s)=>s !== 'DONE')) return {
        key: 'NOT_DONE',
        label: 'Not done'
    };
    if (statuses.some((s)=>s === 'IN_PROGRESS' || s === 'DONE')) return {
        key: 'IN_PROGRESS',
        label: 'In progress'
    };
    return {
        key: 'ASSIGNED',
        label: 'Not started'
    };
}
function meanScore(scores) {
    const s = scores.filter((x)=>typeof x === 'number');
    if (!s.length) return null;
    return Math.round(s.reduce((a, b)=>a + b, 0) / s.length * 10) / 10;
}
function weekStartOf(dateKey) {
    const d = new Date(`${dateKey}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0
    return new Date(d.getTime() - dow * DAY_MS).toISOString().slice(0, 10);
}
function addDays(dateKey, n) {
    return new Date(new Date(`${dateKey}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}
function nextWorkingDay(dateKey) {
    let d = addDays(dateKey, 1);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) d = addDays(d, 1);
    return d;
}

//# sourceMappingURL=work.rules.js.map