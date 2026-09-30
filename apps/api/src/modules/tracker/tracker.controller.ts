import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  daySummariesQuery,
  idleClaimDecideSchema,
  idleClaimsQuery,
  pairStartSchema,
  screenshotsQuery,
  trackerBatchSchema,
  trackerHeartbeatSchema,
  trackerLoginSchema,
  trackerPunchSchema,
  type DaySummariesQuery,
  type IdleClaimDecideInput,
  type IdleClaimsQuery,
  type PairStartInput,
  type ScreenshotsQuery,
  type TrackerBatch,
  type TrackerHeartbeatInput,
  type TrackerLoginInput,
  type TrackerPunchInput,
} from '@lexisora/shared';
import { Public, RequirePerm } from '../../core/auth/decorators';
import { requireContext } from '../../core/context/request-context';
import { ZodPipe } from '../../core/http/zod.pipe';
import { DevicesService } from './devices.service';
import { IngestService } from './ingest.service';
import { ReviewService } from './review.service';
import { TrackerContextService } from './tracker-context.service';
import { deviceIdOf, DeviceOnlyGuard, pairingTokenOf, UserSessionGuard } from './tracker.guards';

const integrityQuery = z.object({
  employeeId: z.string().min(1),
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const ackSchema = z.object({ comment: z.string().trim().max(500).optional() });

/**
 * Desktop tracker API (apps/tracker). Contract: packages/shared/src/tracker.ts.
 *   - sign-in + pairing: public routes authenticated with the opaque pairing-session token
 *   - data plane: device token only (DeviceOnlyGuard)
 */
@Controller('tracker')
export class TrackerDeviceController {
  constructor(
    private readonly devices: DevicesService,
    private readonly ingest: IngestService,
    private readonly tctx: TrackerContextService,
  ) {}

  // ── sign-in & pairing ─────────────────────────────────────────────────
  @Public()
  @Post('auth/login')
  @HttpCode(200)
  login(@Body(new ZodPipe(trackerLoginSchema)) dto: TrackerLoginInput, @Req() req: Request) {
    return this.devices.login(dto, req.ip);
  }

  @Public()
  @Post('pair/start')
  @HttpCode(200)
  pairStart(@Body(new ZodPipe(pairStartSchema)) dto: PairStartInput, @Req() req: Request) {
    return this.devices.pairStart(pairingTokenOf(req), dto);
  }

  @Public()
  @Get('pair/status')
  pairStatus(@Req() req: Request) {
    return this.devices.pairStatus(pairingTokenOf(req));
  }

  @Public()
  @Post('pair/cancel')
  @HttpCode(200)
  pairCancel(@Req() req: Request) {
    return this.devices.pairCancel(pairingTokenOf(req));
  }

  // ── device data plane ─────────────────────────────────────────────────
  @UseGuards(DeviceOnlyGuard)
  @Get('policy')
  async policy(@Req() req: Request) {
    const ctx = requireContext();
    void this.devices.touch(deviceIdOf(req)!);
    return this.tctx.policyFor(ctx.employeeId!);
  }

  @UseGuards(DeviceOnlyGuard)
  @Get('tasks')
  tasks() {
    return this.ingest.tasks(requireContext().employeeId!);
  }

  @UseGuards(DeviceOnlyGuard)
  @Get('today')
  today(@Req() req: Request) {
    void this.devices.touch(deviceIdOf(req)!);
    return this.ingest.today(requireContext().employeeId!);
  }

  @UseGuards(DeviceOnlyGuard)
  @Post('punch')
  @HttpCode(200)
  punch(@Body(new ZodPipe(trackerPunchSchema)) dto: TrackerPunchInput, @Req() req: Request) {
    return this.ingest.punch(deviceIdOf(req)!, requireContext().employeeId!, dto);
  }

  @UseGuards(DeviceOnlyGuard)
  @Post('sync')
  @HttpCode(200)
  sync(@Body(new ZodPipe(trackerBatchSchema)) dto: TrackerBatch, @Req() req: Request) {
    return this.ingest.sync(deviceIdOf(req)!, requireContext().employeeId!, dto);
  }

  @UseGuards(DeviceOnlyGuard)
  @Post('screenshots')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  screenshot(@UploadedFile() file: Express.Multer.File | undefined, @Body('meta') meta: unknown, @Req() req: Request) {
    const ctx = requireContext();
    return this.ingest.uploadScreenshot(deviceIdOf(req)!, ctx.employeeId!, ctx.userId!, file, meta);
  }

  @UseGuards(DeviceOnlyGuard)
  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@Body(new ZodPipe(trackerHeartbeatSchema)) dto: TrackerHeartbeatInput, @Req() req: Request) {
    return this.devices.heartbeat(deviceIdOf(req)!, requireContext().employeeId!, dto);
  }

  @UseGuards(DeviceOnlyGuard)
  @Post('days/:date/confirm')
  @HttpCode(200)
  confirm(@Param('date') date: string) {
    return this.ingest.confirmDay(requireContext().employeeId!, date);
  }

  @UseGuards(DeviceOnlyGuard)
  @Post('unpair')
  @HttpCode(200)
  unpair(@Req() req: Request) {
    return this.devices.unpairCurrent(deviceIdOf(req)!);
  }
}

/**
 * Reviewer-facing tracker reads used by the web app (time's approvals + attendance screens):
 * idle claims, screenshots, day summaries and integrity flags. Relationship scope is applied
 * in ReviewService (self / reporting tree / project lead / admin; HR is not granted screenshots).
 */
@UseGuards(UserSessionGuard)
@Controller('tracker')
export class TrackerReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get('idle-claims')
  claims(@Query(new ZodPipe(idleClaimsQuery)) q: IdleClaimsQuery) {
    return this.review.listClaims(q);
  }

  @Post('idle-claims/:id/decide')
  @HttpCode(200)
  decide(@Param('id') id: string, @Body(new ZodPipe(idleClaimDecideSchema)) dto: IdleClaimDecideInput) {
    return this.review.decideClaim(id, dto);
  }

  @Get('screenshots')
  screenshots(@Query(new ZodPipe(screenshotsQuery)) q: ScreenshotsQuery) {
    return this.review.listScreenshots(q);
  }

  @Get('day-summaries')
  summaries(@Query(new ZodPipe(daySummariesQuery)) q: DaySummariesQuery) {
    return this.review.daySummaries(q);
  }

  @Get('integrity')
  integrity(@Query(new ZodPipe(integrityQuery)) q: z.infer<typeof integrityQuery>) {
    return this.review.integrity(q.employeeId, q.week);
  }

  @RequirePerm('timesheet.approve.l1', 'timesheet.approve.l2', 'attendance.manage', 'attendance.team')
  @Post('integrity/:id/ack')
  @HttpCode(200)
  acknowledge(@Param('id') id: string, @Body(new ZodPipe(ackSchema)) dto: z.infer<typeof ackSchema>) {
    return this.review.acknowledge(id, dto.comment);
  }
}
