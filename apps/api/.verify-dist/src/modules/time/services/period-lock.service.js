"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PeriodLockService", {
    enumerable: true,
    get: function() {
        return PeriodLockService;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _eventsservice = require("../../../core/registry/events.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
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
let PeriodLockService = class PeriodLockService {
    prisma;
    audit;
    events;
    constructor(prisma, audit, events){
        this.prisma = prisma;
        this.audit = audit;
        this.events = events;
    }
    /** True when the IST date (Date or "YYYY-MM-DD") falls in an active lock. */ async isLocked(date) {
        const key = typeof date === 'string' ? date : (0, _timeutils.keyOf)(date);
        const lock = await this.prisma.periodLock.findFirst({
            where: {
                month: (0, _timeutils.monthOf)(key),
                unlockedAt: null,
                lockedUpTo: {
                    gte: (0, _timeutils.dateOf)(key)
                }
            }
        });
        return !!lock;
    }
    async assertOpen(date, what = 'This date') {
        if (await this.isLocked(date)) throw new _errors.AppError(409, 'PERIOD_LOCKED', `${what} is in a locked attendance period`);
    }
    /** Lock a month up to (and including) `upTo` (default: month end). */ async lock(month, upTo, payrollRunId) {
        const range = (0, _timeutils.monthRange)(month);
        const upKey = upTo ? typeof upTo === 'string' ? upTo : (0, _timeutils.keyOf)(upTo) : range.to;
        if ((0, _timeutils.monthOf)(upKey) !== month) throw new _errors.AppError(422, 'LOCK_RANGE', 'Lock date must fall in the chosen month');
        const ctx = (0, _requestcontext.getContext)();
        const row = await this.prisma.periodLock.upsert({
            where: {
                tenantId_month: {
                    tenantId: ctx.tenantId,
                    month
                }
            },
            create: {
                month,
                lockedUpTo: (0, _timeutils.dateOf)(upKey),
                lockedByName: ctx?.userName ?? 'System',
                payrollRunId: payrollRunId ?? null
            },
            update: {
                lockedUpTo: (0, _timeutils.dateOf)(upKey),
                lockedByName: ctx?.userName ?? 'System',
                lockedAt: new Date(),
                unlockedAt: null,
                unlockReason: null,
                ...payrollRunId ? {
                    payrollRunId
                } : {}
            }
        });
        await this.prisma.attendanceDay.updateMany({
            where: {
                date: {
                    gte: (0, _timeutils.dateOf)(range.from),
                    lte: (0, _timeutils.dateOf)(upKey)
                }
            },
            data: {
                isLocked: true
            }
        });
        await this.audit.record({
            action: 'attendance.period.locked',
            entity: 'PeriodLock',
            entityId: row.id,
            meta: {
                month,
                upTo: upKey
            }
        });
        this.events.emit('attendance.period.locked', {
            month,
            upTo: upKey
        });
        return toRow(row);
    }
    async unlock(month, reason) {
        const row = await this.prisma.periodLock.findFirst({
            where: {
                month
            }
        });
        if (!row || row.unlockedAt) throw new _errors.AppError(404, 'NOT_FOUND', 'This month is not locked');
        const range = (0, _timeutils.monthRange)(month);
        const saved = await this.prisma.periodLock.update({
            where: {
                id: row.id
            },
            data: {
                unlockedAt: new Date(),
                unlockReason: reason
            }
        });
        await this.prisma.attendanceDay.updateMany({
            where: {
                date: {
                    gte: (0, _timeutils.dateOf)(range.from),
                    lte: (0, _timeutils.dateOf)(range.to)
                }
            },
            data: {
                isLocked: false
            }
        });
        await this.audit.record({
            action: 'attendance.period.unlocked',
            entity: 'PeriodLock',
            entityId: row.id,
            meta: {
                month,
                reason
            }
        });
        return toRow(saved);
    }
    async list() {
        const rows = await this.prisma.periodLock.findMany({
            orderBy: {
                month: 'desc'
            },
            take: 24
        });
        return rows.map(toRow);
    }
};
PeriodLockService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService
    ])
], PeriodLockService);
function toRow(r) {
    return {
        month: r.month,
        lockedUpTo: (0, _timeutils.keyOf)(r.lockedUpTo),
        lockedBy: r.lockedByName,
        lockedAt: r.lockedAt.toISOString(),
        unlockedAt: r.unlockedAt?.toISOString() ?? null,
        unlockReason: r.unlockReason,
        active: !r.unlockedAt
    };
}

//# sourceMappingURL=period-lock.service.js.map