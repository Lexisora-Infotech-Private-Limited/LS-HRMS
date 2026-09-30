import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TRACKER_SOCKET_EVENTS, trackerWorkDate } from '@lexisora/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventsService } from '../../core/registry/events.service';
import { ApprovalCountsService } from '../../core/registry/registries';
import { RealtimeGateway } from '../../core/realtime/realtime.gateway';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { deviceTokenHooks } from '../../core/auth/auth.middleware';
import { fileAccessCheckers } from '../../core/storage/files.controller';
import { getContext, requireContext, runAsTenant } from '../../core/context/request-context';
import { DevicesService } from './devices.service';
import { IngestService } from './ingest.service';
import { ReviewService } from './review.service';
import { addDays } from './tracker.rules';

/**
 * Registrations (auth hook, file access, approval counts), cross-domain event consumers,
 * realtime pushes to devices, and scheduled jobs of the tracker domain.
 */
@Injectable()
export class TrackerJobs implements OnModuleInit {
  private readonly log = new Logger('TrackerJobs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly approvals: ApprovalCountsService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly devices: DevicesService,
    private readonly ingest: IngestService,
    private readonly review: ReviewService,
  ) {}

  onModuleInit() {
    // Revoked / unpaired device tokens stop authenticating immediately.
    deviceTokenHooks.isDeviceActive = (deviceId, tenantId) => this.devices.isDeviceActive(deviceId, tenantId);

    // Screenshot files: owner, RM chain, project lead of the shot's project, admin (not HR).
    fileAccessCheckers.push(async (fileId) => {
      const ctx = getContext();
      if (!ctx?.userId) return false;
      return this.review.canOpenFile(ctx, fileId);
    });

    // Dashboard "Awaiting your approval": idle claims routed to me.
    this.approvals.register(async (ctx) => {
      if (!ctx.employeeId) return null;
      const count = await this.review.pendingClaimCount(ctx);
      return count ? { key: 'idle-claims', label: 'Idle claims', count, link: '/approvals' } : null;
    });

    // ── event consumers ──
    this.events.on('employee.statusChanged', async (p: { employeeId: string; to: string }) => {
      if (p.to === 'EXITED' || p.to === 'SUSPENDED') await this.devices.revokeAllFor(p.employeeId, p.to === 'EXITED' ? 'Employment ended' : 'Employee suspended');
    });
    this.events.on('attendance.punched', async (p: { employeeId: string; direction: string; source: string; date?: string }) => {
      const ids = await this.devices.activeDeviceIdsForEmployees([p.employeeId]);
      for (const id of ids) this.realtime.toRoom(`d:${id}`, TRACKER_SOCKET_EVENTS.attendancePunched, { direction: p.direction, source: p.source, at: new Date().toISOString() });
    });
    const pushPolicy = async (p: Record<string, unknown>) => {
      const ids = await this.prisma.trackerDevice.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      for (const d of ids) this.realtime.toRoom(`d:${d.id}`, TRACKER_SOCKET_EVENTS.policyUpdated, { updatedAt: (p.updatedAt as string) ?? new Date().toISOString() });
    };
    this.events.on('policy.updated', pushPolicy);
    this.events.on('attendance.policyUpdated', pushPolicy);
    this.events.on('task.statusChanged', async (p: { taskId: string }) => {
      const t = await this.prisma.task.findUnique({ where: { id: p.taskId }, select: { assigneeEmployeeId: true } });
      if (!t?.assigneeEmployeeId) return;
      const ids = await this.devices.activeDeviceIdsForEmployees([t.assigneeEmployeeId]);
      for (const id of ids) this.realtime.toRoom(`d:${id}`, TRACKER_SOCKET_EVENTS.tasksUpdated, {});
    });
    this.events.on('task.assigned', async (p: { taskId?: string; assigneeEmployeeId?: string }) => {
      if (!p.assigneeEmployeeId) return;
      const ids = await this.devices.activeDeviceIdsForEmployees([p.assigneeEmployeeId]);
      for (const id of ids) this.realtime.toRoom(`d:${id}`, TRACKER_SOCKET_EVENTS.tasksUpdated, {});
    });
    // An approved timesheet settles any idle claims nobody decided explicitly.
    this.events.on('timesheet.approved', async (p: { employeeId: string; weekStart: string | Date }) => {
      const ws = typeof p.weekStart === 'string' ? p.weekStart.slice(0, 10) : new Date(p.weekStart).toISOString().slice(0, 10);
      await this.review.approvePendingForWeek(p.employeeId, ws);
    });
  }

