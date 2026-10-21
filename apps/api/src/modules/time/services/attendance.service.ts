import { Injectable, Logger } from '@nestjs/common';
import type { AttendanceDay, PolicyAudience, PunchSource, WorkSession } from '@prisma/client';
import type {
  AttendanceDayRow,
  AttendanceMonth,
  AttendanceTimeline,
  AttendanceToday,
  IdleSpanInput,
  IdleSpanResult,
  LatePrompt,
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
import { SettingsService } from '../../../core/settings/settings.service';
import { OrgService } from '../../../core/org/org.service';
import { getContext, type RequestContext } from '../../../core/context/request-context';
import { hasPerm } from '../../../core/auth/decorators';
import { AppError, forbidden, notFound } from '../../../core/http/errors';
import { CrossReader } from '../cross';
import {
  computeDay,
  countsAsLateMark,
  isCountedLate,
  isWeeklyOff,
  latePenaltyDays,
  punchLateness,
  requiredMinutes,
  secondHalfStart,
  shiftWindow,
  sourceLabel,
  summarizeMonth,
  type SourceKey,
} from '../lib/day-calc';
import { freePart, idleSpanLabel, splitByIdle } from '../lib/idle-spans';
import { KeyedLock } from '../lib/keyed-lock';
import { effectiveAudience, evaluatePunch, modeNote, trackerMode, webPunchAllowed, type GeoInput } from '../lib/policy';
import { addDays, dateOf, dayLabel, daysBetween, fmtMinute, istHm, istInstant, istKeyOf, keyOf, monthOf, monthRange, prevMonth, shortDur } from '../lib/time-utils';
import { PeriodLockService } from './period-lock.service';
import { EMP_SELECT, PolicyService, toLocationRules, toShiftLike, type EmployeeLite } from './policy.service';

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
  /** Why a late punch-in is late (web / mobile ask before punching in; see latePrompt). */
  lateReason?: string | null;
  /** Acknowledged a late beyond the month's limit (first half becomes half-day leave). */
  lateAck?: boolean;
};

export type PunchOutcome = { ok: true; direction: 'IN' | 'OUT'; day: AttendanceDay | null; session: WorkSession; punchId: string; duplicate?: boolean };

const ACTIVE_STATUSES = ['ACTIVE', 'NOTICE_PERIOD'];
/** Sources where a person is at the screen and can be asked why they are late. */
const INTERACTIVE_SOURCES: PunchSource[] = ['WEB', 'MOBILE'];

@Injectable()
export class AttendanceService {
  private readonly log = new Logger('Attendance');
  /** One punch at a time per employee (two tabs / header + page buttons / device + web). */
  private readonly punchLock = new KeyedLock();
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
    private readonly settings: SettingsService,
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
   * 409 PERIOD_LOCKED, 409 ON_LEAVE, 422 LATE_REASON_REQUIRED (web / mobile late punch-in without
   * a reason). Exported for the tracker module (desktop punches).
   */
  async punch(input: PunchInput): Promise<PunchOutcome> {
    return this.punchLock.run(input.employeeId, () => this.punchNow(input));
  }

  private async punchNow(input: PunchInput): Promise<PunchOutcome> {
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
    // Biometric FIRST_LAST: the first tap of the day is IN, every later tap moves the day's OUT.
    if (input.storeUnknownDirection && !open && !input.direction) {
      const last = await this.prisma.workSession.findFirst({ where: { employeeId: emp.id, attendanceDate: dateOf(istKeyOf(at)), endedAt: { not: null } }, orderBy: { startedAt: 'desc' } });
      if (last && last.endedAt! <= at) return this.extendLastOut(emp.id, last, at, input);
    }
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

    // Late first punch-in at the screen (no punch is stored until answered): within the month's
    // limit, ask why (the permission); beyond it, show what happens and ask for an acknowledgement.
    let lateReason: string | null = null;
    if (direction === 'IN' && INTERACTIVE_SOURCES.includes(input.source)) {
      const prompt = await this.latePrompt(emp, date, at, r);
      if (prompt) {
        const reason = input.lateReason?.trim() || null;
        if (prompt.reasonRequired && !reason) throw new AppError(422, 'LATE_REASON_REQUIRED', `You're ${shortDur(prompt.lateByMinutes)} late · tell us why before punching in`, prompt);
        if (prompt.overLimit && !input.lateAck && !reason) {
          throw new AppError(422, 'LATE_CONFIRM_REQUIRED', `Late ${prompt.lateCount} times this month · only ${prompt.lateAllowed} allowed · the first half of today becomes half-day leave`, prompt);
        }
        lateReason = reason;
      }
    }

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
    let day = await this.recomputeDay(emp.id, date);
    if (lateReason && day) day = await this.prisma.attendanceDay.update({ where: { id: day.id }, data: { lateReason, lateReasonAt: new Date() } });
    await this.audit.record({ action: 'punch.accepted', entity: 'AttendancePunch', entityId: punch.id, meta: { source: input.source, direction, date, geoStatus: geo.geoStatus, ...(day?.isLate && direction === 'IN' ? { lateByMinutes: day.lateByMinutes, lateReason } : {}) } });
    this.events.emit('attendance.punched', { employeeId: emp.id, date, direction, source: input.source });
    if (emp.userId) this.realtime.toUser(emp.userId, 'attendance.state', { state: direction, sessionStart: direction === 'IN' ? at.toISOString() : null, source: input.source });
    return { ok: true, direction, day, session, punchId: punch.id };
  }

