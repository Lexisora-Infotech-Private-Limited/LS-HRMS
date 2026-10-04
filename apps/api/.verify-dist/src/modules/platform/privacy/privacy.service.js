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
    get PrivacyController () {
        return PrivacyController;
    },
    get PrivacyService () {
        return PrivacyService;
    },
    get auditSummary () {
        return auditSummary;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _decorators = require("../../../core/auth/decorators");
const _privacylogic = require("./privacy.logic");
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
const DAY = 86_400_000;
function auditSummary(meta, action) {
    const m = meta && typeof meta === 'object' ? meta : {};
    return typeof m.summary === 'string' && m.summary ? m.summary : action.replace(/^platform\./, '').replace(/[._]/g, ' ');
}
let PrivacyService = class PrivacyService {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    async overview() {
        const since = new Date(Date.now() - 90 * DAY);
        const [roles, access] = await Promise.all([
            this.prisma.role.findMany({
                select: {
                    key: true,
                    name: true,
                    isSystem: true,
                    permissions: true
                }
            }),
            this.prisma.auditLog.findMany({
                where: {
                    action: {
                        startsWith: 'platform.'
                    },
                    createdAt: {
                        gte: since
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: 50
            })
        ]);
        const blocked = (0, _privacylogic.blockedModelList)();
        return {
            rows: (0, _privacylogic.privacyRows)(roles),
            controls: (0, _privacylogic.enforcedControls)(blocked.length),
            blockedModels: blocked,
            key: {
                algorithm: 'AES-256-GCM',
                provider: 'Platform-managed key',
                version: 'v1'
            },
            platformAccess: access.map((a)=>({
                    id: a.id,
                    action: a.action,
                    actorName: a.actorName ?? 'Lexisora platform',
                    createdAt: a.createdAt.toISOString(),
                    summary: auditSummary(a.meta, a.action)
                })),
            upcoming: _privacylogic.UPCOMING_CONTROLS
        };
    }
};
PrivacyService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], PrivacyService);
let PrivacyController = class PrivacyController {
    privacy;
    constructor(privacy){
        this.privacy = privacy;
    }
    overview() {
        return this.privacy.overview();
    }
};
_ts_decorate([
    (0, _common.Get)('overview'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], PrivacyController.prototype, "overview", null);
PrivacyController = _ts_decorate([
    (0, _common.Controller)('privacy'),
    (0, _decorators.RequirePerm)('privacy.view'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof PrivacyService === "undefined" ? Object : PrivacyService
    ])
], PrivacyController);

//# sourceMappingURL=privacy.service.js.map