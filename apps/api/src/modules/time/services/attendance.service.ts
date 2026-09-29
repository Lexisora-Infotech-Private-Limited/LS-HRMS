import { Injectable, Logger } from '@nestjs/common';
import type { AttendanceDay, PolicyAudience, PunchSource, WorkSession } from '@prisma/client';
import type {
  AttendanceDayRow,
  AttendanceMonth,
  AttendanceTimeline,
  AttendanceToday,
  PayrollInputRow,
  TeamToday,
  TimelineSegment,
  TimeDayStatus,
} from '@lexisora/shared';
import { DAY_STATUS_LABEL } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { EventsService } from '../../../core/registry/events.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { OrgService } from '../../../core/org/org.service';
import { getContext, type RequestContext } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { AppError, forbidden, notFound } from '../../../core/http/errors';
import { CrossReader } from '../cross';
import { computeDay, isWeeklyOff, latePenaltyDays, requiredMinutes, shiftWindow, sourceLabel, summarizeMonth, type SourceKey } from '../lib/day-calc';
import { effectiveAudience, evaluatePunch, modeNote, trackerMode, webPunchAllowed, type GeoInput } from '../lib/policy';
import { addDays, dateOf, dayLabel, daysBetween, fmtMinute, istHm, istKeyOf, keyOf, monthOf, monthRange, prevMonth, shortDur } from '../lib/time-utils';
import { PeriodLockService } from './period-lock.service';
import { PolicyService, toLocationRules, toShiftLike, type EmployeeLite } from './policy.service';

export type PunchInput = {
  employeeId: string;
  /** Omit to toggle (biometric FIRST_LAST / ALTERNATE devices). */
  direction?: 'IN' | 'OUT';
  source: PunchSource;
  at?: Date;
  deviceId?: string | null;
  biometricDeviceId?: string | null;
  geo?: GeoInput;
  clientEventId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  locationId?: string | null;
  regularizationId?: string | null;
  /** Store the punch as UNKNOWN direction (FIRST_LAST biometric mode). */
  storeUnknownDirection?: boolean;
};

const ACTIVE_STATUSES = ['ACTIVE', 'NOTICE_PERIOD'];

