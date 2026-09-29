import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireContext } from '../context/request-context';
import { MailService } from '../mail/mail.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export type NotifyInput = {
  /** Recipient user ids (use `usersForEmployees` to map employee ids). */
  userIds: string[];
  type: string;
  title: string;
  body?: string;
  link?: string;
  from?: string;
  /** Also send an email to each recipient. */
  email?: boolean;
};

/**
 * In-app alerts (Alerts screen + header count), realtime push and optional email.
 * Every domain calls this instead of writing Notification rows directly.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly mail: MailService,
  ) {}

  async notify(n: NotifyInput): Promise<void> {
    const ids = [...new Set(n.userIds.filter(Boolean))];
    if (!ids.length) return;
    const tenantId = requireContext().tenantId;
    await this.prisma.notification.createMany({
      data: ids.map((userId) => ({
        tenantId,
        userId,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        fromLabel: n.from ?? 'System',
      })),
    });
    this.realtime.toUsers(ids, 'notification', { type: n.type, title: n.title, body: n.body, link: n.link });
    if (n.email) {
      const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { email: true, name: true } });
      await Promise.all(
        users.map((u) =>
          this.mail.send({ to: u.email, subject: n.title, text: `Hi ${u.name},\n\n${n.body ?? n.title}\n\n— Lexisora HRMS` }),
        ),
      );
    }
  }

  /** Map employee ids → their user ids (skips employees without a login). */
  async usersForEmployees(employeeIds: (string | null | undefined)[]): Promise<string[]> {
    const ids = employeeIds.filter((x): x is string => !!x);
    if (!ids.length) return [];
    const rows = await this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { userId: true } });
    return rows.map((r) => r.userId).filter((x): x is string => !!x);
  }

  /** User ids of everyone holding a permission (e.g. all HR for a new onboarding). */
  async usersWithPermission(perm: string): Promise<string[]> {
    const roles = await this.prisma.role.findMany({ where: { permissions: { has: perm } }, select: { id: true } });
    const users = await this.prisma.user.findMany({
      where: { roleId: { in: roles.map((r) => r.id) }, status: 'ACTIVE' },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  list(userId: string, take = 50) {
    return this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id?: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });
  }
}
