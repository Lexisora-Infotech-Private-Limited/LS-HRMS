import { describe, expect, it } from 'vitest';
import {
  ROLE_KEYS,
  ROLE_MATRIX_ROWS,
  alsoEnabledCopy,
  defaultPermissionsFor,
  groupBulkKeys,
  matrixCell,
  setAllContext,
  setRolePermissionsSchema,
  type RoleKey,
} from '@lexisora/shared';
import {
  DependencyError,
  accessChangeSummary,
  applyToggle,
  dependentsOf,
  effectivePlan,
  lockedKeys,
  planAllows,
  replacePermissions,
  requiresClosure,
  roleKeyFor,
} from './rbac.logic';

const cells = (label: string) => {
  const row = ROLE_MATRIX_ROWS.find((r) => r.label === label)!;
  return Object.fromEntries(ROLE_KEYS.map((k) => [k, matrixCell(defaultPermissionsFor(k), row)])) as Record<RoleKey, string>;
};

describe('roles matrix — fresh tenant defaults equal the wireframe (M3 acceptance 1)', () => {
  it.each([
    ['Mobile app access', { employee: 'none', lead: 'none', manager: 'none', hr: 'all', admin: 'all' }],
    ['Approve timesheets', { employee: 'none', lead: 'all', manager: 'all', hr: 'none', admin: 'all' }],
    ['View all task boards', { employee: 'none', lead: 'none', manager: 'all', hr: 'none', admin: 'all' }],
    // HR runs payroll but does not own the ledger → documented partial (half fill).
    ['Payroll & ledger', { employee: 'none', lead: 'none', manager: 'none', hr: 'some', admin: 'all' }],
    ['Publish global notices', { employee: 'none', lead: 'none', manager: 'none', hr: 'all', admin: 'all' }],
    ['Publish team notices', { employee: 'none', lead: 'all', manager: 'all', hr: 'all', admin: 'all' }],
    ['Recruitment', { employee: 'none', lead: 'all', manager: 'none', hr: 'all', admin: 'all' }],
    ['CCTV feeds', { employee: 'none', lead: 'none', manager: 'none', hr: 'none', admin: 'all' }],
  ])('%s', (label, expected) => {
    expect(cells(label)).toEqual(expected);
  });

  it('covers the 8 wireframe rows in order', () => {
    expect(ROLE_MATRIX_ROWS.map((r) => r.label)).toEqual([
      'Mobile app access',
      'Approve timesheets',
      'View all task boards',
      'Payroll & ledger',
      'Publish global notices',
      'Publish team notices',
      'Recruitment',
      'CCTV feeds',
    ]);
  });

  it('bundled rows are tri-state; alternative-level rows are on when any level is held', () => {
    const payroll = { label: 'Payroll & ledger', keys: ['payroll.manage', 'ledger.manage'] };
    expect(matrixCell([], payroll)).toBe('none');
    expect(matrixCell(['payroll.manage'], payroll)).toBe('some');
    expect(matrixCell(['payroll.manage', 'ledger.manage'], payroll)).toBe('all');
    const ts = { label: 'Approve timesheets', keys: ['timesheet.approve.l1', 'timesheet.approve.l2'] };
    expect(matrixCell(['timesheet.approve.l2'], ts)).toBe('all');
  });
});

describe('permission dependencies (M3 acceptance 4)', () => {
  it('enabling payroll adds the requires closure', () => {
    const r = applyToggle(['dashboard.view'], ['payroll.manage'], true);
    expect([...r.added].sort()).toEqual(['employees.compensation', 'employees.view', 'payroll.manage']);
    expect(r.next).toContain('dashboard.view');
    expect(alsoEnabledCopy(r.added, ['payroll.manage'])).toBe('Also enabled: People › View employee directory, People › View compensation');
  });

  it('disabling a key another enabled key needs is refused with the dependents', () => {
    const cur = applyToggle([], ['payroll.manage'], true).next;
    expect(() => applyToggle(cur, ['employees.compensation'], false)).toThrow(DependencyError);
    try {
      applyToggle(cur, ['employees.compensation'], false);
    } catch (e) {
      expect((e as DependencyError).dependents).toEqual(['payroll.manage']);
      expect((e as Error).message).toBe('View compensation is needed by Payroll run');
    }
  });

  it('cascade removes the transitive dependents too', () => {
    const cur = applyToggle([], ['payroll.manage'], true).next;
    const r = applyToggle(cur, ['employees.view'], false, true);
    expect(r.next).toEqual([]);
    expect(r.removed.sort()).toEqual(['employees.compensation', 'employees.view', 'payroll.manage']);
  });

  it('dependentsOf / requiresClosure walk the graph', () => {
    expect(dependentsOf('kudos.view', ['kudos.view', 'kudos.give', 'kudos.eotm']).sort()).toEqual(['kudos.eotm', 'kudos.give']);
    expect([...requiresClosure(['kudos.eotm'])].sort()).toEqual(['kudos.eotm', 'kudos.give', 'kudos.view']);
  });

  it('toggling is idempotent and keeps catalogue order, preserving unknown legacy keys', () => {
    const r = applyToggle(['legacy.key', 'roles.manage', 'dashboard.view'], ['dashboard.view'], true);
    expect(r.added).toEqual([]);
    expect(r.next).toEqual(['dashboard.view', 'roles.manage', 'legacy.key']);
  });
});

