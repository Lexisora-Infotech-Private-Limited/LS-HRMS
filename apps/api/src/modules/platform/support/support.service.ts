import { Body, Controller, Get, HttpCode, Injectable, OnModuleInit, Param, Patch, Post, Query } from '@nestjs/common';
import type { Prisma, PrismaClient, SupportMessage, SupportTicket } from '@prisma/client';
import {
  SUPPORT_SEVERITY_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_LABELS_PLATFORM,
  createSupportTicketSchema,
  supportCsatSchema,
  supportMessageSchema,
  supportQuerySchema,
  supportUpdateSchema,
  supportViewSchema,
  type CreateSupportTicketInput,
  type SupportCsatInput,
  type SupportListResponse,
  type SupportMessageInput,
  type SupportQuery,
  type SupportSeverityKey,
  type SupportStatusKey,
  type SupportTicketDetailDto,
  type SupportTicketRowDto,
  type SupportUpdateInput,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { requireContext, runAsTenant } from '../../../core/context/request-context';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { MailService } from '../../../core/mail/mail.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { SequenceService } from '../../../core/registry/sequence.service';
import { SearchService } from '../../../core/registry/registries';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { badRequest, conflict, forbidden, notFound } from '../../../core/http/errors';
import { openedLabel, platformActorName, platformAdminUserIds, platformTenantId, recordPlatformAccess } from '../platform.util';
import { platformReader } from '../privacy/privacy.guard';
import { canReopen, canTransition, firstResponseDue, isOpenStatus, slaBreached, slaHint, slaPolicy, statusAfterCustomerReply } from './support.logic';

type TicketWithMessages = SupportTicket & { messages: SupportMessage[] };

/** First number handed out by the platform support sequence (wireframe: next request is SUP-222). */
const FIRST_TICKET_NUMBER = 222;

/**
 * Lexisora support (B2B): client company admins raise requests to the Lexisora team; platform
 * administrators work the queue across every tenant. Tickets carry the requesting tenant's id but
 * are numbered from the operator's sequence (SUP-222…).
 */
@Injectable()
export class SupportService implements OnModuleInit {
  private readonly db: PrismaClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly realtime: RealtimeGateway,
    private readonly seq: SequenceService,
    private readonly search: SearchService,
  ) {
    this.db = platformReader(prisma.raw);
  }

  onModuleInit() {
    // Header search: "SUP-221" or a subject word finds this workspace's requests.
    this.search.register('support', async (q, ctx) => {
      if (!ctx.permissions.has('support.use') && !ctx.permissions.has('*')) return [];
      const rows = await this.db.supportTicket.findMany({
        where: { tenantId: ctx.tenantId, OR: [{ code: { contains: q, mode: 'insensitive' } }, { subject: { contains: q, mode: 'insensitive' } }] },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      return rows.map((t) => ({ type: 'support', id: t.id, title: `${t.code} · ${t.subject}`, subtitle: SUPPORT_STATUS_LABELS[t.status as SupportStatusKey], link: `/support?ticket=${t.id}` }));
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private platformView(view: string | undefined): boolean {
    const ctx = requireContext();
    const wants = view === 'platform' || view === 'all';
    if (wants && !ctx.isPlatformAdmin) throw forbidden('Only Lexisora platform administrators can open the support queue');
    return wants;
  }

  private row(t: SupportTicket, tenantName: string | null, platform: boolean, now = new Date()): SupportTicketRowDto {
    const status = t.status as SupportStatusKey;
    return {
      id: t.id,
      code: t.code,
      subject: t.subject,
      severity: t.severity as SupportSeverityKey,
      category: t.category,
      status,
      statusLabel: (platform ? SUPPORT_STATUS_LABELS_PLATFORM : SUPPORT_STATUS_LABELS)[status],
      opened: openedLabel(t.createdAt, now),
      createdAt: t.createdAt.toISOString(),
      tenantId: t.tenantId,
      tenantName,
      planAtOpen: t.planAtOpen,
      assigneeName: t.assigneeName,
      slaDueAt: t.firstResponseDueAt.toISOString(),
      slaBreached: slaBreached(t, now),
      firstRespondedAt: t.firstRespondedAt?.toISOString() ?? null,
    };
  }

  private async tenantNames(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.db.tenant.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async load(id: string, platform: boolean): Promise<TicketWithMessages> {
    const t = await this.db.supportTicket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!t || (!platform && t.tenantId !== requireContext().tenantId)) throw notFound('Request');
    return t;
  }

  private async planOf(tenantId: string): Promise<string> {
    const sub = await this.db.subscription.findUnique({ where: { tenantId }, select: { planCode: true } });
    return sub?.planCode ?? 'INTERNAL';
  }

  /** Alert the requesting workspace's support users (never the actor). */
  private async notifyTenant(t: SupportTicket, n: { type: string; title: string; body?: string; email?: boolean }) {
    const me = requireContext().userId;
    await runAsTenant(t.tenantId, async () => {
      const users = (await this.notifications.usersWithPermission('support.use')).filter((u) => u !== me);
      await this.notifications.notify({ userIds: users, type: n.type, title: n.title, body: n.body, link: `/support?ticket=${t.id}`, from: 'Lexisora support', email: n.email });
    });
    this.realtime.toTenant(t.tenantId, 'support.ticket.updated', { id: t.id });
  }

  /** Alert Lexisora staff in the operator workspace (the assignee, else every platform admin). */
  private async notifyPlatform(t: SupportTicket, n: { type: string; title: string; body?: string; email?: boolean }) {
    const ops = await platformTenantId(this.prisma.raw);
    const me = requireContext().userId;
    const users = (t.assigneeUserId ? [t.assigneeUserId] : await platformAdminUserIds(this.prisma.raw)).filter((u) => u !== me);
    await runAsTenant(ops, () => this.notifications.notify({ userIds: users, type: n.type, title: n.title, body: n.body, link: `/support?scope=all&ticket=${t.id}`, from: 'Support queue', email: n.email }));
    this.realtime.toTenant(ops, 'support.ticket.updated', { id: t.id });
  }

  private async systemMessage(t: SupportTicket, body: string) {
    await this.db.supportMessage.create({ data: { tenantId: t.tenantId, ticketId: t.id, authorType: 'SYSTEM', authorName: 'System', body } });
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  async list(q: SupportQuery): Promise<SupportListResponse> {
    const ctx = requireContext();
    const platform = this.platformView(q.scope);
    const base: Prisma.SupportTicketWhereInput = platform ? {} : { tenantId: ctx.tenantId };
    if (q.q) Object.assign(base, { OR: [{ code: { contains: q.q, mode: 'insensitive' } }, { subject: { contains: q.q, mode: 'insensitive' } }] });
    const open: Prisma.SupportTicketWhereInput = { status: { notIn: ['RESOLVED', 'CLOSED'] } };
    const resolved: Prisma.SupportTicketWhereInput = { status: { in: ['RESOLVED', 'CLOSED'] } };
    const tabWhere = q.tab === 'open' ? open : q.tab === 'resolved' ? resolved : {};
    const where = { AND: [base, tabWhere] };
    const [rows, total, nOpen, nResolved, nAll, plan] = await Promise.all([
      this.db.supportTicket.findMany({ where, orderBy: [{ createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.supportTicket.count({ where }),
      this.db.supportTicket.count({ where: { AND: [base, open] } }),
      this.db.supportTicket.count({ where: { AND: [base, resolved] } }),
      this.db.supportTicket.count({ where: base }),
      this.planOf(ctx.tenantId),
    ]);
    const names = await this.tenantNames(rows.map((r) => r.tenantId));
    const now = new Date();
    return {
      items: rows.map((r) => this.row(r, names.get(r.tenantId) ?? null, platform, now)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: { open: nOpen, resolved: nResolved, all: nAll },
      isPlatformAdmin: !!ctx.isPlatformAdmin,
      slaHint: slaHint(plan),
    };
  }

  async detail(id: string, view?: string): Promise<SupportTicketDetailDto> {
    const platform = this.platformView(view);
    const t = await this.load(id, platform);
    const names = await this.tenantNames([t.tenantId]);
    const now = new Date();
    const visible = platform ? t.messages : t.messages.filter((m) => !m.internal);
    return {
      ...this.row(t, names.get(t.tenantId) ?? null, platform, now),
      description: t.description,
      openedByName: t.openedByName,
      openedByEmail: t.openedByEmail,
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      csat: t.csat,
      canReopen: !platform && canReopen(t, now),
      canResolve: isOpenStatus(t.status),
      canRate: !platform && t.status === 'RESOLVED' && t.csat === null,
      isPlatformView: platform,
      messages: visible.map((m) => ({ id: m.id, authorType: m.authorType, authorName: m.authorName, body: m.body, internal: m.internal, createdAt: m.createdAt.toISOString() })),
    };
  }

  // ── Customer actions ─────────────────────────────────────────────────────

  async create(input: CreateSupportTicketInput): Promise<SupportTicketRowDto> {
    const ctx = requireContext();
    const [tenant, user, plan, ops, max] = await Promise.all([
      this.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
      ctx.userId ? this.db.user.findUnique({ where: { id: ctx.userId }, select: { email: true, name: true } }) : null,
      this.planOf(ctx.tenantId),
      platformTenantId(this.prisma.raw),
      this.db.supportTicket.aggregate({ _max: { number: true } }),
    ]);
    const floor = Math.max(FIRST_TICKET_NUMBER, (max._max.number ?? 0) + 1);
    const number = Math.max(floor, await this.seq.nextValue('support.ticket', { tenantId: ops, start: floor }));
    const code = `SUP-${number}`;
    const now = new Date();
    const t = await this.db.supportTicket.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        code,
        openedByUserId: ctx.userId ?? null,
        openedByName: ctx.userName ?? user?.name ?? 'Workspace admin',
        openedByEmail: user?.email ?? '',
        subject: input.subject,
        description: input.description,
        category: input.category,
        severity: input.severity,
        status: 'OPEN',
        planAtOpen: plan,
        firstResponseDueAt: firstResponseDue(plan, input.severity, now),
      },
    });
    const sla = slaPolicy(plan, input.severity);
    await this.audit.record({ action: 'support.ticket.opened', entity: 'SupportTicket', entityId: t.id, meta: { summary: `Opened ${code} · ${input.subject} (${SUPPORT_SEVERITY_LABELS[input.severity]})`, code, severity: input.severity } });
    if (user?.email) {
      await this.mail.send({
        to: user.email,
        subject: `[${code}] ${input.subject}`,
        text: `We received your request ${code} (${SUPPORT_SEVERITY_LABELS[input.severity]} severity).\n\nFirst response target: ${sla.label}. You can follow and reply to it under SaaS → Lexisora support.\n\n— Lexisora support`,
      });
    }
    await this.notifyPlatform(t, {
      type: 'platform.support_ticket',
      title: `New ${SUPPORT_SEVERITY_LABELS[input.severity].toLowerCase()}-severity request ${code} · ${tenant.name}`,
      body: input.subject,
      email: input.severity === 'HIGH',
    });
    this.realtime.toTenant(ctx.tenantId, 'support.ticket.updated', { id: t.id });
    return this.row(t, tenant.name, false, now);
  }

  async reply(id: string, input: SupportMessageInput): Promise<SupportTicketDetailDto> {
    const ctx = requireContext();
    const platform = !!input.asPlatform && this.platformView('platform');
    if (input.internal && !platform) throw forbidden('Internal notes are for Lexisora staff');
    const t = await this.load(id, platform);
    if (t.status === 'CLOSED') throw badRequest('This request is closed. Open a new request.', 'TICKET_CLOSED');
    const now = new Date();
    const authorName = platform ? platformActorName(ctx.userName, 'Lexisora support') : (ctx.userName ?? 'Workspace admin');
    await this.db.supportMessage.create({
      data: { tenantId: t.tenantId, ticketId: t.id, authorType: platform ? 'PLATFORM_USER' : 'TENANT_USER', authorUserId: ctx.userId ?? null, authorName, body: input.body, internal: !!input.internal },
    });
    if (platform && !input.internal) {
      const status: SupportStatusKey = t.status === 'OPEN' || t.status === 'ENGINEER_ASSIGNED' ? 'IN_PROGRESS' : (t.status as SupportStatusKey);
      await this.db.supportTicket.update({
        where: { id: t.id },
        data: { status, firstRespondedAt: t.firstRespondedAt ?? now, ...(t.assigneeUserId ? {} : { assigneeUserId: ctx.userId ?? null, assigneeName: ctx.userName ?? null }) },
      });
      await recordPlatformAccess(this.prisma.raw, t.tenantId, { action: 'platform.support.reply', entity: 'SupportTicket', entityId: t.id, actorName: authorName, ip: ctx.ip, meta: { summary: `Lexisora support replied on ${t.code}`, code: t.code } });
      await this.notifyTenant(t, { type: 'support.reply', title: `Lexisora support replied on ${t.code}`, body: input.body.slice(0, 280) });
      if (t.openedByEmail) await this.mail.send({ to: t.openedByEmail, subject: `[${t.code}] ${t.subject}`, text: `${authorName} replied:\n\n${input.body}\n\nReply under SaaS → Lexisora support.` });
    } else if (platform) {
      this.realtime.toTenant(await platformTenantId(this.prisma.raw), 'support.ticket.updated', { id: t.id });
    } else {
      const next = statusAfterCustomerReply(t.status as SupportStatusKey);
      if (next !== t.status) await this.db.supportTicket.update({ where: { id: t.id }, data: { status: next } });
      await this.audit.record({ action: 'support.ticket.message', entity: 'SupportTicket', entityId: t.id, meta: { summary: `Replied on ${t.code}`, code: t.code } });
      await this.notifyPlatform(t, { type: 'platform.support_reply', title: `${t.code}: new reply from ${ctx.userName ?? 'the customer'}`, body: input.body.slice(0, 280) });
      this.realtime.toTenant(t.tenantId, 'support.ticket.updated', { id: t.id });
    }
    return this.detail(id, platform ? 'platform' : 'tenant');
  }

  async resolve(id: string): Promise<SupportTicketDetailDto> {
    const ctx = requireContext();
    const t = await this.load(id, false);
    if (!isOpenStatus(t.status)) throw conflict('This request is already resolved');
    await this.db.supportTicket.update({ where: { id: t.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    await this.systemMessage(t, `Marked resolved by ${ctx.userName ?? 'the customer'}`);
    await this.audit.record({ action: 'support.ticket.status_changed', entity: 'SupportTicket', entityId: t.id, meta: { summary: `${t.code} marked resolved`, from: t.status, to: 'RESOLVED' } });
    await this.notifyPlatform(t, { type: 'platform.support_resolved', title: `${t.code} was marked resolved by the customer` });
    return this.detail(id, 'tenant');
  }

  async reopen(id: string): Promise<SupportTicketDetailDto> {
    const ctx = requireContext();
    const t = await this.load(id, false);
    if (!canReopen(t)) throw badRequest('This request was resolved more than 7 days ago. Open a new request.', 'REOPEN_EXPIRED');
    await this.db.supportTicket.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS', resolvedAt: null, closedAt: null, csat: null, reopenedCount: { increment: 1 } } });
    await this.systemMessage(t, `Reopened by ${ctx.userName ?? 'the customer'}`);
    await this.audit.record({ action: 'support.ticket.status_changed', entity: 'SupportTicket', entityId: t.id, meta: { summary: `${t.code} reopened`, from: t.status, to: 'IN_PROGRESS' } });
    await this.notifyPlatform(t, { type: 'platform.support_reopened', title: `${t.code} was reopened`, email: t.severity === 'HIGH' });
    return this.detail(id, 'tenant');
  }

  async rate(id: string, input: SupportCsatInput): Promise<SupportTicketDetailDto> {
    const t = await this.load(id, false);
    if (t.status !== 'RESOLVED') throw badRequest('Rate a request once it is resolved', 'NOT_RESOLVED');
    await this.db.supportTicket.update({ where: { id: t.id }, data: { csat: input.score, status: 'CLOSED', closedAt: new Date() } });
    await this.systemMessage(t, `Rated ${input.score}/5 · request closed`);
    await this.audit.record({ action: 'support.ticket.csat', entity: 'SupportTicket', entityId: t.id, meta: { summary: `${t.code} rated ${input.score}/5`, score: input.score } });
    await this.notifyPlatform(t, { type: 'platform.support_csat', title: `${t.code} rated ${input.score}/5` });
    return this.detail(id, 'tenant');
  }

  // ── Lexisora staff actions ───────────────────────────────────────────────

  async update(id: string, input: SupportUpdateInput): Promise<SupportTicketDetailDto> {
    const ctx = requireContext();
    this.platformView('platform');
    const t = await this.load(id, true);
    const actor = platformActorName(ctx.userName, 'Lexisora support');
    const data: Prisma.SupportTicketUpdateInput = {};
    const notes: string[] = [];
    let status = t.status as SupportStatusKey;
    if (input.assignToMe) {
      data.assigneeUserId = ctx.userId ?? null;
      data.assigneeName = ctx.userName ?? null;
      if (status === 'OPEN') status = 'ENGINEER_ASSIGNED';
      notes.push(`Assigned to ${ctx.userName ?? 'Lexisora support'}`);
    }
    if (input.status && input.status !== status) {
      if (!canTransition(status, input.status)) throw badRequest(`Can’t move a request from ${SUPPORT_STATUS_LABELS_PLATFORM[status]} to ${SUPPORT_STATUS_LABELS_PLATFORM[input.status]}`, 'BAD_TRANSITION');
      status = input.status;
    }
    if (status !== t.status) {
      data.status = status;
      if (status === 'RESOLVED') data.resolvedAt = new Date();
      if (status === 'CLOSED') data.closedAt = new Date();
      if (status === 'IN_PROGRESS' && t.status === 'RESOLVED') data.resolvedAt = null;
      notes.push(`Status: ${SUPPORT_STATUS_LABELS_PLATFORM[status]}`);
    }
    if (!notes.length) return this.detail(id, 'platform');
    await this.db.supportTicket.update({ where: { id: t.id }, data });
    await this.systemMessage(t, `${notes.join(' · ')} (${actor})`);
    await recordPlatformAccess(this.prisma.raw, t.tenantId, { action: 'platform.support.status_changed', entity: 'SupportTicket', entityId: t.id, actorName: actor, ip: ctx.ip, meta: { summary: `${t.code}: ${notes.join(' · ')}`, from: t.status, to: status } });
    if (status !== t.status) {
      const copy: Partial<Record<SupportStatusKey, { type: string; title: string }>> = {
        ENGINEER_ASSIGNED: { type: 'support.engineer_assigned', title: `An engineer is on ${t.code}` },
        IN_PROGRESS: { type: 'support.in_progress', title: `${t.code} is in progress` },
        WAITING_ON_CUSTOMER: { type: 'support.waiting_on_you', title: `${t.code} is waiting on you` },
        RESOLVED: { type: 'support.resolved', title: `${t.code} was resolved · rate the support you got` },
        CLOSED: { type: 'support.closed', title: `${t.code} was closed` },
      };
      const n = copy[status];
      if (n) await this.notifyTenant(t, { ...n, body: t.subject, email: status === 'WAITING_ON_CUSTOMER' || status === 'RESOLVED' });
    } else {
      this.realtime.toTenant(t.tenantId, 'support.ticket.updated', { id: t.id });
    }
    return this.detail(id, 'platform');
  }
}

@Controller('support')
@RequirePerm('support.use')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('tickets')
  list(@Query(new ZodPipe(supportQuerySchema)) q: SupportQuery) {
    return this.support.list(q);
  }

  @Post('tickets')
  create(@Body(new ZodPipe(createSupportTicketSchema)) dto: CreateSupportTicketInput) {
    return this.support.create(dto);
  }

  @Get('tickets/:id')
  detail(@Param('id') id: string, @Query(new ZodPipe(supportViewSchema)) q: { view: 'tenant' | 'platform' }) {
    return this.support.detail(id, q.view);
  }

  @Post('tickets/:id/messages')
  reply(@Param('id') id: string, @Body(new ZodPipe(supportMessageSchema)) dto: SupportMessageInput) {
    return this.support.reply(id, dto);
  }

  /** Lexisora staff: assign to me / change status. */
  @Patch('tickets/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(supportUpdateSchema)) dto: SupportUpdateInput) {
    return this.support.update(id, dto);
  }

  @Post('tickets/:id/resolve')
  @HttpCode(200)
  resolve(@Param('id') id: string) {
    return this.support.resolve(id);
  }

  @Post('tickets/:id/reopen')
  @HttpCode(200)
  reopen(@Param('id') id: string) {
    return this.support.reopen(id);
  }

  @Post('tickets/:id/csat')
  @HttpCode(200)
  rate(@Param('id') id: string, @Body(new ZodPipe(supportCsatSchema)) dto: SupportCsatInput) {
    return this.support.rate(id, dto);
  }
}
