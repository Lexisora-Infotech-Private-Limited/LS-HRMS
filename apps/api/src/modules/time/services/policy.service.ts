import { Injectable } from '@nestjs/common';
import type { AttendancePolicy, Holiday, PolicyAudience, Shift, WorkLocation } from '@prisma/client';
import type { AttendancePolicyDto, PolicyPatch, PolicyUpdateResult } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError } from '../../../core/http/errors';
import { CrossReader } from '../cross';
import { normalizePolicy, type LocationRules } from '../lib/policy';
import { dateOf, keyOf } from '../lib/time-utils';
import type { ShiftLike } from '../lib/day-calc';

export const POLICY_DEFAULTS: Record<PolicyAudience, Omit<AttendancePolicy, 'id' | 'tenantId' | 'audience' | 'updatedAt' | 'updatedByName' | 'version'>> = {
  OFFICE: {
    biometricMandatory: true,
    allowWebPunch: false,
    allowDesktopPunch: false,
    autoIdleEnabled: true,
    autoIdleMinutes: 5,
    screenshotsEnabled: true,
    screenshotIntervalMinutes: 10,
    blurScreenshots: false,
    deductIdleFromPayroll: true,
    monthlyIdleAllowanceMinutes: 60,
    breakReminderMinutes: 120,
    offlineRetentionDays: 7,
    screenshotRetentionDays: 90,
    idleDeductionMode: 'SHORTFALL_ONLY',
    lateMarksPerPenalty: 3,
    latePenaltyDays: 0.5,
    latePenaltySource: 'LEAVE_THEN_LOP',
    earlyOutCountsAsLate: false,
    missedPunchAutoCloseHours: 6,
    maxRegularizationsPerMonth: 3,
    regularizationWindowDays: 7,
    timesheetRequired: true,
    trackerRequired: false,
    punchInReminder: true,
  },
  REMOTE: {
    biometricMandatory: false,
    allowWebPunch: true,
    allowDesktopPunch: true,
    autoIdleEnabled: true,
    autoIdleMinutes: 5,
    screenshotsEnabled: true,
    screenshotIntervalMinutes: 10,
    blurScreenshots: false,
    deductIdleFromPayroll: true,
    monthlyIdleAllowanceMinutes: 60,
    breakReminderMinutes: 120,
    offlineRetentionDays: 7,
    screenshotRetentionDays: 90,
    idleDeductionMode: 'SHORTFALL_ONLY',
    lateMarksPerPenalty: 3,
    latePenaltyDays: 0.5,
    latePenaltySource: 'LEAVE_THEN_LOP',
    earlyOutCountsAsLate: false,
    missedPunchAutoCloseHours: 6,
    maxRegularizationsPerMonth: 3,
    regularizationWindowDays: 7,
    timesheetRequired: true,
    trackerRequired: true,
    punchInReminder: true,
  },
};

/** Built-in fallback when a tenant has no shift rows yet. */
export const GENERAL_SHIFT: ShiftLike & { id: null } = {
  id: null,
  name: 'General',
  startMinute: 570,
  endMinute: 1110,
  graceMinutes: 15,
  breakMinutes: 60,
  weeklyOffDays: [0, 6],
  minFullDayMinutes: 450,
  minHalfDayMinutes: 240,
  halfDayIfLateByMinutes: 120,
  earlyOutGraceMinutes: 15,
};

const MONITORING_FIELDS = ['allowWebPunch', 'allowDesktopPunch', 'biometricMandatory', 'autoIdleEnabled', 'autoIdleMinutes', 'screenshotsEnabled', 'screenshotIntervalMinutes', 'blurScreenshots'] as const;
const FIELD_LABEL: Record<string, string> = {
  biometricMandatory: 'Biometric punch mandatory',
  allowWebPunch: 'Allow web punch-in',
  allowDesktopPunch: 'Allow desktop app punch-in',
  autoIdleEnabled: 'Auto-idle',
  autoIdleMinutes: 'Auto-idle minutes',
  screenshotsEnabled: 'Screenshots',
  screenshotIntervalMinutes: 'Screenshot interval',
  blurScreenshots: 'Blur screenshots',
  deductIdleFromPayroll: 'Deduct idle time from payroll',
};

export type EmployeeLite = {
  id: string;
  fullName: string;
  userId: string | null;
  workMode: 'OFFICE' | 'REMOTE' | 'HYBRID';
  shiftId: string | null;
  workLocationId: string | null;
  managerId: string | null;
  status: string;
  employmentType: string;
  joiningDate: Date | null;
  exitDate: Date | null;
  departmentId: string | null;
  empCode: string;
};

export const EMP_SELECT = {
  id: true,
  fullName: true,
  userId: true,
  workMode: true,
  shiftId: true,
  workLocationId: true,
  managerId: true,
  status: true,
  employmentType: true,
  joiningDate: true,
  exitDate: true,
  departmentId: true,
  empCode: true,
} as const;

