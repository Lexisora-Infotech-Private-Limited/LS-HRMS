import { Injectable } from '@nestjs/common';
import type { Holiday, Shift, WorkLocation } from '@prisma/client';
import type {
  AllocateShiftInput,
  HolidayGroup,
  HolidayInput,
  HolidayRow,
  LocationDetail,
  LocationInput,
  LocationRow,
  ShiftAllocationRow,
  ShiftInput,
  ShiftRow,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { EventsService } from '../../../core/registry/events.service';
import { JobsService } from '../../../core/jobs/jobs.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, notFound } from '../../../core/http/errors';
import { shiftDurationMinutes } from '../lib/day-calc';
import { addDays, dateOf, dayLabel, dm, DOW_SHORT, fmtMinute, istKeyOf, keyOf, parseHm, weeklyOffLabel } from '../lib/time-utils';
import { BUILTIN_HOLIDAYS } from '../lib/holiday-lists';
import { PeriodLockService } from './period-lock.service';
import { PolicyService } from './policy.service';

const ACTIVE = ['ACTIVE', 'NOTICE_PERIOD'] as const;

/** Shift master + allocation, work locations, holiday calendar (spec-time A, B, C). */
@Injectable()
export class MastersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: PolicyService,
    private readonly locks: PeriodLockService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly events: EventsService,
    private readonly jobs: JobsService,
  ) {}

  // ── shifts ────────────────────────────────────────────────────────────────
  /** employeeId → current shiftId (assignment covering today → Employee.shiftId → default). */
  async currentShiftMap(): Promise<Map<string, string | null>> {
    const today = dateOf(istKeyOf(new Date()));
    const [emps, assigns, def] = await Promise.all([
      this.prisma.employee.findMany({ where: { status: { in: [...ACTIVE] } }, select: { id: true, shiftId: true } }),
      this.prisma.shiftAssignment.findMany({ where: { effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }, orderBy: { effectiveFrom: 'asc' } }),
      this.policies.defaultShift(),
    ]);
    const byEmp = new Map<string, string>();
    for (const a of assigns) byEmp.set(a.employeeId, a.shiftId);
    return new Map(emps.map((e) => [e.id, byEmp.get(e.id) ?? e.shiftId ?? def?.id ?? null]));
  }

  async listShifts(): Promise<ShiftRow[]> {
    const [rows, current] = await Promise.all([this.prisma.shift.findMany({ where: { archivedAt: null }, orderBy: [{ isDefault: 'desc' }, { startMinute: 'asc' }] }), this.currentShiftMap()]);
    const counts = new Map<string, number>();
    for (const s of current.values()) if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    return rows.map((s) => toShiftRow(s, counts.get(s.id) ?? 0));
  }

  private validateShift(input: Partial<ShiftInput>, existing?: Shift) {
    const start = input.start !== undefined ? parseHm(input.start) : existing!.startMinute;
    const end = input.end !== undefined ? parseHm(input.end) : existing!.endMinute;
    if (start === end) throw new AppError(422, 'SHIFT_INVALID', 'Start and end cannot be the same');
    const duration = shiftDurationMinutes({ startMinute: start, endMinute: end });
    const brk = input.breakMinutes ?? existing?.breakMinutes ?? 60;
    if (brk >= duration) throw new AppError(422, 'SHIFT_INVALID', 'Break must be shorter than the shift');
    const full = input.minFullDayMinutes ?? existing?.minFullDayMinutes ?? Math.min(450, duration - brk);
    const half = input.minHalfDayMinutes ?? existing?.minHalfDayMinutes ?? Math.min(240, Math.floor(full / 2));
    if (half >= full) throw new AppError(422, 'SHIFT_INVALID', 'Half-day minimum must be below the full-day minimum');
    if (full > duration - brk + 60) throw new AppError(422, 'SHIFT_INVALID', 'Full-day minimum is longer than the shift allows');
    const off = input.weeklyOffDays ?? existing?.weeklyOffDays ?? [0, 6];
    if (new Set(off).size >= 7) throw new AppError(422, 'SHIFT_INVALID', 'Keep at least one working day');
    return { startMinute: start, endMinute: end, breakMinutes: brk, minFullDayMinutes: full, minHalfDayMinutes: half, weeklyOffDays: [...new Set(off)].sort() };
  }

  async createShift(input: ShiftInput): Promise<ShiftRow> {
    const v = this.validateShift(input);
    const exists = await this.prisma.shift.findFirst({ where: { name: input.name } });
    if (exists && !exists.archivedAt) throw new AppError(409, 'DUPLICATE', 'A shift with this name already exists');
    const hasDefault = await this.prisma.shift.count({ where: { isDefault: true, archivedAt: null } });
    const makeDefault = !!input.isDefault || !hasDefault;
    if (makeDefault) await this.prisma.shift.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    const data = {
      name: input.name,
      ...v,
      graceMinutes: input.graceMinutes,
      halfDayIfLateByMinutes: input.halfDayIfLateByMinutes === undefined ? 120 : input.halfDayIfLateByMinutes,
      isDefault: makeDefault,
      archivedAt: null,
    };
    const s = exists ? await this.prisma.shift.update({ where: { id: exists.id }, data }) : await this.prisma.shift.create({ data: data as any });
    await this.audit.record({ action: 'shift.created', entity: 'Shift', entityId: s.id, meta: { name: s.name, timing: `${fmtMinute(s.startMinute)}–${fmtMinute(s.endMinute)}` } });
    return toShiftRow(s, 0);
  }

  async updateShift(id: string, input: Partial<ShiftInput>): Promise<ShiftRow> {
    const s = await this.prisma.shift.findFirst({ where: { id, archivedAt: null } });
    if (!s) throw notFound('Shift');
    const v = this.validateShift(input, s);
    if (input.isDefault) await this.prisma.shift.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
    const saved = await this.prisma.shift.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...v,
        ...(input.graceMinutes !== undefined ? { graceMinutes: input.graceMinutes } : {}),
        ...(input.halfDayIfLateByMinutes !== undefined ? { halfDayIfLateByMinutes: input.halfDayIfLateByMinutes } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault || s.isDefault } : {}),
      },
    });
    const diff: Record<string, unknown> = {};
    for (const k of ['name', 'startMinute', 'endMinute', 'graceMinutes', 'breakMinutes', 'weeklyOffDays', 'minFullDayMinutes', 'minHalfDayMinutes', 'halfDayIfLateByMinutes'] as const) {
      if (JSON.stringify(s[k]) !== JSON.stringify(saved[k])) diff[k] = { from: s[k], to: saved[k] };
    }
    await this.audit.record({ action: 'shift.updated', entity: 'Shift', entityId: id, meta: diff as any });
    const counts = await this.currentShiftMap();
    return toShiftRow(saved, [...counts.values()].filter((x) => x === id).length);
  }

  async archiveShift(id: string) {
    const s = await this.prisma.shift.findFirst({ where: { id, archivedAt: null } });
    if (!s) throw notFound('Shift');
    if (s.isDefault) throw new AppError(409, 'SHIFT_IN_USE', 'Make another shift the default before archiving this one');
    const today = dateOf(istKeyOf(new Date()));
    const inUse = await this.prisma.shiftAssignment.count({ where: { shiftId: id, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] } });
    const direct = await this.prisma.employee.count({ where: { shiftId: id, status: { in: [...ACTIVE] } } });
    if (inUse || direct) throw new AppError(409, 'SHIFT_IN_USE', 'This shift still has current or future allocations');
    await this.prisma.shift.update({ where: { id }, data: { archivedAt: new Date() } });
    await this.audit.record({ action: 'shift.archived', entity: 'Shift', entityId: id, meta: { name: s.name } });
    return { ok: true };
  }

  async listAllocations(q: { shiftId?: string; departmentId?: string }): Promise<ShiftAllocationRow[]> {
    const today = istKeyOf(new Date());
    const rows = await this.prisma.shiftAssignment.findMany({
      where: { ...(q.shiftId ? { shiftId: q.shiftId } : {}) },
      include: { shift: true },
      orderBy: [{ effectiveFrom: 'desc' }],
      take: 500,
    });
    const emps = await this.prisma.employee.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] }, ...(q.departmentId ? { departmentId: q.departmentId } : {}) },
      select: { id: true, fullName: true, department: { select: { name: true } } },
    });
    const em = new Map(emps.map((e) => [e.id, e]));
    return rows
      .filter((r) => em.has(r.employeeId))
      .map((r) => {
        const from = keyOf(r.effectiveFrom);
        const to = r.effectiveTo ? keyOf(r.effectiveTo) : null;
        const e = em.get(r.employeeId)!;
        return {
          id: r.id,
          employeeId: r.employeeId,
          employeeName: e.fullName,
          department: e.department?.name ?? null,
          shiftId: r.shiftId,
          shiftName: r.shift.name,
          from,
          to,
          allocatedBy: r.assignedByName,
          current: from <= today && (!to || to >= today),
        };
      });
  }

  /** Allocate (B3): close each open-ended assignment at D−1 and insert the new one; backdated → recompute. */
  async allocate(input: AllocateShiftInput) {
    const ctx = requireContext();
    const shift = await this.prisma.shift.findFirst({ where: { id: input.shiftId, archivedAt: null } });
    if (!shift) throw notFound('Shift');
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw badRequest('To date must be on or after the From date');
    const today = istKeyOf(new Date());
    if (input.effectiveFrom <= today && (await this.locks.isLocked(input.effectiveFrom))) {
      throw new AppError(409, 'PERIOD_LOCKED', 'This date is in a locked attendance period');
    }
    const emps = await this.prisma.employee.findMany({ where: { id: { in: input.employeeIds }, status: { not: 'EXITED' } }, select: { id: true, joiningDate: true, userId: true, fullName: true } });
    if (!emps.length) throw badRequest('Select employees');
    const from = dateOf(input.effectiveFrom);
    const to = input.effectiveTo ? dateOf(input.effectiveTo) : null;
    for (const e of emps) {
      const start = e.joiningDate && keyOf(e.joiningDate) > input.effectiveFrom ? e.joiningDate : from;
      // overlap check against closed ranges that are not the open-ended current one
      const overlapping = await this.prisma.shiftAssignment.findFirst({
        where: { employeeId: e.id, effectiveTo: { not: null, gte: start }, effectiveFrom: to ? { lte: to } : undefined },
      });
      if (overlapping && keyOf(overlapping.effectiveFrom) >= keyOf(start)) {
        throw new AppError(409, 'ALLOCATION_OVERLAP', `${e.fullName} already has a shift allocation in this range`);
      }
      await this.prisma.$transaction(async (tx) => {
        const open = await tx.shiftAssignment.findMany({ where: { tenantId: ctx.tenantId, employeeId: e.id, OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }] } });
        for (const o of open) {
          if (o.effectiveFrom >= start) await tx.shiftAssignment.delete({ where: { id: o.id } });
          else await tx.shiftAssignment.update({ where: { id: o.id }, data: { effectiveTo: dateOf(addDays(keyOf(start), -1)) } });
        }
        await tx.shiftAssignment.create({ data: { tenantId: ctx.tenantId, employeeId: e.id, shiftId: shift.id, effectiveFrom: start, effectiveTo: to, assignedByName: ctx.userName ?? null } });
        if (keyOf(start) <= today && (!to || keyOf(to) >= today)) await tx.employee.update({ where: { id: e.id }, data: { shiftId: shift.id } });
      });
    }
    await this.audit.record({ action: 'shift.allocated', entity: 'Shift', entityId: shift.id, meta: { employeeIds: emps.map((e) => e.id), from: input.effectiveFrom, to: input.effectiveTo ?? null } });
    const timing = `${fmtMinute(shift.startMinute)}–${fmtMinute(shift.endMinute)}`;
    await this.notifications.notify({
      userIds: emps.map((e) => e.userId).filter((x): x is string => !!x),
      type: 'shift.changed',
      title: `Your shift changes to ${shift.name} ${timing} from ${dm(input.effectiveFrom)}`,
      link: '/attendance',
      from: ctx.userName ?? 'HR',
      email: true,
    });
    if (input.effectiveFrom <= today) {
      await this.jobs.enqueue('time.recomputeRange', { tenantId: ctx.tenantId, employeeIds: emps.map((e) => e.id), from: input.effectiveFrom, to: today });
    }
    return { ok: true, count: emps.length };
  }

  async deleteAllocation(id: string) {
    const a = await this.prisma.shiftAssignment.findFirst({ where: { id } });
    if (!a) throw notFound('Allocation');
    if (keyOf(a.effectiveFrom) <= istKeyOf(new Date())) throw new AppError(409, 'ALLOCATION_STARTED', 'Only future-dated allocations can be deleted');
    await this.prisma.shiftAssignment.delete({ where: { id } });
    await this.audit.record({ action: 'shift.allocation.deleted', entity: 'ShiftAssignment', entityId: id, meta: { employeeId: a.employeeId } });
    return { ok: true };
  }

  // ── locations ─────────────────────────────────────────────────────────────
  private async locationCounts(): Promise<Map<string, number>> {
    const remote = await this.policies.remoteLocation();
    const emps = await this.prisma.employee.findMany({ where: { status: { in: [...ACTIVE] } }, select: { workLocationId: true, workMode: true } });
    const m = new Map<string, number>();
    for (const e of emps) {
      const loc = e.workMode === 'REMOTE' ? remote.id : e.workLocationId;
      if (loc) m.set(loc, (m.get(loc) ?? 0) + 1);
    }
    return m;
  }

  async listLocations(): Promise<LocationRow[]> {
    await this.policies.remoteLocation();
    const [rows, counts] = await Promise.all([this.prisma.workLocation.findMany({ where: { archivedAt: null }, orderBy: [{ isRemote: 'asc' }, { createdAt: 'asc' }] }), this.locationCounts()]);
    return rows.map((l) => toLocationRow(l, counts.get(l.id) ?? 0));
  }

  async locationDetail(id: string): Promise<LocationDetail> {
    const l = await this.prisma.workLocation.findFirst({ where: { id } });
    if (!l) throw notFound('Location');
    const emps = await this.prisma.employee.findMany({
      where: { status: { in: [...ACTIVE] }, ...(l.isRemote ? { OR: [{ workMode: 'REMOTE' }, { workLocationId: id }] } : { workLocationId: id }) },
      select: { id: true, fullName: true, empCode: true, workMode: true, department: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    });
    const devices = await this.prisma.biometricDevice.findMany({ where: { locationId: id }, orderBy: { name: 'asc' } });
    return {
      ...toLocationRow(l, emps.length),
      employeeList: emps.map((e) => ({ id: e.id, name: e.fullName, empCode: e.empCode, department: e.department?.name ?? null, workMode: e.workMode })),
      devices: devices.map((d) => ({
        id: d.id,
        serialNumber: d.serialNumber,
        name: d.name,
        locationId: d.locationId,
        locationName: l.name,
        model: d.model,
        firmware: d.firmware,
        directionMode: d.directionMode,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        lastSeen: d.lastSeenAt ? d.lastSeenAt.toISOString() : 'Never',
        status: d.status === 'DISABLED' ? 'Disabled' : d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 30 * 60_000 ? 'Online' : 'Offline',
        unprocessed: 0,
      })),
    };
  }

  private checkLocation(input: Partial<LocationInput>, existing?: WorkLocation) {
    const isRemote = existing?.isRemote ?? false;
    if (isRemote && input.punchMode === 'BIOMETRIC_ONLY') throw new AppError(422, 'LOCATION_INVALID', 'A remote location cannot be biometric only');
    const fence = input.geoFenceWebPunch ?? existing?.geoFenceWebPunch ?? false;
    const lat = input.lat !== undefined ? input.lat : existing?.lat;
    const lng = input.lng !== undefined ? input.lng : existing?.lng;
    if (fence && (lat == null || lng == null)) throw new AppError(422, 'LOCATION_INVALID', 'Enter latitude and longitude to enforce the geo-fence');
    if (fence && !(input.geoRadiusM ?? existing?.geoRadiusM)) throw new AppError(422, 'LOCATION_INVALID', 'Enter a geo radius to enforce the geo-fence');
  }

  async createLocation(input: LocationInput): Promise<LocationRow> {
    this.checkLocation(input);
    const dup = await this.prisma.workLocation.findFirst({ where: { name: input.name } });
    if (dup) throw new AppError(409, 'DUPLICATE', 'A location with this name already exists');
    const l = await this.prisma.workLocation.create({
      data: {
        name: input.name,
        address: input.address ?? null,
        geoRadiusM: input.geoRadiusM ?? null,
        punchMode: input.punchMode,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        geoFenceWebPunch: input.geoFenceWebPunch ?? false,
        isRemote: false,
      } as any,
    });
    await this.audit.record({ action: 'location.created', entity: 'WorkLocation', entityId: l.id, meta: { name: l.name, punchMode: l.punchMode } });
    return toLocationRow(l, 0);
  }

  async updateLocation(id: string, input: Partial<LocationInput>): Promise<LocationRow> {
    const l = await this.prisma.workLocation.findFirst({ where: { id, archivedAt: null } });
    if (!l) throw notFound('Location');
    this.checkLocation(input, l);
    if (l.isSystem && input.name && input.name !== l.name) throw new AppError(422, 'LOCATION_SYSTEM', 'The Remote location cannot be renamed');
    const saved = await this.prisma.workLocation.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.geoRadiusM !== undefined ? { geoRadiusM: input.geoRadiusM } : {}),
        ...(input.punchMode !== undefined ? { punchMode: input.punchMode } : {}),
        ...(input.lat !== undefined ? { lat: input.lat } : {}),
        ...(input.lng !== undefined ? { lng: input.lng } : {}),
        ...(input.geoFenceWebPunch !== undefined ? { geoFenceWebPunch: input.geoFenceWebPunch } : {}),
      },
    });
    const diff: Record<string, unknown> = {};
    for (const k of ['name', 'address', 'geoRadiusM', 'punchMode', 'lat', 'lng', 'geoFenceWebPunch'] as const) if (l[k] !== saved[k]) diff[k] = { from: l[k], to: saved[k] };
    await this.audit.record({ action: 'location.updated', entity: 'WorkLocation', entityId: id, meta: diff as any });
    if (diff.punchMode || diff.geoFenceWebPunch || diff.geoRadiusM) {
      const ctx = requireContext();
      this.realtime.toTenant(ctx.tenantId, 'policy.updated', { locationId: id });
      this.realtime.toTenant(ctx.tenantId, 'tracker.policy.updated', { locationId: id });
    }
    return toLocationRow(saved, (await this.locationCounts()).get(id) ?? 0);
  }

  async deleteLocation(id: string) {
    const l = await this.prisma.workLocation.findFirst({ where: { id, archivedAt: null } });
    if (!l) throw notFound('Location');
    if (l.isSystem) throw new AppError(409, 'LOCATION_SYSTEM', 'The Remote location cannot be deleted');
    const emps = await this.prisma.employee.count({ where: { workLocationId: id, status: { not: 'EXITED' } } });
    if (emps) throw new AppError(409, 'LOCATION_IN_USE', `${emps} employee${emps === 1 ? ' is' : 's are'} still assigned to this location`);
    const [devices, punches] = await Promise.all([this.prisma.biometricDevice.count({ where: { locationId: id } }), this.prisma.attendancePunch.count({ where: { locationId: id } })]);
    if (!devices && !punches) await this.prisma.workLocation.delete({ where: { id } });
    else await this.prisma.workLocation.update({ where: { id }, data: { archivedAt: new Date() } });
    await this.audit.record({ action: 'location.archived', entity: 'WorkLocation', entityId: id, meta: { name: l.name, hardDeleted: !devices && !punches } });
    return { ok: true };
  }

  async assignLocation(id: string, employeeIds: string[]) {
    const l = await this.prisma.workLocation.findFirst({ where: { id, archivedAt: null } });
    if (!l) throw notFound('Location');
    const res = await this.prisma.employee.updateMany({ where: { id: { in: employeeIds }, status: { not: 'EXITED' } }, data: { workLocationId: id } });
    await this.audit.record({ action: 'location.employees.assigned', entity: 'WorkLocation', entityId: id, meta: { employeeIds } });
    for (const e of employeeIds) this.events.emit('employee.location.changed', { employeeId: e, locationId: id });
    const ctx = requireContext();
    this.realtime.toTenant(ctx.tenantId, 'policy.updated', { locationId: id });
    return { ok: true, count: res.count };
  }

  // ── holidays ──────────────────────────────────────────────────────────────
  async listHolidays(year: number): Promise<HolidayRow[]> {
    const rows = await this.prisma.holiday.findMany({ where: { date: { gte: dateOf(`${year}-01-01`), lte: dateOf(`${year}-12-31`) } }, orderBy: { date: 'asc' } });
    const locs = await this.prisma.workLocation.findMany({ select: { id: true, name: true } });
    const ln = new Map(locs.map((l) => [l.id, l.name]));
    return rows.map((h) => toHolidayRow(h, ln));
  }

  /** Grouped upcoming holidays ("Diwali 8–9 Nov") from a date (default today). */
  async upcoming(from?: string, limit = 8): Promise<HolidayGroup[]> {
    const start = from ?? istKeyOf(new Date());
    const rows = await this.prisma.holiday.findMany({ where: { date: { gte: dateOf(start) } }, orderBy: { date: 'asc' }, take: 40 });
    return groupHolidays(rows).slice(0, limit);
  }

  async createHoliday(input: HolidayInput) {
    const from = input.date;
    const to = input.endDate && input.endDate > from ? input.endDate : from;
    const created: Holiday[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const exists = await this.prisma.holiday.findFirst({ where: { date: dateOf(d), name: input.name } });
      if (exists) continue;
      created.push(
        await this.prisma.holiday.create({
          data: { date: dateOf(d), name: input.name, type: input.type ?? 'MANDATORY', calendar: input.calendar || `National ${from.slice(0, 4)}`, locationIds: input.locationIds ?? [] } as any,
        }),
      );
    }
    if (!created.length) throw new AppError(409, 'DUPLICATE', 'This holiday is already on the calendar');
    await this.audit.record({ action: 'holiday.created', entity: 'Holiday', entityId: created[0]!.id, meta: { name: input.name, from, to } });
    await this.recomputeIfPast(from, to);
    return { ok: true, count: created.length };
  }

  async updateHoliday(id: string, input: Partial<HolidayInput>) {
    const h = await this.prisma.holiday.findFirst({ where: { id } });
    if (!h) throw notFound('Holiday');
    const saved = await this.prisma.holiday.update({
      where: { id },
      data: {
        ...(input.date ? { date: dateOf(input.date) } : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.calendar !== undefined ? { calendar: input.calendar ?? 'National' } : {}),
        ...(input.locationIds ? { locationIds: input.locationIds } : {}),
      },
    });
    await this.audit.record({ action: 'holiday.updated', entity: 'Holiday', entityId: id, meta: { name: saved.name } });
    await this.recomputeIfPast(keyOf(h.date), keyOf(h.date));
    if (input.date) await this.recomputeIfPast(input.date, input.date);
    return { ok: true };
  }

  async deleteHoliday(id: string) {
    const h = await this.prisma.holiday.findFirst({ where: { id } });
    if (!h) throw notFound('Holiday');
    await this.prisma.holiday.delete({ where: { id } });
    await this.audit.record({ action: 'holiday.deleted', entity: 'Holiday', entityId: id, meta: { name: h.name, date: keyOf(h.date) } });
    await this.recomputeIfPast(keyOf(h.date), keyOf(h.date));
    return { ok: true };
  }

  async importHolidays(year: number, calendar: 'National' | 'Gujarat' | 'Maharashtra') {
    const list = (BUILTIN_HOLIDAYS[year] ?? []).filter((h) => h.calendars.includes(calendar));
    if (!list.length) throw new AppError(404, 'NO_LIST', `No built-in ${calendar} list for ${year}`);
    let n = 0;
    for (const h of list) {
      const exists = await this.prisma.holiday.findFirst({ where: { date: dateOf(h.date), name: h.name } });
      if (exists) continue;
      await this.prisma.holiday.create({ data: { date: dateOf(h.date), name: h.name, type: h.type, calendar: `${calendar} ${year}`, locationIds: [] } as any });
      n++;
    }
    await this.audit.record({ action: 'holiday.imported', entity: 'Holiday', meta: { year, calendar, added: n } });
    return { ok: true, count: n };
  }

  async copyHolidays(fromYear: number, toYear: number) {
    if (fromYear === toYear) throw badRequest('Pick a different year');
    const rows = await this.prisma.holiday.findMany({ where: { date: { gte: dateOf(`${fromYear}-01-01`), lte: dateOf(`${fromYear}-12-31`) } } });
    let n = 0;
    for (const h of rows) {
      const k = keyOf(h.date);
      const target = `${toYear}${k.slice(4)}`;
      if (target.endsWith('02-29')) continue;
      const exists = await this.prisma.holiday.findFirst({ where: { date: dateOf(target), name: h.name } });
      if (exists) continue;
      await this.prisma.holiday.create({ data: { date: dateOf(target), name: h.name, type: h.type, calendar: h.calendar.replace(String(fromYear), String(toYear)), locationIds: h.locationIds } as any });
      n++;
    }
    await this.audit.record({ action: 'holiday.copied', entity: 'Holiday', meta: { fromYear, toYear, added: n } });
    return { ok: true, count: n };
  }

  private async recomputeIfPast(from: string, to: string) {
    const today = istKeyOf(new Date());
    if (from > today) return;
    const ctx = requireContext();
    await this.jobs.enqueue('time.recomputeRange', { tenantId: ctx.tenantId, employeeIds: null, from, to: to < today ? to : today });
  }

  // ── lookups ───────────────────────────────────────────────────────────────
  async shiftOptions() {
    const rows = await this.prisma.shift.findMany({ where: { archivedAt: null }, orderBy: [{ isDefault: 'desc' }, { startMinute: 'asc' }] });
    return rows.map((s) => ({ value: s.id, label: `${s.name} · ${fmtMinute(s.startMinute)}–${fmtMinute(s.endMinute)}` }));
  }

  async locationOptions() {
    await this.policies.remoteLocation();
    const rows = await this.prisma.workLocation.findMany({ where: { archivedAt: null }, orderBy: [{ isRemote: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((l) => ({ value: l.id, label: l.name }));
  }
}

export function toShiftRow(s: Shift, employees: number): ShiftRow {
  return {
    id: s.id,
    name: s.name,
    timing: `${fmtMinute(s.startMinute)} – ${fmtMinute(s.endMinute)}`,
    start: fmtMinute(s.startMinute),
    end: fmtMinute(s.endMinute),
    startMinute: s.startMinute,
    endMinute: s.endMinute,
    graceMinutes: s.graceMinutes,
    breakMinutes: s.breakMinutes,
    weeklyOffDays: s.weeklyOffDays,
    weeklyOff: weeklyOffLabel(s.weeklyOffDays),
    employees,
    isDefault: s.isDefault,
    minFullDayMinutes: s.minFullDayMinutes,
    minHalfDayMinutes: s.minHalfDayMinutes,
    halfDayIfLateByMinutes: s.halfDayIfLateByMinutes,
  };
}

export function toLocationRow(l: WorkLocation, employees: number): LocationRow {
  return {
    id: l.id,
    name: l.name,
    address: l.address,
    geoRadiusM: l.geoRadiusM,
    geoRadius: l.geoRadiusM ? `${l.geoRadiusM} m` : '—',
    punchMode: l.punchMode,
    punchModeLabel: l.punchMode === 'BIOMETRIC_ONLY' ? 'Biometric only' : 'Web / desktop',
    isRemote: l.isRemote,
    isSystem: l.isSystem,
    employees,
    lat: l.lat,
    lng: l.lng,
    geoFenceWebPunch: l.geoFenceWebPunch,
  };
}

function toHolidayRow(h: Holiday, locNames: Map<string, string>): HolidayRow {
  const k = keyOf(h.date);
  return {
    id: h.id,
    date: k,
    dateLabel: dayLabel(k).slice(4) + ` ${k.slice(0, 4)}`,
    weekday: DOW_SHORT[dateOf(k).getUTCDay()]!,
    name: h.name,
    type: h.type === 'OPTIONAL' ? 'OPTIONAL' : 'MANDATORY',
    calendar: h.calendar,
    locations: h.locationIds.length ? h.locationIds.map((id) => locNames.get(id) ?? '—').join(', ') : 'All locations',
    locationIds: h.locationIds,
  };
}

/** Consecutive days with the same name collapse into one group ("Diwali 8–9 Nov"). */
export function groupHolidays(rows: { date: Date; name: string; type: string }[]): HolidayGroup[] {
  const out: HolidayGroup[] = [];
  for (const h of rows) {
    const k = keyOf(h.date);
    const last = out.at(-1);
    if (last && last.name === h.name && addDays(last.to, 1) === k) {
      last.to = k;
      last.days++;
      continue;
    }
    out.push({ name: h.name, from: k, to: k, label: '', days: 1, type: h.type });
  }
  for (const g of out) {
    const a = dateOf(g.from);
    const b = dateOf(g.to);
    g.label = g.days === 1 ? dm(g.from) : a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${dm(g.to)}` : `${dm(g.from)} – ${dm(g.to)}`;
  }
  return out;
}
