"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "InternsController", {
    enumerable: true,
    get: function() {
        return InternsController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _zodpipe = require("../../../core/http/zod.pipe");
const _internsservice = require("./interns.service");
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
const weekQuery = _zod.z.object({
    weekStart: _zod.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});
let InternsController = class InternsController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    context() {
        return this.svc.context();
    }
    sheet(q) {
        return this.svc.sheet(q);
    }
    assign(body) {
        return this.svc.assign(body);
    }
    update(id, body) {
        return this.svc.update(id, body);
    }
    remove(id) {
        return this.svc.remove(id);
    }
    carry(id) {
        return this.svc.carryOver(id);
    }
    week(internId, q) {
        return this.svc.week(internId, q.weekStart);
    }
    score(internId, body) {
        return this.svc.setWeekScore(internId, {
            weekStart: body.weekStart,
            score: body.score,
            feedback: body.feedback
        });
    }
};
_ts_decorate([
    (0, _common.Get)('context'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], InternsController.prototype, "context", null);
_ts_decorate([
    (0, _common.Get)('sheet'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.internSheetQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InternsController.prototype, "sheet", null);
_ts_decorate([
    (0, _common.Post)('tasks'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.internTaskInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof InternTaskInput === "undefined" ? Object : InternTaskInput
    ]),
    _ts_metadata("design:returntype", void 0)
], InternsController.prototype, "assign", null);
_ts_decorate([
    (0, _common.Patch)('tasks/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.internTaskUpdateInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof InternTaskUpdateInput === "undefined" ? Object : InternTaskUpdateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], InternsController.prototype, "update", null);
_ts_decorate([
    (0, _common.Delete)('tasks/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], InternsController.prototype, "remove", null);
_ts_decorate([
    (0, _common.Post)('tasks/:id/carry-over'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], InternsController.prototype, "carry", null);
_ts_decorate([
    (0, _common.Get)(':internId/week'),
    _ts_param(0, (0, _common.Param)('internId')),
    _ts_param(1, (0, _common.Query)(new _zodpipe.ZodPipe(weekQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InternsController.prototype, "week", null);
_ts_decorate([
    (0, _common.Put)(':internId/week-score'),
    _ts_param(0, (0, _common.Param)('internId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.internWeekScoreInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InternsController.prototype, "score", null);
InternsController = _ts_decorate([
    (0, _common.Controller)('interns'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _internsservice.InternsService === "undefined" ? Object : _internsservice.InternsService
    ])
], InternsController);

//# sourceMappingURL=interns.controller.js.map