import { describe, expect, it } from 'vitest';
import { pickTemplateId } from './template-choice';

const available = new Set(['default', 'premium', 'intern', 'plain']);
const pick = (own: Record<string, string>, byRole: Record<string, string>, employeeId: string, role: string | null) => pickTemplateId(own, employeeId, byRole, role, available, 'default');

describe('which template a person gets', () => {
  it('uses the template chosen for that person first', () => {
    expect(pick({ e1: 'premium' }, { manager: 'plain' }, 'e1', 'manager')).toBe('premium');
  });
  it("uses their role's template when they have none of their own", () => {
    expect(pick({}, { manager: 'plain' }, 'e1', 'manager')).toBe('plain');
    expect(pick({ e2: 'premium' }, { manager: 'plain' }, 'e1', 'manager')).toBe('plain');
  });
  it('uses the company default when neither applies', () => {
    expect(pick({}, { manager: 'plain' }, 'e1', 'employee')).toBe('default');
    expect(pick({}, {}, 'e1', null)).toBe('default');
    expect(pick({}, { manager: 'plain' }, 'e1', null)).toBe('default'); // no sign-in account, so no role
  });
  it('ignores a choice that points at a template that no longer exists', () => {
    expect(pick({ e1: 'deleted' }, { manager: 'plain' }, 'e1', 'manager')).toBe('plain');
    expect(pick({ e1: 'deleted' }, { manager: 'gone' }, 'e1', 'manager')).toBe('default');
  });
});
