import { describe, expect, it } from 'vitest';
import { canViewLeaveAttachment, toRequestRow, type RequestWithRefs } from './leave.common';

const req = { employeeId: 'emp-priya', approverEmployeeId: 'emp-neha' };

describe('who may open a leave supporting document', () => {
  it('the employee, the approver and HR can', () => {
    expect(canViewLeaveAttachment({ employeeId: 'emp-priya', canManage: false }, req)).toBe(true);
    expect(canViewLeaveAttachment({ employeeId: 'emp-neha', canManage: false }, req)).toBe(true);
    expect(canViewLeaveAttachment({ employeeId: 'emp-kavya', canManage: true }, req)).toBe(true);
  });

  it('a notified colleague or skip-level manager cannot', () => {
    expect(canViewLeaveAttachment({ employeeId: 'emp-arjun', canManage: false }, req)).toBe(false);
    expect(canViewLeaveAttachment({ employeeId: null, canManage: false }, req)).toBe(false);
  });

  it('a request with no approver is not opened by matching a null approver', () => {
    expect(canViewLeaveAttachment({ employeeId: null, canManage: false }, { employeeId: 'emp-priya', approverEmployeeId: null })).toBe(false);
  });
});

describe('request rows only carry the file id for allowed viewers', () => {
  const row: RequestWithRefs = {
    id: 'r1',
    requestNo: 'LV-2026-00001',
    employeeId: 'emp-priya',
    leaveTypeId: 'sl',
    fromDate: new Date('2026-11-30T00:00:00Z'),
    toDate: new Date('2026-12-03T00:00:00Z'),
    halfDay: 'NONE',
    days: 4,
    lopDays: 0,
    reason: 'Fever',
    status: 'PENDING',
    approverEmployeeId: 'emp-neha',
    createdAt: new Date('2026-11-25T05:00:00Z'),
    decidedAt: null,
    decisionNote: null,
    attachmentFileId: 'file-1',
    employee: { fullName: 'Priya Sharma', empCode: 'E001', department: null },
    leaveType: { code: 'SL', name: 'Sick leave' },
  };
  const as = (employeeId: string, isHr = false) => toRequestRow(row, 'Neha Kapoor', { employeeId, isHr, today: '2026-11-25' });

  it('employee, approver and HR get the link', () => {
    expect(as('emp-priya').attachmentFileId).toBe('file-1');
    expect(as('emp-neha').attachmentFileId).toBe('file-1');
    expect(as('emp-kavya', true).attachmentFileId).toBe('file-1');
  });

  it('anyone else only sees that a document is attached', () => {
    const r = as('emp-arjun');
    expect(r.hasAttachment).toBe(true);
    expect(r.attachmentFileId).toBeNull();
  });

  it('no document → nothing to show', () => {
    const r = toRequestRow({ ...row, attachmentFileId: null }, null, { employeeId: 'emp-priya', isHr: false, today: '2026-11-25' });
    expect(r.hasAttachment).toBe(false);
    expect(r.attachmentFileId).toBeNull();
  });
});
