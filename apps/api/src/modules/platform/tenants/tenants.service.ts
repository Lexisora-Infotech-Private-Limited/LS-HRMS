import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { PrismaClient, Subscription, Tenant } from '@prisma/client';
import {
  FREE_SEATS,
  GROWTH_PRICE_PAISE,
  GST_STATE_NAMES,
  ROLE_KEYS,
  ROLE_LABELS,
  ROOT_DOMAIN,
  TENANT_TABS,
  createTenantSchema,
  defaultPermissionsFor,
  extendGraceSchema,
  formatDate,
  istDateKey,
  tenantNoteSchema,
  tenantsQuerySchema,
  type CreateTenantInput,
  type DomainCheckDto,
  type ExtendGraceInput,
  type ProvisionResultDto,
  type TenantDetailDto,
  type TenantNoteInput,
  type TenantRowDto,
  type TenantsQuery,
  type TenantsResponse,
  type TenantTab,
} from '@lexisora/shared';
import { env } from '../../../config/env';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { requireContext, runAsTenant } from '../../../core/context/request-context';
import { AuditService } from '../../../core/audit/audit.service';
import { MailService } from '../../../core/mail/mail.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PlatformOnly } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { AppError, badRequest, conflict, notFound } from '../../../core/http/errors';
import { SEAT_STATUSES, platformActorName, platformAdminUserIds, platformTenantId, recordPlatformAccess, renewalLabel, istStart } from '../platform.util';
import { platformReader } from '../privacy/privacy.guard';
import { auditSummary } from '../privacy/privacy.service';
import { BillingService } from '../billing/billing.service';
import { addCycle, mrrPaise, pctChange, planLabel, seatsBilled, type SubForMetrics } from '../billing/billing.logic';
import { initialQuantity, isPaidPlan, nameFromEmail, seatsFigure, slugProblem, tenantInTab, tenantPlanCode, tenantStatusOf } from './tenants.logic';

const DAY = 86_400_000;
const INVITE_TTL_DAYS = 7;

/**
 * Tenants (Lexisora platform administrators only): every workspace on the platform, KPIs,
 * provisioning, suspension / reactivation and grace extensions. All reads go through
 * `platformReader`, which refuses chat, salary and personal-document tables.
 */
