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
    get EntitlementsGuard () {
        return EntitlementsGuard;
    },
    get invalidateEntitlements () {
        return invalidateEntitlements;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _platformutil = require("../platform.util");
const _entitlementslogic = require("./entitlements.logic");
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
/** Subscription lookups are cached briefly: every write request passes through this guard. */ const TTL_MS = 10_000;
const cache = new Map();
function invalidateEntitlements(tenantId) {
    if (tenantId) cache.delete(tenantId);
    else cache.clear();
}
let EntitlementsGuard = class EntitlementsGuard {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    async subscription(tenantId) {
        const hit = cache.get(tenantId);
        if (hit && Date.now() - hit.at < TTL_MS) return hit.sub;
        const sub = await this.prisma.raw.subscription.findUnique({
            where: {
                tenantId
            },
            select: {
                planCode: true,
                quantity: true,
                status: true
            }
        });
        cache.set(tenantId, {
            at: Date.now(),
            sub
        });
        return sub;
    }
    async canActivate(context) {
        if (context.getType() !== 'http') return true;
        const req = context.switchToHttp().getRequest();
        if (!req || !_entitlementslogic.WRITE_METHODS.has(req.method)) return true;
        const ctx = (0, _requestcontext.getContext)();
        if (!ctx?.tenantId || !ctx.userId) return true;
        const path = (0, _entitlementslogic.routePath)(req.originalUrl ?? req.url);
        const sub = await this.subscription(ctx.tenantId);
        if (!sub) return true;
        if ((0, _entitlementslogic.readOnlyBlocks)(req.method, path, sub.status)) throw new _errors.AppError(423, 'TENANT_READ_ONLY', _entitlementslogic.READ_ONLY_MESSAGE);
        if ((0, _entitlementslogic.consumesSeat)(req.method, path)) {
            const used = await this.prisma.raw.user.count({
                where: {
                    tenantId: ctx.tenantId,
                    status: {
                        in: [
                            ..._platformutil.SEAT_STATUSES
                        ]
                    }
                }
            });
            if ((0, _entitlementslogic.seatBlocks)(req.method, path, sub, used)) throw new _errors.AppError(402, 'SEAT_LIMIT', (0, _entitlementslogic.seatLimitMessage)(sub));
        }
        return true;
    }
};
EntitlementsGuard = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], EntitlementsGuard);

//# sourceMappingURL=entitlements.guard.js.map