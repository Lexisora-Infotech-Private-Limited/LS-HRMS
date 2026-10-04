"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AuditLogController", {
    enumerable: true,
    get: function() {
        return AuditLogController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _errors = require("../../../core/http/errors");
const _auditservice = require("../../../core/audit/audit.service");
const _auditlogservice = require("./audit-log.service");
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
let AuditLogController = class AuditLogController {
    log;
    audit;
    constructor(log, audit){
        this.log = log;
        this.audit = audit;
    }
    list(q) {
        return this.log.list(q);
    }
    facets() {
        return this.log.facets();
    }
    async export(q, res) {
        const csv = await this.log.csv(q);
        await this.audit.record({
            action: 'audit.exported',
            entity: 'AuditLog',
            meta: {
                summary: 'Exported the audit log as CSV',
                tab: q.tab
            }
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.send(csv);
    }
    async get(id) {
        const r = await this.log.get(id);
        if (!r) throw (0, _errors.notFound)('Audit entry');
        return r;
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.auditQuerySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof AuditQuery === "undefined" ? Object : AuditQuery
    ]),
    _ts_metadata("design:returntype", void 0)
], AuditLogController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('facets'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], AuditLogController.prototype, "facets", null);
_ts_decorate([
    (0, _common.Get)('export'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.auditQuerySchema))),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof AuditQuery === "undefined" ? Object : AuditQuery,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], AuditLogController.prototype, "export", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], AuditLogController.prototype, "get", null);
AuditLogController = _ts_decorate([
    (0, _common.Controller)('audit'),
    (0, _decorators.RequirePerm)('audit.view'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _auditlogservice.AuditLogService === "undefined" ? Object : _auditlogservice.AuditLogService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], AuditLogController);

//# sourceMappingURL=audit-log.controller.js.map