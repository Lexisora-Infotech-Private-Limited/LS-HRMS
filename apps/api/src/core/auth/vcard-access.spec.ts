import { describe, expect, it } from 'vitest';
import { vcardAccessSchema, vcardAllowed } from '@lexisora/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { applyVcardAccess, forgetVcardAccess } from './vcard-access';

const access = (v: unknown) => vcardAccessSchema.parse(v);
const prismaWith = (value: unknown): PrismaService => ({ raw: { setting: { findUnique: async () => (value === undefined ? null : { value }) } } }) as unknown as PrismaService;

describe('vcardAllowed', () => {
  it('covers everyone by default', () => {
    expect(vcardAllowed(access({}), { roleKey: 'employee', employeeId: 'e1' })).toBe(true);
  });
  it('limits to the chosen roles', () => {
    const a = access({ mode: 'ROLES', roles: ['hr', 'admin'] });
    expect(vcardAllowed(a, { roleKey: 'admin', employeeId: 'e1' })).toBe(true);
    expect(vcardAllowed(a, { roleKey: 'employee', employeeId: 'e2' })).toBe(false);
    expect(vcardAllowed(a, { roleKey: null, employeeId: null })).toBe(false);
  });
  it('limits to the chosen employees', () => {
    const a = access({ mode: 'EMPLOYEES', employeeIds: ['e1'] });
    expect(vcardAllowed(a, { roleKey: 'employee', employeeId: 'e1' })).toBe(true);
    expect(vcardAllowed(a, { roleKey: 'admin', employeeId: 'e2' })).toBe(false);
    expect(vcardAllowed(a, { roleKey: 'admin', employeeId: null })).toBe(false);
  });
});

describe('applyVcardAccess', () => {
  const perms = ['dashboard.view', 'vcard.self'];
  it('removes vcard.self for someone the setting leaves out', async () => {
    forgetVcardAccess('t-out');
    const out = await applyVcardAccess(prismaWith({ mode: 'ROLES', roles: ['hr'] }), 't-out', { roleKey: 'employee', employeeId: 'e1' }, perms);
    expect(out).toEqual(['dashboard.view']);
  });
  it('keeps it for someone the setting covers, and when nothing is saved', async () => {
    forgetVcardAccess('t-in');
    expect(await applyVcardAccess(prismaWith({ mode: 'ROLES', roles: ['hr'] }), 't-in', { roleKey: 'hr', employeeId: 'e1' }, perms)).toEqual(perms);
    forgetVcardAccess('t-none');
    expect(await applyVcardAccess(prismaWith(undefined), 't-none', { roleKey: 'employee', employeeId: 'e1' }, perms)).toEqual(perms);
  });
  it('does not look anything up when the role never had the permission', async () => {
    forgetVcardAccess('t-skip');
    const boom = { raw: { setting: { findUnique: async () => { throw new Error('should not be called'); } } } } as unknown as PrismaService;
    expect(await applyVcardAccess(boom, 't-skip', { roleKey: 'employee', employeeId: 'e1' }, ['dashboard.view'])).toEqual(['dashboard.view']);
  });
});
