"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PeriodLockPort", {
    enumerable: true,
    get: function() {
        return PeriodLockPort;
    }
});
const _common = require("@nestjs/common");
const _core = require("@nestjs/core");
const _periodlockservice = require("../../time/services/period-lock.service");
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
let PeriodLockPort = class PeriodLockPort {
    moduleRef;
    log = new _common.Logger('PayrollPeriodLock');
    svc;
    constructor(moduleRef){
        this.moduleRef = moduleRef;
    }
    resolve() {
        if (this.svc) return this.svc;
        try {
            const s = this.moduleRef.get(_periodlockservice.PeriodLockService, {
                strict: false
            });
            if (s && typeof s.lock === 'function') return this.svc = s;
        } catch  {
        /* not provided (yet) */ }
        return null;
    }
    /** Returns a warning string when the lock could not be applied. */ async lock(month, upTo, runId) {
        const s = this.resolve();
        if (!s) {
            this.log.warn('PeriodLockService is not available; attendance was not locked');
            return 'Attendance lock service unavailable; attendance was not locked';
        }
        try {
            await s.lock(month, upTo, runId);
            return null;
        } catch (e) {
            const msg = e.message;
            this.log.warn(`Lock failed: ${msg}`);
            return `Attendance lock failed: ${msg}`;
        }
    }
    async unlock(month, reason) {
        const s = this.resolve();
        if (!s) return;
        try {
            await s.unlock(month, reason);
        } catch (e) {
            this.log.warn(`Unlock failed: ${e.message}`);
        }
    }
};
PeriodLockPort = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _core.ModuleRef === "undefined" ? Object : _core.ModuleRef
    ])
], PeriodLockPort);

//# sourceMappingURL=period-lock.port.js.map