import { z } from 'zod';

/**
 * Contract between the Windows desktop tracker (apps/tracker), the API (modules/tracker)
 * and the web app (Profile → Devices, /devices, approvals screenshots / idle claims).
 *
 * SINGLE SOURCE OF TRUTH — owned by the tracker domain. Extend, never rename.
 *
 * Every event the tracker produces carries a client-generated UUID (`clientId`) so offline
 * batches can be replayed safely (idempotent ingest). The device sends raw events plus the
 * segments it computed; the server validates, stores idempotently and projects day summaries.
 *
 * Endpoints (all under /api/v1):
 *   POST /tracker/auth/login            trackerLoginSchema          → TrackerLoginResponse (public)
 *   POST /tracker/pair/start            pairStartSchema             → PairStartResponse   (Bearer <pairingToken>)
 *   GET  /tracker/pair/status                                       → PairStatusResponse  (Bearer <pairingToken>)
 *   POST /tracker/pair/cancel                                       → { ok: true }        (Bearer <pairingToken>)
 *   ── everything below: Bearer <deviceToken> ──
 *   GET  /tracker/policy                                            → TrackerPolicyResponse
 *   GET  /tracker/tasks                                             → TrackerTask[]
 *   GET  /tracker/today                                             → TrackerToday
 *   POST /tracker/punch                 trackerPunchSchema          → TrackerPunchResult  (403 PUNCH_NOT_ALLOWED in MONITOR_ONLY)
 *   POST /tracker/sync                  trackerBatchSchema          → TrackerBatchResult
 *   POST /tracker/screenshots           multipart: file=<image>, meta=<JSON ScreenshotMeta> → ScreenshotUploadResult
 *   POST /tracker/heartbeat             trackerHeartbeatSchema      → TrackerHeartbeatResult
 *   POST /tracker/days/:date/confirm                                → TrackerConfirmResult ("Add to weekly timesheet")
 *   POST /tracker/unpair                                            → { ok: true }        ("Sign out & unpair")
 *
 * Realtime (socket.io, handshake auth.token = deviceToken; device joins room d:<deviceId>):
 *   see TRACKER_SOCKET_EVENTS.
 */

// ── Mode / policy ────────────────────────────────────────────────────────────

/**
 * PUNCH        — Remote / Hybrid (WFH day): the tracker punches IN/OUT (source DESKTOP).
 * MONITOR_ONLY — Office staff (audit G6): they punch with biometric; the tracker may run to
 *                record tasks, idle and screenshots while the biometric session is open,
 *                but POST /tracker/punch is refused.
 */
export const TRACKER_MODES = ['PUNCH', 'MONITOR_ONLY'] as const;
export type TrackerMode = (typeof TRACKER_MODES)[number];

export const MONITOR_ONLY_MESSAGE =
  'Office staff punch with biometric. The tracker records your tasks, idle time and screenshots after your biometric IN.';
export const TRACKER_FOOTER_NOTE = 'Available to Remote / WFH employees. Office staff punch with biometric.';

export const trackerPolicySchema = z.object({
  idleThresholdMin: z.number().int().min(1).max(60), // wireframe default 5
  screenshotIntervalMin: z.number().int().min(1).max(60), // default 10
  screenshotsEnabled: z.boolean(),
  blurScreenshots: z.boolean(),
  offlineRetentionDays: z.number().int().min(1).max(30), // default 7
  desktopPunchAllowed: z.boolean(),
  breakReminderMin: z.number().int().min(0), // 120 = nudge after 2h work; 0 = off
  shiftStart: z.string(), // "09:30"
  shiftEnd: z.string(), // "18:30"
});
export type TrackerPolicy = z.infer<typeof trackerPolicySchema>;

