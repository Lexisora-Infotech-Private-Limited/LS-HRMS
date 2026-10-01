import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma, Subscription } from '@prisma/client';
import { istDateKey } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { runAsTenant } from '../../../core/context/request-context';
import { platformTenantId } from '../platform.util';
import { BillingService } from './billing.service';
import { daysUntil, mrrPaise, reminderDue, seatsBilled, type SubForMetrics } from './billing.logic';

const DAY = 86_400_000;

/**
 * Billing schedules across all tenants: renewals (issue invoice / apply scheduled downgrade),
 * dunning (past due → read-only → suspended), renewal reminders and the daily MRR snapshot.
 */
@Injectable()
export class BillingJobs {
  private readonly log = new Logger('BillingJobs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  private async eachSubscription(name: string, where: Prisma.SubscriptionWhereInput, fn: (s: Subscription) => Promise<unknown>) {
    const subs = await this.prisma.raw.subscription.findMany({ where });
    for (const s of subs) {
      try {
        await runAsTenant(s.tenantId, () => fn(s));
      } catch (e) {
        this.log.error(`${name} failed for tenant ${s.tenantId}: ${(e as Error).message}`);
      }
    }
    return subs.length;
  }

  /** 01:00 IST: periods that ended → renewal invoice (gateway collection) or scheduled downgrade. */
  @Cron('0 1 * * *', { timeZone: 'Asia/Kolkata' })
  async renewals() {
    const n = await this.eachSubscription('billing.renewals', { planCode: 'GROWTH', status: 'ACTIVE', currentPeriodEnd: { lt: new Date() } }, (s) => this.billing.renewOrDowngrade(s));
    if (n) this.log.log(`Processed ${n} renewals`);
  }

  /** Hourly: grace ended → read-only; 30 days unpaid → suspended. */
  @Cron('20 * * * *', { timeZone: 'Asia/Kolkata' })
  async dunning() {
    await this.eachSubscription('billing.dunning', { status: { in: ['PAST_DUE', 'READ_ONLY'] } }, (s) => this.billing.dunning(s));
  }

  /** 09:00 IST: renewal reminders at T-30 (yearly), T-7 and T-1. */
  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async reminders() {
    const now = new Date();
    await this.eachSubscription('billing.reminders', { planCode: 'GROWTH', status: 'ACTIVE', cancelAtPeriodEnd: false, currentPeriodEnd: { gt: now, lt: new Date(now.getTime() + 31 * DAY) } }, async (s) => {
      if (s.currentPeriodEnd && reminderDue(s.cycle, daysUntil(s.currentPeriodEnd, now))) await this.billing.renewalReminder(s);
    });
  }

  /** 00:30 IST: platform MRR snapshot (Tenants screen "MRR +x%" compares with 30 days ago). */
  @Cron('30 0 * * *', { timeZone: 'Asia/Kolkata' })
  async mrrSnapshot() {
    const operator = await platformTenantId(this.prisma.raw).catch(() => null);
    const subs = await this.prisma.raw.subscription.findMany({ where: operator ? { tenantId: { not: operator } } : {} });
    const metrics = subs as unknown as SubForMetrics[];
    const date = new Date(`${istDateKey()}T00:00:00Z`);
    const data = {
      mrrPaise: mrrPaise(metrics),
      seatsBilled: seatsBilled(metrics),
      paidTenants: subs.filter((s) => (s.planCode === 'GROWTH' || s.planCode === 'ENTERPRISE') && ['ACTIVE', 'PAST_DUE', 'READ_ONLY'].includes(s.status)).length,
      freeTenants: subs.filter((s) => s.planCode === 'FREE').length,
    };
    await this.prisma.raw.mrrSnapshot.upsert({ where: { date }, create: { date, ...data }, update: data });
  }
}
