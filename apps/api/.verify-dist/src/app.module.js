"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AppModule", {
    enumerable: true,
    get: function() {
        return AppModule;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _coremodule = require("./core/core.module");
const _platformmodule = require("./modules/platform/platform.module");
const _peoplemodule = require("./modules/people/people.module");
const _timemodule = require("./modules/time/time.module");
const _trackermodule = require("./modules/tracker/tracker.module");
const _leavepaymodule = require("./modules/leavepay/leavepay.module");
const _workmodule = require("./modules/work/work.module");
const _financemodule = require("./modules/finance/finance.module");
const _workplacemodule = require("./modules/workplace/workplace.module");
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
let AppModule = class AppModule {
};
AppModule = _ts_decorate([
    (0, _common.Module)({
        imports: [
            _schedule.ScheduleModule.forRoot(),
            _coremodule.CoreModule,
            _platformmodule.PlatformModule,
            _peoplemodule.PeopleModule,
            _timemodule.TimeModule,
            _trackermodule.TrackerModule,
            _leavepaymodule.LeavepayModule,
            _workmodule.WorkModule,
            _financemodule.FinanceModule,
            _workplacemodule.WorkplaceModule
        ]
    })
], AppModule);

//# sourceMappingURL=app.module.js.map