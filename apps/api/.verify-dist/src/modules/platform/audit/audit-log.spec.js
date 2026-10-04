"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const _auditlogservice = require("./audit-log.service");
(0, _vitest.describe)('audit log tabs and filters', ()=>{
    (0, _vitest.it)('actor picker: a person, System (not Lexisora staff) or the Lexisora platform', ()=>{
        (0, _vitest.expect)((0, _auditlogservice.actorWhere)(undefined)).toBeNull();
        (0, _vitest.expect)((0, _auditlogservice.actorWhere)('')).toBeNull();
        (0, _vitest.expect)((0, _auditlogservice.actorWhere)('cku1')).toEqual({
            actorUserId: 'cku1'
        });
        (0, _vitest.expect)((0, _auditlogservice.actorWhere)('platform')).toEqual({
            action: {
                startsWith: 'platform.'
            }
        });
        (0, _vitest.expect)((0, _auditlogservice.actorWhere)('system')).toEqual({
            actorUserId: null,
            NOT: {
                action: {
                    startsWith: 'platform.'
                }
            }
        });
    });
    (0, _vitest.it)('maps tabs to action filters', ()=>{
        (0, _vitest.expect)((0, _auditlogservice.tabWhere)('all')).toEqual({});
        (0, _vitest.expect)((0, _auditlogservice.tabWhere)('access')).toEqual({
            action: {
                startsWith: 'rbac.'
            }
        });
        (0, _vitest.expect)((0, _auditlogservice.tabWhere)('platform')).toEqual({
            action: {
                startsWith: 'platform.'
            }
        });
        (0, _vitest.expect)(JSON.stringify((0, _auditlogservice.tabWhere)('security'))).toContain('auth.');
        (0, _vitest.expect)(JSON.stringify((0, _auditlogservice.tabWhere)('security'))).toContain('rbac.denied');
    });
    (0, _vitest.it)('result filter mirrors the Result column', ()=>{
        (0, _vitest.expect)((0, _auditlogservice.resultWhere)(undefined)).toEqual({});
        (0, _vitest.expect)(JSON.stringify((0, _auditlogservice.resultWhere)('denied'))).toContain('.denied');
        (0, _vitest.expect)((0, _auditlogservice.resultWhere)('success')).toHaveProperty('NOT');
        (0, _vitest.expect)((0, _auditlogservice.resultWhere)('failure')).toHaveProperty('AND');
    });
    (0, _vitest.it)('classifies results', ()=>{
        (0, _vitest.expect)((0, _shared.auditResultOf)('rbac.denied')).toBe('denied');
        (0, _vitest.expect)((0, _shared.auditResultOf)('punch.rejected')).toBe('denied');
        (0, _vitest.expect)((0, _shared.auditResultOf)('auth.login.failed')).toBe('failure');
        (0, _vitest.expect)((0, _shared.auditResultOf)('auth.login')).toBe('success');
        (0, _vitest.expect)((0, _shared.auditResultOf)('regularization.rejected')).toBe('success');
        (0, _vitest.expect)((0, _shared.auditResultOf)('device.pairing.rejected')).toBe('success');
    });
});
(0, _vitest.describe)('audit summaries', ()=>{
    (0, _vitest.it)('prefers the producer summary', ()=>{
        (0, _vitest.expect)((0, _auditlogservice.summarize)('rbac.role.created', 'Role', 'r1', {
            summary: 'Created role Facility Manager'
        })).toBe('Created role Facility Manager');
    });
    (0, _vitest.it)('falls back to a readable description with scalar meta', ()=>{
        (0, _vitest.expect)((0, _auditlogservice.summarize)('payroll.run.finalized', 'PayrollRun', 'ckabc123456', {
            period: '2026-08',
            net: 100,
            nested: {
                a: 1
            }
        })).toBe('PayrollRun 123456 run finalized — period: 2026-08 · net: 100');
        (0, _vitest.expect)((0, _auditlogservice.summarize)('device.paired', 'TrackerDevice', null, null)).toBe('TrackerDevice paired');
    });
    (0, _vitest.it)('reads core sign-in events recorded without a summary', ()=>{
        (0, _vitest.expect)((0, _auditlogservice.summarize)('auth.login', 'User', 'u1', {
            client: 'web'
        })).toBe('Signed in on the web');
        (0, _vitest.expect)((0, _auditlogservice.summarize)('auth.login', 'User', 'u1', {
            client: 'mobile'
        })).toBe('Signed in on the mobile app');
        (0, _vitest.expect)((0, _auditlogservice.summarize)('auth.login', 'User', null, null)).toBe('Signed in');
        (0, _vitest.expect)((0, _auditlogservice.summarize)('auth.login.failed', 'User', null, {
            email: 'priya.sharma@lexisora.com'
        })).toBe('Failed sign-in attempt for priya.sharma@lexisora.com');
    });
});

//# sourceMappingURL=audit-log.spec.js.map