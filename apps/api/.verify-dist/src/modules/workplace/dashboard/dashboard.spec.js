"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const _dashboardrules = require("./dashboard.rules");
const _dates = require("../common/dates");
const d = (k)=>new Date(`${k}T00:00:00.000Z`);
const TODAY = '2026-09-29'; // Tue — the wireframe's "today"
(0, _vitest.describe)('greeting', ()=>{
    (0, _vitest.it)('uses the IST day part boundaries (morning < 12:00 ≤ afternoon < 17:00 ≤ evening)', ()=>{
        (0, _vitest.expect)((0, _shared.dayPartFor)((0, _dates.istInstant)(TODAY, '06:00'))).toBe('morning');
        (0, _vitest.expect)((0, _shared.dayPartFor)((0, _dates.istInstant)(TODAY, '11:59'))).toBe('morning');
        (0, _vitest.expect)((0, _shared.dayPartFor)((0, _dates.istInstant)(TODAY, '12:00'))).toBe('afternoon');
        (0, _vitest.expect)((0, _shared.dayPartFor)((0, _dates.istInstant)(TODAY, '16:59'))).toBe('afternoon');
        (0, _vitest.expect)((0, _shared.dayPartFor)((0, _dates.istInstant)(TODAY, '17:00'))).toBe('evening');
        (0, _vitest.expect)((0, _shared.dayPartFor)((0, _dates.istInstant)(TODAY, '23:30'))).toBe('evening');
    });
    (0, _vitest.it)('formats the kicker as "EEEE, d MMMM yyyy" in IST', ()=>{
        (0, _vitest.expect)((0, _dates.longDate)((0, _dates.istInstant)(TODAY, '09:00'))).toBe('Tuesday, 29 September 2026');
        // 00:30 IST on the 30th is still the 29th in UTC — the kicker follows IST.
        (0, _vitest.expect)((0, _dates.longDate)((0, _dates.istInstant)('2026-09-30', '00:30'))).toBe('Wednesday, 30 September 2026');
    });
    (0, _vitest.it)('shows designation · department, dropping a redundant department', ()=>{
        (0, _vitest.expect)((0, _dashboardrules.titleLine)('Software Engineer', 'Development')).toBe('Software Engineer · Development');
        (0, _vitest.expect)((0, _dashboardrules.titleLine)('Project Lead', 'Development')).toBe('Project Lead · Development');
        (0, _vitest.expect)((0, _dashboardrules.titleLine)('HR Manager', 'HR')).toBe('HR Manager');
        (0, _vitest.expect)((0, _dashboardrules.titleLine)('Chief Executive Officer', 'Management')).toBe('Chief Executive Officer');
        (0, _vitest.expect)((0, _dashboardrules.titleLine)(null, 'QA')).toBe('QA');
        (0, _vitest.expect)((0, _dashboardrules.titleLine)('Intern', null)).toBe('Intern');
    });
});
(0, _vitest.describe)('thought of the day rotation', ()=>{
    (0, _vitest.it)('is the same for everyone on a date and advances by one each day', ()=>{
        const a = (0, _shared.quoteIndexFor)(TODAY, 4);
        (0, _vitest.expect)((0, _shared.quoteIndexFor)(TODAY, 4)).toBe(a);
        (0, _vitest.expect)((0, _shared.quoteIndexFor)('2026-09-30', 4)).toBe((a + 1) % 4);
        (0, _vitest.expect)((0, _shared.quoteIndexFor)('2026-10-01', 4)).toBe((a + 2) % 4);
    });
    (0, _vitest.it)('stays in range for any pool size and handles an empty pool', ()=>{
        for (const n of [
            1,
            3,
            22,
            64
        ]){
            const i = (0, _shared.quoteIndexFor)(TODAY, n);
            (0, _vitest.expect)(i).toBeGreaterThanOrEqual(0);
            (0, _vitest.expect)(i).toBeLessThan(n);
        }
        (0, _vitest.expect)((0, _shared.quoteIndexFor)(TODAY, 0)).toBe(-1);
    });
});
(0, _vitest.describe)('birthdays & anniversaries', ()=>{
    const people = [
        {
            id: 'rahul',
            name: 'Rahul Desai',
            dob: d('1995-09-30'),
            joined: d('2023-02-20')
        },
        {
            id: 'sneha',
            name: 'Sneha Patel',
            dob: d('1996-04-14'),
            joined: d('2023-10-02')
        },
        {
            id: 'priya',
            name: 'Priya Sharma',
            dob: d('1998-09-30'),
            joined: d('2024-01-12')
        },
        {
            id: 'isha',
            name: 'Isha Mehra',
            dob: d('2004-03-12'),
            joined: d('2026-09-29')
        },
        {
            id: 'far',
            name: 'Far Away',
            dob: d('1990-10-20'),
            joined: d('2020-10-21')
        }
    ];
    (0, _vitest.it)('lists the wireframe rows within 7 days, sorted by date, without the year of birth', ()=>{
        const rows = (0, _dashboardrules.celebrationsWithin)(people, TODAY, 7, 'priya');
        (0, _vitest.expect)(rows.map((r)=>[
                r.what,
                r.when
            ])).toEqual([
            [
                'Rahul Desai · birthday',
                '30 Sep'
            ],
            [
                'Sneha Patel · 3 years',
                '2 Oct'
            ]
        ]);
        (0, _vitest.expect)(rows.every((r)=>!/19\d\d|20\d\d/.test(r.what))).toBe(true);
    });
    (0, _vitest.it)('never lists the viewer’s own birthday but shows it to others', ()=>{
        (0, _vitest.expect)((0, _dashboardrules.celebrationsWithin)(people, TODAY, 7, 'priya').some((r)=>r.id === 'bday:priya')).toBe(false);
        (0, _vitest.expect)((0, _dashboardrules.celebrationsWithin)(people, TODAY, 7, 'rahul').some((r)=>r.id === 'bday:priya')).toBe(true);
    });
    (0, _vitest.it)('needs at least one completed year for an anniversary (joining day is not one)', ()=>{
        (0, _vitest.expect)((0, _dashboardrules.celebrationsWithin)(people, TODAY, 0).some((r)=>r.id === 'anniv:isha')).toBe(false);
        (0, _vitest.expect)((0, _dashboardrules.celebrationsWithin)([
            {
                id: 'x',
                name: 'X',
                dob: null,
                joined: d('2025-09-29')
            }
        ], TODAY, 0)[0]?.what).toBe('X · 1 year');
    });
    (0, _vitest.it)('includes the window end day and excludes the day after', ()=>{
        (0, _vitest.expect)((0, _dashboardrules.celebrationsWithin)(people, TODAY, 3).some((r)=>r.id === 'anniv:sneha')).toBe(true); // 2 Oct = today + 3
        (0, _vitest.expect)((0, _dashboardrules.celebrationsWithin)(people, TODAY, 2).some((r)=>r.id === 'anniv:sneha')).toBe(false);
    });
    (0, _vitest.it)('shows 29 Feb birthdays on 28 Feb in non-leap years and on 29 Feb in leap years', ()=>{
        const leapling = [
            {
                id: 'l',
                name: 'Leap Ling',
                dob: d('2000-02-29'),
                joined: null
            }
        ];
        (0, _vitest.expect)((0, _dashboardrules.celebrationsWithin)(leapling, '2027-02-27', 3)[0]).toMatchObject({
            date: '2027-02-28',
            when: '28 Feb'
        });
        (0, _vitest.expect)((0, _dashboardrules.celebrationsWithin)(leapling, '2028-02-27', 3)[0]).toMatchObject({
            date: '2028-02-29',
            when: '29 Feb'
        });
    });
    (0, _vitest.it)('wraps the year end', ()=>{
        const rows = (0, _dashboardrules.celebrationsWithin)([
            {
                id: 'n',
                name: 'New Year',
                dob: d('1990-01-02'),
                joined: null
            }
        ], '2026-12-30', 7);
        (0, _vitest.expect)(rows[0]).toMatchObject({
            date: '2027-01-02',
            when: '2 Jan'
        });
    });
});
(0, _vitest.describe)('pending to-do merge', ()=>{
    const t = (id, sortDate, prio, createdAt = 0, overdue = sortDate < TODAY)=>({
            id,
            overdue,
            sortDate,
            prio,
            createdAt
        });
    (0, _vitest.it)('sorts overdue first, then by due date, then system → board → personal, then age', ()=>{
        const rows = (0, _dashboardrules.sortTodos)([
            t('personal-today', TODAY, 2, 5),
            t('board-wed', '2026-09-30', 1),
            t('system-today', TODAY, 0),
            t('personal-overdue', '2026-09-25', 2),
            t('personal-today-older', TODAY, 2, 1),
            t('anytime', '9999-12-31', 2),
            t('system-overdue', '2026-09-28', 0)
        ]);
        (0, _vitest.expect)(rows.map((r)=>r.id)).toEqual([
            'personal-overdue',
            'system-overdue',
            'system-today',
            'personal-today-older',
            'personal-today',
            'board-wed',
            'anytime'
        ]);
    });
    (0, _vitest.it)('labels due dates the way the card shows them', ()=>{
        (0, _vitest.expect)((0, _dates.dueLabel)(TODAY, TODAY)).toBe('Today');
        (0, _vitest.expect)((0, _dates.dueLabel)('2026-09-30', TODAY)).toBe('Wed');
        (0, _vitest.expect)((0, _dates.dueLabel)('2026-10-05', TODAY)).toBe('Mon');
        (0, _vitest.expect)((0, _dates.dueLabel)('2026-10-06', TODAY)).toBe('6 Oct');
        (0, _vitest.expect)((0, _dates.dueLabel)('2026-09-28', TODAY)).toBe('Overdue');
        (0, _vitest.expect)((0, _dates.dueLabel)(null, TODAY)).toBe('Anytime');
    });
    (0, _vitest.it)('names last week for the timesheet reminder ("Submit timesheet for 21–27 Sep")', ()=>{
        (0, _vitest.expect)((0, _dates.weekStartKey)(TODAY)).toBe('2026-09-28');
        (0, _vitest.expect)((0, _dashboardrules.weekRangeLabel)('2026-09-21')).toBe('21–27 Sep');
        (0, _vitest.expect)((0, _dashboardrules.weekRangeLabel)('2026-09-28')).toBe('28 Sep – 4 Oct');
    });
    (0, _vitest.it)('deep-links board tasks to the task drawer on their team board', ()=>{
        (0, _vitest.expect)((0, _dashboardrules.taskLink)({
            id: 't1',
            projectId: 'p1',
            departmentId: 'd1'
        })).toBe('/board?project=p1&board=d1&task=t1');
        (0, _vitest.expect)((0, _dashboardrules.taskLink)({
            id: 't1',
            projectId: 'p1',
            departmentId: null
        })).toBe('/board?project=p1&task=t1');
    });
});
(0, _vitest.describe)('awaiting your approval', ()=>{
    const rows = [
        {
            key: 'timesheets',
            label: 'Timesheets',
            count: 0,
            link: '/approvals'
        },
        {
            key: 'leave',
            label: 'Time-off requests',
            count: 3,
            link: '/leave?tab=approvals'
        },
        {
            key: 'helpdesk',
            label: 'Helpdesk escalations',
            count: 1,
            link: '/helpdesk?tab=escalated'
        }
    ];
    (0, _vitest.it)('"Review now" goes to the first queue with work waiting', ()=>{
        (0, _vitest.expect)((0, _dashboardrules.reviewLink)(rows)).toBe('/leave?tab=approvals');
        (0, _vitest.expect)((0, _dashboardrules.reviewLink)(rows.map((r)=>({
                ...r,
                count: 0
            })))).toBe('/approvals');
        (0, _vitest.expect)((0, _dashboardrules.reviewLink)([])).toBeNull();
    });
    (0, _vitest.it)('hides the card for employees with nothing waiting and when no queue applies', ()=>{
        (0, _vitest.expect)((0, _dashboardrules.approvalsFor)('employee', rows.map((r)=>({
                ...r,
                count: 0
            })))).toBeNull();
        (0, _vitest.expect)((0, _dashboardrules.approvalsFor)('employee', [])).toBeNull();
        (0, _vitest.expect)((0, _dashboardrules.approvalsFor)('manager', [])).toBeNull();
        (0, _vitest.expect)((0, _dashboardrules.approvalsFor)('manager', rows.map((r)=>({
                ...r,
                count: 0
            })))).toHaveLength(3);
        (0, _vitest.expect)((0, _dashboardrules.approvalsFor)('hr', rows.slice(1))?.map((r)=>r.label)).toEqual([
            'Time-off requests',
            'Helpdesk escalations'
        ]);
    });
});
(0, _vitest.describe)('event times', ()=>{
    (0, _vitest.it)('renders "3 Oct, 5 pm" style times in IST', ()=>{
        (0, _vitest.expect)((0, _dates.shortTime)((0, _dates.istInstant)('2026-10-03', '17:00'))).toBe('5 pm');
        (0, _vitest.expect)((0, _dates.shortTime)((0, _dates.istInstant)('2026-10-03', '10:30'))).toBe('10:30 am');
    });
});

//# sourceMappingURL=dashboard.spec.js.map