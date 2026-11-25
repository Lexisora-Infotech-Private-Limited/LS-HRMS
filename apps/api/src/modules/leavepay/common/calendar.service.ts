import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type { CalendarDay, CalendarFn } from '../leave/leave-calc';
import { addDays, dd, dk, dow, eachDay, type DateKey } from './dates';

/**
 * Weekly offs when the tenant has no shift at all: Saturday + Sunday (same as attendance's
 * built-in General shift). A real shift's weeklyOffDays is always used as-is, even when empty
 * ("None" on the Shifts screen), so leave and attendance count the same days as working.
 */
export const DEFAULT_WEEKLY_OFFS = [0, 6];
export const DEFAULT_SHIFT_NET_MINUTES = 480;

export type HolidayRow = { id: string; date: DateKey; name: string; type: string; locationIds: string[] };

export type EmployeeCalendar = {
  employeeId: string;
  /** Weekly offs of the shift in force on the window's last day (the calendar itself resolves per date). */
  weeklyOffs: number[];
  shiftNetMinutes: number;
  calendar: CalendarFn;
};

export type ShiftLite = { id: string; weeklyOffDays: number[]; startMinute: number; endMinute: number; breakMinutes: number | null };
export type AssignmentLite = { shiftId: string; effectiveFrom: DateKey; effectiveTo: DateKey | null };

/**
 * Pure: shift in force on a date, resolved exactly like attendance (PolicyService.shiftFor):
 * assignment covering the date (latest effectiveFrom wins) → the employee's own shift → tenant default.
 */
export function shiftResolver(
  assignments: AssignmentLite[],
  shiftsById: Map<string, ShiftLite>,
  ownShiftId: string | null,
  fallback: ShiftLite | null,
): (date: DateKey) => ShiftLite | null {
  const sorted = [...assignments].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
  const base = (ownShiftId ? shiftsById.get(ownShiftId) : undefined) ?? fallback;
  return (date) => {
    const a = sorted.find((x) => x.effectiveFrom <= date && (!x.effectiveTo || x.effectiveTo >= date));
    return (a ? shiftsById.get(a.shiftId) : undefined) ?? base;
  };
}

export const weeklyOffsOf = (s: ShiftLite | null): number[] => (s ? s.weeklyOffDays : DEFAULT_WEEKLY_OFFS);

export function shiftNetMinutesOf(s: ShiftLite | null): number {
  if (!s) return DEFAULT_SHIFT_NET_MINUTES;
  const span = (s.endMinute - s.startMinute + 1440) % 1440 || 1440;
  return Math.max(60, span - (s.breakMinutes ?? 0));
}

/**
 * Pure: build a calendar function from weekly offs + holidays. OPTIONAL holidays stay working days.
 * `weeklyOffs` is a fixed list, or a per-date lookup when the employee's shift changes inside the window.
 */
export function makeCalendar(weeklyOffs: number[] | ((date: DateKey) => number[]), holidays: HolidayRow[], locationId: string | null): CalendarFn {
  const byDate = new Map<DateKey, HolidayRow>();
  for (const h of holidays) {
    if (h.type !== 'MANDATORY') continue;
    if (h.locationIds.length && (!locationId || !h.locationIds.includes(locationId))) continue;
    byDate.set(h.date, h);
  }
  const fixed = Array.isArray(weeklyOffs) ? new Set(weeklyOffs) : null;
  const offsOn = (date: DateKey) => fixed ?? new Set((weeklyOffs as (date: DateKey) => number[])(date));
  return (date: DateKey): CalendarDay => {
    const h = byDate.get(date);
    if (h) return { date, kind: 'HOLIDAY', holidayName: h.name };
    if (offsOn(date).has(dow(date))) return { date, kind: 'WEEKLY_OFF' };
    return { date, kind: 'WORKING' };
  };
}

export function countWorkingDays(calendar: CalendarFn, from: DateKey, to: DateKey): number {
  if (from > to) return 0;
  return eachDay(from, to).filter((d) => calendar(d).kind === 'WORKING').length;
}

/**
 * Working-day calendar per employee, from time-domain spine data (Shift.weeklyOffDays +
 * Holiday). Read-only Prisma reads of the time spine (ARCHITECTURE §5).
 */
@Injectable()
export class WorkCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async holidays(from: DateKey, to: DateKey): Promise<HolidayRow[]> {
    const rows = await this.prisma.holiday.findMany({ where: { date: { gte: dd(from), lte: dd(to) } }, orderBy: { date: 'asc' } });
    return rows.map((h) => ({ id: h.id, date: dk(h.date), name: h.name, type: h.type, locationIds: h.locationIds ?? [] }));
  }

  /**
   * Calendars for many employees over a window (holidays and shift assignments loaded for the
   * window ± 20 days, for sandwich lookups). Shifts resolve per date like attendance does.
   */
  async forEmployees(employeeIds: string[], from: DateKey, to: DateKey): Promise<Map<string, EmployeeCalendar>> {
    const winFrom = addDays(from, -20);
    const winTo = addDays(to, 20);
    const [emps, shifts, holidays, assignments] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, shiftId: true, workLocationId: true } }),
      // Archived shifts too: an employee or an assignment can still point at one, and attendance uses it.
      this.prisma.shift.findMany({ orderBy: { createdAt: 'asc' } }),
      this.holidays(winFrom, winTo),
      this.prisma.shiftAssignment.findMany({
        where: { employeeId: { in: employeeIds }, effectiveFrom: { lte: dd(winTo) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: dd(winFrom) } }] },
        select: { employeeId: true, shiftId: true, effectiveFrom: true, effectiveTo: true },
      }),
    ]);
    const byId = new Map<string, ShiftLite>(shifts.map((s) => [s.id, s]));
    const live = shifts.filter((s) => !s.archivedAt);
    // Same default as PolicyService.defaultShift: the live default shift, else the oldest live shift.
    const def = live.find((s) => s.isDefault) ?? live[0] ?? null;
    const out = new Map<string, EmployeeCalendar>();
    for (const e of emps) {
      const own: AssignmentLite[] = assignments
        .filter((a) => a.employeeId === e.id)
        .map((a) => ({ shiftId: a.shiftId, effectiveFrom: dk(a.effectiveFrom), effectiveTo: a.effectiveTo ? dk(a.effectiveTo) : null }));
      const shiftOn = shiftResolver(own, byId, e.shiftId, def);
      const atEnd = shiftOn(to);
      out.set(e.id, {
        employeeId: e.id,
        weeklyOffs: weeklyOffsOf(atEnd),
        shiftNetMinutes: shiftNetMinutesOf(atEnd),
        calendar: makeCalendar((date) => weeklyOffsOf(shiftOn(date)), holidays, e.workLocationId),
      });
    }
    return out;
  }

  async forEmployee(employeeId: string, from: DateKey, to: DateKey): Promise<EmployeeCalendar> {
    const m = await this.forEmployees([employeeId], from, to);
    return m.get(employeeId) ?? { employeeId, weeklyOffs: DEFAULT_WEEKLY_OFFS, shiftNetMinutes: DEFAULT_SHIFT_NET_MINUTES, calendar: makeCalendar(DEFAULT_WEEKLY_OFFS, [], null) };
  }
}
