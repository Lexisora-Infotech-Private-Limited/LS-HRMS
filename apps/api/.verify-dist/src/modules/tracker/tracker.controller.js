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
    get TrackerDeviceController () {
        return TrackerDeviceController;
    },
    get TrackerReviewController () {
        return TrackerReviewController;
    }
});
const _common = require("@nestjs/common");
const _platformexpress = require("@nestjs/platform-express");
const _multer = require("multer");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../core/auth/decorators");
const _requestcontext = require("../../core/context/request-context");
const _zodpipe = require("../../core/http/zod.pipe");
const _devicesservice = require("./devices.service");
const _ingestservice = require("./ingest.service");
const _reviewservice = require("./review.service");
const _trackercontextservice = require("./tracker-context.service");
const _trackerguards = require("./tracker.guards");
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
const integrityQuery = _zod.z.object({
    employeeId: _zod.z.string().min(1),
    week: _zod.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});
const ackSchema = _zod.z.object({
    comment: _zod.z.string().trim().max(500).optional()
});
let TrackerDeviceController = class TrackerDeviceController {
    devices;
    ingest;
    tctx;
    constructor(devices, ingest, tctx){
        this.devices = devices;
        this.ingest = ingest;
        this.tctx = tctx;
    }
    // ── sign-in & pairing ─────────────────────────────────────────────────
    login(dto, req) {
        return this.devices.login(dto, req.ip);
    }
    pairStart(dto, req) {
        return this.devices.pairStart((0, _trackerguards.pairingTokenOf)(req), dto);
    }
    pairStatus(req) {
        return this.devices.pairStatus((0, _trackerguards.pairingTokenOf)(req));
    }
    pairCancel(req) {
        return this.devices.pairCancel((0, _trackerguards.pairingTokenOf)(req));
    }
    // ── device data plane ─────────────────────────────────────────────────
    async policy(req) {
        const ctx = (0, _requestcontext.requireContext)();
        void this.devices.touch((0, _trackerguards.deviceIdOf)(req));
        return this.tctx.policyFor(ctx.employeeId);
    }
    tasks() {
        return this.ingest.tasks((0, _requestcontext.requireContext)().employeeId);
    }
    today(req) {
        void this.devices.touch((0, _trackerguards.deviceIdOf)(req));
        return this.ingest.today((0, _requestcontext.requireContext)().employeeId);
    }
    punch(dto, req) {
        return this.ingest.punch((0, _trackerguards.deviceIdOf)(req), (0, _requestcontext.requireContext)().employeeId, dto);
    }
    sync(dto, req) {
        return this.ingest.sync((0, _trackerguards.deviceIdOf)(req), (0, _requestcontext.requireContext)().employeeId, dto);
    }
    screenshot(file, meta, req) {
        const ctx = (0, _requestcontext.requireContext)();
        return this.ingest.uploadScreenshot((0, _trackerguards.deviceIdOf)(req), ctx.employeeId, ctx.userId, file, meta);
    }
    heartbeat(dto, req) {
        return this.devices.heartbeat((0, _trackerguards.deviceIdOf)(req), (0, _requestcontext.requireContext)().employeeId, dto);
    }
    confirm(date) {
        return this.ingest.confirmDay((0, _requestcontext.requireContext)().employeeId, date);
    }
    unpair(req) {
        return this.devices.unpairCurrent((0, _trackerguards.deviceIdOf)(req));
    }
};
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('auth/login'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.trackerLoginSchema))),
    _ts_param(1, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof TrackerLoginInput === "undefined" ? Object : TrackerLoginInput,
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "login", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('pair/start'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.pairStartSchema))),
    _ts_param(1, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof PairStartInput === "undefined" ? Object : PairStartInput,
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "pairStart", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Get)('pair/status'),
    _ts_param(0, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "pairStatus", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('pair/cancel'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "pairCancel", null);
_ts_decorate([
    (0, _common.UseGuards)(_trackerguards.DeviceOnlyGuard),
    (0, _common.Get)('policy'),
    _ts_param(0, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", Promise)
], TrackerDeviceController.prototype, "policy", null);
_ts_decorate([
    (0, _common.UseGuards)(_trackerguards.DeviceOnlyGuard),
    (0, _common.Get)('tasks'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "tasks", null);
_ts_decorate([
    (0, _common.UseGuards)(_trackerguards.DeviceOnlyGuard),
    (0, _common.Get)('today'),
    _ts_param(0, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "today", null);
_ts_decorate([
    (0, _common.UseGuards)(_trackerguards.DeviceOnlyGuard),
    (0, _common.Post)('punch'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.trackerPunchSchema))),
    _ts_param(1, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof TrackerPunchInput === "undefined" ? Object : TrackerPunchInput,
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "punch", null);
_ts_decorate([
    (0, _common.UseGuards)(_trackerguards.DeviceOnlyGuard),
    (0, _common.Post)('sync'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.trackerBatchSchema))),
    _ts_param(1, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof TrackerBatch === "undefined" ? Object : TrackerBatch,
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "sync", null);
_ts_decorate([
    (0, _common.UseGuards)(_trackerguards.DeviceOnlyGuard),
    (0, _common.Post)('screenshots'),
    (0, _common.HttpCode)(200),
    (0, _common.UseInterceptors)((0, _platformexpress.FileInterceptor)('file', {
        storage: (0, _multer.memoryStorage)(),
        limits: {
            fileSize: 15 * 1024 * 1024
        }
    })),
    _ts_param(0, (0, _common.UploadedFile)()),
    _ts_param(1, (0, _common.Body)('meta')),
    _ts_param(2, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object,
        Object,
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "screenshot", null);
_ts_decorate([
    (0, _common.UseGuards)(_trackerguards.DeviceOnlyGuard),
    (0, _common.Post)('heartbeat'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.trackerHeartbeatSchema))),
    _ts_param(1, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof TrackerHeartbeatInput === "undefined" ? Object : TrackerHeartbeatInput,
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "heartbeat", null);
_ts_decorate([
    (0, _common.UseGuards)(_trackerguards.DeviceOnlyGuard),
    (0, _common.Post)('days/:date/confirm'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('date')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "confirm", null);
_ts_decorate([
    (0, _common.UseGuards)(_trackerguards.DeviceOnlyGuard),
    (0, _common.Post)('unpair'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Req)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof Request === "undefined" ? Object : Request
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerDeviceController.prototype, "unpair", null);
TrackerDeviceController = _ts_decorate([
    (0, _common.Controller)('tracker'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _devicesservice.DevicesService === "undefined" ? Object : _devicesservice.DevicesService,
        typeof _ingestservice.IngestService === "undefined" ? Object : _ingestservice.IngestService,
        typeof _trackercontextservice.TrackerContextService === "undefined" ? Object : _trackercontextservice.TrackerContextService
    ])
], TrackerDeviceController);
let TrackerReviewController = class TrackerReviewController {
    review;
    constructor(review){
        this.review = review;
    }
    claims(q) {
        return this.review.listClaims(q);
    }
    decide(id, dto) {
        return this.review.decideClaim(id, dto);
    }
    screenshots(q) {
        return this.review.listScreenshots(q);
    }
    summaries(q) {
        return this.review.daySummaries(q);
    }
    integrity(q) {
        return this.review.integrity(q.employeeId, q.week);
    }
    acknowledge(id, dto) {
        return this.review.acknowledge(id, dto.comment);
    }
};
_ts_decorate([
    (0, _common.Get)('idle-claims'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.idleClaimsQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof IdleClaimsQuery === "undefined" ? Object : IdleClaimsQuery
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerReviewController.prototype, "claims", null);
_ts_decorate([
    (0, _common.Post)('idle-claims/:id/decide'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.idleClaimDecideSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof IdleClaimDecideInput === "undefined" ? Object : IdleClaimDecideInput
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerReviewController.prototype, "decide", null);
_ts_decorate([
    (0, _common.Get)('screenshots'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.screenshotsQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof ScreenshotsQuery === "undefined" ? Object : ScreenshotsQuery
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerReviewController.prototype, "screenshots", null);
_ts_decorate([
    (0, _common.Get)('day-summaries'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.daySummariesQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof DaySummariesQuery === "undefined" ? Object : DaySummariesQuery
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerReviewController.prototype, "summaries", null);
_ts_decorate([
    (0, _common.Get)('integrity'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(integrityQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerReviewController.prototype, "integrity", null);
_ts_decorate([
    (0, _decorators.RequirePerm)('timesheet.approve.l1', 'timesheet.approve.l2', 'attendance.manage', 'attendance.team'),
    (0, _common.Post)('integrity/:id/ack'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(ackSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], TrackerReviewController.prototype, "acknowledge", null);
TrackerReviewController = _ts_decorate([
    (0, _common.UseGuards)(_trackerguards.UserSessionGuard),
    (0, _common.Controller)('tracker'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _reviewservice.ReviewService === "undefined" ? Object : _reviewservice.ReviewService
    ])
], TrackerReviewController);

//# sourceMappingURL=tracker.controller.js.map