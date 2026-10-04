"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ChatRealtime", {
    enumerable: true,
    get: function() {
        return ChatRealtime;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _zod = require("zod");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _requestcontext = require("../../../core/context/request-context");
const _chatservice = require("./chat.service");
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
const joinSchema = _zod.z.object({
    channelId: _zod.z.string().min(1)
});
const typingSchema = _zod.z.object({
    channelId: _zod.z.string().min(1),
    on: _zod.z.boolean().default(true)
});
const readSchema = _shared.channelReadSchema.extend({
    channelId: _zod.z.string().min(1)
});
let ChatRealtime = class ChatRealtime {
    realtime;
    prisma;
    chat;
    log = new _common.Logger('ChatRealtime');
    attached = false;
    constructor(realtime, prisma, chat){
        this.realtime = realtime;
        this.prisma = prisma;
        this.chat = chat;
    }
    onModuleInit() {
        this.attach();
    }
    onApplicationBootstrap() {
        this.attach();
    }
    attach() {
        const server = this.realtime.server;
        if (this.attached || !server) return;
        this.attached = true;
        server.on('connection', (socket)=>this.onConnection(socket));
        this.log.log('chat socket handlers registered');
    }
    /** The core gateway authenticates asynchronously; wait for `socket.data.user`. */ async userOf(socket, timeoutMs = 5000) {
        const started = Date.now();
        while(Date.now() - started < timeoutMs){
            if (socket.disconnected) return null;
            const u = socket.data?.user;
            if (u) return u.deviceId ? null : u;
            await new Promise((r)=>setTimeout(r, 50));
        }
        return null;
    }
    async ctxOf(socket) {
        const cached = socket.data.wpCtx;
        if (cached && Date.now() - cached.at < 60_000) return cached.ctx;
        const su = await this.userOf(socket);
        if (!su) return null;
        const u = await this.prisma.raw.user.findUnique({
            where: {
                id: su.userId
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
        if (!u || u.tenantId !== su.tenantId || u.status === 'DISABLED' || u.employee?.status === 'EXITED') return null;
        const perms = new Set(u.role.permissions);
        if (!perms.has('chat.use') && !perms.has('*')) return null;
        const ctx = {
            tenantId: u.tenantId,
            userId: u.id,
            employeeId: u.employee?.id ?? null,
            roleKey: u.role.key,
            permissions: perms,
            isPlatformAdmin: u.isPlatformAdmin,
            userName: u.employee?.fullName ?? u.name
        };
        socket.data.wpCtx = {
            ctx,
            at: Date.now()
        };
        return ctx;
    }
    onConnection(socket) {
        socket.on('chat:join', (p, ack)=>this.handle(socket, ack, async ()=>{
                const { channelId } = joinSchema.parse(p);
                await this.chat.assertMember(channelId);
                await socket.join(`ch:${channelId}`);
                return {
                    ok: true
                };
            }));
        socket.on('chat:send', (p, ack)=>this.handle(socket, ack, async ()=>({
                    ok: true,
                    message: await this.chat.send(_shared.messageSendSchema.parse(p))
                })));
        socket.on('chat:read', (p, ack)=>this.handle(socket, ack, async ()=>{
                const { channelId, seq } = readSchema.parse(p);
                return this.chat.markRead(channelId, seq);
            }));
        // Typing is ephemeral: only relayed to the channel room the socket already belongs to.
        socket.on('chat:typing', (p)=>{
            const parsed = typingSchema.safeParse(p);
            if (!parsed.success || !socket.rooms.has(`ch:${parsed.data.channelId}`)) return;
            const ctx = socket.data.wpCtx?.ctx;
            if (!ctx) return;
            socket.to(`ch:${parsed.data.channelId}`).emit('chat:typing', {
                channelId: parsed.data.channelId,
                userId: ctx.userId,
                name: (ctx.userName ?? '').split(' ')[0] || 'Someone',
                on: parsed.data.on
            });
        });
        socket.on('disconnect', ()=>void this.onDisconnect(socket));
        void this.joinRooms(socket);
    }
    /** Join the rooms of every channel the user belongs to. */ async joinRooms(socket) {
        try {
            const ctx = await this.ctxOf(socket);
            if (!ctx?.userId) return;
            const rows = await this.prisma.raw.chatMember.findMany({
                where: {
                    tenantId: ctx.tenantId,
                    userId: ctx.userId
                },
                select: {
                    channelId: true
                }
            });
            if (rows.length) await socket.join(rows.map((r)=>`ch:${r.channelId}`));
        } catch (e) {
            this.log.debug(`joinRooms: ${e.message}`);
        }
    }
    /** Leaving the last socket drops the user from any live call (the call ends when empty). */ async onDisconnect(socket) {
        const ctx = socket.data?.wpCtx?.ctx;
        if (!ctx?.userId) return;
        setTimeout(()=>{
            void (async ()=>{
                try {
                    const still = await this.realtime.server.in(`u:${ctx.userId}`).fetchSockets();
                    if (still.length) return;
                    await (0, _requestcontext.runWithContext)(ctx, ()=>this.chat.dropFromCalls(ctx.userId));
                } catch (e) {
                    this.log.debug(`disconnect cleanup: ${e.message}`);
                }
            })();
        }, 15_000);
    }
    async handle(socket, ack, fn) {
        try {
            const ctx = await this.ctxOf(socket);
            if (!ctx) throw new Error('Not signed in');
            const res = await (0, _requestcontext.runWithContext)(ctx, fn);
            if (typeof ack === 'function') ack(res);
        } catch (e) {
            const err = e;
            const message = err.response?.message ?? err.issues?.[0]?.message ?? err.message ?? 'Something went wrong';
            if (typeof ack === 'function') ack({
                ok: false,
                error: message,
                code: err.response?.code ?? 'ERROR'
            });
        }
    }
};
ChatRealtime = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _chatservice.ChatService === "undefined" ? Object : _chatservice.ChatService
    ])
], ChatRealtime);

//# sourceMappingURL=chat.realtime.js.map