import { describe, expect, it } from 'vitest';
import {
  alertCategory,
  alertWhenLabel,
  auditChangeRows,
  auditQuerySchema,
  createRoleSchema,
  dayMonthYear,
  navMatches,
  searchTypeLabel,
  sortSearchGroups,
} from '@lexisora/shared';

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

  it('dates print "Sep" whatever the runtime ICU says, on the IST business day', () => {
    expect(dayMonthYear(ist('2026-09-29T10:12:04'))).toBe('29 Sep 2026');
    // 23:30 UTC on 28 Sep is already 29 Sep in India.
    expect(dayMonthYear('2026-09-28T23:30:00Z')).toBe('29 Sep 2026');
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
    // Spec M8 order: People, Tasks, Documents, Projects, Notices, … — other domains' types, then "Go to" last.
    const sorted = sortSearchGroups([{ type: 'goto' }, { type: 'Payslips' }, { type: 'tasks' }, { type: 'zeta' }, { type: 'projects' }, { type: 'people' }, { type: 'Notices' }]);
    expect(sorted.map((g) => g.type)).toEqual(['people', 'tasks', 'projects', 'Notices', 'Payslips', 'zeta', 'goto']);
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

  it('audit drawer lists before → after from any producer shape', () => {
    expect(auditChangeRows(null)).toEqual([]);
    expect(auditChangeRows({ summary: 'Signed in on the web' })).toEqual([]);
    expect(auditChangeRows({ from: 'Employee', to: 'Team / Project Lead' })).toEqual([{ field: 'Change', before: 'Employee', after: 'Team / Project Lead' }]);
    expect(auditChangeRows({ before: { shift: 'General', grace: 10 }, after: { shift: 'Night' } })).toEqual([
      { field: 'shift', before: 'General', after: 'Night' },
      { field: 'grace', before: '10', after: '—' },
    ]);
    expect(auditChangeRows({ changes: { status: ['PENDING', 'APPROVED'], days: { from: 1, to: 1.5 }, bankAccount: '[redacted]' } })).toEqual([
      { field: 'status', before: 'PENDING', after: 'APPROVED' },
      { field: 'days', before: '1', after: '1.5' },
      { field: 'bankAccount', before: '—', after: '[redacted]' },
    ]);
  });
});
