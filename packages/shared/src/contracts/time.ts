import { z } from 'zod';

/**
 * Shared request/response contracts for the time domain (attendance, shifts, locations,
 * attendance policy, holidays, ID compliance, biometric, timesheets, approvals,
 * regularizations, period locks).
 */

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const monthKey = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const intish = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const TIME_DAY_STATUSES = [
  'PENDING', 'PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HALF_DAY_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'HOLIDAY_WORKED', 'WEEKLY_OFF_WORKED', 'MISSED_PUNCH',
] as const;
export type TimeDayStatus = (typeof TIME_DAY_STATUSES)[number];
export type TimePunchSource = 'BIOMETRIC' | 'WEB' | 'DESKTOP' | 'MOBILE' | 'REGULARIZATION' | 'SYSTEM';
export type TimesheetStatusKey = 'DRAFT' | 'SUBMITTED' | 'PENDING_RM' | 'APPROVED' | 'RETURNED' | 'LOCKED';

/** Wireframe labels for attendance day status tags. */
export const DAY_STATUS_LABEL: Record<TimeDayStatus, string> = {
  PENDING: 'In progress',
  PRESENT: 'Present',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  LEAVE: 'Leave',
  HALF_DAY_LEAVE: 'Half-day leave',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly off',
  HOLIDAY_WORKED: 'Holiday worked',
  WEEKLY_OFF_WORKED: 'Weekly off worked',
  MISSED_PUNCH: 'Missed punch',
};
export const PUNCH_SOURCE_LABEL: Record<TimePunchSource, string> = {
  BIOMETRIC: 'Biometric',
  WEB: 'Web',
  DESKTOP: 'Desktop',
  MOBILE: 'Mobile',
  REGULARIZATION: 'Regularized',
  SYSTEM: 'System',
};
export const TIMESHEET_STATUS_LABEL: Record<TimesheetStatusKey, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Pending PL',
  PENDING_RM: 'Pending RM',
  APPROVED: 'Approved',
  RETURNED: 'Returned',
  LOCKED: 'Locked',
};

// ── Punch ─────────────────────────────────────────────────────────────────────
const lateReasonText = z.string().trim().min(5, 'Say why you are late (at least 5 characters)').max(300);
export const punchSchema = z.object({
  direction: z.enum(['IN', 'OUT']).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().min(0).max(100000).optional(),
  /** Why the punch-in is late (asked by the "You're late" dialog after a LATE_REASON_REQUIRED reply). */
  lateReason: lateReasonText.optional(),
  /** "I understand" on a late beyond the month's limit (LATE_CONFIRM_REQUIRED): the first half becomes half-day leave. */
  lateAck: z.boolean().optional(),
});
export type PunchInput = z.infer<typeof punchSchema>;
/** Add / change the late reason of a day afterwards (biometric and desktop punches can't ask). */
export const lateReasonSchema = z.object({ reason: lateReasonText });

/**
 * 422 LATE_REASON_REQUIRED details: a web punch-in after shift start + grace, within the month's
 * allowed number of lates — the web asks for a reason (the permission) and re-sends with `lateReason`.
 * 422 LATE_CONFIRM_REQUIRED: a late beyond the month's limit — no permission is asked; the web shows
 * the consequence (first half = half-day leave) and re-sends with `lateAck` (reason optional).
 */
export type LatePrompt = {
  punchAt: string; // HH:MM
  shiftStart: string; // HH:MM (mid-shift when the first half is a planned leave)
  graceMinutes: number;
  lateAfter: string; // HH:MM
  lateByMinutes: number;
  /** The first half becomes a half day (late by the shift's half-day threshold, or over the month's limit). */
  halfDay: boolean;
  halfDayAfterMinutes: number | null;
  /** This would be late arrival number `lateCount` this month. */
  lateCount: number;
  /** Lates allowed a month on this shift (0 = no limit). */
  lateAllowed: number;
  /** Beyond the month's limit: a notice to acknowledge, not a permission request. */
  overLimit: boolean;
  /** A reason must be typed (within the limit, when HR asks for reasons). */
  reasonRequired: boolean;
  /** What this late arrival costs, in words (late mark / half-day leave …). */
  consequence: string;
};

