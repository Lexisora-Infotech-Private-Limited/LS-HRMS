"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CctvController", {
    enumerable: true,
    get: function() {
        return CctvController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _errors = require("../../../core/http/errors");
const _cctvservice = require("./cctv.service");
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
const listQuery = _zod.z.object({
    location: _zod.z.string().max(80).optional()
});
const sessionsQuery = _zod.z.object({
    cameraId: _zod.z.string().optional()
});
const authSchema = _zod.z.object({
    path: _zod.z.string().optional(),
    query: _zod.z.string().optional(),
    action: _zod.z.string().optional()
}).passthrough();
/** Requests from loopback / private networks only (the gateway's auth hook). */ function isInternal(ip) {
    const a = (ip ?? '').replace(/^::ffff:/, '');
    return a === '::1' || a === '127.0.0.1' || /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
}
let CctvController = class CctvController {
    cctv;
    constructor(cctv){
        this.cctv = cctv;
    }
    list(q) {
        return this.cctv.list(q.location);
    }
    create(dto) {
        return this.cctv.create(dto);
    }
    update(id, dto) {
        return this.cctv.update(id, dto);
    }
    remove(id) {
        return this.cctv.remove(id);
    }
    test(id) {
        return this.cctv.test(id);
    }
    reconnect(id) {
        return this.cctv.reconnect(id);
    }
    view(id) {
        return this.cctv.view(id);
    }
    heartbeat(sid) {
        return this.cctv.heartbeat(sid);
    }
    end(sid) {
        return this.cctv.endView(sid);
    }
    sessions(q) {
        return this.cctv.sessions(q.cameraId);
    }
    /** MediaMTX external auth hook — internal network only; 200 = allow, 401 = deny. */ async auth(ip, body) {
        if (!isInternal(ip)) throw new _errors.AppError(403, 'FORBIDDEN', 'Internal endpoint');
        if (!await this.cctv.authorize(body)) throw new _errors.AppError(401, 'CCTV_TOKEN_INVALID', 'Viewing token is invalid or expired');
        return {
            ok: true
        };
    }
};
_ts_decorate([
    (0, _common.Get)('cameras'),
    (0, _decorators.RequirePerm)('cctv.view', 'cctv.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(listQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], CctvController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)('cameras'),
    (0, _decorators.RequirePerm)('cctv.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.cameraUpsertSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], CctvController.prototype, "create", null);
_ts_decorate([
    (0, _common.Patch)('cameras/:id'),
    (0, _decorators.RequirePerm)('cctv.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.cameraUpdateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], CctvController.prototype, "update", null);
_ts_decorate([
    (0, _common.Delete)('cameras/:id'),
    (0, _decorators.RequirePerm)('cctv.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], CctvController.prototype, "remove", null);
_ts_decorate([
    (0, _common.Post)('cameras/:id/test'),
    (0, _decorators.RequirePerm)('cctv.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], CctvController.prototype, "test", null);
_ts_decorate([
    (0, _common.Post)('cameras/:id/reconnect'),
    (0, _decorators.RequirePerm)('cctv.view', 'cctv.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], CctvController.prototype, "reconnect", null);
_ts_decorate([
    (0, _common.Post)('cameras/:id/view'),
    (0, _decorators.RequirePerm)('cctv.view', 'cctv.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], CctvController.prototype, "view", null);
_ts_decorate([
    (0, _common.Post)('sessions/:sid/heartbeat'),
    (0, _decorators.RequirePerm)('cctv.view', 'cctv.manage'),
    _ts_param(0, (0, _common.Param)('sid')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], CctvController.prototype, "heartbeat", null);
_ts_decorate([
    (0, _common.Post)('sessions/:sid/end'),
    (0, _decorators.RequirePerm)('cctv.view', 'cctv.manage'),
    _ts_param(0, (0, _common.Param)('sid')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], CctvController.prototype, "end", null);
_ts_decorate([
    (0, _common.Get)('sessions'),
    (0, _decorators.RequirePerm)('cctv.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(sessionsQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], CctvController.prototype, "sessions", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('internal/auth'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Ip)()),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(authSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", Promise)
], CctvController.prototype, "auth", null);
CctvController = _ts_decorate([
    (0, _common.Controller)('cctv'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _cctvservice.CctvService === "undefined" ? Object : _cctvservice.CctvService
    ])
], CctvController);

//# sourceMappingURL=cctv.controller.js.map