"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "HelpdeskController", {
    enumerable: true,
    get: function() {
        return HelpdeskController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _errors = require("../../../core/http/errors");
const _helpdeskservice = require("./helpdesk.service");
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
const autoCloseSchema = _zod.z.object({
    days: _zod.z.number().int().min(1).max(30)
});
let HelpdeskController = class HelpdeskController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    meta() {
        return this.svc.meta();
    }
    list(q) {
        return this.svc.list(q);
    }
    create(dto) {
        return this.svc.create(dto);
    }
    detail(id) {
        return this.svc.detail(id);
    }
    /** Status / priority / assignee / category — the support desk (or the ticket's group). */ update(id, dto) {
        return this.svc.update(id, dto);
    }
    comment(id, dto) {
        return this.svc.comment(id, dto);
    }
    resolve(id, dto) {
        return this.svc.resolve(id, dto.note);
    }
    reopen(id) {
        return this.svc.reopen(id);
    }
    cancel(id) {
        return this.svc.cancel(id);
    }
    close(id) {
        return this.svc.close(id);
    }
    escalate(id, dto) {
        return this.svc.escalate(id, dto.note);
    }
    csat(id, dto) {
        return this.svc.csat(id, dto.score, dto.comment);
    }
    // ── Settings (helpdesk.agent = helpdesk admin) ───────────────────────────
    settings() {
        return this.svc.settings();
    }
    createGroup(dto) {
        return this.svc.saveGroup(null, dto);
    }
    updateGroup(id, dto) {
        return this.svc.saveGroup(id, dto);
    }
    createCategory(dto) {
        return this.svc.saveCategory(null, dto);
    }
    updateCategory(id, dto) {
        return this.svc.saveCategory(id, dto);
    }
    sla(priority, dto) {
        const p = priority.toUpperCase();
        if (!_shared.HELPDESK_PRIORITIES.includes(p)) throw (0, _errors.badRequest)('Unknown priority');
        return this.svc.saveSla(p, dto);
    }
    autoClose(dto) {
        return this.svc.saveAutoClose(dto.days);
    }
};
_ts_decorate([
    (0, _common.Get)('meta'),
    (0, _decorators.RequirePerm)('helpdesk.use', 'helpdesk.agent'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "meta", null);
_ts_decorate([
    (0, _common.Get)('tickets'),
    (0, _decorators.RequirePerm)('helpdesk.use', 'helpdesk.agent'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.ticketListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)('tickets'),
    (0, _decorators.RequirePerm)('helpdesk.use'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.ticketCreateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof TicketCreateInput === "undefined" ? Object : TicketCreateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)('tickets/:id'),
    (0, _decorators.RequirePerm)('helpdesk.use', 'helpdesk.agent'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Patch)('tickets/:id'),
    (0, _decorators.RequirePerm)('helpdesk.use', 'helpdesk.agent'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.ticketUpdateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)('tickets/:id/comments'),
    (0, _decorators.RequirePerm)('helpdesk.use', 'helpdesk.agent'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.ticketCommentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "comment", null);
_ts_decorate([
    (0, _common.Post)('tickets/:id/resolve'),
    (0, _decorators.RequirePerm)('helpdesk.use', 'helpdesk.agent'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.ticketResolveSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "resolve", null);
_ts_decorate([
    (0, _common.Post)('tickets/:id/reopen'),
    (0, _decorators.RequirePerm)('helpdesk.use'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "reopen", null);
_ts_decorate([
    (0, _common.Post)('tickets/:id/cancel'),
    (0, _decorators.RequirePerm)('helpdesk.use'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "cancel", null);
_ts_decorate([
    (0, _common.Post)('tickets/:id/close'),
    (0, _decorators.RequirePerm)('helpdesk.use', 'helpdesk.agent'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "close", null);
_ts_decorate([
    (0, _common.Post)('tickets/:id/escalate'),
    (0, _decorators.RequirePerm)('helpdesk.use', 'helpdesk.agent'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.ticketEscalateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "escalate", null);
_ts_decorate([
    (0, _common.Post)('tickets/:id/csat'),
    (0, _decorators.RequirePerm)('helpdesk.use'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.ticketCsatSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "csat", null);
_ts_decorate([
    (0, _common.Get)('settings'),
    (0, _decorators.RequirePerm)('helpdesk.agent'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "settings", null);
_ts_decorate([
    (0, _common.Post)('groups'),
    (0, _decorators.RequirePerm)('helpdesk.agent'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.supportGroupSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof SupportGroupInput === "undefined" ? Object : SupportGroupInput
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "createGroup", null);
_ts_decorate([
    (0, _common.Patch)('groups/:id'),
    (0, _decorators.RequirePerm)('helpdesk.agent'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.supportGroupSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof SupportGroupInput === "undefined" ? Object : SupportGroupInput
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "updateGroup", null);
_ts_decorate([
    (0, _common.Post)('categories'),
    (0, _decorators.RequirePerm)('helpdesk.agent'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.ticketCategorySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof TicketCategoryInput === "undefined" ? Object : TicketCategoryInput
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "createCategory", null);
_ts_decorate([
    (0, _common.Patch)('categories/:id'),
    (0, _decorators.RequirePerm)('helpdesk.agent'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.ticketCategorySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof TicketCategoryInput === "undefined" ? Object : TicketCategoryInput
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "updateCategory", null);
_ts_decorate([
    (0, _common.Put)('sla/:priority'),
    (0, _decorators.RequirePerm)('helpdesk.agent'),
    _ts_param(0, (0, _common.Param)('priority')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.slaPolicySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "sla", null);
_ts_decorate([
    (0, _common.Put)('auto-close'),
    (0, _decorators.RequirePerm)('helpdesk.agent'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(autoCloseSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], HelpdeskController.prototype, "autoClose", null);
HelpdeskController = _ts_decorate([
    (0, _common.Controller)('helpdesk'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _helpdeskservice.HelpdeskService === "undefined" ? Object : _helpdeskservice.HelpdeskService
    ])
], HelpdeskController);

//# sourceMappingURL=helpdesk.controller.js.map