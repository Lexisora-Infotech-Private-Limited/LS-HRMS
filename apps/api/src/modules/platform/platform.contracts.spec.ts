import { describe, expect, it } from 'vitest';
import { alertCategory, alertWhenLabel, auditQuerySchema, createRoleSchema, navMatches, searchTypeLabel, sortSearchGroups } from '@lexisora/shared';

const ist = (s: string) => new Date(`${s}+05:30`);
const NOW = ist('2026-09-29T10:00:00');

describe('Alerts', () => {
  it('"When" is Today / Yesterday / d MMM in IST, with the year only for other years', () => {
    expect(alertWhenLabel(ist('2026-09-29T00:30:00'), NOW)).toBe('Today');
    expect(alertWhenLabel(ist('2026-09-28T23:59:00'), NOW)).toBe('Yesterday');
    expect(alertWhenLabel(ist('2026-09-26T16:20:00'), NOW)).toBe('26 Sep');
    // Upcoming (e.g. a birthday reminder) shows its date.
    expect(alertWhenLabel(ist('2026-09-30T00:05:00'), NOW)).toBe('30 Sep');
    expect(alertWhenLabel(ist('2025-12-31T12:00:00'), NOW)).toBe('31 Dec 2025');
  });

  it('buckets notification types into tabs', () => {
    expect(alertCategory('timesheet.approval', '/approvals')).toBe('approval');
    expect(alertCategory('regularization.requested', '/attendance')).toBe('approval');
    expect(alertCategory('people.onboardingSubmitted', '/onboarding')).toBe('approval');
    expect(alertCategory('timesheet.reminder', '/timesheets')).toBe('reminder');
    expect(alertCategory('policy.acknowledge', '/policies')).toBe('reminder');
    expect(alertCategory('birthday.reminder', '/feed')).toBe('reminder');
    expect(alertCategory('helpdesk.resolved', '/helpdesk')).toBe('info');
    expect(alertCategory('leave.decided', '/leave')).toBe('info');
  });
});

describe('Global search', () => {
  it('"Go to" matches sidebar screens the user can open', () => {
    const admin = new Set(['roles.manage', 'audit.view', 'payroll.manage', 'alerts.view']);
    expect(navMatches('roles', admin).map((n) => n.label)).toContain('Roles & access');
    expect(navMatches('roles', new Set(['alerts.view']))).toEqual([]);
    expect(navMatches('audit log', admin).map((n) => n.path)).toEqual(['/audit']);
    expect(navMatches('   ', admin)).toEqual([]);
  });

  it('orders and labels result groups', () => {
    const sorted = sortSearchGroups([{ type: 'Payslips' }, { type: 'tasks' }, { type: 'zeta' }, { type: 'people' }, { type: 'goto' }]);
    expect(sorted.map((g) => g.type)).toEqual(['goto', 'people', 'tasks', 'Payslips', 'zeta']);
    expect(searchTypeLabel('goto')).toBe('Go to');
    expect(searchTypeLabel('people')).toBe('People');
    expect(searchTypeLabel('welcome-kits')).toBe('Welcome kits');
  });
});

describe('Contracts', () => {
  it('validates the Add role form', () => {
    expect(createRoleSchema.parse({ name: '  Facility Manager ', copyFromRoleId: '' })).toEqual({ name: 'Facility Manager', copyFromRoleId: null });
    expect(createRoleSchema.safeParse({ name: 'A' }).success).toBe(false);
  });

  it('audit query defaults and validation', () => {
    const q = auditQuerySchema.parse({ module: 'rbac', result: 'denied', from: '2026-09-23' });
    expect(q).toMatchObject({ tab: 'all', page: 1, pageSize: 25, module: 'rbac', result: 'denied' });
    expect(auditQuerySchema.safeParse({ module: 'rbac; drop' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: '23-09-2026' }).success).toBe(false);
  });
});
