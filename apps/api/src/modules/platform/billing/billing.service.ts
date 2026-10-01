import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type SaasInvoice, type Subscription, type Tenant } from '@prisma/client';
import {
  FREE_SEATS,
  GROWTH_PRICE_PAISE,
  GST_STATE_NAMES,
  YEARLY_SAVINGS_PCT,
  formatDate,
  formatINR,
  type BillingCycleKey,
  type BillingOverview,
  type BillingProfileInput,
  type CheckoutDetailDto,
  type CheckoutDto,
  type ContactSalesInput,
  type PlanCode,
  type QuoteDto,
  type QuoteInput,
  type QuoteLine,
  type SaasInvoiceDto,
  type SeatChangeResult,
  type SeatQuoteDto,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { requireContext, runAsTenant } from '../../../core/context/request-context';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { MailService } from '../../../core/mail/mail.service';
import { PdfService, PDF_COLORS } from '../../../core/pdf/pdf.service';
import { SequenceService, financialYear } from '../../../core/registry/sequence.service';
import { AppError, badRequest, conflict, notFound } from '../../../core/http/errors';
import { SEAT_STATUSES, platformAdminUserIds, platformTenantId } from '../platform.util';
import { invalidateEntitlements } from './entitlements.guard';
import { createGateway, type GatewayEvent, type PaymentGateway } from './adapters/payment-gateway';
import {
  SAC_CODE,
  SUPPLIER_GSTIN,
  addCycle,
  daysInclusive,
  invoiceNumber,
  periodLine,
  planLabel,
  prorationPaise,
  totalsFor,
  validatePromo,
  type PromoTerms,
  type Totals,
} from './billing.logic';

type Intent = {
  kind: 'UPGRADE' | 'RENEWAL' | 'SEATS' | 'SETTLE';
  planCode?: 'GROWTH';
  cycle?: BillingCycleKey;
  quantity?: number;
  periodStart?: string;
  periodEnd?: string;
};

@Injectable()
export class BillingService {
  private readonly log = new Logger('Billing');
  readonly gateway: PaymentGateway = createGateway();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly mail: MailService,
    private readonly pdf: PdfService,
    private readonly seq: SequenceService,
  ) {}

  // ── Loading ──────────────────────────────────────────────────────────────

  async tenant(): Promise<Tenant> {
    return this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: requireContext().tenantId } });
  }

  /** The tenant's subscription (a Free subscription is created on first access). */
  async subscription(): Promise<Subscription> {
    const s = await this.prisma.subscription.findFirst();
    if (s) return s;
    return this.prisma.subscription.create({ data: { planCode: 'FREE', status: 'FREE', quantity: FREE_SEATS } as any });
  }

  async seatsUsed(tenantId = requireContext().tenantId): Promise<number> {
    return this.prisma.raw.user.count({ where: { tenantId, status: { in: [...SEAT_STATUSES] } } });
  }

  private async pendingPromo(): Promise<(PromoTerms & { redemptionId: string }) | null> {
    const r = await this.prisma.promoRedemption.findFirst({ where: { status: 'PENDING' }, include: { promo: true }, orderBy: { createdAt: 'desc' } });
    if (!r) return null;
    return { redemptionId: r.id, code: r.promo.code, description: r.promo.description, percentOff: r.promo.percentOff, amountOffPaise: r.promo.amountOffPaise };
  }

  async overview(): Promise<BillingOverview> {
    const [sub, used, promo, tenant] = await Promise.all([this.subscription(), this.seatsUsed(), this.pendingPromo(), this.tenant()]);
    const plan = sub.planCode as PlanCode;
    const due = await this.prisma.saasInvoice.findFirst({ where: { status: { in: ['ISSUED', 'OVERDUE'] } }, orderBy: { createdAt: 'desc' } });
    let billingState: string | null = null;
    if (sub.status === 'PAST_DUE') {
      billingState = `Payment of ${formatINR(due?.totalPaise ?? 0)} due since ${formatDate(sub.pastDueSince)}. Workspace becomes read-only on ${formatDate(sub.graceEndsAt)}.`;
    } else if (sub.status === 'READ_ONLY') billingState = 'Your workspace is read-only until the overdue invoice is paid.';
    else if (sub.status === 'SUSPENDED') billingState = 'Your workspace is suspended. Pay the overdue invoice or contact Lexisora billing to reactivate it.';
    else if (sub.cancelAtPeriodEnd) billingState = `Downgrade to Free scheduled for ${formatDate(sub.currentPeriodEnd)}.`;
    else if (due) billingState = `Invoice ${due.number ? `${due.number} ` : ''}for ${formatINR(due.totalPaise)} is awaiting payment${due.dueDate ? ` (due ${formatDate(due.dueDate)})` : ''}.`;
    return {
      tenantName: tenant.brandName ?? tenant.name,
      dueInvoice: due ? { id: due.id, number: due.number, totalPaise: due.totalPaise } : null,
      profile: { legalName: tenant.legalName ?? tenant.name, gstin: tenant.gstin, stateCode: tenant.stateCode, stateName: tenant.stateName ?? (tenant.stateCode ? (GST_STATE_NAMES[tenant.stateCode] ?? null) : null), address: tenant.address },
      planCode: plan,
      planName: planLabel(plan, sub.cycle),
      cycle: sub.cycle,
      status: sub.status,
      quantity: plan === 'FREE' ? FREE_SEATS : sub.quantity,
      seatsUsed: used,
      freeSeats: FREE_SEATS,
      prices: { ...GROWTH_PRICE_PAISE },
      savingsPct: YEARLY_SAVINGS_PCT,
      currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      pendingChange: (sub.pendingChange as BillingOverview['pendingChange']) ?? null,
      pastDueSince: sub.pastDueSince?.toISOString() ?? null,
      graceEndsAt: sub.graceEndsAt?.toISOString() ?? null,
      promo: promo ? { code: promo.code, description: promo.description } : null,
      gateway: this.gateway.name,
      billingState,
    };
  }

  // ── Quotes & checkout ────────────────────────────────────────────────────

  /** Period an upgrade/renewal would cover. Renewals start when the current period ends. */
  private periodFor(sub: Subscription, cycle: BillingCycleKey, now = new Date()) {
    const renewing = sub.planCode === 'GROWTH' && sub.currentPeriodEnd && sub.currentPeriodEnd > now && sub.status === 'ACTIVE';
    const start = renewing ? sub.currentPeriodEnd! : now;
    return { kind: (sub.planCode === 'GROWTH' ? 'RENEWAL' : 'UPGRADE') as Intent['kind'], start, end: addCycle(start, cycle) };
  }

  private toQuote(t: Totals, start: Date, end: Date, promo: string | null): QuoteDto {
    return { ...t, periodStart: start.toISOString(), periodEnd: end.toISOString(), promo };
  }

  async quote(input: QuoteInput): Promise<QuoteDto> {
    const [sub, tenant, used, promo] = await Promise.all([this.subscription(), this.tenant(), this.seatsUsed(), this.pendingPromo()]);
    if (sub.planCode === 'ENTERPRISE' || sub.planCode === 'INTERNAL') throw badRequest('Your plan is billed by contract. Contact Lexisora sales to change it.');
    if (input.quantity < used) throw badRequest(`You have ${used} active users — buy at least ${used} seats`, 'SEATS_BELOW_USAGE');
    const p = this.periodFor(sub, input.cycle);
    const t = totalsFor([periodLine(input.cycle, input.quantity)], tenant.stateCode ?? '24', promo);
    return this.toQuote(t, p.start, p.end, promo?.code ?? null);
  }

  private async createOrder(invoice: SaasInvoice, intent: Intent, tenantName: string): Promise<CheckoutDto> {
    const { orderId } = await this.gateway.createOrder({ invoiceId: invoice.id, amountPaise: invoice.totalPaise, notes: { tenant: tenantName, kind: intent.kind } });
    await this.prisma.saasPayment.create({
      data: { invoiceId: invoice.id, gateway: this.gateway.name, gatewayOrderId: orderId, amountPaise: invoice.totalPaise, intent: intent as Prisma.InputJsonValue } as any,
    });
    await this.audit.record({ action: 'billing.checkout.started', entity: 'SaasInvoice', entityId: invoice.id, meta: { summary: `Checkout started · ${formatINR(invoice.totalPaise)} · ${intent.kind.toLowerCase()}`, orderId } });
    return { orderId, gateway: this.gateway.name, amountPaise: invoice.totalPaise, checkoutPath: `/billing/checkout/${orderId}`, keyId: this.gateway.keyId };
  }

  /** Void earlier unpaid drafts of the same kind (a new checkout supersedes them). */
  private async supersedeDrafts(kind: string) {
    const drafts = await this.prisma.saasInvoice.findMany({ where: { status: 'DRAFT', kind }, select: { id: true } });
    if (!drafts.length) return;
    await this.prisma.saasInvoice.updateMany({ where: { id: { in: drafts.map((d) => d.id) } }, data: { status: 'VOID' } });
    await this.prisma.saasPayment.updateMany({ where: { invoiceId: { in: drafts.map((d) => d.id) }, status: 'CREATED' }, data: { status: 'FAILED', failureReason: 'Superseded by a newer checkout' } });
  }

  async checkout(input: QuoteInput): Promise<CheckoutDto> {
    const q = await this.quote(input);
    const [sub, tenant, promo] = await Promise.all([this.subscription(), this.tenant(), this.pendingPromo()]);
    const p = this.periodFor(sub, input.cycle);
    await this.supersedeDrafts(p.kind);
    const invoice = await this.prisma.saasInvoice.create({
      data: {
        subscriptionId: sub.id,
        kind: p.kind,
        periodStart: p.start,
        periodEnd: p.end,
        planCode: 'GROWTH',
        cycle: input.cycle,
        quantity: input.quantity,
        lines: q.lines as unknown as Prisma.InputJsonValue,
        subtotalPaise: q.subtotalPaise,
        discountPaise: q.discountPaise,
        taxablePaise: q.taxablePaise,
        cgstPaise: q.cgstPaise,
        sgstPaise: q.sgstPaise,
        igstPaise: q.igstPaise,
        roundOffPaise: q.roundOffPaise,
        totalPaise: q.totalPaise,
        placeOfSupply: q.placeOfSupply,
        recipientGstin: tenant.gstin,
        promoRedemptionId: promo?.redemptionId ?? null,
        status: 'DRAFT',
      } as any,
    });
    return this.createOrder(invoice, { kind: p.kind, planCode: 'GROWTH', cycle: input.cycle, quantity: input.quantity, periodStart: p.start.toISOString(), periodEnd: p.end.toISOString() }, tenant.brandName ?? tenant.name);
  }

  /** Pay an issued / overdue invoice (Payment due banner → Pay now). */
  async payInvoice(id: string): Promise<CheckoutDto> {
    const inv = await this.prisma.saasInvoice.findUnique({ where: { id } });
    if (!inv) throw notFound('Invoice');
    if (!['ISSUED', 'OVERDUE'].includes(inv.status)) throw conflict('This invoice is not awaiting payment');
    const tenant = await this.tenant();
    return this.createOrder(inv, { kind: 'SETTLE' }, tenant.brandName ?? tenant.name);
  }

  async changeSeats(quantity: number): Promise<SeatChangeResult> {
    const [sub, used, tenant] = await Promise.all([this.subscription(), this.seatsUsed(), this.tenant()]);
    if (sub.planCode !== 'GROWTH') throw badRequest(sub.planCode === 'FREE' ? 'Upgrade to Growth to buy more seats' : 'Seats on your plan are managed by Lexisora sales');
    if (quantity < used) throw badRequest(`You have ${used} active users — seats can’t go below that`, 'SEATS_BELOW_USAGE');
    if (quantity < FREE_SEATS + 1) throw badRequest('Growth needs at least 11 seats');
    if (quantity === sub.quantity) throw badRequest('That’s your current seat count');
    const cycle = sub.cycle ?? 'YEARLY';
    if (quantity < sub.quantity) {
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { pendingChange: { ...((sub.pendingChange as object) ?? {}), quantity } } });
      await this.prisma.subscriptionChange.create({ data: { subscriptionId: sub.id, type: 'SEATS_REDUCE_SCHEDULED', from: { quantity: sub.quantity }, to: { quantity }, actorName: requireContext().userName } as any });
      await this.audit.record({ action: 'billing.seats.changed', entity: 'Subscription', entityId: sub.id, meta: { summary: `Seats ${sub.quantity} → ${quantity} scheduled for renewal`, from: sub.quantity, to: quantity } });
      return { scheduled: { quantity, effective: sub.currentPeriodEnd?.toISOString() ?? null }, message: `Seats will drop to ${quantity} on ${formatDate(sub.currentPeriodEnd)}` };
    }
    const now = new Date();
    const start = sub.currentPeriodStart ?? now;
    const end = sub.currentPeriodEnd ?? addCycle(now, cycle);
    const remaining = daysInclusive(now, end);
    const total = daysInclusive(start, end) || 1;
    const amount = prorationPaise(sub.quantity, quantity, cycle, remaining, total, sub.unitPaise ?? GROWTH_PRICE_PAISE[cycle]);
    const lines: QuoteLine[] = [
      { kind: 'PRORATION', description: `Add ${quantity - sub.quantity} seats · ${remaining} of ${total} days left in the period`, quantity: quantity - sub.quantity, unitPaise: amount, amountPaise: amount },
    ];
    const t = totalsFor(lines, tenant.stateCode ?? '24', null);
    await this.supersedeDrafts('SEATS');
    const invoice = await this.prisma.saasInvoice.create({
      data: { subscriptionId: sub.id, kind: 'SEATS', periodStart: now, periodEnd: end, planCode: 'GROWTH', cycle, quantity, lines: t.lines as unknown as Prisma.InputJsonValue, subtotalPaise: t.subtotalPaise, discountPaise: 0, taxablePaise: t.taxablePaise, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise, roundOffPaise: t.roundOffPaise, totalPaise: t.totalPaise, placeOfSupply: t.placeOfSupply, recipientGstin: tenant.gstin, status: 'DRAFT' } as any,
    });
    const checkout = await this.createOrder(invoice, { kind: 'SEATS', quantity }, tenant.brandName ?? tenant.name);
    return { checkout, message: `Adding ${quantity - sub.quantity} seats: ${formatINR(t.taxablePaise, { decimals: true })} prorated + GST` };
  }

  async seatQuote(quantity: number): Promise<SeatQuoteDto> {
    const sub = await this.subscription();
    const tenant = await this.tenant();
    const cycle = sub.cycle ?? 'YEARLY';
    const now = new Date();
    const end = sub.currentPeriodEnd ?? addCycle(now, cycle);
    const remaining = daysInclusive(now, end);
    const total = daysInclusive(sub.currentPeriodStart ?? now, end) || 1;
    const amount = prorationPaise(sub.quantity, quantity, cycle, remaining, total, sub.unitPaise ?? GROWTH_PRICE_PAISE[cycle]);
    const t = totalsFor([{ kind: 'PRORATION', description: '', quantity: 1, unitPaise: amount, amountPaise: amount }], tenant.stateCode ?? '24');
    return { quantity, addedSeats: quantity - sub.quantity, amountPaise: amount, totalPaise: amount ? t.totalPaise : 0, remainingDays: remaining, totalDays: total };
  }

  /** Billing details on the invoice (legal name, GSTIN, place of supply). */
  async updateProfile(input: BillingProfileInput): Promise<BillingOverview> {
    const t = await this.tenant();
    const data = { legalName: input.legalName, gstin: input.gstin, stateCode: input.stateCode, stateName: GST_STATE_NAMES[input.stateCode] ?? null, address: input.address };
    await this.prisma.raw.tenant.update({ where: { id: t.id }, data });
    await this.audit.record({
      action: 'billing.profile.updated',
      entity: 'Tenant',
      entityId: t.id,
      meta: { summary: `Billing details updated · ${data.stateName ?? input.stateCode}${input.gstin ? ` · GSTIN ${input.gstin}` : ''}`, changes: { legalName: [t.legalName, input.legalName], gstin: [t.gstin, input.gstin], stateCode: [t.stateCode, input.stateCode] } },
    });
    return this.overview();
  }

  /**
   * First invoice for a paid tenant provisioned by Lexisora (Tenants → Add tenant): issued at once,
   * collected offline Net 15 — or paid by the tenant admin from Subscription & billing → Pay now.
   * Runs in the new tenant's context.
   */
  async issueOpeningInvoice(): Promise<SaasInvoice | null> {
    const [sub, tenant] = await Promise.all([this.subscription(), this.tenant()]);
    if (sub.planCode !== 'GROWTH' || !sub.cycle || !sub.currentPeriodStart || !sub.currentPeriodEnd) return null;
    const now = new Date();
    const t = totalsFor([periodLine(sub.cycle, sub.quantity, sub.unitPaise ?? GROWTH_PRICE_PAISE[sub.cycle])], tenant.stateCode ?? '24');
    const { number, fy } = await this.nextInvoiceNumber(now);
    const inv = await this.prisma.saasInvoice.create({
      data: {
        number,
        fyLabel: fy,
        issueDate: now,
        dueDate: new Date(now.getTime() + 15 * 86_400_000),
        subscriptionId: sub.id,
        kind: 'UPGRADE',
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
        planCode: 'GROWTH',
        cycle: sub.cycle,
        quantity: sub.quantity,
        lines: t.lines as unknown as Prisma.InputJsonValue,
        subtotalPaise: t.subtotalPaise,
        discountPaise: t.discountPaise,
        taxablePaise: t.taxablePaise,
        cgstPaise: t.cgstPaise,
        sgstPaise: t.sgstPaise,
        igstPaise: t.igstPaise,
        roundOffPaise: t.roundOffPaise,
        totalPaise: t.totalPaise,
        placeOfSupply: t.placeOfSupply,
        recipientGstin: tenant.gstin,
        status: 'ISSUED',
      } as any,
    });
    await this.audit.record({ action: 'billing.invoice.issued', entity: 'SaasInvoice', entityId: inv.id, meta: { summary: `Issued ${number} · ${formatINR(inv.totalPaise)} · due in 15 days`, number } });
    return inv;
  }

  /** Next "LXS/26-27/0005": the platform sequence, starting after any invoice numbers already issued this FY. */
  private async nextInvoiceNumber(now = new Date()): Promise<{ number: string; fy: string }> {
    const fy = financialYear(now);
    const prefix = invoiceNumber(fy, 0).slice(0, -4);
    const last = await this.prisma.raw.saasInvoice.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: 'desc' }, select: { number: true } });
    const start = last?.number ? Number(last.number.slice(prefix.length)) + 1 : 1;
    const n = await this.seq.nextValue('saas.invoice', { tenantId: await platformTenantId(this.prisma.raw), period: fy, start });
    return { number: invoiceNumber(fy, Math.max(n, start)), fy };
  }

  async downgrade(): Promise<{ message: string }> {
    const [sub, used] = await Promise.all([this.subscription(), this.seatsUsed()]);
    if (sub.planCode !== 'GROWTH') throw badRequest('Only Growth subscriptions can be downgraded here');
    await this.prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
    await this.prisma.subscriptionChange.create({ data: { subscriptionId: sub.id, type: 'DOWNGRADE_SCHEDULED', from: { planCode: 'GROWTH' }, to: { planCode: 'FREE' }, actorName: requireContext().userName } as any });
    await this.audit.record({ action: 'billing.plan.changed', entity: 'Subscription', entityId: sub.id, meta: { summary: `Downgrade to Free scheduled for ${formatDate(sub.currentPeriodEnd)}` } });
    const warn = used > FREE_SEATS ? ` Deactivate ${used - FREE_SEATS} users before then — Free allows 10.` : '';
    return { message: `Downgrade scheduled for ${formatDate(sub.currentPeriodEnd)}.${warn}` };
  }

  async cancelDowngrade(): Promise<{ message: string }> {
    const sub = await this.subscription();
    if (!sub.cancelAtPeriodEnd) throw badRequest('No downgrade is scheduled');
    await this.prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false } });
    await this.audit.record({ action: 'billing.plan.changed', entity: 'Subscription', entityId: sub.id, meta: { summary: 'Cancelled the scheduled downgrade' } });
    return { message: 'Downgrade cancelled · you stay on Growth' };
  }

  async applyPromo(code: string): Promise<{ message: string }> {
    const [sub, promo] = await Promise.all([this.subscription(), this.prisma.promoCode.findUnique({ where: { code } })]);
    const already = promo ? await this.prisma.promoRedemption.findFirst({ where: { promoId: promo.id } }) : null;
    const check = validatePromo(promo, { now: new Date(), planCode: sub.planCode as PlanCode, cycle: sub.cycle, alreadyRedeemed: !!already });
    if (!check.ok) throw new AppError(check.status, check.code, check.message);
    // A newer promo replaces a pending one.
    await this.prisma.promoRedemption.updateMany({ where: { status: 'PENDING' }, data: { status: 'VOID' } });
    await this.prisma.promoRedemption.create({ data: { promoId: promo!.id, subscriptionId: sub.id, status: 'PENDING', cyclesRemaining: promo!.durationCycles ?? 1, redeemedByName: requireContext().userName } as any });
    await this.prisma.promoCode.update({ where: { id: promo!.id }, data: { redeemedCount: { increment: 1 } } });
    await this.prisma.subscriptionChange.create({ data: { subscriptionId: sub.id, type: 'PROMO_APPLIED', to: { code }, actorName: requireContext().userName } as any });
    await this.audit.record({ action: 'billing.promo.redeemed', entity: 'PromoCode', entityId: promo!.id, meta: { summary: `Applied promo ${code} · ${promo!.description}`, code } });
    return { message: `Promo applied · ${promo!.description}` };
  }

  async contactSales(input: ContactSalesInput): Promise<{ message: string }> {
    const tenant = await this.tenant();
    const lead = await this.prisma.salesLead.create({ data: { name: input.name, email: input.email, phone: input.phone ?? null, seats: input.seats ?? null, message: input.message ?? null } as any });
    await this.audit.record({ action: 'billing.sales.requested', entity: 'SalesLead', entityId: lead.id, meta: { summary: `Enterprise enquiry from ${input.name}${input.seats ? ` · ${input.seats} seats` : ''}` } });
    const opsTenant = await platformTenantId(this.prisma.raw);
    const ops = await platformAdminUserIds(this.prisma.raw);
    await runAsTenant(opsTenant, () =>
      this.notifications.notify({ userIds: ops, type: 'platform.sales_lead', title: `Enterprise enquiry: ${tenant.name}`, body: `${input.name} <${input.email}>${input.phone ? ` · ${input.phone}` : ''}${input.seats ? ` · ${input.seats} seats` : ''}\n\n${input.message ?? ''}`, link: '/tenants', from: 'Sales', email: true }),
    );
    return { message: 'Request noted' };
  }

  // ── Invoices ─────────────────────────────────────────────────────────────

  private invoiceDescription(i: SaasInvoice): string {
    if (i.kind === 'SEATS') return `Additional seats · now ${i.quantity}`;
    if (i.kind === 'ENTERPRISE') return `Enterprise contract · ${i.quantity} seats`;
    return `${planLabel(i.planCode, i.cycle)} · ${i.quantity} seats`;
  }

  toInvoiceDto(i: SaasInvoice): SaasInvoiceDto {
    return {
      id: i.id,
      number: i.number,
      issueDate: i.issueDate?.toISOString() ?? null,
      periodStart: i.periodStart.toISOString(),
      periodEnd: i.periodEnd.toISOString(),
      description: this.invoiceDescription(i),
      amountPaise: i.taxablePaise,
      gstPaise: i.cgstPaise + i.sgstPaise + i.igstPaise,
      totalPaise: i.totalPaise,
      status: i.status,
    };
  }

  async invoices(): Promise<SaasInvoiceDto[]> {
    const rows = await this.prisma.saasInvoice.findMany({ where: { status: { in: ['ISSUED', 'PAID', 'OVERDUE'] } }, orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }] });
    return rows.map((r) => this.toInvoiceDto(r));
  }

  async invoicePdf(id: string, tenantId?: string): Promise<{ filename: string; data: Buffer }> {
    const inv = tenantId ? await this.prisma.raw.saasInvoice.findFirst({ where: { id, tenantId } }) : await this.prisma.saasInvoice.findUnique({ where: { id } });
    if (!inv || inv.status === 'DRAFT' || inv.status === 'VOID') throw notFound('Invoice');
    const tenant = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: inv.tenantId } });
    const lines = (inv.lines as unknown as QuoteLine[]) ?? [];
    const rs = (p: number) => `Rs. ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const data = await this.pdf.render((doc) => {
      this.pdf.header(doc, 'Lexisora Infotech Pvt Ltd', 'Tax invoice · HRMS subscription', PDF_COLORS.accent);
      this.pdf.keyValues(doc, [
        ['Invoice no.', inv.number ?? '—'],
        ['Invoice date', formatDate(inv.issueDate)],
        ['Supplier GSTIN', SUPPLIER_GSTIN],
        ['Billed to', `${tenant.legalName ?? tenant.name}`],
        ['Recipient GSTIN', inv.recipientGstin ?? 'Unregistered'],
        ['Place of supply', `${tenant.stateName ?? ''} (${inv.placeOfSupply})`],
        ['Service period', `${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}`],
        ['SAC', SAC_CODE],
        ['Status', inv.status],
      ]);
      doc.moveDown(1);
      this.pdf.table(doc, ['Description', 'Qty', 'Amount'], lines.map((l) => [l.description, String(l.quantity), rs(l.amountPaise)]), [0.66, 0.1, 0.24], [1, 2]);
      doc.moveDown(0.8);
      const tax: [string, string][] = [['Taxable value', rs(inv.taxablePaise)]];
      if (inv.cgstPaise) tax.push(['CGST 9%', rs(inv.cgstPaise)], ['SGST 9%', rs(inv.sgstPaise)]);
      if (inv.igstPaise) tax.push(['IGST 18%', rs(inv.igstPaise)]);
      if (inv.roundOffPaise) tax.push(['Round off', rs(inv.roundOffPaise)]);
      tax.push(['Total', rs(inv.totalPaise)]);
      this.pdf.keyValues(doc, tax, 360);
      doc.moveDown(2);
      doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.muted).text('Lexisora Infotech Pvt Ltd · 4th Floor, Titanium City Centre, Satellite, Ahmedabad 380015 · This is a computer-generated invoice.');
    });
    return { filename: `${(inv.number ?? inv.id).replace(/\//g, '-')}.pdf`, data };
  }

  // ── Payments ─────────────────────────────────────────────────────────────

  async checkoutDetail(orderId: string): Promise<CheckoutDetailDto> {
    const pay = await this.prisma.saasPayment.findUnique({ where: { gatewayOrderId: orderId }, include: { invoice: true } });
    if (!pay) throw notFound('Checkout');
    const tenant = await this.tenant();
    const i = pay.invoice;
    const quote: QuoteDto = {
      lines: i.lines as unknown as QuoteLine[],
      subtotalPaise: i.subtotalPaise,
      discountPaise: i.discountPaise,
      taxablePaise: i.taxablePaise,
      cgstPaise: i.cgstPaise,
      sgstPaise: i.sgstPaise,
      igstPaise: i.igstPaise,
      roundOffPaise: i.roundOffPaise,
      totalPaise: i.totalPaise,
      placeOfSupply: i.placeOfSupply,
      periodStart: i.periodStart.toISOString(),
      periodEnd: i.periodEnd.toISOString(),
      promo: null,
    };
    return { orderId, status: pay.status, gateway: pay.gateway, amountPaise: pay.amountPaise, tenantName: tenant.brandName ?? tenant.name, description: this.invoiceDescription(i), quote };
  }

  /** Mock checkout page → signed webhook to ourselves (same path a real gateway takes). */
  async confirmMock(orderId: string, outcome: 'success' | 'fail'): Promise<{ status: string; message: string }> {
    const pay = await this.prisma.saasPayment.findUnique({ where: { gatewayOrderId: orderId } });
    if (!pay) throw notFound('Checkout');
    if (pay.gateway !== 'MOCK' || this.gateway.name !== 'MOCK') throw badRequest('This order is paid on the payment gateway’s own checkout', 'GATEWAY_CHECKOUT');
    if (pay.status !== 'CREATED') return { status: pay.status, message: pay.status === 'CAPTURED' ? 'Already paid' : 'This checkout is closed' };
    const event: GatewayEvent = {
      id: `evt_${orderId}_${outcome}`,
      type: outcome === 'success' ? 'payment.captured' : 'payment.failed',
      orderId,
      paymentId: `pay_${orderId.slice(-10)}`,
      amountPaise: pay.amountPaise,
      reason: outcome === 'fail' ? 'Card declined by issuing bank' : undefined,
    };
    await this.processEvent(event, true);
    const after = await this.prisma.saasPayment.findUniqueOrThrow({ where: { gatewayOrderId: orderId } });
    return { status: after.status, message: after.status === 'CAPTURED' ? 'Payment received · subscription updated' : 'Payment failed · nothing was charged' };
  }

  /** Public webhook: verify, dedupe, then process in the paying tenant's context. */
  async handleWebhook(gatewayName: string, headers: Record<string, string | string[] | undefined>, body: unknown) {
    if (gatewayName.toUpperCase() !== this.gateway.name) throw badRequest('Unknown gateway');
    const { valid, event } = this.gateway.verifyWebhook(headers, body);
    if (!valid || !event) throw new AppError(400, 'INVALID_SIGNATURE', 'Invalid webhook signature');
    const pay = await this.prisma.raw.saasPayment.findUnique({ where: { gatewayOrderId: event.orderId } });
    if (!pay) return { ok: true, ignored: 'unknown order' };
    await runAsTenant(pay.tenantId, () => this.processEvent(event, true));
    return { ok: true };
  }

  async processEvent(event: GatewayEvent, signatureValid: boolean) {
    const pay = await this.prisma.saasPayment.findUnique({ where: { gatewayOrderId: event.orderId }, include: { invoice: true } });
    if (!pay) return;
    const seen = await this.prisma.raw.gatewayWebhookEvent.findUnique({ where: { eventId: event.id } });
    if (seen) return;
    await this.prisma.gatewayWebhookEvent.create({ data: { gateway: pay.gateway, eventId: event.id, type: event.type, payload: event as unknown as Prisma.InputJsonValue, signatureValid } as any });
    if (pay.status !== 'CREATED') return;
    if (event.type === 'payment.captured') await this.onCaptured(pay.id, event);
    else await this.onFailed(pay.id, event);
    await this.prisma.gatewayWebhookEvent.updateMany({ where: { eventId: event.id }, data: { processedAt: new Date() } });
  }

  private async billingAdmins(): Promise<string[]> {
    return this.notifications.usersWithPermission('billing.manage');
  }

  private async onCaptured(paymentId: string, event: GatewayEvent) {
    const pay = await this.prisma.saasPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: true } });
    const intent = pay.intent as unknown as Intent;
    const sub = await this.subscription();
    const now = new Date();
    const inv = pay.invoice;
    const number = inv.number ?? (await this.nextInvoiceNumber(now)).number;
    await this.prisma.saasPayment.update({ where: { id: pay.id }, data: { status: 'CAPTURED', gatewayPaymentId: event.paymentId ?? null } });
    await this.prisma.saasInvoice.update({ where: { id: inv.id }, data: { status: 'PAID', paidAt: now, number, fyLabel: financialYear(inv.issueDate ?? now), issueDate: inv.issueDate ?? now, dueDate: inv.dueDate ?? now } });

    const before = { planCode: sub.planCode, cycle: sub.cycle, quantity: sub.quantity, status: sub.status };
    const data: Prisma.SubscriptionUpdateInput = { status: 'ACTIVE', pastDueSince: null, graceEndsAt: null };
    let type = 'RENEWED';
    if (intent.kind === 'UPGRADE' || intent.kind === 'RENEWAL') {
      type = intent.kind === 'UPGRADE' ? 'UPGRADE' : sub.cycle !== intent.cycle ? 'CYCLE_CHANGE' : 'RENEWED';
      Object.assign(data, {
        planCode: 'GROWTH',
        cycle: intent.cycle,
        quantity: intent.quantity,
        unitPaise: GROWTH_PRICE_PAISE[intent.cycle!],
        currentPeriodStart: intent.kind === 'UPGRADE' ? new Date(intent.periodStart!) : (sub.currentPeriodStart ?? new Date(intent.periodStart!)),
        currentPeriodEnd: new Date(intent.periodEnd!),
        cancelAtPeriodEnd: false,
        pendingChange: Prisma.DbNull,
      });
      // An early renewal extends the current period; the new period starts when this one ends.
      if (intent.kind === 'RENEWAL') data.currentPeriodEnd = new Date(intent.periodEnd!);
    } else if (intent.kind === 'SEATS') {
      type = 'SEATS_ADDED';
      data.quantity = intent.quantity;
    }
    await this.prisma.subscription.update({ where: { id: sub.id }, data });
    invalidateEntitlements(sub.tenantId);
    const newQty = (data.quantity as number | undefined) ?? sub.quantity;
    await this.prisma.subscriptionChange.create({
      data: { subscriptionId: sub.id, type, from: before as Prisma.InputJsonValue, to: { planCode: data.planCode ?? sub.planCode, cycle: data.cycle ?? sub.cycle, quantity: newQty } as Prisma.InputJsonValue, seatDelta: before.planCode === 'FREE' ? newQty : newQty - sub.quantity, actorName: requireContext().userName ?? 'Payment gateway' } as any,
    });
    if (inv.promoRedemptionId) {
      await this.prisma.promoRedemption.update({ where: { id: inv.promoRedemptionId }, data: { status: 'APPLIED', appliedInvoiceIds: { push: inv.id }, cyclesRemaining: { decrement: 1 } } });
    }
    const tenant = await this.tenant();
    if (tenant.status !== 'SUSPENDED') await this.prisma.raw.tenant.update({ where: { id: tenant.id }, data: { status: 'ACTIVE' } });
    await this.audit.record({ action: 'billing.payment.captured', entity: 'SaasInvoice', entityId: inv.id, meta: { summary: `Paid ${number} · ${formatINR(inv.totalPaise)}`, number, orderId: pay.gatewayOrderId } });

    const pdf = await this.invoicePdf(inv.id).catch(() => null);
    const admins = await this.billingAdmins();
    await this.notifications.notify({ userIds: admins, type: 'billing.payment_succeeded', title: `Payment received · ${number} · ${formatINR(inv.totalPaise)}`, body: `Thank you — your ${planLabel(data.planCode as string ?? sub.planCode, (data.cycle as string) ?? sub.cycle)} subscription is active until ${formatDate((data.currentPeriodEnd as Date) ?? sub.currentPeriodEnd)}.`, link: '/billing', from: 'Billing' });
    if (pdf) {
      const users = await this.prisma.user.findMany({ where: { id: { in: admins } }, select: { email: true } });
      if (users.length) await this.mail.send({ to: users.map((u) => u.email), subject: `Lexisora HRMS invoice ${number}`, text: `Your payment of ${formatINR(inv.totalPaise)} was received. The tax invoice is attached.`, attachments: [{ filename: pdf.filename, content: pdf.data, contentType: 'application/pdf' }] });
    }
    this.realtime.toTenant(tenant.id, 'billing.updated', { status: 'ACTIVE' });
  }

  private async onFailed(paymentId: string, event: GatewayEvent) {
    const pay = await this.prisma.saasPayment.update({ where: { id: paymentId }, data: { status: 'FAILED', failureReason: event.reason ?? 'Payment failed' }, include: { invoice: true } });
    if (pay.invoice.status === 'DRAFT') await this.prisma.saasInvoice.update({ where: { id: pay.invoiceId }, data: { status: 'VOID' } });
    await this.audit.record({ action: 'billing.payment.failed', entity: 'SaasInvoice', entityId: pay.invoiceId, meta: { summary: `Payment failed · ${formatINR(pay.amountPaise)} · ${event.reason ?? ''}`, orderId: pay.gatewayOrderId } });
    await this.notifications.notify({ userIds: await this.billingAdmins(), type: 'billing.payment_failed', title: `Payment of ${formatINR(pay.amountPaise)} failed`, body: event.reason ?? 'The payment could not be completed. Nothing was charged.', link: '/billing', from: 'Billing', email: true });
    this.realtime.toTenant(pay.tenantId, 'billing.updated', { status: 'FAILED' });
  }

  // ── Renewals & dunning (run by BillingJobs across tenants) ───────────────

  /** Issue the renewal invoice for a subscription whose period ended, or apply a scheduled downgrade. */
  async renewOrDowngrade(sub: Subscription): Promise<void> {
    const now = new Date();
    const used = await this.seatsUsed(sub.tenantId);
    const admins = await this.billingAdmins();
    if (sub.cancelAtPeriodEnd) {
      if (used > FREE_SEATS) {
        await this.notifications.notify({ userIds: admins, type: 'billing.downgrade_blocked', title: `Downgrade blocked: ${used} active users`, body: `Free allows ${FREE_SEATS}. Deactivate ${used - FREE_SEATS} users, then retry.`, link: '/billing', from: 'Billing', email: true });
        return;
      }
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { planCode: 'FREE', status: 'FREE', cycle: null, quantity: FREE_SEATS, unitPaise: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, pendingChange: Prisma.DbNull } });
      await this.prisma.subscriptionChange.create({ data: { subscriptionId: sub.id, type: 'DOWNGRADE_APPLIED', from: { planCode: 'GROWTH', quantity: sub.quantity }, to: { planCode: 'FREE' }, seatDelta: -sub.quantity, actorName: 'System' } as any });
      await this.prisma.raw.tenant.update({ where: { id: sub.tenantId }, data: { status: 'FREE_TIER' } });
      invalidateEntitlements(sub.tenantId);
      await this.notifications.notify({ userIds: admins, type: 'billing.plan_changed', title: 'You are now on the Free plan', link: '/billing', from: 'Billing' });
      return;
    }
    const pending = (sub.pendingChange as { quantity?: number; cycle?: BillingCycleKey } | null) ?? {};
    const cycle = pending.cycle ?? sub.cycle ?? 'YEARLY';
    const quantity = Math.max(pending.quantity ?? sub.quantity, used);
    const tenant = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: sub.tenantId } });
    const promo = await this.pendingPromo();
    const start = sub.currentPeriodEnd ?? now;
    const end = addCycle(start, cycle);
    const t = totalsFor([periodLine(cycle, quantity)], tenant.stateCode ?? '24', promo);
    const { number, fy } = await this.nextInvoiceNumber(now);
    const inv = await this.prisma.saasInvoice.create({
      data: { number, fyLabel: fy, issueDate: now, dueDate: now, subscriptionId: sub.id, kind: 'RENEWAL', periodStart: start, periodEnd: end, planCode: sub.planCode, cycle, quantity, lines: t.lines as unknown as Prisma.InputJsonValue, subtotalPaise: t.subtotalPaise, discountPaise: t.discountPaise, taxablePaise: t.taxablePaise, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise, roundOffPaise: t.roundOffPaise, totalPaise: t.totalPaise, placeOfSupply: t.placeOfSupply, recipientGstin: tenant.gstin, promoRedemptionId: promo?.redemptionId ?? null, status: 'ISSUED' } as any,
    });
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'PAST_DUE', cycle, quantity, currentPeriodStart: start, currentPeriodEnd: end, pendingChange: Prisma.DbNull, pastDueSince: now, graceEndsAt: new Date(start.getTime() + 7 * 86400_000) },
    });
    await this.prisma.raw.tenant.update({ where: { id: sub.tenantId }, data: { status: 'PAYMENT_DUE' } });
    invalidateEntitlements(sub.tenantId);
    await this.notifications.notify({ userIds: admins, type: 'billing.renewal_due', title: `Renewal invoice ${number} · ${formatINR(inv.totalPaise)} due`, body: 'Pay now to keep your workspace active. It becomes read-only 7 days after the renewal date.', link: '/billing', from: 'Billing', email: true });
  }

  /** Past-due → read-only after grace; → suspended 30 days after the payment fell due. */
  async dunning(sub: Subscription): Promise<void> {
    const now = new Date();
    if (sub.status === 'PAST_DUE' && sub.graceEndsAt && now > sub.graceEndsAt) {
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'READ_ONLY' } });
      invalidateEntitlements(sub.tenantId);
      await this.prisma.saasInvoice.updateMany({ where: { status: 'ISSUED' }, data: { status: 'OVERDUE' } });
      await this.notifications.notify({ userIds: await this.billingAdmins(), type: 'billing.read_only', title: 'Workspace is read-only until the overdue invoice is paid', link: '/billing', from: 'Billing', email: true });
    } else if (sub.status === 'READ_ONLY' && sub.pastDueSince && now.getTime() > sub.pastDueSince.getTime() + 30 * 86400_000) {
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'SUSPENDED' } });
      invalidateEntitlements(sub.tenantId);
      await this.prisma.raw.tenant.update({ where: { id: sub.tenantId }, data: { status: 'SUSPENDED' } });
      await this.notifications.notify({ userIds: await this.billingAdmins(), type: 'billing.suspended', title: 'Workspace suspended for non-payment', link: '/billing', from: 'Billing', email: true });
    }
  }

  async renewalReminder(sub: Subscription): Promise<void> {
    await this.notifications.notify({ userIds: await this.billingAdmins(), type: 'billing.renewal_upcoming', title: `Your subscription renews on ${formatDate(sub.currentPeriodEnd)}`, body: `${planLabel(sub.planCode, sub.cycle)} · ${sub.quantity} seats.`, link: '/billing', from: 'Billing' });
  }
}
