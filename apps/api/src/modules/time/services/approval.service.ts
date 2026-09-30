import { Injectable } from '@nestjs/common';
import type { TimesheetApprovalStep } from '@prisma/client';
import { TIMESHEET_STATUS_LABEL, type ApprovalDetail, type ApprovalList, type ApprovalRow, type ApproveStepInput, type ReviewItem, type ScreenshotThumb, type TimesheetStatusKey } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { EventsService } from '../../../core/registry/events.service';
import { hasPerm } from '../../../core/auth/decorators';
import { requireContext, type RequestContext } from '../../../core/context/request-context';
import { AppError, forbidden, notFound } from '../../../core/http/errors';
import { CrossReader } from '../cross';
import { dayLabel, hm, istHm, keyOf, weekLabel } from '../lib/time-utils';
import { PolicyService } from './policy.service';
import { RegularizationService } from './regularization.service';
import { TimesheetService } from './timesheet.service';

const SHOTS_PAGE = 24;

export function isApprovalAdmin(ctx: RequestContext): boolean {
  return ctx.permissions.has('*') || ctx.roleKey === 'admin';
}

/** Timesheet approvals (spec-time K): L1 per project lead, L2 reporting manager. */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: TimesheetService,
    private readonly policies: PolicyService,
    private readonly regs: RegularizationService,
    private readonly cross: CrossReader,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly events: EventsService,
  ) {}

  private stepScope(ctx: RequestContext, level?: number) {
    const where: any = { ...(level ? { level } : {}) };
    if (!isApprovalAdmin(ctx)) where.approverEmployeeId = ctx.employeeId ?? '__none__';
    return where;
  }

  /** Distinct timesheets waiting on the viewer (dashboard count). */
  async pendingCounts(ctx: RequestContext) {
    const own = ctx.employeeId ? { timesheet: { employeeId: { not: ctx.employeeId } } } : {};
    const [l1, l2] = await Promise.all([
      this.prisma.timesheetApprovalStep.count({ where: { ...this.stepScope(ctx, 1), status: 'PENDING', ...own } }),
      this.prisma.timesheetApprovalStep.count({ where: { ...this.stepScope(ctx, 2), status: 'PENDING', ...own } }),
    ]);
    return { l1, l2 };
  }

  async list(level: number, status: string): Promise<ApprovalList> {
    const ctx = requireContext();
    const where: any = { ...this.stepScope(ctx, level) };
    if (status === 'PENDING') where.status = 'PENDING';
    else if (status === 'APPROVED') where.status = 'APPROVED';
    else if (status === 'RETURNED') where.status = 'RETURNED';
    else where.status = { in: ['PENDING', 'APPROVED', 'RETURNED'] };
    if (ctx.employeeId) where.timesheet = { employeeId: { not: ctx.employeeId } };
    const steps = await this.prisma.timesheetApprovalStep.findMany({ where, include: { timesheet: true }, orderBy: [{ createdAt: 'asc' }], take: 200 });
    const empIds = [...new Set(steps.map((s) => s.timesheet.employeeId))];
    const names = new Map((await this.prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
    const projects = await this.cross.projectMap(steps.map((s) => s.projectId).filter((x): x is string => !!x));
    const items: ApprovalRow[] = [];
    for (const s of steps) {
      const t = s.timesheet;
      const from = keyOf(t.weekStart);
      const to = keyOf(t.weekEnd);
      const flags = await this.flagCount(s);
      const st = t.status as TimesheetStatusKey;
      items.push({
        stepId: s.id,
        timesheetId: t.id,
        level: s.level,
        employeeId: t.employeeId,
        name: names.get(t.employeeId) ?? '—',
        week: weekLabel(from, to, true),
        weekStart: from,
        workedMinutes: t.totalMinutes,
        idleMinutes: t.idleMinutes,
        hours: hm(t.totalMinutes),
        idle: hm(t.idleMinutes),
        shots: t.screenshotCount,
        flags,
        status: st,
        statusLabel: s.status === 'RETURNED' ? 'Sent back' : TIMESHEET_STATUS_LABEL[st],
        stepStatus: s.status,
        projectName: s.projectId ? (projects.get(s.projectId)?.name ?? null) : null,
      });
    }
    const counts = await this.pendingCounts(ctx);
    const canCorrections = hasPerm(ctx, 'attendance.regularize.approve') || hasPerm(ctx, 'attendance.manage');
    return {
      items,
      counts: { ...counts, corrections: canCorrections ? await this.regs.pendingCount(ctx) : 0 },
      canL1: hasPerm(ctx, 'timesheet.approve.l1'),
      canL2: hasPerm(ctx, 'timesheet.approve.l2'),
      canCorrections,
      isAdmin: isApprovalAdmin(ctx),
    };
  }

  private async flagCount(s: TimesheetApprovalStep & { timesheet: { id: string; employeeId: string; weekStart: Date; weekEnd: Date } }) {
    const ohWhere: any = { timesheetId: s.timesheetId, reviewStatus: 'PENDING_PL', ...(s.level === 1 ? { projectId: s.projectId } : {}) };
    const [oh, adj] = await Promise.all([
      this.prisma.outsideHoursEntry.count({ where: ohWhere }),
      this.prisma.timesheetAdjustment.count({ where: { timesheetId: s.timesheetId, reviewStatus: 'PENDING_PL' } }),
    ]);
    const claims = (await this.cross.idleClaims(s.timesheet.employeeId, keyOf(s.timesheet.weekStart), keyOf(s.timesheet.weekEnd))).filter((c) => c.status === 'PENDING').length;
    return oh + adj + claims;
  }

  private async loadStep(stepId: string) {
    const ctx = requireContext();
    const step = await this.prisma.timesheetApprovalStep.findFirst({ where: { id: stepId }, include: { timesheet: true } });
    if (!step) throw notFound('Approval step');
    const admin = isApprovalAdmin(ctx);
    if (!admin && step.approverEmployeeId !== ctx.employeeId) throw forbidden('This timesheet is not routed to you');
    return { ctx, step, admin };
  }

  async detail(stepId: string, q: { page?: number; date?: string; taskKey?: string }): Promise<ApprovalDetail> {
    const { ctx, step, admin } = await this.loadStep(stepId);
    const t = step.timesheet;
    const from = keyOf(t.weekStart);
    const to = keyOf(t.weekEnd);
    const scopeProjectId = step.level === 1 ? step.projectId : undefined;
    const week = await this.sheets.weekDto(t.id, { owner: false, ...(scopeProjectId !== undefined ? { scopeProjectId } : {}) });
    const full = await this.sheets.load(t.id);
    const scopedLines = full.lines.filter((l) => scopeProjectId === undefined || l.projectId === scopeProjectId);
    const otherProjectsMinutes = scopeProjectId === undefined ? 0 : full.lines.filter((l) => l.projectId !== scopeProjectId).reduce((s, l) => s + l.cells.reduce((a, c) => a + c.finalMinutes, 0), 0);
    const taskIds = scopedLines.map((l) => l.taskId).filter((x): x is string => !!x);
    const tasks = await this.cross.taskMap([...taskIds, ...full.lines.map((l) => l.taskId).filter((x): x is string => !!x)]);

    // items needing review
    const items: ReviewItem[] = [];
    const oh = await this.prisma.outsideHoursEntry.findMany({ where: { timesheetId: t.id, ...(scopeProjectId !== undefined ? { projectId: scopeProjectId } : {}) }, orderBy: { date: 'asc' } });
    for (const o of oh) {
      const d = keyOf(o.date);
      items.push({ type: 'OUTSIDE_HOURS', id: o.id, date: d, dateLabel: `${dayLabel(d)} · ${istHm(o.startAt)}–${istHm(o.endAt)}`, minutes: o.minutes, task: o.taskText, reason: o.reason, status: o.reviewStatus === 'PENDING_PL' ? 'PENDING' : o.reviewStatus });
    }
    const cellIds = new Map(scopedLines.flatMap((l) => l.cells.map((c) => [c.id, { line: l, date: keyOf(c.date) }] as const)));
    const adjs = await this.prisma.timesheetAdjustment.findMany({ where: { timesheetId: t.id, kind: 'MANUAL_INCREASE', reviewStatus: { in: ['PENDING_PL', 'ACCEPTED', 'REJECTED'] } }, orderBy: { createdAt: 'asc' } });
    for (const a of adjs) {
      const c = cellIds.get(a.cellId);
      if (!c) continue;
      items.push({ type: 'MANUAL_INCREASE', id: a.id, date: c.date, dateLabel: dayLabel(c.date), minutes: a.deltaMinutes, task: c.line.label, reason: a.reason, status: a.reviewStatus === 'PENDING_PL' ? 'PENDING' : a.reviewStatus });
    }
    const claims = await this.cross.idleClaims(t.employeeId, from, to);
    for (const c of claims) {
      if (scopeProjectId !== undefined) {
        const task = c.taskId ? tasks.get(c.taskId) : undefined;
        const proj = task?.projectId ?? (c as any).projectId ?? null;
        if (proj !== scopeProjectId) continue;
      }
      const d = keyOf(c.workDate);
      items.push({ type: 'IDLE_AS_WORK', id: c.id, date: d, dateLabel: `${dayLabel(d)} · ${istHm(c.startAt)}–${istHm(c.endAt)}`, minutes: c.minutes, task: (c.taskId && tasks.get(c.taskId)?.key) || 'Idle marked as work', reason: c.note ?? '', status: c.status });
    }

    // screenshots mapped to tasks
    const scopeTaskIds = scopeProjectId !== undefined ? taskIds : undefined;
    const keyToId = new Map([...tasks.values()].map((x) => [x.key, x.id]));
    const filterTask = q.taskKey ? keyToId.get(q.taskKey) : undefined;
    const taskFilter = filterTask ? [filterTask] : scopeTaskIds;
    const page = Math.max(1, q.page ?? 1);
    const [total, shots, all] = await Promise.all([
      this.cross.screenshotCount(t.employeeId, from, to, { taskIds: taskFilter, date: q.date }),
      this.cross.screenshots(t.employeeId, from, to, { taskIds: taskFilter, date: q.date, skip: (page - 1) * SHOTS_PAGE, take: SHOTS_PAGE }),
      this.cross.screenshots(t.employeeId, from, to, { taskIds: scopeTaskIds }),
    ]);
    const byTaskMap = new Map<string, number>();
    const dayset = new Set<string>();
    for (const s of all) {
      const k = (s.taskId && tasks.get(s.taskId)?.key) || 'Untagged';
      byTaskMap.set(k, (byTaskMap.get(k) ?? 0) + 1);
      dayset.add(keyOf(s.workDate));
    }
    const thumbs: ScreenshotThumb[] = shots.map((s) => ({ id: s.id, capturedAt: s.capturedAt.toISOString(), time: istHm(s.capturedAt)!, taskKey: (s.taskId && tasks.get(s.taskId)?.key) || '—', fileId: s.thumbFileId ?? s.fileId, blurred: s.blurred }));

    const events = await this.prisma.timesheetEvent.findMany({ where: { timesheetId: t.id }, orderBy: { at: 'desc' }, take: 30 });
    const approver = await this.prisma.employee.findFirst({ where: { id: step.approverEmployeeId }, select: { fullName: true } });
    const projectName = step.projectId ? ((await this.cross.projects([step.projectId]))[0]?.name ?? null) : null;
    const workedMin = week.totals.worked;
    return {
      step: { id: step.id, level: step.level, status: step.status, projectId: step.projectId, projectName, approverName: approver?.fullName ?? null },
      timesheet: week,
      kpis: { worked: hm(scopeProjectId !== undefined ? workedMin : t.totalMinutes), idle: hm(t.idleMinutes), shots: scopeProjectId !== undefined ? all.length : t.screenshotCount || all.length },
      otherProjectsMinutes,
      items,
      screenshots: { total, page, pageSize: SHOTS_PAGE, items: thumbs, byTask: [...byTaskMap.entries()].map(([taskKey, count]) => ({ taskKey, count })).sort((a, b) => b.count - a.count), days: [...dayset].sort() },
      history: events.map((e) => ({ type: e.type, actor: e.actorName, level: e.level, comment: e.comment, at: e.at.toISOString() })),
      lateDataBanner: t.hasLateData ? 'New tracker data arrived after submission · totals shown are from the submitted snapshot' : null,
      canAct: step.status === 'PENDING' && (admin || step.approverEmployeeId === ctx.employeeId) && t.employeeId !== ctx.employeeId,
    };
  }

  /** Apply Accept/Reject decisions on outside-hours entries and manual increases (default: accept pending items in scope). */
  private async applyDecisions(step: TimesheetApprovalStep, decisions: ApproveStepInput['decisions'], actor: string) {
    const now = new Date();
    const scope = step.level === 1 ? { projectId: step.projectId } : {};
    const pendingOh = await this.prisma.outsideHoursEntry.findMany({ where: { timesheetId: step.timesheetId, reviewStatus: 'PENDING_PL', ...scope } });
    let changed = false;
    for (const o of pendingOh) {
      const d = decisions.find((x) => x.type === 'OUTSIDE_HOURS' && x.id === o.id);
      const status = d?.decision === 'REJECT' ? 'REJECTED' : 'ACCEPTED';
      await this.prisma.outsideHoursEntry.update({ where: { id: o.id }, data: { reviewStatus: status, reviewedByName: actor, reviewedAt: now, reviewComment: d?.note ?? null } });
      changed = changed || status === 'REJECTED';
    }
    const sheet = await this.sheets.load(step.timesheetId);
    const scopedCells = new Map(sheet.lines.filter((l) => step.level !== 1 || l.projectId === step.projectId).flatMap((l) => l.cells.map((c) => [c.id, c] as const)));
    const pendingAdj = await this.prisma.timesheetAdjustment.findMany({ where: { timesheetId: step.timesheetId, reviewStatus: 'PENDING_PL' } });
    for (const a of pendingAdj) {
      const cell = scopedCells.get(a.cellId);
      if (!cell) continue;
      const d = decisions.find((x) => x.type === 'MANUAL_INCREASE' && x.id === a.id);
      const reject = d?.decision === 'REJECT';
      await this.prisma.timesheetAdjustment.update({ where: { id: a.id }, data: { reviewStatus: reject ? 'REJECTED' : 'ACCEPTED', reviewedByName: actor, reviewedAt: now } });
      if (reject) {
        const adj = cell.adjustmentMinutes - a.deltaMinutes;
        await this.prisma.timesheetCell.update({ where: { id: cell.id }, data: { adjustmentMinutes: adj, finalMinutes: Math.max(0, cell.trackedMinutes + cell.idleAsWorkMinutes + cell.outsideHoursMinutes + adj) } });
        changed = true;
      }
    }
    if (changed) await this.sheets.syncOutsideHours(step.timesheetId);
  }

  async approve(stepId: string, input: ApproveStepInput) {
    const { ctx, step } = await this.loadStep(stepId);
    const t = step.timesheet;
    if (t.employeeId === ctx.employeeId) throw forbidden("You can't approve your own timesheet");
    if (step.status !== 'PENDING') throw new AppError(409, 'STEP_DECIDED', 'This step has already been decided');
    const actor = ctx.userName ?? 'Approver';
    await this.applyDecisions(step, input.decisions ?? [], actor);
    const now = new Date();
    await this.prisma.timesheetApprovalStep.update({ where: { id: step.id }, data: { status: 'APPROVED', actedByName: actor, actedAt: now, comment: input.comment ?? null } });
    await this.prisma.timesheetEvent.create({ data: { timesheetId: t.id, type: 'approved', actorName: actor, level: step.level, comment: input.comment ?? null } as any });
    const emp = (await this.policies.employee(t.employeeId))!;
    const label = weekLabel(keyOf(t.weekStart), keyOf(t.weekEnd), true);
    let message: string;
    let notifyApprover: string | null = null;
    if (step.level === 1) {
      const remaining = await this.prisma.timesheetApprovalStep.count({ where: { timesheetId: t.id, cycle: t.cycle, level: 1, status: 'PENDING' } });
      if (remaining) {
        message = `${emp.fullName} → your review is done · waiting on other Project Leads`;
      } else {
        const l1By = (await this.prisma.timesheetApprovalStep.findMany({ where: { timesheetId: t.id, cycle: t.cycle, level: 1, status: 'APPROVED' }, select: { approverEmployeeId: true } })).map((s) => s.approverEmployeeId);
        const l2 = await this.sheets.createL2(t, t.cycle, emp, l1By);
        if (l2 && l2.status === 'PENDING') {
          await this.prisma.timesheet.update({ where: { id: t.id }, data: { status: 'PENDING_RM' } });
          notifyApprover = l2.approverEmployeeId;
          message = `${emp.fullName} → forwarded to Reporting Manager`;
        } else {
          await this.finalApprove(t.id, emp, label);
          message = `${emp.fullName} → approved, sent to payroll`;
        }
      }
    } else {
      await this.finalApprove(t.id, emp, label);
      message = `${emp.fullName} → approved, sent to payroll`;
    }
    if (notifyApprover) {
      const users = await this.notifications.usersForEmployees([notifyApprover]);
      await this.notifications.notify({ userIds: users, type: 'approval', title: `${emp.fullName}'s timesheet (${label}) is ready for your sign-off`, body: `Project Lead review done by ${actor}.`, link: '/approvals', from: actor });
      for (const u of users) this.realtime.toUser(u, 'approvals.counts', {});
    }
    if (ctx.userId) this.realtime.toUser(ctx.userId, 'approvals.counts', {});
    if (emp.userId) this.realtime.toUser(emp.userId, 'timesheet.updated', { id: t.id });
    await this.audit.record({ action: 'timesheet.step.approved', entity: 'Timesheet', entityId: t.id, meta: { stepId: step.id, level: step.level, projectId: step.projectId, override: step.approverEmployeeId !== ctx.employeeId, decisions: (input.decisions ?? []) as any } });
    return { ok: true, message };
  }

  private async finalApprove(timesheetId: string, emp: { id: string; userId: string | null; fullName: string }, label: string) {
    const t = await this.prisma.timesheet.update({ where: { id: timesheetId }, data: { status: 'APPROVED', approvedAt: new Date() } });
    this.events.emit('timesheet.approved', { timesheetId, employeeId: emp.id, weekStart: keyOf(t.weekStart) });
    if (emp.userId) {
      await this.notifications.notify({ userIds: [emp.userId], type: 'timesheet', title: `Timesheet ${label} approved, sent to payroll`, link: '/timesheet', from: requireContext().userName ?? 'Approver' });
    }
  }

  async returnStep(stepId: string, comment: string) {
    const { ctx, step } = await this.loadStep(stepId);
    const t = step.timesheet;
    if (t.employeeId === ctx.employeeId) throw forbidden("You can't review your own timesheet");
    if (step.status !== 'PENDING') throw new AppError(409, 'STEP_DECIDED', 'This step has already been decided');
    const actor = ctx.userName ?? 'Approver';
    const now = new Date();
    await this.prisma.timesheetApprovalStep.update({ where: { id: step.id }, data: { status: 'RETURNED', actedByName: actor, actedAt: now, comment } });
    const others = await this.prisma.timesheetApprovalStep.findMany({ where: { timesheetId: t.id, cycle: t.cycle, status: 'PENDING', id: { not: step.id } }, select: { approverEmployeeId: true } });
    await this.prisma.timesheetApprovalStep.updateMany({ where: { timesheetId: t.id, cycle: t.cycle, status: 'PENDING', id: { not: step.id } }, data: { status: 'CANCELLED' } });
    await this.prisma.timesheet.update({ where: { id: t.id }, data: { status: 'RETURNED', returnedComment: comment, returnedByName: actor, version: { increment: 1 } } });
    await this.prisma.timesheetEvent.create({ data: { timesheetId: t.id, type: 'returned', actorName: actor, level: step.level, comment } as any });
    const emp = (await this.policies.employee(t.employeeId))!;
    const label = weekLabel(keyOf(t.weekStart), keyOf(t.weekEnd), true);
    if (emp.userId) {
      await this.notifications.notify({ userIds: [emp.userId], type: 'timesheet', title: `Timesheet ${label} sent back by ${actor}`, body: comment, link: '/timesheet', from: actor, email: true });
      this.realtime.toUser(emp.userId, 'timesheet.updated', { id: t.id });
    }
    const users = await this.notifications.usersForEmployees(others.map((o) => o.approverEmployeeId));
    for (const u of [...users, ...(ctx.userId ? [ctx.userId] : [])]) this.realtime.toUser(u, 'approvals.counts', {});
    this.events.emit('timesheet.returned', { timesheetId: t.id, employeeId: t.employeeId, weekStart: keyOf(t.weekStart) });
    await this.audit.record({ action: 'timesheet.step.returned', entity: 'Timesheet', entityId: t.id, meta: { stepId: step.id, level: step.level, comment } });
    return { ok: true, message: `${emp.fullName} → sent back with comment` };
  }

  /** Hourly: remind approvers of overdue steps once. */
  async remindOverdue(now = new Date()) {
    const due = await this.prisma.timesheetApprovalStep.findMany({ where: { status: 'PENDING', dueAt: { lt: now }, escalatedAt: null }, include: { timesheet: true } });
    for (const s of due) {
      const users = await this.notifications.usersForEmployees([s.approverEmployeeId]);
      const name = (await this.prisma.employee.findFirst({ where: { id: s.timesheet.employeeId }, select: { fullName: true } }))?.fullName ?? 'An employee';
      await this.notifications.notify({ userIds: users, type: 'approval', title: `Overdue: ${name}'s timesheet ${weekLabel(keyOf(s.timesheet.weekStart), keyOf(s.timesheet.weekEnd), true)}`, link: '/approvals', from: 'Timesheets' });
      await this.prisma.timesheetApprovalStep.update({ where: { id: s.id }, data: { escalatedAt: now } });
    }
    return due.length;
  }
}
