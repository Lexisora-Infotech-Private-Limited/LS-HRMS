"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "TrackerContextService", {
    enumerable: true,
    get: function() {
        return TrackerContextService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../core/prisma/prisma.service");
const _errors = require("../../core/http/errors");
const _trackerrules = require("./tracker.rules");
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
/** Defaults used when the time domain has not stored an AttendancePolicy row yet. */ const POLICY_DEFAULTS = {
    OFFICE: {
        biometricMandatory: true,
        allowWebPunch: false,
        allowDesktopPunch: false
    },
    REMOTE: {
        biometricMandatory: false,
        allowWebPunch: true,
        allowDesktopPunch: true
    }
};
let TrackerContextService = class TrackerContextService {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    async employee(employeeId) {
        const e = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                id: true,
                tenantId: true,
                userId: true,
                fullName: true,
                empCode: true,
                workMode: true,
                managerId: true,
                shiftId: true,
                workLocationId: true,
                status: true
            }
        });
        if (!e) throw (0, _errors.notFound)('Employee');
        return e;
    }
    async policyRow(audience) {
        const row = await this.prisma.attendancePolicy.findFirst({
            where: {
                audience
            }
        });
        const d = POLICY_DEFAULTS[audience];
        return {
            audience,
            biometricMandatory: row?.biometricMandatory ?? d.biometricMandatory,
            allowWebPunch: row?.allowWebPunch ?? d.allowWebPunch,
            allowDesktopPunch: row?.allowDesktopPunch ?? d.allowDesktopPunch,
            autoIdleEnabled: row?.autoIdleEnabled ?? true,
            autoIdleMinutes: row?.autoIdleMinutes ?? 5,
            screenshotsEnabled: row?.screenshotsEnabled ?? true,
            screenshotIntervalMinutes: row?.screenshotIntervalMinutes ?? 10,
            blurScreenshots: row?.blurScreenshots ?? false,
            deductIdleFromPayroll: row?.deductIdleFromPayroll ?? true,
            breakReminderMinutes: row?.breakReminderMinutes ?? 120,
            offlineRetentionDays: row?.offlineRetentionDays ?? 7,
            screenshotRetentionDays: row?.screenshotRetentionDays ?? 90,
            updatedAt: row?.updatedAt ?? new Date('2026-09-01T00:00:00Z')
        };
    }
    audienceOf(e) {
        return e.workMode === 'OFFICE' ? 'OFFICE' : 'REMOTE';
    }
    async shiftFor(e, dateKey) {
        const date = (0, _trackerrules.dbDate)(dateKey);
        const asg = await this.prisma.shiftAssignment.findFirst({
            where: {
                employeeId: e.id,
                effectiveFrom: {
                    lte: date
                },
                OR: [
                    {
                        effectiveTo: null
                    },
                    {
                        effectiveTo: {
                            gte: date
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
        }).catch(()=>null);
        if (asg?.shift) return asg.shift;
        if (e.shiftId) {
            const s = await this.prisma.shift.findUnique({
                where: {
                    id: e.shiftId
                }
            });
            if (s) return s;
        }
        return this.prisma.shift.findFirst({
            where: {
                isDefault: true
            }
        });
    }
    /** PUNCH for remote / hybrid-WFH days; MONITOR_ONLY for office staff or a hybrid day with a biometric IN. */ async modeFor(e, now = new Date()) {
        const audience = this.audienceOf(e);
        if (audience === 'OFFICE') return {
            mode: 'MONITOR_ONLY',
            message: _shared.MONITOR_ONLY_MESSAGE
        };
        if (e.workLocationId) {
            const loc = await this.prisma.workLocation.findUnique({
                where: {
                    id: e.workLocationId
                }
            }).catch(()=>null);
            if (loc && loc.punchMode === 'BIOMETRIC_ONLY' && !loc.isRemote) return {
                mode: 'MONITOR_ONLY',
                message: _shared.MONITOR_ONLY_MESSAGE
            };
        }
        const policy = await this.policyRow('REMOTE');
        if (!policy.allowDesktopPunch) return {
            mode: 'MONITOR_ONLY',
            message: 'Desktop punch-in is turned off in your attendance policy. The tracker records activity after you punch in.'
        };
        if (e.workMode === 'HYBRID') {
            const bio = await this.prisma.attendancePunch.findFirst({
                where: {
                    employeeId: e.id,
                    attendanceDate: (0, _trackerrules.dbDate)((0, _shared.trackerWorkDate)(now)),
                    source: 'BIOMETRIC',
                    status: 'ACCEPTED'
                }
            }).catch(()=>null);
            if (bio) return {
                mode: 'MONITOR_ONLY',
                message: 'You punched in with biometric at the office today. The tracker records activity only.'
            };
        }
        return {
            mode: 'PUNCH',
            message: null
        };
    }
    async policyFor(employeeId, now = new Date()) {
        const e = await this.employee(employeeId);
        const audience = this.audienceOf(e);
        const p = await this.policyRow(audience);
        const shift = await this.shiftFor(e, (0, _shared.trackerWorkDate)(now));
        const { mode, message } = await this.modeFor(e, now);
        return {
            idleThresholdMin: Math.min(60, Math.max(1, p.autoIdleMinutes)),
            screenshotIntervalMin: Math.min(60, Math.max(1, p.screenshotIntervalMinutes)),
            screenshotsEnabled: p.screenshotsEnabled,
            blurScreenshots: p.blurScreenshots,
            offlineRetentionDays: Math.min(30, Math.max(1, p.offlineRetentionDays)),
            desktopPunchAllowed: mode === 'PUNCH',
            breakReminderMin: p.breakReminderMinutes,
            shiftStart: shift ? (0, _trackerrules.hhmm)(shift.startMinute) : '09:30',
            shiftEnd: shift ? (0, _trackerrules.hhmm)(shift.endMinute) : '18:30',
            mode,
            audience,
            autoIdleEnabled: p.autoIdleEnabled,
            deductIdleFromPayroll: p.deductIdleFromPayroll,
            screenshotRetentionDays: p.screenshotRetentionDays,
            idleClaimsAllowed: true,
            shiftName: shift?.name ?? null,
            breakAllowanceMin: shift?.breakMinutes ?? 60,
            modeMessage: message,
            updatedAt: p.updatedAt.toISOString(),
            serverTime: new Date().toISOString()
        };
    }
};
TrackerContextService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], TrackerContextService);

//# sourceMappingURL=tracker-context.service.js.map