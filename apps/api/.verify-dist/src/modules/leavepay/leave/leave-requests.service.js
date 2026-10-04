"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "LeaveRequestsService", {
    enumerable: true,
    get: function() {
        return LeaveRequestsService;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _requestcontext = require("../../../core/context/request-context");
const _decorators = require("../../../core/auth/decorators");
const _errors = require("../../../core/http/errors");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _eventsservice = require("../../../core/registry/events.service");
const _sequenceservice = require("../../../core/registry/sequence.service");
const _settingsservice = require("../../../core/settings/settings.service");
const _orgservice = require("../../../core/org/org.service");
const _dates = require("../common/dates");
const _calendarservice = require("../common/calendar.service");
const _leavecalc = require("./leave-calc");
const _leaveledgerservice = require("./leave-ledger.service");
const _leavecommon = require("./leave.common");
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
let LeaveRequestsService = class LeaveRequestsService {
    prisma;
    ledger;
    calendar;
    audit;
    notifications;
    events;
    seq;
    settings;
    org;
    constructor(prisma, ledger, calendar, audit, notifications, events, seq, settings, org){
        this.prisma = prisma;
        this.ledger = ledger;
        this.calendar = calendar;
        this.audit = audit;
        this.notifications = notifications;
        this.events = events;
        this.seq = seq;
        this.settings = settings;
        this.org = org;
    }
    // ── helpers ────────────────────────────────────────────────────────────
    viewer() {
        const ctx = (0, _requestcontext.requireContext)();
        return {
            employeeId: ctx.employeeId ?? null,
            isHr: (0, _decorators.hasPerm)(ctx, 'leave.manage'),
            today: (0, _dates.todayKey)()
        };
    }
    leaveSettings() {
        return this.settings.get(_leavecommon.LEAVE_SETTINGS_KEY, _leavecommon.DEFAULT_LEAVE_SETTINGS);
    }
    async names(ids) {
        const list = [
            ...new Set(ids.filter((x)=>!!x))
        ];
        if (!list.length) return new Map();
        const rows = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: list
                }
            },
            select: {
                id: true,
                fullName: true
            }
        });
        return new Map(rows.map((r)=>[
                r.id,
                r.fullName
            ]));
    }
    async rows(reqs) {
        const names = await this.names(reqs.map((r)=>r.approverEmployeeId));
        const v = this.viewer();
        return reqs.map((r)=>(0, _leavecommon.toRequestRow)(r, r.approverEmployeeId ? names.get(r.approverEmployeeId) ?? null : null, v));
    }
    /** RM, or the fallback approver (first HR/admin employee) when the RM is missing or the employee themself. */ async resolveApprover(emp) {
        if (emp.managerId && emp.managerId !== emp.id) {
            const m = await this.prisma.employee.findUnique({
                where: {
                    id: emp.managerId
                },
                select: {
                    id: true,
                    fullName: true,
                    status: true
                }
            });
            if (m && m.status !== 'EXITED') return {
                id: m.id,
                name: m.fullName,
                source: 'RM'
            };
        }
        const roles = await this.prisma.role.findMany({
            where: {
                permissions: {
                    has: 'leave.manage'
                }
            },
            select: {
                id: true
            }
        });
        const hr = await this.prisma.employee.findFirst({
            where: {
                id: {
                    not: emp.id
                },
                status: {
                    in: [
                        'ACTIVE',
                        'NOTICE_PERIOD'
                    ]
                },
                user: {
                    roleId: {
                        in: roles.map((r)=>r.id)
                    }
                }
            },
            orderBy: {
                empCode: 'asc'
            },
            select: {
                id: true,
                fullName: true
            }
        });
        return hr ? {
            id: hr.id,
            name: hr.fullName,
            source: 'FALLBACK'
        } : null;
    }
    /** Available comp-off units usable on `onDate` (approved grants not yet expired) minus pending CO requests. */ async compOffAvailable(employeeId, onDate, coTypeId, excludeRequestId) {
        const grants = await this.prisma.compOffGrant.findMany({
            where: {
                employeeId,
                status: {
                    in: [
                        'APPROVED',
                        'PARTIALLY_USED'
                    ]
                },
                remaining: {
                    gt: 0
                },
                expiresOn: {
                    gte: (0, _dates.dd)(onDate)
                }
            },
            orderBy: {
                expiresOn: 'asc'
            }
        });
        const pending = await this.prisma.leaveRequest.findMany({
            where: {
                employeeId,
                leaveTypeId: coTypeId,
                status: 'PENDING',
                ...excludeRequestId ? {
                    id: {
                        not: excludeRequestId
                    }
                } : {}
            },
            select: {
                paidDays: true
            }
        });
        const total = grants.reduce((s, g)=>s + g.remaining, 0) - pending.reduce((s, p)=>s + p.paidDays, 0);
        return {
            available: (0, _leavecalc.round2)(total),
            grants: grants.map((g)=>({
                    id: g.id,
                    remaining: g.remaining,
                    expiresOn: (0, _dates.dk)(g.expiresOn)
                }))
        };
    }
    async balanceAvailable(employeeId, leaveTypeId, year) {
        let b = await this.prisma.leaveBalance.findUnique({
            where: {
                employeeId_leaveTypeId_year: {
                    employeeId,
                    leaveTypeId,
                    year
                }
            }
        });
        if (!b) b = await this.ledger.recompute(employeeId, leaveTypeId, year);
        return b.available;
    }
    // ── balances / history / upcoming ─────────────────────────────────────
    async balances(employeeId, year = (0, _dates.yearOf)((0, _dates.todayKey)())) {
        const emp = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                employmentType: true
            }
        });
        if (!emp) throw (0, _errors.notFound)('Employee');
        const types = await this.prisma.leaveType.findMany({
            where: {
                active: true,
                hidden: false,
                appliesTo: {
                    has: emp.employmentType
                }
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
        const today = (0, _dates.todayKey)();
        const out = [];
        for (const t of types){
            let b = await this.prisma.leaveBalance.findUnique({
                where: {
                    employeeId_leaveTypeId_year: {
                        employeeId,
                        leaveTypeId: t.id,
                        year
                    }
                }
            });
            if (!b) b = await this.ledger.recompute(employeeId, t.id, year);
            let available = b.available;
            let total = b.entitlement;
            const metas = [];
            if (t.isCompOff) {
                const co = await this.compOffAvailable(employeeId, today, t.id);
                available = co.available;
                total = Math.max(total, available);
                const next = co.grants[0];
                if (next) metas.push(`${(0, _leavecalc.fmtDays)(next.remaining)} expires ${(0, _dates.dayMonth)(next.expiresOn)}`);
            } else {
                if (b.opening > 0) metas.push(`incl. ${(0, _leavecalc.fmtDays)(b.opening)} carried forward`);
                // entitlement = scheduled accrual + positive credits (opening is not part of it).
                const more = (0, _leavecalc.round2)(b.entitlement - b.accrued - Math.max(0, b.credited));
                if (t.accrualFrequency === 'MONTHLY' && more > 0 && year === (0, _dates.yearOf)(today)) metas.push(`${(0, _leavecalc.fmtDays)(more)} more accruing by Dec`);
            }
            if (b.pending > 0) metas.push(`${(0, _leavecalc.fmtDays)(b.pending)} pending approval`);
            out.push({
                leaveTypeId: t.id,
                code: t.code,
                name: t.name,
                available,
                total,
                pending: b.pending,
                availed: b.availed,
                opening: b.opening,
                isCompOff: t.isCompOff,
                allowHalfDay: t.allowHalfDay,
                meta: metas.length ? metas.join(' · ') : null
            });
        }
        return out;
    }
    async myRequests(employeeId, q) {
        const where = {
            employeeId
        };
        if (q.year) where.fromDate = {
            gte: (0, _dates.dd)(`${q.year}-01-01`),
            lte: (0, _dates.dd)(`${q.year}-12-31`)
        };
        if (q.status) where.status = {
            in: q.status.split(',')
        };
        const [total, reqs] = await Promise.all([
            this.prisma.leaveRequest.count({
                where
            }),
            this.prisma.leaveRequest.findMany({
                where,
                include: _leavecommon.requestInclude,
                orderBy: [
                    {
                        fromDate: 'desc'
                    },
                    {
                        createdAt: 'desc'
                    }
                ],
                skip: (q.page - 1) * q.pageSize,
                take: q.pageSize
            })
        ]);
        return {
            items: await this.rows(reqs),
            total,
            page: q.page,
            pageSize: q.pageSize
        };
    }
    async upcoming(employeeId) {
        const today = (0, _dates.todayKey)();
        const until = (0, _dates.addDays)(today, 120);
        const emp = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                workLocationId: true
            }
        });
        const hol = (await this.calendar.holidays(today, until)).filter((h)=>!h.locationIds.length || emp?.workLocationId && h.locationIds.includes(emp.workLocationId));
        const items = [];
        // Group consecutive holidays with the same name ("Diwali 8 – 9 Nov").
        for(let i = 0; i < hol.length; i++){
            const h = hol[i];
            let end = h.date;
            while(hol[i + 1] && hol[i + 1].name === h.name && (0, _dates.diffDays)(hol[i + 1].date, end) === 1)end = hol[++i].date;
            items.push({
                kind: 'HOLIDAY',
                label: h.type === 'OPTIONAL' ? `${h.name} (optional)` : h.name,
                dates: (0, _dates.rangeLabel)(h.date, end),
                date: h.date
            });
        }
        const reqs = await this.prisma.leaveRequest.findMany({
            where: {
                employeeId,
                status: {
                    in: [
                        'PENDING',
                        'APPROVED',
                        'CANCELLATION_PENDING'
                    ]
                },
                toDate: {
                    gte: (0, _dates.dd)(today)
                }
            },
            include: {
                leaveType: true
            },
            orderBy: {
                fromDate: 'asc'
            },
            take: 6
        });
        for (const r of reqs){
            items.push({
                kind: 'LEAVE',
                label: `Your ${r.leaveType.name.toLowerCase()}`,
                dates: (0, _leavecommon.requestDatesLabel)(r.fromDate, r.toDate, r.halfDay),
                date: (0, _dates.dk)(r.fromDate),
                status: r.status === 'PENDING' ? 'Pending RM' : r.status === 'APPROVED' ? 'Approved' : 'Cancellation pending'
            });
        }
        return items.sort((a, b)=>a.date < b.date ? -1 : 1).slice(0, 8);
    }
    // ── preview / apply ───────────────────────────────────────────────────
    async compute(employeeId, input, opts) {
        const today = (0, _dates.todayKey)();
        const emp = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                id: true,
                fullName: true,
                managerId: true,
                userId: true,
                employmentType: true,
                status: true,
                exitDate: true
            }
        });
        if (!emp) throw (0, _errors.notFound)('Employee');
        const type = await this.prisma.leaveType.findUnique({
            where: {
                id: input.leaveTypeId
            }
        });
        if (!type || !type.active) throw (0, _errors.badRequest)('Choose a valid leave type', 'LEAVE_TYPE_INVALID');
        const blocks = [];
        const warnings = [];
        if (![
            'ACTIVE',
            'NOTICE_PERIOD'
        ].includes(emp.status) && !opts.onBehalf) blocks.push('Only active employees can apply for time off');
        if (!type.appliesTo.includes(emp.employmentType)) blocks.push(`${type.name} doesn't apply to ${emp.employmentType === 'INTERN' ? 'interns' : 'your employment type'}`);
        if (type.hidden && !opts.onBehalf) blocks.push(`${type.name} can only be applied by HR`);
        const from = input.fromDate;
        const to = input.toDate;
        const single = from === to;
        const halfDay = single ? input.halfDay : 'NONE';
        const fromSession = single ? 'FULL' : input.fromSession;
        const toSession = single ? 'FULL' : input.toSession;
        if (!type.allowHalfDay && (halfDay !== 'NONE' || fromSession !== 'FULL' || toSession !== 'FULL')) blocks.push(`Half days are not allowed for ${type.name}`);
        const cal = await this.calendar.forEmployee(employeeId, (0, _dates.addDays)(from, -16), (0, _dates.addDays)(to, 16));
        // Existing active requests near the range: overlap + sandwich coverage.
        const existing = await this.prisma.leaveRequest.findMany({
            where: {
                employeeId,
                status: {
                    in: [
                        ..._leavecommon.ACTIVE_STATUSES
                    ]
                },
                fromDate: {
                    lte: (0, _dates.dd)((0, _dates.addDays)(to, 16))
                },
                toDate: {
                    gte: (0, _dates.dd)((0, _dates.addDays)(from, -16))
                },
                ...opts.excludeRequestId ? {
                    id: {
                        not: opts.excludeRequestId
                    }
                } : {}
            },
            include: {
                leaveType: {
                    select: {
                        sandwichWeeklyOffs: true,
                        sandwichHolidays: true,
                        name: true
                    }
                }
            }
        });
        const coverage = new Map();
        const sandwichCoverage = new Map();
        for (const r of existing){
            for (const d of r.dayBreakdown ?? []){
                if (d.units <= 0) continue;
                coverage.set(d.date, d.session);
                if (r.leaveType.sandwichWeeklyOffs || r.leaveType.sandwichHolidays) sandwichCoverage.set(d.date, d.session);
            }
        }
        const ex = (0, _leavecalc.expandLeaveDays)({
            from,
            to,
            halfDay,
            fromSession,
            toSession,
            calendar: cal.calendar,
            sandwichWeeklyOffs: type.sandwichWeeklyOffs,
            sandwichHolidays: type.sandwichHolidays,
            existingCoverage: (d)=>sandwichCoverage.get(d) ?? null
        });
        if (ex.error) blocks.push(ex.error);
        for (const d of ex.days){
            if (d.units <= 0) continue;
            const other = coverage.get(d.date);
            if (other && (0, _leavecalc.sessionsConflict)(other, d.session)) {
                blocks.push(`You already have time off on ${(0, _dates.dayMonth)(d.date)}`);
                break;
            }
        }
        if (emp.exitDate && to > (0, _dates.dk)(emp.exitDate)) blocks.push('Leave cannot extend past your last working day');
        // Balance per leave year.
        const settings = await this.leaveSettings();
        const byYear = new Map();
        for (const d of ex.days)if (d.units > 0) byYear.set((0, _dates.yearOf)(d.date), (byYear.get((0, _dates.yearOf)(d.date)) ?? 0) + d.units);
        let paid = 0;
        let lop = 0;
        let available = 0;
        for (const [year, units] of byYear){
            const avail = type.isCompOff ? (await this.compOffAvailable(employeeId, from, type.id, opts.excludeRequestId)).available : await this.balanceAvailable(employeeId, type.id, year);
            available += avail;
            const s = (0, _leavecalc.splitPaid)(units, avail, {
                isPaidType: type.isPaid,
                allowNegative: type.allowNegative,
                negativeLimit: type.negativeLimit,
                excessAction: type.isCompOff ? 'REJECT' : settings.excessBalanceAction
            });
            if (s.blocked) blocks.push(`Only ${(0, _leavecalc.fmtDays)(Math.max(0, avail))} ${(0, _leavecalc.fmtDays)(Math.max(0, avail)) === '1' ? 'day' : 'days'} of ${type.name.toLowerCase()} available`);
            paid += s.paid;
            lop += s.lop;
        }
        paid = (0, _leavecalc.round2)(paid);
        lop = (0, _leavecalc.round2)(lop);
        const days = (0, _leavecalc.markLop)(ex.days, lop);
        if (lop > 0 && type.isPaid) {
            const msg = `${(0, _leavecalc.fmtDays)(lop)} ${lop === 1 ? 'day' : 'days'} will be unpaid (loss of pay)`;
            if (input.acceptLop) warnings.push(msg);
            else blocks.push(`${msg}. Tick "I understand" to continue`);
        }
        // Notice / backdating / limits (HR on-behalf bypasses notice and backdating).
        if (!opts.onBehalf) {
            const notice = (0, _dates.diffDays)(from, today);
            if (notice >= 0 && notice < type.minNoticeDays) {
                const m = `${type.name} needs ${type.minNoticeDays} days' notice`;
                if (type.noticeEnforcement === 'BLOCK') blocks.push(m);
                else warnings.push(m);
            }
            if (from < today && (0, _dates.diffDays)(today, from) > type.backdateLimitDays) {
                blocks.push(type.backdateLimitDays ? `${type.name} can be applied at most ${type.backdateLimitDays} days back; ask HR` : 'Past dates can only be applied by HR');
            }
        }
        if (type.maxConsecutiveDays && ex.totalDays > type.maxConsecutiveDays) blocks.push(`${type.name} allows at most ${(0, _leavecalc.fmtDays)(type.maxConsecutiveDays)} consecutive days`);
        if (type.documentRequiredAfterDays && ex.totalDays > type.documentRequiredAfterDays && !input.attachmentFileId) warnings.push(`Attach a supporting document for more than ${(0, _leavecalc.fmtDays)(type.documentRequiredAfterDays)} days`);
        // Team overlap (information only).
        if (emp.managerId) {
            const peers = await this.prisma.employee.findMany({
                where: {
                    managerId: emp.managerId,
                    id: {
                        not: emp.id
                    },
                    status: {
                        in: [
                            'ACTIVE',
                            'NOTICE_PERIOD'
                        ]
                    }
                },
                select: {
                    id: true
                }
            });
            if (peers.length) {
                const off = await this.prisma.leaveRequest.findMany({
                    where: {
                        employeeId: {
                            in: peers.map((p)=>p.id)
                        },
                        status: {
                            in: [
                                'PENDING',
                                'APPROVED'
                            ]
                        },
                        fromDate: {
                            lte: (0, _dates.dd)(to)
                        },
                        toDate: {
                            gte: (0, _dates.dd)(from)
                        }
                    },
                    select: {
                        employeeId: true
                    }
                });
                const n = new Set(off.map((o)=>o.employeeId)).size;
                if (n && n / peers.length * 100 > settings.teamOverlapWarnPct) warnings.push(`${n} ${n === 1 ? 'teammate is' : 'teammates are'} also off in this period`);
            }
        }
        const approver = await this.resolveApprover(emp);
        if (!approver) blocks.push('No approver is configured; ask HR to set your Reporting Manager');
        const balanceAfter = (0, _leavecalc.round2)(available - paid);
        const parts = [
            `${(0, _leavecalc.fmtDays)(ex.totalDays)} ${ex.totalDays === 1 ? 'day' : 'days'}`
        ];
        if (type.isPaid) parts.push(`balance after ${(0, _leavecalc.fmtDays)(balanceAfter)}`);
        for (const e of ex.excluded.filter((x)=>x.kind === 'HOLIDAY'))parts.push(`${e.holidayName ?? 'Holiday'} (${(0, _dates.dayMonth)(e.date)}) excluded`);
        if (ex.sandwichDays > 0) parts.push(`${(0, _leavecalc.fmtDays)(ex.sandwichDays)} sandwich ${ex.sandwichDays === 1 ? 'day' : 'days'} counted`);
        if (lop > 0) parts.push(`${(0, _leavecalc.fmtDays)(lop)} unpaid`);
        return {
            preview: {
                totalDays: ex.totalDays,
                paidDays: paid,
                lopDays: lop,
                sandwichDays: ex.sandwichDays,
                days: days.map((d)=>({
                        date: d.date,
                        kind: d.kind,
                        session: d.session,
                        units: d.units,
                        isSandwich: d.isSandwich,
                        isPaid: d.isPaid,
                        holidayName: d.holidayName
                    })),
                available,
                balanceAfter,
                summary: ex.error ? ex.error : parts.join(' · '),
                warnings,
                blocks: [
                    ...new Set(blocks)
                ],
                approver: approver ? {
                    id: approver.id,
                    name: approver.name
                } : null
            },
            days,
            emp: {
                id: emp.id,
                fullName: emp.fullName,
                managerId: emp.managerId,
                userId: emp.userId,
                employmentType: emp.employmentType
            },
            type: {
                id: type.id,
                code: type.code,
                name: type.name,
                isCompOff: type.isCompOff,
                documentRequiredAfterDays: type.documentRequiredAfterDays
            }
        };
    }
    async preview(input, employeeId) {
        const onBehalf = !!employeeId && employeeId !== (0, _requestcontext.requireContext)().employeeId;
        if (onBehalf && !(0, _decorators.hasPerm)((0, _requestcontext.requireContext)(), 'leave.manage')) throw (0, _errors.forbidden)();
        const id = employeeId ?? this.org.myEmployeeId();
        return (await this.compute(id, input, {
            onBehalf
        })).preview;
    }
    async apply(input) {
        const employeeId = this.org.myEmployeeId();
        const req = await this.create(employeeId, input, {
            onBehalf: false
        });
        return req;
    }
    async applyOnBehalf(input) {
        const ctx = (0, _requestcontext.requireContext)();
        if (!(0, _decorators.hasPerm)(ctx, 'leave.manage')) throw (0, _errors.forbidden)();
        const req = await this.create(input.employeeId, input, {
            onBehalf: true
        });
        if (input.autoApprove) return this.approve(req.id, 'Applied by HR', {
            onBehalf: true
        });
        return req;
    }
    async create(employeeId, input, opts) {
        const c = await this.compute(employeeId, input, opts);
        if (c.preview.blocks.length) throw new _errors.AppError(422, 'LEAVE_BLOCKED', c.preview.blocks[0], {
            blocks: c.preview.blocks
        });
        if (c.type.documentRequiredAfterDays && c.preview.totalDays > c.type.documentRequiredAfterDays && !input.attachmentFileId && !opts.onBehalf) {
            throw new _errors.AppError(422, 'LEAVE_BLOCKED', `Attach a supporting document for more than ${(0, _leavecalc.fmtDays)(c.type.documentRequiredAfterDays)} days`);
        }
        const ctx = (0, _requestcontext.requireContext)();
        const year = (0, _dates.yearOf)(input.fromDate);
        const requestNo = await this.seq.next('leave.request', {
            prefix: `LV-${year}-`,
            pad: 5,
            period: String(year)
        });
        const single = input.fromDate === input.toDate;
        const approver = c.preview.approver;
        const approverRow = await this.resolveApprover(c.emp);
        const notify = [
            ...new Set((input.notifyEmployeeIds ?? []).filter((x)=>x !== approver.id && x !== employeeId))
        ];
        const req = await this.prisma.leaveRequest.create({
            data: {
                requestNo,
                employeeId,
                leaveTypeId: c.type.id,
                fromDate: (0, _dates.dd)(input.fromDate),
                toDate: (0, _dates.dd)(input.toDate),
                halfDay: single ? input.halfDay : 'NONE',
                fromSession: single ? 'FULL' : input.fromSession,
                toSession: single ? 'FULL' : input.toSession,
                days: c.preview.totalDays,
                paidDays: c.preview.paidDays,
                lopDays: c.preview.lopDays,
                sandwichDays: c.preview.sandwichDays,
                dayBreakdown: c.days,
                reason: input.reason || null,
                attachmentFileId: input.attachmentFileId ?? null,
                status: 'PENDING',
                approverEmployeeId: approver.id,
                approverSource: opts.onBehalf ? 'HR_ON_BEHALF' : approverRow?.source ?? 'RM',
                notifyEmployeeIds: notify,
                appliedByUserId: ctx.userId ?? null
            },
            include: _leavecommon.requestInclude
        });
        await this.recomputeYears(employeeId, c.type.id, c.days);
        await this.audit.record({
            action: opts.onBehalf ? 'leave.request.applied_on_behalf' : 'leave.request.submitted',
            entity: 'LeaveRequest',
            entityId: req.id,
            meta: {
                requestNo,
                days: req.days,
                type: c.type.code,
                from: input.fromDate,
                to: input.toDate
            }
        });
        const label = `${c.type.name} · ${(0, _leavecommon.requestDatesLabel)(req.fromDate, req.toDate, req.halfDay)} (${(0, _leavecalc.fmtDays)(req.days)} ${req.days === 1 ? 'day' : 'days'})`;
        if (!opts.onBehalf) {
            const approverUsers = await this.notifications.usersForEmployees([
                approver.id
            ]);
            await this.notifications.notify({
                userIds: approverUsers,
                type: 'leave.request',
                title: `Time-off request from ${c.emp.fullName}`,
                body: `${label}${req.reason ? ` · ${req.reason}` : ''}`,
                link: '/leave?tab=team',
                from: c.emp.fullName,
                email: true
            });
            const ccUsers = await this.notifications.usersForEmployees(notify);
            await this.notifications.notify({
                userIds: ccUsers,
                type: 'leave.cc',
                title: `${c.emp.fullName} will be on time off`,
                body: label,
                link: '/leave',
                from: c.emp.fullName
            });
        }
        this.events.emit('leave.requested', {
            requestId: req.id,
            employeeId
        });
        return (await this.rows([
            req
        ]))[0];
    }
    async recomputeYears(employeeId, leaveTypeId, days) {
        const years = new Set(days.map((d)=>(0, _dates.yearOf)(d.date)));
        if (!years.size) years.add((0, _dates.yearOf)((0, _dates.todayKey)()));
        for (const y of years)await this.ledger.recompute(employeeId, leaveTypeId, y);
    }
    // ── detail ────────────────────────────────────────────────────────────
    async load(id) {
        const r = await this.prisma.leaveRequest.findUnique({
            where: {
                id
            },
            include: {
                ..._leavecommon.requestInclude,
                leaveType: true
            }
        });
        if (!r) throw (0, _errors.notFound)('Leave request');
        return r;
    }
    async canView(r) {
        const ctx = (0, _requestcontext.requireContext)();
        const me = ctx.employeeId;
        if ((0, _decorators.hasPerm)(ctx, 'leave.manage')) return true;
        if (!me) return false;
        if (r.employeeId === me || r.approverEmployeeId === me || r.notifyEmployeeIds.includes(me)) return true;
        if ((0, _decorators.hasPerm)(ctx, 'leave.approve')) return (await this.org.reportTree(me)).includes(r.employeeId);
        return false;
    }
    async detail(id) {
        const r = await this.load(id);
        if (!await this.canView(r)) throw (0, _errors.forbidden)();
        const [row] = await this.rows([
            r
        ]);
        const names = await this.names(r.notifyEmployeeIds);
        const timeline = [
            {
                at: r.createdAt.toISOString(),
                text: `Applied for ${(0, _leavecalc.fmtDays)(r.days)} ${r.days === 1 ? 'day' : 'days'}`
            }
        ];
        if (r.decidedAt) timeline.push({
            at: r.decidedAt.toISOString(),
            text: `${row.statusLabel} by ${r.decidedByName ?? 'approver'}${r.decisionNote ? ` · “${r.decisionNote}”` : ''}`
        });
        if (r.cancelRequestedAt) timeline.push({
            at: r.cancelRequestedAt.toISOString(),
            text: `Cancellation requested${r.cancelReason ? ` · ${r.cancelReason}` : ''}`
        });
        if (r.cancelledAt) timeline.push({
            at: r.cancelledAt.toISOString(),
            text: 'Cancelled'
        });
        let balanceAfter = null;
        if (r.leaveType.isPaid) balanceAfter = r.leaveType.isCompOff ? (await this.compOffAvailable(r.employeeId, (0, _dates.todayKey)(), r.leaveTypeId)).available : await this.balanceAvailable(r.employeeId, r.leaveTypeId, (0, _dates.yearOf)((0, _dates.dk)(r.fromDate)));
        return {
            ...row,
            breakdown: (r.dayBreakdown ?? []).map((d)=>({
                    ...d
                })),
            notify: r.notifyEmployeeIds.map((nid)=>({
                    id: nid,
                    name: names.get(nid) ?? '—'
                })),
            timeline,
            attachmentFileId: r.attachmentFileId,
            balanceAfter,
            teamOverlap: await this.teamOverlap(r.employeeId, (0, _dates.dk)(r.fromDate), (0, _dates.dk)(r.toDate))
        };
    }
    async teamOverlap(employeeId, from, to) {
        const emp = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                managerId: true
            }
        });
        if (!emp?.managerId) return 0;
        const off = await this.prisma.leaveRequest.findMany({
            where: {
                employeeId: {
                    not: employeeId
                },
                employee: {
                    managerId: emp.managerId
                },
                status: {
                    in: [
                        'PENDING',
                        'APPROVED'
                    ]
                },
                fromDate: {
                    lte: (0, _dates.dd)(to)
                },
                toDate: {
                    gte: (0, _dates.dd)(from)
                }
            },
            select: {
                employeeId: true
            }
        });
        return new Set(off.map((o)=>o.employeeId)).size;
    }
    // ── decisions ─────────────────────────────────────────────────────────
    assertDecider(r, opts) {
        const ctx = (0, _requestcontext.requireContext)();
        if (opts?.onBehalf) return;
        const me = ctx.employeeId;
        if (me && r.employeeId === me) throw (0, _errors.forbidden)("You can't approve your own request");
        if ((0, _decorators.hasPerm)(ctx, 'leave.manage')) return;
        if (!me || r.approverEmployeeId !== me || !(0, _decorators.hasPerm)(ctx, 'leave.approve')) throw (0, _errors.forbidden)('Only the approver can act on this request');
    }
    async markPayrollStale(employeeId, dates) {
        const periods = [
            ...new Set(dates.map(_dates.periodOf))
        ];
        if (!periods.length) return;
        const runs = await this.prisma.payrollRun.findMany({
            where: {
                period: {
                    in: periods
                },
                status: 'CALCULATED'
            },
            select: {
                id: true
            }
        });
        if (!runs.length) return;
        await this.prisma.payrollItem.updateMany({
            where: {
                runId: {
                    in: runs.map((r)=>r.id)
                },
                employeeId,
                status: {
                    in: [
                        'READY',
                        'TIMESHEET_PENDING',
                        'ON_HOLD'
                    ]
                }
            },
            data: {
                status: 'STALE'
            }
        });
    }
    async approve(id, comment, opts) {
        const r = await this.load(id);
        if (r.status !== 'PENDING') throw new _errors.AppError(409, 'LEAVE_STATE', 'This request is no longer pending');
        this.assertDecider(r, opts);
        const ctx = (0, _requestcontext.requireContext)();
        const days = (r.dayBreakdown ?? []).filter((d)=>d.units > 0);
        // Re-check comp-off availability at approval time (grants may have expired).
        let consumed = [];
        if (r.leaveType.isCompOff) {
            const co = await this.compOffAvailable(r.employeeId, (0, _dates.dk)(r.fromDate), r.leaveTypeId, r.id);
            const res = (0, _leavecalc.consumeCompOff)(co.grants, r.paidDays, (0, _dates.dk)(r.fromDate));
            if (res.shortfall > 0) throw new _errors.AppError(422, 'LEAVE_BLOCKED', 'Not enough comp-off balance left for this request');
            consumed = res.consumed;
        }
        const upd = await this.prisma.leaveRequest.updateMany({
            where: {
                id,
                version: r.version,
                status: 'PENDING'
            },
            data: {
                status: 'APPROVED',
                decidedAt: new Date(),
                decidedByName: ctx.userName ?? 'HR',
                decisionNote: comment || null,
                version: {
                    increment: 1
                }
            }
        });
        if (!upd.count) throw new _errors.AppError(409, 'CONFLICT', 'This request was changed by someone else; refresh and try again');
        await this.prisma.leaveRequestDay.createMany({
            data: days.map((d)=>({
                    requestId: r.id,
                    employeeId: r.employeeId,
                    leaveTypeId: r.leaveTypeId,
                    date: (0, _dates.dd)(d.date),
                    session: d.session,
                    dayKind: d.kind,
                    units: d.units,
                    isSandwich: d.isSandwich,
                    isPaid: d.isPaid,
                    leaveYear: (0, _dates.yearOf)(d.date),
                    active: true
                }))
        });
        for (const c of consumed){
            await this.prisma.compOffConsumption.create({
                data: {
                    grantId: c.grantId,
                    requestId: r.id,
                    units: c.units
                }
            });
            const g = await this.prisma.compOffGrant.findUniqueOrThrow({
                where: {
                    id: c.grantId
                }
            });
            const remaining = (0, _leavecalc.round2)(g.remaining - c.units);
            await this.prisma.compOffGrant.update({
                where: {
                    id: g.id
                },
                data: {
                    remaining,
                    status: remaining <= 0 ? 'USED' : 'PARTIALLY_USED'
                }
            });
        }
        const paidByYear = new Map();
        for (const d of days)if (d.isPaid) paidByYear.set((0, _dates.yearOf)(d.date), (paidByYear.get((0, _dates.yearOf)(d.date)) ?? 0) + d.units);
        if (r.leaveType.isPaid) {
            await this.ledger.post([
                ...paidByYear
            ].map(([y, u])=>({
                    employeeId: r.employeeId,
                    leaveTypeId: r.leaveTypeId,
                    leaveYear: y,
                    txType: 'AVAIL',
                    days: -u,
                    effectiveDate: (0, _dates.dk)(r.fromDate),
                    requestId: r.id,
                    note: r.requestNo
                })));
        }
        await this.recomputeYears(r.employeeId, r.leaveTypeId, days);
        await this.markPayrollStale(r.employeeId, days.map((d)=>d.date));
        await this.audit.record({
            action: opts?.onBehalf ? 'leave.request.approved_on_behalf' : 'leave.request.approved',
            entity: 'LeaveRequest',
            entityId: r.id,
            meta: {
                from: 'PENDING',
                to: 'APPROVED',
                days: r.days
            }
        });
        const users = await this.notifications.usersForEmployees([
            r.employeeId
        ]);
        await this.notifications.notify({
            userIds: users,
            type: 'leave.decided',
            title: `Your ${r.leaveType.name.toLowerCase()} (${(0, _leavecommon.requestDatesLabel)(r.fromDate, r.toDate, r.halfDay)}) was approved`,
            body: comment || undefined,
            link: '/leave',
            from: ctx.userName ?? 'Reporting Manager',
            email: true
        });
        this.events.emit('leave.decided', {
            requestId: r.id,
            employeeId: r.employeeId,
            status: 'APPROVED'
        });
        return (await this.rows([
            await this.prisma.leaveRequest.findUniqueOrThrow({
                where: {
                    id
                },
                include: _leavecommon.requestInclude
            })
        ]))[0];
    }
    async reject(id, comment) {
        const r = await this.load(id);
        if (r.status !== 'PENDING') throw new _errors.AppError(409, 'LEAVE_STATE', 'This request is no longer pending');
        this.assertDecider(r);
        const ctx = (0, _requestcontext.requireContext)();
        const upd = await this.prisma.leaveRequest.updateMany({
            where: {
                id,
                version: r.version,
                status: 'PENDING'
            },
            data: {
                status: 'REJECTED',
                decidedAt: new Date(),
                decidedByName: ctx.userName ?? 'Approver',
                decisionNote: comment,
                version: {
                    increment: 1
                }
            }
        });
        if (!upd.count) throw new _errors.AppError(409, 'CONFLICT', 'This request was changed by someone else; refresh and try again');
        await this.recomputeYears(r.employeeId, r.leaveTypeId, r.dayBreakdown ?? []);
        await this.audit.record({
            action: 'leave.request.rejected',
            entity: 'LeaveRequest',
            entityId: r.id,
            meta: {
                from: 'PENDING',
                to: 'REJECTED',
                comment
            }
        });
        const users = await this.notifications.usersForEmployees([
            r.employeeId
        ]);
        await this.notifications.notify({
            userIds: users,
            type: 'leave.decided',
            title: `Your ${r.leaveType.name.toLowerCase()} (${(0, _leavecommon.requestDatesLabel)(r.fromDate, r.toDate, r.halfDay)}) was rejected`,
            body: comment,
            link: '/leave',
            from: ctx.userName ?? 'Reporting Manager',
            email: true
        });
        this.events.emit('leave.decided', {
            requestId: r.id,
            employeeId: r.employeeId,
            status: 'REJECTED'
        });
        return (await this.rows([
            await this.prisma.leaveRequest.findUniqueOrThrow({
                where: {
                    id
                },
                include: _leavecommon.requestInclude
            })
        ]))[0];
    }
    async withdraw(id) {
        const r = await this.load(id);
        const me = (0, _requestcontext.requireContext)().employeeId;
        if (r.employeeId !== me) throw (0, _errors.forbidden)('Only the applicant can withdraw a request');
        if (r.status !== 'PENDING') throw new _errors.AppError(409, 'LEAVE_STATE', 'Only pending requests can be withdrawn');
        await this.prisma.leaveRequest.update({
            where: {
                id
            },
            data: {
                status: 'WITHDRAWN',
                decidedAt: new Date(),
                version: {
                    increment: 1
                }
            }
        });
        await this.recomputeYears(r.employeeId, r.leaveTypeId, r.dayBreakdown ?? []);
        await this.audit.record({
            action: 'leave.request.withdrawn',
            entity: 'LeaveRequest',
            entityId: r.id
        });
        const users = await this.notifications.usersForEmployees([
            r.approverEmployeeId
        ]);
        await this.notifications.notify({
            userIds: users,
            type: 'leave.withdrawn',
            title: `${r.employee.fullName} withdrew a time-off request`,
            body: `${r.leaveType.name} · ${(0, _leavecommon.requestDatesLabel)(r.fromDate, r.toDate, r.halfDay)}`,
            link: '/leave?tab=team',
            from: r.employee.fullName
        });
        this.events.emit('leave.decided', {
            requestId: r.id,
            employeeId: r.employeeId,
            status: 'WITHDRAWN'
        });
        return (await this.rows([
            await this.prisma.leaveRequest.findUniqueOrThrow({
                where: {
                    id
                },
                include: _leavecommon.requestInclude
            })
        ]))[0];
    }
    /** Owner cancel: pending → withdraw; approved future → cancel; approved started → cancellation request. HR cancels directly. */ async cancel(id, reason) {
        const r = await this.load(id);
        const ctx = (0, _requestcontext.requireContext)();
        const isHr = (0, _decorators.hasPerm)(ctx, 'leave.manage');
        const own = r.employeeId === ctx.employeeId;
        if (!own && !isHr) throw (0, _errors.forbidden)();
        if (r.status === 'PENDING' && own) return this.withdraw(id);
        if (r.status !== 'APPROVED') throw new _errors.AppError(409, 'LEAVE_STATE', 'Only approved requests can be cancelled');
        if (isHr || (0, _dates.dk)(r.fromDate) > (0, _dates.todayKey)()) return this.doCancel(r, reason);
        await this.prisma.leaveRequest.update({
            where: {
                id
            },
            data: {
                status: 'CANCELLATION_PENDING',
                cancelReason: reason || null,
                cancelRequestedAt: new Date(),
                version: {
                    increment: 1
                }
            }
        });
        await this.audit.record({
            action: 'leave.request.cancel_requested',
            entity: 'LeaveRequest',
            entityId: r.id,
            meta: {
                reason: reason ?? null
            }
        });
        const users = await this.notifications.usersForEmployees([
            r.approverEmployeeId
        ]);
        await this.notifications.notify({
            userIds: users,
            type: 'leave.cancel_requested',
            title: `${r.employee.fullName} asked to cancel approved leave`,
            body: `${r.leaveType.name} · ${(0, _leavecommon.requestDatesLabel)(r.fromDate, r.toDate, r.halfDay)}${reason ? ` · ${reason}` : ''}`,
            link: '/leave?tab=team',
            from: r.employee.fullName,
            email: true
        });
        return (await this.rows([
            await this.prisma.leaveRequest.findUniqueOrThrow({
                where: {
                    id
                },
                include: _leavecommon.requestInclude
            })
        ]))[0];
    }
    async decideCancellation(id, approve) {
        const r = await this.load(id);
        if (r.status !== 'CANCELLATION_PENDING') throw new _errors.AppError(409, 'LEAVE_STATE', 'No cancellation is pending on this request');
        this.assertDecider(r);
        if (approve) return this.doCancel(r, r.cancelReason ?? undefined);
        await this.prisma.leaveRequest.update({
            where: {
                id
            },
            data: {
                status: 'APPROVED',
                version: {
                    increment: 1
                }
            }
        });
        await this.audit.record({
            action: 'leave.request.cancel_rejected',
            entity: 'LeaveRequest',
            entityId: r.id
        });
        const users = await this.notifications.usersForEmployees([
            r.employeeId
        ]);
        await this.notifications.notify({
            userIds: users,
            type: 'leave.decided',
            title: 'Your cancellation request was declined',
            body: `${r.leaveType.name} · ${(0, _leavecommon.requestDatesLabel)(r.fromDate, r.toDate, r.halfDay)} stays approved`,
            link: '/leave'
        });
        return (await this.rows([
            await this.prisma.leaveRequest.findUniqueOrThrow({
                where: {
                    id
                },
                include: _leavecommon.requestInclude
            })
        ]))[0];
    }
    async doCancel(r, reason) {
        const today = (0, _dates.todayKey)();
        const days = await this.prisma.leaveRequestDay.findMany({
            where: {
                requestId: r.id,
                active: true
            }
        });
        await this.prisma.leaveRequestDay.updateMany({
            where: {
                requestId: r.id
            },
            data: {
                active: false
            }
        });
        // Comp-off consumption reversal (only restorable while the grant is unexpired).
        const cons = await this.prisma.compOffConsumption.findMany({
            where: {
                requestId: r.id,
                reversedAt: null
            }
        });
        let expiredUnits = 0;
        for (const c of cons){
            const g = await this.prisma.compOffGrant.findUnique({
                where: {
                    id: c.grantId
                }
            });
            await this.prisma.compOffConsumption.update({
                where: {
                    id: c.id
                },
                data: {
                    reversedAt: new Date()
                }
            });
            if (!g) continue;
            if ((0, _dates.dk)(g.expiresOn) >= today) {
                const remaining = (0, _leavecalc.round2)(g.remaining + c.units);
                await this.prisma.compOffGrant.update({
                    where: {
                        id: g.id
                    },
                    data: {
                        remaining,
                        status: remaining >= g.units ? 'APPROVED' : 'PARTIALLY_USED'
                    }
                });
            } else expiredUnits += c.units;
        }
        const paidByYear = new Map();
        for (const d of days)if (d.isPaid) paidByYear.set(d.leaveYear, (paidByYear.get(d.leaveYear) ?? 0) + d.units);
        if (r.leaveType.isPaid) {
            const entries = [
                ...paidByYear
            ].map(([y, u])=>({
                    employeeId: r.employeeId,
                    leaveTypeId: r.leaveTypeId,
                    leaveYear: y,
                    txType: 'AVAIL_REVERSAL',
                    days: u,
                    effectiveDate: today,
                    requestId: r.id,
                    note: `Cancelled ${r.requestNo}`
                }));
            // Comp-off from an already-expired grant is not restored: the reversal is offset by an expiry.
            if (expiredUnits > 0) entries.push({
                employeeId: r.employeeId,
                leaveTypeId: r.leaveTypeId,
                leaveYear: (0, _dates.yearOf)(today),
                txType: 'EXPIRY',
                days: -(0, _leavecalc.round2)(expiredUnits),
                effectiveDate: today,
                requestId: r.id,
                note: 'Grant expired before cancellation'
            });
            await this.ledger.post(entries);
        }
        await this.prisma.leaveRequest.update({
            where: {
                id: r.id
            },
            data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                cancelReason: reason ?? r.cancelReason,
                version: {
                    increment: 1
                }
            }
        });
        await this.recomputeYears(r.employeeId, r.leaveTypeId, days.map((d)=>({
                date: (0, _dates.dk)(d.date)
            })));
        await this.markPayrollStale(r.employeeId, days.map((d)=>(0, _dates.dk)(d.date)));
        await this.audit.record({
            action: 'leave.request.cancelled',
            entity: 'LeaveRequest',
            entityId: r.id,
            meta: {
                reason: reason ?? null
            }
        });
        const ctx = (0, _requestcontext.requireContext)();
        const notifyIds = ctx.employeeId === r.employeeId ? [
            r.approverEmployeeId
        ] : [
            r.employeeId
        ];
        const users = await this.notifications.usersForEmployees(notifyIds);
        await this.notifications.notify({
            userIds: users,
            type: 'leave.cancelled',
            title: `Time off cancelled: ${r.employee.fullName}`,
            body: `${r.leaveType.name} · ${(0, _leavecommon.requestDatesLabel)(r.fromDate, r.toDate, r.halfDay)}`,
            link: '/leave',
            from: ctx.userName ?? 'System'
        });
        this.events.emit('leave.decided', {
            requestId: r.id,
            employeeId: r.employeeId,
            status: 'CANCELLED'
        });
        return (await this.rows([
            await this.prisma.leaveRequest.findUniqueOrThrow({
                where: {
                    id: r.id
                },
                include: _leavecommon.requestInclude
            })
        ]))[0];
    }
    // ── team / admin lists ────────────────────────────────────────────────
    /** Scope of employees whose requests the viewer may decide: HR → everyone; approver → reports tree + requests routed to them. */ async teamWhere() {
        const ctx = (0, _requestcontext.requireContext)();
        const me = ctx.employeeId ?? '__none__';
        if ((0, _decorators.hasPerm)(ctx, 'leave.manage')) return {
            employeeId: {
                not: me
            }
        };
        const tree = await this.org.reportTree(me);
        return {
            OR: [
                {
                    approverEmployeeId: me
                },
                {
                    employeeId: {
                        in: tree
                    }
                }
            ],
            employeeId: {
                not: me
            }
        };
    }
    async teamRequests(tab) {
        const ctx = (0, _requestcontext.requireContext)();
        if (!(0, _decorators.hasPerm)(ctx, 'leave.approve') && !(0, _decorators.hasPerm)(ctx, 'leave.manage')) throw (0, _errors.forbidden)();
        const scope = await this.teamWhere();
        const where = tab === 'PENDING' ? {
            AND: [
                scope,
                {
                    status: {
                        in: [
                            'PENDING',
                            'CANCELLATION_PENDING'
                        ]
                    }
                }
            ]
        } : {
            AND: [
                scope,
                {
                    status: {
                        notIn: [
                            'PENDING',
                            'CANCELLATION_PENDING'
                        ]
                    }
                },
                {
                    fromDate: {
                        gte: (0, _dates.dd)((0, _dates.addDays)((0, _dates.todayKey)(), -90))
                    }
                }
            ]
        };
        const reqs = await this.prisma.leaveRequest.findMany({
            where,
            include: {
                ..._leavecommon.requestInclude,
                leaveType: true
            },
            orderBy: tab === 'PENDING' ? {
                createdAt: 'asc'
            } : {
                fromDate: 'desc'
            },
            take: 100
        });
        const rows = await this.rows(reqs);
        const out = [];
        for(let i = 0; i < reqs.length; i++){
            const r = reqs[i];
            const bal = r.leaveType.isPaid ? r.leaveType.isCompOff ? (await this.compOffAvailable(r.employeeId, (0, _dates.todayKey)(), r.leaveTypeId)).available : await this.balanceAvailable(r.employeeId, r.leaveTypeId, (0, _dates.yearOf)((0, _dates.dk)(r.fromDate))) : null;
            out.push({
                ...rows[i],
                kind: 'LEAVE',
                balanceAfter: bal,
                teamOverlap: tab === 'PENDING' ? await this.teamOverlap(r.employeeId, (0, _dates.dk)(r.fromDate), (0, _dates.dk)(r.toDate)) : 0,
                evidence: null
            });
        }
        // Pending comp-off credit requests routed to me (or all for HR).
        if (tab === 'PENDING') {
            const me = ctx.employeeId ?? '__none__';
            const grants = await this.prisma.compOffGrant.findMany({
                where: {
                    status: 'PENDING',
                    employeeId: {
                        not: me
                    },
                    ...(0, _decorators.hasPerm)(ctx, 'leave.manage') ? {} : {
                        approverEmployeeId: me
                    }
                },
                include: {
                    employee: {
                        select: {
                            fullName: true,
                            empCode: true,
                            department: {
                                select: {
                                    name: true
                                }
                            }
                        }
                    }
                },
                orderBy: {
                    createdAt: 'asc'
                }
            });
            const coType = await this.prisma.leaveType.findFirst({
                where: {
                    isCompOff: true
                }
            });
            for (const g of grants){
                out.push({
                    id: g.id,
                    requestNo: 'Comp-off credit',
                    employeeId: g.employeeId,
                    employeeName: g.employee.fullName,
                    employeeCode: g.employee.empCode,
                    department: g.employee.department?.name ?? null,
                    leaveTypeId: coType?.id ?? '',
                    typeCode: 'CO',
                    typeName: 'Comp-off credit',
                    fromDate: (0, _dates.dk)(g.workedDate),
                    toDate: (0, _dates.dk)(g.workedDate),
                    dates: `Worked ${(0, _dates.dayMonth)((0, _dates.dk)(g.workedDate))}`,
                    days: g.units,
                    lopDays: 0,
                    reason: g.reason,
                    status: 'PENDING',
                    statusLabel: 'Pending RM',
                    approverId: g.approverEmployeeId,
                    approverName: null,
                    appliedOn: g.createdAt.toISOString(),
                    decidedAt: null,
                    decisionNote: null,
                    can: {
                        withdraw: false,
                        cancel: false,
                        requestCancel: false,
                        approve: true,
                        reject: true,
                        decideCancellation: false
                    },
                    kind: 'COMP_OFF',
                    balanceAfter: null,
                    teamOverlap: 0,
                    evidence: g.workedMinutes ? `Worked ${Math.floor(g.workedMinutes / 60)}h ${String(g.workedMinutes % 60).padStart(2, '0')}m` : null
                });
            }
        }
        return out;
    }
    async pendingCountFor(employeeId) {
        const [a, b] = await Promise.all([
            this.prisma.leaveRequest.count({
                where: {
                    approverEmployeeId: employeeId,
                    status: {
                        in: [
                            'PENDING',
                            'CANCELLATION_PENDING'
                        ]
                    },
                    employeeId: {
                        not: employeeId
                    }
                }
            }),
            this.prisma.compOffGrant.count({
                where: {
                    approverEmployeeId: employeeId,
                    status: 'PENDING'
                }
            })
        ]);
        return a + b;
    }
    async adminRequests(q) {
        if (!(0, _decorators.hasPerm)((0, _requestcontext.requireContext)(), 'leave.manage')) throw (0, _errors.forbidden)();
        const base = {};
        if (q.leaveTypeId) base.leaveTypeId = q.leaveTypeId;
        if (q.departmentId) base.employee = {
            departmentId: q.departmentId
        };
        if (q.q) base.OR = [
            {
                employee: {
                    fullName: {
                        contains: q.q,
                        mode: 'insensitive'
                    }
                }
            },
            {
                employee: {
                    empCode: {
                        contains: q.q,
                        mode: 'insensitive'
                    }
                }
            },
            {
                requestNo: {
                    contains: q.q,
                    mode: 'insensitive'
                }
            }
        ];
        if (q.from) base.toDate = {
            gte: (0, _dates.dd)(q.from)
        };
        if (q.to) base.fromDate = {
            lte: (0, _dates.dd)(q.to)
        };
        if (q.year) base.AND = [
            {
                fromDate: {
                    gte: (0, _dates.dd)(`${q.year}-01-01`),
                    lte: (0, _dates.dd)(`${q.year}-12-31`)
                }
            }
        ];
        const where = {
            ...base,
            ...q.status ? {
                status: {
                    in: q.status.split(',')
                }
            } : {}
        };
        const [total, reqs, grouped] = await Promise.all([
            this.prisma.leaveRequest.count({
                where
            }),
            this.prisma.leaveRequest.findMany({
                where,
                include: _leavecommon.requestInclude,
                orderBy: [
                    {
                        fromDate: 'desc'
                    }
                ],
                skip: (q.page - 1) * q.pageSize,
                take: q.pageSize
            }),
            this.prisma.leaveRequest.groupBy({
                by: [
                    'status'
                ],
                where: base,
                _count: {
                    _all: true
                }
            })
        ]);
        const counts = {
            ALL: 0
        };
        for (const g of grouped){
            counts[g.status] = g._count._all;
            counts.ALL += g._count._all;
        }
        return {
            items: await this.rows(reqs),
            total,
            page: q.page,
            pageSize: q.pageSize,
            counts
        };
    }
    /** Dates (YYYY-MM-DD) of an employee's approved leave in a range, with units and paid flag (used by payroll). */ async approvedDays(employeeIds, from, to) {
        const rows = await this.prisma.leaveRequestDay.findMany({
            where: {
                employeeId: {
                    in: employeeIds
                },
                active: true,
                date: {
                    gte: (0, _dates.dd)(from),
                    lte: (0, _dates.dd)(to)
                }
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
        });
        return rows.map((r)=>({
                employeeId: r.employeeId,
                date: (0, _dates.dk)(r.date),
                units: r.units,
                isPaid: r.isPaid,
                dayKind: r.dayKind,
                code: r.request.leaveType.code
            }));
    }
    /** Every date an employee is (going to be) on leave — for "On leave today" consumers. */ async onLeave(employeeId, date = (0, _dates.todayKey)()) {
        const d = await this.prisma.leaveRequestDay.findFirst({
            where: {
                employeeId,
                date: (0, _dates.dd)(date),
                active: true
            },
            include: {
                request: {
                    include: {
                        leaveType: true
                    }
                }
            }
        });
        return d ? {
            onLeave: true,
            session: d.session,
            type: d.request.leaveType.name
        } : {
            onLeave: false
        };
    }
    eachRequestDay(from, to) {
        return (0, _dates.eachDay)(from, to);
    }
};
LeaveRequestsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _leaveledgerservice.LeaveLedgerService === "undefined" ? Object : _leaveledgerservice.LeaveLedgerService,
        typeof _calendarservice.WorkCalendarService === "undefined" ? Object : _calendarservice.WorkCalendarService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _sequenceservice.SequenceService === "undefined" ? Object : _sequenceservice.SequenceService,
        typeof _settingsservice.SettingsService === "undefined" ? Object : _settingsservice.SettingsService,
        typeof _orgservice.OrgService === "undefined" ? Object : _orgservice.OrgService
    ])
], LeaveRequestsService);

//# sourceMappingURL=leave-requests.service.js.map