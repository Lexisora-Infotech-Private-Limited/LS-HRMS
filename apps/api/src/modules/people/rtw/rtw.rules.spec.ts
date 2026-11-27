import { describe, expect, it } from 'vitest';
import { formatShareCode, normaliseShareCode, rtwCheckSchema } from '@lexisora/shared';
import { daysFrom, defaultFollowUp, missingCheckBeforeStart, rtwReminder, rtwStatus, rtwWarnings, validateRtwCheck } from './rtw.rules';

const today = '2026-11-27';

describe('right to work · status', () => {
  it('is MISSING without a check', () => {
    expect(rtwStatus(null, today)).toEqual({ status: 'MISSING', daysToFollowUp: null });
  });

  it('is CURRENT for an unlimited right with no re-check date', () => {
    expect(rtwStatus({ result: 'UNLIMITED', permissionExpiresOn: null, followUpOn: null }, today).status).toBe('CURRENT');
  });

  it('is NO_RIGHT when the check found no right to work', () => {
    expect(rtwStatus({ result: 'NO_RIGHT', permissionExpiresOn: null, followUpOn: null }, today).status).toBe('NO_RIGHT');
  });

  it('time-limited: CURRENT when the permission ends more than 60 days away', () => {
    const s = rtwStatus({ result: 'TIME_LIMITED', permissionExpiresOn: '2027-06-30', followUpOn: null }, today);
    expect(s.status).toBe('CURRENT');
    expect(s.daysToFollowUp).toBe(daysFrom(today, '2027-06-30'));
  });

  it('time-limited: FOLLOW_UP_DUE within 60 days (inclusive) of the re-check date', () => {
    expect(rtwStatus({ result: 'TIME_LIMITED', permissionExpiresOn: '2027-01-26', followUpOn: null }, today)).toEqual({ status: 'FOLLOW_UP_DUE', daysToFollowUp: 60 });
    expect(rtwStatus({ result: 'TIME_LIMITED', permissionExpiresOn: '2027-01-27', followUpOn: null }, today).status).toBe('CURRENT');
    expect(rtwStatus({ result: 'TIME_LIMITED', permissionExpiresOn: today, followUpOn: null }, today).status).toBe('FOLLOW_UP_DUE');
  });

  it('uses an explicit re-check date before the expiry', () => {
    expect(rtwStatus({ result: 'TIME_LIMITED', permissionExpiresOn: '2028-01-01', followUpOn: '2026-12-15' }, today).status).toBe('FOLLOW_UP_DUE');
  });

  it('time-limited: EXPIRED once the permission end date has passed', () => {
    expect(rtwStatus({ result: 'TIME_LIMITED', permissionExpiresOn: '2026-11-26', followUpOn: null }, today).status).toBe('EXPIRED');
  });

  it('unlimited with an explicit re-check date inside 60 days is due', () => {
    expect(rtwStatus({ result: 'UNLIMITED', permissionExpiresOn: null, followUpOn: '2026-12-01' }, today).status).toBe('FOLLOW_UP_DUE');
  });
});

describe('right to work · follow-up default', () => {
  it('defaults to the permission end date for time-limited permission', () => {
    expect(defaultFollowUp('TIME_LIMITED', '2027-03-31')).toBe('2027-03-31');
    expect(defaultFollowUp('TIME_LIMITED', '2027-03-31', '2027-02-01')).toBe('2027-02-01');
  });
  it('has none for unlimited or no right', () => {
    expect(defaultFollowUp('UNLIMITED', null)).toBeNull();
    expect(defaultFollowUp('NO_RIGHT', '2027-03-31', '2027-01-01')).toBeNull();
  });
});

