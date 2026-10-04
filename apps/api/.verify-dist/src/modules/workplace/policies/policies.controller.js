"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PoliciesController", {
    enumerable: true,
    get: function() {
        return PoliciesController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _http = require("../common/http");
const _policiesservice = require("./policies.service");
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
let PoliciesController = class PoliciesController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    list(q) {
        return this.svc.list(q.tab);
    }
    compliance() {
        return this.svc.compliance();
    }
    holidays(q) {
        return this.svc.holidays(q.year);
    }
    async holidaysPdf(year, res) {
        const f = await this.svc.holidaysPdf(year);
        (0, _http.sendFile)(res, f.data, f.filename, 'application/pdf');
    }
    ack(versionId, dto, ua) {
        return this.svc.acknowledge(versionId, dto.readSeconds, ua ?? null);
    }
    detail(id) {
        return this.svc.detail(id);
    }
    create(dto) {
        return this.svc.create(dto);
    }
    newVersion(id, dto) {
        return this.svc.newVersion(id, dto);
    }
    archive(id) {
        return this.svc.archive(id);
    }
    restore(id) {
        return this.svc.restore(id);
    }
    people(id, q) {
        return this.svc.compliancePeople(id, q.state);
    }
    async csv(id, res) {
        const f = await this.svc.complianceCsv(id);
        (0, _http.sendFile)(res, String.fromCharCode(0xfeff) + f.csv, f.filename, 'text/csv; charset=utf-8');
    }
    remind(id) {
        return this.svc.remind(id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('policies.view'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.policyListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PoliciesController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('compliance'),
    (0, _decorators.RequirePerm)('policies.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], PoliciesController.prototype, "compliance", null);
_ts_decorate([
    (0, _common.Get)('holidays'),
    (0, _decorators.RequirePerm)('policies.view'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.wpHolidaysQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PoliciesController.prototype, "holidays", null);
_ts_decorate([
    (0, _common.Get)('holidays/:year/pdf'),
    (0, _decorators.RequirePerm)('policies.view'),
    _ts_param(0, (0, _common.Param)('year', _common.ParseIntPipe)),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Number,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], PoliciesController.prototype, "holidaysPdf", null);
_ts_decorate([
    (0, _common.Post)('versions/:versionId/ack'),
    (0, _decorators.RequirePerm)('policies.view'),
    _ts_param(0, (0, _common.Param)('versionId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.policyAckSchema.omit({
        versionId: true
    })))),
    _ts_param(2, (0, _common.Headers)('user-agent')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PoliciesController.prototype, "ack", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    (0, _decorators.RequirePerm)('policies.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PoliciesController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('policies.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.policyCreateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof PolicyCreateInput === "undefined" ? Object : PolicyCreateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], PoliciesController.prototype, "create", null);
_ts_decorate([
    (0, _common.Post)(':id/versions'),
    (0, _decorators.RequirePerm)('policies.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.policyVersionSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PoliciesController.prototype, "newVersion", null);
_ts_decorate([
    (0, _common.Post)(':id/archive'),
    (0, _decorators.RequirePerm)('policies.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PoliciesController.prototype, "archive", null);
_ts_decorate([
    (0, _common.Post)(':id/restore'),
    (0, _decorators.RequirePerm)('policies.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PoliciesController.prototype, "restore", null);
_ts_decorate([
    (0, _common.Get)(':id/compliance'),
    (0, _decorators.RequirePerm)('policies.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.policyComplianceQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PoliciesController.prototype, "people", null);
_ts_decorate([
    (0, _common.Get)(':id/compliance/csv'),
    (0, _decorators.RequirePerm)('policies.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], PoliciesController.prototype, "csv", null);
_ts_decorate([
    (0, _common.Post)(':id/remind'),
    (0, _decorators.RequirePerm)('policies.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PoliciesController.prototype, "remind", null);
PoliciesController = _ts_decorate([
    (0, _common.Controller)('policies'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _policiesservice.PoliciesService === "undefined" ? Object : _policiesservice.PoliciesService
    ])
], PoliciesController);

//# sourceMappingURL=policies.controller.js.map