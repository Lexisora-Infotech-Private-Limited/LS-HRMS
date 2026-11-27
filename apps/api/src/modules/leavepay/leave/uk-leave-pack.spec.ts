import { describe, expect, it } from 'vitest';
import { leaveTypePatchSchema, UK_STATUTORY_HOLIDAY_DAYS, UK_STATUTORY_PAY_BY_LEAVE } from '@lexisora/shared';
import { UK_BANK_HOLIDAYS, ukBankHolidays } from '../../time/lib/holiday-lists';
import { splitPaid } from './leave-calc';
import { isWeekdayKey, ukAnnualLeaveMessage, ukAnnualLeaveShortfall, ukLeavePack, UK_PACK_DEFAULTS } from './uk-leave-pack';

const pack = ukLeavePack();
const byCode = new Map(pack.map((t) => [t.code, t]));

describe('UK holiday & absence pack', () => {
  it('has every type, with unique 2–6 letter codes and unique names', () => {
    expect(pack.map((t) => t.code)).toEqual(['AL', 'SICK', 'MAT', 'PAT', 'SPL', 'ADOPT', 'NEO', 'BRV', 'CARER', 'UPL', 'DEP', 'JURY', 'TOIL']);
    for (const t of pack) expect(t.code).toMatch(/^[A-Z]{2,6}$/);
    expect(new Set(pack.map((t) => t.name)).size).toBe(pack.length);
  });

  it('contains every statutory-pay code payroll reads, as unpaid (salary) leave', () => {
    for (const code of Object.keys(UK_STATUTORY_PAY_BY_LEAVE)) {
      const t = byCode.get(code);
      expect(t, code).toBeDefined();
      expect(t!.isPaid).toBe(false);
      expect(t!.accrualFrequency).toBe('NONE');
    }
  });

  it('unpaid types are never blocked by a balance (52 weeks of maternity can be recorded)', () => {
    const mat = byCode.get('MAT')!;
    expect(splitPaid(260, 0, { isPaidType: mat.isPaid })).toEqual({ paid: 0, lop: 260, blocked: false });
    expect(mat.maxConsecutiveDays).toBe(52 * 5);
    expect(byCode.get('PAT')!.maxConsecutiveDays).toBe(10);
    expect(byCode.get('NEO')!.maxConsecutiveDays).toBe(60);
    expect(byCode.get('BRV')!.maxConsecutiveDays).toBe(10);
    expect(byCode.get('CARER')!.maxConsecutiveDays).toBe(5);
  });

  it('sickness: no limit, fit note after 7 calendar days (5 working days)', () => {
    const s = byCode.get('SICK')!;
    expect(s.maxConsecutiveDays).toBeNull();
    expect(s.documentRequiredAfterDays).toBe(5);
    expect(s.hidden).toBe(false);
  });

  it('annual leave: paid, yearly, default 20 days, no carry forward by default', () => {
    const al = byCode.get('AL')!;
    expect(al).toMatchObject({ isPaid: true, accrualFrequency: 'YEARLY', annualQuota: UK_PACK_DEFAULTS.annualLeaveDays, carryForwardMax: null });
    const custom = ukLeavePack({ annualLeaveDays: 25, carryForwardDays: 5 }).find((t) => t.code === 'AL')!;
    expect(custom.annualQuota).toBe(25);
    expect(custom.carryForwardMax).toBe(5);
  });

  it('default annual leave + England and Wales bank holidays meets 5.6 weeks (28 days)', () => {
    expect(UK_STATUTORY_HOLIDAY_DAYS).toBe(5.6 * 5);
    for (const year of [2026, 2027]) {
      for (const cal of ['England and Wales', 'Scotland', 'Northern Ireland'] as const) {
        const bh = ukBankHolidays(year, cal).filter((h) => isWeekdayKey(h.date)).length;
        expect(ukAnnualLeaveShortfall(UK_PACK_DEFAULTS.annualLeaveDays, bh).ok, `${cal} ${year}`).toBe(true);
      }
    }
    expect(ukBankHolidays(2026, 'England and Wales').length).toBe(8);
  });

  it('TOIL uses the comp-off mechanism', () => {
    expect(byCode.get('TOIL')).toMatchObject({ isCompOff: true, accrualFrequency: 'ON_APPROVAL', isPaid: true });
  });

  it('every definition passes the leave type edit schema (HR can edit them later)', () => {
    for (const t of pack) {
      const r = leaveTypePatchSchema.safeParse({ name: t.name, code: t.code, annualQuota: t.annualQuota, accrualFrequency: t.accrualFrequency, isPaid: t.isPaid, minNoticeDays: t.minNoticeDays, backdateLimitDays: t.backdateLimitDays, maxConsecutiveDays: t.maxConsecutiveDays, expiryDays: t.expiryDays, documentRequiredAfterDays: t.documentRequiredAfterDays, appliesTo: t.appliesTo });
      expect(r.success, `${t.code}: ${r.success ? '' : r.error.message}`).toBe(true);
    }
  });

  it('5.6-week warning', () => {
    expect(ukAnnualLeaveShortfall(20, 8)).toEqual({ totalDays: 28, shortBy: 0, ok: true });
    expect(ukAnnualLeaveShortfall(18, 8)).toEqual({ totalDays: 26, shortBy: 2, ok: false });
    expect(ukAnnualLeaveMessage(20, 8, null)).toBeNull();
    expect(ukAnnualLeaveMessage(18, 8, 'Leeds')).toContain('at least 20 days');
    expect(ukAnnualLeaveMessage(20, 0, null)).toContain('import the bank holidays');
  });

  it('weekday check used for bank holidays', () => {
    expect(isWeekdayKey('2026-12-26')).toBe(false);
    expect(isWeekdayKey('2026-12-28')).toBe(true);
    expect(UK_BANK_HOLIDAYS[2026]!.every((h) => isWeekdayKey(h.date))).toBe(true);
  });
});