/** Today's lateness for the punch card (null fields before the first punch-in). */
export type TodayLate = {
  workingDay: boolean;
  shiftStart: string;
  graceMinutes: number;
  lateAfter: string;
  halfDayAfterMinutes: number | null;
  reasonRequired: boolean;
  isLate: boolean;
  lateByMinutes: number;
  lateHalfDay: boolean;
  reason: string | null;
  /** Today is late arrival number `lateCount` this month (0 when not late). */
  lateCount: number;
  /** Lates allowed a month on this shift (0 = no limit). */
  lateAllowed: number;
  /** Today's late is beyond the limit (first half = half-day leave). */
  lateOverLimit: boolean;
};

export type AttendanceToday = {
  state: 'IN' | 'OUT';
  title: 'Not punched in' | 'Punched in' | 'Punched out' | 'On break';
  openSessionStart: string | null;
  openSessionSource: TimePunchSource | null;
  workedSecondsClosed: number;
  serverNow: string;
  shift: { id: string | null; name: string; start: string; end: string };
  effectiveMode: 'OFFICE' | 'REMOTE';
  workMode: 'OFFICE' | 'REMOTE' | 'HYBRID';
  location: { id: string | null; name: string };
  webPunchAllowed: boolean;
  canPunchOut: boolean;
  blockReason: string | null;
  modeNote: string;
  modeChip: string;
  trackerRequired: boolean;
  idleThresholdMinutes: number;
  /** The web app should watch for idle: auto-idle on, a non-desktop session open, no tracker data today. */
  webIdleWatch: boolean;
  late: TodayLate;
};
export type PunchResult = { ok: true; direction: 'IN' | 'OUT'; at: string; source: TimePunchSource; message: string; today: AttendanceToday };

// ── Web idle (no input ≥ autoIdleMinutes while punched in) ────────────────────
export const IDLE_SPAN_REASONS = ['BREAK', 'MEETING', 'OTHER'] as const;
export type IdleSpanReason = (typeof IDLE_SPAN_REASONS)[number];
export const IDLE_SPAN_REASON_LABEL: Record<IdleSpanReason, string> = { BREAK: 'Break', MEETING: 'Meeting', OTHER: 'Other' };

