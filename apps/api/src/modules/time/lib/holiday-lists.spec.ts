import { describe, expect, it } from 'vitest';
import { UK_HOLIDAY_CALENDARS } from '@lexisora/shared';
import { BUILTIN_HOLIDAYS, UK_BANK_HOLIDAYS, ukBankHolidays, ukCalendarLocations } from './holiday-lists';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dow = (d: string) => DOW[new Date(`${d}T00:00:00Z`).getUTCDay()];
const dates = (year: number, cal: (typeof UK_HOLIDAY_CALENDARS)[number]) => ukBankHolidays(year, cal).map((h) => h.date);

describe('UK bank holidays', () => {
  it('every bank holiday falls on a weekday (substitute days applied)', () => {
    for (const year of [2026, 2027]) {
      for (const h of UK_BANK_HOLIDAYS[year]!) {
        expect(dow(h.date), `${h.date} ${h.name}`).not.toMatch(/Sat|Sun/);
        expect(h.date.startsWith(String(year))).toBe(true);
      }
    }
  });

  it('dates are unique per nation and in order', () => {
    for (const year of [2026, 2027]) {
      for (const cal of UK_HOLIDAY_CALENDARS) {
        const d = dates(year, cal);
        expect(new Set(d).size).toBe(d.length);
        expect([...d].sort()).toEqual(d);
      }
    }
  });

  it('England and Wales 2026', () => {
    expect(dates(2026, 'England and Wales')).toEqual(['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28']);
  });

  it('Scotland 2026: 2 January, first-Monday August, St Andrew’s Day, no Easter Monday', () => {
    expect(dates(2026, 'Scotland')).toEqual(['2026-01-01', '2026-01-02', '2026-04-03', '2026-05-04', '2026-05-25', '2026-08-03', '2026-11-30', '2026-12-25', '2026-12-28']);
    expect(dow('2026-11-30')).toBe('Mon');
  });

  it('Northern Ireland 2026: St Patrick’s Day and the Boyne substitute (12 Jul is a Sunday)', () => {
    expect(dates(2026, 'Northern Ireland')).toEqual(['2026-01-01', '2026-03-17', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-07-13', '2026-08-31', '2026-12-25', '2026-12-28']);
    expect(dow('2026-07-12')).toBe('Sun');
  });

  it('2026 Boxing Day (Saturday) moves to Monday 28 December', () => {
    expect(dow('2026-12-26')).toBe('Sat');
    const boxing = UK_BANK_HOLIDAYS[2026]!.find((h) => h.name.startsWith('Boxing Day'))!;
    expect(boxing.date).toBe('2026-12-28');
    expect(boxing.name).toContain('substitute');
  });

  it('England and Wales 2027', () => {
    expect(dates(2027, 'England and Wales')).toEqual(['2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28']);
    expect(dow('2027-01-01')).toBe('Fri');
  });

  it('Scotland 2027: 2 January (Saturday) moves to Monday 4 January', () => {
    expect(dates(2027, 'Scotland')).toEqual(['2027-01-01', '2027-01-04', '2027-03-26', '2027-05-03', '2027-05-31', '2027-08-02', '2027-11-30', '2027-12-27', '2027-12-28']);
    expect(dow('2027-01-02')).toBe('Sat');
  });

  it('Northern Ireland 2027', () => {
    expect(dates(2027, 'Northern Ireland')).toEqual(['2027-01-01', '2027-03-17', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-07-12', '2027-08-30', '2027-12-27', '2027-12-28']);
  });

  it('2027 Christmas (Sat) and Boxing Day (Sun) become Mon 27 and Tue 28 December', () => {
    expect([dow('2027-12-25'), dow('2027-12-26')]).toEqual(['Sat', 'Sun']);
    expect(UK_BANK_HOLIDAYS[2027]!.filter((h) => h.date >= '2027-12-25').map((h) => [h.date, h.name])).toEqual([
      ['2027-12-27', 'Christmas Day (substitute day)'],
      ['2027-12-28', 'Boxing Day (substitute day)'],
    ]);
  });

  it('Easter dates', () => {
    const easter = (y: number) => UK_BANK_HOLIDAYS[y]!.filter((h) => /Good Friday|Easter Monday/.test(h.name)).map((h) => [h.date, dow(h.date)]);
    expect(easter(2026)).toEqual([['2026-04-03', 'Fri'], ['2026-04-06', 'Mon']]);
    expect(easter(2027)).toEqual([['2027-03-26', 'Fri'], ['2027-03-29', 'Mon']]);
  });

  it('no list for years not built in', () => {
    expect(ukBankHolidays(2030, 'Scotland')).toEqual([]);
  });

  it('India lists are unchanged', () => {
    expect(BUILTIN_HOLIDAYS[2026]!.length).toBe(18);
    expect(BUILTIN_HOLIDAYS[2027]!.length).toBe(9);
  });
});

describe('ukCalendarLocations (nation → work locations)', () => {
  const locs = [
    { id: 'lon', ukNation: 'ENG_WLS' },
    { id: 'cdf', ukNation: 'ENG_WLS' },
    { id: 'edi', ukNation: 'SCT' },
    { id: 'remote', ukNation: null },
  ];

  it('maps each calendar to the locations of its nation', () => {
    expect(ukCalendarLocations('England and Wales', locs)).toEqual({ mode: 'SOME', locationIds: ['lon', 'cdf'] });
    expect(ukCalendarLocations('Scotland', locs)).toEqual({ mode: 'SOME', locationIds: ['edi'] });
  });

  it('a nation with no location gets nothing', () => {
    expect(ukCalendarLocations('Northern Ireland', locs)).toEqual({ mode: 'NONE', locationIds: [] });
  });

  it('no nation set anywhere → every location', () => {
    expect(ukCalendarLocations('Scotland', [{ id: 'a', ukNation: null }, { id: 'b', ukNation: null }])).toEqual({ mode: 'ALL', locationIds: [] });
    expect(ukCalendarLocations('Northern Ireland', [])).toEqual({ mode: 'ALL', locationIds: [] });
  });
});
