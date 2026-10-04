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
    get SOURCE_BITS () {
        return SOURCE_BITS;
    },
    get computeDay () {
        return computeDay;
    },
    get idleDeductible () {
        return idleDeductible;
    },
    get isWeeklyOff () {
        return isWeeklyOff;
    },
    get lateMark () {
        return lateMark;
    },
    get latePenaltyDays () {
        return latePenaltyDays;
    },
    get requiredMinutes () {
        return requiredMinutes;
    },
    get shiftDurationMinutes () {
        return shiftDurationMinutes;
    },
    get shiftWindow () {
        return shiftWindow;
    },
    get sourceLabel () {
        return sourceLabel;
    },
    get summarizeMonth () {
        return summarizeMonth;
    }
});
const _timeutils = require("./time-utils");
const SOURCE_BITS = {
    BIOMETRIC: 1,
    WEB: 2,
    DESKTOP: 4,
    MOBILE: 8,
    REGULARIZATION: 16,
    SYSTEM: 32
};
function shiftDurationMinutes(shift) {
    const d = (shift.endMinute - shift.startMinute + 1440) % 1440;
    return d === 0 ? 1440 : d;
}
function requiredMinutes(shift) {
    return Math.max(0, shiftDurationMinutes(shift) - shift.breakMinutes);
}
function shiftWindow(date, shift) {
    const expectedStart = (0, _timeutils.istInstant)(date, shift.startMinute);
    const expectedEnd = new Date(expectedStart.getTime() + shiftDurationMinutes(shift) * 60_000);
    return {
        expectedStart,
        expectedEnd
    };
}
function isWeeklyOff(date, shift) {
    return shift.weeklyOffDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}