export const idleSpanSchema = z
  .object({
    clientId: z.string().uuid(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    reason: z.enum(IDLE_SPAN_REASONS),
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.reason !== 'OTHER' || (v.note?.length ?? 0) >= 3, { message: 'Type the reason (at least 3 characters)', path: ['note'] });
export type IdleSpanInput = z.infer<typeof idleSpanSchema>;
export type IdleSpanResult = { ok: true; saved: boolean; minutes: number; message: string };

export type AttendanceDayRow = {
  id: string | null;
  date: string;
  dateLabel: string;
  in: string | null;
  out: string | null;
  source: string | null;
  breakMinutes: number;
  idleMinutes: number;
  workedMinutes: number;
  status: TimeDayStatus;
  statusLabel: string;
  isToday: boolean;
  isLate: boolean;
  lateByMinutes: number;
  /** Late by the shift's half-day threshold → the first half is a half day (leave when the policy says so). */
  lateHalfDay: boolean;
  lateReason: string | null;
  /** The employee can still add / change the late reason (own day, late, not locked, inside the correction window). */
  canAddLateReason: boolean;
  isEarlyOut: boolean;
  /** MISSED_PUNCH: start (HH:MM) of the session that was never punched out. */
  openSince: string | null;
  holidayName: string | null;
  leaveTypeCode: string | null;
  isLocked: boolean;
  overridden: boolean;
  pendingRegularization: boolean;
  canRegularize: boolean;
};
export type AttendanceMonthSummary = {
  month: string;
  presentDays: number;
  /** Every late arrival this month (excused ones and absent days aside), including ones that became half days. */
  lateMarks: number;
  activeMinutes: number;
  idleMinutes: number;
  leaveDays: number;
  workingDays: number;
  absentDays: number;
  missedPunchDays: number;
  idleDeductibleMinutes: number;
  /** Days the month's late marks cost so far (taken from CL, then LOP, when payroll is finalized). */
  latePenaltyDays: number;
  /** Late days charged as half days (late by the half-day threshold, or beyond the month's limit). */
  lateHalfDays: number;
  /** The rules behind the figures, for the explanation under them. */
  lateRules: { allowedMarks: number; allowedFrom: string | null; marksPerPenalty: number; penaltyDays: number; source: 'LEAVE_THEN_LOP' | 'LOP' | 'NONE'; graceMinutes: number; halfDayAfterMinutes: number | null; halfDayAsLeave: boolean };
  /** Corrections left this month (maxRegularizationsPerMonth − used). */
  correctionsLeft: number;
};
export type AttendanceMonth = {
  employee: { id: string; name: string; empCode: string; workMode: string };
  summary: AttendanceMonthSummary;
  days: AttendanceDayRow[];
  locked: boolean;
};
/** missing = a session that was never punched out (auto-closed at shift end). */
export type TimelineSegment = { kind: 'active' | 'break' | 'idle' | 'missing'; start: string; end: string; label: string };
export type AttendanceTimeline = {
  date: string;
  axisStart: string;
  axisEnd: string;
  ticks: string[];
  segments: TimelineSegment[];
  idleThresholdMinutes: number;
  source: 'tracker' | 'sessions' | 'none';
  /** Expected start (ISO) and lateness, for the "before punch-in" part of the strip. */
  expectedStart: string;
  lateAfter: string;
  firstIn: string | null;
  lateByMinutes: number;
  workingDay: boolean;
};

export type TeamTodayRow = {
  employeeId: string;
  name: string;
  empCode: string;
  department: string | null;
  workMode: string;
  status: string;
  in: string | null;
  out: string | null;
  source: string | null;
  isLate: boolean;
  lateByMinutes: number;
  lateHalfDay: boolean;
  lateReason: string | null;
};
export type TeamToday = { date: string; counts: { present: number; late: number; absent: number; onLeave: number; notYetIn: number; total: number }; rows: TeamTodayRow[] };

export const dayOverrideSchema = z.object({
  status: z.enum(TIME_DAY_STATUSES),
  presentFraction: z.number().min(0).max(1),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});
export type DayOverrideInput = z.infer<typeof dayOverrideSchema>;

export const recomputeSchema = z.object({
  employeeIds: z.array(z.string()).optional(),
  from: dateKey,
  to: dateKey,
});

// ── Regularization ────────────────────────────────────────────────────────────
export const REGULARIZATION_TYPES = ['MISSED_PUNCH', 'WRONG_TIME', 'WFH_FORGOT', 'ON_DUTY', 'LATE_EXCUSE'] as const;
export const REGULARIZATION_TYPE_LABEL: Record<(typeof REGULARIZATION_TYPES)[number], string> = {
  MISSED_PUNCH: 'Missed punch',
  WRONG_TIME: 'Wrong time',
  WFH_FORGOT: 'Worked from home (forgot to punch)',
  ON_DUTY: 'On duty (client visit)',
  LATE_EXCUSE: 'Excuse late mark',
};
export const regularizationSchema = z
  .object({
    date: dateKey,
    type: z.enum(REGULARIZATION_TYPES),
    correctedIn: hhmm.optional().nullable(),
    correctedOut: hhmm.optional().nullable(),
    reason: z.string().trim().min(10, 'Reason must be at least 10 characters').max(1000),
    attachmentFileId: z.string().optional().nullable(),
  })
  .refine((v) => v.type === 'LATE_EXCUSE' || !!v.correctedIn || !!v.correctedOut, { message: 'Enter the corrected in or out time', path: ['correctedIn'] });
export type RegularizationInput = z.infer<typeof regularizationSchema>;
export const decisionCommentSchema = z.object({ comment: z.string().trim().max(1000).optional().nullable() });
export const rejectCommentSchema = z.object({ comment: z.string().trim().min(5, 'Add a comment (at least 5 characters)').max(1000) });
export type RegularizationRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  dateLabel: string;
  type: string;
  typeLabel: string;
  requestedIn: string | null;
  requestedOut: string | null;
  reason: string;
  status: string;
  approverName: string | null;
  decidedByName: string | null;
  decisionComment: string | null;
  createdAt: string;
  devicePunchesNow: boolean;
  attachmentFileId: string | null;
  /** What was recorded before the correction (HH:MM), for the approver. */
  recordedIn: string | null;
  recordedOut: string | null;
};

// ── Shifts ────────────────────────────────────────────────────────────────────
export const shiftSchema = z.object({
  name: z.string().trim().min(1, 'Shift name is required').max(60),
  start: hhmm,
  end: hhmm,
  graceMinutes: intish(0, 120),
  breakMinutes: intish(0, 240),
  weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(6, 'Keep at least one working day'),
  minFullDayMinutes: intish(60, 1440).optional(),
  minHalfDayMinutes: intish(30, 1440).optional(),
  /** Late by this many minutes or more (from shift start) → half day. null / 0 = off. */
  halfDayIfLateByMinutes: intish(0, 600).optional().nullable(),
  /** Late marks a month that cost nothing before the late-mark penalty starts. */
  lateMarksAllowed: intish(0, 31).optional(),
  /** Leaving this many minutes before shift end still isn't an early out. */
  earlyOutGraceMinutes: intish(0, 240).optional(),
  isDefault: z.boolean().optional(),
});
export type ShiftInput = z.infer<typeof shiftSchema>;
export const allocateShiftSchema = z.object({
  employeeIds: z.array(z.string()).min(1, 'Select employees'),
  shiftId: z.string().min(1),
  effectiveFrom: dateKey,
  effectiveTo: dateKey.optional().nullable(),
});
export type AllocateShiftInput = z.infer<typeof allocateShiftSchema>;
export type ShiftRow = { id: string; name: string; timing: string; start: string; end: string; startMinute: number; endMinute: number; graceMinutes: number; breakMinutes: number; weeklyOffDays: number[]; weeklyOff: string; employees: number; isDefault: boolean; minFullDayMinutes: number; minHalfDayMinutes: number; halfDayIfLateByMinutes: number | null; earlyOutGraceMinutes: number; lateMarksAllowed: number; lateMarksAllowedFrom: string | null };
export type ShiftAllocationRow = { id: string; employeeId: string; employeeName: string; department: string | null; shiftId: string; shiftName: string; from: string; to: string | null; allocatedBy: string | null; current: boolean };

// ── Locations ─────────────────────────────────────────────────────────────────
export const locationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  address: z.string().trim().max(500).optional().nullable(),
  geoRadiusM: z.coerce.number().int().min(25, 'Radius must be 25–5000 m').max(5000, 'Radius must be 25–5000 m').optional().nullable(),
  punchMode: z.enum(['BIOMETRIC_ONLY', 'WEB_DESKTOP_ALLOWED']),
  lat: z.coerce.number().min(-90).max(90).optional().nullable(),
  lng: z.coerce.number().min(-180).max(180).optional().nullable(),
  geoFenceWebPunch: z.boolean().optional(),
});
export type LocationInput = z.infer<typeof locationSchema>;
export const assignLocationSchema = z.object({ employeeIds: z.array(z.string()).min(1, 'Select employees') });
export type LocationRow = { id: string; name: string; address: string | null; geoRadiusM: number | null; geoRadius: string; punchMode: string; punchModeLabel: string; isRemote: boolean; isSystem: boolean; employees: number; lat: number | null; lng: number | null; geoFenceWebPunch: boolean };
export type LocationDetail = LocationRow & { employeeList: { id: string; name: string; empCode: string; department: string | null; workMode: string }[]; devices: BiometricDeviceRow[] };

