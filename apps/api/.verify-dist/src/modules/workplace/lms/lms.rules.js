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
    get BUCKET_SEC () {
        return BUCKET_SEC;
    },
    get MAX_CREDIT_SEC () {
        return MAX_CREDIT_SEC;
    },
    get VIDEO_COMPLETE_SHARE () {
        return VIDEO_COMPLETE_SHARE;
    },
    get assignmentLabel () {
        return assignmentLabel;
    },
    get bucketCount () {
        return bucketCount;
    },
    get courseProgressPct () {
        return courseProgressPct;
    },
    get courseTile () {
        return courseTile;
    },
    get creditBuckets () {
        return creditBuckets;
    },
    get dueAtFor () {
        return dueAtFor;
    },
    get dueInfo () {
        return dueInfo;
    },
    get isVideoComplete () {
        return isVideoComplete;
    },
    get lessonFraction () {
        return lessonFraction;
    },
    get videoWatchedShare () {
        return videoWatchedShare;
    }
});
const _shared = require("@lexisora/shared");
const _dates = require("../common/dates");
const BUCKET_SEC = 10;
const VIDEO_COMPLETE_SHARE = 0.9;
const MAX_CREDIT_SEC = 20;
function bucketCount(durationSec) {
    return Math.max(1, Math.ceil(Math.max(0, durationSec) / BUCKET_SEC));
}
function creditBuckets(existing, lastPos, newPos, rate, durationSec) {
    const total = bucketCount(durationSec);
    const set = new Set(existing.filter((b)=>b >= 0 && b < total));
    const delta = newPos - lastPos;
    const credited = delta > 0 && delta <= MAX_CREDIT_SEC * Math.max(0.5, rate) + 2;
    if (credited) {
        const from = Math.max(0, Math.floor(lastPos / BUCKET_SEC));
        const to = Math.min(total - 1, Math.floor(Math.max(newPos - 0.001, 0) / BUCKET_SEC));
        for(let b = from; b <= to; b++)set.add(b);
    }
    return {
        buckets: [
            ...set
        ].sort((a, b)=>a - b),
        credited
    };
}
function videoWatchedShare(buckets, durationSec) {
    const total = bucketCount(durationSec);
    return Math.min(1, new Set(buckets.filter((b)=>b >= 0 && b < total)).size / total);
}
function isVideoComplete(buckets, durationSec) {
    return videoWatchedShare(buckets, durationSec) >= VIDEO_COMPLETE_SHARE - 1e-9;
}
function lessonFraction(l, p) {
    if (p?.completedAt) return 1;
    if (!p || l.type !== 'VIDEO') return 0;
    return Math.min(VIDEO_COMPLETE_SHARE, videoWatchedShare(p.watchedBuckets, l.durationSec));
}
function courseProgressPct(fractions) {
    if (!fractions.length) return 0;
    return Math.round(100 * fractions.reduce((a, b)=>a + b, 0) / fractions.length);
}
function dueAtFor(from, days) {
    const ist = new Date(from.getTime() + 330 * 60_000);
    const endIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days, 23, 59, 59);
    return new Date(endIst - 330 * 60_000);
}
function dueInfo(dueAt, completed, now = new Date()) {
    if (!dueAt) return {
        label: null,
        overdue: false
    };
    const ist = new Date(dueAt.getTime() + 330 * 60_000);
    return {
        label: `Due ${ist.getUTCDate()} ${_dates.MONTHS_SHORT[ist.getUTCMonth()]}`,
        overdue: !completed && dueAt.getTime() < now.getTime()
    };
}
function courseTile(t, now = new Date()) {
    const e = t.enrollment;
    const kicker = `${_shared.WP_COURSE_CATEGORY_LABEL[t.category]} · ${(0, _shared.courseDurationLabel)(t.totalDurationSec)}`;
    let statusLine = 'Not started';
    let cta = e ? 'Start' : 'Enroll';
    if (!e) statusLine = `${t.lessonsTotal} lesson${t.lessonsTotal === 1 ? '' : 's'} · not enrolled`;
    else if (e.status === 'IN_PROGRESS') {
        statusLine = `${e.lessonsDone} of ${t.lessonsTotal} lessons done`;
        cta = 'Continue';
    } else if (e.status === 'COMPLETED') {
        if (e.certificateId) {
            statusLine = e.certificateDownloadedAt ? 'Completed' : 'Completed · certificate ready';
            cta = 'Download certificate';
        } else {
            statusLine = 'Completed';
            cta = 'Review';
        }
    }
    const due = dueInfo(e?.dueAt, e?.status === 'COMPLETED', now);
    return {
        courseId: t.courseId,
        enrollmentId: e?.id ?? null,
        kicker,
        title: t.title,
        status: e ? due.overdue ? 'OVERDUE' : e.status : 'NOT_ENROLLED',
        statusLine,
        cta,
        lessonsDone: e?.lessonsDone ?? 0,
        lessonsTotal: t.lessonsTotal,
        progressPct: e?.progressPct ?? 0,
        dueLabel: e?.status === 'COMPLETED' ? null : due.label,
        overdue: due.overdue,
        certificateId: e?.certificateId ?? null,
        category: t.category,
        required: e?.required ?? t.category !== 'OPTIONAL',
        media: t.firstLessonType === 'DOCUMENT' ? 'Document' : 'Video',
        description: t.description
    };
}
function assignmentLabel(a) {
    if (a.audienceType === 'ALL') return 'All employees';
    if (a.audienceType === 'NEW_JOINERS') return 'New joiners';
    if (a.audienceType === 'EMPLOYMENT_TYPE') return a.label ?? 'Employment type';
    return a.label ?? a.audienceType;
}

//# sourceMappingURL=lms.rules.js.map