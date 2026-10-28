import { describe, expect, it } from 'vitest';
import { effectiveAudience, evaluatePunch, geoCheck, modeNote, trackerMode, webPunchAllowed, type LocationRules, type PolicyRules } from './policy';
import { planL1, planL2, statusAfterL1, submitMessage, type ProjectInfo } from './routing';
import {
  cellClaimed,
  cellFinal,
  chainTones,
  decidePending,
  expectedMinutes,
  isActiveTask,
  isEditableStatus,
  isQuietLine,
  leaveLabel,
  outsideHoursMinutes,
  planCellEdit,
  reanchorPending,
  reasonRequired,
  submitLabel,
} from './timesheet-calc';

// ── Approval routing (spec-time K3 + audit G3) ────────────────────────────────
const PROJECTS = new Map<string, ProjectInfo>([
  ['at', { id: 'at', name: 'Atlas CRM', isInternal: false, leadEmployeeId: 'arjun' }],
  ['ks', { id: 'ks', name: 'Kestrel mobile app', isInternal: false, leadEmployeeId: 'arjun' }],
  ['ls', { id: 'ls', name: 'Ledger sync', isInternal: false, leadEmployeeId: 'rahul' }],
  ['int', { id: 'int', name: 'Internal', isInternal: true, leadEmployeeId: 'neha' }],
  ['nolead', { id: 'nolead', name: 'Orphan', isInternal: false, leadEmployeeId: null }],
]);

describe('approval routing', () => {
  it('one L1 step per project with minutes; internal projects are skipped', () => {
    const plan = planL1('priya', [
      { projectId: 'at', minutes: 1230 },
      { projectId: 'at', minutes: 900 },
      { projectId: 'int', minutes: 150 },
    ], PROJECTS);
    expect(plan).toEqual([{ projectId: 'at', projectName: 'Atlas CRM', approverEmployeeId: 'arjun', status: 'PENDING' }]);
  });

  it('a sheet with only internal time has no L1 (goes straight to the RM)', () => {
    const plan = planL1('priya', [{ projectId: 'int', minutes: 480 }], PROJECTS);
    expect(plan).toEqual([]);
    expect(statusAfterL1(plan.map((p) => p.status))).toBe('L2');
  });

  it('self-approval is skipped when the employee leads the project', () => {
    const plan = planL1('rahul', [{ projectId: 'ls', minutes: 300 }, { projectId: 'at', minutes: 60 }], PROJECTS);
    expect(plan.find((p) => p.projectId === 'ls')!.status).toBe('SKIPPED_SELF');
    expect(plan.find((p) => p.projectId === 'at')!.status).toBe('PENDING');
    expect(statusAfterL1(plan.map((p) => p.status))).toBe('SUBMITTED');
  });

  it('projects without a lead and zero-minute lines produce no step', () => {
    expect(planL1('priya', [{ projectId: 'nolead', minutes: 120 }, { projectId: 'ks', minutes: 0 }, { projectId: null, minutes: 60 }], PROJECTS)).toEqual([]);
  });

  it('several projects → several L1 steps sorted by name', () => {
    const plan = planL1('vikram', [{ projectId: 'ks', minutes: 60 }, { projectId: 'at', minutes: 60 }], PROJECTS);
    expect(plan.map((p) => p.projectName)).toEqual(['Atlas CRM', 'Kestrel mobile app']);
  });

  it('L2 goes to the reporting manager; never to the employee', () => {
    expect(planL2({ employeeId: 'priya', managerId: 'neha', l1ApprovedBy: ['arjun'], skipDuplicateApprover: true })).toEqual({ approverEmployeeId: 'neha', status: 'PENDING' });
    expect(planL2({ employeeId: 'neha', managerId: 'neha', fallbackApproverId: 'rohit', l1ApprovedBy: [], skipDuplicateApprover: false })).toEqual({ approverEmployeeId: 'rohit', status: 'PENDING' });
    expect(planL2({ employeeId: 'rohit', managerId: null, adminEmployeeIds: ['rohit'], l1ApprovedBy: [], skipDuplicateApprover: false })).toBeNull();
  });

  it('L2 is skipped as duplicate when the RM already approved at L1 (if enabled)', () => {
    expect(planL2({ employeeId: 'vikram', managerId: 'arjun', l1ApprovedBy: ['arjun'], skipDuplicateApprover: true })!.status).toBe('SKIPPED_DUPLICATE');
    expect(planL2({ employeeId: 'vikram', managerId: 'arjun', l1ApprovedBy: ['arjun'], skipDuplicateApprover: false })!.status).toBe('PENDING');
  });

  it('submit toast copy', () => {
    expect(submitMessage(['Arjun Mehta'], 'Neha Kapoor', 'SUBMITTED')).toBe('Timesheet sent to Arjun Mehta (Project Lead)');
    expect(submitMessage(['A', 'B'], 'Neha Kapoor', 'SUBMITTED')).toBe('Sent to 2 Project Leads');
    expect(submitMessage([], 'Neha Kapoor', 'PENDING_RM')).toBe('Timesheet sent to Neha Kapoor (Reporting Manager)');
  });
});

