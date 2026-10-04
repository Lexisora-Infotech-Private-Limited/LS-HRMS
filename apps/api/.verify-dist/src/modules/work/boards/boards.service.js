"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "BoardsService", {
    enumerable: true,
    get: function() {
        return BoardsService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _workaccessservice = require("../work-access.service");
const _workeventsservice = require("../work-events.service");
const _taskmapper = require("../tasks/task-mapper");
const _workrules = require("../work.rules");
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
let BoardsService = class BoardsService {
    prisma;
    access;
    audit;
    notifications;
    events;
    constructor(prisma, access, audit, notifications, events){
        this.prisma = prisma;
        this.access = access;
        this.audit = audit;
        this.notifications = notifications;
        this.events = events;
    }
    async load(projectId, departmentId) {
        const v = await this.access.viewer();
        const project = await this.access.requireProject(v, projectId);
        const dept = await this.prisma.department.findFirst({
            where: {
                id: departmentId
            }
        });
        if (!dept || !project.isSystem && !project.boardDepartmentIds.includes(departmentId)) throw (0, _errors.notFound)('Board');
        const rights = await this.access.boardRights(v, project, departmentId);
        return {
            v,
            project,
            dept,
            rights
        };
    }
    async view(projectId, departmentId, includeDone) {
        const { v, project, dept, rights } = await this.load(projectId, departmentId);
        if (!rights.canView) throw this.access.boardLockedError(dept.name, dept.id);
        const statuses = [
            ..._shared.BOARD_COLUMNS
        ];
        const where = {
            projectId,
            departmentId,
            isStanding: false,
            OR: [
                {
                    status: {
                        in: [
                            ..._shared.BOARD_COLUMNS
                        ]
                    }
                },
                ...includeDone ? [
                    {
                        status: 'DONE',
                        doneAt: {
                            gte: new Date(Date.now() - 14 * _workrules.DAY_MS)
                        }
                    }
                ] : []
            ]
        };
        if (includeDone) statuses.push('DONE');
        const tasks = await this.prisma.task.findMany({
            where,
            orderBy: [
                {
                    rank: 'asc'
                },
                {
                    number: 'asc'
                }
            ]
        });
        const allocated = await this.prisma.boardMember.findMany({
            where: {
                projectId,
                departmentId
            }
        });
        const names = await this.access.names([
            ...tasks.map((t)=>t.assigneeEmployeeId),
            ...allocated.map((m)=>m.employeeId),
            dept.leadEmployeeId
        ]);
        const cards = tasks.map((t)=>(0, _taskmapper.toCard)(t, names, rights, v.employeeId));
        const members = [
            ...dept.leadEmployeeId ? [
                {
                    employeeId: dept.leadEmployeeId,
                    name: names.get(dept.leadEmployeeId) ?? '—',
                    isLead: true
                }
            ] : [],
            ...allocated.filter((m)=>m.employeeId !== dept.leadEmployeeId).map((m)=>({
                    employeeId: m.employeeId,
                    name: names.get(m.employeeId) ?? '—',
                    isLead: false
                }))
        ];
        const locked = [
            'ARCHIVED',
            'COMPLETED',
            'CANCELLED'
        ].includes(project.status);
        return {
            project: {
                id: project.id,
                key: project.key,
                name: project.name,
                status: project.status,
                locked
            },
            board: {
                departmentId: dept.id,
                name: dept.name,
                locked: false,
                leadEmployeeId: dept.leadEmployeeId,
                leadName: dept.leadEmployeeId ? names.get(dept.leadEmployeeId) ?? null : null,
                memberCount: members.length,
                canManage: rights.canAllocate
            },
            columns: statuses.map((s)=>{
                const list = cards.filter((c)=>c.status === s);
                return {
                    status: s,
                    label: _shared.TASK_STATUS_LABELS[s],
                    count: list.length,
                    cards: locked ? list.map((c)=>({
                            ...c,
                            canMove: false
                        })) : list
                };
            }),
            members
        };
    }
    // ── Members (allocated by the department lead) ─────────────────────────────
    async members(projectId, departmentId) {
        const { project, dept, rights } = await this.load(projectId, departmentId);
        if (!rights.canView) throw this.access.boardLockedError(dept.name, dept.id);
        const rows = await this.prisma.boardMember.findMany({
            where: {
                projectId,
                departmentId
            },
            orderBy: {
                allocatedAt: 'asc'
            }
        });
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: rows.map((r)=>r.employeeId)
                }
            },
            select: {
                id: true,
                fullName: true,
                designation: {
                    select: {
                        name: true
                    }
                }
            }
        });
        const eOf = new Map(emps.map((e)=>[
                e.id,
                e
            ]));
        const names = await this.access.names([
            ...rows.map((r)=>r.allocatedByEmployeeId),
            dept.leadEmployeeId
        ]);
        let candidates = [];
        if (rights.canAllocate) {
            const projectMembers = await this.prisma.projectMember.findMany({
                where: {
                    projectId
                },
                select: {
                    employeeId: true
                }
            });
            const pool = await this.prisma.employee.findMany({
                where: {
                    status: {
                        in: [
                            'ACTIVE',
                            'NOTICE_PERIOD'
                        ]
                    },
                    id: {
                        notIn: [
                            ...rows.map((r)=>r.employeeId),
                            ...dept.leadEmployeeId ? [
                                dept.leadEmployeeId
                            ] : []
                        ]
                    },
                    OR: [
                        {
                            departmentId
                        },
                        {
                            id: {
                                in: projectMembers.map((m)=>m.employeeId)
                            }
                        }
                    ]
                },
                orderBy: {
                    fullName: 'asc'
                },
                select: {
                    id: true,
                    fullName: true,
                    department: {
                        select: {
                            name: true
                        }
                    }
                }
            });
            candidates = pool.map((e)=>({
                    value: e.id,
                    label: `${e.fullName}${e.department ? ` · ${e.department.name}` : ''}`
                }));
        }
        void project;
        return {
            department: dept.name,
            leadEmployeeId: dept.leadEmployeeId,
            leadName: dept.leadEmployeeId ? names.get(dept.leadEmployeeId) ?? null : null,
            canAllocate: rights.canAllocate,
            members: rows.map((r)=>({
                    employeeId: r.employeeId,
                    name: eOf.get(r.employeeId)?.fullName ?? '—',
                    designation: eOf.get(r.employeeId)?.designation?.name ?? null,
                    allocatedBy: r.allocatedByEmployeeId ? names.get(r.allocatedByEmployeeId) ?? null : null,
                    allocatedAt: r.allocatedAt.toISOString()
                })),
            candidates
        };
    }
    async allocate(projectId, departmentId, employeeId) {
        const { v, project, dept, rights } = await this.load(projectId, departmentId);
        if (!rights.canAllocate) throw (0, _errors.forbidden)(`Only the ${dept.name} lead can allocate members to this board`);
        if (project.status === 'ARCHIVED') throw new _errors.AppError(423, 'PROJECT_LOCKED', 'Archived projects are read-only');
        const e = await this.prisma.employee.findFirst({
            where: {
                id: employeeId
            },
            select: {
                id: true,
                fullName: true,
                userId: true,
                status: true
            }
        });
        if (!e || e.status === 'EXITED') throw (0, _errors.badRequest)('Employee not found');
        if (e.id === dept.leadEmployeeId) throw (0, _errors.conflict)(`${e.fullName} leads ${dept.name} and already has access`);
        if (await this.prisma.boardMember.count({
            where: {
                projectId,
                departmentId,
                employeeId
            }
        })) throw (0, _errors.conflict)(`${e.fullName} is already on this board`);
        await this.prisma.boardMember.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                projectId,
                departmentId,
                employeeId,
                allocatedByEmployeeId: v.employeeId
            }
        });
        await this.audit.record({
            action: 'board.member.allocated',
            entity: 'Project',
            entityId: projectId,
            meta: {
                board: dept.name,
                employeeId,
                name: e.fullName
            }
        });
        if (e.userId) {
            await this.notifications.notify({
                userIds: [
                    e.userId
                ],
                type: 'board.allocated',
                title: `You now have access to the ${dept.name} board of ${project.name}`,
                link: `/board?project=${projectId}&board=${departmentId}`,
                from: v.name
            });
            this.events.accessChanged([
                e.userId
            ], projectId, departmentId);
        }
        this.events.boardChanged(projectId, departmentId);
        return {
            ok: true,
            message: `${e.fullName} allocated to ${dept.name}`
        };
    }
    async revoke(projectId, departmentId, employeeId) {
        const { v, project, dept, rights } = await this.load(projectId, departmentId);
        if (!rights.canAllocate) throw (0, _errors.forbidden)(`Only the ${dept.name} lead can change this board's members`);
        const row = await this.prisma.boardMember.findFirst({
            where: {
                projectId,
                departmentId,
                employeeId
            }
        });
        if (!row) throw (0, _errors.notFound)('Board member');
        await this.prisma.boardMember.delete({
            where: {
                id: row.id
            }
        });
        // Their ALLOTTED cards return to Open; WIP and later keep the assignee (lead is told).
        const allotted = await this.prisma.task.findMany({
            where: {
                projectId,
                departmentId,
                assigneeEmployeeId: employeeId,
                status: 'ALLOTTED'
            },
            select: {
                id: true
            }
        });
        if (allotted.length) {
            await this.prisma.task.updateMany({
                where: {
                    id: {
                        in: allotted.map((t)=>t.id)
                    }
                },
                data: {
                    status: 'OPEN',
                    assigneeEmployeeId: null,
                    statusChangedAt: new Date(),
                    version: {
                        increment: 1
                    }
                }
            });
            await this.prisma.taskTransition.createMany({
                data: allotted.map((t)=>({
                        tenantId: (0, _requestcontext.currentTenantId)(),
                        taskId: t.id,
                        fromStatus: 'ALLOTTED',
                        toStatus: 'OPEN',
                        kind: 'ASSIGN',
                        note: 'Assignee lost board access',
                        byEmployeeId: v.employeeId,
                        byName: v.name
                    }))
            });
        }
        const inFlight = await this.prisma.task.count({
            where: {
                projectId,
                departmentId,
                assigneeEmployeeId: employeeId,
                status: {
                    in: [
                        'WIP',
                        'DEV_COMPLETED',
                        'QA'
                    ]
                }
            }
        });
        const e = await this.prisma.employee.findFirst({
            where: {
                id: employeeId
            },
            select: {
                fullName: true,
                userId: true
            }
        });
        await this.audit.record({
            action: 'board.member.revoked',
            entity: 'Project',
            entityId: projectId,
            meta: {
                board: dept.name,
                employeeId,
                returnedToOpen: allotted.length
            }
        });
        if (inFlight && dept.leadEmployeeId && dept.leadEmployeeId !== v.employeeId) {
            await this.notifications.notify({
                userIds: await this.notifications.usersForEmployees([
                    dept.leadEmployeeId
                ]),
                type: 'board.assignee_lost_access',
                title: `${e?.fullName ?? 'A member'} lost access to ${inFlight} in-progress task${inFlight === 1 ? '' : 's'} on ${project.name}`,
                link: `/board?project=${projectId}&board=${departmentId}`,
                from: v.name
            });
        }
        if (e?.userId) {
            this.events.accessChanged([
                e.userId
            ], projectId, departmentId);
            this.events.trackerTasksChanged([
                e.userId
            ]);
        }
        this.events.boardChanged(projectId, departmentId);
        return {
            ok: true,
            message: `${e?.fullName ?? 'Member'} removed from ${dept.name}`,
            returnedToOpen: allotted.length
        };
    }
};
BoardsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _workaccessservice.WorkAccessService === "undefined" ? Object : _workaccessservice.WorkAccessService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _workeventsservice.WorkEvents === "undefined" ? Object : _workeventsservice.WorkEvents
    ])
], BoardsService);

//# sourceMappingURL=boards.service.js.map