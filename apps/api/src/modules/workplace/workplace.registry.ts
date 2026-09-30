import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { WpAudienceRule } from '@lexisora/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ApprovalCountsService, SearchService } from '../../core/registry/registries';
import { EventsService } from '../../core/registry/events.service';
import { RealtimeGateway } from '../../core/realtime/realtime.gateway';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { fileAccessCheckers } from '../../core/storage/files.controller';
import { hasPerm } from '../../core/auth/decorators';
import { runAsTenant } from '../../core/context/request-context';
import { AudienceService } from './common/audience';
import { SpineReader } from './common/spine';
import { shortTime, todayKey } from './common/dates';
import { celebrationsWithin, DashboardService } from './dashboard/dashboard.service';
import { NoticesService } from './notices/notices.service';

const OPEN_TICKET = ['OPEN', 'IN_PROGRESS', 'WAITING'] as const;

/**
 * Workplace registrations (approval counts, search, file access, event consumers) and
 * schedules: scheduled/expiring notices, celebration alerts, town-hall reminders.
 */
@Injectable()
export class WorkplaceRegistry implements OnModuleInit {
  private readonly log = new Logger('Workplace');

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalCountsService,
    private readonly search: SearchService,
    private readonly events: EventsService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly audience: AudienceService,
    private readonly spine: SpineReader,
    private readonly dashboard: DashboardService,
    private readonly notices: NoticesService,
  ) {}

  onModuleInit() {
    // Dashboard "Awaiting your approval" → "Helpdesk escalations N" (agents see all, leads/managers theirs).
    this.approvals.register(async (ctx) => {
      if (!ctx.employeeId) return null;
      const agent = hasPerm(ctx, 'helpdesk.agent');
      const mgmt = ['lead', 'manager', 'hr', 'admin'].includes(ctx.roleKey ?? '');
      if (!agent && !mgmt) return null;
      const count = await this.prisma.helpdeskTicket.count({
        where: { status: { in: [...OPEN_TICKET] }, escalationLevel: { gt: 0 }, ...(agent ? {} : { escalatedToEmployeeIds: { has: ctx.employeeId } }) },
      });
      return { key: 'helpdesk', label: 'Helpdesk escalations', count, link: '/helpdesk?tab=escalated' };
    });

    this.search.register('Notices', async (q, ctx) => (hasPerm(ctx, 'notices.view') ? this.notices.search(q, ctx) : []));
    fileAccessCheckers.push((fileId) => this.notices.canOpenAttachment(fileId).catch(() => false));

    // Late joiners receive live notices whose audience now matches them.
    this.events.on('employee.created', async (p: { employeeId?: string }) => {
      if (p.employeeId) await this.notices.syncRecipientsFor(p.employeeId);
    });
    this.events.on('employee.statusChanged', async (p: { employeeId?: string; to?: string }) => {
      if (p.employeeId && (p.to === 'ACTIVE' || p.to === 'NOTICE_PERIOD')) await this.notices.syncRecipientsFor(p.employeeId);
    });

    // Live dashboard refresh (dashboard:invalidate → the web refetches the named sections).
    const refresh = (sections: string[]) => async (p: { employeeId?: string }) => this.push([p.employeeId], sections);
    this.events.on('timesheet.submitted', refresh(['todos']));
    this.events.on('timesheet.returned', refresh(['todos']));
    this.events.on('timesheet.approved', refresh(['todos']));
    this.events.on('leave.decided', refresh(['approvals']));
    this.events.on('task.statusChanged', async (p: { taskId?: string }) => {
      if (!p.taskId) return;
      const [t] = await this.spine.tasks({ id: p.taskId }, 1);
      if (!t) return;
      const [proj, duty] = await Promise.all([
        this.spine.projects({ id: t.projectId }),
        this.spine.tasks({ projectId: t.projectId, isStanding: true, title: { contains: 'review', mode: 'insensitive' } }, 20),
      ]);
      await this.push([t.assigneeEmployeeId, t.reporterEmployeeId, ...proj.map((x) => x.leadEmployeeId), ...duty.map((x) => x.assigneeEmployeeId)], ['todos']);
    });
  }

  private async push(employeeIds: (string | null | undefined)[], sections: string[]) {
    const users = await this.audience.userIds(employeeIds);
    if (users.length) this.realtime.toUsers(users, 'dashboard:invalidate', { sections });
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

  /** Every minute: scheduled notices whose time has come go live. */
  @Cron('* * * * *')
  async publishScheduledNotices() {
    await this.forEachTenant('notices.publishScheduled', () => this.notices.publishDue());
  }

  /** Every 15 minutes: expire notices past their expiry. */
  @Cron('*/15 * * * *')
  async expireNotices() {
    await this.forEachTenant('notices.expire', () => this.notices.expireDue());
  }

  /** 07:00 IST: birthday / work-anniversary alerts to teammates + a greeting email to the person. */
  @Cron('0 7 * * *', { timeZone: 'Asia/Kolkata' })
  async celebrationsDaily() {
    await this.forEachTenant('celebrations.daily', () => this.sendCelebrations());
  }

  async sendCelebrations(): Promise<number> {
    const people = await this.prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'NOTICE_PERIOD'] } },
      select: { id: true, fullName: true, firstName: true, userId: true, departmentId: true, dateOfBirth: true, joiningDate: true, department: { select: { name: true } } },
    });
    const today = celebrationsWithin(
      people.map((p) => ({ id: p.id, name: p.fullName, dob: p.dateOfBirth, joined: p.joiningDate })),
      todayKey(),
      0,
    );
    const byId = new Map(people.map((p) => [p.id, p]));
    for (const c of today) {
      const p = byId.get(c.id.split(':')[1]!);
      if (!p) continue;
      const projectIds = await this.spine.projectIdsOf(p.id);
      const projectMates = (await Promise.all(projectIds.map((id) => this.spine.projectEmployeeIds(id)))).flat();
      const mates = new Set([...people.filter((x) => x.departmentId && x.departmentId === p.departmentId).map((x) => x.id), ...projectMates]);
      mates.delete(p.id);
      const mateUsers = await this.audience.userIds([...mates]);
      const dept = p.department?.name ? ` · ${p.department.name}` : '';
      if (c.kind === 'BIRTHDAY') {
        await this.notifications.notify({ userIds: mateUsers, type: 'celebration.birthday', title: `Birthday: ${p.fullName}${dept}`, link: '/dashboard' });
        if (p.userId) await this.notifications.notify({ userIds: [p.userId], type: 'celebration.birthday', title: `Happy birthday, ${p.firstName}!`, body: 'Wishing you a wonderful year ahead from all of us.', email: true });
      } else {
        const years = c.what.split(' · ')[1] ?? '';
        await this.notifications.notify({ userIds: mateUsers, type: 'celebration.anniversary', title: `Work anniversary: ${p.fullName} · ${years}`, link: '/dashboard' });
        if (p.userId) await this.notifications.notify({ userIds: [p.userId], type: 'celebration.anniversary', title: `Happy work anniversary, ${p.firstName}! ${years} with us.`, body: 'Thank you for everything you bring to the team.', email: true });
      }
    }
    return today.length;
  }

  /** Hourly: town-hall reminders 24 hours and 1 hour before the start. */
  @Cron('0 * * * *')
  async eventReminders() {
    await this.forEachTenant('events.reminder', () => this.sendEventReminders());
  }

  async sendEventReminders(now = Date.now()): Promise<number> {
    const rows = await this.prisma.companyEvent.findMany({ where: { kind: 'TOWN_HALL', cancelledAt: null, startsAt: { gt: new Date(now), lte: new Date(now + 24 * 3_600_000) } } });
    let sent = 0;
    for (const e of rows) {
      const mins = (e.startsAt.getTime() - now) / 60_000;
      const window = mins > 23 * 60 ? 'day' : mins <= 60 ? 'hour' : null;
      if (!window) continue;
      const ids = await this.audience.resolve((e.audiences ?? []) as WpAudienceRule[]);
      const users = await this.audience.userIds(ids);
      await this.notifications.notify({
        userIds: users,
        type: 'event.reminder',
        title: `${window === 'day' ? 'Tomorrow' : 'Starting soon'}: ${e.title} · ${shortTime(e.startsAt)}`,
        body: e.location ?? undefined,
        link: '/notices?tab=events',
      });
      sent++;
    }
    return sent;
  }

  /** 03:30 IST: delete personal to-dos completed more than 90 days ago. */
  @Cron('30 3 * * *', { timeZone: 'Asia/Kolkata' })
  async purgeTodos() {
    await this.forEachTenant('todos.purge', () => this.dashboard.purgeOldTodos());
  }
}
