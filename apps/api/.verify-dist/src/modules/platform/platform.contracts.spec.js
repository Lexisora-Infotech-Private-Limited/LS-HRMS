"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const ist = (s)=>new Date(`${s}+05:30`);
const NOW = ist('2026-09-29T10:00:00');
(0, _vitest.describe)('Alerts', ()=>{
    (0, _vitest.it)('"When" is Today / Yesterday / d MMM in IST, with the year only for other years', ()=>{
        (0, _vitest.expect)((0, _shared.alertWhenLabel)(ist('2026-09-29T00:30:00'), NOW)).toBe('Today');
        (0, _vitest.expect)((0, _shared.alertWhenLabel)(ist('2026-09-28T23:59:00'), NOW)).toBe('Yesterday');
        (0, _vitest.expect)((0, _shared.alertWhenLabel)(ist('2026-09-26T16:20:00'), NOW)).toBe('26 Sep');
        // Upcoming (e.g. a birthday reminder) shows its date.
        (0, _vitest.expect)((0, _shared.alertWhenLabel)(ist('2026-09-30T00:05:00'), NOW)).toBe('30 Sep');
        (0, _vitest.expect)((0, _shared.alertWhenLabel)(ist('2025-12-31T12:00:00'), NOW)).toBe('31 Dec 2025');
    });
    (0, _vitest.it)('dates print "Sep" whatever the runtime ICU says, on the IST business day', ()=>{
        (0, _vitest.expect)((0, _shared.dayMonthYear)(ist('2026-09-29T10:12:04'))).toBe('29 Sep 2026');
        // 23:30 UTC on 28 Sep is already 29 Sep in India.
        (0, _vitest.expect)((0, _shared.dayMonthYear)('2026-09-28T23:30:00Z')).toBe('29 Sep 2026');
    });
    (0, _vitest.it)('buckets notification types into tabs', ()=>{
        (0, _vitest.expect)((0, _shared.alertCategory)('timesheet.approval', '/approvals')).toBe('approval');
        (0, _vitest.expect)((0, _shared.alertCategory)('regularization.requested', '/attendance')).toBe('approval');
        (0, _vitest.expect)((0, _shared.alertCategory)('people.onboardingSubmitted', '/onboarding')).toBe('approval');
        (0, _vitest.expect)((0, _shared.alertCategory)('timesheet.reminder', '/timesheets')).toBe('reminder');
        (0, _vitest.expect)((0, _shared.alertCategory)('policy.acknowledge', '/policies')).toBe('reminder');
        (0, _vitest.expect)((0, _shared.alertCategory)('birthday.reminder', '/feed')).toBe('reminder');
        (0, _vitest.expect)((0, _shared.alertCategory)('helpdesk.resolved', '/helpdesk')).toBe('info');
        (0, _vitest.expect)((0, _shared.alertCategory)('leave.decided', '/leave')).toBe('info');
    });
});
(0, _vitest.describe)('Global search', ()=>{
    (0, _vitest.it)('"Go to" matches sidebar screens the user can open', ()=>{
        const admin = new Set([
            'roles.manage',
            'audit.view',
            'payroll.manage',
            'alerts.view'
        ]);
        (0, _vitest.expect)((0, _shared.navMatches)('roles', admin).map((n)=>n.label)).toContain('Roles & access');
        (0, _vitest.expect)((0, _shared.navMatches)('roles', new Set([
            'alerts.view'
        ]))).toEqual([]);
        (0, _vitest.expect)((0, _shared.navMatches)('audit log', admin).map((n)=>n.path)).toEqual([
            '/audit'
        ]);
        (0, _vitest.expect)((0, _shared.navMatches)('   ', admin)).toEqual([]);
    });
    (0, _vitest.it)('orders and labels result groups', ()=>{
        // Spec M8 order: People, Tasks, Documents, Projects, Notices, … — other domains' types, then "Go to" last.
        const sorted = (0, _shared.sortSearchGroups)([
            {
                type: 'goto'
            },
            {
                type: 'Payslips'
            },
            {
                type: 'tasks'
            },
            {
                type: 'zeta'
            },
            {
                type: 'projects'
            },
            {
                type: 'people'
            },
            {
                type: 'Notices'
            }
        ]);
        (0, _vitest.expect)(sorted.map((g)=>g.type)).toEqual([
            'people',
            'tasks',
            'projects',
            'Notices',
            'Payslips',
            'zeta',
            'goto'
        ]);
        (0, _vitest.expect)((0, _shared.searchTypeLabel)('goto')).toBe('Go to');
        (0, _vitest.expect)((0, _shared.searchTypeLabel)('people')).toBe('People');
        (0, _vitest.expect)((0, _shared.searchTypeLabel)('welcome-kits')).toBe('Welcome kits');
    });
});
(0, _vitest.describe)('Contracts', ()=>{
    (0, _vitest.it)('validates the Add role form', ()=>{
        (0, _vitest.expect)(_shared.createRoleSchema.parse({
            name: '  Facility Manager ',
            copyFromRoleId: ''
        })).toEqual({
            name: 'Facility Manager',
            copyFromRoleId: null
        });
        (0, _vitest.expect)(_shared.createRoleSchema.safeParse({
            name: 'A'
        }).success).toBe(false);
    });
    (0, _vitest.it)('audit query defaults and validation', ()=>{
        const q = _shared.auditQuerySchema.parse({
            module: 'rbac',
            result: 'denied',
            from: '2026-09-23'
        });
        (0, _vitest.expect)(q).toMatchObject({
            tab: 'all',
            page: 1,
            pageSize: 25,
            module: 'rbac',
            result: 'denied'
        });
        (0, _vitest.expect)(_shared.auditQuerySchema.safeParse({
            module: 'rbac; drop'
        }).success).toBe(false);
        (0, _vitest.expect)(_shared.auditQuerySchema.safeParse({
            from: '23-09-2026'
        }).success).toBe(false);
    });
    (0, _vitest.it)('audit drawer lists before → after from any producer shape', ()=>{
        (0, _vitest.expect)((0, _shared.auditChangeRows)(null)).toEqual([]);
        (0, _vitest.expect)((0, _shared.auditChangeRows)({
            summary: 'Signed in on the web'
        })).toEqual([]);
        (0, _vitest.expect)((0, _shared.auditChangeRows)({
            from: 'Employee',
            to: 'Team / Project Lead'
        })).toEqual([
            {
                field: 'Change',
                before: 'Employee',
                after: 'Team / Project Lead'
            }
        ]);
        (0, _vitest.expect)((0, _shared.auditChangeRows)({
            before: {
                shift: 'General',
                grace: 10
            },
            after: {
                shift: 'Night'
            }
        })).toEqual([
            {
                field: 'shift',
                before: 'General',
                after: 'Night'
            },
            {
                field: 'grace',
                before: '10',
                after: '—'
            }
        ]);
        (0, _vitest.expect)((0, _shared.auditChangeRows)({
            changes: {
                status: [
                    'PENDING',
                    'APPROVED'
                ],
                days: {
                    from: 1,
                    to: 1.5
                },
                bankAccount: '[redacted]'
            }
        })).toEqual([
            {
                field: 'status',
                before: 'PENDING',
                after: 'APPROVED'
            },
            {
                field: 'days',
                before: '1',
                after: '1.5'
            },
            {
                field: 'bankAccount',
                before: '—',
                after: '[redacted]'
            }
        ]);
    });
});

//# sourceMappingURL=platform.contracts.spec.js.map