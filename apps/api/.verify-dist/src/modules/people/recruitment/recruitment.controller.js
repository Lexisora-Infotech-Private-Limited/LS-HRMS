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
    get CandidatesController () {
        return CandidatesController;
    },
    get InterviewsController () {
        return InterviewsController;
    },
    get JobsController () {
        return JobsController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _mastersservice = require("../masters/masters.service");
const _candidatesservice = require("./candidates.service");
const _interviewsservice = require("./interviews.service");
const _jobsservice = require("./jobs.service");
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
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
let JobsController = class JobsController {
    jobs;
    masters;
    constructor(jobs, masters){
        this.jobs = jobs;
        this.masters = masters;
    }
    list(tab) {
        return this.jobs.list(tab === 'closed' ? 'closed' : 'open');
    }
    rounds() {
        return this.masters.rounds();
    }
    createRound(dto) {
        return this.masters.createRound(dto);
    }
    deactivateRound(id) {
        return this.masters.deactivateRound(id);
    }
    detail(id) {
        return this.jobs.detail(id);
    }
    create(dto) {
        return this.jobs.create(dto);
    }
    update(id, dto) {
        return this.jobs.update(id, dto);
    }
    status(id, dto) {
        return this.jobs.setStatus(id, dto.status, dto.reason);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('jobs.manage', 'candidates.view'),
    _ts_param(0, (0, _common.Query)('tab')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], JobsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('rounds'),
    (0, _decorators.RequirePerm)('jobs.manage', 'candidates.view', 'candidates.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], JobsController.prototype, "rounds", null);
_ts_decorate([
    (0, _common.Post)('rounds'),
    (0, _decorators.RequirePerm)('jobs.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.interviewRoundSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], JobsController.prototype, "createRound", null);
_ts_decorate([
    (0, _common.Post)('rounds/:id/deactivate'),
    (0, _decorators.RequirePerm)('jobs.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], JobsController.prototype, "deactivateRound", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    (0, _decorators.RequirePerm)('jobs.manage', 'candidates.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], JobsController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('jobs.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.jobSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof JobInput === "undefined" ? Object : JobInput
    ]),
    _ts_metadata("design:returntype", void 0)
], JobsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Put)(':id'),
    (0, _decorators.RequirePerm)('jobs.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.jobSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof JobInput === "undefined" ? Object : JobInput
    ]),
    _ts_metadata("design:returntype", void 0)
], JobsController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)(':id/status'),
    (0, _decorators.RequirePerm)('jobs.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.jobStatusSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], JobsController.prototype, "status", null);
JobsController = _ts_decorate([
    (0, _common.Controller)('jobs'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _jobsservice.JobsService === "undefined" ? Object : _jobsservice.JobsService,
        typeof _mastersservice.MastersService === "undefined" ? Object : _mastersservice.MastersService
    ])
], JobsController);
let CandidatesController = class CandidatesController {
    candidates;
    constructor(candidates){
        this.candidates = candidates;
    }
    list(q) {
        return this.candidates.list(q);
    }
    detail(id) {
        return this.candidates.detail(id);
    }
    create(dto) {
        return this.candidates.create(dto);
    }
    apply(id, dto) {
        return this.candidates.addApplication(id, dto.jobId);
    }
    anonymise(id) {
        return this.candidates.anonymise(id);
    }
    stage(appId, dto) {
        return this.candidates.moveStage(appId, dto.to, dto.reason);
    }
    offer(appId, dto) {
        return this.candidates.saveOffer(appId, dto);
    }
    hire(appId, dto) {
        return this.candidates.hire(appId, dto);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('candidates.view', 'candidates.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.candidateListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CandidateListQuery === "undefined" ? Object : CandidateListQuery
    ]),
    _ts_metadata("design:returntype", void 0)
], CandidatesController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    (0, _decorators.RequirePerm)('candidates.view', 'candidates.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], CandidatesController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('candidates.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.candidateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CandidateInput === "undefined" ? Object : CandidateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], CandidatesController.prototype, "create", null);
_ts_decorate([
    (0, _common.Post)(':id/applications'),
    (0, _decorators.RequirePerm)('candidates.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.addApplicationSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], CandidatesController.prototype, "apply", null);
_ts_decorate([
    (0, _common.Post)(':id/anonymise'),
    (0, _decorators.RequirePerm)('candidates.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], CandidatesController.prototype, "anonymise", null);
_ts_decorate([
    (0, _common.Post)('applications/:appId/stage'),
    (0, _decorators.RequirePerm)('candidates.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('appId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.stageChangeSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], CandidatesController.prototype, "stage", null);
_ts_decorate([
    (0, _common.Post)('applications/:appId/offer'),
    (0, _decorators.RequirePerm)('candidates.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('appId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.jobOfferSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof JobOfferInput === "undefined" ? Object : JobOfferInput
    ]),
    _ts_metadata("design:returntype", void 0)
], CandidatesController.prototype, "offer", null);
_ts_decorate([
    (0, _common.Post)('applications/:appId/hire'),
    (0, _decorators.RequirePerm)('employees.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('appId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.hireSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof HireInput === "undefined" ? Object : HireInput
    ]),
    _ts_metadata("design:returntype", void 0)
], CandidatesController.prototype, "hire", null);
CandidatesController = _ts_decorate([
    (0, _common.Controller)('candidates'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _candidatesservice.CandidatesService === "undefined" ? Object : _candidatesservice.CandidatesService
    ])
], CandidatesController);
let InterviewsController = class InterviewsController {
    interviews;
    constructor(interviews){
        this.interviews = interviews;
    }
    list(q) {
        return this.interviews.list(q.tab, q.mine);
    }
    rounds() {
        return this.interviews.rounds();
    }
    detail(id) {
        return this.interviews.detail(id);
    }
    schedule(dto) {
        return this.interviews.schedule(dto);
    }
    reschedule(id, dto) {
        return this.interviews.reschedule(id, dto.date, dto.time, dto.durationMin);
    }
    cancel(id, dto) {
        return this.interviews.cancel(id, dto.reason);
    }
    noShow(id) {
        return this.interviews.noShow(id);
    }
    scorecard(id, dto) {
        return this.interviews.saveScorecard(id, dto);
    }
    result(id, dto) {
        return this.interviews.setResult(id, dto.result);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.interviewListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InterviewsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('rounds'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], InterviewsController.prototype, "rounds", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], InterviewsController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('candidates.manage', 'jobs.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.scheduleInterviewSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof ScheduleInterviewInput === "undefined" ? Object : ScheduleInterviewInput
    ]),
    _ts_metadata("design:returntype", void 0)
], InterviewsController.prototype, "schedule", null);
_ts_decorate([
    (0, _common.Post)(':id/reschedule'),
    (0, _decorators.RequirePerm)('candidates.manage', 'jobs.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.rescheduleInterviewSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InterviewsController.prototype, "reschedule", null);
_ts_decorate([
    (0, _common.Post)(':id/cancel'),
    (0, _decorators.RequirePerm)('candidates.manage', 'jobs.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.cancelInterviewSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InterviewsController.prototype, "cancel", null);
_ts_decorate([
    (0, _common.Post)(':id/no-show'),
    (0, _decorators.RequirePerm)('candidates.manage', 'jobs.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], InterviewsController.prototype, "noShow", null);
_ts_decorate([
    (0, _common.Put)(':id/scorecard'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.scorecardSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof ScorecardInput === "undefined" ? Object : ScorecardInput
    ]),
    _ts_metadata("design:returntype", void 0)
], InterviewsController.prototype, "scorecard", null);
_ts_decorate([
    (0, _common.Post)(':id/result'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.interviewResultSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InterviewsController.prototype, "result", null);
InterviewsController = _ts_decorate([
    (0, _common.Controller)('interviews'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _interviewsservice.InterviewsService === "undefined" ? Object : _interviewsservice.InterviewsService
    ])
], InterviewsController);

//# sourceMappingURL=recruitment.controller.js.map