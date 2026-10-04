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
    get DeviceOnlyGuard () {
        return DeviceOnlyGuard;
    },
    get UserSessionGuard () {
        return UserSessionGuard;
    },
    get deviceIdOf () {
        return deviceIdOf;
    },
    get pairingTokenOf () {
        return pairingTokenOf;
    }
});
const _common = require("@nestjs/common");
const _requestcontext = require("../../core/context/request-context");
const _errors = require("../../core/http/errors");
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
const deviceIdOf = (req)=>req.deviceId;
let DeviceOnlyGuard = class DeviceOnlyGuard {
    canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const ctx = (0, _requestcontext.getContext)();
        if (!ctx?.userId || !deviceIdOf(req)) {
            throw new _errors.AppError(401, 'DEVICE_TOKEN_REQUIRED', 'This device is not paired. Sign in to the tracker again.');
        }
        if (!ctx.employeeId) throw new _errors.AppError(403, 'TRACKER_NOT_ELIGIBLE', 'The tracker is for employees.');
        return true;
    }
};
DeviceOnlyGuard = _ts_decorate([
    (0, _common.Injectable)()
], DeviceOnlyGuard);
let UserSessionGuard = class UserSessionGuard {
    canActivate(context) {
        const req = context.switchToHttp().getRequest();
        if (deviceIdOf(req)) throw new _errors.AppError(403, 'WEB_SESSION_REQUIRED', 'Use the web portal for this action.');
        return true;
    }
};
UserSessionGuard = _ts_decorate([
    (0, _common.Injectable)()
], UserSessionGuard);
function pairingTokenOf(req) {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) return h.slice(7).trim() || undefined;
    const x = req.headers['x-pairing-token'];
    return typeof x === 'string' && x ? x : undefined;
}

//# sourceMappingURL=tracker.guards.js.map