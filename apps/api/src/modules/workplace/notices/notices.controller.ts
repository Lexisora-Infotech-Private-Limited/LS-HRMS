import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { noticeListQuery, noticeUpsertSchema, type NoticeUpsertInput } from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { NoticesService } from './notices.service';

const publishBody = z.object({ force: z.boolean().default(false) }).default({});

/** Notice board — /notices (spec §2). */
@Controller('notices')
export class NoticesController {
  constructor(private readonly svc: NoticesService) {}

  @Get()
  @RequirePerm('notices.view')
  list(@Query(new ZodPipe(noticeListQuery)) q: z.infer<typeof noticeListQuery>) {
    return this.svc.list(q);
  }

  @Get('unread-count')
  @RequirePerm('notices.view')
  unreadCount() {
    return this.svc.unreadCount();
  }

  /** Team / visibility options the signed-in publisher may target. */
  @Get('audiences')
  @RequirePerm('notices.publish.global', 'notices.publish.team')
  audiences() {
    return this.svc.audienceOptions();
  }

  @Get(':id')
  @RequirePerm('notices.view')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Post(':id/read')
  @RequirePerm('notices.view')
  read(@Param('id') id: string) {
    return this.svc.markRead(id);
  }

  @Get(':id/receipts')
  @RequirePerm('notices.publish.global', 'notices.publish.team')
  receipts(@Param('id') id: string) {
    return this.svc.receipts(id);
  }

  @Post(':id/remind-unread')
  @RequirePerm('notices.publish.global', 'notices.publish.team')
  remind(@Param('id') id: string) {
    return this.svc.remindUnread(id);
  }

  @Post()
  @RequirePerm('notices.publish.global', 'notices.publish.team')
  create(@Body(new ZodPipe(noticeUpsertSchema)) dto: NoticeUpsertInput) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @RequirePerm('notices.publish.global', 'notices.publish.team')
  update(@Param('id') id: string, @Body(new ZodPipe(noticeUpsertSchema)) dto: NoticeUpsertInput) {
    return this.svc.update(id, dto);
  }

  @Post(':id/publish')
  @RequirePerm('notices.publish.global', 'notices.publish.team')
  publish(@Param('id') id: string, @Body(new ZodPipe(publishBody)) b: z.infer<typeof publishBody>) {
    return this.svc.publish(id, b.force);
  }

  @Post(':id/unschedule')
  @RequirePerm('notices.publish.global', 'notices.publish.team')
  unschedule(@Param('id') id: string) {
    return this.svc.unschedule(id);
  }

  @Post(':id/archive')
  @RequirePerm('notices.publish.global', 'notices.publish.team')
  archive(@Param('id') id: string) {
    return this.svc.archive(id);
  }

  @Post(':id/pin')
  @RequirePerm('notices.publish.global')
  pin(@Param('id') id: string) {
    return this.svc.setPinned(id, true);
  }

  @Delete(':id/pin')
  @RequirePerm('notices.publish.global')
  unpin(@Param('id') id: string) {
    return this.svc.setPinned(id, false);
  }

  @Delete(':id')
  @RequirePerm('notices.publish.global', 'notices.publish.team')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
