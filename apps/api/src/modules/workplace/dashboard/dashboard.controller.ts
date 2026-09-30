import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  companyEventSchema,
  dailyQuoteSchema,
  dashboardQuery,
  eventsQuery,
  todoCreateSchema,
  todoUpdateSchema,
  type CompanyEventInput,
  type DailyQuoteInput,
  type TodoCreateInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { requireContext } from '../../../core/context/request-context';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { DashboardService } from './dashboard.service';

const quoteUpdateSchema = dailyQuoteSchema.partial();
const celebrationsQuery = z.object({ days: z.coerce.number().int().min(1).max(60).default(14) });

/** GET /dashboard — aggregation for the workplace-owned cards (spec §1.4). */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get()
  @RequirePerm('dashboard.view')
  get(@Query(new ZodPipe(dashboardQuery)) q: z.infer<typeof dashboardQuery>) {
    const sections = q.sections?.split(',').map((s) => s.trim()).filter(Boolean);
    return this.svc.dashboard(sections);
  }
}

/** Thought of the day: rotation read by everyone, list managed by HR (quotes.manage). */
@Controller('quotes')
export class QuotesController {
  constructor(private readonly svc: DashboardService) {}

  @Get('today')
  @RequirePerm('dashboard.view')
  today() {
    return this.svc.quoteToday();
  }

  @Get()
  @RequirePerm('quotes.manage')
  list() {
    return this.svc.listQuotes();
  }

  @Post()
  @RequirePerm('quotes.manage')
  create(@Body(new ZodPipe(dailyQuoteSchema)) dto: DailyQuoteInput) {
    return this.svc.createQuote(dto);
  }

  @Patch(':id')
  @RequirePerm('quotes.manage')
  update(@Param('id') id: string, @Body(new ZodPipe(quoteUpdateSchema)) dto: Partial<DailyQuoteInput>) {
    return this.svc.updateQuote(id, dto);
  }

  @Delete(':id')
  @RequirePerm('quotes.manage')
  remove(@Param('id') id: string) {
    return this.svc.deleteQuote(id);
  }
}

/** Personal to-dos (private to their owner) + the merged pending list. */
@Controller('todos')
export class TodosController {
  constructor(private readonly svc: DashboardService) {}

  @Get()
  @RequirePerm('dashboard.view')
  list() {
    return this.svc.listTodos();
  }

  @Post()
  @RequirePerm('dashboard.view')
  create(@Body(new ZodPipe(todoCreateSchema)) dto: TodoCreateInput) {
    return this.svc.createTodo(dto);
  }

  @Patch(':id')
  @RequirePerm('dashboard.view')
  update(@Param('id') id: string, @Body(new ZodPipe(todoUpdateSchema)) dto: Partial<TodoCreateInput>) {
    return this.svc.updateTodo(id, dto);
  }

  @Post(':id/complete')
  @RequirePerm('dashboard.view')
  complete(@Param('id') id: string) {
    return this.svc.setTodoDone(id, true);
  }

  @Post(':id/reopen')
  @RequirePerm('dashboard.view')
  reopen(@Param('id') id: string) {
    return this.svc.setTodoDone(id, false);
  }

  @Delete(':id')
  @RequirePerm('dashboard.view')
  remove(@Param('id') id: string) {
    return this.svc.deleteTodo(id);
  }
}

/** Company events (Town hall …) and celebrations. Managed by global-notice publishers (HR/Admin). */
@Controller('events')
export class EventsController {
  constructor(private readonly svc: DashboardService) {}

  @Get()
  @RequirePerm('dashboard.view', 'notices.view')
  list(@Query(new ZodPipe(eventsQuery)) q: z.infer<typeof eventsQuery>) {
    return this.svc.listEvents(q);
  }

  @Get('celebrations')
  @RequirePerm('dashboard.view', 'notices.view')
  celebrations(@Query(new ZodPipe(celebrationsQuery)) q: z.infer<typeof celebrationsQuery>) {
    return this.svc.celebrations(q.days, requireContext().employeeId);
  }

  @Post()
  @RequirePerm('notices.publish.global')
  create(@Body(new ZodPipe(companyEventSchema)) dto: CompanyEventInput) {
    return this.svc.createEvent(dto);
  }

  @Patch(':id')
  @RequirePerm('notices.publish.global')
  update(@Param('id') id: string, @Body(new ZodPipe(companyEventSchema)) dto: CompanyEventInput) {
    return this.svc.updateEvent(id, dto);
  }

  @Post(':id/cancel')
  @RequirePerm('notices.publish.global')
  cancel(@Param('id') id: string) {
    return this.svc.cancelEvent(id);
  }
}