export function toLocationRules(l: WorkLocation | null): LocationRules | null {
  if (!l) return null;
  return { name: l.name, punchMode: l.punchMode, isRemote: l.isRemote, lat: l.lat, lng: l.lng, geoRadiusM: l.geoRadiusM, geoFenceWebPunch: l.geoFenceWebPunch };
}

export function toShiftLike(s: Shift | null): ShiftLike {
  if (!s) return GENERAL_SHIFT;
  return {
    id: s.id,
    name: s.name,
    startMinute: s.startMinute,
    endMinute: s.endMinute,
    graceMinutes: s.graceMinutes,
    breakMinutes: s.breakMinutes,
    weeklyOffDays: s.weeklyOffDays,
    minFullDayMinutes: s.minFullDayMinutes,
    minHalfDayMinutes: s.minHalfDayMinutes,
    halfDayIfLateByMinutes: s.halfDayIfLateByMinutes,
    earlyOutGraceMinutes: s.earlyOutGraceMinutes,
  };
}

/**
 * Attendance policy (OFFICE / REMOTE columns) plus the calendar lookups every other
 * service needs: shift resolution, locations, holidays.
 */
@Injectable()
export class PolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly cross: CrossReader,
  ) {}

  // ── policy ──
  async get(audience: PolicyAudience): Promise<AttendancePolicy> {
    const row = await this.prisma.attendancePolicy.findFirst({ where: { audience } });
    if (row) return row;
    return this.prisma.attendancePolicy.create({ data: { audience, ...POLICY_DEFAULTS[audience] } as any });
  }

  async both() {
    const [office, remote] = await Promise.all([this.get('OFFICE'), this.get('REMOTE')]);
    return { office: toPolicyDto(office), remote: toPolicyDto(remote) };
  }

  async update(audience: PolicyAudience, patch: PolicyPatch): Promise<PolicyUpdateResult> {
    const current = await this.get(audience);
    if (patch.expectedVersion !== undefined && patch.expectedVersion !== current.version) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Someone else changed this policy · reload and try again');
    }
    const { expectedVersion: _v, ...changes } = patch;
    const merged = { ...current, ...changes };
    const norm = normalizePolicy(merged, changes);
    if (norm.error) throw new AppError(422, 'POLICY_INVALID', norm.error);
    const next = norm.policy;
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(POLICY_DEFAULTS[audience]) as (keyof typeof POLICY_DEFAULTS.OFFICE)[]) {
      if ((current as any)[k] !== (next as any)[k]) diff[k] = { from: (current as any)[k], to: (next as any)[k] };
    }
    if (!Object.keys(diff).length) return { policy: toPolicyDto(current), pushedTo: 0, autoCleared: [] };
    const ctx = requireContext();
    const data: any = {};
    for (const k of Object.keys(diff)) data[k] = (next as any)[k];
    const saved = await this.prisma.attendancePolicy.update({ where: { id: current.id }, data: { ...data, version: current.version + 1, updatedByName: ctx.userName ?? null } });
    await this.audit.record({ action: 'attendance_policy.updated', entity: 'AttendancePolicy', entityId: saved.id, meta: { audience, version: saved.version, diff } as any });

    // Push to web tabs + trackers (they refetch policy on this event).
    this.realtime.toTenant(ctx.tenantId, 'policy.updated', { audience, version: saved.version });
    this.realtime.toTenant(ctx.tenantId, 'tracker.policy.updated', { audience, version: saved.version });

    const affected = await this.employeesInAudience(audience);
    const pushedTo = await this.cross.activeTrackerDevices(affected.map((e) => e.id));
    // DPDP: monitoring / punch-method changes are disclosed to affected employees.
    const material = Object.keys(diff).filter((k) => (MONITORING_FIELDS as readonly string[]).includes(k));
    if (material.length) {
      const userIds = affected.map((e) => e.userId).filter((x): x is string => !!x);
      const what = material.map((k) => `${FIELD_LABEL[k] ?? k}: ${fmtVal(diff[k]!.to)}`).join(', ');
      await this.notifications.notify({ userIds, type: 'attendance.policy.updated', title: 'Attendance policy updated', body: `${audience === 'OFFICE' ? 'Office' : 'Remote / WFH'} rules changed · ${what}`, link: '/attendance', from: 'HR' });
    }
    return { policy: toPolicyDto(saved), pushedTo, autoCleared: norm.autoCleared };
  }

  /** Active employees whose policy column is `audience` (OFFICE vs REMOTE/HYBRID). */
  async employeesInAudience(audience: PolicyAudience) {
    return this.prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'NOTICE_PERIOD'] }, workMode: audience === 'OFFICE' ? 'OFFICE' : { in: ['REMOTE', 'HYBRID'] } },
      select: { id: true, userId: true },
    });
  }

  // ── shifts ──
  async defaultShift(): Promise<Shift | null> {
    return (await this.prisma.shift.findFirst({ where: { isDefault: true, archivedAt: null } })) ?? (await this.prisma.shift.findFirst({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } }));
  }

  /** Resolve shift(employee, date): assignment covering the date → Employee.shiftId → tenant default. */
  async shiftFor(emp: Pick<EmployeeLite, 'id' | 'shiftId'>, date: string): Promise<Shift | null> {
    const d = dateOf(date);
    const a = await this.prisma.shiftAssignment.findFirst({
      where: { employeeId: emp.id, effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: d } }] },
      orderBy: { effectiveFrom: 'desc' },
      include: { shift: true },
    });
    if (a?.shift) return a.shift;
    if (emp.shiftId) {
      const s = await this.prisma.shift.findFirst({ where: { id: emp.shiftId } });
      if (s) return s;
    }
    return this.defaultShift();
  }

  // ── locations ──
  async remoteLocation(): Promise<WorkLocation> {
    const found = await this.prisma.workLocation.findFirst({ where: { isRemote: true, archivedAt: null }, orderBy: { isSystem: 'desc' } });
    if (found) return found;
    return this.prisma.workLocation.create({ data: { name: 'Remote', punchMode: 'WEB_DESKTOP_ALLOWED', isRemote: true, isSystem: true } as any });
  }

  async locationFor(emp: Pick<EmployeeLite, 'workLocationId'>, audience: PolicyAudience): Promise<WorkLocation | null> {
    if (audience === 'REMOTE') return this.remoteLocation();
    if (emp.workLocationId) {
      const l = await this.prisma.workLocation.findFirst({ where: { id: emp.workLocationId } });
      if (l) return l;
    }
    return this.prisma.workLocation.findFirst({ where: { isRemote: false, archivedAt: null }, orderBy: { createdAt: 'asc' } });
  }

  // ── holidays ──
  async holidaysBetween(from: string, to: string): Promise<Holiday[]> {
    return this.prisma.holiday.findMany({ where: { date: { gte: dateOf(from), lte: dateOf(to) }, type: 'MANDATORY' }, orderBy: { date: 'asc' } });
  }

  /** Holiday name for a location on a date (empty locationIds = every location). */
  holidayName(holidays: Holiday[], date: string, locationId: string | null): string | null {
    const h = holidays.find((x) => keyOf(x.date) === date && (!x.locationIds.length || (locationId && x.locationIds.includes(locationId))));
    return h?.name ?? null;
  }

  async employee(id: string): Promise<EmployeeLite | null> {
    return (await this.prisma.employee.findFirst({ where: { id }, select: EMP_SELECT })) as EmployeeLite | null;
  }
}

