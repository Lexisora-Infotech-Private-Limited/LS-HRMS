/** Pure timesheet rules (spec-time J3/J5). */ "use strict";
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
    get cellFinal () {
        return cellFinal;
    },
    get chainTones () {
        return chainTones;
    },
    get hmm () {
        return hmm;
    },
    get isEditableStatus () {
        return isEditableStatus;
    },
    get outsideHoursMinutes () {
        return outsideHoursMinutes;
    },
    get planCellEdit () {
        return planCellEdit;
    },
    get reasonRequired () {
        return reasonRequired;
    },
    get submitLabel () {
        return submitLabel;
    }
});
function cellFinal(c) {
    return Math.max(0, c.trackedMinutes + c.idleAsWorkMinutes + c.outsideHoursMinutes + c.adjustmentMinutes);
}
function planCellEdit(c, newMinutes) {
    const base = c.trackedMinutes + c.idleAsWorkMinutes + c.outsideHoursMinutes;
    const current = cellFinal(c);
    const delta = newMinutes - current;
    if (delta === 0) return null;
    const adjustmentMinutes = newMinutes - base;
    const kind = delta > 0 ? 'MANUAL_INCREASE' : 'MANUAL_DECREASE';
    return {
        adjustmentMinutes,
        deltaMinutes: delta,
        kind,
        reviewStatus: kind === 'MANUAL_INCREASE' && newMinutes > base ? 'PENDING_PL' : 'NOT_REQUIRED'
    };
}
function reasonRequired(p) {
    if (p.hasTrackerData) return true;
    return p.dayTotalAfter > p.attendanceWorked;
}
function chainTones(status) {
    switch(status){
        case 'SUBMITTED':
            return [
                'accent',
                'outline',
                'neutral',
                'neutral'
            ];
        case 'PENDING_RM':
            return [
                'accent',
                'accent',
                'outline',
                'neutral'
            ];
        case 'APPROVED':
            return [
                'accent',
                'accent',
                'accent',
                'outline'
            ];
        case 'LOCKED':
            return [
                'accent',
                'accent',
                'accent',
                'accent'
            ];
        default:
            return [
                'outline',
                'neutral',
                'neutral',
                'neutral'
            ];
    }
}
function submitLabel(status) {
    if (status === 'RETURNED') return 'Resubmit';
    if (status === 'SUBMITTED' || status === 'PENDING_RM') return 'Submitted';
    if (status === 'APPROVED' || status === 'LOCKED') return 'Approved';
    return 'Submit for approval';
}
function isEditableStatus(status) {
    return status === 'DRAFT' || status === 'RETURNED';
}
function outsideHoursMinutes(from, to) {
    const minutes = to - from;
    if (minutes < 15) return {
        minutes,
        error: 'Outside-hours entries must be at least 15 minutes'
    };
    if (minutes > 720) return {
        minutes,
        error: 'Outside-hours entries can be at most 12 hours'
    };
    return {
        minutes
    };
}
function hmm(minutes) {
    if (!minutes) return '–';
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

//# sourceMappingURL=timesheet-calc.js.map