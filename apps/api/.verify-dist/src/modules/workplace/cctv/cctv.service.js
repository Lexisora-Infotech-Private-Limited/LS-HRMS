"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CctvService", {
    enumerable: true,
    get: function() {
        return CctvService;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _env = require("../../../config/env");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _cryptoservice = require("../../../core/crypto/crypto.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _dates = require("../common/dates");
const _gateway = require("./adapters/gateway");
const _cctvrules = require("./cctv.rules");
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
let CctvService = class CctvService {
    prisma;
    crypto;
    audit;
    notifications;
    realtime;
    log = new _common.Logger('Cctv');
    gateway = (0, _gateway.gatewayFromEnv)();
    failures = new Map();
    alerted = new Map();
    constructor(prisma, crypto, audit, notifications, realtime){
        this.prisma = prisma;
        this.crypto = crypto;
        this.audit = audit;
        this.notifications = notifications;
        this.realtime = realtime;
    }
    canManage() {
        return (0, _decorators.hasPerm)((0, _requestcontext.requireContext)(), 'cctv.manage');
    }
    row(c, manage) {
        const lastSeen = c.lastSeenAt ? (0, _dates.hhmm)(c.lastSeenAt) : null;
        const t = (0, _cctvrules.cameraTile)({
            status: c.status,
            enabled: c.enabled,
            location: c.location,
            lastSeen
        });
        return {
            id: c.id,
            name: c.name,
            location: c.location,
            status: c.enabled ? c.status : 'DISABLED',
            lastSeen: c.lastSeenAt ? `${(0, _dates.dayMonth)(c.lastSeenAt)} ${lastSeen}` : null,
            enabled: c.enabled,
            rtspMasked: manage ? c.rtspMasked : null,
            hlsUrl: null,
            sortOrder: c.sortOrder,
            ...t
        };
    }
    async list(location) {
        const manage = this.canManage();
        const all = await this.prisma.camera.findMany({
            where: manage ? {} : {
                enabled: true
            },
            orderBy: [
                {
                    sortOrder: 'asc'
                },
                {
                    name: 'asc'
                }
            ]
        });
        const locations = [
            ...new Set(all.map((c)=>c.location))
        ].sort();
        const items = all.filter((c)=>!location || c.location === location).map((c)=>this.row(c, manage));
        let gatewayDown = false;
        if (this.gateway.mode === 'gateway' && all.length) {
            const p = await this.gateway.probe(all[0].gatewayPath, !!all[0].rtspUrlEnc);
            gatewayDown = !!p.error?.startsWith('Gateway unreachable');
        }
        return {
            items,
            locations,
            mode: this.gateway.mode,
            canManage: manage,
            gatewayDown
        };
    }
    async camera(id) {
        const c = await this.prisma.camera.findFirst({
            where: {
                id
            }
        });
        if (!c) throw (0, _errors.notFound)('Camera');
        return c;
    }
    async probeAndStore(c) {
        const p = await this.gateway.probe(c.gatewayPath, !!c.rtspUrlEnc && c.enabled);
        const now = new Date();
        const updated = await this.prisma.camera.update({
            where: {
                id: c.id
            },
            data: p.ready ? {
                status: 'ONLINE',
                lastSeenAt: now,
                lastError: null
            } : {
                status: 'OFFLINE',
                lastError: p.error
            }
        });
        this.failures.set(c.id, p.ready ? 0 : 2);
        await this.broadcast(updated);
        return updated;
    }
    async broadcast(c) {
        const users = await this.notifications.usersWithPermission('cctv.view');
        this.realtime.toUsers(users, 'cctv:status', {
            cameraId: c.id,
            status: c.enabled ? c.status : 'DISABLED',
            lastSeenAt: c.lastSeenAt?.toISOString() ?? null
        });
    }
    async create(dto) {
        if (!this.canManage()) throw (0, _errors.forbidden)();
        if (await this.prisma.camera.findFirst({
            where: {
                name: dto.name
            }
        })) throw (0, _errors.conflict)(`A camera named ${dto.name} already exists`, 'CAMERA_EXISTS');
        const gatewayPath = `t_${(0, _requestcontext.currentTenantId)().slice(-6)}_${(0, _nodecrypto.randomBytes)(4).toString('hex')}`;
        const c = await this.prisma.camera.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                name: dto.name,
                location: dto.location,
                branchId: dto.branchId ?? null,
                rtspUrlEnc: this.crypto.encrypt(dto.rtspUrl ?? null),
                rtspMasked: (0, _cctvrules.maskRtsp)(dto.rtspUrl),
                gatewayPath,
                enabled: dto.enabled,
                sortOrder: dto.sortOrder,
                status: dto.enabled ? 'UNKNOWN' : 'DISABLED'
            }
        });
        if (dto.rtspUrl) await this.gateway.upsertPath(gatewayPath, dto.rtspUrl).catch((e)=>this.log.warn(`gateway upsert: ${e.message}`));
        await this.audit.record({
            action: 'cctv.camera.create',
            entity: 'Camera',
            entityId: c.id,
            meta: {
                name: c.name,
                location: c.location
            }
        });
        const probed = dto.enabled && dto.rtspUrl ? await this.probeAndStore(c) : c;
        return this.row(probed, true);
    }
    async update(id, dto) {
        if (!this.canManage()) throw (0, _errors.forbidden)();
        const c = await this.camera(id);
        if (dto.name && dto.name !== c.name && await this.prisma.camera.findFirst({
            where: {
                name: dto.name,
                id: {
                    not: id
                }
            }
        })) throw (0, _errors.conflict)(`A camera named ${dto.name} already exists`, 'CAMERA_EXISTS');
        const rtspChanged = dto.rtspUrl !== undefined && dto.rtspUrl !== null && dto.rtspUrl !== '';
        const enabled = dto.enabled ?? c.enabled;
        const updated = await this.prisma.camera.update({
            where: {
                id
            },
            data: {
                ...dto.name ? {
                    name: dto.name
                } : {},
                ...dto.location ? {
                    location: dto.location
                } : {},
                ...dto.branchId !== undefined ? {
                    branchId: dto.branchId
                } : {},
                ...dto.sortOrder !== undefined ? {
                    sortOrder: dto.sortOrder
                } : {},
                ...rtspChanged ? {
                    rtspUrlEnc: this.crypto.encrypt(dto.rtspUrl),
                    rtspMasked: (0, _cctvrules.maskRtsp)(dto.rtspUrl)
                } : {},
                enabled,
                ...enabled ? c.status === 'DISABLED' ? {
                    status: 'UNKNOWN'
                } : {} : {
                    status: 'DISABLED'
                }
            }
        });
        if (rtspChanged) await this.gateway.upsertPath(c.gatewayPath, dto.rtspUrl).catch((e)=>this.log.warn(`gateway upsert: ${e.message}`));
        if (!enabled) await this.gateway.removePath(c.gatewayPath);
        await this.audit.record({
            action: 'cctv.camera.update',
            entity: 'Camera',
            entityId: id,
            meta: {
                name: updated.name,
                rtspChanged,
                enabled
            }
        });
        const final = enabled && (rtspChanged || c.status === 'DISABLED') ? await this.probeAndStore(updated) : updated;
        await this.broadcast(final);
        return this.row(final, true);
    }
    async remove(id) {
        if (!this.canManage()) throw (0, _errors.forbidden)();
        const c = await this.camera(id);
        await this.gateway.removePath(c.gatewayPath);
        await this.prisma.cameraViewSession.updateMany({
            where: {
                cameraId: id,
                endedAt: null
            },
            data: {
                endedAt: new Date()
            }
        });
        await this.prisma.camera.delete({
            where: {
                id
            }
        });
        await this.audit.record({
            action: 'cctv.camera.delete',
            entity: 'Camera',
            entityId: id,
            meta: {
                name: c.name
            }
        });
        return {
            ok: true
        };
    }
    async test(id) {
        if (!this.canManage()) throw (0, _errors.forbidden)();
        const c = await this.probeAndStore(await this.camera(id));
        await this.audit.record({
            action: 'cctv.camera.test',
            entity: 'Camera',
            entityId: id,
            meta: {
                status: c.status
            }
        });
        return {
            ...this.row(c, true),
            message: c.status === 'ONLINE' ? `${c.name} is streaming` : `${c.name}: ${c.lastError ?? 'no video'}`
        };
    }
    /** Reconnect (cctv.view): restart the gateway path, then re-probe; at most once per 30 s per camera. */ async reconnect(id) {
        const c = await this.camera(id);
        if (!c.enabled) throw (0, _errors.conflict)('This camera is disabled', 'CAMERA_DISABLED');
        if (c.lastReconnect && Date.now() - c.lastReconnect.getTime() < _cctvrules.RECONNECT_COOLDOWN_MS) throw new _errors.AppError(429, 'CCTV_RECONNECT_COOLDOWN', 'Reconnect was just tried — give it a few seconds');
        const marked = await this.prisma.camera.update({
            where: {
                id
            },
            data: {
                lastReconnect: new Date(),
                status: 'UNKNOWN'
            }
        });
        await this.broadcast(marked);
        const source = this.crypto.decrypt(c.rtspUrlEnc);
        await this.gateway.restartPath(c.gatewayPath, source).catch((e)=>this.log.warn(`restart ${c.gatewayPath}: ${e.message}`));
        await this.audit.record({
            action: 'cctv.camera.reconnect',
            entity: 'Camera',
            entityId: id,
            meta: {
                name: c.name
            }
        });
        if (this.gateway.mode === 'gateway') await new Promise((r)=>setTimeout(r, 2500));
        const probed = await this.probeAndStore(marked);
        return {
            ...this.row(probed, this.canManage()),
            message: probed.status === 'ONLINE' ? `${c.name} is back online` : `${c.name} is still offline`
        };
    }
    // ── Viewing sessions (always audited) ───────────────────────────────────
    secret() {
        return `${_env.env.JWT_ACCESS_SECRET}:cctv`;
    }
    async view(cameraId) {
        const ctx = (0, _requestcontext.requireContext)();
        const c = await this.camera(cameraId);
        if (!c.enabled) throw (0, _errors.conflict)('This camera is disabled', 'CAMERA_DISABLED');
        const s = await this.prisma.cameraViewSession.create({
            data: {
                tenantId: ctx.tenantId,
                cameraId,
                userId: ctx.userId
            }
        });
        await this.audit.record({
            action: 'cctv.view.start',
            entity: 'Camera',
            entityId: cameraId,
            meta: {
                sessionId: s.id,
                camera: c.name
            }
        });
        const exp = Date.now() + _cctvrules.VIEW_TOKEN_TTL_MS;
        return {
            sessionId: s.id,
            hlsUrl: this.gateway.hlsUrl(c.gatewayPath, (0, _cctvrules.signViewToken)(this.secret(), {
                sid: s.id,
                path: c.gatewayPath,
                exp
            })),
            mode: this.gateway.mode,
            expiresAt: new Date(exp).toISOString()
        };
    }
    async heartbeat(sessionId) {
        const ctx = (0, _requestcontext.requireContext)();
        const s = await this.prisma.cameraViewSession.findFirst({
            where: {
                id: sessionId,
                userId: ctx.userId
            }
        });
        if (!s || s.endedAt) throw (0, _errors.notFound)('Viewing session');
        const c = await this.camera(s.cameraId);
        await this.prisma.cameraViewSession.update({
            where: {
                id: s.id
            },
            data: {
                lastBeatAt: new Date()
            }
        });
        const exp = Date.now() + _cctvrules.VIEW_TOKEN_TTL_MS;
        return {
            sessionId: s.id,
            hlsUrl: this.gateway.hlsUrl(c.gatewayPath, (0, _cctvrules.signViewToken)(this.secret(), {
                sid: s.id,
                path: c.gatewayPath,
                exp
            })),
            mode: this.gateway.mode,
            expiresAt: new Date(exp).toISOString()
        };
    }
    async endView(sessionId) {
        const ctx = (0, _requestcontext.requireContext)();
        const s = await this.prisma.cameraViewSession.findFirst({
            where: {
                id: sessionId,
                userId: ctx.userId
            }
        });
        if (!s || s.endedAt) return {
            ok: true
        };
        const endedAt = new Date();
        await this.prisma.cameraViewSession.update({
            where: {
                id: s.id
            },
            data: {
                endedAt
            }
        });
        await this.audit.record({
            action: 'cctv.view.end',
            entity: 'Camera',
            entityId: s.cameraId,
            meta: {
                sessionId: s.id,
                minutes: Math.max(1, Math.round((endedAt.getTime() - s.startedAt.getTime()) / 60_000))
            }
        });
        return {
            ok: true
        };
    }
    async sessions(cameraId) {
        if (!this.canManage()) throw (0, _errors.forbidden)();
        const rows = await this.prisma.cameraViewSession.findMany({
            where: cameraId ? {
                cameraId
            } : {},
            orderBy: {
                startedAt: 'desc'
            },
            take: 100
        });
        const [cams, users] = await Promise.all([
            this.prisma.camera.findMany({
                where: {
                    id: {
                        in: [
                            ...new Set(rows.map((r)=>r.cameraId))
                        ]
                    }
                },
                select: {
                    id: true,
                    name: true
                }
            }),
            this.prisma.user.findMany({
                where: {
                    id: {
                        in: [
                            ...new Set(rows.map((r)=>r.userId))
                        ]
                    }
                },
                select: {
                    id: true,
                    name: true,
                    employee: {
                        select: {
                            fullName: true
                        }
                    }
                }
            })
        ]);
        const cam = new Map(cams.map((c)=>[
                c.id,
                c.name
            ]));
        const usr = new Map(users.map((u)=>[
                u.id,
                u.employee?.fullName ?? u.name
            ]));
        return rows.map((r)=>{
            const end = r.endedAt ?? r.lastBeatAt;
            return {
                id: r.id,
                camera: cam.get(r.cameraId) ?? 'Deleted camera',
                user: usr.get(r.userId) ?? 'Former user',
                startedAt: `${(0, _dates.dayMonth)(r.startedAt)} ${(0, _dates.hhmm)(r.startedAt)}`,
                endedAt: r.endedAt ? (0, _dates.hhmm)(r.endedAt) : null,
                minutes: Math.max(1, Math.round((end.getTime() - r.startedAt.getTime()) / 60_000))
            };
        });
    }
    /** Gateway auth hook (MediaMTX `authHTTPAddress`): token must match the path and an open session. */ async authorize(body) {
        if (body.action && body.action !== 'read' && body.action !== 'playback') return false;
        const token = new URLSearchParams(body.query ?? '').get('token');
        if (!token || !body.path) return false;
        const t = (0, _cctvrules.verifyViewToken)(this.secret(), token);
        if (!t || t.path !== body.path.replace(/^\//, '').split('/')[0]) return false;
        const s = await this.prisma.raw.cameraViewSession.findUnique({
            where: {
                id: t.sid
            }
        });
        return !!s && !s.endedAt;
    }
    // ── Jobs ────────────────────────────────────────────────────────────────
    /** Gateway health poll (gateway mode only): two failed probes → OFFLINE + alert (1/camera/hour). */ async healthPoll() {
        if (this.gateway.mode !== 'gateway') return 0;
        const cams = await this.prisma.camera.findMany({
            where: {
                enabled: true
            }
        });
        let changed = 0;
        for (const c of cams){
            const p = await this.gateway.probe(c.gatewayPath, !!c.rtspUrlEnc);
            const h = (0, _cctvrules.nextHealth)({
                status: c.status,
                failures: this.failures.get(c.id) ?? 0
            }, p.ready);
            this.failures.set(c.id, h.failures);
            if (h.status === c.status && !p.ready) continue;
            const updated = await this.prisma.camera.update({
                where: {
                    id: c.id
                },
                data: p.ready ? {
                    status: 'ONLINE',
                    lastSeenAt: new Date(),
                    lastError: null
                } : {
                    status: h.status,
                    lastError: p.error
                }
            });
            if (h.status !== c.status) {
                changed++;
                await this.broadcast(updated);
            }
            if (h.wentOffline && Date.now() - (this.alerted.get(c.id) ?? 0) > 3_600_000) {
                this.alerted.set(c.id, Date.now());
                const users = await this.notifications.usersWithPermission('cctv.manage');
                await this.notifications.notify({
                    userIds: users,
                    type: 'cctv.offline',
                    title: `Camera offline: ${c.name}`,
                    body: `${c.location}${p.error ? ` · ${p.error}` : ''}`,
                    link: '/cctv'
                });
            }
        }
        return changed;
    }
    /** Sessions without a heartbeat for 3 minutes are closed. */ async reapSessions(now = Date.now()) {
        const stale = await this.prisma.cameraViewSession.findMany({
            where: {
                endedAt: null,
                lastBeatAt: {
                    lt: new Date(now - _cctvrules.SESSION_IDLE_MS)
                }
            }
        });
        for (const s of stale){
            await this.prisma.cameraViewSession.update({
                where: {
                    id: s.id
                },
                data: {
                    endedAt: s.lastBeatAt
                }
            });
            await this.audit.record({
                action: 'cctv.view.end',
                entity: 'Camera',
                entityId: s.cameraId,
                meta: {
                    sessionId: s.id,
                    reaped: true
                }
            }).catch(()=>undefined);
        }
        return stale.length;
    }
};
CctvService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _cryptoservice.CryptoService === "undefined" ? Object : _cryptoservice.CryptoService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway
    ])
], CctvService);

//# sourceMappingURL=cctv.service.js.map