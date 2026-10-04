"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ProjectsController", {
    enumerable: true,
    get: function() {
        return ProjectsController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _projectsservice = require("./projects.service");
const _workaccessservice = require("../work-access.service");
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
const docsBody = _zod.z.object({
    documents: _zod.z.array(_shared.projectDocumentInput).min(1).max(20)
});
const memberUpdate = _zod.z.object({
    role: _zod.z.enum(_shared.PROJECT_MEMBER_ROLES).optional(),
    allocationPct: _zod.z.number().int().min(0).max(100).nullable().optional()
});
let ProjectsController = class ProjectsController {
    svc;
    access;
    constructor(svc, access){
        this.svc = svc;
        this.access = access;
    }
    list(q) {
        return this.svc.list(q);
    }
    kpis(q) {
        return this.svc.kpis(q.month);
    }
    key(name = '') {
        return this.svc.suggestKey(name);
    }
    create(body) {
        return this.svc.create(body);
    }
    detail(id) {
        return this.svc.detail(id);
    }
    async boards(id) {
        const v = await this.access.viewer();
        const p = await this.access.requireProject(v, id);
        return this.svc.boards(v, p);
    }
    update(id, body) {
        return this.svc.update(id, body);
    }
    status(id, body) {
        return this.svc.setStatus(id, body.status, body.reason, body.cancelRemaining);
    }
    addModule(id, body) {
        return this.svc.addModule(id, body.name, body.estimatedHours);
    }
    updateModule(id, moduleId, body) {
        return this.svc.updateModule(id, moduleId, body);
    }
    removeModule(id, moduleId) {
        return this.svc.removeModule(id, moduleId);
    }
    addMember(id, body) {
        return this.svc.addMember(id, body);
    }
    updateMember(id, memberId, body) {
        return this.svc.updateMember(id, memberId, body);
    }
    removeMember(id, memberId) {
        return this.svc.removeMember(id, memberId);
    }
    addDocs(id, body) {
        return this.svc.addDocuments(id, body.documents);
    }
    removeDoc(id, docId) {
        return this.svc.removeDocument(id, docId);
    }
    link(id) {
        return this.svc.linkGit(id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('projects.view'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.projectListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('kpis'),
    (0, _decorators.RequirePerm)('projects.view'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.projectKpiQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "kpis", null);
_ts_decorate([
    (0, _common.Get)('key-suggestion'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Query)('name')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        void 0
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "key", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.projectCreateInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof ProjectCreateInput === "undefined" ? Object : ProjectCreateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    (0, _decorators.RequirePerm)('projects.view', 'tasks.board'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Get)(':id/boards'),
    (0, _decorators.RequirePerm)('projects.view', 'tasks.board'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], ProjectsController.prototype, "boards", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.projectUpdateInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof ProjectUpdateInput === "undefined" ? Object : ProjectUpdateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)(':id/status'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.projectStatusInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "status", null);
_ts_decorate([
    (0, _common.Post)(':id/modules'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.projectModuleInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "addModule", null);
_ts_decorate([
    (0, _common.Patch)(':id/modules/:moduleId'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('moduleId')),
    _ts_param(2, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.projectModuleUpdateInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "updateModule", null);
_ts_decorate([
    (0, _common.Delete)(':id/modules/:moduleId'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('moduleId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "removeModule", null);
_ts_decorate([
    (0, _common.Post)(':id/members'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.projectMemberInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "addMember", null);
_ts_decorate([
    (0, _common.Patch)(':id/members/:memberId'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('memberId')),
    _ts_param(2, (0, _common.Body)(new _zodpipe.ZodPipe(memberUpdate))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "updateMember", null);
_ts_decorate([
    (0, _common.Delete)(':id/members/:memberId'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('memberId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "removeMember", null);
_ts_decorate([
    (0, _common.Post)(':id/documents'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(docsBody))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "addDocs", null);
_ts_decorate([
    (0, _common.Delete)(':id/documents/:docId'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('docId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "removeDoc", null);
_ts_decorate([
    (0, _common.Post)(':id/git/link'),
    (0, _decorators.RequirePerm)('projects.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ProjectsController.prototype, "link", null);
ProjectsController = _ts_decorate([
    (0, _common.Controller)('projects'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _projectsservice.ProjectsService === "undefined" ? Object : _projectsservice.ProjectsService,
        typeof _workaccessservice.WorkAccessService === "undefined" ? Object : _workaccessservice.WorkAccessService
    ])
], ProjectsController);

//# sourceMappingURL=projects.controller.js.map