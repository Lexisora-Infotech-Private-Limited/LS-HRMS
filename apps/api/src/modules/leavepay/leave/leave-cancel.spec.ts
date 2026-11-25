import { describe, expect, it } from 'vitest';
import { payrollClosedLabel, toRequestRow, type RequestWithRefs } from './leave.common';

const TODAY = '2026-11-25';

/** Approved leave of Vikram (approver Arjun); Kavya is HR. */
const leave = (from: string, to = from, extra: Partial<RequestWithRefs> = {}): RequestWithRefs => ({
  id: 'r1',
  requestNo: 'LV-2026-00012',
  employeeId: 'emp-vikram',
  leaveTypeId: 'cl',
  fromDate: new Date(`${from}T00:00:00Z`),
  toDate: new Date(`${to}T00:00:00Z`),
  halfDay: 'NONE',
  days: 2,
  lopDays: 0,
  reason: null,
  status: 'APPROVED',
  approverEmployeeId: 'emp-arjun',
  createdAt: new Date('2026-09-01T05:00:00Z'),
  decidedAt: new Date('2026-09-02T05:00:00Z'),
  decisionNote: null,
  employee: { fullName: 'Vikram Joshi', empCode: 'E006', department: null },
  leaveType: { code: 'CL', name: 'Casual leave' },
  ...extra,
});

const as = (r: RequestWithRefs, employeeId: string, isHr = false, closed: string | null = null) => toRequestRow(r, 'Arjun Mehta', { employeeId, isHr, today: TODAY }, closed).can;

describe('cancelling approved leave', () => {
  const SEP_PAID = 'September 2026 payroll is paid';

  it('nobody can cancel leave once its payroll month is finalized or paid', () => {
    const r = leave('2026-09-10', '2026-09-11');
    expect(as(r, 'emp-kavya', true, SEP_PAID)).toMatchObject({ cancel: false, requestCancel: false });
    expect(as(r, 'emp-vikram', false, SEP_PAID)).toMatchObject({ cancel: false, requestCancel: false });
    expect(toRequestRow(r, null, { employeeId: 'emp-kavya', isHr: true, today: TODAY }, SEP_PAID).payrollClosed).toBe(SEP_PAID);
  });

  it('HR still cancels someone else\'s leave directly while payroll is open', () => {
    expect(as(leave('2026-11-10'), 'emp-kavya', true)).toMatchObject({ cancel: true, requestCancel: false });
  });

  it('HR\'s own started leave goes to their approver, like everyone else\'s', () => {
    const own = leave('2026-11-10', '2026-11-10', { employeeId: 'emp-kavya', approverEmployeeId: 'emp-rohit' });
    expect(as(own, 'emp-kavya', true)).toMatchObject({ cancel: false, requestCancel: true });
  });

  it('own future leave is cancelled directly, for HR and employees alike', () => {
    expect(as(leave('2026-12-10'), 'emp-vikram')).toMatchObject({ cancel: true, requestCancel: false });
    const hrOwn = leave('2026-12-10', '2026-12-10', { employeeId: 'emp-kavya', approverEmployeeId: 'emp-rohit' });
    expect(as(hrOwn, 'emp-kavya', true)).toMatchObject({ cancel: true, requestCancel: false });
  });

  it('an employee asks to cancel started leave', () => {
    expect(as(leave('2026-11-10'), 'emp-vikram')).toMatchObject({ cancel: false, requestCancel: true });
  });

  it('labels the closed run by its month', () => {
    expect(payrollClosedLabel({ periodStart: new Date('2026-09-01T00:00:00Z'), status: 'PAID' })).toBe(SEP_PAID);
    expect(payrollClosedLabel({ periodStart: new Date('2026-10-01T00:00:00Z'), status: 'FINALIZED' })).toBe('October 2026 payroll is finalized');
  });
});
