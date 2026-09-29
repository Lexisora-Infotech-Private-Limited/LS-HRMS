import { z } from 'zod';

/**
 * Typed IPC contract between the sandboxed renderer and Electron main.
 * The renderer imports these as *types only*; main validates every command with zod.
 * Tokens and keys never cross this boundary.
 */

export const IPC = {
  invoke: 'tracker:invoke',
  state: 'tracker:state',
  toast: 'tracker:toast',
  shot: 'tracker:shot',
  getState: 'tracker:get-state',
} as const;

export type TrackerTab = 'track' | 'summary' | 'settings';
export type View = 'login' | 'pair' | 'home';
export type EngineStatus = 'OUT' | 'WORKING' | 'BREAK';
export type IdleCauseView = 'NO_INPUT' | 'LOCK' | 'SUSPEND' | 'APP_NOT_RUNNING';
export type TrackingMode = 'FULL' | 'MONITOR_ONLY';

export type Prefs = { launchAtStartup: boolean; showTrayWidget: boolean; breakReminders: boolean };

export const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('login'),
    workspace: z.string().trim().min(1, 'Workspace is required').max(200),
    email: z.string().trim().toLowerCase().email('Enter your official email'),
    password: z.string().min(1, 'Password is required').max(200),
  }),
  z.object({ type: z.literal('server.set'), url: z.string().trim().url('Enter a valid URL').max(300) }),
  z.object({ type: z.literal('pair.poll') }),
  z.object({ type: z.literal('pair.newCode') }),
  z.object({ type: z.literal('pair.cancel') }),
  z.object({ type: z.literal('punchIn') }),
  z.object({ type: z.literal('punchOut'), confirmed: z.boolean().optional() }),
  z.object({ type: z.literal('attach') }),
  z.object({ type: z.literal('break.toggle') }),
  z.object({ type: z.literal('task.switch'), taskId: z.string().min(1).max(100) }),
  z.object({
    type: z.literal('idle.resolve'),
    resolution: z.enum(['WORKING', 'BREAK', 'IDLE']),
    note: z.string().max(140).optional(),
  }),
  z.object({ type: z.literal('tab'), tab: z.enum(['track', 'summary', 'settings']) }),
  z.object({ type: z.literal('sync.force') }),
  z.object({
    type: z.literal('pref.set'),
    key: z.enum(['launchAtStartup', 'showTrayWidget', 'breakReminders']),
    value: z.boolean(),
  }),
  z.object({
    type: z.literal('signOut'),
    confirmed: z.boolean().optional(),
    discard: z.literal('UNPAIR').optional(),
  }),
  z.object({ type: z.literal('window'), action: z.enum(['minimize', 'maximize', 'close']) }),
  z.object({ type: z.literal('widget'), action: z.enum(['open', 'close', 'toggle']) }),
  z.object({ type: z.literal('open'), tab: z.enum(['track', 'summary', 'settings']).optional() }),
  z.object({ type: z.literal('copyDiagnostics') }),
  z.object({ type: z.literal('update.open') }),
  z.object({ type: z.literal('update.check') }),
  z.object({
    type: z.literal('simulate'),
    kind: z.enum(['idle', 'screenshot', 'offline', 'lock', 'unlock', 'appGap']),
  }),
]);
export type Command = z.infer<typeof commandSchema>;

export type CommandResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; code: string; error: string; meta?: Record<string, unknown> };

export type TaskRow = {
  id: string;
  key: string;
  title: string;
  projectName: string;
  seconds: number;
  active: boolean;
  unassigned: boolean;
};

export type TimelineBar = { kind: 'WORK' | 'BREAK' | 'IDLE' | 'IDLE_WORK' | 'GAP'; flex: number; label: string };

export type LogLine = { t: string; m: string };

export type ViewState = {
  view: View;
  tab: TrackerTab;
  isDev: boolean;
  appVersion: string;
  serverUrl: string;
  clock: string;

  login: { workspace: string; email: string; busy: boolean; error: string | null; notEligible: boolean };
  pair: {
    code: string[];
    expiresAt: string | null;
    expired: boolean;
    status: 'IDLE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'ERROR';
    hostname: string;
    os: string;
    busy: boolean;
    error: string | null;
    screenCapture: boolean;
  };

  mode: TrackingMode;
  status: EngineStatus;
  statusLabel: string;
  statusTone: 'tag-neutral' | 'tag-accent' | 'tag-outline';
  shiftLabel: string;
  workedSec: number;
  breakSec: number;
  idleSec: number;
  tasks: TaskRow[];
  activeTask: { id: string; key: string; title: string } | null;
  idle: null | {
    cause: IdleCauseView;
    title: string;
    since: string;
    until: string | null;
    claimsAllowed: boolean;
  };
  punchHelper: string;
  /** Punch-in blocked (offline too long / update required / office staff). */
  punchBlocked: string | null;
  /** A session already open on the server (web or biometric) that this device can attach to. */
  serverSession: null | { punchedInAt: string; source: 'WEB' | 'BIOMETRIC' | 'OTHER' };
  monitorNote: string | null;
  nextShot: string | null;
  lastInput: string;
  screenshotsToday: number;
  lastShot: string | null;
  summaryTitle: string;
  timeline: TimelineBar[];

  online: boolean;
  queued: number;
  lastSyncAt: string | null;
  syncing: boolean;

  policyLoaded: boolean;
  settingsRows: { key: string; label: string; note: string; value: string; tone: string; toggle?: keyof Prefs; action?: 'copyDiagnostics' | 'update.open' }[];
  prefs: Prefs;
  device: null | { hostname: string; pairedAt: string | null };
  update: null | { version: string; mandatory: boolean; notes: string | null };
  log: LogLine[];
  weekSubmitted: boolean;
};

export type ToastMessage = { id: number; text: string; tone?: 'info' | 'error' };

export type ShotToast = { time: string; taskKey: string; blurred: boolean; thumb: string | null };
