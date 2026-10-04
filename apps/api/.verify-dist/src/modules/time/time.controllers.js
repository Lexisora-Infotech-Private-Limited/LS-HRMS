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
    get ApprovalsController () {
        return ApprovalsController;
    },
    get AttendanceController () {
        return AttendanceController;
    },
    get BiometricController () {
        return BiometricController;
    },
    get HolidaysController () {
        return HolidaysController;
    },
    get IclockController () {
        return IclockController;
    },
    get IdComplianceController () {
        return IdComplianceController;
    },
    get LocationsController () {
        return LocationsController;
    },
    get PeriodLocksController () {
        return PeriodLocksController;
    },
    get PolicyController () {
        return PolicyController;
    },
    get RegularizationsController () {
        return RegularizationsController;
    },
    get ShiftsController () {
        return ShiftsController;
    },
    get TIME_CONTROLLERS () {
        return TIME_CONTROLLERS;
    },
    get TimesheetsController () {
        return TimesheetsController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../core/auth/decorators");
const _errors = require("../../core/http/errors");
const _zodpipe = require("../../core/http/zod.pipe");
const _orgservice = require("../../core/org/org.service");
const _timeutils = require("./lib/time-utils");
const _approvalservice = require("./services/approval.service");
const _attendanceservice = require("./services/attendance.service");
const _biometricservice = require("./services/biometric.service");
const _idcheckservice = require("./services/idcheck.service");
const _mastersservice = require("./services/masters.service");
const _periodlockservice = require("./services/period-lock.service");
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
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
const dateKey = _zod.z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthKey = _zod.z.string().regex(/^\d{4}-\d{2}$/);
const optDate = (v)=>v && dateKey.safeParse(v).success ? v : undefined;
const optMonth = (v)=>v && monthKey.safeParse(v).success ? v : (0, _timeutils.monthOf)((0, _timeutils.istKeyOf)(new Date()));
let AttendanceController = class AttendanceController {
    attendance;
    idchecks;
    org;
    constructor(attendance, idchecks, org){
        this.attendance = attendance;
        this.idchecks = idchecks;
        this.org = org;
    }
    today() {
        return this.attendance.today(this.org.myEmployeeId());
    }
    async punch(body, req, idem) {
        const employeeId = this.org.myEmployeeId();
        const now = await this.attendance.today(employeeId);
        const direction = body.direction ?? (now.state === 'IN' ? 'OUT' : 'IN');
        const res = await this.attendance.punch({
            employeeId,
            direction,
            source: 'WEB',
            geo: body.lat != null && body.lng != null ? {
                lat: body.lat,
                lng: body.lng,
                accuracyM: body.accuracyM
            } : undefined,
            clientEventId: idem ? idem.slice(0, 80) : null,
            ip: req.ip ?? null,
            userAgent: req.headers['user-agent'] ?? null
        });
        const at = res.direction === 'IN' ? res.session.startedAt : res.session.endedAt ?? new Date();
        const today = await this.attendance.today(employeeId);
        return {
            ok: true,
            direction: res.direction,
            at: at.toISOString(),
            source: 'WEB',
            message: res.direction === 'IN' ? `Punched in at ${(0, _timeutils.istHm)(at)} · web` : 'Punched out · day summary saved',
            today
        };
    }
    myMonth(month) {
        return this.attendance.month(this.org.myEmployeeId(), optMonth(month));
    }
    myTimeline(date) {
        return this.attendance.timeline(this.org.myEmployeeId(), optDate(date) ?? (0, _timeutils.istKeyOf)(new Date()));
    }
    myIdCheck() {
        return this.idchecks.mine(this.org.myEmployeeId());
    }
    /** Effective punch/tracker rules for the signed-in employee (web + tracker refetch on policy.updated). */ myEffective() {
        return this.attendance.effective(this.org.myEmployeeId());
    }
    team(ctx, date) {
        return this.attendance.teamToday(ctx, optDate(date));
    }
    async empMonth(ctx, id, month) {
        await this.attendance.assertCanView(ctx, id);
        return this.attendance.month(id, optMonth(month));
    }
    async empTimeline(ctx, id, date) {
        await this.attendance.assertCanView(ctx, id);
        return this.attendance.timeline(id, optDate(date) ?? (0, _timeutils.istKeyOf)(new Date()));
    }
    /** Profile → Attendance tab (Month | Present | Leave | Idle | Late). */ async empSummary(ctx, id, months) {
        await this.attendance.assertCanView(ctx, id);
        return this.attendance.profileSummary(id, Math.min(24, Math.max(1, Number(months) || 12)));
    }
    override(id, body) {
        return this.attendance.overrideDay(id, body);
    }
    async recompute(body) {
        if (body.to < body.from) throw (0, _errors.badRequest)('To must be on or after From');
        const n = await this.attendance.recomputeRange(body.employeeIds?.length ? body.employeeIds : null, body.from, body.to);
        return {
            ok: true,
            count: n
        };
    }
    payrollInput(month) {
        return this.attendance.payrollInput(optMonth(month));
    }
};
_ts_decorate([
    (0, _common.Get)('me/today'),
    (0, _decorators.RequirePerm)('attendance.self'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], AttendanceController.prototype, "today", null);
_ts_decorate([
    (0, _common.Post)('me/punch'),
    (0, _decorators.RequirePerm)('attendance.self'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.punchSchema))),
    _ts_param(1, (0, _common.Req)()),
    _ts_param(2, (0, _common.Headers)('idempotency-key')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof PunchInput === "undefined" ? Object : PunchInput,
        typeof Request === "undefined" ? Object : Request,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], AttendanceController.prototype, "punch", null);
_ts_decorate([
    (0, _common.Get)('me/month'),
    (0, _decorators.RequirePerm)('attendance.self'),
    _ts_param(0, (0, _common.Query)('month')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], AttendanceController.prototype, "myMonth", null);
_ts_decorate([
    (0, _common.Get)('me/timeline'),
    (0, _decorators.RequirePerm)('attendance.self'),
    _ts_param(0, (0, _common.Query)('date')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], AttendanceController.prototype, "myTimeline", null);
_ts_decorate([
    (0, _common.Get)('me/id-check'),
    (0, _decorators.RequirePerm)('attendance.self'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], AttendanceController.prototype, "myIdCheck", null);
_ts_decorate([
    (0, _common.Get)('me/effective-policy'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], AttendanceController.prototype, "myEffective", null);
_ts_decorate([
    (0, _common.Get)('team'),
    (0, _decorators.RequirePerm)('attendance.team', 'attendance.manage'),
    _ts_param(0, (0, _decorators.Ctx)()),
    _ts_param(1, (0, _common.Query)('date')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof RequestContext === "undefined" ? Object : RequestContext,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], AttendanceController.prototype, "team", null);
_ts_decorate([
    (0, _common.Get)('employees/:id/month'),
    (0, _decorators.RequirePerm)('attendance.self', 'attendance.team', 'attendance.manage'),
    _ts_param(0, (0, _decorators.Ctx)()),
    _ts_param(1, (0, _common.Param)('id')),
    _ts_param(2, (0, _common.Query)('month')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof RequestContext === "undefined" ? Object : RequestContext,
        String,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], AttendanceController.prototype, "empMonth", null);
_ts_decorate([
    (0, _common.Get)('employees/:id/timeline'),
    (0, _decorators.RequirePerm)('attendance.self', 'attendance.team', 'attendance.manage'),
    _ts_param(0, (0, _decorators.Ctx)()),
    _ts_param(1, (0, _common.Param)('id')),
    _ts_param(2, (0, _common.Query)('date')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof RequestContext === "undefined" ? Object : RequestContext,
        String,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], AttendanceController.prototype, "empTimeline", null);
_ts_decorate([
    (0, _common.Get)('employees/:id/summary'),
    _ts_param(0, (0, _decorators.Ctx)()),
    _ts_param(1, (0, _common.Param)('id')),
    _ts_param(2, (0, _common.Query)('months')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof RequestContext === "undefined" ? Object : RequestContext,
        String,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], AttendanceController.prototype, "empSummary", null);
_ts_decorate([
    (0, _common.Patch)('days/:id'),
    (0, _decorators.RequirePerm)('attendance.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.dayOverrideSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof DayOverrideInput === "undefined" ? Object : DayOverrideInput
    ]),
    _ts_metadata("design:returntype", void 0)
], AttendanceController.prototype, "override", null);
_ts_decorate([
    (0, _common.Post)('recompute'),
    (0, _decorators.RequirePerm)('attendance.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.recomputeSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", Promise)
], AttendanceController.prototype, "recompute", null);
_ts_decorate([
    (0, _common.Get)('payroll-input'),
    (0, _decorators.RequirePerm)('attendance.manage', 'payroll.manage'),
    _ts_param(0, (0, _common.Query)('month')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], AttendanceController.prototype, "payrollInput", null);
AttendanceController = _ts_decorate([
    (0, _common.Controller)('attendance'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _attendanceservice.AttendanceService === "undefined" ? Object : _attendanceservice.AttendanceService,
        typeof _idcheckservice.IdCheckService === "undefined" ? Object : _idcheckservice.IdCheckService,
        typeof _orgservice.OrgService === "undefined" ? Object : _orgservice.OrgService
    ])
], AttendanceController);
let BiometricController = class BiometricController {
    bio;
    constructor(bio){
        this.bio = bio;
    }
    devices() {
        return this.bio.devices();
    }
    create(body) {
        return this.bio.createDevice(body);
    }
    update(id, body) {
        return this.bio.updateDevice(id, body);
    }
    remove(id) {
        return this.bio.deleteDevice(id);
    }
    unclaimed() {
        return this.bio.unclaimed();
    }
    enrollments() {
        return this.bio.enrollments();
    }
    enroll(body) {
        return this.bio.setEnrollment(body.employeeId, body.pin);
    }
    logs(deviceId) {
        return this.bio.logs(deviceId || undefined);
    }
    simulate(body) {
        return this.bio.simulate(body);
    }
};
_ts_decorate([
    (0, _common.Get)('devices'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], BiometricController.prototype, "devices", null);
_ts_decorate([
    (0, _common.Post)('devices'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.biometricDeviceSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof BiometricDeviceInput === "undefined" ? Object : BiometricDeviceInput
    ]),
    _ts_metadata("design:returntype", void 0)
], BiometricController.prototype, "create", null);
_ts_decorate([
    (0, _common.Patch)('devices/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.biometricDeviceSchema.partial()))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Partial === "undefined" ? Object : Partial
    ]),
    _ts_metadata("design:returntype", void 0)
], BiometricController.prototype, "update", null);
_ts_decorate([
    (0, _common.Delete)('devices/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], BiometricController.prototype, "remove", null);
_ts_decorate([
    (0, _common.Get)('unclaimed'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], BiometricController.prototype, "unclaimed", null);
_ts_decorate([
    (0, _common.Get)('enrollments'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], BiometricController.prototype, "enrollments", null);
_ts_decorate([
    (0, _common.Put)('enrollments'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.enrollmentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], BiometricController.prototype, "enroll", null);
_ts_decorate([
    (0, _common.Get)('logs'),
    _ts_param(0, (0, _common.Query)('deviceId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], BiometricController.prototype, "logs", null);
_ts_decorate([
    (0, _common.Post)('simulate'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.biometricSimulateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof BiometricSimulateInput === "undefined" ? Object : BiometricSimulateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], BiometricController.prototype, "simulate", null);
BiometricController = _ts_decorate([
    (0, _common.Controller)('attendance/biometric'),
    (0, _decorators.RequirePerm)('attendance.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _biometricservice.BiometricService === "undefined" ? Object : _biometricservice.BiometricService
    ])
], BiometricController);
let IclockController = class IclockController {
    bio;
    constructor(bio){
        this.bio = bio;
    }
    async handshake(sn, req) {
        const d = await this.bio.deviceBySn(sn, req.ip);
        if (!d) return 'OK';
        return this.bio.handshake(d);
    }
    async cdata(sn, table, stamp, req) {
        const d = await this.bio.deviceBySn(sn, req.ip);
        const body = await readRawBody(req);
        if (!d) return 'OK';
        if ((table ?? '').toUpperCase() !== 'ATTLOG') return 'OK';
        const res = await this.bio.ingest(d, body, stamp ?? null);
        return `OK: ${res.received}`;
    }
    async getrequest(sn, req) {
        await this.bio.deviceBySn(sn, req.ip);
        return 'OK';
    }
    devicecmd() {
        return 'OK';
    }
};
_ts_decorate([
    (0, _common.Get)('cdata'),
    (0, _common.Header)('Content-Type', 'text/plain'),
    _ts_param(0, (0, _common.Query)('SN')),
    _ts_param(1, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", Promise)
], IclockController.prototype, "handshake", null);
_ts_decorate([
    (0, _common.Post)('cdata'),
    (0, _common.Header)('Content-Type', 'text/plain'),
    _ts_param(0, (0, _common.Query)('SN')),
    _ts_param(1, (0, _common.Query)('table')),
    _ts_param(2, (0, _common.Query)('Stamp')),
    _ts_param(3, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        Object,
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", Promise)
], IclockController.prototype, "cdata", null);
_ts_decorate([
    (0, _common.Get)('getrequest'),
    (0, _common.Header)('Content-Type', 'text/plain'),
    _ts_param(0, (0, _common.Query)('SN')),
    _ts_param(1, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", Promise)
], IclockController.prototype, "getrequest", null);
_ts_decorate([
    (0, _common.Post)('devicecmd'),
    (0, _common.Header)('Content-Type', 'text/plain'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], IclockController.prototype, "devicecmd", null);
IclockController = _ts_decorate([
    (0, _common.Controller)('attendance/biometric/iclock'),
    (0, _decorators.Public)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _biometricservice.BiometricService === "undefined" ? Object : _biometricservice.BiometricService
    ])
], IclockController);
async function readRawBody(req) {
    const b = req.body;
    if (typeof b === 'string') return b;
    if (Buffer.isBuffer(b)) return b.toString('utf8');
    if (b && typeof b === 'object' && Object.keys(b).length) {
        // urlencoded parser swallowed the body: rebuild "key=value" pairs as lines
        return Object.entries(b).map(([k, v])=>v ? `${k}=${v}` : k).join('\n');
    }
    if (!req.readable) return '';
    return new Promise((resolve)=>{
        const chunks = [];
        req.on('data', (c)=>chunks.push(c));
        req.on('end', ()=>resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', ()=>resolve(''));
    });
}
let ShiftsController = class ShiftsController {
    masters;
    constructor(masters){
        this.masters = masters;
    }
    list() {
        return this.masters.listShifts();
    }
    create(body) {
        return this.masters.createShift(body);
    }
    allocations(shiftId, departmentId) {
        return this.masters.listAllocations({
            shiftId: shiftId || undefined,
            departmentId: departmentId || undefined
        });
    }
    allocate(body) {
        return this.masters.allocate(body);
    }
    deleteAllocation(id) {
        return this.masters.deleteAllocation(id);
    }
    update(id, body) {
        return this.masters.updateShift(id, body);
    }
    archive(id) {
        return this.masters.archiveShift(id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], ShiftsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)(),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.shiftSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof ShiftInput === "undefined" ? Object : ShiftInput
    ]),
    _ts_metadata("design:returntype", void 0)
], ShiftsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)('allocations'),
    _ts_param(0, (0, _common.Query)('shiftId')),
    _ts_param(1, (0, _common.Query)('departmentId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ShiftsController.prototype, "allocations", null);
_ts_decorate([
    (0, _common.Post)('allocate'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.allocateShiftSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof AllocateShiftInput === "undefined" ? Object : AllocateShiftInput
    ]),
    _ts_metadata("design:returntype", void 0)
], ShiftsController.prototype, "allocate", null);
_ts_decorate([
    (0, _common.Delete)('allocations/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ShiftsController.prototype, "deleteAllocation", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.shiftSchema.partial()))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Partial === "undefined" ? Object : Partial
    ]),
    _ts_metadata("design:returntype", void 0)
], ShiftsController.prototype, "update", null);
_ts_decorate([
    (0, _common.Delete)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ShiftsController.prototype, "archive", null);
ShiftsController = _ts_decorate([
    (0, _common.Controller)('shifts'),
    (0, _decorators.RequirePerm)('shifts.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _mastersservice.MastersService === "undefined" ? Object : _mastersservice.MastersService
    ])
], ShiftsController);
let LocationsController = class LocationsController {
    masters;
    constructor(masters){
        this.masters = masters;
    }
    list() {
        return this.masters.listLocations();
    }
    create(body) {
        return this.masters.createLocation(body);
    }
    detail(id) {
        return this.masters.locationDetail(id);
    }
    update(id, body) {
        return this.masters.updateLocation(id, body);
    }
    remove(id) {
        return this.masters.deleteLocation(id);
    }
    assign(id, body) {
        return this.masters.assignLocation(id, body.employeeIds);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], LocationsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)(),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.locationSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof LocationInput === "undefined" ? Object : LocationInput
    ]),
    _ts_metadata("design:returntype", void 0)
], LocationsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LocationsController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.locationSchema.partial()))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Partial === "undefined" ? Object : Partial
    ]),
    _ts_metadata("design:returntype", void 0)
], LocationsController.prototype, "update", null);
_ts_decorate([
    (0, _common.Delete)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LocationsController.prototype, "remove", null);
_ts_decorate([
    (0, _common.Post)(':id/employees'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.assignLocationSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LocationsController.prototype, "assign", null);
LocationsController = _ts_decorate([
    (0, _common.Controller)('locations'),
    (0, _decorators.RequirePerm)('locations.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _mastersservice.MastersService === "undefined" ? Object : _mastersservice.MastersService
    ])
], LocationsController);
let PolicyController = class PolicyController {
    policies;
    attendance;
    org;
    constructor(policies, attendance, org){
        this.policies = policies;
        this.attendance = attendance;
        this.org = org;
    }
    both() {
        return this.policies.both();
    }
    me() {
        return this.attendance.effective(this.org.myEmployeeId());
    }
    update(audience, body) {
        const a = audience.toUpperCase();
        if (a !== 'OFFICE' && a !== 'REMOTE') throw (0, _errors.badRequest)('Audience must be OFFICE or REMOTE');
        return this.policies.update(a, body);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('settings.attendance'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], PolicyController.prototype, "both", null);
_ts_decorate([
    (0, _common.Get)('me'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], PolicyController.prototype, "me", null);
_ts_decorate([
    (0, _common.Patch)(':audience'),
    (0, _decorators.RequirePerm)('settings.attendance'),
    _ts_param(0, (0, _common.Param)('audience')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.policyPatchSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof PolicyPatch === "undefined" ? Object : PolicyPatch
    ]),
    _ts_metadata("design:returntype", void 0)
], PolicyController.prototype, "update", null);
PolicyController = _ts_decorate([
    (0, _common.Controller)('attendance-policy'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _policyservice.PolicyService === "undefined" ? Object : _policyservice.PolicyService,
        typeof _attendanceservice.AttendanceService === "undefined" ? Object : _attendanceservice.AttendanceService,
        typeof _orgservice.OrgService === "undefined" ? Object : _orgservice.OrgService
    ])
], PolicyController);
let HolidaysController = class HolidaysController {
    masters;
    constructor(masters){
        this.masters = masters;
    }
    /** Readable by every signed-in user (leave calendar, dashboard). */ list(year) {
        const y = Number(year) || Number((0, _timeutils.istKeyOf)(new Date()).slice(0, 4));
        return this.masters.listHolidays(y);
    }
    upcoming(from, limit) {
        return this.masters.upcoming(optDate(from), Math.min(20, Math.max(1, Number(limit) || 8)));
    }
    create(body) {
        return this.masters.createHoliday(body);
    }
    import(body) {
        return this.masters.importHolidays(body.year, body.calendar);
    }
    copy(body) {
        return this.masters.copyHolidays(body.fromYear, body.toYear);
    }
    update(id, body) {
        return this.masters.updateHoliday(id, body);
    }
    remove(id) {
        return this.masters.deleteHoliday(id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_param(0, (0, _common.Query)('year')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], HolidaysController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('upcoming'),
    _ts_param(0, (0, _common.Query)('from')),
    _ts_param(1, (0, _common.Query)('limit')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], HolidaysController.prototype, "upcoming", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('holidays.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.holidaySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof HolidayInput === "undefined" ? Object : HolidayInput
    ]),
    _ts_metadata("design:returntype", void 0)
], HolidaysController.prototype, "create", null);
_ts_decorate([
    (0, _common.Post)('import'),
    (0, _decorators.RequirePerm)('holidays.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.holidayImportSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], HolidaysController.prototype, "import", null);
_ts_decorate([
    (0, _common.Post)('copy'),
    (0, _decorators.RequirePerm)('holidays.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.holidayCopySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], HolidaysController.prototype, "copy", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    (0, _decorators.RequirePerm)('holidays.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.holidaySchema.partial()))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Partial === "undefined" ? Object : Partial
    ]),
    _ts_metadata("design:returntype", void 0)
], HolidaysController.prototype, "update", null);
_ts_decorate([
    (0, _common.Delete)(':id'),
    (0, _decorators.RequirePerm)('holidays.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], HolidaysController.prototype, "remove", null);
HolidaysController = _ts_decorate([
    (0, _common.Controller)('holidays'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _mastersservice.MastersService === "undefined" ? Object : _mastersservice.MastersService
    ])
], HolidaysController);
let IdComplianceController = class IdComplianceController {
    ids;
    constructor(ids){
        this.ids = ids;
    }
    summary(date) {
        return this.ids.summary(optDate(date));
    }
    checks(date, wearing) {
        return this.ids.list({
            date: optDate(date),
            wearing
        });
    }
    pending(date) {
        return this.ids.pending(optDate(date));
    }
    log(body) {
        return this.ids.log(body);
    }
    update(id, body) {
        return this.ids.update(id, body.wearing, body.note);
    }
    remind() {
        return this.ids.remindMissing();
    }
};
_ts_decorate([
    (0, _common.Get)('summary'),
    _ts_param(0, (0, _common.Query)('date')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], IdComplianceController.prototype, "summary", null);
_ts_decorate([
    (0, _common.Get)('checks'),
    _ts_param(0, (0, _common.Query)('date')),
    _ts_param(1, (0, _common.Query)('wearing')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], IdComplianceController.prototype, "checks", null);
_ts_decorate([
    (0, _common.Get)('pending'),
    _ts_param(0, (0, _common.Query)('date')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], IdComplianceController.prototype, "pending", null);
_ts_decorate([
    (0, _common.Post)('checks'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.idCheckSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof IdCheckInput === "undefined" ? Object : IdCheckInput
    ]),
    _ts_metadata("design:returntype", void 0)
], IdComplianceController.prototype, "log", null);
_ts_decorate([
    (0, _common.Patch)('checks/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.idCheckPatchSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], IdComplianceController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)('remind'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], IdComplianceController.prototype, "remind", null);
IdComplianceController = _ts_decorate([
    (0, _common.Controller)('id-compliance'),
    (0, _decorators.RequirePerm)('idcompliance.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _idcheckservice.IdCheckService === "undefined" ? Object : _idcheckservice.IdCheckService
    ])
], IdComplianceController);
let RegularizationsController = class RegularizationsController {
    regs;
    constructor(regs){
        this.regs = regs;
    }
    create(body) {
        return this.regs.create(body);
    }
    mine(month) {
        return this.regs.mine(month && monthKey.safeParse(month).success ? month : undefined);
    }
    cancel(id) {
        return this.regs.cancel(id);
    }
    list(status = 'PENDING') {
        return this.regs.list(status.toUpperCase());
    }
    approve(id, body) {
        return this.regs.approve(id, body.comment);
    }
    reject(id, body) {
        return this.regs.reject(id, body.comment);
    }
};
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('attendance.self'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.regularizationSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof RegularizationInput === "undefined" ? Object : RegularizationInput
    ]),
    _ts_metadata("design:returntype", void 0)
], RegularizationsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)('mine'),
    (0, _decorators.RequirePerm)('attendance.self'),
    _ts_param(0, (0, _common.Query)('month')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], RegularizationsController.prototype, "mine", null);
_ts_decorate([
    (0, _common.Post)(':id/cancel'),
    (0, _decorators.RequirePerm)('attendance.self'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], RegularizationsController.prototype, "cancel", null);
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('attendance.regularize.approve', 'attendance.manage'),
    _ts_param(0, (0, _common.Query)('status')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        void 0
    ]),
    _ts_metadata("design:returntype", void 0)
], RegularizationsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)(':id/approve'),
    (0, _decorators.RequirePerm)('attendance.regularize.approve', 'attendance.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.decisionCommentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], RegularizationsController.prototype, "approve", null);
_ts_decorate([
    (0, _common.Post)(':id/reject'),
    (0, _decorators.RequirePerm)('attendance.regularize.approve', 'attendance.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.rejectCommentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], RegularizationsController.prototype, "reject", null);
RegularizationsController = _ts_decorate([
    (0, _common.Controller)('regularizations'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _regularizationservice.RegularizationService === "undefined" ? Object : _regularizationservice.RegularizationService
    ])
], RegularizationsController);
let PeriodLocksController = class PeriodLocksController {
    locks;
    constructor(locks){
        this.locks = locks;
    }
    list() {
        return this.locks.list();
    }
    lock(body) {
        if (body.month > (0, _timeutils.monthOf)((0, _timeutils.istKeyOf)(new Date()))) throw new _errors.AppError(422, 'LOCK_FUTURE', "You can't lock a future month");
        return this.locks.lock(body.month, body.upTo);
    }
    unlock(month, body) {
        return this.locks.unlock(month, body.reason);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], PeriodLocksController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)(),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.periodLockSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], PeriodLocksController.prototype, "lock", null);
_ts_decorate([
    (0, _common.Post)(':month/unlock'),
    _ts_param(0, (0, _common.Param)('month')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.periodUnlockSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], PeriodLocksController.prototype, "unlock", null);
PeriodLocksController = _ts_decorate([
    (0, _common.Controller)('period-locks'),
    (0, _decorators.RequirePerm)('attendance.lock'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _periodlockservice.PeriodLockService === "undefined" ? Object : _periodlockservice.PeriodLockService
    ])
], PeriodLocksController);
let TimesheetsController = class TimesheetsController {
    sheets;
    constructor(sheets){
        this.sheets = sheets;
    }
    myWeek(weekStart) {
        return this.sheets.myWeek(optDate(weekStart));
    }
    mine() {
        return this.sheets.list({
            mine: true
        });
    }
    options() {
        return this.sheets.options();
    }
    list(status, weekStart, employeeId) {
        return this.sheets.list({
            status: status?.toUpperCase(),
            weekStart: optDate(weekStart),
            employeeId: employeeId || undefined
        });
    }
    employeeWeek(ctx, employeeId, weekStart) {
        return this.sheets.weekFor(ctx, employeeId, optDate(weekStart) ?? (0, _timeutils.istKeyOf)(new Date()));
    }
    editCell(id, body) {
        return this.sheets.editCell(id, body);
    }
    addLine(id, body) {
        return this.sheets.addLine(id, body);
    }
    removeLine(id, lineId) {
        return this.sheets.removeLine(id, lineId);
    }
    outsideHours(id, body) {
        return this.sheets.logOutsideHours(id, body);
    }
    deleteOutsideHours(entryId) {
        return this.sheets.deleteOutsideHours(entryId);
    }
    submit(id, body) {
        return this.sheets.submit(id, body);
    }
    recall(id) {
        return this.sheets.recall(id);
    }
    reopen(id, body) {
        return this.sheets.reopen(id, body.reason);
    }
};
_ts_decorate([
    (0, _common.Get)('me/week'),
    (0, _decorators.RequirePerm)('timesheet.self'),
    _ts_param(0, (0, _common.Query)('weekStart')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "myWeek", null);
_ts_decorate([
    (0, _common.Get)('me'),
    (0, _decorators.RequirePerm)('timesheet.self'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "mine", null);
_ts_decorate([
    (0, _common.Get)('options'),
    (0, _decorators.RequirePerm)('timesheet.self'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "options", null);
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('attendance.manage', 'payroll.manage', 'attendance.team', 'timesheet.approve.l2'),
    _ts_param(0, (0, _common.Query)('status')),
    _ts_param(1, (0, _common.Query)('weekStart')),
    _ts_param(2, (0, _common.Query)('employeeId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('employee/:employeeId/week'),
    (0, _decorators.RequirePerm)('attendance.manage', 'payroll.manage', 'attendance.team', 'timesheet.approve.l1', 'timesheet.approve.l2'),
    _ts_param(0, (0, _decorators.Ctx)()),
    _ts_param(1, (0, _common.Param)('employeeId')),
    _ts_param(2, (0, _common.Query)('weekStart')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof RequestContext === "undefined" ? Object : RequestContext,
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "employeeWeek", null);
_ts_decorate([
    (0, _common.Put)(':id/cells'),
    (0, _decorators.RequirePerm)('timesheet.self'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.cellEditSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof CellEditInput === "undefined" ? Object : CellEditInput
    ]),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "editCell", null);
_ts_decorate([
    (0, _common.Post)(':id/lines'),
    (0, _decorators.RequirePerm)('timesheet.self'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.addLineSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof AddLineInput === "undefined" ? Object : AddLineInput
    ]),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "addLine", null);
_ts_decorate([
    (0, _common.Delete)(':id/lines/:lineId'),
    (0, _decorators.RequirePerm)('timesheet.self'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('lineId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "removeLine", null);
_ts_decorate([
    (0, _common.Post)(':id/outside-hours'),
    (0, _decorators.RequirePerm)('timesheet.self'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.outsideHoursSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof OutsideHoursInput === "undefined" ? Object : OutsideHoursInput
    ]),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "outsideHours", null);
_ts_decorate([
    (0, _common.Delete)('outside-hours/:entryId'),
    (0, _decorators.RequirePerm)('timesheet.self'),
    _ts_param(0, (0, _common.Param)('entryId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "deleteOutsideHours", null);
_ts_decorate([
    (0, _common.Post)(':id/submit'),
    (0, _decorators.RequirePerm)('timesheet.self'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.submitTimesheetSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "submit", null);
_ts_decorate([
    (0, _common.Post)(':id/recall'),
    (0, _decorators.RequirePerm)('timesheet.self'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "recall", null);
_ts_decorate([
    (0, _common.Post)(':id/reopen'),
    (0, _decorators.RequirePerm)('timesheet.approve.l2'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.periodUnlockSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], TimesheetsController.prototype, "reopen", null);
TimesheetsController = _ts_decorate([
    (0, _common.Controller)('timesheets'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _timesheetservice.TimesheetService === "undefined" ? Object : _timesheetservice.TimesheetService
    ])
], TimesheetsController);
let ApprovalsController = class ApprovalsController {
    approvals;
    constructor(approvals){
        this.approvals = approvals;
    }
    list(q) {
        return this.approvals.list(q.level, q.status);
    }
    detail(stepId, page, date, taskKey) {
        return this.approvals.detail(stepId, {
            page: Number(page) || 1,
            date: optDate(date),
            taskKey: taskKey || undefined
        });
    }
    approve(stepId, body) {
        return this.approvals.approve(stepId, body);
    }
    sendBack(stepId, body) {
        return this.approvals.returnStep(stepId, body.comment);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.approvalsQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], ApprovalsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)(':stepId'),
    _ts_param(0, (0, _common.Param)('stepId')),
    _ts_param(1, (0, _common.Query)('page')),
    _ts_param(2, (0, _common.Query)('date')),
    _ts_param(3, (0, _common.Query)('taskKey')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ApprovalsController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)(':stepId/approve'),
    _ts_param(0, (0, _common.Param)('stepId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.approveStepSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof ApproveStepInput === "undefined" ? Object : ApproveStepInput
    ]),
    _ts_metadata("design:returntype", void 0)
], ApprovalsController.prototype, "approve", null);
_ts_decorate([
    (0, _common.Post)(':stepId/return'),
    _ts_param(0, (0, _common.Param)('stepId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.returnStepSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], ApprovalsController.prototype, "sendBack", null);
ApprovalsController = _ts_decorate([
    (0, _common.Controller)('timesheet-approvals'),
    (0, _decorators.RequirePerm)('timesheet.approve.l1', 'timesheet.approve.l2'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _approvalservice.ApprovalService === "undefined" ? Object : _approvalservice.ApprovalService
    ])
], ApprovalsController);
const TIME_CONTROLLERS = [
    AttendanceController,
    BiometricController,
    IclockController,
    ShiftsController,
    LocationsController,
    PolicyController,
    HolidaysController,
    IdComplianceController,
    RegularizationsController,
    PeriodLocksController,
    TimesheetsController,
    ApprovalsController
];

//# sourceMappingURL=time.controllers.js.map