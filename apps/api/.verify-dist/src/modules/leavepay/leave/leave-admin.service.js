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
    get LeaveAdminService () {
        return LeaveAdminService;
    },
    get appliesToLabel () {
        return appliesToLabel;
    },
    get creditDaysFor () {
        return creditDaysFor;
    },
    get currentPeriodKey () {
        return currentPeriodKey;
    },
    get parseCarryForward () {
        return parseCarryForward;
    },
    get toLeaveTypeRow () {
        return toLeaveTypeRow;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _requestcontext = require("../../../core/context/request-context");
const _decorators = require("../../../core/auth/decorators");
const _errors = require("../../../core/http/errors");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _settingsservice = require("../../../core/settings/settings.service");
const _orgservice = require("../../../core/org/org.service");
const _dates = require("../common/dates");
const _calendarservice = require("../common/calendar.service");
const _leavecalc = require("./leave-calc");
const _leaveledgerservice = require("./leave-ledger.service");
const _leavecommon = require("./leave.common");
const _leaverequestsservice = require("./leave-requests.service");
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
const FREQ_LABEL = {
    YEARLY: 'Yearly',
    MONTHLY: 'Monthly',
    QUARTERLY: 'Quarterly'
};
const ELIGIBLE_STATUSES = [
    'ACTIVE',
    'NOTICE_PERIOD',
    'ONBOARDING'
];
function parseCarryForward(v) {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v === 'number') return v > 0 ? v : null;
    const s = v.trim().toLowerCase();
    if (!s || s === 'no' || s === 'none' || s === '0') return null;
    const m = s.match(/(\d+(\.\d+)?)/);
    return m ? Number(m[1]) : null;
}
function appliesToLabel(list) {
    return list.map((x)=>_shared.EMPLOYMENT_TYPE_LABEL[x] ?? x).join(', ');
}
function toLeaveTypeRow(t, hasLedger = false) {
    const onApproval = t.isCompOff || t.accrualFrequency === 'ON_APPROVAL';
    return {
        id: t.id,
        code: t.code,
        name: t.name,
        annualQuota: t.annualQuota,
        quotaLabel: onApproval ? 'On approval' : t.hidden && !t.annualQuota ? '—' : (0, _leavecalc.fmtDays)(t.annualQuota),
        carryForwardLabel: t.isCompOff ? `${t.expiryDays ?? 60} days` : !t.carryForwardMax ? 'No' : `Up to ${(0, _leavecalc.fmtDays)(t.carryForwardMax)}`,
        encashable: t.encashable,
        appliesTo: t.appliesTo,
        appliesToLabel: appliesToLabel(t.appliesTo),
        accrualFrequency: t.accrualFrequency,
        isPaid: t.isPaid,
        isCompOff: t.isCompOff,
        allowHalfDay: t.allowHalfDay,
        sandwichWeeklyOffs: t.sandwichWeeklyOffs,
        sandwichHolidays: t.sandwichHolidays,
        minNoticeDays: t.minNoticeDays,
        noticeEnforcement: t.noticeEnforcement,
        backdateLimitDays: t.backdateLimitDays,
        maxConsecutiveDays: t.maxConsecutiveDays,
        expiryDays: t.expiryDays,
        documentRequiredAfterDays: t.documentRequiredAfterDays,
        carryForwardMax: t.carryForwardMax,
        hidden: t.hidden,
        active: t.active,
        hasLedger
    };
}
/** Period key → months of `year` it credits, and a label. */ function periodInfo(freq, periodKey) {
    const year = Number(periodKey.slice(0, 4));
    if (freq === 'YEARLY') return {
        year,
        month: 1,
        label: String(year),
        start: `${year}-01-01`,
        end: `${year}-12-31`
    };
    const month = Number(periodKey.slice(5, 7));
    const b = (0, _dates.monthBounds)(periodKey.slice(0, 7));
    return {
        year,
        month,
        label: `${_dates.MONTHS_SHORT[month - 1]} ${year}`,
        start: b.start,
        end: freq === 'QUARTERLY' ? (0, _dates.monthBounds)(`${year}-${String(Math.min(12, month + 2)).padStart(2, '0')}`).end : b.end
    };
}
function currentPeriodKey(freq, today) {
    if (freq === 'YEARLY') return today.slice(0, 4);
    if (freq === 'QUARTERLY') {
        const m = Number(today.slice(5, 7));
        const q = Math.floor((m - 1) / 3) * 3 + 1;
        return `${today.slice(0, 4)}-${String(q).padStart(2, '0')}`;
    }
    return today.slice(0, 7);
}
function creditDaysFor(rule, periodKey, joinDate) {
    const { year, month } = periodInfo(rule.frequency, periodKey);
    if (rule.frequency === 'YEARLY') return rule.prorateOnJoin ? (0, _leavecalc.prorateYearly)(rule.daysPerPeriod, joinDate, year) : joinDate && (0, _dates.yearOf)(joinDate) > year ? 0 : rule.daysPerPeriod;
    const months = (0, _leavecalc.monthlyCreditMonths)(rule.prorateOnJoin ? joinDate : joinDate && (0, _dates.yearOf)(joinDate) === year ? `${year}-${joinDate.slice(5, 7)}-01` : joinDate, year);
    if (rule.frequency === 'MONTHLY') return months.includes(month) ? rule.daysPerPeriod : 0;
    // QUARTERLY: credited if any month of the quarter is a credit month.
    return [
        month,
        month + 1,
        month + 2
    ].some((m)=>months.includes(m)) ? rule.daysPerPeriod : 0;
}
let LeaveAdminService = class LeaveAdminService {
    prisma;
    ledger;
    requests;
    calendar;
    audit;
    notifications;
    settings;
    org;
    log = new _common.Logger('LeaveAdmin');
    constructor(prisma, ledger, requests, calendar, audit, notifications, settings, org){
        this.prisma = prisma;
        this.ledger = ledger;
        this.requests = requests;
        this.calendar = calendar;
        this.audit = audit;
        this.notifications = notifications;
        this.settings = settings;
        this.org = org;
    }
    assertHr() {
        if (!(0, _decorators.hasPerm)((0, _requestcontext.requireContext)(), 'leave.manage')) throw (0, _errors.forbidden)();
    }
    // ── leave types ───────────────────────────────────────────────────────
    /** HR sees every type (incl. inactive and HR-only); employees see active, visible types. */ async types(includeInactive = true) {
        const rows = await this.prisma.leaveType.findMany({
            where: includeInactive ? {} : {
                active: true,
                hidden: false
            },
            orderBy: [
                {
                    displayOrder: 'asc'
                },
                {
                    name: 'asc'
                }
            ]
        });
        const used = await this.prisma.leaveLedgerEntry.groupBy({
            by: [
                'leaveTypeId'
            ],
            _count: {
                _all: true
            }
        });
        const set = new Set(used.map((u)=>u.leaveTypeId));
        return rows.map((t)=>toLeaveTypeRow(t, set.has(t.id)));
    }
    async uniqueCode(name, wanted) {
        let base = (wanted || name.split(/\s+/).filter(Boolean).map((w)=>w[0]).join('')).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
        if (base.length < 2) base = (name.replace(/[^A-Za-z]/g, '').slice(0, 2) || 'LV').toUpperCase();
        let code = base;
        for(let i = 2; await this.prisma.leaveType.findFirst({
            where: {
                code
            }
        }); i++){
            if (wanted) throw (0, _errors.badRequest)(`Code ${wanted} is already used`, 'DUPLICATE');
            code = `${base.slice(0, 4)}${String.fromCharCode(64 + i)}`;
        }
        return code;
    }
    async createType(input) {
        this.assertHr();
        if (await this.prisma.leaveType.findFirst({
            where: {
                name: {
                    equals: input.name,
                    mode: 'insensitive'
                }
            }
        })) throw (0, _errors.badRequest)('A leave type with this name already exists', 'DUPLICATE');
        const code = await this.uniqueCode(input.name, input.code);
        const isCompOff = input.accrualFrequency === 'ON_APPROVAL';
        const max = await this.prisma.leaveType.aggregate({
            _max: {
                displayOrder: true
            }
        });
        const t = await this.prisma.leaveType.create({
            data: {
                code,
                name: input.name,
                shortLabel: code,
                displayOrder: (max._max.displayOrder ?? 0) + 1,
                annualQuota: input.annualQuota,
                accrualFrequency: input.accrualFrequency,
                carryForwardMax: parseCarryForward(input.carryForward) ?? null,
                encashable: input.encashable,
                appliesTo: input.appliesTo,
                isPaid: input.isPaid,
                isCompOff,
                expiryDays: isCompOff ? input.expiryDays ?? 60 : input.expiryDays ?? null,
                allowHalfDay: input.allowHalfDay,
                sandwichWeeklyOffs: input.sandwichWeeklyOffs,
                sandwichHolidays: input.sandwichHolidays,
                minNoticeDays: input.minNoticeDays,
                noticeEnforcement: input.noticeEnforcement,
                backdateLimitDays: input.backdateLimitDays,
                maxConsecutiveDays: input.maxConsecutiveDays ?? null,
                documentRequiredAfterDays: input.documentRequiredAfterDays ?? null
            }
        });
        // A YEARLY/MONTHLY type gets a default credit rule per applicable employment type.
        if ([
            'YEARLY',
            'MONTHLY',
            'QUARTERLY'
        ].includes(input.accrualFrequency) && input.annualQuota > 0) {
            const per = input.accrualFrequency === 'MONTHLY' ? (0, _leavecalc.round2)(input.annualQuota / 12) : input.accrualFrequency === 'QUARTERLY' ? (0, _leavecalc.round2)(input.annualQuota / 4) : input.annualQuota;
            for (const et of input.appliesTo){
                await this.prisma.leaveCreditRule.create({
                    data: {
                        leaveTypeId: t.id,
                        employmentType: et,
                        frequency: input.accrualFrequency,
                        daysPerPeriod: per,
                        effectiveFrom: (0, _dates.dd)(`${(0, _dates.yearOf)((0, _dates.todayKey)())}-01-01`)
                    }
                });
            }
        }
        await this.audit.record({
            action: 'leave.type.created',
            entity: 'LeaveType',
            entityId: t.id,
            meta: {
                name: t.name,
                code
            }
        });
        return toLeaveTypeRow(t);
    }
    async updateType(id, input) {
        this.assertHr();
        const t = await this.prisma.leaveType.findUnique({
            where: {
                id
            }
        });
        if (!t) throw (0, _errors.notFound)('Leave type');
        const data = {};
        const keys = [
            'name',
            'annualQuota',
            'accrualFrequency',
            'encashable',
            'appliesTo',
            'isPaid',
            'allowHalfDay',
            'sandwichWeeklyOffs',
            'sandwichHolidays',
            'minNoticeDays',
            'noticeEnforcement',
            'backdateLimitDays',
            'maxConsecutiveDays',
            'expiryDays',
            'documentRequiredAfterDays',
            'active'
        ];
        for (const k of keys)if (input[k] !== undefined) data[k] = input[k];
        const cf = parseCarryForward(input.carryForward);
        if (cf !== undefined) data.carryForwardMax = cf;
        const saved = await this.prisma.leaveType.update({
            where: {
                id
            },
            data
        });
        await this.audit.record({
            action: input.active === false ? 'leave.type.deactivated' : 'leave.type.updated',
            entity: 'LeaveType',
            entityId: id,
            meta: {
                changes: Object.keys(data)
            }
        });
        return toLeaveTypeRow(saved);
    }
    async deleteType(id) {
        this.assertHr();
        const used = await this.prisma.leaveLedgerEntry.count({
            where: {
                leaveTypeId: id
            }
        });
        const reqs = await this.prisma.leaveRequest.count({
            where: {
                leaveTypeId: id
            }
        });
        if (used || reqs) throw new _errors.AppError(409, 'LEAVE_TYPE_IN_USE', 'This leave type has balances or requests; deactivate it instead');
        await this.prisma.leaveCreditRule.deleteMany({
            where: {
                leaveTypeId: id
            }
        });
        await this.prisma.leaveBalance.deleteMany({
            where: {
                leaveTypeId: id
            }
        });
        await this.prisma.leaveType.delete({
            where: {
                id
            }
        });
        await this.audit.record({
            action: 'leave.type.deleted',
            entity: 'LeaveType',
            entityId: id
        });
        return {
            ok: true
        };
    }
    // ── credit rules / batches ────────────────────────────────────────────
    async rules() {
        const rules = await this.prisma.leaveCreditRule.findMany({
            include: {
                leaveType: true
            },
            orderBy: [
                {
                    leaveType: {
                        displayOrder: 'asc'
                    }
                },
                {
                    employmentType: 'asc'
                }
            ]
        });
        const today = (0, _dates.todayKey)();
        return rules.map((r)=>{
            const cur = currentPeriodKey(r.frequency, today);
            const due = r.lastPeriodKey === cur ? r.frequency === 'YEARLY' ? String(Number(cur) + 1) : r.frequency === 'QUARTERLY' ? (0, _dates.nextPeriod)((0, _dates.nextPeriod)((0, _dates.nextPeriod)(cur))) : (0, _dates.nextPeriod)(cur) : cur;
            const nextRun = r.frequency === 'YEARLY' ? `1 Jan ${due.slice(0, 4)}` : `${r.creditDay} ${_dates.MONTHS_SHORT[Number(due.slice(5, 7)) - 1]} ${due.slice(0, 4)}`;
            return {
                id: r.id,
                leaveTypeId: r.leaveTypeId,
                leaveType: r.leaveType.name,
                employmentType: r.employmentType,
                appliesTo: _shared.EMPLOYMENT_TYPE_LABEL[r.employmentType] ?? r.employmentType,
                frequency: r.frequency,
                frequencyLabel: FREQ_LABEL[r.frequency] ?? r.frequency,
                daysPerPeriod: r.daysPerPeriod,
                prorateOnJoin: r.prorateOnJoin,
                lastRun: r.lastRunAt?.toISOString() ?? null,
                lastRunStatus: r.lastRunStatus,
                nextRun,
                nextPeriodKey: due,
                active: r.active
            };
        });
    }
    async saveRule(input, id) {
        this.assertHr();
        const data = {
            leaveTypeId: input.leaveTypeId,
            employmentType: input.employmentType,
            frequency: input.frequency,
            daysPerPeriod: input.daysPerPeriod,
            creditDay: input.creditDay,
            prorateOnJoin: input.prorateOnJoin,
            effectiveFrom: (0, _dates.dd)(input.effectiveFrom),
            active: input.active
        };
        const rule = id ? await this.prisma.leaveCreditRule.update({
            where: {
                id
            },
            data
        }) : await this.prisma.leaveCreditRule.create({
            data: data
        });
        await this.audit.record({
            action: id ? 'leave.rule.updated' : 'leave.rule.created',
            entity: 'LeaveCreditRule',
            entityId: rule.id,
            meta: {
                frequency: input.frequency,
                days: input.daysPerPeriod
            }
        });
        return rule;
    }
    async batches() {
        const rows = await this.prisma.leaveCreditBatch.findMany({
            orderBy: {
                startedAt: 'desc'
            },
            take: 30
        });
        const types = new Map((await this.prisma.leaveType.findMany()).map((t)=>[
                t.id,
                t.name
            ]));
        return rows.map((b)=>({
                id: b.id,
                type: b.type,
                leaveType: b.leaveTypeId ? types.get(b.leaveTypeId) ?? null : null,
                periodKey: b.periodKey,
                status: b.status,
                employeeCount: b.employeeCount,
                totalDays: b.totalDays,
                startedAt: b.startedAt.toISOString(),
                note: b.note
            }));
    }
    /**
   * Run a credit rule for a period (idempotent per rule period): each eligible employee gets an
   * ACCRUAL (or PRORATED_ACCRUAL) ledger row tied to the batch.
   */ async runRule(ruleId, periodKey, opts = {}) {
        const rule = await this.prisma.leaveCreditRule.findUnique({
            where: {
                id: ruleId
            },
            include: {
                leaveType: true
            }
        });
        if (!rule) throw (0, _errors.notFound)('Credit rule');
        if (!rule.active || !rule.leaveType.active) throw (0, _errors.badRequest)('This rule is inactive');
        const key = periodKey ?? currentPeriodKey(rule.frequency, (0, _dates.todayKey)());
        const info = periodInfo(rule.frequency, key);
        const batchType = rule.frequency === 'YEARLY' ? 'ANNUAL' : rule.frequency === 'QUARTERLY' ? 'QUARTERLY' : 'MONTHLY';
        const batchKey = opts.employeeIds ? `basic:${key}:${Date.now()}` : `${key}:${rule.employmentType}`;
        if (!opts.employeeIds) {
            const existing = await this.prisma.leaveCreditBatch.findFirst({
                where: {
                    type: batchType,
                    leaveTypeId: rule.leaveTypeId,
                    periodKey: batchKey,
                    status: 'COMPLETED'
                }
            });
            if (existing) throw new _errors.AppError(409, 'ALREADY_CREDITED', `${rule.leaveType.name} is already credited for ${info.label}`);
            await this.prisma.leaveCreditBatch.deleteMany({
                where: {
                    type: batchType,
                    leaveTypeId: rule.leaveTypeId,
                    periodKey: batchKey
                }
            });
        }
        const ctx = (0, _requestcontext.requireContext)();
        const batch = await this.prisma.leaveCreditBatch.create({
            data: {
                type: batchType,
                leaveTypeId: rule.leaveTypeId,
                ruleId: rule.id,
                periodKey: batchKey,
                leaveYear: info.year,
                status: 'RUNNING',
                triggeredById: ctx.userId ?? null,
                note: opts.manual ? 'Run manually' : 'Scheduled'
            }
        });
        try {
            const emps = await this.prisma.employee.findMany({
                where: {
                    status: {
                        in: [
                            ...ELIGIBLE_STATUSES
                        ]
                    },
                    employmentType: rule.employmentType,
                    ...opts.employeeIds ? {
                        id: {
                            in: opts.employeeIds
                        }
                    } : {},
                    OR: [
                        {
                            joiningDate: null
                        },
                        {
                            joiningDate: {
                                lte: (0, _dates.dd)(info.end)
                            }
                        }
                    ]
                },
                select: {
                    id: true,
                    joiningDate: true
                }
            });
            const entries = [];
            for (const e of emps){
                const join = e.joiningDate ? (0, _dates.dk)(e.joiningDate) : null;
                const days = creditDaysFor(rule, key, join);
                if (days <= 0) continue;
                if (opts.employeeIds) {
                    // "Basic (annual)" from the credit form: skip employees already credited for this period.
                    const dup = await this.prisma.leaveLedgerEntry.count({
                        where: {
                            employeeId: e.id,
                            leaveTypeId: rule.leaveTypeId,
                            txType: {
                                in: [
                                    'ACCRUAL',
                                    'PRORATED_ACCRUAL'
                                ]
                            },
                            effectiveDate: {
                                gte: (0, _dates.dd)(info.start),
                                lte: (0, _dates.dd)(info.end)
                            }
                        }
                    });
                    if (dup) continue;
                }
                const full = rule.frequency === 'YEARLY' ? rule.daysPerPeriod : days;
                entries.push({
                    employeeId: e.id,
                    leaveTypeId: rule.leaveTypeId,
                    leaveYear: info.year,
                    txType: days < full ? 'PRORATED_ACCRUAL' : 'ACCRUAL',
                    days,
                    effectiveDate: info.start,
                    batchId: batch.id,
                    note: `${FREQ_LABEL[rule.frequency]} credit · ${info.label}`
                });
            }
            await this.ledger.post(entries);
            const total = (0, _leavecalc.round2)(entries.reduce((s, x)=>s + x.days, 0));
            await this.prisma.leaveCreditBatch.update({
                where: {
                    id: batch.id
                },
                data: {
                    status: 'COMPLETED',
                    employeeCount: entries.length,
                    totalDays: total,
                    completedAt: new Date()
                }
            });
            if (!opts.employeeIds) await this.prisma.leaveCreditRule.update({
                where: {
                    id: rule.id
                },
                data: {
                    lastRunAt: new Date(),
                    lastPeriodKey: key,
                    lastRunStatus: 'COMPLETED'
                }
            });
            await this.audit.record({
                action: 'leave.credit.run',
                entity: 'LeaveCreditBatch',
                entityId: batch.id,
                meta: {
                    rule: rule.id,
                    period: key,
                    employees: entries.length,
                    days: total
                }
            });
            return {
                batchId: batch.id,
                employees: entries.length,
                totalDays: total,
                label: info.label,
                leaveType: rule.leaveType.name
            };
        } catch (e) {
            await this.prisma.leaveCreditBatch.update({
                where: {
                    id: batch.id
                },
                data: {
                    status: 'FAILED',
                    error: e.message,
                    completedAt: new Date()
                }
            });
            await this.prisma.leaveCreditRule.update({
                where: {
                    id: rule.id
                },
                data: {
                    lastRunAt: new Date(),
                    lastRunStatus: 'FAILED'
                }
            });
            throw e;
        }
    }
    /** Scheduled: every active rule whose period is due (called by the monthly cron inside a tenant context). */ async runDueRules(today = (0, _dates.todayKey)()) {
        const rules = await this.prisma.leaveCreditRule.findMany({
            where: {
                active: true,
                leaveType: {
                    active: true
                }
            }
        });
        for (const r of rules){
            const key = currentPeriodKey(r.frequency, today);
            if (r.lastPeriodKey === key) continue;
            if (r.frequency === 'QUARTERLY' && key.slice(5, 7) !== today.slice(5, 7)) continue;
            try {
                await this.runRule(r.id, key);
            } catch (e) {
                if (e.getStatus?.() !== 409) this.log.warn(`Credit rule ${r.id} failed: ${e.message}`);
            }
        }
    }
    // ── manual credit ─────────────────────────────────────────────────────
    async manualCredit(input) {
        this.assertHr();
        const type = await this.prisma.leaveType.findUnique({
            where: {
                id: input.leaveTypeId
            }
        });
        if (!type) throw (0, _errors.notFound)('Leave type');
        const today = (0, _dates.todayKey)();
        if (input.creditType === 'BASIC') {
            if (type.isCompOff) throw (0, _errors.badRequest)('Comp-off has no basic credit rule; use Manual credit');
            const emps = await this.prisma.employee.findMany({
                where: {
                    id: {
                        in: input.employeeIds
                    }
                },
                select: {
                    employmentType: true
                }
            });
            const rules = await this.prisma.leaveCreditRule.findMany({
                where: {
                    leaveTypeId: type.id,
                    active: true,
                    employmentType: {
                        in: [
                            ...new Set(emps.map((e)=>e.employmentType))
                        ]
                    }
                }
            });
            if (!rules.length) throw (0, _errors.badRequest)(`${type.name} has no active credit rule for these employees`);
            let employees = 0;
            let days = 0;
            for (const r of rules){
                const res = await this.runRule(r.id, currentPeriodKey(r.frequency, today), {
                    employeeIds: input.employeeIds,
                    manual: true
                });
                employees += res.employees;
                days += res.totalDays;
            }
            return {
                employees,
                days: (0, _leavecalc.round2)(days),
                message: `Credited ${(0, _leavecalc.fmtDays)((0, _leavecalc.round2)(days))} days to ${employees} ${employees === 1 ? 'employee' : 'employees'}`
            };
        }
        const days = input.days;
        const ctx = (0, _requestcontext.requireContext)();
        const batch = await this.prisma.leaveCreditBatch.create({
            data: {
                type: 'MANUAL',
                leaveTypeId: type.id,
                periodKey: `manual:${Date.now()}`,
                leaveYear: (0, _dates.yearOf)(today),
                status: 'RUNNING',
                triggeredById: ctx.userId ?? null,
                note: input.note
            }
        });
        const entries = [];
        for (const employeeId of input.employeeIds){
            if (type.isCompOff) {
                if (days <= 0) throw (0, _errors.badRequest)('Comp-off credits must be positive');
                const worked = input.workedDate ?? today;
                const grant = await this.prisma.compOffGrant.create({
                    data: {
                        employeeId,
                        workedDate: (0, _dates.dd)(worked),
                        units: days,
                        remaining: days,
                        expiresOn: (0, _dates.dd)((0, _dates.addDays)(worked, type.expiryDays ?? 60)),
                        status: 'APPROVED',
                        source: 'MANUAL',
                        reason: input.note,
                        decidedByName: ctx.userName ?? 'HR',
                        decidedAt: new Date()
                    }
                });
                entries.push({
                    employeeId,
                    leaveTypeId: type.id,
                    leaveYear: (0, _dates.yearOf)(worked),
                    txType: 'COMP_OFF_GRANT',
                    days,
                    effectiveDate: worked,
                    compOffGrantId: grant.id,
                    batchId: batch.id,
                    note: input.note
                });
            } else {
                entries.push({
                    employeeId,
                    leaveTypeId: type.id,
                    leaveYear: (0, _dates.yearOf)(today),
                    txType: days >= 0 ? 'MANUAL_CREDIT' : 'MANUAL_DEBIT',
                    days,
                    effectiveDate: today,
                    batchId: batch.id,
                    note: input.note
                });
            }
        }
        await this.ledger.post(entries);
        await this.prisma.leaveCreditBatch.update({
            where: {
                id: batch.id
            },
            data: {
                status: 'COMPLETED',
                employeeCount: entries.length,
                totalDays: (0, _leavecalc.round2)(days * entries.length),
                completedAt: new Date()
            }
        });
        await this.audit.record({
            action: 'leave.credit.manual',
            entity: 'LeaveCreditBatch',
            entityId: batch.id,
            meta: {
                type: type.code,
                days,
                employees: input.employeeIds.length
            }
        });
        const users = await this.notifications.usersForEmployees(input.employeeIds);
        await this.notifications.notify({
            userIds: users,
            type: 'leave.credit',
            title: `${(0, _leavecalc.fmtDays)(Math.abs(days))} ${type.name.toLowerCase()} ${days >= 0 ? 'credited to' : 'debited from'} your balance`,
            body: input.note,
            link: '/leave',
            from: ctx.userName ?? 'HR'
        });
        const n = input.employeeIds.length;
        return {
            employees: n,
            days,
            message: days >= 0 ? `Credited ${(0, _leavecalc.fmtDays)(days)} ${days === 1 ? 'day' : 'days'} to ${n} ${n === 1 ? 'employee' : 'employees'}` : `Debited ${(0, _leavecalc.fmtDays)(-days)} days from ${n} ${n === 1 ? 'employee' : 'employees'}`
        };
    }
    async manualCredits() {
        const rows = await this.prisma.leaveLedgerEntry.findMany({
            where: {
                OR: [
                    {
                        txType: {
                            in: [
                                'MANUAL_CREDIT',
                                'MANUAL_DEBIT'
                            ]
                        }
                    },
                    {
                        txType: 'COMP_OFF_GRANT'
                    }
                ]
            },
            include: {
                employee: {
                    select: {
                        fullName: true,
                        empCode: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 100
        });
        const types = new Map((await this.prisma.leaveType.findMany()).map((t)=>[
                t.id,
                t.name
            ]));
        return rows.map((r)=>({
                id: r.id,
                date: (0, _dates.dk)(r.effectiveDate),
                employeeName: r.employee.fullName,
                employeeCode: r.employee.empCode,
                leaveType: types.get(r.leaveTypeId) ?? '—',
                days: r.days,
                txType: r.txType,
                note: r.note,
                creditedBy: r.createdByName
            }));
    }
    // ── comp-off ──────────────────────────────────────────────────────────
    toCompOffRow(g) {
        return {
            id: g.id,
            employeeName: g.employee.fullName,
            workedDate: (0, _dates.dk)(g.workedDate),
            units: g.units,
            remaining: g.remaining,
            expiresOn: (0, _dates.dk)(g.expiresOn),
            status: g.status,
            reason: g.reason,
            source: g.source
        };
    }
    async myCompOffs() {
        const me = this.org.myEmployeeId();
        const rows = await this.prisma.compOffGrant.findMany({
            where: {
                employeeId: me
            },
            include: {
                employee: {
                    select: {
                        fullName: true
                    }
                }
            },
            orderBy: {
                workedDate: 'desc'
            },
            take: 50
        });
        return rows.map((g)=>this.toCompOffRow(g));
    }
    async requestCompOff(input) {
        const me = this.org.myEmployeeId();
        const type = await this.prisma.leaveType.findFirst({
            where: {
                isCompOff: true,
                active: true
            }
        });
        if (!type) throw (0, _errors.badRequest)('Comp-off is not enabled');
        const emp = await this.prisma.employee.findUniqueOrThrow({
            where: {
                id: me
            },
            select: {
                id: true,
                fullName: true,
                managerId: true,
                employmentType: true
            }
        });
        if (!type.appliesTo.includes(emp.employmentType)) throw (0, _errors.forbidden)('Comp-off does not apply to your employment type');
        const settings = await this.settings.get(_leavecommon.LEAVE_SETTINGS_KEY, _leavecommon.DEFAULT_LEAVE_SETTINGS);
        const today = (0, _dates.todayKey)();
        if (input.workedDate > today) throw (0, _errors.badRequest)('The worked date must be in the past');
        if ((0, _dates.diffDays)(today, input.workedDate) > settings.compOffRequestWindowDays) throw (0, _errors.badRequest)(`Comp-off must be requested within ${settings.compOffRequestWindowDays} days of working`);
        const cal = await this.calendar.forEmployee(me, input.workedDate, input.workedDate);
        const kind = cal.calendar(input.workedDate).kind;
        if (kind === 'WORKING') throw (0, _errors.badRequest)('Comp-off is only for work on a weekly off or holiday');
        const dup = await this.prisma.compOffGrant.findFirst({
            where: {
                employeeId: me,
                workedDate: (0, _dates.dd)(input.workedDate),
                status: {
                    notIn: [
                        'REJECTED',
                        'CANCELLED'
                    ]
                }
            }
        });
        if (dup) throw (0, _errors.badRequest)('You already requested comp-off for this date');
        const att = await this.prisma.attendanceDay.findUnique({
            where: {
                employeeId_date: {
                    employeeId: me,
                    date: (0, _dates.dd)(input.workedDate)
                }
            }
        }).catch(()=>null);
        const worked = att?.workedMinutes ?? null;
        const units = input.duration === 'HALF' ? 0.5 : 1;
        if (att && worked !== null) {
            const need = units === 1 ? Math.min(settings.compOffFullDayMinMinutes, cal.shiftNetMinutes) : settings.compOffHalfDayMinMinutes;
            if (worked < need) throw (0, _errors.badRequest)(`Attendance shows ${Math.floor(worked / 60)}h ${worked % 60}m worked; a ${units === 1 ? 'full' : 'half'} day needs ${Math.round(need / 60)}h`);
        }
        const approver = await this.requests.resolveApprover(emp);
        const g = await this.prisma.compOffGrant.create({
            data: {
                employeeId: me,
                workedDate: (0, _dates.dd)(input.workedDate),
                units,
                remaining: 0,
                expiresOn: (0, _dates.dd)((0, _dates.addDays)(input.workedDate, type.expiryDays ?? 60)),
                status: 'PENDING',
                source: 'REQUEST',
                reason: input.reason,
                workedMinutes: worked,
                approverEmployeeId: approver?.id ?? null
            },
            include: {
                employee: {
                    select: {
                        fullName: true
                    }
                }
            }
        });
        await this.audit.record({
            action: 'leave.compoff.requested',
            entity: 'CompOffGrant',
            entityId: g.id,
            meta: {
                workedDate: input.workedDate,
                units
            }
        });
        const users = await this.notifications.usersForEmployees([
            approver?.id
        ]);
        await this.notifications.notify({
            userIds: users,
            type: 'leave.compoff',
            title: `Comp-off request from ${emp.fullName}`,
            body: `Worked ${(0, _dates.dayMonth)(input.workedDate)} · ${units === 1 ? 'Full day' : 'Half day'} · ${input.reason}`,
            link: '/leave?tab=team',
            from: emp.fullName,
            email: true
        });
        return this.toCompOffRow(g);
    }
    async decideCompOff(id, approve, comment) {
        const g = await this.prisma.compOffGrant.findUnique({
            where: {
                id
            },
            include: {
                employee: {
                    select: {
                        fullName: true
                    }
                }
            }
        });
        if (!g) throw (0, _errors.notFound)('Comp-off request');
        if (g.status !== 'PENDING') throw new _errors.AppError(409, 'LEAVE_STATE', 'This comp-off request is no longer pending');
        const ctx = (0, _requestcontext.requireContext)();
        if (g.employeeId === ctx.employeeId) throw (0, _errors.forbidden)("You can't approve your own request");
        if (!(0, _decorators.hasPerm)(ctx, 'leave.manage') && g.approverEmployeeId !== ctx.employeeId) throw (0, _errors.forbidden)('Only the approver can act on this request');
        if (!approve && !comment) throw (0, _errors.badRequest)('Add a comment for the employee');
        const type = await this.prisma.leaveType.findFirstOrThrow({
            where: {
                isCompOff: true
            }
        });
        const expiresOn = (0, _dates.addDays)((0, _dates.dk)(g.workedDate), type.expiryDays ?? 60);
        const saved = await this.prisma.compOffGrant.update({
            where: {
                id
            },
            data: approve ? {
                status: 'APPROVED',
                remaining: g.units,
                expiresOn: (0, _dates.dd)(expiresOn),
                decidedAt: new Date(),
                decidedByName: ctx.userName ?? 'Approver',
                comment: comment ?? null
            } : {
                status: 'REJECTED',
                decidedAt: new Date(),
                decidedByName: ctx.userName ?? 'Approver',
                comment: comment ?? null
            },
            include: {
                employee: {
                    select: {
                        fullName: true
                    }
                }
            }
        });
        if (approve) await this.ledger.post([
            {
                employeeId: g.employeeId,
                leaveTypeId: type.id,
                leaveYear: (0, _dates.yearOf)((0, _dates.todayKey)()),
                txType: 'COMP_OFF_GRANT',
                days: g.units,
                effectiveDate: (0, _dates.dk)(g.workedDate),
                compOffGrantId: g.id,
                note: `Worked ${(0, _dates.dayMonth)((0, _dates.dk)(g.workedDate))}`
            }
        ]);
        await this.audit.record({
            action: approve ? 'leave.compoff.approved' : 'leave.compoff.rejected',
            entity: 'CompOffGrant',
            entityId: id,
            meta: {
                comment: comment ?? null
            }
        });
        const users = await this.notifications.usersForEmployees([
            g.employeeId
        ]);
        await this.notifications.notify({
            userIds: users,
            type: 'leave.compoff',
            title: approve ? `Comp-off approved · expires ${(0, _dates.dayMonth)(expiresOn)}` : 'Comp-off request rejected',
            body: comment,
            link: '/leave',
            from: ctx.userName ?? 'Approver'
        });
        return this.toCompOffRow(saved);
    }
    async cancelGrant(id) {
        this.assertHr();
        const g = await this.prisma.compOffGrant.findUnique({
            where: {
                id
            }
        });
        if (!g) throw (0, _errors.notFound)('Comp-off grant');
        if (g.remaining < g.units || ![
            'APPROVED',
            'PENDING'
        ].includes(g.status)) throw new _errors.AppError(409, 'LEAVE_STATE', 'Only unused grants can be cancelled');
        await this.prisma.compOffGrant.update({
            where: {
                id
            },
            data: {
                status: 'CANCELLED',
                remaining: 0
            }
        });
        const type = await this.prisma.leaveType.findFirstOrThrow({
            where: {
                isCompOff: true
            }
        });
        if (g.status === 'APPROVED') await this.ledger.post([
            {
                employeeId: g.employeeId,
                leaveTypeId: type.id,
                leaveYear: (0, _dates.yearOf)((0, _dates.todayKey)()),
                txType: 'MANUAL_DEBIT',
                days: -g.units,
                effectiveDate: (0, _dates.todayKey)(),
                compOffGrantId: g.id,
                note: 'Grant cancelled'
            }
        ]);
        await this.audit.record({
            action: 'leave.compoff.cancelled',
            entity: 'CompOffGrant',
            entityId: id
        });
        return {
            ok: true
        };
    }
    /** Daily: expire comp-off grants past their expiry date. */ async expireCompOffs(today = (0, _dates.todayKey)()) {
        const type = await this.prisma.leaveType.findFirst({
            where: {
                isCompOff: true
            }
        });
        if (!type) return 0;
        const due = await this.prisma.compOffGrant.findMany({
            where: {
                status: {
                    in: [
                        'APPROVED',
                        'PARTIALLY_USED'
                    ]
                },
                expiresOn: {
                    lt: (0, _dates.dd)(today)
                }
            }
        });
        for (const g of due){
            await this.prisma.compOffGrant.update({
                where: {
                    id: g.id
                },
                data: {
                    status: 'EXPIRED',
                    remaining: 0
                }
            });
            if (g.remaining > 0) await this.ledger.post([
                {
                    employeeId: g.employeeId,
                    leaveTypeId: type.id,
                    leaveYear: (0, _dates.yearOf)(today),
                    txType: 'EXPIRY',
                    days: -g.remaining,
                    effectiveDate: today,
                    compOffGrantId: g.id,
                    note: `Expired ${(0, _dates.dayMonth)((0, _dates.dk)(g.expiresOn))}`
                }
            ]);
        }
        return due.length;
    }
    // ── year-end ──────────────────────────────────────────────────────────
    async yearEndPreview(year) {
        const bals = await this.prisma.leaveBalance.findMany({
            where: {
                year,
                leaveType: {
                    isCompOff: false,
                    isPaid: true
                }
            },
            include: {
                leaveType: true,
                employee: {
                    select: {
                        fullName: true
                    }
                }
            }
        });
        return bals.map((b)=>{
            const closing = (0, _leavecalc.round2)(b.opening + b.accrued + b.credited - b.availed - b.lapsed - b.encashed);
            const s = (0, _leavecalc.yearEndSplit)(closing, b.leaveType.carryForwardMax, false);
            return {
                employeeId: b.employeeId,
                employeeName: b.employee.fullName,
                leaveType: b.leaveType.name,
                closing,
                carry: (0, _leavecalc.round2)(s.carry),
                encash: (0, _leavecalc.round2)(s.encash),
                lapse: (0, _leavecalc.round2)(s.lapse),
                leaveTypeId: b.leaveTypeId
            };
        }).filter((r)=>r.closing !== 0).sort((a, b)=>a.employeeName.localeCompare(b.employeeName));
    }
    /** Carry forward (capped) into year+1 and lapse the rest. Idempotent per year. */ async runYearEnd(year) {
        if (year >= (0, _dates.yearOf)((0, _dates.todayKey)())) throw (0, _errors.badRequest)(`Year-end for ${year} runs on 1 Jan ${year + 1}`);
        const done = await this.prisma.leaveCreditBatch.findFirst({
            where: {
                type: 'YEAR_END',
                periodKey: `ye:${year}`,
                status: 'COMPLETED'
            }
        });
        if (done) throw new _errors.AppError(409, 'ALREADY_CREDITED', `Year-end ${year} has already been processed`);
        const batch = await this.prisma.leaveCreditBatch.create({
            data: {
                type: 'YEAR_END',
                periodKey: `ye:${year}`,
                leaveYear: year,
                status: 'RUNNING',
                triggeredById: (0, _requestcontext.requireContext)().userId ?? null
            }
        });
        const rows = await this.yearEndPreview(year);
        const entries = [];
        for (const r of rows){
            const note = `Year-end ${year}`;
            if (r.carry > 0) {
                entries.push({
                    employeeId: r.employeeId,
                    leaveTypeId: r.leaveTypeId,
                    leaveYear: year,
                    txType: 'CARRY_FORWARD_OUT',
                    days: -r.carry,
                    effectiveDate: `${year}-12-31`,
                    note
                });
                entries.push({
                    employeeId: r.employeeId,
                    leaveTypeId: r.leaveTypeId,
                    leaveYear: year + 1,
                    txType: 'CARRY_FORWARD_IN',
                    days: r.carry,
                    effectiveDate: `${year + 1}-01-01`,
                    note
                });
            } else if (r.carry < 0) {
                entries.push({
                    employeeId: r.employeeId,
                    leaveTypeId: r.leaveTypeId,
                    leaveYear: year + 1,
                    txType: 'OPENING',
                    days: r.carry,
                    effectiveDate: `${year + 1}-01-01`,
                    note: `${note} (negative carried)`
                });
            }
            if (r.lapse > 0) entries.push({
                employeeId: r.employeeId,
                leaveTypeId: r.leaveTypeId,
                leaveYear: year,
                txType: 'LAPSE',
                days: -r.lapse,
                effectiveDate: `${year}-12-31`,
                note
            });
        }
        await this.ledger.post(entries.map((e)=>({
                ...e,
                batchId: undefined
            })));
        await this.prisma.leaveCreditBatch.update({
            where: {
                id: batch.id
            },
            data: {
                status: 'COMPLETED',
                employeeCount: new Set(rows.map((r)=>r.employeeId)).size,
                totalDays: (0, _leavecalc.round2)(rows.reduce((s, r)=>s + r.carry, 0)),
                completedAt: new Date()
            }
        });
        await this.audit.record({
            action: 'leave.yearend.run',
            entity: 'LeaveCreditBatch',
            entityId: batch.id,
            meta: {
                year,
                rows: rows.length
            }
        });
        return {
            rows: rows.length,
            carried: (0, _leavecalc.round2)(rows.reduce((s, r)=>s + Math.max(0, r.carry), 0)),
            lapsed: (0, _leavecalc.round2)(rows.reduce((s, r)=>s + r.lapse, 0))
        };
    }
    // ── settings / holidays ───────────────────────────────────────────────
    getSettings() {
        return this.settings.get(_leavecommon.LEAVE_SETTINGS_KEY, _leavecommon.DEFAULT_LEAVE_SETTINGS);
    }
    async saveSettings(input) {
        this.assertHr();
        await this.settings.set(_leavecommon.LEAVE_SETTINGS_KEY, input);
        await this.audit.record({
            action: 'leave.settings.updated',
            entity: 'Setting',
            entityId: _leavecommon.LEAVE_SETTINGS_KEY,
            meta: input
        });
        return input;
    }
    async holidays(year) {
        const rows = await this.calendar.holidays(`${year}-01-01`, `${year}-12-31`);
        const DAYS = [
            'Sunday',
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
            'Saturday'
        ];
        return rows.map((h)=>({
                id: h.id,
                date: h.date,
                name: h.name,
                type: h.type,
                day: DAYS[(0, _dates.dd)(h.date).getUTCDay()]
            }));
    }
    /** employee.created: open balances and credit the joining-year YEARLY quota (pro-rated). */ async onEmployeeCreated(employeeId) {
        const emp = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                id: true,
                employmentType: true,
                joiningDate: true
            }
        });
        if (!emp) return;
        const year = (0, _dates.yearOf)((0, _dates.todayKey)());
        const rules = await this.prisma.leaveCreditRule.findMany({
            where: {
                active: true,
                frequency: 'YEARLY',
                employmentType: emp.employmentType,
                leaveType: {
                    active: true
                }
            }
        });
        const join = emp.joiningDate ? (0, _dates.dk)(emp.joiningDate) : null;
        const entries = [];
        for (const r of rules){
            const already = await this.prisma.leaveLedgerEntry.count({
                where: {
                    employeeId,
                    leaveTypeId: r.leaveTypeId,
                    leaveYear: year,
                    txType: {
                        in: [
                            'ACCRUAL',
                            'PRORATED_ACCRUAL'
                        ]
                    }
                }
            });
            if (already) continue;
            const days = creditDaysFor(r, String(year), join);
            if (days > 0) entries.push({
                employeeId,
                leaveTypeId: r.leaveTypeId,
                leaveYear: year,
                txType: days < r.daysPerPeriod ? 'PRORATED_ACCRUAL' : 'ACCRUAL',
                days,
                effectiveDate: join && join > `${year}-01-01` ? join : `${year}-01-01`,
                note: 'Joining credit'
            });
        }
        await this.ledger.post(entries);
        await this.ledger.ensureBalances(employeeId, year);
    }
};
LeaveAdminService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _leaveledgerservice.LeaveLedgerService === "undefined" ? Object : _leaveledgerservice.LeaveLedgerService,
        typeof _leaverequestsservice.LeaveRequestsService === "undefined" ? Object : _leaverequestsservice.LeaveRequestsService,
        typeof _calendarservice.WorkCalendarService === "undefined" ? Object : _calendarservice.WorkCalendarService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _settingsservice.SettingsService === "undefined" ? Object : _settingsservice.SettingsService,
        typeof _orgservice.OrgService === "undefined" ? Object : _orgservice.OrgService
    ])
], LeaveAdminService);

//# sourceMappingURL=leave-admin.service.js.map