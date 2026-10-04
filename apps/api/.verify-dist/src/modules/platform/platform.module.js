"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PlatformModule", {
    enumerable: true,
    get: function() {
        return PlatformModule;
    }
});
const _common = require("@nestjs/common");
const _core = require("@nestjs/core");
const _rolescontroller = require("./rbac/roles.controller");
const _rolesservice = require("./rbac/roles.service");
const _auditlogcontroller = require("./audit/audit-log.controller");
const _auditlogservice = require("./audit/audit-log.service");
const _billingcontroller = require("./billing/billing.controller");
const _billingservice = require("./billing/billing.service");
const _billingjobs = require("./billing/billing.jobs");
const _entitlementsguard = require("./billing/entitlements.guard");
const _brandingservice = require("./branding/branding.service");
const _tenantsservice = require("./tenants/tenants.service");
const _privacyservice = require("./privacy/privacy.service");
const _supportservice = require("./support/support.service");
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
let PlatformModule = class PlatformModule {
};
PlatformModule = _ts_decorate([
    (0, _common.Module)({
        imports: [],
        controllers: [
            _rolescontroller.RolesController,
            _auditlogcontroller.AuditLogController,
            _billingcontroller.BillingController,
            _brandingservice.BrandingController,
            _tenantsservice.TenantsController,
            _privacyservice.PrivacyController,
            _supportservice.SupportController
        ],
        providers: [
            _rolesservice.RolesService,
            _auditlogservice.AuditLogService,
            _billingservice.BillingService,
            _billingjobs.BillingJobs,
            _brandingservice.BrandingService,
            _tenantsservice.TenantsService,
            _privacyservice.PrivacyService,
            _supportservice.SupportService,
            {
                provide: _core.APP_GUARD,
                useClass: _entitlementsguard.EntitlementsGuard
            }
        ],
        exports: [
            _rolesservice.RolesService,
            _billingservice.BillingService
        ]
    })
], PlatformModule);

//# sourceMappingURL=platform.module.js.map