import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  HELPDESK_PRIORITIES,
  slaPolicySchema,
  supportGroupSchema,
  ticketCategorySchema,
  ticketCommentSchema,
  ticketCreateSchema,
  ticketCsatSchema,
  ticketEscalateSchema,
  ticketListQuery,
  ticketResolveSchema,
  ticketUpdateSchema,
  type SupportGroupInput,
  type TicketCategoryInput,
  type TicketCreateInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { badRequest } from '../../../core/http/errors';
import { HelpdeskService } from './helpdesk.service';

const autoCloseSchema = z.object({ days: z.number().int().min(1).max(30) });

/** Helpdesk — /helpdesk (spec §6). */
@Controller('helpdesk')
export class HelpdeskController {
  constructor(private readonly svc: HelpdeskService) {}

  @Get('meta')
  @RequirePerm('helpdesk.use', 'helpdesk.agent')
  meta() {
    return this.svc.meta();
  }

  @Get('tickets')
  @RequirePerm('helpdesk.use', 'helpdesk.agent')
  list(@Query(new ZodPipe(ticketListQuery)) q: z.infer<typeof ticketListQuery>) {
    return this.svc.list(q);
  }

  @Post('tickets')
  @RequirePerm('helpdesk.use')
  create(@Body(new ZodPipe(ticketCreateSchema)) dto: TicketCreateInput) {
    return this.svc.create(dto);
  }

  @Get('tickets/:id')
  @RequirePerm('helpdesk.use', 'helpdesk.agent')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  /** Status / priority / assignee / category — the support desk (or the ticket's group). */
  @Patch('tickets/:id')
  @RequirePerm('helpdesk.use', 'helpdesk.agent')
  update(@Param('id') id: string, @Body(new ZodPipe(ticketUpdateSchema)) dto: z.infer<typeof ticketUpdateSchema>) {
    return this.svc.update(id, dto);
  }

  @Post('tickets/:id/comments')
  @RequirePerm('helpdesk.use', 'helpdesk.agent')
  comment(@Param('id') id: string, @Body(new ZodPipe(ticketCommentSchema)) dto: z.infer<typeof ticketCommentSchema>) {
    return this.svc.comment(id, dto);
  }

  @Post('tickets/:id/resolve')
  @RequirePerm('helpdesk.use', 'helpdesk.agent')
  resolve(@Param('id') id: string, @Body(new ZodPipe(ticketResolveSchema)) dto: z.infer<typeof ticketResolveSchema>) {
    return this.svc.resolve(id, dto.note);
  }

  @Post('tickets/:id/reopen')
  @RequirePerm('helpdesk.use')
  reopen(@Param('id') id: string) {
    return this.svc.reopen(id);
  }

  @Post('tickets/:id/cancel')
  @RequirePerm('helpdesk.use')
  cancel(@Param('id') id: string) {
    return this.svc.cancel(id);
  }

  @Post('tickets/:id/close')
  @RequirePerm('helpdesk.use', 'helpdesk.agent')
  close(@Param('id') id: string) {
    return this.svc.close(id);
  }

  @Post('tickets/:id/escalate')
  @RequirePerm('helpdesk.use', 'helpdesk.agent')
  escalate(@Param('id') id: string, @Body(new ZodPipe(ticketEscalateSchema)) dto: z.infer<typeof ticketEscalateSchema>) {
    return this.svc.escalate(id, dto.note);
  }

  @Post('tickets/:id/csat')
  @RequirePerm('helpdesk.use')
  csat(@Param('id') id: string, @Body(new ZodPipe(ticketCsatSchema)) dto: z.infer<typeof ticketCsatSchema>) {
    return this.svc.csat(id, dto.score, dto.comment);
  }

  // ── Settings (helpdesk.agent = helpdesk admin) ───────────────────────────

  @Get('settings')
  @RequirePerm('helpdesk.agent')
  settings() {
    return this.svc.settings();
  }

  @Post('groups')
  @RequirePerm('helpdesk.agent')
  createGroup(@Body(new ZodPipe(supportGroupSchema)) dto: SupportGroupInput) {
    return this.svc.saveGroup(null, dto);
  }

  @Patch('groups/:id')
  @RequirePerm('helpdesk.agent')
  updateGroup(@Param('id') id: string, @Body(new ZodPipe(supportGroupSchema)) dto: SupportGroupInput) {
    return this.svc.saveGroup(id, dto);
  }

  @Post('categories')
  @RequirePerm('helpdesk.agent')
  createCategory(@Body(new ZodPipe(ticketCategorySchema)) dto: TicketCategoryInput) {
    return this.svc.saveCategory(null, dto);
  }

  @Patch('categories/:id')
  @RequirePerm('helpdesk.agent')
  updateCategory(@Param('id') id: string, @Body(new ZodPipe(ticketCategorySchema)) dto: TicketCategoryInput) {
    return this.svc.saveCategory(id, dto);
  }

  @Put('sla/:priority')
  @RequirePerm('helpdesk.agent')
  sla(@Param('priority') priority: string, @Body(new ZodPipe(slaPolicySchema)) dto: z.infer<typeof slaPolicySchema>) {
    const p = priority.toUpperCase();
    if (!(HELPDESK_PRIORITIES as readonly string[]).includes(p)) throw badRequest('Unknown priority');
    return this.svc.saveSla(p as (typeof HELPDESK_PRIORITIES)[number], dto);
  }

  @Put('auto-close')
  @RequirePerm('helpdesk.agent')
  autoClose(@Body(new ZodPipe(autoCloseSchema)) dto: z.infer<typeof autoCloseSchema>) {
    return this.svc.saveAutoClose(dto.days);
  }
}
