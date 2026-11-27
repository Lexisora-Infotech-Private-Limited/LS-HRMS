/**
 * UK holiday & absence pack (region GB): the leave types a UK company needs, as plain data.
 * Pure (no I/O) so it is unit tested in uk-leave-pack.spec.ts; LeaveAdminService.addUkPack
 * creates them.
 *
 * How the fields behave (see leave-calc.ts / leave-requests.service.ts):
 * - isPaid=false: every day of the request is unpaid (splitPaid → all LOP) and the balance is
 *   never checked, so a quota can never block HR recording e.g. 52 weeks of maternity leave.
 *   The statutory types (SICK, MAT, PAT, SPL, ADOPT, BRV, NEO) are unpaid as salary; payroll
 *   adds the statutory payment for those codes (UK_STATUTORY_PAY_BY_LEAVE).
 * - accrualFrequency NONE + annualQuota 0: no credit rule, nothing accrues (balance is n/a).
 * - maxConsecutiveDays counts working days (weekly offs and holidays are not counted), so the
 *   statutory week limits are weeks × 5 for the default Mon–Fri week.
 * - hidden: only HR can record it (on the employee's behalf, after the notice / evidence).
 */
import { UK_STATUTORY_HOLIDAY_DAYS, UK_STATUTORY_PAY_BY_LEAVE } from '@lexisora/shared';

export type UkLeaveTypeDef = {
  code: string;
  name: string;
  isPaid: boolean;
  accrualFrequency: 'YEARLY' | 'ON_APPROVAL' | 'NONE';
  annualQuota: number;
  carryForwardMax: number | null;
  isCompOff: boolean;
  expiryDays: number | null;
  allowHalfDay: boolean;
  minNoticeDays: number;
  noticeEnforcement: 'WARN' | 'BLOCK';
  backdateLimitDays: number;
  maxConsecutiveDays: number | null;
  documentRequiredAfterDays: number | null;
  hidden: boolean;
  appliesTo: string[];
  /** Why the settings are what they are (audit / docs). */
  note: string;
};

/** Working days in a full-time week (weekly offs default to Sat/Sun). */
export const UK_WORK_DAYS_PER_WEEK = 5;
const weeks = (n: number) => n * UK_WORK_DAYS_PER_WEEK;
const EVERYONE = ['FULL_TIME', 'INTERN', 'CONTRACT'];

/** Defaults for the request body (also the form defaults on the web). */
export const UK_PACK_DEFAULTS = { annualLeaveDays: 20, carryForwardDays: 0 } as const;

