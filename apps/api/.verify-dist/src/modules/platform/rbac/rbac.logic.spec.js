"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const _rbaclogic = require("./rbac.logic");
const cells = (label)=>{
    const row = _shared.ROLE_MATRIX_ROWS.find((r)=>r.label === label);
    return Object.fromEntries(_shared.ROLE_KEYS.map((k)=>[
            k,
            (0, _shared.matrixCell)((0, _shared.defaultPermissionsFor)(k), row)
        ]));
};
(0, _vitest.describe)('roles matrix — fresh tenant defaults equal the wireframe (M3 acceptance 1)', ()=>{
    _vitest.it.each([
        [
            'Mobile app access',
            {
                employee: 'none',
                lead: 'none',
                manager: 'none',
                hr: 'all',
                admin: 'all'
            }
        ],
        [
            'Approve timesheets',
            {
                employee: 'none',
                lead: 'all',
                manager: 'all',
                hr: 'none',
                admin: 'all'
            }
        ],
        [
            'View all task boards',
            {
                employee: 'none',
                lead: 'none',
                manager: 'all',
                hr: 'none',
                admin: 'all'
            }
        ],
        // HR runs payroll but does not own the ledger → documented partial (half fill).
        [
            'Payroll & ledger',
            {
                employee: 'none',
                lead: 'none',
                manager: 'none',
                hr: 'some',
                admin: 'all'
            }
        ],
        [
            'Publish global notices',
            {
                employee: 'none',
                lead: 'none',
                manager: 'none',
                hr: 'all',
                admin: 'all'
            }
        ],
        [
            'Publish team notices',
            {
                employee: 'none',
                lead: 'all',
                manager: 'all',
                hr: 'all',
                admin: 'all'
            }
        ],
        [
            'Recruitment',
            {
                employee: 'none',
                lead: 'all',
                manager: 'none',
                hr: 'all',
                admin: 'all'
            }
        ],
        [
            'CCTV feeds',
            {
                employee: 'none',
                lead: 'none',
                manager: 'none',
                hr: 'none',
                admin: 'all'
            }
        ]
    ])('%s', (label, expected)=>{
        (0, _vitest.expect)(cells(label)).toEqual(expected);
    });
    (0, _vitest.it)('covers the 8 wireframe rows in order', ()=>{
        (0, _vitest.expect)(_shared.ROLE_MATRIX_ROWS.map((r)=>r.label)).toEqual([
            'Mobile app access',
            'Approve timesheets',
            'View all task boards',
            'Payroll & ledger',
            'Publish global notices',
            'Publish team notices',
            'Recruitment',
            'CCTV feeds'
        ]);
    });
    (0, _vitest.it)('bundled rows are tri-state; alternative-level rows are on when any level is held', ()=>{
        const payroll = {
            label: 'Payroll & ledger',
            keys: [
                'payroll.manage',
                'ledger.manage'
            ]
        };
        (0, _vitest.expect)((0, _shared.matrixCell)([], payroll)).toBe('none');
        (0, _vitest.expect)((0, _shared.matrixCell)([
            'payroll.manage'
        ], payroll)).toBe('some');
        (0, _vitest.expect)((0, _shared.matrixCell)([
            'payroll.manage',
            'ledger.manage'
        ], payroll)).toBe('all');
        const ts = {
            label: 'Approve timesheets',
            keys: [
                'timesheet.approve.l1',
                'timesheet.approve.l2'
            ]
        };
        (0, _vitest.expect)((0, _shared.matrixCell)([
            'timesheet.approve.l2'
        ], ts)).toBe('all');
    });
});
(0, _vitest.describe)('permission dependencies (M3 acceptance 4)', ()=>{
    (0, _vitest.it)('enabling payroll adds the requires closure', ()=>{
        const r = (0, _rbaclogic.applyToggle)([
            'dashboard.view'
        ], [
            'payroll.manage'
        ], true);
        (0, _vitest.expect)([
            ...r.added
        ].sort()).toEqual([
            'employees.compensation',
            'employees.view',
            'payroll.manage'
        ]);
        (0, _vitest.expect)(r.next).toContain('dashboard.view');
        (0, _vitest.expect)((0, _shared.alsoEnabledCopy)(r.added, [
            'payroll.manage'
        ])).toBe('Also enabled: People › View employee directory, People › View compensation');
    });
    (0, _vitest.it)('disabling a key another enabled key needs is refused with the dependents', ()=>{
        const cur = (0, _rbaclogic.applyToggle)([], [
            'payroll.manage'
        ], true).next;
        (0, _vitest.expect)(()=>(0, _rbaclogic.applyToggle)(cur, [
                'employees.compensation'
            ], false)).toThrow(_rbaclogic.DependencyError);
        try {
            (0, _rbaclogic.applyToggle)(cur, [
                'employees.compensation'
            ], false);
        } catch (e) {
            (0, _vitest.expect)(e.dependents).toEqual([
                'payroll.manage'
            ]);
            (0, _vitest.expect)(e.message).toBe('View compensation is needed by Payroll run');
        }
    });
    (0, _vitest.it)('cascade removes the transitive dependents too', ()=>{
        const cur = (0, _rbaclogic.applyToggle)([], [
            'payroll.manage'
        ], true).next;
        const r = (0, _rbaclogic.applyToggle)(cur, [
            'employees.view'
        ], false, true);
        (0, _vitest.expect)(r.next).toEqual([]);
        (0, _vitest.expect)(r.removed.sort()).toEqual([
            'employees.compensation',
            'employees.view',
            'payroll.manage'
        ]);
    });
    (0, _vitest.it)('dependentsOf / requiresClosure walk the graph', ()=>{
        (0, _vitest.expect)((0, _rbaclogic.dependentsOf)('kudos.view', [
            'kudos.view',
            'kudos.give',
            'kudos.eotm'
        ]).sort()).toEqual([
            'kudos.eotm',
            'kudos.give'
        ]);
        (0, _vitest.expect)([
            ...(0, _rbaclogic.requiresClosure)([
                'kudos.eotm'
            ])
        ].sort()).toEqual([
            'kudos.eotm',
            'kudos.give',
            'kudos.view'
        ]);
    });
    (0, _vitest.it)('toggling is idempotent and keeps catalogue order, preserving unknown legacy keys', ()=>{
        const r = (0, _rbaclogic.applyToggle)([
            'legacy.key',
            'roles.manage',
            'dashboard.view'
        ], [
            'dashboard.view'
        ], true);
        (0, _vitest.expect)(r.added).toEqual([]);
        (0, _vitest.expect)(r.next).toEqual([
            'dashboard.view',
            'roles.manage',
            'legacy.key'
        ]);
    });
});
(0, _vitest.describe)('replacePermissions (Undo)', ()=>{
    (0, _vitest.it)('restores an exact earlier set and reports the delta', ()=>{
        const before = (0, _shared.defaultPermissionsFor)('hr');
        const after = (0, _rbaclogic.applyToggle)(before, [
            'cctv.view'
        ], true).next;
        const r = (0, _rbaclogic.replacePermissions)(after, before);
        (0, _vitest.expect)(r.removed).toEqual([
            'cctv.view'
        ]);
        (0, _vitest.expect)(r.added).toEqual([]);
        (0, _vitest.expect)(r.next).toEqual(before);
    });
    (0, _vitest.it)('adds requires and keeps legacy keys', ()=>{
        const r = (0, _rbaclogic.replacePermissions)([
            'old.key'
        ], [
            'lms.manage'
        ]);
        (0, _vitest.expect)(r.next).toEqual([
            'lms.view',
            'lms.manage',
            'old.key'
        ]);
        (0, _vitest.expect)(r.added).toEqual([
            'lms.view',
            'lms.manage'
        ]);
    });
});
(0, _vitest.describe)('plan gating (M3 acceptance 6)', ()=>{
    (0, _vitest.it)('Free cannot enable Growth features; Growth, Enterprise and Internal can', ()=>{
        (0, _vitest.expect)((0, _rbaclogic.planAllows)('FREE', 'payroll.manage')).toBe(false);
        (0, _vitest.expect)((0, _rbaclogic.planAllows)('FREE', 'attendance.self')).toBe(true);
        (0, _vitest.expect)((0, _rbaclogic.planAllows)('GROWTH', 'payroll.manage')).toBe(true);
        (0, _vitest.expect)((0, _rbaclogic.planAllows)('ENTERPRISE', 'cctv.view')).toBe(true);
        (0, _vitest.expect)((0, _rbaclogic.planAllows)('INTERNAL', 'branding.manage')).toBe(true);
        (0, _vitest.expect)((0, _rbaclogic.lockedKeys)('FREE', [
            'payroll.manage',
            'dashboard.view',
            'lms.manage'
        ])).toEqual([
            'payroll.manage',
            'lms.manage'
        ]);
    });
    (0, _vitest.it)('entitlements come from the Subscription row', ()=>{
        // A workspace never provisioned through billing (no row) is not plan-gated.
        (0, _vitest.expect)((0, _rbaclogic.effectivePlan)(null)).toBe('INTERNAL');
        (0, _vitest.expect)((0, _rbaclogic.effectivePlan)({
            planCode: 'GROWTH',
            status: 'ACTIVE'
        })).toBe('GROWTH');
        (0, _vitest.expect)((0, _rbaclogic.effectivePlan)({
            planCode: 'FREE',
            status: 'FREE'
        })).toBe('FREE');
        // Past-due / suspended keep their plan's features; a cancelled plan falls back to Free.
        (0, _vitest.expect)((0, _rbaclogic.effectivePlan)({
            planCode: 'GROWTH',
            status: 'PAST_DUE'
        })).toBe('GROWTH');
        (0, _vitest.expect)((0, _rbaclogic.effectivePlan)({
            planCode: 'ENTERPRISE',
            status: 'CANCELLED'
        })).toBe('FREE');
        (0, _vitest.expect)((0, _rbaclogic.effectivePlan)({
            planCode: 'LEGACY_GOLD',
            status: 'ACTIVE'
        })).toBe('FREE');
    });
});
(0, _vitest.describe)('per-role editor', ()=>{
    const items = [
        {
            key: 'employees.view',
            locked: false
        },
        {
            key: 'employees.compensation',
            locked: false
        },
        {
            key: 'payroll.manage',
            locked: true
        }
    ];
    (0, _vitest.it)('"Turn all on" adds every unlocked key the role lacks; locked keys stay off', ()=>{
        (0, _vitest.expect)((0, _shared.groupBulkKeys)({
            permissions: [
                'employees.view'
            ],
            isMine: false
        }, items)).toEqual({
            allOn: false,
            keys: [
                'employees.compensation'
            ]
        });
    });
    (0, _vitest.it)('"Turn all off" once every togglable key is on — a held locked key counts and can be removed', ()=>{
        (0, _vitest.expect)((0, _shared.groupBulkKeys)({
            permissions: [
                'employees.view',
                'employees.compensation'
            ],
            isMine: false
        }, items)).toEqual({
            allOn: true,
            keys: [
                'employees.view',
                'employees.compensation'
            ]
        });
        (0, _vitest.expect)((0, _shared.groupBulkKeys)({
            permissions: [
                'employees.view',
                'employees.compensation',
                'payroll.manage'
            ],
            isMine: false
        }, items).keys).toEqual([
            'employees.view',
            'employees.compensation',
            'payroll.manage'
        ]);
    });
    (0, _vitest.it)('never turns off an admin’s own Roles & access', ()=>{
        const admin = [
            {
                key: 'roles.manage',
                locked: false
            },
            {
                key: 'audit.view',
                locked: false
            }
        ];
        (0, _vitest.expect)((0, _shared.groupBulkKeys)({
            permissions: [
                'roles.manage',
                'audit.view'
            ],
            isMine: true
        }, admin)).toEqual({
            allOn: true,
            keys: [
                'audit.view'
            ]
        });
        (0, _vitest.expect)((0, _shared.groupBulkKeys)({
            permissions: [
                'roles.manage',
                'audit.view'
            ],
            isMine: false
        }, admin).keys).toEqual([
            'roles.manage',
            'audit.view'
        ]);
    });
    (0, _vitest.it)('a group-off keeps keys other permissions need (replace adds the requires closure)', ()=>{
        const r = (0, _rbaclogic.replacePermissions)([
            'employees.view',
            'employees.compensation',
            'payroll.manage'
        ], [
            'payroll.manage'
        ]);
        (0, _vitest.expect)(r.next).toEqual(_vitest.expect.arrayContaining([
            'employees.view',
            'employees.compensation',
            'payroll.manage'
        ]));
        (0, _vitest.expect)(r.removed).toEqual([]);
    });
    (0, _vitest.it)('labels whole-set replaces in the audit trail', ()=>{
        (0, _vitest.expect)((0, _shared.setAllContext)({
            reason: 'group',
            group: 'People'
        })).toBe('group “People”');
        (0, _vitest.expect)((0, _shared.setAllContext)({
            reason: 'undo'
        })).toBe('undo');
        (0, _vitest.expect)((0, _shared.setAllContext)({})).toBe('undo');
        (0, _vitest.expect)(_shared.setRolePermissionsSchema.parse({
            permissions: [
                'cctv.view'
            ]
        })).toEqual({
            permissions: [
                'cctv.view'
            ]
        });
        (0, _vitest.expect)(()=>_shared.setRolePermissionsSchema.parse({
                permissions: [
                    'cctv.view'
                ],
                reason: 'bulk'
            })).toThrow();
    });
});
(0, _vitest.describe)('role keys and copy', ()=>{
    (0, _vitest.it)('slugs names and suffixes collisions', ()=>{
        (0, _vitest.expect)((0, _rbaclogic.roleKeyFor)('Facility Manager', [])).toBe('facility-manager');
        (0, _vitest.expect)((0, _rbaclogic.roleKeyFor)('Facility Manager', [
            'facility-manager'
        ])).toBe('facility-manager-2');
        (0, _vitest.expect)((0, _rbaclogic.roleKeyFor)('Admin', [
            'admin',
            'admin-2'
        ])).toBe('admin-3');
        (0, _vitest.expect)((0, _rbaclogic.roleKeyFor)('!!!', [])).toBe('role');
    });
    (0, _vitest.it)('summarises access changes for the alert', ()=>{
        (0, _vitest.expect)((0, _rbaclogic.accessChangeSummary)([
            'timesheet.approve.l1'
        ], [])).toBe('+Approve timesheets (Level 1 · Project Lead)');
        (0, _vitest.expect)((0, _rbaclogic.accessChangeSummary)([
            'cctv.view',
            'feed.publish',
            'quotes.manage'
        ], [
            'mobile.access',
            'lms.view'
        ])).toBe('+CCTV feeds, +Publish feed posts, +Manage thought of the day, −Mobile app access and 1 more');
    });
});

//# sourceMappingURL=rbac.logic.spec.js.map