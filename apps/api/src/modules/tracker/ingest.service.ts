import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  screenshotMetaSchema,
  summarizeSegments,
  trackerWorkDate,
  type ScreenshotUploadResult,
  type TrackerBatch,
  type TrackerBatchResult,
  type TrackerConfirmResult,
  type TrackerPerTask,
  type TrackerPunchInput,
  type TrackerPunchResult,
  type TrackerTask,
  type TrackerToday,
} from '@lexisora/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AppError, badRequest } from '../../core/http/errors';
import { AuditService } from '../../core/audit/audit.service';
import { EventsService } from '../../core/registry/events.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { StorageService } from '../../core/storage/storage.service';
import { currentTenantId } from '../../core/context/request-context';
import { TrackerContextService } from './tracker-context.service';
import { TimePort } from './time-port';
import {
  buildTimeline,
  correctedInstant,
  dateKeyOf,
  dbDate,
  estimateSkewSeconds,
  findTrackingGaps,
  isSkewFlagged,
  matchIdleResolution,
  partitionByClientId,
  pickClaimReviewer,
  resolveSegmentKind,
  validateSegments,
  weekStartOf,
} from './tracker.rules';

const SUBMITTED_STATES = ['SUBMITTED', 'PENDING_RM', 'APPROVED', 'LOCKED'] as const;
const TASK_ORDER: Record<string, number> = { WIP: 0, ALLOTTED: 1, QA: 2, DEV_COMPLETED: 3, OPEN: 4 };
const SHOT_MIME = /^image\/(png|jpe?g|webp)$/;
const fmtHm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

export type IntegrityInput = {
  employeeId: string;
  deviceId?: string | null;
  workDate: string;
  type: string;
  severity: 'INFO' | 'WARN' | 'HIGH';
  occurredAt: Date;
  details: Record<string, unknown>;
  dedupeKey: string;
};

/**
 * Device data plane: punch, batch sync (events + segments), screenshots, today / tasks, and
 * the day-summary projection that feeds attendance, timesheets and approvals.
 */
