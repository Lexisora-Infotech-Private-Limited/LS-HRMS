import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  compOffRequestSchema,
  creditRuleSchema,
  leaveApplySchema,
  leaveCancelSchema,
  leaveDecisionSchema,
  leaveListQuery,
  leaveOnBehalfSchema,
  leaveRejectSchema,
  leaveSettingsSchema,
  leaveTypePatchSchema,
  leaveTypeSchema,
  manualCreditSchema,
  yearEndSchema,
  type CompOffRequestInput,
  type CreditRuleInput,
  type LeaveApplyInput,
  type LeaveListQuery,
  type LeaveOnBehalfInput,
  type LeaveSettings,
  type LeaveTypeInput,
  type ManualCreditInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { OrgService } from '../../../core/org/org.service';
import { forbidden } from '../../../core/http/errors';
import { requireContext } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { todayKey, yearOf } from '../common/dates';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveAdminService } from './leave-admin.service';

const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
const teamQuery = z.object({ tab: z.enum(['PENDING', 'HISTORY']).default('PENDING') });
const previewQuery = z.object({ employeeId: z.string().optional() });
const runRuleBody = z.object({ periodKey: z.string().regex(/^\d{4}(-\d{2})?$/, 'Use 2026 or 2026-09').optional() });
const compOffDecision = z.object({ comment: z.string().trim().max(500).optional() });

@Controller('leave')
export class LeaveController {
  constructor(
    private readonly requests: LeaveRequestsService,
    private readonly admin: LeaveAdminService,
    private readonly org: OrgService,
  ) {}

  // ── self service ──
  @Get('me/balances')
  @RequirePerm('leave.self')
  myBalances(@Query(new ZodPipe(yearQuery)) q: { year?: number }) {
    return this.requests.balances(this.org.myEmployeeId(), q.year ?? yearOf(todayKey()));
  }

  @Get('me/requests')
  @RequirePerm('leave.self')
  myRequests(@Query(new ZodPipe(leaveListQuery)) q: LeaveListQuery) {
    return this.requests.myRequests(this.org.myEmployeeId(), q);
  }

  @Get('me/upcoming')
  @RequirePerm('leave.self')
  upcoming() {
    return this.requests.upcoming(this.org.myEmployeeId());
  }

  @Get('me/today')
  @RequirePerm('leave.self')
  today() {
    return this.requests.onLeave(this.org.myEmployeeId());
  }

  @Get('me/comp-offs')
  @RequirePerm('leave.self')
  myCompOffs() {
    return this.admin.myCompOffs();
  }

  @Get('employee/:id/balances')
  @RequirePerm('leave.self', 'leave.manage', 'leave.approve')
  async employeeBalances(@Param('id') id: string, @Query(new ZodPipe(yearQuery)) q: { year?: number }) {
    const ctx = requireContext();
    if (id !== ctx.employeeId && !hasPerm(ctx, 'leave.manage')) {
      const tree = ctx.employeeId && hasPerm(ctx, 'leave.approve') ? await this.org.reportTree(ctx.employeeId) : [];
      if (!tree.includes(id)) throw forbidden();
    }
    return this.requests.balances(id, q.year ?? yearOf(todayKey()));
  }

  @Post('requests/preview')
  @RequirePerm('leave.self', 'leave.manage')
  preview(@Body(new ZodPipe(leaveApplySchema)) body: LeaveApplyInput, @Query(new ZodPipe(previewQuery)) q: { employeeId?: string }) {
    return this.requests.preview(body, q.employeeId);
  }

  @Post('requests')
  @RequirePerm('leave.self')
  apply(@Body(new ZodPipe(leaveApplySchema)) body: LeaveApplyInput) {
    return this.requests.apply(body);
  }

  @Post('requests/on-behalf')
  @RequirePerm('leave.manage')
  onBehalf(@Body(new ZodPipe(leaveOnBehalfSchema)) body: LeaveOnBehalfInput) {
    return this.requests.applyOnBehalf(body);
  }

  @Get('requests/:id')
  @RequirePerm('leave.self', 'leave.approve', 'leave.manage')
  detail(@Param('id') id: string) {
    return this.requests.detail(id);
  }

  @Post('requests/:id/withdraw')
  @RequirePerm('leave.self')
  withdraw(@Param('id') id: string) {
    return this.requests.withdraw(id);
  }

  @Post('requests/:id/cancel')
  @RequirePerm('leave.self', 'leave.manage')
  cancel(@Param('id') id: string, @Body(new ZodPipe(leaveCancelSchema)) body: { reason?: string }) {
    return this.requests.cancel(id, body.reason);
  }

  @Post('requests/:id/approve')
  @RequirePerm('leave.approve', 'leave.manage')
  approve(@Param('id') id: string, @Body(new ZodPipe(leaveDecisionSchema)) body: { comment?: string }) {
    return this.requests.approve(id, body.comment);
  }

  @Post('requests/:id/reject')
  @RequirePerm('leave.approve', 'leave.manage')
  reject(@Param('id') id: string, @Body(new ZodPipe(leaveRejectSchema)) body: { comment: string }) {
    return this.requests.reject(id, body.comment);
  }

