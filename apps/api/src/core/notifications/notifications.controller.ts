import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { formatDayMonth } from '@lexisora/shared';
import { requireContext } from '../context/request-context';
import { RequirePerm } from '../auth/decorators';
import { NotificationsService } from './notifications.service';

function whenLabel(d: Date): string {
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, y)) return 'Yesterday';
  return formatDayMonth(d);
}

@Controller('notifications')
@RequirePerm('alerts.view')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list() {
    const rows = await this.notifications.list(requireContext().userId!);
    return rows.map((n) => ({ ...n, when: whenLabel(n.createdAt) }));
  }

  @Get('count')
  async count() {
    return { unread: await this.notifications.unreadCount(requireContext().userId!) };
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll() {
    await this.notifications.markRead(requireContext().userId!);
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@Param('id') id: string) {
    await this.notifications.markRead(requireContext().userId!, id);
  }
}
