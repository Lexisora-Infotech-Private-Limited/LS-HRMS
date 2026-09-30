import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  addApplicationSchema,
  cancelInterviewSchema,
  candidateListQuery,
  candidateSchema,
  hireSchema,
  interviewListQuery,
  interviewResultSchema,
  interviewRoundSchema,
  jobOfferSchema,
  jobSchema,
  jobStatusSchema,
  rescheduleInterviewSchema,
  scheduleInterviewSchema,
  scorecardSchema,
  stageChangeSchema,
  type CandidateInput,
  type CandidateListQuery,
  type HireInput,
  type JobInput,
  type JobOfferInput,
  type ScheduleInterviewInput,
  type ScorecardInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { MastersService } from '../masters/masters.service';
import { CandidatesService } from './candidates.service';
import { InterviewsService } from './interviews.service';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly masters: MastersService,
  ) {}

  @Get()
  @RequirePerm('jobs.manage', 'candidates.view')
  list(@Query('tab') tab?: string) {
    return this.jobs.list(tab === 'closed' ? 'closed' : 'open');
  }

  @Get('rounds')
  @RequirePerm('jobs.manage', 'candidates.view', 'candidates.manage')
  rounds() {
    return this.masters.rounds();
  }

  @Post('rounds')
  @RequirePerm('jobs.manage')
  createRound(@Body(new ZodPipe(interviewRoundSchema)) dto: z.infer<typeof interviewRoundSchema>) {
    return this.masters.createRound(dto);
  }

  @Post('rounds/:id/deactivate')
  @RequirePerm('jobs.manage')
  @HttpCode(200)
  deactivateRound(@Param('id') id: string) {
    return this.masters.deactivateRound(id);
  }

  @Get(':id')
  @RequirePerm('jobs.manage', 'candidates.view')
  detail(@Param('id') id: string) {
    return this.jobs.detail(id);
  }

  @Post()
  @RequirePerm('jobs.manage')
  create(@Body(new ZodPipe(jobSchema)) dto: JobInput) {
    return this.jobs.create(dto);
  }

  @Put(':id')
  @RequirePerm('jobs.manage')
  update(@Param('id') id: string, @Body(new ZodPipe(jobSchema)) dto: JobInput) {
    return this.jobs.update(id, dto);
  }

  @Post(':id/status')
  @RequirePerm('jobs.manage')
  @HttpCode(200)
  status(@Param('id') id: string, @Body(new ZodPipe(jobStatusSchema)) dto: z.infer<typeof jobStatusSchema>) {
    return this.jobs.setStatus(id, dto.status, dto.reason);
  }
}

@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Get()
  @RequirePerm('candidates.view', 'candidates.manage')
  list(@Query(new ZodPipe(candidateListQuery)) q: CandidateListQuery) {
    return this.candidates.list(q);
  }

  @Get(':id')
  @RequirePerm('candidates.view', 'candidates.manage')
  detail(@Param('id') id: string) {
    return this.candidates.detail(id);
  }

  @Post()
  @RequirePerm('candidates.manage')
  create(@Body(new ZodPipe(candidateSchema)) dto: CandidateInput) {
    return this.candidates.create(dto);
  }

  @Post(':id/applications')
  @RequirePerm('candidates.manage')
  apply(@Param('id') id: string, @Body(new ZodPipe(addApplicationSchema)) dto: z.infer<typeof addApplicationSchema>) {
    return this.candidates.addApplication(id, dto.jobId);
  }

  @Post(':id/anonymise')
  @RequirePerm('candidates.manage')
  @HttpCode(200)
  anonymise(@Param('id') id: string) {
    return this.candidates.anonymise(id);
  }

  @Post('applications/:appId/stage')
  @RequirePerm('candidates.manage')
  @HttpCode(200)
  stage(@Param('appId') appId: string, @Body(new ZodPipe(stageChangeSchema)) dto: z.infer<typeof stageChangeSchema>) {
    return this.candidates.moveStage(appId, dto.to, dto.reason);
  }

  @Post('applications/:appId/offer')
  @RequirePerm('candidates.manage')
  @HttpCode(200)
  offer(@Param('appId') appId: string, @Body(new ZodPipe(jobOfferSchema)) dto: JobOfferInput) {
    return this.candidates.saveOffer(appId, dto);
  }

  @Post('applications/:appId/hire')
  @RequirePerm('employees.manage')
  @HttpCode(200)
  hire(@Param('appId') appId: string, @Body(new ZodPipe(hireSchema)) dto: HireInput) {
    return this.candidates.hire(appId, dto);
  }
}

/** Panelists see their own interviews without the nav permission (audit G2) — scoped in the service. */
@Controller('interviews')
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  @Get()
  list(@Query(new ZodPipe(interviewListQuery)) q: z.infer<typeof interviewListQuery>) {
    return this.interviews.list(q.tab, q.mine);
  }

  @Get('rounds')
  rounds() {
    return this.interviews.rounds();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.interviews.detail(id);
  }

  @Post()
  @RequirePerm('candidates.manage', 'jobs.manage')
  schedule(@Body(new ZodPipe(scheduleInterviewSchema)) dto: ScheduleInterviewInput) {
    return this.interviews.schedule(dto);
  }

  @Post(':id/reschedule')
  @RequirePerm('candidates.manage', 'jobs.manage')
  @HttpCode(200)
  reschedule(@Param('id') id: string, @Body(new ZodPipe(rescheduleInterviewSchema)) dto: z.infer<typeof rescheduleInterviewSchema>) {
    return this.interviews.reschedule(id, dto.date, dto.time, dto.durationMin);
  }

  @Post(':id/cancel')
  @RequirePerm('candidates.manage', 'jobs.manage')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body(new ZodPipe(cancelInterviewSchema)) dto: z.infer<typeof cancelInterviewSchema>) {
    return this.interviews.cancel(id, dto.reason);
  }

  @Put(':id/scorecard')
  scorecard(@Param('id') id: string, @Body(new ZodPipe(scorecardSchema)) dto: ScorecardInput) {
    return this.interviews.saveScorecard(id, dto);
  }

  @Post(':id/result')
  @HttpCode(200)
  result(@Param('id') id: string, @Body(new ZodPipe(interviewResultSchema)) dto: z.infer<typeof interviewResultSchema>) {
    return this.interviews.setResult(id, dto.result);
  }
}
