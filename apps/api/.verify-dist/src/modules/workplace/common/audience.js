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
    get ACTIVE_STATUSES () {
        return ACTIVE_STATUSES;
    },
    get AudienceService () {
        return AudienceService;
    },
    get projectIdsByEmployee () {
        return _audiencerules.projectIdsByEmployee;
    },
    get resolveAudience () {
        return _audiencerules.resolveAudience;
    },
    get ruleMatches () {
        return _audiencerules.ruleMatches;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _spine = require("./spine");
const _audiencerules = require("./audience.rules");
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
const ACTIVE_STATUSES = [
    'ACTIVE',
    'NOTICE_PERIOD'
];
let AudienceService = class AudienceService {
    prisma;
    spine;
    constructor(prisma, spine){
        this.prisma = prisma;
        this.spine = spine;
    }
    async population() {
        const emps = await this.prisma.employee.findMany({
            where: {
                status: {
                    in: [
                        ...ACTIVE_STATUSES
                    ]
                }
            },
            select: {
                id: true,
                departmentId: true,
                branchId: true,
                employmentType: true
            }
        });
        const [members, projects] = await Promise.all([
            this.spine.projectMembers({}),
            this.spine.projects({})
        ]);
        const byEmp = (0, _audiencerules.projectIdsByEmployee)(members, projects);
        return emps.map((e)=>({
                ...e,
                projectIds: [
                    ...byEmp.get(e.id) ?? []
                ]
            }));
    }
    /** Employee ids matching the union of rules. */ async resolve(rules) {
        return (0, _audiencerules.resolveAudience)(await this.population(), rules);
    }
    async subject(employeeId) {
        const e = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                id: true,
                departmentId: true,
                branchId: true,
                employmentType: true
            }
        });
        if (!e) return null;
        return {
            ...e,
            projectIds: await this.spine.projectIdsOf(employeeId)
        };
    }
    async matches(employeeId, rules) {
        if (!rules.length || rules.some((r)=>r.type === 'ALL')) return true;
        if (!employeeId) return false;
        const s = await this.subject(employeeId);
        return !!s && (0, _audiencerules.ruleMatches)(s, rules);
    }
    /** "Everyone" / "Development · Atlas" */ label(rules) {
        if (!rules.length || rules.some((r)=>r.type === 'ALL')) return 'Everyone';
        return rules.map((r)=>r.label ?? r.type).join(' · ');
    }
    /** Fill in missing labels from department / project / employee names. */ async withLabels(rules) {
        const need = rules.filter((r)=>!r.label && r.refId);
        if (!need.length) return rules;
        const ids = need.map((r)=>r.refId);
        const [depts, projects, emps, branches] = await Promise.all([
            this.prisma.department.findMany({
                where: {
                    id: {
                        in: ids
                    }
                }
            }),
            this.spine.projects({
                id: {
                    in: ids
                }
            }),
            this.prisma.employee.findMany({
                where: {
                    id: {
                        in: ids
                    }
                },
                select: {
                    id: true,
                    fullName: true
                }
            }),
            this.prisma.branch.findMany({
                where: {
                    id: {
                        in: ids
                    }
                }
            })
        ]);
        const name = new Map([
            ...depts.map((d)=>[
                    d.id,
                    d.name
                ]),
            ...projects.map((p)=>[
                    p.id,
                    p.name.split(' ')[0]
                ]),
            ...emps.map((e)=>[
                    e.id,
                    e.fullName
                ]),
            ...branches.map((b)=>[
                    b.id,
                    b.name
                ])
        ]);
        return rules.map((r)=>r.label || !r.refId ? r : {
                ...r,
                label: name.get(r.refId) ?? (r.type === 'EMPLOYMENT_TYPE' ? r.refId : r.type)
            });
    }
    // ── Directory helpers ───────────────────────────────────────────────────
    async briefs(employeeIds) {
        const ids = [
            ...new Set(employeeIds.filter((x)=>!!x))
        ];
        if (!ids.length) return new Map();
        const rows = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: ids
                }
            },
            select: {
                id: true,
                fullName: true,
                firstName: true,
                userId: true,
                status: true,
                departmentId: true,
                designation: {
                    select: {
                        name: true
                    }
                },
                department: {
                    select: {
                        name: true
                    }
                }
            }
        });
        return new Map(rows.map((e)=>[
                e.id,
                {
                    id: e.id,
                    name: e.fullName,
                    first: e.firstName,
                    initials: (0, _shared.initialsOf)(e.fullName),
                    userId: e.userId,
                    designation: e.designation?.name ?? null,
                    department: e.department?.name ?? null,
                    departmentId: e.departmentId,
                    status: e.status
                }
            ]));
    }
    async userIds(employeeIds) {
        const ids = employeeIds.filter((x)=>!!x);
        if (!ids.length) return [];
        const rows = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: ids
                }
            },
            select: {
                userId: true
            }
        });
        return rows.map((r)=>r.userId).filter((x)=>!!x);
    }
    async employeeIdOfUser(userId) {
        const e = await this.prisma.employee.findFirst({
            where: {
                userId
            },
            select: {
                id: true
            }
        });
        return e?.id ?? null;
    }
    /** Departments/projects a publisher may target with a team notice (lead or manager). */ async teamsLedBy(employeeId) {
        const [led, reports, projects, lead] = await Promise.all([
            this.prisma.department.findMany({
                where: {
                    leadEmployeeId: employeeId
                },
                select: {
                    id: true
                }
            }),
            this.prisma.employee.findMany({
                where: {
                    managerId: employeeId
                },
                select: {
                    departmentId: true
                }
            }),
            this.spine.projects({
                leadEmployeeId: employeeId
            }),
            this.spine.projectMembers({
                employeeId,
                role: 'LEAD'
            })
        ]);
        return {
            departmentIds: [
                ...new Set([
                    ...led.map((d)=>d.id),
                    ...reports.map((r)=>r.departmentId).filter((x)=>!!x)
                ])
            ],
            projectIds: [
                ...new Set([
                    ...projects.map((p)=>p.id),
                    ...lead.map((m)=>m.projectId)
                ])
            ]
        };
    }
};
AudienceService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _spine.SpineReader === "undefined" ? Object : _spine.SpineReader
    ])
], AudienceService);

//# sourceMappingURL=audience.js.map