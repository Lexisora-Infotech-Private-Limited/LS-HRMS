import { z } from 'zod';
export { IPC } from './channels';

/**
 * Typed IPC contract between the sandboxed renderer and Electron main.
 * The renderer imports these as *types only*; main validates every command with zod.
 * Tokens and keys never cross this boundary — the renderer only ever sees the view model.
 */

export type TrackerTab = 'track' | 'summary' | 'settings';
export type View = 'boot' | 'login' | 'pair' | 'home';
export type EngineStatus = 'OUT' | 'WORKING' | 'BREAK';
export type IdleCauseView = 'NO_INPUT' | 'LOCK' | 'SUSPEND' | 'APP_NOT_RUNNING';
/** Mirrors TrackerMode in @lexisora/shared: PUNCH (remote / WFH) or MONITOR_ONLY (office staff, biometric punch). */
export type TrackingMode = 'PUNCH' | 'MONITOR_ONLY';
export type Tone = 'tag-neutral' | 'tag-accent' | 'tag-outline';

export type Prefs = { launchAtStartup: boolean; showTrayWidget: boolean; breakReminders: boolean };
export const PREF_KEYS = ['launchAtStartup', 'showTrayWidget', 'breakReminders'] as const;

export const SIMULATIONS = ['idle', 'screenshot', 'offline', 'lock', 'appGap', 'breakReminder', 'clock'] as const;
export type Simulation = (typeof SIMULATIONS)[number];

export const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('login'),
    workspace: z.string().trim().min(1, 'Workspace is required').max(200),
    email: z.string().trim().toLowerCase().email('Enter your official email'),
    password: z.string().min(1, 'Password is required').max(200),
  }),
  z.object({ type: z.literal('server.set'), url: z.string().trim().url('Enter a valid URL, e.g. http://localhost:4000').max(300) }),
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
    note: z.string().trim().max(140).optional(),
  }),
  z.object({ type: z.literal('tab'), tab: z.enum(['track', 'summary', 'settings']) }),
  /** "Add to weekly timesheet": checkpoint + force sync + confirm the day. */
  z.object({ type: z.literal('sync.force') }),
  z.object({ type: z.literal('pref.set'), key: z.enum(PREF_KEYS), value: z.boolean() }),
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
  z.object({ type: z.literal('simulate'), kind: z.enum(SIMULATIONS) }),
]);
export type Command = z.infer<typeof commandSchema>;

export type CommandResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; code: string; error: string; meta?: Record<string, unknown> };

export { CONFIRM_CODES } from './channels';

export type TaskRow = {
  id: string;
  key: string;
  title: string;
  projectName: string;
  time: string;
  seconds: number;
  active: boolean;
};

export type TimelineBar = { kind: 'WORK' | 'BREAK' | 'IDLE' | 'IDLE_WORK' | 'GAP'; flex: number; label: string };

export type LogLine = { t: string; m: string };

export type SettingsRow = {
  key: string;
  label: string;
  note: string;
  value: string;
  tone: Tone;
  toggle?: keyof Prefs;
  action?: 'copyDiagnostics' | 'update.open';
  disabled?: boolean;
  hint?: string;
};

export type IdleDialogView = {
  cause: IdleCauseView;
  title: string;
  body: string;
  since: string;
  until: string | null;
  claimsAllowed: boolean;
};

export type ViewState = {
  view: View;
  tab: TrackerTab;
  isDev: boolean;
  appVersion: string;
  serverUrl: string;
  /** HH:mm IST. */
  clock: string;

  login: {
    workspace: string;
    email: string;
    busy: boolean;
    error: string | null;
    notEligible: boolean;
    /** Info banner, e.g. "This device was revoked by HR. Sign in again to pair it." */
    notice: string | null;
  };
  pair: {
    code: string[];
    /** "9:41" countdown. */
    expiresIn: string | null;
    status: 'IDLE' | 'PENDING' | 'AWAITING_HR' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'ERROR';
    deviceLine: string;
    permissions: string;
    busy: boolean;
    error: string | null;
    userName: string | null;
  };

  mode: TrackingMode;
  status: EngineStatus;
  statusLabel: string;
  statusTone: Tone;
  shiftLabel: string;
  workedSec: number;
  worked: string;
  breakTime: string;
  idleTime: string;
  tasks: TaskRow[];
  showTaskSearch: boolean;
  activeTask: { id: string; key: string; title: string } | null;
  idle: IdleDialogView | null;
  punch: {
    /** Punch in blocked (offline too long / update required / not allowed). */
    blocked: string | null;
    helper: string;
    busy: boolean;
  };
  /** A session already open on the server (web / biometric / other desktop) this device can attach to. */
  serverSession: null | { label: string; action: string };
  /** MONITOR_ONLY copy shown instead of the punch buttons. */
  monitorNote: string | null;
  nextShot: string | null;
  lastInput: string;

  summary: {
    title: string;
    byTask: { key: string; title: string; time: string }[];
    screenshots: number;
    timeline: TimelineBar[];
    canConfirm: boolean;
    confirmHint: string | null;
    confirmedAt: string | null;
  };

  online: boolean;
  queued: number;
  syncing: boolean;
  lastSyncAt: string | null;

  settings: SettingsRow[];
  prefs: Prefs;
  device: null | { hostname: string; pairedAt: string | null };
  update: null | { version: string; mandatory: boolean; notes: string | null; hasUrl: boolean };
  unpair: { busy: boolean; progress: string | null };
  widget: { open: boolean; lastShot: string | null };
  log: LogLine[];
};

export type ToastMessage = { id: number; text: string; tone?: 'info' | 'error' };

export type ShotToast = { time: string; taskKey: string; blurred: boolean; thumb: string | null; audience: string };
