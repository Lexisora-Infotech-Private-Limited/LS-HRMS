"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "NoticesController", {
    enumerable: true,
    get: function() {
        return NoticesController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _noticesservice = require("./notices.service");
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
const publishBody = _zod.z.object({
    force: _zod.z.boolean().default(false)
}).default({});
let NoticesController = class NoticesController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    list(q) {
        return this.svc.list(q);
    }
    unreadCount() {
        return this.svc.unreadCount();
    }
    /** Team / visibility options the signed-in publisher may target. */ audiences() {
        return this.svc.audienceOptions();
    }
    detail(id) {
        return this.svc.detail(id);
    }
    read(id) {
        return this.svc.markRead(id);
    }
    receipts(id) {
        return this.svc.receipts(id);
    }
    remind(id) {
        return this.svc.remindUnread(id);
    }
    create(dto) {
        return this.svc.create(dto);
    }
    update(id, dto) {
        return this.svc.update(id, dto);
    }
    publish(id, b) {
        return this.svc.publish(id, b.force);
    }
    unschedule(id) {
        return this.svc.unschedule(id);
    }
    archive(id) {
        return this.svc.archive(id);
    }
    pin(id) {
        return this.svc.setPinned(id, true);
    }
    unpin(id) {
        return this.svc.setPinned(id, false);
    }
    remove(id) {
        return this.svc.remove(id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('notices.view'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.noticeListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('unread-count'),
    (0, _decorators.RequirePerm)('notices.view'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "unreadCount", null);
_ts_decorate([
    (0, _common.Get)('audiences'),
    (0, _decorators.RequirePerm)('notices.publish.global', 'notices.publish.team'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "audiences", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    (0, _decorators.RequirePerm)('notices.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)(':id/read'),
    (0, _decorators.RequirePerm)('notices.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "read", null);
_ts_decorate([
    (0, _common.Get)(':id/receipts'),
    (0, _decorators.RequirePerm)('notices.publish.global', 'notices.publish.team'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "receipts", null);
_ts_decorate([
    (0, _common.Post)(':id/remind-unread'),
    (0, _decorators.RequirePerm)('notices.publish.global', 'notices.publish.team'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "remind", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('notices.publish.global', 'notices.publish.team'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.noticeUpsertSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof NoticeUpsertInput === "undefined" ? Object : NoticeUpsertInput
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "create", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    (0, _decorators.RequirePerm)('notices.publish.global', 'notices.publish.team'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.noticeUpsertSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof NoticeUpsertInput === "undefined" ? Object : NoticeUpsertInput
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)(':id/publish'),
    (0, _decorators.RequirePerm)('notices.publish.global', 'notices.publish.team'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(publishBody))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "publish", null);
_ts_decorate([
    (0, _common.Post)(':id/unschedule'),
    (0, _decorators.RequirePerm)('notices.publish.global', 'notices.publish.team'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "unschedule", null);
_ts_decorate([
    (0, _common.Post)(':id/archive'),
    (0, _decorators.RequirePerm)('notices.publish.global', 'notices.publish.team'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "archive", null);
_ts_decorate([
    (0, _common.Post)(':id/pin'),
    (0, _decorators.RequirePerm)('notices.publish.global'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "pin", null);
_ts_decorate([
    (0, _common.Delete)(':id/pin'),
    (0, _decorators.RequirePerm)('notices.publish.global'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "unpin", null);
_ts_decorate([
    (0, _common.Delete)(':id'),
    (0, _decorators.RequirePerm)('notices.publish.global', 'notices.publish.team'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], NoticesController.prototype, "remove", null);
NoticesController = _ts_decorate([
    (0, _common.Controller)('notices'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _noticesservice.NoticesService === "undefined" ? Object : _noticesservice.NoticesService
    ])
], NoticesController);

//# sourceMappingURL=notices.controller.js.map