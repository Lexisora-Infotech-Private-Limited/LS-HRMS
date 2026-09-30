import { Module } from '@nestjs/common';
import { RolesController } from './rbac/roles.controller';
import { RolesService } from './rbac/roles.service';
import { AuditLogController } from './audit/audit-log.controller';
import { AuditLogService } from './audit/audit-log.service';

/**
 * Platform domain — Roles & access (`/roles`) and the Audit log (`/audit`).
 * Alerts and global search are served by core (`/notifications`, `/search`); their screens live
 * in the web platform module. SaaS modules (billing, branding, tenants, privacy, support) are
 * wired in a later release — see docs/specs/spec-platform.md M9–M13.
 */
@Module({
  imports: [],
  controllers: [RolesController, AuditLogController],
  providers: [RolesService, AuditLogService],
  exports: [RolesService],
})
export class PlatformModule {}