@Injectable()
export class TenantsService {
  private readonly db: PrismaClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly billing: BillingService,
  ) {
    this.db = platformReader(prisma.raw);
  }

  private actor(): string {
    return platformActorName(requireContext().userName);
  }

  private toRow(t: Tenant, sub: Subscription | undefined, used: number, operator: string): TenantRowDto {
    const isOperator = t.id === operator;
    const planCode = tenantPlanCode(sub, isOperator);
    const st = tenantStatusOf(t.status, sub, isOperator);
    const quantity = sub?.quantity ?? FREE_SEATS;
    return {
      id: t.id,
      company: t.name,
      domain: t.domain,
      planCode,
      planLabel: planLabel(planCode, sub?.cycle),
      seats: seatsFigure(planCode, used, quantity),
      seatsUsed: used,
      quantity,
      renewal: isPaidPlan(planCode) ? renewalLabel(sub?.currentPeriodEnd) : '—',
      status: st.status,
      statusTone: st.tone,
      tenantStatus: t.status,
      isOperator,
      createdAt: t.createdAt.toISOString(),
    };
  }

  private async load() {
    const [tenants, subs, counts, operator] = await Promise.all([
      this.db.tenant.findMany({ orderBy: { createdAt: 'asc' } }),
      this.db.subscription.findMany(),
      this.db.user.groupBy({ by: ['tenantId'], where: { status: { in: [...SEAT_STATUSES] } }, _count: { _all: true } }),
      platformTenantId(this.prisma.raw),
    ]);
    const subBy = new Map(subs.map((s) => [s.tenantId, s]));
    const usedBy = new Map(counts.map((c) => [c.tenantId, c._count._all]));
    const rows = tenants.map((t) => this.toRow(t, subBy.get(t.id), usedBy.get(t.id) ?? 0, operator));
    // The operator's own workspace is never billed (its Subscription screen demonstrates the Growth plan).
    const billable = subs.filter((s) => s.tenantId !== operator) as unknown as SubForMetrics[];
    return { rows, subs, billable, operator };
  }

  async list(q: TenantsQuery): Promise<TenantsResponse> {
    const { rows, billable, operator } = await this.load();
    const term = q.q?.trim().toLowerCase();
    const matched = term ? rows.filter((r) => r.company.toLowerCase().includes(term) || r.domain.includes(term)) : rows;
    const counts = Object.fromEntries(TENANT_TABS.map((t) => [t, matched.filter((r) => tenantInTab(r, t)).length])) as Record<TenantTab, number>;
    const tabbed = matched.filter((r) => tenantInTab(r, q.tab));
    const monthStart = istStart(`${istDateKey().slice(0, 7)}-01`);
    const [delta, snapshot] = await Promise.all([
      this.db.subscriptionChange.aggregate({ where: { createdAt: { gte: monthStart }, tenantId: { not: operator } }, _sum: { seatDelta: true } }),
      this.db.mrrSnapshot.findFirst({ where: { date: { lte: new Date(Date.now() - 30 * DAY) } }, orderBy: { date: 'desc' } }),
    ]);
    const mrr = mrrPaise(billable);
    return {
      kpis: {
        tenants: rows.length,
        freeTier: rows.filter((r) => r.planCode === 'FREE').length,
        seatsBilled: seatsBilled(billable),
        seatsDelta: delta._sum.seatDelta ?? 0,
        mrrPaise: mrr,
        mrrDeltaPct: pctChange(mrr, snapshot?.mrrPaise),
      },
      counts,
      items: tabbed.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: tabbed.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(id: string): Promise<TenantDetailDto> {
    const { rows } = await this.load();
    const row = rows.find((r) => r.id === id);
    if (!row) throw notFound('Tenant');
    const [t, sub, admins, activeUsers, invoices, tickets, access] = await Promise.all([
      this.db.tenant.findUniqueOrThrow({ where: { id } }),
      this.db.subscription.findUnique({ where: { tenantId: id } }),
      this.db.user.findMany({ where: { tenantId: id, role: { key: 'admin' } }, select: { name: true, email: true, status: true }, orderBy: { createdAt: 'asc' } }),
      this.db.user.count({ where: { tenantId: id, status: 'ACTIVE' } }),
      this.db.saasInvoice.findMany({ where: { tenantId: id, status: { in: ['ISSUED', 'PAID', 'OVERDUE'] } }, orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }], take: 12 }),
      this.db.supportTicket.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.db.auditLog.findMany({ where: { tenantId: id, action: { startsWith: 'platform.' } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return {
      ...row,
      slug: t.slug,
      stateName: t.stateName ?? (t.stateCode ? (GST_STATE_NAMES[t.stateCode] ?? null) : null),
      customerSince: (sub?.createdAt ?? t.createdAt).toISOString(),
      adminContacts: admins,
      activeUsers,
      subscription: sub
        ? { status: sub.status, cycle: sub.cycle, currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null, pastDueSince: sub.pastDueSince?.toISOString() ?? null, graceEndsAt: sub.graceEndsAt?.toISOString() ?? null, collection: sub.collection }
        : null,
      invoices: invoices.map((i) => this.billing.toInvoiceDto(i)),
      tickets: tickets.map((k) => ({ id: k.id, code: k.code, subject: k.subject, status: k.status, severity: k.severity })),
      platformAudit: access.map((a) => ({ id: a.id, action: a.action, actorName: a.actorName ?? 'Lexisora platform', createdAt: a.createdAt.toISOString(), summary: auditSummary(a.meta, a.action) })),
    };
  }

  // ── Provisioning ─────────────────────────────────────────────────────────

  async domainCheck(raw: string): Promise<DomainCheckDto> {
    const slug = (raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(new RegExp(`\\.${ROOT_DOMAIN.replace('.', '\\.')}$`), '');
    const domain = `${slug}.${ROOT_DOMAIN}`;
    const problem = slugProblem(slug);
    if (problem) return { domain, available: false, message: problem };
    const taken = await this.db.tenant.findFirst({ where: { OR: [{ slug }, { domain }] }, select: { id: true } });
    return taken ? { domain, available: false, message: `${domain} is already taken` } : { domain, available: true, message: `${domain} is available` };
  }

  async create(input: CreateTenantInput): Promise<ProvisionResultDto> {
    const check = await this.domainCheck(input.domain);
    if (!check.available) throw new AppError(409, 'DOMAIN_TAKEN', check.message);
    const slug = input.domain;
    const domain = check.domain;
    const now = new Date();
    const paid = input.planCode !== 'FREE';
    const cycle = input.planCode === 'GROWTH' ? (input.cycle ?? 'YEARLY') : null;
    const quantity = initialQuantity(input.planCode, input.seats);
    const periodEnd = cycle ? addCycle(now, cycle) : input.planCode === 'ENTERPRISE' ? addCycle(now, 'YEARLY') : null;
    const token = randomBytes(24).toString('base64url');
    const adminName = input.adminName?.trim() || nameFromEmail(input.adminEmail);
    const actor = this.actor();

    const { tenant, admin } = await this.db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.company,
          legalName: input.company,
          domain,
          slug,
          status: paid ? 'ACTIVE' : 'FREE_TIER',
          stateCode: input.stateCode ?? null,
          stateName: input.stateCode ? (GST_STATE_NAMES[input.stateCode] ?? null) : null,
          gstin: input.gstin ?? null,
        },
      });
      const roles: Record<string, string> = {};
      for (const key of ROLE_KEYS) {
        const r = await tx.role.create({ data: { tenantId: tenant.id, key, name: ROLE_LABELS[key], isSystem: true, permissions: defaultPermissionsFor(key) } });
        roles[key] = r.id;
      }
      const admin = await tx.user.create({
        data: { tenantId: tenant.id, email: input.adminEmail, name: adminName, status: 'INVITED', roleId: roles.admin!, inviteToken: token, inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY) },
      });
      const sub = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planCode: input.planCode,
          cycle,
          status: paid ? 'ACTIVE' : 'FREE',
          quantity,
          unitPaise: cycle ? GROWTH_PRICE_PAISE[cycle] : null,
          currentPeriodStart: paid ? now : null,
          currentPeriodEnd: periodEnd,
          collection: paid ? 'OFFLINE_INVOICE' : 'GATEWAY',
        },
      });
      await tx.subscriptionChange.create({
        data: { tenantId: tenant.id, subscriptionId: sub.id, type: 'CREATED', to: { planCode: input.planCode, cycle, quantity }, seatDelta: paid ? quantity : 0, actorName: actor },
      });
      await tx.brandingVersion.create({
        data: { tenantId: tenant.id, version: 1, status: 'PUBLISHED', presetKey: 'default-gold-ink', primaryHex: '#b68235', secondaryHex: '#2d2b2b', domain, publishedByName: 'Lexisora platform', publishedAt: now },
      });
      return { tenant, admin };
    });

    const label = planLabel(input.planCode, cycle);
    if (input.planCode === 'GROWTH') await runAsTenant(tenant.id, () => this.billing.issueOpeningInvoice());
    const inviteSent = await this.sendInvite(admin.email, adminName, input.company, domain, token, label);
    const summary = `Provisioned ${input.company} (${domain}) on ${label}${paid ? ` · ${quantity} seats` : ''} · admin ${admin.email}`;
    await this.audit.record({ action: 'platform.tenant.created', entity: 'Tenant', entityId: tenant.id, meta: { summary, plan: input.planCode, seats: quantity } });
    await recordPlatformAccess(this.prisma.raw, tenant.id, { action: 'platform.tenant.created', entity: 'Tenant', entityId: tenant.id, actorName: actor, ip: requireContext().ip, meta: { summary: `Workspace created by Lexisora on ${label} · admin ${admin.email}` } });
    const me = requireContext().userId;
    const ops = (await platformAdminUserIds(this.prisma.raw)).filter((u) => u !== me);
    await this.notifications.notify({ userIds: ops, type: 'platform.tenant_provisioned', title: `Tenant provisioned: ${input.company}`, body: `${domain} · ${label}`, link: '/tenants', from: 'Platform' });
    const { rows } = await this.load();
    return { tenant: rows.find((r) => r.id === tenant.id)!, adminEmail: admin.email, inviteSent, loginUrl: `${env.WEB_ORIGIN}/login` };
  }

  private async sendInvite(to: string, name: string, company: string, domain: string, token: string, plan: string): Promise<boolean> {
    const link = `${env.WEB_ORIGIN}/accept-invite?token=${encodeURIComponent(token)}`;
    return this.mail.send({
      to,
      subject: `Your ${company} workspace on Lexisora HRMS is ready`,
      text: [
        `Hello ${name},`,
        '',
        `Lexisora has set up ${company} on Lexisora HRMS (${plan}).`,
        '',
        `Workspace: ${domain}`,
        `Set your password and sign in: ${link}`,
        '',
        `This link is valid for ${INVITE_TTL_DAYS} days. You are the workspace administrator: invite your team from People → Employees, and set your colours and logo under SaaS → Branding.`,
        '',
        '— Lexisora HRMS',
      ].join('\n'),
    });
  }

  async resendInvite(id: string): Promise<{ message: string }> {
    const t = await this.db.tenant.findUnique({ where: { id } });
    if (!t) throw notFound('Tenant');
    const invited = await this.db.user.findMany({ where: { tenantId: id, status: 'INVITED', role: { key: 'admin' } } });
    if (!invited.length) throw badRequest('The admin has already accepted the invite', 'NO_PENDING_INVITE');
    const sub = await this.db.subscription.findUnique({ where: { tenantId: id } });
    for (const u of invited) {
      const token = randomBytes(24).toString('base64url');
      await this.db.user.update({ where: { id: u.id }, data: { inviteToken: token, inviteExpiresAt: new Date(Date.now() + INVITE_TTL_DAYS * DAY) } });
      await this.sendInvite(u.email, u.name, t.name, t.domain, token, planLabel(sub?.planCode ?? 'FREE', sub?.cycle));
    }
    const to = invited.map((u) => u.email).join(', ');
    await this.audit.record({ action: 'platform.tenant.invite_resent', entity: 'Tenant', entityId: id, meta: { summary: `Resent the admin invite for ${t.name} to ${to}` } });
    await recordPlatformAccess(this.prisma.raw, id, { action: 'platform.tenant.invite_resent', entity: 'Tenant', entityId: id, actorName: this.actor(), meta: { summary: `Admin invite resent to ${to}` } });
    return { message: `Invite sent to ${to}` };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  private async loadForAction(id: string) {
    const t = await this.db.tenant.findUnique({ where: { id } });
    if (!t) throw notFound('Tenant');
    const sub = await this.db.subscription.findUnique({ where: { tenantId: id } });
    return { t, sub };
  }

  private async notifyTenantAdmins(tenantId: string, subject: string, text: string) {
    const admins = await this.db.user.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: 'admin' } }, select: { email: true } });
    if (admins.length) await this.mail.send({ to: admins.map((a) => a.email), subject, text });
  }

  async suspend(id: string, input: TenantNoteInput): Promise<TenantRowDto> {
    if (id === (await platformTenantId(this.prisma.raw))) throw badRequest('The operator workspace can’t be suspended', 'OPERATOR_TENANT');
    const { t, sub } = await this.loadForAction(id);
    if (t.status === 'SUSPENDED') throw conflict('This workspace is already suspended');
    const actor = this.actor();
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id }, data: { status: 'SUSPENDED' } });
      if (sub) {
        await tx.subscription.update({ where: { id: sub.id }, data: { status: 'SUSPENDED' } });
        await tx.subscriptionChange.create({ data: { tenantId: id, subscriptionId: sub.id, type: 'STATUS', from: { status: sub.status }, to: { status: 'SUSPENDED' }, actorName: actor } });
      }
      // End every session: refresh tokens stop working, access tokens lapse within 15 minutes.
      await tx.refreshToken.updateMany({ where: { tenantId: id, revokedAt: null }, data: { revokedAt: now } });
    });
    const why = input.reason ? ` · ${input.reason}` : '';
    await this.audit.record({ action: 'platform.tenant.suspended', entity: 'Tenant', entityId: id, meta: { summary: `Suspended ${t.name}${why}`, from: t.status, to: 'SUSPENDED' } });
    await recordPlatformAccess(this.prisma.raw, id, { action: 'platform.tenant.suspended', entity: 'Tenant', entityId: id, actorName: actor, ip: requireContext().ip, meta: { summary: `Workspace suspended by Lexisora${why}`, from: t.status, to: 'SUSPENDED' } });
    await this.notifyTenantAdmins(id, `${t.name}: your Lexisora HRMS workspace is suspended`, `Your workspace ${t.domain} has been suspended${why}. Sign-ins are blocked until it is reactivated. Reply to this email or contact billing@lexisora.com.`);
    return this.rowOf(id);
  }

  async reactivate(id: string): Promise<TenantRowDto> {
    const { t, sub } = await this.loadForAction(id);
    if (t.status !== 'SUSPENDED' && sub?.status !== 'SUSPENDED' && sub?.status !== 'READ_ONLY') throw conflict('This workspace is already active');
    const now = new Date();
    const overdue = await this.db.saasInvoice.count({ where: { tenantId: id, status: { in: ['ISSUED', 'OVERDUE'] }, dueDate: { lt: now } } });
    const free = !sub || sub.planCode === 'FREE';
    const subStatus = free ? 'FREE' : overdue ? 'PAST_DUE' : 'ACTIVE';
    const tenantStatus = free ? 'FREE_TIER' : overdue ? 'PAYMENT_DUE' : 'ACTIVE';
    const actor = this.actor();
    await this.db.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id }, data: { status: tenantStatus } });
      if (sub) {
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: subStatus, ...(overdue ? { pastDueSince: sub.pastDueSince ?? now, graceEndsAt: new Date(now.getTime() + 7 * DAY) } : { pastDueSince: null, graceEndsAt: null }) },
        });
        await tx.subscriptionChange.create({ data: { tenantId: id, subscriptionId: sub.id, type: 'STATUS', from: { status: sub.status }, to: { status: subStatus }, actorName: actor } });
      }
    });
    const note = overdue ? ` · payment still due, grace until ${formatDate(new Date(now.getTime() + 7 * DAY))}` : '';
    await this.audit.record({ action: 'platform.tenant.reactivated', entity: 'Tenant', entityId: id, meta: { summary: `Reactivated ${t.name}${note}`, from: t.status, to: tenantStatus } });
    await recordPlatformAccess(this.prisma.raw, id, { action: 'platform.tenant.reactivated', entity: 'Tenant', entityId: id, actorName: actor, ip: requireContext().ip, meta: { summary: `Workspace reactivated by Lexisora${note}`, from: t.status, to: tenantStatus } });
    await this.notifyTenantAdmins(id, `${t.name}: your Lexisora HRMS workspace is active again`, `Your workspace ${t.domain} has been reactivated. Everyone can sign in again.${note}`);
    return this.rowOf(id);
  }

  async extendGrace(id: string, input: ExtendGraceInput): Promise<TenantRowDto> {
    const { t, sub } = await this.loadForAction(id);
    if (!sub || !['PAST_DUE', 'READ_ONLY'].includes(sub.status)) throw badRequest('Only workspaces with a payment due have a grace period', 'NOT_PAST_DUE');
    const now = new Date();
    const base = sub.graceEndsAt && sub.graceEndsAt > now ? sub.graceEndsAt : now;
    const until = new Date(base.getTime() + input.days * DAY);
    const actor = this.actor();
    await this.db.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE', graceEndsAt: until, pastDueSince: sub.pastDueSince ?? now } });
    if (t.status !== 'SUSPENDED') await this.db.tenant.update({ where: { id }, data: { status: 'PAYMENT_DUE' } });
    await this.db.subscriptionChange.create({ data: { tenantId: id, subscriptionId: sub.id, type: 'STATUS', from: { status: sub.status, graceEndsAt: sub.graceEndsAt?.toISOString() ?? null }, to: { status: 'PAST_DUE', graceEndsAt: until.toISOString() }, actorName: actor } });
    const summary = `Grace period extended by ${input.days} days to ${formatDate(until)}`;
    await this.audit.record({ action: 'platform.tenant.grace_extended', entity: 'Tenant', entityId: id, meta: { summary: `${t.name}: ${summary}` } });
    await recordPlatformAccess(this.prisma.raw, id, { action: 'platform.tenant.grace_extended', entity: 'Subscription', entityId: sub.id, actorName: platformActorName(requireContext().userName, 'Lexisora billing'), meta: { summary } });
    return this.rowOf(id);
  }

  private async rowOf(id: string): Promise<TenantRowDto> {
    const { rows } = await this.load();
    const r = rows.find((x) => x.id === id);
    if (!r) throw notFound('Tenant');
    return r;
  }

  invoicePdf(tenantId: string, invoiceId: string) {
    return this.billing.invoicePdf(invoiceId, tenantId);
  }
}

