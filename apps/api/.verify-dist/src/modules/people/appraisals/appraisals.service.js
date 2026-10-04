"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AppraisalsService", {
    enumerable: true,
    get: function() {
        return AppraisalsService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _auditservice = require("../../../core/audit/audit.service");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _orgservice = require("../../../core/org/org.service");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _peoplerules = require("../people.rules");
const _peopleutil = require("../people.util");
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
const RATING_LABELS = [
    'Unsatisfactory',
    'Needs improvement',
    'Meets expectations',
    'Exceeds expectations',
    'Outstanding'
];
let AppraisalsService = class AppraisalsService {
    prisma;
    org;
    notify;
    audit;
    constructor(prisma, org, notify, audit){
        this.prisma = prisma;
        this.org = org;
        this.notify = notify;
        this.audit = audit;
    }
    isAdmin() {
        return (0, _decorators.hasPerm)((0, _requestcontext.requireContext)(), 'appraisal.manage');
    }
    assertAdmin() {
        if (!this.isAdmin()) throw (0, _errors.forbidden)('Only HR can manage appraisal cycles');
    }
    // ── Templates ────────────────────────────────────────────────────────────
    async templates() {
        const rows = await this.prisma.kraTemplate.findMany({
            where: {
                status: {
                    not: 'ARCHIVED'
                }
            },
            include: {
                items: {
                    orderBy: {
                        order: 'asc'
                    }
                }
            },
            orderBy: [
                {
                    name: 'asc'
                },
                {
                    version: 'desc'
                }
            ]
        });
        const used = await this.prisma.appraisalCycle.groupBy({
            by: [
                'templateId'
            ],
            _count: {
                _all: true
            }
        });
        const um = new Map(used.map((u)=>[
                u.templateId,
                u._count._all
            ]));
        return rows.map((t)=>({
                id: t.id,
                name: t.name,
                version: t.version,
                status: t.status,
                items: t.items.map((i)=>({
                        id: i.id,
                        title: i.title,
                        description: i.description,
                        measurement: i.measurement,
                        weight: i.weight
                    })),
                cycles: um.get(t.id) ?? 0
            }));
    }
    async createTemplate(i) {
        this.assertAdmin();
        if (!(0, _peoplerules.templateWeightsValid)(i.items.map((x)=>x.weight))) throw (0, _errors.badRequest)('KRA weights must add up to 100%', 'WEIGHTS_INVALID');
        const latest = await this.prisma.kraTemplate.findFirst({
            where: {
                name: i.name
            },
            orderBy: {
                version: 'desc'
            }
        });
        const tenantId = (0, _requestcontext.requireContext)().tenantId;
        const t = await this.prisma.kraTemplate.create({
            data: {
                name: i.name,
                version: (latest?.version ?? 0) + 1,
                status: i.publish ? 'PUBLISHED' : 'DRAFT',
                ratingLabels: RATING_LABELS,
                items: {
                    create: i.items.map((x, n)=>({
                            tenantId,
                            title: x.title,
                            description: x.description ?? null,
                            measurement: x.measurement ?? null,
                            weight: x.weight,
                            order: n
                        }))
                }
            }
        });
        if (latest && i.publish) await this.prisma.kraTemplate.updateMany({
            where: {
                name: i.name,
                id: {
                    not: t.id
                },
                status: 'PUBLISHED'
            },
            data: {
                status: 'ARCHIVED'
            }
        });
        await this.audit.record({
            action: 'appraisal.template_saved',
            entity: 'KraTemplate',
            entityId: t.id,
            meta: {
                name: i.name,
                version: t.version
            }
        });
        return {
            id: t.id
        };
    }
    async publishTemplate(id) {
        this.assertAdmin();
        const t = await this.prisma.kraTemplate.findUnique({
            where: {
                id
            },
            include: {
                items: true
            }
        });
        if (!t) throw (0, _errors.notFound)('Template');
        if (!(0, _peoplerules.templateWeightsValid)(t.items.map((x)=>x.weight))) throw (0, _errors.badRequest)('KRA weights must add up to 100%', 'WEIGHTS_INVALID');
        await this.prisma.kraTemplate.update({
            where: {
                id
            },
            data: {
                status: 'PUBLISHED'
            }
        });
        await this.audit.record({
            action: 'appraisal.template_published',
            entity: 'KraTemplate',
            entityId: id
        });
        return {
            ok: true
        };
    }
    // ── Cycles ───────────────────────────────────────────────────────────────
    async cycleRows(cycles) {
        const tpls = new Map((await this.prisma.kraTemplate.findMany({
            select: {
                id: true,
                name: true,
                version: true
            }
        })).map((t)=>[
                t.id,
                `${t.name}${t.version > 1 ? ` v${t.version}` : ''}`
            ]));
        return cycles.map((c)=>{
            const ps = c.participants.filter((p)=>!p.withdrawn);
            return {
                id: c.id,
                name: c.name,
                period: `${(0, _peopleutil.fmtMonthYear)(c.periodFrom).split(' ')[0]} – ${(0, _peopleutil.fmtMonthYear)(c.periodTo)}`,
                reviewers: new Set(ps.map((p)=>p.reviewerEmployeeId)).size,
                selfPct: (0, _peoplerules.pct)(ps.filter((p)=>p.selfStatus === 'SUBMITTED').length, ps.length),
                managerPct: (0, _peoplerules.pct)(ps.filter((p)=>p.managerStatus === 'SUBMITTED').length, ps.length),
                status: c.status,
                statusLabel: _shared.APPRAISAL_STATUS_LABELS[c.status] ?? c.status,
                participants: ps.length,
                templateId: c.templateId,
                templateName: tpls.get(c.templateId) ?? '—',
                periodFrom: (0, _peopleutil.dbDateKey)(c.periodFrom),
                periodTo: (0, _peopleutil.dbDateKey)(c.periodTo),
                selfReviewDue: (0, _peopleutil.dbDateKey)(c.selfReviewDue),
                managerReviewDue: (0, _peopleutil.dbDateKey)(c.managerReviewDue)
            };
        });
    }
    async cycles() {
        const ctx = (0, _requestcontext.requireContext)();
        if (!(0, _decorators.hasPerm)(ctx, 'appraisal.view')) throw (0, _errors.forbidden)();
        const rows = await this.prisma.appraisalCycle.findMany({
            include: {
                participants: true
            },
            orderBy: {
                periodFrom: 'desc'
            }
        });
        return this.cycleRows(rows);
    }
    async snapshot(templateId) {
        const t = await this.prisma.kraTemplate.findUnique({
            where: {
                id: templateId
            },
            include: {
                items: {
                    orderBy: {
                        order: 'asc'
                    }
                }
            }
        });
        if (!t) throw (0, _errors.badRequest)('Pick a KRA template', 'TEMPLATE_INVALID');
        return t.items.map((i)=>({
                id: i.id,
                title: i.title,
                description: i.description,
                measurement: i.measurement,
                weight: i.weight
            }));
    }
    async createCycle(i) {
        this.assertAdmin();
        const tpl = await this.prisma.kraTemplate.findUnique({
            where: {
                id: i.templateId
            }
        });
        if (!tpl) throw (0, _errors.badRequest)('Pick a KRA template', 'TEMPLATE_INVALID');
        if (tpl.status !== 'PUBLISHED') throw (0, _errors.badRequest)('Publish the KRA template before using it', 'TEMPLATE_DRAFT');
        if (await this.prisma.appraisalCycle.findFirst({
            where: {
                name: i.name
            }
        })) throw (0, _errors.conflict)(`A cycle named “${i.name}” already exists`, 'DUPLICATE_NAME');
        const selfDue = i.selfReviewDue ?? addDaysKey(i.periodTo, 10);
        const mgrDue = i.managerReviewDue ?? addDaysKey(selfDue, 10);
        if (mgrDue < selfDue) throw (0, _errors.badRequest)('The manager review is due after the self review');
        const c = await this.prisma.appraisalCycle.create({
            data: {
                name: i.name,
                periodFrom: (0, _peopleutil.toDbDate)(i.periodFrom),
                periodTo: (0, _peopleutil.toDbDate)(i.periodTo),
                templateId: i.templateId,
                selfReviewDue: (0, _peopleutil.toDbDate)(selfDue),
                managerReviewDue: (0, _peopleutil.toDbDate)(mgrDue),
                eligibility: {
                    minTenureDays: i.minTenureDays,
                    types: i.employmentTypes
                },
                status: 'DRAFT'
            }
        });
        // Auto-associate eligible employees; reviewer = reporting manager.
        const emps = await this.prisma.employee.findMany({
            where: {
                status: 'ACTIVE'
            },
            select: {
                id: true,
                status: true,
                employmentType: true,
                joiningDate: true,
                managerId: true
            }
        });
        const eligible = emps.filter((e)=>e.managerId && (0, _peoplerules.eligibleForCycle)({
                status: e.status,
                employmentType: e.employmentType,
                joiningDate: (0, _peopleutil.dbDateKey)(e.joiningDate)
            }, {
                periodTo: i.periodTo,
                minTenureDays: i.minTenureDays,
                types: i.employmentTypes
            }));
        const snap = await this.snapshot(i.templateId);
        if (eligible.length) {
            await this.prisma.appraisalParticipant.createMany({
                data: eligible.map((e)=>({
                        tenantId: (0, _requestcontext.requireContext)().tenantId,
                        cycleId: c.id,
                        employeeId: e.id,
                        reviewerEmployeeId: e.managerId,
                        templateId: i.templateId,
                        templateSnapshot: snap
                    }))
            });
        }
        await this.audit.record({
            action: 'appraisal.cycle_created',
            entity: 'AppraisalCycle',
            entityId: c.id,
            meta: {
                name: i.name,
                participants: eligible.length
            }
        });
        return {
            id: c.id,
            participants: eligible.length
        };
    }
    async advance(cycleId) {
        this.assertAdmin();
        const c = await this.prisma.appraisalCycle.findUnique({
            where: {
                id: cycleId
            },
            include: {
                participants: {
                    where: {
                        withdrawn: false
                    }
                }
            }
        });
        if (!c) throw (0, _errors.notFound)('Cycle');
        const next = _peoplerules.CYCLE_FLOW[c.status];
        if (!next) throw new _errors.AppError(409, 'CYCLE_CLOSED', 'This cycle is closed');
        if (next === 'SELF_REVIEW' && !c.participants.length) throw (0, _errors.badRequest)('Associate at least one employee before launching', 'NO_PARTICIPANTS');
        if (next === 'CLOSED') {
            const missing = c.participants.filter((p)=>p.managerStatus !== 'SUBMITTED').length;
            if (missing) throw new _errors.AppError(409, 'REVIEWS_PENDING', `${missing} manager review${missing === 1 ? ' is' : 's are'} still pending`);
            for (const p of c.participants){
                const final = p.calibratedScore ?? p.managerScore;
                await this.prisma.appraisalParticipant.update({
                    where: {
                        id: p.id
                    },
                    data: {
                        finalScore: final,
                        band: (0, _peoplerules.bandFor)(final)
                    }
                });
            }
        }
        await this.prisma.appraisalCycle.update({
            where: {
                id: cycleId
            },
            data: {
                status: next,
                launchedAt: next === 'SELF_REVIEW' ? new Date() : c.launchedAt,
                closedAt: next === 'CLOSED' ? new Date() : null
            }
        });
        if (next === 'SELF_REVIEW') {
            // Refresh the frozen KRA snapshot at launch.
            for (const p of c.participants)await this.prisma.appraisalParticipant.update({
                where: {
                    id: p.id
                },
                data: {
                    templateSnapshot: await this.snapshot(p.templateId)
                }
            });
            await this.notify.notify({
                userIds: await this.notify.usersForEmployees(c.participants.map((p)=>p.employeeId)),
                type: 'people.appraisalSelf',
                title: `${c.name}: your self review is open`,
                body: `Due ${(0, _peopleutil.fmt)(c.selfReviewDue)}`,
                link: '/appraisals?tab=mine',
                from: 'HR',
                email: true
            });
        } else if (next === 'MANAGER_REVIEW') {
            await this.notify.notify({
                userIds: await this.notify.usersForEmployees([
                    ...new Set(c.participants.map((p)=>p.reviewerEmployeeId))
                ]),
                type: 'people.appraisalManager',
                title: `${c.name}: manager reviews are open`,
                body: `Due ${(0, _peopleutil.fmt)(c.managerReviewDue)}`,
                link: '/appraisals?tab=mine',
                from: 'HR',
                email: true
            });
        } else if (next === 'CLOSED') {
            await this.notify.notify({
                userIds: await this.notify.usersForEmployees(c.participants.map((p)=>p.employeeId)),
                type: 'people.appraisalClosed',
                title: `${c.name} is closed · view your final rating`,
                link: '/appraisals?tab=mine',
                from: 'HR'
            });
        }
        await this.audit.record({
            action: 'appraisal.cycle_advanced',
            entity: 'AppraisalCycle',
            entityId: cycleId,
            meta: {
                from: c.status,
                to: next
            }
        });
        return {
            status: next
        };
    }
    // ── Association ──────────────────────────────────────────────────────────
    async participants(cycleId) {
        const ctx = (0, _requestcontext.requireContext)();
        if (!(0, _decorators.hasPerm)(ctx, 'appraisal.view')) throw (0, _errors.forbidden)();
        const c = await this.prisma.appraisalCycle.findUnique({
            where: {
                id: cycleId
            }
        });
        if (!c) throw (0, _errors.notFound)('Cycle');
        let where = {
            cycleId,
            withdrawn: false
        };
        if (!this.isAdmin()) {
            const me = ctx.employeeId ?? '';
            where = {
                ...where,
                OR: [
                    {
                        reviewerEmployeeId: me
                    },
                    {
                        employeeId: {
                            in: await this.org.reportTree(me)
                        }
                    }
                ]
            };
        }
        const ps = await this.prisma.appraisalParticipant.findMany({
            where
        });
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: [
                        ...ps.map((p)=>p.employeeId),
                        ...ps.map((p)=>p.reviewerEmployeeId)
                    ]
                }
            },
            include: {
                department: true
            }
        });
        const em = new Map(emps.map((e)=>[
                e.id,
                e
            ]));
        const tpls = new Map((await this.prisma.kraTemplate.findMany({
            select: {
                id: true,
                name: true
            }
        })).map((t)=>[
                t.id,
                t.name
            ]));
        const elig = c.eligibility;
        return ps.map((p)=>{
            const e = em.get(p.employeeId);
            return {
                id: p.id,
                employeeId: p.employeeId,
                employee: e?.fullName ?? '—',
                department: e?.department?.name ?? null,
                reviewer: em.get(p.reviewerEmployeeId)?.fullName ?? '—',
                reviewerEmployeeId: p.reviewerEmployeeId,
                template: tpls.get(p.templateId) ?? '—',
                selfStatus: p.selfStatus,
                managerStatus: p.managerStatus,
                finalScore: p.finalScore ?? p.calibratedScore ?? p.managerScore,
                band: p.band ?? (0, _peoplerules.bandFor)(p.calibratedScore ?? p.managerScore),
                status: c.status,
                eligible: !!e && (0, _peoplerules.eligibleForCycle)({
                    status: e.status,
                    employmentType: e.employmentType,
                    joiningDate: (0, _peopleutil.dbDateKey)(e.joiningDate)
                }, {
                    periodTo: (0, _peopleutil.dbDateKey)(c.periodTo),
                    minTenureDays: elig.minTenureDays,
                    types: elig.types
                })
            };
        }).sort((a, b)=>a.employee.localeCompare(b.employee));
    }
    async addParticipants(cycleId, employeeIds, departmentId) {
        this.assertAdmin();
        const c = await this.prisma.appraisalCycle.findUnique({
            where: {
                id: cycleId
            }
        });
        if (!c) throw (0, _errors.notFound)('Cycle');
        if (c.status === 'CLOSED' || c.status === 'CALIBRATION') throw new _errors.AppError(409, 'CYCLE_LOCKED', 'Participants can no longer be added');
        const ids = new Set(employeeIds);
        if (departmentId) for (const e of (await this.prisma.employee.findMany({
            where: {
                departmentId,
                status: 'ACTIVE'
            },
            select: {
                id: true
            }
        })))ids.add(e.id);
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: [
                        ...ids
                    ]
                },
                status: {
                    not: 'EXITED'
                }
            },
            select: {
                id: true,
                managerId: true
            }
        });
        const existing = new Set((await this.prisma.appraisalParticipant.findMany({
            where: {
                cycleId
            },
            select: {
                employeeId: true
            }
        })).map((p)=>p.employeeId));
        const snap = await this.snapshot(c.templateId);
        let added = 0;
        const skipped = [];
        for (const e of emps){
            if (existing.has(e.id)) {
                await this.prisma.appraisalParticipant.updateMany({
                    where: {
                        cycleId,
                        employeeId: e.id,
                        withdrawn: true
                    },
                    data: {
                        withdrawn: false
                    }
                });
                continue;
            }
            if (!e.managerId) {
                skipped.push(e.id);
                continue;
            }
            await this.prisma.appraisalParticipant.create({
                data: {
                    cycleId,
                    employeeId: e.id,
                    reviewerEmployeeId: e.managerId,
                    templateId: c.templateId,
                    templateSnapshot: snap
                }
            });
            added++;
        }
        await this.audit.record({
            action: 'appraisal.participants_added',
            entity: 'AppraisalCycle',
            entityId: cycleId,
            meta: {
                added
            }
        });
        return {
            added,
            skipped: skipped.length
        };
    }
    async updateParticipant(id, dto) {
        this.assertAdmin();
        const p = await this.prisma.appraisalParticipant.findUnique({
            where: {
                id
            },
            include: {
                cycle: true
            }
        });
        if (!p) throw (0, _errors.notFound)('Participant');
        const data = {};
        if (dto.reviewerEmployeeId) {
            if (dto.reviewerEmployeeId === p.employeeId) throw (0, _errors.badRequest)('An employee cannot review themselves');
            if (p.managerStatus === 'SUBMITTED') throw new _errors.AppError(409, 'REVIEW_SUBMITTED', 'The manager review is already submitted');
            data.reviewerEmployeeId = dto.reviewerEmployeeId;
        }
        if (dto.templateId) {
            if (p.cycle.status !== 'DRAFT') throw new _errors.AppError(409, 'CYCLE_LAUNCHED', 'The template is frozen once the cycle is launched');
            data.templateId = dto.templateId;
            data.templateSnapshot = await this.snapshot(dto.templateId);
        }
        await this.prisma.appraisalParticipant.update({
            where: {
                id
            },
            data
        });
        await this.audit.record({
            action: 'appraisal.participant_updated',
            entity: 'AppraisalParticipant',
            entityId: id,
            meta: dto
        });
        return {
            ok: true
        };
    }
    async removeParticipant(id) {
        this.assertAdmin();
        const p = await this.prisma.appraisalParticipant.findUnique({
            where: {
                id
            }
        });
        if (!p) throw (0, _errors.notFound)('Participant');
        await this.prisma.appraisalParticipant.update({
            where: {
                id
            },
            data: {
                withdrawn: true
            }
        });
        await this.audit.record({
            action: 'appraisal.participant_removed',
            entity: 'AppraisalParticipant',
            entityId: id
        });
        return {
            ok: true
        };
    }
    // ── Reviews ──────────────────────────────────────────────────────────────
    async mine() {
        const me = (0, _requestcontext.requireContext)().employeeId;
        if (!me) return [];
        const ps = await this.prisma.appraisalParticipant.findMany({
            where: {
                withdrawn: false,
                OR: [
                    {
                        employeeId: me
                    },
                    {
                        reviewerEmployeeId: me
                    }
                ],
                cycle: {
                    status: {
                        not: 'DRAFT'
                    }
                }
            },
            include: {
                cycle: true
            },
            orderBy: {
                cycle: {
                    periodFrom: 'desc'
                }
            }
        });
        const names = new Map((await this.prisma.employee.findMany({
            where: {
                id: {
                    in: ps.map((p)=>p.employeeId)
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
        return ps.map((p)=>({
                id: p.id,
                cycleName: p.cycle.name,
                cycleStatus: p.cycle.status,
                employee: names.get(p.employeeId) ?? '—',
                role: p.employeeId === me ? 'SELF' : 'REVIEWER',
                selfStatus: p.selfStatus,
                managerStatus: p.managerStatus,
                finalScore: p.cycle.status === 'CLOSED' ? p.finalScore : p.employeeId === me ? null : p.calibratedScore ?? p.managerScore,
                band: p.cycle.status === 'CLOSED' ? p.band : null,
                due: (0, _peopleutil.dbDateKey)(p.employeeId === me ? p.cycle.selfReviewDue : p.cycle.managerReviewDue)
            }));
    }
    async loadParticipant(id) {
        const p = await this.prisma.appraisalParticipant.findUnique({
            where: {
                id
            },
            include: {
                cycle: true
            }
        });
        if (!p || p.withdrawn) throw (0, _errors.notFound)('Review');
        const ctx = (0, _requestcontext.requireContext)();
        const isSelf = ctx.employeeId === p.employeeId;
        const isReviewer = ctx.employeeId === p.reviewerEmployeeId;
        const admin = this.isAdmin();
        if (!isSelf && !isReviewer && !admin) throw (0, _errors.notFound)('Review');
        return {
            p,
            isSelf,
            isReviewer,
            admin
        };
    }
    async review(id) {
        const { p, isSelf, isReviewer, admin } = await this.loadParticipant(id);
        const names = new Map((await this.prisma.employee.findMany({
            where: {
                id: {
                    in: [
                        p.employeeId,
                        p.reviewerEmployeeId
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
        const snap = p.templateSnapshot;
        const r = p.ratings ?? {};
        const closed = p.cycle.status === 'CLOSED';
        // The employee sees the manager's ratings only once the cycle is closed.
        const showManager = !isSelf || closed || admin;
        const showSelfToReviewer = p.selfStatus === 'SUBMITTED' || isSelf || admin;
        return {
            id: p.id,
            cycleName: p.cycle.name,
            cycleStatus: p.cycle.status,
            employee: names.get(p.employeeId) ?? '—',
            reviewer: names.get(p.reviewerEmployeeId) ?? '—',
            isSelf,
            isReviewer,
            canCalibrate: admin && p.cycle.status === 'CALIBRATION',
            items: snap.map((k)=>({
                    id: k.id,
                    title: k.title,
                    description: k.description,
                    measurement: k.measurement,
                    weight: k.weight,
                    selfRating: showSelfToReviewer ? r[k.id]?.selfRating ?? null : null,
                    selfComment: showSelfToReviewer ? r[k.id]?.selfComment ?? null : null,
                    managerRating: showManager ? r[k.id]?.managerRating ?? null : null,
                    managerComment: showManager ? r[k.id]?.managerComment ?? null : null
                })),
            selfStatus: p.selfStatus,
            managerStatus: p.managerStatus,
            selfScore: p.selfScore,
            managerScore: showManager ? p.managerScore : null,
            finalScore: closed || !isSelf ? p.finalScore ?? p.calibratedScore ?? null : null,
            band: closed || !isSelf ? p.band ?? null : null,
            acknowledgedAt: p.acknowledgedAt?.toISOString() ?? null,
            employeeComment: p.employeeComment,
            showSelfToReviewer
        };
    }
    async saveReview(id, input) {
        const { p, isSelf, isReviewer } = await this.loadParticipant(id);
        const snap = p.templateSnapshot;
        const r = {
            ...p.ratings ?? {}
        };
        let data;
        if (isSelf && !isReviewer) {
            if (p.cycle.status !== 'SELF_REVIEW') throw new _errors.AppError(409, 'NOT_OPEN', 'The self review is not open');
            if (p.selfStatus === 'SUBMITTED') throw new _errors.AppError(409, 'SUBMITTED', 'You have already submitted your self review');
            for (const k of snap)if (input.ratings[k.id]) r[k.id] = {
                ...r[k.id],
                selfRating: input.ratings[k.id].rating ?? null,
                selfComment: input.ratings[k.id].comment ?? null
            };
            const score = (0, _peoplerules.weightedScore)(snap.map((k)=>({
                    weight: k.weight,
                    rating: r[k.id]?.selfRating
                })));
            if (input.submit && score === null) throw (0, _errors.badRequest)('Rate every KRA before submitting', 'RATINGS_INCOMPLETE');
            data = {
                ratings: r,
                selfStatus: input.submit ? 'SUBMITTED' : 'IN_PROGRESS',
                selfSubmittedAt: input.submit ? new Date() : null,
                selfScore: score
            };
            if (input.submit) await this.notify.notify({
                userIds: await this.notify.usersForEmployees([
                    p.reviewerEmployeeId
                ]),
                type: 'people.appraisalSelfDone',
                title: `Self review submitted · ${p.cycle.name}`,
                link: `/appraisals?review=${p.id}`,
                from: 'HR'
            });
        } else if (isReviewer) {
            if (![
                'SELF_REVIEW',
                'MANAGER_REVIEW'
            ].includes(p.cycle.status)) throw new _errors.AppError(409, 'NOT_OPEN', 'Manager reviews are not open');
            if (p.managerStatus === 'SUBMITTED') throw new _errors.AppError(409, 'SUBMITTED', 'You have already submitted this review');
            if (input.submit && p.cycle.status !== 'MANAGER_REVIEW') throw new _errors.AppError(409, 'NOT_OPEN', 'Submit once the manager review stage opens');
            for (const k of snap)if (input.ratings[k.id]) r[k.id] = {
                ...r[k.id],
                managerRating: input.ratings[k.id].rating ?? null,
                managerComment: input.ratings[k.id].comment ?? null
            };
            const score = (0, _peoplerules.weightedScore)(snap.map((k)=>({
                    weight: k.weight,
                    rating: r[k.id]?.managerRating
                })));
            if (input.submit && score === null) throw (0, _errors.badRequest)('Rate every KRA before submitting', 'RATINGS_INCOMPLETE');
            data = {
                ratings: r,
                managerStatus: input.submit ? 'SUBMITTED' : 'IN_PROGRESS',
                managerSubmittedAt: input.submit ? new Date() : null,
                managerScore: score
            };
        } else throw (0, _errors.forbidden)('Only the employee or the reviewer can edit this review');
        await this.prisma.appraisalParticipant.update({
            where: {
                id
            },
            data
        });
        if (input.submit) await this.audit.record({
            action: isSelf ? 'appraisal.self_submitted' : 'appraisal.manager_submitted',
            entity: 'AppraisalParticipant',
            entityId: id
        });
        return this.review(id);
    }
    async calibrate(id, score, note) {
        this.assertAdmin();
        const p = await this.prisma.appraisalParticipant.findUnique({
            where: {
                id
            },
            include: {
                cycle: true
            }
        });
        if (!p) throw (0, _errors.notFound)('Review');
        if (p.cycle.status !== 'CALIBRATION') throw new _errors.AppError(409, 'NOT_CALIBRATION', 'Calibration is not open for this cycle');
        await this.prisma.appraisalParticipant.update({
            where: {
                id
            },
            data: {
                calibratedScore: Math.round(score * 100) / 100,
                calibrationNote: note ?? null,
                band: (0, _peoplerules.bandFor)(score)
            }
        });
        await this.audit.record({
            action: 'appraisal.calibrated',
            entity: 'AppraisalParticipant',
            entityId: id,
            meta: {
                from: p.managerScore,
                to: score
            }
        });
        return this.review(id);
    }
    async acknowledge(id, comment) {
        const { p, isSelf } = await this.loadParticipant(id);
        if (!isSelf) throw (0, _errors.forbidden)();
        if (p.cycle.status !== 'CLOSED') throw new _errors.AppError(409, 'NOT_CLOSED', 'You can acknowledge once the cycle is closed');
        await this.prisma.appraisalParticipant.update({
            where: {
                id
            },
            data: {
                acknowledgedAt: new Date(),
                employeeComment: comment ?? null
            }
        });
        await this.audit.record({
            action: 'appraisal.acknowledged',
            entity: 'AppraisalParticipant',
            entityId: id
        });
        return this.review(id);
    }
    async templateOptions() {
        const rows = await this.prisma.kraTemplate.findMany({
            where: {
                status: 'PUBLISHED'
            },
            orderBy: {
                name: 'asc'
            }
        });
        return rows.map((t)=>({
                value: t.id,
                label: `${t.name}${t.version > 1 ? ` v${t.version}` : ''}`
            }));
    }
    async pendingForReviewer(employeeId) {
        return this.prisma.appraisalParticipant.count({
            where: {
                reviewerEmployeeId: employeeId,
                withdrawn: false,
                managerStatus: {
                    not: 'SUBMITTED'
                },
                cycle: {
                    status: 'MANAGER_REVIEW'
                }
            }
        });
    }
};
AppraisalsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _orgservice.OrgService === "undefined" ? Object : _orgservice.OrgService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], AppraisalsService);
function addDaysKey(s, n) {
    const d = new Date(`${s}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

//# sourceMappingURL=appraisals.service.js.map