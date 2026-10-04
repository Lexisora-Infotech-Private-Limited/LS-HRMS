"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PeopleJobs", {
    enumerable: true,
    get: function() {
        return PeopleJobs;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _decorators = require("../../core/auth/decorators");
const _requestcontext = require("../../core/context/request-context");
const _jobsservice = require("../../core/jobs/jobs.service");
const _lookups = require("../../core/lookups/lookups");
const _prismaservice = require("../../core/prisma/prisma.service");
const _eventsservice = require("../../core/registry/events.service");
const _registries = require("../../core/registry/registries");
const _filescontroller = require("../../core/storage/files.controller");
const _appraisalsservice = require("./appraisals/appraisals.service");
const _assetsservice = require("./assets/assets.service");
const _employeesservice = require("./employees/employees.service");
const _profileservice = require("./employees/profile.service");
const _idcardsservice = require("./idcards/idcards.service");
const _onboardingservice = require("./onboarding/onboarding.service");
const _candidatesservice = require("./recruitment/candidates.service");
const _interviewsservice = require("./recruitment/interviews.service");
const _peopleaccess = require("./people.access");
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
let PeopleJobs = class PeopleJobs {
    prisma;
    lookups;
    search;
    approvals;
    events;
    jobs;
    access;
    employees;
    profile;
    onboarding;
    idcards;
    assets;
    candidates;
    interviews;
    appraisals;
    log = new _common.Logger('PeopleJobs');
    constructor(prisma, lookups, search, approvals, events, jobs, access, employees, profile, onboarding, idcards, assets, candidates, interviews, appraisals){
        this.prisma = prisma;
        this.lookups = lookups;
        this.search = search;
        this.approvals = approvals;
        this.events = events;
        this.jobs = jobs;
        this.access = access;
        this.employees = employees;
        this.profile = profile;
        this.onboarding = onboarding;
        this.idcards = idcards;
        this.assets = assets;
        this.candidates = candidates;
        this.interviews = interviews;
        this.appraisals = appraisals;
    }
    onModuleInit() {
        // ── Lookups ──
        this.lookups.register('jobs', async ()=>(await this.prisma.job.findMany({
                where: {
                    status: {
                        in: [
                            'OPEN',
                            'ON_HOLD'
                        ]
                    }
                },
                orderBy: {
                    title: 'asc'
                }
            })).map((j)=>({
                    value: j.id,
                    label: j.title
                })));
        this.lookups.register('candidates', ()=>this.candidates.lookupOptions());
        this.lookups.register('interviewRounds', ()=>this.interviews.rounds());
        this.lookups.register('kraTemplates', ()=>this.appraisals.templateOptions());
        this.lookups.register('assetCategories', async ()=>(await this.prisma.assetCategory.findMany({
                orderBy: {
                    name: 'asc'
                }
            })).map((c)=>({
                    value: c.id,
                    label: c.name
                })));
        this.lookups.register('kitItems', async ()=>(await this.prisma.welcomeKitItem.findMany({
                where: {
                    isActive: true
                },
                orderBy: {
                    order: 'asc'
                }
            })).map((c)=>({
                    value: c.id,
                    label: c.name
                })));
        this.lookups.register('newJoiners', async ()=>{
            const rows = await this.prisma.welcomeKitIssue.findMany({
                where: {
                    status: {
                        in: [
                            'PENDING',
                            'PARTIAL'
                        ]
                    }
                },
                select: {
                    employeeId: true
                }
            });
            const emps = await this.prisma.employee.findMany({
                where: {
                    id: {
                        in: rows.map((r)=>r.employeeId)
                    },
                    status: {
                        not: 'EXITED'
                    }
                },
                orderBy: {
                    fullName: 'asc'
                },
                select: {
                    id: true,
                    fullName: true
                }
            });
            return emps.map((e)=>({
                    value: e.id,
                    label: e.fullName
                }));
        });
        // ── Header search ──
        this.search.register('people', (q, ctx)=>this.profile.search(q, ctx));
        this.search.register('candidates', async (q, ctx)=>{
            if (!(0, _decorators.hasPerm)(ctx, 'candidates.view')) return [];
            const rows = await this.prisma.candidate.findMany({
                where: {
                    anonymisedAt: null,
                    OR: [
                        {
                            fullName: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        },
                        {
                            email: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        }
                    ]
                },
                take: 5
            });
            return rows.map((c)=>({
                    type: 'candidates',
                    id: c.id,
                    title: c.fullName,
                    subtitle: 'Candidate',
                    link: `/candidates?candidate=${c.id}`
                }));
        });
        // ── Awaiting your approval ──
        this.approvals.register(async (ctx)=>{
            if (!(0, _decorators.hasPerm)(ctx, 'onboarding.manage')) return null;
            const count = await this.prisma.employeeDocument.count({
                where: {
                    verificationStatus: 'PENDING',
                    deletedAt: null,
                    isCurrent: true
                }
            });
            return count ? {
                key: 'documents',
                label: 'Documents to verify',
                count,
                link: '/onboarding?tab=verification'
            } : null;
        });
        this.approvals.register(async (ctx)=>{
            if (!ctx.employeeId) return null;
            const count = await this.interviews.pendingScorecards(ctx.employeeId);
            return count ? {
                key: 'scorecards',
                label: 'Interview scorecards',
                count,
                link: '/interviews'
            } : null;
        });
        this.approvals.register(async (ctx)=>{
            if (!ctx.employeeId) return null;
            const count = await this.appraisals.pendingForReviewer(ctx.employeeId);
            return count ? {
                key: 'appraisals',
                label: 'Appraisal reviews',
                count,
                link: '/appraisals?tab=mine'
            } : null;
        });
        // ── Private file access (documents, resumes, photos) ──
        _filescontroller.fileAccessCheckers.push(async (fileId)=>{
            const ctx = (0, _requestcontext.getContext)();
            if (!ctx) return false;
            // Photos are visible to colleagues (directory, ID cards).
            if (await this.prisma.employee.findFirst({
                where: {
                    photoFileId: fileId
                },
                select: {
                    id: true
                }
            })) return true;
            const doc = await this.prisma.employeeDocument.findFirst({
                where: {
                    fileId,
                    deletedAt: null
                },
                select: {
                    employeeId: true
                }
            });
            if (doc && (doc.employeeId === ctx.employeeId || (0, _peopleaccess.isHr)(ctx) || (0, _decorators.hasPerm)(ctx, 'onboarding.manage'))) return true;
            const cand = await this.prisma.candidate.findFirst({
                where: {
                    resumeFileId: fileId
                },
                select: {
                    id: true
                }
            });
            if (cand) {
                if ((0, _decorators.hasPerm)(ctx, 'candidates.view') || (0, _decorators.hasPerm)(ctx, 'candidates.manage')) return true;
                if (ctx.employeeId && await this.prisma.interview.findFirst({
                    where: {
                        application: {
                            candidateId: cand.id
                        },
                        panelists: {
                            some: {
                                employeeId: ctx.employeeId
                            }
                        }
                    },
                    select: {
                        id: true
                    }
                })) return true;
            }
            if ((0, _decorators.hasPerm)(ctx, 'idcard.manage') && await this.prisma.idCardTemplate.findFirst({
                where: {
                    OR: [
                        {
                            frontBgFileId: fileId
                        },
                        {
                            backBgFileId: fileId
                        }
                    ]
                },
                select: {
                    id: true
                }
            })) return true;
            return false;
        });
        // ── Events ──
        this.events.on('onboarding.completed', async (p)=>{
            const employeeId = String(p.employeeId);
            await this.idcards.ensureCard(employeeId);
            await this.idcards.refresh(employeeId);
        });
        this.jobs.register('people.idcards.generate', async (d)=>this.idcards.generate({
                cardIds: d.cardIds
            }));
        void this.access;
    }
    async forEachTenant(name, fn) {
        const tenants = await this.prisma.raw.tenant.findMany({
            select: {
                id: true
            }
        }).catch(()=>[]);
        for (const t of tenants){
            try {
                await (0, _requestcontext.runAsTenant)(t.id, fn);
            } catch (e) {
                this.log.error(`${name} failed for tenant ${t.id}: ${e.message}`);
            }
        }
    }
    /** 00:05 IST: joiners become ACTIVE on their joining date. */ async lifecycle() {
        await this.forEachTenant('people-lifecycle', ()=>this.employees.dailyLifecycle());
    }
    /** 09:00 IST: onboarding reminders (7/3/1 days before joining). */ async onboardingReminders() {
        await this.forEachTenant('onboarding-reminders', ()=>this.onboarding.remind());
    }
    /** 08:30 IST: asset warranty expiry alerts (30 / 7 / 0 days). */ async warranty() {
        await this.forEachTenant('asset-warranty', ()=>this.assets.warrantyScan());
    }
    /** 02:15 IST: anonymise candidates past their DPDP retention date (M6 acceptance 6). */ async candidateRetention() {
        await this.forEachTenant('candidate-retention', ()=>this.candidates.retentionSweep());
    }
};
_ts_decorate([
    (0, _schedule.Cron)('5 0 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], PeopleJobs.prototype, "lifecycle", null);
_ts_decorate([
    (0, _schedule.Cron)('0 9 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], PeopleJobs.prototype, "onboardingReminders", null);
_ts_decorate([
    (0, _schedule.Cron)('30 8 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], PeopleJobs.prototype, "warranty", null);
_ts_decorate([
    (0, _schedule.Cron)('15 2 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], PeopleJobs.prototype, "candidateRetention", null);
PeopleJobs = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _lookups.LookupsService === "undefined" ? Object : _lookups.LookupsService,
        typeof _registries.SearchService === "undefined" ? Object : _registries.SearchService,
        typeof _registries.ApprovalCountsService === "undefined" ? Object : _registries.ApprovalCountsService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _jobsservice.JobsService === "undefined" ? Object : _jobsservice.JobsService,
        typeof _peopleaccess.PeopleAccess === "undefined" ? Object : _peopleaccess.PeopleAccess,
        typeof _employeesservice.EmployeesService === "undefined" ? Object : _employeesservice.EmployeesService,
        typeof _profileservice.ProfileService === "undefined" ? Object : _profileservice.ProfileService,
        typeof _onboardingservice.OnboardingService === "undefined" ? Object : _onboardingservice.OnboardingService,
        typeof _idcardsservice.IdCardsService === "undefined" ? Object : _idcardsservice.IdCardsService,
        typeof _assetsservice.AssetsService === "undefined" ? Object : _assetsservice.AssetsService,
        typeof _candidatesservice.CandidatesService === "undefined" ? Object : _candidatesservice.CandidatesService,
        typeof _interviewsservice.InterviewsService === "undefined" ? Object : _interviewsservice.InterviewsService,
        typeof _appraisalsservice.AppraisalsService === "undefined" ? Object : _appraisalsservice.AppraisalsService
    ])
], PeopleJobs);

//# sourceMappingURL=people.jobs.js.map