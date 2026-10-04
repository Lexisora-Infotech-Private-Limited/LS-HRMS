"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "InternsService", {
    enumerable: true,
    get: function() {
        return InternsService;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _requestcontext = require("../../../core/context/request-context");
const _decorators = require("../../../core/auth/decorators");
const _errors = require("../../../core/http/errors");
const _workmetricsservice = require("../projects/work-metrics.service");
const _workrules = require("../work.rules");
const _workutil = require("../work.util");
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
const DAY_LABEL = (key)=>new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC'
    });
let InternsService = class InternsService {
    prisma;
    audit;
    notifications;
    realtime;
    metrics;
    log = new _common.Logger('Interns');
    constructor(prisma, audit, notifications, realtime, metrics){
        this.prisma = prisma;
        this.audit = audit;
        this.notifications = notifications;
        this.realtime = realtime;
        this.metrics = metrics;
    }
    me() {
        const ctx = (0, _requestcontext.requireContext)();
        return {
            employeeId: ctx.employeeId ?? null,
            name: ctx.userName ?? 'System',
            userId: ctx.userId ?? null,
            viewAll: (0, _decorators.hasPerm)(ctx, 'interns.viewAll'),
            canAssign: (0, _decorators.hasPerm)(ctx, 'interns.manage') || (0, _decorators.hasPerm)(ctx, 'interns.viewAll')
        };
    }
    internSelect = {
        id: true,
        fullName: true,
        empCode: true,
        managerId: true,
        userId: true,
        employmentType: true,
        department: {
            select: {
                name: true
            }
        }
    };
    /** Interns visible to the viewer (for sheets and the assign form). */ async visibleInterns(m, mentorFilter) {
        const base = {
            employmentType: 'INTERN',
            status: {
                not: 'EXITED'
            }
        };
        if (m.viewAll) {
            return this.prisma.employee.findMany({
                where: {
                    ...base,
                    ...mentorFilter ? {
                        managerId: mentorFilter
                    } : {}
                },
                select: this.internSelect,
                orderBy: {
                    fullName: 'asc'
                }
            });
        }
        if (!m.employeeId) return [];
        const or = [
            {
                id: m.employeeId
            }
        ];
        // Mentor = the intern's reporting manager (relationship scope, independent of interns.manage).
        or.push({
            managerId: m.employeeId
        });
        return this.prisma.employee.findMany({
            where: {
                ...base,
                OR: or
            },
            select: this.internSelect,
            orderBy: {
                fullName: 'asc'
            }
        });
    }
    async requireIntern(m, internId) {
        const e = await this.prisma.employee.findFirst({
            where: {
                id: internId
            },
            select: this.internSelect
        });
        if (!e) throw (0, _errors.notFound)('Intern');
        const isSelf = e.id === m.employeeId;
        const isMentor = !!m.employeeId && e.managerId === m.employeeId;
        if (!isSelf && !isMentor && !m.viewAll) throw (0, _errors.notFound)('Intern');
        return {
            ...e,
            isSelf,
            isMentor
        };
    }
    /** Linked-task hours: tracked minutes on the board task for that intern and date. */ async linkedMinutes(tasks) {
        const linked = tasks.filter((t)=>t.linkedTaskId);
        const out = new Map();
        if (!linked.length) return out;
        const { byTaskEmpDay } = await this.metrics.trackedByTask([
            ...new Set(linked.map((t)=>t.linkedTaskId))
        ]);
        for (const t of linked){
            const m = byTaskEmpDay.get(`${t.linkedTaskId}|${t.internEmployeeId}|${(0, _workutil.dateKey)(t.date)}`);
            if (m) out.set(t.id, m);
        }
        return out;
    }
    async rows(tasks) {
        const linked = await this.linkedMinutes(tasks);
        const keys = tasks.filter((t)=>t.linkedTaskId).length ? new Map((await this.prisma.task.findMany({
            where: {
                id: {
                    in: tasks.map((t)=>t.linkedTaskId).filter((x)=>!!x)
                }
            },
            select: {
                id: true,
                key: true
            }
        })).map((t)=>[
                t.id,
                t.key
            ])) : new Map();
        return new Map(tasks.map((t)=>{
            const minutes = linked.get(t.id) ?? t.minutes;
            return [
                t.id,
                {
                    id: t.id,
                    date: (0, _workutil.dateKey)(t.date),
                    title: t.title,
                    description: t.description,
                    status: t.status,
                    hours: minutes != null ? (0, _workutil.hoursOf)(minutes) : null,
                    estimatedHours: (0, _workutil.hoursOf)(t.estimatedMinutes),
                    internNote: t.internNote,
                    mentorScore: t.mentorScore,
                    mentorFeedback: t.mentorFeedback,
                    linkedTaskKey: t.linkedTaskId ? keys.get(t.linkedTaskId) ?? null : null,
                    carriedFromId: t.carriedFromId
                }
            ];
        }));
    }
    async weekScores(internIds, weekStart) {
        const start = (0, _workutil.dateOnly)(weekStart);
        const end = (0, _workutil.dateOnly)((0, _workrules.addDays)(weekStart, 7));
        const [overrides, scored] = await Promise.all([
            this.prisma.internWeekScore.findMany({
                where: {
                    internEmployeeId: {
                        in: internIds
                    },
                    weekStart: start
                }
            }),
            this.prisma.internTask.findMany({
                where: {
                    internEmployeeId: {
                        in: internIds
                    },
                    date: {
                        gte: start,
                        lt: end
                    },
                    mentorScore: {
                        not: null
                    }
                },
                select: {
                    internEmployeeId: true,
                    mentorScore: true
                }
            })
        ]);
        const out = new Map();
        for (const id of internIds){
            const o = overrides.find((x)=>x.internEmployeeId === id);
            out.set(id, o ? o.score : (0, _workrules.meanScore)(scored.filter((s)=>s.internEmployeeId === id).map((s)=>s.mentorScore)));
        }
        return out;
    }
    // ── Context & sheet ─────────────────────────────────────────────────────
    async context() {
        const m = this.me();
        const self = m.employeeId ? await this.prisma.employee.findFirst({
            where: {
                id: m.employeeId
            },
            select: {
                employmentType: true
            }
        }) : null;
        const interns = await this.visibleInterns(m);
        const mentees = interns.filter((i)=>i.id !== m.employeeId && (m.viewAll || i.managerId === m.employeeId));
        return {
            isIntern: self?.employmentType === 'INTERN',
            isMentor: mentees.some((i)=>i.managerId === m.employeeId),
            canAssign: mentees.length > 0,
            canViewAll: m.viewAll,
            mentees: mentees.map((i)=>({
                    value: i.id,
                    label: i.fullName
                })),
            today: (0, _workutil.todayKey)()
        };
    }
    async sheet(q) {
        const m = this.me();
        const date = q.date ?? (0, _workutil.todayKey)();
        const interns = await this.visibleInterns(m, q.mentorEmployeeId);
        if (!interns.length) return [];
        const ids = interns.map((i)=>i.id);
        const tasks = await this.prisma.internTask.findMany({
            where: {
                internEmployeeId: {
                    in: ids
                },
                date: (0, _workutil.dateOnly)(date)
            },
            orderBy: {
                createdAt: 'asc'
            }
        });
        const rows = await this.rows(tasks);
        const scores = await this.weekScores(ids, (0, _workrules.weekStartOf)(date));
        const mentorNames = new Map((await this.prisma.employee.findMany({
            where: {
                id: {
                    in: interns.map((i)=>i.managerId).filter((x)=>!!x)
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
        const today = (0, _workutil.todayKey)();
        return interns.map((i)=>{
            const mine = tasks.filter((t)=>t.internEmployeeId === i.id).map((t)=>rows.get(t.id));
            const st = (0, _workrules.internDayStatus)(mine.map((t)=>t.status), {
                isPastDay: date < today,
                afterCutoff: date === today && (0, _workutil.istMinuteOfDay)() >= 18 * 60 + 30
            });
            return {
                internEmployeeId: i.id,
                internName: i.fullName,
                empCode: i.empCode,
                department: i.department?.name ?? null,
                mentorEmployeeId: i.managerId,
                mentorName: i.managerId ? mentorNames.get(i.managerId) ?? null : null,
                todayTask: mine[0]?.title ?? null,
                todayMore: Math.max(0, mine.length - 1),
                hours: Math.round(mine.reduce((s, t)=>s + (t.hours ?? 0), 0) * 100) / 100,
                status: st.key,
                statusLabel: st.label,
                weekScore: scores.get(i.id) ?? null,
                tasks: mine
            };
        });
    }
    // ── Assign / update ─────────────────────────────────────────────────────
    async assign(input) {
        const m = this.me();
        if (!m.canAssign && !m.employeeId) throw (0, _errors.forbidden)('Only mentors, HR and admins can assign intern tasks');
        const intern = await this.prisma.employee.findFirst({
            where: {
                id: input.internEmployeeId
            },
            select: this.internSelect
        });
        if (!intern) throw (0, _errors.notFound)('Intern');
        if (intern.employmentType !== 'INTERN') throw new _errors.AppError(422, 'NOT_AN_INTERN', `${intern.fullName} is not an intern`);
        if (!m.viewAll && intern.managerId !== m.employeeId) throw (0, _errors.forbidden)(`You are not ${intern.fullName}'s mentor`);
        if (input.date < (0, _workutil.todayKey)()) throw new _errors.AppError(422, 'PAST_DATE', 'Tasks can be assigned for today or a later date');
        if (input.linkedTaskId && !await this.prisma.task.count({
            where: {
                id: input.linkedTaskId
            }
        })) throw new _errors.AppError(422, 'TASK_INVALID', 'Linked board task not found');
        const t = await this.prisma.internTask.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                internEmployeeId: intern.id,
                mentorEmployeeId: intern.managerId ?? m.employeeId ?? intern.id,
                date: (0, _workutil.dateOnly)(input.date),
                title: input.title,
                description: input.description,
                estimatedMinutes: input.estimatedHours != null ? Math.round(input.estimatedHours * 60) : null,
                linkedTaskId: input.linkedTaskId,
                assignedByEmployeeId: m.employeeId
            }
        });
        await this.audit.record({
            action: 'intern_task.assigned',
            entity: 'InternTask',
            entityId: t.id,
            meta: {
                intern: intern.fullName,
                date: input.date,
                title: input.title.slice(0, 120)
            }
        });
        if (intern.userId) {
            await this.notifications.notify({
                userIds: [
                    intern.userId
                ],
                type: 'intern.task',
                title: `New task from ${m.name}`,
                body: input.title.slice(0, 200),
                link: '/interns',
                from: m.name
            });
            this.realtime.toUsers([
                intern.userId
            ], 'work.interns', {
                internEmployeeId: intern.id
            });
        }
        return {
            id: t.id,
            message: `Task assigned to ${intern.fullName}`
        };
    }
    async requireTask(id) {
        const m = this.me();
        const t = await this.prisma.internTask.findFirst({
            where: {
                id
            }
        });
        if (!t) throw (0, _errors.notFound)('Task');
        const intern = await this.requireIntern(m, t.internEmployeeId);
        return {
            m,
            t,
            intern
        };
    }
    async update(id, input) {
        const { m, t, intern } = await this.requireTask(id);
        const mentorSide = intern.isMentor || m.viewAll;
        const selfFields = [
            'status',
            'hours',
            'internNote'
        ];
        const keys = Object.keys(input).filter((k)=>input[k] !== undefined);
        if (!mentorSide) {
            if (!intern.isSelf) throw (0, _errors.forbidden)();
            const bad = keys.filter((k)=>!selfFields.includes(k));
            if (bad.length) throw (0, _errors.forbidden)('Only your mentor can change the task, date or score');
            if ((0, _workutil.dateKey)(t.date) < (0, _workrules.addDays)((0, _workutil.todayKey)(), -7)) throw new _errors.AppError(423, 'SHEET_LOCKED', 'Tasks older than a week are read-only');
        }
        const status = input.status ?? t.status;
        if (input.mentorScore != null && status !== 'DONE' && status !== 'NOT_DONE') throw new _errors.AppError(422, 'NOT_SCOREABLE', 'Score a task once it is done or not done');
        if (input.date !== undefined && input.date !== (0, _workutil.dateKey)(t.date) && input.date < (0, _workutil.todayKey)()) throw new _errors.AppError(422, 'PAST_DATE', 'Move tasks to today or a later date');
        const data = {};
        if (input.status !== undefined) data.status = input.status;
        if (input.hours !== undefined) data.minutes = input.hours == null ? null : Math.round(input.hours * 60);
        if (input.internNote !== undefined) data.internNote = input.internNote;
        if (input.title !== undefined) data.title = input.title;
        if (input.description !== undefined) data.description = input.description;
        if (input.date !== undefined) data.date = (0, _workutil.dateOnly)(input.date);
        if (input.mentorFeedback !== undefined) data.mentorFeedback = input.mentorFeedback;
        if (input.mentorScore !== undefined) {
            data.mentorScore = input.mentorScore;
            data.scoredAt = input.mentorScore == null ? null : new Date();
            data.scoredByEmployeeId = input.mentorScore == null ? null : m.employeeId;
        }
        // Starting from the sheet with "Done" but no hours: take the estimate as a sensible default.
        if (input.status === 'DONE' && input.hours === undefined && t.minutes == null && t.estimatedMinutes) data.minutes = t.estimatedMinutes;
        await this.prisma.internTask.update({
            where: {
                id
            },
            data
        });
        await this.audit.record({
            action: input.mentorScore != null ? 'intern_task.scored' : 'intern_task.updated',
            entity: 'InternTask',
            entityId: id,
            meta: {
                intern: intern.fullName,
                changes: keys
            }
        });
        if (intern.isSelf && input.status && input.status !== t.status && (input.status === 'DONE' || input.status === 'NOT_DONE')) {
            await this.notifications.notify({
                userIds: await this.notifications.usersForEmployees([
                    intern.managerId
                ]),
                type: 'intern.task_status',
                title: `${intern.fullName} marked "${t.title.slice(0, 60)}" ${input.status === 'DONE' ? 'done' : 'not done'}`,
                link: '/interns',
                from: intern.fullName
            });
        }
        if (!intern.isSelf && input.mentorScore != null && intern.userId) {
            await this.notifications.notify({
                userIds: [
                    intern.userId
                ],
                type: 'intern.scored',
                title: `Your task was scored ${input.mentorScore}/10`,
                body: input.mentorFeedback ?? undefined,
                link: '/interns',
                from: m.name
            });
        }
        this.realtime.toUsers((await this.notifications.usersForEmployees([
            intern.id,
            intern.managerId
        ])).filter(Boolean), 'work.interns', {
            internEmployeeId: intern.id
        });
        return {
            ok: true
        };
    }
    async remove(id) {
        const { m, t, intern } = await this.requireTask(id);
        if (!intern.isMentor && !m.viewAll) throw (0, _errors.forbidden)('Only the mentor can remove a task');
        if (t.mentorScore != null) throw new _errors.AppError(409, 'SCORED', 'Scored tasks cannot be removed');
        await this.prisma.internTask.delete({
            where: {
                id
            }
        });
        await this.audit.record({
            action: 'intern_task.removed',
            entity: 'InternTask',
            entityId: id,
            meta: {
                intern: intern.fullName,
                title: t.title.slice(0, 120)
            }
        });
        return {
            ok: true
        };
    }
    async carryOver(id) {
        const { m, t, intern } = await this.requireTask(id);
        if (!intern.isMentor && !m.viewAll) throw (0, _errors.forbidden)('Only the mentor can carry a task over');
        if (t.status === 'DONE') throw new _errors.AppError(422, 'ALREADY_DONE', 'This task is already done');
        if (await this.prisma.internTask.count({
            where: {
                carriedFromId: id
            }
        })) throw new _errors.AppError(409, 'ALREADY_CARRIED', 'This task was already carried over');
        const next = (0, _workrules.nextWorkingDay)((0, _workutil.dateKey)(t.date) < (0, _workutil.todayKey)() ? (0, _workrules.addDays)((0, _workutil.todayKey)(), -1) : (0, _workutil.dateKey)(t.date));
        await this.prisma.internTask.update({
            where: {
                id
            },
            data: {
                status: 'NOT_DONE'
            }
        });
        const n = await this.prisma.internTask.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                internEmployeeId: t.internEmployeeId,
                mentorEmployeeId: t.mentorEmployeeId,
                date: (0, _workutil.dateOnly)(next),
                title: t.title,
                description: t.description,
                estimatedMinutes: t.estimatedMinutes,
                linkedTaskId: t.linkedTaskId,
                carriedFromId: id,
                assignedByEmployeeId: m.employeeId
            }
        });
        await this.audit.record({
            action: 'intern_task.carried_over',
            entity: 'InternTask',
            entityId: n.id,
            meta: {
                from: id,
                date: next
            }
        });
        return {
            id: n.id,
            date: next,
            message: `Carried over to ${DAY_LABEL(next)}`
        };
    }
    // ── Week view & weekly score ────────────────────────────────────────────
    async week(internId, weekStartIn) {
        const m = this.me();
        const intern = await this.requireIntern(m, internId);
        const weekStart = (0, _workrules.weekStartOf)(weekStartIn ?? (0, _workutil.todayKey)());
        const start = (0, _workutil.dateOnly)(weekStart);
        const tasks = await this.prisma.internTask.findMany({
            where: {
                internEmployeeId: internId,
                date: {
                    gte: start,
                    lt: (0, _workutil.dateOnly)((0, _workrules.addDays)(weekStart, 7))
                }
            },
            orderBy: [
                {
                    date: 'asc'
                },
                {
                    createdAt: 'asc'
                }
            ]
        });
        const rows = await this.rows(tasks);
        const override = await this.prisma.internWeekScore.findFirst({
            where: {
                internEmployeeId: internId,
                weekStart: start
            }
        });
        const mentor = intern.managerId ? await this.prisma.employee.findFirst({
            where: {
                id: intern.managerId
            },
            select: {
                fullName: true
            }
        }) : null;
        const scoredBy = override?.scoredByEmployeeId ? await this.prisma.employee.findFirst({
            where: {
                id: override.scoredByEmployeeId
            },
            select: {
                fullName: true
            }
        }) : null;
        const all = tasks.map((t)=>rows.get(t.id));
        const avgTaskScore = (0, _workrules.meanScore)(all.map((t)=>t.mentorScore));
        // Trend: this and the previous five weeks.
        const trend = [];
        for(let i = 5; i >= 0; i--){
            const ws = (0, _workrules.addDays)(weekStart, -7 * i);
            const s = await this.weekScores([
                internId
            ], ws);
            trend.push({
                weekStart: ws,
                score: s.get(internId) ?? null
            });
        }
        return {
            intern: {
                id: intern.id,
                name: intern.fullName,
                empCode: intern.empCode,
                mentorName: mentor?.fullName ?? null,
                department: intern.department?.name ?? null
            },
            weekStart,
            days: [
                0,
                1,
                2,
                3,
                4,
                5
            ].map((i)=>{
                const d = (0, _workrules.addDays)(weekStart, i);
                return {
                    date: d,
                    label: DAY_LABEL(d),
                    tasks: all.filter((t)=>t.date === d)
                };
            }),
            totals: {
                hours: Math.round(all.reduce((s, t)=>s + (t.hours ?? 0), 0) * 100) / 100,
                done: all.filter((t)=>t.status === 'DONE').length,
                total: all.length,
                avgTaskScore
            },
            weekScore: override ? {
                score: override.score,
                feedback: override.feedback,
                scoredBy: scoredBy?.fullName ?? null
            } : null,
            effectiveScore: override?.score ?? avgTaskScore,
            trend,
            canScore: intern.isMentor || m.viewAll,
            canEditOwn: intern.isSelf
        };
    }
    async setWeekScore(internId, input) {
        const m = this.me();
        const intern = await this.requireIntern(m, internId);
        if (!intern.isMentor && !m.viewAll) throw (0, _errors.forbidden)('Only the mentor can score the week');
        const weekStart = (0, _workutil.dateOnly)((0, _workrules.weekStartOf)(input.weekStart));
        await this.prisma.internWeekScore.upsert({
            where: {
                internEmployeeId_weekStart: {
                    internEmployeeId: internId,
                    weekStart
                }
            },
            create: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                internEmployeeId: internId,
                weekStart,
                score: input.score,
                feedback: input.feedback,
                scoredByEmployeeId: m.employeeId
            },
            update: {
                score: input.score,
                feedback: input.feedback,
                scoredByEmployeeId: m.employeeId
            }
        });
        await this.audit.record({
            action: 'intern_week.scored',
            entity: 'Employee',
            entityId: internId,
            meta: {
                weekStart: (0, _workutil.dateKey)(weekStart),
                score: input.score
            }
        });
        if (intern.userId) await this.notifications.notify({
            userIds: [
                intern.userId
            ],
            type: 'intern.week_scored',
            title: `Week score: ${input.score}/10`,
            body: input.feedback ?? undefined,
            link: '/interns',
            from: m.name
        });
        return {
            ok: true
        };
    }
    // ── Schedules ───────────────────────────────────────────────────────────
    /** 00:05 IST: tasks of earlier days still open become NOT_DONE (mentor may carry them over). */ async closeYesterday() {
        const tenants = await this.prisma.raw.tenant.findMany({
            select: {
                id: true
            }
        });
        for (const tn of tenants){
            await (0, _requestcontext.runAsTenant)(tn.id, async ()=>{
                const r = await this.prisma.internTask.updateMany({
                    where: {
                        date: {
                            lt: (0, _workutil.dateOnly)((0, _workutil.todayKey)())
                        },
                        status: {
                            in: [
                                'ASSIGNED',
                                'IN_PROGRESS'
                            ]
                        }
                    },
                    data: {
                        status: 'NOT_DONE'
                    }
                });
                if (r.count) this.log.log(`${tn.id}: ${r.count} intern tasks marked not done`);
            }).catch((e)=>this.log.error(e.message));
        }
    }
    /** 18:00 IST: remind interns about today's open tasks. */ async eveningReminder() {
        const tenants = await this.prisma.raw.tenant.findMany({
            select: {
                id: true
            }
        });
        for (const tn of tenants){
            await (0, _requestcontext.runAsTenant)(tn.id, async ()=>{
                const open = await this.prisma.internTask.findMany({
                    where: {
                        date: (0, _workutil.dateOnly)((0, _workutil.todayKey)()),
                        status: {
                            in: [
                                'ASSIGNED',
                                'IN_PROGRESS'
                            ]
                        }
                    },
                    select: {
                        internEmployeeId: true
                    }
                });
                const ids = [
                    ...new Set(open.map((o)=>o.internEmployeeId))
                ];
                for (const id of ids){
                    await this.notifications.notify({
                        userIds: await this.notifications.usersForEmployees([
                            id
                        ]),
                        type: 'intern.reminder',
                        title: 'Update today’s task sheet before you log off',
                        link: '/interns',
                        from: 'System'
                    });
                }
            }).catch((e)=>this.log.error(e.message));
        }
    }
};
_ts_decorate([
    (0, _schedule.Cron)('5 0 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], InternsService.prototype, "closeYesterday", null);
_ts_decorate([
    (0, _schedule.Cron)('0 18 * * 1-6', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], InternsService.prototype, "eveningReminder", null);
InternsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _workmetricsservice.WorkMetricsService === "undefined" ? Object : _workmetricsservice.WorkMetricsService
    ])
], InternsService);

//# sourceMappingURL=interns.service.js.map