describe('right to work · validation', () => {
  const base = { method: 'SHARE_CODE' as const, documentType: 'eVisa', shareCode: 'W4K 7RT 2PQ', result: 'TIME_LIMITED' as const, permissionExpiresOn: '2028-01-01', checkedOn: '2026-11-20' };

  it('accepts a valid online check', () => {
    expect(validateRtwCheck(base, today)).toBeNull();
  });
  it('needs a 9-character share code for an online check', () => {
    expect(validateRtwCheck({ ...base, shareCode: '' }, today)).toMatch(/share code/);
    expect(validateRtwCheck({ ...base, shareCode: 'W4K7RT2' }, today)).toMatch(/9 letters/);
  });
  it('needs an end date for time-limited permission', () => {
    expect(validateRtwCheck({ ...base, permissionExpiresOn: null }, today)).toMatch(/permission ends/);
  });
  it('rejects a future check date and an end date before the check', () => {
    expect(validateRtwCheck({ ...base, checkedOn: '2026-11-28' }, today)).toMatch(/future/);
    expect(validateRtwCheck({ ...base, permissionExpiresOn: '2026-11-01' }, today)).toMatch(/before the check/);
  });
  it('share codes are stored without spaces and shown in groups of three', () => {
    expect(normaliseShareCode('w4k 7rt-2pq')).toBe('W4K7RT2PQ');
    expect(formatShareCode('W4K7RT2PQ')).toBe('W4K 7RT 2PQ');
  });
  it('zod schema: share code format, time-limited expiry', () => {
    const ok = rtwCheckSchema.safeParse({ employeeId: 'e1', ...base });
    expect(ok.success && ok.data.shareCode).toBe('W4K7RT2PQ');
    expect(rtwCheckSchema.safeParse({ employeeId: 'e1', ...base, shareCode: 'ABC' }).success).toBe(false);
    expect(rtwCheckSchema.safeParse({ employeeId: 'e1', ...base, permissionExpiresOn: null }).success).toBe(false);
    expect(rtwCheckSchema.safeParse({ employeeId: 'e1', method: 'MANUAL', documentType: 'British passport', result: 'UNLIMITED', checkedOn: '2026-11-20' }).success).toBe(true);
  });
});

describe('right to work · warnings', () => {
  it('warns when a manual check is after the start date', () => {
    const w = rtwWarnings({ method: 'MANUAL', documentType: 'British passport', result: 'UNLIMITED', checkedOn: '2026-11-10' }, '2026-11-02');
    expect(w.join(' ')).toMatch(/on or before the first day/);
  });
  it('no warning when checked on the start date', () => {
    expect(rtwWarnings({ method: 'MANUAL', documentType: 'British passport', result: 'UNLIMITED', checkedOn: '2026-11-02' }, '2026-11-02')).toEqual([]);
  });
  it('flags IDSP for non-passports and manual checks of eVisas', () => {
    expect(rtwWarnings({ method: 'IDSP', documentType: 'eVisa', result: 'UNLIMITED', checkedOn: today }, null).join(' ')).toMatch(/IDSP/);
    expect(rtwWarnings({ method: 'MANUAL', documentType: 'eVisa', result: 'TIME_LIMITED', checkedOn: today }, null).join(' ')).toMatch(/share code/);
  });
});

describe('right to work · reminders', () => {
  it('reminds 60, 30 and 7 days before the re-check date only', () => {
    const at = (d: string) => rtwReminder({ result: 'TIME_LIMITED', permissionExpiresOn: d, followUpOn: null }, today);
    expect(at('2027-01-26')).toEqual({ kind: 'DUE', days: 60 });
    expect(at('2026-12-27')).toEqual({ kind: 'DUE', days: 30 });
    expect(at('2026-12-04')).toEqual({ kind: 'DUE', days: 7 });
    expect(at('2026-12-05')).toBeNull();
  });
  it('alerts the day after a permission ends', () => {
    expect(rtwReminder({ result: 'TIME_LIMITED', permissionExpiresOn: '2026-11-26', followUpOn: null }, today)).toEqual({ kind: 'EXPIRED' });
    expect(rtwReminder({ result: 'TIME_LIMITED', permissionExpiresOn: '2026-11-20', followUpOn: null }, today)).toBeNull();
  });
  it('no reminders for unlimited without a re-check date', () => {
    expect(rtwReminder({ result: 'UNLIMITED', permissionExpiresOn: null, followUpOn: null }, today)).toBeNull();
  });
  it('joiners starting within 3 days with no check', () => {
    expect(missingCheckBeforeStart('2026-11-30', today, false)).toBe(true);
    expect(missingCheckBeforeStart(today, today, false)).toBe(true);
    expect(missingCheckBeforeStart('2026-12-01', today, false)).toBe(false);
    expect(missingCheckBeforeStart('2026-11-29', today, true)).toBe(false);
    expect(missingCheckBeforeStart('2026-11-20', today, false)).toBe(false);
  });
});