@Controller('tenants')
@PlatformOnly()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list(@Query(new ZodPipe(tenantsQuerySchema)) q: TenantsQuery) {
    return this.tenants.list(q);
  }

  @Get('domain-check')
  domainCheck(@Query('domain') domain: string) {
    return this.tenants.domainCheck(domain ?? '');
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.tenants.detail(id);
  }

  @Post()
  create(@Body(new ZodPipe(createTenantSchema)) dto: CreateTenantInput) {
    return this.tenants.create(dto);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id') id: string, @Body(new ZodPipe(tenantNoteSchema)) dto: TenantNoteInput) {
    return this.tenants.suspend(id, dto);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id') id: string) {
    return this.tenants.reactivate(id);
  }

  @Post(':id/extend-grace')
  @HttpCode(200)
  extendGrace(@Param('id') id: string, @Body(new ZodPipe(extendGraceSchema)) dto: ExtendGraceInput) {
    return this.tenants.extendGrace(id, dto);
  }

  @Post(':id/resend-invite')
  @HttpCode(200)
  resendInvite(@Param('id') id: string) {
    return this.tenants.resendInvite(id);
  }

  @Get(':id/invoices/:invoiceId/pdf')
  async invoicePdf(@Param('id') id: string, @Param('invoiceId') invoiceId: string, @Res() res: Response) {
    const pdf = await this.tenants.invoicePdf(id, invoiceId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
    res.send(pdf.data);
  }
}
