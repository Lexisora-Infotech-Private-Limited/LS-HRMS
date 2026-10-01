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
import { WorkplaceRegistry } from './workplace.registry';

/**
 * Workplace domain — dashboard (greeting, thought of the day, to-dos, approvals card,
 * announcements, birthdays & events), notice board, company feed, kudos & Employee of the
 * Month (certificates with public verification), policies & rulebook (holiday list) and
 * helpdesk. Chat, LMS, facility, wellness and CCTV follow in the next workplace release.
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
  ],
  providers: [SpineReader, AudienceService, CertificatesService, DashboardService, NoticesService, FeedService, KudosService, PoliciesService, HelpdeskService, WorkplaceRegistry],
  exports: [AudienceService, NoticesService, HelpdeskService, CertificatesService],
})
export class WorkplaceModule {}
