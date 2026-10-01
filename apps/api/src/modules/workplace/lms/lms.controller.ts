import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  courseAssignmentSchema,
  courseCreateSchema,
  courseUpdateSchema,
  lessonCreateSchema,
  lessonProgressSchema,
  lessonReorderSchema,
  lessonUpdateSchema,
  lmsListQuery,
  type CourseCreateInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { CertificatesService } from '../common/certificates.service';
import { sendFile } from '../common/http';
import { LmsService } from './lms.service';

/** Learning — /lms (spec §7.4). */
@Controller('lms')
export class LmsController {
  constructor(
    private readonly lms: LmsService,
    private readonly certs: CertificatesService,
  ) {}

  @Get()
  @RequirePerm('lms.view', 'lms.manage')
  tiles(@Query(new ZodPipe(lmsListQuery)) q: z.infer<typeof lmsListQuery>) {
    return this.lms.tiles(q.tab);
  }

  @Get('manage')
  @RequirePerm('lms.manage')
  manage() {
    return this.lms.manageList();
  }

  @Get('courses/:id')
  @RequirePerm('lms.view', 'lms.manage')
  detail(@Param('id') id: string) {
    return this.lms.detail(id);
  }

  @Post('courses/:id/enroll')
  @RequirePerm('lms.view')
  enroll(@Param('id') id: string) {
    return this.lms.enroll(id);
  }

  @Post('lessons/:id/progress')
  @RequirePerm('lms.view')
  progress(@Param('id') id: string, @Body(new ZodPipe(lessonProgressSchema)) dto: z.infer<typeof lessonProgressSchema>) {
    return this.lms.heartbeat(id, dto);
  }

  @Post('lessons/:id/complete')
  @RequirePerm('lms.view')
  complete(@Param('id') id: string) {
    return this.lms.completeLesson(id);
  }

  /** Tile "Download certificate": streams the PDF and marks it downloaded. */
  @Get('enrollments/:id/certificate')
  @RequirePerm('lms.view', 'lms.manage')
  async certificate(@Param('id') id: string, @Res() res: Response) {
    const certId = await this.lms.certificateFor(id);
    const { cert, data } = await this.certs.pdfFor(certId);
    sendFile(res, data, `${cert.title.replace(/[^\w]+/g, '-')}-${cert.holderName.replace(/[^\w]+/g, '-')}.pdf`, 'application/pdf');
  }

  // ── Manage (lms.manage) ─────────────────────────────────────────────────
  @Post('courses')
  @RequirePerm('lms.manage')
  create(@Body(new ZodPipe(courseCreateSchema)) dto: CourseCreateInput) {
    return this.lms.create(dto);
  }

  @Patch('courses/:id')
  @RequirePerm('lms.manage')
  update(@Param('id') id: string, @Body(new ZodPipe(courseUpdateSchema)) dto: z.infer<typeof courseUpdateSchema>) {
    return this.lms.update(id, dto);
  }

  @Post('courses/:id/lessons')
  @RequirePerm('lms.manage')
  addLesson(@Param('id') id: string, @Body(new ZodPipe(lessonCreateSchema)) dto: z.infer<typeof lessonCreateSchema>) {
    return this.lms.addLesson(id, dto);
  }

  @Post('courses/:id/lessons/reorder')
  @RequirePerm('lms.manage')
  reorder(@Param('id') id: string, @Body(new ZodPipe(lessonReorderSchema)) dto: z.infer<typeof lessonReorderSchema>) {
    return this.lms.reorder(id, dto.lessonIds);
  }

  @Patch('lessons/:id')
  @RequirePerm('lms.manage')
  updateLesson(@Param('id') id: string, @Body(new ZodPipe(lessonUpdateSchema)) dto: z.infer<typeof lessonUpdateSchema>) {
    return this.lms.updateLesson(id, dto);
  }

  @Delete('lessons/:id')
  @RequirePerm('lms.manage')
  deleteLesson(@Param('id') id: string) {
    return this.lms.deleteLesson(id);
  }

  @Post('courses/:id/publish')
  @RequirePerm('lms.manage')
  publish(@Param('id') id: string) {
    return this.lms.publish(id);
  }

  @Post('courses/:id/archive')
  @RequirePerm('lms.manage')
  archive(@Param('id') id: string) {
    return this.lms.archive(id);
  }

  @Post('courses/:id/assignments')
  @RequirePerm('lms.manage')
  assign(@Param('id') id: string, @Body(new ZodPipe(courseAssignmentSchema)) dto: z.infer<typeof courseAssignmentSchema>) {
    return this.lms.addAssignment(id, dto);
  }

  @Delete('assignments/:id')
  @RequirePerm('lms.manage')
  unassign(@Param('id') id: string) {
    return this.lms.deleteAssignment(id);
  }

  @Get('courses/:id/report')
  @RequirePerm('lms.manage')
  report(@Param('id') id: string) {
    return this.lms.report(id);
  }

  @Get('courses/:id/report.csv')
  @RequirePerm('lms.manage')
  async reportCsv(@Param('id') id: string, @Res() res: Response) {
    const { filename, csv } = await this.lms.reportCsv(id);
    sendFile(res, csv, filename, 'text/csv; charset=utf-8');
  }
}
