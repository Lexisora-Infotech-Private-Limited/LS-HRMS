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
    get BoardsController () {
        return BoardsController;
    },
    get TasksController () {
        return TasksController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _tasksservice = require("./tasks.service");
const _boardsservice = require("../boards/boards.service");
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
const cancelBody = _zod.z.object({
    reason: _zod.z.string().trim().max(500).optional()
}).default({});
let TasksController = class TasksController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    create(body) {
        return this.svc.create(body);
    }
    /** The signed-in employee's open tasks (+ internal standing tasks). */ mine() {
        return this.svc.mine();
    }
    detail(id) {
        return this.svc.detail(id);
    }
    update(id, body) {
        return this.svc.update(id, body);
    }
    move(id, body) {
        return this.svc.move(id, body);
    }
    comment(id, body) {
        return this.svc.comment(id, body.body);
    }
    retry(id) {
        return this.svc.retryGit(id);
    }
    cancel(id, body) {
        return this.svc.remove(id, body.reason);
    }
    remove(id) {
        return this.svc.remove(id);
    }
};
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('tasks.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.taskCreateInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof TaskCreateInput === "undefined" ? Object : TaskCreateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], TasksController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)('mine'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], TasksController.prototype, "mine", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    (0, _decorators.RequirePerm)('tasks.board'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TasksController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    (0, _decorators.RequirePerm)('tasks.board'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.taskUpdateInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof TaskUpdateInput === "undefined" ? Object : TaskUpdateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], TasksController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)(':id/move'),
    (0, _decorators.RequirePerm)('tasks.board'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.taskMoveInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof TaskMoveInput === "undefined" ? Object : TaskMoveInput
    ]),
    _ts_metadata("design:returntype", void 0)
], TasksController.prototype, "move", null);
_ts_decorate([
    (0, _common.Post)(':id/comments'),
    (0, _decorators.RequirePerm)('tasks.board'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.taskCommentInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], TasksController.prototype, "comment", null);
_ts_decorate([
    (0, _common.Post)(':id/git/retry'),
    (0, _decorators.RequirePerm)('tasks.board'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TasksController.prototype, "retry", null);
_ts_decorate([
    (0, _common.Post)(':id/cancel'),
    (0, _decorators.RequirePerm)('tasks.board'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(cancelBody))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], TasksController.prototype, "cancel", null);
_ts_decorate([
    (0, _common.Delete)(':id'),
    (0, _decorators.RequirePerm)('tasks.board'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TasksController.prototype, "remove", null);
TasksController = _ts_decorate([
    (0, _common.Controller)('tasks'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _tasksservice.TasksService === "undefined" ? Object : _tasksservice.TasksService
    ])
], TasksController);
let BoardsController = class BoardsController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    view(projectId, departmentId, q) {
        return this.svc.view(projectId, departmentId, !!q.includeDone);
    }
    members(projectId, departmentId) {
        return this.svc.members(projectId, departmentId);
    }
    allocate(projectId, departmentId, body) {
        return this.svc.allocate(projectId, departmentId, body.employeeId);
    }
    revoke(projectId, departmentId, employeeId) {
        return this.svc.revoke(projectId, departmentId, employeeId);
    }
};
_ts_decorate([
    (0, _common.Get)(':projectId/:departmentId'),
    _ts_param(0, (0, _common.Param)('projectId')),
    _ts_param(1, (0, _common.Param)('departmentId')),
    _ts_param(2, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.boardQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], BoardsController.prototype, "view", null);
_ts_decorate([
    (0, _common.Get)(':projectId/:departmentId/members'),
    _ts_param(0, (0, _common.Param)('projectId')),
    _ts_param(1, (0, _common.Param)('departmentId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], BoardsController.prototype, "members", null);
_ts_decorate([
    (0, _common.Post)(':projectId/:departmentId/members'),
    _ts_param(0, (0, _common.Param)('projectId')),
    _ts_param(1, (0, _common.Param)('departmentId')),
    _ts_param(2, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.boardMemberInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], BoardsController.prototype, "allocate", null);
_ts_decorate([
    (0, _common.Delete)(':projectId/:departmentId/members/:employeeId'),
    _ts_param(0, (0, _common.Param)('projectId')),
    _ts_param(1, (0, _common.Param)('departmentId')),
    _ts_param(2, (0, _common.Param)('employeeId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], BoardsController.prototype, "revoke", null);
BoardsController = _ts_decorate([
    (0, _common.Controller)('boards'),
    (0, _decorators.RequirePerm)('tasks.board', 'tasks.viewAllBoards'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _boardsservice.BoardsService === "undefined" ? Object : _boardsservice.BoardsService
    ])
], BoardsController);

//# sourceMappingURL=tasks.controller.js.map