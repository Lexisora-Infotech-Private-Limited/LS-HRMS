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
    get EOTM_BADGE () {
        return EOTM_BADGE;
    },
    get KudosService () {
        return KudosService;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _eventsservice = require("../../../core/registry/events.service");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _audience = require("../common/audience");
const _certificatesservice = require("../common/certificates.service");
const _html = require("../common/html");
const _dates = require("../common/dates");
const _feedservice = require("../feed/feed.service");
const _kudosrules = require("./kudos.rules");
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
const EOTM_BADGE = 'Employee of the Month';
const DAY = 86_400_000;
let KudosService = class KudosService {
    prisma;
    audience;
    notifications;
    audit;
    events;
    certificates;
    feed;
    log = new _common.Logger('Kudos');
    constructor(prisma, audience, notifications, audit, events, certificates, feed){
        this.prisma = prisma;
        this.audience = audience;
        this.notifications = notifications;
        this.audit = audit;
        this.events = events;
        this.certificates = certificates;
        this.feed = feed;
    }
    viewer() {
        const ctx = (0, _requestcontext.requireContext)();
        return {
            ctx,
            me: ctx.employeeId ?? null,
            moderator: (0, _decorators.hasPerm)(ctx, 'kudos.eotm') || (0, _decorators.hasPerm)(ctx, 'feed.publish')
        };
    }
    /** The system "Employee of the Month" badge (created on first use). */ async eotmBadge() {
        const b = await this.prisma.badge.findFirst({
            where: {
                name: EOTM_BADGE
            }
        });
        if (b) return b;
        return this.prisma.badge.create({
            data: {
                name: EOTM_BADGE,
                icon: 'trophy',
                description: 'Announced monthly by HR',
                system: true
            }
        });
    }
    // ── Kudos ────────────────────────────────────────────────────────────────
    tabWhere(tab, me) {
        const base = {
            revokedAt: null
        };
        if (tab === 'given') return {
            ...base,
            giverEmployeeId: me ?? '__none__'
        };
        if (tab === 'received') return {
            ...base,
            recipientEmployeeId: me ?? '__none__'
        };
        return base;
    }
    async list(tab, page, pageSize) {
        const v = this.viewer();
        const where = this.tabWhere(tab, v.me);
        const monthStart = (0, _dates.istInstant)(`${(0, _dates.todayKey)().slice(0, 7)}-01`, '00:00');
        const [rows, total, all, given, received, month, current] = await Promise.all([
            this.prisma.kudos.findMany({
                where,
                include: {
                    badge: true
                },
                orderBy: {
                    createdAt: 'desc'
                },
                skip: (page - 1) * pageSize,
                take: pageSize
            }),
            this.prisma.kudos.count({
                where
            }),
            this.prisma.kudos.count({
                where: this.tabWhere('all', v.me)
            }),
            this.prisma.kudos.count({
                where: this.tabWhere('given', v.me)
            }),
            this.prisma.kudos.count({
                where: this.tabWhere('received', v.me)
            }),
            this.prisma.kudos.findMany({
                where: {
                    revokedAt: null,
                    createdAt: {
                        gte: monthStart
                    },
                    badge: {
                        system: false
                    }
                },
                include: {
                    badge: true
                }
            }),
            this.currentAward()
        ]);
        const top = (0, _kudosrules.topBadge)(month.map((k)=>({
                badge: k.badge.name,
                createdAt: k.createdAt
            })));
        return {
            items: await this.rows(rows, v),
            total,
            page,
            pageSize,
            counts: {
                all,
                given,
                received
            },
            kpis: {
                thisMonth: month.length,
                topBadge: top?.name ?? null,
                topBadgeCount: top?.count ?? 0,
                eotm: current ? {
                    name: current.name,
                    month: current.monthLabel
                } : null
            }
        };
    }
    async rows(rows, v) {
        const people = await this.audience.briefs(rows.flatMap((r)=>[
                r.giverEmployeeId,
                r.recipientEmployeeId
            ]));
        const awards = await this.prisma.eotmAward.findMany({
            where: {
                postId: {
                    in: rows.map((r)=>r.postId).filter((x)=>!!x)
                }
            }
        });
        const now = Date.now();
        return rows.map((r)=>{
            const award = r.badge.system ? awards.find((a)=>a.postId === r.postId) : undefined;
            return {
                id: r.id,
                employee: people.get(r.recipientEmployeeId)?.name ?? '—',
                employeeId: r.recipientEmployeeId,
                badge: r.badge.name,
                from: people.get(r.giverEmployeeId)?.name ?? '—',
                message: r.message,
                date: (0, _dates.dayMonth)(r.createdAt),
                isEotm: r.badge.system,
                certificateId: award && !award.revokedAt ? award.certificateId : null,
                canRevoke: !r.badge.system && !r.revokedAt && (v.moderator || !!v.me && r.giverEmployeeId === v.me && now - r.createdAt.getTime() <= DAY)
            };
        });
    }
    async give(dto) {
        const v = this.viewer();
        if (!v.me) throw (0, _errors.forbidden)('Only employees can give kudos');
        const me = v.me;
        const [recipient, badge] = await Promise.all([
            this.prisma.employee.findUnique({
                where: {
                    id: dto.recipientEmployeeId
                },
                select: {
                    id: true,
                    fullName: true,
                    firstName: true,
                    status: true,
                    userId: true
                }
            }),
            this.prisma.badge.findUnique({
                where: {
                    id: dto.badgeId
                }
            })
        ]);
        if (!recipient || ![
            'ACTIVE',
            'NOTICE_PERIOD'
        ].includes(recipient.status)) throw (0, _errors.badRequest)('Pick an active employee', 'KUDOS_RECIPIENT');
        if (!badge || !badge.active || badge.system) throw (0, _errors.badRequest)('Pick a badge', 'KUDOS_BADGE');
        const now = new Date();
        const recent = await this.prisma.kudos.findMany({
            where: {
                giverEmployeeId: me,
                revokedAt: null,
                createdAt: {
                    gte: new Date(now.getTime() - 7 * DAY)
                }
            },
            select: {
                recipientEmployeeId: true,
                badgeId: true,
                createdAt: true
            }
        });
        const err = (0, _kudosrules.kudosLimitError)({
            giverId: me,
            recipientId: recipient.id,
            badgeId: badge.id,
            recipientName: recipient.fullName,
            recent,
            now
        });
        if (err) throw new _errors.AppError(err.status, err.code, err.message);
        const tenantId = (0, _requestcontext.currentTenantId)();
        const body = (0, _kudosrules.kudosPostBody)(dto.message);
        const { kudos, post } = await this.prisma.$transaction(async (tx)=>{
            const kudos = await tx.kudos.create({
                data: {
                    tenantId,
                    giverEmployeeId: me,
                    recipientEmployeeId: recipient.id,
                    badgeId: badge.id,
                    message: dto.message
                }
            });
            const post = await tx.post.create({
                data: {
                    tenantId,
                    kind: 'KUDOS',
                    status: 'PUBLISHED',
                    title: (0, _kudosrules.kudosPostTitle)(badge.name, recipient.fullName),
                    bodyHtml: body,
                    excerpt: (0, _html.excerptOf)(body, 300),
                    authorEmployeeId: me,
                    publishedAt: now,
                    publishedByEmployeeId: me,
                    kudosId: kudos.id
                }
            });
            await tx.kudos.update({
                where: {
                    id: kudos.id
                },
                data: {
                    postId: post.id
                }
            });
            return {
                kudos,
                post
            };
        });
        const giver = (await this.audience.briefs([
            me
        ])).get(me);
        if (recipient.userId) {
            await this.notifications.notify({
                userIds: [
                    recipient.userId
                ],
                type: 'kudos.received',
                title: `${giver?.name ?? 'Someone'} gave you the ${badge.name} badge`,
                body: dto.message,
                link: '/kudos?tab=received',
                from: giver?.name ?? 'Kudos',
                email: true
            });
        }
        await this.audit.record({
            action: 'kudos.give',
            entity: 'Kudos',
            entityId: kudos.id,
            meta: {
                recipient: recipient.fullName,
                badge: badge.name
            }
        });
        await this.feed.afterPublish(post, {
            notify: false
        });
        this.events.emit('kudos.given', {
            kudosId: kudos.id,
            employeeId: recipient.id,
            badge: badge.name
        });
        const [row] = await this.rows([
            {
                ...kudos,
                postId: post.id,
                badge
            }
        ], v);
        return row;
    }
    async revoke(id, reason) {
        const v = this.viewer();
        const k = await this.prisma.kudos.findUnique({
            where: {
                id
            },
            include: {
                badge: true
            }
        });
        if (!k || k.revokedAt) throw (0, _errors.notFound)('Kudos');
        if (k.badge.system) throw (0, _errors.badRequest)('Revoke the Employee of the Month award instead', 'KUDOS_EOTM');
        const own = !!v.me && k.giverEmployeeId === v.me && Date.now() - k.createdAt.getTime() <= DAY;
        if (!own && !v.moderator) throw (0, _errors.forbidden)('Kudos can be withdrawn by the giver within 24 hours, or by HR');
        await this.prisma.kudos.update({
            where: {
                id
            },
            data: {
                revokedAt: new Date()
            }
        });
        if (k.postId) await this.prisma.post.updateMany({
            where: {
                id: k.postId
            },
            data: {
                status: 'ARCHIVED',
                pinned: false
            }
        });
        await this.audit.record({
            action: 'kudos.revoke',
            entity: 'Kudos',
            entityId: id,
            meta: {
                reason
            }
        });
        this.events.emit('kudos.revoked', {
            kudosId: id,
            employeeId: k.recipientEmployeeId
        });
        return {
            ok: true
        };
    }
    // ── Badges ───────────────────────────────────────────────────────────────
    async badges() {
        const v = this.viewer();
        await this.eotmBadge();
        const [rows, uses] = await Promise.all([
            this.prisma.badge.findMany({
                where: v.moderator ? {} : {
                    active: true
                },
                orderBy: [
                    {
                        system: 'asc'
                    },
                    {
                        createdAt: 'asc'
                    }
                ]
            }),
            this.prisma.kudos.groupBy({
                by: [
                    'badgeId'
                ],
                where: {
                    revokedAt: null
                },
                _count: {
                    _all: true
                }
            })
        ]);
        return rows.map((b)=>({
                id: b.id,
                name: b.name,
                icon: b.icon,
                description: b.description,
                system: b.system,
                active: b.active,
                uses: uses.find((u)=>u.badgeId === b.id)?._count._all ?? 0
            }));
    }
    async saveBadge(id, dto) {
        const clash = await this.prisma.badge.findFirst({
            where: {
                name: {
                    equals: dto.name,
                    mode: 'insensitive'
                },
                ...id ? {
                    id: {
                        not: id
                    }
                } : {}
            }
        });
        if (clash) throw (0, _errors.conflict)('A badge with this name already exists', 'BADGE_EXISTS');
        if (id) {
            const b = await this.prisma.badge.findUnique({
                where: {
                    id
                }
            });
            if (!b) throw (0, _errors.notFound)('Badge');
            if (b.system) throw (0, _errors.badRequest)('The Employee of the Month badge cannot be changed', 'BADGE_SYSTEM');
            await this.prisma.badge.update({
                where: {
                    id
                },
                data: {
                    name: dto.name,
                    icon: dto.icon,
                    description: dto.description,
                    active: dto.active
                }
            });
        } else {
            await this.prisma.badge.create({
                data: {
                    name: dto.name,
                    icon: dto.icon,
                    description: dto.description,
                    active: dto.active
                }
            });
        }
        await this.audit.record({
            action: 'badge.save',
            entity: 'Badge',
            entityId: id,
            meta: {
                name: dto.name,
                active: dto.active
            }
        });
        return this.badges();
    }
    /** Distinct badges an employee has earned, with counts (profile header tags). */ async employeeBadges(employeeId) {
        const rows = await this.prisma.kudos.findMany({
            where: {
                recipientEmployeeId: employeeId,
                revokedAt: null
            },
            include: {
                badge: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        const by = new Map();
        for (const r of rows){
            const x = by.get(r.badgeId) ?? {
                badgeId: r.badgeId,
                name: r.badge.name,
                icon: r.badge.icon,
                count: 0,
                lastAt: r.createdAt.toISOString()
            };
            x.count++;
            by.set(r.badgeId, x);
        }
        return [
            ...by.values()
        ];
    }
    // ── Employee of the Month ────────────────────────────────────────────────
    async eotmRows(awards) {
        const people = await this.audience.briefs(awards.flatMap((a)=>[
                a.employeeId,
                a.announcedByEmployeeId
            ]));
        const certs = await this.prisma.certificate.findMany({
            where: {
                id: {
                    in: awards.map((a)=>a.certificateId).filter((x)=>!!x)
                }
            },
            select: {
                id: true,
                status: true
            }
        });
        return awards.map((a)=>({
                id: a.id,
                month: a.month,
                monthLabel: (0, _dates.monthLabel)(a.month),
                employeeId: a.employeeId,
                name: people.get(a.employeeId)?.name ?? '—',
                citation: a.citation,
                announcedBy: people.get(a.announcedByEmployeeId)?.name ?? '—',
                announcedAt: a.createdAt.toISOString(),
                postId: a.postId,
                certificateId: a.certificateId,
                certificateStatus: certs.find((c)=>c.id === a.certificateId)?.status ?? null,
                revoked: !!a.revokedAt
            }));
    }
    /** This month's award, else the latest earlier one. */ async currentAward() {
        const month = (0, _dates.todayKey)().slice(0, 7);
        const a = await this.prisma.eotmAward.findFirst({
            where: {
                revokedAt: null,
                month: {
                    lte: month
                }
            },
            orderBy: {
                month: 'desc'
            }
        });
        return a ? (await this.eotmRows([
            a
        ]))[0] ?? null : null;
    }
    async eotmList(year) {
        const where = year ? {
            month: {
                startsWith: `${year}-`
            }
        } : {};
        return this.eotmRows(await this.prisma.eotmAward.findMany({
            where,
            orderBy: {
                month: 'desc'
            },
            take: 36
        }));
    }
    async eotmOptions() {
        const months = (0, _kudosrules.eotmMonthOptions)((0, _dates.todayKey)());
        const taken = await this.prisma.eotmAward.findMany({
            where: {
                month: {
                    in: months
                },
                revokedAt: null
            },
            select: {
                month: true
            }
        });
        return {
            months: months.map((m)=>({
                    value: m,
                    label: (0, _dates.monthLabel)(m),
                    taken: taken.some((t)=>t.month === m)
                })),
            current: await this.currentAward()
        };
    }
    async announce(dto) {
        const v = this.viewer();
        if (!v.me) throw (0, _errors.forbidden)('Only employees can announce awards');
        const me = v.me;
        const monthErr = (0, _kudosrules.eotmMonthError)(dto.month, (0, _dates.todayKey)());
        if (monthErr) throw new _errors.AppError(monthErr.status, monthErr.code, monthErr.message);
        const emp = await this.prisma.employee.findUnique({
            where: {
                id: dto.employeeId
            },
            select: {
                id: true,
                fullName: true,
                firstName: true,
                status: true,
                joiningDate: true,
                exitDate: true,
                userId: true
            }
        });
        if (!emp || !(0, _kudosrules.eotmEligible)(emp, dto.month)) throw (0, _errors.badRequest)('Pick an employee who was active during that month', 'EOTM_RECIPIENT');
        const existing = await this.prisma.eotmAward.findFirst({
            where: {
                month: dto.month
            }
        });
        if (existing && !existing.revokedAt) throw (0, _errors.conflict)(`Employee of the Month for ${(0, _dates.monthLabel)(dto.month)} has already been announced`, 'EOTM_EXISTS');
        const badge = await this.eotmBadge();
        const tenantId = (0, _requestcontext.currentTenantId)();
        const now = new Date();
        const body = (0, _kudosrules.eotmPostBody)(dto.citation);
        const { award, post } = await this.prisma.$transaction(async (tx)=>{
            if (existing) {
                // A revoked award frees the month: keep the history on the archived post/certificate.
                await tx.post.updateMany({
                    where: {
                        eotmAwardId: existing.id
                    },
                    data: {
                        eotmAwardId: null
                    }
                });
                await tx.eotmAward.delete({
                    where: {
                        id: existing.id
                    }
                });
            }
            const award = await tx.eotmAward.create({
                data: {
                    tenantId,
                    employeeId: emp.id,
                    month: dto.month,
                    citation: dto.citation,
                    announcedByEmployeeId: me
                }
            });
            // The newest EOTM post is pinned; earlier EOTM posts are unpinned.
            await tx.post.updateMany({
                where: {
                    kind: 'EOTM',
                    pinned: true
                },
                data: {
                    pinned: false
                }
            });
            const pinnedOthers = await tx.post.count({
                where: {
                    pinned: true,
                    status: 'PUBLISHED',
                    deletedAt: null
                }
            });
            const post = await tx.post.create({
                data: {
                    tenantId,
                    kind: 'EOTM',
                    status: 'PUBLISHED',
                    title: `Employee of the Month: ${emp.fullName}`,
                    bodyHtml: body,
                    excerpt: (0, _html.excerptOf)(body, 300),
                    authorEmployeeId: me,
                    publishedAt: now,
                    publishedByEmployeeId: me,
                    eotmAwardId: award.id,
                    pinned: pinnedOthers < 3
                }
            });
            await tx.kudos.create({
                data: {
                    tenantId,
                    giverEmployeeId: me,
                    recipientEmployeeId: emp.id,
                    badgeId: badge.id,
                    message: dto.citation.slice(0, 500),
                    postId: post.id
                }
            });
            const updated = await tx.eotmAward.update({
                where: {
                    id: award.id
                },
                data: {
                    postId: post.id
                }
            });
            return {
                award: updated,
                post
            };
        });
        const cert = await this.certificates.issue({
            type: 'EOTM',
            recipientEmployeeId: emp.id,
            title: EOTM_BADGE,
            subtitle: (0, _dates.monthLabel)(dto.month),
            sourceType: 'EOTM',
            sourceId: award.id,
            metadata: {
                citation: dto.citation,
                month: dto.month,
                holderName: emp.fullName
            }
        });
        const final = await this.prisma.eotmAward.update({
            where: {
                id: award.id
            },
            data: {
                certificateId: cert.id
            }
        });
        await this.audit.record({
            action: 'eotm.announce',
            entity: 'EotmAward',
            entityId: award.id,
            meta: {
                employee: emp.fullName,
                month: dto.month
            }
        });
        await this.feed.afterPublish(post, {
            notify: false
        });
        const everyone = (await this.prisma.user.findMany({
            where: {
                status: 'ACTIVE',
                employee: {
                    isNot: null
                }
            },
            select: {
                id: true
            }
        })).map((u)=>u.id).filter((id)=>id !== emp.userId);
        await this.notifications.notify({
            userIds: everyone,
            type: 'eotm.announced',
            title: `Employee of the Month · ${(0, _dates.monthLabel)(dto.month)}: ${emp.fullName}`,
            body: dto.citation,
            link: `/feed?post=${post.id}`,
            from: 'HR'
        });
        if (emp.userId) {
            await this.notifications.notify({
                userIds: [
                    emp.userId
                ],
                type: 'eotm.announced',
                title: `Congratulations, ${emp.firstName}! You are the Employee of the Month for ${(0, _dates.monthLabel)(dto.month)}`,
                body: `${dto.citation}\n\nYour certificate is ready to download from the company feed.`,
                link: `/feed?post=${post.id}`,
                from: 'HR',
                email: true
            });
        }
        this.events.emit('eotm.announced', {
            awardId: award.id,
            employeeId: emp.id,
            month: dto.month
        });
        return (await this.eotmRows([
            final
        ]))[0];
    }
    async revokeEotm(id, reason) {
        const a = await this.prisma.eotmAward.findUnique({
            where: {
                id
            }
        });
        if (!a || a.revokedAt) throw (0, _errors.notFound)('Award');
        const now = new Date();
        await this.prisma.eotmAward.update({
            where: {
                id
            },
            data: {
                revokedAt: now
            }
        });
        if (a.postId) {
            await this.prisma.post.updateMany({
                where: {
                    id: a.postId
                },
                data: {
                    status: 'ARCHIVED',
                    pinned: false
                }
            });
            await this.prisma.kudos.updateMany({
                where: {
                    postId: a.postId
                },
                data: {
                    revokedAt: now
                }
            });
        }
        if (a.certificateId) await this.certificates.revoke(a.certificateId, reason);
        await this.audit.record({
            action: 'eotm.revoke',
            entity: 'EotmAward',
            entityId: id,
            meta: {
                reason,
                month: a.month
            }
        });
        return {
            ok: true
        };
    }
};
KudosService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _audience.AudienceService === "undefined" ? Object : _audience.AudienceService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _certificatesservice.CertificatesService === "undefined" ? Object : _certificatesservice.CertificatesService,
        typeof _feedservice.FeedService === "undefined" ? Object : _feedservice.FeedService
    ])
], KudosService);

//# sourceMappingURL=kudos.service.js.map