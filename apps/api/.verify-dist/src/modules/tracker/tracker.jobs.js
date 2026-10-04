"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "TrackerJobs", {
    enumerable: true,
    get: function() {
        return TrackerJobs;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../core/prisma/prisma.service");
const _eventsservice = require("../../core/registry/events.service");
const _registries = require("../../core/registry/registries");
const _realtimegateway = require("../../core/realtime/realtime.gateway");
const _notificationsservice = require("../../core/notifications/notifications.service");
const _authmiddleware = require("../../core/auth/auth.middleware");
const _filescontroller = require("../../core/storage/files.controller");
const _requestcontext = require("../../core/context/request-context");
const _devicesservice = require("./devices.service");
const _ingestservice = require("./ingest.service");
const _reviewservice = require("./review.service");
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
let TrackerJobs = class TrackerJobs {
    prisma;
    events;
    approvals;
    realtime;
    notifications;
    devices;
    ingest;
    review;
    log = new _common.Logger('TrackerJobs');
    constructor(prisma, events, approvals, realtime, notifications, devices, ingest, review){
        this.prisma = prisma;
        this.events = events;
        this.approvals = approvals;
        this.realtime = realtime;
        this.notifications = notifications;
        this.devices = devices;
        this.ingest = ingest;
        this.review = review;
    }
    onModuleInit() {
        // Revoked / unpaired device tokens stop authenticating immediately.
        _authmiddleware.deviceTokenHooks.isDeviceActive = (deviceId, tenantId)=>this.devices.isDeviceActive(deviceId, tenantId);
        // Screenshot files: owner, RM chain, project lead of the shot's project, admin (not HR).
        _filescontroller.fileAccessCheckers.push(async (fileId)=>{
            const ctx = (0, _requestcontext.getContext)();
            if (!ctx?.userId) return false;
            return this.review.canOpenFile(ctx, fileId);
        });
        // Dashboard "Awaiting your approval": idle claims routed to me.
        this.approvals.register(async (ctx)=>{
            if (!ctx.employeeId) return null;
            const count = await this.review.pendingClaimCount(ctx);
            return count ? {
                key: 'idle-claims',
                label: 'Idle claims',
                count,
                link: '/approvals'
            } : null;
        });
        // ── event consumers ──
        this.events.on('employee.statusChanged', async (p)=>{
            if (p.to === 'EXITED' || p.to === 'SUSPENDED') await this.devices.revokeAllFor(p.employeeId, p.to === 'EXITED' ? 'Employment ended' : 'Employee suspended');
        });
        this.events.on('attendance.punched', async (p)=>{
            const ids = await this.devices.activeDeviceIdsForEmployees([
                p.employeeId
            ]);
            for (const id of ids)this.realtime.toRoom(`d:${id}`, _shared.TRACKER_SOCKET_EVENTS.attendancePunched, {
                direction: p.direction,
                source: p.source,
                at: new Date().toISOString()
            });
        });
        const pushPolicy = async (p)=>{
            const ids = await this.prisma.trackerDevice.findMany({
                where: {
                    status: 'ACTIVE'
                },
                select: {
                    id: true
                }
            });
            for (const d of ids)this.realtime.toRoom(`d:${d.id}`, _shared.TRACKER_SOCKET_EVENTS.policyUpdated, {
                updatedAt: p.updatedAt ?? new Date().toISOString()
            });
        };
        this.events.on('policy.updated', pushPolicy);
        this.events.on('attendance.policyUpdated', pushPolicy);
        this.events.on('task.statusChanged', async (p)=>{
            const t = await this.prisma.task.findUnique({
                where: {
                    id: p.taskId
                },
                select: {
                    assigneeEmployeeId: true
                }
            });
            if (!t?.assigneeEmployeeId) return;
            const ids = await this.devices.activeDeviceIdsForEmployees([
                t.assigneeEmployeeId
            ]);
            for (const id of ids)this.realtime.toRoom(`d:${id}`, _shared.TRACKER_SOCKET_EVENTS.tasksUpdated, {});
        });
        this.events.on('task.assigned', async (p)=>{
            if (!p.assigneeEmployeeId) return;
            const ids = await this.devices.activeDeviceIdsForEmployees([
                p.assigneeEmployeeId
            ]);
            for (const id of ids)this.realtime.toRoom(`d:${id}`, _shared.TRACKER_SOCKET_EVENTS.tasksUpdated, {});
        });
        // An approved timesheet settles any idle claims nobody decided explicitly.
        this.events.on('timesheet.approved', async (p)=>{
            const ws = typeof p.weekStart === 'string' ? p.weekStart.slice(0, 10) : new Date(p.weekStart).toISOString().slice(0, 10);
            await this.review.approvePendingForWeek(p.employeeId, ws);
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
                await (0, _requestcontext.runAsTenant)(t.id, ()=>fn(t.id));
            } catch (e) {
                this.log.error(`${name} failed for tenant ${t.id}: ${e.message}`);
            }
        }
    }
    /** Pairing codes expire after 10 min; AWAITING_HR requests after 72 h. */ async expirePairings() {
        await this.forEachTenant('pairing-expiry', (tid)=>this.devices.expireStale(tid));
    }
    /** Screenshot retention (policy.screenshotRetentionDays → purgeAfter). */ async purgeScreenshots() {
        await this.forEachTenant('screenshot-retention', async ()=>{
            let n = 0;
            do n = await this.ingest.purgeScreenshots();
            while (n === 500)
        });
    }
    /** Nightly: flag days with ≥ 3 missing screenshots. */ async screenshotMissing() {
        const today = (0, _shared.trackerWorkDate)(new Date());
        await this.forEachTenant('screenshot-missing', ()=>this.ingest.screenshotMissingCheck(today));
    }
    /** 10:00 IST digest to reviewers: "4 idle claims awaiting review". */ async claimDigest() {
        await this.forEachTenant('idleclaim-digest', async ()=>{
            const groups = await this.prisma.idleClaim.groupBy({
                by: [
                    'reviewerEmployeeId'
                ],
                where: {
                    status: 'PENDING',
                    reviewerEmployeeId: {
                        not: null
                    }
                },
                _count: {
                    _all: true
                }
            });
            for (const g of groups){
                const users = await this.notifications.usersForEmployees([
                    g.reviewerEmployeeId
                ]);
                const n = g._count._all;
                await this.notifications.notify({
                    userIds: users,
                    type: 'approval',
                    title: `${n} idle claim${n === 1 ? '' : 's'} awaiting review`,
                    body: 'Review them with the timesheet in Approvals.',
                    link: '/approvals',
                    from: 'Lexisora Tracker'
                });
            }
        });
    }
    /** Daily 09:00 IST: devices not seen for 30 days → alert HR. */ async staleDevices() {
        await this.forEachTenant('device-stale', async ()=>{
            const before = new Date(Date.now() - 30 * 86400_000);
            const stale = await this.prisma.trackerDevice.findMany({
                where: {
                    status: 'ACTIVE',
                    lastSeenAt: {
                        lt: before,
                        gte: new Date(before.getTime() - 86400_000)
                    }
                }
            });
            if (!stale.length) return;
            const hr = await this.notifications.usersWithPermission('devices.manage');
            await this.notifications.notify({
                userIds: hr,
                type: 'tracker',
                title: `${stale.length} tracker device${stale.length === 1 ? '' : 's'} not seen for 30 days`,
                body: stale.map((d)=>d.hostname).join(', '),
                link: '/devices?tab=stale',
                from: 'Lexisora Tracker'
            });
        });
    }
    /** Utility for tests / seeds: re-project a week for an employee inside the current tenant. */ async reprojectWeek(employeeId, weekStart) {
        (0, _requestcontext.requireContext)();
        for(let i = 0; i < 7; i++)await this.ingest.projectDay(employeeId, (0, _trackerrules.addDays)(weekStart, i));
    }
};
_ts_decorate([
    (0, _schedule.Cron)('*/1 * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], TrackerJobs.prototype, "expirePairings", null);
_ts_decorate([
    (0, _schedule.Cron)('30 2 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], TrackerJobs.prototype, "purgeScreenshots", null);
_ts_decorate([
    (0, _schedule.Cron)('50 23 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], TrackerJobs.prototype, "screenshotMissing", null);
_ts_decorate([
    (0, _schedule.Cron)('0 10 * * 1-6', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], TrackerJobs.prototype, "claimDigest", null);
_ts_decorate([
    (0, _schedule.Cron)('0 9 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], TrackerJobs.prototype, "staleDevices", null);
TrackerJobs = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _registries.ApprovalCountsService === "undefined" ? Object : _registries.ApprovalCountsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _devicesservice.DevicesService === "undefined" ? Object : _devicesservice.DevicesService,
        typeof _ingestservice.IngestService === "undefined" ? Object : _ingestservice.IngestService,
        typeof _reviewservice.ReviewService === "undefined" ? Object : _reviewservice.ReviewService
    ])
], TrackerJobs);

//# sourceMappingURL=tracker.jobs.js.map