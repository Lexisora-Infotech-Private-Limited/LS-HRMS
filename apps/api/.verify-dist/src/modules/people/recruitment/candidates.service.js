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
    get CandidatesService () {
        return CandidatesService;
    },
    get STAGE_LABEL () {
        return STAGE_LABEL;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _auditservice = require("../../../core/audit/audit.service");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _mailservice = require("../../../core/mail/mail.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _employeesservice = require("../employees/employees.service");
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
const STAGE_LABEL = {
    SCREENING: 'Screening',
    INTERVIEW: 'Interview',
    OFFERED: 'Offered',
    HIRED: 'Hired',
    REJECTED: 'Rejected',
    OFFER_DECLINED: 'Offer declined',
    WITHDRAWN: 'Withdrawn'
};
const TAB_STAGES = {
    all: null,
    screening: [
        'SCREENING'
    ],
    interview: [
        'INTERVIEW'
    ],
    offered: [
        'OFFERED',
        'HIRED'
    ],
    rejected: [
        'REJECTED',
        'OFFER_DECLINED',
        'WITHDRAWN'
    ]
};
let CandidatesService = class CandidatesService {
    prisma;
    employees;
    mail;
    notify;
    audit;
    constructor(prisma, employees, mail, notify, audit){
        this.prisma = prisma;
        this.employees = employees;
        this.mail = mail;
        this.notify = notify;
        this.audit = audit;
    }
    canManage() {
        const ctx = (0, _requestcontext.requireContext)();
        return (0, _decorators.hasPerm)(ctx, 'candidates.manage') || (0, _decorators.hasPerm)(ctx, 'jobs.manage');
    }
    assertManage() {
        if (!this.canManage()) throw (0, _errors.forbidden)('Only recruiters can change candidates');
    }
    /**
   * Leads (recruiters without `jobs.manage`) see only candidates for jobs in their own
   * department or jobs they are the hiring manager for (spec M6). HR/admin: no scope.
   */ async jobScope() {
        const ctx = (0, _requestcontext.requireContext)();
        if ((0, _decorators.hasPerm)(ctx, 'jobs.manage')) return null;
        const me = ctx.employeeId;
        if (!me) return {
            id: '__none__'
        };
        const e = await this.prisma.employee.findUnique({
            where: {
                id: me
            },
            select: {
                departmentId: true
            }
        });
        return {
            OR: [
                {
                    hiringManagerId: me
                },
                ...e?.departmentId ? [
                    {
                        departmentId: e.departmentId
                    }
                ] : []
            ]
        };
    }
    // ── List / detail ────────────────────────────────────────────────────────
    async list(q) {
        const base = {
            candidate: {
                anonymisedAt: null
            }
        };
        const scope = await this.jobScope();
        if (scope) base.job = scope;
        if (q.jobId) base.jobId = q.jobId;
        if (q.q) base.candidate = {
            anonymisedAt: null,
            OR: [
                {
                    fullName: {
                        contains: q.q,
                        mode: 'insensitive'
                    }
                },
                {
                    email: {
                        contains: q.q,
                        mode: 'insensitive'
                    }
                },
                {
                    tags: {
                        has: q.q.toLowerCase()
                    }
                }
            ]
        };
        const stages = TAB_STAGES[q.tab];
        const where = stages ? {
            AND: [
                base,
                {
                    stage: {
                        in: stages
                    }
                }
            ]
        } : base;
        const [apps, grouped] = await Promise.all([
            this.prisma.jobApplication.findMany({
                where,
                include: {
                    candidate: true,
                    job: {
                        select: {
                            title: true
                        }
                    }
                },
                orderBy: [
                    {
                        stageChangedAt: 'desc'
                    }
                ],
                take: 500
            }),
            this.prisma.jobApplication.groupBy({
                by: [
                    'stage'
                ],
                where: base,
                _count: {
                    _all: true
                }
            })
        ]);
        const by = Object.fromEntries(grouped.map((g)=>[
                g.stage,
                g._count._all
            ]));
        const sum = (s)=>s.reduce((a, k)=>a + (by[k] ?? 0), 0);
        const items = apps.map((a)=>({
                applicationId: a.id,
                candidateId: a.candidateId,
                name: a.candidate.fullName,
                email: a.candidate.email,
                appliedFor: a.job.title,
                jobId: a.jobId,
                source: a.candidate.source,
                sourceLabel: _shared.CANDIDATE_SOURCE_LABELS[a.candidate.source],
                score: a.score,
                stage: a.stage,
                stageLabel: STAGE_LABEL[a.stage],
                resumeFileId: a.candidate.resumeFileId
            }));
        return {
            items,
            counts: {
                all: grouped.reduce((s, g)=>s + g._count._all, 0),
                screening: sum([
                    'SCREENING'
                ]),
                interview: sum([
                    'INTERVIEW'
                ]),
                offered: sum([
                    'OFFERED',
                    'HIRED'
                ]),
                rejected: sum([
                    'REJECTED',
                    'OFFER_DECLINED',
                    'WITHDRAWN'
                ])
            },
            canManage: this.canManage()
        };
    }
    async detail(candidateId) {
        const c = await this.prisma.candidate.findUnique({
            where: {
                id: candidateId
            },
            include: {
                applications: {
                    include: {
                        job: {
                            select: {
                                title: true,
                                departmentId: true,
                                hiringManagerId: true
                            }
                        },
                        offer: true,
                        events: {
                            orderBy: {
                                at: 'asc'
                            }
                        },
                        interviews: {
                            include: {
                                panelists: true,
                                scorecards: true
                            },
                            orderBy: {
                                startsAt: 'asc'
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            }
        });
        if (!c || c.anonymisedAt) throw (0, _errors.notFound)('Candidate');
        const scope = await this.jobScope();
        if (scope) {
            const me = (0, _requestcontext.requireContext)().employeeId;
            const dept = me ? (await this.prisma.employee.findUnique({
                where: {
                    id: me
                },
                select: {
                    departmentId: true
                }
            }))?.departmentId : null;
            c.applications = c.applications.filter((a)=>a.job.hiringManagerId === me || !!dept && a.job.departmentId === dept);
            if (!c.applications.length) throw (0, _errors.notFound)('Candidate');
        }
        const empIds = c.applications.flatMap((a)=>a.interviews.flatMap((i)=>[
                    ...i.panelists.map((p)=>p.employeeId),
                    ...i.scorecards.map((s)=>s.interviewerEmployeeId)
                ]));
        const names = new Map((await this.prisma.employee.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(empIds)
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
        return {
            id: c.id,
            fullName: c.fullName,
            email: c.email,
            phone: c.phone,
            location: c.location,
            source: c.source,
            sourceLabel: _shared.CANDIDATE_SOURCE_LABELS[c.source],
            tags: c.tags,
            resumeFileId: c.resumeFileId,
            currentCtcPaise: c.currentCtcPaise,
            expectedCtcPaise: c.expectedCtcPaise,
            noticePeriodDays: c.noticePeriodDays,
            applications: c.applications.map((a)=>({
                    id: a.id,
                    jobId: a.jobId,
                    jobTitle: a.job.title,
                    stage: a.stage,
                    stageLabel: STAGE_LABEL[a.stage],
                    score: a.score,
                    employeeId: a.employeeId,
                    offer: a.offer ? {
                        annualCtcPaise: a.offer.annualCtcPaise,
                        joiningDate: (0, _peopleutil.dbDateKey)(a.offer.joiningDate),
                        expiresOn: (0, _peopleutil.dbDateKey)(a.offer.expiresOn),
                        status: a.offer.status,
                        designationId: a.offer.designationId,
                        departmentId: a.offer.departmentId,
                        branchId: a.offer.branchId,
                        employmentType: a.offer.employmentType
                    } : null,
                    events: a.events.map((e)=>({
                            from: e.from,
                            to: e.to,
                            by: e.byName,
                            reason: e.reason,
                            at: e.at.toISOString()
                        })),
                    interviews: a.interviews.map((i)=>({
                            id: i.id,
                            round: i.roundName,
                            when: (0, _peopleutil.fmtWhen)(i.startsAt),
                            interviewer: names.get(i.panelists.find((p)=>p.role === 'LEAD')?.employeeId ?? i.panelists[0]?.employeeId ?? '') ?? '—',
                            result: i.status === 'CANCELLED' ? 'CANCELLED' : i.result,
                            scores: i.scorecards.map((s)=>({
                                    by: names.get(s.interviewerEmployeeId) ?? '—',
                                    overall: s.overall,
                                    recommendation: s.recommendation,
                                    status: s.status
                                }))
                        }))
                })),
            canManage: this.canManage(),
            canHire: (0, _decorators.hasPerm)((0, _requestcontext.requireContext)(), 'employees.manage')
        };
    }
    // ── Create / stage changes ───────────────────────────────────────────────
    async event(applicationId, from, to, reason) {
        await this.prisma.jobApplicationEvent.create({
            data: {
                applicationId,
                from,
                to,
                reason: reason ?? null,
                byName: (0, _requestcontext.requireContext)().userName ?? null
            }
        });
    }
    async create(i) {
        this.assertManage();
        const job = await this.prisma.job.findUnique({
            where: {
                id: i.jobId
            }
        });
        if (!job) throw (0, _errors.badRequest)('Pick the job applied for', 'JOB_INVALID');
        if (job.status === 'CLOSED') throw (0, _errors.conflict)(`${job.title} is closed for applications`, 'JOB_CLOSED');
        const file = await this.prisma.fileObject.findUnique({
            where: {
                id: i.resumeFileId
            }
        });
        if (!file) throw (0, _errors.badRequest)('Attach the resume', 'FILE_MISSING');
        const tags = (i.tags ?? '').split(',').map((t)=>t.trim().toLowerCase()).filter(Boolean).slice(0, 10);
        const existing = await this.prisma.candidate.findFirst({
            where: {
                email: i.email
            }
        });
        let candidateId;
        if (existing) {
            if (existing.anonymisedAt) throw (0, _errors.conflict)('This candidate asked to be forgotten; add them as a new record later', 'ANONYMISED');
            if (await this.prisma.jobApplication.findFirst({
                where: {
                    candidateId: existing.id,
                    jobId: job.id
                }
            })) throw (0, _errors.conflict)(`${existing.fullName} has already applied for ${job.title}`, 'DUPLICATE_APPLICATION');
            await this.prisma.candidate.update({
                where: {
                    id: existing.id
                },
                data: {
                    phone: i.phone,
                    resumeFileId: i.resumeFileId,
                    source: i.source,
                    tags: [
                        ...new Set([
                            ...existing.tags,
                            ...tags
                        ])
                    ]
                }
            });
            candidateId = existing.id;
        } else {
            const c = await this.prisma.candidate.create({
                data: {
                    fullName: i.fullName,
                    email: i.email,
                    phone: i.phone,
                    location: i.location ?? null,
                    source: i.source,
                    referredByEmployeeId: i.referredByEmployeeId ?? null,
                    currentCtcPaise: i.currentCtcPaise ?? null,
                    expectedCtcPaise: i.expectedCtcPaise ?? null,
                    noticePeriodDays: i.noticePeriodDays ?? null,
                    totalExpMonths: i.totalExpYears != null ? Math.round(i.totalExpYears * 12) : null,
                    tags,
                    resumeFileId: i.resumeFileId,
                    consentAt: i.consent ? new Date() : null,
                    retentionUntil: (0, _peopleutil.toDbDate)((0, _peoplerules.addDays)((0, _peopleutil.todayKey)(), 730))
                }
            });
            candidateId = c.id;
        }
        const app = await this.prisma.jobApplication.create({
            data: {
                candidateId,
                jobId: job.id,
                stage: 'SCREENING'
            }
        });
        await this.event(app.id, null, 'SCREENING', 'Added');
        await this.audit.record({
            action: 'candidate.added',
            entity: 'Candidate',
            entityId: candidateId,
            meta: {
                jobId: job.id,
                source: i.source
            }
        });
        if (job.hiringManagerId) {
            await this.notify.notify({
                userIds: await this.notify.usersForEmployees([
                    job.hiringManagerId
                ]),
                type: 'people.newApplicant',
                title: `New applicant for ${job.title}: ${i.fullName}`,
                link: `/candidates?candidate=${candidateId}`,
                from: 'Recruitment'
            });
        }
        return {
            candidateId,
            applicationId: app.id
        };
    }
    async addApplication(candidateId, jobId) {
        this.assertManage();
        const [c, job] = await Promise.all([
            this.prisma.candidate.findUnique({
                where: {
                    id: candidateId
                }
            }),
            this.prisma.job.findUnique({
                where: {
                    id: jobId
                }
            })
        ]);
        if (!c || c.anonymisedAt) throw (0, _errors.notFound)('Candidate');
        if (!job || job.status === 'CLOSED') throw (0, _errors.badRequest)('Pick an open job', 'JOB_INVALID');
        if (await this.prisma.jobApplication.findFirst({
            where: {
                candidateId,
                jobId
            }
        })) throw (0, _errors.conflict)(`${c.fullName} has already applied for ${job.title}`, 'DUPLICATE_APPLICATION');
        const app = await this.prisma.jobApplication.create({
            data: {
                candidateId,
                jobId,
                stage: 'SCREENING'
            }
        });
        await this.event(app.id, null, 'SCREENING', 'Considered for another job');
        await this.audit.record({
            action: 'candidate.applied',
            entity: 'JobApplication',
            entityId: app.id,
            meta: {
                jobId
            }
        });
        return this.detail(candidateId);
    }
    async moveStage(applicationId, to, reason) {
        this.assertManage();
        const a = await this.prisma.jobApplication.findUnique({
            where: {
                id: applicationId
            },
            include: {
                candidate: true
            }
        });
        if (!a) throw (0, _errors.notFound)('Application');
        if (a.stage === to) return this.detail(a.candidateId);
        if (to === 'HIRED') throw new _errors.AppError(409, 'USE_HIRE', 'Use “Hire” to convert the candidate into an employee');
        if (!(0, _peoplerules.canMoveStage)(a.stage, to)) throw new _errors.AppError(409, 'INVALID_TRANSITION', `Cannot move from ${STAGE_LABEL[a.stage]} to ${STAGE_LABEL[to]}`);
        if (to === 'REJECTED' && !reason?.trim()) throw (0, _errors.badRequest)('Give a rejection reason', 'REASON_REQUIRED');
        await this.prisma.jobApplication.update({
            where: {
                id: applicationId
            },
            data: {
                stage: to,
                stageChangedAt: new Date(),
                rejectReason: to === 'REJECTED' ? reason.trim() : null
            }
        });
        if (to === 'OFFER_DECLINED') await this.prisma.jobOffer.updateMany({
            where: {
                applicationId
            },
            data: {
                status: 'DECLINED'
            }
        });
        if (to === 'WITHDRAWN' || to === 'REJECTED') await this.prisma.jobOffer.updateMany({
            where: {
                applicationId,
                status: {
                    in: [
                        'DRAFT',
                        'ISSUED'
                    ]
                }
            },
            data: {
                status: 'WITHDRAWN'
            }
        });
        await this.event(applicationId, a.stage, to, reason);
        await this.audit.record({
            action: 'candidate.stage_changed',
            entity: 'JobApplication',
            entityId: applicationId,
            meta: {
                from: a.stage,
                to,
                reason: reason ?? null
            }
        });
        return this.detail(a.candidateId);
    }
    /** Recompute the application score from submitted scorecards (average overall /10). */ async recomputeScore(applicationId) {
        const cards = await this.prisma.interviewScorecard.findMany({
            where: {
                interview: {
                    applicationId,
                    status: {
                        not: 'CANCELLED'
                    }
                },
                status: 'SUBMITTED'
            },
            select: {
                overall: true
            }
        });
        const score = (0, _peoplerules.applicationScore)(cards.map((c)=>c.overall));
        await this.prisma.jobApplication.update({
            where: {
                id: applicationId
            },
            data: {
                score
            }
        });
        return score;
    }
    // ── Offer & hire ─────────────────────────────────────────────────────────
    async saveOffer(applicationId, i) {
        this.assertManage();
        const a = await this.prisma.jobApplication.findUnique({
            where: {
                id: applicationId
            },
            include: {
                candidate: true,
                job: true
            }
        });
        if (!a) throw (0, _errors.notFound)('Application');
        if (![
            'SCREENING',
            'INTERVIEW',
            'OFFERED'
        ].includes(a.stage)) throw new _errors.AppError(409, 'INVALID_STAGE', `Cannot make an offer at stage ${STAGE_LABEL[a.stage]}`);
        if (i.expiresOn < (0, _peopleutil.todayKey)()) throw (0, _errors.badRequest)('The offer expiry must be in the future');
        const data = {
            designationId: i.designationId ?? a.job.designationId ?? null,
            departmentId: i.departmentId ?? a.job.departmentId,
            branchId: i.branchId ?? a.job.branchId ?? null,
            employmentType: i.employmentType,
            annualCtcPaise: i.annualCtcPaise,
            joiningDate: (0, _peopleutil.toDbDate)(i.joiningDate),
            expiresOn: (0, _peopleutil.toDbDate)(i.expiresOn),
            status: 'ISSUED'
        };
        await this.prisma.jobOffer.upsert({
            where: {
                applicationId
            },
            create: {
                applicationId,
                ...data
            },
            update: data
        });
        if (a.stage !== 'OFFERED') {
            await this.prisma.jobApplication.update({
                where: {
                    id: applicationId
                },
                data: {
                    stage: 'OFFERED',
                    stageChangedAt: new Date()
                }
            });
            await this.event(applicationId, a.stage, 'OFFERED', `Offer ${(0, _peopleutil.inrPdf)(i.annualCtcPaise)} p.a.`);
        }
        const t = await this.prisma.raw.tenant.findUnique({
            where: {
                id: (0, _requestcontext.requireContext)().tenantId
            }
        });
        const company = t?.name ?? 'Lexisora';
        await this.mail.send({
            to: a.candidate.email,
            subject: `Offer from ${company} · ${a.job.title}`,
            text: `Hi ${a.candidate.fullName},\n\nWe are delighted to offer you the role of ${a.job.title} at ${company} with an annual CTC of ${(0, _peopleutil.inrPdf)(i.annualCtcPaise)}, joining on ${(0, _peopleutil.fmt)(i.joiningDate)}.\n\nThis offer is valid until ${(0, _peopleutil.fmt)(i.expiresOn)}. Once you accept, you will receive an invite to sign the formal offer letter online.\n\n— ${company} HR`,
            html: `<p>Hi ${(0, _employeesservice.escapeHtml)(a.candidate.fullName)},</p><p>We are delighted to offer you the role of <b>${(0, _employeesservice.escapeHtml)(a.job.title)}</b> at ${(0, _employeesservice.escapeHtml)(company)} with an annual CTC of <b>${(0, _peopleutil.inrPdf)(i.annualCtcPaise)}</b>, joining on ${(0, _peopleutil.fmt)(i.joiningDate)}.</p><p>This offer is valid until ${(0, _peopleutil.fmt)(i.expiresOn)}. Once you accept, you will receive an invite to sign the formal offer letter online.</p><p>— ${(0, _employeesservice.escapeHtml)(company)} HR</p>`
        });
        await this.audit.record({
            action: 'offer.issued',
            entity: 'JobApplication',
            entityId: applicationId,
            meta: {
                annualCtcPaise: i.annualCtcPaise,
                joiningDate: i.joiningDate
            }
        });
        return this.detail(a.candidateId);
    }
    /** "Hire": candidate → employee (User INVITED + Employee + onboarding), application HIRED. */ async hire(applicationId, i) {
        const ctx = (0, _requestcontext.requireContext)();
        if (!(0, _decorators.hasPerm)(ctx, 'employees.manage')) throw (0, _errors.forbidden)('Only HR can hire');
        const a = await this.prisma.jobApplication.findUnique({
            where: {
                id: applicationId
            },
            include: {
                candidate: true,
                job: true,
                offer: true
            }
        });
        if (!a) throw (0, _errors.notFound)('Application');
        if (a.employeeId || a.stage === 'HIRED') throw (0, _errors.conflict)(`${a.candidate.fullName} is already hired`, 'ALREADY_HIRED');
        if (a.stage !== 'OFFERED' && a.stage !== 'INTERVIEW') throw new _errors.AppError(409, 'INVALID_STAGE', 'Make an offer before hiring');
        const departmentId = i.departmentId ?? a.offer?.departmentId ?? a.job.departmentId;
        const designationId = i.designationId ?? a.offer?.designationId ?? a.job.designationId;
        if (!designationId) throw (0, _errors.badRequest)('Pick a designation', 'DESIGNATION_REQUIRED');
        const joiningDate = i.joiningDate ?? (0, _peopleutil.dbDateKey)(a.offer?.joiningDate) ?? (0, _peoplerules.addDays)((0, _peopleutil.todayKey)(), 7);
        const employmentType = a.offer?.employmentType ?? (a.job.jobType === 'INTERNSHIP' ? 'INTERN' : a.job.jobType === 'CONTRACT' ? 'CONTRACT' : 'FULL_TIME');
        const res = await this.employees.create({
            fullName: a.candidate.fullName,
            officialEmail: i.officialEmail,
            personalEmail: a.candidate.email,
            phone: a.candidate.phone,
            departmentId,
            designationId,
            managerId: i.managerId ?? a.job.hiringManagerId ?? null,
            employmentType,
            workMode: i.workMode,
            joiningDate,
            shiftId: i.shiftId ?? null,
            branchId: a.offer?.branchId ?? a.job.branchId ?? null,
            skipOnboarding: false,
            sendInvite: true
        }, {
            sourceApplicationId: a.id,
            resumeFileId: a.candidate.resumeFileId
        });
        await this.prisma.jobApplication.update({
            where: {
                id: a.id
            },
            data: {
                stage: 'HIRED',
                stageChangedAt: new Date(),
                employeeId: res.employee.id
            }
        });
        if (a.offer) await this.prisma.jobOffer.update({
            where: {
                id: a.offer.id
            },
            data: {
                employeeId: res.employee.id
            }
        });
        else {
            await this.prisma.jobOffer.create({
                data: {
                    applicationId: a.id,
                    designationId,
                    departmentId,
                    branchId: a.job.branchId,
                    employmentType,
                    annualCtcPaise: a.candidate.expectedCtcPaise ?? 0,
                    joiningDate: (0, _peopleutil.toDbDate)(joiningDate),
                    expiresOn: (0, _peopleutil.toDbDate)(joiningDate),
                    status: 'ISSUED',
                    employeeId: res.employee.id
                }
            });
        }
        await this.event(a.id, a.stage, 'HIRED', `Employee ${res.employee.empCode}`);
        const hired = await this.prisma.jobApplication.count({
            where: {
                jobId: a.jobId,
                stage: 'HIRED'
            }
        });
        if (hired >= a.job.openings && a.job.status !== 'CLOSED') {
            await this.prisma.job.update({
                where: {
                    id: a.jobId
                },
                data: {
                    status: 'CLOSED',
                    closedAt: new Date(),
                    closeReason: 'FILLED'
                }
            });
            await this.audit.record({
                action: 'job.closed',
                entity: 'Job',
                entityId: a.jobId,
                meta: {
                    reason: 'FILLED'
                }
            });
        }
        await this.audit.record({
            action: 'candidate.hired',
            entity: 'JobApplication',
            entityId: a.id,
            meta: {
                employeeId: res.employee.id,
                empCode: res.employee.empCode
            }
        });
        return {
            ...res,
            candidateId: a.candidateId
        };
    }
    /** DPDP: anonymise a candidate on request (keeps aggregate pipeline numbers). */ async anonymise(candidateId) {
        this.assertManage();
        const c = await this.prisma.candidate.findUnique({
            where: {
                id: candidateId
            },
            include: {
                applications: true
            }
        });
        if (!c) throw (0, _errors.notFound)('Candidate');
        if (c.applications.some((a)=>a.stage === 'HIRED')) throw (0, _errors.conflict)('Hired candidates are kept on the employee record', 'HIRED');
        await this.prisma.candidate.update({
            where: {
                id: candidateId
            },
            data: {
                fullName: 'Anonymised candidate',
                email: `anon-${candidateId}@invalid.local`,
                phone: '0000000000',
                location: null,
                resumeFileId: null,
                notes: null,
                tags: [],
                anonymisedAt: new Date()
            }
        });
        await this.audit.record({
            action: 'candidate.anonymised',
            entity: 'Candidate',
            entityId: candidateId
        });
        return {
            ok: true
        };
    }
    /**
   * DPDP retention (daily job): candidates whose retentionUntil has passed are anonymised.
   * Hired candidates are kept (their data lives on the employee record). Runs without a user.
   */ async retentionSweep(today = (0, _peopleutil.todayKey)()) {
        const due = await this.prisma.candidate.findMany({
            where: {
                anonymisedAt: null,
                retentionUntil: {
                    lt: (0, _peopleutil.toDbDate)(today)
                },
                applications: {
                    none: {
                        stage: 'HIRED'
                    }
                }
            },
            select: {
                id: true
            },
            take: 500
        });
        for (const c of due){
            await this.prisma.candidate.update({
                where: {
                    id: c.id
                },
                data: {
                    fullName: 'Anonymised candidate',
                    email: `anon-${c.id}@invalid.local`,
                    phone: '0000000000',
                    location: null,
                    currentCompany: null,
                    resumeFileId: null,
                    notes: null,
                    tags: [],
                    anonymisedAt: new Date()
                }
            });
            await this.audit.record({
                action: 'candidate.anonymised',
                entity: 'Candidate',
                entityId: c.id,
                meta: {
                    reason: 'RETENTION_EXPIRED'
                }
            });
        }
        return due.length;
    }
    async lookupOptions() {
        const ctx = (0, _requestcontext.requireContext)();
        if (!(0, _decorators.hasPerm)(ctx, 'candidates.view') && !(0, _decorators.hasPerm)(ctx, 'candidates.manage') && !(0, _decorators.hasPerm)(ctx, 'jobs.manage')) return [];
        const scope = await this.jobScope();
        const apps = await this.prisma.jobApplication.findMany({
            where: {
                stage: {
                    in: [
                        'SCREENING',
                        'INTERVIEW',
                        'OFFERED'
                    ]
                },
                candidate: {
                    anonymisedAt: null
                },
                ...scope ? {
                    job: scope
                } : {}
            },
            include: {
                candidate: {
                    select: {
                        fullName: true
                    }
                },
                job: {
                    select: {
                        title: true
                    }
                }
            },
            orderBy: {
                stageChangedAt: 'desc'
            },
            take: 300
        });
        return apps.map((a)=>({
                value: a.id,
                label: `${a.candidate.fullName} · ${a.job.title}`
            }));
    }
};
CandidatesService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _employeesservice.EmployeesService === "undefined" ? Object : _employeesservice.EmployeesService,
        typeof _mailservice.MailService === "undefined" ? Object : _mailservice.MailService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], CandidatesService);

//# sourceMappingURL=candidates.service.js.map