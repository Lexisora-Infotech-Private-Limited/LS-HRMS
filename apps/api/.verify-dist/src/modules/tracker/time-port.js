"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "TimePort", {
    enumerable: true,
    get: function() {
        return TimePort;
    }
});
const _common = require("@nestjs/common");
const _core = require("@nestjs/core");
const _errors = require("../../core/http/errors");
const _attendanceservice = require("../time/services/attendance.service");
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
let TimePort = class TimePort {
    moduleRef;
    log = new _common.Logger('TrackerTimePort');
    svc;
    constructor(moduleRef){
        this.moduleRef = moduleRef;
    }
    resolve() {
        if (this.svc) return this.svc;
        try {
            const s = this.moduleRef.get(_attendanceservice.AttendanceService, {
                strict: false
            });
            if (s && typeof s.punch === 'function') return this.svc = s;
        } catch  {
        /* not registered (yet) */ }
        try {
            // fallback: look the provider up by name (e.g. if the class was re-exported elsewhere)
            const container = this.moduleRef.container;
            for (const mod of container?.getModules?.().values?.() ?? []){
                for (const [token, wrapper] of mod.providers ?? []){
                    const name = typeof token === 'function' ? token.name : String(token);
                    if (name === 'AttendanceService' && wrapper?.instance && typeof wrapper.instance.punch === 'function') {
                        return this.svc = wrapper.instance;
                    }
                }
            }
        } catch (e) {
            this.log.warn(`AttendanceService lookup failed: ${e.message}`);
        }
        return null;
    }
    async punch(input) {
        const svc = this.resolve();
        if (!svc) throw new _errors.AppError(503, 'ATTENDANCE_UNAVAILABLE', 'Attendance service is not available. Try again shortly.');
        return svc.punch(input);
    }
};
TimePort = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _core.ModuleRef === "undefined" ? Object : _core.ModuleRef
    ])
], TimePort);

//# sourceMappingURL=time-port.js.map