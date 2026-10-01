import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  finCancelInvoiceSchema,
  finCreateInvoiceSchema,
  finEmailInvoiceSchema,
  finInvoiceListQuery,
  finInvoicePreviewQuery,
  finRecordPaymentSchema,
  finUpdateInvoiceSchema,
  ledgerKpiQuery,
  type FinCreateInvoiceInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../core/auth/decorators';
import { ZodPipe } from '../../core/http/zod.pipe';
import { InvoiceService } from './invoice.service';
import { sendBytes } from './ledger.controller';

/** GST invoices (spec-workfin Module G) — admin (`invoices.manage`). */
@Controller('invoices')
@RequirePerm('invoices.manage')
export class InvoicesController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  list(@Query(new ZodPipe(finInvoiceListQuery)) q: z.infer<typeof finInvoiceListQuery>) {
    return this.invoices.list(q);
  }

  @Get('kpis')
  kpis(@Query(new ZodPipe(ledgerKpiQuery)) q: z.infer<typeof ledgerKpiQuery>) {
    return this.invoices.kpis(q.month);
  }

  @Get('options')
  options() {
    return this.invoices.options();
  }

  /** Approved, unbilled billable hours for client + project + month (form auto-fill). */
  @Get('preview')
  preview(@Query(new ZodPipe(finInvoicePreviewQuery)) q: z.infer<typeof finInvoicePreviewQuery>) {
    return this.invoices.preview(q);
  }

  @Post()
  create(@Body(new ZodPipe(finCreateInvoiceSchema)) dto: FinCreateInvoiceInput) {
    return this.invoices.create(dto);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.invoices.detail(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(finUpdateInvoiceSchema)) dto: z.infer<typeof finUpdateInvoiceSchema>) {
    return this.invoices.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.invoices.remove(id);
  }

  @Post(':id/issue')
  issue(@Param('id') id: string) {
    return this.invoices.issue(id);
  }

  @Post(':id/email')
  email(@Param('id') id: string, @Body(new ZodPipe(finEmailInvoiceSchema)) dto: z.infer<typeof finEmailInvoiceSchema>) {
    return this.invoices.email(id, dto);
  }

  @Post(':id/payments')
  pay(@Param('id') id: string, @Body(new ZodPipe(finRecordPaymentSchema)) dto: z.infer<typeof finRecordPaymentSchema>) {
    return this.invoices.recordPayment(id, dto);
  }

  @Delete(':id/payments/:paymentId')
  reversePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    return this.invoices.reversePayment(id, paymentId);
  }

  /** Cancel an issued invoice with a full credit note (hours become billable again). */
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body(new ZodPipe(finCancelInvoiceSchema)) dto: z.infer<typeof finCancelInvoiceSchema>) {
    return this.invoices.cancel(id, dto.reason);
  }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response, @Query('inline') inline?: string) {
    const f = await this.invoices.pdfFile(id);
    sendBytes(res, f.data, f.filename, 'application/pdf', inline === '1');
  }

  @Get(':id/credit-notes/:cnId/pdf')
  async creditNotePdf(@Param('id') id: string, @Param('cnId') cnId: string, @Res() res: Response, @Query('inline') inline?: string) {
    const f = await this.invoices.creditNotePdf(id, cnId);
    sendBytes(res, f.data, f.filename, 'application/pdf', inline === '1');
  }
}
