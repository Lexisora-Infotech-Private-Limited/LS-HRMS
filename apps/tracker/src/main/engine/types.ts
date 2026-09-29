/**
 * Pure time-accounting types. Nothing in src/main/engine imports electron or touches
 * the file system, so every rule here is unit-tested with a fake clock.
 * Timestamps are epoch milliseconds.
 */

export type SegmentKind = 'WORK' | 'BREAK' | 'IDLE' | 'IDLE_WORK';
export type Status = 'OUT' | 'WORKING' | 'BREAK';
export type IdleCause = 'NO_INPUT' | 'LOCK' | 'SUSPEND' | 'APP_NOT_RUNNING';
export type Resolution = 'WORKING' | 'BREAK' | 'IDLE';

export interface Segment {
  clientId: string;
  kind: SegmentKind;
  taskId: string | null;
  startedAt: number;
  endedAt: number;
}

export interface OpenSegment {
  clientId: string;
  kind: 'WORK' | 'BREAK';
  taskId: string | null;
  startedAt: number;
}

export interface EngineConfig {
  /** 0 disables idle detection. */
  idleThresholdSec: number;
  screenshotsEnabled: boolean;
  screenshotIntervalSec: number;
  /** 0 disables the reminder. */
  breakReminderSec: number;
  /** Long WORK segments are checkpointed (closed + reopened) so the server sees progress. */
  checkpointSec: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  idleThresholdSec: 300,
  screenshotsEnabled: true,
  screenshotIntervalSec: 600,
  breakReminderSec: 7200,
  checkpointSec: 900,
};

/** An event as produced by the engine — mirrors TrackerEvent in @lexisora/shared (ISO strings added on output). */
export interface EngineEvent {
  clientId: string;
  type:
    | 'PUNCH_IN'
    | 'PUNCH_OUT'
    | 'BREAK_START'
    | 'BREAK_END'
    | 'TASK_SWITCH'
    | 'IDLE_START'
    | 'IDLE_RESOLVED'
    | 'LOCK'
    | 'UNLOCK'
    | 'SUSPEND'
    | 'RESUME'
    | 'APP_QUIT';
  at: number;
  taskId?: string | null;
  resolution?: Resolution;
  idleFrom?: number;
  note?: string;
}

export interface EngineOutput {
  events: EngineEvent[];
  segments: Segment[];
  shotDue: boolean;
  breakReminderDue: boolean;
  idleStarted: boolean;
}

export const emptyOutput = (): EngineOutput => ({
  events: [],
  segments: [],
  shotDue: false,
  breakReminderDue: false,
  idleStarted: false,
});

export class EngineError extends Error {
  constructor(
    public readonly code:
      | 'NOT_PUNCHED_IN'
      | 'ALREADY_PUNCHED_IN'
      | 'IDLE_UNRESOLVED'
      | 'NO_IDLE'
      | 'NOT_ON_BREAK'
      | 'ON_BREAK',
    message: string,
  ) {
    super(message);
  }
}
