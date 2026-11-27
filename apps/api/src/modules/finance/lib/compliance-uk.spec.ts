import { describe, expect, it } from 'vitest';
import { addMonthsToDate, ukComplianceCalendar, ukObligations, ukVatReturnStatus } from './compliance-uk';
import { complianceCalendar } from './compliance';

const TODAY = '2026-11-27';
const due = (form: string, period: string, opts = {}) => ukObligations(TODAY, opts).find((o) => o.form === form && o.period === period)?.dueDate;

describe('UK compliance calendar', () => {
  it('PAYE/NI payment on the 22nd, EPS by the 19th, FPS on payday (month end)', () => {
    expect(due('PAYE_PAYMENT', '2026-10')).toBe('2026-11-22');
    expect(due('PAYE_PAYMENT', '2026-12')).toBe('2027-01-22');
    expect(due('EPS', '2026-10')).toBe('2026-11-19');
    expect(due('FPS', '2026-11')).toBe('2026-11-30');
    expect(due('FPS', '2027-02')).toBe('2027-02-28');
  });
  it('VAT return + payment 1 month and 7 days after the quarter (default Mar/Jun/Sep/Dec, configurable stagger)', () => {
    expect(due('VAT_RETURN', '2026-09')).toBe('2026-11-07');
    expect(due('VAT_RETURN', '2026-12')).toBe('2027-02-07');
    expect(due('VAT_RETURN', '2026-10', { vatStaggerEndMonth: 1 })).toBe('2026-12-07');
    expect(due('VAT_RETURN', '2026-09', { vatStaggerEndMonth: 1 })).toBeUndefined();
    expect(ukObligations(TODAY, { vatRegistered: false }).some((o) => o.form === 'VAT_RETURN')).toBe(false);
  });
  it('employer year end: P60 31 May, P11D 6 July, Class 1A 22 July', () => {
    expect(due('P60', '2025/26')).toBe('2026-05-31');
    expect(due('P11D', '2025/26')).toBe('2026-07-06');
    expect(due('CLASS_1A', '2025/26')).toBe('2026-07-22');
  });
  it('corporation tax and Companies House from the year end (default 31 March)', () => {
    expect(due('CT_PAYMENT', '2026-03-31')).toBe('2027-01-01'); // 9 months + 1 day
    expect(due('CT600', '2026-03-31')).toBe('2027-03-31'); // 12 months
    expect(due('ANNUAL_ACCOUNTS', '2026-03-31')).toBe('2026-12-31'); // 9 months
    expect(due('CONFIRMATION_STATEMENT', '2026-03-31')).toBe('2026-04-14'); // review date + 14 days
  });
  it('a 31 December year end and a separate confirmation date', () => {
    const o = { yearEnd: { month: 12, day: 31 }, confirmationDate: { month: 6, day: 15 } };
    expect(due('CT_PAYMENT', '2025-12-31', o)).toBe('2026-10-01');
    expect(due('ANNUAL_ACCOUNTS', '2025-12-31', o)).toBe('2026-09-30');
    expect(due('CT600', '2025-12-31', o)).toBe('2026-12-31');
    expect(due('CONFIRMATION_STATEMENT', '2026-06-15', o)).toBe('2026-06-29');
  });
  it('month arithmetic keeps month ends', () => {
    expect(addMonthsToDate('2026-02-28', 9)).toBe('2026-11-30');
    expect(addMonthsToDate('2026-05-15', 9)).toBe('2027-02-15');
    expect(addMonthsToDate('2025-05-31', 9)).toBe('2026-02-28');
  });
  it('calendar card: overdue, due soon and filed, earliest first', () => {
    const items = ukComplianceCalendar(TODAY, { 'EPS:2026-10': { ref: null, filedOn: '2026-11-18' } }, { limit: 50 });
    const paye = items.find((i) => i.key === 'PAYE_PAYMENT:2026-10')!;
    expect(paye).toMatchObject({ status: 'OVERDUE', daysLeft: -5, label: 'PAYE & NI payment to HMRC', dueDate: '2026-11-22' });
    expect(items.find((i) => i.key === 'FPS:2026-11')).toMatchObject({ status: 'DUE_SOON', daysLeft: 3 });
    expect(items.find((i) => i.key === 'EPS:2026-10')).toMatchObject({ status: 'FILED', filedOn: '2026-11-18' });
    expect(items.find((i) => i.key === 'ANNUAL_ACCOUNTS:2026-03-31')).toMatchObject({ status: 'UPCOMING', daysLeft: 34 });
    expect(items[0]!.status).toBe('OVERDUE');
    expect(items.every((i) => !/GSTR|TDS|PF_ECR|^PT$|ITR/.test(i.form))).toBe(true);
  });
  it('VAT return register status', () => {
    expect(ukVatReturnStatus('2026-09', TODAY, {})).toMatchObject({ status: 'OVERDUE', dueDate: '2026-11-07' });
    expect(ukVatReturnStatus('2026-12', TODAY, {})).toMatchObject({ status: 'OPEN', dueDate: '2027-02-07' });
    expect(ukVatReturnStatus('2026-09', TODAY, { 'VAT_RETURN:2026-09': { ref: 'X1', filedOn: '2026-11-05' } })).toMatchObject({ status: 'FILED', ref: 'X1' });
  });
  it('the India calendar is untouched (no UK forms)', () => {
    const items = complianceCalendar(TODAY, {}, { limit: 50 });
    expect(items.some((i) => i.form === ('VAT_RETURN' as never))).toBe(false);
    expect(items.some((i) => i.form === 'GSTR3B')).toBe(true);
  });
});
