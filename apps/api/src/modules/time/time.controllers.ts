import { Body, Controller, Delete, Get, Header, Headers, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  addLineSchema,
  allocateShiftSchema,
  approvalsQuery,
  approveStepSchema,
  assignLocationSchema,
  biometricDeviceSchema,
  biometricSimulateSchema,
  cellEditSchema,
  dayOverrideSchema,
  decisionCommentSchema,
  enrollmentSchema,
  holidayCopySchema,
  holidayImportSchema,
  holidaySchema,
  idCheckPatchSchema,
  idCheckSchema,
  locationSchema,
  outsideHoursSchema,
  periodLockSchema,
  periodUnlockSchema,
  policyPatchSchema,
  punchSchema,
  recomputeSchema,
  regularizationSchema,
  rejectCommentSchema,
  returnStepSchema,
  shiftSchema,
  submitTimesheetSchema,
  type AddLineInput,
  type AllocateShiftInput,
  type ApproveStepInput,
  type BiometricDeviceInput,
  type BiometricSimulateInput,
  type CellEditInput,
  type DayOverrideInput,
  type HolidayInput,
  type IdCheckInput,
  type LocationInput,
  type OutsideHoursInput,
  type PolicyPatch,
  type PunchInput,
  type PunchResult,
  type RegularizationInput,
  type ShiftInput,
} from '@lexisora/shared';
import { Ctx, Public, RequirePerm } from '../../core/auth/decorators';
import type { RequestContext } from '../../core/context/request-context';
import { AppError, badRequest } from '../../core/http/errors';
import { ZodPipe } from '../../core/http/zod.pipe';
import { OrgService } from '../../core/org/org.service';
import { defaultLockUpTo, lockRangeError } from './lib/compliance';
import { istHm, istKeyOf, monthOf, monthRange } from './lib/time-utils';
import { ApprovalService } from './services/approval.service';
import { AttendanceService } from './services/attendance.service';
import { BiometricService } from './services/biometric.service';
import { IdCheckService } from './services/idcheck.service';
import { MastersService } from './services/masters.service';
import { PeriodLockService } from './services/period-lock.service';
import { PolicyService } from './services/policy.service';
import { RegularizationService } from './services/regularization.service';
import { TimesheetService } from './services/timesheet.service';

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthKey = z.string().regex(/^\d{4}-\d{2}$/);
const optDate = (v?: string) => (v && dateKey.safeParse(v).success ? v : undefined);
const optMonth = (v?: string) => (v && monthKey.safeParse(v).success ? v : monthOf(istKeyOf(new Date())));

