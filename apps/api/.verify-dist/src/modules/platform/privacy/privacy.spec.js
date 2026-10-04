"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _privacyguard = require("./privacy.guard");
const _privacylogic = require("./privacy.logic");
(0, _vitest.describe)('Restricted data classification', ()=>{
    (0, _vitest.it)('chats, salaries and personal documents are restricted', ()=>{
        (0, _vitest.expect)((0, _privacyguard.restrictedCategoryOf)('ChatMessage')).toBe('CHAT');
        (0, _vitest.expect)((0, _privacyguard.restrictedCategoryOf)('ChatCall')).toBe('CHAT');
        (0, _vitest.expect)((0, _privacyguard.restrictedCategoryOf)('Payslip')).toBe('SALARY');
        (0, _vitest.expect)((0, _privacyguard.restrictedCategoryOf)('EmployeeSalary')).toBe('SALARY');
        (0, _vitest.expect)((0, _privacyguard.restrictedCategoryOf)('PayrollItemLine')).toBe('SALARY');
        (0, _vitest.expect)((0, _privacyguard.restrictedCategoryOf)('SalaryComponent')).toBe('SALARY');
        (0, _vitest.expect)((0, _privacyguard.restrictedCategoryOf)('EmployeeDocument')).toBe('PERSONAL_DOC');
        (0, _vitest.expect)((0, _privacyguard.restrictedCategoryOf)('Employee')).toBe('PERSONAL_DOC');
        (0, _vitest.expect)((0, _privacyguard.restrictedCategoryOf)('FileObject')).toBe('PERSONAL_DOC');
        (0, _vitest.expect)((0, _privacyguard.restrictedCategoryOf)('Screenshot')).toBe('PERSONAL_DOC');
    });
    (0, _vitest.it)('platform metadata stays readable', ()=>{
        for (const m of [
            'Tenant',
            'User',
            'Role',
            'Subscription',
            'SaasInvoice',
            'SupportTicket',
            'AuditLog',
            'IdCardTemplate',
            'Channel'
        ]){
            (0, _vitest.expect)((0, _privacyguard.restrictedCategoryOf)(m)).toBeNull();
        }
    });
    (0, _vitest.it)('covers the models present in the schema', ()=>{
        const r = (0, _privacyguard.restrictedModels)();
        (0, _vitest.expect)(r.SALARY).toContain('Payslip');
        (0, _vitest.expect)(r.PERSONAL_DOC).toContain('EmployeeDocument');
        (0, _vitest.expect)(Object.values(r).flat()).not.toContain('Tenant');
    });
});
(0, _vitest.describe)('platformReader (cross-tenant client for Lexisora staff)', ()=>{
    const fake = {
        tenant: {
            findMany: async ()=>[
                    {
                        id: 't1'
                    }
                ]
        },
        payslip: {
            findMany: async ()=>[
                    {
                        netPaise: 1
                    }
                ]
        },
        chatMessage: {
            findMany: async ()=>[]
        },
        $queryRaw: async ()=>[
                {
                    x: 1
                }
            ],
        $transaction: async (fn)=>fn({
                employeeDocument: {
                    findMany: async ()=>[]
                },
                tenant: {
                    count: async ()=>4
                }
            })
    };
    const db = (0, _privacyguard.platformReader)(fake);
    (0, _vitest.it)('reads tenant metadata', async ()=>{
        await (0, _vitest.expect)(db.tenant.findMany()).resolves.toEqual([
            {
                id: 't1'
            }
        ]);
    });
    (0, _vitest.it)('refuses salary and chat tables with 403 RESTRICTED_DATA', ()=>{
        (0, _vitest.expect)(()=>db.payslip).toThrowError(/salaries or personal documents/);
        let err = null;
        try {
            void db.chatMessage;
        } catch (e) {
            err = e;
        }
        (0, _vitest.expect)(err?.getStatus()).toBe(403);
        (0, _vitest.expect)(err?.getResponse().code).toBe('RESTRICTED_DATA');
    });
    (0, _vitest.it)('refuses raw SQL (it could name any table)', ()=>{
        (0, _vitest.expect)(()=>db.$queryRaw()).toThrowError(/raw SQL/);
    });
    (0, _vitest.it)('wraps interactive transactions too', async ()=>{
        await (0, _vitest.expect)(db.$transaction(async (tx)=>tx.tenant.count())).resolves.toBe(4);
        await (0, _vitest.expect)(db.$transaction(async (tx)=>tx.employeeDocument.findMany())).rejects.toThrowError(/EmployeeDocument/);
    });
});
(0, _vitest.describe)('Data privacy table', ()=>{
    const roles = [
        {
            key: 'employee',
            name: 'Employee',
            isSystem: true,
            permissions: [
                'chat.use'
            ]
        },
        {
            key: 'hr',
            name: 'HR',
            isSystem: true,
            permissions: [
                'employees.compensation',
                'payroll.manage',
                'onboarding.manage'
            ]
        },
        {
            key: 'admin',
            name: 'Admin / CEO',
            isSystem: true,
            permissions: [
                'employees.compensation',
                'employees.manage',
                'billing.manage'
            ]
        },
        {
            key: 'payroll-clerk',
            name: 'Payroll clerk',
            isSystem: false,
            permissions: [
                'payroll.manage'
            ]
        }
    ];
    (0, _vitest.it)('“Tenant admin” is derived from the roles that hold the access today', ()=>{
        (0, _vitest.expect)((0, _privacylogic.holdersLabel)(roles, [
            'employees.compensation',
            'payroll.manage'
        ])).toBe('HR / Admin + Payroll clerk');
        (0, _vitest.expect)((0, _privacylogic.holdersLabel)(roles, [
            'onboarding.manage',
            'employees.manage'
        ])).toBe('HR / Admin');
        (0, _vitest.expect)((0, _privacylogic.holdersLabel)(roles, [
            'billing.manage'
        ])).toBe('Admin');
        (0, _vitest.expect)((0, _privacylogic.holdersLabel)(roles, [
            'cctv.view'
        ])).toBe('Nobody');
    });
    (0, _vitest.it)('wireframe rows: Lexisora super-admin has no access to chats, salaries or documents', ()=>{
        const rows = (0, _privacylogic.privacyRows)(roles);
        (0, _vitest.expect)(rows.map((r)=>r.data)).toEqual([
            'Chats & call recordings',
            'Salaries & payslips',
            'Personal documents',
            'Usage & billing metrics'
        ]);
        (0, _vitest.expect)(rows.slice(0, 3).every((r)=>r.platformAdmin === 'No access' && r.platformTone === 'neutral')).toBe(true);
        (0, _vitest.expect)(rows[3]).toMatchObject({
            platformAdmin: 'Aggregated only',
            platformTone: 'accent'
        });
    });
});

//# sourceMappingURL=privacy.spec.js.map