/** GET /tracker/policy — resolved AttendancePolicy for the device's employee. */
export type TrackerPolicyResponse = TrackerPolicy & {
  mode: TrackerMode;
  /** Which AttendancePolicy applied (OFFICE for office staff; REMOTE for remote/hybrid). */
  audience: 'OFFICE' | 'REMOTE';
  autoIdleEnabled: boolean;
  deductIdleFromPayroll: boolean;
  screenshotRetentionDays: number;
  /** "I was working" idle claims allowed (always true for now). */
  idleClaimsAllowed: boolean;
  shiftName: string | null;
  breakAllowanceMin: number;
  /** Non-null in MONITOR_ONLY mode: copy to show instead of the Punch in button. */
  modeMessage: string | null;
  /** ISO; changes whenever HR saves the policy (compare to detect a push). */
  updatedAt: string;
  serverTime: string;
};

// ── Sign-in & pairing ────────────────────────────────────────────────────────

export const trackerLoginSchema = z.object({
  workspace: z.string().trim().min(1, 'Workspace is required'),
  email: z.string().trim().toLowerCase().email('Enter your official email'),
  password: z.string().min(1, 'Password is required'),
});
export type TrackerLoginInput = z.infer<typeof trackerLoginSchema>;

export type TrackerLoginResponse = {
  /** Opaque, 15-minute token. Send as `Authorization: Bearer <pairingToken>` to /tracker/pair/*. */
  pairingToken: string;
  expiresAt: string;
  mode: TrackerMode;
  modeMessage: string | null;
  user: {
    name: string;
    initials: string;
    email: string;
    empCode: string;
    workMode: 'OFFICE' | 'REMOTE' | 'HYBRID';
    tenantName: string;
  };
};

export const pairStartSchema = z.object({
  hostname: z.string().min(1).max(120),
  os: z.string().min(1).max(120),
  appVersion: z.string().min(1).max(40),
});
export type PairStartInput = z.infer<typeof pairStartSchema>;
export type PairStartResponse = {
  deviceId: string;
  code: string;
  expiresAt: string;
  /** Suggested polling interval for GET /tracker/pair/status. */
  pollAfterSec?: number;
  /** "Permissions: activity monitor, screen capture" (screen capture omitted when screenshots are off). */
  permissions?: string[];
};
export type PairStatusResponse =
  | { status: 'PENDING' }
  | { status: 'AWAITING_HR' }
  | {
      status: 'APPROVED';
      deviceToken: string;
      deviceId?: string;
      device?: { hostname: string; os: string; appVersion: string; pairedAt: string };
    }
  | { status: 'REJECTED' | 'EXPIRED' };

export const approveDeviceSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export type ApproveDeviceInput = z.infer<typeof approveDeviceSchema>;

// ── Events & segments ────────────────────────────────────────────────────────

export const TRACKER_EVENT_TYPES = [
  'PUNCH_IN',
  'PUNCH_OUT',
  'BREAK_START',
  'BREAK_END',
  'TASK_SWITCH',
  'IDLE_START',
  'IDLE_RESOLVED',
  'LOCK',
  'UNLOCK',
  'SUSPEND',
  'RESUME',
  'APP_QUIT',
  // additions (append-only)
  'APP_START',
  'IDLE_END',
  'CLOCK_CHANGE',
  'DISPLAY_CHANGE',
  'SCREENSHOT',
  'SUMMARY_CONFIRMED',
  'OFFLINE',
  'ONLINE',
] as const;
export type TrackerEventType = (typeof TRACKER_EVENT_TYPES)[number];

/** How the user answered the idle dialog. */
export const IDLE_RESOLUTIONS = ['WORKING', 'BREAK', 'IDLE'] as const;
export type IdleResolution = (typeof IDLE_RESOLUTIONS)[number];

export const IDLE_CAUSES = ['NO_INPUT', 'LOCK', 'SLEEP', 'APP_NOT_RUNNING'] as const;
export type IdleCause = (typeof IDLE_CAUSES)[number];