export function toPolicyDto(p: AttendancePolicy): AttendancePolicyDto {
  return {
    audience: p.audience,
    biometricMandatory: p.biometricMandatory,
    allowWebPunch: p.allowWebPunch,
    allowDesktopPunch: p.allowDesktopPunch,
    autoIdleEnabled: p.autoIdleEnabled,
    autoIdleMinutes: p.autoIdleMinutes,
    screenshotsEnabled: p.screenshotsEnabled,
    screenshotIntervalMinutes: p.screenshotIntervalMinutes,
    blurScreenshots: p.blurScreenshots,
    deductIdleFromPayroll: p.deductIdleFromPayroll,
    monthlyIdleAllowanceMinutes: p.monthlyIdleAllowanceMinutes,
    breakReminderMinutes: p.breakReminderMinutes,
    offlineRetentionDays: p.offlineRetentionDays,
    screenshotRetentionDays: p.screenshotRetentionDays,
    idleDeductionMode: p.idleDeductionMode as AttendancePolicyDto['idleDeductionMode'],
    lateMarksPerPenalty: p.lateMarksPerPenalty,
    latePenaltyDays: p.latePenaltyDays,
    latePenaltySource: p.latePenaltySource as AttendancePolicyDto['latePenaltySource'],
    earlyOutCountsAsLate: p.earlyOutCountsAsLate,
    missedPunchAutoCloseHours: p.missedPunchAutoCloseHours,
    maxRegularizationsPerMonth: p.maxRegularizationsPerMonth,
    regularizationWindowDays: p.regularizationWindowDays,
    timesheetRequired: p.timesheetRequired,
    trackerRequired: p.trackerRequired,
    punchInReminder: p.punchInReminder,
    version: p.version,
    updatedAt: p.updatedAt.toISOString(),
    updatedByName: p.updatedByName,
  };
}

function fmtVal(v: unknown) {
  if (v === true) return 'on';
  if (v === false) return 'off';
  return String(v);
}
