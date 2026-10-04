"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WorkplaceHubRegistry", {
    enumerable: true,
    get: function() {
        return WorkplaceHubRegistry;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _prismaservice = require("../../core/prisma/prisma.service");
const _registries = require("../../core/registry/registries");
const _eventsservice = require("../../core/registry/events.service");
const _lookups = require("../../core/lookups/lookups");
const _filescontroller = require("../../core/storage/files.controller");
const _decorators = require("../../core/auth/decorators");
const _requestcontext = require("../../core/context/request-context");
const _chatservice = require("./chat/chat.service");
const _lmsservice = require("./lms/lms.service");
const _facilityservice = require("./facility/facility.service");
const _cctvservice = require("./cctv/cctv.service");
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
let WorkplaceHubRegistry = class WorkplaceHubRegistry {
    prisma;
    search;
    events;
    lookups;
    chat;
    lms;
    facility;
    cctv;
    log = new _common.Logger('WorkplaceHub');
    constructor(prisma, search, events, lookups, chat, lms, facility, cctv){
        this.prisma = prisma;
        this.search = search;
        this.events = events;
        this.lookups = lookups;
        this.chat = chat;
        this.lms = lms;
        this.facility = facility;
        this.cctv = cctv;
    }
    onModuleInit() {
        _filescontroller.fileAccessCheckers.push((fileId)=>this.chat.canOpenFile(fileId).catch(()=>false));
        _filescontroller.fileAccessCheckers.push((fileId)=>this.lms.canOpenFile(fileId).catch(()=>false));
        this.lookups.register('rooms', async ()=>(await this.prisma.room.findMany({
                where: {
                    active: true
                },
                orderBy: {
                    name: 'asc'
                }
            })).map((r)=>({
                    value: r.id,
                    label: r.name
                })));
        this.search.register('Courses', async (q, ctx)=>(0, _decorators.hasPerm)(ctx, 'lms.view') || (0, _decorators.hasPerm)(ctx, 'lms.manage') ? this.lms.search(q) : []);
        const syncEmployee = async (employeeId)=>{
            if (!employeeId) return;
            const emp = await this.prisma.employee.findFirst({
                where: {
                    id: employeeId
                },
                select: {
                    userId: true
                }
            });
            if (emp?.userId) await this.chat.syncFor(emp.userId).catch((e)=>this.log.warn(`chat sync: ${e.message}`));
        };
        this.events.on('employee.created', async (p)=>{
            await syncEmployee(p.employeeId);
            if (p.employeeId) await this.lms.enrollNewEmployee(p.employeeId).catch((e)=>this.log.warn(`lms enroll: ${e.message}`));
        });
        this.events.on('employee.statusChanged', async (p)=>syncEmployee(p.employeeId));
        this.events.on('onboarding.completed', async (p)=>syncEmployee(p.employeeId));
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
    /** Every 5 minutes: end calls nobody is in (or older than 8 hours). */ async reapCalls() {
        await this.forEachTenant('chat.reapCalls', ()=>this.chat.reapCalls());
    }
    /** 09:00 IST: course due / overdue reminders. */ async courseReminders() {
        await this.forEachTenant('lms.dueReminders', ()=>this.lms.dueReminders());
    }
    /** Every 15 minutes: completed bookings, visitor no-shows, auto check-out, PII purge. */ async facilityClose() {
        await this.forEachTenant('facility.closePast', ()=>this.facility.closePast());
    }
    /** Every 30 s (gateway mode only): camera health. */ async cctvHealth() {
        if (this.cctv.gateway.mode !== 'gateway') return;
        await this.forEachTenant('cctv.healthPoll', ()=>this.cctv.healthPoll());
    }
    /** Every minute: close viewing sessions without a heartbeat. */ async cctvReaper() {
        await this.forEachTenant('cctv.sessionReaper', ()=>this.cctv.reapSessions());
    }
};
_ts_decorate([
    (0, _schedule.Cron)('*/5 * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceHubRegistry.prototype, "reapCalls", null);
_ts_decorate([
    (0, _schedule.Cron)('0 9 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceHubRegistry.prototype, "courseReminders", null);
_ts_decorate([
    (0, _schedule.Cron)('*/15 * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceHubRegistry.prototype, "facilityClose", null);
_ts_decorate([
    (0, _schedule.Cron)('*/30 * * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceHubRegistry.prototype, "cctvHealth", null);
_ts_decorate([
    (0, _schedule.Cron)('* * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkplaceHubRegistry.prototype, "cctvReaper", null);
WorkplaceHubRegistry = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _registries.SearchService === "undefined" ? Object : _registries.SearchService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _lookups.LookupsService === "undefined" ? Object : _lookups.LookupsService,
        typeof _chatservice.ChatService === "undefined" ? Object : _chatservice.ChatService,
        typeof _lmsservice.LmsService === "undefined" ? Object : _lmsservice.LmsService,
        typeof _facilityservice.FacilityService === "undefined" ? Object : _facilityservice.FacilityService,
        typeof _cctvservice.CctvService === "undefined" ? Object : _cctvservice.CctvService
    ])
], WorkplaceHubRegistry);

//# sourceMappingURL=workplace-hub.registry.js.map