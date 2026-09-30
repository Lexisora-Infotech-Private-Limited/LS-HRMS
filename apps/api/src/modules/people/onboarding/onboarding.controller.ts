import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  bankStepSchema,
  docsStepSchema,
  esignSchema,
  kitStepSchema,
  onboardingTemplatesSchema,
  peopleReasonSchema,
  reopenStepSchema,
  vaultUploadSchema,
  vaultVerifySchema,
  verifyBankSchema,
  type BankStepInput,
  type DocsStepInput,
  type EsignInput,
  type KitStepInput,
  type OnboardingTemplates,
  type VaultUploadInput,
} from '@lexisora/shared';
import { Public, RequirePerm } from '../../../core/auth/decorators';
import { requireContext } from '../../../core/context/request-context';
import { notFound } from '../../../core/http/errors';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { EsignService } from '../documents/esign.service';
import { VaultService } from '../documents/vault.service';
import { OnboardingService } from './onboarding.service';

const pdf = (res: Response, name: string, data: Buffer, inline = true) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(name)}"`);
  res.send(data);
};

/** /onboarding — joiner steps (self) and HR view. */
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly vault: VaultService,
  ) {}

  @Get('me')
  @RequirePerm('onboarding.self', 'onboarding.manage')
  mine() {
    return this.onboarding.mine();
  }

  @Post('me/sign/:key')
  @RequirePerm('onboarding.self')
  @HttpCode(200)
  sign(@Param('key') key: string, @Body(new ZodPipe(esignSchema)) dto: EsignInput, @Headers('user-agent') ua?: string) {
    if (key !== 'offer' && key !== 'nda') throw notFound('Step');
    return this.onboarding.sign(key, dto, ua);
  }

  @Post('me/decline')
  @RequirePerm('onboarding.self')
  @HttpCode(200)
  decline(@Body(new ZodPipe(peopleReasonSchema)) dto: z.infer<typeof peopleReasonSchema>) {
    return this.onboarding.declineOffer(dto.reason);
  }

  @Post('me/docs')
  @RequirePerm('onboarding.self')
  @HttpCode(200)
  docs(@Body(new ZodPipe(docsStepSchema)) dto: DocsStepInput) {
    return this.onboarding.submitDocs(dto);
  }

  @Post('me/bank')
  @RequirePerm('onboarding.self')
  @HttpCode(200)
  bank(@Body(new ZodPipe(bankStepSchema)) dto: BankStepInput) {
    return this.onboarding.submitBank(dto);
  }

  @Post('me/finish')
  @RequirePerm('onboarding.self')
  @HttpCode(200)
  finish(@Body(new ZodPipe(kitStepSchema)) dto: KitStepInput) {
    return this.onboarding.finish(dto);
  }

  // ── HR ──
  @Get()
  @RequirePerm('onboarding.manage')
  list(@Query('status') status?: string) {
    return this.onboarding.list(status || undefined);
  }

  @Get('verification')
  @RequirePerm('onboarding.manage')
  queue(@Query('employeeId') employeeId?: string) {
    return this.vault.queue(employeeId || undefined);
  }

  @Get('templates')
  @RequirePerm('onboarding.manage')
  templates() {
    return this.onboarding.templates();
  }

  @Put('templates')
  @RequirePerm('onboarding.manage')
  saveTemplates(@Body(new ZodPipe(onboardingTemplatesSchema)) dto: OnboardingTemplates) {
    return this.onboarding.saveTemplates(dto);
  }

  @Get(':employeeId')
  @RequirePerm('onboarding.manage')
  detail(@Param('employeeId') id: string) {
    return this.onboarding.detail(id);
  }

  @Post(':employeeId/reopen')
  @RequirePerm('onboarding.manage')
  @HttpCode(200)
  reopen(@Param('employeeId') id: string, @Body(new ZodPipe(reopenStepSchema)) dto: z.infer<typeof reopenStepSchema>) {
    return this.onboarding.reopen(id, dto.key, dto.reason);
  }

  @Post(':employeeId/override')
  @RequirePerm('onboarding.manage')
  @HttpCode(200)
  override(@Param('employeeId') id: string, @Body(new ZodPipe(peopleReasonSchema)) dto: z.infer<typeof peopleReasonSchema>) {
    return this.onboarding.override(id, dto.reason);
  }

  @Post(':employeeId/bank/verify')
  @RequirePerm('onboarding.manage')
  @HttpCode(200)
  verifyBank(@Param('employeeId') id: string, @Body(new ZodPipe(verifyBankSchema)) dto: z.infer<typeof verifyBankSchema>) {
    return this.onboarding.verifyBank(id, dto.decision, dto.reason);
  }
}

/** /vault — own documents; /documents/:id — verify, download, delete. */
@Controller()
export class DocumentsController {
  constructor(
    private readonly vault: VaultService,
    private readonly onboarding: OnboardingService,
    private readonly esign: EsignService,
  ) {}

  private me() {
    const me = requireContext().employeeId;
    if (!me) throw notFound('Employee');
    return me;
  }

  @Get('vault')
  @RequirePerm('vault.self')
  mine(@Query('category') category?: string) {
    return this.vault.listFor(this.me(), category || undefined);
  }

  @Post('vault')
  @RequirePerm('vault.self')
  upload(@Body(new ZodPipe(vaultUploadSchema)) dto: VaultUploadInput) {
    return this.vault.upload(this.me(), dto);
  }

  /** HR upload onto someone's profile (or self). */
  @Post('documents/employee/:employeeId')
  @RequirePerm('vault.self', 'employees.manage')
  uploadFor(@Param('employeeId') employeeId: string, @Body(new ZodPipe(vaultUploadSchema)) dto: VaultUploadInput) {
    return this.vault.upload(employeeId, dto);
  }

  @Get('documents/:id/versions')
  versions(@Param('id') id: string) {
    return this.vault.versions(id);
  }

  @Get('documents/:id/file')
  async file(@Param('id') id: string, @Res() res: Response) {
    const f = await this.vault.download(id);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.filename)}"`);
    res.send(f.data);
  }

  @Post('documents/:id/verify')
  @RequirePerm('onboarding.manage')
  @HttpCode(200)
  async verify(@Param('id') id: string, @Body(new ZodPipe(vaultVerifySchema)) dto: z.infer<typeof vaultVerifySchema>) {
    const r = await this.vault.verify(id, dto.decision, dto.reason);
    const doc = await this.vault.versions(id);
    await this.onboarding.afterDocDecision(r.employeeId, dto.decision, doc[0]?.title, dto.reason);
    return r;
  }

  @Delete('documents/:id')
  remove(@Param('id') id: string) {
    return this.vault.remove(id);
  }

  // ── E-sign envelopes ──
  @Get('esign/:id')
  envelope(@Param('id') id: string) {
    return this.esign.dto(id);
  }

  @Get('esign/:id/pdf')
  async envelopePdf(@Param('id') id: string, @Res() res: Response) {
    const d = await this.esign.document(id);
    pdf(res, d.filename, d.pdf);
  }

  @Public()
  @Get('esign/verify/:sha256')
  verifyHash(@Param('sha256') sha: string) {
    return this.esign.verifyHash(sha);
  }
}
