import { UK_CALENDAR_NATION, type UkHolidayCalendar, type UkNation } from '@lexisora/shared';

/** Built-in national / state holiday lists for "Import national/state list" (spec-time C1). */
export type BuiltinHoliday = { date: string; name: string; type: 'MANDATORY' | 'OPTIONAL'; calendars: ('National' | 'Gujarat' | 'Maharashtra')[] };

const ALL: BuiltinHoliday['calendars'] = ['National', 'Gujarat', 'Maharashtra'];

export const BUILTIN_HOLIDAYS: Record<number, BuiltinHoliday[]> = {
  2026: [
    { date: '2026-01-14', name: 'Makar Sankranti / Uttarayan', type: 'MANDATORY', calendars: ['Gujarat'] },
    { date: '2026-01-26', name: 'Republic Day', type: 'MANDATORY', calendars: ALL },
    { date: '2026-03-04', name: 'Holi', type: 'MANDATORY', calendars: ALL },
    { date: '2026-03-19', name: 'Gudi Padwa', type: 'OPTIONAL', calendars: ['Maharashtra'] },
    { date: '2026-03-21', name: 'Id-ul-Fitr', type: 'OPTIONAL', calendars: ALL },
    { date: '2026-04-03', name: 'Good Friday', type: 'OPTIONAL', calendars: ALL },
    { date: '2026-05-01', name: 'Maharashtra / Gujarat Day', type: 'MANDATORY', calendars: ['Gujarat', 'Maharashtra'] },
    { date: '2026-08-15', name: 'Independence Day', type: 'MANDATORY', calendars: ALL },
    { date: '2026-08-28', name: 'Raksha Bandhan', type: 'OPTIONAL', calendars: ['Gujarat'] },
    { date: '2026-09-04', name: 'Janmashtami', type: 'MANDATORY', calendars: ['Gujarat'] },
    { date: '2026-09-14', name: 'Ganesh Chaturthi', type: 'MANDATORY', calendars: ['Maharashtra'] },
    { date: '2026-10-02', name: 'Gandhi Jayanti', type: 'MANDATORY', calendars: ALL },
    { date: '2026-10-20', name: 'Dussehra', type: 'MANDATORY', calendars: ALL },
    { date: '2026-11-08', name: 'Diwali', type: 'MANDATORY', calendars: ALL },
    { date: '2026-11-09', name: 'Diwali', type: 'MANDATORY', calendars: ALL },
    { date: '2026-11-10', name: 'Gujarati New Year', type: 'MANDATORY', calendars: ['Gujarat'] },
    { date: '2026-11-11', name: 'Bhai Dooj', type: 'OPTIONAL', calendars: ['Gujarat', 'Maharashtra'] },
    { date: '2026-12-25', name: 'Christmas', type: 'MANDATORY', calendars: ALL },
  ],
  2027: [
    { date: '2027-01-14', name: 'Makar Sankranti / Uttarayan', type: 'MANDATORY', calendars: ['Gujarat'] },
    { date: '2027-01-26', name: 'Republic Day', type: 'MANDATORY', calendars: ALL },
    { date: '2027-03-22', name: 'Holi', type: 'MANDATORY', calendars: ALL },
    { date: '2027-05-01', name: 'Maharashtra / Gujarat Day', type: 'MANDATORY', calendars: ['Gujarat', 'Maharashtra'] },
    { date: '2027-08-15', name: 'Independence Day', type: 'MANDATORY', calendars: ALL },
    { date: '2027-10-02', name: 'Gandhi Jayanti', type: 'MANDATORY', calendars: ALL },
    { date: '2027-10-09', name: 'Dussehra', type: 'MANDATORY', calendars: ALL },
    { date: '2027-10-29', name: 'Diwali', type: 'MANDATORY', calendars: ALL },
    { date: '2027-12-25', name: 'Christmas', type: 'MANDATORY', calendars: ALL },
  ],
};

// ── UK bank holidays (region GB) ─────────────────────────────────────────────────────

/** A UK bank holiday and the nations it applies in (GOV.UK list, substitute days included). */
export type UkBankHoliday = { date: string; name: string; nations: UkNation[] };

const UK: UkNation[] = ['ENG_WLS', 'SCT', 'NIR'];
const EW_NI: UkNation[] = ['ENG_WLS', 'NIR'];

