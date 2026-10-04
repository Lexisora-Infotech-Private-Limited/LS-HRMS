import type { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { FREE_SEATS, GROWTH_PRICE_PAISE, PLAN_CARDS, ROLE_KEYS, ROLE_LABELS, defaultPermissionsFor, type QuoteLine } from '@lexisora/shared';
import { DEMO_PASSWORD, type SeedCtx } from './core';
import { daysInclusive, periodLine, prorationPaise, totalsFor } from '../../src/modules/platform/billing/billing.logic';

/**
 * Demo data for the platform domain. "Today" is Tue 29 Sep 2026 (IST).
 *  - Plan catalogue, promo codes (DIWALI20 live, SUMMER15 expired).
 *  - Subscriptions: Lexisora (Growth · yearly, 50 seats), Acme Logistics (Growth · yearly, 240),
 *    Bluepeak Studio (Free, 9 users) and Nova Clinics (Growth · monthly, 62, payment due) — the
 *    Tenants screen rows — with their SaaS invoices, payments, subscription history and a
 *    60-day MRR snapshot series.
 *  - Branding history, Lexisora support tickets SUP-214…SUP-221 (next request is SUP-222).
 *  - The wireframe's Alerts rows and a week of audit history (Roles & access / Audit log screens).
 */
export async function seed_platform(prisma: PrismaClient, ctx: SeedCtx): Promise<void> {
  const ist = (s: string) => new Date(`${s}+05:30`);
  const json = (v: unknown) => v as Prisma.InputJsonValue;

  // ── Plan catalogue & promo codes (global rows) ────────────────────────────
  const feats = (code: string) => PLAN_CARDS.find((p) => p.code === code)?.feats ?? [];
  const plans = [
    { code: 'FREE', name: 'Free', freeSeats: FREE_SEATS, maxActiveUsers: FREE_SEATS, monthlyPaisePerSeat: 0, yearlyPaisePerSeat: 0, features: feats('FREE'), isPublic: true, sortOrder: 0 },
    { code: 'GROWTH', name: 'Growth', freeSeats: FREE_SEATS, maxActiveUsers: null, monthlyPaisePerSeat: GROWTH_PRICE_PAISE.MONTHLY, yearlyPaisePerSeat: GROWTH_PRICE_PAISE.YEARLY, features: feats('GROWTH'), isPublic: true, sortOrder: 1 },
    { code: 'ENTERPRISE', name: 'Enterprise', freeSeats: FREE_SEATS, maxActiveUsers: null, monthlyPaisePerSeat: null, yearlyPaisePerSeat: null, features: feats('ENTERPRISE'), isPublic: true, sortOrder: 2 },
    { code: 'INTERNAL', name: 'Internal', freeSeats: FREE_SEATS, maxActiveUsers: null, monthlyPaisePerSeat: null, yearlyPaisePerSeat: null, features: ['Operator workspace'], isPublic: false, sortOrder: 3 },
  ];
  for (const p of plans) await prisma.plan.upsert({ where: { code: p.code }, create: p, update: p });

  const promos = [
    { code: 'DIWALI20', description: '20% off next renewal', percentOff: 20, planCodes: ['GROWTH'], cycles: [], duration: 'NEXT_INVOICE', maxRedemptions: 500, validFrom: ist('2026-09-01T00:00:00'), validUntil: ist('2026-11-30T23:59:59') },
    { code: 'SUMMER15', description: '15% off one monthly invoice', percentOff: 15, planCodes: ['GROWTH'], cycles: ['MONTHLY' as const], duration: 'NEXT_INVOICE', maxRedemptions: 200, validFrom: ist('2026-05-01T00:00:00'), validUntil: ist('2026-08-31T23:59:59') },
  ];
  for (const p of promos) await prisma.promoCode.upsert({ where: { code: p.code }, create: p, update: {} });

  // ── Tenants ───────────────────────────────────────────────────────────────
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const rohit = ctx.user.rohit ? await prisma.user.findUnique({ where: { id: ctx.user.rohit }, select: { id: true, name: true } }) : null;
  const opsName = (team = 'Lexisora platform') => (rohit ? `${team} · ${rohit.name}` : team);

  /** A customer workspace with the 5 system roles and its users (first one is the admin, can sign in). */
  async function customer(t: { name: string; legalName: string; domain: string; slug: string; status: 'ACTIVE' | 'FREE_TIER' | 'PAYMENT_DUE'; stateCode: string; stateName: string; city: string; gstin?: string; users: { name: string; email: string; role: string }[] }) {
    const existing = await prisma.tenant.findUnique({ where: { domain: t.domain } });
    if (existing) return existing.id;
    const tenant = await prisma.tenant.create({
      data: { name: t.name, legalName: t.legalName, domain: t.domain, slug: t.slug, status: t.status, stateCode: t.stateCode, stateName: t.stateName, city: t.city, gstin: t.gstin ?? null },
    });
    const roles: Record<string, string> = {};
    for (const key of ROLE_KEYS) {
      const r = await prisma.role.create({ data: { tenantId: tenant.id, key, name: ROLE_LABELS[key], isSystem: true, permissions: defaultPermissionsFor(key) } });
      roles[key] = r.id;
    }
    await prisma.user.createMany({
      data: t.users.map((u, i) => ({ tenantId: tenant.id, email: u.email, name: u.name, roleId: roles[u.role] ?? roles.employee!, status: 'ACTIVE' as const, passwordHash: i === 0 ? hash : null })),
    });
    return tenant.id;
  }

  const bluepeakId = await customer({
    name: 'Bluepeak Studio',
    legalName: 'Bluepeak Studio LLP',
    domain: 'bluepeak.hrms.app',
    slug: 'bluepeak',
    status: 'FREE_TIER',
    stateCode: '27',
    stateName: 'Maharashtra',
    city: 'Mumbai',
    users: [
      { name: 'Tanvi Kulkarni', email: 'tanvi@bluepeak.studio', role: 'admin' },
      { name: 'Aditya Rane', email: 'aditya@bluepeak.studio', role: 'lead' },
      { name: 'Pooja Shetty', email: 'pooja@bluepeak.studio', role: 'hr' },
      { name: 'Rhea Mehta', email: 'rhea@bluepeak.studio', role: 'employee' },
      { name: 'Siddharth Joshi', email: 'siddharth@bluepeak.studio', role: 'employee' },
      { name: 'Nikhil Bhosale', email: 'nikhil@bluepeak.studio', role: 'employee' },
      { name: 'Ishaan Kapoor', email: 'ishaan@bluepeak.studio', role: 'employee' },
      { name: 'Zoya Sheikh', email: 'zoya@bluepeak.studio', role: 'employee' },
      { name: 'Manav Desai', email: 'manav@bluepeak.studio', role: 'employee' },
    ],
  });
  const novaId = await customer({
    name: 'Nova Clinics',
    legalName: 'Nova Clinics Private Limited',
    domain: 'nova.hrms.app',
    slug: 'nova',
    status: 'PAYMENT_DUE',
    stateCode: '29',
    stateName: 'Karnataka',
    city: 'Bengaluru',
    gstin: '29AAGCN4821K1Z3',
    users: [
      { name: 'Dr. Kiran Rao', email: 'kiran.rao@novaclinics.in', role: 'admin' },
      { name: 'Shalini Menon', email: 'shalini.menon@novaclinics.in', role: 'hr' },
    ],
  });
  const acmeId: string | undefined = ctx.extra.acmeTenantId;
  if (acmeId) {
    await prisma.tenant.update({ where: { id: acmeId }, data: { legalName: 'Acme Logistics Private Limited', gstin: '27AAKCA7310M1Z9', city: 'Mumbai' } });
  }
  ctx.extra.platformTenants = { lexisora: ctx.tenantId, acme: acmeId ?? null, bluepeak: bluepeakId, nova: novaId };

  // ── Subscriptions ─────────────────────────────────────────────────────────
  // Lexisora: Growth · yearly, 50 seats ("N of 50 seats used · first 10 users are free").
  const lexSub = await prisma.subscription.upsert({
    where: { tenantId: ctx.tenantId },
    update: {},
    create: { tenantId: ctx.tenantId, planCode: 'GROWTH', cycle: 'YEARLY', status: 'ACTIVE', quantity: 50, unitPaise: GROWTH_PRICE_PAISE.YEARLY, currentPeriodStart: ist('2026-04-01T00:00:00'), currentPeriodEnd: ist('2027-03-31T23:59:59'), createdAt: ist('2025-04-01T10:00:00') },
  });
  // Acme Logistics: Growth · yearly, 240 seats (200 + 40 added on 8 Sep), renews Mar 2027.
  const acmeSub = acmeId
    ? await prisma.subscription.upsert({
        where: { tenantId: acmeId },
        update: {},
        create: { tenantId: acmeId, planCode: 'GROWTH', cycle: 'YEARLY', status: 'ACTIVE', quantity: 240, unitPaise: GROWTH_PRICE_PAISE.YEARLY, currentPeriodStart: ist('2026-03-15T00:00:00'), currentPeriodEnd: ist('2027-03-14T23:59:59'), createdAt: ist('2025-03-15T10:00:00') },
      })
    : null;
  // Bluepeak Studio: Free (9 users).
  const blueSub = await prisma.subscription.upsert({
    where: { tenantId: bluepeakId },
    update: {},
    create: { tenantId: bluepeakId, planCode: 'FREE', status: 'FREE', quantity: FREE_SEATS, createdAt: ist('2026-02-03T11:30:00') },
  });
  // Nova Clinics: Growth · monthly, 62 seats; the 12 Sep renewal charge was declined → payment due,
  // grace extended by Lexisora billing to the next renewal (12 Oct).
  const novaSub = await prisma.subscription.upsert({
    where: { tenantId: novaId },
    update: {},
    create: {
      tenantId: novaId,
      planCode: 'GROWTH',
      cycle: 'MONTHLY',
      status: 'PAST_DUE',
      quantity: 62,
      unitPaise: GROWTH_PRICE_PAISE.MONTHLY,
      currentPeriodStart: ist('2026-09-12T00:00:00'),
      currentPeriodEnd: ist('2026-10-12T00:00:00'),
      pastDueSince: ist('2026-09-12T09:00:00'),
      graceEndsAt: ist('2026-10-12T00:00:00'),
      createdAt: ist('2026-07-12T12:15:00'),
    },
  });

  const change = (tenantId: string, subscriptionId: string, at: string, type: string, seatDelta: number, from: unknown, to: unknown, actorName: string) => ({
    tenantId,
    subscriptionId,
    type,
    seatDelta,
    from: json(from),
    to: json(to),
    actorName,
    createdAt: ist(at),
  });
  await prisma.subscriptionChange.createMany({
    data: [
      change(ctx.tenantId, lexSub.id, '2025-04-01T10:00:00', 'UPGRADE', 40, { planCode: 'FREE' }, { planCode: 'GROWTH', cycle: 'YEARLY', quantity: 40 }, rohit?.name ?? 'Rohit Verma'),
      change(ctx.tenantId, lexSub.id, '2026-04-01T09:12:00', 'RENEWED', 10, { quantity: 40 }, { quantity: 50 }, rohit?.name ?? 'Rohit Verma'),
      ...(acmeId && acmeSub
        ? [
            change(acmeId, acmeSub.id, '2025-03-15T10:00:00', 'CREATED', 160, null, { planCode: 'GROWTH', cycle: 'YEARLY', quantity: 160 }, opsName()),
            change(acmeId, acmeSub.id, '2026-03-15T08:40:00', 'RENEWED', 40, { quantity: 160 }, { quantity: 200 }, 'Acme Admin'),
            change(acmeId, acmeSub.id, '2026-09-08T15:05:00', 'SEATS_ADDED', 40, { quantity: 200 }, { quantity: 240 }, 'Acme Admin'),
          ]
        : []),
      change(bluepeakId, blueSub.id, '2026-02-03T11:30:00', 'CREATED', 0, null, { planCode: 'FREE', quantity: FREE_SEATS }, opsName()),
      change(novaId, novaSub.id, '2026-07-12T12:15:00', 'UPGRADE', 50, { planCode: 'FREE' }, { planCode: 'GROWTH', cycle: 'MONTHLY', quantity: 50 }, 'Dr. Kiran Rao'),
      change(novaId, novaSub.id, '2026-08-12T00:05:00', 'RENEWED', 0, { quantity: 50 }, { quantity: 50 }, 'Payment gateway'),
      change(novaId, novaSub.id, '2026-09-12T00:05:00', 'SEATS_ADDED', 12, { quantity: 50 }, { quantity: 62 }, 'System'),
      change(novaId, novaSub.id, '2026-09-12T09:00:00', 'STATUS', 0, { status: 'ACTIVE' }, { status: 'PAST_DUE' }, 'System'),
      change(novaId, novaSub.id, '2026-09-19T11:20:00', 'STATUS', 0, { status: 'PAST_DUE', graceEndsAt: '2026-09-19' }, { status: 'PAST_DUE', graceEndsAt: '2026-10-12' }, opsName('Lexisora billing')),
    ],
  });

  // ── SaaS invoices & payments (LXS/{FY}/{0000}, platform sequence) ─────────
  async function invoice(o: { tenantId: string; subscriptionId: string; number: string; fy: string; issued: string; kind: string; cycle: 'MONTHLY' | 'YEARLY'; quantity: number; periodStart: string; periodEnd: string; lines: QuoteLine[]; state: string; gstin?: string | null; paid: boolean; failed?: string }) {
    const t = totalsFor(o.lines, o.state);
    const issued = ist(o.issued);
    const row = await prisma.saasInvoice.create({
      data: {
        tenantId: o.tenantId,
        number: o.number,
        fyLabel: o.fy,
        subscriptionId: o.subscriptionId,
        kind: o.kind,
        issueDate: issued,
        dueDate: issued,
        periodStart: ist(o.periodStart),
        periodEnd: ist(o.periodEnd),
        planCode: 'GROWTH',
        cycle: o.cycle,
        quantity: o.quantity,
        lines: json(t.lines),
        subtotalPaise: t.subtotalPaise,
        discountPaise: t.discountPaise,
        taxablePaise: t.taxablePaise,
        cgstPaise: t.cgstPaise,
        sgstPaise: t.sgstPaise,
        igstPaise: t.igstPaise,
        roundOffPaise: t.roundOffPaise,
        totalPaise: t.totalPaise,
        placeOfSupply: o.state,
        recipientGstin: o.gstin ?? null,
        status: o.paid ? 'PAID' : 'ISSUED',
        paidAt: o.paid ? new Date(issued.getTime() + 4 * 60_000) : null,
        createdAt: issued,
      },
    });
    const ref = o.number.replace(/\W/g, '').toLowerCase();
    await prisma.saasPayment.create({
      data: {
        tenantId: o.tenantId,
        invoiceId: row.id,
        gateway: 'MOCK',
        gatewayOrderId: `mock_order_seed_${ref}`,
        gatewayPaymentId: o.paid ? `pay_seed_${ref}` : null,
        amountPaise: t.totalPaise,
        status: o.paid ? 'CAPTURED' : 'FAILED',
        failureReason: o.failed ?? null,
        intent: json({ kind: o.kind === 'SEATS' ? 'SEATS' : 'RENEWAL', planCode: 'GROWTH', cycle: o.cycle, quantity: o.quantity }),
        createdAt: issued,
      },
    });
  }

  const lexState = '24';
  await invoice({ tenantId: ctx.tenantId, subscriptionId: lexSub.id, number: 'LXS/25-26/0001', fy: '2025-26', issued: '2025-04-01T10:00:00', kind: 'UPGRADE', cycle: 'YEARLY', quantity: 40, periodStart: '2025-04-01T00:00:00', periodEnd: '2026-03-31T23:59:59', lines: [periodLine('YEARLY', 40)], state: lexState, gstin: '24AAECL1234F1Z1', paid: true });
  if (acmeId && acmeSub) {
    await invoice({ tenantId: acmeId, subscriptionId: acmeSub.id, number: 'LXS/25-26/0002', fy: '2025-26', issued: '2026-03-15T08:40:00', kind: 'RENEWAL', cycle: 'YEARLY', quantity: 200, periodStart: '2026-03-15T00:00:00', periodEnd: '2027-03-14T23:59:59', lines: [periodLine('YEARLY', 200)], state: '27', gstin: '27AAKCA7310M1Z9', paid: true });
  }
  await invoice({ tenantId: ctx.tenantId, subscriptionId: lexSub.id, number: 'LXS/26-27/0001', fy: '2026-27', issued: '2026-04-01T09:12:00', kind: 'RENEWAL', cycle: 'YEARLY', quantity: 50, periodStart: '2026-04-01T00:00:00', periodEnd: '2027-03-31T23:59:59', lines: [periodLine('YEARLY', 50)], state: lexState, gstin: '24AAECL1234F1Z1', paid: true });
  await invoice({ tenantId: novaId, subscriptionId: novaSub.id, number: 'LXS/26-27/0002', fy: '2026-27', issued: '2026-07-12T12:15:00', kind: 'UPGRADE', cycle: 'MONTHLY', quantity: 50, periodStart: '2026-07-12T00:00:00', periodEnd: '2026-08-12T00:00:00', lines: [periodLine('MONTHLY', 50)], state: '29', gstin: '29AAGCN4821K1Z3', paid: true });
  await invoice({ tenantId: novaId, subscriptionId: novaSub.id, number: 'LXS/26-27/0003', fy: '2026-27', issued: '2026-08-12T00:05:00', kind: 'RENEWAL', cycle: 'MONTHLY', quantity: 50, periodStart: '2026-08-12T00:00:00', periodEnd: '2026-09-12T00:00:00', lines: [periodLine('MONTHLY', 50)], state: '29', gstin: '29AAGCN4821K1Z3', paid: true });
  if (acmeId && acmeSub) {
    const start = ist('2026-03-15T00:00:00');
    const end = ist('2027-03-14T23:59:59');
    const at = ist('2026-09-08T15:05:00');
    const remaining = daysInclusive(at, end);
    const total = daysInclusive(start, end);
    const amount = prorationPaise(200, 240, 'YEARLY', remaining, total);
    await invoice({
      tenantId: acmeId,
      subscriptionId: acmeSub.id,
      number: 'LXS/26-27/0004',
      fy: '2026-27',
      issued: '2026-09-08T15:05:00',
      kind: 'SEATS',
      cycle: 'YEARLY',
      quantity: 240,
      periodStart: '2026-09-08T15:05:00',
      periodEnd: '2027-03-14T23:59:59',
      lines: [{ kind: 'PRORATION', description: `Add 40 seats · ${remaining} of ${total} days left in the period`, quantity: 40, unitPaise: amount, amountPaise: amount }],
      state: '27',
      gstin: '27AAKCA7310M1Z9',
      paid: true,
    });
  }
  await invoice({ tenantId: novaId, subscriptionId: novaSub.id, number: 'LXS/26-27/0005', fy: '2026-27', issued: '2026-09-12T00:05:00', kind: 'RENEWAL', cycle: 'MONTHLY', quantity: 62, periodStart: '2026-09-12T00:00:00', periodEnd: '2026-10-12T00:00:00', lines: [periodLine('MONTHLY', 62)], state: '29', gstin: '29AAGCN4821K1Z3', paid: false, failed: 'Card declined by issuing bank' });

  // ── MRR snapshots (Tenants → "MRR +x%" compares with 30 days ago) ──────────
  const snapshots: Prisma.MrrSnapshotCreateManyInput[] = [];
  for (let d = Date.parse('2026-08-01T00:00:00Z'); d <= Date.parse('2026-09-29T00:00:00Z'); d += 86_400_000) {
    const day = new Date(d);
    const acmeSeats = !acmeId ? 0 : d >= Date.parse('2026-09-08T00:00:00Z') ? 240 : 200;
    const novaSeats = d >= Date.parse('2026-09-12T00:00:00Z') ? 62 : 50;
    const mrr = (acmeSeats ? (acmeSeats - FREE_SEATS) * GROWTH_PRICE_PAISE.YEARLY : 0) + (novaSeats - FREE_SEATS) * GROWTH_PRICE_PAISE.MONTHLY;
    snapshots.push({ date: day, mrrPaise: mrr, paidTenants: acmeId ? 2 : 1, freeTenants: 1, seatsBilled: acmeSeats + novaSeats, createdAt: new Date(d + 19 * 3600_000) });
  }
  await prisma.mrrSnapshot.createMany({ data: snapshots, skipDuplicates: true });

  // ── Branding history ──────────────────────────────────────────────────────
  await prisma.brandingVersion.createMany({
    data: [
      { tenantId: ctx.tenantId, version: 1, status: 'PUBLISHED', presetKey: 'default-gold-ink', primaryHex: '#b68235', secondaryHex: '#2d2b2b', productName: 'Lexisora', domain: 'lexisora.hrms.app', publishedById: rohit?.id ?? null, publishedByName: rohit?.name ?? 'Rohit Verma', publishedAt: ist('2025-04-01T10:30:00') },
      ...(acmeId
        ? [
            { tenantId: acmeId, version: 1, status: 'ARCHIVED', presetKey: 'default-gold-ink', primaryHex: '#b68235', secondaryHex: '#2d2b2b', productName: null, domain: 'acme.hrms.app', publishedById: null, publishedByName: 'Lexisora platform', publishedAt: ist('2025-03-15T10:00:00') },
            { tenantId: acmeId, version: 2, status: 'PUBLISHED', presetKey: 'acme-red-black', primaryHex: '#c62828', secondaryHex: '#1c1c1c', productName: null, domain: 'acme.hrms.app', publishedById: null, publishedByName: 'Acme Admin', publishedAt: ist('2025-03-20T16:45:00') },
          ]
        : []),
      { tenantId: bluepeakId, version: 1, status: 'PUBLISHED', presetKey: 'default-gold-ink', primaryHex: '#b68235', secondaryHex: '#2d2b2b', productName: null, domain: 'bluepeak.hrms.app', publishedById: null, publishedByName: 'Lexisora platform', publishedAt: ist('2026-02-03T11:30:00') },
      { tenantId: novaId, version: 1, status: 'PUBLISHED', presetKey: 'default-gold-ink', primaryHex: '#b68235', secondaryHex: '#2d2b2b', productName: null, domain: 'nova.hrms.app', publishedById: null, publishedByName: 'Lexisora platform', publishedAt: ist('2026-07-12T12:15:00') },
    ],
    skipDuplicates: true,
  });

  // ── Lexisora support (SUP-214…SUP-221; the next request is SUP-222) ───────
  const lexAdmin = { name: rohit?.name ?? 'Rohit Verma', email: 'rohit.verma@lexisora.com', id: rohit?.id ?? null };
  const engineer = 'Aman Gupta · Lexisora support';
  type Msg = { at: string; type: 'TENANT_USER' | 'PLATFORM_USER' | 'SYSTEM'; author: string; body: string; internal?: boolean };
  async function ticket(o: { tenantId: string; number: number; subject: string; description: string; category: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; status: 'OPEN' | 'ENGINEER_ASSIGNED' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED'; plan: string; opener: { name: string; email: string; id?: string | null }; opened: string; due: string; responded?: string; resolved?: string; closed?: string; csat?: number; assignee?: string; messages: Msg[] }) {
    const code = `SUP-${o.number}`;
    if (await prisma.supportTicket.findUnique({ where: { code } })) return;
    const t = await prisma.supportTicket.create({
      data: {
        tenantId: o.tenantId,
        number: o.number,
        code,
        openedByUserId: o.opener.id ?? null,
        openedByName: o.opener.name,
        openedByEmail: o.opener.email,
        subject: o.subject,
        description: o.description,
        category: o.category,
        severity: o.severity,
        status: o.status,
        assigneeName: o.assignee ?? null,
        planAtOpen: o.plan,
        firstResponseDueAt: ist(o.due),
        firstRespondedAt: o.responded ? ist(o.responded) : null,
        resolvedAt: o.resolved ? ist(o.resolved) : null,
        closedAt: o.closed ? ist(o.closed) : null,
        csat: o.csat ?? null,
        createdAt: ist(o.opened),
        updatedAt: ist(o.messages.at(-1)?.at ?? o.opened),
      },
    });
    if (o.messages.length) {
      await prisma.supportMessage.createMany({
        data: o.messages.map((m) => ({ tenantId: o.tenantId, ticketId: t.id, authorType: m.type, authorName: m.author, body: m.body, internal: !!m.internal, createdAt: ist(m.at) })),
      });
    }
  }

  await ticket({
    tenantId: ctx.tenantId,
    number: 214,
    subject: 'Custom payslip template',
    description: 'We would like the payslip PDF to show our CIN and the employee’s PAN below the header, and the leave balance table at the bottom. Is a custom template possible on Growth?',
    category: 'FEATURE_REQUEST',
    severity: 'LOW',
    status: 'RESOLVED',
    plan: 'GROWTH',
    opener: lexAdmin,
    opened: '2026-09-22T11:05:00',
    due: '2026-09-25T11:05:00',
    responded: '2026-09-22T15:40:00',
    resolved: '2026-09-25T17:10:00',
    assignee: 'Aman Gupta',
    messages: [
      { at: '2026-09-22T15:40:00', type: 'PLATFORM_USER', author: engineer, body: 'Thanks Rohit — yes. Payslip templates are configurable per workspace. Could you share where exactly the CIN should appear (left or right of the logo)?' },
      { at: '2026-09-22T17:02:00', type: 'TENANT_USER', author: lexAdmin.name, body: 'Right of the logo, small type. PAN can go in the employee details block.' },
      { at: '2026-09-25T17:10:00', type: 'PLATFORM_USER', author: engineer, body: 'Done: the template now shows the CIN beside the logo and PAN in the employee block. The September payslips will use it. Marking this resolved — reopen if anything looks off.' },
      { at: '2026-09-25T17:10:30', type: 'SYSTEM', author: 'System', body: `Status: Resolved (${engineer})` },
    ],
  });
  await ticket({
    tenantId: ctx.tenantId,
    number: 219,
    subject: 'Biometric punches syncing late from the Pune office device',
    description: 'Punches from the Pune eSSL device show up 30–40 minutes late since Monday. Ahmedabad is fine. Device serial PUN-ESSL-02.',
    category: 'TECHNICAL',
    severity: 'MEDIUM',
    status: 'CLOSED',
    plan: 'GROWTH',
    opener: lexAdmin,
    opened: '2026-09-23T10:20:00',
    due: '2026-09-24T10:20:00',
    responded: '2026-09-23T11:05:00',
    resolved: '2026-09-23T16:10:00',
    closed: '2026-09-24T09:30:00',
    csat: 5,
    assignee: 'Aman Gupta',
    messages: [
      { at: '2026-09-23T11:05:00', type: 'PLATFORM_USER', author: engineer, body: 'Looking at the device heartbeat logs now — no employee data is needed. I’ll check the sync settings of your workspace (metadata only).' },
      { at: '2026-09-23T15:30:00', type: 'PLATFORM_USER', author: engineer, body: 'Found it: the device’s push interval was reset to 30 minutes after a firmware update. Set it back to real-time push from the device menu (Comm → Cloud → Realtime).', internal: false },
      { at: '2026-09-23T15:31:00', type: 'PLATFORM_USER', author: engineer, body: 'Customer device firmware 6.60 resets push interval — add to known issues.', internal: true },
      { at: '2026-09-23T16:10:00', type: 'TENANT_USER', author: lexAdmin.name, body: 'Fixed, punches are arriving instantly now. Thanks!' },
      { at: '2026-09-24T09:30:00', type: 'SYSTEM', author: 'System', body: 'Rated 5/5 · request closed' },
    ],
  });
  await ticket({
    tenantId: ctx.tenantId,
    number: 221,
    subject: 'SSO login failing for 3 users',
    description: 'Three people in Design (Vikram, Divya, Ananya) get “Single sign-on is not configured” since this morning when they use “Sign in with Google”. Everyone else is fine. Password sign-in works for them.',
    category: 'TECHNICAL',
    severity: 'HIGH',
    status: 'ENGINEER_ASSIGNED',
    plan: 'GROWTH',
    opener: lexAdmin,
    opened: '2026-09-29T10:12:00',
    due: '2026-09-29T14:12:00',
    responded: '2026-09-29T10:41:00',
    assignee: 'Aman Gupta',
    messages: [
      { at: '2026-09-29T10:19:00', type: 'SYSTEM', author: 'System', body: `Assigned to Aman Gupta · Status: Engineer assigned (${engineer})` },
      { at: '2026-09-29T10:41:00', type: 'PLATFORM_USER', author: engineer, body: 'I’m on it. Could you confirm whether these three accounts were recently moved to a different Google Workspace organisational unit?' },
      { at: '2026-09-29T10:44:00', type: 'PLATFORM_USER', author: engineer, body: 'IdP metadata for lexisora.hrms.app last rotated 28 Sep — check the OU-scoped app assignment.', internal: true },
    ],
  });
  if (acmeId) {
    await ticket({
      tenantId: acmeId,
      number: 220,
      subject: 'Payroll export column order for Tally',
      description: 'Our accountant imports the bank transfer file into Tally Prime. Can the export put Employee code before Name and use DD-MM-YYYY dates?',
      category: 'TECHNICAL',
      severity: 'MEDIUM',
      status: 'IN_PROGRESS',
      plan: 'GROWTH',
      opener: { name: 'Acme Admin', email: 'admin@acme.com' },
      opened: '2026-09-25T16:45:00',
      due: '2026-09-26T16:45:00',
      responded: '2026-09-26T10:05:00',
      assignee: 'Aman Gupta',
      messages: [
        { at: '2026-09-26T10:05:00', type: 'PLATFORM_USER', author: engineer, body: 'Thanks — we are adding a “Tally Prime” layout to the export options. I’ll update you once it is on staging.' },
      ],
    });
  }
  await ticket({
    tenantId: novaId,
    number: 218,
    subject: 'Card payment failing on renewal',
    description: 'Our September renewal shows “Card declined”. The card works elsewhere. Can we pay by UPI or bank transfer instead?',
    category: 'BILLING',
    severity: 'HIGH',
    status: 'WAITING_ON_CUSTOMER',
    plan: 'GROWTH',
    opener: { name: 'Dr. Kiran Rao', email: 'kiran.rao@novaclinics.in' },
    opened: '2026-09-12T18:20:00',
    due: '2026-09-14T13:20:00',
    responded: '2026-09-14T10:30:00',
    assignee: 'Rohit Verma',
    messages: [
      { at: '2026-09-14T10:30:00', type: 'PLATFORM_USER', author: opsName('Lexisora support'), body: 'Your bank declined the recurring charge (no 3-D Secure mandate). Use “Pay now” on Subscription & billing — UPI and net banking are offered there. We have extended your grace period to 12 Oct.' },
      { at: '2026-09-19T11:20:00', type: 'SYSTEM', author: 'System', body: `Status: Waiting on customer (${opsName('Lexisora support')})` },
    ],
  });
  await ticket({
    tenantId: bluepeakId,
    number: 217,
    subject: 'How do we import employees from a spreadsheet?',
    description: 'We have our team in Google Sheets. Is there a CSV import on the Free plan?',
    category: 'ACCOUNT',
    severity: 'LOW',
    status: 'RESOLVED',
    plan: 'FREE',
    opener: { name: 'Tanvi Kulkarni', email: 'tanvi@bluepeak.studio' },
    opened: '2026-09-17T12:00:00',
    due: '2026-09-21T10:00:00',
    responded: '2026-09-18T11:15:00',
    resolved: '2026-09-21T15:00:00',
    assignee: 'Aman Gupta',
    messages: [
      { at: '2026-09-18T11:15:00', type: 'PLATFORM_USER', author: engineer, body: 'Yes — People → Employees → Import CSV. Download the template there, paste your sheet and run the dry-run first.' },
      { at: '2026-09-21T15:00:00', type: 'SYSTEM', author: 'System', body: 'Marked resolved by Tanvi Kulkarni' },
    ],
  });

  // ── Platform access log in customer workspaces (Data privacy → Platform access) ──
  const access = [
    { tenantId: novaId, at: '2026-07-12T12:15:00', action: 'platform.tenant.created', entity: 'Tenant', entityId: novaId, actorName: opsName(), summary: 'Workspace created by Lexisora on Free · admin kiran.rao@novaclinics.in' },
    { tenantId: novaId, at: '2026-09-14T10:30:00', action: 'platform.support.reply', entity: 'SupportTicket', entityId: null, actorName: opsName('Lexisora support'), summary: 'Lexisora support replied on SUP-218' },
    { tenantId: novaId, at: '2026-09-19T11:20:00', action: 'platform.tenant.grace_extended', entity: 'Subscription', entityId: novaSub.id, actorName: opsName('Lexisora billing'), summary: 'Grace period extended by 23 days to 12 Oct 2026' },
    { tenantId: bluepeakId, at: '2026-02-03T11:30:00', action: 'platform.tenant.created', entity: 'Tenant', entityId: bluepeakId, actorName: opsName(), summary: 'Workspace created by Lexisora on Free · admin tanvi@bluepeak.studio' },
    { tenantId: bluepeakId, at: '2026-09-18T11:15:00', action: 'platform.support.reply', entity: 'SupportTicket', entityId: null, actorName: 'Lexisora support · Aman Gupta', summary: 'Lexisora support replied on SUP-217' },
    { tenantId: ctx.tenantId, at: '2026-09-29T10:41:00', action: 'platform.support.reply', entity: 'SupportTicket', entityId: null, actorName: 'Lexisora support · Aman Gupta', summary: 'Lexisora support replied on SUP-221' },
    ...(acmeId ? [{ tenantId: acmeId, at: '2026-09-26T10:05:00', action: 'platform.support.reply', entity: 'SupportTicket', entityId: null, actorName: 'Lexisora support · Aman Gupta', summary: 'Lexisora support replied on SUP-220' }] : []),
  ];
  await prisma.auditLog.createMany({
    data: access.map((a) => ({ tenantId: a.tenantId, actorUserId: null, actorName: a.actorName, action: a.action, entity: a.entity, entityId: a.entityId, ip: '13.232.44.10', meta: json({ summary: a.summary }), createdAt: ist(a.at) })),
  });

  // ── Alerts (wireframe GEN "notif": 4 unread for everyone) ────────────────
  const users = await prisma.user.findMany({ where: { tenantId: ctx.tenantId, status: { not: 'DISABLED' } }, include: { role: { select: { key: true } } } });
  const alerts: { userId: string; type: string; title: string; body?: string; link: string; fromLabel: string; createdAt: Date; readAt?: Date }[] = [];
  for (const u of users) {
    alerts.push(
      { userId: u.id, type: 'birthday.reminder', title: 'Birthday: Rahul Desai', body: 'Wish Rahul on the company feed.', link: '/feed', fromLabel: 'System', createdAt: ist('2026-09-30T00:05:00') },
      { userId: u.id, type: 'timesheet.reminder', title: 'Timesheet for 21–27 Sep awaiting your submission', body: 'Submit by Wednesday so your Project Lead can approve it before payroll.', link: '/timesheets', fromLabel: 'System', createdAt: ist('2026-09-29T09:30:00') },
      { userId: u.id, type: 'policy.acknowledge', title: 'Acknowledge the updated leave & attendance policy', body: 'Version 3 · effective 1 Oct 2026.', link: '/policies', fromLabel: 'HR', createdAt: ist('2026-09-28T11:00:00') },
      { userId: u.id, type: 'helpdesk.resolved', title: 'Your ticket HD-1038 was resolved', body: 'Payslip correction for August has been processed.', link: '/helpdesk', fromLabel: 'Payroll', createdAt: ist('2026-09-26T16:20:00') },
      { userId: u.id, type: 'payslip.published', title: 'Your payslip for August 2026 is ready', link: '/payslips', fromLabel: 'Payroll', createdAt: ist('2026-09-01T10:00:00'), readAt: ist('2026-09-01T12:14:00') },
    );
    if (['lead', 'manager', 'admin'].includes(u.role.key)) {
      alerts.push({ userId: u.id, type: 'timesheet.approval', title: 'Timesheets for 14–20 Sep are awaiting your approval', link: '/approvals', fromLabel: 'System', createdAt: ist('2026-09-21T09:00:00'), readAt: ist('2026-09-22T10:30:00') });
    }
    if (['hr', 'admin'].includes(u.role.key)) {
      alerts.push({ userId: u.id, type: 'leave.request', title: 'Leave request from Ananya Rao is awaiting your approval', link: '/leave', fromLabel: 'System', createdAt: ist('2026-09-23T14:10:00'), readAt: ist('2026-09-23T15:02:00') });
    }
    if (u.id === rohit?.id) {
      alerts.push({ userId: u.id, type: 'platform.payment_failed', title: 'Nova Clinics: renewal payment of ₹ 10,983 failed', body: 'Card declined by issuing bank · grace extended to 12 Oct.', link: '/tenants', fromLabel: 'Billing', createdAt: ist('2026-09-12T09:00:00'), readAt: ist('2026-09-12T10:02:00') });
    }
  }
  if (alerts.length) await prisma.notification.createMany({ data: alerts.map((a) => ({ tenantId: ctx.tenantId, ...a })) });

  // Nova's billing admins were told about the failed renewal charge.
  const novaAdmins = await prisma.user.findMany({ where: { tenantId: novaId, role: { key: 'admin' } }, select: { id: true } });
  if (novaAdmins.length) {
    await prisma.notification.createMany({
      data: novaAdmins.map((u) => ({ tenantId: novaId, userId: u.id, type: 'billing.payment_failed', title: 'Payment of ₹ 10,983 failed', body: 'Card declined by issuing bank. Pay now to keep your workspace active.', link: '/billing', fromLabel: 'Billing', createdAt: ist('2026-09-12T09:00:00') })),
    });
  }

  // ── Audit log: a week of history (default filter = last 7 days) ──────────
  const name = async (key: string) => {
    const id = ctx.user[key];
    if (!id) return null;
    const u = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true } });
    return u;
  };
  const [rohitU, kavya, neha, arjun, priya, sneha] = await Promise.all(['rohit', 'kavya', 'neha', 'arjun', 'priya', 'sneha'].map(name));
  const hrRole = ctx.roles.hr ?? null;
  type Row = { at: string; actor: { id: string; name: string } | null; actorName?: string; action: string; entity: string; entityId?: string | null; ip?: string; meta: Record<string, unknown> };
  const rows: Row[] = [
    { at: '2026-09-29T10:12:04', actor: priya, action: 'auth.login', entity: 'User', entityId: priya?.id, ip: '49.36.112.18', meta: { client: 'web', summary: 'Signed in on the web' } },
    { at: '2026-09-29T09:14:40', actor: rohitU, action: 'auth.login', entity: 'User', entityId: rohitU?.id, ip: '10.20.1.14', meta: { client: 'web', summary: 'Signed in on the web' } },
    { at: '2026-09-29T09:31:05', actor: rohitU, action: 'rbac.permission.granted', entity: 'Role', entityId: hrRole, ip: '10.20.1.14', meta: { summary: 'Granted Mobile app access to HR · matrix row “Mobile app access”', role: 'HR', keys: ['mobile.access'] } },
    { at: '2026-09-28T18:45:22', actor: neha, action: 'timesheet.step.approved', entity: 'Timesheet', ip: '10.20.1.31', meta: { summary: 'Approved Priya Sharma’s timesheet for 14–20 Sep (Level 2 · Reporting Manager)' } },
    { at: '2026-09-28T11:02:09', actor: kavya, action: 'onboarding.created', entity: 'Employee', entityId: ctx.emp.meera ?? null, ip: '10.20.1.22', meta: { summary: 'Started onboarding for Meera Iyer (joins 6 Oct)' } },
    { at: '2026-09-27T22:13:51', actor: null, action: 'auth.login.failed', entity: 'User', entityId: priya?.id, ip: '103.21.58.4', meta: { summary: '3 failed sign-in attempts for priya.sharma@lexisora.com', email: 'priya.sharma@lexisora.com', attempts: 3 } },
    { at: '2026-09-26T16:20:03', actor: kavya, action: 'salary.viewed', entity: 'Employee', entityId: ctx.emp.rahul ?? null, ip: '10.20.1.22', meta: { summary: 'Viewed the salary structure of Rahul Desai' } },
    { at: '2026-09-25T12:40:36', actor: rohitU, action: 'rbac.member.added', entity: 'User', entityId: sneha?.id, ip: '10.20.1.14', meta: { summary: 'Sneha Patel: Employee → Team / Project Lead', from: 'Employee', to: 'Team / Project Lead' } },
    { at: '2026-09-24T10:05:47', actor: arjun, action: 'rbac.denied', entity: 'Permission', entityId: 'payroll.manage', ip: '182.74.16.203', meta: { summary: 'Denied: Payroll run (payroll.manage) · GET /payroll/runs', permission: 'payroll.manage' } },
    { at: '2026-09-23T15:30:00', actor: null, actorName: 'Lexisora support · Aman Gupta', action: 'platform.support.session', entity: 'Tenant', entityId: ctx.tenantId, ip: '13.232.44.10', meta: { summary: 'Lexisora support opened workspace settings for ticket SUP-219 (metadata only)', ticket: 'SUP-219' } },
    { at: '2026-09-22T09:58:10', actor: kavya, action: 'period.locked', entity: 'PeriodLock', ip: '10.20.1.22', meta: { summary: 'Locked attendance up to 31 Aug 2026' } },
    { at: '2026-09-22T11:05:00', actor: rohitU, action: 'support.ticket.opened', entity: 'SupportTicket', ip: '10.20.1.14', meta: { summary: 'Opened SUP-214 · Custom payslip template (Low)', code: 'SUP-214' } },
    { at: '2026-09-29T10:12:00', actor: rohitU, action: 'support.ticket.opened', entity: 'SupportTicket', ip: '10.20.1.14', meta: { summary: 'Opened SUP-221 · SSO login failing for 3 users (High)', code: 'SUP-221' } },
    // Rohit is also a Lexisora platform administrator: his console actions on customer workspaces.
    { at: '2026-09-19T11:20:00', actor: rohitU, action: 'platform.tenant.grace_extended', entity: 'Tenant', entityId: novaId, ip: '10.20.1.14', meta: { summary: 'Nova Clinics: Grace period extended by 23 days to 12 Oct 2026' } },
  ];
  await prisma.auditLog.createMany({
    data: rows.map((r) => ({
      tenantId: ctx.tenantId,
      actorUserId: r.actor?.id ?? null,
      actorName: r.actor?.name ?? r.actorName ?? null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId ?? null,
      ip: r.ip ?? null,
      meta: r.meta as Prisma.InputJsonValue,
      createdAt: ist(r.at),
    })),
  });
}
