import { afterEach, describe, expect, it } from 'vitest';
import { formatINR, istDateKey, navFor, regionText, setRegionResolver, ukText, zonedInstant } from '@lexisora/shared';

afterEach(() => setRegionResolver(() => 'IN'));

describe('region wording', () => {
  it('India text never changes', () => {
    setRegionResolver(() => 'IN');
    for (const t of ['Shifts', 'Punch in', 'Not punched in', 'Appraisals', 'Annual CTC (₹)', 'LOP days', 'GST invoices']) expect(regionText(t)).toBe(t);
  });
  it('UK wording inside longer text', () => {
    setRegionResolver(() => 'GB');
    expect(regionText('Shifts')).toBe('Rotas');
    expect(regionText('Punch in')).toBe('Clock in');
    expect(regionText('Punch out where you punched in.')).toBe('Clock out where you clocked in.');
    expect(regionText('Not punched in')).toBe('Not clocked in');
    expect(regionText('Shift master and employee shift allocation.')).toBe('Shift patterns and employee rota allocation.');
    expect(regionText('Appraisals')).toBe('Performance reviews');
    expect(regionText('Annual CTC')).toBe('Annual salary');
    expect(regionText('LOP days')).toBe('Unpaid days');
    expect(regionText('Visiting card designer')).toBe('Business card designer');
    expect(ukText('Allocate shift')).toBe('Allocate shift');
    expect(ukText('shifted')).toBe('shifted');
  });
  it('sidebar labels follow the region', () => {
    const granted = new Set(['shifts.manage', 'rtw.manage', 'employees.view']);
    const uk = navFor(granted, 'GB').flatMap((g) => g.items.map((i) => i.label));
    expect(uk).toContain('Rotas');
    expect(uk).toContain('Right to work');
    const ind = navFor(granted, 'IN').flatMap((g) => g.items.map((i) => i.label));
    expect(ind).toContain('Shifts');
    expect(ind).not.toContain('Right to work');
  });
});

describe('region money and time', () => {
  it('India money is unchanged; UK prints pounds', () => {
    setRegionResolver(() => 'IN');
    expect(formatINR(10_288_000)).toBe('₹ 1,02,880');
    setRegionResolver(() => 'GB');
    expect(formatINR(10_288_000)).toBe('£102,880');
    expect(formatINR(299_934)).toBe('£2,999.34');
  });
  it('business day and DST in London', () => {
    setRegionResolver(() => 'GB');
    // 23:30 UTC on 30 June is 00:30 on 1 July in London (BST).
    expect(istDateKey(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
    expect(zonedInstant('2026-07-01', 9 * 60).toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedInstant('2026-12-01', 9 * 60).toISOString()).toBe('2026-12-01T09:00:00.000Z');
    setRegionResolver(() => 'IN');
    expect(istDateKey(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
    expect(istDateKey(new Date('2026-06-30T17:00:00Z'))).toBe('2026-06-30');
  });
});