// ── Policy resolution by work mode ────────────────────────────────────────────
const OFFICE: PolicyRules = { biometricMandatory: true, allowWebPunch: false, allowDesktopPunch: false, autoIdleEnabled: true, screenshotsEnabled: true, blurScreenshots: false, deductIdleFromPayroll: true };
const REMOTE: PolicyRules = { ...OFFICE, biometricMandatory: false, allowWebPunch: true, allowDesktopPunch: true };
const HQ: LocationRules = { name: 'Ahmedabad HQ', punchMode: 'BIOMETRIC_ONLY', isRemote: false, lat: 23.0128, lng: 72.5258, geoRadiusM: 150, geoFenceWebPunch: false };
const REMOTE_LOC: LocationRules = { name: 'Remote', punchMode: 'WEB_DESKTOP_ALLOWED', isRemote: true, lat: null, lng: null, geoRadiusM: null, geoFenceWebPunch: false };
const FENCED: LocationRules = { name: 'Client site', punchMode: 'WEB_DESKTOP_ALLOWED', isRemote: false, lat: 23.0128, lng: 72.5258, geoRadiusM: 150, geoFenceWebPunch: true };

describe('policy resolution', () => {
  it('OFFICE → OFFICE policy; REMOTE and HYBRID → REMOTE policy', () => {
    expect(effectiveAudience('OFFICE')).toBe('OFFICE');
    expect(effectiveAudience('REMOTE')).toBe('REMOTE');
    expect(effectiveAudience('HYBRID')).toBe('REMOTE');
  });
  it('overrides: WFH approval forces REMOTE; a biometric punch makes a hybrid day OFFICE', () => {
    expect(effectiveAudience('OFFICE', { wfhOverride: true })).toBe('REMOTE');
    expect(effectiveAudience('HYBRID', { biometricToday: true })).toBe('OFFICE');
  });

  it('office staff: web punch blocked with the wireframe copy', () => {
    const d = evaluatePunch({ source: 'WEB', direction: 'IN', audience: 'OFFICE', policy: OFFICE, location: HQ, openSessionSource: null });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('PUNCH_NOT_ALLOWED');
      expect(d.message).toBe('Office mode: punch in with the biometric sensor');
    }
    expect(webPunchAllowed(OFFICE, HQ)).toBe(false);
    expect(modeNote('OFFICE', OFFICE, HQ)).toBe('Office · biometric punch');
    expect(trackerMode(OFFICE, HQ)).toBe('MONITOR_ONLY');
  });

  it('remote staff: web + desktop punch allowed', () => {
    expect(evaluatePunch({ source: 'WEB', direction: 'IN', audience: 'REMOTE', policy: REMOTE, location: REMOTE_LOC, openSessionSource: null }).allowed).toBe(true);
    expect(evaluatePunch({ source: 'DESKTOP', direction: 'IN', audience: 'REMOTE', policy: REMOTE, location: REMOTE_LOC, openSessionSource: null }).allowed).toBe(true);
    expect(modeNote('REMOTE', REMOTE, REMOTE_LOC)).toBe('Remote · web punch allowed');
    expect(trackerMode(REMOTE, REMOTE_LOC)).toBe('PUNCH');
  });

  it('a biometric-only location blocks web punch even for a remote-policy employee', () => {
    const d = evaluatePunch({ source: 'WEB', direction: 'IN', audience: 'REMOTE', policy: REMOTE, location: HQ, openSessionSource: null });
    expect(d.allowed).toBe(false);
  });

  it('biometric sessions must be closed at the sensor; web/desktop sessions close cross-channel', () => {
    expect(evaluatePunch({ source: 'WEB', direction: 'OUT', audience: 'REMOTE', policy: REMOTE, location: REMOTE_LOC, openSessionSource: 'BIOMETRIC' }).allowed).toBe(false);
    expect(evaluatePunch({ source: 'WEB', direction: 'OUT', audience: 'REMOTE', policy: REMOTE, location: REMOTE_LOC, openSessionSource: 'DESKTOP' }).allowed).toBe(true);
  });

  it('geofence: required when enforced, inside passes, outside is rejected', () => {
    expect(geoCheck(REMOTE_LOC, null).geoStatus).toBe('NOT_REQUIRED');
    expect(geoCheck(FENCED, null).geoStatus).toBe('UNAVAILABLE');
    expect(geoCheck(FENCED, { lat: 23.0129, lng: 72.5259, accuracyM: 20 }).geoStatus).toBe('INSIDE');
    const out = evaluatePunch({ source: 'WEB', direction: 'IN', audience: 'REMOTE', policy: REMOTE, location: FENCED, openSessionSource: null, geo: { lat: 23.03, lng: 72.55, accuracyM: 20 } });
    expect(out.allowed).toBe(false);
    if (!out.allowed) expect(out.code).toBe('GEOFENCE_OUTSIDE');
    const noGeo = evaluatePunch({ source: 'WEB', direction: 'IN', audience: 'REMOTE', policy: REMOTE, location: FENCED, openSessionSource: null });
    expect(!noGeo.allowed && noGeo.code).toBe('GEO_REQUIRED');
  });
});

