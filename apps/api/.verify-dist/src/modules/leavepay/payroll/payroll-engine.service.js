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
    get ADJ_LABEL () {
        return ADJ_LABEL;
    },
    get PayrollEngineService () {
        return PayrollEngineService;
    },
    get adjSigned () {
        return adjSigned;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _requestcontext = require("../../../core/context/request-context");
const _dates = require("../common/dates");
const _calendarservice = require("../common/calendar.service");
const _leavecalc = require("../leave/leave-calc");
const _payrollcalc = require("./payroll-calc");
const _payrolldays = require("./payroll-days");
const _salaryservice = require("./salary.service");
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
const ADJ_SIGN = {
    LOP_REVERSAL: 1,
    IDLE_REVERSAL: 1,
    BONUS: 1,
    REIMBURSEMENT: 1,
    MANUAL_EARNING: 1,
    LOP_RECOVERY: -1,
    IDLE_RECOVERY: -1,
    RECOVERY: -1,
    MANUAL_DEDUCTION: -1
};
const ADJ_LABEL = {
    LOP_REVERSAL: 'LOP reversal',
    IDLE_REVERSAL: 'Idle deduction reversal',
    BONUS: 'Bonus',
    REIMBURSEMENT: 'Reimbursement',
    MANUAL_EARNING: 'Other earning',
    LOP_RECOVERY: 'LOP recovery',
    IDLE_RECOVERY: 'Idle recovery',
    RECOVERY: 'Recovery',
    MANUAL_DEDUCTION: 'Other deduction'
};
const adjSigned = (type, amountPaise)=>(ADJ_SIGN[type] ?? 1) * Math.abs(amountPaise);
let PayrollEngineService = class PayrollEngineService {
    prisma;
    calendar;
    salary;
    constructor(prisma, calendar, salary){
        this.prisma = prisma;
        this.calendar = calendar;
        this.salary = salary;
    }
    async compute(opts) {
        const b = (0, _dates.monthBounds)(opts.period);
        const lock = opts.lockDate;
        const today = opts.today ?? (0, _dates.todayKey)();
        const emps = await this.prisma.employee.findMany({
            where: {
                ...opts.employeeIds ? {
                    id: {
                        in: opts.employeeIds
                    }
                } : {},
                OR: [
                    {
                        status: {
                            in: [
                                'ACTIVE',
                                'NOTICE_PERIOD'
                            ]
                        }
                    },
                    {
                        status: 'EXITED',
                        exitDate: {
                            gte: (0, _dates.dd)(b.start)
                        }
                    }
                ],
                AND: [
                    {
                        OR: [
                            {
                                joiningDate: null
                            },
                            {
                                joiningDate: {
                                    lte: (0, _dates.dd)(lock)
                                }
                            }
                        ]
                    }
                ]
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
        if (!emps.length) return [];
        const ids = emps.map((e)=>e.id);
        const [salaries, calendars, leaveRows, attRows, trackerRows, policies, sheets, adjustments] = await Promise.all([
            this.salary.effectiveOn(ids, b.end),
            this.calendar.forEmployees(ids, b.start, b.end),
            this.prisma.leaveRequestDay.findMany({
                where: {
                    employeeId: {
                        in: ids
                    },
                    active: true,
                    date: {
                        gte: (0, _dates.dd)(b.start),
                        lte: (0, _dates.dd)(b.end)
                    },
                    dayKind: 'WORKING'
                },
                include: {
                    request: {
                        select: {
                            leaveType: {
                                select: {
                                    code: true
                                }
                            }
                        }
                    }
                }
            }),
            this.prisma.attendanceDay.findMany({
                where: {
                    employeeId: {
                        in: ids
                    },
                    date: {
                        gte: (0, _dates.dd)(b.start),
                        lte: (0, _dates.dd)(lock)
                    }
                },
                select: {
                    employeeId: true,
                    date: true,
                    status: true,
                    presentFraction: true,
                    idleDeductibleMinutes: true
                }
            }),
            this.prisma.trackerDaySummary.findMany({
                where: {
                    employeeId: {
                        in: ids
                    },
                    workDate: {
                        gte: (0, _dates.dd)(b.start),
                        lte: (0, _dates.dd)(lock)
                    }
                },
                select: {
                    employeeId: true,
                    idleDeductedSec: true
                }
            }),
            this.prisma.attendancePolicy.findMany(),
            this.prisma.timesheet.findMany({
                where: {
                    weekEnd: {
                        gte: (0, _dates.dd)(b.start)
                    },
                    weekStart: {
                        lte: (0, _dates.dd)(lock)
                    }
                },
                select: {
                    employeeId: true,
                    status: true
                }
            }),
            this.prisma.payrollAdjustment.findMany({
                where: {
                    employeeId: {
                        in: ids
                    },
                    status: 'PENDING',
                    forPeriod: {
                        lte: opts.period
                    },
                    OR: [
                        {
                            targetPeriod: null
                        },
                        {
                            targetPeriod: {
                                lte: opts.period
                            }
                        }
                    ]
                }
            })
        ]);
        // FY-to-date tax figures from finalized regular runs.
        const prior = (0, _dates.fyPriorPeriods)(opts.period);
        const priorRuns = prior.length ? await this.prisma.payrollRun.findMany({
            where: {
                period: {
                    in: prior
                },
                status: {
                    in: [
                        'FINALIZED',
                        'PAID'
                    ]
                },
                runType: 'REGULAR'
            },
            select: {
                id: true,
                period: true
            }
        }) : [];
        const priorItems = priorRuns.length ? await this.prisma.payrollItem.findMany({
            where: {
                runId: {
                    in: priorRuns.map((r)=>r.id)
                },
                employeeId: {
                    in: ids
                },
                status: {
                    in: [
                        'FINALIZED',
                        'PAID'
                    ]
                }
            },
            select: {
                employeeId: true,
                runId: true,
                taxableMonthlyPaise: true,
                tdsPaise: true,
                pfEePaise: true,
                ptPaise: true
            }
        }) : [];
        const runPeriod = new Map(priorRuns.map((r)=>[
                r.id,
                r.period
            ]));
        const out = [];
        for (const e of emps){
            const prof = (0, _salaryservice.resolveProfile)(e.leavepayPayrollProfile, e);
            const cal = calendars.get(e.id);
            const leave = new Map();
            for (const l of leaveRows.filter((x)=>x.employeeId === e.id)){
                const k = (0, _dates.dk)(l.date);
                leave.set(k, [
                    ...leave.get(k) ?? [],
                    {
                        units: l.units,
                        isPaid: l.isPaid,
                        code: l.request.leaveType.code
                    }
                ]);
            }
            const attendance = new Map();
            // Today's (and later) attendance is still in progress — never LOP it; those days count as projected present.
            for (const a of attRows.filter((x)=>x.employeeId === e.id && (0, _dates.dk)(x.date) < today))attendance.set((0, _dates.dk)(a.date), {
                status: a.status,
                presentFraction: a.presentFraction,
                idleDeductibleMinutes: a.idleDeductibleMinutes
            });
            const trackerIdle = Math.round(trackerRows.filter((x)=>x.employeeId === e.id).reduce((s, x)=>s + x.idleDeductedSec, 0) / 60);
            const days = (0, _payrolldays.classifyDays)({
                period: opts.period,
                lockDate: lock,
                joinDate: e.joiningDate ? (0, _dates.dk)(e.joiningDate) : null,
                exitDate: e.exitDate ? (0, _dates.dk)(e.exitDate) : null,
                calendar: cal.calendar,
                leave,
                attendance,
                fallbackIdleMinutes: trackerIdle
            });
            const policy = policies.find((p)=>p.audience === (e.workMode === 'OFFICE' ? 'OFFICE' : 'REMOTE'));
            const deductIdle = opts.includeIdle && (policy?.deductIdleFromPayroll ?? true) && !prof.idleDeductionExempt;
            const allowance = policy?.monthlyIdleAllowanceMinutes ?? 60;
            // Interns keep intern task sheets instead of weekly timesheets (NOT_REQUIRED).
            const gate = (0, _payrolldays.timesheetGate)({
                required: e.employmentType !== 'INTERN',
                statuses: sheets.filter((s)=>s.employeeId === e.id).map((s)=>s.status)
            });
            const sal = salaries.get(e.id);
            const errors = [];
            const structure = sal ? this.salary.earningLines(sal) : [];
            if (!sal) errors.push('No salary structure');
            else if (!structure.length) errors.push('Salary structure could not be read');
            const mine = priorItems.filter((i)=>i.employeeId === e.id);
            const finalizedPeriods = new Set(mine.map((i)=>runPeriod.get(i.runId)));
            const joinKey = e.joiningDate ? (0, _dates.dk)(e.joiningDate) : null;
            const missingPriorMonths = prior.filter((p)=>!finalizedPeriods.has(p) && (!joinKey || joinKey <= (0, _dates.monthBounds)(p).end)).length;
            const adj = adjustments.filter((a)=>a.employeeId === e.id).map((a)=>({
                    id: a.id,
                    type: a.type,
                    label: `${ADJ_LABEL[a.type] ?? a.type}${a.reason ? ` · ${a.reason}` : ''}`.slice(0, 80),
                    amountPaise: adjSigned(a.type, a.amountPaise),
                    taxable: a.taxable,
                    pfApplicable: a.pfApplicable,
                    esiApplicable: a.esiApplicable
                }));
            let result = null;
            if (!errors.length) {
                result = (0, _payrollcalc.calculateItem)({
                    period: opts.period,
                    payType: sal.payType,
                    structure,
                    grossFixedPaise: sal.grossMonthlyPaise,
                    days: {
                        workingDays: days.workingDays,
                        eligibleDays: days.eligibleDays,
                        paidLeaveDays: days.paidLeaveDays,
                        unpaidLeaveDays: days.unpaidLeaveDays,
                        absentDays: days.absentDays,
                        projectedDays: days.projectedDays
                    },
                    idle: {
                        apply: deductIdle,
                        rawMinutes: days.idleMinutes,
                        allowanceMinutes: allowance,
                        shiftNetMinutes: cal.shiftNetMinutes
                    },
                    profile: {
                        pfEnabled: prof.pfEnabled,
                        pfCeilingOpted: prof.pfCeilingOpted,
                        esiMode: prof.esiMode,
                        ptStateCode: prof.ptStateCode,
                        taxRegime: prof.taxRegime,
                        gender: e.gender,
                        declarations: prof.declarations
                    },
                    tax: {
                        ytdMonths: mine.length,
                        missingPriorMonths,
                        ytdTaxablePaise: mine.reduce((s, i)=>s + i.taxableMonthlyPaise, 0),
                        ytdTdsPaise: mine.reduce((s, i)=>s + i.tdsPaise, 0),
                        ytdPfEePaise: mine.reduce((s, i)=>s + i.pfEePaise, 0),
                        ytdPtPaise: mine.reduce((s, i)=>s + i.ptPaise, 0)
                    },
                    adjustments: adj
                });
                errors.push(...result.errors);
            }
            let status = 'READY';
            if (errors.length) status = 'ERROR';
            else if (prof.payrollHold) status = 'ON_HOLD';
            else if (!_payrolldays.GATE_OK.includes(gate)) status = 'TIMESHEET_PENDING';
            out.push({
                employeeId: e.id,
                name: e.fullName,
                code: e.empCode,
                department: e.department?.name ?? null,
                departmentId: e.departmentId,
                employmentType: e.employmentType,
                managerId: e.managerId,
                status,
                timesheetGate: gate,
                payType: sal?.payType ?? prof.payType,
                taxRegime: prof.taxRegime,
                ptStateCode: prof.ptStateCode,
                grossFixedPaise: sal?.grossMonthlyPaise ?? 0,
                days,
                leaveLabel: (0, _leavecalc.leaveSummaryLabel)(days.leaveSummary),
                idleRaw: days.idleMinutes,
                idleAllowance: allowance,
                shiftNetMinutes: cal.shiftNetMinutes,
                result,
                errors,
                holdReason: prof.payrollHold ? prof.holdReason ?? 'On hold' : null,
                adjustmentIds: adj.map((a)=>a.id)
            });
        }
        return out;
    }
    /** Replace a run's items with freshly calculated ones (only rows for the given employees when partial). */ async persist(runId, calcVersion, rows) {
        const tenantId = (0, _requestcontext.currentTenantId)();
        for (const r of rows){
            const c = r.result;
            const data = {
                calcVersion,
                status: r.status,
                timesheetGate: r.timesheetGate,
                payType: r.payType,
                taxRegime: r.taxRegime,
                ptStateCode: r.ptStateCode,
                workingDays: r.days.workingDays,
                eligibleDays: r.days.eligibleDays,
                paidLeaveDays: r.days.paidLeaveDays,
                unpaidLeaveDays: r.days.unpaidLeaveDays,
                absentDays: r.days.absentDays,
                lopDays: c?.lopDays ?? 0,
                paidDays: c?.paidDays ?? 0,
                projectedDays: r.days.projectedDays,
                holidays: r.days.holidays,
                weeklyOffs: r.days.weeklyOffs,
                leaveSummary: r.days.leaveSummary,
                leaveLabel: r.leaveLabel,
                idleMinutesRaw: r.idleRaw,
                idleAllowanceMinutes: r.idleAllowance,
                idleMinutesDeductible: c?.idleMinutesDeductible ?? 0,
                hourlyRatePaise: c?.hourlyRatePaise ?? 0,
                perDayRatePaise: c?.perDayRatePaise ?? 0,
                grossFixedPaise: r.grossFixedPaise,
                grossEarnedPaise: c?.grossEarnedPaise ?? 0,
                lopAmountPaise: c?.lopAmountPaise ?? 0,
                idleDeductionPaise: c?.idleDeductionPaise ?? 0,
                adjustmentsPaise: c?.adjustmentsPaise ?? 0,
                totalEarningsPaise: c?.totalEarningsPaise ?? 0,
                totalDeductionsPaise: c?.totalDeductionsPaise ?? 0,
                employerContribPaise: c?.employerContribPaise ?? 0,
                employerPfPaise: c?.pfErPaise ?? 0,
                pfEePaise: c?.pfEePaise ?? 0,
                esiEePaise: c?.esiEePaise ?? 0,
                ptPaise: c?.ptPaise ?? 0,
                tdsPaise: c?.tdsPaise ?? 0,
                roundingPaise: c?.roundingPaise ?? 0,
                netPaise: c?.netPaise ?? 0,
                taxableMonthlyPaise: c?.taxableMonthlyPaise ?? 0,
                trace: c?.trace ?? [],
                errors: r.errors,
                holdReason: r.holdReason,
                lastCalculatedAt: new Date()
            };
            const item = await this.prisma.payrollItem.upsert({
                where: {
                    runId_employeeId: {
                        runId,
                        employeeId: r.employeeId
                    }
                },
                create: {
                    runId,
                    employeeId: r.employeeId,
                    ...data
                },
                update: data
            });
            await this.prisma.payrollItemLine.deleteMany({
                where: {
                    itemId: item.id
                }
            });
            if (c?.lines.length) {
                await this.prisma.payrollItemLine.createMany({
                    data: c.lines.map((l)=>({
                            tenantId,
                            itemId: item.id,
                            componentCode: l.componentCode,
                            label: l.label,
                            kind: l.kind,
                            fullAmountPaise: l.fullAmountPaise ?? null,
                            amountPaise: l.amountPaise,
                            adjustmentId: l.adjustmentId ?? null,
                            order: l.order
                        }))
                });
            }
        }
    }
    /** Default payment date: the last working day (Mon–Fri) of the period. */ static lastWorkingDay(period) {
        let d = (0, _dates.monthBounds)(period).end;
        while([
            0,
            6
        ].includes((0, _dates.dd)(d).getUTCDay()))d = (0, _dates.addDays)(d, -1);
        return d;
    }
};
PayrollEngineService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _calendarservice.WorkCalendarService === "undefined" ? Object : _calendarservice.WorkCalendarService,
        typeof _salaryservice.SalaryService === "undefined" ? Object : _salaryservice.SalaryService
    ])
], PayrollEngineService);

//# sourceMappingURL=payroll-engine.service.js.map