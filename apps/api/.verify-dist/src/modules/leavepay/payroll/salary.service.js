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
    get SalaryService () {
        return SalaryService;
    },
    get resolveProfile () {
        return resolveProfile;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _requestcontext = require("../../../core/context/request-context");
const _decorators = require("../../../core/auth/decorators");
const _errors = require("../../../core/http/errors");
const _auditservice = require("../../../core/audit/audit.service");
const _cryptoservice = require("../../../core/crypto/crypto.service");
const _dates = require("../common/dates");
const _salary = require("./salary");
const _statutory = require("./statutory");
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
function resolveProfile(p, emp) {
    const intern = emp.employmentType === 'INTERN';
    return {
        payType: p?.payType ?? (intern ? 'STIPEND' : 'SALARY'),
        pfEnabled: p?.pfEnabled ?? !intern,
        pfCeilingOpted: p?.pfCeilingOpted ?? true,
        esiMode: p?.esiMode ?? 'AUTO',
        ptStateCode: p?.ptStateCode ?? (0, _statutory.ptStateFrom)(emp.branch?.name),
        taxRegime: p?.taxRegime ?? emp.taxRegime ?? 'NEW',
        declarations: p?.declarations ?? null,
        payrollHold: p?.payrollHold ?? false,
        holdReason: p?.holdReason ?? null,
        idleDeductionExempt: p?.idleDeductionExempt ?? false,
        paymentMode: p?.paymentMode ?? 'BANK_TRANSFER',
        bankVerified: p?.bankVerified ?? true
    };
}
let SalaryService = class SalaryService {
    prisma;
    crypto;
    audit;
    constructor(prisma, crypto, audit){
        this.prisma = prisma;
        this.crypto = crypto;
        this.audit = audit;
    }
    structureOf(row) {
        try {
            return this.crypto.decryptJson(row.structureEnc) ?? [];
        } catch  {
            return [];
        }
    }
    /** Earning components only (Basic/HRA/Special or Stipend) — the payroll proration base. */ earningLines(row) {
        return this.structureOf(row).filter((l)=>![
                'PF_ER',
                'ESI_ER',
                'CTC'
            ].includes(l.code));
    }
    /** Salary effective on a date (latest non-cancelled revision with effectiveFrom ≤ date). */ async effectiveOn(employeeIds, date) {
        const rows = await this.prisma.employeeSalary.findMany({
            where: {
                employeeId: {
                    in: employeeIds
                },
                effectiveFrom: {
                    lte: (0, _dates.dd)(date)
                },
                status: {
                    not: 'CANCELLED'
                }
            },
            orderBy: {
                effectiveFrom: 'desc'
            }
        });
        const out = new Map();
        for (const r of rows)if (!out.has(r.employeeId)) out.set(r.employeeId, r);
        return out;
    }
    async assertCanView(employeeId) {
        const ctx = (0, _requestcontext.requireContext)();
        if (ctx.employeeId === employeeId) return;
        if ((0, _decorators.hasPerm)(ctx, 'employees.compensation') || (0, _decorators.hasPerm)(ctx, 'payroll.manage')) return;
        throw (0, _errors.forbidden)("You don't have access to this employee's compensation");
    }
    async view(employeeId) {
        await this.assertCanView(employeeId);
        const ctx = (0, _requestcontext.requireContext)();
        const emp = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            include: {
                branch: true,
                leavepayPayrollProfile: true
            }
        });
        if (!emp) throw (0, _errors.notFound)('Employee');
        const revs = await this.prisma.employeeSalary.findMany({
            where: {
                employeeId
            },
            orderBy: {
                effectiveFrom: 'desc'
            }
        });
        const today = (0, _dates.todayKey)();
        const current = revs.find((r)=>(0, _dates.dk)(r.effectiveFrom) <= today && r.status !== 'CANCELLED') ?? revs[revs.length - 1] ?? null;
        const prof = resolveProfile(emp.leavepayPayrollProfile, emp);
        const lines = current ? this.structureOf(current) : [];
        const rows = lines.length ? [
            ...lines.filter((l)=>l.code !== 'CTC'),
            {
                code: 'CTC',
                label: 'CTC',
                monthlyPaise: Math.round(current.ctcAnnualPaise / 12),
                annualPaise: current.ctcAnnualPaise
            }
        ] : [];
        if (ctx.employeeId !== employeeId) await this.audit.record({
            action: 'salary.viewed',
            entity: 'Employee',
            entityId: employeeId
        });
        let panMasked = null;
        try {
            const pan = this.crypto.decrypt(emp.panEnc);
            panMasked = pan ? `••••${pan.slice(-4)}` : null;
        } catch  {
            panMasked = null;
        }
        return {
            employeeId,
            employeeName: emp.fullName,
            payType: current?.payType ?? prof.payType,
            effectiveFrom: current ? (0, _dates.dk)(current.effectiveFrom) : null,
            ctcAnnualPaise: current?.ctcAnnualPaise ?? 0,
            grossMonthlyPaise: current?.grossMonthlyPaise ?? 0,
            rows,
            revisions: revs.map((r)=>({
                    id: r.id,
                    effectiveFrom: (0, _dates.dk)(r.effectiveFrom),
                    ctcAnnualPaise: r.ctcAnnualPaise,
                    grossMonthlyPaise: r.grossMonthlyPaise,
                    reason: r.reason,
                    by: r.createdByName,
                    status: r.status
                })),
            statutory: {
                uan: emp.uan,
                pfEnabled: prof.pfEnabled,
                pfCeilingOpted: prof.pfCeilingOpted,
                esiCovered: current ? prof.payType === 'SALARY' && (0, _statutory.esiCovered)(current.grossMonthlyPaise, prof.esiMode) : false,
                ptState: prof.ptStateCode,
                taxRegime: prof.taxRegime,
                panMasked
            },
            bank: {
                accountMasked: emp.bankAccountLast4 ? `XXXX XXXX ${emp.bankAccountLast4}` : null,
                ifsc: emp.bankIfsc,
                bankName: emp.bankName,
                verified: prof.bankVerified
            },
            profile: {
                payrollHold: prof.payrollHold,
                holdReason: prof.holdReason,
                idleDeductionExempt: prof.idleDeductionExempt,
                esiMode: prof.esiMode,
                paymentMode: prof.paymentMode
            },
            canEdit: (0, _decorators.hasPerm)(ctx, 'payroll.manage')
        };
    }
    async list() {
        const emps = await this.prisma.employee.findMany({
            where: {
                status: {
                    not: 'EXITED'
                }
            },
            include: {
                department: true,
                branch: true,
                leavepayPayrollProfile: true
            },
            orderBy: {
                fullName: 'asc'
            }
        });
        const sal = await this.effectiveOn(emps.map((e)=>e.id), '2999-12-31');
        const today = (0, _dates.todayKey)();
        const current = await this.effectiveOn(emps.map((e)=>e.id), today);
        return emps.map((e)=>{
            const s = current.get(e.id) ?? sal.get(e.id);
            const p = resolveProfile(e.leavepayPayrollProfile, e);
            return {
                employeeId: e.id,
                name: e.fullName,
                code: e.empCode,
                department: e.department?.name ?? null,
                employmentType: e.employmentType,
                payType: s?.payType ?? p.payType,
                ctcAnnualPaise: s?.ctcAnnualPaise ?? 0,
                grossMonthlyPaise: s?.grossMonthlyPaise ?? 0,
                effectiveFrom: s ? (0, _dates.dk)(s.effectiveFrom) : null,
                taxRegime: p.taxRegime,
                hold: p.payrollHold
            };
        });
    }
    preview(input) {
        const s = (0, _salary.buildStructure)({
            grossMonthlyPaise: input.grossMonthlyPaise,
            ctcAnnualPaise: input.ctcAnnualPaise
        }, {
            payType: input.payType,
            pfCeilingOpted: input.pfCeilingOpted
        });
        return {
            grossMonthlyPaise: s.grossMonthlyPaise,
            ctcAnnualPaise: s.ctcAnnualPaise,
            ctcMonthlyPaise: s.ctcMonthlyPaise,
            rows: s.table,
            warnings: s.warnings
        };
    }
    async revise(employeeId, input) {
        const ctx = (0, _requestcontext.requireContext)();
        const emp = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            include: {
                leavepayPayrollProfile: true,
                branch: true
            }
        });
        if (!emp) throw (0, _errors.notFound)('Employee');
        const prof = resolveProfile(emp.leavepayPayrollProfile, emp);
        const s = (0, _salary.buildStructure)(input.mode === 'CTC' ? {
            ctcAnnualPaise: input.amountPaise
        } : {
            grossMonthlyPaise: input.amountPaise
        }, {
            payType: input.payType,
            pfEnabled: prof.pfEnabled,
            pfCeilingOpted: prof.pfCeilingOpted,
            esiMode: prof.esiMode
        });
        if (s.grossMonthlyPaise <= 0) throw (0, _errors.badRequest)('Enter a valid amount');
        const data = {
            ctcAnnualPaise: s.ctcAnnualPaise,
            grossMonthlyPaise: s.grossMonthlyPaise,
            structureEnc: this.crypto.encryptJson(s.lines),
            payType: input.payType,
            reason: input.reason,
            note: input.note ?? null,
            createdByName: ctx.userName ?? 'HR',
            status: 'ACTIVE'
        };
        const row = await this.prisma.employeeSalary.upsert({
            where: {
                employeeId_effectiveFrom: {
                    employeeId,
                    effectiveFrom: (0, _dates.dd)(input.effectiveFrom)
                }
            },
            create: {
                employeeId,
                effectiveFrom: (0, _dates.dd)(input.effectiveFrom),
                ...data
            },
            update: data
        });
        await this.prisma.employeeSalary.updateMany({
            where: {
                employeeId,
                id: {
                    not: row.id
                },
                effectiveFrom: {
                    lt: (0, _dates.dd)(input.effectiveFrom)
                },
                status: 'ACTIVE'
            },
            data: {
                status: 'SUPERSEDED'
            }
        });
        if (!emp.leavepayPayrollProfile) await this.prisma.employeePayrollProfile.create({
            data: {
                employeeId,
                payType: input.payType,
                pfEnabled: input.payType === 'SALARY'
            }
        });
        else if (emp.leavepayPayrollProfile.payType !== input.payType) await this.prisma.employeePayrollProfile.update({
            where: {
                employeeId
            },
            data: {
                payType: input.payType
            }
        });
        // Calculated (not finalized) runs covering the new salary need a re-run.
        const runs = await this.prisma.payrollRun.findMany({
            where: {
                status: 'CALCULATED',
                period: {
                    gte: (0, _dates.periodOf)(input.effectiveFrom)
                }
            },
            select: {
                id: true
            }
        });
        if (runs.length) await this.prisma.payrollItem.updateMany({
            where: {
                runId: {
                    in: runs.map((r)=>r.id)
                },
                employeeId,
                status: {
                    not: 'EXCLUDED'
                }
            },
            data: {
                status: 'STALE'
            }
        });
        await this.audit.record({
            action: 'salary.revision.created',
            entity: 'EmployeeSalary',
            entityId: row.id,
            meta: {
                employeeId,
                effectiveFrom: input.effectiveFrom,
                reason: input.reason
            }
        });
        return this.view(employeeId);
    }
    async updateProfile(employeeId, input) {
        const emp = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                id: true
            }
        });
        if (!emp) throw (0, _errors.notFound)('Employee');
        const data = {};
        for (const [k, v] of Object.entries(input))if (v !== undefined) data[k] = v;
        await this.prisma.employeePayrollProfile.upsert({
            where: {
                employeeId
            },
            create: {
                employeeId,
                ...data
            },
            update: data
        });
        await this.audit.record({
            action: 'payroll.profile.updated',
            entity: 'EmployeePayrollProfile',
            entityId: employeeId,
            meta: {
                fields: Object.keys(data)
            }
        });
        return this.view(employeeId);
    }
};
SalaryService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _cryptoservice.CryptoService === "undefined" ? Object : _cryptoservice.CryptoService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], SalaryService);

//# sourceMappingURL=salary.service.js.map