export function ukLeavePack(opts: { annualLeaveDays?: number; carryForwardDays?: number } = {}): UkLeaveTypeDef[] {
  const al = opts.annualLeaveDays ?? UK_PACK_DEFAULTS.annualLeaveDays;
  const cf = opts.carryForwardDays ?? UK_PACK_DEFAULTS.carryForwardDays;
  const unpaid = { isPaid: false, accrualFrequency: 'NONE' as const, annualQuota: 0, carryForwardMax: null, isCompOff: false, expiryDays: null, noticeEnforcement: 'WARN' as const, appliesTo: EVERYONE };
  return [
    {
      code: 'AL',
      name: 'Annual leave',
      isPaid: true,
      accrualFrequency: 'YEARLY',
      annualQuota: al,
      carryForwardMax: cf > 0 ? cf : null,
      isCompOff: false,
      expiryDays: null,
      allowHalfDay: true,
      minNoticeDays: 0,
      noticeEnforcement: 'WARN',
      backdateLimitDays: 0,
      maxConsecutiveDays: null,
      documentRequiredAfterDays: null,
      hidden: false,
      appliesTo: EVERYONE,
      note: `Contractual days on top of bank holidays: ${al} + bank holidays must reach ${UK_STATUTORY_HOLIDAY_DAYS} days (5.6 weeks). Credited on 1 January, pro-rated for joiners.`,
    },
    { ...unpaid, code: 'SICK', name: 'Sickness', allowHalfDay: true, minNoticeDays: 0, backdateLimitDays: 7, maxConsecutiveDays: null, documentRequiredAfterDays: 5, hidden: false, note: 'Statutory Sick Pay is added by payroll. Self-certified for 7 calendar days; a fit note is asked for after 5 working days (more than 7 calendar days). Can be recorded up to 7 days back.' },
    { ...unpaid, code: 'MAT', name: 'Maternity leave', allowHalfDay: false, minNoticeDays: 0, backdateLimitDays: 0, maxConsecutiveDays: weeks(52), documentRequiredAfterDays: null, hidden: true, note: 'Up to 52 weeks. Statutory Maternity Pay is added by payroll. HR records it after the MATB1.' },
    { ...unpaid, code: 'PAT', name: 'Paternity leave', allowHalfDay: false, minNoticeDays: 0, backdateLimitDays: 0, maxConsecutiveDays: weeks(2), documentRequiredAfterDays: null, hidden: true, note: 'Up to 2 weeks. Statutory Paternity Pay is added by payroll.' },
    { ...unpaid, code: 'SPL', name: 'Shared parental leave', allowHalfDay: false, minNoticeDays: 0, backdateLimitDays: 0, maxConsecutiveDays: weeks(50), documentRequiredAfterDays: null, hidden: true, note: 'Up to 50 weeks shared between parents. Statutory Shared Parental Pay is added by payroll.' },
    { ...unpaid, code: 'ADOPT', name: 'Adoption leave', allowHalfDay: false, minNoticeDays: 0, backdateLimitDays: 0, maxConsecutiveDays: weeks(52), documentRequiredAfterDays: null, hidden: true, note: 'Up to 52 weeks. Statutory Adoption Pay is added by payroll.' },
    { ...unpaid, code: 'NEO', name: 'Neonatal care leave', allowHalfDay: false, minNoticeDays: 0, backdateLimitDays: 0, maxConsecutiveDays: weeks(12), documentRequiredAfterDays: null, hidden: true, note: 'Up to 12 weeks. Statutory Neonatal Care Pay is added by payroll.' },
    { ...unpaid, code: 'BRV', name: 'Parental bereavement leave', allowHalfDay: false, minNoticeDays: 0, backdateLimitDays: 0, maxConsecutiveDays: weeks(2), documentRequiredAfterDays: null, hidden: true, note: 'Up to 2 weeks. Statutory Parental Bereavement Pay is added by payroll.' },
    { ...unpaid, code: 'CARER', name: "Carer's leave", allowHalfDay: true, minNoticeDays: 0, backdateLimitDays: 0, maxConsecutiveDays: weeks(1), documentRequiredAfterDays: null, hidden: false, note: 'Unpaid, up to 1 week a year, in half or whole days.' },
    { ...unpaid, code: 'UPL', name: 'Unpaid parental leave', allowHalfDay: false, minNoticeDays: 21, backdateLimitDays: 0, maxConsecutiveDays: weeks(4), documentRequiredAfterDays: null, hidden: true, note: "Unpaid, 18 weeks per child before age 18, at most 4 weeks a year; 21 days' notice." },
    { ...unpaid, code: 'DEP', name: 'Time off for dependants', allowHalfDay: true, minNoticeDays: 0, backdateLimitDays: 7, maxConsecutiveDays: null, documentRequiredAfterDays: null, hidden: false, note: 'Unpaid, reasonable time for emergencies; can be recorded up to 7 days back.' },
    { ...unpaid, code: 'JURY', name: 'Jury service', allowHalfDay: false, minNoticeDays: 0, backdateLimitDays: 0, maxConsecutiveDays: null, documentRequiredAfterDays: null, hidden: true, note: 'Unpaid by the company; the court pays loss of earnings. HR records it from the summons.' },
    {
      code: 'TOIL',
      name: 'Time off in lieu',
      isPaid: true,
      accrualFrequency: 'ON_APPROVAL',
      annualQuota: 0,
      carryForwardMax: null,
      isCompOff: true,
      expiryDays: 90,
      allowHalfDay: true,
      minNoticeDays: 0,
      noticeEnforcement: 'WARN',
      backdateLimitDays: 0,
      maxConsecutiveDays: null,
      documentRequiredAfterDays: null,
      hidden: false,
      appliesTo: EVERYONE,
      note: 'Uses the comp-off mechanism: extra hours on a weekly off or bank holiday earn paid time off, to be used within 90 days.',
    },
  ];
}

/** Statutory types whose days payroll pays by a statutory payment (must exist in the pack). */
export const UK_STATUTORY_LEAVE_CODES = Object.keys(UK_STATUTORY_PAY_BY_LEAVE);

/** Annual leave + paid bank holidays vs the 5.6-week (28-day) minimum for full-time staff. */
export function ukAnnualLeaveShortfall(annualLeaveDays: number, bankHolidays: number): { totalDays: number; shortBy: number; ok: boolean } {
  const totalDays = Math.round((annualLeaveDays + bankHolidays) * 100) / 100;
  const shortBy = Math.max(0, Math.round((UK_STATUTORY_HOLIDAY_DAYS - totalDays) * 100) / 100);
  return { totalDays, shortBy, ok: shortBy === 0 };
}

export function ukAnnualLeaveMessage(annualLeaveDays: number, bankHolidays: number, location: string | null): string | null {
  const s = ukAnnualLeaveShortfall(annualLeaveDays, bankHolidays);
  if (s.ok) return null;
  const where = location ? ` at ${location}` : '';
  return `Annual leave ${annualLeaveDays} days + ${bankHolidays} bank holidays${where} = ${s.totalDays} days, below the legal minimum of ${UK_STATUTORY_HOLIDAY_DAYS} days (5.6 weeks) for full-time staff. Raise annual leave to at least ${annualLeaveDays + s.shortBy} days${bankHolidays ? '' : ' or import the bank holidays'}.`;
}

/** Mon–Fri date (bank holidays on a weekly off are not an extra day off). */
export function isWeekdayKey(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
}
