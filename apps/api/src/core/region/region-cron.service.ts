import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { REGIONS, REGION_CODES } from '@lexisora/shared';
import { runInCronRegion } from './region-cache';

type CronJob = ReturnType<SchedulerRegistry['getCronJob']>;
type CronJobCtor = { from(p: { cronTime: string; timeZone: string; start: boolean; onTick: () => void }): CronJob };

const IST = 'Asia/Kolkata';
/** Jobs that are about Lexisora's own platform (SaaS billing), not a tenant's calendar. */
const PLATFORM_PREFIX = 'platform.';

/**
 * Daily/weekly jobs are declared with `@Cron(expr, { timeZone: 'Asia/Kolkata' })`. For each
 * of them this service schedules one run per region, each at that region's local time
 * (00:30 IST for India tenants, 00:30 UK time for UK tenants), and marks the run with its
 * region so the job's tenant loop only takes that region's tenants (`tenantsForCron`).
 * India runs keep exactly the original schedule. Interval jobs (no time zone) are untouched.
 */
@Injectable()
export class RegionCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(RegionCronService.name);
  private readonly mine: CronJob[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly registry: SchedulerRegistry) {}

  onApplicationBootstrap() {
    // The schedule module mounts @Cron jobs in its own bootstrap hook; run after it.
    this.timer = setTimeout(() => this.mirror(), 1500);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
    for (const j of this.mine) j.stop();
  }

  mirror() {
    let n = 0;
    for (const [name, job] of this.registry.getCronJobs()) {
      if (name.startsWith(PLATFORM_PREFIX) || name.startsWith('region.')) continue;
      const tz = (job.cronTime as unknown as { timeZone?: string }).timeZone;
      if (tz !== IST) continue;
      const source = String((job.cronTime as unknown as { source: unknown }).source);
      try {
        const Ctor = job.constructor as unknown as CronJobCtor;
        const runs = REGION_CODES.map((region) =>
          Ctor.from({
            cronTime: source,
            timeZone: REGIONS[region].timezone,
            start: false,
            onTick: () => runInCronRegion(region, () => void job.fireOnTick()),
          }),
        );
        job.stop();
        for (const r of runs) {
          r.start();
          this.mine.push(r);
        }
        n++;
      } catch (e) {
        this.log.warn(`Could not split job ${name} by region: ${(e as Error).message}`);
      }
    }
    this.log.log(`Scheduled ${n} daily jobs per region (${REGION_CODES.join(', ')})`);
  }
}