  /** FIRST_LAST biometric: a later tap moves the day's last OUT instead of opening a new session. */
  private async extendLastOut(employeeId: string, last: WorkSession, at: Date, input: PunchInput): Promise<PunchOutcome> {
    const date = keyOf(last.attendanceDate);
    const punch = await this.prisma.attendancePunch.create({
      data: { employeeId, attendanceDate: last.attendanceDate, punchedAt: at, direction: 'UNKNOWN', source: input.source, status: 'ACCEPTED', biometricDeviceId: input.biometricDeviceId ?? null, clientEventId: input.clientEventId ?? null, locationId: input.locationId ?? null } as any,
    });
    if (last.outPunchId) await this.prisma.attendancePunch.updateMany({ where: { id: last.outPunchId }, data: { status: 'SUPERSEDED' } });
    const session = await this.prisma.workSession.update({ where: { id: last.id }, data: { endedAt: at, outPunchId: punch.id, autoClosed: false } });
    const day = await this.recomputeDay(employeeId, date);
    await this.audit.record({ action: 'punch.accepted', entity: 'AttendancePunch', entityId: punch.id, meta: { source: input.source, direction: 'OUT', date, mode: 'FIRST_LAST' } });
    return { ok: true, direction: 'OUT', day, session, punchId: punch.id };
  }

  /**
   * Is a punch-in at `at` late enough to ask why? Only the first punch-in of a working day, when the
   * policy asks for reasons. Returns the figures for the "You're late" dialog, or null.
   */
  async latePrompt(emp: EmployeeLite, date: string, at: Date, r: Awaited<ReturnType<AttendanceService['resolve']>>): Promise<LatePrompt | null> {
    const earlier = await this.prisma.workSession.count({ where: { employeeId: emp.id, attendanceDate: dateOf(date) } });
    if (earlier) return null;
    const [holidays, leaveRows, ordinal] = await Promise.all([this.policies.holidaysBetween(date, date), this.cross.leaveDays([emp.id], date, date), this.lateOrdinal(emp.id, date)]);
    const offDay = isWeeklyOff(date, r.shift) || !!this.policies.holidayName(holidays, date, this.holidayLocation(emp, r));
    const leave = CrossReader.leaveOnDay(leaveRows);
    const late = punchLateness({ date, at, shift: r.shift, offDay, plannedFirstHalf: !!leave?.plannedFirstHalf && leave.fraction < 1, ordinal });
    if (!late.isLate) return null;
    // Within the limit the reason is the permission (when HR asks for one); beyond it there is nothing
    // to permit — the notice is shown either way so the half day never comes as a surprise.
    const reasonRequired = r.policy.lateReasonRequired && !late.overLimit;
    if (!reasonRequired && !late.overLimit) return null;
    return {
      punchAt: istHm(at)!,
      shiftStart: istHm(late.expectedStart)!,
      graceMinutes: r.shift.graceMinutes,
      lateAfter: istHm(new Date(late.expectedStart.getTime() + r.shift.graceMinutes * 60_000))!,
      lateByMinutes: late.lateByMinutes,
      halfDay: late.lateHalfDay,
      halfDayAfterMinutes: r.shift.halfDayIfLateByMinutes || null,
      lateCount: ordinal,
      lateAllowed: r.shift.lateMarksAllowed ?? 0,
      overLimit: late.overLimit,
      reasonRequired,
      consequence: await this.lateConsequence(emp.id, date, r, { halfDay: late.lateHalfDay, overLimit: late.overLimit, ordinal }),
    };
  }

  /**
   * Place a late arrival on `date` takes among the month's late arrivals (1 = first): counted lates
   * on earlier days of the month + 1. Drives the shift's monthly limit.
   */
  async lateOrdinal(employeeId: string, date: string): Promise<number> {
    const { from } = monthRange(monthOf(date));
    if (from >= date) return 1;
    const earlier = await this.prisma.attendanceDay.findMany({ where: { employeeId, date: { gte: dateOf(from), lt: dateOf(date) }, isLate: true }, select: { isLate: true, lateExcused: true, status: true } });
    return earlier.filter(isCountedLate).length + 1;
  }

