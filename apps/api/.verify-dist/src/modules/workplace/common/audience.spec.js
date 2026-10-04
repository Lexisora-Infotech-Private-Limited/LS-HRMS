"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _audiencerules = require("./audience.rules");
/** The demo tenant in miniature: Development, QA, Design; Atlas project spans teams. */ const members = [
    {
        projectId: 'atlas',
        employeeId: 'priya'
    },
    {
        projectId: 'atlas',
        employeeId: 'rahul'
    },
    {
        projectId: 'atlas',
        employeeId: 'sneha'
    },
    {
        projectId: 'atlas',
        employeeId: 'vikram'
    },
    {
        projectId: 'orbit',
        employeeId: 'rahul'
    }
];
const projects = [
    {
        id: 'atlas',
        leadEmployeeId: 'arjun'
    },
    {
        id: 'orbit',
        leadEmployeeId: null
    }
];
const byEmp = (0, _audiencerules.projectIdsByEmployee)(members, projects);
const P = (id, departmentId, extra = {})=>({
        id,
        departmentId,
        branchId: 'ahmedabad',
        employmentType: 'FULL_TIME',
        projectIds: [
            ...byEmp.get(id) ?? []
        ],
        ...extra
    });
const pop = [
    P('neha', 'dev'),
    P('arjun', 'dev'),
    P('priya', 'dev'),
    P('rahul', 'dev'),
    P('isha', 'dev', {
        employmentType: 'INTERN'
    }),
    P('sneha', 'qa'),
    P('karan', 'qa', {
        employmentType: 'INTERN'
    }),
    P('vikram', 'design', {
        branchId: 'pune'
    }),
    P('ananya', 'finance')
];
(0, _vitest.describe)('project membership', ()=>{
    (0, _vitest.it)('counts members and the project lead', ()=>{
        (0, _vitest.expect)([
            ...byEmp.get('arjun') ?? []
        ]).toEqual([
            'atlas'
        ]);
        (0, _vitest.expect)([
            ...byEmp.get('rahul') ?? []
        ].sort()).toEqual([
            'atlas',
            'orbit'
        ]);
        (0, _vitest.expect)(byEmp.has('karan')).toBe(false);
    });
});
(0, _vitest.describe)('notice audience resolution', ()=>{
    (0, _vitest.it)('an empty rule list or ALL means everyone', ()=>{
        (0, _vitest.expect)((0, _audiencerules.resolveAudience)(pop, [])).toHaveLength(pop.length);
        (0, _vitest.expect)((0, _audiencerules.resolveAudience)(pop, [
            {
                type: 'ALL'
            }
        ])).toHaveLength(pop.length);
    });
    (0, _vitest.it)('"Development · Atlas" is the union of the department and the project (lead included)', ()=>{
        const rules = [
            {
                type: 'DEPARTMENT',
                refId: 'dev'
            },
            {
                type: 'PROJECT',
                refId: 'atlas'
            }
        ];
        (0, _vitest.expect)((0, _audiencerules.resolveAudience)(pop, rules).sort()).toEqual([
            'arjun',
            'isha',
            'neha',
            'priya',
            'rahul',
            'sneha',
            'vikram'
        ]);
    });
    (0, _vitest.it)('keeps QA-only and finance people out of a Development notice', ()=>{
        const rules = [
            {
                type: 'DEPARTMENT',
                refId: 'dev'
            }
        ];
        const ids = (0, _audiencerules.resolveAudience)(pop, rules);
        (0, _vitest.expect)(ids).not.toContain('karan');
        (0, _vitest.expect)(ids).not.toContain('ananya');
        (0, _vitest.expect)((0, _audiencerules.ruleMatches)(pop.find((p)=>p.id === 'sneha'), rules)).toBe(false);
    });
    (0, _vitest.it)('supports branch, employment type and single-employee rules', ()=>{
        (0, _vitest.expect)((0, _audiencerules.resolveAudience)(pop, [
            {
                type: 'BRANCH',
                refId: 'pune'
            }
        ])).toEqual([
            'vikram'
        ]);
        (0, _vitest.expect)((0, _audiencerules.resolveAudience)(pop, [
            {
                type: 'EMPLOYMENT_TYPE',
                refId: 'INTERN'
            }
        ])).toEqual([
            'isha',
            'karan'
        ]);
        (0, _vitest.expect)((0, _audiencerules.resolveAudience)(pop, [
            {
                type: 'EMPLOYEE',
                refId: 'ananya'
            }
        ])).toEqual([
            'ananya'
        ]);
    });
    (0, _vitest.it)('rules without a reference match nobody (never "everyone" by accident)', ()=>{
        for (const type of [
            'DEPARTMENT',
            'PROJECT',
            'BRANCH',
            'EMPLOYEE',
            'EMPLOYMENT_TYPE'
        ]){
            (0, _vitest.expect)((0, _audiencerules.resolveAudience)(pop, [
                {
                    type,
                    refId: null
                }
            ])).toEqual([]);
        }
    });
    (0, _vitest.it)('a late joiner in Development matches the live Atlas notice', ()=>{
        const meera = {
            id: 'new',
            departmentId: 'dev',
            branchId: 'ahmedabad',
            employmentType: 'FULL_TIME',
            projectIds: []
        };
        (0, _vitest.expect)((0, _audiencerules.ruleMatches)(meera, [
            {
                type: 'DEPARTMENT',
                refId: 'dev'
            },
            {
                type: 'PROJECT',
                refId: 'atlas'
            }
        ])).toBe(true);
    });
});

//# sourceMappingURL=audience.spec.js.map