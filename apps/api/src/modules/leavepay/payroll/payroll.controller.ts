import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  adjustmentSchema,
  payrollCancelSchema,
  payrollHoldSchema,
  payrollProfileSchema,
  payrollRunSchema,
  payslipListQuery,
  salaryPreviewSchema,
  salaryRevisionSchema,
  type AdjustmentInput,
  type PayrollProfileInput,
  type PayrollRunInput,
  type SalaryPreviewInput,
  type SalaryRevisionInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { PayrollService } from './payroll.service';
import { PayslipService } from './payslip.service';
import { SalaryService } from './salary.service';

const periodParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-09');
const refreshQuery = z.object({ refresh: z.coerce.boolean().optional() });
const recalcBody = z.object({ itemIds: z.array(z.string()).max(500).optional() });
const periodBody = z.object({ period: periodParam });
const adjQuery = z.object({ period: periodParam.optional() });

function sendFile(res: Response, data: Buffer, filename: string, mime: string, inline = false) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(data);
}

@Controller('payroll')
@RequirePerm('payroll.manage')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('period/:period')
  period(@Param('period', new ZodPipe(periodParam)) period: string, @Query(new ZodPipe(refreshQuery)) q: { refresh?: boolean }) {
    return this.payroll.periodView(period, !!q.refresh);
  }

  @Post('runs')
  create(@Body(new ZodPipe(payrollRunSchema)) body: PayrollRunInput) {
    return this.payroll.createRun(body);
  }

  @Patch('runs/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(payrollRunSchema.partial())) body: Partial<PayrollRunInput>) {
    return this.payroll.updateRun(id, body);
  }

  @Post('runs/:id/recalculate')
  recalc(@Param('id') id: string, @Body(new ZodPipe(recalcBody)) body: { itemIds?: string[] }) {
    return this.payroll.recalculate(id, body.itemIds);
  }

  @Post('runs/:id/finalize')
  finalize(@Param('id') id: string) {
    return this.payroll.finalize(id);
  }

  @Post('runs/:id/cancel')
  cancel(@Param('id') id: string, @Body(new ZodPipe(payrollCancelSchema)) body: { reason: string }) {
    return this.payroll.cancel(id, body.reason);
  }

  @Post('runs/:id/mark-paid')
  markPaid(@Param('id') id: string) {
    return this.payroll.markPaid(id);
  }

  @Post('runs/:id/exclude-pending')
  excludePending(@Param('id') id: string) {
    return this.payroll.excludePending(id);
  }

  @Post('runs/:id/bank-file')
  bankFile(@Param('id') id: string) {
    return this.payroll.generateBankFile(id);
  }

  @Get('runs/:id/bank-file')
  async bankFileDownload(@Param('id') id: string, @Res() res: Response) {
    const f = await this.payroll.bankFileDownload(id);
    sendFile(res, f.data, f.filename, 'text/csv; charset=utf-8');
  }

  @Post('runs/:id/items/:itemId/hold')
  hold(@Param('id') id: string, @Param('itemId') itemId: string, @Body(new ZodPipe(payrollHoldSchema)) body: { reason: string }) {
    return this.payroll.hold(id, itemId, body.reason);
  }

  @Post('runs/:id/items/:itemId/release')
  release(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.payroll.release(id, itemId);
  }

  @Get('items/:itemId')
  item(@Param('itemId') itemId: string) {
    return this.payroll.itemDetail(itemId);
  }

  @Post('remind-rms')
  remind(@Body(new ZodPipe(periodBody)) body: { period: string }) {
    return this.payroll.remindRms(body.period);
  }

  @Get('adjustments')
  adjustments(@Query(new ZodPipe(adjQuery)) q: { period?: string }) {
    return this.payroll.adjustments(q.period);
  }

  @Post('adjustments')
  addAdjustment(@Body(new ZodPipe(adjustmentSchema)) body: AdjustmentInput) {
    return this.payroll.addAdjustment(body);
  }

  @Delete('adjustments/:id')
  cancelAdjustment(@Param('id') id: string) {
    return this.payroll.cancelAdjustment(id);
  }
}

@Controller('payslips')
export class PayslipsController {
  constructor(private readonly payslips: PayslipService) {}

  @Get('me')
  @RequirePerm('payslips.self')
  mine(@Query(new ZodPipe(payslipListQuery)) q: { fy?: string }) {
    return this.payslips.myPayslips(q.fy);
  }

  @Get('employee/:id')
  @RequirePerm('payroll.manage')
  forEmployee(@Param('id') id: string, @Query(new ZodPipe(payslipListQuery)) q: { fy?: string }) {
    return this.payslips.forEmployee(id, q.fy, false);
  }

  @Get(':id')
  @RequirePerm('payslips.self', 'payroll.manage')
  detail(@Param('id') id: string) {
    return this.payslips.detail(id);
  }

  @Get(':id/pdf')
  @RequirePerm('payslips.self', 'payroll.manage')
  async pdf(@Param('id') id: string, @Res() res: Response, @Query('inline') inline?: string) {
    const f = await this.payslips.pdfFor(id);
    sendFile(res, f.data, f.filename, 'application/pdf', inline === '1');
  }
}

@Controller('salary')
export class SalaryController {
  constructor(private readonly salary: SalaryService) {}

  @Get('employee/:id')
  @RequirePerm('payslips.self', 'employees.compensation', 'payroll.manage')
  view(@Param('id') id: string) {
    return this.salary.view(id);
  }

  @Get('employees')
  @RequirePerm('payroll.manage')
  list() {
    return this.salary.list();
  }

  @Post('preview')
  @RequirePerm('payroll.manage')
  preview(@Body(new ZodPipe(salaryPreviewSchema)) body: SalaryPreviewInput) {
    return this.salary.preview(body);
  }

  @Post('employee/:id/revisions')
  @RequirePerm('payroll.manage')
  revise(@Param('id') id: string, @Body(new ZodPipe(salaryRevisionSchema)) body: SalaryRevisionInput) {
    return this.salary.revise(id, body);
  }

  @Patch('employee/:id/profile')
  @RequirePerm('payroll.manage')
  profile(@Param('id') id: string, @Body(new ZodPipe(payrollProfileSchema)) body: PayrollProfileInput) {
    return this.salary.updateProfile(id, body);
  }
}