export const trackerEventSchema = z.object({
  clientId: z.string().uuid(),
  type: z.enum(TRACKER_EVENT_TYPES),
  at: z.string().datetime(), // device time (ISO, UTC)
  taskId: z.string().nullable().optional(),
  /** For IDLE_RESOLVED: how the user classified the idle span. */
  resolution: z.enum(IDLE_RESOLUTIONS).optional(),
  /** For IDLE_RESOLVED: idle span start (ISO). */
  idleFrom: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
  /** Free-form typed payload (e.g. CLOCK_CHANGE {driftSec}, DISPLAY_CHANGE {displays}). */
  payload: z.record(z.unknown()).optional(),
});
export type TrackerEvent = z.infer<typeof trackerEventSchema>;

export const SEGMENT_KINDS = ['WORK', 'BREAK', 'IDLE', 'IDLE_WORK'] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

/**
 * A contiguous span of one activity kind on one task, computed on the device.
 * Idle handling:
 *   kind IDLE  + resolution IDLE (or none)  → stored IDLE, idleResolution DEDUCTED
 *   kind IDLE  + resolution BREAK           → stored IDLE, idleResolution AS_BREAK (counts as break)
 *   kind IDLE  + resolution WORKING         → stored IDLE_WORK, CLAIMED_WORK + IdleClaim PENDING (PL review)
 *   kind IDLE_WORK                          → same as IDLE + WORKING
 * If `resolution` is omitted on an IDLE segment the server looks for an IDLE_RESOLVED event
 * whose `idleFrom` equals the segment start.
 */
export const activitySegmentSchema = z.object({
  clientId: z.string().uuid(),
  kind: z.enum(SEGMENT_KINDS),
  taskId: z.string().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  keyboardEvents: z.number().int().min(0).default(0),
  mouseEvents: z.number().int().min(0).default(0),
  resolution: z.enum(IDLE_RESOLUTIONS).optional(),
  idleCause: z.enum(IDLE_CAUSES).optional(),
  /** Idle claim note ("Client call"), max 140 chars. */
  note: z.string().max(140).optional(),
});
export type ActivitySegment = z.infer<typeof activitySegmentSchema>;
export type ActivitySegmentInput = z.input<typeof activitySegmentSchema>;

export const trackerBatchSchema = z.object({
  deviceTime: z.string().datetime(), // lets the server estimate clock skew
  events: z.array(trackerEventSchema).max(1000),
  segments: z.array(activitySegmentSchema).max(2000),
  /** Unsynced entries still in the local outbox after this batch (for HR fleet view). */
  queueDepth: z.number().int().min(0).optional(),
});
export type TrackerBatch = z.infer<typeof trackerBatchSchema>;
export type TrackerBatchResult = {
  accepted: number;
  duplicates: number;
  /** deviceTime − serverTime, seconds (positive = device clock ahead). */
  skewSeconds: number;
  /** Items the server refused, with a reason (e.g. OVERLAP, END_BEFORE_START, TOO_LONG, FUTURE). */
  rejected?: { clientId: string; reason: string }[];
  /** IST dates (YYYY-MM-DD) whose summaries were re-projected. */
  workDates?: string[];
  serverTime?: string;
};

export const screenshotMetaSchema = z.object({
  clientId: z.string().uuid(),
  capturedAt: z.string().datetime(),
  taskId: z.string().nullable(),
  monitorCount: z.number().int().min(1).default(1),
  blurred: z.boolean().default(false),
});
export type ScreenshotMeta = z.infer<typeof screenshotMetaSchema>;
export type ScreenshotUploadResult = { id: string; duplicate: boolean; blurred: boolean; workDate: string };

export const trackerPunchSchema = z.object({
  direction: z.enum(['IN', 'OUT']),
  /** Optional client event id; a replayed punch with the same id is ignored. */
  clientId: z.string().uuid().optional(),
  /** Device time of the click (defaults to server now); used for offline punches. */
  at: z.string().datetime().optional(),
  taskId: z.string().nullable().optional(),
});
export type TrackerPunchInput = z.infer<typeof trackerPunchSchema>;

