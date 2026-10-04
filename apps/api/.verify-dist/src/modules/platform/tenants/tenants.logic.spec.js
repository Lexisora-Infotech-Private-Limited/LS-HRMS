"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const _platformutil = require("../platform.util");
const _tenantslogic = require("./tenants.logic");
const ist = (s)=>new Date(`${s}+05:30`);
(0, _vitest.describe)('Tenants table (wireframe rows)', ()=>{
    const now = ist('2026-09-29T12:00:00');
    (0, _vitest.it)('Lexisora Infotech: the operator shows as Internal · Active, seats = users, no renewal', ()=>{
        const sub = {
            planCode: 'GROWTH',
            status: 'ACTIVE',
            cycle: 'YEARLY',
            quantity: 50
        };
        (0, _vitest.expect)((0, _tenantslogic.tenantPlanCode)(sub, true)).toBe('INTERNAL');
        (0, _vitest.expect)((0, _tenantslogic.tenantStatusOf)('ACTIVE', sub, true)).toEqual({
            status: 'Active',
            tone: 'accent'
        });
        (0, _vitest.expect)((0, _tenantslogic.seatsFigure)('INTERNAL', 128, 50)).toBe('128');
    });
    (0, _vitest.it)('Acme Logistics: Growth · yearly · 240 · Mar 2027 · Active', ()=>{
        const sub = {
            planCode: 'GROWTH',
            status: 'ACTIVE',
            cycle: 'YEARLY',
            quantity: 240
        };
        (0, _vitest.expect)((0, _tenantslogic.tenantPlanCode)(sub, false)).toBe('GROWTH');
        (0, _vitest.expect)((0, _tenantslogic.seatsFigure)('GROWTH', 212, 240)).toBe('240');
        (0, _vitest.expect)((0, _platformutil.renewalLabel)(ist('2027-03-14T23:59:59'), now)).toBe('Mar 2027');
        (0, _vitest.expect)((0, _tenantslogic.tenantStatusOf)('ACTIVE', sub, false)).toEqual({
            status: 'Active',
            tone: 'accent'
        });
    });
    (0, _vitest.it)('Bluepeak Studio: Free · 9 · Free tier', ()=>{
        const sub = {
            planCode: 'FREE',
            status: 'FREE',
            cycle: null,
            quantity: 10
        };
        (0, _vitest.expect)((0, _tenantslogic.seatsFigure)('FREE', 9, 10)).toBe('9');
        (0, _vitest.expect)((0, _tenantslogic.tenantStatusOf)('FREE_TIER', sub, false)).toEqual({
            status: 'Free tier',
            tone: 'neutral'
        });
        (0, _vitest.expect)((0, _tenantslogic.tenantStatusOf)('ACTIVE', null, false).status).toBe('Free tier');
    });
    (0, _vitest.it)('Nova Clinics: Growth · monthly · 62 · 12 Oct · Payment due', ()=>{
        const sub = {
            planCode: 'GROWTH',
            status: 'PAST_DUE',
            cycle: 'MONTHLY',
            quantity: 62
        };
        (0, _vitest.expect)((0, _platformutil.renewalLabel)(ist('2026-10-12T00:00:00'), now)).toBe('12 Oct');
        (0, _vitest.expect)((0, _tenantslogic.tenantStatusOf)('PAYMENT_DUE', sub, false)).toEqual({
            status: 'Payment due',
            tone: 'outline'
        });
    });
    (0, _vitest.it)('read-only and suspended states; suspension wins', ()=>{
        (0, _vitest.expect)((0, _tenantslogic.tenantStatusOf)('ACTIVE', {
            planCode: 'GROWTH',
            status: 'READ_ONLY',
            quantity: 20
        }, false).status).toBe('Read-only');
        (0, _vitest.expect)((0, _tenantslogic.tenantStatusOf)('SUSPENDED', {
            planCode: 'GROWTH',
            status: 'PAST_DUE',
            quantity: 20
        }, false)).toEqual({
            status: 'Suspended',
            tone: 'neutral'
        });
    });
    (0, _vitest.it)('tabs: Paid, Free, Attention', ()=>{
        (0, _vitest.expect)((0, _tenantslogic.tenantInTab)({
            planCode: 'GROWTH',
            status: 'Active'
        }, 'paid')).toBe(true);
        (0, _vitest.expect)((0, _tenantslogic.tenantInTab)({
            planCode: 'INTERNAL',
            status: 'Active'
        }, 'paid')).toBe(false);
        (0, _vitest.expect)((0, _tenantslogic.tenantInTab)({
            planCode: 'FREE',
            status: 'Free tier'
        }, 'free')).toBe(true);
        (0, _vitest.expect)((0, _tenantslogic.tenantInTab)({
            planCode: 'GROWTH',
            status: 'Payment due'
        }, 'attention')).toBe(true);
        (0, _vitest.expect)((0, _tenantslogic.tenantInTab)({
            planCode: 'GROWTH',
            status: 'Active'
        }, 'attention')).toBe(false);
        (0, _vitest.expect)((0, _tenantslogic.tenantInTab)({
            planCode: 'FREE',
            status: 'Free tier'
        }, 'all')).toBe(true);
    });
});
(0, _vitest.describe)('Add tenant', ()=>{
    (0, _vitest.it)('normalises the login domain to a workspace slug', ()=>{
        const v = _shared.createTenantSchema.parse({
            company: 'Nova Clinics',
            domain: 'Nova.hrms.app',
            planCode: 'FREE',
            adminEmail: 'Kiran.Rao@NovaClinics.in'
        });
        (0, _vitest.expect)(v.domain).toBe('nova');
        (0, _vitest.expect)(v.adminEmail).toBe('kiran.rao@novaclinics.in');
        (0, _vitest.expect)(_shared.createTenantSchema.safeParse({
            company: 'X Co',
            domain: 'bad domain',
            planCode: 'FREE',
            adminEmail: 'a@b.co'
        }).success).toBe(false);
    });
    (0, _vitest.it)('paid plans need more than the 10 free seats', ()=>{
        (0, _vitest.expect)(_shared.createTenantSchema.safeParse({
            company: 'Acme',
            domain: 'acme2',
            planCode: 'GROWTH',
            seats: 10,
            adminEmail: 'a@b.co'
        }).success).toBe(false);
        (0, _vitest.expect)(_shared.createTenantSchema.safeParse({
            company: 'Acme',
            domain: 'acme2',
            planCode: 'GROWTH',
            seats: 250,
            cycle: 'YEARLY',
            stateCode: '27',
            adminEmail: 'a@b.co'
        }).success).toBe(true);
        (0, _vitest.expect)((0, _tenantslogic.initialQuantity)('FREE', 400)).toBe(10);
        (0, _vitest.expect)((0, _tenantslogic.initialQuantity)('GROWTH', 250)).toBe(250);
    });
    (0, _vitest.it)('reserved and malformed slugs are refused', ()=>{
        (0, _vitest.expect)((0, _tenantslogic.slugProblem)('nova')).toBeNull();
        (0, _vitest.expect)((0, _tenantslogic.slugProblem)('api')).toContain('reserved');
        (0, _vitest.expect)((0, _tenantslogic.slugProblem)('ab')).toBe('Use at least 3 characters');
        (0, _vitest.expect)((0, _tenantslogic.slugProblem)('-x-')).toContain('letters');
    });
    (0, _vitest.it)('admin name falls back to the email', ()=>{
        (0, _vitest.expect)((0, _tenantslogic.nameFromEmail)('kiran.rao@novaclinics.in')).toBe('Kiran Rao');
        (0, _vitest.expect)((0, _tenantslogic.nameFromEmail)('admin@acme.com')).toBe('Admin');
    });
});

//# sourceMappingURL=tenants.logic.spec.js.map