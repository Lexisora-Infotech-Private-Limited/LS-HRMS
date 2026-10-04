"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PoliciesService", {
    enumerable: true,
    get: function() {
        return PoliciesService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _eventsservice = require("../../../core/registry/events.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _pdfservice = require("../../../core/pdf/pdf.service");
const _storageservice = require("../../../core/storage/storage.service");
const _orgservice = require("../../../core/org/org.service");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _audience = require("../common/audience");
const _spine = require("../common/spine");
const _dates = require("../common/dates");
const _policiesrules = require("./policies.rules");
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
const iso = (d)=>d ? d.toISOString() : null;
const EXCLUDED = [
    'EXITED'
];
let PoliciesService = class PoliciesService {
    prisma;
    audience;
    notifications;
    audit;
    events;
    realtime;
    pdf;
    storage;
    org;
    spine;
    log = new _common.Logger('Policies');
    constructor(prisma, audience, notifications, audit, events, realtime, pdf, storage, org, spine){
        this.prisma = prisma;
        this.audience = audience;
        this.notifications = notifications;
        this.audit = audit;
        this.events = events;
        this.realtime = realtime;
        this.pdf = pdf;
        this.storage = storage;
        this.org = org;
        this.spine = spine;
    }
    viewer() {
        const ctx = (0, _requestcontext.requireContext)();
        return {
            ctx,
            me: ctx.employeeId ?? null,
            manager: (0, _decorators.hasPerm)(ctx, 'policies.manage')
        };
    }
    async exitedIds() {
        const rows = await this.prisma.employee.findMany({
            where: {
                status: {
                    in: EXCLUDED
                }
            },
            select: {
                id: true
            }
        });
        return new Set(rows.map((r)=>r.id));
    }
    async visibleTo(p, me, manager) {
        if (manager) return true;
        const rules = p.audiences ?? [];
        return this.audience.matches(me, rules);
    }
    // ── List / detail ────────────────────────────────────────────────────────
    async list(tab) {
        const v = this.viewer();
        if (tab === 'archived' && !v.manager) throw (0, _errors.forbidden)();
        const policies = await this.prisma.hrPolicy.findMany({
            where: {
                status: tab === 'archived' ? 'ARCHIVED' : 'PUBLISHED'
            },
            include: {
                versions: true
            },
            orderBy: [
                {
                    sortOrder: 'asc'
                },
                {
                    createdAt: 'asc'
                }
            ]
        });
        const visible = [];
        for (const p of policies)if (await this.visibleTo(p, v.me, v.manager)) visible.push(p);
        const rows = await this.rows(visible, v.me, v.manager);
        const pending = rows.filter((r)=>r.myState === 'PENDING').length;
        const archived = v.manager ? await this.prisma.hrPolicy.count({
            where: {
                status: 'ARCHIVED'
            }
        }) : 0;
        const all = tab === 'archived' ? await this.prisma.hrPolicy.count({
            where: {
                status: 'PUBLISHED'
            }
        }) : rows.length;
        return {
            items: tab === 'pending' ? rows.filter((r)=>r.myState === 'PENDING') : rows,
            counts: {
                all,
                pending,
                archived
            },
            canManage: v.manager
        };
    }
    async rows(policies, me, manager) {
        const currentIds = policies.map((p)=>p.currentVersionId).filter((x)=>!!x);
        const [mine, all, exited] = await Promise.all([
            me && currentIds.length ? this.prisma.policyAck.findMany({
                where: {
                    employeeId: me,
                    policyVersionId: {
                        in: currentIds
                    }
                }
            }) : Promise.resolve([]),
            manager && currentIds.length ? this.prisma.policyAck.findMany({
                where: {
                    policyVersionId: {
                        in: currentIds
                    }
                },
                select: {
                    policyVersionId: true,
                    employeeId: true,
                    dueAt: true,
                    acknowledgedAt: true
                }
            }) : Promise.resolve([]),
            manager ? this.exitedIds() : Promise.resolve(new Set())
        ]);
        const now = new Date();
        return policies.map((p)=>{
            const cur = p.versions.find((x)=>x.id === p.currentVersionId) ?? null;
            const ack = mine.find((a)=>a.policyVersionId === p.currentVersionId) ?? null;
            const isHolidayList = p.category === 'HOLIDAY_LIST';
            const needsAck = p.requiresAck && !isHolidayList;
            const myState = !needsAck ? 'NA' : ack ? ack.acknowledgedAt ? 'ACKNOWLEDGED' : 'PENDING' : 'NA';
            let compliance = null;
            if (manager && needsAck && cur) {
                const c = (0, _policiesrules.complianceCounts)(all.filter((a)=>a.policyVersionId === cur.id && !exited.has(a.employeeId)), now);
                compliance = `${c.acknowledged} / ${c.required}`;
            }
            return {
                id: p.id,
                title: p.title,
                category: p.category,
                updated: cur ? (0, _shared.formatDate)(cur.effectiveFrom) : '—',
                requiresAck: needsAck,
                myState,
                acknowledgedAt: iso(ack?.acknowledgedAt),
                versionId: cur?.id ?? null,
                version: cur?.version ?? 0,
                fileId: cur?.fileId ?? null,
                compliance,
                isHolidayList,
                dueAt: iso(ack?.dueAt),
                overdue: !!ack && (0, _policiesrules.isOverdue)(ack, now),
                status: p.status
            };
        });
    }
    async detail(id) {
        const v = this.viewer();
        const p = await this.prisma.hrPolicy.findUnique({
            where: {
                id
            },
            include: {
                versions: {
                    orderBy: {
                        version: 'desc'
                    }
                }
            }
        });
        if (!p || p.status !== 'PUBLISHED' && !v.manager || !await this.visibleTo(p, v.me, v.manager)) throw (0, _errors.notFound)('Policy');
        const [row] = await this.rows([
            p
        ], v.me, v.manager);
        const people = await this.audience.briefs(p.versions.map((x)=>x.publishedByEmployeeId));
        const cur = p.versions.find((x)=>x.id === p.currentVersionId) ?? null;
        return {
            ...row,
            versions: p.versions.map((x)=>({
                    id: x.id,
                    version: x.version,
                    effectiveFrom: (0, _dates.keyOf)(x.effectiveFrom),
                    changeSummary: x.changeSummary,
                    fileId: x.fileId,
                    publishedAt: iso(x.publishedAt),
                    publishedBy: x.publishedByEmployeeId ? people.get(x.publishedByEmployeeId)?.name ?? null : null,
                    isCurrent: x.id === p.currentVersionId,
                    requiresReack: x.requiresReack
                })),
            minReadSeconds: (0, _shared.minReadSecondsFor)(cur?.pageCount),
            ackDueDays: p.ackDueDays,
            changeSummary: cur?.changeSummary ?? null,
            effectiveFrom: cur ? (0, _dates.keyOf)(cur.effectiveFrom) : null
        };
    }
    // ── Publish ──────────────────────────────────────────────────────────────
    async pdfFile(fileId) {
        const f = await this.prisma.fileObject.findUnique({
            where: {
                id: fileId
            }
        });
        if (!f) throw (0, _errors.badRequest)('The policy file could not be found — upload it again', 'POLICY_FILE');
        if (f.mime !== 'application/pdf') throw (0, _errors.badRequest)('Upload the policy as a PDF', 'POLICY_FILE_TYPE');
        if (f.size > 20 * 1024 * 1024) throw (0, _errors.badRequest)('Policy PDFs can be up to 20 MB', 'POLICY_FILE_SIZE');
        try {
            return (0, _policiesrules.pdfPageCount)((await this.storage.read(fileId)).data);
        } catch  {
            return null;
        }
    }
    async create(dto) {
        const v = this.viewer();
        const pages = await this.pdfFile(dto.fileId);
        const isHoliday = dto.category === 'HOLIDAY_LIST';
        const exists = await this.prisma.hrPolicy.findFirst({
            where: {
                title: {
                    equals: dto.title,
                    mode: 'insensitive'
                },
                status: {
                    not: 'ARCHIVED'
                }
            }
        });
        if (exists) throw (0, _errors.conflict)('A policy with this title already exists — publish a new version of it instead', 'POLICY_EXISTS');
        const now = new Date();
        const effectiveKey = dto.effectiveFrom ?? (0, _dates.todayKey)(now);
        const sortOrder = await this.prisma.hrPolicy.count() + 1;
        const policy = await this.prisma.hrPolicy.create({
            data: {
                title: dto.title,
                category: dto.category,
                requiresAck: isHoliday ? false : dto.requiresAck,
                ackDueDays: dto.ackDueDays,
                status: 'PUBLISHED',
                holidayYear: isHoliday ? Number(effectiveKey.slice(0, 4)) : null,
                audiences: [],
                sortOrder,
                tenantId: (0, _requestcontext.currentTenantId)()
            }
        });
        const version = await this.prisma.hrPolicyVersion.create({
            data: {
                policyId: policy.id,
                version: 1,
                fileId: dto.fileId,
                pageCount: pages,
                effectiveFrom: (0, _dates.dateOnly)(effectiveKey),
                changeSummary: dto.changeSummary,
                requiresReack: true,
                publishedAt: now,
                publishedByEmployeeId: v.me
            }
        });
        await this.prisma.hrPolicy.update({
            where: {
                id: policy.id
            },
            data: {
                currentVersionId: version.id
            }
        });
        await this.audit.record({
            action: 'policy.create',
            entity: 'HrPolicy',
            entityId: policy.id,
            meta: {
                title: policy.title,
                requiresAck: policy.requiresAck
            }
        });
        const n = await this.materialize({
            ...policy,
            currentVersionId: version.id
        }, version, null);
        this.events.emit('policy.published', {
            policyId: policy.id,
            versionId: version.id,
            version: 1,
            requirements: n
        });
        return this.detail(policy.id);
    }
    async newVersion(id, dto) {
        const v = this.viewer();
        const p = await this.prisma.hrPolicy.findUnique({
            where: {
                id
            },
            include: {
                versions: {
                    orderBy: {
                        version: 'desc'
                    },
                    take: 1
                }
            }
        });
        if (!p) throw (0, _errors.notFound)('Policy');
        if (p.status === 'ARCHIVED') throw (0, _errors.conflict)('Archived policies cannot get new versions', 'POLICY_ARCHIVED');
        const pages = await this.pdfFile(dto.fileId);
        const prev = p.versions[0] ?? null;
        const now = new Date();
        const version = await this.prisma.hrPolicyVersion.create({
            data: {
                policyId: p.id,
                version: (prev?.version ?? 0) + 1,
                fileId: dto.fileId,
                pageCount: pages,
                effectiveFrom: (0, _dates.dateOnly)(dto.effectiveFrom ?? (0, _dates.todayKey)(now)),
                changeSummary: dto.changeSummary,
                requiresReack: dto.requiresReack,
                publishedAt: now,
                publishedByEmployeeId: v.me
            }
        });
        await this.prisma.hrPolicy.update({
            where: {
                id: p.id
            },
            data: {
                currentVersionId: version.id,
                status: 'PUBLISHED'
            }
        });
        await this.audit.record({
            action: 'policy.version.publish',
            entity: 'HrPolicy',
            entityId: p.id,
            meta: {
                version: version.version,
                requiresReack: dto.requiresReack
            }
        });
        const n = await this.materialize({
            ...p,
            currentVersionId: version.id
        }, version, prev?.id ?? null);
        this.events.emit('policy.published', {
            policyId: p.id,
            versionId: version.id,
            version: version.version,
            requirements: n
        });
        return this.detail(p.id);
    }
    /** Creates acknowledgement requirements for the resolved audience and alerts them. */ async materialize(policy, version, previousVersionId) {
        if (!policy.requiresAck || policy.category === 'HOLIDAY_LIST') return 0;
        const audience = await this.audience.resolve(policy.audiences ?? []);
        const previous = previousVersionId ? await this.prisma.policyAck.findMany({
            where: {
                policyVersionId: previousVersionId
            }
        }) : [];
        const now = new Date();
        const reqs = (0, _policiesrules.requirementsForVersion)({
            audience,
            previous,
            requiresReack: version.requiresReack,
            isFirst: !previousVersionId,
            dueAt: (0, _policiesrules.ackDueAt)((0, _dates.keyOf)(version.effectiveFrom), now, policy.ackDueDays)
        });
        const tenantId = (0, _requestcontext.currentTenantId)();
        if (reqs.length) {
            await this.prisma.policyAck.createMany({
                data: reqs.map((r)=>({
                        tenantId,
                        policyId: policy.id,
                        policyVersionId: version.id,
                        employeeId: r.employeeId,
                        dueAt: r.dueAt,
                        acknowledgedAt: r.acknowledgedAt,
                        readSeconds: r.carried ? 0 : null
                    })),
                skipDuplicates: true
            });
        }
        const carried = reqs.filter((r)=>r.carried && r.acknowledgedAt).length;
        if (carried) await this.audit.record({
            action: 'policy.ack.carry',
            entity: 'HrPolicyVersion',
            entityId: version.id,
            meta: {
                carried,
                from: previousVersionId
            }
        });
        const pendingEmp = reqs.filter((r)=>!r.acknowledgedAt).map((r)=>r.employeeId);
        const users = await this.audience.userIds(pendingEmp);
        if (users.length) {
            await this.notifications.notify({
                userIds: users,
                type: 'policy.ackRequired',
                title: `Acknowledge the ${version.version > 1 ? 'updated ' : ''}${(0, _policiesrules.lowerTitle)(policy.title)}`,
                body: `${version.changeSummary ? `What changed: ${version.changeSummary}\n\n` : ''}Please read and acknowledge it by ${(0, _shared.formatDate)(reqs.find((r)=>!r.acknowledgedAt)?.dueAt ?? now)}.`,
                link: `/policies?read=${policy.id}`,
                from: 'HR',
                email: true
            });
            this.realtime.toUsers(users, 'dashboard:invalidate', {
                sections: [
                    'todos'
                ]
            });
        }
        return reqs.length;
    }
    async archive(id) {
        const p = await this.prisma.hrPolicy.findUnique({
            where: {
                id
            }
        });
        if (!p) throw (0, _errors.notFound)('Policy');
        await this.prisma.hrPolicy.update({
            where: {
                id
            },
            data: {
                status: 'ARCHIVED'
            }
        });
        await this.audit.record({
            action: 'policy.archive',
            entity: 'HrPolicy',
            entityId: id,
            meta: {
                title: p.title
            }
        });
        const users = await this.audience.userIds((await this.prisma.policyAck.findMany({
            where: {
                policyVersionId: p.currentVersionId ?? '',
                acknowledgedAt: null
            },
            select: {
                employeeId: true
            }
        })).map((a)=>a.employeeId));
        if (users.length) this.realtime.toUsers(users, 'dashboard:invalidate', {
            sections: [
                'todos'
            ]
        });
        return {
            ok: true
        };
    }
    async restore(id) {
        const p = await this.prisma.hrPolicy.findUnique({
            where: {
                id
            }
        });
        if (!p) throw (0, _errors.notFound)('Policy');
        await this.prisma.hrPolicy.update({
            where: {
                id
            },
            data: {
                status: 'PUBLISHED'
            }
        });
        await this.audit.record({
            action: 'policy.restore',
            entity: 'HrPolicy',
            entityId: id,
            meta: {
                title: p.title
            }
        });
        return this.detail(id);
    }
    // ── Acknowledge ──────────────────────────────────────────────────────────
    async acknowledge(versionId, readSeconds, userAgent) {
        const v = this.viewer();
        if (!v.me) throw (0, _errors.forbidden)('Only employees acknowledge policies');
        const ver = await this.prisma.hrPolicyVersion.findUnique({
            where: {
                id: versionId
            },
            include: {
                policy: true
            }
        });
        if (!ver || !await this.visibleTo(ver.policy, v.me, false)) throw (0, _errors.notFound)('Policy');
        if (ver.policy.status !== 'PUBLISHED') throw (0, _errors.conflict)('This policy is no longer in force', 'POLICY_ARCHIVED');
        if (ver.policy.currentVersionId !== ver.id) throw new _errors.AppError(409, 'VERSION_SUPERSEDED', 'A newer version of this policy was published — read the latest version');
        if (!ver.policy.requiresAck || ver.policy.category === 'HOLIDAY_LIST') throw (0, _errors.badRequest)('This document does not need an acknowledgement', 'POLICY_NO_ACK');
        let req = await this.prisma.policyAck.findFirst({
            where: {
                policyVersionId: ver.id,
                employeeId: v.me
            }
        });
        if (!req) {
            // Late joiner without a materialised requirement: create it now.
            req = await this.prisma.policyAck.create({
                data: {
                    policyId: ver.policyId,
                    policyVersionId: ver.id,
                    employeeId: v.me,
                    dueAt: (0, _policiesrules.ackDueAt)((0, _dates.keyOf)(ver.effectiveFrom), new Date(), ver.policy.ackDueDays)
                }
            });
        }
        if (!req.acknowledgedAt) {
            const at = new Date();
            await this.prisma.policyAck.update({
                where: {
                    id: req.id
                },
                data: {
                    acknowledgedAt: at,
                    ackIp: v.ctx.ip ?? null,
                    ackUserAgent: userAgent?.slice(0, 300) ?? null,
                    readSeconds
                }
            });
            await this.audit.record({
                action: 'policy.ack',
                entity: 'HrPolicyVersion',
                entityId: ver.id,
                meta: {
                    policy: ver.policy.title,
                    version: ver.version,
                    ip: v.ctx.ip ?? null,
                    readSeconds
                }
            });
            this.events.emit('policy.acknowledged', {
                policyId: ver.policyId,
                versionId: ver.id,
                employeeId: v.me
            });
            if (v.ctx.userId) this.realtime.toUser(v.ctx.userId, 'dashboard:invalidate', {
                sections: [
                    'todos'
                ]
            });
        }
        return this.detail(ver.policyId);
    }
    // ── Compliance (policies.manage) ─────────────────────────────────────────
    async compliance() {
        const policies = await this.prisma.hrPolicy.findMany({
            where: {
                status: 'PUBLISHED',
                requiresAck: true,
                category: {
                    not: 'HOLIDAY_LIST'
                }
            },
            include: {
                versions: true
            },
            orderBy: {
                sortOrder: 'asc'
            }
        });
        const ids = policies.map((p)=>p.currentVersionId).filter((x)=>!!x);
        const [acks, exited] = await Promise.all([
            this.prisma.policyAck.findMany({
                where: {
                    policyVersionId: {
                        in: ids
                    }
                },
                select: {
                    policyVersionId: true,
                    employeeId: true,
                    dueAt: true,
                    acknowledgedAt: true
                }
            }),
            this.exitedIds()
        ]);
        const now = new Date();
        return policies.map((p)=>{
            const c = (0, _policiesrules.complianceCounts)(acks.filter((a)=>a.policyVersionId === p.currentVersionId && !exited.has(a.employeeId)), now);
            return {
                id: p.id,
                title: p.title,
                category: p.category,
                version: p.versions.find((x)=>x.id === p.currentVersionId)?.version ?? 1,
                ...c
            };
        });
    }
    async compliancePeople(id, state) {
        const p = await this.prisma.hrPolicy.findUnique({
            where: {
                id
            }
        });
        if (!p || !p.currentVersionId) throw (0, _errors.notFound)('Policy');
        const exited = await this.exitedIds();
        const now = new Date();
        const acks = (await this.prisma.policyAck.findMany({
            where: {
                policyVersionId: p.currentVersionId
            }
        })).filter((a)=>!exited.has(a.employeeId));
        const pick = acks.filter((a)=>state === 'all' ? true : state === 'done' ? !!a.acknowledgedAt : state === 'overdue' ? (0, _policiesrules.isOverdue)(a, now) : !a.acknowledgedAt);
        const people = await this.audience.briefs(pick.map((a)=>a.employeeId));
        return pick.map((a)=>{
            const b = people.get(a.employeeId);
            return {
                employeeId: a.employeeId,
                name: b?.name ?? '—',
                initials: b?.initials ?? (0, _shared.initialsOf)(b?.name ?? '?'),
                department: b?.department ?? null,
                dueAt: a.dueAt.toISOString(),
                acknowledgedAt: iso(a.acknowledgedAt),
                overdue: (0, _policiesrules.isOverdue)(a, now),
                lastRemindedAt: iso(a.lastRemindedAt)
            };
        }).sort((x, y)=>Number(y.overdue) - Number(x.overdue) || x.name.localeCompare(y.name));
    }
    async remind(id) {
        const p = await this.prisma.hrPolicy.findUnique({
            where: {
                id
            }
        });
        if (!p || !p.currentVersionId) throw (0, _errors.notFound)('Policy');
        const now = new Date();
        const exited = await this.exitedIds();
        const pending = (await this.prisma.policyAck.findMany({
            where: {
                policyVersionId: p.currentVersionId,
                acknowledgedAt: null
            }
        })).filter((a)=>!exited.has(a.employeeId));
        const due = pending.filter((a)=>!a.lastRemindedAt || now.getTime() - a.lastRemindedAt.getTime() >= 86_400_000);
        if (due.length) {
            await this.notifications.notify({
                userIds: await this.audience.userIds(due.map((a)=>a.employeeId)),
                type: 'policy.ackReminder',
                title: `Reminder: acknowledge the ${(0, _policiesrules.lowerTitle)(p.title)}`,
                link: `/policies?read=${p.id}`,
                from: 'HR',
                email: true
            });
            await this.prisma.policyAck.updateMany({
                where: {
                    id: {
                        in: due.map((a)=>a.id)
                    }
                },
                data: {
                    lastRemindedAt: now
                }
            });
        }
        await this.audit.record({
            action: 'policy.remind',
            entity: 'HrPolicy',
            entityId: id,
            meta: {
                reminded: due.length
            }
        });
        return {
            reminded: due.length,
            skipped: pending.length - due.length
        };
    }
    async complianceCsv(id) {
        const p = await this.prisma.hrPolicy.findUnique({
            where: {
                id
            }
        });
        if (!p) throw (0, _errors.notFound)('Policy');
        const rows = await this.compliancePeople(id, 'all');
        const esc = (s)=>`"${(s ?? '').replace(/"/g, '""')}"`;
        const fmt = (d)=>d ? new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            }).format(new Date(d)) : '';
        const lines = [
            'Employee,Department,Due,Acknowledged at,Status',
            ...rows.map((r)=>[
                    esc(r.name),
                    esc(r.department),
                    esc(fmt(r.dueAt)),
                    esc(fmt(r.acknowledgedAt)),
                    esc(r.acknowledgedAt ? 'Acknowledged' : r.overdue ? 'Overdue' : 'Pending')
                ].join(','))
        ];
        return {
            filename: `${p.title.replace(/[^\w]+/g, '-').toLowerCase()}-acknowledgements.csv`,
            csv: lines.join('\r\n')
        };
    }
    // ── Holiday list (time domain Holiday rows, read only) ───────────────────
    async holidays(year) {
        const y = year ?? Number((0, _dates.todayKey)().slice(0, 4));
        const [rows, locations, all] = await Promise.all([
            this.spine.rawFindMany('holiday', {
                where: {
                    date: {
                        gte: new Date(Date.UTC(y, 0, 1)),
                        lt: new Date(Date.UTC(y + 1, 0, 1))
                    }
                },
                orderBy: {
                    date: 'asc'
                }
            }),
            this.spine.rawFindMany('workLocation', {}),
            this.spine.rawFindMany('holiday', {
                select: {
                    date: true
                }
            })
        ]);
        const today = (0, _dates.todayKey)();
        const items = rows.map((h)=>{
            const key = (0, _dates.keyOf)(h.date);
            const d = (0, _dates.dateOnly)(key);
            const locs = (h.locationIds ?? []).map((id)=>locations.find((l)=>l.id === id)?.name).filter(Boolean);
            return {
                id: h.id,
                date: `${d.getUTCDate()} ${_shared.MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
                day: new Intl.DateTimeFormat('en-GB', {
                    weekday: 'long',
                    timeZone: 'UTC'
                }).format(d),
                name: h.name,
                type: h.type,
                typeLabel: h.type === 'MANDATORY' ? 'Mandatory' : 'Optional',
                location: locs.length ? locs.join(', ') : h.calendar && h.calendar !== 'National' ? h.calendar : 'All offices',
                past: key < today
            };
        });
        const years = [
            ...new Set([
                y,
                ...all.map((h)=>h.date.getUTCFullYear())
            ])
        ].sort((a, b)=>a - b);
        return {
            year: y,
            items,
            years
        };
    }
    async holidaysPdf(year) {
        const list = await this.holidays(year);
        const tenant = await this.org.tenant();
        const data = await this.pdf.render((doc)=>{
            this.pdf.header(doc, tenant.brandName ?? tenant.name ?? 'Lexisora', `Holiday list ${list.year}`);
            doc.moveDown(0.5).font('Helvetica').fontSize(10).fillColor('#605d5d').text('Mandatory holidays are paid days off for everyone. You may take optional (restricted) holidays against your leave plan.');
            doc.moveDown(0.8);
            this.pdf.table(doc, [
                'Date',
                'Day',
                'Holiday',
                'Type',
                'Location'
            ], list.items.map((h)=>[
                    h.date,
                    h.day,
                    h.name,
                    h.typeLabel,
                    h.location
                ]), [
                0.18,
                0.16,
                0.34,
                0.14,
                0.18
            ]);
            if (!list.items.length) doc.moveDown().fontSize(11).text('No holidays have been published for this year yet.');
        });
        return {
            filename: `holiday-list-${list.year}.pdf`,
            data
        };
    }
    // ── Schedules & event consumers ──────────────────────────────────────────
    /** Joiners / re-activated employees get requirements for every policy in force. */ async materializeForEmployee(employeeId) {
        const e = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                id: true,
                joiningDate: true,
                status: true
            }
        });
        if (!e || EXCLUDED.includes(e.status)) return 0;
        const policies = await this.prisma.hrPolicy.findMany({
            where: {
                status: 'PUBLISHED',
                requiresAck: true,
                category: {
                    not: 'HOLIDAY_LIST'
                },
                currentVersionId: {
                    not: null
                }
            },
            include: {
                versions: true
            }
        });
        const tenantId = (0, _requestcontext.currentTenantId)();
        let n = 0;
        for (const p of policies){
            if (!await this.audience.matches(employeeId, p.audiences ?? [])) continue;
            const ver = p.versions.find((x)=>x.id === p.currentVersionId);
            if (!ver) continue;
            const startKey = e.joiningDate && (0, _dates.keyOf)(e.joiningDate) > (0, _dates.todayKey)() ? (0, _dates.keyOf)(e.joiningDate) : (0, _dates.todayKey)();
            const r = await this.prisma.policyAck.createMany({
                data: [
                    {
                        tenantId,
                        policyId: p.id,
                        policyVersionId: ver.id,
                        employeeId,
                        dueAt: (0, _policiesrules.ackDueAt)(startKey, new Date(), p.ackDueDays)
                    }
                ],
                skipDuplicates: true
            });
            n += r.count;
        }
        return n;
    }
    /** Daily 10:00 IST: reminders on day 3, the due day, then every 3 days while overdue. */ async sendReminders(now = new Date()) {
        const pending = await this.prisma.policyAck.findMany({
            where: {
                acknowledgedAt: null
            },
            include: {
                version: {
                    include: {
                        policy: true
                    }
                }
            }
        });
        const exited = await this.exitedIds();
        const due = pending.filter((a)=>{
            const p = a.version.policy;
            if (p.status !== 'PUBLISHED' || p.currentVersionId !== a.policyVersionId || exited.has(a.employeeId)) return false;
            const startKey = (0, _dates.todayKey)(new Date(a.dueAt.getTime() - p.ackDueDays * 86_400_000));
            return (0, _policiesrules.reminderDue)({
                startKey,
                dueAt: a.dueAt,
                acknowledgedAt: a.acknowledgedAt,
                lastRemindedAt: a.lastRemindedAt
            }, now);
        });
        const byPolicy = new Map();
        for (const a of due)byPolicy.set(a.policyId, [
            ...byPolicy.get(a.policyId) ?? [],
            a
        ]);
        for (const [, list] of byPolicy){
            const p = list[0].version.policy;
            const overdue = list.filter((a)=>(0, _policiesrules.isOverdue)(a, now)).map((a)=>a.employeeId);
            const upcoming = list.filter((a)=>!(0, _policiesrules.isOverdue)(a, now)).map((a)=>a.employeeId);
            if (upcoming.length) await this.notifications.notify({
                userIds: await this.audience.userIds(upcoming),
                type: 'policy.ackReminder',
                title: `Reminder: acknowledge the ${(0, _policiesrules.lowerTitle)(p.title)}`,
                link: `/policies?read=${p.id}`,
                from: 'HR'
            });
            if (overdue.length) await this.notifications.notify({
                userIds: await this.audience.userIds(overdue),
                type: 'policy.ackReminder',
                title: `Overdue: acknowledge the ${(0, _policiesrules.lowerTitle)(p.title)}`,
                link: `/policies?read=${p.id}`,
                from: 'HR',
                email: true
            });
            await this.prisma.policyAck.updateMany({
                where: {
                    id: {
                        in: list.map((a)=>a.id)
                    }
                },
                data: {
                    lastRemindedAt: now
                }
            });
        }
        return due.length;
    }
    /** Monday 09:00 IST: employees more than 7 days overdue → HR and each reporting manager. */ async overdueDigest(now = new Date()) {
        const cutoff = new Date(now.getTime() - 7 * 86_400_000);
        const rows = await this.prisma.policyAck.findMany({
            where: {
                acknowledgedAt: null,
                dueAt: {
                    lt: cutoff
                }
            },
            include: {
                version: {
                    include: {
                        policy: true
                    }
                }
            }
        });
        const live = rows.filter((a)=>a.version.policy.status === 'PUBLISHED' && a.version.policy.currentVersionId === a.policyVersionId);
        if (!live.length) return 0;
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(live.map((a)=>a.employeeId))
                    ]
                },
                status: {
                    notIn: EXCLUDED
                }
            },
            select: {
                id: true,
                fullName: true,
                managerId: true
            }
        });
        const line = (e)=>`${e.fullName}: ${live.filter((a)=>a.employeeId === e.id).map((a)=>a.version.policy.title).join(', ')}`;
        const hr = await this.notifications.usersWithPermission('policies.manage');
        if (hr.length && emps.length) await this.notifications.notify({
            userIds: hr,
            type: 'policy.overdueDigest',
            title: `${emps.length} employee${emps.length === 1 ? ' is' : 's are'} overdue on policy acknowledgements`,
            body: emps.map(line).join('\n'),
            link: '/policies?tab=compliance',
            from: 'HR',
            email: true
        });
        const byManager = new Map();
        for (const e of emps)if (e.managerId) byManager.set(e.managerId, [
            ...byManager.get(e.managerId) ?? [],
            e
        ]);
        for (const [mgr, list] of byManager){
            const users = await this.audience.userIds([
                mgr
            ]);
            if (users.length) await this.notifications.notify({
                userIds: users,
                type: 'policy.overdueDigest',
                title: `Your team: ${list.length} overdue policy acknowledgement${list.length === 1 ? '' : 's'}`,
                body: list.map(line).join('\n'),
                link: '/policies',
                from: 'HR'
            });
        }
        return emps.length;
    }
    /** File access: published policy PDFs are readable by everyone with policies.view. */ async canOpenFile(fileId) {
        const ctx = (0, _requestcontext.requireContext)();
        if (!(0, _decorators.hasPerm)(ctx, 'policies.view')) return false;
        const ver = await this.prisma.hrPolicyVersion.findFirst({
            where: {
                fileId
            },
            include: {
                policy: true
            }
        });
        if (!ver) return false;
        return ver.policy.status === 'PUBLISHED' || (0, _decorators.hasPerm)(ctx, 'policies.manage');
    }
    async search(q) {
        const rows = await this.prisma.hrPolicy.findMany({
            where: {
                status: 'PUBLISHED',
                title: {
                    contains: q,
                    mode: 'insensitive'
                }
            },
            take: 6,
            orderBy: {
                sortOrder: 'asc'
            }
        });
        return rows.map((p)=>({
                type: 'Policies',
                id: p.id,
                title: p.title,
                subtitle: p.category === 'HOLIDAY_LIST' ? 'Holiday list' : 'Policy',
                link: p.category === 'HOLIDAY_LIST' ? '/policies?tab=holidays' : `/policies?read=${p.id}`
            }));
    }
};
PoliciesService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _audience.AudienceService === "undefined" ? Object : _audience.AudienceService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _pdfservice.PdfService === "undefined" ? Object : _pdfservice.PdfService,
        typeof _storageservice.StorageService === "undefined" ? Object : _storageservice.StorageService,
        typeof _orgservice.OrgService === "undefined" ? Object : _orgservice.OrgService,
        typeof _spine.SpineReader === "undefined" ? Object : _spine.SpineReader
    ])
], PoliciesService);

//# sourceMappingURL=policies.service.js.map