"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ClientsController", {
    enumerable: true,
    get: function() {
        return ClientsController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _clientsservice = require("./clients.service");
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
let ClientsController = class ClientsController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    list(q) {
        return this.svc.list(q);
    }
    create(body) {
        return this.svc.create(body);
    }
    detail(id) {
        return this.svc.detail(id);
    }
    update(id, body) {
        return this.svc.update(id, body);
    }
    status(id, body) {
        return this.svc.setStatus(id, body.status);
    }
    remove(id) {
        return this.svc.remove(id);
    }
    addDoc(id, body) {
        return this.svc.addDocument(id, body);
    }
    removeDoc(id, docId) {
        return this.svc.removeDocument(id, docId);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.clientListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ClientsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)(),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.clientInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof ClientInput === "undefined" ? Object : ClientInput
    ]),
    _ts_metadata("design:returntype", void 0)
], ClientsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ClientsController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.clientInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof ClientInput === "undefined" ? Object : ClientInput
    ]),
    _ts_metadata("design:returntype", void 0)
], ClientsController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)(':id/status'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.clientStatusInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ClientsController.prototype, "status", null);
_ts_decorate([
    (0, _common.Delete)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ClientsController.prototype, "remove", null);
_ts_decorate([
    (0, _common.Post)(':id/documents'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.projectDocumentInput))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], ClientsController.prototype, "addDoc", null);
_ts_decorate([
    (0, _common.Delete)(':id/documents/:docId'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('docId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], ClientsController.prototype, "removeDoc", null);
ClientsController = _ts_decorate([
    (0, _common.Controller)('clients'),
    (0, _decorators.RequirePerm)('clients.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _clientsservice.ClientsService === "undefined" ? Object : _clientsservice.ClientsService
    ])
], ClientsController);

//# sourceMappingURL=clients.controller.js.map