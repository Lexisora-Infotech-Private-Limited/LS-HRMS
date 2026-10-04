"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "FeedController", {
    enumerable: true,
    get: function() {
        return FeedController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _feedservice = require("./feed.service");
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
let FeedController = class FeedController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    list(q) {
        return this.svc.list(q);
    }
    drafts() {
        return this.svc.drafts();
    }
    sidebar() {
        return this.svc.sidebar();
    }
    get(id) {
        return this.svc.get(id);
    }
    create(dto) {
        return this.svc.create(dto);
    }
    update(id, dto) {
        return this.svc.update(id, dto);
    }
    publish(id) {
        return this.svc.publish(id);
    }
    archive(id) {
        return this.svc.archive(id);
    }
    pin(id, b) {
        return this.svc.setPinned(id, b.pinned);
    }
    remove(id) {
        return this.svc.removeDraft(id);
    }
    like(id) {
        return this.svc.like(id, true);
    }
    unlike(id) {
        return this.svc.like(id, false);
    }
    comments(id) {
        return this.svc.comments(id);
    }
    comment(id, dto) {
        return this.svc.addComment(id, dto.body, dto.parentId);
    }
    deleteComment(id) {
        return this.svc.deleteComment(id);
    }
};
_ts_decorate([
    (0, _common.Get)('posts'),
    (0, _decorators.RequirePerm)('feed.view'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.feedListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('drafts'),
    (0, _decorators.RequirePerm)('feed.publish'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "drafts", null);
_ts_decorate([
    (0, _common.Get)('sidebar'),
    (0, _decorators.RequirePerm)('feed.view'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "sidebar", null);
_ts_decorate([
    (0, _common.Get)('posts/:id'),
    (0, _decorators.RequirePerm)('feed.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "get", null);
_ts_decorate([
    (0, _common.Post)('posts'),
    (0, _decorators.RequirePerm)('feed.publish'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.postUpsertSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof PostUpsertInput === "undefined" ? Object : PostUpsertInput
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "create", null);
_ts_decorate([
    (0, _common.Put)('posts/:id'),
    (0, _decorators.RequirePerm)('feed.publish'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.postUpsertSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof PostUpsertInput === "undefined" ? Object : PostUpsertInput
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)('posts/:id/publish'),
    (0, _decorators.RequirePerm)('feed.publish'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "publish", null);
_ts_decorate([
    (0, _common.Post)('posts/:id/archive'),
    (0, _decorators.RequirePerm)('feed.publish'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "archive", null);
_ts_decorate([
    (0, _common.Post)('posts/:id/pin'),
    (0, _decorators.RequirePerm)('feed.publish'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.feedPinSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "pin", null);
_ts_decorate([
    (0, _common.Delete)('posts/:id'),
    (0, _decorators.RequirePerm)('feed.publish'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "remove", null);
_ts_decorate([
    (0, _common.Put)('posts/:id/like'),
    (0, _decorators.RequirePerm)('feed.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "like", null);
_ts_decorate([
    (0, _common.Delete)('posts/:id/like'),
    (0, _decorators.RequirePerm)('feed.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "unlike", null);
_ts_decorate([
    (0, _common.Get)('posts/:id/comments'),
    (0, _decorators.RequirePerm)('feed.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "comments", null);
_ts_decorate([
    (0, _common.Post)('posts/:id/comments'),
    (0, _decorators.RequirePerm)('feed.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.postCommentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "comment", null);
_ts_decorate([
    (0, _common.Delete)('comments/:id'),
    (0, _decorators.RequirePerm)('feed.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], FeedController.prototype, "deleteComment", null);
FeedController = _ts_decorate([
    (0, _common.Controller)('feed'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _feedservice.FeedService === "undefined" ? Object : _feedservice.FeedService
    ])
], FeedController);

//# sourceMappingURL=feed.controller.js.map