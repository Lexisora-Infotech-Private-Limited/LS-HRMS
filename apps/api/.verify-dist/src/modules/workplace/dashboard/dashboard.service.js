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
    get DEFAULT_QUOTES () {
        return _dashboardrules.DEFAULT_QUOTES;
    },
    get DashboardService () {
        return DashboardService;
    },
    get approvalsFor () {
        return _dashboardrules.approvalsFor;
    },
    get celebrationsWithin () {
        return _dashboardrules.celebrationsWithin;
    },
    get reviewLink () {
        return _dashboardrules.reviewLink;
    },
    get sortTodos () {
        return _dashboardrules.sortTodos;
    },
    get taskLink () {
        return _dashboardrules.taskLink;
    },
    get titleLine () {
        return _dashboardrules.titleLine;
    },
    get weekRangeLabel () {
        return _dashboardrules.weekRangeLabel;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _registries = require("../../../core/registry/registries");
const _auditservice = require("../../../core/audit/audit.service");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _audience = require("../common/audience");
const _spine = require("../common/spine");
const _dates = require("../common/dates");
const _noticesservice = require("../notices/notices.service");
const _dashboardrules = require("./dashboard.rules");
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
let DashboardService = class DashboardService {
    prisma;
    approvals;
    audience;
    spine;
    notices;
    audit;
    constructor(prisma, approvals, audience, spine, notices, audit){
        this.prisma = prisma;
        this.approvals = approvals;
        this.audience = audience;
        this.spine = spine;
        this.notices = notices;
        this.audit = audit;
    }
    /** GET /dashboard — parallel sections; a slow/failed section degrades to an empty value. */ async dashboard(sections) {
        const ctx = (0, _requestcontext.requireContext)();
        const want = (s)=>!sections?.length || sections.includes(s);
        const now = new Date();
        const out = {};
        const tasks = [];
        const guard = (p, fallback)=>Promise.race([
                p,
                new Promise((r)=>setTimeout(()=>r(fallback), 2500))
            ]).catch(()=>fallback);
        if (want('greeting')) {
            tasks.push((async ()=>{
                const me = ctx.employeeId ? await this.prisma.employee.findUnique({
                    where: {
                        id: ctx.employeeId
                    },
                    include: {
                        designation: true,
                        department: true
                    }
                }) : null;
                const first = me?.firstName ?? (ctx.userName ?? '').split(' ')[0] ?? '';
                const title = me ? (0, _dashboardrules.titleLine)(me.designation?.name, me.department?.name) : '';
                out.greeting = {
                    kicker: (0, _dates.longDate)(now),
                    dayPart: (0, _shared.dayPartFor)(now),
                    firstName: first,
                    title,
                    localDate: (0, _dates.todayKey)(now)
                };
            })());
        }
        if (want('quote')) tasks.push(guard(this.quoteToday(), null).then((q)=>void (out.quote = q)));
        if (want('todos')) tasks.push(guard(this.todos(ctx), {
            items: [],
            more: 0
        }).then((t)=>{
            out.todos = t.items;
            out.todosMore = t.more;
        }));
        if (want('approvals')) tasks.push(guard(this.approvals.counts(), []).then((c)=>{
            out.approvals = (0, _dashboardrules.approvalsFor)(ctx.roleKey, c);
        }));
        if (want('announcements')) tasks.push(guard(this.notices.latestForMe(5), []).then((a)=>void (out.announcements = a)));
        if (want('events')) tasks.push(guard(this.upcoming(7), []).then((e)=>void (out.events = e.slice(0, 6))));
        await Promise.all(tasks);
        return out;
    }
    // ── Quotes ─────────────────────────────────────────────────────────────
    async quoteToday() {
        const q = await this.pickQuote((0, _dates.todayKey)());
        return q ? {
            text: q.text,
            author: q.author
        } : null;
    }
    async pickQuote(day) {
        const scheduled = await this.prisma.quote.findFirst({
            where: {
                active: true,
                scheduledFor: (0, _dates.dateOnly)(day)
            }
        });
        if (scheduled) return scheduled;
        const pool = await this.prisma.quote.findMany({
            where: {
                active: true,
                scheduledFor: null
            },
            orderBy: [
                {
                    sortOrder: 'asc'
                },
                {
                    id: 'asc'
                }
            ]
        });
        if (!pool.length) return {
            id: null,
            text: _dashboardrules.DEFAULT_QUOTES[(0, _shared.quoteIndexFor)(day, _dashboardrules.DEFAULT_QUOTES.length)],
            author: null
        };
        return pool[(0, _shared.quoteIndexFor)(day, pool.length)];
    }
    async listQuotes() {
        const [rows, today] = await Promise.all([
            this.prisma.quote.findMany({
                orderBy: [
                    {
                        scheduledFor: {
                            sort: 'desc',
                            nulls: 'last'
                        }
                    },
                    {
                        sortOrder: 'asc'
                    },
                    {
                        createdAt: 'asc'
                    }
                ]
            }),
            this.pickQuote((0, _dates.todayKey)())
        ]);
        return rows.map((q)=>({
                id: q.id,
                text: q.text,
                author: q.author,
                scheduledFor: q.scheduledFor ? (0, _dates.keyOf)(q.scheduledFor) : null,
                active: q.active,
                sortOrder: q.sortOrder,
                isToday: q.id === today?.id
            }));
    }
    async createQuote(dto) {
        if (dto.scheduledFor) await this.assertFreeDay(dto.scheduledFor);
        const max = await this.prisma.quote.aggregate({
            _max: {
                sortOrder: true
            }
        });
        const q = await this.prisma.quote.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                text: dto.text,
                author: dto.author,
                scheduledFor: dto.scheduledFor ? (0, _dates.dateOnly)(dto.scheduledFor) : null,
                active: dto.active,
                sortOrder: (max._max.sortOrder ?? 0) + 1
            }
        });
        await this.audit.record({
            action: 'quote.create',
            entity: 'Quote',
            entityId: q.id
        });
        return q;
    }
    async assertFreeDay(day, exceptId) {
        const clash = await this.prisma.quote.findFirst({
            where: {
                scheduledFor: (0, _dates.dateOnly)(day),
                ...exceptId ? {
                    NOT: {
                        id: exceptId
                    }
                } : {}
            }
        });
        if (clash) throw (0, _errors.badRequest)(`Another quote is already scheduled for ${(0, _dates.dayMonth)((0, _dates.dateOnly)(day))}`, 'QUOTE_DAY_TAKEN');
    }
    async updateQuote(id, dto) {
        const cur = await this.prisma.quote.findFirst({
            where: {
                id
            }
        });
        if (!cur) throw (0, _errors.notFound)('Quote');
        if (dto.scheduledFor) await this.assertFreeDay(dto.scheduledFor, id);
        const q = await this.prisma.quote.update({
            where: {
                id
            },
            data: {
                ...dto.text !== undefined && {
                    text: dto.text
                },
                ...dto.author !== undefined && {
                    author: dto.author
                },
                ...dto.active !== undefined && {
                    active: dto.active
                },
                ...dto.scheduledFor !== undefined && {
                    scheduledFor: dto.scheduledFor ? (0, _dates.dateOnly)(dto.scheduledFor) : null
                }
            }
        });
        await this.audit.record({
            action: 'quote.update',
            entity: 'Quote',
            entityId: id
        });
        return q;
    }
    async deleteQuote(id) {
        const cur = await this.prisma.quote.findFirst({
            where: {
                id
            }
        });
        if (!cur) throw (0, _errors.notFound)('Quote');
        await this.prisma.quote.delete({
            where: {
                id
            }
        });
        await this.audit.record({
            action: 'quote.delete',
            entity: 'Quote',
            entityId: id
        });
        return {
            ok: true
        };
    }
    // ── To-dos ─────────────────────────────────────────────────────────────
    async todos(ctx, limit = 6) {
        const all = await this.allTodos(ctx);
        return {
            items: all.slice(0, limit),
            more: Math.max(0, all.length - limit)
        };
    }
    /** GET /todos — every merged item plus my personal list (done items stay visible for 24 hours, spec §1.3). */ async listTodos() {
        const ctx = (0, _requestcontext.requireContext)();
        const me = ctx.employeeId;
        if (!me) return {
            items: [],
            personal: []
        };
        const [items, rows] = await Promise.all([
            this.allTodos(ctx),
            this.prisma.personalTodo.findMany({
                where: {
                    employeeId: me,
                    OR: [
                        {
                            completedAt: null
                        },
                        {
                            completedAt: {
                                gt: new Date(Date.now() - _dates.DAY_MS)
                            }
                        }
                    ]
                },
                orderBy: [
                    {
                        completedAt: {
                            sort: 'asc',
                            nulls: 'first'
                        }
                    },
                    {
                        dueDate: {
                            sort: 'asc',
                            nulls: 'last'
                        }
                    },
                    {
                        createdAt: 'asc'
                    }
                ]
            })
        ]);
        return {
            items,
            personal: rows.map((r)=>this.personalRow(r))
        };
    }
    personalRow(r) {
        const today = (0, _dates.todayKey)();
        const due = r.dueDate ? (0, _dates.keyOf)(r.dueDate) : null;
        return {
            id: r.id,
            title: r.title,
            note: r.note,
            dueDate: due,
            due: (0, _dates.dueLabel)(due, today),
            overdue: !r.completedAt && !!due && due < today,
            completedAt: r.completedAt?.toISOString() ?? null
        };
    }
    async allTodos(ctx) {
        const me = ctx.employeeId;
        if (!me) return [];
        const today = (0, _dates.todayKey)();
        const items = [];
        const push = (t)=>items.push({
                ...t,
                due: (0, _dates.dueLabel)(t.dueDate, today),
                overdue: !!t.dueDate && t.dueDate < today,
                sortDate: t.dueDate ?? '9999-12-31'
            });
        const emp = await this.prisma.employee.findUnique({
            where: {
                id: me
            },
            select: {
                employmentType: true,
                joiningDate: true
            }
        });
        await Promise.allSettled([
            // 1. Last week's timesheet not submitted (time domain spine: Timesheet)
            (async ()=>{
                if (!(0, _decorators.hasPerm)(ctx, 'timesheet.self') || emp?.employmentType === 'INTERN') return;
                const lastWeek = (0, _dates.addDaysKey)((0, _dates.weekStartKey)(today), -7);
                if (emp?.joiningDate && (0, _dates.keyOf)(emp.joiningDate) > (0, _dates.addDaysKey)(lastWeek, 6)) return;
                const rows = await this.spine.timesheets({
                    employeeId: me,
                    weekStart: (0, _dates.dateOnly)(lastWeek)
                });
                const sheet = rows[0];
                if (sheet && ![
                    'DRAFT',
                    'RETURNED'
                ].includes(sheet.status)) return;
                push({
                    id: `sys:timesheet:${lastWeek}`,
                    source: 'SYSTEM',
                    text: `Submit timesheet for ${(0, _dashboardrules.weekRangeLabel)(lastWeek)}`,
                    dueDate: (0, _dates.addDaysKey)(lastWeek, 8),
                    link: '/timesheet',
                    checkable: false,
                    prio: 0,
                    createdAt: 0
                });
            })(),
            // 2. Policies needing acknowledgement
            (async ()=>{
                const acks = await this.prisma.policyAck.findMany({
                    where: {
                        employeeId: me,
                        acknowledgedAt: null
                    },
                    include: {
                        version: {
                            include: {
                                policy: true
                            }
                        }
                    }
                });
                for (const a of acks){
                    const p = a.version.policy;
                    if (p.status !== 'PUBLISHED' || p.currentVersionId !== a.policyVersionId) continue;
                    push({
                        id: `sys:policy:${a.id}`,
                        source: 'SYSTEM',
                        text: `Acknowledge ${p.title}${a.version.version > 1 ? ' update' : ''}`,
                        dueDate: (0, _dates.keyOf)(new Date(a.dueAt.getTime() + 330 * 60_000)),
                        link: `/policies?read=${p.id}`,
                        checkable: false,
                        prio: 0,
                        createdAt: 1
                    });
                }
            })(),
            // 3. Code reviews: DEV_COMPLETED tasks on projects I lead or review (I hold the project's
            //    standing "Code review" task), or that I reported — never my own.
            (async ()=>{
                const [led, reviewDuty] = await Promise.all([
                    this.spine.projects({
                        leadEmployeeId: me
                    }),
                    this.spine.tasks({
                        assigneeEmployeeId: me,
                        isStanding: true,
                        status: {
                            in: [
                                'ALLOTTED',
                                'WIP'
                            ]
                        },
                        title: {
                            contains: 'review',
                            mode: 'insensitive'
                        }
                    }, 20)
                ]);
                const projectIds = [
                    ...new Set([
                        ...led.map((p)=>p.id),
                        ...reviewDuty.map((t)=>t.projectId)
                    ])
                ];
                const or = [
                    {
                        reporterEmployeeId: me
                    }
                ];
                if (projectIds.length) or.push({
                    projectId: {
                        in: projectIds
                    }
                });
                const tasks = await this.spine.tasks({
                    status: 'DEV_COMPLETED',
                    AND: [
                        {
                            OR: or
                        },
                        {
                            OR: [
                                {
                                    assigneeEmployeeId: null
                                },
                                {
                                    assigneeEmployeeId: {
                                        not: me
                                    }
                                }
                            ]
                        }
                    ]
                }, 10);
                for (const t of tasks)push({
                    id: `sys:review:${t.id}`,
                    source: 'SYSTEM',
                    text: `Code review: ${t.key} ${t.title}`,
                    dueDate: t.dueDate ? (0, _dates.keyOf)(t.dueDate) : null,
                    link: (0, _dashboardrules.taskLink)(t),
                    checkable: false,
                    prio: 0,
                    createdAt: 2
                });
            })(),
            // 4. Board tasks assigned to me (ALLOTTED/WIP), due within 7 days or overdue
            (async ()=>{
                const tasks = await this.spine.tasks({
                    assigneeEmployeeId: me,
                    status: {
                        in: [
                            'ALLOTTED',
                            'WIP'
                        ]
                    },
                    dueDate: {
                        lte: (0, _dates.dateOnly)((0, _dates.addDaysKey)(today, 7))
                    }
                }, 10);
                for (const t of tasks)push({
                    id: `board:${t.id}`,
                    source: 'BOARD',
                    text: `${t.key} ${t.title}`,
                    dueDate: t.dueDate ? (0, _dates.keyOf)(t.dueDate) : null,
                    link: (0, _dashboardrules.taskLink)(t),
                    checkable: false,
                    prio: 1,
                    createdAt: 0
                });
            })(),
            // 5. Required courses due within 7 days / overdue
            (async ()=>{
                const enr = await this.prisma.enrollment.findMany({
                    where: {
                        employeeId: me,
                        required: true,
                        status: {
                            not: 'COMPLETED'
                        },
                        dueAt: {
                            lte: new Date(Date.now() + 7 * _dates.DAY_MS)
                        }
                    },
                    include: {
                        course: true
                    }
                });
                for (const e of enr)push({
                    id: `sys:course:${e.id}`,
                    source: 'SYSTEM',
                    text: `Complete course: ${e.course.title}`,
                    dueDate: e.dueAt ? (0, _dates.keyOf)(new Date(e.dueAt.getTime() + 330 * 60_000)) : null,
                    link: '/learning',
                    checkable: false,
                    prio: 0,
                    createdAt: 3
                });
            })(),
            // 6. Helpdesk tickets waiting on me as requester
            (async ()=>{
                const t = await this.prisma.helpdeskTicket.findMany({
                    where: {
                        requesterEmployeeId: me,
                        status: 'WAITING'
                    }
                });
                for (const x of t)push({
                    id: `sys:ticket:${x.id}`,
                    source: 'SYSTEM',
                    text: `Reply on ${x.code}: ${x.subject}`,
                    dueDate: today,
                    link: `/helpdesk?ticket=${x.id}`,
                    checkable: false,
                    prio: 0,
                    createdAt: 4
                });
            })(),
            // 7. Pending onboarding steps (people domain, read defensively)
            (async ()=>{
                const obs = await this.spine.rawFindMany('onboarding', {
                    where: {
                        employeeId: me,
                        status: {
                            in: [
                                'NOT_STARTED',
                                'IN_PROGRESS'
                            ]
                        }
                    }
                });
                for (const ob of obs){
                    const steps = await this.spine.rawFindMany('onboardingStep', {
                        where: {
                            onboardingId: ob.id,
                            status: {
                                in: [
                                    'PENDING',
                                    'IN_PROGRESS',
                                    'NEEDS_ATTENTION'
                                ]
                            }
                        }
                    });
                    if (steps.length) push({
                        id: `sys:onboarding:${ob.id}`,
                        source: 'SYSTEM',
                        text: `Complete onboarding · ${steps.length} step${steps.length > 1 ? 's' : ''} pending`,
                        dueDate: today,
                        link: '/onboarding',
                        checkable: false,
                        prio: 0,
                        createdAt: 5
                    });
                }
            })(),
            // 8. Interviews to score (people domain, read defensively)
            (async ()=>{
                const panels = await this.spine.rawFindMany('interviewPanelist', {
                    where: {
                        employeeId: me
                    }
                });
                if (!panels.length) return;
                const ids = panels.map((p)=>p.interviewId);
                const [ivs, cards] = await Promise.all([
                    this.spine.rawFindMany('interview', {
                        where: {
                            id: {
                                in: ids
                            },
                            startsAt: {
                                lte: new Date()
                            },
                            status: {
                                notIn: [
                                    'CANCELLED',
                                    'NO_SHOW'
                                ]
                            }
                        }
                    }),
                    this.spine.rawFindMany('interviewScorecard', {
                        where: {
                            interviewId: {
                                in: ids
                            },
                            interviewerEmployeeId: me
                        }
                    })
                ]);
                const done = new Set(cards.filter((c)=>c.status === 'SUBMITTED').map((c)=>c.interviewId));
                for (const iv of ivs)if (!done.has(iv.id)) push({
                    id: `sys:interview:${iv.id}`,
                    source: 'SYSTEM',
                    text: `Score interview${iv.roundName ? `: ${iv.roundName}` : ''}`,
                    dueDate: (0, _dates.keyOf)(new Date(iv.startsAt.getTime() + 330 * 60_000)),
                    link: '/interviews',
                    checkable: false,
                    prio: 0,
                    createdAt: 6
                });
            })(),
            // 9. Personal to-dos (open ones; completed ones leave the card)
            (async ()=>{
                const rows = await this.prisma.personalTodo.findMany({
                    where: {
                        employeeId: me,
                        completedAt: null
                    },
                    orderBy: {
                        createdAt: 'asc'
                    }
                });
                for (const r of rows)push({
                    id: r.id,
                    source: 'PERSONAL',
                    text: r.title,
                    dueDate: r.dueDate ? (0, _dates.keyOf)(r.dueDate) : null,
                    link: null,
                    checkable: true,
                    prio: 2,
                    createdAt: r.createdAt.getTime()
                });
            })()
        ]);
        return (0, _dashboardrules.sortTodos)(items).map(({ sortDate: _s, prio: _p, createdAt: _c, ...t })=>t);
    }
    me() {
        const id = (0, _requestcontext.requireContext)().employeeId;
        if (!id) throw (0, _errors.badRequest)('Your account is not linked to an employee record', 'NO_EMPLOYEE');
        return id;
    }
    async createTodo(dto) {
        const t = await this.prisma.personalTodo.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                employeeId: this.me(),
                title: dto.title,
                note: dto.note,
                dueDate: dto.dueDate ? (0, _dates.dateOnly)(dto.dueDate) : null
            }
        });
        return this.personalRow(t);
    }
    async ownTodo(id) {
        const t = await this.prisma.personalTodo.findFirst({
            where: {
                id,
                employeeId: this.me()
            }
        });
        if (!t) throw (0, _errors.notFound)('To-do');
        return t;
    }
    async updateTodo(id, dto) {
        await this.ownTodo(id);
        const t = await this.prisma.personalTodo.update({
            where: {
                id
            },
            data: {
                ...dto.title !== undefined && {
                    title: dto.title
                },
                ...dto.note !== undefined && {
                    note: dto.note
                },
                ...dto.dueDate !== undefined && {
                    dueDate: dto.dueDate ? (0, _dates.dateOnly)(dto.dueDate) : null
                }
            }
        });
        return this.personalRow(t);
    }
    async setTodoDone(id, done) {
        await this.ownTodo(id);
        const t = await this.prisma.personalTodo.update({
            where: {
                id
            },
            data: {
                completedAt: done ? new Date() : null
            }
        });
        return this.personalRow(t);
    }
    async deleteTodo(id) {
        await this.ownTodo(id);
        await this.prisma.personalTodo.delete({
            where: {
                id
            }
        });
        return {
            ok: true
        };
    }
    /** Housekeeping: completed personal to-dos are deleted after 90 days. */ async purgeOldTodos() {
        const r = await this.prisma.personalTodo.deleteMany({
            where: {
                completedAt: {
                    lt: new Date(Date.now() - 90 * _dates.DAY_MS)
                }
            }
        });
        return r.count;
    }
    // ── Events & celebrations ──────────────────────────────────────────────
    /** Dashboard "Birthdays & events": celebrations + live company events in the next `days`. */ async upcoming(days) {
        const ctx = (0, _requestcontext.requireContext)();
        const today = (0, _dates.todayKey)();
        const cel = await this.celebrations(days, ctx.employeeId);
        const events = await this.eventsBetween((0, _dates.istInstant)(today, '00:00'), (0, _dates.istInstant)((0, _dates.addDaysKey)(today, days + 1), '00:00'), false);
        const evs = events.map((e)=>({
                id: e.id,
                kind: 'EVENT',
                what: e.title,
                when: `${(0, _dates.dayMonth)(e.startsAt)}, ${(0, _dates.shortTime)(e.startsAt)}`,
                date: this.eventDate(e)
            }));
        return [
            ...cel,
            ...evs
        ].sort((a, b)=>a.date.localeCompare(b.date) || (a.kind === 'EVENT' ? 1 : 0) - (b.kind === 'EVENT' ? 1 : 0));
    }
    async celebrations(days, excludeId) {
        const people = await this.prisma.employee.findMany({
            where: {
                status: {
                    in: [
                        'ACTIVE',
                        'NOTICE_PERIOD'
                    ]
                }
            },
            select: {
                id: true,
                fullName: true,
                dateOfBirth: true,
                joiningDate: true
            }
        });
        return (0, _dashboardrules.celebrationsWithin)(people.map((p)=>({
                id: p.id,
                name: p.fullName,
                dob: p.dateOfBirth,
                joined: p.joiningDate
            })), (0, _dates.todayKey)(), days, excludeId);
    }
    eventDate(e) {
        return (0, _dates.keyOf)(new Date(e.startsAt.getTime() + 330 * 60_000));
    }
    /** Audience-filtered events between two instants; cancelled ones linger 24 h when asked. */ async eventsBetween(from, to, includeCancelled) {
        const ctx = (0, _requestcontext.requireContext)();
        const rows = await this.prisma.companyEvent.findMany({
            where: {
                startsAt: {
                    gte: from,
                    lt: to
                },
                OR: includeCancelled ? [
                    {
                        cancelledAt: null
                    },
                    {
                        cancelledAt: {
                            gt: new Date(Date.now() - _dates.DAY_MS)
                        }
                    }
                ] : [
                    {
                        cancelledAt: null
                    }
                ]
            },
            orderBy: {
                startsAt: 'asc'
            }
        });
        const out = [];
        for (const r of rows)if (await this.audience.matches(ctx.employeeId, r.audiences ?? [])) out.push(r);
        return out;
    }
    eventRow(e, canManage) {
        return {
            id: e.id,
            title: e.title,
            description: e.description,
            kind: e.kind,
            startsAt: e.startsAt.toISOString(),
            endsAt: e.endsAt?.toISOString() ?? null,
            location: e.location,
            when: `${(0, _dates.dayMonth)(e.startsAt)}, ${(0, _dates.shortTime)(e.startsAt)}`,
            date: this.eventDate(e),
            cancelled: !!e.cancelledAt,
            canManage
        };
    }
    async listEvents(q) {
        const ctx = (0, _requestcontext.requireContext)();
        const from = q.from ?? (0, _dates.todayKey)();
        const to = q.to ?? (0, _dates.addDaysKey)(from, q.days ?? 60);
        const rows = await this.eventsBetween((0, _dates.istInstant)(from, '00:00'), (0, _dates.istInstant)((0, _dates.addDaysKey)(to, 1), '00:00'), true);
        const canManage = (0, _decorators.hasPerm)(ctx, 'notices.publish.global');
        return rows.map((e)=>this.eventRow(e, canManage));
    }
    eventTimes(dto) {
        const startsAt = new Date(dto.startsAt);
        const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
        if (Number.isNaN(startsAt.getTime())) throw (0, _errors.badRequest)('Enter a valid start date and time', 'EVENT_DATES');
        if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)) throw (0, _errors.badRequest)('The event must end after it starts', 'EVENT_DATES');
        return {
            startsAt,
            endsAt
        };
    }
    async createEvent(dto) {
        const ctx = (0, _requestcontext.requireContext)();
        const { startsAt, endsAt } = this.eventTimes(dto);
        const e = await this.prisma.companyEvent.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                title: dto.title,
                description: dto.description,
                kind: dto.kind,
                startsAt,
                endsAt,
                location: dto.location,
                createdByEmployeeId: ctx.employeeId ?? null,
                audiences: []
            }
        });
        await this.audit.record({
            action: 'event.create',
            entity: 'CompanyEvent',
            entityId: e.id,
            meta: {
                title: e.title
            }
        });
        return this.eventRow(e, true);
    }
    async updateEvent(id, dto) {
        const cur = await this.prisma.companyEvent.findFirst({
            where: {
                id
            }
        });
        if (!cur) throw (0, _errors.notFound)('Event');
        const { startsAt, endsAt } = this.eventTimes(dto);
        const e = await this.prisma.companyEvent.update({
            where: {
                id
            },
            data: {
                title: dto.title,
                description: dto.description,
                kind: dto.kind,
                startsAt,
                endsAt,
                location: dto.location
            }
        });
        await this.audit.record({
            action: 'event.update',
            entity: 'CompanyEvent',
            entityId: id
        });
        return this.eventRow(e, true);
    }
    async cancelEvent(id) {
        const cur = await this.prisma.companyEvent.findFirst({
            where: {
                id
            }
        });
        if (!cur) throw (0, _errors.notFound)('Event');
        const e = await this.prisma.companyEvent.update({
            where: {
                id
            },
            data: {
                cancelledAt: cur.cancelledAt ?? new Date()
            }
        });
        await this.audit.record({
            action: 'event.cancel',
            entity: 'CompanyEvent',
            entityId: id
        });
        return this.eventRow(e, true);
    }
};
DashboardService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _registries.ApprovalCountsService === "undefined" ? Object : _registries.ApprovalCountsService,
        typeof _audience.AudienceService === "undefined" ? Object : _audience.AudienceService,
        typeof _spine.SpineReader === "undefined" ? Object : _spine.SpineReader,
        typeof _noticesservice.NoticesService === "undefined" ? Object : _noticesservice.NoticesService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], DashboardService);

//# sourceMappingURL=dashboard.service.js.map