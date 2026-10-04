"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "LeaveJobs", {
    enumerable: true,
    get: function() {
        return LeaveJobs;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _requestcontext = require("../../../core/context/request-context");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _auditservice = require("../../../core/audit/audit.service");
const _dates = require("../common/dates");
const _leaveadminservice = require("./leave-admin.service");
const _leaverequestsservice = require("./leave-requests.service");
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
let LeaveJobs = class LeaveJobs {
    prisma;
    admin;
    requests;
    notifications;
    audit;
    log = new _common.Logger('LeaveJobs');
    constructor(prisma, admin, requests, notifications, audit){
        this.prisma = prisma;
        this.admin = admin;
        this.requests = requests;
        this.notifications = notifications;
        this.audit = audit;
    }
    async eachTenant(name, fn) {
        const tenants = await this.prisma.raw.tenant.findMany({
            where: {
                status: 'ACTIVE'
            },
            select: {
                id: true
            }
        });
        for (const t of tenants){
            try {
                await (0, _requestcontext.runAsTenant)(t.id, fn);
            } catch (e) {
                this.log.error(`${name} failed for tenant ${t.id}: ${e.message}`);
            }
        }
    }
    /** 00:30 IST on the 1st: due credit rules (monthly EL 1.5, quarterly, and yearly on 1 Jan) + year-end on 1 Jan. */ async monthlyCredits() {
        const today = (0, _dates.todayKey)();
        await this.eachTenant('leave.credits', async ()=>{
            if (today.slice(5, 10) === '01-01') {
                try {
                    await this.admin.runYearEnd((0, _dates.yearOf)(today) - 1);
                } catch (e) {
                    this.log.warn(`Year-end: ${e.message}`);
                }
            }
            await this.admin.runDueRules(today);
        });
    }
    /** 01:15 IST daily: expire comp-off grants. */ async compOffExpiry() {
        await this.eachTenant('leave.compOffExpiry', ()=>this.admin.expireCompOffs());
    }
    /** 10:00 IST daily: remind approvers of stale requests; escalate past `escalateAfterDays`. */ async reminders() {
        await this.eachTenant('leave.reminders', async ()=>{
            const s = await this.requests.leaveSettings();
            const now = Date.now();
            const pending = await this.prisma.leaveRequest.findMany({
                where: {
                    status: 'PENDING'
                },
                include: {
                    employee: {
                        select: {
                            fullName: true
                        }
                    },
                    leaveType: {
                        select: {
                            name: true
                        }
                    }
                }
            });
            for (const r of pending){
                const ageH = (now - r.createdAt.getTime()) / 3_600_000;
                if (ageH >= s.escalateAfterDays * 24 && r.approverSource !== 'ESCALATED' && r.approverEmployeeId) {
                    const approver = await this.prisma.employee.findUnique({
                        where: {
                            id: r.approverEmployeeId
                        },
                        select: {
                            id: true,
                            managerId: true
                        }
                    });
                    const next = approver ? await this.requests.resolveApprover({
                        id: approver.id,
                        managerId: approver.managerId
                    }) : null;
                    if (next && next.id !== r.employeeId && next.id !== r.approverEmployeeId) {
                        await this.prisma.leaveRequest.update({
                            where: {
                                id: r.id
                            },
                            data: {
                                approverEmployeeId: next.id,
                                approverSource: 'ESCALATED'
                            }
                        });
                        await this.audit.record({
                            action: 'leave.request.escalated',
                            entity: 'LeaveRequest',
                            entityId: r.id,
                            meta: {
                                from: r.approverEmployeeId,
                                to: next.id
                            }
                        });
                        const users = await this.notifications.usersForEmployees([
                            next.id,
                            r.approverEmployeeId,
                            r.employeeId
                        ]);
                        await this.notifications.notify({
                            userIds: users,
                            type: 'leave.escalated',
                            title: `Time-off request escalated: ${r.employee.fullName}`,
                            body: `${r.leaveType.name} request ${r.requestNo} is now with ${next.name}`,
                            link: '/leave?tab=team',
                            email: true
                        });
                        continue;
                    }
                }
                if (ageH >= s.pendingReminderHours) {
                    const users = await this.notifications.usersForEmployees([
                        r.approverEmployeeId
                    ]);
                    await this.notifications.notify({
                        userIds: users,
                        type: 'leave.reminder',
                        title: `Reminder: ${r.employee.fullName}'s time-off request is waiting`,
                        body: `${r.leaveType.name} · ${r.requestNo}`,
                        link: '/leave?tab=team'
                    });
                }
            }
        });
    }
};
_ts_decorate([
    (0, _schedule.Cron)('30 0 1 * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], LeaveJobs.prototype, "monthlyCredits", null);
_ts_decorate([
    (0, _schedule.Cron)('15 1 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], LeaveJobs.prototype, "compOffExpiry", null);
_ts_decorate([
    (0, _schedule.Cron)('0 10 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], LeaveJobs.prototype, "reminders", null);
LeaveJobs = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _leaveadminservice.LeaveAdminService === "undefined" ? Object : _leaveadminservice.LeaveAdminService,
        typeof _leaverequestsservice.LeaveRequestsService === "undefined" ? Object : _leaverequestsservice.LeaveRequestsService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], LeaveJobs);

//# sourceMappingURL=leave.jobs.js.map