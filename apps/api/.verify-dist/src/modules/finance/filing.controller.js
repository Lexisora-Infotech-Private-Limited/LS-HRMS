"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "FilingController", {
    enumerable: true,
    get: function() {
        return FilingController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../core/auth/decorators");
const _zodpipe = require("../../core/http/zod.pipe");
const _filingservice = require("./filing.service");
const _complianceservice = require("./compliance.service");
const _ledgercontroller = require("./ledger.controller");
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
const unfileSchema = _zod.z.object({
    form: _zod.z.enum(_shared.FIN_COMPLIANCE_FORMS),
    period: _zod.z.string().trim().min(4).max(20)
});
let FilingController = class FilingController {
    filing;
    compliance;
    constructor(filing, compliance){
        this.filing = filing;
        this.compliance = compliance;
    }
    folders() {
        return this.filing.tiles();
    }
    createFolder(dto) {
        return this.filing.createFolder(dto.name, dto.parentId);
    }
    folder(id, q) {
        return this.filing.folder(id, q);
    }
    async deleteFolder(id) {
        await this.filing.deleteFolder(id);
        return {
            ok: true
        };
    }
    /** Search across every folder (title, tag, linked reference). */ search(q) {
        return this.filing.search(q);
    }
    upload(dto) {
        return this.filing.upload(dto);
    }
    update(id, dto) {
        return this.filing.update(id, dto);
    }
    async remove(id) {
        await this.filing.remove(id);
        return {
            ok: true
        };
    }
    async download(id, res, inline) {
        const f = await this.filing.download(id);
        (0, _ledgercontroller.sendBytes)(res, f.data, f.filename, f.mime, inline === '1');
    }
    calendar() {
        return this.compliance.calendar();
    }
    markFiled(dto) {
        return this.compliance.markFiled(dto);
    }
    unmarkFiled(dto) {
        return this.compliance.unmarkFiled(dto.form, dto.period);
    }
    gstReturns() {
        return this.compliance.gstReturns(6);
    }
};
_ts_decorate([
    (0, _common.Get)('folders'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], FilingController.prototype, "folders", null);
_ts_decorate([
    (0, _common.Post)('folders'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finCreateFolderSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FilingController.prototype, "createFolder", null);
_ts_decorate([
    (0, _common.Get)('folders/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.filingDocsQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FilingController.prototype, "folder", null);
_ts_decorate([
    (0, _common.Delete)('folders/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], FilingController.prototype, "deleteFolder", null);
_ts_decorate([
    (0, _common.Get)('documents'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.filingDocsQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FilingController.prototype, "search", null);
_ts_decorate([
    (0, _common.Post)('documents'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finUploadDocumentsSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FilingController.prototype, "upload", null);
_ts_decorate([
    (0, _common.Patch)('documents/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finUpdateDocumentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FilingController.prototype, "update", null);
_ts_decorate([
    (0, _common.Delete)('documents/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], FilingController.prototype, "remove", null);
_ts_decorate([
    (0, _common.Get)('documents/:id/download'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_param(2, (0, _common.Query)('inline')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], FilingController.prototype, "download", null);
_ts_decorate([
    (0, _common.Get)('compliance'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], FilingController.prototype, "calendar", null);
_ts_decorate([
    (0, _common.Post)('compliance/filed'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finMarkFiledSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof FinMarkFiledInput === "undefined" ? Object : FinMarkFiledInput
    ]),
    _ts_metadata("design:returntype", void 0)
], FilingController.prototype, "markFiled", null);
_ts_decorate([
    (0, _common.Post)('compliance/unfiled'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(unfileSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], FilingController.prototype, "unmarkFiled", null);
_ts_decorate([
    (0, _common.Get)('gst-returns'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], FilingController.prototype, "gstReturns", null);
FilingController = _ts_decorate([
    (0, _common.Controller)('filing'),
    (0, _decorators.RequirePerm)('filing.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _filingservice.FilingService === "undefined" ? Object : _filingservice.FilingService,
        typeof _complianceservice.ComplianceService === "undefined" ? Object : _complianceservice.ComplianceService
    ])
], FilingController);

//# sourceMappingURL=filing.controller.js.map