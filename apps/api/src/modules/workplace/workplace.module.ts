import { Module } from '@nestjs/common';
import { AudienceService } from './common/audience';
import { CertificatesService } from './common/certificates.service';
import { SpineReader } from './common/spine';
import { DashboardController, EventsController, QuotesController, TodosController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { NoticesController } from './notices/notices.controller';
import { NoticesService } from './notices/notices.service';
import { WorkplaceRegistry } from './workplace.registry';

/**
 * Workplace domain — dashboard (greeting, thought of the day, to-dos, approvals card,
 * announcements, birthdays & events), notice board, company events and quotes.
 * Feed, kudos/EOTM, chat, helpdesk, LMS, facility, policies, wellness and CCTV follow.
 * Imports nothing from other domains (ARCHITECTURE §5); reads spine models via Prisma.
 */
@Module({
  imports: [],
  controllers: [DashboardController, QuotesController, TodosController, EventsController, NoticesController],
  providers: [SpineReader, AudienceService, CertificatesService, DashboardService, NoticesService, WorkplaceRegistry],
  exports: [AudienceService, NoticesService],
})
export class WorkplaceModule {}