export const TRACKER_LIVE_STATUSES = ['OUT', 'WORKING', 'BREAK', 'IDLE'] as const;
export const trackerHeartbeatSchema = z.object({
  status: z.enum(TRACKER_LIVE_STATUSES),
  taskId: z.string().nullable().optional(),
  queueDepth: z.number().int().min(0).default(0),
  appVersion: z.string().max(40).optional(),
  displays: z.number().int().min(1).max(12).optional(),
});
export type TrackerHeartbeatInput = z.infer<typeof trackerHeartbeatSchema>;
export type TrackerHeartbeatResult = {
  serverTime: string;
  deviceStatus: 'ACTIVE' | 'REVOKED';
  /** Compare with the cached policy's updatedAt; refetch GET /tracker/policy when different. */
  policyUpdatedAt: string;
};

// ── Read models ──────────────────────────────────────────────────────────────

export type TrackerTask = {
  id: string;
  key: string;
  title: string;
  projectName: string;
  // additions
  projectId?: string;
  projectKey?: string;
  status?: string;
  /** Standing internal task (INT-1 Stand-up & meetings, INT-2 Training). */
  isStanding?: boolean;
  /** Seconds already tracked today on this task. */
  todaySeconds?: number;
};

export type TrackerTimelineBlock = {
  kind: 'WORK' | 'BREAK' | 'IDLE';
  startAt: string;
  endAt: string;
  taskKey: string | null;
};

export type TrackerToday = {
  status: 'OUT' | 'WORKING' | 'BREAK';
  workedSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  screenshots: number;
  byTask: { taskId: string | null; key: string; title: string; seconds: number }[];
  punchedInAt: string | null;
  // additions
  date?: string; // YYYY-MM-DD IST
  mode?: TrackerMode;
  /** Idle marked "I was working" and not yet reviewed (already included in workedSeconds). */
  idlePendingSeconds?: number;
  firstInAt?: string | null;
  lastOutAt?: string | null;
  /** Source of the open session (BIOMETRIC for office staff, WEB if punched on the portal …). */
  punchSource?: string | null;
  timeline?: TrackerTimelineBlock[];
  confirmedAt?: string | null;
  /** True when this week's timesheet is already submitted (disables "Add to weekly timesheet"). */
  weekSubmitted?: boolean;
};

export type TrackerPunchResult = { ok: true; direction: 'IN' | 'OUT'; at: string; today: TrackerToday };
export type TrackerConfirmResult = { confirmedAt: string; date: string; weekSubmitted: boolean };

/** Server → device realtime events (room d:<deviceId>). */
export const TRACKER_SOCKET_EVENTS = {
  policyUpdated: 'policy.updated', // { updatedAt }
  deviceRevoked: 'device.revoked', // { by, reason }
  attendancePunched: 'attendance.punched', // { direction, source, at }
  tasksUpdated: 'tasks.updated', // {}
  syncNow: 'command.syncNow', // {}
} as const;

// ── Web: devices ─────────────────────────────────────────────────────────────

export const DEVICE_STATUSES = ['PENDING', 'ACTIVE', 'REVOKED'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export type DeviceRow = {
  id: string;
  hostname: string;
  os: string;
  appVersion: string;
  status: DeviceStatus | 'AWAITING_HR';
  pairedAt: string | null;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  queueDepth: number;
  revokedAt: string | null;
  revokeReason: string | null;
  employee: { id: string; name: string; empCode: string; workMode: string } | null;
  /** Latest app version seen across the tenant's devices — rows below it show "Update available". */
  outdated: boolean;
};

export type DevicesAdminResponse = {
  items: DeviceRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { all: number; active: number; pending: number; revoked: number; stale: number };
  latestVersion: string | null;
};

export const devicesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().optional(),
  tab: z.enum(['all', 'active', 'pending', 'revoked', 'stale']).default('all'),
});
export type DevicesQuery = z.infer<typeof devicesQuery>;