// ── Attendance ─────────────────────────────────────────────────────────────
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly idchecks: IdCheckService,
    private readonly org: OrgService,
  ) {}

  @Get('me/today')
  @RequirePerm('attendance.self')
  today() {
    return this.attendance.today(this.org.myEmployeeId());
  }

  @Post('me/punch')
  @RequirePerm('attendance.self')
  async punch(@Body(new ZodPipe(punchSchema)) body: PunchInput, @Req() req: Request, @Headers('idempotency-key') idem?: string): Promise<PunchResult> {
    const employeeId = this.org.myEmployeeId();
    const now = await this.attendance.today(employeeId);
    const direction = body.direction ?? (now.state === 'IN' ? 'OUT' : 'IN');
    const res = await this.attendance.punch({
      employeeId,
      direction,
      source: 'WEB',
      geo: body.lat != null && body.lng != null ? { lat: body.lat, lng: body.lng, accuracyM: body.accuracyM } : undefined,
      clientEventId: idem ? idem.slice(0, 80) : null,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    const at = res.direction === 'IN' ? res.session.startedAt : (res.session.endedAt ?? new Date());
    const today = await this.attendance.today(employeeId);
    return {
      ok: true,
      direction: res.direction,
      at: at.toISOString(),
      source: 'WEB',
      message: res.direction === 'IN' ? `Punched in at ${istHm(at)} · web` : 'Punched out · day summary saved',
      today,
    };
  }

  @Get('me/month')
  @RequirePerm('attendance.self')
  myMonth(@Query('month') month?: string) {
    return this.attendance.month(this.org.myEmployeeId(), optMonth(month));
  }

  @Get('me/timeline')
  @RequirePerm('attendance.self')
  myTimeline(@Query('date') date?: string) {
    return this.attendance.timeline(this.org.myEmployeeId(), optDate(date) ?? istKeyOf(new Date()));
  }

  @Get('me/id-check')
  @RequirePerm('attendance.self')
  myIdCheck() {
    return this.idchecks.mine(this.org.myEmployeeId());
  }

  /** Effective punch/tracker rules for the signed-in employee (web + tracker refetch on policy.updated). */
  @Get('me/effective-policy')
  myEffective() {
    return this.attendance.effective(this.org.myEmployeeId());
  }

  @Get('team')
  @RequirePerm('attendance.team', 'attendance.manage')
  team(@Ctx() ctx: RequestContext, @Query('date') date?: string) {
    return this.attendance.teamToday(ctx, optDate(date));
  }

  @Get('employees/:id/month')
  @RequirePerm('attendance.self', 'attendance.team', 'attendance.manage')
  async empMonth(@Ctx() ctx: RequestContext, @Param('id') id: string, @Query('month') month?: string) {
    await this.attendance.assertCanView(ctx, id);
    return this.attendance.month(id, optMonth(month));
  }

  @Get('employees/:id/timeline')
  @RequirePerm('attendance.self', 'attendance.team', 'attendance.manage')
  async empTimeline(@Ctx() ctx: RequestContext, @Param('id') id: string, @Query('date') date?: string) {
    await this.attendance.assertCanView(ctx, id);
    return this.attendance.timeline(id, optDate(date) ?? istKeyOf(new Date()));
  }

  /** Profile → Attendance tab (Month | Present | Leave | Idle | Late). */
  @Get('employees/:id/summary')
  async empSummary(@Ctx() ctx: RequestContext, @Param('id') id: string, @Query('months') months?: string) {
    await this.attendance.assertCanView(ctx, id);
    return this.attendance.profileSummary(id, Math.min(24, Math.max(1, Number(months) || 12)));
  }

  @Patch('days/:id')
  @RequirePerm('attendance.manage')
  override(@Param('id') id: string, @Body(new ZodPipe(dayOverrideSchema)) body: DayOverrideInput) {
    return this.attendance.overrideDay(id, body);
  }

  @Post('recompute')
  @RequirePerm('attendance.manage')
  async recompute(@Body(new ZodPipe(recomputeSchema)) body: { employeeIds?: string[]; from: string; to: string }) {
    if (body.to < body.from) throw badRequest('To must be on or after From');
    const n = await this.attendance.recomputeRange(body.employeeIds?.length ? body.employeeIds : null, body.from, body.to);
    return { ok: true, count: n };
  }

  @Get('payroll-input')
  @RequirePerm('attendance.manage', 'payroll.manage')
  payrollInput(@Query('month') month?: string) {
    return this.attendance.payrollInput(optMonth(month));
  }
}

// ── Biometric admin ────────────────────────────────────────────────────────
@Controller('attendance/biometric')
@RequirePerm('attendance.manage')
export class BiometricController {
  constructor(private readonly bio: BiometricService) {}

  @Get('devices')
  devices() {
    return this.bio.devices();
  }

  @Post('devices')
  create(@Body(new ZodPipe(biometricDeviceSchema)) body: BiometricDeviceInput) {
    return this.bio.createDevice(body);
  }

  @Patch('devices/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(biometricDeviceSchema.partial())) body: Partial<BiometricDeviceInput>) {
    return this.bio.updateDevice(id, body);
  }

  @Delete('devices/:id')
  remove(@Param('id') id: string) {
    return this.bio.deleteDevice(id);
  }

  @Get('unclaimed')
  unclaimed() {
    return this.bio.unclaimed();
  }

  @Get('enrollments')
  enrollments() {
    return this.bio.enrollments();
  }

  @Put('enrollments')
  enroll(@Body(new ZodPipe(enrollmentSchema)) body: { employeeId: string; pin: string }) {
    return this.bio.setEnrollment(body.employeeId, body.pin);
  }

  @Get('logs')
  logs(@Query('deviceId') deviceId?: string) {
    return this.bio.logs(deviceId || undefined);
  }

  @Post('logs/reprocess')
  reprocess(@Body(new ZodPipe(z.object({ deviceId: z.string().optional().nullable() }))) body: { deviceId?: string | null }) {
    return this.bio.reprocess(body.deviceId || undefined);
  }

  @Post('simulate')
  simulate(@Body(new ZodPipe(biometricSimulateSchema)) body: BiometricSimulateInput) {
    return this.bio.simulate(body);
  }
}

/** ZKTeco ADMS push protocol. Public: devices authenticate by registered serial number. */
@Controller('attendance/biometric/iclock')
@Public()
export class IclockController {
  constructor(private readonly bio: BiometricService) {}

  @Get('cdata')
  @Header('Content-Type', 'text/plain')
  async handshake(@Query('SN') sn: string, @Query('probe') probe: string | undefined, @Req() req: Request) {
    // `probe=1` (HR "Check endpoint"): answer like a real handshake without touching device health.
    const d = await this.bio.deviceBySn(sn, req.ip, probe !== '1');
    if (!d) return 'OK';
    return this.bio.handshake(d);
  }

  @Post('cdata')
  @Header('Content-Type', 'text/plain')
  async cdata(@Query('SN') sn: string, @Query('table') table: string, @Query('Stamp') stamp: string | undefined, @Req() req: Request) {
    const d = await this.bio.deviceBySn(sn, req.ip);
    const body = await readRawBody(req);
    if (!d) return 'OK';
    if ((table ?? '').toUpperCase() !== 'ATTLOG') return 'OK';
    const res = await this.bio.ingest(d, body, stamp ?? null);
    return `OK: ${res.received}`;
  }

  @Get('getrequest')
  @Header('Content-Type', 'text/plain')
  async getrequest(@Query('SN') sn: string, @Req() req: Request) {
    await this.bio.deviceBySn(sn, req.ip);
    return 'OK';
  }

  @Post('devicecmd')
  @Header('Content-Type', 'text/plain')
  devicecmd() {
    return 'OK';
  }
}

async function readRawBody(req: Request): Promise<string> {
  const b: unknown = (req as any).body;
  if (typeof b === 'string') return b;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  if (b && typeof b === 'object' && Object.keys(b).length) {
    // urlencoded parser swallowed the body: rebuild "key=value" pairs as lines
    return Object.entries(b as Record<string, unknown>).map(([k, v]) => (v ? `${k}=${v}` : k)).join('\n');
  }
  if (!req.readable) return '';
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

// ── Shifts ─────────────────────────────────────────────────────────────────
@Controller('shifts')
@RequirePerm('shifts.manage')
export class ShiftsController {
  constructor(private readonly masters: MastersService) {}

  @Get()
  list() {
    return this.masters.listShifts();
  }

  @Post()
  create(@Body(new ZodPipe(shiftSchema)) body: ShiftInput) {
    return this.masters.createShift(body);
  }

  @Get('allocations')
  allocations(@Query('shiftId') shiftId?: string, @Query('departmentId') departmentId?: string) {
    return this.masters.listAllocations({ shiftId: shiftId || undefined, departmentId: departmentId || undefined });
  }

  @Post('allocate')
  allocate(@Body(new ZodPipe(allocateShiftSchema)) body: AllocateShiftInput) {
    return this.masters.allocate(body);
  }

  @Delete('allocations/:id')
  deleteAllocation(@Param('id') id: string) {
    return this.masters.deleteAllocation(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(shiftSchema.partial())) body: Partial<ShiftInput>) {
    return this.masters.updateShift(id, body);
  }

  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.masters.archiveShift(id);
  }
}

// ── Locations ──────────────────────────────────────────────────────────────
@Controller('locations')
@RequirePerm('locations.manage')
export class LocationsController {
  constructor(private readonly masters: MastersService) {}

  @Get()
  list() {
    return this.masters.listLocations();
  }

  @Post()
  create(@Body(new ZodPipe(locationSchema)) body: LocationInput) {
    return this.masters.createLocation(body);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.masters.locationDetail(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(locationSchema.partial())) body: Partial<LocationInput>) {
    return this.masters.updateLocation(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.masters.deleteLocation(id);
  }

  @Post(':id/employees')
  assign(@Param('id') id: string, @Body(new ZodPipe(assignLocationSchema)) body: { employeeIds: string[] }) {
    return this.masters.assignLocation(id, body.employeeIds);
  }
}

// ── Attendance policy ──────────────────────────────────────────────────────
@Controller('attendance-policy')
export class PolicyController {
  constructor(
    private readonly policies: PolicyService,
    private readonly attendance: AttendanceService,
    private readonly org: OrgService,
  ) {}

  @Get()
  @RequirePerm('settings.attendance')
  both() {
    return this.policies.both();
  }

  @Get('me')
  me() {
    return this.attendance.effective(this.org.myEmployeeId());
  }

  @Patch(':audience')
  @RequirePerm('settings.attendance')
  update(@Param('audience') audience: string, @Body(new ZodPipe(policyPatchSchema)) body: PolicyPatch) {
    const a = audience.toUpperCase();
    if (a !== 'OFFICE' && a !== 'REMOTE') throw badRequest('Audience must be OFFICE or REMOTE');
    return this.policies.update(a, body);
  }
}

// ── Holidays ───────────────────────────────────────────────────────────────
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly masters: MastersService) {}

  /** Readable by every signed-in user (leave calendar, dashboard). */
  @Get()
  list(@Query('year') year?: string) {
    const y = Number(year) || Number(istKeyOf(new Date()).slice(0, 4));
    return this.masters.listHolidays(y);
  }

  @Get('upcoming')
  upcoming(@Query('from') from?: string, @Query('limit') limit?: string) {
    return this.masters.upcoming(optDate(from), Math.min(20, Math.max(1, Number(limit) || 8)));
  }

  @Post()
  @RequirePerm('holidays.manage')
  create(@Body(new ZodPipe(holidaySchema)) body: HolidayInput) {
    return this.masters.createHoliday(body);
  }

  @Post('import')
  @RequirePerm('holidays.manage')
  import(@Body(new ZodPipe(holidayImportSchema)) body: { year: number; calendar: 'National' | 'Gujarat' | 'Maharashtra' }) {
    return this.masters.importHolidays(body.year, body.calendar);
  }

  @Post('copy')
  @RequirePerm('holidays.manage')
  copy(@Body(new ZodPipe(holidayCopySchema)) body: { fromYear: number; toYear: number }) {
    return this.masters.copyHolidays(body.fromYear, body.toYear);
  }

  @Patch(':id')
  @RequirePerm('holidays.manage')
  update(@Param('id') id: string, @Body(new ZodPipe(holidaySchema.partial())) body: Partial<HolidayInput>) {
    return this.masters.updateHoliday(id, body);
  }

  @Delete(':id')
  @RequirePerm('holidays.manage')
  remove(@Param('id') id: string) {
    return this.masters.deleteHoliday(id);
  }
}

