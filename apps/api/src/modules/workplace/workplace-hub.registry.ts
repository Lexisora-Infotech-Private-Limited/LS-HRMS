import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SearchService } from '../../core/registry/registries';
import { EventsService } from '../../core/registry/events.service';
import { LookupsService } from '../../core/lookups/lookups';
import { fileAccessCheckers } from '../../core/storage/files.controller';
import { hasPerm } from '../../core/auth/decorators';
import { runAsTenant } from '../../core/context/request-context';
import { ChatService } from './chat/chat.service';
import { LmsService } from './lms/lms.service';
import { FacilityService } from './facility/facility.service';
import { CctvService } from './cctv/cctv.service';

/**
 * Registrations and schedules for the comms hub, learning, rooms & visitors and CCTV:
 * file access for chat attachments and lesson files, the "rooms" lookup, course search,
 * audience-driven channel membership and LMS enrollment for new joiners, call reaping,
 * course due reminders, booking/visitor day close, CCTV health poll and session reaper.
 */
@Injectable()
export class WorkplaceHubRegistry implements OnModuleInit {
  private readonly log = new Logger('WorkplaceHub');

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly events: EventsService,
    private readonly lookups: LookupsService,
    private readonly chat: ChatService,
    private readonly lms: LmsService,
    private readonly facility: FacilityService,
    private readonly cctv: CctvService,
  ) {}

  onModuleInit() {
    fileAccessCheckers.push((fileId) => this.chat.canOpenFile(fileId).catch(() => false));
    fileAccessCheckers.push((fileId) => this.lms.canOpenFile(fileId).catch(() => false));

    this.lookups.register('rooms', async () => (await this.prisma.room.findMany({ where: { active: true }, orderBy: { name: 'asc' } })).map((r) => ({ value: r.id, label: r.name })));
    this.search.register('Courses', async (q, ctx) => (hasPerm(ctx, 'lms.view') || hasPerm(ctx, 'lms.manage') ? this.lms.search(q) : []));

    const syncEmployee = async (employeeId?: string) => {
      if (!employeeId) return;
      const emp = await this.prisma.employee.findFirst({ where: { id: employeeId }, select: { userId: true } });
      if (emp?.userId) await this.chat.syncFor(emp.userId).catch((e) => this.log.warn(`chat sync: ${(e as Error).message}`));
    };
    this.events.on('employee.created', async (p: { employeeId?: string }) => {
      await syncEmployee(p.employeeId);
      if (p.employeeId) await this.lms.enrollNewEmployee(p.employeeId).catch((e) => this.log.warn(`lms enroll: ${(e as Error).message}`));
    });
    this.events.on('employee.statusChanged', async (p: { employeeId?: string }) => syncEmployee(p.employeeId));
    this.events.on('onboarding.completed', async (p: { employeeId?: string }) => syncEmployee(p.employeeId));
  }

  private async forEachTenant(name: string, fn: () => Promise<unknown>) {
    const tenants = await this.prisma.raw.tenant.findMany({ select: { id: true } }).catch(() => [] as { id: string }[]);
    for (const t of tenants) {
      try {
        await runAsTenant(t.id, fn);
      } catch (e) {
        this.log.error(`${name} failed for tenant ${t.id}: ${(e as Error).message}`);
      }
    }
  }

  /** Every 5 minutes: end calls nobody is in (or older than 8 hours). */
  @Cron('*/5 * * * *')
  async reapCalls() {
    await this.forEachTenant('chat.reapCalls', () => this.chat.reapCalls());
  }

  /** 09:00 IST: course due / overdue reminders. */
  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async courseReminders() {
    await this.forEachTenant('lms.dueReminders', () => this.lms.dueReminders());
  }

  /** Every 15 minutes: completed bookings, visitor no-shows, auto check-out, PII purge. */
  @Cron('*/15 * * * *')
  async facilityClose() {
    await this.forEachTenant('facility.closePast', () => this.facility.closePast());
  }

  /** Every 30 s (gateway mode only): camera health. */
  @Cron('*/30 * * * * *')
  async cctvHealth() {
    if (this.cctv.gateway.mode !== 'gateway') return;
    await this.forEachTenant('cctv.healthPoll', () => this.cctv.healthPoll());
  }

  /** Every minute: close viewing sessions without a heartbeat. */
  @Cron('* * * * *')
  async cctvReaper() {
    await this.forEachTenant('cctv.sessionReaper', () => this.cctv.reapSessions());
  }
}
