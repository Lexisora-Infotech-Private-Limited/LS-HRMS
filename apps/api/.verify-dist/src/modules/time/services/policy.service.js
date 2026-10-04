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
    get EMP_SELECT () {
        return EMP_SELECT;
    },
    get GENERAL_SHIFT () {
        return GENERAL_SHIFT;
    },
    get POLICY_DEFAULTS () {
        return POLICY_DEFAULTS;
    },
    get PolicyService () {
        return PolicyService;
    },
    get toLocationRules () {
        return toLocationRules;
    },
    get toPolicyDto () {
        return toPolicyDto;
    },
    get toShiftLike () {
        return toShiftLike;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _eventsservice = require("../../../core/registry/events.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _cross = require("../cross");
const _policy = require("../lib/policy");
const _timeutils = require("../lib/time-utils");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") {
        r = Reflect.decorate(decorators, target, key, desc);
    } else {
        for(var i = decorators.length - 1; i >= 0; i--){
            if (d = decorators[i]) {
                r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
            }
        }
    }
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(metadataKey, metadataValue) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") {
        return Reflect.metadata(metadataKey, metadataValue);
    }
}
const POLICY_DEFAULTS = {
    OFFICE: {
        biometricMandatory: true,
        allowWebPunch: false,
        allowDesktopPunch: false,
        autoIdleEnabled: true,
        autoIdleMinutes: 5,
        screenshotsEnabled: true,
        screenshotIntervalMinutes: 10,
        blurScreenshots: false,
        deductIdleFromPayroll: true,
        monthlyIdleAllowanceMinutes: 60,
        breakReminderMinutes: 120,
        offlineRetentionDays: 7,
        screenshotRetentionDays: 90,
        idleDeductionMode: 'SHORTFALL_ONLY',
        lateMarksPerPenalty: 3,
        latePenaltyDays: 0.5,
        latePenaltySource: 'LEAVE_THEN_LOP',
        earlyOutCountsAsLate: false,
        missedPunchAutoCloseHours: 6,
        maxRegularizationsPerMonth: 3,
        regularizationWindowDays: 7,
        timesheetRequired: true,
        trackerRequired: false,
        punchInReminder: true
    },
    REMOTE: {
        biometricMandatory: false,
        allowWebPunch: true,
        allowDesktopPunch: true,
        autoIdleEnabled: true,
        autoIdleMinutes: 5,
        screenshotsEnabled: true,
        screenshotIntervalMinutes: 10,
        blurScreenshots: false,
        deductIdleFromPayroll: true,
        monthlyIdleAllowanceMinutes: 60,
        breakReminderMinutes: 120,
        offlineRetentionDays: 7,
        screenshotRetentionDays: 90,
        idleDeductionMode: 'SHORTFALL_ONLY',
        lateMarksPerPenalty: 3,
        latePenaltyDays: 0.5,
        latePenaltySource: 'LEAVE_THEN_LOP',
        earlyOutCountsAsLate: false,
        missedPunchAutoCloseHours: 6,
        maxRegularizationsPerMonth: 3,
        regularizationWindowDays: 7,
        timesheetRequired: true,
        trackerRequired: true,
        punchInReminder: true
    }
};
const GENERAL_SHIFT = {
    id: null,
    name: 'General',
    startMinute: 570,
    endMinute: 1110,
    graceMinutes: 15,
    breakMinutes: 60,
    weeklyOffDays: [
        0,
        6
    ],
    minFullDayMinutes: 450,
    minHalfDayMinutes: 240,
    halfDayIfLateByMinutes: 120,
    earlyOutGraceMinutes: 15
};
const MONITORING_FIELDS = [
    'allowWebPunch',
    'allowDesktopPunch',
    'biometricMandatory',
    'autoIdleEnabled',
    'autoIdleMinutes',
    'screenshotsEnabled',
    'screenshotIntervalMinutes',
    'blurScreenshots'
];
const FIELD_LABEL = {
    biometricMandatory: 'Biometric punch mandatory',
    allowWebPunch: 'Allow web punch-in',
    allowDesktopPunch: 'Allow desktop app punch-in',
    autoIdleEnabled: 'Auto-idle',
    autoIdleMinutes: 'Auto-idle minutes',
    screenshotsEnabled: 'Screenshots',
    screenshotIntervalMinutes: 'Screenshot interval',
    blurScreenshots: 'Blur screenshots',
    deductIdleFromPayroll: 'Deduct idle time from payroll'
};
const EMP_SELECT = {
    id: true,
    fullName: true,
    userId: true,
    workMode: true,
    shiftId: true,
    workLocationId: true,
    managerId: true,
    status: true,
    employmentType: true,
    joiningDate: true,
    exitDate: true,
    departmentId: true,
    empCode: true
};
function toLocationRules(l) {
    if (!l) return null;
    return {
        name: l.name,
        punchMode: l.punchMode,
        isRemote: l.isRemote,
        lat: l.lat,
        lng: l.lng,
        geoRadiusM: l.geoRadiusM,
        geoFenceWebPunch: l.geoFenceWebPunch
    };
}
function toShiftLike(s) {
    if (!s) return GENERAL_SHIFT;
    return {
        id: s.id,
        name: s.name,
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        graceMinutes: s.graceMinutes,
        breakMinutes: s.breakMinutes,
        weeklyOffDays: s.weeklyOffDays,
        minFullDayMinutes: s.minFullDayMinutes,
        minHalfDayMinutes: s.minHalfDayMinutes,
        halfDayIfLateByMinutes: s.halfDayIfLateByMinutes,
        earlyOutGraceMinutes: s.earlyOutGraceMinutes
    };
}
let PolicyService = class PolicyService {
    prisma;
    audit;
    realtime;
    notifications;
    cross;
    events;
    constructor(prisma, audit, realtime, notifications, cross, events){
        this.prisma = prisma;
        this.audit = audit;
        this.realtime = realtime;
        this.notifications = notifications;
        this.cross = cross;
        this.events = events;
    }
    // ── policy ──
    async get(audience) {
        const row = await this.prisma.attendancePolicy.findFirst({
            where: {
                audience
            }
        });
        if (row) return row;
        return this.prisma.attendancePolicy.create({
            data: {
                audience,
                ...POLICY_DEFAULTS[audience]
            }
        });
    }
    async both() {
        const [office, remote] = await Promise.all([
            this.get('OFFICE'),
            this.get('REMOTE')
        ]);
        return {
            office: toPolicyDto(office),
            remote: toPolicyDto(remote)
        };
    }
    async update(audience, patch) {
        const current = await this.get(audience);
        if (patch.expectedVersion !== undefined && patch.expectedVersion !== current.version) {
            throw new _errors.AppError(409, 'VERSION_CONFLICT', 'Someone else changed this policy · reload and try again');
        }
        const { expectedVersion: _v, ...changes } = patch;
        const merged = {
            ...current,
            ...changes
        };
        const norm = (0, _policy.normalizePolicy)(merged, changes);
        if (norm.error) throw new _errors.AppError(422, 'POLICY_INVALID', norm.error);
        const next = norm.policy;
        const diff = {};
        for (const k of Object.keys(POLICY_DEFAULTS[audience])){
            if (current[k] !== next[k]) diff[k] = {
                from: current[k],
                to: next[k]
            };
        }
        if (!Object.keys(diff).length) return {
            policy: toPolicyDto(current),
            pushedTo: 0,
            autoCleared: []
        };
        const ctx = (0, _requestcontext.requireContext)();
        const data = {};
        for (const k of Object.keys(diff))data[k] = next[k];
        const saved = await this.prisma.attendancePolicy.update({
            where: {
                id: current.id
            },
            data: {
                ...data,
                version: current.version + 1,
                updatedByName: ctx.userName ?? null
            }
        });
        await this.audit.record({
            action: 'attendance_policy.updated',
            entity: 'AttendancePolicy',
            entityId: saved.id,
            meta: {
                audience,
                version: saved.version,
                diff
            }
        });
        // Push to web tabs + trackers (they refetch policy on this event).
        this.realtime.toTenant(ctx.tenantId, 'policy.updated', {
            audience,
            version: saved.version
        });
        this.realtime.toTenant(ctx.tenantId, 'tracker.policy.updated', {
            audience,
            version: saved.version
        });
        this.events.emit('policy.updated', {
            audience,
            version: saved.version,
            updatedAt: saved.updatedAt.toISOString()
        });
        const affected = await this.employeesInAudience(audience);
        const pushedTo = await this.cross.activeTrackerDevices(affected.map((e)=>e.id));
        // DPDP: monitoring / punch-method changes are disclosed to affected employees.
        const material = Object.keys(diff).filter((k)=>MONITORING_FIELDS.includes(k));
        if (material.length) {
            const userIds = affected.map((e)=>e.userId).filter((x)=>!!x);
            const what = material.map((k)=>`${FIELD_LABEL[k] ?? k}: ${fmtVal(diff[k].to)}`).join(', ');
            await this.notifications.notify({
                userIds,
                type: 'attendance.policy.updated',
                title: 'Attendance policy updated',
                body: `${audience === 'OFFICE' ? 'Office' : 'Remote / WFH'} rules changed · ${what}`,
                link: '/attendance',
                from: 'HR'
            });
        }
        return {
            policy: toPolicyDto(saved),
            pushedTo,
            autoCleared: norm.autoCleared
        };
    }
    /** Active employees whose policy column is `audience` (OFFICE vs REMOTE/HYBRID). */ async employeesInAudience(audience) {
        return this.prisma.employee.findMany({
            where: {
                status: {
                    in: [
                        'ACTIVE',
                        'NOTICE_PERIOD'
                    ]
                },
                workMode: audience === 'OFFICE' ? 'OFFICE' : {
                    in: [
                        'REMOTE',
                        'HYBRID'
                    ]
                }
            },
            select: {
                id: true,
                userId: true
            }
        });
    }
    // ── shifts ──
    async defaultShift() {
        return await this.prisma.shift.findFirst({
            where: {
                isDefault: true,
                archivedAt: null
            }
        }) ?? await this.prisma.shift.findFirst({
            where: {
                archivedAt: null
            },
            orderBy: {
                createdAt: 'asc'
            }
        });
    }
    /** Resolve shift(employee, date): assignment covering the date → Employee.shiftId → tenant default. */ async shiftFor(emp, date) {
        const d = (0, _timeutils.dateOf)(date);
        const a = await this.prisma.shiftAssignment.findFirst({
            where: {
                employeeId: emp.id,
                effectiveFrom: {
                    lte: d
                },
                OR: [
                    {
                        effectiveTo: null
                    },
                    {
                        effectiveTo: {
                            gte: d
                        }
                    }
                ]
            },
            orderBy: {
                effectiveFrom: 'desc'
            },
            include: {
                shift: true
            }
        });
        if (a?.shift) return a.shift;
        if (emp.shiftId) {
            const s = await this.prisma.shift.findFirst({
                where: {
                    id: emp.shiftId
                }
            });
            if (s) return s;
        }
        return this.defaultShift();
    }
    // ── locations ──
    async remoteLocation() {
        const found = await this.prisma.workLocation.findFirst({
            where: {
                isRemote: true,
                archivedAt: null
            },
            orderBy: {
                isSystem: 'desc'
            }
        });
        if (found) return found;
        return this.prisma.workLocation.create({
            data: {
                name: 'Remote',
                punchMode: 'WEB_DESKTOP_ALLOWED',
                isRemote: true,
                isSystem: true
            }
        });
    }
    async locationFor(emp, audience) {
        if (audience === 'REMOTE') return this.remoteLocation();
        if (emp.workLocationId) {
            const l = await this.prisma.workLocation.findFirst({
                where: {
                    id: emp.workLocationId
                }
            });
            if (l) return l;
        }
        return this.prisma.workLocation.findFirst({
            where: {
                isRemote: false,
                archivedAt: null
            },
            orderBy: {
                createdAt: 'asc'
            }
        });
    }
    // ── holidays ──
    async holidaysBetween(from, to) {
        return this.prisma.holiday.findMany({
            where: {
                date: {
                    gte: (0, _timeutils.dateOf)(from),
                    lte: (0, _timeutils.dateOf)(to)
                },
                type: 'MANDATORY'
            },
            orderBy: {
                date: 'asc'
            }
        });
    }
    /** Holiday name for a location on a date (empty locationIds = every location). */ holidayName(holidays, date, locationId) {
        const h = holidays.find((x)=>(0, _timeutils.keyOf)(x.date) === date && (!x.locationIds.length || locationId && x.locationIds.includes(locationId)));
        return h?.name ?? null;
    }
    async employee(id) {
        return await this.prisma.employee.findFirst({
            where: {
                id
            },
            select: EMP_SELECT
        });
    }
};
PolicyService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _cross.CrossReader === "undefined" ? Object : _cross.CrossReader,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService
    ])
], PolicyService);
function toPolicyDto(p) {
    return {
        audience: p.audience,
        biometricMandatory: p.biometricMandatory,
        allowWebPunch: p.allowWebPunch,
        allowDesktopPunch: p.allowDesktopPunch,
        autoIdleEnabled: p.autoIdleEnabled,
        autoIdleMinutes: p.autoIdleMinutes,
        screenshotsEnabled: p.screenshotsEnabled,
        screenshotIntervalMinutes: p.screenshotIntervalMinutes,
        blurScreenshots: p.blurScreenshots,
        deductIdleFromPayroll: p.deductIdleFromPayroll,
        monthlyIdleAllowanceMinutes: p.monthlyIdleAllowanceMinutes,
        breakReminderMinutes: p.breakReminderMinutes,
        offlineRetentionDays: p.offlineRetentionDays,
        screenshotRetentionDays: p.screenshotRetentionDays,
        idleDeductionMode: p.idleDeductionMode,
        lateMarksPerPenalty: p.lateMarksPerPenalty,
        latePenaltyDays: p.latePenaltyDays,
        latePenaltySource: p.latePenaltySource,
        earlyOutCountsAsLate: p.earlyOutCountsAsLate,
        missedPunchAutoCloseHours: p.missedPunchAutoCloseHours,
        maxRegularizationsPerMonth: p.maxRegularizationsPerMonth,
        regularizationWindowDays: p.regularizationWindowDays,
        timesheetRequired: p.timesheetRequired,
        trackerRequired: p.trackerRequired,
        punchInReminder: p.punchInReminder,
        version: p.version,
        updatedAt: p.updatedAt.toISOString(),
        updatedByName: p.updatedByName
    };
}
function fmtVal(v) {
    if (v === true) return 'on';
    if (v === false) return 'off';
    return String(v);
}

//# sourceMappingURL=policy.service.js.map