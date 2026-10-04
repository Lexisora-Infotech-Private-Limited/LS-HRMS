"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AuthGuard", {
    enumerable: true,
    get: function() {
        return AuthGuard;
    }
});
const _common = require("@nestjs/common");
const _core = require("@nestjs/core");
const _requestcontext = require("../context/request-context");
const _errors = require("../http/errors");
const _decorators = require("./decorators");
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
let AuthGuard = class AuthGuard {
    reflector;
    constructor(reflector){
        this.reflector = reflector;
    }
    canActivate(context) {
        if (context.getType() !== 'http') return true;
        const targets = [
            context.getHandler(),
            context.getClass()
        ];
        if (this.reflector.getAllAndOverride(_decorators.IS_PUBLIC, targets)) return true;
        const ctx = (0, _requestcontext.getContext)();
        if (!ctx?.userId) throw new _errors.AppError(401, 'UNAUTHENTICATED', 'Please sign in');
        if (this.reflector.getAllAndOverride(_decorators.PLATFORM_ONLY, targets) && !ctx.isPlatformAdmin) {
            throw new _errors.AppError(403, 'FORBIDDEN', 'Platform administrators only');
        }
        const perms = this.reflector.getAllAndOverride(_decorators.REQUIRED_PERMS, targets);
        if (perms?.length && !perms.some((p)=>ctx.permissions.has(p))) {
            throw new _errors.AppError(403, 'FORBIDDEN', 'You do not have access to this');
        }
        return true;
    }
};
AuthGuard = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _core.Reflector === "undefined" ? Object : _core.Reflector
    ])
], AuthGuard);

//# sourceMappingURL=auth.guard.js.map