  private async forEachTenant(name: string, fn: (tenantId: string) => Promise<unknown>) {
    const tenants = await this.prisma.raw.tenant.findMany({ select: { id: true } }).catch(() => [] as { id: string }[]);
    for (const t of tenants) {
      try {
        await runAsTenant(t.id, () => fn(t.id));
      } catch (e) {
        this.log.error(`${name} failed for tenant ${t.id}: ${(e as Error).message}`);
      }
    }
  }

  /** Pairing codes expire after 10 min; AWAITING_HR requests after 72 h. */
  @Cron('*/1 * * * *')
  async expirePairings() {
    await this.forEachTenant('pairing-expiry', (tid) => this.devices.expireStale(tid));
  }

  /** Screenshot retention (policy.screenshotRetentionDays → purgeAfter). */
  @Cron('30 2 * * *', { timeZone: 'Asia/Kolkata' })
  async purgeScreenshots() {
    await this.forEachTenant('screenshot-retention', async () => {
      let n = 0;
      do n = await this.ingest.purgeScreenshots();
      while (n === 500);
    });
  }

  /** Nightly: flag days with ≥ 3 missing screenshots. */
  @Cron('50 23 * * *', { timeZone: 'Asia/Kolkata' })
  async screenshotMissing() {
    const today = trackerWorkDate(new Date());
    await this.forEachTenant('screenshot-missing', () => this.ingest.screenshotMissingCheck(today));
  }

  /** 10:00 IST digest to reviewers: "4 idle claims awaiting review". */
  @Cron('0 10 * * 1-6', { timeZone: 'Asia/Kolkata' })
  async claimDigest() {
    await this.forEachTenant('idleclaim-digest', async () => {
      const groups = await this.prisma.idleClaim.groupBy({ by: ['reviewerEmployeeId'], where: { status: 'PENDING', reviewerEmployeeId: { not: null } }, _count: { _all: true } });
      for (const g of groups) {
        const users = await this.notifications.usersForEmployees([g.reviewerEmployeeId]);
        const n = g._count._all;
        await this.notifications.notify({ userIds: users, type: 'approval', title: `${n} idle claim${n === 1 ? '' : 's'} awaiting review`, body: 'Review them with the timesheet in Approvals.', link: '/approvals', from: 'Lexisora Tracker' });
      }
    });
  }

  /** Daily 09:00 IST: devices not seen for 30 days → alert HR. */
  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async staleDevices() {
    await this.forEachTenant('device-stale', async () => {
      const before = new Date(Date.now() - 30 * 86400_000);
      const stale = await this.prisma.trackerDevice.findMany({ where: { status: 'ACTIVE', lastSeenAt: { lt: before, gte: new Date(before.getTime() - 86400_000) } } });
      if (!stale.length) return;
      const hr = await this.notifications.usersWithPermission('devices.manage');
      await this.notifications.notify({
        userIds: hr,
        type: 'tracker',
        title: `${stale.length} tracker device${stale.length === 1 ? '' : 's'} not seen for 30 days`,
        body: stale.map((d) => d.hostname).join(', '),
        link: '/devices?tab=stale',
        from: 'Lexisora Tracker',
      });
    });
  }

  /** Utility for tests / seeds: re-project a week for an employee inside the current tenant. */
  async reprojectWeek(employeeId: string, weekStart: string) {
    requireContext();
    for (let i = 0; i < 7; i++) await this.ingest.projectDay(employeeId, addDays(weekStart, i));
  }
}