// ── Timesheet cell rules ─────────────────────────────────────────────────────
describe('timesheet cells', () => {
  const tracked = { trackedMinutes: 240, idleAsWorkMinutes: 0, outsideHoursMinutes: 0, adjustmentMinutes: 0, pendingAdjustmentMinutes: 0 };
  it('final = tracked + approved idle + outside hours + adjustment (never negative)', () => {
    expect(cellFinal({ trackedMinutes: 240, idleAsWorkMinutes: 15, outsideHoursMinutes: 90, adjustmentMinutes: -30 })).toBe(315);
    expect(cellFinal({ trackedMinutes: 10, idleAsWorkMinutes: 0, outsideHoursMinutes: 0, adjustmentMinutes: -60 })).toBe(0);
  });
  it('an increase above tracked waits for PL review and is kept out of the counted value', () => {
    const plan = planCellEdit(tracked, 270)!;
    expect(plan).toEqual({ adjustmentMinutes: 0, pendingAdjustmentMinutes: 30, fromMinutes: 240, deltaMinutes: 30, kind: 'MANUAL_INCREASE', reviewStatus: 'PENDING_PL' });
    const after = { ...tracked, adjustmentMinutes: plan.adjustmentMinutes, pendingAdjustmentMinutes: plan.pendingAdjustmentMinutes };
    expect(cellFinal(after)).toBe(240);
    expect(cellClaimed(after)).toBe(270);
  });
  it('a decrease counts straight away (no review)', () => {
    expect(planCellEdit(tracked, 200)).toEqual({ adjustmentMinutes: -40, pendingAdjustmentMinutes: 0, fromMinutes: 240, deltaMinutes: -40, kind: 'MANUAL_DECREASE', reviewStatus: 'NOT_REQUIRED' });
    expect(planCellEdit(tracked, 240)).toBeNull();
  });
  it('AT-101 case: 12:20 typed on a day with no tracker time → 0 counted, 12:20 waiting for review', () => {
    const empty = { trackedMinutes: 0, idleAsWorkMinutes: 0, outsideHoursMinutes: 0, adjustmentMinutes: 0, pendingAdjustmentMinutes: 0 };
    const plan = planCellEdit(empty, 740)!;
    expect(plan.reviewStatus).toBe('PENDING_PL');
    expect(plan.pendingAdjustmentMinutes).toBe(740);
    expect(cellFinal({ ...empty, adjustmentMinutes: plan.adjustmentMinutes })).toBe(0);
  });
  it('editing a claim that waits for review replaces it; lowering it below tracked needs no review', () => {
    const waiting = { ...tracked, pendingAdjustmentMinutes: 60 }; // claims 5:00 on 4:00 tracked
    expect(planCellEdit(waiting, 280)).toMatchObject({ adjustmentMinutes: 0, pendingAdjustmentMinutes: 40, deltaMinutes: 40, reviewStatus: 'PENDING_PL' });
    expect(planCellEdit(waiting, 230)).toMatchObject({ adjustmentMinutes: -10, pendingAdjustmentMinutes: 0, deltaMinutes: -70, kind: 'MANUAL_DECREASE', reviewStatus: 'NOT_REQUIRED' });
  });
  it('time already accepted above tracked counts; only the new part above it waits', () => {
    const accepted = { ...tracked, adjustmentMinutes: 60 }; // 5:00 counted (accepted +1:00)
    expect(planCellEdit(accepted, 330)).toMatchObject({ adjustmentMinutes: 60, pendingAdjustmentMinutes: 30, reviewStatus: 'PENDING_PL' });
    expect(planCellEdit(accepted, 270)).toMatchObject({ adjustmentMinutes: 30, pendingAdjustmentMinutes: 0, reviewStatus: 'NOT_REQUIRED' });
  });
  it('restoring tracked time after a decrease needs no review', () => {
    const lowered = { ...tracked, adjustmentMinutes: -120 };
    expect(planCellEdit(lowered, 200)).toMatchObject({ adjustmentMinutes: -40, pendingAdjustmentMinutes: 0, reviewStatus: 'NOT_REQUIRED' });
    expect(planCellEdit(lowered, 300)).toMatchObject({ adjustmentMinutes: 0, pendingAdjustmentMinutes: 60, reviewStatus: 'PENDING_PL' });
  });
  it('tracker time arriving later covers a waiting claim instead of adding to it (no double count)', () => {
    // claimed 2:00 with nothing tracked; the tracker then syncs 1:30 for the same task-day
    expect(reanchorPending({ trackedMinutes: 90, idleAsWorkMinutes: 0, outsideHoursMinutes: 0, adjustmentMinutes: 0 }, 120)).toBe(30);
    expect(reanchorPending({ trackedMinutes: 150, idleAsWorkMinutes: 0, outsideHoursMinutes: 0, adjustmentMinutes: 0 }, 120)).toBe(0);
  });
  it('accepting moves the waiting minutes into the count; rejecting drops them', () => {
    expect(decidePending({ adjustmentMinutes: 0, pendingAdjustmentMinutes: 740 }, 740, true)).toEqual({ adjustmentMinutes: 740, pendingAdjustmentMinutes: 0 });
    expect(decidePending({ adjustmentMinutes: 0, pendingAdjustmentMinutes: 740 }, 740, false)).toEqual({ adjustmentMinutes: 0, pendingAdjustmentMinutes: 0 });
    expect(decidePending({ adjustmentMinutes: 30, pendingAdjustmentMinutes: 20 }, 999, true)).toEqual({ adjustmentMinutes: 50, pendingAdjustmentMinutes: 0 });
  });
  it('empty rows hide only when the task is no longer worked on', () => {
    expect(isActiveTask('WIP')).toBe(true);
    expect(isActiveTask('ALLOTTED')).toBe(true);
    expect(isActiveTask('DEV_COMPLETED')).toBe(false);
    expect(isQuietLine({ claimed: 0, pendingIdle: 0, taskId: 't', taskStatus: 'DEV_COMPLETED' })).toBe(true);
    expect(isQuietLine({ claimed: 0, pendingIdle: 0, taskId: 't', taskStatus: 'WIP' })).toBe(false);
    expect(isQuietLine({ claimed: 15, pendingIdle: 0, taskId: 't', taskStatus: 'DONE' })).toBe(false);
    expect(isQuietLine({ claimed: 0, pendingIdle: 0, taskId: null, taskStatus: null })).toBe(false);
  });
  it('expected hours: full shift, none on off days and full leave, half on a half-day leave', () => {
    expect(expectedMinutes({ offDay: false, leaveFraction: 0, requiredMinutes: 480 })).toBe(480);
    expect(expectedMinutes({ offDay: true, leaveFraction: 0, requiredMinutes: 480 })).toBe(0);
    expect(expectedMinutes({ offDay: false, leaveFraction: 1, requiredMinutes: 480 })).toBe(0);
    expect(expectedMinutes({ offDay: false, leaveFraction: 0.5, requiredMinutes: 480 })).toBe(240);
    expect(leaveLabel({ typeCode: 'CL', fraction: 1, session: null })).toBe('Leave · CL');
    expect(leaveLabel({ typeCode: 'SL', fraction: 0.5, session: 'FIRST_HALF' })).toBe('½ leave · SL (1st half)');
  });
  it('edits to tracked time always need a reason; manual days only when above attendance', () => {
    expect(reasonRequired({ hasTrackerData: true, dayTotalAfter: 100, attendanceWorked: 480 })).toBe(true);
    expect(reasonRequired({ hasTrackerData: false, dayTotalAfter: 480, attendanceWorked: 480 })).toBe(false);
    expect(reasonRequired({ hasTrackerData: false, dayTotalAfter: 500, attendanceWorked: 480 })).toBe(true);
  });
  it('status → chain chips, button label, editability', () => {
    expect(chainTones('SUBMITTED')).toEqual(['accent', 'outline', 'neutral', 'neutral']);
    expect(chainTones('PENDING_RM')).toEqual(['accent', 'accent', 'outline', 'neutral']);
    expect(submitLabel('DRAFT')).toBe('Submit for approval');
    expect(submitLabel('SUBMITTED')).toBe('Submitted');
    expect(submitLabel('RETURNED')).toBe('Resubmit');
    expect(isEditableStatus('RETURNED')).toBe(true);
    expect(isEditableStatus('PENDING_RM')).toBe(false);
  });
  it('outside-hours entries are 15 min – 12 h', () => {
    expect(outsideHoursMinutes(600, 610).error).toBeTruthy();
    expect(outsideHoursMinutes(660, 750)).toEqual({ minutes: 90 });
    expect(outsideHoursMinutes(0, 800).error).toBeTruthy();
  });
});
