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
    get AuditLogService () {
        return AuditLogService;
    },
    get actorWhere () {
        return actorWhere;
    },
    get resultWhere () {
        return resultWhere;
    },
    get summarize () {
        return summarize;
    },
    get tabWhere () {
        return tabWhere;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _paginate = require("../../../core/http/paginate");
const _platformutil = require("../platform.util");
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
function tabWhere(tab) {
    switch(tab){
        case 'security':
            return {
                OR: [
                    {
                        action: {
                            startsWith: 'auth.'
                        }
                    },
                    {
                        action: {
                            startsWith: 'security.'
                        }
                    },
                    {
                        action: 'rbac.denied'
                    },
                    {
                        action: {
                            startsWith: 'privacy.'
                        }
                    }
                ]
            };
        case 'access':
            return {
                action: {
                    startsWith: 'rbac.'
                }
            };
        case 'platform':
            return {
                action: {
                    startsWith: 'platform.'
                }
            };
        default:
            return {};
    }
}
function resultWhere(result) {
    const denied = {
        OR: [
            {
                action: {
                    endsWith: '.denied',
                    mode: 'insensitive'
                }
            },
            {
                action: {
                    endsWith: '.blocked',
                    mode: 'insensitive'
                }
            },
            {
                action: {
                    endsWith: '.forbidden',
                    mode: 'insensitive'
                }
            },
            {
                action: {
                    in: [
                        'punch.rejected',
                        'tracker.sync.rejected'
                    ]
                }
            }
        ]
    };
    const failure = {
        OR: [
            {
                action: {
                    contains: 'fail',
                    mode: 'insensitive'
                }
            },
            {
                action: {
                    contains: 'error',
                    mode: 'insensitive'
                }
            }
        ]
    };
    switch(result){
        case 'denied':
            return denied;
        case 'failure':
            return {
                AND: [
                    failure,
                    {
                        NOT: denied
                    }
                ]
            };
        case 'success':
            return {
                NOT: {
                    OR: [
                        denied,
                        failure
                    ]
                }
            };
        default:
            return {};
    }
}
/** Rows written by Lexisora staff (support sessions, billing and tenant operations). */ const PLATFORM_ACTION = {
    action: {
        startsWith: 'platform.'
    }
};
function actorWhere(actor) {
    if (!actor) return null;
    if (actor === 'platform') return PLATFORM_ACTION;
    if (actor === 'system') return {
        actorUserId: null,
        NOT: PLATFORM_ACTION
    };
    return {
        actorUserId: actor
    };
}
/** Short human summary: the producer's `meta.summary`, else a readable fallback. */ const CLIENT_LABEL = {
    web: 'on the web',
    mobile: 'on the mobile app',
    tracker: 'on the desktop tracker'
};
/** Readable copy for core events that are recorded without a summary. */ const KNOWN = {
    'auth.login': (m)=>[
            'Signed in',
            CLIENT_LABEL[String(m.client)]
        ].filter(Boolean).join(' '),
    'auth.logout': ()=>'Signed out',
    'auth.login.failed': (m)=>`Failed sign-in attempt${typeof m.email === 'string' ? ` for ${m.email}` : ''}`
};
function summarize(action, entity, entityId, meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    if (typeof m.summary === 'string') return m.summary;
    const known = KNOWN[action];
    if (known) return known(m);
    const verb = action.split('.').slice(1).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const extra = Object.entries(m).filter(([, v])=>[
            'string',
            'number',
            'boolean'
        ].includes(typeof v)).slice(0, 3).map(([k, v])=>`${k}: ${String(v)}`).join(' · ');
    return [
        `${entity}${entityId ? ` ${entityId.slice(-6)}` : ''} ${verb}`.trim(),
        extra
    ].filter(Boolean).join(' — ');
}
let AuditLogService = class AuditLogService {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    where(q) {
        const and = [
            tabWhere(q.tab)
        ];
        const actor = actorWhere(q.actor);
        if (actor) and.push(actor);
        if (q.action) and.push({
            action: {
                contains: q.action,
                mode: 'insensitive'
            }
        });
        if (q.module) and.push({
            OR: [
                {
                    action: {
                        startsWith: `${q.module}.`
                    }
                },
                {
                    action: q.module
                }
            ]
        });
        if (q.result) and.push(resultWhere(q.result));
        if (q.entity) and.push({
            entity: q.entity
        });
        if (q.entityId) and.push({
            entityId: {
                contains: q.entityId
            }
        });
        if (q.from || q.to) and.push({
            createdAt: {
                ...q.from ? {
                    gte: (0, _platformutil.istStart)(q.from)
                } : {},
                ...q.to ? {
                    lte: (0, _platformutil.istEnd)(q.to)
                } : {}
            }
        });
        if (q.q) and.push({
            OR: [
                {
                    actorName: {
                        contains: q.q,
                        mode: 'insensitive'
                    }
                },
                {
                    action: {
                        contains: q.q,
                        mode: 'insensitive'
                    }
                },
                {
                    entity: {
                        contains: q.q,
                        mode: 'insensitive'
                    }
                }
            ]
        });
        return {
            AND: and
        };
    }
    row(r) {
        return {
            id: r.id,
            createdAt: r.createdAt.toISOString(),
            actorUserId: r.actorUserId,
            actorName: r.actorName ?? 'System',
            action: r.action,
            module: r.action.split('.')[0] ?? r.action,
            entity: r.entity,
            entityId: r.entityId,
            summary: summarize(r.action, r.entity, r.entityId, r.meta),
            ip: r.ip,
            meta: r.meta,
            platform: r.action.startsWith('platform.'),
            result: (0, _shared.auditResultOf)(r.action)
        };
    }
    async list(q) {
        const where = this.where(q);
        const base = this.where({
            ...q,
            tab: 'all'
        });
        const [rows, total, ...counts] = await Promise.all([
            this.prisma.auditLog.findMany({
                where,
                orderBy: {
                    createdAt: 'desc'
                },
                ...(0, _paginate.pageArgs)(q)
            }),
            this.prisma.auditLog.count({
                where
            }),
            ...[
                'all',
                'security',
                'access',
                'platform'
            ].map((t)=>this.prisma.auditLog.count({
                    where: {
                        AND: [
                            base,
                            tabWhere(t)
                        ]
                    }
                }))
        ]);
        return {
            ...(0, _paginate.paginated)(rows.map((r)=>this.row(r)), total, q),
            counts: {
                all: counts[0],
                security: counts[1],
                access: counts[2],
                platform: counts[3]
            }
        };
    }
    async get(id) {
        const r = await this.prisma.auditLog.findUnique({
            where: {
                id
            }
        });
        return r ? this.row(r) : null;
    }
    async facets() {
        const [actors, entities, actions] = await Promise.all([
            this.prisma.auditLog.findMany({
                where: {
                    actorUserId: {
                        not: null
                    }
                },
                distinct: [
                    'actorUserId'
                ],
                select: {
                    actorUserId: true,
                    actorName: true
                },
                take: 200
            }),
            this.prisma.auditLog.findMany({
                distinct: [
                    'entity'
                ],
                select: {
                    entity: true
                },
                take: 200
            }),
            this.prisma.auditLog.findMany({
                distinct: [
                    'action'
                ],
                select: {
                    action: true
                },
                take: 500
            })
        ]);
        return {
            actors: [
                {
                    value: 'system',
                    label: 'System'
                },
                {
                    value: 'platform',
                    label: 'Lexisora platform'
                },
                ...actors.map((a)=>({
                        value: a.actorUserId,
                        label: a.actorName ?? 'Unknown'
                    })).sort((a, b)=>a.label.localeCompare(b.label))
            ],
            entities: entities.map((e)=>e.entity).sort(),
            modules: [
                ...new Set(actions.map((a)=>a.action.split('.')[0]))
            ].sort()
        };
    }
    /** CSV export of the current filter (max 5,000 rows). */ async csv(q) {
        const rows = await this.prisma.auditLog.findMany({
            where: this.where(q),
            orderBy: {
                createdAt: 'desc'
            },
            take: 5000
        });
        const esc = (v)=>{
            const s = v === null || v === undefined ? '' : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [
            [
                'When (UTC)',
                'Actor',
                'Action',
                'Module',
                'Entity',
                'Entity id',
                'Summary',
                'IP',
                'Result'
            ].join(',')
        ];
        for (const r of rows){
            const d = this.row(r);
            lines.push([
                d.createdAt,
                d.actorName,
                d.action,
                d.module,
                d.entity,
                d.entityId,
                d.summary,
                d.ip,
                d.result
            ].map(esc).join(','));
        }
        return lines.join('\n');
    }
};
AuditLogService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], AuditLogService);

//# sourceMappingURL=audit-log.service.js.map