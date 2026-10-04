"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "RegularizationService", {
    enumerable: true,
    get: function() {
        return RegularizationService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _orgservice = require("../../../core/org/org.service");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _cross = require("../cross");
const _timeutils = require("../lib/time-utils");
const _attendanceservice = require("./attendance.service");
const _periodlockservice = require("./period-lock.service");
const _policyservice = require("./policy.service");
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
let RegularizationService = class RegularizationService {
    prisma;
    attendance;
    policies;
    locks;
    cross;
    audit;
    notifications;
    realtime;
    org;
    constructor(prisma, attendance, policies, locks, cross, audit, notifications, realtime, org){
        this.prisma = prisma;
        this.attendance = attendance;
        this.policies = policies;
        this.locks = locks;
        this.cross = cross;
        this.audit = audit;
        this.notifications = notifications;
        this.realtime = realtime;
        this.org = org;
    }
    async create(input) {
        const ctx = (0, _requestcontext.requireContext)();
        const employeeId = this.org.myEmployeeId();
        const emp = await this.policies.employee(employeeId);
        if (!emp) throw (0, _errors.notFound)('Employee');
        const today = (0, _timeutils.istKeyOf)(new Date());
        if (input.date > today) throw new _errors.AppError(422, 'REGULARIZATION_FUTURE', "You can't regularize a future date");
        const audience = emp.workMode === 'OFFICE' ? 'OFFICE' : 'REMOTE';
        const policy = await this.policies.get(audience);
        if (input.date < (0, _timeutils.addDays)(today, -policy.regularizationWindowDays)) {
            throw new _errors.AppError(422, 'REGULARIZATION_WINDOW', `Corrections must be requested within ${policy.regularizationWindowDays} days`);
        }
        await this.locks.assertOpen(input.date);
        const leave = await this.cross.leaveDays([
            employeeId
        ], input.date, input.date);
        if (leave.reduce((s, l)=>s + l.units, 0) >= 1) throw new _errors.AppError(409, 'ON_LEAVE', 'You were on approved leave that day');
        const pending = await this.prisma.attendanceRegularization.findFirst({
            where: {
                employeeId,
                date: (0, _timeutils.dateOf)(input.date),
                status: 'PENDING'
            }
        });
        if (pending) throw new _errors.AppError(409, 'REGULARIZATION_PENDING', 'A correction for this date is already pending');
        const { from, to } = (0, _timeutils.monthRange)((0, _timeutils.monthOf)(input.date));
        const used = await this.prisma.attendanceRegularization.count({
            where: {
                employeeId,
                date: {
                    gte: (0, _timeutils.dateOf)(from),
                    lte: (0, _timeutils.dateOf)(to)
                },
                status: {
                    in: [
                        'PENDING',
                        'APPROVED'
                    ]
                }
            }
        });
        if (used >= policy.maxRegularizationsPerMonth) {
            throw new _errors.AppError(422, 'REGULARIZATION_LIMIT', `You've used all ${policy.maxRegularizationsPerMonth} corrections for this month`);
        }
        const inAt = input.correctedIn ? (0, _timeutils.istInstant)(input.date, (0, _timeutils.parseHm)(input.correctedIn)) : null;
        let outAt = input.correctedOut ? (0, _timeutils.istInstant)(input.date, (0, _timeutils.parseHm)(input.correctedOut)) : null;
        if (inAt && outAt && outAt <= inAt) outAt = new Date(outAt.getTime() + 86_400_000); // night shift out after midnight
        if (inAt && outAt && outAt.getTime() - inAt.getTime() > 16 * 3600_000) throw new _errors.AppError(422, 'REGULARIZATION_SPAN', 'The corrected span can be at most 16 hours');
        const approver = emp.managerId && emp.managerId !== employeeId ? emp.managerId : null;
        const row = await this.prisma.attendanceRegularization.create({
            data: {
                employeeId,
                date: (0, _timeutils.dateOf)(input.date),
                type: input.type,
                requestedIn: inAt,
                requestedOut: outAt,
                reason: input.reason,
                attachmentFileId: input.attachmentFileId ?? null,
                approverEmployeeId: approver
            }
        });
        await this.audit.record({
            action: 'regularization.requested',
            entity: 'AttendanceRegularization',
            entityId: row.id,
            meta: {
                date: input.date,
                type: input.type
            }
        });
        const approverUsers = approver ? await this.notifications.usersForEmployees([
            approver
        ]) : await this.notifications.usersWithPermission('attendance.manage');
        await this.notifications.notify({
            userIds: approverUsers,
            type: 'regularization.requested',
            title: `${emp.fullName} requested an attendance correction for ${(0, _timeutils.dayLabel)(input.date)}`,
            body: `${_shared.REGULARIZATION_TYPE_LABEL[input.type]} · ${input.reason}`,
            link: '/approvals?tab=corrections',
            from: emp.fullName,
            email: true
        });
        for (const u of approverUsers)this.realtime.toUser(u, 'approvals.counts', {});
        return (await this.rows([
            row
        ]))[0];
    }
    async mine(month) {
        const employeeId = this.org.myEmployeeId();
        const where = {
            employeeId
        };
        if (month) {
            const { from, to } = (0, _timeutils.monthRange)(month);
            where.date = {
                gte: (0, _timeutils.dateOf)(from),
                lte: (0, _timeutils.dateOf)(to)
            };
        }
        return this.rows(await this.prisma.attendanceRegularization.findMany({
            where,
            orderBy: {
                createdAt: 'desc'
            },
            take: 50
        }));
    }
    async cancel(id) {
        const employeeId = this.org.myEmployeeId();
        const r = await this.prisma.attendanceRegularization.findFirst({
            where: {
                id,
                employeeId
            }
        });
        if (!r) throw (0, _errors.notFound)('Correction request');
        if (r.status !== 'PENDING') throw new _errors.AppError(409, 'NOT_PENDING', 'Only pending requests can be cancelled');
        await this.prisma.attendanceRegularization.update({
            where: {
                id
            },
            data: {
                status: 'CANCELLED',
                decidedAt: new Date()
            }
        });
        await this.audit.record({
            action: 'regularization.cancelled',
            entity: 'AttendanceRegularization',
            entityId: id
        });
        return {
            ok: true
        };
    }
    /** Scope: HR (attendance.manage) sees all; others see requests routed to them. */ scopeWhere(ctx) {
        if ((0, _decorators.hasPerm)(ctx, 'attendance.manage')) return {};
        return {
            approverEmployeeId: ctx.employeeId ?? '__none__'
        };
    }
    async list(status) {
        const ctx = (0, _requestcontext.requireContext)();
        const where = {
            ...this.scopeWhere(ctx),
            ...status && status !== 'ALL' ? {
                status
            } : {}
        };
        if (ctx.employeeId) where.employeeId = {
            not: ctx.employeeId
        };
        return this.rows(await this.prisma.attendanceRegularization.findMany({
            where,
            orderBy: [
                {
                    status: 'asc'
                },
                {
                    createdAt: 'desc'
                }
            ],
            take: 100
        }));
    }
    async pendingCount(ctx) {
        const where = {
            status: 'PENDING',
            ...this.scopeWhere(ctx)
        };
        if (ctx.employeeId) where.employeeId = {
            not: ctx.employeeId
        };
        return this.prisma.attendanceRegularization.count({
            where
        });
    }
    async loadForDecision(id) {
        const ctx = (0, _requestcontext.requireContext)();
        const r = await this.prisma.attendanceRegularization.findFirst({
            where: {
                id
            }
        });
        if (!r) throw (0, _errors.notFound)('Correction request');
        if (r.employeeId === ctx.employeeId) throw (0, _errors.forbidden)("You can't decide your own correction request");
        if (!(0, _decorators.hasPerm)(ctx, 'attendance.manage') && r.approverEmployeeId !== ctx.employeeId) throw (0, _errors.forbidden)('This request is not routed to you');
        if (r.status !== 'PENDING') throw new _errors.AppError(409, 'NOT_PENDING', 'This request has already been decided');
        return {
            ctx,
            r
        };
    }
    async approve(id, comment) {
        const { ctx, r } = await this.loadForDecision(id);
        const date = (0, _timeutils.keyOf)(r.date);
        await this.locks.assertOpen(date);
        // Replace conflicting punches: accepted punches on that day in the corrected direction are superseded.
        if (r.requestedIn || r.requestedOut) {
            const sessions = await this.prisma.workSession.findMany({
                where: {
                    employeeId: r.employeeId,
                    attendanceDate: r.date
                },
                orderBy: {
                    startedAt: 'asc'
                }
            });
            const inAt = r.requestedIn ?? sessions[0]?.startedAt ?? null;
            const outAt = r.requestedOut ?? sessions.filter((s)=>s.endedAt && !s.autoClosed).at(-1)?.endedAt ?? null;
            const punchIds = sessions.flatMap((s)=>[
                    s.inPunchId,
                    s.outPunchId
                ].filter((x)=>!!x));
            if (punchIds.length) await this.prisma.attendancePunch.updateMany({
                where: {
                    id: {
                        in: punchIds
                    }
                },
                data: {
                    status: 'SUPERSEDED'
                }
            });
            await this.prisma.workSession.deleteMany({
                where: {
                    employeeId: r.employeeId,
                    attendanceDate: r.date
                }
            });
            if (inAt) {
                const pin = await this.prisma.attendancePunch.create({
                    data: {
                        employeeId: r.employeeId,
                        attendanceDate: r.date,
                        punchedAt: inAt,
                        direction: 'IN',
                        source: 'REGULARIZATION',
                        status: 'ACCEPTED',
                        regularizationId: r.id,
                        createdByName: ctx.userName ?? null
                    }
                });
                let outId = null;
                if (outAt) {
                    const pout = await this.prisma.attendancePunch.create({
                        data: {
                            employeeId: r.employeeId,
                            attendanceDate: r.date,
                            punchedAt: outAt,
                            direction: 'OUT',
                            source: 'REGULARIZATION',
                            status: 'ACCEPTED',
                            regularizationId: r.id,
                            createdByName: ctx.userName ?? null
                        }
                    });
                    outId = pout.id;
                }
                await this.prisma.workSession.create({
                    data: {
                        employeeId: r.employeeId,
                        attendanceDate: r.date,
                        inPunchId: pin.id,
                        outPunchId: outId,
                        startedAt: inAt,
                        endedAt: outAt,
                        source: 'REGULARIZATION'
                    }
                });
            }
        }
        const saved = await this.prisma.attendanceRegularization.update({
            where: {
                id
            },
            data: {
                status: 'APPROVED',
                decidedAt: new Date(),
                decidedByName: ctx.userName ?? null,
                decisionComment: comment ?? null
            }
        });
        await this.attendance.recomputeDay(r.employeeId, date);
        await this.audit.record({
            action: 'regularization.approved',
            entity: 'AttendanceRegularization',
            entityId: id,
            meta: {
                date,
                type: r.type
            }
        });
        await this.notifyEmployee(saved, `Attendance correction for ${(0, _timeutils.dayLabel)(date)} approved`, comment);
        return (await this.rows([
            saved
        ]))[0];
    }
    async reject(id, comment) {
        const { ctx, r } = await this.loadForDecision(id);
        const saved = await this.prisma.attendanceRegularization.update({
            where: {
                id
            },
            data: {
                status: 'REJECTED',
                decidedAt: new Date(),
                decidedByName: ctx.userName ?? null,
                decisionComment: comment
            }
        });
        await this.audit.record({
            action: 'regularization.rejected',
            entity: 'AttendanceRegularization',
            entityId: id,
            meta: {
                date: (0, _timeutils.keyOf)(r.date),
                comment
            }
        });
        await this.notifyEmployee(saved, `Attendance correction for ${(0, _timeutils.dayLabel)((0, _timeutils.keyOf)(r.date))} rejected`, comment);
        return (await this.rows([
            saved
        ]))[0];
    }
    async notifyEmployee(r, title, comment) {
        const ctx = (0, _requestcontext.requireContext)();
        const users = await this.notifications.usersForEmployees([
            r.employeeId
        ]);
        await this.notifications.notify({
            userIds: users,
            type: 'regularization.decided',
            title,
            body: comment ?? undefined,
            link: '/attendance',
            from: ctx.userName ?? 'Manager'
        });
        if (ctx.userId) this.realtime.toUser(ctx.userId, 'approvals.counts', {});
    }
    async rows(list) {
        if (!list.length) return [];
        const empIds = [
            ...new Set(list.flatMap((r)=>[
                    r.employeeId,
                    r.approverEmployeeId
                ].filter((x)=>!!x)))
        ];
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: empIds
                }
            },
            select: {
                id: true,
                fullName: true
            }
        });
        const names = new Map(emps.map((e)=>[
                e.id,
                e.fullName
            ]));
        const out = [];
        for (const r of list){
            const date = (0, _timeutils.keyOf)(r.date);
            const devicePunches = r.status === 'PENDING' ? await this.prisma.attendancePunch.count({
                where: {
                    employeeId: r.employeeId,
                    attendanceDate: r.date,
                    source: {
                        in: [
                            'BIOMETRIC',
                            'DESKTOP'
                        ]
                    },
                    status: 'ACCEPTED',
                    createdAt: {
                        gt: r.createdAt
                    }
                }
            }) > 0 : false;
            out.push({
                id: r.id,
                employeeId: r.employeeId,
                employeeName: names.get(r.employeeId) ?? '—',
                date,
                dateLabel: (0, _timeutils.dayLabel)(date),
                type: r.type,
                typeLabel: _shared.REGULARIZATION_TYPE_LABEL[r.type],
                requestedIn: (0, _timeutils.istHm)(r.requestedIn),
                requestedOut: (0, _timeutils.istHm)(r.requestedOut),
                reason: r.reason,
                status: r.status,
                approverName: r.approverEmployeeId ? names.get(r.approverEmployeeId) ?? null : 'HR',
                decidedByName: r.decidedByName,
                decisionComment: r.decisionComment,
                createdAt: r.createdAt.toISOString(),
                devicePunchesNow: devicePunches
            });
        }
        return out;
    }
};
RegularizationService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _attendanceservice.AttendanceService === "undefined" ? Object : _attendanceservice.AttendanceService,
        typeof _policyservice.PolicyService === "undefined" ? Object : _policyservice.PolicyService,
        typeof _periodlockservice.PeriodLockService === "undefined" ? Object : _periodlockservice.PeriodLockService,
        typeof _cross.CrossReader === "undefined" ? Object : _cross.CrossReader,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _orgservice.OrgService === "undefined" ? Object : _orgservice.OrgService
    ])
], RegularizationService);

//# sourceMappingURL=regularization.service.js.map