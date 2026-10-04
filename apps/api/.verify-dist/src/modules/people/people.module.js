"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PeopleModule", {
    enumerable: true,
    get: function() {
        return PeopleModule;
    }
});
const _common = require("@nestjs/common");
const _appraisalscontroller = require("./appraisals/appraisals.controller");
const _appraisalsservice = require("./appraisals/appraisals.service");
const _assetscontroller = require("./assets/assets.controller");
const _assetsservice = require("./assets/assets.service");
const _esignservice = require("./documents/esign.service");
const _vaultservice = require("./documents/vault.service");
const _employeescontroller = require("./employees/employees.controller");
const _employeesservice = require("./employees/employees.service");
const _profileservice = require("./employees/profile.service");
const _idcardscontroller = require("./idcards/idcards.controller");
const _idcardsservice = require("./idcards/idcards.service");
const _kitsservice = require("./kits/kits.service");
const _mastersservice = require("./masters/masters.service");
const _onboardingcontroller = require("./onboarding/onboarding.controller");
const _onboardingservice = require("./onboarding/onboarding.service");
const _peopleaccess = require("./people.access");
const _peoplejobs = require("./people.jobs");
const _candidatesservice = require("./recruitment/candidates.service");
const _interviewsservice = require("./recruitment/interviews.service");
const _jobsservice = require("./recruitment/jobs.service");
const _recruitmentcontroller = require("./recruitment/recruitment.controller");
const _vcardservice = require("./vcard/vcard.service");
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
let PeopleModule = class PeopleModule {
};
PeopleModule = _ts_decorate([
    (0, _common.Module)({
        imports: [],
        controllers: [
            _employeescontroller.EmployeesController,
            _employeescontroller.ProfileController,
            _employeescontroller.MastersController,
            _onboardingcontroller.OnboardingController,
            _onboardingcontroller.DocumentsController,
            _recruitmentcontroller.JobsController,
            _recruitmentcontroller.CandidatesController,
            _recruitmentcontroller.InterviewsController,
            _appraisalscontroller.AppraisalsController,
            _assetscontroller.AssetsController,
            _assetscontroller.WelcomeKitsController,
            _idcardscontroller.IdCardsController,
            _idcardscontroller.VcardController
        ],
        providers: [
            _peopleaccess.PeopleAccess,
            _employeesservice.EmployeesService,
            _profileservice.ProfileService,
            _mastersservice.MastersService,
            _vaultservice.VaultService,
            _esignservice.EsignService,
            _onboardingservice.OnboardingService,
            _kitsservice.KitsService,
            _idcardsservice.IdCardsService,
            _vcardservice.VcardService,
            _assetsservice.AssetsService,
            _jobsservice.JobsService,
            _candidatesservice.CandidatesService,
            _interviewsservice.InterviewsService,
            _appraisalsservice.AppraisalsService,
            _peoplejobs.PeopleJobs
        ],
        exports: [
            _employeesservice.EmployeesService,
            _idcardsservice.IdCardsService,
            _vaultservice.VaultService
        ]
    })
], PeopleModule);

//# sourceMappingURL=people.module.js.map