function lateMark(firstIn, expectedStart, graceMinutes) {
    const diff = Math.round((firstIn.getTime() - expectedStart.getTime()) / 60_000);
    if (diff > graceMinutes) return {
        isLate: true,
        lateByMinutes: diff
    };
    return {
        isLate: false,
        lateByMinutes: 0
    };
}
function idleDeductible(idle, worked, shift, policy, presentFraction) {
    if (!policy.deductIdleFromPayroll || presentFraction <= 0 || idle <= 0) return 0;
    if (policy.idleDeductionMode === 'ALL_IDLE') return idle;
    return Math.min(idle, Math.max(0, requiredMinutes(shift) - worked));
}
function computeDay(input) {
    const { date, today, now, shift, policy } = input;
    const { expectedStart, expectedEnd } = shiftWindow(date, shift);
    const weeklyOff = isWeeklyOff(date, shift);
    const offDay = weeklyOff || !!input.holidayName;
    const sessions = [
        ...input.sessions
    ].sort((a, b)=>a.startedAt.getTime() - b.startedAt.getTime());
    const isToday = date === today;
    const isPast = date < today;
    let gross = 0;
    let gapBreak = 0;
    let missed = false;
    let mask = 0;
    let prevEnd = null;
    for (const s of sessions){
        mask |= SOURCE_BITS[s.source] ?? 0;
        const end = s.endedAt ?? (isToday ? now : null);
        if (!s.endedAt && !isToday) missed = true;
        if (s.autoClosed && s.source !== 'DESKTOP') missed = true;
        if (end && !(s.autoClosed && s.source !== 'DESKTOP')) gross += (0, _timeutils.minutesBetween)(s.startedAt, end);
        if (prevEnd && s.startedAt > prevEnd) gapBreak += (0, _timeutils.minutesBetween)(prevEnd, s.startedAt);
        if (s.endedAt) prevEnd = s.endedAt;
    }
    const firstInAt = sessions[0]?.startedAt ?? null;
    const closed = sessions.filter((s)=>s.endedAt && !(s.autoClosed && s.source !== 'DESKTOP'));
    const lastOutAt = closed.length ? new Date(Math.max(...closed.map((s)=>s.endedAt.getTime()))) : null;
    const hasOpen = sessions.some((s)=>!s.endedAt);
    const primarySource = sessions[0]?.source ?? null;
    let breakMinutes;
    let presence;
    let idle = 0;
    let deductedIdle = 0;
    if (input.tracker) {
        const tBreak = Math.round(input.tracker.breakSec / 60);
        idle = Math.round(input.tracker.idleSec / 60);
        deductedIdle = Math.round((input.tracker.idleDeductedSec ?? input.tracker.idleSec) / 60);
        breakMinutes = tBreak + gapBreak;
        presence = Math.max(0, gross - tBreak);
    } else if (sessions.length === 1 && gross > 300 && !hasOpen) {
        breakMinutes = shift.breakMinutes; // "assume shift break when unrecorded"
        presence = gross - breakMinutes;
    } else {
        breakMinutes = gapBreak;
        presence = gross;
    }
    const worked = Math.max(0, presence - deductedIdle);
    let isLate = false;
    let lateByMinutes = 0;
    if (firstInAt && !offDay) ({ isLate, lateByMinutes } = lateMark(firstInAt, expectedStart, shift.graceMinutes));
    let isEarlyOut = false;
    if (lastOutAt && !hasOpen && !offDay && (isPast || now > expectedEnd)) {
        isEarlyOut = lastOutAt.getTime() < expectedEnd.getTime() - shift.earlyOutGraceMinutes * 60_000;
        if (isEarlyOut && policy.earlyOutCountsAsLate) isLate = true;
    }
    const leave = input.leave;
    const leaveFull = !!leave && leave.fraction >= 1;
    const leaveHalf = !!leave && leave.fraction > 0 && leave.fraction < 1;
    let status;
    let presentFraction = 0;
    let leaveFraction = 0;
    if (offDay) {
        status = presence >= shift.minHalfDayMinutes ? input.holidayName ? 'HOLIDAY_WORKED' : 'WEEKLY_OFF_WORKED' : input.holidayName ? 'HOLIDAY' : 'WEEKLY_OFF';
    } else if (leaveFull) {
        status = 'LEAVE';
        leaveFraction = 1;
    } else if (missed) {
        status = 'MISSED_PUNCH';
        leaveFraction = leaveHalf ? 0.5 : 0;
    } else if (isToday && (hasOpen || presence < shift.minFullDayMinutes) && now < new Date(expectedEnd.getTime() + 4 * 3600_000)) {
        status = 'PENDING';
        leaveFraction = leaveHalf ? 0.5 : 0;
    } else if (date > today) {
        status = 'PENDING';
    } else if (leaveHalf) {
        leaveFraction = 0.5;
        status = 'HALF_DAY_LEAVE';
        presentFraction = presence >= shift.minHalfDayMinutes ? 0.5 : 0;
    } else if (presence >= shift.minFullDayMinutes) {
        const cap = shift.halfDayIfLateByMinutes != null && lateByMinutes > shift.halfDayIfLateByMinutes;
        status = cap ? 'HALF_DAY' : 'PRESENT';
        presentFraction = cap ? 0.5 : 1;
    } else if (presence >= shift.minHalfDayMinutes) {
        status = 'HALF_DAY';
        presentFraction = 0.5;
    } else {
        status = 'ABSENT';
    }
    const idleDeductibleMinutes = idleDeductible(idle, worked, shift, policy, presentFraction);
    return {
        status,
        firstInAt,
        lastOutAt,
        primarySource,
        sourcesMask: mask,
        presenceMinutes: presence,
        workedMinutes: worked,
        breakMinutes,
        idleMinutes: idle,
        isLate,
        lateByMinutes,
        lateExcused: !!input.lateExcused && isLate,
        isEarlyOut,
        presentFraction,
        leaveFraction,
        leaveTypeCode: leave?.typeCode ?? null,
        idleDeductibleMinutes,
        expectedStart,
        expectedEnd,
        holidayName: input.holidayName,
        isWeeklyOff: weeklyOff
    };
}
function sourceLabel(mask, primary) {
    if (!mask && !primary) return null;
    const bits = Object.values(SOURCE_BITS).filter((b)=>mask & b).length;
    if (bits > 1) return 'Mixed';
    const LABEL = {
        BIOMETRIC: 'Biometric',
        WEB: 'Web',
        DESKTOP: 'Desktop',
        MOBILE: 'Mobile',
        REGULARIZATION: 'Regularized',
        SYSTEM: 'System'
    };
    return primary ? LABEL[primary] : null;
}
function summarizeMonth(days, allowanceMinutes = 0) {
    const off = new Set([
        'WEEKLY_OFF',
        'HOLIDAY',
        'WEEKLY_OFF_WORKED',
        'HOLIDAY_WORKED'
    ]);
    const sumDeductible = days.reduce((s, d)=>s + d.idleDeductibleMinutes, 0);
    return {
        presentDays: round2(days.reduce((s, d)=>s + d.presentFraction, 0)),
        lateMarks: days.filter((d)=>d.isLate && !d.lateExcused).length,
        activeMinutes: days.reduce((s, d)=>s + d.workedMinutes, 0),
        idleMinutes: days.reduce((s, d)=>s + d.idleMinutes, 0),
        leaveDays: round2(days.reduce((s, d)=>s + d.leaveFraction, 0)),
        workingDays: days.filter((d)=>!off.has(d.status)).length,
        absentDays: days.filter((d)=>d.status === 'ABSENT').length,
        missedPunchDays: days.filter((d)=>d.status === 'MISSED_PUNCH').length,
        idleDeductibleMinutes: Math.max(0, sumDeductible - allowanceMinutes)
    };
}
function latePenaltyDays(lateMarks, perPenalty, penaltyDays) {
    if (perPenalty <= 0) return 0;
    return Math.floor(lateMarks / perPenalty) * penaltyDays;
}
function round2(n) {
    return Math.round(n * 100) / 100;
}

//# sourceMappingURL=day-calc.js.map