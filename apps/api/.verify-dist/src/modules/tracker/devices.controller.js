"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "DevicesController", {
    enumerable: true,
    get: function() {
        return DevicesController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../core/auth/decorators");
const _zodpipe = require("../../core/http/zod.pipe");
const _devicesservice = require("./devices.service");
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
let DevicesController = class DevicesController {
    devices;
    constructor(devices){
        this.devices = devices;
    }
    mine() {
        return this.devices.myDevices();
    }
    /** Preview the pairing request behind a code (hostname, OS, version, permissions). */ lookup(dto) {
        return this.devices.lookup(dto.code);
    }
    /** Owner approves (or rejects) the device showing this code. */ approve(dto) {
        return this.devices.approveByCode(dto.code, dto.decision);
    }
    revoke(id, dto) {
        return this.devices.revoke(id, dto.reason);
    }
    employeeDevices(employeeId) {
        return this.devices.employeeDevices(employeeId);
    }
    list(q) {
        return this.devices.adminList(q);
    }
    hrDecision(id, dto) {
        return this.devices.hrDecision(id, dto.decision, dto.reason);
    }
};
_ts_decorate([
    (0, _common.Get)('me'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], DevicesController.prototype, "mine", null);
_ts_decorate([
    (0, _common.Post)('lookup'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.approveDeviceSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof ApproveDeviceInput === "undefined" ? Object : ApproveDeviceInput
    ]),
    _ts_metadata("design:returntype", void 0)
], DevicesController.prototype, "lookup", null);
_ts_decorate([
    (0, _common.Post)('approve'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.devicePairDecisionSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof DevicePairDecisionInput === "undefined" ? Object : DevicePairDecisionInput
    ]),
    _ts_metadata("design:returntype", void 0)
], DevicesController.prototype, "approve", null);
_ts_decorate([
    (0, _common.Post)(':id/revoke'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.deviceRevokeSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof DeviceRevokeInput === "undefined" ? Object : DeviceRevokeInput
    ]),
    _ts_metadata("design:returntype", void 0)
], DevicesController.prototype, "revoke", null);
_ts_decorate([
    (0, _common.Get)('employee/:employeeId'),
    _ts_param(0, (0, _common.Param)('employeeId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], DevicesController.prototype, "employeeDevices", null);
_ts_decorate([
    (0, _decorators.RequirePerm)('devices.manage'),
    (0, _common.Get)(),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.devicesQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof DevicesQuery === "undefined" ? Object : DevicesQuery
    ]),
    _ts_metadata("design:returntype", void 0)
], DevicesController.prototype, "list", null);
_ts_decorate([
    (0, _decorators.RequirePerm)('devices.manage'),
    (0, _common.Post)(':id/hr-decision'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.deviceHrDecisionSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], DevicesController.prototype, "hrDecision", null);
DevicesController = _ts_decorate([
    (0, _common.UseGuards)(_trackerguards.UserSessionGuard),
    (0, _common.Controller)('devices'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _devicesservice.DevicesService === "undefined" ? Object : _devicesservice.DevicesService
    ])
], DevicesController);

//# sourceMappingURL=devices.controller.js.map