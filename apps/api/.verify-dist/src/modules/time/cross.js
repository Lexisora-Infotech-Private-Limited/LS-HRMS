"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CrossReader", {
    enumerable: true,
    get: function() {
        return CrossReader;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../core/prisma/prisma.service");
const _timeutils = require("./lib/time-utils");
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
let CrossReader = class CrossReader {
    prisma;
    log = new _common.Logger('TimeCross');
    constructor(prisma){
        this.prisma = prisma;
    }
    model(name) {
        return this.prisma[name];
    }
    async safe(name, fn, fallback) {
        const m = this.model(name);
        if (!m) return fallback;
        try {
            return await fn(m);
        } catch (e) {
            this.log.debug(`${name} read failed: ${e.message}`);
            return fallback;
        }
    }
    // ── tracker ──
    segments(employeeIds, from, to) {
        const ids = Array.isArray(employeeIds) ? employeeIds : [
            employeeIds
        ];
        return this.safe('activitySegment', (m)=>m.findMany({
                where: {
                    employeeId: {
                        in: ids
                    },
                    workDate: {
                        gte: (0, _timeutils.dateOf)(from),
                        lte: (0, _timeutils.dateOf)(to)
                    }
                },
                orderBy: {
                    startAt: 'asc'
                }
            }), []);
    }
    daySummaries(employeeIds, from, to) {
        return this.safe('trackerDaySummary', (m)=>m.findMany({
                where: {
                    employeeId: {
                        in: employeeIds
                    },
                    workDate: {
                        gte: (0, _timeutils.dateOf)(from),
                        lte: (0, _timeutils.dateOf)(to)
                    }
                }
            }), []);
    }
    async daySummary(employeeId, date) {
        return (await this.daySummaries([
            employeeId
        ], date, date))[0] ?? null;
    }
    idleClaims(employeeId, from, to) {
        return this.safe('idleClaim', (m)=>m.findMany({
                where: {
                    employeeId,
                    workDate: {
                        gte: (0, _timeutils.dateOf)(from),
                        lte: (0, _timeutils.dateOf)(to)
                    }
                },
                orderBy: {
                    startAt: 'asc'
                }
            }), []);
    }
    screenshots(employeeId, from, to, opts = {}) {
        const where = {
            employeeId,
            workDate: opts.date ? (0, _timeutils.dateOf)(opts.date) : {
                gte: (0, _timeutils.dateOf)(from),
                lte: (0, _timeutils.dateOf)(to)
            }
        };
        if (opts.taskIds) where.taskId = {
            in: opts.taskIds
        };
        return this.safe('screenshot', (m)=>m.findMany({
                where,
                orderBy: {
                    capturedAt: 'asc'
                },
                skip: opts.skip,
                take: opts.take
            }), []);
    }
    screenshotCount(employeeId, from, to, opts = {}) {
        const where = {
            employeeId,
            workDate: opts.date ? (0, _timeutils.dateOf)(opts.date) : {
                gte: (0, _timeutils.dateOf)(from),
                lte: (0, _timeutils.dateOf)(to)
            }
        };
        if (opts.taskIds) where.taskId = {
            in: opts.taskIds
        };
        return this.safe('screenshot', (m)=>m.count({
                where
            }), 0);
    }
    screenshotByFile(fileId) {
        return this.safe('screenshot', (m)=>m.findFirst({
                where: {
                    OR: [
                        {
                            fileId
                        },
                        {
                            thumbFileId: fileId
                        }
                    ]
                }
            }), null);
    }
    activeTrackerDevices(employeeIds) {
        return this.safe('trackerDevice', (m)=>m.count({
                where: {
                    status: 'ACTIVE',
                    ...employeeIds ? {
                        employeeId: {
                            in: employeeIds
                        }
                    } : {}
                }
            }), 0);
    }
    // ── work ──
    projects(ids) {
        return this.safe('project', (m)=>m.findMany({
                where: ids ? {
                    id: {
                        in: ids
                    }
                } : {},
                orderBy: {
                    name: 'asc'
                }
            }), []);
    }
    async projectMap(ids) {
        const rows = ids.length ? await this.projects([
            ...new Set(ids)
        ]) : [];
        return new Map(rows.map((p)=>[
                p.id,
                p
            ]));
    }
    tasks(ids) {
        if (!ids.length) return Promise.resolve([]);
        return this.safe('task', (m)=>m.findMany({
                where: {
                    id: {
                        in: [
                            ...new Set(ids)
                        ]
                    }
                }
            }), []);
    }
    async taskMap(ids) {
        return new Map((await this.tasks(ids)).map((t)=>[
                t.id,
                t
            ]));
    }
    /** Project ids the employee belongs to (ProjectMember) plus projects they lead. */ async memberProjectIds(employeeId) {
        const members = await this.safe('projectMember', (m)=>m.findMany({
                where: {
                    employeeId
                },
                select: {
                    projectId: true
                }
            }), []);
        const led = await this.safe('project', (m)=>m.findMany({
                where: {
                    leadEmployeeId: employeeId
                },
                select: {
                    id: true
                }
            }), []);
        const internal = await this.safe('project', (m)=>m.findMany({
                where: {
                    isInternal: true
                },
                select: {
                    id: true
                }
            }), []);
        return [
            ...new Set([
                ...members.map((x)=>x.projectId),
                ...led.map((x)=>x.id),
                ...internal.map((x)=>x.id)
            ])
        ];
    }
    /** Tasks the employee can log time against: assigned to them, or standing tasks (INT meetings…). */ async assignableTasks(employeeId) {
        const projectIds = await this.memberProjectIds(employeeId);
        return this.safe('task', (m)=>m.findMany({
                where: {
                    OR: [
                        {
                            assigneeEmployeeId: employeeId
                        },
                        {
                            isStanding: true
                        },
                        ...projectIds.length ? [
                            {
                                projectId: {
                                    in: projectIds
                                },
                                status: {
                                    notIn: [
                                        'DONE',
                                        'CANCELLED'
                                    ]
                                }
                            }
                        ] : []
                    ]
                },
                orderBy: {
                    key: 'asc'
                },
                take: 300
            }), []);
    }
    /** Employees on projects the lead leads (lead's project scope). */ async projectTeam(leadEmployeeId) {
        const led = await this.safe('project', (m)=>m.findMany({
                where: {
                    leadEmployeeId
                },
                select: {
                    id: true
                }
            }), []);
        if (!led.length) return [];
        const members = await this.safe('projectMember', (m)=>m.findMany({
                where: {
                    projectId: {
                        in: led.map((p)=>p.id)
                    }
                },
                select: {
                    employeeId: true
                }
            }), []);
        return [
            ...new Set(members.map((x)=>x.employeeId))
        ];
    }
    // ── leavepay ──
    async leaveDays(employeeIds, from, to) {
        const rows = await this.safe('leaveRequestDay', (m)=>m.findMany({
                where: {
                    employeeId: {
                        in: employeeIds
                    },
                    active: true,
                    date: {
                        gte: (0, _timeutils.dateOf)(from),
                        lte: (0, _timeutils.dateOf)(to)
                    }
                }
            }), []);
        if (!rows.length) return [];
        const reqs = await this.safe('leaveRequest', (m)=>m.findMany({
                where: {
                    id: {
                        in: [
                            ...new Set(rows.map((r)=>r.requestId))
                        ]
                    }
                },
                select: {
                    id: true,
                    leaveTypeId: true,
                    status: true
                }
            }), []);
        const types = await this.safe('leaveType', (m)=>m.findMany({
                where: {
                    id: {
                        in: [
                            ...new Set(reqs.map((r)=>r.leaveTypeId))
                        ]
                    }
                },
                select: {
                    id: true,
                    code: true
                }
            }), []);
        const reqMap = new Map(reqs.map((r)=>[
                r.id,
                r
            ]));
        const typeMap = new Map(types.map((t)=>[
                t.id,
                t.code
            ]));
        return rows.filter((r)=>{
            const req = reqMap.get(r.requestId);
            return !req || req.status === 'APPROVED' || req.status === 'CANCELLATION_PENDING';
        }).map((r)=>({
                employeeId: r.employeeId,
                date: (0, _timeutils.keyOf)(r.date),
                units: Number(r.units),
                isPaid: !!r.isPaid,
                typeCode: typeMap.get(reqMap.get(r.requestId)?.leaveTypeId) ?? null
            }));
    }
    leaveRequest(id) {
        return this.safe('leaveRequest', (m)=>m.findFirst({
                where: {
                    id
                }
            }), null);
    }
    // ── people ──
    /** Resolve a scanned badge: IdCard.verifyToken (people domain), "DEV:<employeeId>", or an employee code. */ async employeeIdFromBadge(token) {
        const t = token.trim();
        if (t.startsWith('DEV:')) return t.slice(4);
        const url = /\/(?:vcard|id-cards?|idcards?|verify)\/(?:scan\/)?([\w-]+)/.exec(t);
        const raw = url?.[1] ?? t;
        const card = await this.safe('idCard', (m)=>m.findFirst({
                where: {
                    verifyToken: raw
                }
            }), null);
        if (card?.employeeId) return card.employeeId;
        const byCode = await this.prisma.employee.findFirst({
            where: {
                empCode: raw
            },
            select: {
                id: true
            }
        });
        return byCode?.id ?? null;
    }
};
CrossReader = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], CrossReader);

//# sourceMappingURL=cross.js.map