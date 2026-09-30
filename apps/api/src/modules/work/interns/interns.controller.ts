import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { internSheetQuery, internTaskInput, internTaskUpdateInput, internWeekScoreInput, type InternTaskInput, type InternTaskUpdateInput } from '@lexisora/shared';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { InternsService } from './interns.service';

const weekQuery = z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/**
 * Intern task sheets. Any signed-in user may call these; the service scopes by relationship
 * (intern → own sheet, mentor → mentees, interns.viewAll → everyone).
 */
@Controller('interns')
export class InternsController {
  constructor(private readonly svc: InternsService) {}

  @Get('context')
  context() {
    return this.svc.context();
  }

  @Get('sheet')
  sheet(@Query(new ZodPipe(internSheetQuery)) q: z.infer<typeof internSheetQuery>) {
    return this.svc.sheet(q);
  }

  @Post('tasks')
  assign(@Body(new ZodPipe(internTaskInput)) body: InternTaskInput) {
    return this.svc.assign(body);
  }

  @Patch('tasks/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(internTaskUpdateInput)) body: InternTaskUpdateInput) {
    return this.svc.update(id, body);
  }

  @Delete('tasks/:id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post('tasks/:id/carry-over')
  carry(@Param('id') id: string) {
    return this.svc.carryOver(id);
  }

  @Get(':internId/week')
  week(@Param('internId') internId: string, @Query(new ZodPipe(weekQuery)) q: z.infer<typeof weekQuery>) {
    return this.svc.week(internId, q.weekStart);
  }

  @Put(':internId/week-score')
  score(@Param('internId') internId: string, @Body(new ZodPipe(internWeekScoreInput)) body: z.infer<typeof internWeekScoreInput>) {
    return this.svc.setWeekScore(internId, { weekStart: body.weekStart, score: body.score, feedback: body.feedback });
  }
}
