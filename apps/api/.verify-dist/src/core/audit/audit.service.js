"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AuditService", {
    enumerable: true,
    get: function() {
        return AuditService;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../prisma/prisma.service");
const _requestcontext = require("../context/request-context");
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
let AuditService = class AuditService {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    /** Record an action by the current user (tenant/actor taken from context). */ async record(a) {
        const ctx = (0, _requestcontext.getContext)();
        if (!ctx) return;
        await this.prisma.raw.auditLog.create({
            data: {
                tenantId: ctx.tenantId,
                actorUserId: ctx.userId,
                actorName: ctx.userName,
                ip: ctx.ip,
                action: a.action,
                entity: a.entity,
                entityId: a.entityId ?? null,
                meta: a.meta
            }
        });
    }
    /** Record outside a request context (login, jobs). */ async recordRaw(tenantId, a) {
        await this.prisma.raw.auditLog.create({
            data: {
                tenantId,
                actorUserId: a.actorUserId ?? null,
                actorName: a.actorName ?? null,
                ip: a.ip,
                action: a.action,
                entity: a.entity,
                entityId: a.entityId ?? null,
                meta: a.meta
            }
        });
    }
};
AuditService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], AuditService);

//# sourceMappingURL=audit.service.js.map