// ── Attendance policy ─────────────────────────────────────────────────────────
export const POLICY_BOOL_FIELDS = ['biometricMandatory', 'allowWebPunch', 'allowDesktopPunch', 'autoIdleEnabled', 'screenshotsEnabled', 'blurScreenshots', 'deductIdleFromPayroll', 'earlyOutCountsAsLate', 'lateReasonRequired', 'lateHalfDayAsLeave', 'timesheetRequired', 'trackerRequired', 'punchInReminder'] as const;
export const policyPatchSchema = z.object({
  expectedVersion: z.number().int().optional(),
  biometricMandatory: z.boolean().optional(),
  allowWebPunch: z.boolean().optional(),
  allowDesktopPunch: z.boolean().optional(),
  autoIdleEnabled: z.boolean().optional(),
  autoIdleMinutes: intish(1, 60).optional(),
  screenshotsEnabled: z.boolean().optional(),
  screenshotIntervalMinutes: intish(5, 60).optional(),
  blurScreenshots: z.boolean().optional(),
  deductIdleFromPayroll: z.boolean().optional(),
  monthlyIdleAllowanceMinutes: intish(0, 600).optional(),
  breakReminderMinutes: intish(0, 480).optional(),
  offlineRetentionDays: intish(1, 30).optional(),
  screenshotRetentionDays: intish(7, 365).optional(),
  idleDeductionMode: z.enum(['SHORTFALL_ONLY', 'ALL_IDLE']).optional(),
  lateMarksPerPenalty: intish(1, 31).optional(),
  latePenaltyDays: z.coerce.number().min(0).max(5).optional(),
  latePenaltySource: z.enum(['LEAVE_THEN_LOP', 'LOP', 'NONE']).optional(),
  earlyOutCountsAsLate: z.boolean().optional(),
  lateReasonRequired: z.boolean().optional(),
  lateHalfDayAsLeave: z.boolean().optional(),
  missedPunchAutoCloseHours: intish(1, 24).optional(),
  maxRegularizationsPerMonth: intish(0, 31).optional(),
  regularizationWindowDays: intish(1, 60).optional(),
  timesheetRequired: z.boolean().optional(),
  trackerRequired: z.boolean().optional(),
  punchInReminder: z.boolean().optional(),
});
export type PolicyPatch = z.infer<typeof policyPatchSchema>;
export type AttendancePolicyDto = {
  audience: 'OFFICE' | 'REMOTE';
  biometricMandatory: boolean;
  allowWebPunch: boolean;
  allowDesktopPunch: boolean;
  autoIdleEnabled: boolean;
  autoIdleMinutes: number;
  screenshotsEnabled: boolean;
  screenshotIntervalMinutes: number;
  blurScreenshots: boolean;
  deductIdleFromPayroll: boolean;
  monthlyIdleAllowanceMinutes: number;
  breakReminderMinutes: number;
  offlineRetentionDays: number;
  screenshotRetentionDays: number;
  idleDeductionMode: 'SHORTFALL_ONLY' | 'ALL_IDLE';
  lateMarksPerPenalty: number;
  latePenaltyDays: number;
  latePenaltySource: 'LEAVE_THEN_LOP' | 'LOP' | 'NONE';
  earlyOutCountsAsLate: boolean;
  lateReasonRequired: boolean;
  lateHalfDayAsLeave: boolean;
  /** Late half days become leave from this date (set when the rule is switched on). */
  lateHalfDayLeaveFrom: string;
  missedPunchAutoCloseHours: number;
  maxRegularizationsPerMonth: number;
  regularizationWindowDays: number;
  timesheetRequired: boolean;
  trackerRequired: boolean;
  punchInReminder: boolean;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
};
export type PolicyUpdateResult = { policy: AttendancePolicyDto; pushedTo: number; autoCleared: string[] };
export type EffectivePolicy = {
  audience: 'OFFICE' | 'REMOTE';
  webPunchAllowed: boolean;
  desktopPunchAllowed: boolean;
  trackerMode: 'PUNCH' | 'MONITOR_ONLY' | 'DISABLED';
  blockReason: string | null;
  policy: AttendancePolicyDto;
  shift: { name: string; start: string; end: string };
};