/**
 * Official GOV.UK bank holidays. When a holiday falls on a weekend the next weekday is the
 * substitute day (the holiday is listed on that weekday only). Covered by holiday-lists.spec.ts.
 */
export const UK_BANK_HOLIDAYS: Record<number, UkBankHoliday[]> = {
  2026: [
    { date: '2026-01-01', name: "New Year's Day", nations: UK },
    { date: '2026-01-02', name: '2nd January', nations: ['SCT'] },
    { date: '2026-03-17', name: "St Patrick's Day", nations: ['NIR'] },
    { date: '2026-04-03', name: 'Good Friday', nations: UK },
    { date: '2026-04-06', name: 'Easter Monday', nations: EW_NI },
    { date: '2026-05-04', name: 'Early May bank holiday', nations: UK },
    { date: '2026-05-25', name: 'Spring bank holiday', nations: UK },
    // 12 July 2026 is a Sunday.
    { date: '2026-07-13', name: "Battle of the Boyne (Orangemen's Day) (substitute day)", nations: ['NIR'] },
    { date: '2026-08-03', name: 'Summer bank holiday', nations: ['SCT'] },
    { date: '2026-08-31', name: 'Summer bank holiday', nations: EW_NI },
    { date: '2026-11-30', name: "St Andrew's Day", nations: ['SCT'] },
    { date: '2026-12-25', name: 'Christmas Day', nations: UK },
    // 26 December 2026 is a Saturday.
    { date: '2026-12-28', name: 'Boxing Day (substitute day)', nations: UK },
  ],
  2027: [
    { date: '2027-01-01', name: "New Year's Day", nations: UK },
    // 2 January 2027 is a Saturday.
    { date: '2027-01-04', name: '2nd January (substitute day)', nations: ['SCT'] },
    { date: '2027-03-17', name: "St Patrick's Day", nations: ['NIR'] },
    { date: '2027-03-26', name: 'Good Friday', nations: UK },
    { date: '2027-03-29', name: 'Easter Monday', nations: EW_NI },
    { date: '2027-05-03', name: 'Early May bank holiday', nations: UK },
    { date: '2027-05-31', name: 'Spring bank holiday', nations: UK },
    { date: '2027-07-12', name: "Battle of the Boyne (Orangemen's Day)", nations: ['NIR'] },
    { date: '2027-08-02', name: 'Summer bank holiday', nations: ['SCT'] },
    { date: '2027-08-30', name: 'Summer bank holiday', nations: EW_NI },
    { date: '2027-11-30', name: "St Andrew's Day", nations: ['SCT'] },
    // 25 and 26 December 2027 are Saturday and Sunday.
    { date: '2027-12-27', name: 'Christmas Day (substitute day)', nations: UK },
    { date: '2027-12-28', name: 'Boxing Day (substitute day)', nations: UK },
  ],
};

/** The bank holidays of one UK calendar for a year (empty when the year is not built in). */
export function ukBankHolidays(year: number, calendar: UkHolidayCalendar): UkBankHoliday[] {
  const nation = UK_CALENDAR_NATION[calendar];
  return (UK_BANK_HOLIDAYS[year] ?? []).filter((h) => h.nations.includes(nation));
}

/**
 * Which work locations a UK calendar applies to, from each location's nation:
 * - ALL: no location has a nation yet → import for every location (locationIds = []).
 * - SOME: the locations in that nation.
 * - NONE: locations have nations, but none is in this one → nothing to import.
 */
export type UkCalendarTarget = { mode: 'ALL'; locationIds: [] } | { mode: 'SOME'; locationIds: string[] } | { mode: 'NONE'; locationIds: [] };

export function ukCalendarLocations(calendar: UkHolidayCalendar, locations: { id: string; ukNation: string | null }[]): UkCalendarTarget {
  if (!locations.some((l) => l.ukNation)) return { mode: 'ALL', locationIds: [] };
  const nation = UK_CALENDAR_NATION[calendar];
  const ids = locations.filter((l) => l.ukNation === nation).map((l) => l.id);
  return ids.length ? { mode: 'SOME', locationIds: ids } : { mode: 'NONE', locationIds: [] };
}
