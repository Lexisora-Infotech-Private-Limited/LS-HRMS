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
    get AuthMiddleware () {
        return AuthMiddleware;
    },
    get deviceTokenHooks () {
        return deviceTokenHooks;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../prisma/prisma.service");
const _requestcontext = require("../context/request-context");
const _tokenservice = require("./token.service");
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
const deviceTokenHooks = {};
let AuthMiddleware = class AuthMiddleware {
    tokens;
    prisma;
    constructor(tokens, prisma){
        this.tokens = tokens;
        this.prisma = prisma;
    }
    async use(req, _res, next) {
        const h = req.headers.authorization;
        const q = typeof req.query.access_token === 'string' ? req.query.access_token : undefined; // for <img>/<a> downloads
        const token = h?.startsWith('Bearer ') ? h.slice(7) : q;
        if (!token) return next();
        const p = this.tokens.verify(token);
        if (!p) return next();
        if (p.typ === 'device' && deviceTokenHooks.isDeviceActive && !await deviceTokenHooks.isDeviceActive(p.did, p.tid)) {
            return next();
        }
        const user = await this.prisma.raw.user.findUnique({
            where: {
                id: p.sub
            },
            include: {
                role: true,
                employee: {
                    select: {
                        id: true,
                        fullName: true,
                        status: true
                    }
                }
            }
        });
        if (!user || user.tenantId !== p.tid || user.status === 'DISABLED' || user.employee?.status === 'EXITED') return next();
        const ctx = {
            tenantId: user.tenantId,
            userId: user.id,
            employeeId: user.employee?.id ?? null,
            roleKey: user.role.key,
            permissions: new Set(user.role.permissions),
            isPlatformAdmin: user.isPlatformAdmin,
            userName: user.employee?.fullName ?? user.name,
            ip: req.ip
        };
        req.deviceId = p.typ === 'device' ? p.did : undefined;
        (0, _requestcontext.runWithContext)(ctx, ()=>next());
    }
};
AuthMiddleware = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _tokenservice.TokenService === "undefined" ? Object : _tokenservice.TokenService,
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], AuthMiddleware);

//# sourceMappingURL=auth.middleware.js.map