  /** What this late arrival costs, in words, from the shift and policy (dialog + month card share it). */
  private async lateConsequence(
    employeeId: string,
    date: string,
    r: Awaited<ReturnType<AttendanceService['resolve']>>,
    late: { halfDay: boolean; overLimit: boolean; ordinal: number },
  ): Promise<string> {
    const p = r.policy;
    const allowed = r.shift.lateMarksAllowed ?? 0;
    if (late.halfDay) {
      const why = late.overLimit
        ? `Late ${late.ordinal} times this month and only ${allowed} ${allowed === 1 ? 'is' : 'are'} allowed`
        : `More than ${shortDur(r.shift.halfDayIfLateByMinutes ?? 0)} late`;
      if (p.lateHalfDayAsLeave && p.latePenaltySource !== 'NONE' && date >= keyOf(p.lateHalfDayLeaveFrom)) {
        const code = (await this.settings.get<{ latePenaltyLeaveCode?: string }>('leave.settings', {})).latePenaltyLeaveCode || 'CL';
        return p.latePenaltySource === 'LOP'
          ? `${why}: the first half of today is booked as half-day leave without pay.`
          : `${why}: the first half of today is booked as half-day ${code} (leave without pay when ${code} runs out). It shows in your time off.`;
      }
      return `${why}: only the second half of today counts (half day).`;
    }
    if (allowed > 0) {
      return late.ordinal < allowed
        ? `Late ${late.ordinal} of ${allowed} allowed this month · no leave is cut. From late ${allowed + 1}, the first half of that day becomes half-day leave.`
        : `Late ${late.ordinal} of ${allowed} allowed this month · no leave is cut. Your next late this month makes the first half of that day half-day leave.`;
    }
    if (p.latePenaltySource === 'NONE') return 'This is recorded as a late mark. Late marks cost no leave.';
    const { from } = monthRange(monthOf(date));
    const marks = (await this.prisma.attendanceDay.findMany({ where: { employeeId, date: { gte: dateOf(from), lt: dateOf(date) } }, select: { isLate: true, lateExcused: true, status: true, lateHalfDay: true } })).filter(countsAsLateMark).length + 1;
    const rule = `every ${p.lateMarksPerPenalty === 1 ? '' : `${p.lateMarksPerPenalty} `}late mark${p.lateMarksPerPenalty === 1 ? '' : 's'} cost${p.lateMarksPerPenalty === 1 ? 's' : ''} ${p.latePenaltyDays} day`;
    const from2 = p.latePenaltySource === 'LOP' ? 'as loss of pay' : 'from your leave (loss of pay when it runs out)';
    return `Late mark ${marks} this month · ${rule} ${from2}, settled when payroll runs.`;
  }

  /** Holidays follow the employee's work location (as in timesheets, leave and payroll). */
  private holidayLocation(emp: EmployeeLite, r: { location: { id: string } | null }): string | null {
    return emp.workLocationId ?? r.location?.id ?? null;
  }