// ── Holidays ──────────────────────────────────────────────────────────────────
export const holidaySchema = z.object({
  date: dateKey,
  endDate: dateKey.optional().nullable(),
  name: z.string().trim().min(1, 'Holiday name is required').max(80),
  type: z.enum(['MANDATORY', 'OPTIONAL']).default('MANDATORY'),
  calendar: z.string().trim().max(60).optional().nullable(),
  locationIds: z.array(z.string()).optional(),
});
export type HolidayInput = z.infer<typeof holidaySchema>;
/**
 * Two holidays on the same date clash when their locations overlap (empty locationIds = every
 * location). A Gujarat holiday for Ahmedabad and a Maharashtra one for Pune on one date don't.
 */
export function holidayLocationsOverlap(a: readonly string[], b: readonly string[]): boolean {
  return !a.length || !b.length || a.some((x) => b.includes(x));
}
export const holidayImportSchema = z.object({ year: z.coerce.number().int().min(2000).max(2100), calendar: z.enum(['National', 'Gujarat', 'Maharashtra']) });
export const holidayCopySchema = z.object({ fromYear: z.coerce.number().int(), toYear: z.coerce.number().int() });
export type HolidayRow = { id: string; date: string; dateLabel: string; weekday: string; name: string; type: 'MANDATORY' | 'OPTIONAL'; calendar: string; locations: string; locationIds: string[] };
/** Grouped for "Upcoming" lists: Diwali 8–9 Nov. */
export type HolidayGroup = { name: string; from: string; to: string; label: string; days: number; type: string };

