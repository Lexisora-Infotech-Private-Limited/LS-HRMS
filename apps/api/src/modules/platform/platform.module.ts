import { Module } from '@nestjs/common';
import { RolesController } from './rbac/roles.controller';
import { RolesService } from './rbac/roles.service';
import { AuditLogController } from './audit/audit-log.controller';
import { AuditLogService } from './audit/audit-log.service';
import { BillingController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';
import { BillingJobs } from './billing/billing.jobs';
import { BrandingController, BrandingService } from './branding/branding.service';
import { TenantsController, TenantsService } from './tenants/tenants.service';
import { PrivacyController, PrivacyService } from './privacy/privacy.service';
import { SupportController, SupportService } from './support/support.service';

/**
 * Platform domain:
 *  - Roles & access (`/roles`) and the Audit log (`/audit`); Alerts and global search screens are
 *    served by core (`/notifications`, `/search`).
 *  - SaaS: Subscription & billing (`/billing`, Razorpay / mock gateway, promo codes, GST invoices,
 *    renewal + dunning jobs), Branding (`/branding`), Tenants (`/tenants`, platform admins only),
 *    Data privacy (`/privacy`) and Lexisora support (`/support`).
 */
@Module({
  imports: [],
  controllers: [RolesController, AuditLogController, BillingController, BrandingController, TenantsController, PrivacyController, SupportController],
  providers: [RolesService, AuditLogService, BillingService, BillingJobs, BrandingService, TenantsService, PrivacyService, SupportService],
  exports: [RolesService, BillingService],
})
export class PlatformModule {}
