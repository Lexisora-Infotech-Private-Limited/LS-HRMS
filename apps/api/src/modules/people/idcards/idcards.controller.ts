import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  generateCardsSchema,
  idCardSettingsSchema,
  idCardTemplateSchema,
  peopleReasonSchema,
  printBatchSchema,
  vcardEmailSchema,
  vcardSettingsSchema,
  vcardWhatsappSchema,
  type IdCardSettings,
  type IdCardTemplateInput,
} from '@lexisora/shared';
import { Public, RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { VcardService } from '../vcard/vcard.service';
import { IdCardsService } from './idcards.service';

const send = (res: Response, mime: string, name: string, data: Buffer | string, inline = true) => {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(name)}"`);
  res.send(data);
};

/** /id-cards — designer templates, generation, print batches; public QR verify. */
@Controller('id-cards')
export class IdCardsController {
  constructor(private readonly cards: IdCardsService) {}

  @Public()
  @Get('verify/:token')
  async verify(@Param('token') token: string, @Res() res: Response) {
    const r = await this.cards.verifyHtml(token);
    res.status(r.status).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(r.html);
  }

  @Get('mine')
  mine() {
    return this.cards.myCard();
  }

  @Get('settings')
  @RequirePerm('idcard.manage')
  settings() {
    return this.cards.settings();
  }

  @Put('settings')
  @RequirePerm('idcard.manage')
  saveSettings(@Body(new ZodPipe(idCardSettingsSchema)) dto: IdCardSettings) {
    return this.cards.saveSettings(dto);
  }

  @Get('templates')
  @RequirePerm('idcard.manage')
  templates() {
    return this.cards.templates();
  }

  @Post('templates')
  @RequirePerm('idcard.manage')
  createTemplate(@Body(new ZodPipe(idCardTemplateSchema)) dto: IdCardTemplateInput) {
    return this.cards.createTemplate(dto);
  }

  @Put('templates/:id')
  @RequirePerm('idcard.manage')
  updateTemplate(@Param('id') id: string, @Body(new ZodPipe(idCardTemplateSchema)) dto: IdCardTemplateInput) {
    return this.cards.updateTemplate(id, dto);
  }

  @Post('templates/:id/default')
  @RequirePerm('idcard.manage')
  @HttpCode(200)
  setDefault(@Param('id') id: string) {
    return this.cards.setDefault(id);
  }

  @Get('templates/:id/preview/:side')
  @RequirePerm('idcard.manage')
  async preview(@Param('id') id: string, @Param('side') side: string, @Query('employeeId') employeeId: string, @Res() res: Response) {
    const png = await this.cards.previewPng(id, employeeId, side === 'back' ? 'back' : 'front');
    res.setHeader('Cache-Control', 'no-store');
    send(res, 'image/png', `preview-${side}.png`, png);
  }

  @Get('preview-data')
  @RequirePerm('idcard.manage')
  previewData(@Query('employeeId') employeeId?: string) {
    return this.cards.previewData(employeeId || null);
  }

  @Get()
  @RequirePerm('idcard.manage')
  list(@Query('status') status?: string, @Query('q') q?: string) {
    return this.cards.cards(status || undefined, q || undefined);
  }

  @Get('generatable')
  @RequirePerm('idcard.manage')
  generatable() {
    return this.cards.generatable();
  }

  @Post('generate')
  @RequirePerm('idcard.manage')
  @HttpCode(200)
  generate(@Body(new ZodPipe(generateCardsSchema)) dto: z.infer<typeof generateCardsSchema>) {
    return this.cards.generate(dto);
  }

  @Post('print')
  @RequirePerm('idcard.manage')
  @HttpCode(200)
  print(@Body(new ZodPipe(printBatchSchema)) dto: z.infer<typeof printBatchSchema>) {
    return this.cards.sendToPrint(dto);
  }

