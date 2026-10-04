/**
 * Pure business rules for tracker ingest (no Nest / Prisma). Unit-tested in tracker.rules.spec.ts.
 * Shared device/server formulas (summaries, validation, idle mapping) live in
 * packages/shared/src/tracker.ts and are re-exported here for the services.
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
    get MAX_ACTIVE_DEVICES () {
        return MAX_ACTIVE_DEVICES;
    },
    get PAIR_CODE_TTL_MIN () {
        return PAIR_CODE_TTL_MIN;
    },
    get PAIR_MAX_WRONG () {
        return PAIR_MAX_WRONG;
    },
    get PAIR_SESSION_TTL_MIN () {
        return PAIR_SESSION_TTL_MIN;
    },
    get PAIR_WINDOW_MIN () {
        return PAIR_WINDOW_MIN;
    },
    get SKEW_CORRECT_THRESHOLD_SEC () {
        return _shared.SKEW_CORRECT_THRESHOLD_SEC;
    },
    get addDays () {
        return addDays;
    },
    get buildTimeline () {
        return buildTimeline;
    },
    get compareVersions () {
        return compareVersions;
    },
    get correctedInstant () {
        return correctedInstant;
    },
    get dateKeyOf () {
        return dateKeyOf;
    },
    get dbDate () {
        return dbDate;
    },
    get displayKind () {
        return displayKind;
    },
    get estimateSkewSeconds () {
        return _shared.estimateSkewSeconds;
    },
    get findTrackingGaps () {
        return findTrackingGaps;
    },
    get hhmm () {
        return hhmm;
    },
    get isRateLimited () {
        return isRateLimited;
    },
    get isSkewFlagged () {
        return isSkewFlagged;
    },
    get matchIdleResolution () {
        return matchIdleResolution;
    },
    get missingScreenshots () {
        return missingScreenshots;
    },
    get partitionByClientId () {
        return partitionByClientId;
    },
    get pickClaimReviewer () {
        return pickClaimReviewer;
    },
    get resolveSegmentKind () {
        return _shared.resolveSegmentKind;
    },
    get summarizeSegments () {
        return _shared.summarizeSegments;
    },
    get validateSegments () {
        return _shared.validateSegments;
    },
    get weekStartOf () {
        return weekStartOf;
    }
});
const _shared = require("@lexisora/shared");
function partitionByClientId(items, existing) {
    const seen = new Set(existing);
    const fresh = [];
    let duplicates = 0;
    for (const it of items){
        if (seen.has(it.clientId)) duplicates++;
        else {
            seen.add(it.clientId);
            fresh.push(it);
        }
    }
    return {
        fresh,
        duplicates
    };
}
function correctedInstant(iso, skewSec, threshold = _shared.SKEW_CORRECT_THRESHOLD_SEC) {
    const t = Date.parse(iso);
    return new Date(Math.abs(skewSec) > threshold ? t - skewSec * 1000 : t);
}
function isSkewFlagged(skewSec, threshold = _shared.SKEW_CORRECT_THRESHOLD_SEC) {
    return Math.abs(skewSec) > threshold;
}
function matchIdleResolution(seg, events) {
    if (seg.resolution) return seg.resolution;
    const s = Date.parse(seg.startedAt);
    const ev = events.find((e)=>e.type === 'IDLE_RESOLVED' && e.idleFrom && e.resolution && Math.abs(Date.parse(e.idleFrom) - s) <= 2000);
    return ev?.resolution;
}
function pickClaimReviewer(input) {
    const { employeeId, projectLeadId, projectIsInternal, managerId } = input;
    if (projectLeadId && !projectIsInternal && projectLeadId !== employeeId) return projectLeadId;
    if (managerId && managerId !== employeeId) return managerId;
    return null;
}
function displayKind(s) {
    if (s.kind === 'WORK') return 'WORK';
    if (s.kind === 'BREAK') return 'BREAK';
    if (s.idleResolution === 'AS_BREAK') return 'BREAK';
    if (s.kind === 'IDLE_WORK' && s.claimStatus === 'APPROVED') return 'WORK';
    return 'IDLE';
}
function buildTimeline(segments, keyOf) {
    const sorted = [
        ...segments
    ].sort((a, b)=>a.startAt.getTime() - b.startAt.getTime());
    const out = [];
    for (const s of sorted){
        const kind = displayKind(s);
        const taskKey = kind === 'WORK' ? keyOf(s.taskId) : null;
        const last = out[out.length - 1];
        if (last && last.kind === kind && last.taskKey === taskKey && s.startAt.getTime() - last._e <= 60_000) {
            last._e = Math.max(last._e, s.endAt.getTime());
            last.endAt = new Date(last._e).toISOString();
        } else {
            out.push({
                kind,
                taskKey,
                startAt: s.startAt.toISOString(),
                endAt: s.endAt.toISOString(),
                _s: s.startAt.getTime(),
                _e: s.endAt.getTime()
            });
        }
    }
    return out.map(({ _s, _e, ...b })=>b);
}
function findTrackingGaps(segments, sessions, opts) {
    const min = (opts.minGapSec ?? 900) * 1000;
    const segs = [
        ...segments
    ].sort((a, b)=>a.startAt.getTime() - b.startAt.getTime());
    if (!segs.length) return [];
    const gaps = [];
    for (const ses of sessions){
        const sStart = ses.startedAt.getTime();
        // an open session only counts up to the last tracked instant (the device may not have synced yet)
        const lastSeg = segs[segs.length - 1].endAt.getTime();
        const sEnd = ses.endedAt ? ses.endedAt.getTime() : Math.min(opts.now.getTime(), lastSeg);
        const inside = segs.filter((g)=>g.endAt.getTime() > sStart && g.startAt.getTime() < sEnd);
        if (!inside.length) continue; // device not used in this session (e.g. biometric day without tracker)
        let cursor = Math.max(sStart, inside[0].startAt.getTime());
        for (const g of inside){
            const gs = Math.max(g.startAt.getTime(), sStart);
            if (gs - cursor >= min) gaps.push({
                from: new Date(cursor),
                to: new Date(gs),
                seconds: Math.round((gs - cursor) / 1000)
            });
            cursor = Math.max(cursor, Math.min(g.endAt.getTime(), sEnd));
        }
        if (ses.endedAt && sEnd - cursor >= min) gaps.push({
            from: new Date(cursor),
            to: new Date(sEnd),
            seconds: Math.round((sEnd - cursor) / 1000)
        });
    }
    return gaps;
}
function missingScreenshots(workedSec, intervalMin, actual) {
    if (intervalMin <= 0) return 0;
    const expected = Math.floor(workedSec / (intervalMin * 60));
    return Math.max(0, expected - actual);
}
function weekStartOf(dateKey) {
    const d = new Date(`${dateKey}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
}
function addDays(dateKey, n) {
    const d = new Date(`${dateKey}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}
const dbDate = (key)=>new Date(`${key}T00:00:00.000Z`);
const dateKeyOf = (d)=>d.toISOString().slice(0, 10);
const hhmm = (min)=>`${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
function compareVersions(a, b) {
    const pa = a.split(/[.-]/).map((x)=>parseInt(x, 10) || 0);
    const pb = b.split(/[.-]/).map((x)=>parseInt(x, 10) || 0);
    for(let i = 0; i < Math.max(pa.length, pb.length); i++){
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d) return d;
    }
    return 0;
}
const PAIR_MAX_WRONG = 5;
const PAIR_WINDOW_MIN = 15;
const PAIR_CODE_TTL_MIN = 10;
const PAIR_SESSION_TTL_MIN = 15;
const MAX_ACTIVE_DEVICES = 2;
function isRateLimited(wrongAttemptsInWindow, max = PAIR_MAX_WRONG) {
    return wrongAttemptsInWindow >= max;
}

//# sourceMappingURL=tracker.rules.js.map