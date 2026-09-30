import { Module } from '@nestjs/common';
import { AppraisalsController } from './appraisals/appraisals.controller';
import { AppraisalsService } from './appraisals/appraisals.service';
import { AssetsController, WelcomeKitsController } from './assets/assets.controller';
import { AssetsService } from './assets/assets.service';
import { EsignService } from './documents/esign.service';
import { VaultService } from './documents/vault.service';
import { EmployeesController, MastersController, ProfileController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { ProfileService } from './employees/profile.service';
import { IdCardsController, VcardController } from './idcards/idcards.controller';
import { IdCardsService } from './idcards/idcards.service';
import { KitsService } from './kits/kits.service';
import { MastersService } from './masters/masters.service';
import { DocumentsController, OnboardingController } from './onboarding/onboarding.controller';
import { OnboardingService } from './onboarding/onboarding.service';
import { PeopleAccess } from './people.access';
import { PeopleJobs } from './people.jobs';
import { CandidatesService } from './recruitment/candidates.service';
import { InterviewsService } from './recruitment/interviews.service';
import { JobsService } from './recruitment/jobs.service';
import { CandidatesController, InterviewsController, JobsController } from './recruitment/recruitment.controller';
import { VcardService } from './vcard/vcard.service';

/**
 * People domain — employees & masters, profile, digital vault, paperless onboarding with local
 * e-sign, lifecycle (notice/exit), recruitment (jobs, candidates, interviews), appraisals,
 * assets, welcome kits, ID cards and visiting cards. See docs/specs/spec-people.md.
 * Imports nothing from other domains (ARCHITECTURE §5); reads spine models via Prisma.
 */
@Module({
  imports: [],
  controllers: [
    EmployeesController,
    ProfileController,
    MastersController,
    OnboardingController,
    DocumentsController,
    JobsController,
    CandidatesController,
    InterviewsController,
    AppraisalsController,
    AssetsController,
    WelcomeKitsController,
    IdCardsController,
    VcardController,
  ],
  providers: [
    PeopleAccess,
    EmployeesService,
    ProfileService,
    MastersService,
    VaultService,
    EsignService,
    OnboardingService,
    KitsService,
    IdCardsService,
    VcardService,
    AssetsService,
    JobsService,
    CandidatesService,
    InterviewsService,
    AppraisalsService,
    PeopleJobs,
  ],
  exports: [EmployeesService, IdCardsService, VaultService],
})
export class PeopleModule {}
