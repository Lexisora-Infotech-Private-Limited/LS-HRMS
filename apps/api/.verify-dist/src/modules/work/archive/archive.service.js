"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ArchiveService", {
    enumerable: true,
    get: function() {
        return ArchiveService;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _storageservice = require("../../../core/storage/storage.service");
const _requestcontext = require("../../../core/context/request-context");
const _decorators = require("../../../core/auth/decorators");
const _errors = require("../../../core/http/errors");
const _paginate = require("../../../core/http/paginate");
const _workdocsservice = require("../projects/work-docs.service");
const _workaccessservice = require("../work-access.service");
const _workeventsservice = require("../work-events.service");
const _workutil = require("../work.util");
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
let ArchiveService = class ArchiveService {
    prisma;
    audit;
    notifications;
    storage;
    docs;
    access;
    events;
    constructor(prisma, audit, notifications, storage, docs, access, events){
        this.prisma = prisma;
        this.audit = audit;
        this.notifications = notifications;
        this.storage = storage;
        this.docs = docs;
        this.access = access;
        this.events = events;
    }
    accessWhere() {
        const ctx = (0, _requestcontext.requireContext)();
        return (0, _decorators.hasPerm)(ctx, 'archive.view') ? {} : {
            archiveAccess: 'ALL_DEVELOPERS'
        };
    }
    tabWhere(tab) {
        if (tab === 'web') return {
            category: 'WEB'
        };
        if (tab === 'mobile') return {
            category: 'MOBILE'
        };
        if (tab === 'internal') return {
            OR: [
                {
                    isInternal: true
                },
                {
                    client: {
                        isInternal: true
                    }
                }
            ]
        };
        return {};
    }
    searchWhere(q) {
        if (!q) return {};
        const t = q.trim();
        return {
            OR: [
                {
                    name: {
                        contains: t,
                        mode: 'insensitive'
                    }
                },
                {
                    key: {
                        contains: t,
                        mode: 'insensitive'
                    }
                },
                {
                    description: {
                        contains: t,
                        mode: 'insensitive'
                    }
                },
                {
                    client: {
                        name: {
                            contains: t,
                            mode: 'insensitive'
                        }
                    }
                },
                {
                    techStack: {
                        hasSome: [
                            t,
                            t.toLowerCase(),
                            t[0].toUpperCase() + t.slice(1).toLowerCase(),
                            t.toUpperCase()
                        ]
                    }
                },
                {
                    documents: {
                        some: {
                            title: {
                                contains: t,
                                mode: 'insensitive'
                            }
                        }
                    }
                }
            ]
        };
    }
    async docCounts(projects) {
        const [pc, cc] = await Promise.all([
            this.prisma.projectDocument.groupBy({
                by: [
                    'projectId'
                ],
                where: {
                    projectId: {
                        in: projects.map((p)=>p.id)
                    }
                },
                _count: {
                    _all: true
                }
            }),
            this.prisma.projectDocument.groupBy({
                by: [
                    'clientId'
                ],
                where: {
                    projectId: null,
                    clientId: {
                        in: projects.map((p)=>p.clientId).filter((x)=>!!x)
                    }
                },
                _count: {
                    _all: true
                }
            })
        ]);
        const pOf = new Map(pc.map((x)=>[
                x.projectId,
                x._count._all
            ]));
        const cOf = new Map(cc.map((x)=>[
                x.clientId,
                x._count._all
            ]));
        return (p)=>(pOf.get(p.id) ?? 0) + (p.clientId ? cOf.get(p.clientId) ?? 0 : 0);
    }
    row(p, documents) {
        return {
            id: p.id,
            key: p.key,
            name: p.name,
            clientName: p.client?.name ?? 'Internal',
            closedAt: p.closedAt?.toISOString() ?? null,
            closedLabel: (0, _workutil.monthYearLabel)(p.closedAt ?? p.archivedAt),
            documents,
            techStack: p.techStack,
            archiveAccess: p.archiveAccess,
            category: p.category,
            isInternal: p.isInternal || !!p.client?.isInternal
        };
    }
    async list(q) {
        const base = {
            AND: [
                {
                    status: 'ARCHIVED'
                },
                this.accessWhere(),
                this.searchWhere(q.q)
            ]
        };
        const where = {
            AND: [
                base,
                this.tabWhere(q.tab)
            ]
        };
        const [rows, total, all, web, mobile, internal] = await Promise.all([
            this.prisma.project.findMany({
                where,
                include: {
                    client: true
                },
                orderBy: [
                    {
                        closedAt: 'desc'
                    },
                    {
                        name: 'asc'
                    }
                ],
                skip: (q.page - 1) * q.pageSize,
                take: q.pageSize
            }),
            this.prisma.project.count({
                where
            }),
            this.prisma.project.count({
                where: base
            }),
            this.prisma.project.count({
                where: {
                    AND: [
                        base,
                        this.tabWhere('web')
                    ]
                }
            }),
            this.prisma.project.count({
                where: {
                    AND: [
                        base,
                        this.tabWhere('mobile')
                    ]
                }
            }),
            this.prisma.project.count({
                where: {
                    AND: [
                        base,
                        this.tabWhere('internal')
                    ]
                }
            })
        ]);
        const count = await this.docCounts(rows);
        const ctx = (0, _requestcontext.requireContext)();
        return {
            ...(0, _paginate.paginated)(rows.map((p)=>this.row(p, count(p))), total, q),
            counts: {
                all,
                web,
                mobile,
                internal
            },
            canManage: (0, _decorators.hasPerm)(ctx, 'archive.manage'),
            // Completed projects that can be archived (manager action from this screen).
            archivable: (0, _decorators.hasPerm)(ctx, 'archive.manage') ? (await this.prisma.project.findMany({
                where: {
                    status: 'COMPLETED'
                },
                select: {
                    id: true,
                    name: true,
                    key: true
                },
                orderBy: {
                    closedAt: 'desc'
                }
            })).map((p)=>({
                    value: p.id,
                    label: `${p.name} · ${p.key}`
                })) : []
        };
    }
    async requireItem(id) {
        const p = await this.prisma.project.findFirst({
            where: {
                AND: [
                    {
                        id
                    },
                    {
                        status: 'ARCHIVED'
                    },
                    this.accessWhere()
                ]
            },
            include: {
                client: true
            }
        });
        if (!p) throw (0, _errors.notFound)('Archived project');
        return p;
    }
    async detail(id) {
        const p = await this.requireItem(id);
        const [docs, clientDocs, tasks, members, modules] = await Promise.all([
            this.prisma.projectDocument.findMany({
                where: {
                    projectId: id
                },
                orderBy: [
                    {
                        kind: 'asc'
                    },
                    {
                        createdAt: 'asc'
                    }
                ]
            }),
            p.clientId ? this.prisma.projectDocument.findMany({
                where: {
                    clientId: p.clientId,
                    projectId: null
                },
                orderBy: {
                    createdAt: 'asc'
                }
            }) : Promise.resolve([]),
            this.prisma.task.groupBy({
                by: [
                    'status'
                ],
                where: {
                    projectId: id,
                    isStanding: false
                },
                _count: {
                    _all: true
                }
            }),
            this.prisma.projectMember.findMany({
                where: {
                    projectId: id
                }
            }),
            this.prisma.projectModule.findMany({
                where: {
                    projectId: id
                },
                orderBy: {
                    sortOrder: 'asc'
                }
            })
        ]);
        const names = await this.access.names([
            ...members.map((m)=>m.employeeId),
            p.leadEmployeeId
        ]);
        return {
            ...this.row(p, docs.length + clientDocs.length),
            description: p.description,
            leadName: p.leadEmployeeId ? names.get(p.leadEmployeeId) ?? null : null,
            estimatedMinutes: p.estimatedMinutes,
            loggedMinutes: p.loggedMinutes,
            progressPct: p.progressPct,
            tasksByStatus: Object.fromEntries(tasks.map((t)=>[
                    t.status,
                    t._count._all
                ])),
            members: members.map((m)=>({
                    name: names.get(m.employeeId) ?? '—',
                    role: m.role
                })),
            modules: modules.map((m)=>m.name),
            projectDocuments: await this.docs.rows(docs),
            clientDocuments: await this.docs.rows(clientDocs),
            canManage: (0, _decorators.hasPerm)((0, _requestcontext.requireContext)(), 'archive.manage')
        };
    }
    async setAccess(id, archiveAccess) {
        const p = await this.requireItem(id);
        await this.prisma.project.update({
            where: {
                id
            },
            data: {
                archiveAccess
            }
        });
        await this.audit.record({
            action: 'archive.access_changed',
            entity: 'Project',
            entityId: id,
            meta: {
                name: p.name,
                from: p.archiveAccess,
                to: archiveAccess
            }
        });
        return {
            ok: true
        };
    }
    async addDocument(id, doc) {
        const p = await this.requireItem(id);
        const [f] = await this.docs.files([
            doc.fileId
        ]);
        await this.prisma.projectDocument.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                projectId: p.id,
                fileId: f.id,
                title: doc.title || f.filename,
                kind: doc.kind,
                sizeBytes: f.size,
                uploadedByEmployeeId: (0, _requestcontext.requireContext)().employeeId ?? null
            }
        });
        await this.audit.record({
            action: 'archive.document.added',
            entity: 'Project',
            entityId: id,
            meta: {
                title: doc.title ?? f.filename
            }
        });
        return {
            ok: true
        };
    }
    /** Stream a document of an archived item (project or inherited client vault) — audited. */ async download(id, docId) {
        const p = await this.requireItem(id);
        const d = await this.prisma.projectDocument.findFirst({
            where: {
                id: docId,
                OR: [
                    {
                        projectId: p.id
                    },
                    ...p.clientId ? [
                        {
                            clientId: p.clientId,
                            projectId: null
                        }
                    ] : []
                ]
            }
        });
        if (!d) throw (0, _errors.notFound)('Document');
        const file = await this.storage.read(d.fileId);
        await this.audit.record({
            action: 'archive.document.downloaded',
            entity: 'Project',
            entityId: id,
            meta: {
                title: d.title
            }
        });
        return file;
    }
    // ── Archive / unarchive (Project lifecycle COMPLETED ↔ ARCHIVED) ─────────────
    async archive(id) {
        const ctx = (0, _requestcontext.requireContext)();
        if (!(0, _decorators.hasPerm)(ctx, 'archive.manage')) throw (0, _errors.forbidden)('Only a manager can archive projects');
        const p = await this.prisma.project.findFirst({
            where: {
                id
            }
        });
        if (!p) throw (0, _errors.notFound)('Project');
        if (p.status !== 'COMPLETED') throw new _errors.AppError(422, 'NOT_COMPLETED', 'Only completed projects can be archived — mark the project completed first');
        await this.prisma.project.update({
            where: {
                id
            },
            data: {
                status: 'ARCHIVED',
                archivedAt: new Date(),
                archivedByEmployeeId: ctx.employeeId ?? null,
                closedAt: p.closedAt ?? new Date(),
                health: 'NA'
            }
        });
        await this.audit.record({
            action: 'project.archived',
            entity: 'Project',
            entityId: id,
            meta: {
                name: p.name
            }
        });
        const members = await this.prisma.projectMember.findMany({
            where: {
                projectId: id
            },
            select: {
                employeeId: true
            }
        });
        await this.notifications.notify({
            userIds: (await this.notifications.usersForEmployees(members.map((m)=>m.employeeId))).filter((u)=>u !== ctx.userId),
            type: 'project.archived',
            title: `${p.name} archived`,
            link: `/archive?open=${id}`,
            from: ctx.userName ?? 'Projects'
        });
        this.events.emit('project.statusChanged', {
            projectId: id,
            from: 'COMPLETED',
            to: 'ARCHIVED'
        });
        return {
            ok: true,
            message: `${p.name} archived`
        };
    }
    async unarchive(id) {
        const ctx = (0, _requestcontext.requireContext)();
        if (!(0, _decorators.hasPerm)(ctx, 'archive.manage')) throw (0, _errors.forbidden)('Only a manager can unarchive projects');
        const p = await this.prisma.project.findFirst({
            where: {
                id,
                status: 'ARCHIVED'
            }
        });
        if (!p) throw (0, _errors.notFound)('Archived project');
        await this.prisma.project.update({
            where: {
                id
            },
            data: {
                status: 'COMPLETED',
                archivedAt: null,
                archivedByEmployeeId: null
            }
        });
        await this.audit.record({
            action: 'project.unarchived',
            entity: 'Project',
            entityId: id,
            meta: {
                name: p.name
            }
        });
        this.events.emit('project.statusChanged', {
            projectId: id,
            from: 'ARCHIVED',
            to: 'COMPLETED'
        });
        return {
            ok: true,
            message: `${p.name} restored to Completed`
        };
    }
};
ArchiveService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _storageservice.StorageService === "undefined" ? Object : _storageservice.StorageService,
        typeof _workdocsservice.WorkDocsService === "undefined" ? Object : _workdocsservice.WorkDocsService,
        typeof _workaccessservice.WorkAccessService === "undefined" ? Object : _workaccessservice.WorkAccessService,
        typeof _workeventsservice.WorkEvents === "undefined" ? Object : _workeventsservice.WorkEvents
    ])
], ArchiveService);

//# sourceMappingURL=archive.service.js.map