import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { feedListQuery, feedPinSchema, postCommentSchema, postUpsertSchema, type PostUpsertInput } from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { FeedService } from './feed.service';

/** Company feed — /feed (spec §3). */
@Controller('feed')
export class FeedController {
  constructor(private readonly svc: FeedService) {}

  @Get('posts')
  @RequirePerm('feed.view')
  list(@Query(new ZodPipe(feedListQuery)) q: z.infer<typeof feedListQuery>) {
    return this.svc.list(q);
  }

  @Get('drafts')
  @RequirePerm('feed.publish')
  drafts() {
    return this.svc.drafts();
  }

  @Get('sidebar')
  @RequirePerm('feed.view')
  sidebar() {
    return this.svc.sidebar();
  }

  @Get('posts/:id')
  @RequirePerm('feed.view')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post('posts')
  @RequirePerm('feed.publish')
  create(@Body(new ZodPipe(postUpsertSchema)) dto: PostUpsertInput) {
    return this.svc.create(dto);
  }

  @Put('posts/:id')
  @RequirePerm('feed.publish')
  update(@Param('id') id: string, @Body(new ZodPipe(postUpsertSchema)) dto: PostUpsertInput) {
    return this.svc.update(id, dto);
  }

  @Post('posts/:id/publish')
  @RequirePerm('feed.publish')
  publish(@Param('id') id: string) {
    return this.svc.publish(id);
  }

  @Post('posts/:id/archive')
  @RequirePerm('feed.publish')
  archive(@Param('id') id: string) {
    return this.svc.archive(id);
  }

  @Post('posts/:id/pin')
  @RequirePerm('feed.publish')
  pin(@Param('id') id: string, @Body(new ZodPipe(feedPinSchema)) b: z.infer<typeof feedPinSchema>) {
    return this.svc.setPinned(id, b.pinned);
  }

  @Delete('posts/:id')
  @RequirePerm('feed.publish')
  remove(@Param('id') id: string) {
    return this.svc.removeDraft(id);
  }

  @Put('posts/:id/like')
  @RequirePerm('feed.view')
  like(@Param('id') id: string) {
    return this.svc.like(id, true);
  }

  @Delete('posts/:id/like')
  @RequirePerm('feed.view')
  unlike(@Param('id') id: string) {
    return this.svc.like(id, false);
  }

  @Get('posts/:id/comments')
  @RequirePerm('feed.view')
  comments(@Param('id') id: string) {
    return this.svc.comments(id);
  }

  @Post('posts/:id/comments')
  @RequirePerm('feed.view')
  comment(@Param('id') id: string, @Body(new ZodPipe(postCommentSchema)) dto: z.infer<typeof postCommentSchema>) {
    return this.svc.addComment(id, dto.body, dto.parentId);
  }

  @Delete('comments/:id')
  @RequirePerm('feed.view')
  deleteComment(@Param('id') id: string) {
    return this.svc.deleteComment(id);
  }
}