// ── ID card compliance ─────────────────────────────────────────────────────
@Controller('id-compliance')
@RequirePerm('idcompliance.manage')
export class IdComplianceController {
  constructor(private readonly ids: IdCheckService) {}

  @Get('summary')
  summary(@Query('date') date?: string) {
    return this.ids.summary(optDate(date));
  }

  @Get('checks')
  checks(@Query('date') date?: string, @Query('wearing') wearing?: string, @Query('department') department?: string) {
    return this.ids.list({ date: optDate(date), wearing, department: department || undefined });
  }

  @Get('pending')
  pending(@Query('date') date?: string) {
    return this.ids.pending(optDate(date));
  }

  @Post('checks')
  log(@Body(new ZodPipe(idCheckSchema)) body: IdCheckInput) {
    return this.ids.log(body);
  }

  @Patch('checks/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(idCheckPatchSchema)) body: { wearing: boolean; note?: string | null }) {
    return this.ids.update(id, body.wearing, body.note);
  }

  @Post('remind')
  remind(@Body(new ZodPipe(z.object({ date: dateKey.optional() }))) body: { date?: string }) {
    return this.ids.remindMissing(body.date && body.date <= istKeyOf(new Date()) ? body.date : undefined);
  }
}

// ── Regularizations ────────────────────────────────────────────────────────
@Controller('regularizations')
export class RegularizationsController {
  constructor(private readonly regs: RegularizationService) {}

