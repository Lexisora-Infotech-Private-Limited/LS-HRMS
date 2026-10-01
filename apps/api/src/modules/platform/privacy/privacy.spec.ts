import { describe, expect, it } from 'vitest';
import { platformReader, restrictedCategoryOf, restrictedModels } from './privacy.guard';
import { holdersLabel, privacyRows } from './privacy.logic';

describe('Restricted data classification', () => {
  it('chats, salaries and personal documents are restricted', () => {
    expect(restrictedCategoryOf('ChatMessage')).toBe('CHAT');
    expect(restrictedCategoryOf('ChatCall')).toBe('CHAT');
    expect(restrictedCategoryOf('Payslip')).toBe('SALARY');
    expect(restrictedCategoryOf('EmployeeSalary')).toBe('SALARY');
    expect(restrictedCategoryOf('PayrollItemLine')).toBe('SALARY');
    expect(restrictedCategoryOf('SalaryComponent')).toBe('SALARY');
    expect(restrictedCategoryOf('EmployeeDocument')).toBe('PERSONAL_DOC');
    expect(restrictedCategoryOf('Employee')).toBe('PERSONAL_DOC');
    expect(restrictedCategoryOf('FileObject')).toBe('PERSONAL_DOC');
    expect(restrictedCategoryOf('Screenshot')).toBe('PERSONAL_DOC');
  });

  it('platform metadata stays readable', () => {
    for (const m of ['Tenant', 'User', 'Role', 'Subscription', 'SaasInvoice', 'SupportTicket', 'AuditLog', 'IdCardTemplate', 'Channel']) {
      expect(restrictedCategoryOf(m)).toBeNull();
    }
  });

  it('covers the models present in the schema', () => {
    const r = restrictedModels();
    expect(r.SALARY).toContain('Payslip');
    expect(r.PERSONAL_DOC).toContain('EmployeeDocument');
    expect(Object.values(r).flat()).not.toContain('Tenant');
  });
});

describe('platformReader (cross-tenant client for Lexisora staff)', () => {
  const fake = {
    tenant: { findMany: async () => [{ id: 't1' }] },
    payslip: { findMany: async () => [{ netPaise: 1 }] },
    chatMessage: { findMany: async () => [] },
    $queryRaw: async () => [{ x: 1 }],
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ employeeDocument: { findMany: async () => [] }, tenant: { count: async () => 4 } }),
  };
  const db = platformReader(fake);

  it('reads tenant metadata', async () => {
    await expect(db.tenant.findMany()).resolves.toEqual([{ id: 't1' }]);
  });

  it('refuses salary and chat tables with 403 RESTRICTED_DATA', () => {
    expect(() => db.payslip).toThrowError(/salaries or personal documents/);
    let err: any = null;
    try {
      void db.chatMessage;
    } catch (e) {
      err = e;
    }
    expect(err?.getStatus()).toBe(403);
    expect(err?.getResponse().code).toBe('RESTRICTED_DATA');
  });

  it('refuses raw SQL (it could name any table)', () => {
    expect(() => db.$queryRaw()).toThrowError(/raw SQL/);
  });

  it('wraps interactive transactions too', async () => {
    await expect(db.$transaction(async (tx: any) => tx.tenant.count())).resolves.toBe(4);
    await expect(db.$transaction(async (tx: any) => tx.employeeDocument.findMany())).rejects.toThrowError(/EmployeeDocument/);
  });
});

describe('Data privacy table', () => {
  const roles = [
    { key: 'employee', name: 'Employee', isSystem: true, permissions: ['chat.use'] },
    { key: 'hr', name: 'HR', isSystem: true, permissions: ['employees.compensation', 'payroll.manage', 'onboarding.manage'] },
    { key: 'admin', name: 'Admin / CEO', isSystem: true, permissions: ['employees.compensation', 'employees.manage', 'billing.manage'] },
    { key: 'payroll-clerk', name: 'Payroll clerk', isSystem: false, permissions: ['payroll.manage'] },
  ];

  it('“Tenant admin” is derived from the roles that hold the access today', () => {
    expect(holdersLabel(roles, ['employees.compensation', 'payroll.manage'])).toBe('HR / Admin + Payroll clerk');
    expect(holdersLabel(roles, ['onboarding.manage', 'employees.manage'])).toBe('HR / Admin');
    expect(holdersLabel(roles, ['billing.manage'])).toBe('Admin');
    expect(holdersLabel(roles, ['cctv.view'])).toBe('Nobody');
  });

  it('wireframe rows: Lexisora super-admin has no access to chats, salaries or documents', () => {
    const rows = privacyRows(roles);
    expect(rows.map((r) => r.data)).toEqual(['Chats & call recordings', 'Salaries & payslips', 'Personal documents', 'Usage & billing metrics']);
    expect(rows.slice(0, 3).every((r) => r.platformAdmin === 'No access' && r.platformTone === 'neutral')).toBe(true);
    expect(rows[3]).toMatchObject({ platformAdmin: 'Aggregated only', platformTone: 'accent' });
  });
});
