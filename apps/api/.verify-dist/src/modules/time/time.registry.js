"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "TimeRegistry", {
    enumerable: true,
    get: function() {
        return TimeRegistry;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _prismaservice = require("../../core/prisma/prisma.service");
const _lookups = require("../../core/lookups/lookups");
const _registries = require("../../core/registry/registries");
const _eventsservice = require("../../core/registry/events.service");
const _jobsservice = require("../../core/jobs/jobs.service");
const _decorators = require("../../core/auth/decorators");
const _requestcontext = require("../../core/context/request-context");
const _filescontroller = require("../../core/storage/files.controller");
const _cross = require("./cross");
const _timeutils = require("./lib/time-utils");
const _approvalservice = require("./services/approval.service");
const _attendanceservice = require("./services/attendance.service");
const _idcheckservice = require("./services/idcheck.service");
const _mastersservice = require("./services/masters.service");
const _policyservice = require("./services/policy.service");
const _regularizationservice = require("./services/regularization.service");
const _timesheetservice = require("./services/timesheet.service");
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
let TimeRegistry = class TimeRegistry {
    prisma;
    lookups;
    approvalCounts;
    events;
    jobs;
    cross;
    attendance;
    masters;
    policies;
    sheets;
    approvals;
    regs;
    idchecks;
    log = new _common.Logger('TimeRegistry');
    constructor(prisma, lookups, approvalCounts, events, jobs, cross, attendance, masters, policies, sheets, approvals, regs, idchecks){
        this.prisma = prisma;
        this.lookups = lookups;
        this.approvalCounts = approvalCounts;
        this.events = events;
        this.jobs = jobs;
        this.cross = cross;
        this.attendance = attendance;
        this.masters = masters;
        this.policies = policies;
        this.sheets = sheets;
        this.approvals = approvals;
        this.regs = regs;
        this.idchecks = idchecks;
    }
    onModuleInit() {
        this.lookups.register('shifts', ()=>this.masters.shiftOptions());
        this.lookups.register('locations', ()=>this.masters.locationOptions());
        this.approvalCounts.register(async (ctx)=>{
            if (!(0, _decorators.hasPerm)(ctx, 'timesheet.approve.l1') && !(0, _decorators.hasPerm)(ctx, 'timesheet.approve.l2')) return null;
            const c = await this.approvals.pendingCounts(ctx);
            return {
                key: 'timesheets',
                label: 'Timesheets',
                count: c.l1 + c.l2,
                link: '/approvals'
            };
        });
        this.approvalCounts.register(async (ctx)=>{
            if (!(0, _decorators.hasPerm)(ctx, 'attendance.regularize.approve') && !(0, _decorators.hasPerm)(ctx, 'attendance.manage')) return null;
            return {
                key: 'regularizations',
                label: 'Attendance corrections',
                count: await this.regs.pendingCount(ctx),
                link: '/approvals?tab=corrections'
            };
        });
        _filescontroller.fileAccessCheckers.push((fileId)=>this.idchecks.canOpenPhoto(fileId).catch(()=>false));
        _filescontroller.fileAccessCheckers.push(async (fileId)=>{
            const ctx = (0, _requestcontext.requireContext)();
            const r = await this.prisma.attendanceRegularization.findFirst({
                where: {
                    attachmentFileId: fileId
                },
                select: {
                    employeeId: true,
                    approverEmployeeId: true
                }
            });
            if (!r) return false;
            return r.employeeId === ctx.employeeId || r.approverEmployeeId === ctx.employeeId || (0, _decorators.hasPerm)(ctx, 'attendance.manage');
        });
        this.jobs.register('time.recomputeRange', async (d)=>{
            await this.attendance.recomputeRange(d.employeeIds, d.from, d.to);
        });
        this.jobs.register('time.rebuildTimesheets', async (d)=>{
            await this.sheets.rebuildForDates(d.employeeId, d.dates);
        });
        const onSegments = async (p)=>{
            const dates = [
                ...new Set([
                    ...p.workDates ?? [],
                    ...p.workDate ? [
                        p.workDate
                    ] : []
                ].map((d)=>String(d).slice(0, 10)))
            ];
            if (!p.employeeId || !dates.length) return;
            const today = (0, _timeutils.istKeyOf)(new Date());
            for (const d of dates)if (d <= today) await this.attendance.recomputeDay(p.employeeId, d);
            await this.sheets.rebuildForDates(p.employeeId, dates);
        };
        this.events.on('tracker.segmentsIngested', onSegments);
        this.events.on('idle.claimDecided', onSegments);
        this.events.on('leave.decided', async (p)=>{
            const req = await this.cross.leaveRequest(p.requestId);
            if (!req) return;
            const today = (0, _timeutils.istKeyOf)(new Date());
            const from = (0, _timeutils.keyOf)(req.fromDate);
            const to = (0, _timeutils.keyOf)(req.toDate);
            if (from > today) return;
            await this.attendance.recomputeRange([
                req.employeeId
            ], from, to < today ? to : today);
        });
        this.events.on('employee.created', async (p)=>{
            const e = await this.prisma.employee.findFirst({
                where: {
                    id: p.employeeId
                },
                select: {
                    id: true,
                    shiftId: true,
                    workLocationId: true,
                    workMode: true
                }
            });
            if (!e) return;
            const data = {};
            if (!e.shiftId) {
                const s = await this.policies.defaultShift();
                if (s) data.shiftId = s.id;
            }
            if (!e.workLocationId) {
                const loc = e.workMode === 'REMOTE' ? await this.policies.remoteLocation() : await this.prisma.workLocation.findFirst({
                    where: {
                        isRemote: false,
                        archivedAt: null
                    },
                    orderBy: {
                        createdAt: 'asc'
                    }
                });
                if (loc) data.workLocationId = loc.id;
            }
            if (Object.keys(data).length) await this.prisma.employee.update({
                where: {
                    id: e.id
                },
                data
            });
        });
        this.events.on('payroll.finalized', async (p)=>{
            if (p?.period) await this.sheets.lockForPeriod(p.period);
        });
    }
    async forEachTenant(fn) {
        const tenants = await this.prisma.raw.tenant.findMany({
            select: {
                id: true
            }
        });
        for (const t of tenants){
            try {
                await (0, _requestcontext.runAsTenant)(t.id, fn);
            } catch (e) {
                this.log.error(`tenant ${t.id}: ${e.message}`);
            }
        }
    }
    /** Close sessions left open past shift end + policy.missedPunchAutoCloseHours (default 6 h). */ async autoClose() {
        await this.forEachTenant(()=>this.attendance.autoCloseDue());
    }
    /** Friday 16:00 IST: remind employees to submit this week's timesheet. */ async fridayReminders() {
        await this.forEachTenant(()=>this.sheets.remindUnsubmitted());
    }
    /** Hourly: overdue approval steps. */ async overdueApprovals() {
        await this.forEachTenant(()=>this.approvals.remindOverdue());
    }
    /** 00:30 IST: materialise yesterday's attendance days (absences, weekly offs) for everyone. */ async closeYesterday() {
        const y = (0, _timeutils.addDays)((0, _timeutils.istKeyOf)(new Date()), -1);
        await this.forEachTenant(()=>this.attendance.recomputeRange(null, y, y));
    }
};
_ts_decorate([
    (0, _schedule.Cron)('*/30 * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], TimeRegistry.prototype, "autoClose", null);
_ts_decorate([
    (0, _schedule.Cron)('0 16 * * 5', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], TimeRegistry.prototype, "fridayReminders", null);
_ts_decorate([
    (0, _schedule.Cron)('15 * * * *'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], TimeRegistry.prototype, "overdueApprovals", null);
_ts_decorate([
    (0, _schedule.Cron)('30 0 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], TimeRegistry.prototype, "closeYesterday", null);
TimeRegistry = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _lookups.LookupsService === "undefined" ? Object : _lookups.LookupsService,
        typeof _registries.ApprovalCountsService === "undefined" ? Object : _registries.ApprovalCountsService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _jobsservice.JobsService === "undefined" ? Object : _jobsservice.JobsService,
        typeof _cross.CrossReader === "undefined" ? Object : _cross.CrossReader,
        typeof _attendanceservice.AttendanceService === "undefined" ? Object : _attendanceservice.AttendanceService,
        typeof _mastersservice.MastersService === "undefined" ? Object : _mastersservice.MastersService,
        typeof _policyservice.PolicyService === "undefined" ? Object : _policyservice.PolicyService,
        typeof _timesheetservice.TimesheetService === "undefined" ? Object : _timesheetservice.TimesheetService,
        typeof _approvalservice.ApprovalService === "undefined" ? Object : _approvalservice.ApprovalService,
        typeof _regularizationservice.RegularizationService === "undefined" ? Object : _regularizationservice.RegularizationService,
        typeof _idcheckservice.IdCheckService === "undefined" ? Object : _idcheckservice.IdCheckService
    ])
], TimeRegistry);

//# sourceMappingURL=time.registry.js.map