// ── ID card compliance ────────────────────────────────────────────────────────
export const idCheckSchema = z
  .object({
    employeeId: z.string().optional().nullable(),
    badgeToken: z.string().trim().optional().nullable(),
    wearing: z.boolean(),
    photoFileId: z.string().optional().nullable(),
    note: z.string().max(300).optional().nullable(),
  })
  .refine((v) => !!v.employeeId || !!v.badgeToken, { message: 'Scan a badge or pick an employee', path: ['employeeId'] });
export type IdCheckInput = z.infer<typeof idCheckSchema>;
export const idCheckPatchSchema = z.object({ wearing: z.boolean(), note: z.string().max(300).optional().nullable() });
export type IdCheckRow = { id: string; employeeId: string; employeeName: string; department: string | null; checkedAt: string; wearing: boolean; photo: 'Taken' | 'Skipped'; photoFileId: string | null; loggedBy: string; date: string };
export type IdComplianceSummary = {
  date: string;
  inOffice: number;
  headcount: number;
  checked: number;
  wearing: number;
  wearingPct: number;
  missing: number;
  unchecked: number;
  remindersSent: boolean;
  monthCompliancePct: number;
  prevMonthCompliancePct: number | null;
  deltaPct: number | null;
  /** Most recent earlier day with checks, when the chosen day has none yet. */
  lastCheckDate: string | null;
};
export type IdPendingRow = { employeeId: string; name: string; department: string | null; firstIn: string | null };
export type MyIdCheckCard = { title: string; body: string; meta: string; checkedToday: boolean };

// ── Biometric ─────────────────────────────────────────────────────────────────
export const biometricDeviceSchema = z.object({
  serialNumber: z.string().trim().min(3, 'Serial number is required').max(40),
  name: z.string().trim().min(1, 'Device name is required').max(80),
  locationId: z.string().optional().nullable(),
  model: z.string().max(60).optional().nullable(),
  directionMode: z.enum(['DEVICE_STATUS', 'ALTERNATE', 'FIRST_LAST']).default('FIRST_LAST'),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});
export type BiometricDeviceInput = z.infer<typeof biometricDeviceSchema>;
export type BiometricDeviceRow = { id: string; serialNumber: string; name: string; locationId: string | null; locationName: string | null; model: string | null; firmware: string | null; directionMode: string; lastSeenAt: string | null; lastSeen: string; status: 'Online' | 'Offline' | 'Disabled'; unprocessed: number };
export const enrollmentSchema = z.object({ employeeId: z.string().min(1), pin: z.string().trim().regex(/^\d{1,9}$/, 'PIN is digits only') });
export type EnrollmentRow = { employeeId: string; name: string; empCode: string; pin: string | null; workMode: string };
export const biometricSimulateSchema = z.object({
  serialNumber: z.string().trim().min(3),
  pin: z.string().trim().min(1),
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/, 'Use YYYY-MM-DD HH:MM').optional().nullable(),
  status: z.coerce.number().int().min(0).max(5).optional(),
});
export type BiometricSimulateInput = z.infer<typeof biometricSimulateSchema>;
export type RawLogRow = { id: string; pin: string; employeeName: string | null; punchedAtLocal: string; statusCode: number | null; processed: boolean; error: string | null; receivedAt: string };

// ── Period locks ──────────────────────────────────────────────────────────────
export const periodLockSchema = z.object({ month: monthKey, upTo: dateKey.optional() });
export const periodUnlockSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) });
export type PeriodLockRow = { month: string; lockedUpTo: string; lockedBy: string | null; lockedAt: string; unlockedAt: string | null; unlockReason: string | null; active: boolean };
export type PeriodLockReadiness = {
  month: string;
  lock: PeriodLockRow | null;
  attendanceDays: number;
  pendingCorrections: number;
  missedPunchDays: number;
  openSessions: number;
  timesheetsPending: number;
  timesheetsApproved: number;
};

