import { Injectable } from '@nestjs/common';
import type { IdCardCheck } from '@prisma/client';
import type { IdCheckInput, IdCheckRow, IdComplianceSummary, IdPendingRow, MyIdCheckCard } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, forbidden, notFound } from '../../../core/http/errors';
import { CrossReader } from '../cross';
import { complianceDelta, idDayFigures, pctOf } from '../lib/compliance';
import { addDays, dateOf, istHm, istKeyOf, keyOf, monthOf, monthRange, prevMonth } from '../lib/time-utils';

const ACTIVE = ['ACTIVE', 'NOTICE_PERIOD'] as const;

/** ID card compliance (spec-time G). */
@Injectable()
export class IdCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cross: CrossReader,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Employees in office on the date: AttendanceDay with effectiveMode OFFICE and a first in. */
  private async inOffice(date: string) {
    const days = await this.prisma.attendanceDay.findMany({ where: { date: dateOf(date), effectiveMode: 'OFFICE', firstInAt: { not: null } }, select: { employeeId: true, firstInAt: true } });
    return days;
  }

  async summary(date = istKeyOf(new Date())): Promise<IdComplianceSummary> {
    const [inOffice, headcount, checks] = await Promise.all([
      this.inOffice(date),
      this.prisma.employee.count({ where: { status: { in: [...ACTIVE] } } }),
      this.prisma.idCardCheck.findMany({ where: { date: dateOf(date) } }),
    ]);
    const f = idDayFigures(
      inOffice.map((d) => d.employeeId),
      checks.map((c) => ({ employeeId: c.employeeId, wearing: c.wearing })),
    );
    const month = monthOf(date);
    const monthPct = await this.monthPct(month, date);
    const prev = await this.monthPct(prevMonth(month));
    const missingIds = checks.filter((c) => !c.wearing).map((c) => c.employeeId);
    const reminded = f.missing > 0 && (await this.remindedCount(missingIds, date)) > 0;
    // When the chosen day has no checks yet, point the screen at the most recent check day.
    const last = checks.length ? null : await this.prisma.idCardCheck.findFirst({ where: { date: { lt: dateOf(date) } }, orderBy: { date: 'desc' }, select: { date: true } });
    return {
      date,
      ...f,
      headcount,
      remindersSent: reminded,
      monthCompliancePct: monthPct ?? 0,
      prevMonthCompliancePct: prev,
      deltaPct: complianceDelta(monthPct, prev),
      lastCheckDate: last ? keyOf(last.date) : null,
    };
  }

  /** Reminders sent on the day to the given employees (notification rows of type idcheck.missing). */
  private async remindedCount(employeeIds: string[], date: string): Promise<number> {
    if (!employeeIds.length) return 0;
    const users = await this.prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { userId: true } });
    const userIds = users.map((u) => u.userId).filter((x): x is string => !!x);
    if (!userIds.length) return 0;
    return this.prisma.notification.count({ where: { userId: { in: userIds }, type: 'idcheck.missing', createdAt: { gte: dateOf(date), lt: dateOf(addDays(date, 1)) } } });
  }

  private async monthPct(month: string, upTo?: string): Promise<number | null> {
    const { from, to } = monthRange(month);
    const rows = await this.prisma.idCardCheck.groupBy({ by: ['wearing'], where: { date: { gte: dateOf(from), lte: dateOf(upTo && upTo < to ? upTo : to) } }, _count: { _all: true } });
    const total = rows.reduce((s, r) => s + r._count._all, 0);
    const yes = rows.find((r) => r.wearing)?._count._all ?? 0;
    return pctOf(yes, total);
  }

  async list(q: { date?: string; wearing?: string; department?: string }): Promise<IdCheckRow[]> {
    const date = q.date ?? istKeyOf(new Date());
    const rows = await this.prisma.idCardCheck.findMany({
      where: { date: dateOf(date), ...(q.wearing === 'yes' ? { wearing: true } : q.wearing === 'no' ? { wearing: false } : {}) },
      orderBy: { checkedAt: 'asc' },
    });
    const out = await this.toRows(rows);
    return q.department ? out.filter((r) => r.department === q.department) : out;
  }

  async pending(date = istKeyOf(new Date())): Promise<IdPendingRow[]> {
    const [inOffice, checks] = await Promise.all([this.inOffice(date), this.prisma.idCardCheck.findMany({ where: { date: dateOf(date) }, select: { employeeId: true } })]);
    const checked = new Set(checks.map((c) => c.employeeId));
    const todo = inOffice.filter((d) => !checked.has(d.employeeId));
    const emps = await this.prisma.employee.findMany({ where: { id: { in: todo.map((d) => d.employeeId) } }, select: { id: true, fullName: true, department: { select: { name: true } } } });
    const em = new Map(emps.map((e) => [e.id, e]));
    return todo
      .filter((d) => em.has(d.employeeId))
      .map((d) => ({ employeeId: d.employeeId, name: em.get(d.employeeId)!.fullName, department: em.get(d.employeeId)!.department?.name ?? null, firstIn: istHm(d.firstInAt) }))
      .sort((a, b) => (a.firstIn ?? '').localeCompare(b.firstIn ?? ''));
  }

  async log(input: IdCheckInput): Promise<IdCheckRow & { warning: string | null }> {
    const ctx = requireContext();
    let employeeId = input.employeeId ?? null;
    let method = 'MANUAL_PICK';
    if (input.badgeToken) {
      employeeId = await this.cross.employeeIdFromBadge(input.badgeToken);
      if (!employeeId) throw new AppError(422, 'BADGE_UNKNOWN', "This badge wasn't recognised · pick the employee instead");
      const revoked = await this.cardRevoked(input.badgeToken);
      if (revoked) throw new AppError(422, 'BADGE_REVOKED', 'This ID card has been revoked');
      method = 'BADGE_SCAN';
    }
    if (!employeeId) throw badRequest('Scan a badge or pick an employee');
    if (employeeId === ctx.employeeId) throw forbidden("You can't log your own ID card check");
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId }, select: { id: true, fullName: true, userId: true, managerId: true, workLocationId: true } });
    if (!emp) throw notFound('Employee');
    const date = istKeyOf(new Date());
    const day = await this.prisma.attendanceDay.findFirst({ where: { employeeId, date: dateOf(date) }, select: { firstInAt: true, effectiveMode: true } });
    const warning = !day?.firstInAt ? `${emp.fullName} hasn't punched in today` : null;
    const existing = await this.prisma.idCardCheck.findFirst({ where: { employeeId, date: dateOf(date) } });
    const loggedByName = ctx.userName ?? 'Security desk';
    const data = { wearing: input.wearing, photoFileId: input.photoFileId ?? existing?.photoFileId ?? null, method, loggedByUserId: ctx.userId ?? null, loggedByName, note: input.note ?? null, checkedAt: new Date(), locationId: emp.workLocationId };
    const saved = existing
      ? await this.prisma.idCardCheck.update({ where: { id: existing.id }, data })
      : await this.prisma.idCardCheck.create({ data: { employeeId, date: dateOf(date), ...data } as any });
    await this.audit.record({
      action: existing ? 'idcheck.updated' : 'idcheck.logged',
      entity: 'IdCardCheck',
      entityId: saved.id,
      meta: { employeeId, wearing: input.wearing, method, before: existing ? { wearing: existing.wearing, checkedAt: existing.checkedAt.toISOString() } : null } as any,
    });
    if (!input.wearing) await this.remindOne(saved, emp);
    this.realtime.toTenant(ctx.tenantId, 'idcheck.logged', { date });
    return { ...(await this.toRows([saved]))[0]!, warning };
  }

  async update(id: string, wearing: boolean, note?: string | null): Promise<IdCheckRow> {
    const ctx = requireContext();
    const c = await this.prisma.idCardCheck.findFirst({ where: { id } });
    if (!c) throw notFound('ID check');
    if (c.employeeId === ctx.employeeId) throw forbidden("You can't edit your own ID card check");
    const saved = await this.prisma.idCardCheck.update({ where: { id }, data: { wearing, note: note ?? c.note, loggedByName: ctx.userName ?? c.loggedByName, loggedByUserId: ctx.userId ?? null } });
    await this.audit.record({ action: 'idcheck.updated', entity: 'IdCardCheck', entityId: id, meta: { before: { wearing: c.wearing }, after: { wearing } } });
    if (!wearing && c.wearing) {
      const emp = await this.prisma.employee.findFirst({ where: { id: c.employeeId }, select: { id: true, fullName: true, userId: true, managerId: true, workLocationId: true } });
      if (emp) await this.remindOne(saved, emp);
    }
    this.realtime.toTenant(ctx.tenantId, 'idcheck.logged', { date: keyOf(c.date) });
    return (await this.toRows([saved]))[0]!;
  }

  /** "Reminder sent": nudge everyone logged as not wearing today who hasn't been reminded yet. */
  async remindMissing(date = istKeyOf(new Date())) {
    const missing = await this.prisma.idCardCheck.findMany({ where: { date: dateOf(date), wearing: false } });
    let n = 0;
    for (const c of missing) {
      const emp = await this.prisma.employee.findFirst({ where: { id: c.employeeId }, select: { id: true, fullName: true, userId: true, managerId: true, workLocationId: true } });
      if (emp) {
        await this.remindOne(c, emp, true);
        n++;
      }
    }
    await this.audit.record({ action: 'idcheck.reminders_sent', entity: 'IdCardCheck', entityId: date, meta: { date, count: n } });
    return { ok: true, count: n, message: n ? `Reminder sent to ${n} ${n === 1 ? 'employee' : 'employees'}` : 'Everyone checked is wearing their ID' };
  }

  private async remindOne(c: IdCardCheck, emp: { id: string; fullName: string; userId: string | null; managerId: string | null }, force = false) {
    const date = keyOf(c.date);
    if (emp.userId) {
      const already = !force && (await this.prisma.notification.count({ where: { userId: emp.userId, type: 'idcheck.missing', createdAt: { gte: dateOf(date) } } })) > 0;
      if (!already) {
        await this.notifications.notify({
          userIds: [emp.userId],
          type: 'idcheck.missing',
          title: `Please wear your ID card (logged ${istHm(c.checkedAt)} by ${c.loggedByName})`,
          link: '/attendance',
          from: c.loggedByName,
        });
      }
    }
    // 3rd miss this month → RM and HR
    const { from } = monthRange(monthOf(date));
    const misses = await this.prisma.idCardCheck.count({ where: { employeeId: emp.id, wearing: false, date: { gte: dateOf(from), lte: c.date } } });
    if (misses === 3) {
      const users = [...(await this.notifications.usersForEmployees([emp.managerId])), ...(await this.notifications.usersWithPermission('idcompliance.manage'))];
      await this.notifications.notify({ userIds: users, type: 'idcheck.repeat', title: `${emp.fullName} missed their ID card 3 times this month`, link: '/id-compliance', from: 'ID compliance' });
    }
  }

  private async cardRevoked(token: string): Promise<boolean> {
    try {
      const card = await (this.prisma as any).idCard?.findFirst({ where: { verifyToken: token.trim() }, select: { revokedAt: true } });
      return !!card?.revokedAt;
    } catch {
      return false;
    }
  }

  /** Employee Attendance card "ID card check". */
  async mine(employeeId: string): Promise<MyIdCheckCard> {
    const today = istKeyOf(new Date());
    const { from } = monthRange(monthOf(today));
    const [todayRow, monthRows] = await Promise.all([
      this.prisma.idCardCheck.findFirst({ where: { employeeId, date: dateOf(today) } }),
      this.prisma.idCardCheck.findMany({ where: { employeeId, date: { gte: dateOf(from), lte: dateOf(today) } }, select: { wearing: true } }),
    ]);
    const yes = monthRows.filter((r) => r.wearing).length;
    const meta = `Compliance this month: ${yes} / ${monthRows.length} days`;
    if (!todayRow) return { title: 'Not checked today', body: 'Security logs ID cards at the office entrance', meta, checkedToday: false };
    const body = `Logged by ${todayRow.loggedByName} · ${todayRow.photoFileId ? 'photo on file' : 'no photo'}`;
    return { title: todayRow.wearing ? `Verified today, ${istHm(todayRow.checkedAt)}` : `ID missing · logged ${istHm(todayRow.checkedAt)}`, body, meta, checkedToday: true };
  }

  /** File access: HR/admin, or the subject employee, may open an ID-check photo. */
  async canOpenPhoto(fileId: string): Promise<boolean> {
    const ctx = requireContext();
    const c = await this.prisma.idCardCheck.findFirst({ where: { photoFileId: fileId }, select: { employeeId: true } });
    if (!c) return false;
    return c.employeeId === ctx.employeeId || ctx.permissions.has('*') || ctx.permissions.has('idcompliance.manage');
  }

  private async toRows(rows: IdCardCheck[]): Promise<IdCheckRow[]> {
    const emps = await this.prisma.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, fullName: true, department: { select: { name: true } } } });
    const em = new Map(emps.map((e) => [e.id, e]));
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: em.get(r.employeeId)?.fullName ?? '—',
      department: em.get(r.employeeId)?.department?.name ?? null,
      checkedAt: istHm(r.checkedAt)!,
      wearing: r.wearing,
      photo: r.photoFileId ? 'Taken' : 'Skipped',
      photoFileId: r.photoFileId,
      loggedBy: r.loggedByName,
      date: keyOf(r.date),
    }));
  }
}
