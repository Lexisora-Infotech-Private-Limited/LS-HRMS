import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { policyAckSchema, policyComplianceQuery, policyCreateSchema, policyListQuery, policyVersionSchema, wpHolidaysQuery, type PolicyCreateInput } from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { sendFile } from '../common/http';
import { PoliciesService } from './policies.service';

/** Policies & rulebook — /policies (spec §9), including the holiday list. */
@Controller('policies')
export class PoliciesController {
  constructor(private readonly svc: PoliciesService) {}

  @Get()
  @RequirePerm('policies.view')
  list(@Query(new ZodPipe(policyListQuery)) q: z.infer<typeof policyListQuery>) {
    return this.svc.list(q.tab);
  }

  @Get('compliance')
  @RequirePerm('policies.manage')
  compliance() {
    return this.svc.compliance();
  }

  @Get('holidays')
  @RequirePerm('policies.view')
  holidays(@Query(new ZodPipe(wpHolidaysQuery)) q: z.infer<typeof wpHolidaysQuery>) {
    return this.svc.holidays(q.year);
  }

  @Get('holidays/:year/pdf')
  @RequirePerm('policies.view')
  async holidaysPdf(@Param('year', ParseIntPipe) year: number, @Res() res: Response) {
    const f = await this.svc.holidaysPdf(year);
    sendFile(res, f.data, f.filename, 'application/pdf');
  }

  @Post('versions/:versionId/ack')
  @RequirePerm('policies.view')
  ack(@Param('versionId') versionId: string, @Body(new ZodPipe(policyAckSchema.omit({ versionId: true }))) dto: { readSeconds: number }, @Headers('user-agent') ua?: string) {
    return this.svc.acknowledge(versionId, dto.readSeconds, ua ?? null);
  }

  @Get(':id')
  @RequirePerm('policies.view')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Post()
  @RequirePerm('policies.manage')
  create(@Body(new ZodPipe(policyCreateSchema)) dto: PolicyCreateInput) {
    return this.svc.create(dto);
  }

  @Post(':id/versions')
  @RequirePerm('policies.manage')
  newVersion(@Param('id') id: string, @Body(new ZodPipe(policyVersionSchema)) dto: z.infer<typeof policyVersionSchema>) {
    return this.svc.newVersion(id, dto);
  }

  @Post(':id/archive')
  @RequirePerm('policies.manage')
  archive(@Param('id') id: string) {
    return this.svc.archive(id);
  }

  @Post(':id/restore')
  @RequirePerm('policies.manage')
  restore(@Param('id') id: string) {
    return this.svc.restore(id);
  }

  @Get(':id/compliance')
  @RequirePerm('policies.manage')
  people(@Param('id') id: string, @Query(new ZodPipe(policyComplianceQuery)) q: z.infer<typeof policyComplianceQuery>) {
    return this.svc.compliancePeople(id, q.state);
  }

  @Get(':id/compliance/csv')
  @RequirePerm('policies.manage')
  async csv(@Param('id') id: string, @Res() res: Response) {
    const f = await this.svc.complianceCsv(id);
    sendFile(res, String.fromCharCode(0xfeff) + f.csv, f.filename, 'text/csv; charset=utf-8');
  }

  @Post(':id/remind')
  @RequirePerm('policies.manage')
  remind(@Param('id') id: string) {
    return this.svc.remind(id);
  }
}
