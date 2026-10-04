"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "JobsService", {
    enumerable: true,
    get: function() {
        return JobsService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _auditservice = require("../../../core/audit/audit.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _sequenceservice = require("../../../core/registry/sequence.service");
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
const STATUS_LABEL = {
    DRAFT: 'Draft',
    OPEN: 'Open',
    ON_HOLD: 'On hold',
    CLOSED: 'Closed'
};
const JOB_FLOW = {
    DRAFT: [
        'OPEN',
        'CLOSED'
    ],
    OPEN: [
        'ON_HOLD',
        'CLOSED'
    ],
    ON_HOLD: [
        'OPEN',
        'CLOSED'
    ],
    CLOSED: [
        'OPEN'
    ]
};
let JobsService = class JobsService {
    prisma;
    seq;
    audit;
    constructor(prisma, seq, audit){
        this.prisma = prisma;
        this.seq = seq;
        this.audit = audit;
    }
    async rows(jobs) {
        const ids = jobs.map((j)=>j.id);
        const [depts, branches, apps, hired] = await Promise.all([
            this.prisma.department.findMany({
                where: {
                    id: {
                        in: jobs.map((j)=>j.departmentId)
                    }
                },
                select: {
                    id: true,
                    name: true
                }
            }),
            this.prisma.branch.findMany({
                where: {
                    id: {
                        in: jobs.map((j)=>j.branchId).filter((x)=>!!x)
                    }
                },
                select: {
                    id: true,
                    name: true
                }
            }),
            this.prisma.jobApplication.groupBy({
                by: [
                    'jobId'
                ],
                where: {
                    jobId: {
                        in: ids
                    }
                },
                _count: {
                    _all: true
                }
            }),
            this.prisma.jobApplication.groupBy({
                by: [
                    'jobId'
                ],
                where: {
                    jobId: {
                        in: ids
                    },
                    stage: 'HIRED'
                },
                _count: {
                    _all: true
                }
            })
        ]);
        const dm = new Map(depts.map((d)=>[
                d.id,
                d.name
            ]));
        const bm = new Map(branches.map((d)=>[
                d.id,
                d.name
            ]));
        const am = new Map(apps.map((a)=>[
                a.jobId,
                a._count._all
            ]));
        const hm = new Map(hired.map((a)=>[
                a.jobId,
                a._count._all
            ]));
        return jobs.map((j)=>({
                id: j.id,
                code: j.code,
                title: j.title,
                department: dm.get(j.departmentId) ?? '—',
                departmentId: j.departmentId,
                jobType: j.jobType,
                typeLabel: _shared.JOB_TYPE_LABELS[j.jobType],
                openings: j.openings,
                branch: j.branchId ? bm.get(j.branchId) ?? '—' : '—',
                applicants: am.get(j.id) ?? 0,
                hired: hm.get(j.id) ?? 0,
                status: j.status,
                statusLabel: STATUS_LABEL[j.status],
                description: j.description
            }));
    }
    async list(tab = 'open') {
        const where = tab === 'closed' ? {
            status: 'CLOSED'
        } : {
            status: {
                not: 'CLOSED'
            }
        };
        const [jobs, open, closed] = await Promise.all([
            this.prisma.job.findMany({
                where,
                orderBy: [
                    {
                        status: 'asc'
                    },
                    {
                        createdAt: 'asc'
                    }
                ]
            }),
            // "Open · {n}" counts every job in the Open tab (drafts and on hold included) — spec M6 acceptance 1.
            this.prisma.job.count({
                where: {
                    status: {
                        not: 'CLOSED'
                    }
                }
            }),
            this.prisma.job.count({
                where: {
                    status: 'CLOSED'
                }
            })
        ]);
        return {
            items: await this.rows(jobs),
            counts: {
                open,
                closed
            }
        };
    }
    async detail(id) {
        const j = await this.prisma.job.findUnique({
            where: {
                id
            }
        });
        if (!j) throw (0, _errors.notFound)('Job');
        const [row] = await this.rows([
            j
        ]);
        const stages = await this.prisma.jobApplication.groupBy({
            by: [
                'stage'
            ],
            where: {
                jobId: id
            },
            _count: {
                _all: true
            }
        });
        return {
            ...row,
            designationId: j.designationId,
            branchId: j.branchId,
            experienceMinYrs: j.experienceMinYrs,
            experienceMaxYrs: j.experienceMaxYrs,
            hiringManagerId: j.hiringManagerId,
            roundNames: j.roundNames,
            pipeline: Object.fromEntries(stages.map((s)=>[
                    s.stage,
                    s._count._all
                ]))
        };
    }
    async validate(i) {
        if (!await this.prisma.department.findUnique({
            where: {
                id: i.departmentId
            }
        })) throw (0, _errors.badRequest)('Pick a department');
        if (i.branchId && !await this.prisma.branch.findUnique({
            where: {
                id: i.branchId
            }
        })) throw (0, _errors.badRequest)('Pick a branch');
        if (i.experienceMinYrs != null && i.experienceMaxYrs != null && i.experienceMaxYrs < i.experienceMinYrs) throw (0, _errors.badRequest)('Maximum experience must be at least the minimum');
    }
    async create(i) {
        await this.validate(i);
        const code = await this.seq.next('recruitment.job', {
            prefix: 'JOB-',
            pad: 4
        });
        const j = await this.prisma.job.create({
            data: {
                code,
                title: i.title,
                departmentId: i.departmentId,
                designationId: i.designationId ?? null,
                jobType: i.jobType,
                openings: i.openings,
                branchId: i.branchId ?? null,
                description: i.description ?? null,
                experienceMinYrs: i.experienceMinYrs ?? null,
                experienceMaxYrs: i.experienceMaxYrs ?? null,
                hiringManagerId: i.hiringManagerId ?? null,
                roundNames: i.roundNames,
                status: i.status,
                publishedAt: i.status === 'OPEN' ? new Date() : null
            }
        });
        await this.audit.record({
            action: 'job.created',
            entity: 'Job',
            entityId: j.id,
            meta: {
                code,
                title: i.title,
                status: i.status
            }
        });
        return this.detail(j.id);
    }
    async update(id, i) {
        const j = await this.prisma.job.findUnique({
            where: {
                id
            }
        });
        if (!j) throw (0, _errors.notFound)('Job');
        await this.validate(i);
        await this.prisma.job.update({
            where: {
                id
            },
            data: {
                title: i.title,
                departmentId: i.departmentId,
                designationId: i.designationId ?? null,
                jobType: i.jobType,
                openings: i.openings,
                branchId: i.branchId ?? null,
                description: i.description ?? null,
                experienceMinYrs: i.experienceMinYrs ?? null,
                experienceMaxYrs: i.experienceMaxYrs ?? null,
                hiringManagerId: i.hiringManagerId ?? null,
                roundNames: i.roundNames
            }
        });
        await this.audit.record({
            action: 'job.updated',
            entity: 'Job',
            entityId: id
        });
        return this.detail(id);
    }
    async setStatus(id, status, reason) {
        const j = await this.prisma.job.findUnique({
            where: {
                id
            }
        });
        if (!j) throw (0, _errors.notFound)('Job');
        if (j.status === status) return this.detail(id);
        if (!JOB_FLOW[j.status].includes(status)) throw new _errors.AppError(409, 'INVALID_TRANSITION', `A ${STATUS_LABEL[j.status].toLowerCase()} job cannot be moved to ${STATUS_LABEL[status].toLowerCase()}`);
        await this.prisma.job.update({
            where: {
                id
            },
            data: {
                status,
                closedAt: status === 'CLOSED' ? new Date() : null,
                closeReason: status === 'CLOSED' ? reason ?? 'CANCELLED' : null,
                publishedAt: status === 'OPEN' ? j.publishedAt ?? new Date() : j.publishedAt
            }
        });
        await this.audit.record({
            action: `job.${status.toLowerCase()}`,
            entity: 'Job',
            entityId: id,
            meta: {
                from: j.status,
                reason: reason ?? null,
                by: (0, _requestcontext.requireContext)().userName ?? null
            }
        });
        return this.detail(id);
    }
};
JobsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _sequenceservice.SequenceService === "undefined" ? Object : _sequenceservice.SequenceService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], JobsService);

//# sourceMappingURL=jobs.service.js.map