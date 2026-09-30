import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import {
  addParticipantsSchema,
  appraisalAcknowledgeSchema,
  appraisalCalibrateSchema,
  appraisalCycleSchema,
  appraisalReviewSchema,
  kraTemplateSchema,
  updateParticipantSchema,
  type AppraisalCycleInput,
  type AppraisalReviewInput,
  type KraTemplateInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { AppraisalsService } from './appraisals.service';

/** /appraisals — cycles, templates, association (appraisal.view/manage); own reviews for everyone. */
@Controller('appraisals')
export class AppraisalsController {
  constructor(private readonly svc: AppraisalsService) {}

  @Get('cycles')
  @RequirePerm('appraisal.view', 'appraisal.manage')
  cycles() {
    return this.svc.cycles();
  }

  @Post('cycles')
  @RequirePerm('appraisal.manage')
  create(@Body(new ZodPipe(appraisalCycleSchema)) dto: AppraisalCycleInput) {
    return this.svc.createCycle(dto);
  }

  @Post('cycles/:id/advance')
  @RequirePerm('appraisal.manage')
  @HttpCode(200)
  advance(@Param('id') id: string) {
    return this.svc.advance(id);
  }

  @Get('cycles/:id/participants')
  @RequirePerm('appraisal.view', 'appraisal.manage')
  participants(@Param('id') id: string) {
    return this.svc.participants(id);
  }

  @Post('cycles/:id/participants')
  @RequirePerm('appraisal.manage')
  addParticipants(@Param('id') id: string, @Body(new ZodPipe(addParticipantsSchema)) dto: z.infer<typeof addParticipantsSchema>) {
    return this.svc.addParticipants(id, dto.employeeIds, dto.departmentId);
  }

  @Patch('participants/:id')
  @RequirePerm('appraisal.manage')
  updateParticipant(@Param('id') id: string, @Body(new ZodPipe(updateParticipantSchema)) dto: z.infer<typeof updateParticipantSchema>) {
    return this.svc.updateParticipant(id, dto);
  }

  @Delete('participants/:id')
  @RequirePerm('appraisal.manage')
  removeParticipant(@Param('id') id: string) {
    return this.svc.removeParticipant(id);
  }

  @Get('templates')
  @RequirePerm('appraisal.view', 'appraisal.manage')
  templates() {
    return this.svc.templates();
  }

  @Post('templates')
  @RequirePerm('appraisal.manage')
  createTemplate(@Body(new ZodPipe(kraTemplateSchema)) dto: KraTemplateInput) {
    return this.svc.createTemplate(dto);
  }

  @Post('templates/:id/publish')
  @RequirePerm('appraisal.manage')
  @HttpCode(200)
  publish(@Param('id') id: string) {
    return this.svc.publishTemplate(id);
  }

  @Get('mine')
  mine() {
    return this.svc.mine();
  }

  @Get('reviews/:id')
  review(@Param('id') id: string) {
    return this.svc.review(id);
  }

  @Put('reviews/:id')
  save(@Param('id') id: string, @Body(new ZodPipe(appraisalReviewSchema)) dto: AppraisalReviewInput) {
    return this.svc.saveReview(id, dto);
  }

  @Post('reviews/:id/calibrate')
  @RequirePerm('appraisal.manage')
  @HttpCode(200)
  calibrate(@Param('id') id: string, @Body(new ZodPipe(appraisalCalibrateSchema)) dto: z.infer<typeof appraisalCalibrateSchema>) {
    return this.svc.calibrate(id, dto.score, dto.note);
  }

  @Post('reviews/:id/acknowledge')
  @HttpCode(200)
  acknowledge(@Param('id') id: string, @Body(new ZodPipe(appraisalAcknowledgeSchema)) dto: z.infer<typeof appraisalAcknowledgeSchema>) {
    return this.svc.acknowledge(id, dto.comment);
  }
}
