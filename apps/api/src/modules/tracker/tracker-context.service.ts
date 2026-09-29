import { Injectable } from '@nestjs/common';
import {
  MONITOR_ONLY_MESSAGE,
  trackerWorkDate,
  type TrackerMode,
  type TrackerPolicyResponse,
} from '@lexisora/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { notFound } from '../../core/http/errors';
import { dbDate, hhmm } from './tracker.rules';

/** Defaults used when the time domain has not stored an AttendancePolicy row yet. */
const POLICY_DEFAULTS = {
  OFFICE: { biometricMandatory: true, allowWebPunch: false, allowDesktopPunch: false },
  REMOTE: { biometricMandatory: false, allowWebPunch: true, allowDesktopPunch: true },
} as const;

export type TrackerEmployee = {
  id: string;
  tenantId: string;
  userId: string | null;
  fullName: string;
  empCode: string;
  workMode: 'OFFICE' | 'REMOTE' | 'HYBRID';
  managerId: string | null;
  shiftId: string | null;
  workLocationId: string | null;
  status: string;
};

/**
 * Resolves who the device belongs to and which rules apply: AttendancePolicy by audience
 * (OFFICE employees → OFFICE; REMOTE / HYBRID → REMOTE), shift, and the tracker mode
 * (PUNCH vs MONITOR_ONLY, audit G6 / D7).
 */
@Injectable()
export class TrackerContextService {
  constructor(private readonly prisma: PrismaService) {}

  async employee(employeeId: string): Promise<TrackerEmployee> {
    const e = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, tenantId: true, userId: true, fullName: true, empCode: true, workMode: true, managerId: true, shiftId: true, workLocationId: true, status: true },
    });
    if (!e) throw notFound('Employee');
    return e as TrackerEmployee;
  }

  async policyRow(audience: 'OFFICE' | 'REMOTE') {
    const row = await this.prisma.attendancePolicy.findFirst({ where: { audience } });
    const d = POLICY_DEFAULTS[audience];
    return {
      audience,
      biometricMandatory: row?.biometricMandatory ?? d.biometricMandatory,
      allowWebPunch: row?.allowWebPunch ?? d.allowWebPunch,
      allowDesktopPunch: row?.allowDesktopPunch ?? d.allowDesktopPunch,
      autoIdleEnabled: row?.autoIdleEnabled ?? true,
      autoIdleMinutes: row?.autoIdleMinutes ?? 5,
      screenshotsEnabled: row?.screenshotsEnabled ?? true,
      screenshotIntervalMinutes: row?.screenshotIntervalMinutes ?? 10,
      blurScreenshots: row?.blurScreenshots ?? false,
      deductIdleFromPayroll: row?.deductIdleFromPayroll ?? true,
      breakReminderMinutes: row?.breakReminderMinutes ?? 120,
      offlineRetentionDays: row?.offlineRetentionDays ?? 7,
      screenshotRetentionDays: row?.screenshotRetentionDays ?? 90,
      updatedAt: row?.updatedAt ?? new Date('2026-09-01T00:00:00Z'),
    };
  }

  audienceOf(e: Pick<TrackerEmployee, 'workMode'>): 'OFFICE' | 'REMOTE' {
    return e.workMode === 'OFFICE' ? 'OFFICE' : 'REMOTE';
  }

  async shiftFor(e: TrackerEmployee, dateKey: string) {
    const date = dbDate(dateKey);
    const asg = await this.prisma.shiftAssignment
      .findFirst({
        where: { employeeId: e.id, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
        orderBy: { effectiveFrom: 'desc' },
        include: { shift: true },
      })
      .catch(() => null);
    if (asg?.shift) return asg.shift;
    if (e.shiftId) {
      const s = await this.prisma.shift.findUnique({ where: { id: e.shiftId } });
      if (s) return s;
    }
    return this.prisma.shift.findFirst({ where: { isDefault: true } });
  }

  /** PUNCH for remote / hybrid-WFH days; MONITOR_ONLY for office staff or a hybrid day with a biometric IN. */
  async modeFor(e: TrackerEmployee, now = new Date()): Promise<{ mode: TrackerMode; message: string | null }> {
    const audience = this.audienceOf(e);
    if (audience === 'OFFICE') return { mode: 'MONITOR_ONLY', message: MONITOR_ONLY_MESSAGE };
    if (e.workLocationId) {
      const loc = await this.prisma.workLocation.findUnique({ where: { id: e.workLocationId } }).catch(() => null);
      if (loc && loc.punchMode === 'BIOMETRIC_ONLY' && !loc.isRemote) return { mode: 'MONITOR_ONLY', message: MONITOR_ONLY_MESSAGE };
    }
    const policy = await this.policyRow('REMOTE');
    if (!policy.allowDesktopPunch) return { mode: 'MONITOR_ONLY', message: 'Desktop punch-in is turned off in your attendance policy. The tracker records activity after you punch in.' };
    if (e.workMode === 'HYBRID') {
      const bio = await this.prisma.attendancePunch
        .findFirst({ where: { employeeId: e.id, attendanceDate: dbDate(trackerWorkDate(now)), source: 'BIOMETRIC', status: 'ACCEPTED' } })
        .catch(() => null);
      if (bio) return { mode: 'MONITOR_ONLY', message: 'You punched in with biometric at the office today. The tracker records activity only.' };
    }
    return { mode: 'PUNCH', message: null };
  }

  async policyFor(employeeId: string, now = new Date()): Promise<TrackerPolicyResponse> {
    const e = await this.employee(employeeId);
    const audience = this.audienceOf(e);
    const p = await this.policyRow(audience);
    const shift = await this.shiftFor(e, trackerWorkDate(now));
    const { mode, message } = await this.modeFor(e, now);
    return {
      idleThresholdMin: Math.min(60, Math.max(1, p.autoIdleMinutes)),
      screenshotIntervalMin: Math.min(60, Math.max(1, p.screenshotIntervalMinutes)),
      screenshotsEnabled: p.screenshotsEnabled,
      blurScreenshots: p.blurScreenshots,
      offlineRetentionDays: Math.min(30, Math.max(1, p.offlineRetentionDays)),
      desktopPunchAllowed: mode === 'PUNCH',
      breakReminderMin: p.breakReminderMinutes,
      shiftStart: shift ? hhmm(shift.startMinute) : '09:30',
      shiftEnd: shift ? hhmm(shift.endMinute) : '18:30',
      mode,
      audience,
      autoIdleEnabled: p.autoIdleEnabled,
      deductIdleFromPayroll: p.deductIdleFromPayroll,
      screenshotRetentionDays: p.screenshotRetentionDays,
      idleClaimsAllowed: true,
      shiftName: shift?.name ?? null,
      breakAllowanceMin: shift?.breakMinutes ?? 60,
      modeMessage: message,
      updatedAt: p.updatedAt.toISOString(),
      serverTime: new Date().toISOString(),
    };
  }
}
