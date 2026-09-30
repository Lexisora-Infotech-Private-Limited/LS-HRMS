import { Injectable } from '@nestjs/common';
import type { AttendanceRegularization } from '@prisma/client';
import { REGULARIZATION_TYPE_LABEL, type RegularizationInput, type RegularizationRow } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { OrgService } from '../../../core/org/org.service';
import { hasPerm } from '../../../core/auth/decorators';
import { requireContext, type RequestContext } from '../../../core/context/request-context';
import { AppError, forbidden, notFound } from '../../../core/http/errors';
import { CrossReader } from '../cross';
import { addDays, dateOf, dayLabel, istHm, istInstant, istKeyOf, keyOf, monthOf, monthRange, parseHm } from '../lib/time-utils';
import { AttendanceService } from './attendance.service';
import { PeriodLockService } from './period-lock.service';
import { PolicyService } from './policy.service';

/** Attendance regularization (spec-time F). */
@Injectable()
export class RegularizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly policies: PolicyService,
    private readonly locks: PeriodLockService,
    private readonly cross: CrossReader,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly org: OrgService,
  ) {}

  async create(input: RegularizationInput): Promise<RegularizationRow> {
    const ctx = requireContext();
    const employeeId = this.org.myEmployeeId();
    const emp = await this.policies.employee(employeeId);
    if (!emp) throw notFound('Employee');
    const today = istKeyOf(new Date());
    if (input.date > today) throw new AppError(422, 'REGULARIZATION_FUTURE', "You can't regularize a future date");
    const audience = emp.workMode === 'OFFICE' ? 'OFFICE' : 'REMOTE';
    const policy = await this.policies.get(audience);
    if (input.date < addDays(today, -policy.regularizationWindowDays)) {
      throw new AppError(422, 'REGULARIZATION_WINDOW', `Corrections must be requested within ${policy.regularizationWindowDays} days`);
    }
    await this.locks.assertOpen(input.date);
    const leave = await this.cross.leaveDays([employeeId], input.date, input.date);
    if (leave.reduce((s, l) => s + l.units, 0) >= 1) throw new AppError(409, 'ON_LEAVE', 'You were on approved leave that day');
    const pending = await this.prisma.attendanceRegularization.findFirst({ where: { employeeId, date: dateOf(input.date), status: 'PENDING' } });
    if (pending) throw new AppError(409, 'REGULARIZATION_PENDING', 'A correction for this date is already pending');
    const { from, to } = monthRange(monthOf(input.date));
    const used = await this.prisma.attendanceRegularization.count({ where: { employeeId, date: { gte: dateOf(from), lte: dateOf(to) }, status: { in: ['PENDING', 'APPROVED'] } } });
    if (used >= policy.maxRegularizationsPerMonth) {
      throw new AppError(422, 'REGULARIZATION_LIMIT', `You've used all ${policy.maxRegularizationsPerMonth} corrections for this month`);
    }
    const inAt = input.correctedIn ? istInstant(input.date, parseHm(input.correctedIn)) : null;
    let outAt = input.correctedOut ? istInstant(input.date, parseHm(input.correctedOut)) : null;
    if (inAt && outAt && outAt <= inAt) outAt = new Date(outAt.getTime() + 86_400_000); // night shift out after midnight
    if (inAt && outAt && outAt.getTime() - inAt.getTime() > 16 * 3600_000) throw new AppError(422, 'REGULARIZATION_SPAN', 'The corrected span can be at most 16 hours');
    const approver = emp.managerId && emp.managerId !== employeeId ? emp.managerId : null;
    const row = await this.prisma.attendanceRegularization.create({
      data: {
        employeeId,
        date: dateOf(input.date),
        type: input.type,
        requestedIn: inAt,
        requestedOut: outAt,
        reason: input.reason,
        attachmentFileId: input.attachmentFileId ?? null,
        approverEmployeeId: approver,
      } as any,
    });
    await this.audit.record({ action: 'regularization.requested', entity: 'AttendanceRegularization', entityId: row.id, meta: { date: input.date, type: input.type } });
    const approverUsers = approver ? await this.notifications.usersForEmployees([approver]) : await this.notifications.usersWithPermission('attendance.manage');
    await this.notifications.notify({
      userIds: approverUsers,
      type: 'regularization.requested',
      title: `${emp.fullName} requested an attendance correction for ${dayLabel(input.date)}`,
      body: `${REGULARIZATION_TYPE_LABEL[input.type]} · ${input.reason}`,
      link: '/approvals?tab=corrections',
      from: emp.fullName,
      email: true,
    });
    for (const u of approverUsers) this.realtime.toUser(u, 'approvals.counts', {});
    return (await this.rows([row]))[0]!;
  }

  async mine(month?: string): Promise<RegularizationRow[]> {
    const employeeId = this.org.myEmployeeId();
    const where: any = { employeeId };
    if (month) {
      const { from, to } = monthRange(month);
      where.date = { gte: dateOf(from), lte: dateOf(to) };
    }
    return this.rows(await this.prisma.attendanceRegularization.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 }));
  }

  async cancel(id: string) {
    const employeeId = this.org.myEmployeeId();
    const r = await this.prisma.attendanceRegularization.findFirst({ where: { id, employeeId } });
    if (!r) throw notFound('Correction request');
    if (r.status !== 'PENDING') throw new AppError(409, 'NOT_PENDING', 'Only pending requests can be cancelled');
    await this.prisma.attendanceRegularization.update({ where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() } });
    await this.audit.record({ action: 'regularization.cancelled', entity: 'AttendanceRegularization', entityId: id });
    return { ok: true };
  }

  /** Scope: HR (attendance.manage) sees all; others see requests routed to them. */
  private scopeWhere(ctx: RequestContext) {
    if (hasPerm(ctx, 'attendance.manage')) return {};
    return { approverEmployeeId: ctx.employeeId ?? '__none__' };
  }

  async list(status: string): Promise<RegularizationRow[]> {
    const ctx = requireContext();
    const where: any = { ...this.scopeWhere(ctx), ...(status && status !== 'ALL' ? { status } : {}) };
    if (ctx.employeeId) where.employeeId = { not: ctx.employeeId };
    return this.rows(await this.prisma.attendanceRegularization.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 100 }));
  }

  async pendingCount(ctx: RequestContext): Promise<number> {
    const where: any = { status: 'PENDING', ...this.scopeWhere(ctx) };
    if (ctx.employeeId) where.employeeId = { not: ctx.employeeId };
    return this.prisma.attendanceRegularization.count({ where });
  }

  private async loadForDecision(id: string) {
    const ctx = requireContext();
    const r = await this.prisma.attendanceRegularization.findFirst({ where: { id } });
    if (!r) throw notFound('Correction request');
    if (r.employeeId === ctx.employeeId) throw forbidden("You can't decide your own correction request");
    if (!hasPerm(ctx, 'attendance.manage') && r.approverEmployeeId !== ctx.employeeId) throw forbidden('This request is not routed to you');
    if (r.status !== 'PENDING') throw new AppError(409, 'NOT_PENDING', 'This request has already been decided');
    return { ctx, r };
  }

  async approve(id: string, comment?: string | null) {
    const { ctx, r } = await this.loadForDecision(id);
    const date = keyOf(r.date);
    await this.locks.assertOpen(date);
    // Replace conflicting punches: accepted punches on that day in the corrected direction are superseded.
    if (r.requestedIn || r.requestedOut) {
      const sessions = await this.prisma.workSession.findMany({ where: { employeeId: r.employeeId, attendanceDate: r.date }, orderBy: { startedAt: 'asc' } });
      const inAt = r.requestedIn ?? sessions[0]?.startedAt ?? null;
      const outAt = r.requestedOut ?? sessions.filter((s) => s.endedAt && !s.autoClosed).at(-1)?.endedAt ?? null;
      const punchIds = sessions.flatMap((s) => [s.inPunchId, s.outPunchId].filter((x): x is string => !!x));
      if (punchIds.length) await this.prisma.attendancePunch.updateMany({ where: { id: { in: punchIds } }, data: { status: 'SUPERSEDED' } });
      await this.prisma.workSession.deleteMany({ where: { employeeId: r.employeeId, attendanceDate: r.date } });
      if (inAt) {
        const pin = await this.prisma.attendancePunch.create({
          data: { employeeId: r.employeeId, attendanceDate: r.date, punchedAt: inAt, direction: 'IN', source: 'REGULARIZATION', status: 'ACCEPTED', regularizationId: r.id, createdByName: ctx.userName ?? null } as any,
        });
        let outId: string | null = null;
        if (outAt) {
          const pout = await this.prisma.attendancePunch.create({
            data: { employeeId: r.employeeId, attendanceDate: r.date, punchedAt: outAt, direction: 'OUT', source: 'REGULARIZATION', status: 'ACCEPTED', regularizationId: r.id, createdByName: ctx.userName ?? null } as any,
          });
          outId = pout.id;
        }
        await this.prisma.workSession.create({
          data: { employeeId: r.employeeId, attendanceDate: r.date, inPunchId: pin.id, outPunchId: outId, startedAt: inAt, endedAt: outAt, source: 'REGULARIZATION' } as any,
        });
      }
    }
    const saved = await this.prisma.attendanceRegularization.update({ where: { id }, data: { status: 'APPROVED', decidedAt: new Date(), decidedByName: ctx.userName ?? null, decisionComment: comment ?? null } });
    await this.attendance.recomputeDay(r.employeeId, date);
    await this.audit.record({ action: 'regularization.approved', entity: 'AttendanceRegularization', entityId: id, meta: { date, type: r.type } });
    await this.notifyEmployee(saved, `Attendance correction for ${dayLabel(date)} approved`, comment);
    return (await this.rows([saved]))[0]!;
  }

  async reject(id: string, comment: string) {
    const { ctx, r } = await this.loadForDecision(id);
    const saved = await this.prisma.attendanceRegularization.update({ where: { id }, data: { status: 'REJECTED', decidedAt: new Date(), decidedByName: ctx.userName ?? null, decisionComment: comment } });
    await this.audit.record({ action: 'regularization.rejected', entity: 'AttendanceRegularization', entityId: id, meta: { date: keyOf(r.date), comment } });
    await this.notifyEmployee(saved, `Attendance correction for ${dayLabel(keyOf(r.date))} rejected`, comment);
    return (await this.rows([saved]))[0]!;
  }

  private async notifyEmployee(r: AttendanceRegularization, title: string, comment?: string | null) {
    const ctx = requireContext();
    const users = await this.notifications.usersForEmployees([r.employeeId]);
    await this.notifications.notify({ userIds: users, type: 'regularization.decided', title, body: comment ?? undefined, link: '/attendance', from: ctx.userName ?? 'Manager' });
    if (ctx.userId) this.realtime.toUser(ctx.userId, 'approvals.counts', {});
  }

  async rows(list: AttendanceRegularization[]): Promise<RegularizationRow[]> {
    if (!list.length) return [];
    const empIds = [...new Set(list.flatMap((r) => [r.employeeId, r.approverEmployeeId].filter((x): x is string => !!x)))];
    const emps = await this.prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, fullName: true } });
    const names = new Map(emps.map((e) => [e.id, e.fullName]));
    const out: RegularizationRow[] = [];
    for (const r of list) {
      const date = keyOf(r.date);
      const devicePunches =
        r.status === 'PENDING'
          ? (await this.prisma.attendancePunch.count({ where: { employeeId: r.employeeId, attendanceDate: r.date, source: { in: ['BIOMETRIC', 'DESKTOP'] }, status: 'ACCEPTED', createdAt: { gt: r.createdAt } } })) > 0
          : false;
      out.push({
        id: r.id,
        employeeId: r.employeeId,
        employeeName: names.get(r.employeeId) ?? '—',
        date,
        dateLabel: dayLabel(date),
        type: r.type,
        typeLabel: REGULARIZATION_TYPE_LABEL[r.type],
        requestedIn: istHm(r.requestedIn),
        requestedOut: istHm(r.requestedOut),
        reason: r.reason,
        status: r.status,
        approverName: r.approverEmployeeId ? (names.get(r.approverEmployeeId) ?? null) : 'HR',
        decidedByName: r.decidedByName,
        decisionComment: r.decisionComment,
        createdAt: r.createdAt.toISOString(),
        devicePunchesNow: devicePunches,
      });
    }
    return out;
  }
}
