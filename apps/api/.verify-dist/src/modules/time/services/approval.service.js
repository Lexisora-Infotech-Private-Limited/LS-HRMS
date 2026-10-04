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
    get ApprovalService () {
        return ApprovalService;
    },
    get isApprovalAdmin () {
        return isApprovalAdmin;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _eventsservice = require("../../../core/registry/events.service");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _cross = require("../cross");
const _timeutils = require("../lib/time-utils");
const _policyservice = require("./policy.service");
const _regularizationservice = require("./regularization.service");
const _timesheetservice = require("./timesheet.service");
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
const SHOTS_PAGE = 24;
function isApprovalAdmin(ctx) {
    return ctx.permissions.has('*') || ctx.roleKey === 'admin';
}
let ApprovalService = class ApprovalService {
    prisma;
    sheets;
    policies;
    regs;
    cross;
    audit;
    notifications;
    realtime;
    events;
    constructor(prisma, sheets, policies, regs, cross, audit, notifications, realtime, events){
        this.prisma = prisma;
        this.sheets = sheets;
        this.policies = policies;
        this.regs = regs;
        this.cross = cross;
        this.audit = audit;
        this.notifications = notifications;
        this.realtime = realtime;
        this.events = events;
    }
    stepScope(ctx, level) {
        const where = {
            ...level ? {
                level
            } : {}
        };
        if (!isApprovalAdmin(ctx)) where.approverEmployeeId = ctx.employeeId ?? '__none__';
        return where;
    }
    /** Distinct timesheets waiting on the viewer (dashboard count). */ async pendingCounts(ctx) {
        const own = ctx.employeeId ? {
            timesheet: {
                employeeId: {
                    not: ctx.employeeId
                }
            }
        } : {};
        const [l1, l2] = await Promise.all([
            this.prisma.timesheetApprovalStep.count({
                where: {
                    ...this.stepScope(ctx, 1),
                    status: 'PENDING',
                    ...own
                }
            }),
            this.prisma.timesheetApprovalStep.count({
                where: {
                    ...this.stepScope(ctx, 2),
                    status: 'PENDING',
                    ...own
                }
            })
        ]);
        return {
            l1,
            l2
        };
    }
    async list(level, status) {
        const ctx = (0, _requestcontext.requireContext)();
        const where = {
            ...this.stepScope(ctx, level)
        };
        if (status === 'PENDING') where.status = 'PENDING';
        else if (status === 'APPROVED') where.status = 'APPROVED';
        else if (status === 'RETURNED') where.status = 'RETURNED';
        else where.status = {
            in: [
                'PENDING',
                'APPROVED',
                'RETURNED'
            ]
        };
        if (ctx.employeeId) where.timesheet = {
            employeeId: {
                not: ctx.employeeId
            }
        };
        const steps = await this.prisma.timesheetApprovalStep.findMany({
            where,
            include: {
                timesheet: true
            },
            orderBy: [
                {
                    createdAt: 'asc'
                }
            ],
            take: 200
        });
        const empIds = [
            ...new Set(steps.map((s)=>s.timesheet.employeeId))
        ];
        const names = new Map((await this.prisma.employee.findMany({
            where: {
                id: {
                    in: empIds
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
        const projects = await this.cross.projectMap(steps.map((s)=>s.projectId).filter((x)=>!!x));
        const items = [];
        for (const s of steps){
            const t = s.timesheet;
            const from = (0, _timeutils.keyOf)(t.weekStart);
            const to = (0, _timeutils.keyOf)(t.weekEnd);
            const flags = await this.flagCount(s);
            const st = t.status;
            items.push({
                stepId: s.id,
                timesheetId: t.id,
                level: s.level,
                employeeId: t.employeeId,
                name: names.get(t.employeeId) ?? '—',
                week: (0, _timeutils.weekLabel)(from, to, true),
                weekStart: from,
                workedMinutes: t.totalMinutes,
                idleMinutes: t.idleMinutes,
                hours: (0, _timeutils.hm)(t.totalMinutes),
                idle: (0, _timeutils.hm)(t.idleMinutes),
                shots: t.screenshotCount,
                flags,
                status: st,
                statusLabel: s.status === 'RETURNED' ? 'Sent back' : _shared.TIMESHEET_STATUS_LABEL[st],
                stepStatus: s.status,
                projectName: s.projectId ? projects.get(s.projectId)?.name ?? null : null
            });
        }
        const counts = await this.pendingCounts(ctx);
        const canCorrections = (0, _decorators.hasPerm)(ctx, 'attendance.regularize.approve') || (0, _decorators.hasPerm)(ctx, 'attendance.manage');
        return {
            items,
            counts: {
                ...counts,
                corrections: canCorrections ? await this.regs.pendingCount(ctx) : 0
            },
            canL1: (0, _decorators.hasPerm)(ctx, 'timesheet.approve.l1'),
            canL2: (0, _decorators.hasPerm)(ctx, 'timesheet.approve.l2'),
            canCorrections,
            isAdmin: isApprovalAdmin(ctx)
        };
    }
    async flagCount(s) {
        const ohWhere = {
            timesheetId: s.timesheetId,
            reviewStatus: 'PENDING_PL',
            ...s.level === 1 ? {
                projectId: s.projectId
            } : {}
        };
        const [oh, adj] = await Promise.all([
            this.prisma.outsideHoursEntry.count({
                where: ohWhere
            }),
            this.prisma.timesheetAdjustment.count({
                where: {
                    timesheetId: s.timesheetId,
                    reviewStatus: 'PENDING_PL'
                }
            })
        ]);
        const claims = (await this.cross.idleClaims(s.timesheet.employeeId, (0, _timeutils.keyOf)(s.timesheet.weekStart), (0, _timeutils.keyOf)(s.timesheet.weekEnd))).filter((c)=>c.status === 'PENDING').length;
        return oh + adj + claims;
    }
    async loadStep(stepId) {
        const ctx = (0, _requestcontext.requireContext)();
        const step = await this.prisma.timesheetApprovalStep.findFirst({
            where: {
                id: stepId
            },
            include: {
                timesheet: true
            }
        });
        if (!step) throw (0, _errors.notFound)('Approval step');
        const admin = isApprovalAdmin(ctx);
        if (!admin && step.approverEmployeeId !== ctx.employeeId) throw (0, _errors.forbidden)('This timesheet is not routed to you');
        return {
            ctx,
            step,
            admin
        };
    }
    async detail(stepId, q) {
        const { ctx, step, admin } = await this.loadStep(stepId);
        const t = step.timesheet;
        const from = (0, _timeutils.keyOf)(t.weekStart);
        const to = (0, _timeutils.keyOf)(t.weekEnd);
        const scopeProjectId = step.level === 1 ? step.projectId : undefined;
        const week = await this.sheets.weekDto(t.id, {
            owner: false,
            ...scopeProjectId !== undefined ? {
                scopeProjectId
            } : {}
        });
        const full = await this.sheets.load(t.id);
        const scopedLines = full.lines.filter((l)=>scopeProjectId === undefined || l.projectId === scopeProjectId);
        const otherProjectsMinutes = scopeProjectId === undefined ? 0 : full.lines.filter((l)=>l.projectId !== scopeProjectId).reduce((s, l)=>s + l.cells.reduce((a, c)=>a + c.finalMinutes, 0), 0);
        const taskIds = scopedLines.map((l)=>l.taskId).filter((x)=>!!x);
        const tasks = await this.cross.taskMap([
            ...taskIds,
            ...full.lines.map((l)=>l.taskId).filter((x)=>!!x)
        ]);
        // items needing review
        const items = [];
        const oh = await this.prisma.outsideHoursEntry.findMany({
            where: {
                timesheetId: t.id,
                ...scopeProjectId !== undefined ? {
                    projectId: scopeProjectId
                } : {}
            },
            orderBy: {
                date: 'asc'
            }
        });
        for (const o of oh){
            const d = (0, _timeutils.keyOf)(o.date);
            items.push({
                type: 'OUTSIDE_HOURS',
                id: o.id,
                date: d,
                dateLabel: `${(0, _timeutils.dayLabel)(d)} · ${(0, _timeutils.istHm)(o.startAt)}–${(0, _timeutils.istHm)(o.endAt)}`,
                minutes: o.minutes,
                task: o.taskText,
                reason: o.reason,
                status: o.reviewStatus === 'PENDING_PL' ? 'PENDING' : o.reviewStatus
            });
        }
        const cellIds = new Map(scopedLines.flatMap((l)=>l.cells.map((c)=>[
                    c.id,
                    {
                        line: l,
                        date: (0, _timeutils.keyOf)(c.date)
                    }
                ])));
        const adjs = await this.prisma.timesheetAdjustment.findMany({
            where: {
                timesheetId: t.id,
                kind: 'MANUAL_INCREASE',
                reviewStatus: {
                    in: [
                        'PENDING_PL',
                        'ACCEPTED',
                        'REJECTED'
                    ]
                }
            },
            orderBy: {
                createdAt: 'asc'
            }
        });
        for (const a of adjs){
            const c = cellIds.get(a.cellId);
            if (!c) continue;
            items.push({
                type: 'MANUAL_INCREASE',
                id: a.id,
                date: c.date,
                dateLabel: (0, _timeutils.dayLabel)(c.date),
                minutes: a.deltaMinutes,
                task: c.line.label,
                reason: a.reason,
                status: a.reviewStatus === 'PENDING_PL' ? 'PENDING' : a.reviewStatus
            });
        }
        const claims = await this.cross.idleClaims(t.employeeId, from, to);
        for (const c of claims){
            if (scopeProjectId !== undefined) {
                const task = c.taskId ? tasks.get(c.taskId) : undefined;
                const proj = task?.projectId ?? c.projectId ?? null;
                if (proj !== scopeProjectId) continue;
            }
            const d = (0, _timeutils.keyOf)(c.workDate);
            items.push({
                type: 'IDLE_AS_WORK',
                id: c.id,
                date: d,
                dateLabel: `${(0, _timeutils.dayLabel)(d)} · ${(0, _timeutils.istHm)(c.startAt)}–${(0, _timeutils.istHm)(c.endAt)}`,
                minutes: c.minutes,
                task: c.taskId && tasks.get(c.taskId)?.key || 'Idle marked as work',
                reason: c.note ?? '',
                status: c.status
            });
        }
        // screenshots mapped to tasks
        const scopeTaskIds = scopeProjectId !== undefined ? taskIds : undefined;
        const keyToId = new Map([
            ...tasks.values()
        ].map((x)=>[
                x.key,
                x.id
            ]));
        const filterTask = q.taskKey ? keyToId.get(q.taskKey) : undefined;
        const taskFilter = filterTask ? [
            filterTask
        ] : scopeTaskIds;
        const page = Math.max(1, q.page ?? 1);
        const [total, shots, all] = await Promise.all([
            this.cross.screenshotCount(t.employeeId, from, to, {
                taskIds: taskFilter,
                date: q.date
            }),
            this.cross.screenshots(t.employeeId, from, to, {
                taskIds: taskFilter,
                date: q.date,
                skip: (page - 1) * SHOTS_PAGE,
                take: SHOTS_PAGE
            }),
            this.cross.screenshots(t.employeeId, from, to, {
                taskIds: scopeTaskIds
            })
        ]);
        const byTaskMap = new Map();
        const dayset = new Set();
        for (const s of all){
            const k = s.taskId && tasks.get(s.taskId)?.key || 'Untagged';
            byTaskMap.set(k, (byTaskMap.get(k) ?? 0) + 1);
            dayset.add((0, _timeutils.keyOf)(s.workDate));
        }
        const thumbs = shots.map((s)=>({
                id: s.id,
                capturedAt: s.capturedAt.toISOString(),
                time: (0, _timeutils.istHm)(s.capturedAt),
                taskKey: s.taskId && tasks.get(s.taskId)?.key || '—',
                fileId: s.thumbFileId ?? s.fileId,
                blurred: s.blurred
            }));
        const events = await this.prisma.timesheetEvent.findMany({
            where: {
                timesheetId: t.id
            },
            orderBy: {
                at: 'desc'
            },
            take: 30
        });
        const approver = await this.prisma.employee.findFirst({
            where: {
                id: step.approverEmployeeId
            },
            select: {
                fullName: true
            }
        });
        const projectName = step.projectId ? (await this.cross.projects([
            step.projectId
        ]))[0]?.name ?? null : null;
        const workedMin = week.totals.worked;
        return {
            step: {
                id: step.id,
                level: step.level,
                status: step.status,
                projectId: step.projectId,
                projectName,
                approverName: approver?.fullName ?? null
            },
            timesheet: week,
            kpis: {
                worked: (0, _timeutils.hm)(scopeProjectId !== undefined ? workedMin : t.totalMinutes),
                idle: (0, _timeutils.hm)(t.idleMinutes),
                shots: scopeProjectId !== undefined ? all.length : t.screenshotCount || all.length
            },
            otherProjectsMinutes,
            items,
            screenshots: {
                total,
                page,
                pageSize: SHOTS_PAGE,
                items: thumbs,
                byTask: [
                    ...byTaskMap.entries()
                ].map(([taskKey, count])=>({
                        taskKey,
                        count
                    })).sort((a, b)=>b.count - a.count),
                days: [
                    ...dayset
                ].sort()
            },
            history: events.map((e)=>({
                    type: e.type,
                    actor: e.actorName,
                    level: e.level,
                    comment: e.comment,
                    at: e.at.toISOString()
                })),
            lateDataBanner: t.hasLateData ? 'New tracker data arrived after submission · totals shown are from the submitted snapshot' : null,
            canAct: step.status === 'PENDING' && (admin || step.approverEmployeeId === ctx.employeeId) && t.employeeId !== ctx.employeeId
        };
    }
    /** Apply Accept/Reject decisions on outside-hours entries and manual increases (default: accept pending items in scope). */ async applyDecisions(step, decisions, actor) {
        const now = new Date();
        const scope = step.level === 1 ? {
            projectId: step.projectId
        } : {};
        const pendingOh = await this.prisma.outsideHoursEntry.findMany({
            where: {
                timesheetId: step.timesheetId,
                reviewStatus: 'PENDING_PL',
                ...scope
            }
        });
        let changed = false;
        for (const o of pendingOh){
            const d = decisions.find((x)=>x.type === 'OUTSIDE_HOURS' && x.id === o.id);
            const status = d?.decision === 'REJECT' ? 'REJECTED' : 'ACCEPTED';
            await this.prisma.outsideHoursEntry.update({
                where: {
                    id: o.id
                },
                data: {
                    reviewStatus: status,
                    reviewedByName: actor,
                    reviewedAt: now,
                    reviewComment: d?.note ?? null
                }
            });
            changed = changed || status === 'REJECTED';
        }
        const sheet = await this.sheets.load(step.timesheetId);
        const scopedCells = new Map(sheet.lines.filter((l)=>step.level !== 1 || l.projectId === step.projectId).flatMap((l)=>l.cells.map((c)=>[
                    c.id,
                    c
                ])));
        const pendingAdj = await this.prisma.timesheetAdjustment.findMany({
            where: {
                timesheetId: step.timesheetId,
                reviewStatus: 'PENDING_PL'
            }
        });
        for (const a of pendingAdj){
            const cell = scopedCells.get(a.cellId);
            if (!cell) continue;
            const d = decisions.find((x)=>x.type === 'MANUAL_INCREASE' && x.id === a.id);
            const reject = d?.decision === 'REJECT';
            await this.prisma.timesheetAdjustment.update({
                where: {
                    id: a.id
                },
                data: {
                    reviewStatus: reject ? 'REJECTED' : 'ACCEPTED',
                    reviewedByName: actor,
                    reviewedAt: now
                }
            });
            if (reject) {
                const adj = cell.adjustmentMinutes - a.deltaMinutes;
                await this.prisma.timesheetCell.update({
                    where: {
                        id: cell.id
                    },
                    data: {
                        adjustmentMinutes: adj,
                        finalMinutes: Math.max(0, cell.trackedMinutes + cell.idleAsWorkMinutes + cell.outsideHoursMinutes + adj)
                    }
                });
                changed = true;
            }
        }
        if (changed) await this.sheets.syncOutsideHours(step.timesheetId);
    }
    async approve(stepId, input) {
        const { ctx, step } = await this.loadStep(stepId);
        const t = step.timesheet;
        if (t.employeeId === ctx.employeeId) throw (0, _errors.forbidden)("You can't approve your own timesheet");
        if (step.status !== 'PENDING') throw new _errors.AppError(409, 'STEP_DECIDED', 'This step has already been decided');
        const actor = ctx.userName ?? 'Approver';
        await this.applyDecisions(step, input.decisions ?? [], actor);
        const now = new Date();
        await this.prisma.timesheetApprovalStep.update({
            where: {
                id: step.id
            },
            data: {
                status: 'APPROVED',
                actedByName: actor,
                actedAt: now,
                comment: input.comment ?? null
            }
        });
        await this.prisma.timesheetEvent.create({
            data: {
                timesheetId: t.id,
                type: 'approved',
                actorName: actor,
                level: step.level,
                comment: input.comment ?? null
            }
        });
        const emp = await this.policies.employee(t.employeeId);
        const label = (0, _timeutils.weekLabel)((0, _timeutils.keyOf)(t.weekStart), (0, _timeutils.keyOf)(t.weekEnd), true);
        let message;
        let notifyApprover = null;
        if (step.level === 1) {
            const remaining = await this.prisma.timesheetApprovalStep.count({
                where: {
                    timesheetId: t.id,
                    cycle: t.cycle,
                    level: 1,
                    status: 'PENDING'
                }
            });
            if (remaining) {
                message = `${emp.fullName} → your review is done · waiting on other Project Leads`;
            } else {
                const l1By = (await this.prisma.timesheetApprovalStep.findMany({
                    where: {
                        timesheetId: t.id,
                        cycle: t.cycle,
                        level: 1,
                        status: 'APPROVED'
                    },
                    select: {
                        approverEmployeeId: true
                    }
                })).map((s)=>s.approverEmployeeId);
                const l2 = await this.sheets.createL2(t, t.cycle, emp, l1By);
                if (l2 && l2.status === 'PENDING') {
                    await this.prisma.timesheet.update({
                        where: {
                            id: t.id
                        },
                        data: {
                            status: 'PENDING_RM'
                        }
                    });
                    notifyApprover = l2.approverEmployeeId;
                    message = `${emp.fullName} → forwarded to Reporting Manager`;
                } else {
                    await this.finalApprove(t.id, emp, label);
                    message = `${emp.fullName} → approved, sent to payroll`;
                }
            }
        } else {
            await this.finalApprove(t.id, emp, label);
            message = `${emp.fullName} → approved, sent to payroll`;
        }
        if (notifyApprover) {
            const users = await this.notifications.usersForEmployees([
                notifyApprover
            ]);
            await this.notifications.notify({
                userIds: users,
                type: 'approval',
                title: `${emp.fullName}'s timesheet (${label}) is ready for your sign-off`,
                body: `Project Lead review done by ${actor}.`,
                link: '/approvals',
                from: actor
            });
            for (const u of users)this.realtime.toUser(u, 'approvals.counts', {});
        }
        if (ctx.userId) this.realtime.toUser(ctx.userId, 'approvals.counts', {});
        if (emp.userId) this.realtime.toUser(emp.userId, 'timesheet.updated', {
            id: t.id
        });
        await this.audit.record({
            action: 'timesheet.step.approved',
            entity: 'Timesheet',
            entityId: t.id,
            meta: {
                stepId: step.id,
                level: step.level,
                projectId: step.projectId,
                override: step.approverEmployeeId !== ctx.employeeId,
                decisions: input.decisions ?? []
            }
        });
        return {
            ok: true,
            message
        };
    }
    async finalApprove(timesheetId, emp, label) {
        const t = await this.prisma.timesheet.update({
            where: {
                id: timesheetId
            },
            data: {
                status: 'APPROVED',
                approvedAt: new Date()
            }
        });
        this.events.emit('timesheet.approved', {
            timesheetId,
            employeeId: emp.id,
            weekStart: (0, _timeutils.keyOf)(t.weekStart)
        });
        if (emp.userId) {
            await this.notifications.notify({
                userIds: [
                    emp.userId
                ],
                type: 'timesheet',
                title: `Timesheet ${label} approved, sent to payroll`,
                link: '/timesheet',
                from: (0, _requestcontext.requireContext)().userName ?? 'Approver'
            });
        }
    }
    async returnStep(stepId, comment) {
        const { ctx, step } = await this.loadStep(stepId);
        const t = step.timesheet;
        if (t.employeeId === ctx.employeeId) throw (0, _errors.forbidden)("You can't review your own timesheet");
        if (step.status !== 'PENDING') throw new _errors.AppError(409, 'STEP_DECIDED', 'This step has already been decided');
        const actor = ctx.userName ?? 'Approver';
        const now = new Date();
        await this.prisma.timesheetApprovalStep.update({
            where: {
                id: step.id
            },
            data: {
                status: 'RETURNED',
                actedByName: actor,
                actedAt: now,
                comment
            }
        });
        const others = await this.prisma.timesheetApprovalStep.findMany({
            where: {
                timesheetId: t.id,
                cycle: t.cycle,
                status: 'PENDING',
                id: {
                    not: step.id
                }
            },
            select: {
                approverEmployeeId: true
            }
        });
        await this.prisma.timesheetApprovalStep.updateMany({
            where: {
                timesheetId: t.id,
                cycle: t.cycle,
                status: 'PENDING',
                id: {
                    not: step.id
                }
            },
            data: {
                status: 'CANCELLED'
            }
        });
        await this.prisma.timesheet.update({
            where: {
                id: t.id
            },
            data: {
                status: 'RETURNED',
                returnedComment: comment,
                returnedByName: actor,
                version: {
                    increment: 1
                }
            }
        });
        await this.prisma.timesheetEvent.create({
            data: {
                timesheetId: t.id,
                type: 'returned',
                actorName: actor,
                level: step.level,
                comment
            }
        });
        const emp = await this.policies.employee(t.employeeId);
        const label = (0, _timeutils.weekLabel)((0, _timeutils.keyOf)(t.weekStart), (0, _timeutils.keyOf)(t.weekEnd), true);
        if (emp.userId) {
            await this.notifications.notify({
                userIds: [
                    emp.userId
                ],
                type: 'timesheet',
                title: `Timesheet ${label} sent back by ${actor}`,
                body: comment,
                link: '/timesheet',
                from: actor,
                email: true
            });
            this.realtime.toUser(emp.userId, 'timesheet.updated', {
                id: t.id
            });
        }
        const users = await this.notifications.usersForEmployees(others.map((o)=>o.approverEmployeeId));
        for (const u of [
            ...users,
            ...ctx.userId ? [
                ctx.userId
            ] : []
        ])this.realtime.toUser(u, 'approvals.counts', {});
        this.events.emit('timesheet.returned', {
            timesheetId: t.id,
            employeeId: t.employeeId,
            weekStart: (0, _timeutils.keyOf)(t.weekStart)
        });
        await this.audit.record({
            action: 'timesheet.step.returned',
            entity: 'Timesheet',
            entityId: t.id,
            meta: {
                stepId: step.id,
                level: step.level,
                comment
            }
        });
        return {
            ok: true,
            message: `${emp.fullName} → sent back with comment`
        };
    }
    /** Hourly: remind approvers of overdue steps once. */ async remindOverdue(now = new Date()) {
        const due = await this.prisma.timesheetApprovalStep.findMany({
            where: {
                status: 'PENDING',
                dueAt: {
                    lt: now
                },
                escalatedAt: null
            },
            include: {
                timesheet: true
            }
        });
        for (const s of due){
            const users = await this.notifications.usersForEmployees([
                s.approverEmployeeId
            ]);
            const name = (await this.prisma.employee.findFirst({
                where: {
                    id: s.timesheet.employeeId
                },
                select: {
                    fullName: true
                }
            }))?.fullName ?? 'An employee';
            await this.notifications.notify({
                userIds: users,
                type: 'approval',
                title: `Overdue: ${name}'s timesheet ${(0, _timeutils.weekLabel)((0, _timeutils.keyOf)(s.timesheet.weekStart), (0, _timeutils.keyOf)(s.timesheet.weekEnd), true)}`,
                link: '/approvals',
                from: 'Timesheets'
            });
            await this.prisma.timesheetApprovalStep.update({
                where: {
                    id: s.id
                },
                data: {
                    escalatedAt: now
                }
            });
        }
        return due.length;
    }
};
ApprovalService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _timesheetservice.TimesheetService === "undefined" ? Object : _timesheetservice.TimesheetService,
        typeof _policyservice.PolicyService === "undefined" ? Object : _policyservice.PolicyService,
        typeof _regularizationservice.RegularizationService === "undefined" ? Object : _regularizationservice.RegularizationService,
        typeof _cross.CrossReader === "undefined" ? Object : _cross.CrossReader,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService
    ])
], ApprovalService);

//# sourceMappingURL=approval.service.js.map