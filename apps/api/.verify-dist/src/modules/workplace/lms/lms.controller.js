"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "LmsController", {
    enumerable: true,
    get: function() {
        return LmsController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _certificatesservice = require("../common/certificates.service");
const _http = require("../common/http");
const _lmsservice = require("./lms.service");
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
let LmsController = class LmsController {
    lms;
    certs;
    constructor(lms, certs){
        this.lms = lms;
        this.certs = certs;
    }
    tiles(q) {
        return this.lms.tiles(q.tab);
    }
    manage() {
        return this.lms.manageList();
    }
    detail(id) {
        return this.lms.detail(id);
    }
    enroll(id) {
        return this.lms.enroll(id);
    }
    progress(id, dto) {
        return this.lms.heartbeat(id, dto);
    }
    complete(id) {
        return this.lms.completeLesson(id);
    }
    /** Tile "Download certificate": streams the PDF and marks it downloaded. */ async certificate(id, res) {
        const certId = await this.lms.certificateFor(id);
        const { cert, data } = await this.certs.pdfFor(certId);
        (0, _http.sendFile)(res, data, `${cert.title.replace(/[^\w]+/g, '-')}-${cert.holderName.replace(/[^\w]+/g, '-')}.pdf`, 'application/pdf');
    }
    // ── Manage (lms.manage) ─────────────────────────────────────────────────
    create(dto) {
        return this.lms.create(dto);
    }
    update(id, dto) {
        return this.lms.update(id, dto);
    }
    addLesson(id, dto) {
        return this.lms.addLesson(id, dto);
    }
    reorder(id, dto) {
        return this.lms.reorder(id, dto.lessonIds);
    }
    updateLesson(id, dto) {
        return this.lms.updateLesson(id, dto);
    }
    deleteLesson(id) {
        return this.lms.deleteLesson(id);
    }
    publish(id) {
        return this.lms.publish(id);
    }
    archive(id) {
        return this.lms.archive(id);
    }
    assign(id, dto) {
        return this.lms.addAssignment(id, dto);
    }
    unassign(id) {
        return this.lms.deleteAssignment(id);
    }
    report(id) {
        return this.lms.report(id);
    }
    async reportCsv(id, res) {
        const { filename, csv } = await this.lms.reportCsv(id);
        (0, _http.sendFile)(res, csv, filename, 'text/csv; charset=utf-8');
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('lms.view', 'lms.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.lmsListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "tiles", null);
_ts_decorate([
    (0, _common.Get)('manage'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "manage", null);
_ts_decorate([
    (0, _common.Get)('courses/:id'),
    (0, _decorators.RequirePerm)('lms.view', 'lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)('courses/:id/enroll'),
    (0, _decorators.RequirePerm)('lms.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "enroll", null);
_ts_decorate([
    (0, _common.Post)('lessons/:id/progress'),
    (0, _decorators.RequirePerm)('lms.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.lessonProgressSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "progress", null);
_ts_decorate([
    (0, _common.Post)('lessons/:id/complete'),
    (0, _decorators.RequirePerm)('lms.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "complete", null);
_ts_decorate([
    (0, _common.Get)('enrollments/:id/certificate'),
    (0, _decorators.RequirePerm)('lms.view', 'lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], LmsController.prototype, "certificate", null);
_ts_decorate([
    (0, _common.Post)('courses'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.courseCreateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CourseCreateInput === "undefined" ? Object : CourseCreateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Patch)('courses/:id'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.courseUpdateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)('courses/:id/lessons'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.lessonCreateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "addLesson", null);
_ts_decorate([
    (0, _common.Post)('courses/:id/lessons/reorder'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.lessonReorderSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "reorder", null);
_ts_decorate([
    (0, _common.Patch)('lessons/:id'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.lessonUpdateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "updateLesson", null);
_ts_decorate([
    (0, _common.Delete)('lessons/:id'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "deleteLesson", null);
_ts_decorate([
    (0, _common.Post)('courses/:id/publish'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "publish", null);
_ts_decorate([
    (0, _common.Post)('courses/:id/archive'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "archive", null);
_ts_decorate([
    (0, _common.Post)('courses/:id/assignments'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.courseAssignmentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "assign", null);
_ts_decorate([
    (0, _common.Delete)('assignments/:id'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "unassign", null);
_ts_decorate([
    (0, _common.Get)('courses/:id/report'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LmsController.prototype, "report", null);
_ts_decorate([
    (0, _common.Get)('courses/:id/report.csv'),
    (0, _decorators.RequirePerm)('lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], LmsController.prototype, "reportCsv", null);
LmsController = _ts_decorate([
    (0, _common.Controller)('lms'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _lmsservice.LmsService === "undefined" ? Object : _lmsservice.LmsService,
        typeof _certificatesservice.CertificatesService === "undefined" ? Object : _certificatesservice.CertificatesService
    ])
], LmsController);

//# sourceMappingURL=lms.controller.js.map