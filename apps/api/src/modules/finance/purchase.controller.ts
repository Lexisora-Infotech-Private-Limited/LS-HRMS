import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  cancelPurchaseSchema,
  createPurchaseSchema,
  extractBillSchema,
  finCreateCategorySchema,
  finCreateVendorSchema,
  finUpdateCategorySchema,
  gstr3bQuery,
  purchaseKpiQuery,
  purchaseListQuery,
  ukCreatePurchaseSchema,
  ukCreateVendorSchema,
  ukVatReturnQuery,
  type CreatePurchaseInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../core/auth/decorators';
import { ZodPipe } from '../../core/http/zod.pipe';
import { PurchaseService } from './purchase.service';
import { sendBytes } from './ledger.controller';
import { RegionZodPipe } from './region-pipe';

/** Purchases & input GST (spec-workfin Module H) — admin (`purchases.manage`). */
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchaseService) {}

  @Get()
  @RequirePerm('purchases.manage')
  list(@Query(new ZodPipe(purchaseListQuery)) q: z.infer<typeof purchaseListQuery>) {
    return this.purchases.list(q);
  }

  @Get('kpis')
  @RequirePerm('purchases.manage')
  kpis(@Query(new ZodPipe(purchaseKpiQuery)) q: z.infer<typeof purchaseKpiQuery>) {
    return this.purchases.kpis(q.month);
  }

  @Get('options')
  @RequirePerm('purchases.manage')
  options() {
    return this.purchases.options();
  }

  /** Bill OCR: read the uploaded bill's text layer; estimate GST when nothing is found. */
  @Post('extract')
  @RequirePerm('purchases.manage')
  extract(@Body(new ZodPipe(extractBillSchema)) dto: z.infer<typeof extractBillSchema>) {
    return this.purchases.extract(dto);
  }

  @Post()
  @RequirePerm('purchases.manage')
  create(@Body(new RegionZodPipe(createPurchaseSchema, ukCreatePurchaseSchema)) dto: CreatePurchaseInput) {
    return this.purchases.create(dto);
  }

  @Get('gstr3b')
  @RequirePerm('purchases.manage', 'filing.manage')
  gstr3b(@Query(new ZodPipe(gstr3bQuery)) q: z.infer<typeof gstr3bQuery>) {
    return this.purchases.gstr3b(q.month);
  }

  @Get('gstr3b/csv')
  @RequirePerm('purchases.manage', 'filing.manage')
  async gstr3bCsv(@Query(new ZodPipe(gstr3bQuery)) q: z.infer<typeof gstr3bQuery>, @Res() res: Response) {
    const f = await this.purchases.gstr3bCsv(q.month);
    sendBytes(res, `﻿${f.csv}`, f.filename, 'text/csv; charset=utf-8');
  }

  /** Save the GSTR-3B working PDF into Filing cabinet › GST returns. */
  @Post('gstr3b/file')
  @RequirePerm('purchases.manage', 'filing.manage')
  fileGstr3b(@Body(new ZodPipe(gstr3bQuery)) dto: z.infer<typeof gstr3bQuery>) {
    return this.purchases.fileGstr3b(dto.month);
  }

  /** UK (GB): HMRC VAT return (9 boxes) for the quarter ending `period` (YYYY-MM). */
  @Get('vat-return')
  @RequirePerm('purchases.manage', 'filing.manage')
  vatReturn(@Query(new ZodPipe(ukVatReturnQuery)) q: z.infer<typeof ukVatReturnQuery>) {
    return this.purchases.vatReturn(q.period);
  }

  @Get('vat-return/csv')
  @RequirePerm('purchases.manage', 'filing.manage')
  async vatReturnCsv(@Query(new ZodPipe(ukVatReturnQuery)) q: z.infer<typeof ukVatReturnQuery>, @Res() res: Response) {
    const f = await this.purchases.vatReturnCsv(q.period);
    sendBytes(res, `﻿${f.csv}`, f.filename, 'text/csv; charset=utf-8');
  }

  /** Save the VAT return working PDF into Filing cabinet › VAT returns. */
  @Post('vat-return/file')
  @RequirePerm('purchases.manage', 'filing.manage')
  fileVatReturn(@Body(new ZodPipe(ukVatReturnQuery)) dto: z.infer<typeof ukVatReturnQuery>) {
    return this.purchases.fileVatReturn(dto.period);
  }

  @Get('categories')
  @RequirePerm('purchases.manage')
  categories() {
    return this.purchases.categories();
  }

  @Post('categories')
  @RequirePerm('purchases.manage')
  createCategory(@Body(new ZodPipe(finCreateCategorySchema)) dto: z.infer<typeof finCreateCategorySchema>) {
    return this.purchases.createCategory(dto);
  }

  @Patch('categories/:id')
  @RequirePerm('purchases.manage')
  updateCategory(@Param('id') id: string, @Body(new ZodPipe(finUpdateCategorySchema)) dto: z.infer<typeof finUpdateCategorySchema>) {
    return this.purchases.updateCategory(id, dto);
  }

  @Get(':id')
  @RequirePerm('purchases.manage')
  detail(@Param('id') id: string) {
    return this.purchases.detail(id);
  }

  @Post(':id/cancel')
  @RequirePerm('purchases.manage')
  cancel(@Param('id') id: string, @Body(new ZodPipe(cancelPurchaseSchema)) dto: z.infer<typeof cancelPurchaseSchema>) {
    return this.purchases.cancel(id, dto.reason);
  }
}

@Controller('vendors')
@RequirePerm('purchases.manage')
export class VendorsController {
  constructor(private readonly purchases: PurchaseService) {}

  @Get()
  list() {
    return this.purchases.vendors();
  }

  @Post()
  create(@Body(new RegionZodPipe(finCreateVendorSchema, ukCreateVendorSchema)) dto: z.infer<typeof finCreateVendorSchema>) {
    return this.purchases.createVendor(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new RegionZodPipe(finCreateVendorSchema, ukCreateVendorSchema)) dto: z.infer<typeof finCreateVendorSchema>) {
    return this.purchases.updateVendor(id, dto);
  }
}
