import { Module } from '@nestjs/common';
import { TimeModule } from '../time/time.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { IngestService } from './ingest.service';
import { ReviewService } from './review.service';
import { TimePort } from './time-port';
import { TrackerContextService } from './tracker-context.service';
import { TrackerDeviceController, TrackerReviewController } from './tracker.controller';
import { DeviceOnlyGuard, UserSessionGuard } from './tracker.guards';
import { TrackerJobs } from './tracker.jobs';

/**
 * Tracker domain — desktop tracker sign-in/pairing, ingest (events, segments, screenshots),
 * device management, idle-claim review and day summaries. See docs/specs/spec-tracker.md.
 * Imports TimeModule for AttendanceService.punch (desktop punches, ARCHITECTURE §5).
 */
@Module({
  imports: [TimeModule],
  controllers: [TrackerDeviceController, TrackerReviewController, DevicesController],
  providers: [TrackerContextService, DevicesService, IngestService, ReviewService, TimePort, TrackerJobs, DeviceOnlyGuard, UserSessionGuard],
  exports: [IngestService, ReviewService, DevicesService],
})
export class TrackerModule {}
