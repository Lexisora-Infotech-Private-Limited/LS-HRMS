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
    get TimesheetService () {
        return TimesheetService;
    },
    get defaultWeekStart () {
        return defaultWeekStart;
    },
    get submitOpen () {
        return submitOpen;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _eventsservice = require("../../../core/registry/events.service");
const _orgservice = require("../../../core/org/org.service");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _cross = require("../cross");
const _daycalc = require("../lib/day-calc");
const _routing = require("../lib/routing");
const _timesheetcalc = require("../lib/timesheet-calc");
const _timeutils = require("../lib/time-utils");
const _periodlockservice = require("./period-lock.service");
const _policyservice = require("./policy.service");
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
const ACTIVE = [
    'ACTIVE',
    'NOTICE_PERIOD'
];
const L1_SLA_HOURS = 48;
function defaultWeekStart(today) {
    const monday = (0, _timeutils.mondayOf)(today);
    const dow = (0, _timeutils.dateOf)(today).getUTCDay();
    return dow === 1 || dow === 2 ? (0, _timeutils.addDays)(monday, -7) : monday;
}
function submitOpen(weekStart, now) {
    const today = (0, _timeutils.istKeyOf)(now);
    const weekEnd = (0, _timeutils.addDays)(weekStart, 6);
    if (today > weekEnd) return true;
    return now.getTime() >= (0, _timeutils.istInstant)((0, _timeutils.addDays)(weekStart, 4), 15 * 60).getTime();
}
let TimesheetService = class TimesheetService {
    prisma;
    policies;
    locks;
    cross;
    audit;
    notifications;
    realtime;
    events;
    org;
    log = new _common.Logger('Timesheets');
    constructor(prisma, policies, locks, cross, audit, notifications, realtime, events, org){
        this.prisma = prisma;
        this.policies = policies;
        this.locks = locks;
        this.cross = cross;
        this.audit = audit;
        this.notifications = notifications;
        this.realtime = realtime;
        this.events = events;
        this.org = org;
    }
    // ── loading ──────────────────────────────────────────────────────────────
    async load(id) {
        const ts = await this.prisma.timesheet.findFirst({
            where: {
                id
            },
            include: {
                lines: {
                    include: {
                        cells: true
                    },
                    orderBy: [
                        {
                            sortOrder: 'asc'
                        },
                        {
                            createdAt: 'asc'
                        }
                    ]
                }
            }
        });
        if (!ts) throw (0, _errors.notFound)('Timesheet');
        return ts;
    }
    async getOrCreate(employeeId, weekStart) {
        const ws = (0, _timeutils.mondayOf)(weekStart);
        const existing = await this.prisma.timesheet.findFirst({
            where: {
                employeeId,
                weekStart: (0, _timeutils.dateOf)(ws)
            }
        });
        if (existing) return existing;
        try {
            return await this.prisma.timesheet.create({
                data: {
                    employeeId,
                    weekStart: (0, _timeutils.dateOf)(ws),
                    weekEnd: (0, _timeutils.dateOf)((0, _timeutils.addDays)(ws, 6)),
                    status: 'DRAFT'
                }
            });
        } catch  {
            return await this.prisma.timesheet.findFirst({
                where: {
                    employeeId,
                    weekStart: (0, _timeutils.dateOf)(ws)
                }
            });
        }
    }
    // ── projection from tracker segments ────────────────────────────────────
    /**
   * Rebuild tracked / idle-as-work / pending-idle minutes and the idle row from tracker
   * ActivitySegments (WORK + approved IDLE_WORK). Submitted sheets keep their snapshot; late
   * data only raises the "late data" banner for approvers.
   */ async rebuild(ts) {
        const from = (0, _timeutils.keyOf)(ts.weekStart);
        const to = (0, _timeutils.keyOf)(ts.weekEnd);
        const segs = await this.cross.segments(ts.employeeId, from, to);
        if (!(0, _timesheetcalc.isEditableStatus)(ts.status)) {
            if (segs.length && ts.submittedAt && segs.some((s)=>s.createdAt && s.createdAt > ts.submittedAt) && !ts.hasLateData) {
                return this.prisma.timesheet.update({
                    where: {
                        id: ts.id
                    },
                    data: {
                        hasLateData: true
                    }
                });
            }
            return ts;
        }
        if (!segs.length) return this.refreshTotals(ts.id);
        const claims = await this.cross.idleClaims(ts.employeeId, from, to);
        const claimBySeg = new Map();
        for (const c of claims)if (c.segmentId) claimBySeg.set(c.segmentId, c.status);
        const groups = new Map();
        const idle = new Map();
        const add = (s, field, min)=>{
            const key = s.taskId ? `t:${s.taskId}` : s.projectId ? `p:${s.projectId}` : 'general';
            const g = groups.get(key) ?? {
                taskId: s.taskId ?? null,
                projectId: s.projectId ?? null,
                days: new Map()
            };
            const day = (0, _timeutils.keyOf)(s.workDate);
            const acc = g.days.get(day) ?? {
                tracked: 0,
                idleAsWork: 0,
                pending: 0
            };
            acc[field] += min;
            g.days.set(day, acc);
            groups.set(key, g);
        };
        for (const s of segs){
            const min = Math.round(s.durationSec / 60);
            if (min <= 0) continue;
            const day = (0, _timeutils.keyOf)(s.workDate);
            if (s.kind === 'WORK') add(s, 'tracked', min);
            else if (s.kind === 'IDLE_WORK' || s.kind === 'IDLE' && s.idleResolution === 'CLAIMED_WORK') {
                const st = claimBySeg.get(s.id) ?? 'PENDING';
                if (st === 'APPROVED') add(s, 'idleAsWork', min);
                else if (st === 'PENDING') add(s, 'pending', min);
                else idle.set(day, (idle.get(day) ?? 0) + min);
            } else if (s.kind === 'IDLE' && s.idleResolution !== 'AS_BREAK') idle.set(day, (idle.get(day) ?? 0) + min);
        }
        const full = await this.load(ts.id);
        const taskIds = [
            ...groups.values()
        ].map((g)=>g.taskId).filter((x)=>!!x);
        const tasks = await this.cross.taskMap(taskIds);
        const projectIds = [
            ...new Set([
                ...[
                    ...groups.values()
                ].map((g)=>g.projectId),
                ...[
                    ...tasks.values()
                ].map((t)=>t.projectId)
            ].filter((x)=>!!x))
        ];
        const projects = await this.cross.projectMap(projectIds);
        const tenantId = (0, _requestcontext.currentTenantId)();
        const lines = [
            ...full.lines
        ];
        let sort = lines.reduce((m, l)=>Math.max(m, l.sortOrder), 0);
        const lineFor = async (g)=>{
            let line = g.taskId ? lines.find((l)=>l.taskId === g.taskId) : g.projectId ? lines.find((l)=>!l.taskId && l.projectId === g.projectId && !l.isManual) : lines.find((l)=>!l.taskId && !l.projectId && !l.isManual);
            if (line) return line;
            const task = g.taskId ? tasks.get(g.taskId) : undefined;
            const projectId = task?.projectId ?? g.projectId ?? null;
            const project = projectId ? projects.get(projectId) : undefined;
            const created = await this.prisma.timesheetLine.create({
                data: {
                    tenantId,
                    timesheetId: ts.id,
                    taskId: g.taskId,
                    projectId,
                    label: task ? `${task.key} ${task.title}` : project?.name ?? 'General',
                    subLabel: project ? project.isInternal ? 'Internal' : `${project.name}${task?.moduleName ? ` · ${task.moduleName}` : ''}` : null,
                    billable: !!project && project.billable && !project.isInternal,
                    isManual: false,
                    sortOrder: ++sort
                }
            });
            const withCells = {
                ...created,
                cells: []
            };
            lines.push(withCells);
            return withCells;
        };
        const target = new Map(); // lineId → day → acc
        for (const g of groups.values()){
            const line = await lineFor(g);
            const m = target.get(line.id) ?? new Map();
            for (const [d, acc] of g.days){
                const prev = m.get(d) ?? {
                    tracked: 0,
                    idleAsWork: 0,
                    pending: 0
                };
                m.set(d, {
                    tracked: prev.tracked + acc.tracked,
                    idleAsWork: prev.idleAsWork + acc.idleAsWork,
                    pending: prev.pending + acc.pending
                });
            }
            target.set(line.id, m);
        }
        const days = (0, _timeutils.daysBetween)(from, to);
        for (const line of lines){
            const m = target.get(line.id);
            for (const d of days){
                const acc = m?.get(d) ?? {
                    tracked: 0,
                    idleAsWork: 0,
                    pending: 0
                };
                const cell = line.cells.find((c)=>(0, _timeutils.keyOf)(c.date) === d);
                if (!cell) {
                    if (!acc.tracked && !acc.idleAsWork && !acc.pending) continue;
                    await this.prisma.timesheetCell.create({
                        data: {
                            tenantId,
                            lineId: line.id,
                            date: (0, _timeutils.dateOf)(d),
                            trackedMinutes: acc.tracked,
                            idleAsWorkMinutes: acc.idleAsWork,
                            pendingIdleMinutes: acc.pending,
                            finalMinutes: (0, _timesheetcalc.cellFinal)({
                                trackedMinutes: acc.tracked,
                                idleAsWorkMinutes: acc.idleAsWork,
                                outsideHoursMinutes: 0,
                                adjustmentMinutes: 0
                            })
                        }
                    });
                } else if (cell.trackedMinutes !== acc.tracked || cell.idleAsWorkMinutes !== acc.idleAsWork || cell.pendingIdleMinutes !== acc.pending) {
                    await this.prisma.timesheetCell.update({
                        where: {
                            id: cell.id
                        },
                        data: {
                            trackedMinutes: acc.tracked,
                            idleAsWorkMinutes: acc.idleAsWork,
                            pendingIdleMinutes: acc.pending,
                            finalMinutes: (0, _timesheetcalc.cellFinal)({
                                trackedMinutes: acc.tracked,
                                idleAsWorkMinutes: acc.idleAsWork,
                                outsideHoursMinutes: cell.outsideHoursMinutes,
                                adjustmentMinutes: cell.adjustmentMinutes
                            })
                        }
                    });
                }
            }
        }
        for (const d of days){
            const minutes = idle.get(d) ?? 0;
            const existing = await this.prisma.timesheetIdleDay.findFirst({
                where: {
                    timesheetId: ts.id,
                    date: (0, _timeutils.dateOf)(d)
                }
            });
            if (existing) {
                if (existing.idleMinutes !== minutes) await this.prisma.timesheetIdleDay.update({
                    where: {
                        id: existing.id
                    },
                    data: {
                        idleMinutes: minutes
                    }
                });
            } else if (minutes) await this.prisma.timesheetIdleDay.create({
                data: {
                    tenantId,
                    timesheetId: ts.id,
                    date: (0, _timeutils.dateOf)(d),
                    idleMinutes: minutes
                }
            });
        }
        return this.refreshTotals(ts.id);
    }
    /** Re-sum a sheet's totals (after edits / rebuilds / decisions). */ async refreshTotals(id) {
        const ts = await this.load(id);
        const idleDays = await this.prisma.timesheetIdleDay.findMany({
            where: {
                timesheetId: id
            }
        });
        const cells = ts.lines.flatMap((l)=>l.cells);
        const shots = await this.cross.screenshotCount(ts.employeeId, (0, _timeutils.keyOf)(ts.weekStart), (0, _timeutils.keyOf)(ts.weekEnd));
        return this.prisma.timesheet.update({
            where: {
                id
            },
            data: {
                totalMinutes: cells.reduce((s, c)=>s + c.finalMinutes, 0),
                trackedMinutes: cells.reduce((s, c)=>s + c.trackedMinutes, 0),
                adjustmentMinutes: cells.reduce((s, c)=>s + c.adjustmentMinutes, 0),
                outsideHoursMinutes: cells.reduce((s, c)=>s + c.outsideHoursMinutes, 0),
                idleAsWorkMinutes: cells.reduce((s, c)=>s + c.idleAsWorkMinutes, 0),
                idleMinutes: idleDays.reduce((s, d)=>s + d.idleMinutes, 0),
                screenshotCount: shots || ts.screenshotCount
            }
        });
    }
    /** Called on tracker.segmentsIngested / idle.claimDecided. */ async rebuildForDates(employeeId, dates) {
        const weeks = [
            ...new Set(dates.map((d)=>(0, _timeutils.mondayOf)(d)))
        ];
        for (const w of weeks){
            const ts = await this.prisma.timesheet.findFirst({
                where: {
                    employeeId,
                    weekStart: (0, _timeutils.dateOf)(w)
                }
            });
            if (ts) await this.rebuild(ts);
            else if (w <= (0, _timeutils.istKeyOf)(new Date())) await this.rebuild(await this.getOrCreate(employeeId, w));
        }
    }
    // ── read model ───────────────────────────────────────────────────────────
    async myWeek(weekStart) {
        const employeeId = this.org.myEmployeeId();
        const ws = weekStart ? (0, _timeutils.mondayOf)(weekStart) : defaultWeekStart((0, _timeutils.istKeyOf)(new Date()));
        const ts = await this.rebuild(await this.getOrCreate(employeeId, ws));
        return this.weekDto(ts.id, {
            owner: true
        });
    }
    async weekFor(ctx, employeeId, weekStart) {
        await this.assertCanView(ctx, employeeId);
        const ts = await this.prisma.timesheet.findFirst({
            where: {
                employeeId,
                weekStart: (0, _timeutils.dateOf)((0, _timeutils.mondayOf)(weekStart))
            }
        });
        if (!ts) throw (0, _errors.notFound)('Timesheet');
        return this.weekDto(ts.id, {
            owner: employeeId === ctx.employeeId
        });
    }
    async weekDto(id, opts) {
        const ts = await this.load(id);
        const from = (0, _timeutils.keyOf)(ts.weekStart);
        const to = (0, _timeutils.keyOf)(ts.weekEnd);
        const now = new Date();
        const today = (0, _timeutils.istKeyOf)(now);
        const emp = await this.policies.employee(ts.employeeId);
        if (!emp) throw (0, _errors.notFound)('Employee');
        const [shiftRow, holidays, idleDays, ohRows, adjustments, steps] = await Promise.all([
            this.policies.shiftFor(emp, from),
            this.policies.holidaysBetween(from, to),
            this.prisma.timesheetIdleDay.findMany({
                where: {
                    timesheetId: id
                }
            }),
            this.prisma.outsideHoursEntry.findMany({
                where: {
                    timesheetId: id
                },
                orderBy: [
                    {
                        date: 'asc'
                    },
                    {
                        startAt: 'asc'
                    }
                ]
            }),
            this.prisma.timesheetAdjustment.findMany({
                where: {
                    timesheetId: id
                },
                orderBy: {
                    createdAt: 'desc'
                }
            }),
            this.prisma.timesheetApprovalStep.findMany({
                where: {
                    timesheetId: id,
                    cycle: ts.cycle
                }
            })
        ]);
        const shift = (0, _policyservice.toShiftLike)(shiftRow);
        const editable = opts.owner && (0, _timesheetcalc.isEditableStatus)(ts.status);
        const days = [];
        for (const d of (0, _timeutils.daysBetween)(from, to)){
            days.push({
                date: d,
                dow: _timeutils.DOW_SHORT[(0, _timeutils.dateOf)(d).getUTCDay()],
                label: (0, _timeutils.dm)(d),
                future: d > today,
                weeklyOff: (0, _daycalc.isWeeklyOff)(d, shift),
                holiday: this.policies.holidayName(holidays, d, emp.workLocationId),
                locked: await this.locks.isLocked(d)
            });
        }
        const scoped = opts.scopeProjectId !== undefined;
        const allLines = ts.lines;
        const inScope = (l)=>!scoped || l.projectId === opts.scopeProjectId;
        const lines = allLines.filter(inScope).map((l)=>{
            const cells = days.map((day)=>{
                const c = l.cells.find((x)=>(0, _timeutils.keyOf)(x.date) === day.date);
                const adj = c ? adjustments.find((a)=>a.cellId === c.id) : undefined;
                return {
                    date: day.date,
                    final: c?.finalMinutes ?? 0,
                    tracked: c?.trackedMinutes ?? 0,
                    adjustment: c?.adjustmentMinutes ?? 0,
                    outsideHours: c?.outsideHoursMinutes ?? 0,
                    idleAsWork: c?.idleAsWorkMinutes ?? 0,
                    pendingIdle: c?.pendingIdleMinutes ?? 0,
                    adjusted: !!c && c.adjustmentMinutes !== 0,
                    adjustmentReason: adj?.reason ?? null,
                    ohPending: ohRows.some((o)=>o.lineId === l.id && (0, _timeutils.keyOf)(o.date) === day.date && o.reviewStatus === 'PENDING_PL'),
                    editable: editable && !day.future && !day.locked,
                    outOfPeriod: false
                };
            });
            return {
                id: l.id,
                label: l.label,
                subLabel: l.subLabel,
                projectId: l.projectId,
                taskId: l.taskId,
                billable: l.billable,
                isManual: l.isManual,
                total: cells.reduce((s, c)=>s + c.final, 0),
                cells
            };
        });
        const idleRow = days.map((d)=>idleDays.find((x)=>(0, _timeutils.keyOf)(x.date) === d.date)?.idleMinutes ?? 0);
        const dayTotals = days.map((_, i)=>lines.reduce((s, l)=>s + l.cells[i].final, 0));
        const projectIds = [
            ...new Set(allLines.map((l)=>l.projectId).filter((x)=>!!x))
        ];
        const projects = await this.cross.projectMap([
            ...projectIds,
            ...ohRows.map((o)=>o.projectId).filter((x)=>!!x)
        ]);
        const l1Steps = steps.filter((s)=>s.level === 1 && s.status !== 'CANCELLED');
        const leadIds = l1Steps.length ? l1Steps.map((s)=>s.approverEmployeeId) : [
            ...projects.values()
        ].filter((p)=>!p.isInternal && p.leadEmployeeId && p.leadEmployeeId !== ts.employeeId).map((p)=>p.leadEmployeeId);
        const l2 = steps.find((s)=>s.level === 2 && s.status !== 'CANCELLED');
        const nameIds = [
            ...new Set([
                ...leadIds,
                ...l2 ? [
                    l2.approverEmployeeId
                ] : emp.managerId ? [
                    emp.managerId
                ] : []
            ])
        ];
        const names = new Map((await this.prisma.employee.findMany({
            where: {
                id: {
                    in: nameIds
                }
            },
            select: {
                id: true,
                fullName: true
            }
        })).map((e)=>[
                e.id,
                e.fullName
            ]));
        const plNames = [
            ...new Set(leadIds.map((x)=>names.get(x)).filter((x)=>!!x))
        ];
        const rmName = names.get(l2?.approverEmployeeId ?? emp.managerId ?? '') ?? null;
        const tones = (0, _timesheetcalc.chainTones)(ts.status);
        const chain = [
            {
                key: 'employee',
                label: 'Employee',
                tone: tones[0],
                tooltip: emp.fullName
            },
            {
                key: 'pl',
                label: 'Project Lead',
                tone: tones[1],
                tooltip: plNames.join(', ') || 'No project lead review (internal work)'
            },
            {
                key: 'rm',
                label: 'Reporting Manager',
                tone: tones[2],
                tooltip: rmName ?? undefined
            },
            {
                key: 'payroll',
                label: 'Payroll',
                tone: tones[3]
            }
        ];
        const hasTrackerData = lines.some((l)=>l.cells.some((c)=>c.tracked > 0 || c.idleAsWork > 0 || c.pendingIdle > 0)) || idleRow.some((x)=>x > 0);
        const outsideHours = ohRows.filter((o)=>!scoped || o.projectId === opts.scopeProjectId).map((o)=>({
                id: o.id,
                date: (0, _timeutils.keyOf)(o.date),
                dateLabel: (0, _timeutils.dayLabel)((0, _timeutils.keyOf)(o.date)),
                from: (0, _timeutils.istHm)(o.startAt),
                to: (0, _timeutils.istHm)(o.endAt),
                minutes: o.minutes,
                taskText: o.taskText,
                projectId: o.projectId,
                projectName: o.projectId ? projects.get(o.projectId)?.name ?? null : null,
                reason: o.reason,
                reviewStatus: o.reviewStatus
            }));
        const totals = {
            worked: lines.reduce((s, l)=>s + l.total, 0),
            idle: idleRow.reduce((s, x)=>s + x, 0),
            tracked: lines.reduce((s, l)=>s + l.cells.reduce((a, c)=>a + c.tracked, 0), 0),
            adjustments: lines.reduce((s, l)=>s + l.cells.reduce((a, c)=>a + c.adjustment, 0), 0),
            outsideHours: lines.reduce((s, l)=>s + l.cells.reduce((a, c)=>a + c.outsideHours, 0), 0),
            idleAsWork: lines.reduce((s, l)=>s + l.cells.reduce((a, c)=>a + c.idleAsWork, 0), 0)
        };
        const status = ts.status;
        const actedSteps = steps.filter((s)=>s.status === 'APPROVED' || s.status === 'RETURNED');
        return {
            id: ts.id,
            employee: {
                id: emp.id,
                name: emp.fullName
            },
            weekStart: from,
            weekEnd: to,
            label: (0, _timeutils.weekLabel)(from, to),
            shortLabel: (0, _timeutils.weekLabel)(from, to, true),
            status,
            statusLabel: _shared.TIMESHEET_STATUS_LABEL[status],
            editable,
            days,
            lines,
            idleRow,
            dayTotals,
            totals,
            chain,
            returned: ts.status === 'RETURNED' && ts.returnedComment ? {
                by: ts.returnedByName,
                comment: ts.returnedComment
            } : null,
            outsideHours,
            version: ts.version,
            submitLabel: (0, _timesheetcalc.submitLabel)(ts.status),
            canSubmit: editable && submitOpen(from, now),
            canRecall: opts.owner && ts.status === 'SUBMITTED' && actedSteps.length === 0,
            hasTrackerData,
            screenshotCount: ts.screenshotCount,
            plNames
        };
    }
    // ── employee edits ──────────────────────────────────────────────────────
    async ownedEditable(id, expectedVersion) {
        const me = this.org.myEmployeeId();
        const ts = await this.load(id);
        if (ts.employeeId !== me) throw (0, _errors.forbidden)('You can only edit your own timesheet');
        if (!(0, _timesheetcalc.isEditableStatus)(ts.status)) throw new _errors.AppError(409, 'TIMESHEET_NOT_EDITABLE', 'This timesheet has been submitted · recall it to make changes');
        if (expectedVersion !== undefined && expectedVersion !== ts.version) throw new _errors.AppError(409, 'VERSION_CONFLICT', 'Your timesheet changed in another tab · reload and try again');
        return ts;
    }
    assertInWeek(ts, date) {
        if (date < (0, _timeutils.keyOf)(ts.weekStart) || date > (0, _timeutils.keyOf)(ts.weekEnd)) throw (0, _errors.badRequest)('Pick a date inside this week');
    }
    async bump(id, type, comment) {
        const ctx = (0, _requestcontext.getContext)();
        await this.prisma.timesheet.update({
            where: {
                id
            },
            data: {
                version: {
                    increment: 1
                }
            }
        });
        await this.prisma.timesheetEvent.create({
            data: {
                timesheetId: id,
                type,
                actorName: ctx?.userName ?? null,
                comment: comment ?? null
            }
        });
    }
    async editCell(id, input) {
        const ts = await this.ownedEditable(id, input.expectedVersion);
        this.assertInWeek(ts, input.date);
        if (input.date > (0, _timeutils.istKeyOf)(new Date())) throw new _errors.AppError(422, 'FUTURE_DATE', "You can't log time for a future date");
        await this.locks.assertOpen(input.date);
        const line = ts.lines.find((l)=>l.id === input.lineId);
        if (!line) throw (0, _errors.notFound)('Timesheet line');
        let cell = line.cells.find((c)=>(0, _timeutils.keyOf)(c.date) === input.date) ?? null;
        const parts = cell ?? {
            trackedMinutes: 0,
            idleAsWorkMinutes: 0,
            outsideHoursMinutes: 0,
            adjustmentMinutes: 0
        };
        const plan = (0, _timesheetcalc.planCellEdit)(parts, input.minutes);
        if (!plan) return this.weekDto(id, {
            owner: true
        });
        const dayCells = ts.lines.flatMap((l)=>l.cells.filter((c)=>(0, _timeutils.keyOf)(c.date) === input.date));
        const dayTotalBefore = dayCells.reduce((s, c)=>s + c.finalMinutes, 0);
        const attendance = await this.prisma.attendanceDay.findFirst({
            where: {
                employeeId: ts.employeeId,
                date: (0, _timeutils.dateOf)(input.date)
            },
            select: {
                workedMinutes: true
            }
        });
        const needReason = (0, _timesheetcalc.reasonRequired)({
            hasTrackerData: dayCells.some((c)=>c.trackedMinutes > 0 || c.idleAsWorkMinutes > 0),
            dayTotalAfter: dayTotalBefore - (cell?.finalMinutes ?? 0) + input.minutes,
            attendanceWorked: attendance?.workedMinutes ?? 0
        });
        const reason = input.reason?.trim() ?? '';
        if (needReason && reason.length < 10) throw new _errors.AppError(422, 'REASON_REQUIRED', 'Edits to tracked time need a reason (at least 10 characters)');
        const tenantId = (0, _requestcontext.currentTenantId)();
        const final = (0, _timesheetcalc.cellFinal)({
            ...parts,
            adjustmentMinutes: plan.adjustmentMinutes
        });
        if (cell) cell = await this.prisma.timesheetCell.update({
            where: {
                id: cell.id
            },
            data: {
                adjustmentMinutes: plan.adjustmentMinutes,
                finalMinutes: final
            }
        });
        else cell = await this.prisma.timesheetCell.create({
            data: {
                tenantId,
                lineId: line.id,
                date: (0, _timeutils.dateOf)(input.date),
                adjustmentMinutes: plan.adjustmentMinutes,
                finalMinutes: final
            }
        });
        const ctx = (0, _requestcontext.requireContext)();
        await this.prisma.timesheetAdjustment.create({
            data: {
                tenantId,
                timesheetId: id,
                cellId: cell.id,
                fromMinutes: input.minutes - plan.deltaMinutes,
                toMinutes: input.minutes,
                deltaMinutes: plan.deltaMinutes,
                kind: plan.kind,
                reason: reason || 'Manual entry',
                reviewStatus: plan.reviewStatus,
                createdByName: ctx.userName ?? null
            }
        });
        await this.bump(id, 'cell.adjusted', `${line.label} · ${(0, _timeutils.dayLabel)(input.date)} → ${input.minutes} min`);
        await this.refreshTotals(id);
        await this.audit.record({
            action: 'timesheet.cell.adjusted',
            entity: 'Timesheet',
            entityId: id,
            meta: {
                lineId: line.id,
                date: input.date,
                delta: plan.deltaMinutes,
                kind: plan.kind
            }
        });
        return this.weekDto(id, {
            owner: true
        });
    }
    async addLine(id, input) {
        const ts = await this.ownedEditable(id);
        const tenantId = (0, _requestcontext.currentTenantId)();
        let label = input.label?.trim() || '';
        let subLabel = null;
        let projectId = input.projectId ?? null;
        let billable = false;
        if (input.taskId) {
            if (ts.lines.some((l)=>l.taskId === input.taskId)) throw new _errors.AppError(409, 'DUPLICATE', 'This task is already on your timesheet');
            const task = (await this.cross.tasks([
                input.taskId
            ]))[0];
            if (!task) throw (0, _errors.notFound)('Task');
            projectId = task.projectId;
            label = `${task.key} ${task.title}`;
            const p = (await this.cross.projects([
                task.projectId
            ]))[0];
            subLabel = p ? p.isInternal ? 'Internal' : `${p.name}${task.moduleName ? ` · ${task.moduleName}` : ''}` : null;
            billable = !!p && p.billable && !p.isInternal;
        } else if (projectId) {
            const p = (await this.cross.projects([
                projectId
            ]))[0];
            if (!p) throw (0, _errors.notFound)('Project');
            label = label || p.name;
            subLabel = p.isInternal ? 'Internal' : p.name;
            billable = p.billable && !p.isInternal;
        }
        if (!label) throw (0, _errors.badRequest)('Pick a task or project');
        await this.prisma.timesheetLine.create({
            data: {
                tenantId,
                timesheetId: id,
                taskId: input.taskId ?? null,
                projectId,
                label,
                subLabel,
                billable,
                isManual: true,
                sortOrder: ts.lines.length + 1
            }
        });
        await this.bump(id, 'line.added', label);
        return this.weekDto(id, {
            owner: true
        });
    }
    async removeLine(id, lineId) {
        const ts = await this.ownedEditable(id);
        const line = ts.lines.find((l)=>l.id === lineId);
        if (!line) throw (0, _errors.notFound)('Timesheet line');
        if (!line.isManual || line.cells.some((c)=>c.trackedMinutes > 0 || c.outsideHoursMinutes > 0)) throw new _errors.AppError(409, 'LINE_HAS_TIME', 'Only manual lines without tracked time can be removed');
        await this.prisma.timesheetLine.delete({
            where: {
                id: lineId
            }
        });
        await this.bump(id, 'line.removed', line.label);
        await this.refreshTotals(id);
        return this.weekDto(id, {
            owner: true
        });
    }
    // ── outside hours ───────────────────────────────────────────────────────
    async logOutsideHours(id, input) {
        const ts = await this.ownedEditable(id);
        this.assertInWeek(ts, input.date);
        if (input.date > (0, _timeutils.istKeyOf)(new Date())) throw new _errors.AppError(422, 'FUTURE_DATE', "You can't log time for a future date");
        await this.locks.assertOpen(input.date);
        const fromMin = (0, _timeutils.parseHm)(input.from);
        const toMin = (0, _timeutils.parseHm)(input.to);
        const { minutes, error } = (0, _timesheetcalc.outsideHoursMinutes)(fromMin, toMin);
        if (error) throw new _errors.AppError(422, 'OUTSIDE_HOURS_INVALID', error);
        const startAt = (0, _timeutils.istInstant)(input.date, fromMin);
        const endAt = (0, _timeutils.istInstant)(input.date, toMin);
        const overlap = await this.prisma.outsideHoursEntry.findFirst({
            where: {
                employeeId: ts.employeeId,
                date: (0, _timeutils.dateOf)(input.date),
                reviewStatus: {
                    not: 'REJECTED'
                },
                startAt: {
                    lt: endAt
                },
                endAt: {
                    gt: startAt
                }
            }
        });
        if (overlap) throw new _errors.AppError(409, 'OUTSIDE_HOURS_OVERLAP', 'This overlaps another outside-hours entry');
        const project = (await this.cross.projects([
            input.projectId
        ]))[0];
        if (!project) throw (0, _errors.notFound)('Project');
        const tenantId = (0, _requestcontext.currentTenantId)();
        let line = input.taskId ? ts.lines.find((l)=>l.taskId === input.taskId) : ts.lines.find((l)=>!l.taskId && l.projectId === input.projectId);
        if (!line) {
            const task = input.taskId ? (await this.cross.tasks([
                input.taskId
            ]))[0] : undefined;
            const created = await this.prisma.timesheetLine.create({
                data: {
                    tenantId,
                    timesheetId: id,
                    taskId: input.taskId ?? null,
                    projectId: input.projectId,
                    label: task ? `${task.key} ${task.title}` : input.taskText,
                    subLabel: project.isInternal ? 'Internal' : project.name,
                    billable: project.billable && !project.isInternal,
                    isManual: true,
                    sortOrder: ts.lines.length + 1
                }
            });
            line = {
                ...created,
                cells: []
            };
        }
        const entry = await this.prisma.outsideHoursEntry.create({
            data: {
                employeeId: ts.employeeId,
                timesheetId: id,
                lineId: line.id,
                projectId: input.projectId,
                taskId: input.taskId ?? null,
                taskText: input.taskText,
                date: (0, _timeutils.dateOf)(input.date),
                startAt,
                endAt,
                minutes,
                reason: input.reason,
                reviewStatus: 'PENDING_PL'
            }
        });
        await this.syncOutsideHours(id);
        await this.bump(id, 'outside_hours.logged', `${input.taskText} · ${(0, _timeutils.dayLabel)(input.date)} ${input.from}–${input.to}`);
        await this.audit.record({
            action: 'timesheet.outside_hours.logged',
            entity: 'OutsideHoursEntry',
            entityId: entry.id,
            meta: {
                date: input.date,
                minutes,
                projectId: input.projectId
            }
        });
        return this.weekDto(id, {
            owner: true
        });
    }
    async deleteOutsideHours(entryId) {
        const e = await this.prisma.outsideHoursEntry.findFirst({
            where: {
                id: entryId
            }
        });
        if (!e) throw (0, _errors.notFound)('Outside-hours entry');
        await this.ownedEditable(e.timesheetId);
        await this.prisma.outsideHoursEntry.delete({
            where: {
                id: entryId
            }
        });
        await this.syncOutsideHours(e.timesheetId);
        await this.bump(e.timesheetId, 'outside_hours.removed', e.taskText);
        return this.weekDto(e.timesheetId, {
            owner: true
        });
    }
    /** Cell outsideHours = Σ non-rejected entries on that line/day. */ async syncOutsideHours(timesheetId) {
        const ts = await this.load(timesheetId);
        const entries = await this.prisma.outsideHoursEntry.findMany({
            where: {
                timesheetId,
                reviewStatus: {
                    not: 'REJECTED'
                }
            }
        });
        const sum = new Map();
        for (const e of entries)if (e.lineId) sum.set(`${e.lineId}|${(0, _timeutils.keyOf)(e.date)}`, (sum.get(`${e.lineId}|${(0, _timeutils.keyOf)(e.date)}`) ?? 0) + e.minutes);
        const tenantId = (0, _requestcontext.currentTenantId)();
        for (const l of ts.lines){
            const keys = new Set([
                ...l.cells.map((c)=>(0, _timeutils.keyOf)(c.date)),
                ...[
                    ...sum.keys()
                ].filter((k)=>k.startsWith(`${l.id}|`)).map((k)=>k.split('|')[1])
            ]);
            for (const d of keys){
                const oh = sum.get(`${l.id}|${d}`) ?? 0;
                const c = l.cells.find((x)=>(0, _timeutils.keyOf)(x.date) === d);
                if (c) {
                    if (c.outsideHoursMinutes !== oh) await this.prisma.timesheetCell.update({
                        where: {
                            id: c.id
                        },
                        data: {
                            outsideHoursMinutes: oh,
                            finalMinutes: (0, _timesheetcalc.cellFinal)({
                                ...c,
                                outsideHoursMinutes: oh
                            })
                        }
                    });
                } else if (oh) {
                    await this.prisma.timesheetCell.create({
                        data: {
                            tenantId,
                            lineId: l.id,
                            date: (0, _timeutils.dateOf)(d),
                            outsideHoursMinutes: oh,
                            finalMinutes: oh
                        }
                    });
                }
            }
        }
        await this.refreshTotals(timesheetId);
    }
    // ── submit / recall ─────────────────────────────────────────────────────
    async submit(id, input) {
        let ts = await this.ownedEditable(id, input.expectedVersion);
        const now = new Date();
        if (!submitOpen((0, _timeutils.keyOf)(ts.weekStart), now)) throw new _errors.AppError(422, 'SUBMIT_TOO_EARLY', `You can submit this week from Fri ${(0, _timeutils.dm)((0, _timeutils.addDays)((0, _timeutils.keyOf)(ts.weekStart), 4))}, 15:00`);
        ts = await this.rebuild(ts);
        if (ts.totalMinutes <= 0 && !input.confirmEmpty) throw new _errors.AppError(422, 'EMPTY_TIMESHEET', 'This timesheet has no hours · add time before submitting');
        const emp = await this.policies.employee(ts.employeeId);
        const full = await this.load(id);
        const oh = await this.prisma.outsideHoursEntry.findMany({
            where: {
                timesheetId: id,
                reviewStatus: {
                    not: 'REJECTED'
                }
            }
        });
        const routeLines = [
            ...full.lines.map((l)=>({
                    projectId: l.projectId,
                    minutes: l.cells.reduce((s, c)=>s + c.finalMinutes, 0)
                })),
            ...oh.map((o)=>({
                    projectId: o.projectId,
                    minutes: o.minutes
                }))
        ];
        const projects = await this.cross.projectMap(routeLines.map((l)=>l.projectId).filter((x)=>!!x));
        const l1 = (0, _routing.planL1)(ts.employeeId, routeLines, projects);
        const cycle = ts.cycle + 1;
        const tenantId = (0, _requestcontext.currentTenantId)();
        const dueAt = new Date(now.getTime() + L1_SLA_HOURS * 3600_000);
        for (const p of l1){
            await this.prisma.timesheetApprovalStep.create({
                data: {
                    tenantId,
                    timesheetId: id,
                    cycle,
                    level: 1,
                    projectId: p.projectId,
                    approverEmployeeId: p.approverEmployeeId,
                    status: p.status,
                    dueAt,
                    ...p.status === 'SKIPPED_SELF' ? {
                        actedAt: now,
                        comment: 'Skipped: you lead this project'
                    } : {}
                }
            });
        }
        const pendingL1 = l1.filter((p)=>p.status === 'PENDING');
        let status = 'SUBMITTED';
        let l2Name = null;
        const notifyIds = pendingL1.map((p)=>p.approverEmployeeId);
        if (!pendingL1.length) {
            const l2 = await this.createL2(ts, cycle, emp, []);
            status = l2 ? 'PENDING_RM' : 'APPROVED';
            if (l2) {
                notifyIds.push(l2.approverEmployeeId);
                l2Name = (await this.prisma.employee.findFirst({
                    where: {
                        id: l2.approverEmployeeId
                    },
                    select: {
                        fullName: true
                    }
                }))?.fullName ?? null;
            }
        }
        await this.prisma.timesheet.update({
            where: {
                id
            },
            data: {
                status,
                cycle,
                submittedAt: now,
                returnedComment: null,
                returnedByName: null,
                hasLateData: false,
                version: {
                    increment: 1
                },
                ...status === 'APPROVED' ? {
                    approvedAt: now
                } : {}
            }
        });
        await this.prisma.timesheetEvent.create({
            data: {
                timesheetId: id,
                type: 'submitted',
                actorName: emp.fullName
            }
        });
        const label = (0, _timeutils.weekLabel)((0, _timeutils.keyOf)(ts.weekStart), (0, _timeutils.keyOf)(ts.weekEnd), true);
        const users = await this.notifications.usersForEmployees(notifyIds);
        await this.notifications.notify({
            userIds: users,
            type: 'approval',
            title: `${emp.fullName} submitted a timesheet · ${label}`,
            body: 'Review hours, screenshots and flagged items.',
            link: '/approvals',
            from: emp.fullName
        });
        for (const u of users)this.realtime.toUser(u, 'approvals.counts', {});
        await this.audit.record({
            action: 'timesheet.submitted',
            entity: 'Timesheet',
            entityId: id,
            meta: {
                cycle,
                l1: l1.map((p)=>({
                        projectId: p.projectId,
                        status: p.status
                    })),
                status
            }
        });
        this.events.emit('timesheet.submitted', {
            timesheetId: id,
            employeeId: ts.employeeId,
            weekStart: (0, _timeutils.keyOf)(ts.weekStart)
        });
        if (status === 'APPROVED') this.events.emit('timesheet.approved', {
            timesheetId: id,
            employeeId: ts.employeeId,
            weekStart: (0, _timeutils.keyOf)(ts.weekStart)
        });
        const pendingNames = (await this.prisma.employee.findMany({
            where: {
                id: {
                    in: pendingL1.map((p)=>p.approverEmployeeId)
                }
            },
            select: {
                fullName: true
            }
        })).map((e)=>e.fullName);
        return {
            status,
            message: (0, _routing.submitMessage)([
                ...new Set(pendingNames)
            ], l2Name, status)
        };
    }
    /** Create the Level-2 step (RM → any admin). Returns null when nobody can approve (auto-approve). */ async createL2(ts, cycle, emp, l1ApprovedBy) {
        const admins = await this.prisma.employee.findMany({
            where: {
                status: {
                    in: [
                        ...ACTIVE
                    ]
                },
                user: {
                    role: {
                        key: 'admin'
                    }
                }
            },
            select: {
                id: true
            }
        });
        const plan = (0, _routing.planL2)({
            employeeId: emp.id,
            managerId: emp.managerId,
            adminEmployeeIds: admins.map((a)=>a.id),
            l1ApprovedBy,
            skipDuplicateApprover: false
        });
        if (!plan) return null;
        // NULL projectIds are distinct in the unique index, so find/create instead of upsert.
        const found = await this.prisma.timesheetApprovalStep.findFirst({
            where: {
                timesheetId: ts.id,
                cycle,
                level: 2
            }
        });
        if (found) return this.prisma.timesheetApprovalStep.update({
            where: {
                id: found.id
            },
            data: {
                approverEmployeeId: plan.approverEmployeeId,
                status: plan.status
            }
        });
        return this.prisma.timesheetApprovalStep.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                timesheetId: ts.id,
                cycle,
                level: 2,
                projectId: null,
                approverEmployeeId: plan.approverEmployeeId,
                status: plan.status,
                dueAt: new Date(Date.now() + L1_SLA_HOURS * 3600_000)
            }
        });
    }
    async recall(id) {
        const me = this.org.myEmployeeId();
        const ts = await this.load(id);
        if (ts.employeeId !== me) throw (0, _errors.forbidden)('You can only recall your own timesheet');
        const steps = await this.prisma.timesheetApprovalStep.findMany({
            where: {
                timesheetId: id,
                cycle: ts.cycle
            }
        });
        if (ts.status !== 'SUBMITTED' || steps.some((s)=>s.status === 'APPROVED' || s.status === 'RETURNED')) throw new _errors.AppError(409, 'CANNOT_RECALL', 'A reviewer has already acted on this timesheet');
        await this.prisma.timesheetApprovalStep.updateMany({
            where: {
                timesheetId: id,
                cycle: ts.cycle,
                status: 'PENDING'
            },
            data: {
                status: 'CANCELLED'
            }
        });
        await this.prisma.timesheet.update({
            where: {
                id
            },
            data: {
                status: 'DRAFT',
                submittedAt: null,
                version: {
                    increment: 1
                }
            }
        });
        await this.prisma.timesheetEvent.create({
            data: {
                timesheetId: id,
                type: 'recalled',
                actorName: (0, _requestcontext.requireContext)().userName ?? null
            }
        });
        const users = await this.notifications.usersForEmployees(steps.map((s)=>s.approverEmployeeId));
        for (const u of users)this.realtime.toUser(u, 'approvals.counts', {});
        await this.audit.record({
            action: 'timesheet.recalled',
            entity: 'Timesheet',
            entityId: id
        });
        return this.weekDto(id, {
            owner: true
        });
    }
    /** Admin reopen of an approved (not locked) sheet → RETURNED. */ async reopen(id, reason) {
        const ctx = (0, _requestcontext.requireContext)();
        if (!(ctx.permissions.has('*') || ctx.roleKey === 'admin')) throw (0, _errors.forbidden)('Only an admin can reopen an approved timesheet');
        const ts = await this.load(id);
        if (ts.employeeId === ctx.employeeId) throw (0, _errors.forbidden)("You can't reopen your own timesheet");
        if (ts.status !== 'APPROVED') throw new _errors.AppError(409, 'NOT_APPROVED', 'Only approved timesheets can be reopened');
        await this.prisma.timesheet.update({
            where: {
                id
            },
            data: {
                status: 'RETURNED',
                returnedComment: reason,
                returnedByName: ctx.userName ?? 'Admin',
                approvedAt: null,
                version: {
                    increment: 1
                }
            }
        });
        await this.prisma.timesheetEvent.create({
            data: {
                timesheetId: id,
                type: 'reopened',
                actorName: ctx.userName ?? null,
                comment: reason
            }
        });
        await this.audit.record({
            action: 'timesheet.reopened',
            entity: 'Timesheet',
            entityId: id,
            meta: {
                reason
            }
        });
        const users = await this.notifications.usersForEmployees([
            ts.employeeId
        ]);
        await this.notifications.notify({
            userIds: users,
            type: 'timesheet',
            title: `Your timesheet for ${(0, _timeutils.weekLabel)((0, _timeutils.keyOf)(ts.weekStart), (0, _timeutils.keyOf)(ts.weekEnd), true)} was reopened`,
            body: reason,
            link: '/timesheet',
            from: ctx.userName
        });
        this.events.emit('timesheet.returned', {
            timesheetId: id,
            employeeId: ts.employeeId,
            weekStart: (0, _timeutils.keyOf)(ts.weekStart)
        });
        return {
            ok: true
        };
    }
    // ── lists / options ─────────────────────────────────────────────────────
    async assertCanView(ctx, employeeId) {
        if (employeeId === ctx.employeeId) return;
        if ((0, _decorators.hasPerm)(ctx, 'attendance.manage') || (0, _decorators.hasPerm)(ctx, 'payroll.manage') || ctx.roleKey === 'admin') return;
        const me = ctx.employeeId;
        if (!me) throw (0, _errors.forbidden)();
        const [reports, team] = await Promise.all([
            this.org.reportTree(me),
            this.cross.projectTeam(me)
        ]);
        if (!reports.includes(employeeId) && !team.includes(employeeId)) throw (0, _errors.forbidden)("You can't view this timesheet");
    }
    async list(q) {
        const ctx = (0, _requestcontext.requireContext)();
        const where = {};
        if (q.mine) where.employeeId = this.org.myEmployeeId();
        else if (!((0, _decorators.hasPerm)(ctx, 'attendance.manage') || (0, _decorators.hasPerm)(ctx, 'payroll.manage') || ctx.roleKey === 'admin')) {
            const me = ctx.employeeId ?? '__none__';
            where.employeeId = {
                in: [
                    me,
                    ...await this.org.reportTree(me)
                ]
            };
        }
        if (q.employeeId) where.AND = [
            {
                employeeId: q.employeeId
            }
        ];
        if (q.status && q.status !== 'ALL') where.status = q.status;
        if (q.weekStart) where.weekStart = (0, _timeutils.dateOf)((0, _timeutils.mondayOf)(q.weekStart));
        const rows = await this.prisma.timesheet.findMany({
            where,
            orderBy: [
                {
                    weekStart: 'desc'
                }
            ],
            take: 200
        });
        const names = new Map((await this.prisma.employee.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(rows.map((r)=>r.employeeId))
                    ]
                }
            },
            select: {
                id: true,
                fullName: true
            }
        })).map((e)=>[
                e.id,
                e.fullName
            ]));
        return rows.map((r)=>({
                id: r.id,
                employeeId: r.employeeId,
                employeeName: names.get(r.employeeId) ?? '—',
                weekStart: (0, _timeutils.keyOf)(r.weekStart),
                label: (0, _timeutils.weekLabel)((0, _timeutils.keyOf)(r.weekStart), (0, _timeutils.keyOf)(r.weekEnd), true),
                status: r.status,
                statusLabel: _shared.TIMESHEET_STATUS_LABEL[r.status],
                totalMinutes: r.totalMinutes,
                idleMinutes: r.idleMinutes,
                submittedAt: r.submittedAt?.toISOString() ?? null,
                approvedAt: r.approvedAt?.toISOString() ?? null
            }));
    }
    async options() {
        const me = this.org.myEmployeeId();
        const tasks = await this.cross.assignableTasks(me);
        const projectIds = [
            ...new Set([
                ...await this.cross.memberProjectIds(me),
                ...tasks.map((t)=>t.projectId)
            ])
        ];
        const projects = projectIds.length ? await this.cross.projects(projectIds) : [];
        const pm = new Map(projects.map((p)=>[
                p.id,
                p
            ]));
        return {
            projects: projects.filter((p)=>![
                    'ARCHIVED',
                    'CANCELLED'
                ].includes(p.status ?? '')).map((p)=>({
                    id: p.id,
                    name: p.name,
                    key: p.key,
                    isInternal: p.isInternal
                })),
            tasks: tasks.map((t)=>({
                    id: t.id,
                    key: t.key,
                    title: t.title,
                    projectId: t.projectId,
                    projectName: pm.get(t.projectId)?.name ?? ''
                }))
        };
    }
    /** Friday reminder: employees with a required, unsubmitted sheet for this week. */ async remindUnsubmitted(now = new Date()) {
        const ws = (0, _timeutils.mondayOf)((0, _timeutils.istKeyOf)(now));
        const emps = await this.prisma.employee.findMany({
            where: {
                status: {
                    in: [
                        ...ACTIVE
                    ]
                },
                employmentType: {
                    not: 'INTERN'
                },
                userId: {
                    not: null
                }
            },
            select: {
                id: true,
                userId: true,
                workMode: true
            }
        });
        const sheets = await this.prisma.timesheet.findMany({
            where: {
                weekStart: (0, _timeutils.dateOf)(ws),
                status: {
                    notIn: [
                        'DRAFT',
                        'RETURNED'
                    ]
                }
            },
            select: {
                employeeId: true
            }
        });
        const done = new Set(sheets.map((s)=>s.employeeId));
        const office = await this.policies.get('OFFICE');
        const remote = await this.policies.get('REMOTE');
        const users = emps.filter((e)=>!done.has(e.id) && (e.workMode === 'OFFICE' ? office : remote).timesheetRequired).map((e)=>e.userId);
        await this.notifications.notify({
            userIds: users,
            type: 'timesheet.reminder',
            title: `Submit your timesheet for ${(0, _timeutils.weekLabel)(ws, (0, _timeutils.addDays)(ws, 6), true)}`,
            body: 'Review tracked hours and submit before Monday 12:00.',
            link: '/timesheet',
            from: 'Timesheets'
        });
        return users.length;
    }
    /** payroll.finalized → approved sheets overlapping the period become LOCKED. */ async lockForPeriod(period) {
        const from = (0, _timeutils.dateOf)(`${period}-01`);
        const [y, m] = period.split('-').map(Number);
        const to = new Date(Date.UTC(y, m, 0));
        const res = await this.prisma.timesheet.updateMany({
            where: {
                status: 'APPROVED',
                weekStart: {
                    lte: to
                },
                weekEnd: {
                    gte: from
                }
            },
            data: {
                status: 'LOCKED',
                lockedAt: new Date()
            }
        });
        return res.count;
    }
};
TimesheetService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _policyservice.PolicyService === "undefined" ? Object : _policyservice.PolicyService,
        typeof _periodlockservice.PeriodLockService === "undefined" ? Object : _periodlockservice.PeriodLockService,
        typeof _cross.CrossReader === "undefined" ? Object : _cross.CrossReader,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _orgservice.OrgService === "undefined" ? Object : _orgservice.OrgService
    ])
], TimesheetService);

//# sourceMappingURL=timesheet.service.js.map