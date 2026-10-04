"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ArchiveController", {
    enumerable: true,
    get: function() {
        return ArchiveController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _archiveservice = require("./archive.service");
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
let ArchiveController = class ArchiveController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    list(q) {
        return this.svc.list(q);
    }
    detail(id) {
        return this.svc.detail(id);
    }
    access(id, body) {
        return this.svc.setAccess(id, body.archiveAccess);
    }
    addDoc(id, body) {
        return this.svc.addDocument(id, body);
    }
    async download(id, docId, res) {
        const { row, data } = await this.svc.download(id, docId);
        res.setHeader('Content-Type', row.mime);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.filename)}"`);
        res.send(data);
    }
    archive(id) {
        return this.svc.archive(id);
    }
    unarchive(id) {
        return this.svc.unarchive(id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.archiveQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ArchiveController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ArchiveController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Patch)(':id/access'),
    (0, _decorators.RequirePerm)('archive.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.archiveAccessInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ArchiveController.prototype, "access", null);
_ts_decorate([
    (0, _common.Post)(':id/documents'),
    (0, _decorators.RequirePerm)('archive.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.projectDocumentInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ArchiveController.prototype, "addDoc", null);
_ts_decorate([
    (0, _common.Get)(':id/documents/:docId/download'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('docId')),
    _ts_param(2, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], ArchiveController.prototype, "download", null);
_ts_decorate([
    (0, _common.Post)(':id/archive'),
    (0, _decorators.RequirePerm)('archive.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ArchiveController.prototype, "archive", null);
_ts_decorate([
    (0, _common.Post)(':id/unarchive'),
    (0, _decorators.RequirePerm)('archive.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ArchiveController.prototype, "unarchive", null);
ArchiveController = _ts_decorate([
    (0, _common.Controller)('archive'),
    (0, _decorators.RequirePerm)('archive.view', 'projects.view'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _archiveservice.ArchiveService === "undefined" ? Object : _archiveservice.ArchiveService
    ])
], ArchiveController);

//# sourceMappingURL=archive.controller.js.map