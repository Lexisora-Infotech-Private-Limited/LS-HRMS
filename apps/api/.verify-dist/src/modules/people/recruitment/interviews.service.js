"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "InterviewsService", {
    enumerable: true,
    get: function() {
        return InterviewsService;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _shared = require("@lexisora/shared");
const _env = require("../../../config/env");
const _auditservice = require("../../../core/audit/audit.service");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _mailservice = require("../../../core/mail/mail.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _peoplerules = require("../people.rules");
const _peopleutil = require("../people.util");
const _candidatesservice = require("./candidates.service");
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
const RESULT_LABEL = {
    PENDING: 'Pending',
    SELECTED: 'Selected',
    REJECTED: 'Rejected',
    ON_HOLD: 'On hold',
    CANCELLED: 'Cancelled',
    NO_SHOW: 'No-show'
};
const DEFAULT_CRITERIA = [
    {
        key: 'problem_solving',
        label: 'Problem solving'
    },
    {
        key: 'technical_depth',
        label: 'Technical depth'
    },
    {
        key: 'communication',
        label: 'Communication'
    },
    {
        key: 'culture_fit',
        label: 'Culture fit'
    }
];
let InterviewsService = class InterviewsService {
    prisma;
    candidates;
    mail;
    notify;
    audit;
    log = new _common.Logger('Interviews');
    constructor(prisma, candidates, mail, notify, audit){
        this.prisma = prisma;
        this.candidates = candidates;
        this.mail = mail;
        this.notify = notify;
        this.audit = audit;
    }
    isRecruiter() {
        const ctx = (0, _requestcontext.requireContext)();
        return (0, _decorators.hasPerm)(ctx, 'candidates.manage') || (0, _decorators.hasPerm)(ctx, 'jobs.manage');
    }
    include = {
        panelists: true,
        scorecards: true,
        application: {
            select: {
                id: true,
                candidateId: true,
                candidate: {
                    select: {
                        fullName: true,
                        email: true,
                        resumeFileId: true
                    }
                },
                job: {
                    select: {
                        title: true
                    }
                }
            }
        }
    };
    async names(ids) {
        return new Map((await this.prisma.employee.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(ids)
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
    }
    row(i, names, me) {
        const lead = i.panelists.find((p)=>p.role === 'LEAD') ?? i.panelists[0];
        const mine = me ? i.scorecards.find((s)=>s.interviewerEmployeeId === me) : undefined;
        const result = i.status === 'CANCELLED' ? 'CANCELLED' : i.status === 'NO_SHOW' ? 'NO_SHOW' : i.result;
        return {
            id: i.id,
            candidate: i.application.candidate.fullName,
            candidateId: i.application.candidateId,
            applicationId: i.applicationId,
            jobTitle: i.application.job.title,
            round: i.roundName,
            interviewer: [
                lead ? names.get(lead.employeeId) : null,
                ...i.panelists.filter((p)=>p !== lead).map((p)=>names.get(p.employeeId))
            ].filter(Boolean).join(', ') || '—',
            interviewerIds: i.panelists.map((p)=>p.employeeId),
            startsAt: i.startsAt.toISOString(),
            when: (0, _peopleutil.fmtWhen)(i.startsAt),
            mode: i.mode,
            modeLabel: _shared.INTERVIEW_MODE_LABELS[i.mode],
            status: i.status,
            result,
            resultLabel: RESULT_LABEL[result] ?? result,
            isPanelist: !!me && i.panelists.some((p)=>p.employeeId === me),
            scorecardStatus: mine?.status ?? (me && i.panelists.some((p)=>p.employeeId === me) ? 'NOT_STARTED' : null)
        };
    }
    async list(tab = 'all', mine) {
        const ctx = (0, _requestcontext.requireContext)();
        const me = ctx.employeeId;
        const recruiter = this.isRecruiter();
        let where = {};
        if (!recruiter || mine) {
            if (!me) return {
                items: [],
                canManage: false,
                counts: {
                    upcoming: 0,
                    past: 0,
                    all: 0
                }
            };
            where.panelists = {
                some: {
                    employeeId: me
                }
            };
        } else {
            // Leads: interviews they sit on plus their department's jobs (spec M6).
            const scope = await this.candidates.jobScope();
            if (scope) where = {
                OR: [
                    {
                        panelists: {
                            some: {
                                employeeId: me ?? '__none__'
                            }
                        }
                    },
                    {
                        application: {
                            job: scope
                        }
                    }
                ]
            };
        }
        const now = new Date();
        const tabWhere = tab === 'upcoming' ? {
            startsAt: {
                gte: new Date(now.getTime() - 2 * 3600_000)
            },
            status: 'SCHEDULED'
        } : tab === 'past' ? {
            OR: [
                {
                    startsAt: {
                        lt: now
                    }
                },
                {
                    status: {
                        not: 'SCHEDULED'
                    }
                }
            ]
        } : {};
        const [rows, upcoming, all] = await Promise.all([
            this.prisma.interview.findMany({
                where: {
                    AND: [
                        where,
                        tabWhere
                    ]
                },
                include: this.include,
                orderBy: {
                    startsAt: tab === 'past' ? 'desc' : 'asc'
                },
                take: 300
            }),
            this.prisma.interview.count({
                where: {
                    AND: [
                        where,
                        {
                            startsAt: {
                                gte: new Date(now.getTime() - 2 * 3600_000)
                            },
                            status: 'SCHEDULED'
                        }
                    ]
                }
            }),
            this.prisma.interview.count({
                where
            })
        ]);
        const names = await this.names(rows.flatMap((r)=>r.panelists.map((p)=>p.employeeId)));
        return {
            items: rows.map((r)=>this.row(r, names, me)),
            canManage: recruiter,
            counts: {
                upcoming,
                past: all - upcoming,
                all
            }
        };
    }
    async load(id) {
        const i = await this.prisma.interview.findUnique({
            where: {
                id
            },
            include: this.include
        });
        if (!i) throw (0, _errors.notFound)('Interview');
        return i;
    }
    async assertCanSee(i) {
        const me = (0, _requestcontext.requireContext)().employeeId;
        if (me && i.panelists.some((p)=>p.employeeId === me)) return;
        if (!this.isRecruiter()) throw (0, _errors.notFound)('Interview');
        const scope = await this.candidates.jobScope();
        if (scope && !await this.prisma.interview.findFirst({
            where: {
                id: i.id,
                application: {
                    job: scope
                }
            },
            select: {
                id: true
            }
        })) throw (0, _errors.notFound)('Interview');
    }
    async criteriaFor(roundName) {
        const r = await this.prisma.interviewRound.findFirst({
            where: {
                name: roundName
            }
        });
        const c = r?.criteria ?? [];
        return c.length ? c : DEFAULT_CRITERIA;
    }
    async detail(id) {
        const i = await this.load(id);
        await this.assertCanSee(i);
        const me = (0, _requestcontext.requireContext)().employeeId;
        const names = await this.names([
            ...i.panelists.map((p)=>p.employeeId),
            ...i.scorecards.map((s)=>s.interviewerEmployeeId)
        ]);
        const criteria = await this.criteriaFor(i.roundName);
        const my = me ? i.scorecards.find((s)=>s.interviewerEmployeeId === me) : undefined;
        const recruiter = this.isRecruiter();
        return {
            ...this.row(i, names, me),
            durationMin: i.durationMin,
            notesToCandidate: i.notesToCandidate,
            candidateEmail: i.application.candidate.email,
            resumeFileId: i.application.candidate.resumeFileId,
            panelists: i.panelists.map((p)=>{
                const sc = i.scorecards.find((s)=>s.interviewerEmployeeId === p.employeeId);
                // Panelists see others' scorecards only after submitting their own (avoid anchoring).
                const visible = recruiter || my?.status === 'SUBMITTED' || p.employeeId === me;
                return {
                    employeeId: p.employeeId,
                    name: names.get(p.employeeId) ?? '—',
                    role: p.role,
                    scorecard: sc && visible ? {
                        overall: sc.overall,
                        recommendation: sc.recommendation,
                        status: sc.status
                    } : sc ? {
                        overall: null,
                        recommendation: null,
                        status: sc.status
                    } : null
                };
            }),
            myScorecard: my ? {
                ratings: my.ratings ?? [],
                overall: my.overall,
                recommendation: my.recommendation,
                notes: my.notes,
                status: my.status
            } : null,
            criteria,
            canManage: recruiter,
            suggestedResult: (0, _peoplerules.suggestResult)(i.scorecards.filter((s)=>s.status === 'SUBMITTED').map((s)=>s.recommendation)),
            icsSequence: i.icsSequence
        };
    }
    // ── Scheduling & ICS ─────────────────────────────────────────────────────
    async sendInvites(i, method) {
        const ctx = (0, _requestcontext.requireContext)();
        const t = await this.prisma.raw.tenant.findUnique({
            where: {
                id: ctx.tenantId
            }
        });
        const company = t?.name ?? 'Lexisora';
        const panel = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: i.panelists.map((p)=>p.employeeId)
                }
            },
            select: {
                fullName: true,
                officialEmail: true
            }
        });
        const organizerEmail = ctx.userId && (await this.prisma.user.findUnique({
            where: {
                id: ctx.userId
            },
            select: {
                email: true
            }
        }))?.email || _env.env.MAIL_FROM.replace(/^.*<|>$/g, '');
        const summary = `${i.roundName} interview · ${i.application.candidate.fullName} · ${i.application.job.title}`;
        const location = i.mode === 'VIDEO' ? i.location ?? `${_env.env.WEB_ORIGIN}/calls/interview-${i.id}` : i.mode === 'IN_OFFICE' ? i.location ?? `${company} office` : 'Phone call';
        const ics = (0, _peoplerules.buildIcs)({
            uid: i.icsUid,
            sequence: i.icsSequence,
            method,
            start: i.startsAt,
            durationMin: i.durationMin,
            summary,
            description: [
                i.notesToCandidate,
                `Mode: ${_shared.INTERVIEW_MODE_LABELS[i.mode]}`
            ].filter(Boolean).join('\n'),
            location,
            organizer: {
                name: `${company} Recruitment`,
                email: organizerEmail
            },
            attendees: [
                {
                    name: i.application.candidate.fullName,
                    email: i.application.candidate.email
                },
                ...panel.map((p)=>({
                        name: p.fullName,
                        email: p.officialEmail
                    }))
            ]
        });
        const when = `${(0, _peopleutil.fmtWhen)(i.startsAt)} IST · ${i.durationMin} min · ${_shared.INTERVIEW_MODE_LABELS[i.mode]}`;
        const cancel = method === 'CANCEL';
        const candidateOk = await this.mail.send({
            to: i.application.candidate.email,
            subject: `${cancel ? 'Cancelled: ' : ''}${i.roundName} interview with ${company} · ${(0, _peopleutil.fmtWhen)(i.startsAt)}`,
            text: `Hi ${i.application.candidate.fullName},\n\n${cancel ? 'Your interview has been cancelled. We will be in touch to reschedule.' : `Your ${i.roundName} interview for ${i.application.job.title} is scheduled for ${when}.\nWhere: ${location}`}${i.notesToCandidate && !cancel ? `\n\n${i.notesToCandidate}` : ''}\n\n— ${company} Recruitment`,
            icalEvent: {
                filename: 'interview.ics',
                method,
                content: ics
            }
        });
        const panelOk = panel.length ? await this.mail.send({
            to: panel.map((p)=>p.officialEmail),
            subject: `${cancel ? 'Cancelled: ' : ''}${summary}`,
            text: `${cancel ? 'This interview has been cancelled.' : `You are on the panel for ${i.application.candidate.fullName} (${i.application.job.title}), ${i.roundName}.\nWhen: ${when}\nWhere: ${location}\n\nOpen the scorecard: ${_env.env.WEB_ORIGIN}/interviews?interview=${i.id}`}`,
            icalEvent: {
                filename: 'interview.ics',
                method,
                content: ics
            }
        }) : true;
        if (candidateOk || panelOk) await this.prisma.interview.update({
            where: {
                id: i.id
            },
            data: {
                emailedAt: new Date()
            }
        });
        return candidateOk && panelOk;
    }
    async schedule(input) {
        if (!this.isRecruiter()) throw (0, _errors.forbidden)('Only recruiters can schedule interviews');
        const app = await this.prisma.jobApplication.findUnique({
            where: {
                id: input.applicationId
            },
            include: {
                candidate: true,
                job: true
            }
        });
        if (!app) throw (0, _errors.badRequest)('Pick the candidate', 'APPLICATION_INVALID');
        if (![
            'SCREENING',
            'INTERVIEW'
        ].includes(app.stage)) throw new _errors.AppError(409, 'INVALID_STAGE', `${app.candidate.fullName} is at ${app.stage.toLowerCase()} stage`);
        const startsAt = (0, _peoplerules.istDateTime)(input.date, input.time);
        if (input.date < (0, _peopleutil.todayKey)()) throw (0, _errors.badRequest)('Pick a date from today onwards');
        const panelIds = [
            ...new Set([
                input.interviewerId,
                ...input.panelistIds
            ])
        ];
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: panelIds
                },
                status: {
                    not: 'EXITED'
                }
            },
            select: {
                id: true
            }
        });
        if (emps.length !== panelIds.length) throw (0, _errors.badRequest)('Pick active interviewers', 'INTERVIEWER_INVALID');
        // Double-booking guard for the lead interviewer.
        const end = new Date(startsAt.getTime() + input.durationMin * 60_000);
        const clash = await this.prisma.interview.findFirst({
            where: {
                status: 'SCHEDULED',
                panelists: {
                    some: {
                        employeeId: input.interviewerId
                    }
                },
                startsAt: {
                    lt: end,
                    gte: new Date(startsAt.getTime() - 8 * 3600_000)
                }
            }
        });
        if (clash && new Date(clash.startsAt.getTime() + clash.durationMin * 60_000) > startsAt) throw new _errors.AppError(409, 'INTERVIEWER_BUSY', `The interviewer already has an interview at ${(0, _peopleutil.fmtWhen)(clash.startsAt)}`);
        const seq = await this.prisma.interview.count({
            where: {
                applicationId: app.id
            }
        }) + 1;
        const tenantId = (0, _requestcontext.requireContext)().tenantId;
        const created = await this.prisma.interview.create({
            data: {
                applicationId: app.id,
                roundName: input.roundName,
                sequence: seq,
                startsAt,
                durationMin: input.durationMin,
                mode: input.mode,
                notesToCandidate: input.notesToCandidate ?? null,
                icsUid: `${(0, _nodecrypto.randomUUID)()}@lexisora-hrms`,
                panelists: {
                    create: panelIds.map((employeeId)=>({
                            tenantId,
                            employeeId,
                            role: employeeId === input.interviewerId ? 'LEAD' : 'PANELIST'
                        }))
                }
            }
        });
        if (app.stage === 'SCREENING') {
            await this.prisma.jobApplication.update({
                where: {
                    id: app.id
                },
                data: {
                    stage: 'INTERVIEW',
                    stageChangedAt: new Date()
                }
            });
            await this.prisma.jobApplicationEvent.create({
                data: {
                    applicationId: app.id,
                    from: 'SCREENING',
                    to: 'INTERVIEW',
                    byName: (0, _requestcontext.requireContext)().userName ?? null,
                    reason: `${input.roundName} scheduled`
                }
            });
        }
        const full = await this.load(created.id);
        const emailed = await this.sendInvites(full, 'REQUEST');
        await this.notify.notify({
            userIds: await this.notify.usersForEmployees(panelIds),
            type: 'people.interviewScheduled',
            title: `Interview: ${app.candidate.fullName} · ${input.roundName}`,
            body: `${(0, _peopleutil.fmtWhen)(startsAt)} · ${_shared.INTERVIEW_MODE_LABELS[input.mode]} · ${app.job.title}`,
            link: `/interviews?interview=${created.id}`,
            from: 'Recruitment'
        });
        await this.audit.record({
            action: 'interview.scheduled',
            entity: 'Interview',
            entityId: created.id,
            meta: {
                applicationId: app.id,
                round: input.roundName,
                startsAt: startsAt.toISOString(),
                emailed
            }
        });
        return {
            id: created.id,
            emailed
        };
    }
    async reschedule(id, date, time, durationMin) {
        if (!this.isRecruiter()) throw (0, _errors.forbidden)();
        const i = await this.load(id);
        if (i.status !== 'SCHEDULED') throw new _errors.AppError(409, 'INVALID_STATUS', 'Only scheduled interviews can be moved');
        if (date < (0, _peopleutil.todayKey)()) throw (0, _errors.badRequest)('Pick a date from today onwards');
        await this.prisma.interview.update({
            where: {
                id
            },
            data: {
                startsAt: (0, _peoplerules.istDateTime)(date, time),
                durationMin: durationMin ?? i.durationMin,
                icsSequence: i.icsSequence + 1
            }
        });
        const emailed = await this.sendInvites(await this.load(id), 'REQUEST');
        await this.audit.record({
            action: 'interview.rescheduled',
            entity: 'Interview',
            entityId: id,
            meta: {
                date,
                time
            }
        });
        return {
            ok: true,
            emailed
        };
    }
    async cancel(id, reason) {
        if (!this.isRecruiter()) throw (0, _errors.forbidden)();
        const i = await this.load(id);
        if (i.status !== 'SCHEDULED') throw new _errors.AppError(409, 'INVALID_STATUS', 'Only scheduled interviews can be cancelled');
        await this.prisma.interview.update({
            where: {
                id
            },
            data: {
                status: 'CANCELLED',
                icsSequence: i.icsSequence + 1
            }
        });
        await this.sendInvites(await this.load(id), 'CANCEL');
        await this.audit.record({
            action: 'interview.cancelled',
            entity: 'Interview',
            entityId: id,
            meta: {
                reason: reason ?? null
            }
        });
        return {
            ok: true
        };
    }
    /** Candidate did not turn up: closes the slot without a result (scorecards not owed). */ async noShow(id) {
        if (!this.isRecruiter()) throw (0, _errors.forbidden)();
        const i = await this.load(id);
        if (i.status !== 'SCHEDULED') throw new _errors.AppError(409, 'INVALID_STATUS', 'Only scheduled interviews can be marked as no-show');
        if (i.startsAt.getTime() > Date.now()) throw new _errors.AppError(409, 'NOT_YET', 'The interview has not started yet');
        await this.prisma.interview.update({
            where: {
                id
            },
            data: {
                status: 'NO_SHOW'
            }
        });
        await this.audit.record({
            action: 'interview.no_show',
            entity: 'Interview',
            entityId: id,
            meta: {
                candidate: i.application.candidate.fullName
            }
        });
        return this.detail(id);
    }
    // ── Scorecards & result ──────────────────────────────────────────────────
    async saveScorecard(id, input) {
        const me = (0, _requestcontext.requireContext)().employeeId;
        const i = await this.load(id);
        if (!me || !i.panelists.some((p)=>p.employeeId === me)) throw (0, _errors.forbidden)('Only panelists can score this interview');
        if (i.status === 'CANCELLED') throw new _errors.AppError(409, 'CANCELLED', 'This interview was cancelled');
        const existing = i.scorecards.find((s)=>s.interviewerEmployeeId === me);
        if (existing?.status === 'SUBMITTED') throw new _errors.AppError(409, 'ALREADY_SUBMITTED', 'You have already submitted your scorecard');
        if (input.submit) {
            if (input.ratings.some((r)=>r.rating == null)) throw (0, _errors.badRequest)('Rate every criterion before submitting', 'RATINGS_INCOMPLETE');
            if (!input.recommendation) throw (0, _errors.badRequest)('Pick a recommendation', 'RECOMMENDATION_REQUIRED');
            if (i.startsAt.getTime() > Date.now() + 15 * 60_000) throw new _errors.AppError(409, 'NOT_YET', 'You can submit the scorecard once the interview has started');
        }
        const overall = input.overall ?? (0, _peoplerules.overallFromRatings)(input.ratings.map((r)=>r.rating));
        const data = {
            ratings: input.ratings,
            overall,
            recommendation: input.recommendation ?? null,
            notes: input.notes ?? null,
            status: input.submit ? 'SUBMITTED' : 'DRAFT',
            submittedAt: input.submit ? new Date() : null
        };
        await this.prisma.interviewScorecard.upsert({
            where: {
                interviewId_interviewerEmployeeId: {
                    interviewId: id,
                    interviewerEmployeeId: me
                }
            },
            create: {
                interviewId: id,
                interviewerEmployeeId: me,
                ...data
            },
            update: data
        });
        if (input.submit) {
            await this.candidates.recomputeScore(i.applicationId);
            const all = await this.prisma.interviewScorecard.count({
                where: {
                    interviewId: id,
                    status: 'SUBMITTED'
                }
            });
            if (all >= i.panelists.length) {
                await this.notify.notify({
                    userIds: await this.notify.usersWithPermission('candidates.manage'),
                    type: 'people.scorecardsIn',
                    title: `All scorecards in: ${i.application.candidate.fullName} · ${i.roundName}`,
                    link: `/interviews?interview=${id}`,
                    from: 'Recruitment'
                });
            }
            await this.audit.record({
                action: 'interview.scorecard_submitted',
                entity: 'Interview',
                entityId: id,
                meta: {
                    overall,
                    recommendation: input.recommendation
                }
            });
        }
        return this.detail(id);
    }
    async setResult(id, result) {
        const me = (0, _requestcontext.requireContext)().employeeId;
        const i = await this.load(id);
        const isLead = !!me && i.panelists.some((p)=>p.employeeId === me && p.role === 'LEAD');
        if (!this.isRecruiter() && !isLead) throw (0, _errors.forbidden)('Only recruiters or the lead interviewer can record the result');
        if (i.status === 'CANCELLED') throw new _errors.AppError(409, 'CANCELLED', 'This interview was cancelled');
        await this.prisma.interview.update({
            where: {
                id
            },
            data: {
                result,
                status: result === 'PENDING' ? i.status : 'COMPLETED'
            }
        });
        await this.candidates.recomputeScore(i.applicationId);
        await this.audit.record({
            action: 'interview.result',
            entity: 'Interview',
            entityId: id,
            meta: {
                result
            }
        });
        return this.detail(id);
    }
    async rounds() {
        const rows = await this.prisma.interviewRound.findMany({
            where: {
                isActive: true
            },
            orderBy: [
                {
                    order: 'asc'
                },
                {
                    name: 'asc'
                }
            ]
        });
        return rows.map((r)=>({
                value: r.name,
                label: r.name
            }));
    }
    /** Dashboard "Awaiting your approval": scorecards I still owe for interviews that already happened. */ async pendingScorecards(employeeId) {
        return this.prisma.interview.count({
            where: {
                status: {
                    in: [
                        'SCHEDULED',
                        'COMPLETED'
                    ]
                },
                startsAt: {
                    lt: new Date()
                },
                panelists: {
                    some: {
                        employeeId
                    }
                },
                NOT: {
                    scorecards: {
                        some: {
                            interviewerEmployeeId: employeeId,
                            status: 'SUBMITTED'
                        }
                    }
                }
            }
        });
    }
};
InterviewsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _candidatesservice.CandidatesService === "undefined" ? Object : _candidatesservice.CandidatesService,
        typeof _mailservice.MailService === "undefined" ? Object : _mailservice.MailService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], InterviewsService);

//# sourceMappingURL=interviews.service.js.map