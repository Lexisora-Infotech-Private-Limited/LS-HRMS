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
    get ACTIVE_STATUSES () {
        return ACTIVE_STATUSES;
    },
    get DEFAULT_LEAVE_SETTINGS () {
        return DEFAULT_LEAVE_SETTINGS;
    },
    get HALF_LABEL () {
        return HALF_LABEL;
    },
    get LEAVE_SETTINGS_KEY () {
        return LEAVE_SETTINGS_KEY;
    },
    get requestDatesLabel () {
        return requestDatesLabel;
    },
    get requestInclude () {
        return requestInclude;
    },
    get toRequestRow () {
        return toRequestRow;
    }
});
const _shared = require("@lexisora/shared");
const _dates = require("../common/dates");
const LEAVE_SETTINGS_KEY = 'leave.settings';
const DEFAULT_LEAVE_SETTINGS = {
    excessBalanceAction: 'REJECT',
    escalateAfterDays: 3,
    pendingReminderHours: 24,
    compOffHalfDayMinMinutes: 240,
    compOffFullDayMinMinutes: 420,
    compOffRequestWindowDays: 30,
    teamOverlapWarnPct: 30
};
const ACTIVE_STATUSES = [
    'PENDING',
    'APPROVED',
    'CANCELLATION_PENDING'
];
const HALF_LABEL = {
    FIRST_HALF: 'first half',
    SECOND_HALF: 'second half'
};
function requestDatesLabel(from, to, halfDay) {
    const f = (0, _dates.dk)(from);
    const t = (0, _dates.dk)(to);
    if (f === t && halfDay !== 'NONE') return `${(0, _dates.dayMonth)(f)} · ${HALF_LABEL[halfDay] ?? ''}`;
    return (0, _dates.rangeLabel)(f, t);
}
function toRequestRow(r, approverName, viewer) {
    const status = r.status;
    const own = viewer.employeeId === r.employeeId;
    const isApprover = !!viewer.employeeId && viewer.employeeId === r.approverEmployeeId && !own;
    const canDecide = isApprover || viewer.isHr && !own;
    const from = (0, _dates.dk)(r.fromDate);
    return {
        id: r.id,
        requestNo: r.requestNo,
        employeeId: r.employeeId,
        employeeName: r.employee.fullName,
        employeeCode: r.employee.empCode,
        department: r.employee.department?.name ?? null,
        leaveTypeId: r.leaveTypeId,
        typeCode: r.leaveType.code,
        typeName: r.leaveType.name,
        fromDate: from,
        toDate: (0, _dates.dk)(r.toDate),
        dates: requestDatesLabel(r.fromDate, r.toDate, r.halfDay),
        days: r.days,
        lopDays: r.lopDays,
        reason: r.reason,
        status,
        statusLabel: _shared.LEAVE_STATUS_LABEL[status] ?? status,
        approverId: r.approverEmployeeId,
        approverName,
        appliedOn: r.createdAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decisionNote: r.decisionNote,
        can: {
            withdraw: own && status === 'PENDING',
            cancel: (own || viewer.isHr) && status === 'APPROVED' && (from > viewer.today || viewer.isHr),
            requestCancel: own && !viewer.isHr && status === 'APPROVED' && from <= viewer.today,
            approve: canDecide && status === 'PENDING',
            reject: canDecide && status === 'PENDING',
            decideCancellation: canDecide && status === 'CANCELLATION_PENDING'
        }
    };
}
const requestInclude = {
    employee: {
        select: {
            fullName: true,
            empCode: true,
            department: {
                select: {
                    name: true
                }
            }
        }
    },
    leaveType: {
        select: {
            code: true,
            name: true
        }
    }
};

//# sourceMappingURL=leave.common.js.map