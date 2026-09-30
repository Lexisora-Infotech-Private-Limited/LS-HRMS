import { describe, expect, it } from 'vitest';
import type { WpAudienceRule } from '@lexisora/shared';
import { projectIdsByEmployee, resolveAudience, ruleMatches, type AudienceSubject } from './audience.rules';

/** The demo tenant in miniature: Development, QA, Design; Atlas project spans teams. */
const members = [
  { projectId: 'atlas', employeeId: 'priya' },
  { projectId: 'atlas', employeeId: 'rahul' },
  { projectId: 'atlas', employeeId: 'sneha' },
  { projectId: 'atlas', employeeId: 'vikram' },
  { projectId: 'orbit', employeeId: 'rahul' },
];
const projects = [
  { id: 'atlas', leadEmployeeId: 'arjun' },
  { id: 'orbit', leadEmployeeId: null },
];
const byEmp = projectIdsByEmployee(members, projects);
const P = (id: string, departmentId: string, extra: Partial<AudienceSubject> = {}): AudienceSubject => ({ id, departmentId, branchId: 'ahmedabad', employmentType: 'FULL_TIME', projectIds: [...(byEmp.get(id) ?? [])], ...extra });
const pop: AudienceSubject[] = [
  P('neha', 'dev'),
  P('arjun', 'dev'),
  P('priya', 'dev'),
  P('rahul', 'dev'),
  P('isha', 'dev', { employmentType: 'INTERN' }),
  P('sneha', 'qa'),
  P('karan', 'qa', { employmentType: 'INTERN' }),
  P('vikram', 'design', { branchId: 'pune' }),
  P('ananya', 'finance'),
];

describe('project membership', () => {
  it('counts members and the project lead', () => {
    expect([...(byEmp.get('arjun') ?? [])]).toEqual(['atlas']);
    expect([...(byEmp.get('rahul') ?? [])].sort()).toEqual(['atlas', 'orbit']);
    expect(byEmp.has('karan')).toBe(false);
  });
});

describe('notice audience resolution', () => {
  it('an empty rule list or ALL means everyone', () => {
    expect(resolveAudience(pop, [])).toHaveLength(pop.length);
    expect(resolveAudience(pop, [{ type: 'ALL' }])).toHaveLength(pop.length);
  });

  it('"Development · Atlas" is the union of the department and the project (lead included)', () => {
    const rules: WpAudienceRule[] = [
      { type: 'DEPARTMENT', refId: 'dev' },
      { type: 'PROJECT', refId: 'atlas' },
    ];
    expect(resolveAudience(pop, rules).sort()).toEqual(['arjun', 'isha', 'neha', 'priya', 'rahul', 'sneha', 'vikram']);
  });

  it('keeps QA-only and finance people out of a Development notice', () => {
    const rules: WpAudienceRule[] = [{ type: 'DEPARTMENT', refId: 'dev' }];
    const ids = resolveAudience(pop, rules);
    expect(ids).not.toContain('karan');
    expect(ids).not.toContain('ananya');
    expect(ruleMatches(pop.find((p) => p.id === 'sneha')!, rules)).toBe(false);
  });

  it('supports branch, employment type and single-employee rules', () => {
    expect(resolveAudience(pop, [{ type: 'BRANCH', refId: 'pune' }])).toEqual(['vikram']);
    expect(resolveAudience(pop, [{ type: 'EMPLOYMENT_TYPE', refId: 'INTERN' }])).toEqual(['isha', 'karan']);
    expect(resolveAudience(pop, [{ type: 'EMPLOYEE', refId: 'ananya' }])).toEqual(['ananya']);
  });

  it('rules without a reference match nobody (never "everyone" by accident)', () => {
    for (const type of ['DEPARTMENT', 'PROJECT', 'BRANCH', 'EMPLOYEE', 'EMPLOYMENT_TYPE'] as const) {
      expect(resolveAudience(pop, [{ type, refId: null }])).toEqual([]);
    }
  });

  it('a late joiner in Development matches the live Atlas notice', () => {
    const meera: AudienceSubject = { id: 'new', departmentId: 'dev', branchId: 'ahmedabad', employmentType: 'FULL_TIME', projectIds: [] };
    expect(ruleMatches(meera, [{ type: 'DEPARTMENT', refId: 'dev' }, { type: 'PROJECT', refId: 'atlas' }])).toBe(true);
  });
});
