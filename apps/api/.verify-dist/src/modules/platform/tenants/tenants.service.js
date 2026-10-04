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
    get TenantsController () {
        return TenantsController;
    },
    get TenantsService () {
        return TenantsService;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _shared = require("@lexisora/shared");
const _env = require("../../../config/env");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _requestcontext = require("../../../core/context/request-context");
const _auditservice = require("../../../core/audit/audit.service");
const _mailservice = require("../../../core/mail/mail.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _errors = require("../../../core/http/errors");
const _platformutil = require("../platform.util");
const _privacyguard = require("../privacy/privacy.guard");
const _privacyservice = require("../privacy/privacy.service");
const _billingservice = require("../billing/billing.service");
const _billinglogic = require("../billing/billing.logic");
const _entitlementsguard = require("../billing/entitlements.guard");
const _tenantslogic = require("./tenants.logic");
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
const DAY = 86_400_000;
const INVITE_TTL_DAYS = 7;
let TenantsService = class TenantsService {
    prisma;
    audit;
    mail;
    notifications;
    billing;
    db;
    constructor(prisma, audit, mail, notifications, billing){
        this.prisma = prisma;
        this.audit = audit;
        this.mail = mail;
        this.notifications = notifications;
        this.billing = billing;
        this.db = (0, _privacyguard.platformReader)(prisma.raw);
    }
    actor() {
        return (0, _platformutil.platformActorName)((0, _requestcontext.requireContext)().userName);
    }
    toRow(t, sub, used, operator) {
        const isOperator = t.id === operator;
        const planCode = (0, _tenantslogic.tenantPlanCode)(sub, isOperator);
        const st = (0, _tenantslogic.tenantStatusOf)(t.status, sub, isOperator);
        const quantity = sub?.quantity ?? _shared.FREE_SEATS;
        return {
            id: t.id,
            company: t.name,
            domain: t.domain,
            planCode,
            planLabel: (0, _billinglogic.planLabel)(planCode, sub?.cycle),
            seats: (0, _tenantslogic.seatsFigure)(planCode, used, quantity),
            seatsUsed: used,
            quantity,
            renewal: (0, _tenantslogic.isPaidPlan)(planCode) ? (0, _platformutil.renewalLabel)(sub?.currentPeriodEnd) : '—',
            status: st.status,
            statusTone: st.tone,
            tenantStatus: t.status,
            isOperator,
            createdAt: t.createdAt.toISOString()
        };
    }
    async load() {
        const [tenants, subs, counts, operator] = await Promise.all([
            this.db.tenant.findMany({
                orderBy: {
                    createdAt: 'asc'
                }
            }),
            this.db.subscription.findMany(),
            this.db.user.groupBy({
                by: [
                    'tenantId'
                ],
                where: {
                    status: {
                        in: [
                            ..._platformutil.SEAT_STATUSES
                        ]
                    }
                },
                _count: {
                    _all: true
                }
            }),
            (0, _platformutil.platformTenantId)(this.prisma.raw)
        ]);
        const subBy = new Map(subs.map((s)=>[
                s.tenantId,
                s
            ]));
        const usedBy = new Map(counts.map((c)=>[
                c.tenantId,
                c._count._all
            ]));
        const rows = tenants.map((t)=>this.toRow(t, subBy.get(t.id), usedBy.get(t.id) ?? 0, operator));
        // The operator's own workspace is never billed (its Subscription screen demonstrates the Growth plan).
        const billable = subs.filter((s)=>s.tenantId !== operator);
        return {
            rows,
            subs,
            billable,
            operator
        };
    }
    async list(q) {
        const { rows, billable, operator } = await this.load();
        const term = q.q?.trim().toLowerCase();
        const matched = term ? rows.filter((r)=>r.company.toLowerCase().includes(term) || r.domain.includes(term)) : rows;
        const counts = Object.fromEntries(_shared.TENANT_TABS.map((t)=>[
                t,
                matched.filter((r)=>(0, _tenantslogic.tenantInTab)(r, t)).length
            ]));
        const tabbed = matched.filter((r)=>(0, _tenantslogic.tenantInTab)(r, q.tab));
        const monthStart = (0, _platformutil.istStart)(`${(0, _shared.istDateKey)().slice(0, 7)}-01`);
        const [delta, snapshot] = await Promise.all([
            this.db.subscriptionChange.aggregate({
                where: {
                    createdAt: {
                        gte: monthStart
                    },
                    tenantId: {
                        not: operator
                    }
                },
                _sum: {
                    seatDelta: true
                }
            }),
            this.db.mrrSnapshot.findFirst({
                where: {
                    date: {
                        lte: new Date(Date.now() - 30 * DAY)
                    }
                },
                orderBy: {
                    date: 'desc'
                }
            })
        ]);
        const mrr = (0, _billinglogic.mrrPaise)(billable);
        return {
            kpis: {
                tenants: rows.length,
                freeTier: rows.filter((r)=>r.planCode === 'FREE').length,
                seatsBilled: (0, _billinglogic.seatsBilled)(billable),
                seatsDelta: delta._sum.seatDelta ?? 0,
                mrrPaise: mrr,
                mrrDeltaPct: (0, _billinglogic.pctChange)(mrr, snapshot?.mrrPaise)
            },
            counts,
            items: tabbed.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
            total: tabbed.length,
            page: q.page,
            pageSize: q.pageSize
        };
    }
    async detail(id) {
        const { rows } = await this.load();
        const row = rows.find((r)=>r.id === id);
        if (!row) throw (0, _errors.notFound)('Tenant');
        const [t, sub, admins, activeUsers, invoices, tickets, access] = await Promise.all([
            this.db.tenant.findUniqueOrThrow({
                where: {
                    id
                }
            }),
            this.db.subscription.findUnique({
                where: {
                    tenantId: id
                }
            }),
            this.db.user.findMany({
                where: {
                    tenantId: id,
                    role: {
                        key: 'admin'
                    }
                },
                select: {
                    name: true,
                    email: true,
                    status: true
                },
                orderBy: {
                    createdAt: 'asc'
                }
            }),
            this.db.user.count({
                where: {
                    tenantId: id,
                    status: 'ACTIVE'
                }
            }),
            this.db.saasInvoice.findMany({
                where: {
                    tenantId: id,
                    status: {
                        in: [
                            'ISSUED',
                            'PAID',
                            'OVERDUE'
                        ]
                    }
                },
                orderBy: [
                    {
                        issueDate: 'desc'
                    },
                    {
                        createdAt: 'desc'
                    }
                ],
                take: 12
            }),
            this.db.supportTicket.findMany({
                where: {
                    tenantId: id
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: 10
            }),
            this.db.auditLog.findMany({
                where: {
                    tenantId: id,
                    action: {
                        startsWith: 'platform.'
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: 20
            })
        ]);
        return {
            ...row,
            slug: t.slug,
            stateName: t.stateName ?? (t.stateCode ? _shared.GST_STATE_NAMES[t.stateCode] ?? null : null),
            customerSince: (sub?.createdAt ?? t.createdAt).toISOString(),
            adminContacts: admins,
            activeUsers,
            subscription: sub ? {
                status: sub.status,
                cycle: sub.cycle,
                currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
                pastDueSince: sub.pastDueSince?.toISOString() ?? null,
                graceEndsAt: sub.graceEndsAt?.toISOString() ?? null,
                collection: sub.collection
            } : null,
            invoices: invoices.map((i)=>this.billing.toInvoiceDto(i)),
            tickets: tickets.map((k)=>({
                    id: k.id,
                    code: k.code,
                    subject: k.subject,
                    status: k.status,
                    severity: k.severity
                })),
            platformAudit: access.map((a)=>({
                    id: a.id,
                    action: a.action,
                    actorName: a.actorName ?? 'Lexisora platform',
                    createdAt: a.createdAt.toISOString(),
                    summary: (0, _privacyservice.auditSummary)(a.meta, a.action)
                }))
        };
    }
    // ── Provisioning ─────────────────────────────────────────────────────────
    async domainCheck(raw) {
        const slug = (raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(new RegExp(`\\.${_shared.ROOT_DOMAIN.replace('.', '\\.')}$`), '');
        const domain = `${slug}.${_shared.ROOT_DOMAIN}`;
        const problem = (0, _tenantslogic.slugProblem)(slug);
        if (problem) return {
            domain,
            available: false,
            message: problem
        };
        const taken = await this.db.tenant.findFirst({
            where: {
                OR: [
                    {
                        slug
                    },
                    {
                        domain
                    }
                ]
            },
            select: {
                id: true
            }
        });
        return taken ? {
            domain,
            available: false,
            message: `${domain} is already taken`
        } : {
            domain,
            available: true,
            message: `${domain} is available`
        };
    }
    async create(input) {
        const check = await this.domainCheck(input.domain);
        if (!check.available) throw new _errors.AppError(409, 'DOMAIN_TAKEN', check.message);
        const slug = input.domain;
        const domain = check.domain;
        const now = new Date();
        const paid = input.planCode !== 'FREE';
        const cycle = input.planCode === 'GROWTH' ? input.cycle ?? 'YEARLY' : null;
        const quantity = (0, _tenantslogic.initialQuantity)(input.planCode, input.seats);
        const periodEnd = cycle ? (0, _billinglogic.addCycle)(now, cycle) : input.planCode === 'ENTERPRISE' ? (0, _billinglogic.addCycle)(now, 'YEARLY') : null;
        const token = (0, _nodecrypto.randomBytes)(24).toString('base64url');
        const adminName = input.adminName?.trim() || (0, _tenantslogic.nameFromEmail)(input.adminEmail);
        const actor = this.actor();
        const { tenant, admin } = await this.db.$transaction(async (tx)=>{
            const tenant = await tx.tenant.create({
                data: {
                    name: input.company,
                    legalName: input.company,
                    domain,
                    slug,
                    status: paid ? 'ACTIVE' : 'FREE_TIER',
                    stateCode: input.stateCode ?? null,
                    stateName: input.stateCode ? _shared.GST_STATE_NAMES[input.stateCode] ?? null : null,
                    gstin: input.gstin ?? null
                }
            });
            const roles = {};
            for (const key of _shared.ROLE_KEYS){
                const r = await tx.role.create({
                    data: {
                        tenantId: tenant.id,
                        key,
                        name: _shared.ROLE_LABELS[key],
                        isSystem: true,
                        permissions: (0, _shared.defaultPermissionsFor)(key)
                    }
                });
                roles[key] = r.id;
            }
            const admin = await tx.user.create({
                data: {
                    tenantId: tenant.id,
                    email: input.adminEmail,
                    name: adminName,
                    status: 'INVITED',
                    roleId: roles.admin,
                    inviteToken: token,
                    inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY)
                }
            });
            const sub = await tx.subscription.create({
                data: {
                    tenantId: tenant.id,
                    planCode: input.planCode,
                    cycle,
                    status: paid ? 'ACTIVE' : 'FREE',
                    quantity,
                    unitPaise: cycle ? _shared.GROWTH_PRICE_PAISE[cycle] : null,
                    currentPeriodStart: paid ? now : null,
                    currentPeriodEnd: periodEnd,
                    collection: paid ? 'OFFLINE_INVOICE' : 'GATEWAY'
                }
            });
            await tx.subscriptionChange.create({
                data: {
                    tenantId: tenant.id,
                    subscriptionId: sub.id,
                    type: 'CREATED',
                    to: {
                        planCode: input.planCode,
                        cycle,
                        quantity
                    },
                    seatDelta: paid ? quantity : 0,
                    actorName: actor
                }
            });
            await tx.brandingVersion.create({
                data: {
                    tenantId: tenant.id,
                    version: 1,
                    status: 'PUBLISHED',
                    presetKey: 'default-gold-ink',
                    primaryHex: '#b68235',
                    secondaryHex: '#2d2b2b',
                    domain,
                    publishedByName: 'Lexisora platform',
                    publishedAt: now
                }
            });
            return {
                tenant,
                admin
            };
        });
        const label = (0, _billinglogic.planLabel)(input.planCode, cycle);
        if (input.planCode === 'GROWTH') await (0, _requestcontext.runAsTenant)(tenant.id, ()=>this.billing.issueOpeningInvoice());
        const inviteSent = await this.sendInvite(admin.email, adminName, input.company, domain, token, label);
        const summary = `Provisioned ${input.company} (${domain}) on ${label}${paid ? ` · ${quantity} seats` : ''} · admin ${admin.email}`;
        await this.audit.record({
            action: 'platform.tenant.created',
            entity: 'Tenant',
            entityId: tenant.id,
            meta: {
                summary,
                plan: input.planCode,
                seats: quantity
            }
        });
        await (0, _platformutil.recordPlatformAccess)(this.prisma.raw, tenant.id, {
            action: 'platform.tenant.created',
            entity: 'Tenant',
            entityId: tenant.id,
            actorName: actor,
            ip: (0, _requestcontext.requireContext)().ip,
            meta: {
                summary: `Workspace created by Lexisora on ${label} · admin ${admin.email}`
            }
        });
        const me = (0, _requestcontext.requireContext)().userId;
        const ops = (await (0, _platformutil.platformAdminUserIds)(this.prisma.raw)).filter((u)=>u !== me);
        await this.notifications.notify({
            userIds: ops,
            type: 'platform.tenant_provisioned',
            title: `Tenant provisioned: ${input.company}`,
            body: `${domain} · ${label}`,
            link: '/tenants',
            from: 'Platform'
        });
        const { rows } = await this.load();
        return {
            tenant: rows.find((r)=>r.id === tenant.id),
            adminEmail: admin.email,
            inviteSent,
            loginUrl: `${_env.env.WEB_ORIGIN}/login`
        };
    }
    async sendInvite(to, name, company, domain, token, plan) {
        const link = `${_env.env.WEB_ORIGIN}/accept-invite?token=${encodeURIComponent(token)}`;
        return this.mail.send({
            to,
            subject: `Your ${company} workspace on Lexisora HRMS is ready`,
            text: [
                `Hello ${name},`,
                '',
                `Lexisora has set up ${company} on Lexisora HRMS (${plan}).`,
                '',
                `Workspace: ${domain}`,
                `Set your password and sign in: ${link}`,
                '',
                `This link is valid for ${INVITE_TTL_DAYS} days. You are the workspace administrator: invite your team from People → Employees, and set your colours and logo under SaaS → Branding.`,
                '',
                '— Lexisora HRMS'
            ].join('\n')
        });
    }
    async resendInvite(id) {
        const t = await this.db.tenant.findUnique({
            where: {
                id
            }
        });
        if (!t) throw (0, _errors.notFound)('Tenant');
        const invited = await this.db.user.findMany({
            where: {
                tenantId: id,
                status: 'INVITED',
                role: {
                    key: 'admin'
                }
            }
        });
        if (!invited.length) throw (0, _errors.badRequest)('The admin has already accepted the invite', 'NO_PENDING_INVITE');
        const sub = await this.db.subscription.findUnique({
            where: {
                tenantId: id
            }
        });
        for (const u of invited){
            const token = (0, _nodecrypto.randomBytes)(24).toString('base64url');
            await this.db.user.update({
                where: {
                    id: u.id
                },
                data: {
                    inviteToken: token,
                    inviteExpiresAt: new Date(Date.now() + INVITE_TTL_DAYS * DAY)
                }
            });
            await this.sendInvite(u.email, u.name, t.name, t.domain, token, (0, _billinglogic.planLabel)(sub?.planCode ?? 'FREE', sub?.cycle));
        }
        const to = invited.map((u)=>u.email).join(', ');
        await this.audit.record({
            action: 'platform.tenant.invite_resent',
            entity: 'Tenant',
            entityId: id,
            meta: {
                summary: `Resent the admin invite for ${t.name} to ${to}`
            }
        });
        await (0, _platformutil.recordPlatformAccess)(this.prisma.raw, id, {
            action: 'platform.tenant.invite_resent',
            entity: 'Tenant',
            entityId: id,
            actorName: this.actor(),
            meta: {
                summary: `Admin invite resent to ${to}`
            }
        });
        return {
            message: `Invite sent to ${to}`
        };
    }
    // ── Lifecycle ────────────────────────────────────────────────────────────
    async loadForAction(id) {
        const t = await this.db.tenant.findUnique({
            where: {
                id
            }
        });
        if (!t) throw (0, _errors.notFound)('Tenant');
        const sub = await this.db.subscription.findUnique({
            where: {
                tenantId: id
            }
        });
        return {
            t,
            sub
        };
    }
    async notifyTenantAdmins(tenantId, subject, text) {
        const admins = await this.db.user.findMany({
            where: {
                tenantId,
                status: 'ACTIVE',
                role: {
                    key: 'admin'
                }
            },
            select: {
                email: true
            }
        });
        if (admins.length) await this.mail.send({
            to: admins.map((a)=>a.email),
            subject,
            text
        });
    }
    async suspend(id, input) {
        if (id === await (0, _platformutil.platformTenantId)(this.prisma.raw)) throw (0, _errors.badRequest)('The operator workspace can’t be suspended', 'OPERATOR_TENANT');
        const { t, sub } = await this.loadForAction(id);
        if (t.status === 'SUSPENDED') throw (0, _errors.conflict)('This workspace is already suspended');
        const actor = this.actor();
        const now = new Date();
        await this.db.$transaction(async (tx)=>{
            await tx.tenant.update({
                where: {
                    id
                },
                data: {
                    status: 'SUSPENDED'
                }
            });
            if (sub) {
                await tx.subscription.update({
                    where: {
                        id: sub.id
                    },
                    data: {
                        status: 'SUSPENDED'
                    }
                });
                await tx.subscriptionChange.create({
                    data: {
                        tenantId: id,
                        subscriptionId: sub.id,
                        type: 'STATUS',
                        from: {
                            status: sub.status
                        },
                        to: {
                            status: 'SUSPENDED'
                        },
                        actorName: actor
                    }
                });
            }
            // End every session: refresh tokens stop working, access tokens lapse within 15 minutes.
            await tx.refreshToken.updateMany({
                where: {
                    tenantId: id,
                    revokedAt: null
                },
                data: {
                    revokedAt: now
                }
            });
        });
        (0, _entitlementsguard.invalidateEntitlements)(id);
        const why = input.reason ? ` · ${input.reason}` : '';
        await this.audit.record({
            action: 'platform.tenant.suspended',
            entity: 'Tenant',
            entityId: id,
            meta: {
                summary: `Suspended ${t.name}${why}`,
                from: t.status,
                to: 'SUSPENDED'
            }
        });
        await (0, _platformutil.recordPlatformAccess)(this.prisma.raw, id, {
            action: 'platform.tenant.suspended',
            entity: 'Tenant',
            entityId: id,
            actorName: actor,
            ip: (0, _requestcontext.requireContext)().ip,
            meta: {
                summary: `Workspace suspended by Lexisora${why}`,
                from: t.status,
                to: 'SUSPENDED'
            }
        });
        await this.notifyTenantAdmins(id, `${t.name}: your Lexisora HRMS workspace is suspended`, `Your workspace ${t.domain} has been suspended${why}. Sign-ins are blocked until it is reactivated. Reply to this email or contact billing@lexisora.com.`);
        return this.rowOf(id);
    }
    async reactivate(id) {
        const { t, sub } = await this.loadForAction(id);
        if (t.status !== 'SUSPENDED' && sub?.status !== 'SUSPENDED' && sub?.status !== 'READ_ONLY') throw (0, _errors.conflict)('This workspace is already active');
        const now = new Date();
        const overdue = await this.db.saasInvoice.count({
            where: {
                tenantId: id,
                status: {
                    in: [
                        'ISSUED',
                        'OVERDUE'
                    ]
                },
                dueDate: {
                    lt: now
                }
            }
        });
        const free = !sub || sub.planCode === 'FREE';
        const subStatus = free ? 'FREE' : overdue ? 'PAST_DUE' : 'ACTIVE';
        const tenantStatus = free ? 'FREE_TIER' : overdue ? 'PAYMENT_DUE' : 'ACTIVE';
        const actor = this.actor();
        await this.db.$transaction(async (tx)=>{
            await tx.tenant.update({
                where: {
                    id
                },
                data: {
                    status: tenantStatus
                }
            });
            if (sub) {
                await tx.subscription.update({
                    where: {
                        id: sub.id
                    },
                    data: {
                        status: subStatus,
                        ...overdue ? {
                            pastDueSince: sub.pastDueSince ?? now,
                            graceEndsAt: new Date(now.getTime() + 7 * DAY)
                        } : {
                            pastDueSince: null,
                            graceEndsAt: null
                        }
                    }
                });
                await tx.subscriptionChange.create({
                    data: {
                        tenantId: id,
                        subscriptionId: sub.id,
                        type: 'STATUS',
                        from: {
                            status: sub.status
                        },
                        to: {
                            status: subStatus
                        },
                        actorName: actor
                    }
                });
            }
        });
        (0, _entitlementsguard.invalidateEntitlements)(id);
        const note = overdue ? ` · payment still due, grace until ${(0, _shared.formatDate)(new Date(now.getTime() + 7 * DAY))}` : '';
        await this.audit.record({
            action: 'platform.tenant.reactivated',
            entity: 'Tenant',
            entityId: id,
            meta: {
                summary: `Reactivated ${t.name}${note}`,
                from: t.status,
                to: tenantStatus
            }
        });
        await (0, _platformutil.recordPlatformAccess)(this.prisma.raw, id, {
            action: 'platform.tenant.reactivated',
            entity: 'Tenant',
            entityId: id,
            actorName: actor,
            ip: (0, _requestcontext.requireContext)().ip,
            meta: {
                summary: `Workspace reactivated by Lexisora${note}`,
                from: t.status,
                to: tenantStatus
            }
        });
        await this.notifyTenantAdmins(id, `${t.name}: your Lexisora HRMS workspace is active again`, `Your workspace ${t.domain} has been reactivated. Everyone can sign in again.${note}`);
        return this.rowOf(id);
    }
    async extendGrace(id, input) {
        const { t, sub } = await this.loadForAction(id);
        if (!sub || ![
            'PAST_DUE',
            'READ_ONLY'
        ].includes(sub.status)) throw (0, _errors.badRequest)('Only workspaces with a payment due have a grace period', 'NOT_PAST_DUE');
        const now = new Date();
        const base = sub.graceEndsAt && sub.graceEndsAt > now ? sub.graceEndsAt : now;
        const until = new Date(base.getTime() + input.days * DAY);
        const actor = this.actor();
        await this.db.subscription.update({
            where: {
                id: sub.id
            },
            data: {
                status: 'PAST_DUE',
                graceEndsAt: until,
                pastDueSince: sub.pastDueSince ?? now
            }
        });
        if (t.status !== 'SUSPENDED') await this.db.tenant.update({
            where: {
                id
            },
            data: {
                status: 'PAYMENT_DUE'
            }
        });
        (0, _entitlementsguard.invalidateEntitlements)(id);
        await this.db.subscriptionChange.create({
            data: {
                tenantId: id,
                subscriptionId: sub.id,
                type: 'STATUS',
                from: {
                    status: sub.status,
                    graceEndsAt: sub.graceEndsAt?.toISOString() ?? null
                },
                to: {
                    status: 'PAST_DUE',
                    graceEndsAt: until.toISOString()
                },
                actorName: actor
            }
        });
        const summary = `Grace period extended by ${input.days} days to ${(0, _shared.formatDate)(until)}`;
        await this.audit.record({
            action: 'platform.tenant.grace_extended',
            entity: 'Tenant',
            entityId: id,
            meta: {
                summary: `${t.name}: ${summary}`
            }
        });
        await (0, _platformutil.recordPlatformAccess)(this.prisma.raw, id, {
            action: 'platform.tenant.grace_extended',
            entity: 'Subscription',
            entityId: sub.id,
            actorName: (0, _platformutil.platformActorName)((0, _requestcontext.requireContext)().userName, 'Lexisora billing'),
            meta: {
                summary
            }
        });
        return this.rowOf(id);
    }
    async rowOf(id) {
        const { rows } = await this.load();
        const r = rows.find((x)=>x.id === id);
        if (!r) throw (0, _errors.notFound)('Tenant');
        return r;
    }
    invoicePdf(tenantId, invoiceId) {
        return this.billing.invoicePdf(invoiceId, tenantId);
    }
};
TenantsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _mailservice.MailService === "undefined" ? Object : _mailservice.MailService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _billingservice.BillingService === "undefined" ? Object : _billingservice.BillingService
    ])
], TenantsService);
let TenantsController = class TenantsController {
    tenants;
    constructor(tenants){
        this.tenants = tenants;
    }
    list(q) {
        return this.tenants.list(q);
    }
    domainCheck(domain) {
        return this.tenants.domainCheck(domain ?? '');
    }
    detail(id) {
        return this.tenants.detail(id);
    }
    create(dto) {
        return this.tenants.create(dto);
    }
    suspend(id, dto) {
        return this.tenants.suspend(id, dto);
    }
    reactivate(id) {
        return this.tenants.reactivate(id);
    }
    extendGrace(id, dto) {
        return this.tenants.extendGrace(id, dto);
    }
    resendInvite(id) {
        return this.tenants.resendInvite(id);
    }
    async invoicePdf(id, invoiceId, res) {
        const pdf = await this.tenants.invoicePdf(id, invoiceId);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
        res.send(pdf.data);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.tenantsQuerySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof TenantsQuery === "undefined" ? Object : TenantsQuery
    ]),
    _ts_metadata("design:returntype", void 0)
], TenantsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('domain-check'),
    _ts_param(0, (0, _common.Query)('domain')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TenantsController.prototype, "domainCheck", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TenantsController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)(),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.createTenantSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CreateTenantInput === "undefined" ? Object : CreateTenantInput
    ]),
    _ts_metadata("design:returntype", void 0)
], TenantsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Post)(':id/suspend'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.tenantNoteSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof TenantNoteInput === "undefined" ? Object : TenantNoteInput
    ]),
    _ts_metadata("design:returntype", void 0)
], TenantsController.prototype, "suspend", null);
_ts_decorate([
    (0, _common.Post)(':id/reactivate'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TenantsController.prototype, "reactivate", null);
_ts_decorate([
    (0, _common.Post)(':id/extend-grace'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.extendGraceSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof ExtendGraceInput === "undefined" ? Object : ExtendGraceInput
    ]),
    _ts_metadata("design:returntype", void 0)
], TenantsController.prototype, "extendGrace", null);
_ts_decorate([
    (0, _common.Post)(':id/resend-invite'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TenantsController.prototype, "resendInvite", null);
_ts_decorate([
    (0, _common.Get)(':id/invoices/:invoiceId/pdf'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('invoiceId')),
    _ts_param(2, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], TenantsController.prototype, "invoicePdf", null);
TenantsController = _ts_decorate([
    (0, _common.Controller)('tenants'),
    (0, _decorators.PlatformOnly)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof TenantsService === "undefined" ? Object : TenantsService
    ])
], TenantsController);

//# sourceMappingURL=tenants.service.js.map