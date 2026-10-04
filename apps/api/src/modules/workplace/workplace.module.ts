import { Module } from '@nestjs/common';
import { AudienceService } from './common/audience';
import { CertificatesService } from './common/certificates.service';
import { SpineReader } from './common/spine';
import { DashboardController, EventsController, QuotesController, TodosController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { FeedController } from './feed/feed.controller';
import { FeedService } from './feed/feed.service';
import { HelpdeskController } from './helpdesk/helpdesk.controller';
import { HelpdeskService } from './helpdesk/helpdesk.service';
import { CertificatesController, EotmController, KudosController } from './kudos/kudos.controller';
import { KudosService } from './kudos/kudos.service';
import { NoticesController } from './notices/notices.controller';
import { NoticesService } from './notices/notices.service';
import { PoliciesController } from './policies/policies.controller';
import { PoliciesService } from './policies/policies.service';
import { ChatController } from './chat/chat.controller';
import { ChatRealtime } from './chat/chat.realtime';
import { ChatService } from './chat/chat.service';
import { LmsController } from './lms/lms.controller';
import { LmsService } from './lms/lms.service';
import { FacilityController, FacilityPassController } from './facility/facility.controller';
import { FacilityService } from './facility/facility.service';
import { WellnessController } from './wellness/wellness.controller';
import { WellnessService } from './wellness/wellness.service';
import { CctvController } from './cctv/cctv.controller';
import { CctvService } from './cctv/cctv.service';
import { WorkplaceRegistry } from './workplace.registry';
import { WorkplaceHubRegistry } from './workplace-hub.registry';

/**
 * Workplace domain — dashboard (greeting, thought of the day, to-dos, approvals card,
 * announcements, birthdays & events), notice board, company feed, kudos & Employee of the
 * Month (certificates with public verification), policies & rulebook (holiday list), helpdesk,
 * comms hub (channels, DMs, realtime on the core gateway, calls via LiveKit or a local
 * preview), learning (courses, progress, certificates), rooms & visitors (bookings, e-passes,
 * front desk), wellness games (daily puzzles, leaderboard) and CCTV (gateway HLS or stub tiles).
 * Imports nothing from other domains (ARCHITECTURE §5); reads spine models via Prisma.
 */
@Module({
  imports: [],
  controllers: [
    DashboardController,
    QuotesController,
    TodosController,
    EventsController,
    NoticesController,
    FeedController,
    KudosController,
    EotmController,
    CertificatesController,
    PoliciesController,
    HelpdeskController,
    ChatController,
    LmsController,
    FacilityController,
    FacilityPassController,
    WellnessController,
    CctvController,
  ],
  providers: [
    SpineReader,
    AudienceService,
    CertificatesService,
    DashboardService,
    NoticesService,
    FeedService,
    KudosService,
    PoliciesService,
    HelpdeskService,
    ChatService,
    ChatRealtime,
    LmsService,
    FacilityService,
    WellnessService,
    CctvService,
    WorkplaceRegistry,
    WorkplaceHubRegistry,
  ],
  exports: [AudienceService, NoticesService, HelpdeskService, CertificatesService],
})
export class WorkplaceModule {}
