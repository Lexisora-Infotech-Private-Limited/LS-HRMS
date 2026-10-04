"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WorkplaceModule", {
    enumerable: true,
    get: function() {
        return WorkplaceModule;
    }
});
const _common = require("@nestjs/common");
const _audience = require("./common/audience");
const _certificatesservice = require("./common/certificates.service");
const _spine = require("./common/spine");
const _dashboardcontroller = require("./dashboard/dashboard.controller");
const _dashboardservice = require("./dashboard/dashboard.service");
const _feedcontroller = require("./feed/feed.controller");
const _feedservice = require("./feed/feed.service");
const _helpdeskcontroller = require("./helpdesk/helpdesk.controller");
const _helpdeskservice = require("./helpdesk/helpdesk.service");
const _kudoscontroller = require("./kudos/kudos.controller");
const _kudosservice = require("./kudos/kudos.service");
const _noticescontroller = require("./notices/notices.controller");
const _noticesservice = require("./notices/notices.service");
const _policiescontroller = require("./policies/policies.controller");
const _policiesservice = require("./policies/policies.service");
const _chatcontroller = require("./chat/chat.controller");
const _chatrealtime = require("./chat/chat.realtime");
const _chatservice = require("./chat/chat.service");
const _lmscontroller = require("./lms/lms.controller");
const _lmsservice = require("./lms/lms.service");
const _facilitycontroller = require("./facility/facility.controller");
const _facilityservice = require("./facility/facility.service");
const _wellnesscontroller = require("./wellness/wellness.controller");
const _wellnessservice = require("./wellness/wellness.service");
const _cctvcontroller = require("./cctv/cctv.controller");
const _cctvservice = require("./cctv/cctv.service");
const _workplaceregistry = require("./workplace.registry");
const _workplacehubregistry = require("./workplace-hub.registry");
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
let WorkplaceModule = class WorkplaceModule {
};
WorkplaceModule = _ts_decorate([
    (0, _common.Module)({
        imports: [],
        controllers: [
            _dashboardcontroller.DashboardController,
            _dashboardcontroller.QuotesController,
            _dashboardcontroller.TodosController,
            _dashboardcontroller.EventsController,
            _noticescontroller.NoticesController,
            _feedcontroller.FeedController,
            _kudoscontroller.KudosController,
            _kudoscontroller.EotmController,
            _kudoscontroller.CertificatesController,
            _policiescontroller.PoliciesController,
            _helpdeskcontroller.HelpdeskController,
            _chatcontroller.ChatController,
            _lmscontroller.LmsController,
            _facilitycontroller.FacilityController,
            _facilitycontroller.FacilityPassController,
            _wellnesscontroller.WellnessController,
            _cctvcontroller.CctvController
        ],
        providers: [
            _spine.SpineReader,
            _audience.AudienceService,
            _certificatesservice.CertificatesService,
            _dashboardservice.DashboardService,
            _noticesservice.NoticesService,
            _feedservice.FeedService,
            _kudosservice.KudosService,
            _policiesservice.PoliciesService,
            _helpdeskservice.HelpdeskService,
            _chatservice.ChatService,
            _chatrealtime.ChatRealtime,
            _lmsservice.LmsService,
            _facilityservice.FacilityService,
            _wellnessservice.WellnessService,
            _cctvservice.CctvService,
            _workplaceregistry.WorkplaceRegistry,
            _workplacehubregistry.WorkplaceHubRegistry
        ],
        exports: [
            _audience.AudienceService,
            _noticesservice.NoticesService,
            _helpdeskservice.HelpdeskService,
            _certificatesservice.CertificatesService
        ]
    })
], WorkplaceModule);

//# sourceMappingURL=workplace.module.js.map