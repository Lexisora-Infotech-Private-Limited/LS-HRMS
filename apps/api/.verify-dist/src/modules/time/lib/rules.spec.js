"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _policy = require("./policy");
const _routing = require("./routing");
const _timesheetcalc = require("./timesheet-calc");
// ── Approval routing (spec-time K3 + audit G3) ────────────────────────────────
const PROJECTS = new Map([
    [
        'at',
        {
            id: 'at',
            name: 'Atlas CRM',
            isInternal: false,
            leadEmployeeId: 'arjun'
        }
    ],
    [
        'ks',
        {
            id: 'ks',
            name: 'Kestrel mobile app',
            isInternal: false,
            leadEmployeeId: 'arjun'
        }
    ],
    [
        'ls',
        {
            id: 'ls',
            name: 'Ledger sync',
            isInternal: false,
            leadEmployeeId: 'rahul'
        }
    ],
    [
        'int',
        {
            id: 'int',
            name: 'Internal',
            isInternal: true,
            leadEmployeeId: 'neha'
        }
    ],
    [
        'nolead',
        {
            id: 'nolead',
            name: 'Orphan',
            isInternal: false,
            leadEmployeeId: null
        }
    ]
]);
(0, _vitest.describe)('approval routing', ()=>{
    (0, _vitest.it)('one L1 step per project with minutes; internal projects are skipped', ()=>{
        const plan = (0, _routing.planL1)('priya', [
            {
                projectId: 'at',
                minutes: 1230
            },
            {
                projectId: 'at',
                minutes: 900
            },
            {
                projectId: 'int',
                minutes: 150
            }
        ], PROJECTS);
        (0, _vitest.expect)(plan).toEqual([
            {
                projectId: 'at',
                projectName: 'Atlas CRM',
                approverEmployeeId: 'arjun',
                status: 'PENDING'
            }
        ]);
    });
    (0, _vitest.it)('a sheet with only internal time has no L1 (goes straight to the RM)', ()=>{
        const plan = (0, _routing.planL1)('priya', [
            {
                projectId: 'int',
                minutes: 480
            }
        ], PROJECTS);
        (0, _vitest.expect)(plan).toEqual([]);
        (0, _vitest.expect)((0, _routing.statusAfterL1)(plan.map((p)=>p.status))).toBe('L2');
    });
    (0, _vitest.it)('self-approval is skipped when the employee leads the project', ()=>{
        const plan = (0, _routing.planL1)('rahul', [
            {
                projectId: 'ls',
                minutes: 300
            },
            {
                projectId: 'at',
                minutes: 60
            }
        ], PROJECTS);
        (0, _vitest.expect)(plan.find((p)=>p.projectId === 'ls').status).toBe('SKIPPED_SELF');
        (0, _vitest.expect)(plan.find((p)=>p.projectId === 'at').status).toBe('PENDING');
        (0, _vitest.expect)((0, _routing.statusAfterL1)(plan.map((p)=>p.status))).toBe('SUBMITTED');
    });
    (0, _vitest.it)('projects without a lead and zero-minute lines produce no step', ()=>{
        (0, _vitest.expect)((0, _routing.planL1)('priya', [
            {
                projectId: 'nolead',
                minutes: 120
            },
            {
                projectId: 'ks',
                minutes: 0
            },
            {
                projectId: null,
                minutes: 60
            }
        ], PROJECTS)).toEqual([]);
    });
    (0, _vitest.it)('several projects → several L1 steps sorted by name', ()=>{
        const plan = (0, _routing.planL1)('vikram', [
            {
                projectId: 'ks',
                minutes: 60
            },
            {
                projectId: 'at',
                minutes: 60
            }
        ], PROJECTS);
        (0, _vitest.expect)(plan.map((p)=>p.projectName)).toEqual([
            'Atlas CRM',
            'Kestrel mobile app'
        ]);
    });
    (0, _vitest.it)('L2 goes to the reporting manager; never to the employee', ()=>{
        (0, _vitest.expect)((0, _routing.planL2)({
            employeeId: 'priya',
            managerId: 'neha',
            l1ApprovedBy: [
                'arjun'
            ],
            skipDuplicateApprover: true
        })).toEqual({
            approverEmployeeId: 'neha',
            status: 'PENDING'
        });
        (0, _vitest.expect)((0, _routing.planL2)({
            employeeId: 'neha',
            managerId: 'neha',
            fallbackApproverId: 'rohit',
            l1ApprovedBy: [],
            skipDuplicateApprover: false
        })).toEqual({
            approverEmployeeId: 'rohit',
            status: 'PENDING'
        });
        (0, _vitest.expect)((0, _routing.planL2)({
            employeeId: 'rohit',
            managerId: null,
            adminEmployeeIds: [
                'rohit'
            ],
            l1ApprovedBy: [],
            skipDuplicateApprover: false
        })).toBeNull();
    });
    (0, _vitest.it)('L2 is skipped as duplicate when the RM already approved at L1 (if enabled)', ()=>{
        (0, _vitest.expect)((0, _routing.planL2)({
            employeeId: 'vikram',
            managerId: 'arjun',
            l1ApprovedBy: [
                'arjun'
            ],
            skipDuplicateApprover: true
        }).status).toBe('SKIPPED_DUPLICATE');
        (0, _vitest.expect)((0, _routing.planL2)({
            employeeId: 'vikram',
            managerId: 'arjun',
            l1ApprovedBy: [
                'arjun'
            ],
            skipDuplicateApprover: false
        }).status).toBe('PENDING');
    });
    (0, _vitest.it)('submit toast copy', ()=>{
        (0, _vitest.expect)((0, _routing.submitMessage)([
            'Arjun Mehta'
        ], 'Neha Kapoor', 'SUBMITTED')).toBe('Timesheet sent to Arjun Mehta (Project Lead)');
        (0, _vitest.expect)((0, _routing.submitMessage)([
            'A',
            'B'
        ], 'Neha Kapoor', 'SUBMITTED')).toBe('Sent to 2 Project Leads');
        (0, _vitest.expect)((0, _routing.submitMessage)([], 'Neha Kapoor', 'PENDING_RM')).toBe('Timesheet sent to Neha Kapoor (Reporting Manager)');
    });
});
// ── Policy resolution by work mode ────────────────────────────────────────────
const OFFICE = {
    biometricMandatory: true,
    allowWebPunch: false,
    allowDesktopPunch: false,
    autoIdleEnabled: true,
    screenshotsEnabled: true,
    blurScreenshots: false,
    deductIdleFromPayroll: true
};
const REMOTE = {
    ...OFFICE,
    biometricMandatory: false,
    allowWebPunch: true,
    allowDesktopPunch: true
};
const HQ = {
    name: 'Ahmedabad HQ',
    punchMode: 'BIOMETRIC_ONLY',
    isRemote: false,
    lat: 23.0128,
    lng: 72.5258,
    geoRadiusM: 150,
    geoFenceWebPunch: false
};
const REMOTE_LOC = {
    name: 'Remote',
    punchMode: 'WEB_DESKTOP_ALLOWED',
    isRemote: true,
    lat: null,
    lng: null,
    geoRadiusM: null,
    geoFenceWebPunch: false
};
const FENCED = {
    name: 'Client site',
    punchMode: 'WEB_DESKTOP_ALLOWED',
    isRemote: false,
    lat: 23.0128,
    lng: 72.5258,
    geoRadiusM: 150,
    geoFenceWebPunch: true
};
(0, _vitest.describe)('policy resolution', ()=>{
    (0, _vitest.it)('OFFICE → OFFICE policy; REMOTE and HYBRID → REMOTE policy', ()=>{
        (0, _vitest.expect)((0, _policy.effectiveAudience)('OFFICE')).toBe('OFFICE');
        (0, _vitest.expect)((0, _policy.effectiveAudience)('REMOTE')).toBe('REMOTE');
        (0, _vitest.expect)((0, _policy.effectiveAudience)('HYBRID')).toBe('REMOTE');
    });
    (0, _vitest.it)('overrides: WFH approval forces REMOTE; a biometric punch makes a hybrid day OFFICE', ()=>{
        (0, _vitest.expect)((0, _policy.effectiveAudience)('OFFICE', {
            wfhOverride: true
        })).toBe('REMOTE');
        (0, _vitest.expect)((0, _policy.effectiveAudience)('HYBRID', {
            biometricToday: true
        })).toBe('OFFICE');
    });
    (0, _vitest.it)('office staff: web punch blocked with the wireframe copy', ()=>{
        const d = (0, _policy.evaluatePunch)({
            source: 'WEB',
            direction: 'IN',
            audience: 'OFFICE',
            policy: OFFICE,
            location: HQ,
            openSessionSource: null
        });
        (0, _vitest.expect)(d.allowed).toBe(false);
        if (!d.allowed) {
            (0, _vitest.expect)(d.code).toBe('PUNCH_NOT_ALLOWED');
            (0, _vitest.expect)(d.message).toBe('Office mode: punch in with the biometric sensor');
        }
        (0, _vitest.expect)((0, _policy.webPunchAllowed)(OFFICE, HQ)).toBe(false);
        (0, _vitest.expect)((0, _policy.modeNote)('OFFICE', OFFICE, HQ)).toBe('Office · biometric punch');
        (0, _vitest.expect)((0, _policy.trackerMode)(OFFICE, HQ)).toBe('MONITOR_ONLY');
    });
    (0, _vitest.it)('remote staff: web + desktop punch allowed', ()=>{
        (0, _vitest.expect)((0, _policy.evaluatePunch)({
            source: 'WEB',
            direction: 'IN',
            audience: 'REMOTE',
            policy: REMOTE,
            location: REMOTE_LOC,
            openSessionSource: null
        }).allowed).toBe(true);
        (0, _vitest.expect)((0, _policy.evaluatePunch)({
            source: 'DESKTOP',
            direction: 'IN',
            audience: 'REMOTE',
            policy: REMOTE,
            location: REMOTE_LOC,
            openSessionSource: null
        }).allowed).toBe(true);
        (0, _vitest.expect)((0, _policy.modeNote)('REMOTE', REMOTE, REMOTE_LOC)).toBe('Remote · web punch allowed');
        (0, _vitest.expect)((0, _policy.trackerMode)(REMOTE, REMOTE_LOC)).toBe('PUNCH');
    });
    (0, _vitest.it)('a biometric-only location blocks web punch even for a remote-policy employee', ()=>{
        const d = (0, _policy.evaluatePunch)({
            source: 'WEB',
            direction: 'IN',
            audience: 'REMOTE',
            policy: REMOTE,
            location: HQ,
            openSessionSource: null
        });
        (0, _vitest.expect)(d.allowed).toBe(false);
    });
    (0, _vitest.it)('biometric sessions must be closed at the sensor; web/desktop sessions close cross-channel', ()=>{
        (0, _vitest.expect)((0, _policy.evaluatePunch)({
            source: 'WEB',
            direction: 'OUT',
            audience: 'REMOTE',
            policy: REMOTE,
            location: REMOTE_LOC,
            openSessionSource: 'BIOMETRIC'
        }).allowed).toBe(false);
        (0, _vitest.expect)((0, _policy.evaluatePunch)({
            source: 'WEB',
            direction: 'OUT',
            audience: 'REMOTE',
            policy: REMOTE,
            location: REMOTE_LOC,
            openSessionSource: 'DESKTOP'
        }).allowed).toBe(true);
    });
    (0, _vitest.it)('geofence: required when enforced, inside passes, outside is rejected', ()=>{
        (0, _vitest.expect)((0, _policy.geoCheck)(REMOTE_LOC, null).geoStatus).toBe('NOT_REQUIRED');
        (0, _vitest.expect)((0, _policy.geoCheck)(FENCED, null).geoStatus).toBe('UNAVAILABLE');
        (0, _vitest.expect)((0, _policy.geoCheck)(FENCED, {
            lat: 23.0129,
            lng: 72.5259,
            accuracyM: 20
        }).geoStatus).toBe('INSIDE');
        const out = (0, _policy.evaluatePunch)({
            source: 'WEB',
            direction: 'IN',
            audience: 'REMOTE',
            policy: REMOTE,
            location: FENCED,
            openSessionSource: null,
            geo: {
                lat: 23.03,
                lng: 72.55,
                accuracyM: 20
            }
        });
        (0, _vitest.expect)(out.allowed).toBe(false);
        if (!out.allowed) (0, _vitest.expect)(out.code).toBe('GEOFENCE_OUTSIDE');
        const noGeo = (0, _policy.evaluatePunch)({
            source: 'WEB',
            direction: 'IN',
            audience: 'REMOTE',
            policy: REMOTE,
            location: FENCED,
            openSessionSource: null
        });
        (0, _vitest.expect)(!noGeo.allowed && noGeo.code).toBe('GEO_REQUIRED');
    });
});
// ── Timesheet cell rules ─────────────────────────────────────────────────────
(0, _vitest.describe)('timesheet cells', ()=>{
    const tracked = {
        trackedMinutes: 240,
        idleAsWorkMinutes: 0,
        outsideHoursMinutes: 0,
        adjustmentMinutes: 0
    };
    (0, _vitest.it)('final = tracked + approved idle + outside hours + adjustment (never negative)', ()=>{
        (0, _vitest.expect)((0, _timesheetcalc.cellFinal)({
            trackedMinutes: 240,
            idleAsWorkMinutes: 15,
            outsideHoursMinutes: 90,
            adjustmentMinutes: -30
        })).toBe(315);
        (0, _vitest.expect)((0, _timesheetcalc.cellFinal)({
            trackedMinutes: 10,
            idleAsWorkMinutes: 0,
            outsideHoursMinutes: 0,
            adjustmentMinutes: -60
        })).toBe(0);
    });
    (0, _vitest.it)('an increase above tracked goes to PL review; a decrease does not', ()=>{
        (0, _vitest.expect)((0, _timesheetcalc.planCellEdit)(tracked, 270)).toEqual({
            adjustmentMinutes: 30,
            deltaMinutes: 30,
            kind: 'MANUAL_INCREASE',
            reviewStatus: 'PENDING_PL'
        });
        (0, _vitest.expect)((0, _timesheetcalc.planCellEdit)(tracked, 200)).toEqual({
            adjustmentMinutes: -40,
            deltaMinutes: -40,
            kind: 'MANUAL_DECREASE',
            reviewStatus: 'NOT_REQUIRED'
        });
        (0, _vitest.expect)((0, _timesheetcalc.planCellEdit)(tracked, 240)).toBeNull();
    });
    (0, _vitest.it)('edits to tracked time always need a reason; manual days only when above attendance', ()=>{
        (0, _vitest.expect)((0, _timesheetcalc.reasonRequired)({
            hasTrackerData: true,
            dayTotalAfter: 100,
            attendanceWorked: 480
        })).toBe(true);
        (0, _vitest.expect)((0, _timesheetcalc.reasonRequired)({
            hasTrackerData: false,
            dayTotalAfter: 480,
            attendanceWorked: 480
        })).toBe(false);
        (0, _vitest.expect)((0, _timesheetcalc.reasonRequired)({
            hasTrackerData: false,
            dayTotalAfter: 500,
            attendanceWorked: 480
        })).toBe(true);
    });
    (0, _vitest.it)('status → chain chips, button label, editability', ()=>{
        (0, _vitest.expect)((0, _timesheetcalc.chainTones)('SUBMITTED')).toEqual([
            'accent',
            'outline',
            'neutral',
            'neutral'
        ]);
        (0, _vitest.expect)((0, _timesheetcalc.chainTones)('PENDING_RM')).toEqual([
            'accent',
            'accent',
            'outline',
            'neutral'
        ]);
        (0, _vitest.expect)((0, _timesheetcalc.submitLabel)('DRAFT')).toBe('Submit for approval');
        (0, _vitest.expect)((0, _timesheetcalc.submitLabel)('SUBMITTED')).toBe('Submitted');
        (0, _vitest.expect)((0, _timesheetcalc.submitLabel)('RETURNED')).toBe('Resubmit');
        (0, _vitest.expect)((0, _timesheetcalc.isEditableStatus)('RETURNED')).toBe(true);
        (0, _vitest.expect)((0, _timesheetcalc.isEditableStatus)('PENDING_RM')).toBe(false);
    });
    (0, _vitest.it)('outside-hours entries are 15 min – 12 h', ()=>{
        (0, _vitest.expect)((0, _timesheetcalc.outsideHoursMinutes)(600, 610).error).toBeTruthy();
        (0, _vitest.expect)((0, _timesheetcalc.outsideHoursMinutes)(660, 750)).toEqual({
            minutes: 90
        });
        (0, _vitest.expect)((0, _timesheetcalc.outsideHoursMinutes)(0, 800).error).toBeTruthy();
    });
});

//# sourceMappingURL=rules.spec.js.map