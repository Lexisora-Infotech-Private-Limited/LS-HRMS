import { describe, expect, it } from 'vitest';
import { createTenantSchema } from '@lexisora/shared';
import { renewalLabel } from '../platform.util';
import { initialQuantity, nameFromEmail, seatsFigure, slugProblem, tenantInTab, tenantPlanCode, tenantStatusOf } from './tenants.logic';

const ist = (s: string) => new Date(`${s}+05:30`);

describe('Tenants table (wireframe rows)', () => {
  const now = ist('2026-09-29T12:00:00');

  it('Lexisora Infotech: the operator shows as Internal · Active, seats = users, no renewal', () => {
    const sub = { planCode: 'GROWTH', status: 'ACTIVE', cycle: 'YEARLY', quantity: 50 };
    expect(tenantPlanCode(sub, true)).toBe('INTERNAL');
    expect(tenantStatusOf('ACTIVE', sub, true)).toEqual({ status: 'Active', tone: 'accent' });
    expect(seatsFigure('INTERNAL', 128, 50)).toBe('128');
  });

  it('Acme Logistics: Growth · yearly · 240 · Mar 2027 · Active', () => {
    const sub = { planCode: 'GROWTH', status: 'ACTIVE', cycle: 'YEARLY', quantity: 240 };
    expect(tenantPlanCode(sub, false)).toBe('GROWTH');
    expect(seatsFigure('GROWTH', 212, 240)).toBe('240');
    expect(renewalLabel(ist('2027-03-14T23:59:59'), now)).toBe('Mar 2027');
    expect(tenantStatusOf('ACTIVE', sub, false)).toEqual({ status: 'Active', tone: 'accent' });
  });

  it('Bluepeak Studio: Free · 9 · Free tier', () => {
    const sub = { planCode: 'FREE', status: 'FREE', cycle: null, quantity: 10 };
    expect(seatsFigure('FREE', 9, 10)).toBe('9');
    expect(tenantStatusOf('FREE_TIER', sub, false)).toEqual({ status: 'Free tier', tone: 'neutral' });
    expect(tenantStatusOf('ACTIVE', null, false).status).toBe('Free tier');
  });

  it('Nova Clinics: Growth · monthly · 62 · 12 Oct · Payment due', () => {
    const sub = { planCode: 'GROWTH', status: 'PAST_DUE', cycle: 'MONTHLY', quantity: 62 };
    expect(renewalLabel(ist('2026-10-12T00:00:00'), now)).toBe('12 Oct');
    expect(tenantStatusOf('PAYMENT_DUE', sub, false)).toEqual({ status: 'Payment due', tone: 'outline' });
  });

  it('read-only and suspended states; suspension wins', () => {
    expect(tenantStatusOf('ACTIVE', { planCode: 'GROWTH', status: 'READ_ONLY', quantity: 20 }, false).status).toBe('Read-only');
    expect(tenantStatusOf('SUSPENDED', { planCode: 'GROWTH', status: 'PAST_DUE', quantity: 20 }, false)).toEqual({ status: 'Suspended', tone: 'neutral' });
  });

  it('tabs: Paid, Free, Attention', () => {
    expect(tenantInTab({ planCode: 'GROWTH', status: 'Active' }, 'paid')).toBe(true);
    expect(tenantInTab({ planCode: 'INTERNAL', status: 'Active' }, 'paid')).toBe(false);
    expect(tenantInTab({ planCode: 'FREE', status: 'Free tier' }, 'free')).toBe(true);
    expect(tenantInTab({ planCode: 'GROWTH', status: 'Payment due' }, 'attention')).toBe(true);
    expect(tenantInTab({ planCode: 'GROWTH', status: 'Active' }, 'attention')).toBe(false);
    expect(tenantInTab({ planCode: 'FREE', status: 'Free tier' }, 'all')).toBe(true);
  });
});

describe('Add tenant', () => {
  it('normalises the login domain to a workspace slug', () => {
    const v = createTenantSchema.parse({ company: 'Nova Clinics', domain: 'Nova.hrms.app', planCode: 'FREE', adminEmail: 'Kiran.Rao@NovaClinics.in' });
    expect(v.domain).toBe('nova');
    expect(v.adminEmail).toBe('kiran.rao@novaclinics.in');
    expect(createTenantSchema.safeParse({ company: 'X Co', domain: 'bad domain', planCode: 'FREE', adminEmail: 'a@b.co' }).success).toBe(false);
  });

  it('paid plans need more than the 10 free seats', () => {
    expect(createTenantSchema.safeParse({ company: 'Acme', domain: 'acme2', planCode: 'GROWTH', seats: 10, adminEmail: 'a@b.co' }).success).toBe(false);
    expect(createTenantSchema.safeParse({ company: 'Acme', domain: 'acme2', planCode: 'GROWTH', seats: 250, cycle: 'YEARLY', stateCode: '27', adminEmail: 'a@b.co' }).success).toBe(true);
    expect(initialQuantity('FREE', 400)).toBe(10);
    expect(initialQuantity('GROWTH', 250)).toBe(250);
  });

  it('reserved and malformed slugs are refused', () => {
    expect(slugProblem('nova')).toBeNull();
    expect(slugProblem('api')).toContain('reserved');
    expect(slugProblem('ab')).toBe('Use at least 3 characters');
    expect(slugProblem('-x-')).toContain('letters');
  });

  it('admin name falls back to the email', () => {
    expect(nameFromEmail('kiran.rao@novaclinics.in')).toBe('Kiran Rao');
    expect(nameFromEmail('admin@acme.com')).toBe('Admin');
  });
});
