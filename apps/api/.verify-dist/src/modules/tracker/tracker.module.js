"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "TrackerModule", {
    enumerable: true,
    get: function() {
        return TrackerModule;
    }
});
const _common = require("@nestjs/common");
const _timemodule = require("../time/time.module");
const _devicescontroller = require("./devices.controller");
const _devicesservice = require("./devices.service");
const _ingestservice = require("./ingest.service");
const _reviewservice = require("./review.service");
const _timeport = require("./time-port");
const _trackercontextservice = require("./tracker-context.service");
const _trackercontroller = require("./tracker.controller");
const _trackerguards = require("./tracker.guards");
const _trackerjobs = require("./tracker.jobs");
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
let TrackerModule = class TrackerModule {
};
TrackerModule = _ts_decorate([
    (0, _common.Module)({
        imports: [
            _timemodule.TimeModule
        ],
        controllers: [
            _trackercontroller.TrackerDeviceController,
            _trackercontroller.TrackerReviewController,
            _devicescontroller.DevicesController
        ],
        providers: [
            _trackercontextservice.TrackerContextService,
            _devicesservice.DevicesService,
            _ingestservice.IngestService,
            _reviewservice.ReviewService,
            _timeport.TimePort,
            _trackerjobs.TrackerJobs,
            _trackerguards.DeviceOnlyGuard,
            _trackerguards.UserSessionGuard
        ],
        exports: [
            _ingestservice.IngestService,
            _reviewservice.ReviewService,
            _devicesservice.DevicesService
        ]
    })
], TrackerModule);

//# sourceMappingURL=tracker.module.js.map