  @Post()
  @RequirePerm('attendance.self')
  create(@Body(new ZodPipe(regularizationSchema)) body: RegularizationInput) {
    return this.regs.create(body);
  }

  @Get('mine')
  @RequirePerm('attendance.self')
  mine(@Query('month') month?: string) {
    return this.regs.mine(month && monthKey.safeParse(month).success ? month : undefined);
  }

  @Post(':id/cancel')
  @RequirePerm('attendance.self')
  cancel(@Param('id') id: string) {
    return this.regs.cancel(id);
  }

  @Get()
  @RequirePerm('attendance.regularize.approve', 'attendance.manage')
  list(@Query('status') status = 'PENDING') {
    return this.regs.list(status.toUpperCase());
  }

  @Post(':id/approve')
  @RequirePerm('attendance.regularize.approve', 'attendance.manage')
  approve(@Param('id') id: string, @Body(new ZodPipe(decisionCommentSchema)) body: { comment?: string | null }) {
    return this.regs.approve(id, body.comment);
  }

  @Post(':id/reject')
  @RequirePerm('attendance.regularize.approve', 'attendance.manage')
  reject(@Param('id') id: string, @Body(new ZodPipe(rejectCommentSchema)) body: { comment: string }) {
    return this.regs.reject(id, body.comment);
  }
}

