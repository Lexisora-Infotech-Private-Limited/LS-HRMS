import type { Prisma, PrismaClient } from '@prisma/client';
import { FREE_SEATS, GROWTH_PRICE_PAISE, PLAN_CARDS } from '@lexisora/shared';
import type { SeedCtx } from './core';

/**
 * Demo data for the platform domain (core release): plan catalogue, subscriptions (so plan-gated
 * permissions on Roles & access behave like the Growth plan), the wireframe's Alerts rows and a
 * week of audit-log history. "Today" is Tue 29 Sep 2026 (IST).
 */
export async function seed_platform(prisma: PrismaClient, ctx: SeedCtx): Promise<void> {
  const ist = (s: string) => new Date(`${s}+05:30`);

  // ── Plan catalogue (global rows) ──────────────────────────────────────────
  const feats = (code: string) => PLAN_CARDS.find((p) => p.code === code)?.feats ?? [];
  const plans = [
    { code: 'FREE', name: 'Free', freeSeats: FREE_SEATS, maxActiveUsers: FREE_SEATS, monthlyPaisePerSeat: 0, yearlyPaisePerSeat: 0, features: feats('FREE'), isPublic: true, sortOrder: 0 },
    { code: 'GROWTH', name: 'Growth', freeSeats: FREE_SEATS, maxActiveUsers: null, monthlyPaisePerSeat: GROWTH_PRICE_PAISE.MONTHLY, yearlyPaisePerSeat: GROWTH_PRICE_PAISE.YEARLY, features: feats('GROWTH'), isPublic: true, sortOrder: 1 },
    { code: 'ENTERPRISE', name: 'Enterprise', freeSeats: FREE_SEATS, maxActiveUsers: null, monthlyPaisePerSeat: null, yearlyPaisePerSeat: null, features: feats('ENTERPRISE'), isPublic: true, sortOrder: 2 },
    { code: 'INTERNAL', name: 'Internal', freeSeats: FREE_SEATS, maxActiveUsers: null, monthlyPaisePerSeat: null, yearlyPaisePerSeat: null, features: ['Operator workspace'], isPublic: false, sortOrder: 3 },
  ];
  for (const p of plans) await prisma.plan.upsert({ where: { code: p.code }, create: p, update: p });

  // ── Subscriptions ─────────────────────────────────────────────────────────
  // Lexisora: Growth · yearly, 50 seats ("42 of 50 seats used · first 10 users are free").
  await prisma.subscription.upsert({
    where: { tenantId: ctx.tenantId },
    update: {},
    create: {
      tenantId: ctx.tenantId,
      planCode: 'GROWTH',
      cycle: 'YEARLY',
      status: 'ACTIVE',
      quantity: 50,
      unitPaise: GROWTH_PRICE_PAISE.YEARLY,
      currentPeriodStart: ist('2026-04-01T00:00:00'),
      currentPeriodEnd: ist('2027-03-31T23:59:59'),
      createdAt: ist('2025-04-01T10:00:00'),
    },
  });
  const acmeId: string | undefined = ctx.extra.acmeTenantId;
  if (acmeId) {
    // Acme Logistics: Growth · yearly, 240 seats, renews Mar 2027 (Tenants screen row).
    await prisma.subscription.upsert({
      where: { tenantId: acmeId },
      update: {},
      create: {
        tenantId: acmeId,
        planCode: 'GROWTH',
        cycle: 'YEARLY',
        status: 'ACTIVE',
        quantity: 240,
        unitPaise: GROWTH_PRICE_PAISE.YEARLY,
        currentPeriodStart: ist('2026-03-15T00:00:00'),
        currentPeriodEnd: ist('2027-03-14T23:59:59'),
        createdAt: ist('2025-03-15T10:00:00'),
      },
    });
  }

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
  }
  if (alerts.length) await prisma.notification.createMany({ data: alerts.map((a) => ({ tenantId: ctx.tenantId, ...a })) });

  // ── Audit log: a week of history (default filter = last 7 days) ──────────
  const name = async (key: string) => {
    const id = ctx.user[key];
    if (!id) return null;
    const u = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true } });
    return u;
  };
  const [rohit, kavya, neha, arjun, priya, sneha] = await Promise.all(['rohit', 'kavya', 'neha', 'arjun', 'priya', 'sneha'].map(name));
  const hrRole = ctx.roles.hr ?? null;
  type Row = { at: string; actor: { id: string; name: string } | null; actorName?: string; action: string; entity: string; entityId?: string | null; ip?: string; meta: Record<string, unknown> };
  const rows: Row[] = [
    { at: '2026-09-29T10:12:04', actor: priya, action: 'auth.login', entity: 'User', entityId: priya?.id, ip: '49.36.112.18', meta: { client: 'web', summary: 'Signed in on the web' } },
    { at: '2026-09-29T09:14:40', actor: rohit, action: 'auth.login', entity: 'User', entityId: rohit?.id, ip: '10.20.1.14', meta: { client: 'web', summary: 'Signed in on the web' } },
    { at: '2026-09-29T09:31:05', actor: rohit, action: 'rbac.permission.granted', entity: 'Role', entityId: hrRole, ip: '10.20.1.14', meta: { summary: 'Granted Mobile app access to HR · matrix row “Mobile app access”', role: 'HR', keys: ['mobile.access'] } },
    { at: '2026-09-28T18:45:22', actor: neha, action: 'timesheet.step.approved', entity: 'Timesheet', ip: '10.20.1.31', meta: { summary: 'Approved Priya Sharma’s timesheet for 14–20 Sep (Level 2 · Reporting Manager)' } },
    { at: '2026-09-28T11:02:09', actor: kavya, action: 'onboarding.created', entity: 'Employee', entityId: ctx.emp.meera ?? null, ip: '10.20.1.22', meta: { summary: 'Started onboarding for Meera Iyer (joins 6 Oct)' } },
    { at: '2026-09-27T22:13:51', actor: null, action: 'auth.login.failed', entity: 'User', entityId: priya?.id, ip: '103.21.58.4', meta: { summary: '3 failed sign-in attempts for priya.sharma@lexisora.com', email: 'priya.sharma@lexisora.com', attempts: 3 } },
    { at: '2026-09-26T16:20:03', actor: kavya, action: 'salary.viewed', entity: 'Employee', entityId: ctx.emp.rahul ?? null, ip: '10.20.1.22', meta: { summary: 'Viewed the salary structure of Rahul Desai' } },
    { at: '2026-09-25T12:40:36', actor: rohit, action: 'rbac.member.added', entity: 'User', entityId: sneha?.id, ip: '10.20.1.14', meta: { summary: 'Sneha Patel: Employee → Team / Project Lead', from: 'Employee', to: 'Team / Project Lead' } },
    { at: '2026-09-24T10:05:47', actor: arjun, action: 'rbac.denied', entity: 'Permission', entityId: 'payroll.manage', ip: '182.74.16.203', meta: { summary: 'Denied: Payroll run (payroll.manage) · GET /payroll/runs', permission: 'payroll.manage' } },
    { at: '2026-09-23T15:30:00', actor: null, actorName: 'Lexisora support · Aman Gupta', action: 'platform.support.session', entity: 'Tenant', entityId: ctx.tenantId, ip: '13.232.44.10', meta: { summary: 'Lexisora support opened workspace settings for ticket SUP-219 (metadata only)', ticket: 'SUP-219' } },
    { at: '2026-09-22T09:58:10', actor: kavya, action: 'period.locked', entity: 'PeriodLock', ip: '10.20.1.22', meta: { summary: 'Locked attendance up to 31 Aug 2026' } },
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
