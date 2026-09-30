import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { formatDayMonth, istDateKey } from '@lexisora/shared';
import { requireContext } from '../context/request-context';
import { RequirePerm } from '../auth/decorators';
import { NotificationsService } from './notifications.service';

/** "Today" / "Yesterday" / "26 Sep", judged on the IST business day (not server time). */
function whenLabel(d: Date): string {
  const key = istDateKey(d);
  if (key === istDateKey()) return 'Today';
  if (key === istDateKey(new Date(Date.now() - 86400_000))) return 'Yesterday';
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