// ── Period locks ───────────────────────────────────────────────────────────
@Controller('period-locks')
@RequirePerm('attendance.lock')
export class PeriodLocksController {
  constructor(private readonly locks: PeriodLockService) {}

  @Get()
  list() {
    return this.locks.list();
  }

  @Get('readiness')
  readiness(@Query('month') month?: string) {
    const m = month && monthKey.safeParse(month).success ? month : monthOf(istKeyOf(new Date()));
    return this.locks.readiness(m);
  }

  @Post()
  lock(@Body(new ZodPipe(periodLockSchema)) body: { month: string; upTo?: string }) {
    const today = istKeyOf(new Date());
    const err = lockRangeError(body.month, body.upTo, today);
    if (err) throw new AppError(422, 'LOCK_RANGE', err);
    return this.locks.lock(body.month, body.upTo ?? defaultLockUpTo(body.month, monthRange(body.month).to, today));
  }

  @Post(':month/unlock')
  unlock(@Param('month') month: string, @Body(new ZodPipe(periodUnlockSchema)) body: { reason: string }) {
    return this.locks.unlock(month, body.reason);
  }
}

// ── Timesheets ─────────────────────────────────────────────────────────────
@Controller('timesheets')
export class TimesheetsController {
  constructor(private readonly sheets: TimesheetService) {}

  @Get('me/week')
  @RequirePerm('timesheet.self')
  myWeek(@Query('weekStart') weekStart?: string) {
    return this.sheets.myWeek(optDate(weekStart));
  }

  @Get('me')
  @RequirePerm('timesheet.self')
  mine() {
    return this.sheets.list({ mine: true });
  }

  @Get('options')
  @RequirePerm('timesheet.self')
  options() {
    return this.sheets.options();
  }

