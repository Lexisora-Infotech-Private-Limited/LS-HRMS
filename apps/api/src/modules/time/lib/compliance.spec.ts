import { describe, expect, it } from 'vitest';
import { directionFromStatus, localToInstant, parseAttLog } from './adms';
import { complianceDelta, defaultLockUpTo, idDayFigures, lockRangeError, parseBadgeToken, pctOf } from './compliance';

describe('ID card compliance figures (spec-time G5)', () => {
  const office = ['rahul', 'sneha', 'ananya', 'rohit', 'kavya'];
  const checks = [
    { employeeId: 'rahul', wearing: true },
    { employeeId: 'sneha', wearing: true },
    { employeeId: 'vikram', wearing: false }, // checked at the desk without an office punch
    { employeeId: 'ananya', wearing: true },
  ];

  it('counts in-office as punched-in ∪ checked, wearing % over the checked population', () => {
    const f = idDayFigures(office, checks);
    expect(f.inOffice).toBe(6);
    expect(f.checked).toBe(4);
    expect(f.wearing).toBe(3);
    expect(f.wearingPct).toBe(75);
    expect(f.missing).toBe(1);
    expect(f.unchecked).toBe(2); // rohit, kavya
  });

  it('wireframe figures: 81 of 86 checked → 94%', () => {
    expect(pctOf(81, 86)).toBe(94);
    expect(pctOf(0, 0)).toBeNull();
  });

  it('empty day has zeroed figures', () => {
    expect(idDayFigures([], [])).toEqual({ inOffice: 0, checked: 0, wearing: 0, wearingPct: 0, missing: 0, unchecked: 0 });
  });

  it('month delta in percentage points ("+2% vs Aug")', () => {
    expect(complianceDelta(96, 94)).toBe(2);
    expect(complianceDelta(91, 94)).toBe(-3);
    expect(complianceDelta(96, null)).toBeNull();
  });
});

describe('badge scan → verify token', () => {
  it('reads the token from the printed verify URL', () => {
    expect(parseBadgeToken('https://hr.lexisora.com/api/v1/id-cards/verify/9f3c2a7b-11ee')).toBe('9f3c2a7b-11ee');
  });
  it('accepts vCard / scan URLs and bare tokens or employee codes', () => {
    expect(parseBadgeToken('https://x.app/vcard/scan/abc123')).toBe('abc123');
    expect(parseBadgeToken('  tok_42  ')).toBe('tok_42');
    expect(parseBadgeToken('LX-0118')).toBe('LX-0118');
  });
});

describe('period lock range (D9)', () => {
  const today = '2026-09-29';
  it('rejects future months and dates outside the month or after today', () => {
    expect(lockRangeError('2026-10', undefined, today)).toMatch(/future month/);
    expect(lockRangeError('2026-09', '2026-08-31', today)).toMatch(/chosen month/);
    expect(lockRangeError('2026-09', '2026-09-30', today)).toMatch(/haven't happened/);
    expect(lockRangeError('2026-9', undefined, today)).toBe('Choose a month');
  });
  it('accepts past months and the running month up to today', () => {
    expect(lockRangeError('2026-08', undefined, today)).toBeNull();
    expect(lockRangeError('2026-09', '2026-09-29', today)).toBeNull();
  });
  it('defaults to month end, or today for the running month', () => {
    expect(defaultLockUpTo('2026-08', '2026-08-31', today)).toBe('2026-08-31');
    expect(defaultLockUpTo('2026-09', '2026-09-30', today)).toBe('2026-09-29');
  });
});

describe('ZKTeco ADMS ATTLOG parsing', () => {
  it('parses tab-separated lines, pads seconds and skips junk', () => {
    const body = '118\t2026-09-29 09:41:07\t0\t15\t0\r\n\n131\t2026-09-29 09:48\t1\t1\nnot a line\nabc\t2026-09-29 10:00:00\t0';
    const rows = parseAttLog(body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ pin: '118', local: '2026-09-29 09:41:07', status: 0, verify: 15, workCode: '0' });
    expect(rows[1]).toMatchObject({ pin: '131', local: '2026-09-29 09:48:00', status: 1, verify: 1, workCode: null });
  });
  it('maps device status keys to directions', () => {
    expect(directionFromStatus(0)).toBe('IN');
    expect(directionFromStatus(3)).toBe('IN');
    expect(directionFromStatus(1)).toBe('OUT');
    expect(directionFromStatus(2)).toBe('OUT');
    expect(directionFromStatus(null)).toBeUndefined();
  });
  it('device-local IST time → UTC instant', () => {
    expect(localToInstant('2026-09-29 09:41:07').toISOString()).toBe('2026-09-29T04:11:07.000Z');
  });
});