@Injectable()
export class IngestService {
  private readonly log = new Logger('TrackerIngest');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tctx: TrackerContextService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly time: TimePort,
  ) {}

  // ── tasks ───────────────────────────────────────────────────────────────
  async tasks(employeeId: string): Promise<TrackerTask[]> {
    const today = trackerWorkDate(new Date());
    const [assigned, standing, summary] = await Promise.all([
      this.prisma.task.findMany({
        where: { assigneeEmployeeId: employeeId, status: { notIn: ['DONE', 'CANCELLED'] }, isStanding: false },
        include: { project: { select: { id: true, key: true, name: true, status: true } } },
        take: 100,
      }),
      this.prisma.task.findMany({
        where: { isStanding: true, status: { not: 'CANCELLED' }, project: { isInternal: true } },
        include: { project: { select: { id: true, key: true, name: true, status: true } } },
        orderBy: { number: 'asc' },
      }),
      this.prisma.trackerDaySummary.findUnique({ where: { employeeId_workDate: { employeeId, workDate: dbDate(today) } } }),
    ]);
    const perTask = new Map(((summary?.perTask as TrackerPerTask[] | null) ?? []).map((p) => [p.taskId, p.seconds]));
    const live = assigned.filter((t) => !['ARCHIVED', 'CANCELLED'].includes(t.project.status));
    live.sort((a, b) => (TASK_ORDER[a.status] ?? 9) - (TASK_ORDER[b.status] ?? 9) || a.key.localeCompare(b.key, 'en', { numeric: true }));
    const map = (t: (typeof assigned)[number], isStanding: boolean): TrackerTask => ({
      id: t.id,
      key: t.key,
      title: t.title,
      projectName: t.project.name,
      projectId: t.project.id,
      projectKey: t.project.key,
      status: t.status,
      isStanding,
      todaySeconds: perTask.get(t.id) ?? 0,
    });
    return [...live.map((t) => map(t, false)), ...standing.map((t) => map(t, true))];
  }

  // ── today ───────────────────────────────────────────────────────────────
  async today(employeeId: string, dateKey = trackerWorkDate(new Date())): Promise<TrackerToday> {
    const date = dbDate(dateKey);
    const [summary, open, lastBreak, day, emp] = await Promise.all([
      this.prisma.trackerDaySummary.findUnique({ where: { employeeId_workDate: { employeeId, workDate: date } } }),
      this.prisma.workSession.findFirst({ where: { employeeId, endedAt: null }, orderBy: { startedAt: 'desc' } }),
      this.prisma.trackerEvent.findFirst({
        where: { employeeId, workDate: date, type: { in: ['BREAK_START', 'BREAK_END', 'PUNCH_IN', 'PUNCH_OUT'] } },
        orderBy: { at: 'desc' },
      }),
      this.prisma.attendanceDay.findUnique({ where: { employeeId_date: { employeeId, date } } }).catch(() => null),
      this.tctx.employee(employeeId),
    ]);
    const { mode } = await this.tctx.modeFor(emp);
    const status: TrackerToday['status'] = open ? (lastBreak?.type === 'BREAK_START' ? 'BREAK' : 'WORKING') : 'OUT';
    const perTask = (summary?.perTask as TrackerPerTask[] | null) ?? [];
    return {
      status,
      workedSeconds: (summary?.workedSec ?? 0) + (summary?.idlePendingSec ?? 0),
      breakSeconds: summary?.breakSec ?? 0,
      idleSeconds: summary?.idleDeductedSec ?? 0,
      screenshots: summary?.screenshotCount ?? 0,
      byTask: perTask.map((p) => ({ taskId: p.taskId, key: p.key, title: p.title, seconds: p.seconds })),
      punchedInAt: open?.startedAt.toISOString() ?? null,
      date: dateKey,
      mode,
      idlePendingSeconds: summary?.idlePendingSec ?? 0,
      firstInAt: (day?.firstInAt ?? summary?.firstInAt)?.toISOString() ?? null,
      lastOutAt: open ? null : ((day?.lastOutAt ?? summary?.lastOutAt)?.toISOString() ?? null),
      punchSource: open?.source ?? null,
      timeline: (summary?.timeline as TrackerToday['timeline']) ?? [],
      confirmedAt: summary?.confirmedAt?.toISOString() ?? null,
      weekSubmitted: await this.weekSubmitted(employeeId, dateKey),
    };
  }

  private async weekSubmitted(employeeId: string, dateKey: string) {
    const ts = await this.prisma.timesheet
      .findFirst({ where: { employeeId, weekStart: dbDate(weekStartOf(dateKey)) }, select: { status: true } })
      .catch(() => null);
    return !!ts && (SUBMITTED_STATES as readonly string[]).includes(ts.status);
  }

  // ── punch ───────────────────────────────────────────────────────────────
  async punch(deviceId: string, employeeId: string, input: TrackerPunchInput): Promise<TrackerPunchResult> {
    const emp = await this.tctx.employee(employeeId);
    const { mode, message } = await this.tctx.modeFor(emp);
    if (mode === 'MONITOR_ONLY') throw new AppError(403, 'PUNCH_NOT_ALLOWED', message ?? 'Punch in with biometric at the office.');
    if (input.clientId) {
      const seen = await this.prisma.trackerEvent.findUnique({ where: { clientId: input.clientId } });
      if (seen) return { ok: true, direction: input.direction, at: seen.at.toISOString(), today: await this.today(employeeId) };
    }
    const device = await this.prisma.trackerDevice.findUniqueOrThrow({ where: { id: deviceId } });
    const now = new Date();
    let at = input.at ? correctedInstant(input.at, device.lastSkewSec ?? 0) : now;
    if (at.getTime() > now.getTime()) at = now;
    const policy = await this.tctx.policyRow('REMOTE');
    if (now.getTime() - at.getTime() > policy.offlineRetentionDays * 86400_000) {
      throw badRequest('This punch is older than the offline limit. Raise a regularization instead.', 'PUNCH_TOO_OLD');
    }
    await this.time.punch({ employeeId, direction: input.direction, source: 'DESKTOP', at, deviceId, clientEventId: input.clientId ?? null });
    const workDate = trackerWorkDate(at);
    await this.prisma.trackerEvent.create({
      data: {
        tenantId: currentTenantId(),
        clientId: input.clientId ?? randomUUID(),
        deviceId,
        employeeId,
        type: input.direction === 'IN' ? 'PUNCH_IN' : 'PUNCH_OUT',
        at,
        clientAt: input.at ? new Date(input.at) : now,
        workDate: dbDate(workDate),
        taskId: input.taskId ?? null,
      },
    });
    await this.prisma.trackerDevice.update({ where: { id: deviceId }, data: { lastSeenAt: now, liveStatus: input.direction === 'IN' ? 'WORKING' : 'OUT', liveTaskId: input.taskId ?? null } });
    await this.audit.record({ action: 'tracker.punch', entity: 'TrackerDevice', entityId: deviceId, meta: { direction: input.direction, source: 'DESKTOP', at: at.toISOString() } });
    return { ok: true, direction: input.direction, at: at.toISOString(), today: await this.today(employeeId, workDate) };
  }

  // ── sync ────────────────────────────────────────────────────────────────
  async sync(deviceId: string, employeeId: string, batch: TrackerBatch): Promise<TrackerBatchResult> {
    const now = new Date();
    const skew = estimateSkewSeconds(batch.deviceTime, now.getTime());
    const fix = (iso: string) => correctedInstant(iso, skew);
    const workDates = new Set<string>();
    const rejected: { clientId: string; reason: string }[] = [];

    // 1. events (idempotent by clientId)
    const existingEv = batch.events.length
      ? await this.prisma.trackerEvent.findMany({ where: { clientId: { in: batch.events.map((e) => e.clientId) } }, select: { clientId: true } })
      : [];
    const evPart = partitionByClientId(batch.events, existingEv.map((e) => e.clientId));
    if (evPart.fresh.length) {
      await this.prisma.trackerEvent.createMany({
        skipDuplicates: true,
        data: evPart.fresh.map((e) => {
          const at = fix(e.at);
          const wd = trackerWorkDate(at);
          workDates.add(wd);
          return {
            tenantId: currentTenantId(),
            clientId: e.clientId,
            deviceId,
            employeeId,
            type: e.type,
            at,
            clientAt: new Date(e.at),
            workDate: dbDate(wd),
            taskId: e.taskId ?? null,
            resolution: e.resolution ?? null,
            idleFrom: e.idleFrom ? fix(e.idleFrom) : null,
            note: e.note ?? null,
            payload: (e.payload as Prisma.InputJsonValue | undefined) ?? undefined,
            skewSec: skew,
          };
        }),
      });
    }

    // 2. segments (idempotent, validated, idle resolved)
    const existingSeg = batch.segments.length
      ? await this.prisma.activitySegment.findMany({ where: { clientId: { in: batch.segments.map((s) => s.clientId) } }, select: { clientId: true } })
      : [];
    const segPart = partitionByClientId(batch.segments, existingSeg.map((s) => s.clientId));
    const corrected = segPart.fresh.map((s) => ({ ...s, startedAt: fix(s.startedAt).toISOString(), endedAt: fix(s.endedAt).toISOString() }));
    let acceptedSegs = 0;
    if (corrected.length) {
      const minStart = new Date(Math.min(...corrected.map((s) => Date.parse(s.startedAt))));
      const maxEnd = new Date(Math.max(...corrected.map((s) => Date.parse(s.endedAt))));
      const stored = await this.prisma.activitySegment.findMany({
        where: { employeeId, startAt: { lt: maxEnd }, endAt: { gt: minStart } },
        select: { startAt: true, endAt: true },
      });
      const v = validateSegments(corrected, { nowMs: now.getTime(), existing: stored });
      rejected.push(...v.rejected);

      // idle answers stored earlier (dialog answered in a previous batch)
      const idleStarts = v.ok.filter((s) => s.kind === 'IDLE' && !s.resolution).map((s) => new Date(s.startedAt));
      const dbResolved = idleStarts.length
        ? await this.prisma.trackerEvent.findMany({ where: { employeeId, type: 'IDLE_RESOLVED', idleFrom: { in: idleStarts } }, select: { type: true, idleFrom: true, resolution: true } })
        : [];
      const resolvedEvents = [
        ...batch.events.map((e) => ({ type: e.type, idleFrom: e.idleFrom ? fix(e.idleFrom).toISOString() : undefined, resolution: e.resolution })),
        ...dbResolved.map((e) => ({ type: e.type as 'IDLE_RESOLVED', idleFrom: e.idleFrom?.toISOString(), resolution: (e.resolution ?? undefined) as any })),
      ];

      const taskIds = [...new Set(v.ok.map((s) => s.taskId).filter((x): x is string => !!x))];
      const tasks = taskIds.length
        ? await this.prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, key: true, projectId: true, project: { select: { leadEmployeeId: true, isInternal: true } } } })
        : [];
      const taskById = new Map(tasks.map((t) => [t.id, t]));
      const emp = await this.tctx.employee(employeeId);

      const segRows: Prisma.ActivitySegmentCreateManyInput[] = [];
      const claimRows: Prisma.IdleClaimCreateManyInput[] = [];
      for (const s of v.ok) {
        const res = matchIdleResolution(s, resolvedEvents);
        const mapped = resolveSegmentKind(s.kind, res);
        const task = s.taskId ? taskById.get(s.taskId) : undefined;
        const startAt = new Date(s.startedAt);
        const endAt = new Date(s.endedAt);
        const wd = trackerWorkDate(startAt);
        workDates.add(wd);
        const id = randomUUID();
        segRows.push({
          id,
          tenantId: currentTenantId(),
          clientId: s.clientId,
          employeeId,
          deviceId,
          workDate: dbDate(wd),
          kind: mapped.kind,
          taskId: task ? task.id : null,
          projectId: task?.projectId ?? null,
          startAt,
          endAt,
          durationSec: Math.round((endAt.getTime() - startAt.getTime()) / 1000),
          idleResolution: mapped.idleResolution,
          idleCause: s.idleCause ?? null,
          note: s.note ?? null,
          keyboardEvents: s.keyboardEvents ?? 0,
          mouseEvents: s.mouseEvents ?? 0,
          flags: isSkewFlagged(skew) ? ['SKEW_CORRECTED'] : [],
        });
        if (mapped.createsClaim) {
          claimRows.push({
            tenantId: currentTenantId(),
            employeeId,
            segmentId: id,
            workDate: dbDate(wd),
            startAt,
            endAt,
            minutes: Math.max(1, Math.round((endAt.getTime() - startAt.getTime()) / 60000)),
            taskId: task?.id ?? null,
            projectId: task?.projectId ?? null,
            note: s.note ?? null,
            status: 'PENDING',
            reviewerEmployeeId: pickClaimReviewer({
              employeeId,
              projectLeadId: task?.project.leadEmployeeId,
              projectIsInternal: task?.project.isInternal,
              managerId: emp.managerId,
            }),
          });
        }
      }
      if (segRows.length) await this.prisma.activitySegment.createMany({ data: segRows, skipDuplicates: true });
      if (claimRows.length) {
        await this.prisma.idleClaim.createMany({ data: claimRows, skipDuplicates: true });
        await this.notifyClaimReviewers(emp.fullName, claimRows, taskById);
      }
      acceptedSegs = segRows.length;
    }

    // 3. integrity
    const today = trackerWorkDate(now);
    if (isSkewFlagged(skew)) {
      await this.flag({
        employeeId,
        deviceId,
        workDate: today,
        type: 'CLOCK_SKEW',
        severity: Math.abs(skew) > 3600 ? 'WARN' : 'INFO',
        occurredAt: now,
        details: { skewSeconds: skew, message: `Device clock ${skew > 0 ? 'ahead' : 'behind'} by ${Math.round(Math.abs(skew) / 60)} min; times corrected` },
        dedupeKey: `skew:${deviceId}:${today}`,
      });
    }
    for (const r of rejected.filter((x) => x.reason === 'OVERLAP')) {
      await this.flag({ employeeId, deviceId, workDate: today, type: 'OVERLAP_REJECTED', severity: 'WARN', occurredAt: now, details: { clientId: r.clientId }, dedupeKey: `overlap:${r.clientId}` });
    }
    for (const e of evPart.fresh) {
      const at = fix(e.at);
      if (e.type === 'APP_QUIT') {
        const open = await this.prisma.workSession.findFirst({ where: { employeeId, startedAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gt: at } }] } });
        if (open) {
          await this.flag({
            employeeId,
            deviceId,
            workDate: trackerWorkDate(at),
            type: 'APP_QUIT_WHILE_PUNCHED_IN',
            severity: 'INFO',
            occurredAt: at,
            details: { message: `Tracker closed while punched in at ${fmtHm(at)}` },
            dedupeKey: `quit:${e.clientId}`,
          });
        }
      } else if (e.type === 'CLOCK_CHANGE') {
        const drift = Number((e.payload as any)?.driftSec ?? 0);
        await this.flag({
          employeeId,
          deviceId,
          workDate: trackerWorkDate(at),
          type: 'CLOCK_CHANGED',
          severity: Math.abs(drift) > 3600 ? 'HIGH' : 'WARN',
          occurredAt: at,
          details: { driftSec: drift, message: `PC clock changed by ${Math.round(drift / 60)} min` },
          dedupeKey: `clock:${e.clientId}`,
        });
      }
    }
    for (const wd of workDates) await this.detectGaps(employeeId, deviceId, wd, now);

    // 4. confirmations inside the batch ("Add to weekly timesheet" while offline)
    const confirmDates = evPart.fresh.filter((e) => e.type === 'SUMMARY_CONFIRMED').map((e) => trackerWorkDate(fix(e.at)));

    // 5. projections + downstream
    for (const wd of workDates) await this.projectDay(employeeId, wd);
    for (const wd of confirmDates) await this.markConfirmed(employeeId, wd);
    await this.prisma.trackerDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: now, lastSyncAt: now, lastSkewSec: skew, ...(batch.queueDepth !== undefined ? { queueDepth: batch.queueDepth } : {}) },
    });
    const dates = [...workDates].sort();
    if (dates.length) this.events.emit('tracker.segmentsIngested', { employeeId, workDates: dates });
    if (rejected.length) await this.audit.record({ action: 'tracker.sync.rejected', entity: 'TrackerDevice', entityId: deviceId, meta: { count: rejected.length, reasons: [...new Set(rejected.map((r) => r.reason))] } });

    return {
      accepted: evPart.fresh.length + acceptedSegs,
      duplicates: evPart.duplicates + segPart.duplicates,
      skewSeconds: skew,
      rejected,
      workDates: dates,
      serverTime: now.toISOString(),
    };
  }

  private async notifyClaimReviewers(
    name: string,
    claims: Prisma.IdleClaimCreateManyInput[],
    taskById: Map<string, { key: string }>,
  ) {
    const byReviewer = new Map<string, Prisma.IdleClaimCreateManyInput[]>();
    for (const c of claims) if (c.reviewerEmployeeId) byReviewer.set(c.reviewerEmployeeId, [...(byReviewer.get(c.reviewerEmployeeId) ?? []), c]);
    for (const [rid, list] of byReviewer) {
      const users = await this.notifications.usersForEmployees([rid]);
      const first = list[0]!;
      const key = first.taskId ? taskById.get(first.taskId)?.key : null;
      await this.notifications.notify({
        userIds: users,
        type: 'approval',
        title: `${name.split(' ')[0]} marked ${first.minutes} min idle as working${key ? ` (${key})` : ''}`,
        body: list.length > 1 ? `${list.length} idle claims awaiting review` : (first.note ?? undefined),
        link: '/approvals',
        from: name,
      });
    }
  }

  async flag(i: IntegrityInput) {
    const tenantId = currentTenantId();
    await this.prisma.trackerIntegrityEvent
      .upsert({
        where: { dedupeKey: `${tenantId}:${i.dedupeKey}` },
        update: {},
        create: {
          tenantId,
          employeeId: i.employeeId,
          deviceId: i.deviceId ?? null,
          workDate: dbDate(i.workDate),
          type: i.type,
          severity: i.severity,
          occurredAt: i.occurredAt,
          details: i.details as Prisma.InputJsonValue,
          dedupeKey: `${tenantId}:${i.dedupeKey}`,
        },
      })
      .catch((e) => this.log.warn(`integrity flag failed: ${(e as Error).message}`));
  }

  private async detectGaps(employeeId: string, deviceId: string, dateKey: string, now: Date) {
    const date = dbDate(dateKey);
    const [segs, sessions] = await Promise.all([
      this.prisma.activitySegment.findMany({ where: { employeeId, workDate: date }, select: { startAt: true, endAt: true } }),
      this.prisma.workSession.findMany({ where: { employeeId, attendanceDate: date }, select: { startedAt: true, endedAt: true } }).catch(() => []),
    ]);
    for (const g of findTrackingGaps(segs, sessions, { now })) {
      await this.flag({
        employeeId,
        deviceId,
        workDate: dateKey,
        type: 'GAP',
        severity: g.seconds >= 3600 ? 'WARN' : 'INFO',
        occurredAt: g.from,
        details: { from: g.from.toISOString(), to: g.to.toISOString(), minutes: Math.round(g.seconds / 60), message: `No tracker data ${fmtHm(g.from)}–${fmtHm(g.to)} while punched in` },
        dedupeKey: `gap:${employeeId}:${g.from.toISOString()}`,
      });
    }
  }

  // ── projection ──────────────────────────────────────────────────────────
  /** Re-projects TrackerDaySummary for one employee/day from stored segments, claims and shots. */
  async projectDay(employeeId: string, dateKey: string) {
    const date = dbDate(dateKey);
    const [segs, claims, shots, flags] = await Promise.all([
      this.prisma.activitySegment.findMany({ where: { employeeId, workDate: date }, orderBy: { startAt: 'asc' } }),
      this.prisma.idleClaim.findMany({ where: { employeeId, workDate: date }, select: { segmentId: true, status: true } }),
      this.prisma.screenshot.count({ where: { employeeId, workDate: date } }),
      this.prisma.trackerIntegrityEvent.count({ where: { employeeId, workDate: date } }),
    ]);
    const claimBySeg = new Map(claims.map((c) => [c.segmentId, c.status]));
    const withClaims = segs.map((s) => ({ ...s, claimStatus: claimBySeg.get(s.id) ?? (s.kind === 'IDLE_WORK' ? 'PENDING' : null) }));
    const totals = summarizeSegments(
      withClaims.map((s) => ({ kind: s.kind as any, idleResolution: s.idleResolution, taskId: s.taskId, durationSec: s.durationSec, claimStatus: s.claimStatus as any })),
    );
    const taskIds = Object.keys(totals.perTaskSec).filter(Boolean);
    const tasks = taskIds.length
      ? await this.prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, key: true, title: true, projectId: true } })
      : [];
    const tById = new Map(tasks.map((t) => [t.id, t]));
    const perTask: TrackerPerTask[] = Object.entries(totals.perTaskSec)
      .filter(([, sec]) => sec > 0)
      .map(([taskId, seconds]) => {
        const t = tById.get(taskId);
        return { taskId: taskId || null, projectId: t?.projectId ?? null, key: t?.key ?? 'General', title: t?.title ?? 'Unallocated', seconds };
      })
      .sort((a, b) => b.seconds - a.seconds);
    const timeline = buildTimeline(withClaims, (id) => (id ? (tById.get(id)?.key ?? null) : null));
    const data = {
      workedSec: totals.workedSec,
      breakSec: totals.breakSec,
      idleSec: totals.idleSec,
      idleDeductedSec: totals.idleDeductedSec,
      idlePendingSec: totals.idlePendingSec,
      claimApprovedSec: totals.claimApprovedSec,
      screenshotCount: shots,
      perTask: perTask as unknown as Prisma.InputJsonValue,
      timeline: timeline as unknown as Prisma.InputJsonValue,
      firstInAt: segs[0]?.startAt ?? null,
      lastOutAt: segs.length ? segs[segs.length - 1]!.endAt : null,
      integrityFlags: flags,
      lastProjectedAt: new Date(),
    };
    return this.prisma.trackerDaySummary.upsert({
      where: { employeeId_workDate: { employeeId, workDate: date } },
      create: { tenantId: currentTenantId(), employeeId, workDate: date, ...data },
      update: data,
    });
  }

  private async markConfirmed(employeeId: string, dateKey: string) {
    await this.prisma.trackerDaySummary.updateMany({ where: { employeeId, workDate: dbDate(dateKey), confirmedAt: null }, data: { confirmedAt: new Date() } });
  }

  /** "Add to weekly timesheet": idempotent; re-projects and asks time to rebuild the timesheet. */
  async confirmDay(employeeId: string, dateKey: string): Promise<TrackerConfirmResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw badRequest('Invalid date');
    await this.projectDay(employeeId, dateKey);
    await this.markConfirmed(employeeId, dateKey);
    const s = await this.prisma.trackerDaySummary.findUniqueOrThrow({ where: { employeeId_workDate: { employeeId, workDate: dbDate(dateKey) } } });
    const weekSubmitted = await this.weekSubmitted(employeeId, dateKey);
    this.events.emit('tracker.segmentsIngested', { employeeId, workDates: [dateKey], confirmed: true });
    await this.audit.record({ action: 'tracker.summary.confirmed', entity: 'TrackerDaySummary', entityId: s.id, meta: { date: dateKey } });
    return { confirmedAt: s.confirmedAt!.toISOString(), date: dateKey, weekSubmitted };
  }

  // ── screenshots ─────────────────────────────────────────────────────────
  async uploadScreenshot(
    deviceId: string,
    employeeId: string,
    userId: string,
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    metaRaw: unknown,
  ): Promise<ScreenshotUploadResult> {
    let metaObj: unknown = metaRaw;
    if (typeof metaRaw === 'string') {
      try {
        metaObj = JSON.parse(metaRaw);
      } catch {
        throw badRequest('meta must be JSON', 'VALIDATION_FAILED');
      }
    }
    const parsed = screenshotMetaSchema.safeParse(metaObj);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid screenshot meta', 'VALIDATION_FAILED');
    const meta = parsed.data;
    const existing = await this.prisma.screenshot.findUnique({ where: { clientId: meta.clientId } });
    if (existing) return { id: existing.id, duplicate: true, blurred: existing.blurred, workDate: dateKeyOf(existing.workDate) };
    if (!file) throw badRequest('No image uploaded');
    if (!SHOT_MIME.test(file.mimetype)) throw badRequest(`Screenshots must be PNG, JPEG or WebP (got ${file.mimetype})`, 'FILE_TYPE');
    if (file.size > 15 * 1024 * 1024) throw badRequest('Screenshot is too large', 'FILE_TOO_LARGE');

    const device = await this.prisma.trackerDevice.findUniqueOrThrow({ where: { id: deviceId } });
    const capturedAt = correctedInstant(meta.capturedAt, device.lastSkewSec ?? 0);
    const workDate = trackerWorkDate(capturedAt);
    const policy = await this.tctx.policyFor(employeeId, capturedAt);

    let img = sharp(file.buffer, { failOn: 'none' }).rotate();
    let blurred = meta.blurred;
    if (policy.blurScreenshots && !blurred) {
      img = img.blur(8); // defence in depth: device should already blur
      blurred = true;
    }
    let full: Buffer;
    let thumb: Buffer;
    try {
      full = await img.clone().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
      thumb = await img.clone().resize({ width: 320, withoutEnlargement: true }).webp({ quality: 60 }).toBuffer();
    } catch {
      throw badRequest('The screenshot image could not be read', 'IMAGE_INVALID');
    }

    const task = meta.taskId ? await this.prisma.task.findUnique({ where: { id: meta.taskId }, select: { id: true, key: true, projectId: true } }) : null;
    const stamp = capturedAt.toISOString().replace(/[:.]/g, '-');
    const fileRow = await this.storage.save({ data: full, filename: `shot-${stamp}.webp`, mime: 'image/webp', category: 'screenshot', isPrivate: true, ownerUserId: userId });
    const thumbRow = await this.storage.save({ data: thumb, filename: `shot-${stamp}-thumb.webp`, mime: 'image/webp', category: 'screenshot', isPrivate: true, ownerUserId: userId });
    const inIdle = !!(await this.prisma.activitySegment.findFirst({
      where: { employeeId, kind: { in: ['IDLE', 'IDLE_WORK'] }, startAt: { lte: capturedAt }, endAt: { gt: capturedAt } },
      select: { id: true },
    }));
    try {
      const row = await this.prisma.screenshot.create({
        data: {
          tenantId: currentTenantId(),
          clientId: meta.clientId,
          employeeId,
          deviceId,
          capturedAt,
          workDate: dbDate(workDate),
          taskId: task?.id ?? null,
          projectId: task?.projectId ?? null,
          fileId: fileRow.id,
          thumbFileId: thumbRow.id,
          blurred,
          inIdle,
          monitorCount: meta.monitorCount,
          purgeAfter: new Date(capturedAt.getTime() + policy.screenshotRetentionDays * 86400_000),
        },
      });
      await this.projectDay(employeeId, workDate);
      await this.prisma.trackerDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date(), displays: meta.monitorCount } });
      return { id: row.id, duplicate: false, blurred, workDate };
    } catch (e) {
      // concurrent retry of the same clientId
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await this.storage.remove(fileRow.id);
        await this.storage.remove(thumbRow.id);
        const row = await this.prisma.screenshot.findUniqueOrThrow({ where: { clientId: meta.clientId } });
        return { id: row.id, duplicate: true, blurred: row.blurred, workDate: dateKeyOf(row.workDate) };
      }
      throw e;
    }
  }

  /** Retention: delete screenshot files past purgeAfter; the row stays (purgedAt) for counts. */
  async purgeScreenshots(now = new Date()) {
    const due = await this.prisma.screenshot.findMany({ where: { purgeAfter: { lt: now }, purgedAt: null }, take: 500 });
    for (const s of due) {
      await this.storage.remove(s.fileId).catch(() => undefined);
      if (s.thumbFileId) await this.storage.remove(s.thumbFileId).catch(() => undefined);
      await this.prisma.screenshot.update({ where: { id: s.id }, data: { purgedAt: now, thumbFileId: null } });
    }
    if (due.length) await this.audit.record({ action: 'screenshot.purged', entity: 'Screenshot', meta: { count: due.length } });
    return due.length;
  }

  /** Nightly: SCREENSHOT_MISSING when ≥ 3 expected shots are missing for the day. */
  async screenshotMissingCheck(dateKey: string) {
    const rows = await this.prisma.trackerDaySummary.findMany({ where: { workDate: dbDate(dateKey), workedSec: { gt: 0 } } });
    for (const r of rows) {
      const policy = await this.tctx.policyFor(r.employeeId);
      if (!policy.screenshotsEnabled) continue;
      const expected = Math.floor(r.workedSec / (policy.screenshotIntervalMin * 60));
      const missing = expected - r.screenshotCount;
      if (missing >= 3) {
        await this.flag({
          employeeId: r.employeeId,
          workDate: dateKey,
          type: 'SCREENSHOT_MISSING',
          severity: 'WARN',
          occurredAt: new Date(),
          details: { expected, actual: r.screenshotCount, missing, message: `Screenshots missing ${missing}` },
          dedupeKey: `shots:${r.employeeId}:${dateKey}`,
        });
      }
    }
  }
}