describe('replacePermissions (Undo)', () => {
  it('restores an exact earlier set and reports the delta', () => {
    const before = defaultPermissionsFor('hr');
    const after = applyToggle(before, ['cctv.view'], true).next;
    const r = replacePermissions(after, before);
    expect(r.removed).toEqual(['cctv.view']);
    expect(r.added).toEqual([]);
    expect(r.next).toEqual(before);
  });

  it('adds requires and keeps legacy keys', () => {
    const r = replacePermissions(['old.key'], ['lms.manage']);
    expect(r.next).toEqual(['lms.view', 'lms.manage', 'old.key']);
    expect(r.added).toEqual(['lms.view', 'lms.manage']);
  });
});

describe('plan gating (M3 acceptance 6)', () => {
  it('Free cannot enable Growth features; Growth, Enterprise and Internal can', () => {
    expect(planAllows('FREE', 'payroll.manage')).toBe(false);
    expect(planAllows('FREE', 'attendance.self')).toBe(true);
    expect(planAllows('GROWTH', 'payroll.manage')).toBe(true);
    expect(planAllows('ENTERPRISE', 'cctv.view')).toBe(true);
    expect(planAllows('INTERNAL', 'branding.manage')).toBe(true);
    expect(lockedKeys('FREE', ['payroll.manage', 'dashboard.view', 'lms.manage'])).toEqual(['payroll.manage', 'lms.manage']);
  });

  it('entitlements come from the Subscription row', () => {
    // A workspace never provisioned through billing (no row) is not plan-gated.
    expect(effectivePlan(null)).toBe('INTERNAL');
    expect(effectivePlan({ planCode: 'GROWTH', status: 'ACTIVE' })).toBe('GROWTH');
    expect(effectivePlan({ planCode: 'FREE', status: 'FREE' })).toBe('FREE');
    // Past-due / suspended keep their plan's features; a cancelled plan falls back to Free.
    expect(effectivePlan({ planCode: 'GROWTH', status: 'PAST_DUE' })).toBe('GROWTH');
    expect(effectivePlan({ planCode: 'ENTERPRISE', status: 'CANCELLED' })).toBe('FREE');
    expect(effectivePlan({ planCode: 'LEGACY_GOLD', status: 'ACTIVE' })).toBe('FREE');
  });
});

describe('per-role editor', () => {
  const items = [
    { key: 'employees.view', locked: false },
    { key: 'employees.compensation', locked: false },
    { key: 'payroll.manage', locked: true },
  ];

  it('"Turn all on" adds every unlocked key the role lacks; locked keys stay off', () => {
    expect(groupBulkKeys({ permissions: ['employees.view'], isMine: false }, items)).toEqual({ allOn: false, keys: ['employees.compensation'] });
  });

  it('"Turn all off" once every togglable key is on — a held locked key counts and can be removed', () => {
    expect(groupBulkKeys({ permissions: ['employees.view', 'employees.compensation'], isMine: false }, items)).toEqual({
      allOn: true,
      keys: ['employees.view', 'employees.compensation'],
    });
    expect(groupBulkKeys({ permissions: ['employees.view', 'employees.compensation', 'payroll.manage'], isMine: false }, items).keys).toEqual([
      'employees.view',
      'employees.compensation',
      'payroll.manage',
    ]);
  });

  it('never turns off an admin’s own Roles & access', () => {
    const admin = [{ key: 'roles.manage', locked: false }, { key: 'audit.view', locked: false }];
    expect(groupBulkKeys({ permissions: ['roles.manage', 'audit.view'], isMine: true }, admin)).toEqual({ allOn: true, keys: ['audit.view'] });
    expect(groupBulkKeys({ permissions: ['roles.manage', 'audit.view'], isMine: false }, admin).keys).toEqual(['roles.manage', 'audit.view']);
  });

  it('a group-off keeps keys other permissions need (replace adds the requires closure)', () => {
    const r = replacePermissions(['employees.view', 'employees.compensation', 'payroll.manage'], ['payroll.manage']);
    expect(r.next).toEqual(expect.arrayContaining(['employees.view', 'employees.compensation', 'payroll.manage']));
    expect(r.removed).toEqual([]);
  });

  it('labels whole-set replaces in the audit trail', () => {
    expect(setAllContext({ reason: 'group', group: 'People' })).toBe('group “People”');
    expect(setAllContext({ reason: 'undo' })).toBe('undo');
    expect(setAllContext({})).toBe('undo');
    expect(setRolePermissionsSchema.parse({ permissions: ['cctv.view'] })).toEqual({ permissions: ['cctv.view'] });
    expect(() => setRolePermissionsSchema.parse({ permissions: ['cctv.view'], reason: 'bulk' })).toThrow();
  });
});

describe('role keys and copy', () => {
  it('slugs names and suffixes collisions', () => {
    expect(roleKeyFor('Facility Manager', [])).toBe('facility-manager');
    expect(roleKeyFor('Facility Manager', ['facility-manager'])).toBe('facility-manager-2');
    expect(roleKeyFor('Admin', ['admin', 'admin-2'])).toBe('admin-3');
    expect(roleKeyFor('!!!', [])).toBe('role');
  });

  it('summarises access changes for the alert', () => {
    expect(accessChangeSummary(['timesheet.approve.l1'], [])).toBe('+Approve timesheets (Level 1 · Project Lead)');
    expect(accessChangeSummary(['cctv.view', 'feed.publish', 'quotes.manage'], ['mobile.access', 'lms.view'])).toBe(
      '+CCTV feeds, +Publish feed posts, +Manage thought of the day, −Mobile app access and 1 more',
    );
  });
});
