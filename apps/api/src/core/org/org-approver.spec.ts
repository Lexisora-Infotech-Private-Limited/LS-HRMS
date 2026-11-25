import { describe, expect, it } from 'vitest';
import { canActWith, OrgService, type ChainPerson } from './org.service';

const LEAVE = ['leave.approve', 'leave.manage'] as const;
const CORRECTION = ['attendance.regularize.approve', 'attendance.manage'] as const;

const person = (id: string, managerId: string | null, permissions: string[], extra: Partial<ChainPerson> = {}): ChainPerson => ({
  id,
  fullName: id,
  status: 'ACTIVE',
  managerId,
  user: { status: 'ACTIVE', role: { permissions } },
  ...extra,
});

// The demo org: Divya → Vikram (Employee) → Arjun (Team Lead) → Neha (Manager) → Rohit (Admin).
const ORG: Record<string, ChainPerson> = {
  divya: person('divya', 'vikram', []),
  vikram: person('vikram', 'arjun', []),
  arjun: person('arjun', 'neha', ['attendance.regularize.approve']),
  neha: person('neha', 'rohit', ['leave.approve', 'attendance.regularize.approve']),
  rohit: person('rohit', null, ['leave.approve', 'leave.manage', 'attendance.regularize.approve', 'attendance.manage']),
};

function orgService(people: Record<string, ChainPerson>) {
  const prisma = { employee: { findUnique: async ({ where }: { where: { id: string } }) => people[where.id] ?? null } };
  return new OrgService(prisma as any);
}

describe('who can decide a request', () => {
  it('needs one of the permissions, or every permission', () => {
    expect(canActWith(ORG.neha!, LEAVE)).toBe(true);
    expect(canActWith(ORG.arjun!, LEAVE)).toBe(false);
    expect(canActWith(person('x', null, ['*']), LEAVE)).toBe(true);
  });

  it('not someone who left or whose account is disabled', () => {
    expect(canActWith(person('x', null, ['leave.approve'], { status: 'EXITED' }), LEAVE)).toBe(false);
    expect(canActWith(person('x', null, ['leave.approve'], { user: { status: 'DISABLED', role: { permissions: ['leave.approve'] } } }), LEAVE)).toBe(false);
    expect(canActWith(person('x', null, ['leave.approve'], { user: null }), LEAVE)).toBe(false);
  });
});

describe('approver up the reporting line', () => {
  const org = orgService(ORG);

  it('a direct manager who can approve gets it (RM)', async () => {
    expect(await org.approverUpChain('priya', 'neha', LEAVE)).toEqual({ id: 'neha', name: 'neha', direct: true });
  });

  it("skips a Team Lead who can't approve leave (Vikram → Arjun → Neha)", async () => {
    expect(await org.approverUpChain('vikram', 'arjun', LEAVE)).toEqual({ id: 'neha', name: 'neha', direct: false });
  });

  it('skips several levels (Divya → Vikram → Arjun → Neha)', async () => {
    expect(await org.approverUpChain('divya', 'vikram', LEAVE)).toMatchObject({ id: 'neha', direct: false });
  });

  it('corrections use their own permission: the Team Lead can approve those', async () => {
    expect(await org.approverUpChain('vikram', 'arjun', CORRECTION)).toEqual({ id: 'arjun', name: 'arjun', direct: true });
    expect(await org.approverUpChain('divya', 'vikram', CORRECTION)).toMatchObject({ id: 'arjun', direct: false });
  });

  it('nobody on the line → null (caller falls back to HR)', async () => {
    expect(await org.approverUpChain('rohit', null, LEAVE)).toBeNull();
    const flat = orgService({ a: person('a', 'b', []), b: person('b', null, []) });
    expect(await flat.approverUpChain('a', 'b', LEAVE)).toBeNull();
  });

  it('never picks the employee themself and survives a looped chart', async () => {
    const loop = orgService({ a: person('a', 'b', ['leave.approve']), b: person('b', 'a', []) });
    expect(await loop.approverUpChain('a', 'b', LEAVE)).toBeNull();
    expect(await org.approverUpChain('neha', 'neha', LEAVE)).toBeNull();
  });

  it('canAct reflects a role change', async () => {
    expect(await org.canAct('neha', LEAVE)).toBe(true);
    expect(await org.canAct('arjun', LEAVE)).toBe(false);
    expect(await org.canAct('nobody', LEAVE)).toBe(false);
  });
});
