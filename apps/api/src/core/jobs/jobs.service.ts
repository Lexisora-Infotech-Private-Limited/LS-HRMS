import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../../config/env';
import { runAsTenant } from '../context/request-context';

type Handler = (data: any) => Promise<unknown>;

/**
 * Thin BullMQ wrapper. Domains register named handlers in onModuleInit:
 *   jobs.register('payroll.generatePayslips', async (d) => …)
 * and enqueue with jobs.enqueue('payroll.generatePayslips', { tenantId, runId }).
 * Handlers run inside a tenant context when `tenantId` is present in the payload.
 * If Redis is unavailable (or JOBS_DISABLED), jobs run inline so dev/test still work.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private readonly handlers = new Map<string, Handler>();
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;
  private inline = env.JOBS_DISABLED;

  private ensure() {
    if (this.inline || this.queue) return;
    try {
      this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
      this.connection.on('error', (e) => this.log.warn(`Redis: ${e.message}`));
      this.queue = new Queue('hrms', { connection: this.connection });
      this.worker = new Worker(
        'hrms',
        async (job) => this.run(job.name, job.data),
        { connection: this.connection, concurrency: 4 },
      );
      this.worker.on('failed', (job, err) => this.log.error(`Job ${job?.name} failed: ${err.message}`));
    } catch (e) {
      this.log.warn(`Queue unavailable, running jobs inline: ${(e as Error).message}`);
      this.inline = true;
    }
  }

  register(name: string, handler: Handler) {
    this.handlers.set(name, handler);
    this.ensure();
  }

  async enqueue(name: string, data: Record<string, unknown>, opts?: JobsOptions) {
    this.ensure();
    if (this.inline || !this.queue) {
      setImmediate(() => void this.run(name, data).catch((e) => this.log.error(`${name}: ${e.message}`)));
      return;
    }
    await this.queue.add(name, data, { removeOnComplete: 1000, removeOnFail: 5000, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, ...opts });
  }

  private async run(name: string, data: any) {
    const h = this.handlers.get(name);
    if (!h) throw new Error(`No handler for job ${name}`);
    return data?.tenantId ? runAsTenant(data.tenantId, () => h(data)) : h(data);
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