  @Get()
  @RequirePerm('attendance.manage', 'payroll.manage', 'attendance.team', 'timesheet.approve.l2')
  list(@Query('status') status?: string, @Query('weekStart') weekStart?: string, @Query('employeeId') employeeId?: string) {
    return this.sheets.list({ status: status?.toUpperCase(), weekStart: optDate(weekStart), employeeId: employeeId || undefined });
  }

  @Get('employee/:employeeId/week')
  @RequirePerm('attendance.manage', 'payroll.manage', 'attendance.team', 'timesheet.approve.l1', 'timesheet.approve.l2')
  employeeWeek(@Ctx() ctx: RequestContext, @Param('employeeId') employeeId: string, @Query('weekStart') weekStart?: string) {
    return this.sheets.weekFor(ctx, employeeId, optDate(weekStart) ?? istKeyOf(new Date()));
  }

  @Put(':id/cells')
  @RequirePerm('timesheet.self')
  editCell(@Param('id') id: string, @Body(new ZodPipe(cellEditSchema)) body: CellEditInput) {
    return this.sheets.editCell(id, body);
  }

  @Post(':id/lines')
  @RequirePerm('timesheet.self')
  addLine(@Param('id') id: string, @Body(new ZodPipe(addLineSchema)) body: AddLineInput) {
    return this.sheets.addLine(id, body);
  }

  @Delete(':id/lines/:lineId')
  @RequirePerm('timesheet.self')
  removeLine(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.sheets.removeLine(id, lineId);
  }

  @Post(':id/outside-hours')
  @RequirePerm('timesheet.self')
  outsideHours(@Param('id') id: string, @Body(new ZodPipe(outsideHoursSchema)) body: OutsideHoursInput) {
    return this.sheets.logOutsideHours(id, body);
  }

  @Delete('outside-hours/:entryId')
  @RequirePerm('timesheet.self')
  deleteOutsideHours(@Param('entryId') entryId: string) {
    return this.sheets.deleteOutsideHours(entryId);
  }

  @Post(':id/submit')
  @RequirePerm('timesheet.self')
  submit(@Param('id') id: string, @Body(new ZodPipe(submitTimesheetSchema)) body: { expectedVersion?: number; confirmEmpty?: boolean }) {
    return this.sheets.submit(id, body);
  }

  @Post(':id/recall')
  @RequirePerm('timesheet.self')
  recall(@Param('id') id: string) {
    return this.sheets.recall(id);
  }

  @Post(':id/reopen')
  @RequirePerm('timesheet.approve.l2')
  reopen(@Param('id') id: string, @Body(new ZodPipe(periodUnlockSchema)) body: { reason: string }) {
    return this.sheets.reopen(id, body.reason);
  }
}

// ── Timesheet approvals ────────────────────────────────────────────────────
@Controller('timesheet-approvals')
@RequirePerm('timesheet.approve.l1', 'timesheet.approve.l2')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalService) {}

  @Get()
  list(@Query(new ZodPipe(approvalsQuery)) q: { level: number; status: string }) {
    return this.approvals.list(q.level, q.status);
  }

  @Get(':stepId')
  detail(@Param('stepId') stepId: string, @Query('page') page?: string, @Query('date') date?: string, @Query('taskKey') taskKey?: string) {
    return this.approvals.detail(stepId, { page: Number(page) || 1, date: optDate(date), taskKey: taskKey || undefined });
  }

  @Post(':stepId/approve')
  approve(@Param('stepId') stepId: string, @Body(new ZodPipe(approveStepSchema)) body: ApproveStepInput) {
    return this.approvals.approve(stepId, body);
  }

  @Post(':stepId/return')
  sendBack(@Param('stepId') stepId: string, @Body(new ZodPipe(returnStepSchema)) body: { comment: string }) {
    return this.approvals.returnStep(stepId, body.comment);
  }
}

export const TIME_CONTROLLERS = [
  AttendanceController,
  BiometricController,
  IclockController,
  ShiftsController,
  LocationsController,
  PolicyController,
  HolidaysController,
  IdComplianceController,
  RegularizationsController,
  PeriodLocksController,
  TimesheetsController,
  ApprovalsController,
];
