"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "GitController", {
    enumerable: true,
    get: function() {
        return GitController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _gitservice = require("./git.service");
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
let GitController = class GitController {
    git;
    constructor(git){
        this.git = git;
    }
    view() {
        return this.git.view();
    }
    save(body) {
        return this.git.save(body);
    }
    test() {
        return this.git.test();
    }
    rotate() {
        return this.git.rotateSecret();
    }
    /** GitLab project/group webhook (push, merge request, pipeline). Verified by X-Gitlab-Token. */ webhook(token, event, uuid, payload) {
        return this.git.receiveWebhook({
            token,
            event,
            uuid
        }, payload);
    }
};
_ts_decorate([
    (0, _common.Get)('integration'),
    (0, _decorators.RequirePerm)('git.manage', 'projects.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], GitController.prototype, "view", null);
_ts_decorate([
    (0, _common.Put)('integration'),
    (0, _decorators.RequirePerm)('git.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.gitIntegrationInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], GitController.prototype, "save", null);
_ts_decorate([
    (0, _common.Post)('integration/test'),
    (0, _decorators.RequirePerm)('git.manage', 'projects.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], GitController.prototype, "test", null);
_ts_decorate([
    (0, _common.Post)('integration/rotate-secret'),
    (0, _decorators.RequirePerm)('git.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], GitController.prototype, "rotate", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('webhook'),
    (0, _common.HttpCode)(202),
    _ts_param(0, (0, _common.Headers)('x-gitlab-token')),
    _ts_param(1, (0, _common.Headers)('x-gitlab-event')),
    _ts_param(2, (0, _common.Headers)('x-gitlab-event-uuid')),
    _ts_param(3, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object,
        Object,
        Object,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], GitController.prototype, "webhook", null);
GitController = _ts_decorate([
    (0, _common.Controller)('git'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _gitservice.GitService === "undefined" ? Object : _gitservice.GitService
    ])
], GitController);

//# sourceMappingURL=git.controller.js.map