"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CoreModule", {
    enumerable: true,
    get: function() {
        return CoreModule;
    }
});
const _common = require("@nestjs/common");
const _jwt = require("@nestjs/jwt");
const _core = require("@nestjs/core");
const _prismamodule = require("./prisma/prisma.module");
const _authcontroller = require("./auth/auth.controller");
const _authservice = require("./auth/auth.service");
const _tokenservice = require("./auth/token.service");
const _authmiddleware = require("./auth/auth.middleware");
const _authguard = require("./auth/auth.guard");
const _errors = require("./http/errors");
const _mailservice = require("./mail/mail.service");
const _auditservice = require("./audit/audit.service");
const _realtimegateway = require("./realtime/realtime.gateway");
const _notificationsservice = require("./notifications/notifications.service");
const _notificationscontroller = require("./notifications/notifications.controller");
const _storageservice = require("./storage/storage.service");
const _filescontroller = require("./storage/files.controller");
const _cryptoservice = require("./crypto/crypto.service");
const _settingsservice = require("./settings/settings.service");
const _jobsservice = require("./jobs/jobs.service");
const _pdfservice = require("./pdf/pdf.service");
const _orgservice = require("./org/org.service");
const _healthcontroller = require("./health.controller");
const _lookups = require("./lookups/lookups");
const _sequenceservice = require("./registry/sequence.service");
const _eventsservice = require("./registry/events.service");
const _registries = require("./registry/registries");
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
const SHARED = [
    _lookups.LookupsService,
    _sequenceservice.SequenceService,
    _eventsservice.EventsService,
    _registries.ApprovalCountsService,
    _registries.SearchService,
    _authservice.AuthService,
    _tokenservice.TokenService,
    _mailservice.MailService,
    _auditservice.AuditService,
    _realtimegateway.RealtimeGateway,
    _notificationsservice.NotificationsService,
    _storageservice.StorageService,
    _cryptoservice.CryptoService,
    _settingsservice.SettingsService,
    _jobsservice.JobsService,
    _pdfservice.PdfService,
    _orgservice.OrgService
];
let CoreModule = class CoreModule {
    configure(consumer) {
        consumer.apply(_authmiddleware.AuthMiddleware).forRoutes('{*splat}');
    }
};
CoreModule = _ts_decorate([
    (0, _common.Global)(),
    (0, _common.Module)({
        imports: [
            _prismamodule.PrismaModule,
            _jwt.JwtModule.register({})
        ],
        controllers: [
            _authcontroller.AuthController,
            _notificationscontroller.NotificationsController,
            _filescontroller.FilesController,
            _healthcontroller.HealthController,
            _lookups.LookupsController,
            _registries.RegistriesController
        ],
        providers: [
            ...SHARED,
            {
                provide: _core.APP_GUARD,
                useClass: _authguard.AuthGuard
            },
            {
                provide: _core.APP_FILTER,
                useClass: _errors.AllExceptionsFilter
            }
        ],
        exports: [
            ...SHARED,
            _jwt.JwtModule
        ]
    })
], CoreModule);

//# sourceMappingURL=core.module.js.map