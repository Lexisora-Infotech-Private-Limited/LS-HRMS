"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WorkRegistry", {
    enumerable: true,
    get: function() {
        return WorkRegistry;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../core/prisma/prisma.service");
const _lookups = require("../../core/lookups/lookups");
const _registries = require("../../core/registry/registries");
const _eventsservice = require("../../core/registry/events.service");
const _decorators = require("../../core/auth/decorators");
const _requestcontext = require("../../core/context/request-context");
const _filescontroller = require("../../core/storage/files.controller");
const _workaccessservice = require("./work-access.service");
const _workmetricsservice = require("./projects/work-metrics.service");
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
let WorkRegistry = class WorkRegistry {
    prisma;
    lookups;
    search;
    events;
    access;
    metrics;
    log = new _common.Logger('WorkRegistry');
    constructor(prisma, lookups, search, events, access, metrics){
        this.prisma = prisma;
        this.lookups = lookups;
        this.search = search;
        this.events = events;
        this.access = access;
        this.metrics = metrics;
    }
    onModuleInit() {
        this.lookups.register('projects', async ()=>{
            const v = await this.access.viewer();
            const scope = await this.access.projectScope(v);
            const rows = await this.prisma.project.findMany({
                where: {
                    status: {
                        in: [
                            'PLANNING',
                            'ACTIVE',
                            'ON_HOLD'
                        ]
                    },
                    OR: [
                        scope,
                        {
                            isSystem: true
                        }
                    ]
                },
                orderBy: [
                    {
                        isSystem: 'asc'
                    },
                    {
                        name: 'asc'
                    }
                ],
                select: {
                    id: true,
                    name: true,
                    key: true
                }
            });
            return rows.map((p)=>({
                    value: p.id,
                    label: `${p.name} · ${p.key}`
                }));
        });
        this.lookups.register('clients', async ()=>(await this.prisma.client.findMany({
                where: {
                    status: 'ACTIVE'
                },
                orderBy: [
                    {
                        isInternal: 'asc'
                    },
                    {
                        name: 'asc'
                    }
                ],
                select: {
                    id: true,
                    name: true
                }
            })).map((c)=>({
                    value: c.id,
                    label: c.name
                })));
        this.lookups.register('teams', async ()=>{
            const used = new Set((await this.prisma.project.findMany({
                select: {
                    boardDepartmentIds: true
                }
            })).flatMap((p)=>p.boardDepartmentIds));
            const depts = await this.prisma.department.findMany({
                orderBy: {
                    name: 'asc'
                },
                select: {
                    id: true,
                    name: true
                }
            });
            const list = depts.filter((d)=>used.has(d.id));
            return (list.length ? list : depts).map((d)=>({
                    value: d.id,
                    label: d.name
                }));
        });
        this.search.register('projects', async (q, ctx)=>{
            if (!(0, _decorators.hasPerm)(ctx, 'projects.view')) return [];
            const v = await this.access.viewer();
            const scope = await this.access.projectScope(v);
            const rows = await this.prisma.project.findMany({
                where: {
                    AND: [
                        scope,
                        {
                            isSystem: false,
                            status: {
                                not: 'ARCHIVED'
                            }
                        },
                        {
                            OR: [
                                {
                                    name: {
                                        contains: q,
                                        mode: 'insensitive'
                                    }
                                },
                                {
                                    key: {
                                        equals: q.toUpperCase()
                                    }
                                }
                            ]
                        }
                    ]
                },
                include: {
                    client: {
                        select: {
                            name: true
                        }
                    }
                },
                take: 6
            });
            return rows.map((p)=>({
                    type: 'projects',
                    id: p.id,
                    title: p.name,
                    subtitle: `${p.key} · ${p.client?.name ?? 'Internal'}`,
                    link: `/projects/${p.id}`
                }));
        });
        this.search.register('tasks', async (q, ctx)=>{
            if (!(0, _decorators.hasPerm)(ctx, 'tasks.board')) return [];
            const v = await this.access.viewer();
            const boards = await this.access.visibleBoards(v);
            const rows = await this.prisma.task.findMany({
                where: {
                    status: {
                        not: 'CANCELLED'
                    },
                    OR: [
                        {
                            key: {
                                equals: q.toUpperCase()
                            }
                        },
                        {
                            title: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        }
                    ]
                },
                include: {
                    project: {
                        select: {
                            name: true,
                            isSystem: true
                        }
                    }
                },
                orderBy: {
                    updatedAt: 'desc'
                },
                take: 30
            });
            return rows.filter((t)=>boards.all || t.project.isSystem || t.assigneeEmployeeId === v.employeeId || t.departmentId && boards.keys.has(`${t.projectId}|${t.departmentId}`)).slice(0, 6).map((t)=>({
                    type: 'tasks',
                    id: t.id,
                    title: `${t.key} ${t.title}`,
                    subtitle: t.project.name,
                    link: `/board?project=${t.projectId}${t.departmentId ? `&board=${t.departmentId}` : ''}&task=${t.id}`
                }));
        });
        _filescontroller.fileAccessCheckers.push(async (fileId)=>{
            const docs = await this.prisma.projectDocument.findMany({
                where: {
                    fileId
                },
                select: {
                    projectId: true,
                    clientId: true
                }
            });
            if (!docs.length) return false;
            const v = await this.access.viewer();
            for (const d of docs){
                if (d.projectId) {
                    const p = await this.prisma.project.findFirst({
                        where: {
                            id: d.projectId
                        },
                        select: {
                            status: true,
                            archiveAccess: true
                        }
                    });
                    if (p?.status === 'ARCHIVED') {
                        const ctx = (0, _requestcontext.requireContext)();
                        if ((0, _decorators.hasPerm)(ctx, 'archive.view') || p.archiveAccess === 'ALL_DEVELOPERS') return true;
                    } else if (await this.access.canSeeProject(v, d.projectId)) return true;
                } else if (d.clientId) {
                    const ctx = (0, _requestcontext.requireContext)();
                    if ((0, _decorators.hasPerm)(ctx, 'clients.manage') || (0, _decorators.hasPerm)(ctx, 'archive.view')) return true;
                }
            }
            return false;
        });
        // Logged minutes follow approved timesheets / tracker ingest (throttled per project).
        const touch = async (employeeId)=>{
            const rows = await this.prisma.task.findMany({
                where: {
                    assigneeEmployeeId: employeeId,
                    status: {
                        notIn: [
                            'CANCELLED'
                        ]
                    }
                },
                select: {
                    projectId: true
                },
                distinct: [
                    'projectId'
                ]
            });
            for (const r of rows)await this.metrics.recomputeProjectIfStale(r.projectId, 5 * 60_000);
        };
        for (const ev of [
            'timesheet.approved',
            'timesheet.submitted',
            'tracker.segmentsIngested'
        ]){
            this.events.on(ev, async (p)=>{
                if (p?.employeeId) await touch(p.employeeId).catch((e)=>this.log.warn(`${ev}: ${e.message}`));
            });
        }
    }
};
WorkRegistry = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _lookups.LookupsService === "undefined" ? Object : _lookups.LookupsService,
        typeof _registries.SearchService === "undefined" ? Object : _registries.SearchService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _workaccessservice.WorkAccessService === "undefined" ? Object : _workaccessservice.WorkAccessService,
        typeof _workmetricsservice.WorkMetricsService === "undefined" ? Object : _workmetricsservice.WorkMetricsService
    ])
], WorkRegistry);

//# sourceMappingURL=work-registry.service.js.map