@Injectable()
export class AttendanceService {
  private readonly log = new Logger('Attendance');
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: PolicyService,
    private readonly locks: PeriodLockService,
    private readonly cross: CrossReader,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly org: OrgService,
  ) {}

  // ── context resolution ──────────────────────────────────────────────────────
  async resolve(emp: EmployeeLite, date: string, opts: { biometricToday?: boolean } = {}) {
    const [shiftRow, wfh, bio] = await Promise.all([
      this.policies.shiftFor(emp, date),
      this.prisma.attendanceRegularization.findFirst({ where: { employeeId: emp.id, date: dateOf(date), type: 'WFH_FORGOT', status: 'APPROVED' }, select: { id: true } }),
      opts.biometricToday !== undefined
        ? Promise.resolve(opts.biometricToday)
        : this.prisma.attendancePunch.count({ where: { employeeId: emp.id, attendanceDate: dateOf(date), source: 'BIOMETRIC', status: 'ACCEPTED' } }).then((n) => n > 0),
    ]);
    const audience: PolicyAudience = effectiveAudience(emp.workMode, { wfhOverride: !!wfh, biometricToday: bio });
    const [policy, location] = await Promise.all([this.policies.get(audience), this.policies.locationFor(emp, audience)]);
    return { shift: toShiftLike(shiftRow), shiftRow, audience, policy, location };
  }

  private async openSession(employeeId: string) {
    return this.prisma.workSession.findFirst({ where: { employeeId, endedAt: null }, orderBy: { startedAt: 'desc' } });
  }

  // ── punch ───────────────────────────────────────────────────────────────────
  /**
   * Record a punch (web, desktop tracker, biometric, regularization, system). Throws
   * AppError(403,'PUNCH_NOT_ALLOWED'|'GEOFENCE_OUTSIDE'|'GEO_REQUIRED', msg), 409 STATE_CONFLICT,
   * 409 PERIOD_LOCKED, 409 ON_LEAVE. Exported for the tracker module (desktop punches).
   */
  async punch(input: PunchInput): Promise<{ ok: true; direction: 'IN' | 'OUT'; day: AttendanceDay | null; session: WorkSession; punchId: string; duplicate?: boolean }> {
    const emp = await this.policies.employee(input.employeeId);
    if (!emp) throw notFound('Employee');
    if (!ACTIVE_STATUSES.includes(emp.status)) throw new AppError(403, 'EMPLOYEE_INACTIVE', 'Your employee record is not active');
    const at = input.at ?? new Date();
    const ctx = getContext();

    if (input.clientEventId) {
      const dup = await this.prisma.attendancePunch.findFirst({ where: { source: input.source, clientEventId: input.clientEventId } });
      if (dup) {
        const s = await this.prisma.workSession.findFirst({ where: { OR: [{ inPunchId: dup.id }, { outPunchId: dup.id }] } });
        if (s && dup.status === 'ACCEPTED') {
          const day = await this.prisma.attendanceDay.findFirst({ where: { employeeId: emp.id, date: dup.attendanceDate } });
          return { ok: true, direction: dup.direction === 'OUT' ? 'OUT' : 'IN', day, session: s, punchId: dup.id, duplicate: true };
        }
      }
    }

    let open = await this.openSession(emp.id);
    if (open) open = await this.closeIfStale(open, at);
    const direction: 'IN' | 'OUT' = input.direction ?? (open ? 'OUT' : 'IN');

    // Biometric double taps within 60 s are superseded (no state change).
    if (input.source === 'BIOMETRIC') {
      const recent = await this.prisma.attendancePunch.findFirst({
        where: { employeeId: emp.id, source: 'BIOMETRIC', status: 'ACCEPTED', punchedAt: { gte: new Date(at.getTime() - 60_000), lte: new Date(at.getTime() + 60_000) } },
      });
      if (recent) {
        const p = await this.prisma.attendancePunch.create({
          data: { employeeId: emp.id, attendanceDate: recent.attendanceDate, punchedAt: at, direction: 'UNKNOWN', source: 'BIOMETRIC', status: 'SUPERSEDED', rejectReason: 'DUPLICATE', biometricDeviceId: input.biometricDeviceId ?? null, clientEventId: input.clientEventId ?? null, locationId: input.locationId ?? null } as any,
        });
        const s = (await this.prisma.workSession.findFirst({ where: { OR: [{ inPunchId: recent.id }, { outPunchId: recent.id }] } }))!;
        const day = await this.prisma.attendanceDay.findFirst({ where: { employeeId: emp.id, date: recent.attendanceDate } });
        return { ok: true, direction: recent.direction === 'OUT' ? 'OUT' : 'IN', day, session: s, punchId: p.id, duplicate: true };
      }
    }

    const date = direction === 'OUT' && open ? keyOf(open.attendanceDate) : istKeyOf(at);
    const reject = async (code: string, message: string, status = 403, geo?: { geoStatus: string; distanceM: number | null }) => {
      await this.prisma.attendancePunch.create({
        data: {
          employeeId: emp.id,
          attendanceDate: dateOf(date),
          punchedAt: at,
          direction,
          source: input.source,
          status: 'REJECTED',
          rejectReason: code,
          lat: input.geo?.lat ?? null,
          lng: input.geo?.lng ?? null,
          accuracyM: input.geo?.accuracyM != null ? Math.round(input.geo.accuracyM) : null,
          distanceM: geo?.distanceM ?? null,
          geoStatus: geo?.geoStatus ?? 'NOT_REQUIRED',
          ipAddress: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, 250) ?? null,
          trackerDeviceId: input.deviceId ?? null,
          biometricDeviceId: input.biometricDeviceId ?? null,
          createdByName: ctx?.userName ?? null,
        } as any,
      });
      await this.audit.record({ action: 'punch.rejected', entity: 'AttendancePunch', entityId: emp.id, meta: { code, source: input.source, direction, date, geo: geo ?? null } as any });
      throw new AppError(status, code, message);
    };

    if (input.source !== 'REGULARIZATION' && (await this.locks.isLocked(date))) await reject('PERIOD_LOCKED', 'This date is in a locked attendance period', 409);
    if (direction === 'IN' && input.source !== 'BIOMETRIC' && input.source !== 'REGULARIZATION') {
      const leave = await this.cross.leaveDays([emp.id], date, date);
      if (leave.reduce((s, l) => s + l.units, 0) >= 1) await reject('ON_LEAVE', "You're on approved leave today · cancel the leave first", 409);
    }

    const r = await this.resolve(emp, date, input.source === 'BIOMETRIC' ? { biometricToday: true } : {});
    const decision = evaluatePunch({ source: input.source, direction, audience: r.audience, policy: r.policy, location: toLocationRules(r.location), openSessionSource: open?.source ?? null, geo: input.geo });
    if (!decision.allowed) await reject(decision.code, decision.message, 403, decision.geo);
    const geo = decision.geo;

    if (direction === 'IN' && open) await reject('STATE_CONFLICT', 'You are already punched in', 409);
    if (direction === 'OUT' && !open) await reject('STATE_CONFLICT', 'You are not punched in', 409);

    const punch = await this.prisma.attendancePunch.create({
      data: {
        employeeId: emp.id,
        attendanceDate: dateOf(date),
        punchedAt: at,
        direction: input.storeUnknownDirection ? 'UNKNOWN' : direction,
        source: input.source,
        status: 'ACCEPTED',
        locationId: input.locationId ?? r.location?.id ?? null,
        lat: input.geo?.lat ?? null,
        lng: input.geo?.lng ?? null,
        accuracyM: input.geo?.accuracyM != null ? Math.round(input.geo.accuracyM) : null,
        distanceM: geo.distanceM,
        geoStatus: geo.geoStatus,
        ipAddress: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 250) ?? null,
        trackerDeviceId: input.deviceId ?? null,
        biometricDeviceId: input.biometricDeviceId ?? null,
        regularizationId: input.regularizationId ?? null,
        clientEventId: input.clientEventId ?? null,
        createdByName: ctx?.userName ?? null,
      } as any,
    });
    let session: WorkSession;
    if (direction === 'IN') {
      session = await this.prisma.workSession.create({ data: { employeeId: emp.id, attendanceDate: dateOf(date), inPunchId: punch.id, startedAt: at, source: input.source, deviceId: input.deviceId ?? null } as any });
    } else {
      session = await this.prisma.workSession.update({ where: { id: open!.id }, data: { endedAt: at < open!.startedAt ? open!.startedAt : at, outPunchId: punch.id } });
    }
    const day = await this.recomputeDay(emp.id, date);
    await this.audit.record({ action: 'punch.accepted', entity: 'AttendancePunch', entityId: punch.id, meta: { source: input.source, direction, date, geoStatus: geo.geoStatus } });
    this.events.emit('attendance.punched', { employeeId: emp.id, date, direction, source: input.source });
    if (emp.userId) this.realtime.toUser(emp.userId, 'attendance.state', { state: direction, sessionStart: direction === 'IN' ? at.toISOString() : null, source: input.source });
    return { ok: true, direction, day, session, punchId: punch.id };
  }

  /** An open session from a previous day past its auto-close point is closed before a new punch. */
  private async closeIfStale(open: WorkSession, now: Date): Promise<WorkSession | null> {
    const date = keyOf(open.attendanceDate);
    if (date >= istKeyOf(now)) return open;
    const emp = await this.policies.employee(open.employeeId);
    if (!emp) return open;
    const r = await this.resolve(emp, date);
    const { expectedEnd } = shiftWindow(date, r.shift);
    if (now.getTime() < expectedEnd.getTime() + r.policy.missedPunchAutoCloseHours * 3600_000) return open;
    await this.autoClose(open, expectedEnd);
    return null;
  }

  /** Auto-close a forgotten session (desktop: at the last tracker activity; others become MISSED_PUNCH). */
  async autoClose(open: WorkSession, expectedEnd: Date) {
    const date = keyOf(open.attendanceDate);
    let end = expectedEnd;
    if (open.source === 'DESKTOP') {
      const segs = await this.cross.segments(open.employeeId, date, date);
      const last = segs.filter((s) => s.endAt > open.startedAt).at(-1);
      end = last?.endAt ?? expectedEnd;
    }
    if (end < open.startedAt) end = open.startedAt;
    const punch = await this.prisma.attendancePunch.create({
      data: { employeeId: open.employeeId, attendanceDate: open.attendanceDate, punchedAt: end, direction: 'OUT', source: 'SYSTEM', status: 'ACCEPTED', createdByName: 'System (auto-close)' } as any,
    });
    await this.prisma.workSession.update({ where: { id: open.id }, data: { endedAt: end, outPunchId: punch.id, autoClosed: true } });
    const day = await this.recomputeDay(open.employeeId, date);
    if (open.source !== 'DESKTOP') {
      const userId = await this.org.userIdOf(open.employeeId);
      if (userId) {
        await this.notifications.notify({ userIds: [userId], type: 'attendance.missedPunch', title: `Missed punch on ${dayLabel(date)}`, body: 'You did not punch out. Request a correction before the period is locked.', link: '/attendance', email: true });
      }
    }
    return day;
  }

  // ── day computation ─────────────────────────────────────────────────────────
  /** Recompute one AttendanceDay from punches/sessions, shift, holiday, leave and tracker data. */
  async recomputeDay(employeeId: string, date: Date | string): Promise<AttendanceDay | null> {
    const key = typeof date === 'string' ? date : keyOf(date);
    const emp = await this.policies.employee(employeeId);
    if (!emp) return null;
    if (emp.joiningDate && key < keyOf(emp.joiningDate)) return null;
    if (emp.exitDate && key > keyOf(emp.exitDate)) return null;
    const existing = await this.prisma.attendanceDay.findFirst({ where: { employeeId, date: dateOf(key) } });
    if (existing?.isLocked) return existing;

    const sessions = await this.prisma.workSession.findMany({ where: { employeeId, attendanceDate: dateOf(key) }, orderBy: { startedAt: 'asc' } });
    const r = await this.resolve(emp, key, { biometricToday: sessions.some((s) => s.source === 'BIOMETRIC') });
    const [holidays, leaveRows, tracker, excuse] = await Promise.all([
      this.policies.holidaysBetween(key, key),
      this.cross.leaveDays([employeeId], key, key),
      this.cross.daySummary(employeeId, key),
      this.prisma.attendanceRegularization.findFirst({ where: { employeeId, date: dateOf(key), type: 'LATE_EXCUSE', status: 'APPROVED' }, select: { id: true } }),
    ]);
    const leaveUnits = leaveRows.reduce((s, l) => s + l.units, 0);
    const now = new Date();
    const res = computeDay({
      date: key,
      today: istKeyOf(now),
      now,
      shift: r.shift,
      holidayName: this.policies.holidayName(holidays, key, r.location?.id ?? null),
      leave: leaveUnits > 0 ? { fraction: Math.min(1, leaveUnits), typeCode: leaveRows[0]?.typeCode ?? null, paid: leaveRows.every((l) => l.isPaid) } : null,
      sessions: sessions.map((s) => ({ startedAt: s.startedAt, endedAt: s.endedAt, source: s.source as SourceKey, autoClosed: s.autoClosed })),
      tracker: tracker ? { workedSec: tracker.workedSec, breakSec: tracker.breakSec, idleSec: tracker.idleSec, idleDeductedSec: tracker.idleDeductedSec } : null,
      lateExcused: !!excuse,
      policy: r.policy,
    });
    const data = {
      status: existing?.overriddenByName ? existing.status : res.status,
      presentFraction: existing?.overriddenByName ? existing.presentFraction : res.presentFraction,
      firstInAt: res.firstInAt,
      lastOutAt: res.lastOutAt,
      primarySource: res.primarySource,
      sourcesMask: res.sourcesMask,
      workedMinutes: res.workedMinutes,
      presenceMinutes: res.presenceMinutes,
      breakMinutes: res.breakMinutes,
      idleMinutes: res.idleMinutes,
      isLate: res.isLate,
      lateByMinutes: res.lateByMinutes,
      lateExcused: res.lateExcused,
      isEarlyOut: res.isEarlyOut,
      leaveFraction: res.leaveFraction,
      leaveTypeCode: res.leaveTypeCode,
      idleDeductibleMinutes: res.idleDeductibleMinutes,
      shiftId: r.shiftRow?.id ?? null,
      effectiveMode: r.audience,
      locationId: r.location?.id ?? null,
      expectedStart: res.expectedStart,
      expectedEnd: res.expectedEnd,
      holidayName: res.holidayName,
      recomputedAt: now,
    };
    const day = existing
      ? await this.prisma.attendanceDay.update({ where: { id: existing.id }, data })
      : await this.prisma.attendanceDay.create({ data: { employeeId, date: dateOf(key), ...data } as any });

    this.events.emit('attendance.dayComputed', { employeeId, date: key, status: day.status });
    if ((day.status === 'HOLIDAY_WORKED' || day.status === 'WEEKLY_OFF_WORKED') && existing?.status !== day.status) {
      this.events.emit('attendance.compoff.eligible', { employeeId, date: key, fraction: res.presenceMinutes >= r.shift.minFullDayMinutes ? 1 : 0.5 });
    }
    if (emp.userId) this.realtime.toUser(emp.userId, 'attendance.day.updated', { date: key });
    return day;
  }

  async recomputeRange(employeeIds: string[] | null, from: string, to: string): Promise<number> {
    const ids = employeeIds ?? (await this.prisma.employee.findMany({ where: { status: { in: ACTIVE_STATUSES as any } }, select: { id: true } })).map((e) => e.id);
    const today = istKeyOf(new Date());
    let n = 0;
    for (const id of ids) {
      for (const d of daysBetween(from, to < today ? to : today)) {
        if (await this.recomputeDay(id, d)) n++;
      }
    }
    return n;
  }

  // ── read models ─────────────────────────────────────────────────────────────
  async today(employeeId: string): Promise<AttendanceToday> {
    const emp = await this.policies.employee(employeeId);
    if (!emp) throw notFound('Employee');
    const now = new Date();
    const date = istKeyOf(now);
    let open = await this.openSession(emp.id);
    if (open) open = await this.closeIfStale(open, now);
    const sessions = await this.prisma.workSession.findMany({ where: { employeeId: emp.id, attendanceDate: dateOf(date) } });
    const r = await this.resolve(emp, date, { biometricToday: sessions.some((s) => s.source === 'BIOMETRIC') || open?.source === 'BIOMETRIC' });
    const closedSec = sessions.filter((s) => s.endedAt && s.id !== open?.id).reduce((s, x) => s + (x.endedAt!.getTime() - x.startedAt.getTime()) / 1000, 0);
    const loc = toLocationRules(r.location);
    const leave = await this.cross.leaveDays([emp.id], date, date);
    const onLeave = leave.reduce((s, l) => s + l.units, 0) >= 1;
    const webAllowed = webPunchAllowed(r.policy, loc) && ACTIVE_STATUSES.includes(emp.status) && !onLeave;
    const canPunchOut = !!open && (open.source === 'WEB' || open.source === 'DESKTOP' || open.source === 'MOBILE');
    let blockReason: string | null = null;
    if (!webAllowed) {
      if (onLeave) blockReason = "You're on approved leave today.";
      else if (r.audience === 'OFFICE' || loc?.punchMode === 'BIOMETRIC_ONLY') blockReason = 'Web punch disabled. Use the fingerprint sensor at the office entrance.';
      else if (r.policy.allowDesktopPunch) blockReason = 'Punch from the desktop tracker.';
      else blockReason = 'Web punch is disabled by HR policy.';
    }
    return {
      state: open ? 'IN' : 'OUT',
      title: open ? 'Punched in' : sessions.length ? 'Punched out' : 'Not punched in',
      openSessionStart: open?.startedAt.toISOString() ?? null,
      openSessionSource: (open?.source as AttendanceToday['openSessionSource']) ?? null,
      workedSecondsClosed: Math.round(closedSec),
      serverNow: now.toISOString(),
      shift: { id: r.shiftRow?.id ?? null, name: r.shift.name, start: fmtMinute(r.shift.startMinute), end: fmtMinute(r.shift.endMinute) },
      effectiveMode: r.audience,
      workMode: emp.workMode,
      location: { id: r.location?.id ?? null, name: r.location?.name ?? '—' },
      webPunchAllowed: webAllowed,
      canPunchOut,
      blockReason,
      modeNote: modeNote(r.audience, r.policy, loc),
      modeChip: `${r.audience === 'OFFICE' ? 'Office' : 'Remote / WFH'} · ${r.location?.name ?? '—'}`,
      trackerRequired: r.audience === 'REMOTE' && r.policy.trackerRequired,
      idleThresholdMinutes: r.policy.autoIdleMinutes,
    };
  }

  /** Effective policy for an employee today (also consumed by the tracker via GET /attendance-policy/me). */
  async effective(employeeId: string) {
    const emp = await this.policies.employee(employeeId);
    if (!emp) throw notFound('Employee');
    const date = istKeyOf(new Date());
    const r = await this.resolve(emp, date);
    const loc = toLocationRules(r.location);
    const t = await this.today(employeeId);
    return {
      audience: r.audience,
      webPunchAllowed: t.webPunchAllowed,
      desktopPunchAllowed: trackerMode(r.policy, loc) === 'PUNCH',
      trackerMode: trackerMode(r.policy, loc),
      blockReason: t.blockReason,
      shift: t.shift,
      policy: r.policy,
    };
  }

  async month(employeeId: string, month: string): Promise<AttendanceMonth> {
    const emp = await this.policies.employee(employeeId);
    if (!emp) throw notFound('Employee');
    const { from, to } = monthRange(month);
    const today = istKeyOf(new Date());
    const start = emp.joiningDate && keyOf(emp.joiningDate) > from ? keyOf(emp.joiningDate) : from;
    const last = to < today ? to : today;
    let rows = await this.prisma.attendanceDay.findMany({ where: { employeeId, date: { gte: dateOf(from), lte: dateOf(to) } }, orderBy: { date: 'desc' } });
    const have = new Set(rows.map((r) => keyOf(r.date)));
    // Lazily materialise missing past days (weekly offs, absences, holidays) so the month is complete.
    const missing = start <= last ? daysBetween(start, last).filter((d) => !have.has(d)) : [];
    if (missing.length) {
      for (const d of missing) await this.recomputeDay(employeeId, d);
      rows = await this.prisma.attendanceDay.findMany({ where: { employeeId, date: { gte: dateOf(from), lte: dateOf(to) } }, orderBy: { date: 'desc' } });
    }
    const [regs, locked, r] = await Promise.all([
      this.prisma.attendanceRegularization.findMany({ where: { employeeId, date: { gte: dateOf(from), lte: dateOf(to) }, status: 'PENDING' }, select: { date: true } }),
      this.locks.isLocked(to),
      this.resolve(emp, last >= start ? last : today),
    ]);
    const pending = new Set(regs.map((x) => keyOf(x.date)));
    const window = r.policy.regularizationWindowDays;
    const summary = summarizeMonth(rows, 0);
    const holidays = await this.policies.holidaysBetween(from, to);
    const workingDays = daysBetween(start > from ? start : from, to).filter((d) => !isWeeklyOff(d, r.shift) && !this.policies.holidayName(holidays, d, r.location?.id ?? null)).length;
    const days: AttendanceDayRow[] = rows
      .filter((d) => d.status !== 'WEEKLY_OFF')
      .map((d) => {
        const key = keyOf(d.date);
        const status = d.status as TimeDayStatus;
        const statusLabel = status === 'PRESENT' && d.isLate && !d.lateExcused ? 'Late' : status === 'LEAVE' && d.leaveTypeCode ? `Leave · ${d.leaveTypeCode}` : status === 'HOLIDAY' && d.holidayName ? `Holiday · ${d.holidayName}` : DAY_STATUS_LABEL[status];
        return {
          id: d.id,
          date: key,
          dateLabel: dayLabel(key),
          in: istHm(d.firstInAt),
          out: istHm(d.lastOutAt),
          source: sourceLabel(d.sourcesMask, d.primarySource as SourceKey | null),
          breakMinutes: d.breakMinutes,
          idleMinutes: d.idleMinutes,
          workedMinutes: d.workedMinutes,
          status,
          statusLabel,
          isLate: d.isLate && !d.lateExcused,
          lateByMinutes: d.lateByMinutes,
          holidayName: d.holidayName,
          leaveTypeCode: d.leaveTypeCode,
          isLocked: d.isLocked,
          overridden: !!d.overriddenByName,
          pendingRegularization: pending.has(key),
          canRegularize: !d.isLocked && key <= today && key >= addDays(today, -window) && !pending.has(key) && status !== 'LEAVE',
        };
      });
    return {
      employee: { id: emp.id, name: emp.fullName, empCode: emp.empCode, workMode: emp.workMode },
      summary: { month, ...summary, workingDays },
      days,
      locked,
    };
  }

  async timeline(employeeId: string, date: string): Promise<AttendanceTimeline> {
    const emp = await this.policies.employee(employeeId);
    if (!emp) throw notFound('Employee');
    const r = await this.resolve(emp, date);
    const { expectedStart, expectedEnd } = shiftWindow(date, r.shift);
    const segs = await this.cross.segments(employeeId, date, date);
    const now = new Date();
    let segments: TimelineSegment[] = [];
    let source: AttendanceTimeline['source'] = 'none';
    if (segs.length) {
      source = 'tracker';
      const tasks = await this.cross.taskMap(segs.map((s) => s.taskId).filter((x): x is string => !!x));
      segments = segs.map((s) => {
        const kind: TimelineSegment['kind'] =
          s.kind === 'WORK' || s.kind === 'IDLE_WORK' || (s.kind === 'IDLE' && s.idleResolution === 'CLAIMED_WORK') ? 'active' : s.kind === 'BREAK' || (s.kind === 'IDLE' && s.idleResolution === 'AS_BREAK') ? 'break' : 'idle';
        const name = kind === 'active' ? 'Active' : kind === 'break' ? 'Break' : 'Auto-idle';
        const task = s.taskId ? tasks.get(s.taskId)?.key : null;
        return { kind, start: s.startAt.toISOString(), end: s.endAt.toISOString(), label: `${name} ${istHm(s.startAt)}–${istHm(s.endAt)}${task ? ` · ${task}` : ''}` };
      });
    } else {
      const sessions = await this.prisma.workSession.findMany({ where: { employeeId, attendanceDate: dateOf(date) }, orderBy: { startedAt: 'asc' } });
      if (sessions.length) source = 'sessions';
      let prev: Date | null = null;
      for (const s of sessions) {
        if (prev && s.startedAt > prev) segments.push({ kind: 'break', start: prev.toISOString(), end: s.startedAt.toISOString(), label: `Break ${istHm(prev)}–${istHm(s.startedAt)}` });
        const end = s.endedAt ?? (date === istKeyOf(now) ? now : s.startedAt);
        segments.push({ kind: 'active', start: s.startedAt.toISOString(), end: end.toISOString(), label: `Active ${istHm(s.startedAt)}–${istHm(end)} · ${s.source.toLowerCase()}` });
        prev = end;
      }
    }
    const first = segments[0] ? new Date(segments[0].start) : expectedStart;
    const lastSeg = segments.at(-1);
    const lastEnd = lastSeg ? new Date(lastSeg.end) : expectedEnd;
    const axisStart = first < expectedStart ? first : expectedStart;
    const axisEnd = lastEnd > expectedEnd ? lastEnd : expectedEnd;
    const ticks: string[] = [];
    const span = axisEnd.getTime() - axisStart.getTime();
    for (let i = 0; i <= 6; i++) ticks.push(istHm(new Date(axisStart.getTime() + (span * i) / 6))!);
    return { date, axisStart: axisStart.toISOString(), axisEnd: axisEnd.toISOString(), ticks, segments, idleThresholdMinutes: r.policy.autoIdleMinutes, source };
  }

  // ── scope ───────────────────────────────────────────────────────────────────
  /** Employees whose attendance the viewer may see (null = everyone). */
  async visibleEmployeeIds(ctx: RequestContext): Promise<string[] | null> {
    if (hasPerm(ctx, 'attendance.manage') || ctx.roleKey === 'admin') return null;
    const me = ctx.employeeId;
    if (!me) return [];
    if (!hasPerm(ctx, 'attendance.team')) return [me];
    const [reports, team] = await Promise.all([this.org.reportTree(me), this.cross.projectTeam(me)]);
    return [...new Set([me, ...reports, ...team])];
  }

  async assertCanView(ctx: RequestContext, employeeId: string) {
    if (employeeId === ctx.employeeId) return;
    const ids = await this.visibleEmployeeIds(ctx);
    if (ids && !ids.includes(employeeId)) throw forbidden("You can't view this employee's attendance");
  }

  async teamToday(ctx: RequestContext, date?: string): Promise<TeamToday> {
    const key = date ?? istKeyOf(new Date());
    const ids = await this.visibleEmployeeIds(ctx);
    const emps = await this.prisma.employee.findMany({
      where: { status: { in: ACTIVE_STATUSES as any }, ...(ids ? { id: { in: ids.filter((x) => x !== ctx.employeeId) } } : {}) },
      select: { id: true, fullName: true, empCode: true, workMode: true, department: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    });
    const days = await this.prisma.attendanceDay.findMany({ where: { employeeId: { in: emps.map((e) => e.id) }, date: dateOf(key) } });
    const leaves = await this.cross.leaveDays(emps.map((e) => e.id), key, key);
    const byEmp = new Map(days.map((d) => [d.employeeId, d]));
    const counts = { present: 0, late: 0, absent: 0, onLeave: 0, notYetIn: 0, total: emps.length };
    const rows = emps.map((e) => {
      const d = byEmp.get(e.id);
      const onLeave = leaves.some((l) => l.employeeId === e.id) || d?.status === 'LEAVE';
      let status: string;
      if (onLeave) {
        status = 'On leave';
        counts.onLeave++;
      } else if (!d || (!d.firstInAt && (d.status === 'PENDING' || d.status === 'ABSENT'))) {
        status = d?.status === 'ABSENT' ? 'Absent' : d?.status === 'WEEKLY_OFF' || d?.status === 'HOLIDAY' ? DAY_STATUS_LABEL[d.status as TimeDayStatus] : 'Not yet in';
        if (status === 'Absent') counts.absent++;
        else if (status === 'Not yet in') counts.notYetIn++;
      } else if (d.status === 'WEEKLY_OFF' || d.status === 'HOLIDAY') {
        status = DAY_STATUS_LABEL[d.status as TimeDayStatus];
      } else {
        status = d.isLate && !d.lateExcused ? 'Late' : d.status === 'PENDING' ? 'Present' : DAY_STATUS_LABEL[d.status as TimeDayStatus];
        counts.present++;
        if (d.isLate && !d.lateExcused) counts.late++;
      }
      return {
        employeeId: e.id,
        name: e.fullName,
        empCode: e.empCode,
        department: e.department?.name ?? null,
        workMode: e.workMode,
        status,
        in: istHm(d?.firstInAt ?? null),
        out: istHm(d?.lastOutAt ?? null),
        source: d ? sourceLabel(d.sourcesMask, d.primarySource as SourceKey | null) : null,
        isLate: !!d?.isLate && !d.lateExcused,
      };
    });
    return { date: key, counts, rows };
  }

  async overrideDay(id: string, input: { status: TimeDayStatus; presentFraction: number; reason: string }) {
    const day = await this.prisma.attendanceDay.findFirst({ where: { id } });
    if (!day) throw notFound('Attendance day');
    if (day.isLocked) throw new AppError(409, 'PERIOD_LOCKED', 'This date is in a locked attendance period');
    const ctx = getContext();
    const saved = await this.prisma.attendanceDay.update({ where: { id }, data: { status: input.status, presentFraction: input.presentFraction, overriddenByName: ctx?.userName ?? 'HR', overrideReason: input.reason } });
    await this.audit.record({ action: 'day.overridden', entity: 'AttendanceDay', entityId: id, meta: { before: { status: day.status, presentFraction: day.presentFraction }, after: input } as any });
    return saved;
  }

  /** Profile → Attendance tab: Month | Present | Leave | Idle | Late for the last N months. */
  async profileSummary(employeeId: string, months = 12) {
    const out: { month: string; label: string; present: number; leave: number; idle: string; late: number }[] = [];
    let m = monthOf(istKeyOf(new Date()));
    for (let i = 0; i < months; i++) {
      const { from, to } = monthRange(m);
      const rows = await this.prisma.attendanceDay.findMany({ where: { employeeId, date: { gte: dateOf(from), lte: dateOf(to) } } });
      if (rows.length) {
        const s = summarizeMonth(rows);
        const [y, mm] = m.split('-').map(Number) as [number, number];
        out.push({ month: m, label: new Date(Date.UTC(y, mm - 1, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }), present: s.presentDays, leave: s.leaveDays, idle: shortDur(s.idleMinutes), late: s.lateMarks });
      }
      m = prevMonth(m);
    }
    return out;
  }

  /** Payroll input (consumed by leavepay's payroll run). */
  async payrollInput(month: string): Promise<PayrollInputRow[]> {
    const { from, to } = monthRange(month);
    const emps = (await this.prisma.employee.findMany({ where: { status: { in: ACTIVE_STATUSES as any } }, select: { id: true, joiningDate: true, exitDate: true, workMode: true, shiftId: true, workLocationId: true, employmentType: true } })) as any[];
    const locked = await this.locks.isLocked(to);
    const holidays = await this.policies.holidaysBetween(from, to);
    const leaves = await this.cross.leaveDays(emps.map((e) => e.id), from, to);
    const sheets = await this.prisma.timesheet.findMany({ where: { employeeId: { in: emps.map((e) => e.id) }, weekEnd: { gte: dateOf(from) }, weekStart: { lte: dateOf(to) } }, select: { employeeId: true, status: true, weekStart: true, weekEnd: true, idleMinutes: true } });
    const out: PayrollInputRow[] = [];
    for (const e of emps) {
      const days = await this.prisma.attendanceDay.findMany({ where: { employeeId: e.id, date: { gte: dateOf(from), lte: dateOf(to) } } });
      const shiftRow = await this.policies.shiftFor(e, to);
      const shift = toShiftLike(shiftRow);
      const start = e.joiningDate && keyOf(e.joiningDate) > from ? keyOf(e.joiningDate) : from;
      const end = e.exitDate && keyOf(e.exitDate) < to ? keyOf(e.exitDate) : to;
      const range = start <= end ? daysBetween(start, end) : [];
      const weeklyOffs = range.filter((d) => isWeeklyOff(d, shift)).length;
      const hol = range.filter((d) => !isWeeklyOff(d, shift) && this.policies.holidayName(holidays, d, e.workLocationId)).length;
      const workingDays = range.length - weeklyOffs - hol;
      const s = summarizeMonth(days);
      const myLeaves = leaves.filter((l) => l.employeeId === e.id);
      const paidLeave = myLeaves.filter((l) => l.isPaid).reduce((a, l) => a + l.units, 0);
      const unpaidLeave = myLeaves.filter((l) => !l.isPaid).reduce((a, l) => a + l.units, 0);
      const policy = await this.policies.get(e.workMode === 'OFFICE' ? 'OFFICE' : 'REMOTE');
      const penalty = policy.latePenaltySource === 'NONE' ? 0 : latePenaltyDays(s.lateMarks, policy.lateMarksPerPenalty, policy.latePenaltyDays);
      const byDate = new Map(days.map((d) => [keyOf(d.date), d]));
      let lop = 0;
      for (const d of range) {
        if (isWeeklyOff(d, shift) || this.policies.holidayName(holidays, d, e.workLocationId)) continue;
        const row = byDate.get(d);
        const paidL = myLeaves.filter((l) => l.date === d && l.isPaid).reduce((a, l) => a + l.units, 0);
        if (!row) continue; // not yet computed (future) → not LOP
        if (row.status === 'PENDING') continue;
        lop += Math.max(0, 1 - row.presentFraction - Math.max(paidL, row.leaveTypeCode ? row.leaveFraction : 0));
      }
      lop += policy.latePenaltySource === 'LOP' ? penalty : 0;
      const mySheets = sheets.filter((t) => t.employeeId === e.id);
      const required = policy.timesheetRequired && e.employmentType !== 'INTERN';
      const pendingPeriods = mySheets.filter((t) => t.status !== 'APPROVED' && t.status !== 'LOCKED').map((t) => `${keyOf(t.weekStart)}..${keyOf(t.weekEnd)}`);
      const approvedIdle = mySheets.filter((t) => t.status === 'APPROVED' || t.status === 'LOCKED').reduce((a, t) => a + t.idleMinutes, 0);
      const idleDeductible = policy.deductIdleFromPayroll ? Math.max(0, days.reduce((a, d) => a + d.idleDeductibleMinutes, 0) - policy.monthlyIdleAllowanceMinutes) : 0;
      out.push({
        employeeId: e.id,
        workingDays,
        weeklyOffs,
        holidays: hol,
        presentDays: s.presentDays,
        paidLeaveDays: paidLeave,
        unpaidLeaveDays: unpaidLeave,
        lopDays: Math.round((lop + unpaidLeave) * 100) / 100,
        paidDays: Math.max(0, Math.round((workingDays - lop - unpaidLeave) * 100) / 100),
        lateMarks: s.lateMarks,
        latePenaltyDays: penalty,
        idleMinutes: approvedIdle || s.idleMinutes,
        idleDeductibleMinutes: idleDeductible,
        missedPunchDays: s.missedPunchDays,
        timesheetStatus: !required ? 'NOT_REQUIRED' : pendingPeriods.length ? 'PENDING' : 'APPROVED',
        pendingPeriods,
        locked,
      });
    }
    return out;
  }

  /** Cron: close sessions left open 6 h (policy) after shift end. */
  async autoCloseDue(now = new Date()): Promise<number> {
    const open = await this.prisma.workSession.findMany({ where: { endedAt: null } });
    let n = 0;
    for (const s of open) {
      const emp = await this.policies.employee(s.employeeId);
      if (!emp) continue;
      const date = keyOf(s.attendanceDate);
      const r = await this.resolve(emp, date);
      const { expectedEnd } = shiftWindow(date, r.shift);
      if (now.getTime() >= expectedEnd.getTime() + r.policy.missedPunchAutoCloseHours * 3600_000) {
        await this.autoClose(s, expectedEnd);
        n++;
      }
    }
    return n;
  }

  requiredMinutesFor(shift: Parameters<typeof requiredMinutes>[0]) {
    return requiredMinutes(shift);
  }
}
