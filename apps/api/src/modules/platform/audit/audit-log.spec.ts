import { describe, expect, it } from 'vitest';
import { auditResultOf } from '@lexisora/shared';
import { actorWhere, resultWhere, summarize, tabWhere } from './audit-log.service';

describe('audit log tabs and filters', () => {
  it('actor picker: a person, System (not Lexisora staff) or the Lexisora platform', () => {
    expect(actorWhere(undefined)).toBeNull();
    expect(actorWhere('')).toBeNull();
    expect(actorWhere('cku1')).toEqual({ actorUserId: 'cku1' });
    expect(actorWhere('platform')).toEqual({ action: { startsWith: 'platform.' } });
    expect(actorWhere('system')).toEqual({ actorUserId: null, NOT: { action: { startsWith: 'platform.' } } });
  });

  it('maps tabs to action filters', () => {
    expect(tabWhere('all')).toEqual({});
    expect(tabWhere('access')).toEqual({ action: { startsWith: 'rbac.' } });
    expect(tabWhere('platform')).toEqual({ action: { startsWith: 'platform.' } });
    expect(JSON.stringify(tabWhere('security'))).toContain('auth.');
    expect(JSON.stringify(tabWhere('security'))).toContain('rbac.denied');
  });

  it('result filter mirrors the Result column', () => {
    expect(resultWhere(undefined)).toEqual({});
    expect(JSON.stringify(resultWhere('denied'))).toContain('.denied');
    expect(resultWhere('success')).toHaveProperty('NOT');
    expect(resultWhere('failure')).toHaveProperty('AND');
  });

  it('classifies results', () => {
    expect(auditResultOf('rbac.denied')).toBe('denied');
    expect(auditResultOf('punch.rejected')).toBe('denied');
    expect(auditResultOf('auth.login.failed')).toBe('failure');
    expect(auditResultOf('auth.login')).toBe('success');
    expect(auditResultOf('regularization.rejected')).toBe('success');
    expect(auditResultOf('device.pairing.rejected')).toBe('success');
  });
});

describe('audit summaries', () => {
  it('prefers the producer summary', () => {
    expect(summarize('rbac.role.created', 'Role', 'r1', { summary: 'Created role Facility Manager' })).toBe('Created role Facility Manager');
  });

  it('falls back to a readable description with scalar meta', () => {
    expect(summarize('payroll.run.finalized', 'PayrollRun', 'ckabc123456', { period: '2026-08', net: 100, nested: { a: 1 } })).toBe(
      'PayrollRun 123456 run finalized — period: 2026-08 · net: 100',
    );
    expect(summarize('device.paired', 'TrackerDevice', null, null)).toBe('TrackerDevice paired');
  });

  it('reads core sign-in events recorded without a summary', () => {
    expect(summarize('auth.login', 'User', 'u1', { client: 'web' })).toBe('Signed in on the web');
    expect(summarize('auth.login', 'User', 'u1', { client: 'mobile' })).toBe('Signed in on the mobile app');
    expect(summarize('auth.login', 'User', null, null)).toBe('Signed in');
    expect(summarize('auth.login.failed', 'User', null, { email: 'priya.sharma@lexisora.com' })).toBe('Failed sign-in attempt for priya.sharma@lexisora.com');
  });
});
