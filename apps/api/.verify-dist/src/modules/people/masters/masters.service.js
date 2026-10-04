"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "MastersService", {
    enumerable: true,
    get: function() {
        return MastersService;
    }
});
const _common = require("@nestjs/common");
const _auditservice = require("../../../core/audit/audit.service");
const _errors = require("../../../core/http/errors");
const _prismaservice = require("../../../core/prisma/prisma.service");
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
const ACTIVE_EMP = {
    status: {
        not: 'EXITED'
    }
};
let MastersService = class MastersService {
    prisma;
    audit;
    constructor(prisma, audit){
        this.prisma = prisma;
        this.audit = audit;
    }
    async departments() {
        const rows = await this.prisma.department.findMany({
            orderBy: {
                name: 'asc'
            },
            include: {
                _count: {
                    select: {
                        employees: {
                            where: ACTIVE_EMP
                        }
                    }
                }
            }
        });
        const leads = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: rows.map((r)=>r.leadEmployeeId).filter((x)=>!!x)
                }
            },
            select: {
                id: true,
                fullName: true
            }
        });
        const lm = new Map(leads.map((l)=>[
                l.id,
                l.fullName
            ]));
        return rows.map((r)=>({
                id: r.id,
                name: r.name,
                code: r.code,
                lead: r.leadEmployeeId ? lm.get(r.leadEmployeeId) ?? null : null,
                leadEmployeeId: r.leadEmployeeId,
                employees: r._count.employees
            }));
    }
    async assertUnique(kind, name, exceptId) {
        const m = this.prisma[kind];
        const dup = await m.findFirst({
            where: {
                name: {
                    equals: name,
                    mode: 'insensitive'
                },
                ...exceptId ? {
                    id: {
                        not: exceptId
                    }
                } : {}
            }
        });
        if (dup) throw (0, _errors.conflict)(`“${name}” already exists`, 'DUPLICATE_NAME');
    }
    async createDepartment(i) {
        await this.assertUnique('department', i.name);
        if (i.code && await this.prisma.department.findFirst({
            where: {
                code: i.code
            }
        })) throw (0, _errors.conflict)(`Code ${i.code} is taken`, 'DUPLICATE_CODE');
        const row = await this.prisma.department.create({
            data: {
                name: i.name,
                code: i.code ?? null,
                leadEmployeeId: i.leadEmployeeId ?? null
            }
        });
        await this.audit.record({
            action: 'master.created',
            entity: 'Department',
            entityId: row.id,
            meta: {
                name: i.name
            }
        });
        return row;
    }
    async updateDepartment(id, i) {
        await this.assertUnique('department', i.name, id);
        if (i.code && await this.prisma.department.findFirst({
            where: {
                code: i.code,
                id: {
                    not: id
                }
            }
        })) throw (0, _errors.conflict)(`Code ${i.code} is taken`, 'DUPLICATE_CODE');
        const row = await this.prisma.department.update({
            where: {
                id
            },
            data: {
                name: i.name,
                code: i.code ?? null,
                leadEmployeeId: i.leadEmployeeId ?? null
            }
        });
        await this.audit.record({
            action: 'master.updated',
            entity: 'Department',
            entityId: id,
            meta: {
                name: i.name
            }
        });
        return row;
    }
    async designations() {
        const rows = await this.prisma.designation.findMany({
            orderBy: {
                name: 'asc'
            },
            include: {
                _count: {
                    select: {
                        employees: {
                            where: ACTIVE_EMP
                        }
                    }
                }
            }
        });
        return rows.map((r)=>({
                id: r.id,
                name: r.name,
                employees: r._count.employees
            }));
    }
    async createDesignation(i) {
        await this.assertUnique('designation', i.name);
        const row = await this.prisma.designation.create({
            data: {
                name: i.name
            }
        });
        await this.audit.record({
            action: 'master.created',
            entity: 'Designation',
            entityId: row.id,
            meta: {
                name: i.name
            }
        });
        return row;
    }
    async updateDesignation(id, i) {
        await this.assertUnique('designation', i.name, id);
        const row = await this.prisma.designation.update({
            where: {
                id
            },
            data: {
                name: i.name
            }
        });
        await this.audit.record({
            action: 'master.updated',
            entity: 'Designation',
            entityId: id,
            meta: {
                name: i.name
            }
        });
        return row;
    }
    async branches() {
        const rows = await this.prisma.branch.findMany({
            orderBy: {
                name: 'asc'
            },
            include: {
                _count: {
                    select: {
                        employees: {
                            where: ACTIVE_EMP
                        }
                    }
                }
            }
        });
        return rows.map((r)=>({
                id: r.id,
                name: r.name,
                address: r.address,
                employees: r._count.employees
            }));
    }
    async createBranch(i) {
        await this.assertUnique('branch', i.name);
        const row = await this.prisma.branch.create({
            data: {
                name: i.name,
                address: i.address ?? null
            }
        });
        await this.audit.record({
            action: 'master.created',
            entity: 'Branch',
            entityId: row.id,
            meta: {
                name: i.name
            }
        });
        return row;
    }
    async updateBranch(id, i) {
        await this.assertUnique('branch', i.name, id);
        const row = await this.prisma.branch.update({
            where: {
                id
            },
            data: {
                name: i.name,
                address: i.address ?? null
            }
        });
        await this.audit.record({
            action: 'master.updated',
            entity: 'Branch',
            entityId: id,
            meta: {
                name: i.name
            }
        });
        return row;
    }
    /** Delete is blocked while active employees or open jobs reference the record. */ async remove(kind, id) {
        const field = `${kind}Id`;
        const [emps, jobs] = await Promise.all([
            this.prisma.employee.count({
                where: {
                    [field]: id,
                    status: {
                        not: 'EXITED'
                    }
                }
            }),
            kind === 'designation' ? this.prisma.job.count({
                where: {
                    designationId: id,
                    status: {
                        not: 'CLOSED'
                    }
                }
            }) : this.prisma.job.count({
                where: {
                    [field]: id,
                    status: {
                        not: 'CLOSED'
                    }
                }
            })
        ]);
        if (emps || jobs) {
            throw new _errors.AppError(409, 'MASTER_IN_USE', `In use by ${emps ? `${emps} active employee${emps === 1 ? '' : 's'}` : ''}${emps && jobs ? ' and ' : ''}${jobs ? `${jobs} open job${jobs === 1 ? '' : 's'}` : ''}`, {
                activeEmployees: emps,
                openJobs: jobs
            });
        }
        const m = this.prisma[kind];
        try {
            await m.delete({
                where: {
                    id
                }
            });
        } catch  {
            throw (0, _errors.conflict)('This record is referenced by past records and cannot be deleted', 'MASTER_REFERENCED');
        }
        await this.audit.record({
            action: 'master.deleted',
            entity: kind,
            entityId: id
        });
        return {
            ok: true
        };
    }
    // ── Interview rounds & asset categories ─────────────────────────────────
    async rounds() {
        const rows = await this.prisma.interviewRound.findMany({
            where: {
                isActive: true
            },
            orderBy: [
                {
                    order: 'asc'
                },
                {
                    name: 'asc'
                }
            ]
        });
        return rows.map((r)=>({
                id: r.id,
                name: r.name,
                defaultDurationMin: r.defaultDurationMin,
                criteria: r.criteria
            }));
    }
    async createRound(i) {
        if (await this.prisma.interviewRound.findFirst({
            where: {
                name: {
                    equals: i.name,
                    mode: 'insensitive'
                }
            }
        })) throw (0, _errors.conflict)(`“${i.name}” already exists`, 'DUPLICATE_NAME');
        const order = await this.prisma.interviewRound.count();
        const criteria = (i.criteria.length ? i.criteria : [
            'Problem solving',
            'Communication',
            'Culture fit'
        ]).map((label)=>({
                key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                label
            }));
        return this.prisma.interviewRound.create({
            data: {
                name: i.name,
                defaultDurationMin: i.defaultDurationMin,
                criteria,
                order
            }
        });
    }
    async deactivateRound(id) {
        const r = await this.prisma.interviewRound.findUnique({
            where: {
                id
            }
        });
        if (!r) throw (0, _errors.notFound)('Round');
        await this.prisma.interviewRound.update({
            where: {
                id
            },
            data: {
                isActive: false
            }
        });
        return {
            ok: true
        };
    }
    async assetCategories() {
        const rows = await this.prisma.assetCategory.findMany({
            orderBy: {
                name: 'asc'
            },
            include: {
                _count: {
                    select: {
                        assets: {
                            where: {
                                deletedAt: null
                            }
                        }
                    }
                }
            }
        });
        return rows.map((r)=>({
                id: r.id,
                name: r.name,
                requiresSerial: r.requiresSerial,
                assets: r._count.assets
            }));
    }
    async createAssetCategory(i) {
        if (!i.name.trim()) throw (0, _errors.badRequest)('Enter a name');
        if (await this.prisma.assetCategory.findFirst({
            where: {
                name: {
                    equals: i.name,
                    mode: 'insensitive'
                }
            }
        })) throw (0, _errors.conflict)(`“${i.name}” already exists`, 'DUPLICATE_NAME');
        return this.prisma.assetCategory.create({
            data: {
                name: i.name,
                requiresSerial: i.requiresSerial
            }
        });
    }
};
MastersService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], MastersService);

//# sourceMappingURL=masters.service.js.map