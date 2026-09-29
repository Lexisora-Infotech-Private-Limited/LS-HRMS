import { z } from 'zod';

/**
 * Contract between the Windows desktop tracker and the API.
 * Every event the tracker produces carries a client-generated UUID (`clientId`)
 * so offline batches can be replayed safely (idempotent ingest).
 */

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

export const pairStartSchema = z.object({
  hostname: z.string().min(1).max(120),
  os: z.string().min(1).max(120),
  appVersion: z.string().min(1).max(40),
});
export type PairStartInput = z.infer<typeof pairStartSchema>;
export type PairStartResponse = { deviceId: string; code: string; expiresAt: string };
export type PairStatusResponse =
  | { status: 'PENDING' }
  | { status: 'APPROVED'; deviceToken: string }
  | { status: 'REJECTED' | 'EXPIRED' };

export const approveDeviceSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

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
] as const;
export type TrackerEventType = (typeof TRACKER_EVENT_TYPES)[number];

export const IDLE_RESOLUTIONS = ['WORKING', 'BREAK', 'IDLE'] as const;
export type IdleResolution = (typeof IDLE_RESOLUTIONS)[number];

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
});
export type TrackerEvent = z.infer<typeof trackerEventSchema>;

/** A contiguous span of one activity kind on one task, computed on the device. */
export const activitySegmentSchema = z.object({
  clientId: z.string().uuid(),
  kind: z.enum(['WORK', 'BREAK', 'IDLE', 'IDLE_WORK']), // IDLE_WORK = "I was working" → needs PL review
  taskId: z.string().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  keyboardEvents: z.number().int().min(0).default(0),
  mouseEvents: z.number().int().min(0).default(0),
});
export type ActivitySegment = z.infer<typeof activitySegmentSchema>;

export const trackerBatchSchema = z.object({
  deviceTime: z.string().datetime(), // lets the server estimate clock skew
  events: z.array(trackerEventSchema).max(1000),
  segments: z.array(activitySegmentSchema).max(2000),
});
export type TrackerBatch = z.infer<typeof trackerBatchSchema>;
export type TrackerBatchResult = { accepted: number; duplicates: number; skewSeconds: number };

export const screenshotMetaSchema = z.object({
  clientId: z.string().uuid(),
  capturedAt: z.string().datetime(),
  taskId: z.string().nullable(),
  monitorCount: z.number().int().min(1).default(1),
  blurred: z.boolean().default(false),
});
export type ScreenshotMeta = z.infer<typeof screenshotMetaSchema>;

export type TrackerTask = { id: string; key: string; title: string; projectName: string };

export type TrackerToday = {
  status: 'OUT' | 'WORKING' | 'BREAK';
  workedSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  screenshots: number;
  byTask: { taskId: string | null; key: string; title: string; seconds: number }[];
  punchedInAt: string | null;
};
