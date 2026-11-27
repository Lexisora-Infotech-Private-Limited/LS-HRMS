import { z } from 'zod';
import type { UkNation } from './region';

/**
 * UK (region GB) holiday & absence contracts: the built-in bank holiday calendars and the
 * "UK holiday & absence pack" of leave types (API: time/lib/holiday-lists.ts and
 * leavepay/leave/uk-leave-pack.ts).
 */

/** Built-in UK bank holiday calendars (one per nation group). Also the Holiday.calendar label. */
export const UK_HOLIDAY_CALENDARS = ['England and Wales', 'Scotland', 'Northern Ireland'] as const;
export type UkHolidayCalendar = (typeof UK_HOLIDAY_CALENDARS)[number];

export const UK_CALENDAR_NATION: Record<UkHolidayCalendar, UkNation> = {
  'England and Wales': 'ENG_WLS',
  Scotland: 'SCT',
  'Northern Ireland': 'NIR',
};

export function isUkHolidayCalendar(v: unknown): v is UkHolidayCalendar {
  return typeof v === 'string' && (UK_HOLIDAY_CALENDARS as readonly string[]).includes(v);
}

/** Statutory minimum holiday: 5.6 weeks; for a 5-day week that is 28 days (bank holidays may count towards it). */
export const UK_STATUTORY_HOLIDAY_WEEKS = 5.6;
export const UK_STATUTORY_HOLIDAY_DAYS = 28;
/** Most a UK company can let staff carry over by agreement: the extra 1.6 weeks (8 days for a 5-day week). */
export const UK_MAX_CARRY_FORWARD_DAYS = 8;

/** POST /leave/types/uk-pack */
export const ukLeavePackSchema = z.object({
  /** Contractual annual leave days on top of bank holidays (full-time, 5-day week). */
  annualLeaveDays: z.coerce.number().min(20, 'At least 20 days (20 + 8 bank holidays = the 28-day legal minimum)').max(60).default(20),
  /** Unused annual leave that moves to next year. */
  carryForwardDays: z.coerce.number().min(0).max(UK_MAX_CARRY_FORWARD_DAYS, `At most ${UK_MAX_CARRY_FORWARD_DAYS} days`).default(0),
});
export type UkLeavePackInput = z.input<typeof ukLeavePackSchema>;

/** Annual leave + bank holidays against the 5.6-week minimum, for full-time staff. */
export type UkAnnualLeaveCheck = {
  year: number;
  /** Quota of the AL leave type (null = no active AL type). */
  annualLeaveDays: number | null;
  /** Fewest paid (mandatory) weekday holidays any work location gets this year. */
  bankHolidays: number;
  /** Location with that fewest count (null = applies everywhere / no locations). */
  location: string | null;
  totalDays: number;
  minimumDays: number;
  ok: boolean;
  /** Warning text when below the minimum. */
  message: string | null;
};

export type UkLeavePackResult = {
  created: string[];
  skipped: { code: string; reason: string }[];
  message: string;
  check: UkAnnualLeaveCheck;
};

/** Holiday import result (UK lists also say which locations got the holidays). */
export type HolidayImportResult = { ok: boolean; count: number; skipped: number; message?: string };
