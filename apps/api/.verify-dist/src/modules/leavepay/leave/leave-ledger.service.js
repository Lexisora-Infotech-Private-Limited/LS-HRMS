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
    get LeaveLedgerService () {
        return LeaveLedgerService;
    },
    get projectLedger () {
        return projectLedger;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _requestcontext = require("../../../core/context/request-context");
const _dates = require("../common/dates");
const _leavecalc = require("./leave-calc");
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
function projectLedger(entries) {
    const sum = (types)=>(0, _leavecalc.round2)(entries.filter((e)=>types.includes(e.txType)).reduce((s, e)=>s + e.days, 0));
    return {
        opening: sum([
            'OPENING',
            'CARRY_FORWARD_IN'
        ]),
        accrued: sum([
            'ACCRUAL',
            'PRORATED_ACCRUAL'
        ]),
        credited: sum([
            'MANUAL_CREDIT',
            'MANUAL_DEBIT',
            'COMP_OFF_GRANT'
        ]),
        availed: -sum([
            'AVAIL',
            'AVAIL_REVERSAL'
        ]),
        lapsed: -sum([
            'LAPSE',
            'EXPIRY',
            'CARRY_FORWARD_OUT'
        ]),
        encashed: -sum([
            'ENCASHMENT'
        ])
    };
}
let LeaveLedgerService = class LeaveLedgerService {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    async post(entries, tx = this.prisma) {
        if (!entries.length) return;
        const ctx = (0, _requestcontext.getContext)();
        const tenantId = (0, _requestcontext.currentTenantId)();
        await tx.leaveLedgerEntry.createMany({
            data: entries.map((e)=>({
                    tenantId,
                    employeeId: e.employeeId,
                    leaveTypeId: e.leaveTypeId,
                    leaveYear: e.leaveYear,
                    txType: e.txType,
                    days: (0, _leavecalc.round2)(e.days),
                    effectiveDate: (0, _dates.dd)(e.effectiveDate),
                    requestId: e.requestId ?? null,
                    compOffGrantId: e.compOffGrantId ?? null,
                    batchId: e.batchId ?? null,
                    note: e.note ?? null,
                    createdById: ctx?.userId ?? null,
                    createdByName: ctx?.userName ?? 'System'
                }))
        });
        const keys = new Set(entries.map((e)=>`${e.employeeId}|${e.leaveTypeId}|${e.leaveYear}`));
        for (const k of keys){
            const [employeeId, leaveTypeId, year] = k.split('|');
            await this.recompute(employeeId, leaveTypeId, Number(year), tx);
        }
    }
    /** Pending (reserved) paid units of PENDING requests for a type/year, from each request's day breakdown. */ async pendingUnits(employeeId, leaveTypeId, year, tx = this.prisma) {
        const reqs = await tx.leaveRequest.findMany({
            where: {
                employeeId,
                leaveTypeId,
                status: 'PENDING'
            },
            select: {
                dayBreakdown: true
            }
        });
        let s = 0;
        for (const r of reqs){
            for (const d of r.dayBreakdown ?? []){
                if (d.isPaid && Number(d.date.slice(0, 4)) === year) s += d.units;
            }
        }
        return (0, _leavecalc.round2)(s);
    }
    /** Recompute the LeaveBalance row from ledger + pending requests. */ async recompute(employeeId, leaveTypeId, year, tx = this.prisma) {
        const [type, emp, entries, pending] = await Promise.all([
            tx.leaveType.findUniqueOrThrow({
                where: {
                    id: leaveTypeId
                },
                include: {
                    creditRules: {
                        where: {
                            active: true
                        }
                    }
                }
            }),
            tx.employee.findUniqueOrThrow({
                where: {
                    id: employeeId
                },
                select: {
                    joiningDate: true,
                    employmentType: true
                }
            }),
            tx.leaveLedgerEntry.findMany({
                where: {
                    employeeId,
                    leaveTypeId,
                    leaveYear: year
                },
                select: {
                    txType: true,
                    days: true
                }
            }),
            this.pendingUnits(employeeId, leaveTypeId, year, tx)
        ]);
        const parts = {
            ...projectLedger(entries),
            pending
        };
        const available = (0, _leavecalc.availableOf)(parts);
        const rule = type.creditRules.find((r)=>r.employmentType === emp.employmentType);
        const join = emp.joiningDate ? (0, _dates.dk)(emp.joiningDate) : null;
        const scheduled = type.isCompOff ? 0 : rule ? (0, _leavecalc.scheduledAnnual)(rule.frequency, rule.daysPerPeriod, type.annualQuota, join, year) : type.accrualFrequency === 'YEARLY' ? (0, _leavecalc.scheduledAnnual)('YEARLY', 0, type.annualQuota, join, year) : 0;
        const entitlement = (0, _leavecalc.round2)(Math.max(scheduled, parts.accrued) + Math.max(0, parts.credited));
        const data = {
            ...parts,
            available,
            entitlement
        };
        return tx.leaveBalance.upsert({
            where: {
                employeeId_leaveTypeId_year: {
                    employeeId,
                    leaveTypeId,
                    year
                }
            },
            create: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                employeeId,
                leaveTypeId,
                year,
                ...data
            },
            update: {
                ...data,
                version: {
                    increment: 1
                }
            }
        });
    }
    /** Ensure balance rows exist for every applicable type (e.g. a new joiner). */ async ensureBalances(employeeId, year) {
        const emp = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                employmentType: true
            }
        });
        if (!emp) return;
        const types = await this.prisma.leaveType.findMany({
            where: {
                active: true,
                appliesTo: {
                    has: emp.employmentType
                }
            }
        });
        for (const t of types)await this.recompute(employeeId, t.id, year);
    }
};
LeaveLedgerService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], LeaveLedgerService);

//# sourceMappingURL=leave-ledger.service.js.map