  @Post('requests/:id/cancellation/approve')
  @RequirePerm('leave.approve', 'leave.manage')
  approveCancellation(@Param('id') id: string) {
    return this.requests.decideCancellation(id, true);
  }

  @Post('requests/:id/cancellation/reject')
  @RequirePerm('leave.approve', 'leave.manage')
  rejectCancellation(@Param('id') id: string) {
    return this.requests.decideCancellation(id, false);
  }

  // ── team / admin ──
  @Get('team/requests')
  @RequirePerm('leave.approve', 'leave.manage')
  team(@Query(new ZodPipe(teamQuery)) q: { tab: 'PENDING' | 'HISTORY' }) {
    return this.requests.teamRequests(q.tab);
  }

  @Get('admin/requests')
  @RequirePerm('leave.manage')
  adminRequests(@Query(new ZodPipe(leaveListQuery)) q: LeaveListQuery) {
    return this.requests.adminRequests(q);
  }

  // ── comp-off ──
  @Post('comp-off/requests')
  @RequirePerm('leave.self')
  requestCompOff(@Body(new ZodPipe(compOffRequestSchema)) body: CompOffRequestInput) {
    return this.admin.requestCompOff(body);
  }

  @Post('comp-off/requests/:id/approve')
  @RequirePerm('leave.approve', 'leave.manage')
  approveCompOff(@Param('id') id: string, @Body(new ZodPipe(compOffDecision)) body: { comment?: string }) {
    return this.admin.decideCompOff(id, true, body.comment);
  }

  @Post('comp-off/requests/:id/reject')
  @RequirePerm('leave.approve', 'leave.manage')
  rejectCompOff(@Param('id') id: string, @Body(new ZodPipe(leaveRejectSchema)) body: { comment: string }) {
    return this.admin.decideCompOff(id, false, body.comment);
  }

  @Post('comp-off/grants/:id/cancel')
  @RequirePerm('leave.manage')
  cancelGrant(@Param('id') id: string) {
    return this.admin.cancelGrant(id);
  }

  // ── setup ──
  @Get('types')
  @RequirePerm('leave.self', 'leave.manage')
  types() {
    return this.admin.types(hasPerm(requireContext(), 'leave.manage'));
  }

  @Post('types')
  @RequirePerm('leave.manage')
  createType(@Body(new ZodPipe(leaveTypeSchema)) body: LeaveTypeInput) {
    return this.admin.createType(body);
  }

  @Patch('types/:id')
  @RequirePerm('leave.manage')
  updateType(@Param('id') id: string, @Body(new ZodPipe(leaveTypePatchSchema)) body: Partial<LeaveTypeInput> & { active?: boolean }) {
    return this.admin.updateType(id, body);
  }

  @Delete('types/:id')
  @RequirePerm('leave.manage')
  deleteType(@Param('id') id: string) {
    return this.admin.deleteType(id);
  }

  @Get('rules')
  @RequirePerm('leave.manage')
  rules() {
    return this.admin.rules();
  }

  @Post('rules')
  @RequirePerm('leave.manage')
  createRule(@Body(new ZodPipe(creditRuleSchema)) body: CreditRuleInput) {
    return this.admin.saveRule(body);
  }

  @Patch('rules/:id')
  @RequirePerm('leave.manage')
  updateRule(@Param('id') id: string, @Body(new ZodPipe(creditRuleSchema)) body: CreditRuleInput) {
    return this.admin.saveRule(body, id);
  }

  @Post('rules/:id/run')
  @RequirePerm('leave.manage')
  runRule(@Param('id') id: string, @Body(new ZodPipe(runRuleBody)) body: { periodKey?: string }) {
    return this.admin.runRule(id, body.periodKey, { manual: true });
  }

  @Get('batches')
  @RequirePerm('leave.manage')
  batches() {
    return this.admin.batches();
  }

  @Get('credits')
  @RequirePerm('leave.manage')
  credits() {
    return this.admin.manualCredits();
  }

  @Post('credits')
  @RequirePerm('leave.manage')
  credit(@Body(new ZodPipe(manualCreditSchema)) body: ManualCreditInput) {
    return this.admin.manualCredit(body);
  }

  @Get('year-end/preview')
  @RequirePerm('leave.manage')
  yearEndPreview(@Query(new ZodPipe(yearEndSchema)) q: { year: number }) {
    return this.admin.yearEndPreview(q.year);
  }

  @Post('year-end')
  @RequirePerm('leave.manage')
  yearEnd(@Body(new ZodPipe(yearEndSchema)) body: { year: number }) {
    return this.admin.runYearEnd(body.year);
  }

  @Get('settings')
  @RequirePerm('leave.manage')
  settings() {
    return this.admin.getSettings();
  }

  @Put('settings')
  @RequirePerm('leave.manage')
  saveSettings(@Body(new ZodPipe(leaveSettingsSchema)) body: LeaveSettings) {
    return this.admin.saveSettings(body);
  }

  @Get('holidays')
  @RequirePerm('leave.self', 'leave.manage')
  holidays(@Query(new ZodPipe(yearQuery)) q: { year?: number }) {
    return this.admin.holidays(q.year ?? yearOf(todayKey()));
  }
}
