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
    get BrandingController () {
        return BrandingController;
    },
    get BrandingService () {
        return BrandingService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _requestcontext = require("../../../core/context/request-context");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _storageservice = require("../../../core/storage/storage.service");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _errors = require("../../../core/http/errors");
const _rbaclogic = require("../rbac/rbac.logic");
const _tenantslogic = require("../tenants/tenants.logic");
const _brandinglogic = require("./branding.logic");
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
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
const publicLogoUrl = (id)=>id ? `/api/v1/files/${id}/public` : null;
let BrandingService = class BrandingService {
    prisma;
    storage;
    audit;
    notifications;
    realtime;
    constructor(prisma, storage, audit, notifications, realtime){
        this.prisma = prisma;
        this.storage = storage;
        this.audit = audit;
        this.notifications = notifications;
        this.realtime = realtime;
    }
    tenant() {
        return this.prisma.raw.tenant.findUniqueOrThrow({
            where: {
                id: (0, _requestcontext.requireContext)().tenantId
            }
        });
    }
    async plan() {
        return (0, _rbaclogic.effectivePlan)(await this.prisma.subscription.findFirst({
            select: {
                planCode: true,
                status: true
            }
        }));
    }
    async get() {
        const [t, plan, versions] = await Promise.all([
            this.tenant(),
            this.plan(),
            this.prisma.brandingVersion.findMany({
                orderBy: {
                    version: 'desc'
                },
                take: 12
            })
        ]);
        const current = versions.find((v)=>v.status === 'PUBLISHED') ?? null;
        return {
            presetKey: (0, _brandinglogic.presetFor)(t.brandAccent, t.brandAccent2) ?? (current && current.primaryHex === t.brandAccent ? current.presetKey : null),
            primaryHex: t.brandAccent,
            secondaryHex: t.brandAccent2,
            logoFileId: t.logoFileId,
            logoUrl: publicLogoUrl(t.logoFileId),
            productName: t.brandName,
            tenantName: t.name,
            domain: t.domain,
            version: current?.version ?? null,
            publishedAt: current?.publishedAt.toISOString() ?? null,
            publishedByName: current?.publishedByName ?? null,
            locked: _shared.PLAN_RANK[plan] < _shared.PLAN_RANK.GROWTH,
            planCode: plan,
            versions: versions.map((v)=>({
                    id: v.id,
                    version: v.version,
                    status: v.status,
                    presetKey: v.presetKey,
                    primaryHex: v.primaryHex,
                    secondaryHex: v.secondaryHex,
                    productName: v.productName,
                    domain: v.domain,
                    publishedAt: v.publishedAt.toISOString(),
                    publishedByName: v.publishedByName
                }))
        };
    }
    /** Why `domain` can't be this workspace's login address, or null + its slug. */ async domainProblem(domain, tenantId) {
        const slug = (0, _shared.slugOfDomain)(domain);
        if (!slug) return {
            slug: null,
            problem: `Custom domains are available on Enterprise. Use an address like yourcompany.${_shared.ROOT_DOMAIN}`,
            status: 400,
            code: 'CUSTOM_DOMAIN_NOT_AVAILABLE'
        };
        const p = (0, _tenantslogic.slugProblem)(slug);
        if (p) return {
            slug,
            problem: p,
            status: 400,
            code: 'DOMAIN_INVALID'
        };
        const taken = await this.prisma.raw.tenant.findFirst({
            where: {
                id: {
                    not: tenantId
                },
                OR: [
                    {
                        domain
                    },
                    {
                        slug
                    }
                ]
            },
            select: {
                id: true
            }
        });
        if (taken) return {
            slug,
            problem: `${domain} is already taken`,
            status: 409,
            code: 'DOMAIN_TAKEN'
        };
        return {
            slug,
            problem: null,
            status: 200,
            code: 'OK'
        };
    }
    async domainCheck(raw) {
        const domain = (0, _shared.normalizeLoginDomain)(raw || '');
        const r = await this.domainProblem(domain, (0, _requestcontext.requireContext)().tenantId);
        return {
            domain,
            available: !r.problem,
            message: r.problem ?? `${domain} is available`
        };
    }
    /** Copy an uploaded (private) logo into a public, validated brand asset. */ async publicLogo(fileId) {
        const { row, data } = await this.storage.read(fileId);
        if (!row.isPrivate && row.category === 'brand-logo') return row.id;
        const check = (0, _brandinglogic.checkLogo)(row.mime, data);
        if (!check.ok) throw (0, _errors.badRequest)(check.message, 'LOGO_INVALID');
        const saved = await this.storage.save({
            data: check.data,
            filename: row.filename,
            mime: row.mime,
            category: 'brand-logo',
            isPrivate: false
        });
        return saved.id;
    }
    async publish(input, reason) {
        const ctx = (0, _requestcontext.requireContext)();
        const t = await this.tenant();
        if (_shared.PLAN_RANK[await this.plan()] < _shared.PLAN_RANK.GROWTH) {
            throw new _errors.AppError(402, 'FEATURE_NOT_IN_PLAN', 'Branding is available on Growth. Upgrade to publish your own theme.');
        }
        const d = await this.domainProblem(input.domain, t.id);
        if (d.problem) throw new _errors.AppError(d.status, d.code, d.problem);
        const primary = input.primaryHex.toLowerCase();
        const secondary = input.secondaryHex.toLowerCase();
        const logoFileId = input.logoFileId ? input.logoFileId === t.logoFileId ? t.logoFileId : await this.publicLogo(input.logoFileId) : null;
        const productName = input.productName?.trim() || null;
        // A preset is recorded only when the colours really are that preset ("Custom" otherwise).
        const presetKey = (0, _brandinglogic.presetFor)(primary, secondary);
        const last = await this.prisma.brandingVersion.findFirst({
            orderBy: {
                version: 'desc'
            },
            select: {
                version: true
            }
        });
        const version = (last?.version ?? 0) + 1;
        await this.prisma.raw.$transaction([
            this.prisma.raw.brandingVersion.updateMany({
                where: {
                    tenantId: t.id,
                    status: 'PUBLISHED'
                },
                data: {
                    status: 'ARCHIVED'
                }
            }),
            this.prisma.raw.brandingVersion.create({
                data: {
                    tenantId: t.id,
                    version,
                    status: 'PUBLISHED',
                    presetKey,
                    primaryHex: primary,
                    secondaryHex: secondary,
                    logoFileId,
                    productName,
                    domain: input.domain,
                    publishedById: ctx.userId ?? null,
                    publishedByName: ctx.userName ?? null
                }
            }),
            this.prisma.raw.tenant.update({
                where: {
                    id: t.id
                },
                data: {
                    brandAccent: primary,
                    brandAccent2: secondary,
                    logoFileId,
                    brandName: productName,
                    domain: input.domain,
                    slug: d.slug
                }
            })
        ]);
        const presetName = _shared.BRAND_PRESETS.find((p)=>p.key === presetKey)?.name ?? `Custom ${primary} / ${secondary}`;
        await this.audit.record({
            action: reason ? 'branding.restored' : 'branding.published',
            entity: 'Tenant',
            entityId: t.id,
            meta: {
                summary: `${reason ?? 'Published theme'} v${version} · ${presetName}`,
                changes: {
                    primary: [
                        t.brandAccent,
                        primary
                    ],
                    secondary: [
                        t.brandAccent2,
                        secondary
                    ],
                    logo: [
                        t.logoFileId ? 'set' : 'none',
                        logoFileId ? logoFileId === t.logoFileId ? 'unchanged' : 'new' : 'none'
                    ],
                    productName: [
                        t.brandName,
                        productName
                    ],
                    domain: [
                        t.domain,
                        input.domain
                    ]
                }
            }
        });
        const others = (await this.notifications.usersWithPermission('branding.manage')).filter((u)=>u !== ctx.userId);
        await this.notifications.notify({
            userIds: others,
            type: 'branding.published',
            title: `${ctx.userName ?? 'An admin'} published a new theme (v${version})`,
            body: presetName,
            link: '/branding',
            from: 'Branding'
        });
        if (input.domain !== t.domain) {
            await this.audit.record({
                action: 'domain.slug_changed',
                entity: 'Tenant',
                entityId: t.id,
                meta: {
                    summary: `Login domain changed from ${t.domain} to ${input.domain}`,
                    from: t.domain,
                    to: input.domain
                }
            });
            const everyone = await this.prisma.user.findMany({
                where: {
                    status: 'ACTIVE'
                },
                select: {
                    id: true
                }
            });
            await this.notifications.notify({
                userIds: everyone.map((u)=>u.id).filter((u)=>u !== ctx.userId),
                type: 'tenant.domain_changed',
                title: `Sign in at ${input.domain} from now on`,
                body: `${t.name} moved its workspace address from ${t.domain} on ${(0, _shared.formatDate)(new Date())}. Update the workspace field in the desktop tracker and your bookmarks.`,
                link: '/branding',
                from: 'Admin',
                email: true
            });
        }
        this.realtime.toTenant(t.id, 'branding.updated', {
            version
        });
        return this.get();
    }
    async restore(versionId) {
        const v = await this.prisma.brandingVersion.findUnique({
            where: {
                id: versionId
            }
        });
        if (!v) throw (0, _errors.notFound)('Theme version');
        const t = await this.tenant();
        return this.publish({
            presetKey: v.presetKey,
            primaryHex: v.primaryHex,
            secondaryHex: v.secondaryHex,
            logoFileId: v.logoFileId,
            productName: v.productName,
            domain: t.domain
        }, `Restored v${v.version} as`);
    }
};
BrandingService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _storageservice.StorageService === "undefined" ? Object : _storageservice.StorageService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway
    ])
], BrandingService);
let BrandingController = class BrandingController {
    branding;
    constructor(branding){
        this.branding = branding;
    }
    get() {
        return this.branding.get();
    }
    domainCheck(domain) {
        return this.branding.domainCheck(domain ?? '');
    }
    publish(dto) {
        return this.branding.publish(dto);
    }
    restore(id) {
        return this.branding.restore(id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], BrandingController.prototype, "get", null);
_ts_decorate([
    (0, _common.Get)('domain-check'),
    _ts_param(0, (0, _common.Query)('domain')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], BrandingController.prototype, "domainCheck", null);
_ts_decorate([
    (0, _common.Post)('publish'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.publishBrandingSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof PublishBrandingInput === "undefined" ? Object : PublishBrandingInput
    ]),
    _ts_metadata("design:returntype", void 0)
], BrandingController.prototype, "publish", null);
_ts_decorate([
    (0, _common.Post)('versions/:id/restore'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], BrandingController.prototype, "restore", null);
BrandingController = _ts_decorate([
    (0, _common.Controller)('branding'),
    (0, _decorators.RequirePerm)('branding.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof BrandingService === "undefined" ? Object : BrandingService
    ])
], BrandingController);

//# sourceMappingURL=branding.service.js.map