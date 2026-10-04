"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WorkplaceRegistry", {
    enumerable: true,
    get: function() {
        return WorkplaceRegistry;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _prismaservice = require("../../core/prisma/prisma.service");
const _registries = require("../../core/registry/registries");
const _eventsservice = require("../../core/registry/events.service");
const _realtimegateway = require("../../core/realtime/realtime.gateway");
const _notificationsservice = require("../../core/notifications/notifications.service");
const _filescontroller = require("../../core/storage/files.controller");
const _decorators = require("../../core/auth/decorators");
const _requestcontext = require("../../core/context/request-context");
const _audience = require("./common/audience");
const _spine = require("./common/spine");
const _dates = require("./common/dates");
const _dashboardservice = require("./dashboard/dashboard.service");
const _noticesservice = require("./notices/notices.service");
const _feedservice = require("./feed/feed.service");
const _helpdeskservice = require("./helpdesk/helpdesk.service");
const _policiesservice = require("./policies/policies.service");
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
const OPEN_TICKET = [
    'OPEN',
    'IN_PROGRESS',
    'WAITING'
];
let WorkplaceRegistry = class WorkplaceRegistry {
    prisma;
    approvals;
    search;
    events;
    realtime;
    notifications;
    audience;
    spine;
    dashboard;
    notices;
    feed;
    helpdesk;
    policies;
    log = new _common.Logger('Workplace');
    constructor(prisma, approvals, search, events, realtime, notifications, audience, spine, dashboard, notices, feed, helpdesk, policies){
        this.prisma = prisma;
        this.approvals = approvals;
        this.search = search;
        this.events = events;
        this.realtime = realtime;
        this.notifications = notifications;
        this.audience = audience;
        this.spine = spine;
        this.dashboard = dashboard;
        this.notices = notices;
        this.feed = feed;
        this.helpdesk = helpdesk;
        this.policies = policies;
    }
    onModuleInit() {
        // Dashboard "Awaiting your approval" → "Helpdesk escalations N" (agents see all, leads/managers theirs).
        this.approvals.register(async (ctx)=>{
            if (!ctx.employeeId) return null;
            const agent = (0, _decorators.hasPerm)(ctx, 'helpdesk.agent');
            const mgmt = [
                'lead',
                'manager',
                'hr',
                'admin'
            ].includes(ctx.roleKey ?? '');
            if (!agent && !mgmt) return null;
            const count = await this.prisma.helpdeskTicket.count({
                where: {
                    status: {
                        in: [
                            ...OPEN_TICKET
                        ]
                    },
                    escalationLevel: {
                        gt: 0
                    },
                    ...agent ? {} : {
                        escalatedToEmployeeIds: {
                            has: ctx.employeeId
                        }
                    }
                }
            });
            return {
                key: 'helpdesk',
                label: 'Helpdesk escalations',
                count,
                link: '/helpdesk?tab=escalations'
            };
        });
        this.search.register('Notices', async (q, ctx)=>(0, _decorators.hasPerm)(ctx, 'notices.view') ? this.notices.search(q, ctx) : []);
        this.search.register('Feed', async (q, ctx)=>(0, _decorators.hasPerm)(ctx, 'feed.view') ? this.feed.search(q) : []);
        this.search.register('Tickets', async (q, ctx)=>(0, _decorators.hasPerm)(ctx, 'helpdesk.use') || (0, _decorators.hasPerm)(ctx, 'helpdesk.agent') ? this.helpdesk.search(q) : []);
        this.search.register('Policies', async (q, ctx)=>(0, _decorators.hasPerm)(ctx, 'policies.view') ? this.policies.search(q) : []);
        _filescontroller.fileAccessCheckers.push((fileId)=>this.notices.canOpenAttachment(fileId).catch(()=>false));
        _filescontroller.fileAccessCheckers.push((fileId)=>this.feed.canOpenFile(fileId).catch(()=>false));
        _filescontroller.fileAccessCheckers.push((fileId)=>this.policies.canOpenFile(fileId).catch(()=>false));
        _filescontroller.fileAccessCheckers.push((fileId)=>this.helpdesk.canOpenFile(fileId).catch(()=>false));
        // Late joiners receive live notices whose audience now matches them.
        this.events.on('employee.created', async (p)=>{
            if (!p.employeeId) return;
            await this.notices.syncRecipientsFor(p.employeeId);
            await this.policies.materializeForEmployee(p.employeeId);
        });
        this.events.on('employee.statusChanged', async (p)=>{
            if (!p.employeeId || !(p.to === 'ACTIVE' || p.to === 'NOTICE_PERIOD')) return;
            await this.notices.syncRecipientsFor(p.employeeId);
            await this.policies.materializeForEmployee(p.employeeId);
        });
        // Live dashboard refresh (dashboard:invalidate → the web refetches the named sections).
        const refresh = (sections)=>async (p)=>this.push([
                    p.employeeId
                ], sections);
        this.events.on('timesheet.submitted', refresh([
            'todos'
        ]));
        this.events.on('timesheet.returned', refresh([
            'todos'
        ]));
        this.events.on('timesheet.approved', refresh([
            'todos'
        ]));
        this.events.on('leave.decided', refresh([
            'approvals'
        ]));
        this.events.on('task.statusChanged', async (p)=>{
            if (!p.taskId) return;
            const [t] = await this.spine.tasks({
                id: p.taskId
            }, 1);
            if (!t) return;
            const [proj, duty] = await Promise.all([
                this.spine.projects({
                    id: t.projectId
                }),
                this.spine.tasks({
                    projectId: t.projectId,
                    isStanding: true,
                    title: {
                        contains: 'review',
                        mode: 'insensitive'
                    }
                }, 20)
            ]);
            await this.push([
                t.assigneeEmployeeId,
                t.reporterEmployeeId,
                ...proj.map((x)=>x.leadEmployeeId),
                ...duty.map((x)=>x.assigneeEmployeeId)
            ], [
                'todos'
            ]);
        });
    }
    async push(employeeIds, sections) {
        const users = await this.audience.userIds(employeeIds);
        if (users.length) this.realtime.toUsers(users, 'dashboard:invalidate', {
            sections
        });
    }
    async forEachTenant(name, fn) {
        const tenants = await this.prisma.raw.tenant.findMany({
            select: {
                id: true
            }
        }).catch(()=>[]);
        for (const t of tenants){
            try {
                await (0, _requestcontext.runAsTenant)(t.id, fn);
            } catch (e) {
                this.log.error(`${name} failed for tenant ${t.id}: ${e.message}`);
            }
        }
    }
    /** Every minute: scheduled notices whose time has come go live. */ async publishScheduledNotices() {
        await this.forEachTenant('notices.publishScheduled', ()=>this.notices.publishDue());
    }
    /** Every 15 minutes: expire notices past their expiry. */ async expireNotices() {
        await this.forEachTenant('notices.expire', ()=>this.notices.expireDue());
    }
    /** 07:00 IST: birthday / work-anniversary alerts to teammates + a greeting email to the person. */ async celebrationsDaily() {
        await this.forEachTenant('celebrations.daily', ()=>this.sendCelebrations());
    }
    async sendCelebrations() {
        const people = await this.prisma.employee.findMany({
            where: {
                status: {
                    in: [
                        'ACTIVE',
                        'NOTICE_PERIOD'
                    ]
                }
            },
            select: {
                id: true,
                fullName: true,
                firstName: true,
                userId: true,
                departmentId: true,
                dateOfBirth: true,
                joiningDate: true,
                department: {
                    select: {
                        name: true
                    }
                }
            }
        });
        const today = (0, _dashboardservice.celebrationsWithin)(people.map((p)=>({
                id: p.id,
                name: p.fullName,
                dob: p.dateOfBirth,
                joined: p.joiningDate
            })), (0, _dates.todayKey)(), 0);
        const byId = new Map(people.map((p)=>[
                p.id,
                p
            ]));
        for (const c of today){
            const p = byId.get(c.id.split(':')[1]);
            if (!p) continue;
            const projectIds = await this.spine.projectIdsOf(p.id);
            const projectMates = (await Promise.all(projectIds.map((id)=>this.spine.projectEmployeeIds(id)))).flat();
            const mates = new Set([
                ...people.filter((x)=>x.departmentId && x.departmentId === p.departmentId).map((x)=>x.id),
                ...projectMates
            ]);
            mates.delete(p.id);
            const mateUsers = await this.audience.userIds([
                ...mates
            ]);
            const dept = p.department?.name ? ` · ${p.department.name}` : '';
            if (c.kind === 'BIRTHDAY') {
                await this.notifications.notify({
                    userIds: mateUsers,
                    type: 'celebration.birthday',
                    title: `Birthday: ${p.fullName}${dept}`,
                    link: '/dashboard'
                });
                if (p.userId) await this.notifications.notify({
                    userIds: [
                        p.userId
                    ],
                    type: 'celebration.birthday',
                    title: `Happy birthday, ${p.firstName}!`,
                    body: 'Wishing you a wonderful year ahead from all of us.',
                    email: true
                });
            } else {
                const years = c.what.split(' · ')[1] ?? '';
                await this.notifications.notify({
                    userIds: mateUsers,
                    type: 'celebration.anniversary',
                    title: `Work anniversary: ${p.fullName} · ${years}`,
                    link: '/dashboard'
                });
                if (p.userId) await this.notifications.notify({
                    userIds: [
                        p.userId
                    ],
                    type: 'celebration.anniversary',
                    title: `Happy work anniversary, ${p.firstName}! ${years} with us.`,
                    body: 'Thank you for everything you bring to the team.',
                    email: true
                });
            }
        }
        return today.length;
    }
    /** Hourly: town-hall reminders 24 hours and 1 hour before the start. */ async eventReminders() {
        await this.forEachTenant('events.reminder', ()=>this.sendEventReminders());
    }
    async sendEventReminders(now = Date.now()) {
        const rows = await this.prisma.companyEvent.findMany({
            where: {
                kind: 'TOWN_HALL',
                cancelledAt: null,
                startsAt: {
                    gt: new Date(now),
                    lte: new Date(now + 24 * 3_600_000)
                }
            }
        });
        let sent = 0;
        for (const e of rows){
            const mins = (e.startsAt.getTime() - now) / 60_000;
            const window = mins > 23 * 60 ? 'day' : mins <= 60 ? 'hour' : null;
            if (!window) continue;
            const ids = await this.audience.resolve(e.audiences ?? []);
            const users = await this.audience.userIds(ids);
            await this.notifications.notify({
                userIds: users,
                type: 'event.reminder',
                title: `${window === 'day' ? 'Tomorrow' : 'Starting soon'}: ${e.title} · ${(0, _dates.shortTime)(e.startsAt)}`,
                body: e.location ?? undefined,
                link: '/notices?tab=events'
            });
            sent++;
        }
        return sent;
    }
    /** Every 5 minutes: helpdesk SLA monitor (at-risk alerts, L1/L2 escalations). */ async helpdeskSla() {
        await this.forEachTenant('helpdesk.slaMonitor', ()=>this.helpdesk.monitorSla());
    }
    /** Hourly: close resolved tickets after the auto-close window. */ async helpdeskAutoClose() {
        await this.forEachTenant('helpdesk.autoClose', ()=>this.helpdesk.autoClose());
    }
    /** 10:00 IST daily: policy acknowledgement reminders. */ async policyReminders() {
        await this.forEachTenant('policies.ackReminders', ()=>this.policies.sendReminders());
    }
    /** Monday 09:00 IST: overdue acknowledgement digest to HR and reporting managers. */ async policyOverdueDigest() {
        await this.forEachTenant('policies.overdueDigest', ()=>this.policies.overdueDigest());
    }
    /** 03:30 IST: delete personal to-dos completed more than 90 days ago. */ async purgeTodos() {
        await this.forEachTenant('todos.purge', ()=>this.dashboard.purgeOldTodos());
    }
};
_ts_decorate([
    (0, _schedule.Cron)('* * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceRegistry.prototype, "publishScheduledNotices", null);
_ts_decorate([
    (0, _schedule.Cron)('*/15 * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceRegistry.prototype, "expireNotices", null);
_ts_decorate([
    (0, _schedule.Cron)('0 7 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceRegistry.prototype, "celebrationsDaily", null);
_ts_decorate([
    (0, _schedule.Cron)('0 * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceRegistry.prototype, "eventReminders", null);
_ts_decorate([
    (0, _schedule.Cron)('*/5 * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceRegistry.prototype, "helpdeskSla", null);
_ts_decorate([
    (0, _schedule.Cron)('20 * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceRegistry.prototype, "helpdeskAutoClose", null);
_ts_decorate([
    (0, _schedule.Cron)('0 10 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceRegistry.prototype, "policyReminders", null);
_ts_decorate([
    (0, _schedule.Cron)('0 9 * * 1', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceRegistry.prototype, "policyOverdueDigest", null);
_ts_decorate([
    (0, _schedule.Cron)('30 3 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceRegistry.prototype, "purgeTodos", null);
WorkplaceRegistry = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _registries.ApprovalCountsService === "undefined" ? Object : _registries.ApprovalCountsService,
        typeof _registries.SearchService === "undefined" ? Object : _registries.SearchService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _audience.AudienceService === "undefined" ? Object : _audience.AudienceService,
        typeof _spine.SpineReader === "undefined" ? Object : _spine.SpineReader,
        typeof _dashboardservice.DashboardService === "undefined" ? Object : _dashboardservice.DashboardService,
        typeof _noticesservice.NoticesService === "undefined" ? Object : _noticesservice.NoticesService,
        typeof _feedservice.FeedService === "undefined" ? Object : _feedservice.FeedService,
        typeof _helpdeskservice.HelpdeskService === "undefined" ? Object : _helpdeskservice.HelpdeskService,
        typeof _policiesservice.PoliciesService === "undefined" ? Object : _policiesservice.PoliciesService
    ])
], WorkplaceRegistry);

//# sourceMappingURL=workplace.registry.js.map