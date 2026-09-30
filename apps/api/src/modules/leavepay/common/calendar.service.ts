import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type { CalendarDay, CalendarFn } from '../leave/leave-calc';
import { addDays, dd, dk, dow, eachDay, type DateKey } from './dates';

/** Default weekly offs when no shift is configured: Saturday + Sunday (matches the wireframe working-day counts). */
export const DEFAULT_WEEKLY_OFFS = [0, 6];
export const DEFAULT_SHIFT_NET_MINUTES = 480;

export type HolidayRow = { id: string; date: DateKey; name: string; type: string; locationIds: string[] };

export type EmployeeCalendar = {
  employeeId: string;
  weeklyOffs: number[];
  shiftNetMinutes: number;
  calendar: CalendarFn;
};

/** Pure: build a calendar function from weekly offs + holidays. OPTIONAL holidays stay working days. */
export function makeCalendar(weeklyOffs: number[], holidays: HolidayRow[], locationId: string | null): CalendarFn {
  const byDate = new Map<DateKey, HolidayRow>();
  for (const h of holidays) {
    if (h.type !== 'MANDATORY') continue;
    if (h.locationIds.length && (!locationId || !h.locationIds.includes(locationId))) continue;
    byDate.set(h.date, h);
  }
  const offs = new Set(weeklyOffs);
  return (date: DateKey): CalendarDay => {
    const h = byDate.get(date);
    if (h) return { date, kind: 'HOLIDAY', holidayName: h.name };
    if (offs.has(dow(date))) return { date, kind: 'WEEKLY_OFF' };
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

  /** Calendars for many employees over a window (holidays loaded for the window ± 20 days, for sandwich lookups). */
  async forEmployees(employeeIds: string[], from: DateKey, to: DateKey): Promise<Map<string, EmployeeCalendar>> {
    const [emps, shifts, holidays] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, shiftId: true, workLocationId: true } }),
      this.prisma.shift.findMany({ where: { archivedAt: null } }),
      this.holidays(addDays(from, -20), addDays(to, 20)),
    ]);
    const def = shifts.find((s) => s.isDefault) ?? shifts[0];
    const out = new Map<string, EmployeeCalendar>();
    for (const e of emps) {
      const shift = shifts.find((s) => s.id === e.shiftId) ?? def;
      const weeklyOffs = shift?.weeklyOffDays?.length ? shift.weeklyOffDays : DEFAULT_WEEKLY_OFFS;
      let net = DEFAULT_SHIFT_NET_MINUTES;
      if (shift) {
        const span = (shift.endMinute - shift.startMinute + 1440) % 1440 || 1440;
        net = Math.max(60, span - (shift.breakMinutes ?? 0));
      }
      out.set(e.id, { employeeId: e.id, weeklyOffs, shiftNetMinutes: net, calendar: makeCalendar(weeklyOffs, holidays, e.workLocationId) });
    }
    return out;
  }

  async forEmployee(employeeId: string, from: DateKey, to: DateKey): Promise<EmployeeCalendar> {
    const m = await this.forEmployees([employeeId], from, to);
    return m.get(employeeId) ?? { employeeId, weeklyOffs: DEFAULT_WEEKLY_OFFS, shiftNetMinutes: DEFAULT_SHIFT_NET_MINUTES, calendar: makeCalendar(DEFAULT_WEEKLY_OFFS, [], null) };
  }
}