// ── Timesheets ────────────────────────────────────────────────────────────────
export const timesheetWeekQuery = z.object({ weekStart: dateKey.optional(), employeeId: z.string().optional() });
export const cellEditSchema = z.object({
  lineId: z.string().min(1),
  date: dateKey,
  minutes: z.coerce.number().int().min(0).max(1440),
  reason: z.string().trim().max(500).optional().nullable(),
  expectedVersion: z.number().int().optional(),
});
export type CellEditInput = z.infer<typeof cellEditSchema>;
export const addLineSchema = z.object({ taskId: z.string().optional().nullable(), projectId: z.string().optional().nullable(), label: z.string().trim().max(120).optional().nullable() });
export type AddLineInput = z.infer<typeof addLineSchema>;
export const outsideHoursSchema = z
  .object({
    taskText: z.string().trim().min(2, 'Task is required').max(160),
    projectId: z.string().min(1, 'Project is required'),
    taskId: z.string().optional().nullable(),
    date: dateKey,
    from: hhmm,
    to: hhmm,
    reason: z.string().trim().min(5, 'Reason must be at least 5 characters').max(1000),
  })
  .refine((v) => v.to > v.from, { message: 'To must be after From (split entries that cross midnight)', path: ['to'] });
export type OutsideHoursInput = z.infer<typeof outsideHoursSchema>;
export const submitTimesheetSchema = z.object({ expectedVersion: z.number().int().optional(), confirmEmpty: z.boolean().optional() });

export type TimesheetChainChip = { key: 'employee' | 'pl' | 'rm' | 'payroll'; label: string; tone: 'accent' | 'outline' | 'neutral'; tooltip?: string };
export type TimesheetCellDto = {
  date: string;
  /** Counted minutes (tracked + approved idle + accepted outside hours + counted edits). */
  final: number;
  tracked: number;
  adjustment: number;
  /** Accepted outside hours. */
  outsideHours: number;
  idleAsWork: number;
  pendingIdle: number;
  /** Manual increase waiting for the Project Lead (not in `final`). */
  pendingAdjustment: number;
  /** Outside-hours entries waiting for the Project Lead (not in `final`). */
  pendingOutside: number;
  /** pendingAdjustment + pendingOutside. */
  pending: number;
  /** What a cell edit starts from: final + pendingAdjustment. */
  claimed: number;
  adjusted: boolean;
  adjustmentReason: string | null;
  ohPending: boolean;
  editable: boolean;
  outOfPeriod: boolean;
};
export type TimesheetLineTask = { status: string; statusLabel: string; active: boolean; estimatedMinutes: number | null; loggedMinutes: number };
export type TimesheetLineDto = {
  id: string;
  label: string;
  subLabel: string | null;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  isManual: boolean;
  /** Counted minutes this week. */
  total: number;
  /** Minutes waiting for review this week. */
  pending: number;
  /** No time this week and the task is no longer being worked on: hidden unless "Show empty rows". */
  quiet: boolean;
  task: TimesheetLineTask | null;
  cells: TimesheetCellDto[];
};
export type OutsideHoursDto = { id: string; date: string; dateLabel: string; from: string; to: string; minutes: number; taskText: string; projectId: string | null; projectName: string | null; reason: string; reviewStatus: string };
export type TimesheetDayLeave = { typeCode: string | null; fraction: number; session: string | null; label: string };
export type TimesheetDay = {
  date: string;
  dow: string;
  label: string;
  future: boolean;
  weeklyOff: boolean;
  holiday: string | null;
  locked: boolean;
  /** Approved leave on the day (null when none). */
  leave: TimesheetDayLeave | null;
  /** Hours expected: 0 on a weekly off / holiday, less leave taken. */
  expectedMinutes: number;
};
export type TimesheetWeek = {
  id: string;
  employee: { id: string; name: string };
  weekStart: string;
  weekEnd: string;
  label: string; // "21 – 27 Sep 2026"
  shortLabel: string; // "21–27 Sep"
  status: TimesheetStatusKey;
  statusLabel: string;
  editable: boolean;
  days: TimesheetDay[];
  lines: TimesheetLineDto[];
  idleRow: number[];
  /** Counted minutes per day. */
  dayTotals: number[];
  /** Minutes waiting for review per day (not in dayTotals). */
  pendingRow: number[];
  totals: { worked: number; idle: number; tracked: number; adjustments: number; outsideHours: number; idleAsWork: number; pending: number; expected: number };
  chain: TimesheetChainChip[];
  returned: { by: string | null; comment: string } | null;
  outsideHours: OutsideHoursDto[];
  version: number;
  submitLabel: string;
  canSubmit: boolean;
  canRecall: boolean;
  hasTrackerData: boolean;
  screenshotCount: number;
  plNames: string[];
};
export type TimesheetListRow = { id: string; employeeId: string; employeeName: string; weekStart: string; label: string; status: TimesheetStatusKey; statusLabel: string; totalMinutes: number; idleMinutes: number; submittedAt: string | null; approvedAt: string | null };
export type TimesheetOptions = { projects: { id: string; name: string; key: string; isInternal: boolean }[]; tasks: { id: string; key: string; title: string; projectId: string; projectName: string }[] };
export type SubmitResult = { status: TimesheetStatusKey; message: string };

