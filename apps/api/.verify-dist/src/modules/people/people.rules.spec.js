"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _peoplerules = require("./people.rules");
(0, _vitest.describe)('employee codes', ()=>{
    (0, _vitest.it)('formats full-time codes as LX-#### and interns as LX-I-###', ()=>{
        (0, _vitest.expect)((0, _peoplerules.formatEmpCode)('FULL_TIME', 161)).toBe('LX-0161');
        (0, _vitest.expect)((0, _peoplerules.formatEmpCode)('CONTRACT', 7)).toBe('LX-0007');
        (0, _vitest.expect)((0, _peoplerules.formatEmpCode)('INTERN', 24)).toBe('LX-I-024');
        (0, _vitest.expect)((0, _peoplerules.formatEmpCode)('FULL_TIME', 12345)).toBe('LX-12345');
    });
    (0, _vitest.it)('uses separate sequence keys per series', ()=>{
        (0, _vitest.expect)((0, _peoplerules.empCodeSeries)('FULL_TIME').key).toBe('employee.fulltime');
        (0, _vitest.expect)((0, _peoplerules.empCodeSeries)('CONTRACT').key).toBe('employee.fulltime');
        (0, _vitest.expect)((0, _peoplerules.empCodeSeries)('INTERN').key).toBe('employee.intern');
    });
    (0, _vitest.it)('rejects non-positive sequence values', ()=>{
        (0, _vitest.expect)(()=>(0, _peoplerules.formatEmpCode)('INTERN', 0)).toThrow();
    });
    (0, _vitest.it)('finds the highest used number per series', ()=>{
        const codes = [
            'LX-0001',
            'LX-0160',
            'LX-I-021',
            'LX-I-023',
            'X-9999'
        ];
        (0, _vitest.expect)((0, _peoplerules.maxCodeNumber)(codes, 'FULL_TIME')).toBe(160);
        (0, _vitest.expect)((0, _peoplerules.maxCodeNumber)(codes, 'INTERN')).toBe(23);
    });
    (0, _vitest.it)('labels statuses like the wireframe', ()=>{
        (0, _vitest.expect)((0, _peoplerules.employeeStatusLabel)('ACTIVE', 'FULL_TIME')).toBe('Active');
        (0, _vitest.expect)((0, _peoplerules.employeeStatusLabel)('ACTIVE', 'INTERN')).toBe('Intern');
        (0, _vitest.expect)((0, _peoplerules.employeeStatusLabel)('NOTICE_PERIOD', 'FULL_TIME')).toBe('Notice period');
        (0, _vitest.expect)((0, _peoplerules.employeeStatusLabel)('ONBOARDING', 'FULL_TIME')).toBe('Onboarding');
    });
});
(0, _vitest.describe)('statutory validation', ()=>{
    (0, _vitest.it)('validates PAN format with P as the 4th character', ()=>{
        (0, _vitest.expect)((0, _peoplerules.isValidPan)('ABCPS1234K')).toBe(true);
        (0, _vitest.expect)((0, _peoplerules.isValidPan)('ABCD1234F')).toBe(false);
        (0, _vitest.expect)((0, _peoplerules.isValidPan)('ABCCS1234K')).toBe(false);
        (0, _vitest.expect)((0, _peoplerules.maskPan)('ABCPS1234K')).toBe('XXXXX1234X');
    });
    (0, _vitest.it)('validates Aadhaar with the Verhoeff checksum', ()=>{
        const base = '23456789012';
        const good = base + (0, _peoplerules.verhoeffDigit)(base);
        (0, _vitest.expect)((0, _peoplerules.isValidAadhaar)(good)).toBe(true);
        const bad = base + ((0, _peoplerules.verhoeffDigit)(base) + 1) % 10;
        (0, _vitest.expect)((0, _peoplerules.isValidAadhaar)(bad)).toBe(false);
        (0, _vitest.expect)((0, _peoplerules.isValidAadhaar)('1' + good.slice(1))).toBe(false); // first digit 2-9
        (0, _vitest.expect)((0, _peoplerules.maskAadhaar)('4821')).toBe('XXXX XXXX 4821');
    });
    (0, _vitest.it)('validates IFSC and account confirmation', ()=>{
        (0, _vitest.expect)((0, _peoplerules.isValidIfsc)('HDFC0001234')).toBe(true);
        (0, _vitest.expect)((0, _peoplerules.isValidIfsc)('HDFC1001234')).toBe(false);
        (0, _vitest.expect)((0, _peoplerules.validateBank)({
            accountNumber: '50100234567890',
            confirmAccountNumber: '50100234567890',
            ifsc: 'HDFC0001234'
        })).toBeNull();
        (0, _vitest.expect)((0, _peoplerules.validateBank)({
            accountNumber: '50100234567890',
            confirmAccountNumber: '50100234567891',
            ifsc: 'HDFC0001234'
        })).toMatch(/do not match/);
        (0, _vitest.expect)((0, _peoplerules.validateBank)({
            accountNumber: '1234',
            confirmAccountNumber: '1234',
            ifsc: 'HDFC0001234'
        })).toMatch(/9 to 18/);
    });
});
(0, _vitest.describe)('dates', ()=>{
    (0, _vitest.it)('accepts YYYY-MM-DD and DD-MM-YYYY', ()=>{
        (0, _vitest.expect)((0, _peoplerules.parseFlexibleDate)('2026-10-06')).toBe('2026-10-06');
        (0, _vitest.expect)((0, _peoplerules.parseFlexibleDate)('06-10-2026')).toBe('2026-10-06');
        (0, _vitest.expect)((0, _peoplerules.parseFlexibleDate)('6/10/2026')).toBe('2026-10-06');
        (0, _vitest.expect)((0, _peoplerules.parseFlexibleDate)('31-02-2026')).toBeNull();
        (0, _vitest.expect)((0, _peoplerules.parseFlexibleDate)('Oct 6')).toBeNull();
    });
});
(0, _vitest.describe)('CSV row validation', ()=>{
    const ctx = {
        departments: new Map([
            [
                'development',
                'd1'
            ],
            [
                'qa',
                'd2'
            ]
        ]),
        designations: new Map([
            [
                'software engineer',
                'g1'
            ],
            [
                'intern',
                'g2'
            ]
        ]),
        branches: new Map([
            [
                'ahmedabad',
                'b1'
            ]
        ]),
        managersByEmail: new Map([
            [
                'neha.kapoor@lexisora.com',
                'e-neha'
            ]
        ]),
        existingEmails: new Set([
            'priya.sharma@lexisora.com'
        ]),
        today: '2026-09-29'
    };
    const row = (o = {})=>({
            full_name: 'Aditya Kulkarni',
            official_email: 'aditya.kulkarni@lexisora.com',
            phone: '+91 98250 11111',
            department: 'Development',
            designation: 'Software Engineer',
            manager_email: 'neha.kapoor@lexisora.com',
            employment_type: 'Full-time',
            work_mode: 'Remote',
            joining_date: '06-10-2026',
            ...o
        });
    (0, _vitest.it)('normalises a valid row', ()=>{
        const r = (0, _peoplerules.validateCsvRow)(row(), 1, ctx);
        (0, _vitest.expect)(r.ok).toBe(true);
        (0, _vitest.expect)(r.value).toMatchObject({
            departmentId: 'd1',
            designationId: 'g1',
            managerId: 'e-neha',
            employmentType: 'FULL_TIME',
            workMode: 'REMOTE',
            joiningDate: '2026-10-06'
        });
    });
    (0, _vitest.it)('reports each invalid field with its row number', ()=>{
        const r = (0, _peoplerules.validateCsvRow)(row({
            official_email: 'bad',
            department: 'Sales',
            employment_type: 'Temp',
            joining_date: '2026/13/40',
            phone: '12'
        }), 7, ctx);
        (0, _vitest.expect)(r.ok).toBe(false);
        const fields = r.errors.map((e)=>e.field);
        (0, _vitest.expect)(fields).toEqual(_vitest.expect.arrayContaining([
            'official_email',
            'department',
            'employment_type',
            'joining_date',
            'phone'
        ]));
        (0, _vitest.expect)(r.errors.every((e)=>e.row === 7)).toBe(true);
    });
    (0, _vitest.it)('rejects existing emails and unknown managers', ()=>{
        (0, _vitest.expect)((0, _peoplerules.validateCsvRow)(row({
            official_email: 'priya.sharma@lexisora.com'
        }), 1, ctx).errors[0].message).toMatch(/already exists/);
        (0, _vitest.expect)((0, _peoplerules.validateCsvRow)(row({
            manager_email: 'nobody@lexisora.com'
        }), 1, ctx).errors[0].message).toMatch(/not found/);
    });
    (0, _vitest.it)('allows unknown masters when "Create missing masters" is ticked', ()=>{
        (0, _vitest.expect)((0, _peoplerules.validateCsvRow)(row({
            department: 'Sales'
        }), 1, {
            ...ctx,
            createMissingMasters: true
        }).ok).toBe(true);
    });
    (0, _vitest.it)('resolves managers defined in the same file and orders them first', ()=>{
        const rows = [
            row({
                official_email: 'report@lexisora.com',
                manager_email: 'lead@lexisora.com'
            }),
            row({
                official_email: 'lead@lexisora.com',
                manager_email: ''
            }),
            row({
                official_email: 'report@lexisora.com'
            }),
            row({
                official_email: 'x@lexisora.com',
                phone: '1'
            })
        ];
        const { valid, errors } = (0, _peoplerules.validateCsvRows)(rows, ctx);
        (0, _vitest.expect)(valid.map((v)=>v.officialEmail)).toEqual([
            'report@lexisora.com',
            'lead@lexisora.com'
        ]);
        (0, _vitest.expect)(errors.map((e)=>e.row)).toEqual([
            3,
            4
        ]);
        (0, _vitest.expect)((0, _peoplerules.orderByManager)(valid).map((v)=>v.officialEmail)).toEqual([
            'lead@lexisora.com',
            'report@lexisora.com'
        ]);
    });
    (0, _vitest.it)('fails a report whose in-file manager row is invalid', ()=>{
        const rows = [
            row({
                official_email: 'r@lexisora.com',
                manager_email: 'm@lexisora.com'
            }),
            row({
                official_email: 'm@lexisora.com',
                phone: 'x'
            })
        ];
        const { valid, errors } = (0, _peoplerules.validateCsvRows)(rows, ctx);
        (0, _vitest.expect)(valid).toHaveLength(0);
        (0, _vitest.expect)(errors.some((e)=>e.row === 1 && e.field === 'manager_email')).toBe(true);
    });
});
(0, _vitest.describe)('onboarding step state machine', ()=>{
    const fresh = ()=>({
            offer: 'PENDING',
            nda: 'PENDING',
            docs: 'PENDING',
            bank: 'PENDING',
            kit: 'PENDING'
        });
    (0, _vitest.it)('moves to IN_PROGRESS on the first completed step', ()=>{
        const r = (0, _peoplerules.applyOnboardingEvent)('NOT_STARTED', fresh(), {
            type: 'STEP_DONE',
            key: 'offer'
        });
        (0, _vitest.expect)(r.status).toBe('IN_PROGRESS');
        (0, _vitest.expect)(r.steps.offer).toBe('DONE');
        (0, _vitest.expect)((0, _peoplerules.currentStep)(r.steps)).toBe('nda');
    });
    (0, _vitest.it)('requires the offer letter before other steps', ()=>{
        (0, _vitest.expect)(()=>(0, _peoplerules.applyOnboardingEvent)('NOT_STARTED', fresh(), {
                type: 'STEP_DONE',
                key: 'nda'
            })).toThrow(/offer letter/);
    });
    (0, _vitest.it)('blocks Finish until steps 1-4 are done, listing what is missing', ()=>{
        const s = {
            ...fresh(),
            offer: 'DONE'
        };
        try {
            (0, _peoplerules.applyOnboardingEvent)('IN_PROGRESS', s, {
                type: 'FINISH'
            });
            throw new Error('expected failure');
        } catch (e) {
            (0, _vitest.expect)(e).toBeInstanceOf(_peoplerules.OnboardingRuleError);
            (0, _vitest.expect)(e.code).toBe('STEPS_INCOMPLETE');
            (0, _vitest.expect)(e.details).toEqual([
                'nda',
                'docs',
                'bank'
            ]);
        }
    });
    (0, _vitest.it)('the kit step is completed by Finish only', ()=>{
        const s = {
            ...fresh(),
            offer: 'DONE'
        };
        (0, _vitest.expect)(()=>(0, _peoplerules.applyOnboardingEvent)('IN_PROGRESS', s, {
                type: 'STEP_DONE',
                key: 'kit'
            })).toThrow(/Finish/);
    });
    (0, _vitest.it)('Finish submits; verification completes; rejection reopens docs', ()=>{
        let st = fresh();
        let status = 'NOT_STARTED';
        for (const k of [
            'offer',
            'nda',
            'docs',
            'bank'
        ])({ status, steps: st } = (0, _peoplerules.applyOnboardingEvent)(status, st, {
            type: 'STEP_DONE',
            key: k
        }));
        (0, _vitest.expect)((0, _peoplerules.incompleteSteps)(st)).toEqual([]);
        ({ status, steps: st } = (0, _peoplerules.applyOnboardingEvent)(status, st, {
            type: 'FINISH'
        }));
        (0, _vitest.expect)(status).toBe('SUBMITTED');
        (0, _vitest.expect)(st.kit).toBe('DONE');
        (0, _vitest.expect)(()=>(0, _peoplerules.applyOnboardingEvent)(status, st, {
                type: 'FINISH'
            })).toThrow(/already submitted/);
        (0, _vitest.expect)(()=>(0, _peoplerules.applyOnboardingEvent)(status, st, {
                type: 'STEP_DONE',
                key: 'bank'
            })).toThrow(/reopen/);
        ({ status, steps: st } = (0, _peoplerules.applyOnboardingEvent)(status, st, {
            type: 'DOC_REJECTED'
        }));
        (0, _vitest.expect)(status).toBe('IN_PROGRESS');
        (0, _vitest.expect)(st.docs).toBe('NEEDS_ATTENTION');
        (0, _vitest.expect)((0, _peoplerules.currentStep)(st)).toBe('docs');
        // ALL_VERIFIED is ignored while a step is open
        (0, _vitest.expect)((0, _peoplerules.applyOnboardingEvent)(status, st, {
            type: 'ALL_VERIFIED'
        }).status).toBe('IN_PROGRESS');
        ({ status, steps: st } = (0, _peoplerules.applyOnboardingEvent)(status, st, {
            type: 'STEP_DONE',
            key: 'docs'
        }));
        (0, _vitest.expect)(status).toBe('SUBMITTED');
        ({ status } = (0, _peoplerules.applyOnboardingEvent)(status, st, {
            type: 'ALL_VERIFIED'
        }));
        (0, _vitest.expect)(status).toBe('COMPLETED');
        (0, _vitest.expect)(()=>(0, _peoplerules.applyOnboardingEvent)('COMPLETED', st, {
                type: 'STEP_DONE',
                key: 'offer'
            })).toThrow(/already complete/);
    });
    (0, _vitest.it)('HR reopen and override', ()=>{
        const done = {
            offer: 'DONE',
            nda: 'DONE',
            docs: 'DONE',
            bank: 'DONE',
            kit: 'DONE'
        };
        const r = (0, _peoplerules.applyOnboardingEvent)('SUBMITTED', done, {
            type: 'REOPEN',
            key: 'bank'
        });
        (0, _vitest.expect)(r).toMatchObject({
            status: 'IN_PROGRESS',
            steps: {
                bank: 'NEEDS_ATTENTION'
            }
        });
        const o = (0, _peoplerules.applyOnboardingEvent)('IN_PROGRESS', {
            ...done,
            nda: 'PENDING'
        }, {
            type: 'OVERRIDE'
        });
        (0, _vitest.expect)(o.status).toBe('COMPLETED');
        (0, _vitest.expect)(o.steps.nda).toBe('SKIPPED');
        (0, _vitest.expect)(()=>(0, _peoplerules.applyOnboardingEvent)('CANCELLED', done, {
                type: 'FINISH'
            })).toThrow(/cancelled/);
    });
});
(0, _vitest.describe)('notice & exit', ()=>{
    (0, _vitest.it)('computes notice days and LWD = resignation + notice − 1', ()=>{
        (0, _vitest.expect)((0, _peoplerules.defaultNoticeDays)('FULL_TIME', '2024-01-12', '2026-09-29')).toBe(30);
        (0, _vitest.expect)((0, _peoplerules.defaultNoticeDays)('FULL_TIME', '2026-06-01', '2026-09-29')).toBe(15);
        (0, _vitest.expect)((0, _peoplerules.defaultNoticeDays)('INTERN', '2026-09-15', '2026-09-29')).toBe(7);
        (0, _vitest.expect)((0, _peoplerules.computeLwd)('2026-09-10', 30)).toEqual({
            lastWorkingDay: '2026-10-09',
            shortfallDays: 0
        });
        (0, _vitest.expect)((0, _peoplerules.computeLwd)('2026-09-10', 30, '2026-09-30')).toEqual({
            lastWorkingDay: '2026-09-30',
            shortfallDays: 9
        });
        (0, _vitest.expect)(()=>(0, _peoplerules.computeLwd)('2026-09-10', 30, '2026-09-01')).toThrow();
    });
    (0, _vitest.it)('blocks completion while assets are held or blocking items pending', ()=>{
        const items = [
            {
                key: 'ASSET_RETURN',
                status: 'PENDING',
                blocking: true
            },
            {
                key: 'IDCARD_SURRENDER',
                status: 'DONE',
                blocking: true
            },
            {
                key: 'KT_HANDOVER',
                status: 'PENDING',
                blocking: true
            },
            {
                key: 'EXIT_INTERVIEW',
                status: 'PENDING',
                blocking: false
            }
        ];
        (0, _vitest.expect)((0, _peoplerules.exitBlockers)(items, 2)).toEqual([
            '2 assets not returned',
            'Knowledge transfer & handover'
        ]);
        (0, _vitest.expect)((0, _peoplerules.exitBlockers)(items.map((i)=>({
                ...i,
                status: 'DONE'
            })), 0)).toEqual([]);
    });
});
(0, _vitest.describe)('appraisal scoring', ()=>{
    (0, _vitest.it)('weights must total 100', ()=>{
        (0, _vitest.expect)((0, _peoplerules.templateWeightsValid)([
            40,
            30,
            20
        ])).toBe(false);
        (0, _vitest.expect)((0, _peoplerules.templateWeightsValid)([
            40,
            30,
            30
        ])).toBe(true);
        (0, _vitest.expect)((0, _peoplerules.templateWeightsValid)([])).toBe(false);
    });
    (0, _vitest.it)('computes the weighted score and band', ()=>{
        const s = (0, _peoplerules.weightedScore)([
            {
                weight: 40,
                rating: 5
            },
            {
                weight: 30,
                rating: 4
            },
            {
                weight: 30,
                rating: 3
            }
        ]);
        (0, _vitest.expect)(s).toBe(4.1);
        (0, _vitest.expect)((0, _peoplerules.bandFor)(s)).toBe('Exceeds expectations');
        (0, _vitest.expect)((0, _peoplerules.bandFor)(3.9)).toBe('Exceeds expectations');
        (0, _vitest.expect)((0, _peoplerules.bandFor)(4.5)).toBe('Outstanding');
        (0, _vitest.expect)((0, _peoplerules.bandFor)(2.4)).toBe('Needs improvement');
        (0, _vitest.expect)((0, _peoplerules.weightedScore)([
            {
                weight: 50,
                rating: 4
            },
            {
                weight: 50,
                rating: null
            }
        ])).toBeNull();
    });
    (0, _vitest.it)('suggests Indian FY half-year cycle names', ()=>{
        (0, _vitest.expect)((0, _peoplerules.suggestCycleName)('2026-09-29')).toEqual({
            name: 'H1 FY26-27',
            from: '2026-04-01',
            to: '2026-09-30'
        });
        (0, _vitest.expect)((0, _peoplerules.suggestCycleName)('2026-02-10')).toEqual({
            name: 'H2 FY25-26',
            from: '2025-10-01',
            to: '2026-03-31'
        });
    });
    (0, _vitest.it)('eligibility uses tenure before period end', ()=>{
        const cyc = {
            periodTo: '2026-09-30',
            minTenureDays: 90,
            types: [
                'FULL_TIME'
            ]
        };
        (0, _vitest.expect)((0, _peoplerules.eligibleForCycle)({
            status: 'ACTIVE',
            employmentType: 'FULL_TIME',
            joiningDate: '2026-07-02'
        }, cyc)).toBe(true);
        (0, _vitest.expect)((0, _peoplerules.eligibleForCycle)({
            status: 'ACTIVE',
            employmentType: 'FULL_TIME',
            joiningDate: '2026-07-03'
        }, cyc)).toBe(false);
        (0, _vitest.expect)((0, _peoplerules.eligibleForCycle)({
            status: 'ACTIVE',
            employmentType: 'INTERN',
            joiningDate: '2026-01-01'
        }, cyc)).toBe(false);
        (0, _vitest.expect)((0, _peoplerules.eligibleForCycle)({
            status: 'NOTICE_PERIOD',
            employmentType: 'FULL_TIME',
            joiningDate: '2020-01-01'
        }, cyc)).toBe(false);
    });
});
(0, _vitest.describe)('recruitment', ()=>{
    (0, _vitest.it)('derives result from recommendations and averages scores', ()=>{
        (0, _vitest.expect)((0, _peoplerules.resultFromRecommendation)('HIRE')).toBe('SELECTED');
        (0, _vitest.expect)((0, _peoplerules.resultFromRecommendation)('STRONG_NO_HIRE')).toBe('REJECTED');
        (0, _vitest.expect)((0, _peoplerules.suggestResult)([
            'HIRE',
            'NO_HIRE'
        ])).toBe('ON_HOLD');
        (0, _vitest.expect)((0, _peoplerules.suggestResult)([
            'HIRE',
            'STRONG_HIRE',
            'NO_HIRE'
        ])).toBe('SELECTED');
        (0, _vitest.expect)((0, _peoplerules.applicationScore)([
            8.2
        ])).toBe(8.2);
        (0, _vitest.expect)((0, _peoplerules.applicationScore)([
            8,
            7.5,
            null
        ])).toBe(7.8);
        (0, _vitest.expect)((0, _peoplerules.applicationScore)([])).toBeNull();
        (0, _vitest.expect)((0, _peoplerules.overallFromRatings)([
            4,
            5,
            4
        ])).toBe(8.7);
    });
    (0, _vitest.it)('restricts stage moves', ()=>{
        (0, _vitest.expect)((0, _peoplerules.canMoveStage)('SCREENING', 'INTERVIEW')).toBe(true);
        (0, _vitest.expect)((0, _peoplerules.canMoveStage)('HIRED', 'REJECTED')).toBe(false);
        (0, _vitest.expect)((0, _peoplerules.canMoveStage)('REJECTED', 'SCREENING')).toBe(true);
    });
    (0, _vitest.it)('builds an RFC 5545 invite in IST', ()=>{
        const start = (0, _peoplerules.istDateTime)('2026-09-30', '11:00');
        (0, _vitest.expect)(start.toISOString()).toBe('2026-09-30T05:30:00.000Z');
        const ics = (0, _peoplerules.buildIcs)({
            uid: 'abc@lexisora.hrms.app',
            sequence: 1,
            method: 'REQUEST',
            start,
            durationMin: 60,
            summary: 'Interview – Aditya Kulkarni – Technical 2 (React Developer)',
            organizer: {
                name: 'Lexisora Recruiting',
                email: 'careers@lexisora.com'
            },
            attendees: [
                {
                    name: 'Aditya',
                    email: 'aditya@example.com'
                }
            ],
            now: new Date('2026-09-29T04:00:00Z')
        });
        (0, _vitest.expect)(ics).toContain('METHOD:REQUEST');
        (0, _vitest.expect)(ics).toContain('UID:abc@lexisora.hrms.app');
        (0, _vitest.expect)(ics).toContain('SEQUENCE:1');
        (0, _vitest.expect)(ics).toContain('DTSTART;TZID=Asia/Kolkata:20260930T110000');
        (0, _vitest.expect)(ics).toContain('DTEND;TZID=Asia/Kolkata:20260930T120000');
        (0, _vitest.expect)(ics).toContain('TRIGGER:-PT15M');
        (0, _vitest.expect)(ics).toContain('SUMMARY:Interview – Aditya Kulkarni – Technical 2 (React Developer)');
    });
});
(0, _vitest.describe)('assets, kits, cards', ()=>{
    (0, _vitest.it)('warranty thresholds 30 / 7 / 0 days', ()=>{
        (0, _vitest.expect)((0, _peoplerules.warrantyThreshold)('2027-01-01', '2026-12-02')).toBe(30);
        (0, _vitest.expect)((0, _peoplerules.warrantyThreshold)('2027-01-01', '2026-12-26')).toBe(7);
        (0, _vitest.expect)((0, _peoplerules.warrantyThreshold)('2027-01-01', '2027-01-01')).toBe(0);
        (0, _vitest.expect)((0, _peoplerules.warrantyThreshold)('2027-01-01', '2026-09-29')).toBeNull();
        (0, _vitest.expect)((0, _peoplerules.warrantyThreshold)(null, '2026-09-29')).toBeNull();
    });
    (0, _vitest.it)('asset state machine', ()=>{
        (0, _vitest.expect)((0, _peoplerules.canAssetMove)('IN_STOCK', 'ASSIGNED')).toBe(true);
        (0, _vitest.expect)((0, _peoplerules.canAssetMove)('ASSIGNED', 'ASSIGNED')).toBe(false);
        (0, _vitest.expect)((0, _peoplerules.canAssetMove)('RETURNED', 'UNDER_REPAIR')).toBe(true);
        (0, _vitest.expect)((0, _peoplerules.canAssetMove)('LOST', 'IN_STOCK')).toBe(false);
    });
    (0, _vitest.it)('kit status from lines', ()=>{
        (0, _vitest.expect)((0, _peoplerules.kitStatus)([
            {
                issued: false
            },
            {
                issued: false
            }
        ])).toBe('PENDING');
        (0, _vitest.expect)((0, _peoplerules.kitStatus)([
            {
                issued: true
            },
            {
                issued: false
            }
        ])).toBe('PARTIAL');
        (0, _vitest.expect)((0, _peoplerules.kitStatus)([
            {
                issued: true
            },
            {
                issued: true
            }
        ])).toBe('ISSUED');
    });
    (0, _vitest.it)('ID card completeness', ()=>{
        (0, _vitest.expect)((0, _peoplerules.idCardMissing)({
            fullName: 'Meera Iyer',
            designation: 'QA Engineer'
        }, true)).toEqual([
            'employee.photo',
            'employee.blood_group'
        ]);
        (0, _vitest.expect)((0, _peoplerules.idCardMissing)({
            fullName: 'A',
            designation: 'B',
            photoFileId: 'f',
            bloodGroup: null
        }, false)).toEqual([]);
    });
    (0, _vitest.it)('visiting card helpers', ()=>{
        (0, _vitest.expect)((0, _peoplerules.slugify)('Priya Sharma')).toBe('priya-sharma');
        const vcf = (0, _peoplerules.buildVcf)({
            name: 'Priya Sharma',
            org: 'Lexisora Infotech',
            title: 'Software Engineer',
            email: 'priya.sharma@lexisora.com',
            phone: '+91 98250 12345'
        });
        (0, _vitest.expect)(vcf).toContain('FN:Priya Sharma');
        (0, _vitest.expect)(vcf).toContain('N:Sharma;Priya;;;');
        (0, _vitest.expect)(vcf).toContain('ORG:Lexisora Infotech');
        (0, _vitest.expect)((0, _peoplerules.whatsappLink)('98250 12345', 'Hi https://x/c/p')).toBe('https://wa.me/919825012345?text=Hi%20https%3A%2F%2Fx%2Fc%2Fp');
        (0, _vitest.expect)((0, _peoplerules.whatsappLink)('', 'Hi')).toBe('https://wa.me/?text=Hi');
    });
});

//# sourceMappingURL=people.rules.spec.js.map