import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  filingDocsQuery,
  finCreateFolderSchema,
  finMarkFiledSchema,
  finUpdateDocumentSchema,
  finUploadDocumentsSchema,
  FIN_COMPLIANCE_FORMS,
  type FinMarkFiledInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../core/auth/decorators';
import { ZodPipe } from '../../core/http/zod.pipe';
import { FilingService } from './filing.service';
import { ComplianceService } from './compliance.service';
import { sendBytes } from './ledger.controller';

const dayOfMonth = z.number().int().min(1).max(31);
const ukComplianceSettingsSchema = z.object({
  vatStaggerEndMonth: z.number().int().min(1).max(3).optional(),
  yearEndMonth: z.number().int().min(1).max(12).optional(),
  yearEndDay: dayOfMonth.optional(),
  confirmationMonth: z.number().int().min(1).max(12).optional().nullable(),
  confirmationDay: dayOfMonth.optional().nullable(),
});
const unfileSchema = z.object({ form: z.enum(FIN_COMPLIANCE_FORMS), period: z.string().trim().min(4).max(20) });

/** Filing cabinet (spec-workfin Module J) — admin (`filing.manage`). */
@Controller('filing')
@RequirePerm('filing.manage')
export class FilingController {
  constructor(
    private readonly filing: FilingService,
    private readonly compliance: ComplianceService,
  ) {}

  @Get('folders')
  folders() {
    return this.filing.tiles();
  }

  @Post('folders')
  createFolder(@Body(new ZodPipe(finCreateFolderSchema)) dto: z.infer<typeof finCreateFolderSchema>) {
    return this.filing.createFolder(dto.name, dto.parentId);
  }

  @Get('folders/:id')
  folder(@Param('id') id: string, @Query(new ZodPipe(filingDocsQuery)) q: z.infer<typeof filingDocsQuery>) {
    return this.filing.folder(id, q);
  }

  @Delete('folders/:id')
  async deleteFolder(@Param('id') id: string) {
    await this.filing.deleteFolder(id);
    return { ok: true };
  }

  /** Search across every folder (title, tag, linked reference). */
  @Get('documents')
  search(@Query(new ZodPipe(filingDocsQuery)) q: z.infer<typeof filingDocsQuery>) {
    return this.filing.search(q);
  }

  @Post('documents')
  upload(@Body(new ZodPipe(finUploadDocumentsSchema)) dto: z.infer<typeof finUploadDocumentsSchema>) {
    return this.filing.upload(dto);
  }

  @Patch('documents/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(finUpdateDocumentSchema)) dto: z.infer<typeof finUpdateDocumentSchema>) {
    return this.filing.update(id, dto);
  }

  @Delete('documents/:id')
  async remove(@Param('id') id: string) {
    await this.filing.remove(id);
    return { ok: true };
  }

  @Get('documents/:id/download')
  async download(@Param('id') id: string, @Res() res: Response, @Query('inline') inline?: string) {
    const f = await this.filing.download(id);
    sendBytes(res, f.data, f.filename, f.mime, inline === '1');
  }

  @Get('compliance')
  calendar() {
    return this.compliance.calendar();
  }

  @Post('compliance/filed')
  markFiled(@Body(new ZodPipe(finMarkFiledSchema)) dto: FinMarkFiledInput) {
    return this.compliance.markFiled(dto);
  }

  @Post('compliance/unfiled')
  unmarkFiled(@Body(new ZodPipe(unfileSchema)) dto: z.infer<typeof unfileSchema>) {
    return this.compliance.unmarkFiled(dto.form, dto.period);
  }

  @Get('gst-returns')
  gstReturns() {
    return this.compliance.gstReturns(6);
  }

  /** UK (GB): VAT returns register (last 4 quarters). */
  @Get('vat-returns')
  vatReturns() {
    return this.compliance.vatReturns(4);
  }

  /** UK (GB): company year end, VAT quarter stagger and confirmation statement date. */
  @Get('compliance/uk-settings')
  ukSettings() {
    return this.compliance.ukSettings();
  }

  @Patch('compliance/uk-settings')
  updateUkSettings(@Body(new ZodPipe(ukComplianceSettingsSchema)) dto: z.infer<typeof ukComplianceSettingsSchema>) {
    return this.compliance.setUkSettings(dto);
  }
}