export type PairingLookup = {
  requestId: string;
  deviceId: string;
  hostname: string;
  os: string;
  appVersion: string;
  requestedAt: string;
  expiresAt: string;
  permissions: string[];
};

export const devicePairDecisionSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  decision: z.enum(['APPROVE', 'REJECT']).default('APPROVE'),
});
export type DevicePairDecisionInput = z.infer<typeof devicePairDecisionSchema>;
export type DeviceApproveResult = { status: 'APPROVED' | 'AWAITING_HR' | 'REJECTED'; device: DeviceRow };

export const deviceRevokeSchema = z.object({ reason: z.string().trim().max(300).optional() });
export type DeviceRevokeInput = z.infer<typeof deviceRevokeSchema>;

export const deviceHrDecisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(300).optional() });

// ── Web: idle claims, screenshots, day summaries ────────────────────────────

export const IDLE_CLAIM_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type IdleClaimStatus = (typeof IDLE_CLAIM_STATUSES)[number];

export const idleClaimsQuery = z.object({
  employeeId: z.string().optional(),
  /** Monday of the week, YYYY-MM-DD. */
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(IDLE_CLAIM_STATUSES).optional(),
});
export type IdleClaimsQuery = z.infer<typeof idleClaimsQuery>;

export type IdleClaimRow = {
  id: string;
  employee: { id: string; name: string };
  workDate: string;
  startAt: string;
  endAt: string;
  minutes: number;
  task: { id: string; key: string; title: string } | null;
  note: string | null;
  status: IdleClaimStatus;
  reviewer: { id: string; name: string } | null;
  decidedAt: string | null;
  comment: string | null;
  canDecide: boolean;
};

export const idleClaimDecideSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(500).optional(),
});
export type IdleClaimDecideInput = z.infer<typeof idleClaimDecideSchema>;

