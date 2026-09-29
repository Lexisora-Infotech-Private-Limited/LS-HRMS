import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { TokenService } from './auth/token.service';
import { AuthMiddleware } from './auth/auth.middleware';
import { AuthGuard } from './auth/auth.guard';
import { AllExceptionsFilter } from './http/errors';
import { MailService } from './mail/mail.service';
import { AuditService } from './audit/audit.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { NotificationsService } from './notifications/notifications.service';
import { NotificationsController } from './notifications/notifications.controller';
import { StorageService } from './storage/storage.service';
import { FilesController } from './storage/files.controller';
import { CryptoService } from './crypto/crypto.service';
import { SettingsService } from './settings/settings.service';
import { JobsService } from './jobs/jobs.service';
import { PdfService } from './pdf/pdf.service';
import { OrgService } from './org/org.service';
import { HealthController } from './health.controller';
import { LookupsController, LookupsService } from './lookups/lookups';
import { SequenceService } from './registry/sequence.service';
import { EventsService } from './registry/events.service';
import { ApprovalCountsService, RegistriesController, SearchService } from './registry/registries';

const SHARED = [
  LookupsService,
  SequenceService,
  EventsService,
  ApprovalCountsService,
  SearchService,
  AuthService,
  TokenService,
  MailService,
  AuditService,
  RealtimeGateway,
  NotificationsService,
  StorageService,
  CryptoService,
  SettingsService,
  JobsService,
  PdfService,
  OrgService,
];

/** Cross-cutting services available to every domain module without importing. */
@Global()
@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [AuthController, NotificationsController, FilesController, HealthController, LookupsController, RegistriesController],
  providers: [
    ...SHARED,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [...SHARED, JwtModule],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('{*splat}');
  }
}
