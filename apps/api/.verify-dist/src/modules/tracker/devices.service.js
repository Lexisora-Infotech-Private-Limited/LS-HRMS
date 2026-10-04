"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "DevicesService", {
    enumerable: true,
    get: function() {
        return DevicesService;
    }
});
const _common = require("@nestjs/common");
const _bcryptjs = /*#__PURE__*/ _interop_require_default(require("bcryptjs"));
const _nodecrypto = require("node:crypto");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../core/prisma/prisma.service");
const _authservice = require("../../core/auth/auth.service");
const _tokenservice = require("../../core/auth/token.service");
const _errors = require("../../core/http/errors");
const _auditservice = require("../../core/audit/audit.service");
const _notificationsservice = require("../../core/notifications/notifications.service");
const _realtimegateway = require("../../core/realtime/realtime.gateway");
const _orgservice = require("../../core/org/org.service");
const _requestcontext = require("../../core/context/request-context");
const _decorators = require("../../core/auth/decorators");
const _trackercontextservice = require("./tracker-context.service");
const _trackerrules = require("./tracker.rules");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
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
const codeHash = (tenantId, userId, code)=>(0, _tokenservice.sha256)(`pair:${tenantId}:${userId}:${code}`);
const STALE_DAYS = 7;
let DevicesService = class DevicesService {
    prisma;
    auth;
    tokens;
    audit;
    notifications;
    realtime;
    org;
    tctx;
    log = new _common.Logger('TrackerDevices');
    /** Short cache for the auth-middleware hook (invalidated on revoke). */ activeCache = new Map();
    constructor(prisma, auth, tokens, audit, notifications, realtime, org, tctx){
        this.prisma = prisma;
        this.auth = auth;
        this.tokens = tokens;
        this.audit = audit;
        this.notifications = notifications;
        this.realtime = realtime;
        this.org = org;
        this.tctx = tctx;
    }
    // ── auth-middleware hook ────────────────────────────────────────────────
    async isDeviceActive(deviceId, tenantId) {
        const c = this.activeCache.get(deviceId);
        if (c && Date.now() - c.at < 10_000) return c.ok;
        const d = await this.prisma.raw.trackerDevice.findUnique({
            where: {
                id: deviceId
            },
            select: {
                status: true,
                tenantId: true
            }
        });
        const ok = !!d && d.tenantId === tenantId && d.status === 'ACTIVE';
        this.activeCache.set(deviceId, {
            ok,
            at: Date.now()
        });
        return ok;
    }
    // ── desktop: sign-in & pairing ─────────────────────────────────────────
    async login(input, ip) {
        const tenant = await this.auth.resolveTenant(input.workspace);
        const user = await this.prisma.raw.user.findUnique({
            where: {
                tenantId_email: {
                    tenantId: tenant.id,
                    email: input.email
                }
            },
            include: {
                employee: true
            }
        });
        const ok = user?.passwordHash && await _bcryptjs.default.compare(input.password, user.passwordHash);
        if (!user || !ok) throw new _errors.AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
        if (user.status === 'DISABLED') throw new _errors.AppError(403, 'ACCOUNT_DISABLED', 'Your account is disabled');
        const e = user.employee;
        if (!e) throw new _errors.AppError(403, 'TRACKER_NOT_ELIGIBLE', 'The tracker is for employees. Your account is not linked to an employee record.');
        if (e.status === 'EXITED') throw new _errors.AppError(403, 'ACCOUNT_EXITED', 'Your employment has ended');
        return (0, _requestcontext.runAsTenant)(tenant.id, async ()=>{
            const emp = await this.tctx.employee(e.id);
            const { mode, message } = await this.tctx.modeFor(emp);
            const token = (0, _tokenservice.randomToken)(32);
            const expiresAt = new Date(Date.now() + _trackerrules.PAIR_SESSION_TTL_MIN * 60_000);
            await this.prisma.raw.devicePairingRequest.create({
                data: {
                    tenantId: tenant.id,
                    userId: user.id,
                    employeeId: e.id,
                    sessionTokenHash: (0, _tokenservice.sha256)(token),
                    sessionExpiresAt: expiresAt,
                    mode,
                    ip,
                    permissions: []
                }
            });
            await this.audit.recordRaw(tenant.id, {
                actorUserId: user.id,
                actorName: e.fullName,
                action: 'tracker.login',
                entity: 'User',
                entityId: user.id,
                meta: {
                    mode
                },
                ip
            });
            return {
                pairingToken: token,
                expiresAt: expiresAt.toISOString(),
                mode,
                modeMessage: message,
                user: {
                    name: e.fullName,
                    initials: (0, _shared.initialsOf)(e.fullName),
                    email: user.email,
                    empCode: e.empCode,
                    workMode: e.workMode,
                    tenantName: tenant.brandName ?? tenant.name
                }
            };
        });
    }
    async session(pairingToken) {
        if (!pairingToken) throw new _errors.AppError(401, 'PAIRING_SESSION_REQUIRED', 'Sign in again to pair this device');
        const r = await this.prisma.raw.devicePairingRequest.findUnique({
            where: {
                sessionTokenHash: (0, _tokenservice.sha256)(pairingToken)
            }
        });
        if (!r || r.sessionExpiresAt < new Date()) throw new _errors.AppError(401, 'PAIRING_SESSION_EXPIRED', 'Your sign-in expired. Sign in again to pair this device');
        return r;
    }
    async pairStart(pairingToken, input) {
        const r = await this.session(pairingToken);
        if ([
            'APPROVED',
            'CLAIMED'
        ].includes(r.status)) throw (0, _errors.badRequest)('This device is already paired', 'ALREADY_PAIRED');
        const recent = await this.prisma.raw.devicePairingRequest.count({
            where: {
                tenantId: r.tenantId,
                userId: r.userId,
                codeHash: {
                    not: null
                },
                createdAt: {
                    gte: new Date(Date.now() - 10 * 60_000)
                }
            }
        });
        if (recent >= 6) throw new _errors.AppError(429, 'TOO_MANY_PAIRING_REQUESTS', 'Too many pairing codes requested. Try again in 10 minutes.');
        return (0, _requestcontext.runAsTenant)(r.tenantId, async ()=>{
            const policy = await this.tctx.policyFor(r.employeeId);
            const hostname = input.hostname.replace(/[^\w.\- ]+/g, '').slice(0, 64) || 'DEVICE';
            // cancel older open requests of this user from the same machine
            if (r.deviceId) await this.prisma.raw.trackerDevice.deleteMany({
                where: {
                    id: r.deviceId,
                    status: 'PENDING'
                }
            });
            const device = await this.prisma.raw.trackerDevice.create({
                data: {
                    tenantId: r.tenantId,
                    userId: r.userId,
                    employeeId: r.employeeId,
                    hostname,
                    os: input.os.slice(0, 120),
                    appVersion: input.appVersion,
                    status: 'PENDING'
                }
            });
            let code = '';
            for(let i = 0; i < 5; i++){
                code = String((0, _nodecrypto.randomInt)(0, 1_000_000)).padStart(6, '0');
                const clash = await this.prisma.raw.devicePairingRequest.findFirst({
                    where: {
                        tenantId: r.tenantId,
                        userId: r.userId,
                        status: 'PENDING',
                        codeHash: codeHash(r.tenantId, r.userId, code)
                    }
                });
                if (!clash) break;
            }
            const expiresAt = new Date(Date.now() + _trackerrules.PAIR_CODE_TTL_MIN * 60_000);
            const permissions = policy.screenshotsEnabled ? [
                'activity monitor',
                'screen capture'
            ] : [
                'activity monitor'
            ];
            // one session may regenerate its code ("Get a new code"): the row moves to the new device
            await this.prisma.raw.devicePairingRequest.update({
                where: {
                    id: r.id
                },
                data: {
                    status: 'PENDING',
                    codeHash: codeHash(r.tenantId, r.userId, code),
                    hostname,
                    os: device.os,
                    appVersion: input.appVersion,
                    permissions,
                    expiresAt,
                    deviceId: device.id,
                    // keep the session alive for the whole code lifetime
                    sessionExpiresAt: new Date(Math.max(r.sessionExpiresAt.getTime(), expiresAt.getTime() + 5 * 60_000))
                }
            });
            await this.audit.recordRaw(r.tenantId, {
                actorUserId: r.userId,
                action: 'device.pairing.requested',
                entity: 'TrackerDevice',
                entityId: device.id,
                meta: {
                    hostname,
                    os: device.os,
                    appVersion: input.appVersion
                }
            });
            // web banner: "A device (PRIYA-LAPTOP) is waiting — enter the code shown on it."
            this.realtime.toUser(r.userId, 'device.pairing.requested', {
                deviceId: device.id,
                hostname
            });
            return {
                deviceId: device.id,
                code,
                expiresAt: expiresAt.toISOString(),
                pollAfterSec: 3,
                permissions
            };
        });
    }
    async pairStatus(pairingToken) {
        const r = await this.session(pairingToken);
        if (r.status === 'PENDING' && r.expiresAt && r.expiresAt < new Date()) {
            await this.expireRequest(r.id, r.deviceId);
            return {
                status: 'EXPIRED'
            };
        }
        if (r.status === 'APPROVED' || r.status === 'CLAIMED') {
            const d = await this.prisma.raw.trackerDevice.findUnique({
                where: {
                    id: r.deviceId
                }
            });
            if (!d || d.status !== 'ACTIVE') return {
                status: 'REJECTED'
            };
            if (r.status === 'APPROVED') {
                await this.prisma.raw.devicePairingRequest.update({
                    where: {
                        id: r.id
                    },
                    data: {
                        status: 'CLAIMED',
                        claimedAt: new Date()
                    }
                });
                await this.prisma.raw.trackerDevice.update({
                    where: {
                        id: d.id
                    },
                    data: {
                        lastSeenAt: new Date()
                    }
                });
            }
            return {
                status: 'APPROVED',
                deviceToken: this.tokens.signDevice(r.userId, r.tenantId, d.id),
                deviceId: d.id,
                device: {
                    hostname: d.hostname,
                    os: d.os,
                    appVersion: d.appVersion,
                    pairedAt: (d.pairedAt ?? new Date()).toISOString()
                }
            };
        }
        if (r.status === 'AWAITING_HR') return {
            status: 'AWAITING_HR'
        };
        if (r.status === 'REJECTED' || r.status === 'CANCELLED') return {
            status: 'REJECTED'
        };
        if (r.status === 'EXPIRED') return {
            status: 'EXPIRED'
        };
        return {
            status: 'PENDING'
        };
    }
    async pairCancel(pairingToken) {
        const r = await this.session(pairingToken);
        if ([
            'PENDING',
            'AWAITING_HR',
            'SIGNED_IN'
        ].includes(r.status)) {
            await this.prisma.raw.devicePairingRequest.update({
                where: {
                    id: r.id
                },
                data: {
                    status: 'CANCELLED',
                    sessionExpiresAt: new Date()
                }
            });
            if (r.deviceId) await this.prisma.raw.trackerDevice.deleteMany({
                where: {
                    id: r.deviceId,
                    status: 'PENDING'
                }
            });
        }
        return {
            ok: true
        };
    }
    async expireRequest(id, deviceId) {
        await this.prisma.raw.devicePairingRequest.update({
            where: {
                id
            },
            data: {
                status: 'EXPIRED'
            }
        });
        if (deviceId) await this.prisma.raw.trackerDevice.deleteMany({
            where: {
                id: deviceId,
                status: 'PENDING'
            }
        });
    }
    /** Cron: expire codes after 10 min (AWAITING_HR requests after 72 h). */ async expireStale(tenantId) {
        const now = new Date();
        const stale = await this.prisma.raw.devicePairingRequest.findMany({
            where: {
                tenantId,
                OR: [
                    {
                        status: 'PENDING',
                        expiresAt: {
                            lt: now
                        }
                    },
                    {
                        status: 'AWAITING_HR',
                        createdAt: {
                            lt: new Date(now.getTime() - 72 * 3600_000)
                        }
                    }
                ]
            },
            select: {
                id: true,
                deviceId: true
            }
        });
        for (const s of stale)await this.expireRequest(s.id, s.deviceId);
        return stale.length;
    }
    // ── web: own devices + approve by code ─────────────────────────────────
    async openRequestsFor(userId) {
        return this.prisma.devicePairingRequest.findMany({
            where: {
                userId,
                status: {
                    in: [
                        'PENDING',
                        'AWAITING_HR'
                    ]
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
    }
    async lookupByCode(code) {
        const ctx = (0, _requestcontext.requireContext)();
        const since = new Date(Date.now() - _trackerrules.PAIR_WINDOW_MIN * 60_000);
        const wrong = await this.prisma.devicePairingAttempt.count({
            where: {
                userId: ctx.userId,
                ok: false,
                createdAt: {
                    gte: since
                }
            }
        });
        if ((0, _trackerrules.isRateLimited)(wrong)) throw new _errors.AppError(429, 'PAIRING_LOCKED', 'Too many wrong codes. Try again in 15 minutes.');
        const req = await this.prisma.devicePairingRequest.findFirst({
            where: {
                userId: ctx.userId,
                status: 'PENDING',
                expiresAt: {
                    gt: new Date()
                },
                codeHash: codeHash(ctx.tenantId, ctx.userId, code)
            }
        });
        await this.prisma.devicePairingAttempt.create({
            data: {
                tenantId: ctx.tenantId,
                userId: ctx.userId,
                ok: !!req
            }
        });
        if (!req || !req.deviceId) throw new _errors.AppError(404, 'CODE_NOT_FOUND', 'Code not found. Check the code shown on your tracker, or get a new code.');
        return req;
    }
    async lookup(code) {
        const req = await this.lookupByCode(code);
        return {
            requestId: req.id,
            deviceId: req.deviceId,
            hostname: req.hostname ?? 'Device',
            os: req.os ?? '',
            appVersion: req.appVersion ?? '',
            requestedAt: req.createdAt.toISOString(),
            expiresAt: req.expiresAt.toISOString(),
            permissions: req.permissions
        };
    }
    async approveByCode(code, decision) {
        const ctx = (0, _requestcontext.requireContext)();
        const req = await this.lookupByCode(code);
        const device = await this.prisma.trackerDevice.findUniqueOrThrow({
            where: {
                id: req.deviceId
            }
        });
        if (decision === 'REJECT') {
            await this.prisma.devicePairingRequest.update({
                where: {
                    id: req.id
                },
                data: {
                    status: 'REJECTED'
                }
            });
            await this.prisma.trackerDevice.delete({
                where: {
                    id: device.id
                }
            });
            await this.audit.record({
                action: 'device.pairing.rejected',
                entity: 'TrackerDevice',
                entityId: device.id,
                meta: {
                    hostname: device.hostname
                }
            });
            const hr = await this.notifications.usersWithPermission('devices.manage');
            await this.notifications.notify({
                userIds: hr,
                type: 'security',
                title: `Device pairing rejected by ${ctx.userName}`,
                body: `${ctx.userName} rejected a pairing request from ${device.hostname}. If they did not start it, the password may be compromised.`,
                link: '/devices',
                from: 'Security'
            });
            return {
                status: 'REJECTED',
                device: await this.row({
                    ...device,
                    status: 'REVOKED'
                })
            };
        }
        const active = await this.prisma.trackerDevice.count({
            where: {
                userId: ctx.userId,
                status: 'ACTIVE'
            }
        });
        if (active >= _trackerrules.MAX_ACTIVE_DEVICES) {
            await this.prisma.devicePairingRequest.update({
                where: {
                    id: req.id
                },
                data: {
                    status: 'AWAITING_HR'
                }
            });
            await this.audit.record({
                action: 'device.pairing.awaiting_hr',
                entity: 'TrackerDevice',
                entityId: device.id,
                meta: {
                    hostname: device.hostname,
                    active
                }
            });
            const hr = await this.notifications.usersWithPermission('devices.manage');
            await this.notifications.notify({
                userIds: hr,
                type: 'approval',
                title: `Device pairing awaiting approval · ${ctx.userName}`,
                body: `${device.hostname} · ${device.os} · v${device.appVersion}. ${ctx.userName} already has ${active} active devices.`,
                link: '/devices?tab=pending',
                from: ctx.userName
            });
            return {
                status: 'AWAITING_HR',
                device: await this.row(device, 'AWAITING_HR')
            };
        }
        const d = await this.activate(device, req.id, 'PORTAL_CODE', ctx.userId);
        return {
            status: 'APPROVED',
            device: await this.row(d)
        };
    }
    async activate(device, requestId, method, approvedByUserId) {
        const now = new Date();
        const d = await this.prisma.trackerDevice.update({
            where: {
                id: device.id
            },
            data: {
                status: 'ACTIVE',
                pairedAt: now,
                approvalMethod: method,
                approvedByUserId
            }
        });
        await this.prisma.devicePairingRequest.update({
            where: {
                id: requestId
            },
            data: {
                status: 'APPROVED',
                approvedAt: now,
                approvedByUserId,
                approvalMethod: method
            }
        });
        this.activeCache.delete(d.id);
        await this.audit.record({
            action: 'device.paired',
            entity: 'TrackerDevice',
            entityId: d.id,
            meta: {
                hostname: d.hostname,
                method
            }
        });
        await this.notifications.notify({
            userIds: [
                d.userId
            ],
            type: 'security',
            title: `${d.hostname} paired`,
            body: `New device paired to your account: ${d.hostname} · ${d.os} · v${d.appVersion}. Not you? Revoke it under Profile → Devices.`,
            link: '/me?tab=devices',
            from: 'Lexisora Tracker',
            email: true
        });
        this.realtime.toUser(d.userId, 'device.paired', {
            deviceId: d.id,
            hostname: d.hostname
        });
        return d;
    }
    async myDevices() {
        const ctx = (0, _requestcontext.requireContext)();
        const [devices, open] = await Promise.all([
            this.prisma.trackerDevice.findMany({
                where: {
                    userId: ctx.userId,
                    status: {
                        in: [
                            'ACTIVE',
                            'REVOKED',
                            'PENDING'
                        ]
                    }
                },
                orderBy: [
                    {
                        status: 'asc'
                    },
                    {
                        pairedAt: 'desc'
                    }
                ]
            }),
            this.openRequestsFor(ctx.userId)
        ]);
        const awaiting = new Set(open.filter((o)=>o.status === 'AWAITING_HR').map((o)=>o.deviceId));
        const items = await this.rows(devices.filter((d)=>d.status !== 'PENDING' || awaiting.has(d.id)), awaiting);
        const waiting = open.filter((o)=>o.status === 'PENDING' && o.deviceId && o.expiresAt && o.expiresAt > new Date()).map((o)=>({
                deviceId: o.deviceId,
                hostname: o.hostname ?? 'Device',
                expiresAt: o.expiresAt.toISOString()
            }));
        return {
            items,
            waiting
        };
    }
    /** Devices of another employee (HR/Admin, or their reporting manager read-only). */ async employeeDevices(employeeId) {
        const ctx = (0, _requestcontext.requireContext)();
        const canManage = (0, _decorators.hasPerm)(ctx, 'devices.manage');
        if (!canManage && ctx.employeeId !== employeeId) {
            const tree = ctx.employeeId ? await this.org.reportTree(ctx.employeeId) : [];
            if (!tree.includes(employeeId)) throw (0, _errors.forbidden)();
        }
        const [devices, open] = await Promise.all([
            this.prisma.trackerDevice.findMany({
                where: {
                    employeeId,
                    status: {
                        in: [
                            'ACTIVE',
                            'REVOKED',
                            'PENDING'
                        ]
                    }
                },
                orderBy: [
                    {
                        status: 'asc'
                    },
                    {
                        pairedAt: 'desc'
                    }
                ]
            }),
            this.prisma.devicePairingRequest.findMany({
                where: {
                    employeeId,
                    status: 'AWAITING_HR'
                }
            })
        ]);
        const awaiting = new Set(open.map((o)=>o.deviceId));
        return {
            items: await this.rows(devices.filter((d)=>d.status !== 'PENDING' || awaiting.has(d.id)), awaiting),
            canManage
        };
    }
    async adminList(q) {
        const staleBefore = new Date(Date.now() - STALE_DAYS * 86400_000);
        const awaitingReqs = await this.prisma.devicePairingRequest.findMany({
            where: {
                status: 'AWAITING_HR'
            },
            select: {
                deviceId: true
            }
        });
        const awaitingIds = awaitingReqs.map((r)=>r.deviceId).filter((x)=>!!x);
        const visible = {
            OR: [
                {
                    status: {
                        in: [
                            'ACTIVE',
                            'REVOKED'
                        ]
                    }
                },
                {
                    id: {
                        in: awaitingIds
                    }
                }
            ]
        };
        const tabWhere = {
            all: visible,
            active: {
                status: 'ACTIVE'
            },
            pending: {
                id: {
                    in: awaitingIds
                }
            },
            revoked: {
                status: 'REVOKED'
            },
            stale: {
                status: 'ACTIVE',
                OR: [
                    {
                        lastSeenAt: null
                    },
                    {
                        lastSeenAt: {
                            lt: staleBefore
                        }
                    }
                ]
            }
        };
        let search = {};
        if (q.q) {
            const emps = await this.prisma.employee.findMany({
                where: {
                    OR: [
                        {
                            fullName: {
                                contains: q.q,
                                mode: 'insensitive'
                            }
                        },
                        {
                            empCode: {
                                contains: q.q,
                                mode: 'insensitive'
                            }
                        }
                    ]
                },
                select: {
                    id: true
                }
            });
            search = {
                OR: [
                    {
                        hostname: {
                            contains: q.q,
                            mode: 'insensitive'
                        }
                    },
                    {
                        employeeId: {
                            in: emps.map((e)=>e.id)
                        }
                    }
                ]
            };
        }
        const where = {
            AND: [
                tabWhere[q.tab] ?? visible,
                search
            ]
        };
        const [total, devices, all, active, pending, revoked, stale] = await Promise.all([
            this.prisma.trackerDevice.count({
                where
            }),
            this.prisma.trackerDevice.findMany({
                where,
                orderBy: [
                    {
                        lastSeenAt: {
                            sort: 'desc',
                            nulls: 'last'
                        }
                    },
                    {
                        createdAt: 'desc'
                    }
                ],
                skip: (q.page - 1) * q.pageSize,
                take: q.pageSize
            }),
            this.prisma.trackerDevice.count({
                where: tabWhere.all
            }),
            this.prisma.trackerDevice.count({
                where: tabWhere.active
            }),
            this.prisma.trackerDevice.count({
                where: tabWhere.pending
            }),
            this.prisma.trackerDevice.count({
                where: tabWhere.revoked
            }),
            this.prisma.trackerDevice.count({
                where: tabWhere.stale
            })
        ]);
        const latestVersion = await this.latestVersion();
        return {
            items: await this.rows(devices, new Set(awaitingIds), latestVersion),
            total,
            page: q.page,
            pageSize: q.pageSize,
            counts: {
                all,
                active,
                pending,
                revoked,
                stale
            },
            latestVersion
        };
    }
    async latestVersion() {
        const vs = await this.prisma.trackerDevice.findMany({
            where: {
                status: 'ACTIVE'
            },
            select: {
                appVersion: true
            },
            distinct: [
                'appVersion'
            ]
        });
        return vs.map((v)=>v.appVersion).sort(_trackerrules.compareVersions).pop() ?? null;
    }
    async hrDecision(deviceId, decision, reason) {
        const ctx = (0, _requestcontext.requireContext)();
        const device = await this.prisma.trackerDevice.findUnique({
            where: {
                id: deviceId
            }
        });
        if (!device) throw (0, _errors.notFound)('Device');
        const req = await this.prisma.devicePairingRequest.findFirst({
            where: {
                deviceId,
                status: 'AWAITING_HR'
            }
        });
        if (!req) throw (0, _errors.badRequest)('This device is not waiting for HR approval', 'NOT_AWAITING_HR');
        if (decision === 'REJECT') {
            await this.prisma.devicePairingRequest.update({
                where: {
                    id: req.id
                },
                data: {
                    status: 'REJECTED'
                }
            });
            await this.prisma.trackerDevice.update({
                where: {
                    id: deviceId
                },
                data: {
                    status: 'REVOKED',
                    revokedAt: new Date(),
                    revokedByUserId: ctx.userId,
                    revokeReason: reason || 'Pairing rejected by HR'
                }
            });
            await this.audit.record({
                action: 'device.pairing.rejected',
                entity: 'TrackerDevice',
                entityId: deviceId,
                meta: {
                    by: 'HR',
                    reason: reason ?? null
                }
            });
            await this.notifications.notify({
                userIds: [
                    device.userId
                ],
                type: 'security',
                title: `${device.hostname} pairing rejected`,
                body: reason ?? `Rejected by ${ctx.userName}`,
                link: '/me?tab=devices',
                from: ctx.userName
            });
            return this.row({
                ...device,
                status: 'REVOKED'
            });
        }
        const d = await this.activate(device, req.id, 'HR', ctx.userId);
        return this.row(d);
    }
    async revoke(deviceId, reason) {
        const ctx = (0, _requestcontext.requireContext)();
        const d = await this.prisma.trackerDevice.findUnique({
            where: {
                id: deviceId
            }
        });
        if (!d) throw (0, _errors.notFound)('Device');
        const own = d.userId === ctx.userId;
        if (!own && !(0, _decorators.hasPerm)(ctx, 'devices.manage')) throw (0, _errors.forbidden)();
        if (!own && !reason?.trim()) throw (0, _errors.badRequest)('Give a reason for revoking this device', 'REASON_REQUIRED');
        if (d.status === 'REVOKED') return this.row(d);
        const updated = await this.prisma.trackerDevice.update({
            where: {
                id: deviceId
            },
            data: {
                status: 'REVOKED',
                revokedAt: new Date(),
                revokedByUserId: ctx.userId,
                revokeReason: reason?.trim() || (own ? 'Revoked by owner' : null)
            }
        });
        await this.prisma.devicePairingRequest.updateMany({
            where: {
                deviceId,
                status: {
                    in: [
                        'PENDING',
                        'AWAITING_HR'
                    ]
                }
            },
            data: {
                status: 'CANCELLED'
            }
        });
        this.activeCache.delete(deviceId);
        this.realtime.toRoom(`d:${deviceId}`, _shared.TRACKER_SOCKET_EVENTS.deviceRevoked, {
            by: ctx.userName,
            reason: updated.revokeReason,
            message: `This device was removed by ${ctx.userName}`
        });
        await this.audit.record({
            action: 'device.revoked',
            entity: 'TrackerDevice',
            entityId: deviceId,
            meta: {
                hostname: d.hostname,
                by: ctx.userName ?? null,
                reason: updated.revokeReason
            }
        });
        if (!own) {
            await this.notifications.notify({
                userIds: [
                    d.userId
                ],
                type: 'security',
                title: `Your device was revoked by ${ctx.userName}`,
                body: `${d.hostname} was signed out of the tracker. Reason: ${reason}`,
                link: '/me?tab=devices',
                from: ctx.userName,
                email: true
            });
        }
        return this.row(updated);
    }
    /** Offboarding: revoke every device of an exited employee (event employee.statusChanged). */ async revokeAllFor(employeeId, reason) {
        const devices = await this.prisma.trackerDevice.findMany({
            where: {
                employeeId,
                status: {
                    in: [
                        'ACTIVE',
                        'PENDING'
                    ]
                }
            }
        });
        for (const d of devices){
            await this.prisma.trackerDevice.update({
                where: {
                    id: d.id
                },
                data: {
                    status: 'REVOKED',
                    revokedAt: new Date(),
                    revokeReason: reason
                }
            });
            this.activeCache.delete(d.id);
            this.realtime.toRoom(`d:${d.id}`, _shared.TRACKER_SOCKET_EVENTS.deviceRevoked, {
                by: 'HR',
                reason,
                message: 'This device was removed by HR'
            });
        }
        if (devices.length) await this.audit.record({
            action: 'device.revoked',
            entity: 'Employee',
            entityId: employeeId,
            meta: {
                count: devices.length,
                reason
            }
        });
        return devices.length;
    }
    // ── device-token endpoints ──────────────────────────────────────────────
    async unpairCurrent(deviceId) {
        const d = await this.prisma.trackerDevice.update({
            where: {
                id: deviceId
            },
            data: {
                status: 'REVOKED',
                revokedAt: new Date(),
                revokeReason: 'Signed out & unpaired on the device'
            }
        });
        this.activeCache.delete(deviceId);
        await this.audit.record({
            action: 'device.unpaired',
            entity: 'TrackerDevice',
            entityId: deviceId,
            meta: {
                hostname: d.hostname
            }
        });
        return {
            ok: true
        };
    }
    async heartbeat(deviceId, employeeId, input) {
        const d = await this.prisma.trackerDevice.update({
            where: {
                id: deviceId
            },
            data: {
                lastSeenAt: new Date(),
                liveStatus: input.status,
                liveTaskId: input.taskId ?? null,
                queueDepth: input.queueDepth,
                ...input.appVersion ? {
                    appVersion: input.appVersion
                } : {},
                ...input.displays ? {
                    displays: input.displays
                } : {}
            }
        });
        const policy = await this.tctx.policyFor(employeeId);
        return {
            serverTime: new Date().toISOString(),
            deviceStatus: d.status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED',
            policyUpdatedAt: policy.updatedAt
        };
    }
    async touch(deviceId, data = {}) {
        await this.prisma.trackerDevice.update({
            where: {
                id: deviceId
            },
            data: {
                lastSeenAt: new Date(),
                ...data
            }
        }).catch(()=>undefined);
    }
    async activeDeviceIdsForEmployees(employeeIds) {
        const rows = await this.prisma.trackerDevice.findMany({
            where: {
                employeeId: {
                    in: employeeIds
                },
                status: 'ACTIVE'
            },
            select: {
                id: true
            }
        });
        return rows.map((r)=>r.id);
    }
    // ── mapping ─────────────────────────────────────────────────────────────
    async row(d, status) {
        return (await this.rows([
            d
        ], status === 'AWAITING_HR' ? new Set([
            d.id
        ]) : new Set()))[0];
    }
    async rows(devices, awaiting, latest) {
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(devices.map((d)=>d.employeeId))
                    ]
                }
            },
            select: {
                id: true,
                fullName: true,
                empCode: true,
                workMode: true
            }
        });
        const byId = new Map(emps.map((e)=>[
                e.id,
                e
            ]));
        const latestV = latest === undefined ? await this.latestVersion() : latest;
        return devices.map((d)=>{
            const e = byId.get(d.employeeId);
            return {
                id: d.id,
                hostname: d.hostname,
                os: d.os,
                appVersion: d.appVersion,
                status: awaiting.has(d.id) && d.status === 'PENDING' ? 'AWAITING_HR' : d.status,
                pairedAt: d.pairedAt?.toISOString() ?? null,
                lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
                lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
                queueDepth: d.queueDepth,
                revokedAt: d.revokedAt?.toISOString() ?? null,
                revokeReason: d.revokeReason,
                employee: e ? {
                    id: e.id,
                    name: e.fullName,
                    empCode: e.empCode,
                    workMode: e.workMode
                } : null,
                outdated: !!latestV && d.status === 'ACTIVE' && (0, _trackerrules.compareVersions)(d.appVersion, latestV) < 0
            };
        });
    }
};
DevicesService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _authservice.AuthService === "undefined" ? Object : _authservice.AuthService,
        typeof _tokenservice.TokenService === "undefined" ? Object : _tokenservice.TokenService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _orgservice.OrgService === "undefined" ? Object : _orgservice.OrgService,
        typeof _trackercontextservice.TrackerContextService === "undefined" ? Object : _trackercontextservice.TrackerContextService
    ])
], DevicesService);

//# sourceMappingURL=devices.service.js.map