// ── Timesheet approvals ───────────────────────────────────────────────────────
export const approvalsQuery = z.object({ level: z.coerce.number().int().min(1).max(2).default(1), status: z.enum(['PENDING', 'APPROVED', 'RETURNED', 'ALL']).default('PENDING') });
export const itemDecisionSchema = z.object({ type: z.enum(['OUTSIDE_HOURS', 'IDLE_AS_WORK', 'MANUAL_INCREASE']), id: z.string().min(1), decision: z.enum(['ACCEPT', 'REJECT']), note: z.string().max(500).optional().nullable() });
export const approveStepSchema = z.object({ comment: z.string().trim().max(1000).optional().nullable(), decisions: z.array(itemDecisionSchema).default([]) });
export type ApproveStepInput = z.infer<typeof approveStepSchema>;
export const returnStepSchema = z.object({ comment: z.string().trim().min(5, 'Add a comment for the employee (at least 5 characters)').max(1000) });
export type ApprovalRow = { stepId: string; timesheetId: string; level: number; employeeId: string; name: string; week: string; weekStart: string; workedMinutes: number; idleMinutes: number; hours: string; idle: string; shots: number; flags: number; status: string; statusLabel: string; stepStatus: string; projectName: string | null; pendingMinutes: number };
export type ApprovalList = { items: ApprovalRow[]; counts: { l1: number; l2: number; corrections: number }; canL1: boolean; canL2: boolean; canCorrections: boolean; isAdmin: boolean };
export type ReviewItem = { type: 'OUTSIDE_HOURS' | 'IDLE_AS_WORK' | 'MANUAL_INCREASE'; id: string; date: string; dateLabel: string; minutes: number; task: string; reason: string; status: string };
export type ScreenshotThumb = { id: string; capturedAt: string; time: string; taskKey: string; fileId: string | null; blurred: boolean };
export type ApprovalDetail = {
  step: { id: string; level: number; status: string; projectId: string | null; projectName: string | null; approverName: string | null };
  timesheet: TimesheetWeek;
  kpis: { worked: string; idle: string; shots: number };
  otherProjectsMinutes: number;
  items: ReviewItem[];
  screenshots: { total: number; page: number; pageSize: number; items: ScreenshotThumb[]; byTask: { taskKey: string; count: number }[]; days: string[] };
  history: { type: string; actor: string | null; level: number | null; comment: string | null; at: string }[];
  lateDataBanner: string | null;
  canAct: boolean;
};

// ── Payroll feed (read by leavepay) ───────────────────────────────────────────
export type PayrollInputRow = {
  employeeId: string;
  workingDays: number;
  weeklyOffs: number;
  holidays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  lopDays: number;
  paidDays: number;
  lateMarks: number;
  latePenaltyDays: number;
  idleMinutes: number;
  idleDeductibleMinutes: number;
  missedPunchDays: number;
  timesheetStatus: 'APPROVED' | 'PENDING' | 'NOT_REQUIRED';
  pendingPeriods: string[];
  locked: boolean;
};
