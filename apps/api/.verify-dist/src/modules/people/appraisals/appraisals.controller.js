"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AppraisalsController", {
    enumerable: true,
    get: function() {
        return AppraisalsController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _appraisalsservice = require("./appraisals.service");
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
let AppraisalsController = class AppraisalsController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    cycles() {
        return this.svc.cycles();
    }
    create(dto) {
        return this.svc.createCycle(dto);
    }
    advance(id) {
        return this.svc.advance(id);
    }
    participants(id) {
        return this.svc.participants(id);
    }
    addParticipants(id, dto) {
        return this.svc.addParticipants(id, dto.employeeIds, dto.departmentId);
    }
    updateParticipant(id, dto) {
        return this.svc.updateParticipant(id, dto);
    }
    removeParticipant(id) {
        return this.svc.removeParticipant(id);
    }
    templates() {
        return this.svc.templates();
    }
    createTemplate(dto) {
        return this.svc.createTemplate(dto);
    }
    publish(id) {
        return this.svc.publishTemplate(id);
    }
    mine() {
        return this.svc.mine();
    }
    review(id) {
        return this.svc.review(id);
    }
    save(id, dto) {
        return this.svc.saveReview(id, dto);
    }
    calibrate(id, dto) {
        return this.svc.calibrate(id, dto.score, dto.note);
    }
    acknowledge(id, dto) {
        return this.svc.acknowledge(id, dto.comment);
    }
};
_ts_decorate([
    (0, _common.Get)('cycles'),
    (0, _decorators.RequirePerm)('appraisal.view', 'appraisal.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "cycles", null);
_ts_decorate([
    (0, _common.Post)('cycles'),
    (0, _decorators.RequirePerm)('appraisal.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.appraisalCycleSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof AppraisalCycleInput === "undefined" ? Object : AppraisalCycleInput
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Post)('cycles/:id/advance'),
    (0, _decorators.RequirePerm)('appraisal.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "advance", null);
_ts_decorate([
    (0, _common.Get)('cycles/:id/participants'),
    (0, _decorators.RequirePerm)('appraisal.view', 'appraisal.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "participants", null);
_ts_decorate([
    (0, _common.Post)('cycles/:id/participants'),
    (0, _decorators.RequirePerm)('appraisal.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.addParticipantsSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "addParticipants", null);
_ts_decorate([
    (0, _common.Patch)('participants/:id'),
    (0, _decorators.RequirePerm)('appraisal.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.updateParticipantSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "updateParticipant", null);
_ts_decorate([
    (0, _common.Delete)('participants/:id'),
    (0, _decorators.RequirePerm)('appraisal.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "removeParticipant", null);
_ts_decorate([
    (0, _common.Get)('templates'),
    (0, _decorators.RequirePerm)('appraisal.view', 'appraisal.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "templates", null);
_ts_decorate([
    (0, _common.Post)('templates'),
    (0, _decorators.RequirePerm)('appraisal.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.kraTemplateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof KraTemplateInput === "undefined" ? Object : KraTemplateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "createTemplate", null);
_ts_decorate([
    (0, _common.Post)('templates/:id/publish'),
    (0, _decorators.RequirePerm)('appraisal.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "publish", null);
_ts_decorate([
    (0, _common.Get)('mine'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "mine", null);
_ts_decorate([
    (0, _common.Get)('reviews/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "review", null);
_ts_decorate([
    (0, _common.Put)('reviews/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.appraisalReviewSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof AppraisalReviewInput === "undefined" ? Object : AppraisalReviewInput
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "save", null);
_ts_decorate([
    (0, _common.Post)('reviews/:id/calibrate'),
    (0, _decorators.RequirePerm)('appraisal.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.appraisalCalibrateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "calibrate", null);
_ts_decorate([
    (0, _common.Post)('reviews/:id/acknowledge'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.appraisalAcknowledgeSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AppraisalsController.prototype, "acknowledge", null);
AppraisalsController = _ts_decorate([
    (0, _common.Controller)('appraisals'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _appraisalsservice.AppraisalsService === "undefined" ? Object : _appraisalsservice.AppraisalsService
    ])
], AppraisalsController);

//# sourceMappingURL=appraisals.controller.js.map