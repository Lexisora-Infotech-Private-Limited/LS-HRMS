import { Injectable } from '@nestjs/common';
import type {
  DaySummariesQuery,
  DaySummaryRow,
  IdleClaimDecideInput,
  IdleClaimRow,
  IdleClaimsQuery,
  IntegrityEventRow,
  ScreenshotRow,
  ScreenshotsQuery,
  TrackerPerTask,
  TrackerTimelineBlock,
} from '@lexisora/shared';
import type { IdleClaim, Prisma, Screenshot } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { EventsService } from '../../core/registry/events.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { OrgService } from '../../core/org/org.service';
import { badRequest, forbidden, notFound } from '../../core/http/errors';
import { hasPerm } from '../../core/auth/decorators';
import { requireContext, type RequestContext } from '../../core/context/request-context';
import { IngestService } from './ingest.service';
import { addDays, dateKeyOf, dbDate, weekStartOf } from './tracker.rules';

const fmtHm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

export type ViewerScope = { all: boolean; self: string | null; reports: Set<string>; ledProjects: Set<string> };

/**
 * Reviewer-facing reads and decisions (used inside time's approvals UI and attendance):
 * idle claims, screenshots, day summaries, integrity flags — all relationship-scoped:
 * self, reporting tree (RM chain), project lead of the task's project, admin.
 * HR is intentionally NOT granted screenshots (master design default).
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly ingest: IngestService,
  ) {}

  isAdmin(ctx: RequestContext) {
    return ctx.permissions.has('*') || ctx.roleKey === 'admin';
  }

  async scope(ctx = requireContext()): Promise<ViewerScope> {
    const me = ctx.employeeId ?? null;
    if (this.isAdmin(ctx)) return { all: true, self: me, reports: new Set(), ledProjects: new Set() };
    const [reports, led] = await Promise.all([
      me ? this.org.reportTree(me) : Promise.resolve([] as string[]),
      me ? this.prisma.project.findMany({ where: { leadEmployeeId: me }, select: { id: true } }) : Promise.resolve([] as { id: string }[]),
    ]);
    return { all: false, self: me, reports: new Set(reports), ledProjects: new Set(led.map((p) => p.id)) };
  }

  /** Screenshot visibility: own, RM chain, project lead of the shot's project, admin. */
  canViewShot(s: ViewerScope, shot: Pick<Screenshot, 'employeeId' | 'projectId'>) {
    return s.all || shot.employeeId === s.self || s.reports.has(shot.employeeId) || (!!shot.projectId && s.ledProjects.has(shot.projectId));
  }

  /** fileAccessCheckers hook: may the current user open this private file (a screenshot)? */
  async canOpenFile(ctx: RequestContext, fileId: string): Promise<boolean> {
    const shot = await this.prisma.screenshot.findFirst({ where: { OR: [{ fileId }, { thumbFileId: fileId }] }, select: { employeeId: true, projectId: true } });
    if (!shot) return false;
    return this.canViewShot(await this.scope(ctx), shot);
  }

  private weekRange(week?: string) {
    if (!week) return undefined;
    const ws = weekStartOf(week);
    return { gte: dbDate(ws), lte: dbDate(addDays(ws, 6)) };
  }

  // ── idle claims ─────────────────────────────────────────────────────────
  private canDecideClaim(s: ViewerScope, c: Pick<IdleClaim, 'employeeId' | 'reviewerEmployeeId' | 'projectId'>) {
    if (c.employeeId === s.self) return false; // no self-review
    return s.all || c.reviewerEmployeeId === s.self || (!!c.projectId && s.ledProjects.has(c.projectId)) || s.reports.has(c.employeeId);
  }

  async listClaims(q: IdleClaimsQuery): Promise<IdleClaimRow[]> {
    const ctx = requireContext();
    const s = await this.scope(ctx);
    const where: Prisma.IdleClaimWhereInput = { ...(q.status ? { status: q.status } : {}) };
    const wr = this.weekRange(q.week);
    if (wr) where.workDate = wr;
    if (q.employeeId) {
      where.employeeId = q.employeeId;
      if (!s.all && q.employeeId !== s.self && !s.reports.has(q.employeeId)) {
        // project leads see claims on their projects (or routed to them)
        where.OR = [{ reviewerEmployeeId: s.self ?? '__none__' }, { projectId: { in: [...s.ledProjects] } }];
      }
    } else if (!s.all) {
      where.OR = [
        { reviewerEmployeeId: s.self ?? '__none__' },
        { projectId: { in: [...s.ledProjects] } },
        { employeeId: { in: [...s.reports] } },
        ...(s.self ? [{ employeeId: s.self }] : []),
      ];
    }
    const claims = await this.prisma.idleClaim.findMany({ where, orderBy: [{ workDate: 'desc' }, { startAt: 'asc' }], take: 300 });
    return this.claimRows(claims, s);
  }

  private async claimRows(claims: IdleClaim[], s: ViewerScope): Promise<IdleClaimRow[]> {
    const empIds = [...new Set(claims.flatMap((c) => [c.employeeId, c.reviewerEmployeeId].filter((x): x is string => !!x)))];
    const taskIds = [...new Set(claims.map((c) => c.taskId).filter((x): x is string => !!x))];
    const [emps, tasks] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, fullName: true } }),
      taskIds.length ? this.prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, key: true, title: true } }) : Promise.resolve([]),
    ]);
    const e = new Map(emps.map((x) => [x.id, x.fullName]));
    const t = new Map(tasks.map((x) => [x.id, x]));
    return claims.map((c) => ({
      id: c.id,
      employee: { id: c.employeeId, name: e.get(c.employeeId) ?? '—' },
      workDate: dateKeyOf(c.workDate),
      startAt: c.startAt.toISOString(),
      endAt: c.endAt.toISOString(),
      minutes: c.minutes,
      task: c.taskId && t.get(c.taskId) ? { id: c.taskId, key: t.get(c.taskId)!.key, title: t.get(c.taskId)!.title } : null,
      note: c.note,
      status: c.status as IdleClaimRow['status'],
      reviewer: c.reviewerEmployeeId ? { id: c.reviewerEmployeeId, name: e.get(c.reviewerEmployeeId) ?? '—' } : null,
      decidedAt: c.decidedAt?.toISOString() ?? null,
      comment: c.comment,
      canDecide: this.canDecideClaim(s, c),
    }));
  }

  async decideClaim(id: string, input: IdleClaimDecideInput): Promise<IdleClaimRow> {
    const ctx = requireContext();
    const s = await this.scope(ctx);
    const c = await this.prisma.idleClaim.findUnique({ where: { id } });
    if (!c) throw notFound('Idle claim');
    if (!this.canDecideClaim(s, c)) throw forbidden(c.employeeId === s.self ? 'You cannot review your own idle claim' : 'You do not review this idle claim');
    // A comment is optional per claim; the approvals UI makes "Comment to employee" mandatory when any claim is rejected.
    const override = c.status !== 'PENDING' && c.status !== input.status;
    if (c.status === input.status) return (await this.claimRows([c], s))[0]!;
    const updated = await this.prisma.idleClaim.update({
      where: { id },
      data: { status: input.status, decidedAt: new Date(), decidedByUserId: ctx.userId, comment: input.comment?.trim() || null, ...(s.self && !c.reviewerEmployeeId ? { reviewerEmployeeId: s.self } : {}) },
    });
    const dateKey = dateKeyOf(c.workDate);
    await this.ingest.projectDay(c.employeeId, dateKey);
    await this.audit.record({
      action: override ? 'idle.claim.overridden' : 'idle.claim.decided',
      entity: 'IdleClaim',
      entityId: id,
      meta: { status: input.status, minutes: c.minutes, employeeId: c.employeeId, workDate: dateKey },
    });
    const users = await this.notifications.usersForEmployees([c.employeeId]);
    await this.notifications.notify({
      userIds: users,
      type: 'tracker',
      title: `Idle claim ${fmtHm(c.startAt)}–${fmtHm(c.endAt)} ${input.status === 'APPROVED' ? 'approved' : 'rejected'} by ${ctx.userName?.split(' ')[0] ?? 'your reviewer'}`,
      body: input.comment?.trim() || `${c.minutes} min on ${dateKey}`,
      link: '/timesheet',
      from: ctx.userName,
    });
    this.events.emit('idle.claimDecided', { claimId: id, employeeId: c.employeeId, workDate: dateKey, status: input.status });
    this.events.emit('tracker.segmentsIngested', { employeeId: c.employeeId, workDates: [dateKey] });
    return (await this.claimRows([updated], s))[0]!;
  }

  /** Implicit approval: when a timesheet is approved, pending claims of that week become APPROVED. */
  async approvePendingForWeek(employeeId: string, weekStart: string) {
    const range = { gte: dbDate(weekStartOf(weekStart)), lte: dbDate(addDays(weekStartOf(weekStart), 6)) };
    const pending = await this.prisma.idleClaim.findMany({ where: { employeeId, status: 'PENDING', workDate: range } });
    if (!pending.length) return 0;
    await this.prisma.idleClaim.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: 'APPROVED', decidedAt: new Date(), comment: 'Approved with the timesheet' } });
    const dates = [...new Set(pending.map((p) => dateKeyOf(p.workDate)))];
    for (const d of dates) await this.ingest.projectDay(employeeId, d);
    for (const p of pending) this.events.emit('idle.claimDecided', { claimId: p.id, employeeId, workDate: dateKeyOf(p.workDate), status: 'APPROVED' });
    this.events.emit('tracker.segmentsIngested', { employeeId, workDates: dates });
    return pending.length;
  }

  async pendingClaimCount(ctx: RequestContext) {
    if (!ctx.employeeId) return 0;
    return this.prisma.idleClaim.count({ where: { status: 'PENDING', reviewerEmployeeId: ctx.employeeId } });
  }

  // ── screenshots ─────────────────────────────────────────────────────────
  async listScreenshots(q: ScreenshotsQuery): Promise<{ items: ScreenshotRow[]; total: number; intervalMin: number | null }> {
    const ctx = requireContext();
    const s = await this.scope(ctx);
    const employeeId = q.employeeId ?? s.self;
    if (!employeeId) throw badRequest('employeeId is required');
    const where: Prisma.ScreenshotWhereInput = { employeeId, purgedAt: null };
    if (q.date) where.workDate = dbDate(q.date);
    else if (q.week) where.workDate = this.weekRange(q.week);
    if (q.taskId) where.taskId = q.taskId;
    if (!s.all && employeeId !== s.self && !s.reports.has(employeeId)) {
      if (!s.ledProjects.size) throw forbidden('Screenshots are visible to the employee, their reporting manager and project lead');
      where.projectId = { in: [...s.ledProjects] };
    }
    const [total, shots] = await Promise.all([
      this.prisma.screenshot.count({ where }),
      this.prisma.screenshot.findMany({ where, orderBy: { capturedAt: 'asc' }, take: q.limit }),
    ]);
    const taskIds = [...new Set(shots.map((x) => x.taskId).filter((x): x is string => !!x))];
    const devIds = [...new Set(shots.map((x) => x.deviceId).filter((x): x is string => !!x))];
    const [tasks, devices] = await Promise.all([
      taskIds.length ? this.prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, key: true, title: true } }) : Promise.resolve([]),
      devIds.length ? this.prisma.trackerDevice.findMany({ where: { id: { in: devIds } }, select: { id: true, hostname: true } }) : Promise.resolve([]),
    ]);
    const t = new Map(tasks.map((x) => [x.id, x]));
    const d = new Map(devices.map((x) => [x.id, x.hostname]));
    const pol = await this.prisma.attendancePolicy.findFirst({ where: { audience: 'REMOTE' }, select: { screenshotIntervalMinutes: true } }).catch(() => null);
    return {
      total,
      intervalMin: pol?.screenshotIntervalMinutes ?? 10,
      items: shots.map((x) => ({
        id: x.id,
        capturedAt: x.capturedAt.toISOString(),
        workDate: dateKeyOf(x.workDate),
        task: x.taskId && t.get(x.taskId) ? { id: x.taskId, key: t.get(x.taskId)!.key, title: t.get(x.taskId)!.title } : null,
        fileId: x.fileId,
        thumbFileId: x.thumbFileId,
        blurred: x.blurred,
        inIdle: x.inIdle,
        deviceName: x.deviceId ? (d.get(x.deviceId) ?? null) : null,
      })),
    };
  }

  // ── day summaries (attendance timeline, KPIs, approvals) ────────────────
  async daySummaries(q: DaySummariesQuery): Promise<DaySummaryRow[]> {
    const ctx = requireContext();
    const s = await this.scope(ctx);
    const employeeId = q.employeeId ?? s.self;
    if (!employeeId) throw badRequest('employeeId is required');
    const hrLike = hasPerm(ctx, 'attendance.manage');
    const lead = s.ledProjects.size > 0 && hasPerm(ctx, 'attendance.team');
    if (!s.all && !hrLike && employeeId !== s.self && !s.reports.has(employeeId) && !lead) throw forbidden();
    const rows = await this.prisma.trackerDaySummary.findMany({
      where: { employeeId, workDate: { gte: dbDate(q.from), lte: dbDate(q.to) } },
      orderBy: { workDate: 'asc' },
    });
    return rows.map((r) => ({
      workDate: dateKeyOf(r.workDate),
      workedSec: r.workedSec,
      breakSec: r.breakSec,
      idleSec: r.idleSec,
      idleDeductedSec: r.idleDeductedSec,
      idlePendingSec: r.idlePendingSec,
      screenshotCount: r.screenshotCount,
      firstInAt: r.firstInAt?.toISOString() ?? null,
      lastOutAt: r.lastOutAt?.toISOString() ?? null,
      perTask: (r.perTask as unknown as TrackerPerTask[]) ?? [],
      timeline: (r.timeline as unknown as TrackerTimelineBlock[]) ?? [],
      integrityFlags: r.integrityFlags,
    }));
  }

  // ── integrity ───────────────────────────────────────────────────────────
  async integrity(employeeId: string, week?: string): Promise<IntegrityEventRow[]> {
    const ctx = requireContext();
    const s = await this.scope(ctx);
    const hrLike = hasPerm(ctx, 'attendance.manage');
    const reviewer = hasPerm(ctx, 'timesheet.approve.l1') || hasPerm(ctx, 'timesheet.approve.l2');
    if (!s.all && !hrLike && employeeId !== s.self && !s.reports.has(employeeId) && !(reviewer && s.ledProjects.size)) throw forbidden();
    const rows = await this.prisma.trackerIntegrityEvent.findMany({
      where: { employeeId, ...(week ? { workDate: this.weekRange(week) } : {}) },
      orderBy: { occurredAt: 'asc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type as IntegrityEventRow['type'],
      severity: r.severity as IntegrityEventRow['severity'],
      workDate: dateKeyOf(r.workDate),
      occurredAt: r.occurredAt.toISOString(),
      details: (r.details as Record<string, unknown>) ?? {},
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    }));
  }

  async acknowledge(id: string, comment?: string) {
    const ctx = requireContext();
    const row = await this.prisma.trackerIntegrityEvent.findUnique({ where: { id } });
    if (!row) throw notFound('Integrity flag');
    const s = await this.scope(ctx);
    if (row.employeeId === s.self) throw forbidden('You cannot acknowledge your own integrity flag');
    if (!s.all && !hasPerm(ctx, 'attendance.manage') && !s.reports.has(row.employeeId) && !s.ledProjects.size) throw forbidden();
    await this.prisma.trackerIntegrityEvent.update({ where: { id }, data: { acknowledgedAt: new Date(), acknowledgedByUserId: ctx.userId, comment: comment?.trim() || null } });
    await this.audit.record({ action: 'tracker.integrity.acknowledged', entity: 'TrackerIntegrityEvent', entityId: id, meta: { type: row.type } });
    return { ok: true as const };
  }
}