export const screenshotsQuery = z.object({
  employeeId: z.string().optional(),
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  taskId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ScreenshotsQuery = z.infer<typeof screenshotsQuery>;

export type ScreenshotRow = {
  id: string;
  capturedAt: string;
  workDate: string;
  task: { id: string; key: string; title: string } | null;
  fileId: string;
  thumbFileId: string | null;
  blurred: boolean;
  inIdle: boolean;
  deviceName: string | null;
};

export const daySummariesQuery = z.object({
  employeeId: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type DaySummariesQuery = z.infer<typeof daySummariesQuery>;

export type DaySummaryRow = {
  workDate: string;
  workedSec: number;
  breakSec: number;
  idleSec: number;
  idleDeductedSec: number;
  idlePendingSec: number;
  screenshotCount: number;
  firstInAt: string | null;
  lastOutAt: string | null;
  perTask: TrackerPerTask[];
  timeline: TrackerTimelineBlock[];
  integrityFlags: number;
};

export type TrackerPerTask = { taskId: string | null; projectId?: string | null; key: string; title: string; seconds: number };

export const INTEGRITY_TYPES = [
  'CLOCK_SKEW',
  'CLOCK_CHANGED',
  'APP_QUIT_WHILE_PUNCHED_IN',
  'GAP',
  'OVERLAP_REJECTED',
  'SCREENSHOT_MISSING',
  'OFFLINE_OVER_LIMIT',
] as const;
export type IntegrityType = (typeof INTEGRITY_TYPES)[number];

export type IntegrityEventRow = {
  id: string;
  type: IntegrityType;
  severity: 'INFO' | 'WARN' | 'HIGH';
  workDate: string;
  occurredAt: string;
  details: Record<string, unknown>;
  acknowledgedAt: string | null;
};

// ── Pure rules shared by device and server (unit-tested in apps/api) ──────────

/** Clock skew in seconds: positive when the device clock is ahead of the server. */
export function estimateSkewSeconds(deviceTimeIso: string, serverNowMs: number): number {
  return Math.round((Date.parse(deviceTimeIso) - serverNowMs) / 1000);
}

/** Skew above this (5 min) raises a CLOCK_SKEW integrity event and times are corrected. */
export const SKEW_CORRECT_THRESHOLD_SEC = 300;

/** Maximum length of a single segment (hard session cap). */
export const MAX_SEGMENT_SEC = 16 * 3600;

export type StoredIdleResolution = 'DEDUCTED' | 'AS_BREAK' | 'CLAIMED_WORK';

/** Maps a device segment to the stored kind + idle resolution (see activitySegmentSchema docs). */
export function resolveSegmentKind(
  kind: SegmentKind,
  resolution?: IdleResolution | null,
): { kind: SegmentKind; idleResolution: StoredIdleResolution | null; createsClaim: boolean } {
  if (kind === 'IDLE_WORK') return { kind: 'IDLE_WORK', idleResolution: 'CLAIMED_WORK', createsClaim: true };
  if (kind === 'IDLE') {
    if (resolution === 'WORKING') return { kind: 'IDLE_WORK', idleResolution: 'CLAIMED_WORK', createsClaim: true };
    if (resolution === 'BREAK') return { kind: 'IDLE', idleResolution: 'AS_BREAK', createsClaim: false };
    return { kind: 'IDLE', idleResolution: 'DEDUCTED', createsClaim: false };
  }
  return { kind, idleResolution: null, createsClaim: false };
}

export type SegmentForSummary = {
  kind: SegmentKind;
  idleResolution?: StoredIdleResolution | string | null;
  taskId: string | null;
  durationSec: number;
  /** For IDLE_WORK: status of the linked idle claim (default PENDING). */
  claimStatus?: IdleClaimStatus | null;
};

export type DayTotals = {
  /** Payable worked: WORK + approved "I was working" claims. */
  workedSec: number;
  /** What the tracker timer shows: workedSec + pending claims. */
  workedDisplaySec: number;
  breakSec: number;
  /** Idle not counted as work: deducted + pending claims. */
  idleSec: number;
  idleDeductedSec: number;
  idlePendingSec: number;
  claimApprovedSec: number;
  perTaskSec: Record<string, number>; // taskId ('' = no task) → payable seconds
};

/**
 * Day totals from segments (same formula on device and server):
 *   worked   = ΣWORK + ΣIDLE_WORK[APPROVED]
 *   break    = ΣBREAK + ΣIDLE[AS_BREAK]
 *   deducted = ΣIDLE[DEDUCTED] + ΣIDLE_WORK[REJECTED]
 *   pending  = ΣIDLE_WORK[PENDING]
 */
export function summarizeSegments(segments: SegmentForSummary[]): DayTotals {
  const t: DayTotals = {
    workedSec: 0,
    workedDisplaySec: 0,
    breakSec: 0,
    idleSec: 0,
    idleDeductedSec: 0,
    idlePendingSec: 0,
    claimApprovedSec: 0,
    perTaskSec: {},
  };
  const addTask = (taskId: string | null, s: number) => {
    const k = taskId ?? '';
    t.perTaskSec[k] = (t.perTaskSec[k] ?? 0) + s;
  };
  for (const s of segments) {
    const d = Math.max(0, Math.round(s.durationSec));
    if (s.kind === 'WORK') {
      t.workedSec += d;
      addTask(s.taskId, d);
    } else if (s.kind === 'BREAK') {
      t.breakSec += d;
    } else if (s.kind === 'IDLE') {
      if (s.idleResolution === 'AS_BREAK') t.breakSec += d;
      else if (s.idleResolution === 'CLAIMED_WORK') {
        // legacy shape: IDLE with CLAIMED_WORK behaves like IDLE_WORK
        applyClaim(s, d);
      } else t.idleDeductedSec += d;
    } else if (s.kind === 'IDLE_WORK') {
      applyClaim(s, d);
    }
  }
  function applyClaim(s: SegmentForSummary, d: number) {
    const st = s.claimStatus ?? 'PENDING';
    if (st === 'APPROVED') {
      t.workedSec += d;
      t.claimApprovedSec += d;
      addTask(s.taskId, d);
    } else if (st === 'REJECTED') t.idleDeductedSec += d;
    else t.idlePendingSec += d;
  }
  t.idleSec = t.idleDeductedSec + t.idlePendingSec;
  t.workedDisplaySec = t.workedSec + t.idlePendingSec;
  return t;
}

export type SegmentCheck = { clientId: string; startedAt: string; endedAt: string };

/**
 * Validates a set of device segments: end after start, ≤ 16 h, not in the future beyond the
 * allowed skew, and no overlap with each other or with already-stored spans (`existing`).
 * Returns the accepted segments (input order) and the rejected ones with a reason.
 */
export function validateSegments<T extends SegmentCheck>(
  segments: T[],
  opts: { nowMs: number; existing?: { startAt: Date | string; endAt: Date | string }[]; futureToleranceSec?: number } = {
    nowMs: Date.now(),
  },
): { ok: T[]; rejected: { clientId: string; reason: string }[] } {
  const tolerance = (opts.futureToleranceSec ?? SKEW_CORRECT_THRESHOLD_SEC) * 1000;
  const rejected: { clientId: string; reason: string }[] = [];
  const candidates: { seg: T; s: number; e: number; idx: number }[] = [];
  segments.forEach((seg, idx) => {
    const s = Date.parse(seg.startedAt);
    const e = Date.parse(seg.endedAt);
    if (!Number.isFinite(s) || !Number.isFinite(e)) rejected.push({ clientId: seg.clientId, reason: 'INVALID_TIME' });
    else if (e <= s) rejected.push({ clientId: seg.clientId, reason: 'END_BEFORE_START' });
    else if ((e - s) / 1000 > MAX_SEGMENT_SEC) rejected.push({ clientId: seg.clientId, reason: 'TOO_LONG' });
    else if (e > opts.nowMs + tolerance) rejected.push({ clientId: seg.clientId, reason: 'FUTURE' });
    else candidates.push({ seg, s, e, idx });
  });
  const taken = (opts.existing ?? []).map((x) => ({ s: new Date(x.startAt).getTime(), e: new Date(x.endAt).getTime() }));
  const ok: { seg: T; idx: number }[] = [];
  // earliest first so the first-recorded span wins an overlap
  for (const c of [...candidates].sort((a, b) => a.s - b.s || a.idx - b.idx)) {
    const clash = taken.some((t) => c.s < t.e && t.s < c.e);
    if (clash) rejected.push({ clientId: c.seg.clientId, reason: 'OVERLAP' });
    else {
      taken.push({ s: c.s, e: c.e });
      ok.push({ seg: c.seg, idx: c.idx });
    }
  }
  return { ok: ok.sort((a, b) => a.idx - b.idx).map((x) => x.seg), rejected };
}

/** IST business date (YYYY-MM-DD) of an instant. */
export function trackerWorkDate(at: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(at),
  );
}

/**
 * Largest-remainder rounding of per-task seconds to minutes so that Σ minutes equals
 * round(total/60) (e.g. 4 × 20m20s → 20,20,20,21).
 */
export function roundTaskMinutes(perTaskSec: Record<string, number>): Record<string, number> {
  const entries = Object.entries(perTaskSec);
  const total = Math.round(entries.reduce((a, [, s]) => a + s, 0) / 60);
  const base = entries.map(([k, s]) => ({ k, floor: Math.floor(s / 60), rem: s / 60 - Math.floor(s / 60) }));
  let left = total - base.reduce((a, b) => a + b.floor, 0);
  const out: Record<string, number> = Object.fromEntries(base.map((b) => [b.k, b.floor]));
  for (const b of [...base].sort((a, c) => c.rem - a.rem)) {
    if (left <= 0) break;
    out[b.k]! += 1;
    left--;
  }
  return out;
}
