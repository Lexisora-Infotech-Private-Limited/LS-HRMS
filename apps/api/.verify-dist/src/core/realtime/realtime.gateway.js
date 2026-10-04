"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "RealtimeGateway", {
    enumerable: true,
    get: function() {
        return RealtimeGateway;
    }
});
const _common = require("@nestjs/common");
const _websockets = require("@nestjs/websockets");
const _env = require("../../config/env");
const _prismaservice = require("../prisma/prisma.service");
const _tokenservice = require("../auth/token.service");
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
let RealtimeGateway = class RealtimeGateway {
    tokens;
    prisma;
    log = new _common.Logger('Realtime');
    server;
    constructor(tokens, prisma){
        this.tokens = tokens;
        this.prisma = prisma;
    }
    async handleConnection(socket) {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        const p = token ? this.tokens.verify(token) : null;
        if (!p) {
            socket.disconnect(true);
            return;
        }
        const user = await this.prisma.raw.user.findUnique({
            where: {
                id: p.sub
            },
            include: {
                employee: {
                    select: {
                        id: true
                    }
                }
            }
        });
        if (!user || user.tenantId !== p.tid || user.status === 'DISABLED') {
            socket.disconnect(true);
            return;
        }
        const su = {
            userId: user.id,
            tenantId: user.tenantId,
            employeeId: user.employee?.id ?? null
        };
        if (p.typ === 'device') su.deviceId = p.did;
        socket.data.user = su;
        socket.join([
            `t:${su.tenantId}`,
            `u:${su.userId}`
        ]);
        if (su.deviceId) socket.join(`d:${su.deviceId}`);
    }
    toUser(userId, event, payload) {
        this.server?.to(`u:${userId}`).emit(event, payload);
    }
    toUsers(userIds, event, payload) {
        if (userIds.length) this.server?.to(userIds.map((u)=>`u:${u}`)).emit(event, payload);
    }
    toTenant(tenantId, event, payload) {
        this.server?.to(`t:${tenantId}`).emit(event, payload);
    }
    toRoom(room, event, payload) {
        this.server?.to(room).emit(event, payload);
    }
};
_ts_decorate([
    (0, _websockets.WebSocketServer)(),
    _ts_metadata("design:type", typeof Server === "undefined" ? Object : Server)
], RealtimeGateway.prototype, "server", void 0);
RealtimeGateway = _ts_decorate([
    (0, _websockets.WebSocketGateway)({
        path: '/socket.io',
        cors: {
            origin: _env.env.WEB_ORIGIN,
            credentials: true
        }
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _tokenservice.TokenService === "undefined" ? Object : _tokenservice.TokenService,
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], RealtimeGateway);

//# sourceMappingURL=realtime.gateway.js.map