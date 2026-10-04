"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "TimeModule", {
    enumerable: true,
    get: function() {
        return TimeModule;
    }
});
const _common = require("@nestjs/common");
const _cross = require("./cross");
const _timecontrollers = require("./time.controllers");
const _timeregistry = require("./time.registry");
const _approvalservice = require("./services/approval.service");
const _attendanceservice = require("./services/attendance.service");
const _biometricservice = require("./services/biometric.service");
const _idcheckservice = require("./services/idcheck.service");
const _mastersservice = require("./services/masters.service");
const _periodlockservice = require("./services/period-lock.service");
const _policyservice = require("./services/policy.service");
const _regularizationservice = require("./services/regularization.service");
const _timesheetservice = require("./services/timesheet.service");
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
let TimeModule = class TimeModule {
};
TimeModule = _ts_decorate([
    (0, _common.Module)({
        controllers: _timecontrollers.TIME_CONTROLLERS,
        providers: [
            _cross.CrossReader,
            _policyservice.PolicyService,
            _periodlockservice.PeriodLockService,
            _attendanceservice.AttendanceService,
            _mastersservice.MastersService,
            _idcheckservice.IdCheckService,
            _regularizationservice.RegularizationService,
            _biometricservice.BiometricService,
            _timesheetservice.TimesheetService,
            _approvalservice.ApprovalService,
            _timeregistry.TimeRegistry
        ],
        exports: [
            _attendanceservice.AttendanceService,
            _periodlockservice.PeriodLockService,
            _policyservice.PolicyService,
            _timesheetservice.TimesheetService
        ]
    })
], TimeModule);

//# sourceMappingURL=time.module.js.map