  /** Add / change the late reason of one of my days (biometric and desktop punch-ins can't ask). */
  async setLateReason(employeeId: string, date: string, reason: string) {
    const day = await this.prisma.attendanceDay.findFirst({ where: { employeeId, date: dateOf(date) } });
    if (!day || !day.isLate) throw new AppError(422, 'NOT_LATE', 'You were not late that day');
    if (day.isLocked) throw new AppError(409, 'PERIOD_LOCKED', 'This date is in a locked attendance period');
    const emp = await this.policies.employee(employeeId);
    if (!emp) throw notFound('Employee');
    const r = await this.resolve(emp, date);
    const today = istKeyOf(new Date());
    if (date < addDays(today, -r.policy.regularizationWindowDays)) throw new AppError(422, 'REGULARIZATION_WINDOW', `Late reasons can be added within ${r.policy.regularizationWindowDays} days`);
    const saved = await this.prisma.attendanceDay.update({ where: { id: day.id }, data: { lateReason: reason.trim(), lateReasonAt: new Date() } });
    await this.audit.record({ action: 'attendance.late_reason', entity: 'AttendanceDay', entityId: day.id, meta: { date, reason: reason.trim() } });
    if (emp.userId) this.realtime.toUser(emp.userId, 'attendance.day.updated', { date });
    return { ok: true, date, lateReason: saved.lateReason };
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
    // Claim the session first: the cron and a page load can race to close the same one.
    const claimed = await this.prisma.workSession.updateMany({ where: { id: open.id, endedAt: null }, data: { endedAt: end, autoClosed: true } });
    if (!claimed.count) return this.prisma.attendanceDay.findFirst({ where: { employeeId: open.employeeId, date: open.attendanceDate } });
    const punch = await this.prisma.attendancePunch.create({
      data: { employeeId: open.employeeId, attendanceDate: open.attendanceDate, punchedAt: end, direction: 'OUT', source: 'SYSTEM', status: 'ACCEPTED', createdByName: 'System (auto-close)' } as any,
    });
    await this.prisma.workSession.update({ where: { id: open.id }, data: { outPunchId: punch.id } });
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
  async recomputeDay(employeeId: string, date: Date | string, opts: { cascade?: boolean } = {}): Promise<AttendanceDay | null> {
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
    const limited = (r.shift.lateMarksAllowed ?? 0) > 0;
    const now = new Date();
    const res = computeDay({
      date: key,
      today: istKeyOf(now),
      now,
      shift: r.shift,
      holidayName: this.policies.holidayName(holidays, key, this.holidayLocation(emp, r)),
      leave: CrossReader.leaveOnDay(leaveRows),
      sessions: sessions.map((s) => ({ startedAt: s.startedAt, endedAt: s.endedAt, source: s.source as SourceKey, autoClosed: s.autoClosed })),
      tracker: tracker ? { workedSec: tracker.workedSec, breakSec: tracker.breakSec, idleSec: tracker.idleSec, idleDeductedSec: tracker.idleDeductedSec } : null,
      lateExcused: !!excuse,
      lateOrdinal: limited && sessions.length ? await this.lateOrdinal(employeeId, key) : 0,
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
      lateHalfDay: res.lateHalfDay,
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
    // Upsert: two recomputes of a new day (punch + event) must not both try to create it.
    const day = existing
      ? await this.prisma.attendanceDay.update({ where: { id: existing.id }, data })
      : await this.prisma.attendanceDay.upsert({ where: { employeeId_date: { employeeId, date: dateOf(key) } }, create: { employeeId, date: dateOf(key), ...data } as any, update: data });

    // Leave books / undoes the late-arrival half day from this (see LeaveLateArrivalService).
    this.events.emit('attendance.dayComputed', {
      employeeId,
      date: key,
      status: day.status,
      lateHalfDay: day.lateHalfDay,
      lateByMinutes: day.lateByMinutes,
      lateOverLimit: res.lateOverLimit,
      lateAllowed: r.shift.lateMarksAllowed ?? 0,
      audience: r.audience,
    });
    // Under a monthly late limit, a day that starts / stops counting as a late (punch, late excuse,
    // correction) moves every later late of the month up or down by one: recompute those.
    const counted = (d: Pick<AttendanceDay, 'isLate' | 'lateExcused' | 'status'> | null) => !!d && isCountedLate(d);
    if (limited && opts.cascade !== false && counted(existing) !== counted(day)) {
      const { to } = monthRange(monthOf(key));
      const today = istKeyOf(now);
      const later = await this.prisma.attendanceDay.findMany({
        where: { employeeId, date: { gt: dateOf(key), lte: dateOf(to < today ? to : today) }, isLate: true, isLocked: false },
        select: { date: true },
        orderBy: { date: 'asc' },
      });
      for (const l of later) await this.recomputeDay(employeeId, keyOf(l.date), { cascade: false });
    }
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
        // One bad employee-day must not stop the rest of the run.
        try {
          if (await this.recomputeDay(id, d)) n++;
        } catch (e) {
          this.log.error(`recompute ${id} ${d}: ${(e as Error).message}`);
        }
      }
    }
    return n;
  }

  /**
   * Days still "in progress" (PENDING) after they ended — the night job didn't run (server down,
   * deploy) or failed. Recomputing turns them into their real status. Safe to run any time.
   */
  async finalizeStale(employeeIds?: string[]): Promise<number> {
    const today = istKeyOf(new Date());
    const stale = await this.prisma.attendanceDay.findMany({
      where: { status: 'PENDING', date: { lt: dateOf(today) }, isLocked: false, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
      select: { employeeId: true, date: true },
      take: 5000,
    });
    let n = 0;
    for (const d of stale) {
      try {
        if (await this.recomputeDay(d.employeeId, keyOf(d.date))) n++;
      } catch (e) {
        this.log.error(`finalize ${d.employeeId} ${keyOf(d.date)}: ${(e as Error).message}`);
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
    const [leave, holidays, dayRow] = await Promise.all([
      this.cross.leaveDays([emp.id], date, date),
      this.policies.holidaysBetween(date, date),
      this.prisma.attendanceDay.findFirst({ where: { employeeId: emp.id, date: dateOf(date) } }),
    ]);
    const onLeave = leave.reduce((s, l) => s + l.units, 0) >= 1;
    const leaveDay = CrossReader.leaveOnDay(leave);
    const lateAllowed = r.shift.lateMarksAllowed ?? 0;
    const lateToday = !!dayRow && isCountedLate(dayRow) && dayRow.lateByMinutes > 0;
    const lateCount = lateToday ? await this.lateOrdinal(emp.id, date) : 0;
    const offDay = isWeeklyOff(date, r.shift) || !!this.policies.holidayName(holidays, date, this.holidayLocation(emp, r));
    const { expectedStart } = shiftWindow(date, r.shift);
    const lateStart = leaveDay?.plannedFirstHalf && leaveDay.fraction < 1 ? secondHalfStart(expectedStart, r.shift) : expectedStart;
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
      webIdleWatch: r.policy.autoIdleEnabled && !!open && open.source !== 'DESKTOP' && !(await this.cross.hasSegments(emp.id, date)),
      late: {
        workingDay: !offDay && !onLeave,
        shiftStart: istHm(lateStart)!,
        graceMinutes: r.shift.graceMinutes,
        lateAfter: istHm(new Date(lateStart.getTime() + r.shift.graceMinutes * 60_000))!,
        halfDayAfterMinutes: r.shift.halfDayIfLateByMinutes || null,
        reasonRequired: r.policy.lateReasonRequired,
        isLate: !!dayRow?.isLate && !dayRow.lateExcused && dayRow.lateByMinutes > 0,
        lateByMinutes: dayRow?.lateExcused ? 0 : (dayRow?.lateByMinutes ?? 0),
        lateHalfDay: !!dayRow?.lateHalfDay,
        reason: dayRow?.lateReason ?? null,
        lateCount,
        lateAllowed,
        lateOverLimit: lateToday && !!dayRow?.lateHalfDay && lateAllowed > 0 && lateCount > lateAllowed,
      },
    };
  }

  // ── web idle ────────────────────────────────────────────────────────────────
  /**
   * Save idle time the web app saw (no input ≥ autoIdleMinutes) with the reason picked on return.
   * Clipped to the punched-in session it falls in and to time not saved yet; replays are ignored.
   */
  async recordIdle(employeeId: string, input: IdleSpanInput): Promise<IdleSpanResult> {
    const minutesOf = (s: { startedAt: Date; endedAt: Date }) => Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60_000);
    const dup = await this.prisma.attendanceIdleSpan.findFirst({ where: { clientId: input.clientId } });
    if (dup) {
      if (dup.employeeId !== employeeId) throw forbidden('This idle entry belongs to someone else');
      return { ok: true, saved: false, minutes: minutesOf(dup), message: 'Idle time already saved' };
    }
    const now = new Date();
    const start = new Date(input.startedAt);
    const end = new Date(Math.min(Date.parse(input.endedAt), now.getTime()));
    if (end <= start) throw new AppError(422, 'IDLE_SPAN', 'The idle end must be after its start');
    if (end.getTime() - start.getTime() > 16 * 3600_000) throw new AppError(422, 'IDLE_SPAN', 'An idle span can be at most 16 hours');
    const session = await this.prisma.workSession.findFirst({
      where: { employeeId, startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
      orderBy: { startedAt: 'desc' },
    });
    if (!session) throw new AppError(409, 'NO_SESSION', "You weren't punched in during that time");
    const date = keyOf(session.attendanceDate);
    await this.locks.assertOpen(date);
    const taken = await this.prisma.attendanceIdleSpan.findMany({ where: { employeeId, startedAt: { lt: end }, endedAt: { gt: start } } });
    const free = freePart(Math.max(start.getTime(), session.startedAt.getTime()), Math.min(end.getTime(), (session.endedAt ?? now).getTime()), taken);
    if (!free || free.to - free.from < 60_000) return { ok: true, saved: false, minutes: 0, message: 'That time is already on your timeline' };
    const row = await this.prisma.attendanceIdleSpan.create({
      data: {
        employeeId,
        attendanceDate: dateOf(date),
        sessionId: session.id,
        clientId: input.clientId,
        startedAt: new Date(free.from),
        endedAt: new Date(free.to),
        reason: input.reason,
        note: input.note || null,
      } as any,
    });
    const minutes = minutesOf(row);
    await this.audit.record({ action: 'attendance.idle.recorded', entity: 'AttendanceIdleSpan', entityId: row.id, meta: { date, reason: input.reason, minutes } });
    return { ok: true, saved: true, minutes, message: `${idleSpanLabel(row)} · saved to your timeline` };
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
    const load = () => this.prisma.attendanceDay.findMany({ where: { employeeId, date: { gte: dateOf(from), lte: dateOf(to) } }, orderBy: { date: 'desc' } });
    let rows = await load();
    const have = new Set(rows.map((r) => keyOf(r.date)));
    // Lazily materialise missing past days (weekly offs, absences, holidays) so the month is complete,
    // and finish days still "in progress" after they ended (the night job didn't run for them).
    const missing = start <= last ? daysBetween(start, last).filter((d) => !have.has(d)) : [];
    const stale = rows.filter((d) => d.status === 'PENDING' && keyOf(d.date) < today && !d.isLocked).map((d) => keyOf(d.date));
    if (missing.length || stale.length) {
      for (const d of [...missing, ...stale]) await this.recomputeDay(employeeId, d);
      rows = await load();
    }
    const [regs, locked, r, unclosed] = await Promise.all([
      this.prisma.attendanceRegularization.findMany({ where: { employeeId, date: { gte: dateOf(from), lte: dateOf(to) }, status: { in: ['PENDING', 'APPROVED'] } }, select: { date: true, status: true } }),
      this.locks.isLocked(to),
      this.resolve(emp, last >= start ? last : today),
      // Sessions never punched out (open, or auto-closed at shift end) → "open since" on missed-punch rows.
      this.prisma.workSession.findMany({ where: { employeeId, attendanceDate: { gte: dateOf(from), lte: dateOf(to) }, OR: [{ endedAt: null }, { autoClosed: true, source: { not: 'DESKTOP' } }] }, select: { attendanceDate: true, startedAt: true }, orderBy: { startedAt: 'asc' } }),
    ]);
    const pending = new Set(regs.filter((x) => x.status === 'PENDING').map((x) => keyOf(x.date)));
    const correctionsLeft = Math.max(0, r.policy.maxRegularizationsPerMonth - regs.length);
    const openSince = new Map<string, string>();
    for (const s of unclosed) if (!openSince.has(keyOf(s.attendanceDate))) openSince.set(keyOf(s.attendanceDate), istHm(s.startedAt)!);
    const window = r.policy.regularizationWindowDays;
    const { penaltyLateMarks, ...summary } = summarizeMonth(rows, 0);
    const holidays = await this.policies.holidaysBetween(from, to);
    const workingDays = daysBetween(start > from ? start : from, to).filter((d) => !isWeeklyOff(d, r.shift) && !this.policies.holidayName(holidays, d, this.holidayLocation(emp, r))).length;
    const days: AttendanceDayRow[] = rows
      .filter((d) => d.status !== 'WEEKLY_OFF')
      .map((d) => {
        const key = keyOf(d.date);
        const status = d.status as TimeDayStatus;
        const isToday = key === today;
        const inWindow = !d.isLocked && key <= today && key >= addDays(today, -window);
        const late = d.isLate && !d.lateExcused;
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
          statusLabel: dayStatusLabel(d, isToday),
          isToday,
          isLate: late,
          lateByMinutes: late ? d.lateByMinutes : 0,
          lateHalfDay: d.lateHalfDay,
          lateReason: d.lateReason,
          canAddLateReason: late && d.lateByMinutes > 0 && inWindow,
          isEarlyOut: d.isEarlyOut,
          openSince: status === 'MISSED_PUNCH' || (isToday && status === 'PENDING') ? (openSince.get(key) ?? null) : null,
          holidayName: d.holidayName,
          leaveTypeCode: d.leaveTypeCode,
          isLocked: d.isLocked,
          overridden: !!d.overriddenByName,
          pendingRegularization: pending.has(key),
          canRegularize: inWindow && !pending.has(key) && status !== 'LEAVE' && correctionsLeft > 0,
        };
      });
    return {
      employee: { id: emp.id, name: emp.fullName, empCode: emp.empCode, workMode: emp.workMode },
      summary: {
        month,
        ...summary,
        workingDays,
        latePenaltyDays: r.policy.latePenaltySource === 'NONE' ? 0 : latePenaltyDays(penaltyLateMarks, r.policy.lateMarksPerPenalty, r.policy.latePenaltyDays, r.shift.lateMarksAllowed),
        lateRules: {
          allowedMarks: r.shift.lateMarksAllowed ?? 0,
          allowedFrom: r.shift.lateMarksAllowedFrom ?? null,
          marksPerPenalty: r.policy.lateMarksPerPenalty,
          penaltyDays: r.policy.latePenaltyDays,
          source: r.policy.latePenaltySource as 'LEAVE_THEN_LOP' | 'LOP' | 'NONE',
          graceMinutes: r.shift.graceMinutes,
          halfDayAfterMinutes: r.shift.halfDayIfLateByMinutes || null,
          halfDayAsLeave: r.policy.lateHalfDayAsLeave && r.policy.latePenaltySource !== 'NONE',
        },
        correctionsLeft,
      },
      days,
      locked,
    };
  }

  async timeline(employeeId: string, date: string): Promise<AttendanceTimeline> {
    const emp = await this.policies.employee(employeeId);
    if (!emp) throw notFound('Employee');
    const r = await this.resolve(emp, date);
    const { expectedStart, expectedEnd } = shiftWindow(date, r.shift);
    const [segs, dayRow, leaveRows, holidays] = await Promise.all([
      this.cross.segments(employeeId, date, date),
      this.prisma.attendanceDay.findFirst({ where: { employeeId, date: dateOf(date) } }),
      this.cross.leaveDays([employeeId], date, date),
      this.policies.holidaysBetween(date, date),
    ]);
    const leaveDay = CrossReader.leaveOnDay(leaveRows);
    const lateStart = leaveDay?.plannedFirstHalf && leaveDay.fraction < 1 ? secondHalfStart(expectedStart, r.shift) : expectedStart;
    const workingDay = !isWeeklyOff(date, r.shift) && !this.policies.holidayName(holidays, date, this.holidayLocation(emp, r)) && !(leaveDay && leaveDay.fraction >= 1);
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
      const [sessions, idle] = await Promise.all([
        this.prisma.workSession.findMany({ where: { employeeId, attendanceDate: dateOf(date) }, orderBy: { startedAt: 'asc' } }),
        this.prisma.attendanceIdleSpan.findMany({ where: { employeeId, attendanceDate: dateOf(date) } }),
      ]);
      if (sessions.length) source = 'sessions';
      let prev: Date | null = null;
      for (const s of sessions) {
        if (prev && s.startedAt > prev) segments.push({ kind: 'break', start: prev.toISOString(), end: s.startedAt.toISOString(), label: `Break ${istHm(prev)}–${istHm(s.startedAt)}` });
        // Never punched out: an earlier day's open session, or one the system closed at shift end.
        const unclosed = (!s.endedAt && date !== istKeyOf(now)) || (s.autoClosed && s.source !== 'DESKTOP');
        if (unclosed) {
          const until = s.endedAt && s.endedAt > s.startedAt ? s.endedAt : expectedEnd > s.startedAt ? expectedEnd : new Date(s.startedAt.getTime() + 60_000);
          segments.push({ kind: 'missing', start: s.startedAt.toISOString(), end: until.toISOString(), label: `No punch-out after ${istHm(s.startedAt)} · not counted until corrected` });
          prev = until;
          continue;
        }
        const end = s.endedAt ?? (date === istKeyOf(now) ? now : s.startedAt);
        // Web idle spans show in the idle colour, labelled with the reason the employee gave.
        for (const p of splitByIdle(s.startedAt.getTime(), end.getTime(), idle)) {
          const a = new Date(p.start);
          const b = new Date(p.end);
          segments.push(
            p.idle
              ? { kind: 'idle', start: a.toISOString(), end: b.toISOString(), label: idleSpanLabel({ ...p.idle, startedAt: a, endedAt: b }) }
              : { kind: 'active', start: a.toISOString(), end: b.toISOString(), label: `Active ${istHm(a)}–${istHm(b)} · ${s.source.toLowerCase()}` },
          );
        }
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
    return {
      date,
      axisStart: axisStart.toISOString(),
      axisEnd: axisEnd.toISOString(),
      ticks,
      segments,
      idleThresholdMinutes: r.policy.autoIdleMinutes,
      source,
      expectedStart: lateStart.toISOString(),
      lateAfter: new Date(lateStart.getTime() + r.shift.graceMinutes * 60_000).toISOString(),
      firstIn: dayRow?.firstInAt?.toISOString() ?? null,
      lateByMinutes: dayRow?.isLate && !dayRow.lateExcused ? dayRow.lateByMinutes : 0,
      workingDay,
    };
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
      select: { id: true, fullName: true, empCode: true, workMode: true, joiningDate: true, department: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    });
    const today = istKeyOf(new Date());
    const loadDays = () => this.prisma.attendanceDay.findMany({ where: { employeeId: { in: emps.map((e) => e.id) }, date: dateOf(key) } });
    let days = await loadDays();
    // Materialise missing rows (weekly off / holiday / absent come out right), and on a past date
    // finish rows left "in progress".
    if (key <= today) {
      const have = new Set(days.filter((d) => key === today || d.status !== 'PENDING' || d.isLocked).map((d) => d.employeeId));
      const todo = emps.filter((e) => !have.has(e.id) && (!e.joiningDate || keyOf(e.joiningDate) <= key));
      if (todo.length) {
        for (const e of todo) await this.recomputeDay(e.id, key).catch((err) => this.log.error(`team recompute ${e.id}: ${(err as Error).message}`));
        days = await loadDays();
      }
    }
    const leaves = await this.cross.leaveDays(emps.map((e) => e.id), key, key);
    const byEmp = new Map(days.map((d) => [d.employeeId, d]));
    const OFF = new Set(['WEEKLY_OFF', 'HOLIDAY']);
    const counts = { present: 0, late: 0, absent: 0, onLeave: 0, notYetIn: 0, total: emps.length };
    const rows = emps.map((e) => {
      const d = byEmp.get(e.id);
      const leaveUnits = leaves.filter((l) => l.employeeId === e.id).reduce((s, l) => s + l.units, 0);
      const late = !!d?.isLate && !d.lateExcused;
      let status: string;
      if (leaveUnits >= 1 || d?.status === 'LEAVE') {
        status = 'On leave';
        counts.onLeave++;
      } else if (d && OFF.has(d.status)) {
        status = d.status === 'HOLIDAY' && d.holidayName ? `Holiday · ${d.holidayName}` : DAY_STATUS_LABEL[d.status as TimeDayStatus];
      } else if (!d?.firstInAt) {
        // Not in: a working day still running is "Not yet in"; a finished one is absent.
        status = d && d.status !== 'PENDING' ? dayStatusLabel(d, key === today) : leaveUnits > 0 ? 'Half-day leave' : 'Not yet in';
        if (d?.status === 'ABSENT' || d?.status === 'MISSED_PUNCH') counts.absent++;
        else if (status === 'Not yet in' || status === 'Not punched in') counts.notYetIn++;
        else if (leaveUnits > 0) counts.onLeave++;
      } else {
        status = dayStatusLabel(d, key === today);
        counts.present++;
        if (late) counts.late++;
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
        isLate: late,
        lateByMinutes: late ? d!.lateByMinutes : 0,
        lateHalfDay: !!d?.lateHalfDay,
        lateReason: d?.lateReason ?? null,
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
      const penalty = policy.latePenaltySource === 'NONE' ? 0 : latePenaltyDays(s.penaltyLateMarks, policy.lateMarksPerPenalty, policy.latePenaltyDays, shift.lateMarksAllowed);
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
        lateMarks: s.penaltyLateMarks,
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

  /**
   * Cron (policy.punchInReminder): once shift start + grace has passed on a working day, remind
   * whoever hasn't punched in (not on leave), once a day.
   */
  async punchInReminders(now = new Date()): Promise<number> {
    const today = istKeyOf(now);
    const emps = (await this.prisma.employee.findMany({ where: { status: { in: ACTIVE_STATUSES as any }, userId: { not: null } }, select: EMP_SELECT })) as EmployeeLite[];
    if (!emps.length) return 0;
    const [sessions, leaves, holidays, sent] = await Promise.all([
      this.prisma.workSession.findMany({ where: { attendanceDate: dateOf(today) }, select: { employeeId: true } }),
      this.cross.leaveDays(emps.map((e) => e.id), today, today),
      this.policies.holidaysBetween(today, today),
      this.prisma.notification.findMany({ where: { type: 'attendance.punchReminder', createdAt: { gte: istInstant(today, 0) } }, select: { userId: true } }),
    ]);
    const punched = new Set(sessions.map((s) => s.employeeId));
    const reminded = new Set(sent.map((s) => s.userId));
    let n = 0;
    for (const e of emps) {
      if (punched.has(e.id) || reminded.has(e.userId!) || (e.joiningDate && keyOf(e.joiningDate) > today)) continue;
      const leave = CrossReader.leaveOnDay(leaves.filter((l) => l.employeeId === e.id));
      if (leave && leave.fraction >= 1) continue;
      const r = await this.resolve(e, today);
      if (!r.policy.punchInReminder || isWeeklyOff(today, r.shift) || this.policies.holidayName(holidays, today, this.holidayLocation(e, r))) continue;
      const { expectedStart, expectedEnd } = shiftWindow(today, r.shift);
      const start = leave?.plannedFirstHalf ? secondHalfStart(expectedStart, r.shift) : expectedStart;
      const lateAfter = new Date(start.getTime() + r.shift.graceMinutes * 60_000);
      if (now < lateAfter || now > expectedEnd) continue;
      await this.notifications.notify({
        userIds: [e.userId!],
        type: 'attendance.punchReminder',
        title: "You haven't punched in yet",
        body: `Your shift started at ${istHm(start)} (grace till ${istHm(lateAfter)}). Punch in now — a late punch-in asks for the reason.`,
        link: '/attendance',
      });
      n++;
    }
    return n;
  }

  requiredMinutesFor(shift: Parameters<typeof requiredMinutes>[0]) {
    return requiredMinutes(shift);
  }
}

/** Status words for a stored day (lateness is shown separately as its own tag). */
export function dayStatusLabel(d: Pick<AttendanceDay, 'status' | 'firstInAt' | 'leaveTypeCode' | 'holidayName' | 'lateHalfDay'>, isToday: boolean): string {
  const s = d.status as TimeDayStatus;
  if (s === 'PENDING') return isToday ? (d.firstInAt ? 'In progress' : 'Not punched in') : 'Pending';
  if (s === 'LEAVE' && d.leaveTypeCode) return `Leave · ${d.leaveTypeCode}`;
  if (s === 'HALF_DAY_LEAVE' && d.leaveTypeCode) return `Half-day leave · ${d.leaveTypeCode}`;
  if (s === 'HOLIDAY' && d.holidayName) return `Holiday · ${d.holidayName}`;
  if (s === 'HOLIDAY_WORKED' && d.holidayName) return `Worked on ${d.holidayName}`;
  if (s === 'HALF_DAY' && d.lateHalfDay) return 'Half day · late';
  return DAY_STATUS_LABEL[s];
}