  @Get('batches')
  @RequirePerm('idcard.manage')
  batches() {
    return this.cards.batches();
  }

  @Post('batches/:id/:status')
  @RequirePerm('idcard.manage')
  @HttpCode(200)
  batchStatus(@Param('id') id: string, @Param('status') status: string) {
    return this.cards.setBatchStatus(id, status === 'delivered' ? 'DELIVERED' : 'ACKNOWLEDGED');
  }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const r = await this.cards.cardPdf(id);
    send(res, 'application/pdf', r.filename, r.pdf);
  }

  @Get(':id/png/:side')
  async png(@Param('id') id: string, @Param('side') side: string, @Res() res: Response) {
    send(res, 'image/png', `id-card-${side}.png`, await this.cards.cardPng(id, side === 'back' ? 'back' : 'front'));
  }

  @Post(':id/issue')
  @RequirePerm('idcard.manage')
  @HttpCode(200)
  issue(@Param('id') id: string) {
    return this.cards.markIssued(id);
  }

  @Post(':id/revoke')
  @RequirePerm('idcard.manage')
  @HttpCode(200)
  revoke(@Param('id') id: string, @Body(new ZodPipe(peopleReasonSchema)) dto: z.infer<typeof peopleReasonSchema>) {
    return this.cards.revoke(id, dto.reason);
  }

  @Post('employee/:employeeId/reissue')
  @RequirePerm('idcard.manage')
  @HttpCode(200)
  reissue(@Param('employeeId') employeeId: string, @Body(new ZodPipe(peopleReasonSchema)) dto: z.infer<typeof peopleReasonSchema>) {
    return this.cards.reissue(employeeId, dto.reason);
  }
}

/** /vcard — own digital visiting card; public card page. */
@Controller('vcard')
export class VcardController {
  constructor(private readonly vcard: VcardService) {}

  @Public()
  @Get('c/:tenant/:slug')
  async publicCard(@Param('tenant') tenant: string, @Param('slug') slug: string, @Res() res: Response) {
    const r = await this.vcard.publicCard(tenant, slug);
    res.status(r.status);
    if (r.vcf) return send(res, 'text/vcard; charset=utf-8', r.filename ?? 'contact.vcf', r.vcf, false);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(r.html ?? '');
  }

  @Get()
  @RequirePerm('vcard.self')
  card() {
    return this.vcard.card();
  }

  @Put()
  @RequirePerm('vcard.self')
  settings(@Body(new ZodPipe(vcardSettingsSchema)) dto: z.infer<typeof vcardSettingsSchema>) {
    return this.vcard.updateSettings({ ...dto, linkedinUrl: dto.linkedinUrl || null });
  }

  @Get('png')
  @RequirePerm('vcard.self')
  async png(@Res() res: Response) {
    send(res, 'image/png', 'visiting-card.png', await this.vcard.png(), false);
  }

  @Get('pdf')
  @RequirePerm('vcard.self')
  async pdf(@Res() res: Response) {
    send(res, 'application/pdf', 'visiting-card.pdf', await this.vcard.pdfFile(), false);
  }

  @Get('vcf')
  @RequirePerm('vcard.self')
  async vcf(@Res() res: Response) {
    const r = await this.vcard.vcf();
    send(res, 'text/vcard; charset=utf-8', r.filename, r.vcf, false);
  }

  @Post('share/email')
  @RequirePerm('vcard.self')
  @HttpCode(200)
  email(@Body(new ZodPipe(vcardEmailSchema)) dto: z.infer<typeof vcardEmailSchema>) {
    return this.vcard.shareEmail(dto.to, dto.message);
  }

  @Post('share/whatsapp')
  @RequirePerm('vcard.self')
  @HttpCode(200)
  whatsapp(@Body(new ZodPipe(vcardWhatsappSchema)) dto: z.infer<typeof vcardWhatsappSchema>) {
    return this.vcard.shareWhatsapp(dto.phone || null);
  }
}
