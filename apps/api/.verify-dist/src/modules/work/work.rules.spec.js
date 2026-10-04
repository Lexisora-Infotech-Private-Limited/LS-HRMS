"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _workrules = require("./work.rules");
const _gitstubadapter = require("./adapters/git-stub.adapter");
const now = new Date('2026-09-29T06:00:00Z');
const d = (k)=>new Date(`${k}T00:00:00Z`);
const H = (h)=>h * 60;
(0, _vitest.describe)('planTransition — git side effects', ()=>{
    const base = {
        hasRepo: true,
        assigneeEmployeeId: 'e1',
        moverEmployeeId: 'e1',
        startedAt: null,
        now
    };
    (0, _vitest.it)('moving to WIP creates the feature branch and stamps startedAt', ()=>{
        const p = (0, _workrules.planTransition)({
            ...base,
            from: 'ALLOTTED',
            to: 'WIP'
        });
        (0, _vitest.expect)(p.git).toBe('branch');
        (0, _vitest.expect)(p.set.startedAt).toEqual(now);
        (0, _vitest.expect)(p.backward).toBe(false);
    });
    (0, _vitest.it)('moving to Dev Completed opens a merge request', ()=>{
        const p = (0, _workrules.planTransition)({
            ...base,
            from: 'WIP',
            to: 'DEV_COMPLETED',
            startedAt: d('2026-09-24')
        });
        (0, _vitest.expect)(p.git).toBe('mr');
        (0, _vitest.expect)(p.set.devCompletedAt).toEqual(now);
        (0, _vitest.expect)(p.set.startedAt).toBeUndefined();
    });
    (0, _vitest.it)('dragging straight from Open to Dev Completed still opens an MR (branch ensured by the adapter)', ()=>{
        (0, _vitest.expect)((0, _workrules.planTransition)({
            ...base,
            from: 'OPEN',
            to: 'DEV_COMPLETED'
        }).git).toBe('mr');
    });
    (0, _vitest.it)('moving back from QA to WIP does not create another branch', ()=>{
        const p = (0, _workrules.planTransition)({
            ...base,
            from: 'QA',
            to: 'WIP',
            startedAt: d('2026-09-24')
        });
        (0, _vitest.expect)(p.git).toBe('none');
        (0, _vitest.expect)(p.backward).toBe(true);
    });
    (0, _vitest.it)('no repository → no git side effect', ()=>{
        (0, _vitest.expect)((0, _workrules.planTransition)({
            ...base,
            hasRepo: false,
            from: 'ALLOTTED',
            to: 'WIP'
        }).git).toBe('none');
        (0, _vitest.expect)((0, _workrules.planTransition)({
            ...base,
            hasRepo: false,
            from: 'WIP',
            to: 'DEV_COMPLETED'
        }).git).toBe('none');
    });
    (0, _vitest.it)('QA and Done stamp their timestamps; reopening from Done clears doneAt', ()=>{
        (0, _vitest.expect)((0, _workrules.planTransition)({
            ...base,
            from: 'DEV_COMPLETED',
            to: 'QA'
        }).set.qaAt).toEqual(now);
        (0, _vitest.expect)((0, _workrules.planTransition)({
            ...base,
            from: 'QA',
            to: 'DONE'
        }).set.doneAt).toEqual(now);
        (0, _vitest.expect)((0, _workrules.planTransition)({
            ...base,
            from: 'DONE',
            to: 'QA'
        }).set.doneAt).toBeNull();
    });
    (0, _vitest.it)('moving back to Open unassigns; leaving Open without an assignee assigns the mover', ()=>{
        (0, _vitest.expect)((0, _workrules.planTransition)({
            ...base,
            from: 'ALLOTTED',
            to: 'OPEN'
        }).set.assigneeEmployeeId).toBeNull();
        (0, _vitest.expect)((0, _workrules.planTransition)({
            ...base,
            assigneeEmployeeId: null,
            moverEmployeeId: 'me',
            from: 'OPEN',
            to: 'ALLOTTED'
        }).set.assigneeEmployeeId).toBe('me');
        (0, _vitest.expect)('assigneeEmployeeId' in (0, _workrules.planTransition)({
            ...base,
            from: 'OPEN',
            to: 'ALLOTTED'
        }).set).toBe(false);
    });
});
(0, _vitest.describe)('moveMessage — wireframe toasts', ()=>{
    (0, _vitest.it)('Dev Completed with a synced MR', ()=>{
        (0, _vitest.expect)((0, _workrules.moveMessage)('AT-102', 'DEV_COMPLETED', {
            action: 'mr',
            status: 'SYNCED',
            branch: 'feature/at-102'
        })).toBe('AT-102 → Dev Completed · pushed to GitLab (feature/at-102)');
    });
    (0, _vitest.it)('WIP with a new branch', ()=>{
        (0, _vitest.expect)((0, _workrules.moveMessage)('AT-103', 'WIP', {
            action: 'branch',
            status: 'SYNCED',
            branch: 'feature/at-103',
            targetBranch: 'develop'
        })).toBe('AT-103 → WIP · branch feature/at-103 created from develop');
    });
    (0, _vitest.it)('Mark done and failed sync', ()=>{
        (0, _vitest.expect)((0, _workrules.moveMessage)('AT-106', 'DONE', {
            action: 'none',
            status: 'NONE'
        })).toBe('AT-106 closed');
        (0, _vitest.expect)((0, _workrules.moveMessage)('AT-102', 'DEV_COMPLETED', {
            action: 'mr',
            status: 'FAILED'
        })).toMatch(/sync failed/);
        (0, _vitest.expect)((0, _workrules.moveMessage)('AT-104', 'ALLOTTED', {
            action: 'none',
            status: 'NONE'
        })).toBe('AT-104 → Alloted');
    });
});
(0, _vitest.describe)('git naming', ()=>{
    (0, _vitest.it)('branch names are lower-case feature/<key>', ()=>{
        (0, _vitest.expect)((0, _workrules.branchName)('AT-102')).toBe('feature/at-102');
        (0, _vitest.expect)((0, _workrules.branchName)('KS-7', 'feat/{KEY}')).toBe('feat/ks-7');
        (0, _vitest.expect)((0, _workrules.branchName)('AT-1', '//bad name/{key}//')).toBe('bad-name/at-1');
    });
    (0, _vitest.it)('MR titles and key detection', ()=>{
        (0, _vitest.expect)((0, _workrules.mrTitle)('AT-102', 'GST rounding rules')).toBe('AT-102: GST rounding rules');
        (0, _vitest.expect)((0, _workrules.taskKeysIn)('AT-101 fix pdf; refs at-102 and feature/ks-43')).toEqual([
            'AT-101',
            'AT-102',
            'KS-43'
        ]);
    });
});
(0, _vitest.describe)('StubGitAdapter', ()=>{
    (0, _vitest.it)('records branch and MR URLs, numbers MRs and reuses an open MR for the same branch', async ()=>{
        let iid = 47;
        const stub = new _gitstubadapter.StubGitAdapter(async ()=>++iid);
        const repo = {
            repoUrl: 'https://gitlab.com/lexisora/atlas-crm.git',
            projectId: 1
        };
        const br = await stub.ensureBranch(repo, 'feature/at-102', 'develop');
        (0, _vitest.expect)(br.url).toBe('https://gitlab.com/lexisora/atlas-crm/-/tree/feature/at-102');
        const mr = await stub.ensureMr(repo, {
            source: 'feature/at-102',
            target: 'develop',
            title: 'AT-102: GST rounding rules'
        });
        (0, _vitest.expect)(mr).toMatchObject({
            iid: 48,
            state: 'opened',
            created: true,
            url: 'https://gitlab.com/lexisora/atlas-crm/-/merge_requests/48'
        });
        const again = await stub.ensureMr(repo, {
            source: 'feature/at-102',
            target: 'develop',
            title: 'x'
        });
        (0, _vitest.expect)(again).toMatchObject({
            iid: 48,
            created: false
        });
        const other = await stub.ensureMr(repo, {
            source: 'feature/at-101',
            target: 'develop',
            title: 'y'
        });
        (0, _vitest.expect)(other.iid).toBe(49);
        (0, _vitest.expect)((await stub.testConnection()).ok).toBe(true);
    });
});
(0, _vitest.describe)('board access', ()=>{
    const none = {
        viewAll: false,
        isDeptLead: false,
        isAllocated: false,
        isProjectLead: false
    };
    (0, _vitest.it)('private board: members not allocated by the department lead cannot see it', ()=>{
        (0, _vitest.expect)((0, _workrules.boardAccess)(none)).toEqual({
            canView: false,
            canManage: false,
            canAllocate: false
        });
    });
    (0, _vitest.it)('allocated members view but do not manage', ()=>{
        (0, _vitest.expect)((0, _workrules.boardAccess)({
            ...none,
            isAllocated: true
        })).toEqual({
            canView: true,
            canManage: false,
            canAllocate: false
        });
    });
    (0, _vitest.it)('department lead views, manages and allocates', ()=>{
        (0, _vitest.expect)((0, _workrules.boardAccess)({
            ...none,
            isDeptLead: true
        })).toEqual({
            canView: true,
            canManage: true,
            canAllocate: true
        });
    });
    (0, _vitest.it)('managers/admin (tasks.viewAllBoards) see every board', ()=>{
        (0, _vitest.expect)((0, _workrules.boardAccess)({
            ...none,
            viewAll: true
        })).toEqual({
            canView: true,
            canManage: true,
            canAllocate: true
        });
    });
    (0, _vitest.it)('project lead manages only boards they can see', ()=>{
        (0, _vitest.expect)((0, _workrules.boardAccess)({
            ...none,
            isProjectLead: true
        }).canView).toBe(false);
        (0, _vitest.expect)((0, _workrules.boardAccess)({
            ...none,
            isProjectLead: true
        }).canManage).toBe(false);
        (0, _vitest.expect)((0, _workrules.boardAccess)({
            ...none,
            isProjectLead: true,
            isAllocated: true
        })).toEqual({
            canView: true,
            canManage: true,
            canAllocate: false
        });
    });
    (0, _vitest.it)('members move their own or unassigned cards; managers move anything', ()=>{
        const member = {
            canManage: false,
            canView: true,
            me: 'priya'
        };
        (0, _vitest.expect)((0, _workrules.canMoveTask)({
            ...member,
            assigneeEmployeeId: 'priya'
        })).toBe(true);
        (0, _vitest.expect)((0, _workrules.canMoveTask)({
            ...member,
            assigneeEmployeeId: null
        })).toBe(true);
        (0, _vitest.expect)((0, _workrules.canMoveTask)({
            ...member,
            assigneeEmployeeId: 'rahul'
        })).toBe(false);
        (0, _vitest.expect)((0, _workrules.canMoveTask)({
            canManage: true,
            canView: true,
            me: 'arjun',
            assigneeEmployeeId: 'rahul'
        })).toBe(true);
        (0, _vitest.expect)((0, _workrules.canMoveTask)({
            canManage: true,
            canView: false,
            me: 'x',
            assigneeEmployeeId: null
        })).toBe(false);
    });
});
(0, _vitest.describe)('project progress', ()=>{
    (0, _vitest.it)('weights estimates by status, ignoring cancelled and standing tasks', ()=>{
        const tasks = [
            {
                status: 'DONE',
                estimatedMinutes: H(10)
            },
            {
                status: 'WIP',
                estimatedMinutes: H(10)
            },
            {
                status: 'CANCELLED',
                estimatedMinutes: H(50)
            },
            {
                status: 'WIP',
                estimatedMinutes: null,
                isStanding: true
            }
        ];
        (0, _vitest.expect)((0, _workrules.computeProgress)(tasks)).toBe(63); // (10 + 2.5) / 20
    });
    (0, _vitest.it)('un-broken-down budget counts as not started', ()=>{
        (0, _vitest.expect)((0, _workrules.computeProgress)([
            {
                status: 'DONE',
                estimatedMinutes: H(10)
            }
        ], H(100))).toBe(10);
    });
    (0, _vitest.it)('falls back to counts without estimates; empty is 0', ()=>{
        (0, _vitest.expect)((0, _workrules.computeProgress)([
            {
                status: 'DONE',
                estimatedMinutes: null
            },
            {
                status: 'OPEN',
                estimatedMinutes: null
            }
        ])).toBe(50);
        (0, _vitest.expect)((0, _workrules.computeProgress)([])).toBe(0);
    });
    (0, _vitest.it)('seeded Atlas CRM lands on the wireframe 64 %', ()=>{
        const tasks = [
            {
                status: 'DONE',
                estimatedMinutes: H(512)
            },
            {
                status: 'WIP',
                estimatedMinutes: H(8)
            },
            {
                status: 'DEV_COMPLETED',
                estimatedMinutes: H(5)
            },
            {
                status: 'ALLOTTED',
                estimatedMinutes: H(6)
            },
            {
                status: 'OPEN',
                estimatedMinutes: H(10)
            },
            {
                status: 'QA',
                estimatedMinutes: H(3)
            },
            {
                status: 'OPEN',
                estimatedMinutes: H(4)
            },
            {
                status: 'OPEN',
                estimatedMinutes: H(6)
            },
            {
                status: 'DONE',
                estimatedMinutes: H(4)
            },
            {
                status: 'WIP',
                estimatedMinutes: H(3)
            },
            {
                status: 'WIP',
                estimatedMinutes: null,
                isStanding: true
            }
        ];
        (0, _vitest.expect)((0, _workrules.computeProgress)(tasks, H(820))).toBe(64);
    });
});
(0, _vitest.describe)('project health', ()=>{
    const today = d('2026-09-29');
    const p = {
        status: 'ACTIVE',
        estimatedMinutes: H(820),
        loggedMinutes: H(540),
        progressPct: 64,
        startDate: d('2026-03-02'),
        deadline: d('2026-12-18')
    };
    (0, _vitest.it)('Atlas CRM is on track', ()=>{
        (0, _vitest.expect)((0, _workrules.computeHealth)(p, today)).toEqual({
            health: 'ON_TRACK',
            reason: null
        });
    });
    (0, _vitest.it)('AT_RISK when logged/estimated exceeds progress by more than 15 points', ()=>{
        const r = (0, _workrules.computeHealth)({
            ...p,
            loggedMinutes: H(700),
            progressPct: 64
        }, today);
        (0, _vitest.expect)(r.health).toBe('AT_RISK');
        (0, _vitest.expect)(r.reason).toBe('Logged 85% of estimate vs 64% progress');
        (0, _vitest.expect)((0, _workrules.computeHealth)({
            ...p,
            loggedMinutes: H(0.79 * 820),
            progressPct: 64
        }, today).health).toBe('ON_TRACK');
    });
    (0, _vitest.it)('AT_RISK when the deadline is near and progress < 80 %', ()=>{
        const r = (0, _workrules.computeHealth)({
            ...p,
            deadline: d('2026-10-09'),
            startDate: null,
            loggedMinutes: H(400),
            progressPct: 60
        }, today);
        (0, _vitest.expect)(r).toEqual({
            health: 'AT_RISK',
            reason: 'Deadline in 10 days with 60% progress'
        });
    });
    (0, _vitest.it)('seeded Kestrel mobile app is at risk (schedule almost elapsed)', ()=>{
        const r = (0, _workrules.computeHealth)({
            status: 'ACTIVE',
            estimatedMinutes: H(400),
            loggedMinutes: H(372),
            progressPct: 82,
            startDate: d('2026-04-01'),
            deadline: d('2026-10-02')
        }, today);
        (0, _vitest.expect)(r).toEqual({
            health: 'AT_RISK',
            reason: '98% of the schedule elapsed vs 82% progress'
        });
    });
    (0, _vitest.it)('OFF_TRACK when the deadline passed or logged exceeds the estimate', ()=>{
        (0, _vitest.expect)((0, _workrules.computeHealth)({
            ...p,
            deadline: d('2026-09-20')
        }, today).health).toBe('OFF_TRACK');
        (0, _vitest.expect)((0, _workrules.computeHealth)({
            ...p,
            loggedMinutes: H(900),
            progressPct: 70
        }, today).health).toBe('OFF_TRACK');
    });
    (0, _vitest.it)('non-active projects have no health', ()=>{
        (0, _vitest.expect)((0, _workrules.computeHealth)({
            ...p,
            status: 'PLANNING'
        }, today).health).toBe('NA');
    });
    (0, _vitest.it)('status column label', ()=>{
        (0, _vitest.expect)((0, _workrules.projectStatusLabel)('ACTIVE', 'ON_TRACK')).toBe('On track');
        (0, _vitest.expect)((0, _workrules.projectStatusLabel)('ACTIVE', 'AT_RISK')).toBe('At risk');
        (0, _vitest.expect)((0, _workrules.projectStatusLabel)('PLANNING', 'NA')).toBe('Planning');
    });
});
(0, _vitest.describe)('helpers', ()=>{
    (0, _vitest.it)('shortName and suggestKey', ()=>{
        (0, _vitest.expect)((0, _workrules.shortName)('Priya Sharma')).toBe('Priya S.');
        (0, _vitest.expect)((0, _workrules.shortName)(null)).toBe('—');
        (0, _vitest.expect)((0, _workrules.suggestKey)('Atlas CRM')).toBe('AT');
        (0, _vitest.expect)((0, _workrules.suggestKey)('Orbit HR portal')).toBe('OR');
        (0, _vitest.expect)((0, _workrules.suggestKey)('Atlas Two', new Set([
            'AT'
        ]))).toBe('ATL');
    });
    (0, _vitest.it)('intern week helpers', ()=>{
        (0, _vitest.expect)((0, _workrules.weekStartOf)('2026-09-29')).toBe('2026-09-28');
        (0, _vitest.expect)((0, _workrules.nextWorkingDay)('2026-10-03')).toBe('2026-10-05');
        (0, _vitest.expect)((0, _workrules.meanScore)([
            4,
            5,
            null,
            4.5
        ])).toBe(4.5);
    });
});

//# sourceMappingURL=work.rules.spec.js.map