import { app, clipboard, dialog, powerMonitor, screen, shell as electronShell, type MenuItemConstructorOptions } from 'electron';
import { randomUUID } from 'node:crypto';
import type { PairStatusResponse, ScreenshotMeta, TrackerEvent, TrackerLoginResponse, TrackerMode, TrackerPunchInput, TrackerTask, TrackerToday } from '@lexisora/shared';
import { clock, compareVersions, hm, istDayKey } from '@tracker-shared/format';
import {
  CONFIRM_CODES,
  commandSchema,
  type Command,
  type CommandResult,
  type ShotToast,
  type Simulation,
  type TrackerTab,
  type View,
  type ViewState,
} from '@tracker-shared/ipc';
import { Connectivity } from '../engine/backoff';
import { TrackerEngine, type EngineSnapshot } from '../engine/engine';
import { combine, computeTotals, localSpans, timelineFromSpans, type Bar, type DayTotals, type TimelineSpan } from '../engine/summary';
import { EngineError, type EngineConfig, type EngineEvent, type EngineOutput, type Segment } from '../engine/types';
import { ApiClient, ApiError, type LatestRelease } from '../services/api-client';
import type { KeyProtector } from '../services/crypto-box';
import { OutboxStore } from '../services/outbox-store';
import { RealtimeClient } from '../services/realtime';
import { captureScreens } from '../services/screenshots';
import { SyncService } from '../services/sync';
import { DiagLog } from './log';
import { deviceIdentity } from './platform';
import { emptyCache, LocalStore, type CacheDoc, type Credentials, type StoredPrefs } from './storage';
import * as vm from './view-model';
import { eventToWire, isPunchEvent, punchInput, segmentToWire } from './wire';

/** The window/tray layer the controller drives (implemented in main/index.ts with real windows). */
export interface UiShell {
  broadcast(state: ViewState): void;
  toast(text: string, tone?: 'info' | 'error'): void;
  showMain(): void;
  hideMain(): void;
  minimizeMain(): void;
  toggleMaximizeMain(): void;
  /** Bring the main window to the front and flash the taskbar button (idle prompt). */
  attention(): void;
  mainFocused(): boolean;
  widgetOpen(): void;
  widgetClose(): void;
  widgetToggle(): void;
  widgetVisible(): boolean;
  shotToast(shot: ShotToast): void;
  tray(dot: vm.DotState, tooltip: string): void;
  notify(title: string, body: string, onClick?: () => void): void;
  quit(): void;
}

export interface ControllerOptions {
  userData: string;
  appVersion: string;
  isDev: boolean;
  defaultServerUrl: string;
  protector: KeyProtector;
  shell: UiShell;
}

type PairState = {
  pairingToken: string;
  sessionExpiresAt: number;
  login: TrackerLoginResponse;
  workspace: string;
  deviceId: string | null;
  code: string | null;
  codeExpiresAt: number | null;
  permissions: string[];
  status: ViewState['pair']['status'];
  error: string | null;
  busy: boolean;
};

/** Server → device realtime events (TRACKER_SOCKET_EVENTS in packages/shared/src/tracker.ts). */
const SOCKET = {
  policyUpdated: 'policy.updated',
  deviceRevoked: 'device.revoked',
  attendancePunched: 'attendance.punched',
  tasksUpdated: 'tasks.updated',
  syncNow: 'command.syncNow',
} as const;

const ok = (message?: string): CommandResult => (message ? { ok: true, message } : { ok: true });
const fail = (code: string, error: string, meta?: Record<string, unknown>): CommandResult => ({ ok: false, code, error, ...(meta ? { meta } : {}) });
const toFailure = (e: unknown): CommandResult =>
  e instanceof EngineError || e instanceof ApiError ? fail(e.code, e.message) : fail('ERROR', e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const iso = (ms: number) => new Date(ms).toISOString();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Orchestrates the desktop tracker: the pure TrackerEngine (time accounting), the encrypted
 * outbox + SyncService (offline-first delivery), the realtime channel, powerMonitor signals,
 * screenshots, notifications and the view model pushed to the renderer windows.
 */
export class TrackerController {
  private readonly local: LocalStore;
  private readonly store: OutboxStore;
  private readonly api: ApiClient;
  private readonly conn = new Connectivity();
  private readonly sync: SyncService;
  readonly log: DiagLog;
  private readonly identity = deviceIdentity();
  private engine: TrackerEngine;
  private rt: RealtimeClient | null = null;

  private prefs: StoredPrefs;
  private creds: Credentials | null;
  private cache: CacheDoc;
  private pair: PairState | null = null;

  private view: View = 'boot';
  private tab: TrackerTab = 'track';
  private loginForm: ViewState['login'];
  private mode: TrackerMode = 'PUNCH';
  private modeMessage: string | null = null;
  private lastIdleSec = 0;
  private punchBusy = false;
  private confirmBusy = false;
  private unpairState: ViewState['unpair'] = { busy: false, progress: null };
  private update: LatestRelease | null = null;
  private lastShot: { at: number; taskKey: string } | null = null;
  private capturing = false;
  private forcedOffline = false;
  private shuttingDown = false;
  private ready = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private onlineTimers: ReturnType<typeof setInterval>[] = [];
  private pairTimer: ReturnType<typeof setTimeout> | null = null;
  private todayTimer: ReturnType<typeof setTimeout> | null = null;
  private todayInFlight: Promise<void> | null = null;
  private lastTickWall: number | null = null;
  private lastSave = 0;
  private lastTray = '';
  private lastState: ViewState | null = null;

  constructor(private readonly opts: ControllerOptions) {
    this.local = new LocalStore(opts.userData, opts.protector);
    this.log = new DiagLog(this.local.logDir);
    this.store = new OutboxStore(this.local.outboxDir, this.local.key);
    this.prefs = this.local.readPrefs();
    this.creds = this.local.readCredentials();
    this.cache = this.local.readCache();
    this.api = new ApiClient(this.creds?.serverUrl ?? this.prefs.serverUrl ?? opts.defaultServerUrl, `LexisoraTracker/${opts.appVersion}`);
    this.loginForm = { workspace: this.prefs.lastWorkspace, email: this.prefs.lastEmail, busy: false, error: null, notEligible: false, notice: null };
    this.engine = this.makeEngine(null);

    this.api.onOutcome = (reachable) => this.onOutcome(reachable);
    this.api.onUnauthorized = () => this.onRevoked('This device was signed out. Sign in again to pair it.');
    this.sync = new SyncService(this.store, this.api, () => this.isOnline(), {
      onChange: () => this.push(),
      onAcked: (ids, kind) => {
        const t = Date.now();
        for (const id of ids) this.cache.acks[id] = [t, kind === 'shot'];
      },
      onPunch: (_input, r, startedAt) => this.applyToday(r.today, startedAt),
      onPunchRejected: (input, err) => this.onPunchRejected(input, err),
      onBatch: () => {
        this.cache.lastSyncAt = Date.now();
        this.scheduleTodayRefresh();
      },
      onShot: () => this.scheduleTodayRefresh(),
      onAuthLost: () => this.onRevoked('This device was signed out. Sign in again to pair it.'),
      log: (m) => this.log.add(m, 'warn'),
    });
  }

  // ── lifecycle ────────────────────────────────────────────────────────────
  init() {
    this.log.add(`Lexisora Tracker v${this.opts.appVersion} started`);
    if (this.store.corruptLines > 1) this.log.add(`${this.store.corruptLines} unreadable outbox lines were kept aside`, 'warn');
    this.pruneAcks();
    if (!this.prefs.firstRunDone) {
      this.prefs.firstRunDone = true;
      this.savePrefs();
      this.applyLoginItem();
    }
    const snap = this.local.snapshot.read();
    if (this.creds) {
      this.api.token = this.creds.deviceToken;
      this.mode = this.cache.policy?.mode ?? this.creds.mode;
      this.modeMessage = this.cache.policy?.modeMessage ?? this.creds.modeMessage;
      this.engine = this.makeEngine(snap);
      this.view = 'home';
      const out = this.engine.recover(Date.now());
      this.handleOutput(out);
      if (!this.engine.activeTaskId && this.cache.tasks[0]) this.engine.switchTask(Date.now(), this.cache.tasks[0].id);
      this.startOnline();
      if (this.engine.status !== 'OUT' && this.prefs.showTrayWidget) this.opts.shell.widgetOpen();
    } else {
      this.view = 'login';
      if (snap) this.local.snapshot.write(this.engine.snapshot());
    }
    this.attachPower();
    this.tickTimer = setInterval(() => this.onTick(), 1000);
    this.ready = true;
    this.saveSnapshot();
    this.push();
  }

  get paired() {
    return !!this.creds;
  }

  get stopped() {
    return this.shuttingDown;
  }

  /** Quit / OS shutdown: close what's open (APP_QUIT) and try to flush for up to 3 s. */
  async shutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.view === 'home') this.handleOutput(this.engine.appQuit(Date.now()));
    this.saveSnapshot();
    this.saveCache();
    if (this.creds && this.isOnline() && this.store.queue.size) await Promise.race([this.sync.flush(), sleep(3000)]);
    this.sync.stop();
    this.stopOnline();
    this.clearPairTimer();
    this.log.add('Tracker stopped');
  }

  /** powerMonitor 'shutdown' / Windows session end: synchronous best effort. */
  onSystemShutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.view === 'home') this.handleOutput(this.engine.appQuit(Date.now()));
    this.saveSnapshot();
    this.saveCache();
    this.log.add('Windows is shutting down · tracking paused');
  }

  /** Tray → Quit: "Punch out before quitting?" [Punch out & quit] / [Quit (tracking stops)] / [Cancel]. */
  async requestQuit() {
    if (this.view === 'home' && this.engine.status !== 'OUT' && !this.engine.attached && this.mode === 'PUNCH') {
      const r = await dialog.showMessageBox({
        type: 'question',
        title: 'Lexisora Tracker',
        message: 'Punch out before quitting?',
        detail: 'If you quit without punching out, tracking stops. When the tracker starts again you will be asked how to count the gap.',
        buttons: ['Punch out & quit', 'Quit (tracking stops)', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (r.response === 2) return;
      if (r.response === 0) {
        const now = Date.now();
        if (this.engine.prompting) this.handleOutput(this.engine.resolveIdle(now, 'IDLE'));
        this.handleOutput(this.engine.punchOut(now));
        this.cache.sessionStartedAt = null;
        this.log.add('Punched out');
      }
    }
    await this.shutdown();
    this.opts.shell.quit();
  }

  private makeEngine(snapshot: EngineSnapshot | null): TrackerEngine {
    return new TrackerEngine({
      uuid: randomUUID,
      dayKey: istDayKey,
      config: this.engineConfig(),
      snapshot: snapshot && snapshot.v === 1 ? snapshot : null,
      now: Date.now(),
    });
  }

  private engineConfig(): Partial<EngineConfig> {
    const p = this.cache?.policy;
    const reminders = this.prefs?.breakReminders ?? true;
    if (!p) return { breakReminderSec: reminders ? 7200 : 0 };
    return {
      idleThresholdSec: p.autoIdleEnabled ? p.idleThresholdMin * 60 : 0,
      screenshotsEnabled: p.screenshotsEnabled,
      screenshotIntervalSec: Math.max(60, p.screenshotIntervalMin * 60),
      breakReminderSec: reminders ? Math.max(0, p.breakReminderMin) * 60 : 0,
    };
  }

  private isOnline() {
    return this.conn.online && !this.forcedOffline;
  }

  // ── the 1-second loop ────────────────────────────────────────────────────
  private systemIdleSec(): number {
    try {
      return powerMonitor.getSystemIdleTime();
    } catch {
      return 0;
    }
  }

  private onTick() {
    if (this.shuttingDown) return;
    const now = Date.now();
    const idleSec = this.systemIdleSec();
    this.lastIdleSec = idleSec;
    if (this.view === 'home') {
      // A long gap between ticks without a suspend event (hibernate, frozen VM) is treated as sleep.
      const prev = this.lastTickWall;
      if (prev !== null && now - prev > 60_000 && this.engine.status === 'WORKING' && !this.engine.away && !this.engine.prompting) {
        this.handleOutput(this.engine.lock(prev, 'SUSPEND', prev));
        this.handleOutput(this.engine.unlock(now, 'RESUME'));
        this.log.add(`No activity signal from ${clock(prev)} to ${clock(now)} (sleep?)`);
      }
      if (this.engine.status === 'OUT' && this.engine.rollDay(now)) {
        this.log.add('New day · totals reset');
        void this.refreshToday();
      }
      this.handleOutput(this.engine.tick(now, idleSec));
      if (now - this.lastSave > 15_000) {
        this.saveSnapshot();
        this.saveCache();
      }
    } else if (this.view === 'pair' && this.pair?.status === 'PENDING' && this.pair.codeExpiresAt && now > this.pair.codeExpiresAt) {
      this.pair.status = 'EXPIRED';
      this.clearPairTimer();
    }
    this.lastTickWall = now;
    this.push();
  }

  /** Queue what the engine produced; react to idle / screenshot / reminder signals. */
  private handleOutput(out: EngineOutput, opts: { punch?: 'queue' | 'skip' } = {}) {
    let queued = 0;
    for (const seg of out.segments) if (this.store.append('segment', seg.clientId, segmentToWire(seg))) queued++;
    for (const ev of out.events) {
      if (isPunchEvent(ev)) {
        if (opts.punch !== 'skip' && this.store.append('punch', ev.clientId, punchInput(ev))) queued++;
      } else if (this.store.append('event', ev.clientId, eventToWire(ev))) queued++;
    }
    if (out.idleStarted) this.onIdleStarted();
    if (out.shotDue) void this.captureScreenshot();
    if (out.breakReminderDue) this.onBreakReminder();
    if (queued) {
      this.sync.trigger();
      this.saveSnapshot();
    }
  }

  // ── power signals ────────────────────────────────────────────────────────
  private attachPower() {
    powerMonitor.on('lock-screen', () => this.onPower('LOCK'));
    powerMonitor.on('unlock-screen', () => this.onPower('UNLOCK'));
    powerMonitor.on('suspend', () => this.onPower('SUSPEND'));
    powerMonitor.on('resume', () => this.onPower('RESUME'));
    powerMonitor.on('shutdown', () => this.onSystemShutdown());
  }

  private onPower(kind: 'LOCK' | 'UNLOCK' | 'SUSPEND' | 'RESUME') {
    if (this.view !== 'home' || this.shuttingDown) return;
    const now = Date.now();
    if (kind === 'LOCK' || kind === 'SUSPEND') {
      const lastInput = now - this.systemIdleSec() * 1000;
      this.handleOutput(this.engine.lock(now, kind, lastInput));
      if (this.engine.status !== 'OUT') this.log.add(kind === 'LOCK' ? 'Screen locked' : 'PC going to sleep');
      this.saveSnapshot();
    } else {
      this.handleOutput(this.engine.unlock(now, kind));
      if (this.engine.status !== 'OUT') this.log.add(kind === 'UNLOCK' ? 'Screen unlocked' : 'PC resumed');
      this.lastTickWall = now;
      if (kind === 'RESUME' && this.creds) {
        void this.heartbeat();
        void this.refreshToday();
      }
    }
    this.push();
  }

  // ── connectivity ─────────────────────────────────────────────────────────
  private onOutcome(reachable: boolean) {
    if (this.forcedOffline) return;
    if (reachable) {
      if (this.conn.success().justReconnected) this.onReconnected();
    } else if (this.conn.failure().wentOffline) {
      this.log.add('Connection lost · tracking locally', 'warn');
      this.push();
    }
  }

  private onReconnected() {
    if (this.shuttingDown || !this.creds) return;
    const pending = this.store.queue.size;
    this.rt?.kick();
    void this.sync.flush().then((r) => {
      if (pending > 0 || r.synced > 0) {
        const msg = `Back online · ${plural(r.synced, 'entry').replace('entrys', 'entries')} synced`;
        this.log.add(msg);
        this.opts.shell.toast(msg);
      } else this.log.add('Back online');
      if (r.ok && this.cache.pendingConfirm) void this.confirmPending();
      void this.refreshToday();
      this.push();
    });
  }

  private startOnline() {
    this.stopOnline();
    this.sync.resume();
    this.startRealtime();
    const every = (ms: number, fn: () => void) => this.onlineTimers.push(setInterval(fn, ms));
    every(60_000, () => void this.heartbeat());
    every(60_000, () => void this.refreshToday());
    every(10 * 60_000, () => void this.refreshTasks());
    every(4 * 3600_000, () => void this.checkUpdate(false));
    every(3600_000, () => this.pruneQueue());
    void this.bootstrapFetch();
  }

  private stopOnline() {
    for (const t of this.onlineTimers) clearInterval(t);
    this.onlineTimers = [];
    if (this.todayTimer) clearTimeout(this.todayTimer);
    this.todayTimer = null;
    this.rt?.stop();
    this.rt = null;
  }

  private async bootstrapFetch() {
    await this.refreshPolicy(false);
    await Promise.allSettled([this.refreshTasks(), this.refreshToday(), this.heartbeat()]);
    this.pruneQueue();
    if (this.store.queue.size) void this.sync.flush();
    if (this.cache.pendingConfirm && this.isOnline()) void this.confirmPending();
    void this.checkUpdate(false);
  }

  private startRealtime() {
    this.rt?.stop();
    this.rt = null;
    if (!this.creds || !RealtimeClient.supported()) return;
    const rt = new RealtimeClient(this.api.baseUrl, this.creds.deviceToken);
    rt.on(SOCKET.policyUpdated, () => void this.refreshPolicy(true));
    rt.on(SOCKET.deviceRevoked, () => this.onRevoked('This device was revoked by HR. Sign in again to pair it.'));
    rt.on(SOCKET.attendancePunched, () => void this.refreshToday());
    rt.on(SOCKET.tasksUpdated, () => void this.refreshTasks());
    rt.on(SOCKET.syncNow, () => void this.sync.flush());
    rt.onStatus = (connected) => {
      if (connected) void this.refreshToday();
    };
    this.rt = rt;
    if (!this.forcedOffline) rt.start();
  }

  private async heartbeat() {
    if (!this.creds) return;
    try {
      const status = this.engine.status === 'OUT' ? 'OUT' : this.engine.prompting ? 'IDLE' : this.engine.status;
      const r = await this.api.heartbeat({
        status,
        taskId: this.engine.activeTaskId,
        queueDepth: this.store.queue.size,
        appVersion: this.opts.appVersion,
        displays: Math.min(12, Math.max(1, screen.getAllDisplays().length)),
      });
      if (r.deviceStatus === 'REVOKED') return this.onRevoked('This device was revoked by HR. Sign in again to pair it.');
      if (!this.cache.policy || r.policyUpdatedAt !== this.cache.policy.updatedAt) void this.refreshPolicy(!!this.cache.policy);
    } catch {
      /* connectivity is tracked by onOutcome */
    }
  }

  private async refreshPolicy(announce: boolean) {
    if (!this.creds) return;
    try {
      const p = await this.api.policy();
      const prev = this.cache.policy;
      this.cache.policy = p;
      this.mode = p.mode;
      this.modeMessage = p.modeMessage;
      this.engine.setConfig(this.engineConfig());
      this.saveCache();
      if (announce && prev && prev.updatedAt !== p.updatedAt) {
        this.log.add('Tracker policy updated by HR');
        this.opts.shell.toast('Tracker policy updated by HR');
      }
      this.push();
    } catch {
      /* keep the cached policy */
    }
  }

  private async refreshTasks() {
    if (!this.creds) return;
    try {
      const tasks = await this.api.tasks();
      this.cache.tasks = tasks;
      for (const t of tasks) this.cache.known[t.id] = { key: t.key, title: t.title, projectName: t.projectName };
      if (!this.engine.activeTaskId && tasks[0] && this.engine.status === 'OUT') this.engine.switchTask(Date.now(), tasks[0].id);
      this.saveCache();
      this.push();
    } catch {
      /* keep cached tasks */
    }
  }

  private refreshToday(): Promise<void> {
    if (!this.creds) return Promise.resolve();
    if (this.todayInFlight) return this.todayInFlight;
    const requestedAt = Date.now();
    this.todayInFlight = this.api
      .today()
      .then((t) => this.applyToday(t, requestedAt))
      .catch(() => undefined)
      .finally(() => {
        this.todayInFlight = null;
      });
    return this.todayInFlight;
  }

  private scheduleTodayRefresh() {
    if (this.todayTimer) clearTimeout(this.todayTimer);
    this.todayTimer = setTimeout(() => {
      this.todayTimer = null;
      void this.refreshToday();
    }, 800);
  }

  /** New server baseline for today (all devices, everything synced before `requestedAt`). */
  private applyToday(t: TrackerToday, requestedAt: number) {
    this.cache.today = { ...t, requestedAt, fetchedAt: Date.now() };
    for (const [id, [at]] of Object.entries(this.cache.acks)) if (at < requestedAt) delete this.cache.acks[id];
    for (const b of t.byTask) if (b.taskId) this.cache.known[b.taskId] = { ...this.cache.known[b.taskId], key: b.key, title: b.title };
    if (t.mode && t.mode !== this.mode) {
      this.mode = t.mode;
      void this.refreshPolicy(false);
    }
    this.reconcileSession(t);
    this.saveCache();
    this.push();
  }

  /**
   * Keep this device in step with the attendance session on the server:
   *  - MONITOR_ONLY: the biometric IN starts tracking, the biometric OUT stops it;
   *  - a session closed on the web portal (or by HR) detaches this device;
   *  - an open web session is offered as "Continue tracking here" (see buildState).
   */
  private reconcileSession(t: TrackerToday) {
    if (this.punchBusy || this.store.queue.nextPunch()) return;
    const now = Date.now();
    if (t.date && t.date !== istDayKey(now)) return;
    const st = this.engine.status;
    const mode = t.mode ?? this.mode;
    if (t.status === 'OUT') {
      if (st === 'OUT') return;
      const lastOut = t.lastOutAt ? Date.parse(t.lastOutAt) : null;
      const started = this.cache.sessionStartedAt ?? 0;
      if (!this.engine.attached && (lastOut === null || lastOut < started - 60_000)) return;
      this.handleOutput(this.engine.punchOut(now, { detach: true }));
      this.cache.sessionStartedAt = null;
      const msg =
        mode === 'MONITOR_ONLY'
          ? `Biometric OUT${lastOut ? ` at ${clock(lastOut)}` : ''} · tracking stopped`
          : `Punched out ${t.punchSource === 'BIOMETRIC' ? 'with biometric' : 'on the web portal'} · tracking stopped`;
      this.log.add(msg);
      this.opts.shell.notify('Lexisora Tracker', msg);
      this.tab = 'summary';
      this.opts.shell.widgetClose();
      return;
    }
    if (st === 'OUT' && mode === 'MONITOR_ONLY') {
      this.handleOutput(this.engine.punchIn(now, this.engine.activeTaskId ?? this.defaultTaskId(), { attached: true }));
      this.cache.sessionStartedAt = now;
      const msg = `Biometric IN${t.punchedInAt ? ` at ${clock(Date.parse(t.punchedInAt))}` : ''} · tracking started`;
      this.log.add(msg);
      this.opts.shell.notify('Lexisora Tracker', msg);
      if (this.prefs.showTrayWidget) this.opts.shell.widgetOpen();
    }
  }

  private pruneQueue() {
    const days = this.cache.policy?.offlineRetentionDays ?? 7;
    const dropped = this.store.prune(days);
    if (dropped.length) {
      const msg = `${dropped.length} offline entries older than ${days} days were discarded`;
      this.log.add(msg, 'warn');
      this.opts.shell.toast(msg, 'error');
    }
  }

  private pruneAcks() {
    const cutoff = Date.now() - 2 * 86_400_000;
    for (const [id, [at]] of Object.entries(this.cache.acks)) if (at < cutoff) delete this.cache.acks[id];
  }

  private async checkUpdate(manual: boolean): Promise<CommandResult> {
    if (!this.creds) return fail('NOT_PAIRED', 'Pair this device first');
    try {
      const r = await this.api.latestRelease();
      if (r && compareVersions(r.version, this.opts.appVersion) > 0) {
        this.update = r;
        this.log.add(`Update v${r.version} available`);
        return ok(manual ? `Update v${r.version} available · see Settings` : undefined);
      }
      this.update = null;
      return ok(manual ? (r ? "You're on the latest version" : 'Updates are rolled out by your IT team') : undefined);
    } catch (e) {
      return manual ? fail('UPDATE_CHECK_FAILED', "Couldn't check for updates. Try again later.") : ok();
    }
  }

  // ── commands (renderer IPC, tray, widget) ────────────────────────────────
  async handle(raw: unknown): Promise<CommandResult> {
    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success) return fail('VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Invalid request');
    try {
      return await this.dispatch(parsed.data);
    } catch (e) {
      return toFailure(e);
    } finally {
      this.push();
    }
  }

  private async dispatch(cmd: Command): Promise<CommandResult> {
    switch (cmd.type) {
      case 'login':
        return this.login(cmd.workspace, cmd.email, cmd.password);
      case 'server.set': {
        if (this.creds) return fail('PAIRED', 'Sign out first to change the server');
        this.api.setServer(cmd.url);
        this.prefs.serverUrl = this.api.baseUrl;
        this.savePrefs();
        this.conn.success();
        return ok(`Server set to ${this.api.baseUrl}`);
      }
      case 'pair.poll':
        return this.pollPair(true);
      case 'pair.newCode':
        return this.newCode();
      case 'pair.cancel':
        return this.cancelPair();
      case 'punchIn':
        return this.punchIn();
      case 'punchOut':
        return this.punchOut(!!cmd.confirmed);
      case 'attach':
        return this.attach();
      case 'break.toggle':
        return this.toggleBreak();
      case 'task.switch':
        return this.switchTask(cmd.taskId);
      case 'idle.resolve':
        return this.resolveIdle(cmd.resolution, cmd.note);
      case 'tab':
        return this.setTab(cmd.tab);
      case 'sync.force':
        return this.confirmDay();
      case 'pref.set':
        return this.setPref(cmd.key, cmd.value);
      case 'signOut':
        return this.signOut(cmd);
      case 'window':
        if (cmd.action === 'minimize') this.opts.shell.minimizeMain();
        else if (cmd.action === 'maximize') this.opts.shell.toggleMaximizeMain();
        else this.hideToTray();
        return ok();
      case 'widget':
        if (cmd.action === 'open') this.opts.shell.widgetOpen();
        else if (cmd.action === 'close') this.opts.shell.widgetClose();
        else this.opts.shell.widgetToggle();
        return ok();
      case 'open':
        this.opts.shell.widgetClose();
        this.openMain(cmd.tab ?? 'track');
        return ok();
      case 'copyDiagnostics':
        clipboard.writeText(JSON.stringify(this.diagnostics(), null, 2));
        this.log.add('Diagnostics copied');
        return ok('Diagnostics copied to the clipboard');
      case 'update.open': {
        const url = this.update?.url ?? this.update?.downloadUrl;
        if (!url || !/^https?:\/\//i.test(url)) return fail('NO_UPDATE', 'No download link is available yet');
        await electronShell.openExternal(url);
        return ok();
      }
      case 'update.check':
        return this.checkUpdate(true);
      case 'simulate':
        return this.simulate(cmd.kind);
    }
  }

  openMain(tab?: TrackerTab) {
    if (tab && this.view === 'home') this.tab = tab;
    this.opts.shell.showMain();
    this.push();
  }

  /** Tray left-click: toggle the mini widget (or open the window while not paired). */
  onTrayClick() {
    if (this.view !== 'home') this.openMain();
    else this.opts.shell.widgetToggle();
    this.push();
  }

  hideToTray() {
    this.opts.shell.hideMain();
    if (!this.prefs.trayHintShown) {
      this.prefs.trayHintShown = true;
      this.savePrefs();
      this.opts.shell.notify('Still tracking in the tray', 'Lexisora Tracker keeps running near the clock. Right-click the tray icon to quit.');
    }
  }

  trayMenu(): MenuItemConstructorOptions[] {
    const s = this.lastState ?? this.buildState();
    const items: MenuItemConstructorOptions[] = [];
    if (this.view === 'home') {
      const inSession = s.status !== 'OUT';
      items.push({ label: s.statusLabel, enabled: false });
      items.push({ label: `Worked today ${s.worked}`, enabled: false });
      if (s.activeTask) items.push({ label: `${s.activeTask.key} · ${s.activeTask.title}`.slice(0, 64), enabled: false });
      items.push({ type: 'separator' });
      items.push({ label: 'Open', click: () => this.openMain('track') });
      if (inSession) {
        items.push({ label: s.status === 'BREAK' ? 'End break' : 'Start break', enabled: !s.idle, click: () => void this.handle({ type: 'break.toggle' }) });
      }
      if (this.mode === 'PUNCH') {
        items.push(
          inSession
            ? { label: 'Punch out', enabled: !s.idle, click: () => void this.trayPunchOut() }
            : { label: 'Punch in', enabled: !s.punch.blocked && !s.serverSession, click: () => void this.trayCommand({ type: 'punchIn' }) },
        );
      }
      items.push({ label: 'Settings', click: () => this.openMain('settings') });
      items.push({ label: 'Check for updates', click: () => void this.trayCommand({ type: 'update.check' }) });
    } else {
      items.push({ label: 'Lexisora Tracker · not signed in', enabled: false }, { type: 'separator' }, { label: 'Open', click: () => this.openMain() });
    }
    items.push({ type: 'separator' }, { label: 'Quit', click: () => void this.requestQuit() });
    return items;
  }

  private async trayCommand(cmd: Command) {
    const r = await this.handle(cmd);
    if (!r.ok) this.opts.shell.notify('Lexisora Tracker', r.error);
    else if (r.message) this.opts.shell.notify('Lexisora Tracker', r.message);
  }

  private async trayPunchOut() {
    const r = await this.handle({ type: 'punchOut' });
    if (!r.ok && r.code === CONFIRM_CODES.earlyPunchOut) {
      const c = await dialog.showMessageBox({ type: 'question', title: 'Lexisora Tracker', message: r.error, buttons: ['Punch out', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
      if (c.response === 0) await this.trayCommand({ type: 'punchOut', confirmed: true });
    } else if (!r.ok) this.opts.shell.notify('Lexisora Tracker', r.error);
  }

  // ── sign-in & pairing ───────────────────────────────────────────────────
  private async login(workspace: string, email: string, password: string): Promise<CommandResult> {
    if (this.creds) return fail('PAIRED', 'This device is already paired');
    this.loginForm = { workspace, email, busy: true, error: null, notEligible: false, notice: null };
    this.push();
    try {
      const res = await this.api.login({ workspace, email, password });
      this.prefs.lastWorkspace = workspace;
      this.prefs.lastEmail = email;
      this.prefs.serverUrl = this.api.baseUrl;
      this.savePrefs();
      this.pair = {
        pairingToken: res.pairingToken,
        sessionExpiresAt: Date.parse(res.expiresAt),
        login: res,
        workspace,
        deviceId: null,
        code: null,
        codeExpiresAt: null,
        permissions: [],
        status: 'IDLE',
        error: null,
        busy: true,
      };
      this.view = 'pair';
      this.log.add(`Signed in as ${res.user.name}`);
      await this.pairStart();
      return ok();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'ERROR', String(e));
      if (err.code === 'TRACKER_NOT_ELIGIBLE') this.loginForm.notEligible = true;
      this.loginForm.error =
        err.code === 'TRACKER_NOT_ELIGIBLE'
          ? vm.FOOTER_NOTE
          : err.code === 'WORKSPACE_NOT_FOUND'
            ? 'Workspace not found'
            : err.network
              ? `Can't reach ${this.api.baseUrl}. Check your connection or the server address.`
              : err.message;
      return fail(err.code, this.loginForm.error);
    } finally {
      this.loginForm.busy = false;
    }
  }

  private async pairStart() {
    const p = this.pair;
    if (!p) return;
    p.busy = true;
    p.error = null;
    this.push();
    try {
      const r = await this.api.pairStart(p.pairingToken, { hostname: this.identity.hostname, os: this.identity.os, appVersion: this.opts.appVersion });
      if (this.pair !== p) return;
      p.deviceId = r.deviceId;
      p.code = r.code;
      p.codeExpiresAt = Date.parse(r.expiresAt);
      p.permissions = r.permissions?.length ? r.permissions : vm.DEFAULT_PERMISSIONS;
      p.status = 'PENDING';
      this.log.add('Pairing code issued');
      this.schedulePairPoll(r.pollAfterSec ?? 3);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return this.pairSessionExpired();
      p.status = 'ERROR';
      p.error = e instanceof ApiError ? e.message : String(e);
    } finally {
      p.busy = false;
      this.push();
    }
  }

  private pairSessionExpired() {
    this.clearPairTimer();
    this.pair = null;
    this.view = 'login';
    this.loginForm.error = 'Your sign-in expired. Sign in again to pair this device';
    this.push();
  }

  private schedulePairPoll(sec: number) {
    this.clearPairTimer();
    this.pairTimer = setTimeout(() => void this.pollPair(false), Math.max(1, sec) * 1000);
  }

  private clearPairTimer() {
    if (this.pairTimer) clearTimeout(this.pairTimer);
    this.pairTimer = null;
  }

  private async pollPair(manual: boolean): Promise<CommandResult> {
    const p = this.pair;
    if (!p || !p.deviceId) return fail('NO_PAIRING', 'Get a pairing code first');
    if (p.status === 'EXPIRED' || (p.codeExpiresAt && Date.now() > p.codeExpiresAt)) {
      p.status = 'EXPIRED';
      return fail('EXPIRED', 'This code has expired. Get a new code.');
    }
    this.clearPairTimer();
    let r: PairStatusResponse;
    try {
      r = await this.api.pairStatus(p.pairingToken);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.pairSessionExpired();
        return fail('PAIRING_SESSION_EXPIRED', 'Your sign-in expired. Sign in again to pair this device');
      }
      if (this.pair === p) this.schedulePairPoll(5);
      return fail('NETWORK', e instanceof ApiError ? e.message : String(e));
    }
    if (this.pair !== p) return ok();
    switch (r.status) {
      case 'APPROVED':
        this.completePairing(r);
        return ok();
      case 'AWAITING_HR':
        p.status = 'AWAITING_HR';
        this.schedulePairPoll(5);
        return manual ? fail('AWAITING_HR', 'Waiting for HR approval') : ok();
      case 'PENDING':
        p.status = 'PENDING';
        this.schedulePairPoll(3);
        return manual ? fail('NOT_APPROVED', 'Not approved yet') : ok();
      case 'REJECTED':
        p.status = 'REJECTED';
        p.error = 'The pairing request was rejected. Get a new code to try again.';
        return fail('REJECTED', p.error);
      default:
        p.status = 'EXPIRED';
        return fail('EXPIRED', 'This code has expired. Get a new code.');
    }
  }

  private completePairing(r: Extract<PairStatusResponse, { status: 'APPROVED' }>) {
    const p = this.pair!;
    this.clearPairTimer();
    const u = p.login.user;
    const creds: Credentials = {
      serverUrl: this.api.baseUrl,
      workspace: p.workspace,
      deviceId: r.deviceId ?? p.deviceId!,
      deviceToken: r.deviceToken,
      hostname: r.device?.hostname ?? this.identity.hostname,
      os: r.device?.os ?? this.identity.os,
      pairedAt: r.device?.pairedAt ?? new Date().toISOString(),
      mode: p.login.mode,
      modeMessage: p.login.modeMessage,
      user: { name: u.name, initials: u.initials, email: u.email, empCode: u.empCode, workMode: u.workMode, tenantName: u.tenantName },
    };
    if (this.prefs.lastPairedEmail && this.prefs.lastPairedEmail !== u.email) {
      // A different person on this PC: never replay someone else's queued time.
      this.store.clear();
      this.engine = this.makeEngine(null);
      this.cache = emptyCache();
    }
    this.prefs.lastPairedEmail = u.email;
    this.savePrefs();
    this.local.writeCredentials(creds);
    this.creds = creds;
    this.api.token = creds.deviceToken;
    this.mode = p.login.mode;
    this.modeMessage = p.login.modeMessage;
    this.pair = null;
    this.view = 'home';
    this.tab = 'track';
    this.loginForm = { ...this.loginForm, error: null, notice: null, notEligible: false };
    this.log.add('Device paired');
    this.opts.shell.toast(`${creds.hostname} paired`);
    this.startOnline();
    this.saveCache();
    this.saveSnapshot();
  }

  private async newCode(): Promise<CommandResult> {
    if (!this.pair) return fail('NO_SESSION', 'Sign in again to pair this device');
    if (Date.now() > this.pair.sessionExpiresAt) {
      this.pairSessionExpired();
      return fail('PAIRING_SESSION_EXPIRED', 'Your sign-in expired. Sign in again to pair this device');
    }
    await this.pairStart();
    return this.pair?.status === 'PENDING' ? ok('New code issued') : fail('PAIR_FAILED', this.pair?.error ?? 'Could not get a new code');
  }

  private async cancelPair(): Promise<CommandResult> {
    const p = this.pair;
    this.clearPairTimer();
    this.pair = null;
    this.view = 'login';
    if (p) void this.api.pairCancel(p.pairingToken).catch(() => undefined);
    return ok();
  }

  /** Device revoked by HR, token rejected, or unpaired from the web: back to sign-in, keep the queue for a re-pair. */
  private onRevoked(notice: string) {
    if (!this.creds) return;
    const now = Date.now();
    if (this.engine.status !== 'OUT') this.handleOutput(this.engine.punchOut(now, { detach: true }));
    this.cache.sessionStartedAt = null;
    this.stopOnline();
    this.sync.stop();
    this.local.clearCredentials();
    this.creds = null;
    this.api.token = null;
    this.view = 'login';
    this.tab = 'track';
    this.loginForm = { ...this.loginForm, busy: false, error: null, notEligible: false, notice };
    this.opts.shell.widgetClose();
    this.opts.shell.notify('Lexisora Tracker', notice);
    this.log.add(notice, 'warn');
    this.saveSnapshot();
    this.saveCache();
    this.push();
  }

  private async signOut(cmd: { confirmed?: boolean; discard?: 'UNPAIR' }): Promise<CommandResult> {
    if (!this.creds) {
      this.view = 'login';
      return ok();
    }
    if (this.unpairState.busy) return fail('BUSY', 'Signing out…');
    const ownSession = this.engine.status !== 'OUT' && !this.engine.attached;
    if (ownSession && !cmd.confirmed && !cmd.discard) return fail(CONFIRM_CODES.unpairPunchOut, 'Punch out and unpair?');
    if (this.engine.prompting) return fail('IDLE_UNRESOLVED', 'Choose how to count your idle time first');
    if (this.engine.status !== 'OUT') {
      this.handleOutput(this.engine.punchOut(Date.now(), { detach: this.engine.attached }));
      this.cache.sessionStartedAt = null;
      this.log.add(ownSession ? 'Punched out' : 'Tracking stopped');
    }
    const queued = this.store.queue.size;
    if (queued > 0 && !cmd.discard) {
      if (!this.isOnline()) return fail(CONFIRM_CODES.unpairOffline, `${plural(queued, 'entry').replace('entrys', 'entries')} not synced — connect first`, { queued });
      this.unpairState = { busy: true, progress: `Syncing ${plural(queued, 'entry').replace('entrys', 'entries')}…` };
      this.push();
      await this.sync.flush();
      this.unpairState = { busy: false, progress: null };
      const left = this.store.queue.size;
      if (left > 0) return fail(CONFIRM_CODES.unpairOffline, `${plural(left, 'entry').replace('entrys', 'entries')} not synced — connect first`, { queued: left });
    }
    if (this.isOnline()) {
      this.unpairState = { busy: true, progress: 'Unpairing…' };
      this.push();
      try {
        await this.api.unpair();
      } catch {
        /* the credential is removed locally either way */
      }
    }
    this.finishSignOut(!!cmd.discard);
    return ok('Signed out · this device is unpaired');
  }

  private finishSignOut(discard: boolean) {
    this.stopOnline();
    this.sync.stop();
    if (discard) this.store.clear();
    this.local.clearCredentials();
    this.creds = null;
    this.api.token = null;
    this.engine = this.makeEngine(null);
    this.cache = emptyCache();
    this.update = null;
    this.lastShot = null;
    this.saveSnapshot();
    this.saveCache();
    this.opts.shell.widgetClose();
    this.view = 'login';
    this.tab = 'track';
    this.unpairState = { busy: false, progress: null };
    this.loginForm = { ...this.loginForm, busy: false, error: null, notEligible: false, notice: 'Signed out · this device is no longer paired.' };
    this.log.add(discard ? 'Unpaired · unsynced entries discarded' : 'Signed out & unpaired');
  }

  // ── tracking ─────────────────────────────────────────────────────────────
  private defaultTaskId(): string | null {
    return this.cache.tasks[0]?.id ?? null;
  }

  private punchBlocked(now: number): string | null {
    if (this.update?.mandatory) return `Update required · install v${this.update.version} to punch in`;
    const oldest = this.store.queue.oldestCreatedAt();
    return vm.offlineBlock({
      online: this.isOnline(),
      queued: this.store.queue.size,
      lastSyncAt: this.cache.lastSyncAt,
      oldestPendingAt: oldest,
      now,
      retentionDays: this.cache.policy?.offlineRetentionDays ?? 7,
    });
  }

  private async punchIn(): Promise<CommandResult> {
    if (this.view !== 'home') return fail('NOT_PAIRED', 'Pair this device first');
    if (this.mode === 'MONITOR_ONLY') return fail('PUNCH_NOT_ALLOWED', this.modeMessage ?? vm.MONITOR_ONLY_MESSAGE);
    if (this.engine.status !== 'OUT') return fail('ALREADY_PUNCHED_IN', 'You are already punched in');
    if (this.punchBusy) return fail('BUSY', 'One moment…');
    const now = Date.now();
    const blocked = this.punchBlocked(now);
    if (blocked) return fail('PUNCH_BLOCKED', blocked);
    const snap = this.engine.snapshot();
    const prevStart = this.cache.sessionStartedAt;
    const out = this.engine.punchIn(now, this.engine.activeTaskId ?? this.defaultTaskId());
    this.handleOutput(out, { punch: 'skip' });
    this.cache.sessionStartedAt = now;
    const ev = out.events.find(isPunchEvent);
    const r = ev ? await this.deliverPunch(ev) : ok();
    if (!r.ok) {
      this.engine = this.makeEngine(snap);
      this.cache.sessionStartedAt = prevStart;
      this.saveSnapshot();
      return r;
    }
    this.tab = 'track';
    this.log.add(r.message ? 'Punched in · desktop (offline)' : 'Punched in · desktop');
    if (this.prefs.showTrayWidget) this.opts.shell.widgetOpen();
    this.saveSnapshot();
    this.saveCache();
    return r;
  }

  private async punchOut(confirmed: boolean): Promise<CommandResult> {
    if (this.engine.status === 'OUT') return fail('NOT_PUNCHED_IN', 'You are not punched in');
    if (this.mode === 'MONITOR_ONLY' && this.engine.attached) return fail('PUNCH_NOT_ALLOWED', 'Office staff punch out with biometric.');
    if (this.engine.prompting) return fail('IDLE_UNRESOLVED', 'Choose how to count your idle time first');
    const now = Date.now();
    if (!confirmed) {
      const q = vm.earlyPunchOutPrompt(now, this.cache.policy);
      if (q) return fail(CONFIRM_CODES.earlyPunchOut, q);
    }
    const out = this.engine.punchOut(now);
    this.handleOutput(out, { punch: 'skip' });
    this.cache.sessionStartedAt = null;
    this.tab = 'summary';
    this.log.add('Punched out');
    this.opts.shell.widgetClose();
    const ev = out.events.find(isPunchEvent);
    const r = ev ? await this.deliverPunch(ev) : ok();
    void this.sync.flush();
    this.saveSnapshot();
    if (!r.ok) {
      this.log.add(`Punch out not recorded on the server: ${r.error}`, 'warn');
      return fail(r.code, `Punched out here, but the server said: ${r.error}`);
    }
    return r;
  }

  /** Online-first punch (keeps queued punches in order); falls back to the outbox when offline. */
  private async deliverPunch(ev: EngineEvent): Promise<CommandResult> {
    const input = punchInput(ev);
    const offlineMsg = `Punched ${input.direction === 'IN' ? 'in' : 'out'} offline · syncs when you reconnect`;
    if (!this.isOnline() || this.store.queue.nextPunch()) {
      this.store.append('punch', ev.clientId, input);
      this.sync.trigger(300);
      return ok(this.isOnline() ? undefined : offlineMsg);
    }
    this.punchBusy = true;
    this.push();
    const t0 = Date.now();
    try {
      const r = await this.api.punch(input);
      this.punchBusy = false;
      this.applyToday(r.today, t0);
      return ok();
    } catch (e) {
      if (e instanceof ApiError && e.retryable) {
        this.store.append('punch', ev.clientId, input);
        this.sync.trigger(2000);
        return ok(offlineMsg);
      }
      return toFailure(e);
    } finally {
      this.punchBusy = false;
    }
  }

  /** A queued punch the server refused for good (e.g. PUNCH_NOT_ALLOWED, PUNCH_TOO_OLD). */
  private onPunchRejected(input: TrackerPunchInput, err: ApiError) {
    const msg = `Punch ${input.direction === 'IN' ? 'in' : 'out'} was not accepted: ${err.message}`;
    this.log.add(msg, 'warn');
    this.opts.shell.notify('Lexisora Tracker', msg);
    if (input.direction === 'IN' && this.engine.status !== 'OUT' && !this.engine.attached) {
      this.handleOutput(this.engine.punchOut(Date.now(), { detach: true }));
      this.cache.sessionStartedAt = null;
    }
    this.push();
  }

  private attach(): CommandResult {
    if (this.engine.status !== 'OUT') return fail('ALREADY_TRACKING', 'Already tracking on this device');
    const t = this.cache.today;
    if (!t || t.status === 'OUT') return fail('NO_SESSION', 'There is no open session to continue. Punch in instead.');
    const now = Date.now();
    this.handleOutput(this.engine.punchIn(now, this.engine.activeTaskId ?? this.defaultTaskId(), { attached: true }));
    this.cache.sessionStartedAt = now;
    const src = vm.serverSessionView(t)?.label ?? 'Open session';
    this.log.add(`${src} · tracking continues here`);
    if (this.prefs.showTrayWidget) this.opts.shell.widgetOpen();
    this.saveSnapshot();
    return ok('Tracking continues on this device');
  }

  private toggleBreak(): CommandResult {
    if (this.engine.status === 'OUT') return fail('NOT_PUNCHED_IN', 'Punch in first');
    const wasBreak = this.engine.status === 'BREAK';
    this.handleOutput(this.engine.toggleBreak(Date.now()));
    this.log.add(wasBreak ? 'Break ended' : 'Break started');
    return ok();
  }

  private switchTask(taskId: string): CommandResult {
    const t = this.taskList().find((x) => x.id === taskId);
    if (!t) return fail('UNKNOWN_TASK', 'That task is no longer assigned to you');
    if (taskId === this.engine.activeTaskId) return ok();
    this.handleOutput(this.engine.switchTask(Date.now(), taskId));
    this.log.add(`Switched to ${t.key}`);
    return ok();
  }

  private resolveIdle(resolution: 'WORKING' | 'BREAK' | 'IDLE', note?: string): CommandResult {
    if (!this.engine.prompting) return fail('NO_IDLE', 'There is no idle time to classify');
    if (resolution === 'WORKING' && this.cache.policy && !this.cache.policy.idleClaimsAllowed) return fail('CLAIMS_OFF', 'Idle claims are turned off by HR');
    const out = this.engine.resolveIdle(Date.now(), resolution, note || undefined);
    const idleSeg = out.segments[0];
    const mins = idleSeg ? Math.max(1, Math.round((idleSeg.endedAt - idleSeg.startedAt) / 60_000)) : 0;
    this.handleOutput(out);
    const msg =
      resolution === 'WORKING'
        ? 'Idle marked as work · sent for PL review'
        : resolution === 'BREAK'
          ? 'Idle counted as break'
          : `Idle logged · ${mins} min deducted`;
    this.log.add(msg);
    return ok(msg);
  }

  private setTab(tab: TrackerTab): CommandResult {
    this.tab = tab;
    if (tab === 'settings') this.syncLoginItemPref();
    if (tab === 'summary') void this.refreshToday();
    return ok();
  }

  /** "Add to weekly timesheet": close the open segment, force a sync and confirm the day. */
  private async confirmDay(): Promise<CommandResult> {
    if (!this.creds) return fail('NOT_PAIRED', 'Pair this device first');
    const today = this.cache.today?.date === this.engine.dayKey ? this.cache.today : null;
    if (today?.weekSubmitted) return fail('WEEK_SUBMITTED', vm.WEEK_SUBMITTED_HINT);
    if (this.confirmBusy) return fail('BUSY', 'Syncing…');
    const now = Date.now();
    const date = this.engine.dayKey;
    this.handleOutput(this.engine.checkpoint(now));
    const queueOffline = (): CommandResult => {
      const ev: TrackerEvent = { clientId: randomUUID(), type: 'SUMMARY_CONFIRMED', at: iso(now), taskId: null, payload: { date } };
      this.store.append('event', ev.clientId, ev);
      this.cache.pendingConfirm = date;
      this.saveCache();
      this.log.add('Summary queued (offline)');
      return ok('Summary queued (offline)');
    };
    if (!this.isOnline()) return queueOffline();
    this.confirmBusy = true;
    this.push();
    try {
      const r = await this.sync.flush();
      if (!r.ok) return queueOffline();
      const c = await this.api.confirmDay(date);
      this.cache.pendingConfirm = null;
      if (this.cache.today && this.cache.today.date === date) {
        this.cache.today.confirmedAt = c.confirmedAt;
        this.cache.today.weekSubmitted = c.weekSubmitted;
      }
      this.saveCache();
      this.log.add('Summary synced to timesheet');
      void this.refreshToday();
      return ok('Summary synced to timesheet');
    } catch (e) {
      if (e instanceof ApiError && e.retryable) return queueOffline();
      return toFailure(e);
    } finally {
      this.confirmBusy = false;
    }
  }

  private async confirmPending() {
    const date = this.cache.pendingConfirm;
    if (!date || !this.creds) return;
    try {
      const c = await this.api.confirmDay(date);
      this.cache.pendingConfirm = null;
      if (this.cache.today?.date === date) this.cache.today.confirmedAt = c.confirmedAt;
      this.log.add('Summary synced to timesheet');
      this.saveCache();
    } catch (e) {
      if (!(e instanceof ApiError && e.retryable)) {
        this.cache.pendingConfirm = null;
        this.log.add(`Summary not added: ${e instanceof Error ? e.message : String(e)}`, 'warn');
      }
    }
  }

  private setPref(key: 'launchAtStartup' | 'showTrayWidget' | 'breakReminders', value: boolean): CommandResult {
    if (key === 'breakReminders' && value && (this.cache.policy?.breakReminderMin ?? 120) <= 0) return fail('HR_POLICY', 'Break reminders are turned off in your attendance policy');
    this.prefs[key] = value;
    this.savePrefs();
    if (key === 'launchAtStartup') this.applyLoginItem();
    if (key === 'showTrayWidget') {
      if (value && this.engine.status !== 'OUT') this.opts.shell.widgetOpen();
      if (!value) this.opts.shell.widgetClose();
    }
    if (key === 'breakReminders') this.engine.setConfig(this.engineConfig());
    const label = key === 'launchAtStartup' ? 'Launch at Windows start-up' : key === 'showTrayWidget' ? 'Tray widget' : 'Break reminders';
    this.log.add(`${label} ${value ? 'on' : 'off'}`);
    return ok();
  }

  /** Registers / removes the Windows autostart entry (installed app only; starts hidden in the tray). */
  private applyLoginItem() {
    if (!app.isPackaged) return;
    try {
      app.setLoginItemSettings({ openAtLogin: this.prefs.launchAtStartup, args: ['--hidden'] });
    } catch (e) {
      this.log.add(`Could not update start-up setting: ${String(e)}`, 'warn');
    }
  }

  /** The user may delete the autostart entry outside the app — reflect the real OS state. */
  private syncLoginItemPref() {
    if (!app.isPackaged) return;
    try {
      const s = app.getLoginItemSettings({ args: ['--hidden'] });
      if (s.openAtLogin !== this.prefs.launchAtStartup) {
        this.prefs.launchAtStartup = s.openAtLogin;
        this.savePrefs();
      }
    } catch {
      /* ignore */
    }
  }

  // ── screenshots, idle prompt, reminders ─────────────────────────────────
  private async captureScreenshot() {
    if (this.capturing || this.engine.status === 'OUT') return;
    this.capturing = true;
    const taskId = this.engine.activeTaskId;
    const taskKey = this.taskKey(taskId);
    try {
      const p = this.cache.policy as (typeof this.cache.policy & { screenshotAllMonitors?: boolean }) | null;
      const cap = await captureScreens({ allMonitors: p?.screenshotAllMonitors ?? true, blur: !!p?.blurScreenshots });
      const capturedAt = Date.now();
      const clientId = randomUUID();
      const meta: ScreenshotMeta = { clientId, capturedAt: iso(capturedAt), taskId, monitorCount: Math.min(12, Math.max(1, cap.displays)), blurred: cap.blurred };
      this.store.putBlob(clientId, cap.jpeg);
      this.store.append('shot', clientId, meta);
      this.engine.shotTaken();
      this.lastShot = { at: capturedAt, taskKey };
      this.log.add(`Screenshot · ${taskKey}`);
      if (!this.opts.shell.widgetVisible()) {
        this.opts.shell.shotToast({ time: clock(capturedAt), taskKey, blurred: cap.blurred, thumb: cap.thumbDataUrl, audience: vm.SCREENSHOT_AUDIENCE });
      }
      this.sync.trigger(500);
      this.saveSnapshot();
    } catch (e) {
      this.log.add(`Screenshot failed: ${e instanceof Error ? e.message : String(e)}`, 'warn');
    } finally {
      this.capturing = false;
      this.push();
    }
  }

  private onIdleStarted() {
    const v = this.idleView(Date.now());
    this.tab = 'track';
    this.log.add(v?.cause === 'NO_INPUT' ? `No input for ${this.cache.policy?.idleThresholdMin ?? 5} min → idle` : (v?.title ?? 'Idle'));
    this.opts.shell.attention();
    if (!this.opts.shell.mainFocused()) this.opts.shell.notify(v?.title ?? "You've been idle", 'Choose how to count this time in Lexisora Tracker.', () => this.openMain('track'));
    this.saveSnapshot();
  }

  private onBreakReminder() {
    if (!this.prefs.breakReminders) return;
    const min = this.cache.policy?.breakReminderMin ?? 120;
    const span = min % 60 === 0 ? plural(min / 60, 'hour') : `${min} minutes`;
    this.log.add('Break reminder');
    this.opts.shell.notify(`You've worked ${span} without a break`, 'Click to start a break.', () => {
      if (this.engine.status === 'WORKING' && !this.engine.prompting) void this.handle({ type: 'break.toggle' });
    });
  }

  private idleView(now: number) {
    const st = this.engine.idleState;
    if (st.phase !== 'PROMPT') return null;
    const threshold = this.cache.policy?.idleThresholdMin ?? Math.max(1, Math.round(this.engine.config.idleThresholdSec / 60));
    const until = st.cause === 'NO_INPUT' ? null : (st.inputAt ?? now);
    return vm.idleDialog(st.cause, st.since, until, threshold, this.cache.policy?.idleClaimsAllowed ?? true);
  }

  // ── dev "prototype controls" ─────────────────────────────────────────────
  private async simulate(kind: Simulation): Promise<CommandResult> {
    if (!this.opts.isDev) return fail('NOT_AVAILABLE', 'Simulation is only available in development builds');
    const now = Date.now();
    const working = this.engine.status === 'WORKING' && this.engine.idleState.phase === 'ACTIVE';
    const openStart = this.engine.openSegment?.startedAt ?? now;
    const back = Math.max(1, this.engine.config.idleThresholdSec) * 1000 + 60_000;
    switch (kind) {
      case 'idle':
        if (!working) return fail('NOT_WORKING', 'Idle ignored · not working');
        this.handleOutput(this.engine.simulateIdle(now));
        return ok();
      case 'screenshot':
        if (this.engine.status === 'OUT') return fail('NOT_PUNCHED_IN', 'Screenshots only while punched in');
        await this.captureScreenshot();
        return ok();
      case 'offline':
        this.forcedOffline = !this.forcedOffline;
        this.api.forcedOffline = this.forcedOffline;
        this.conn.forceOffline(this.forcedOffline);
        if (this.forcedOffline) {
          this.rt?.stop();
          this.log.add('Connection lost · tracking locally', 'warn');
        } else {
          this.log.add('Reconnecting…');
          this.startRealtime();
          void this.heartbeat();
          if (this.creds) void this.refreshToday();
        }
        return ok();
      case 'lock': {
        if (!working) return fail('NOT_WORKING', 'Lock ignored · not working');
        const since = Math.max(openStart + 1000, now - back);
        this.handleOutput(this.engine.lock(since, 'LOCK', since));
        this.handleOutput(this.engine.unlock(now, 'UNLOCK'));
        return ok();
      }
      case 'appGap': {
        if (!working) return fail('NOT_WORKING', 'Gap ignored · not working');
        const since = Math.max(openStart + 1000, now - back);
        this.handleOutput(this.engine.appQuit(since));
        this.handleOutput(this.engine.recover(now));
        return ok();
      }
      case 'breakReminder':
        this.onBreakReminder();
        return ok();
    }
  }

  // ── view model ───────────────────────────────────────────────────────────
  private taskKey(taskId: string | null): string {
    if (!taskId) return 'No task';
    return this.cache.known[taskId]?.key ?? this.cache.tasks.find((t) => t.id === taskId)?.key ?? 'Task';
  }

  private taskList(): TrackerTask[] {
    const list = [...this.cache.tasks];
    const active = this.engine.activeTaskId;
    if (active && !list.some((t) => t.id === active)) {
      const k = this.cache.known[active];
      if (k) list.unshift({ id: active, key: k.key, title: k.title, projectName: k.projectName ?? '' });
    }
    return list;
  }

  /** Server baseline (everything synced from any device) + this device's not-yet-counted segments + the live span. */
  private dayView(now: number): { totals: DayTotals; screenshots: number; bars: Bar[]; baseline: CacheDoc['today'] } {
    const live = this.engine.live(now);
    const b = this.cache.today && this.cache.today.date === this.engine.dayKey ? this.cache.today : null;
    const segs = this.engine.segments;
    const local: readonly Segment[] = b ? segs.filter((s) => this.store.queue.has(s.clientId) || s.clientId in this.cache.acks) : segs;
    const delta = computeTotals(local, live);
    const totals = b ? combine({ workedSeconds: b.workedSeconds, breakSeconds: b.breakSeconds, idleSeconds: b.idleSeconds, screenshots: b.screenshots, byTask: b.byTask }, delta) : delta;
    const day = this.engine.dayKey;
    const pendingShots = this.store.queue.pending('shot').filter((e) => istDayKey(Date.parse((e.payload as ScreenshotMeta).capturedAt)) === day).length;
    const ackedShots = Object.values(this.cache.acks).filter(([, shot]) => shot).length;
    const screenshots = b ? b.screenshots + pendingShots + ackedShots : Math.max(this.engine.shots, pendingShots);
    const serverSpans: TimelineSpan[] = b
      ? (b.timeline ?? []).map((x) => ({ kind: x.kind, label: x.kind === 'WORK' ? x.taskKey : null, from: Date.parse(x.startAt), to: Date.parse(x.endAt) }))
      : [];
    const bars = timelineFromSpans([...serverSpans, ...localSpans(local, live, (id) => this.taskKey(id))]);
    return { totals, screenshots, bars, baseline: b };
  }

  private buildState(): ViewState {
    const now = Date.now();
    const p = this.cache.policy;
    const status = this.engine.status;
    const prompting = this.engine.prompting;
    const sv = vm.statusView(status, prompting);
    const day = this.dayView(now);
    const tasks = this.taskList();
    const activeId = this.engine.activeTaskId;
    const active = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;
    const pair = this.pair;
    const pairStatus = pair && pair.status === 'PENDING' && pair.codeExpiresAt && now > pair.codeExpiresAt ? 'EXPIRED' : (pair?.status ?? 'IDLE');
    const code = pair?.code ?? '';
    const today = day.baseline;
    return {
      view: this.view,
      tab: this.tab,
      isDev: this.opts.isDev,
      appVersion: this.opts.appVersion,
      serverUrl: this.api.baseUrl,
      clock: clock(now),
      login: { ...this.loginForm },
      pair: {
        code: Array.from({ length: 6 }, (_, i) => code[i] ?? ''),
        expiresIn: pair?.codeExpiresAt ? vm.countdown(pair.codeExpiresAt - now) : null,
        status: pairStatus,
        deviceLine: `Device: ${this.identity.hostname} · ${this.identity.os}`,
        permissions: vm.permissionsLine(pair?.permissions),
        busy: pair?.busy ?? false,
        error: pair?.error ?? null,
        userName: pair?.login.user.name ?? null,
      },
      mode: this.mode,
      status,
      statusLabel: sv.label,
      statusTone: sv.tone,
      shiftLabel: vm.shiftLabel(p),
      workedSec: Math.floor(day.totals.workedSec),
      worked: hm(day.totals.workedSec),
      breakTime: hm(day.totals.breakSec),
      idleTime: hm(day.totals.idleSec),
      tasks: vm.taskRows(tasks, day.totals.perTask, activeId),
      showTaskSearch: tasks.length > 8,
      activeTask: active ? { id: active.id, key: active.key, title: active.title } : null,
      idle: this.idleView(now),
      punch: { blocked: this.punchBlocked(now), helper: vm.punchHelper(p), busy: this.punchBusy },
      serverSession: this.mode === 'PUNCH' && status === 'OUT' && !this.store.queue.nextPunch() && !this.punchBusy ? vm.serverSessionView(today) : null,
      monitorNote: this.mode === 'MONITOR_ONLY' ? (this.modeMessage ?? vm.MONITOR_ONLY_MESSAGE) : null,
      nextShot: vm.nextShotLabel({ enabled: this.engine.config.screenshotsEnabled, status, paused: this.engine.shotsPaused, seconds: this.engine.nextShotInSec() }),
      lastInput: vm.lastInputLabel(this.lastIdleSec),
      summary: {
        title: vm.summaryTitle(status, day.totals.workedSec),
        byTask: vm.byTaskRows(tasks, day.totals.perTask, new Map(Object.entries(this.cache.known))),
        screenshots: day.screenshots,
        timeline: day.bars,
        canConfirm: !!this.creds && !today?.weekSubmitted && day.totals.workedSec >= 60 && !this.confirmBusy,
        confirmHint: today?.weekSubmitted ? vm.WEEK_SUBMITTED_HINT : null,
        confirmedAt: this.cache.pendingConfirm
          ? 'Queued · reaches your timesheet when you reconnect'
          : today?.confirmedAt
            ? `Added to your weekly timesheet at ${clock(Date.parse(today.confirmedAt))}`
            : null,
      },
      online: this.isOnline(),
      queued: this.store.queue.size,
      syncing: this.sync.busy || this.confirmBusy,
      lastSyncAt: this.cache.lastSyncAt ? clock(this.cache.lastSyncAt) : null,
      settings: vm.settingsRows({
        policy: p,
        prefs: this.prefs,
        mode: this.mode,
        device: this.creds ? { hostname: this.creds.hostname, pairedAt: this.creds.pairedAt } : null,
        appVersion: this.opts.appVersion,
        update: this.update ? { version: this.update.version, mandatory: !!this.update.mandatory, notes: this.update.notes ?? null } : null,
      }),
      prefs: { launchAtStartup: this.prefs.launchAtStartup, showTrayWidget: this.prefs.showTrayWidget, breakReminders: this.prefs.breakReminders },
      device: this.creds ? { hostname: this.creds.hostname, pairedAt: this.creds.pairedAt } : null,
      update: this.update
        ? { version: this.update.version, mandatory: !!this.update.mandatory, notes: this.update.notes ?? null, hasUrl: !!(this.update.url ?? this.update.downloadUrl) }
        : null,
      unpair: { ...this.unpairState },
      widget: { open: this.opts.shell.widgetVisible(), lastShot: this.lastShot ? `Last shot ${clock(this.lastShot.at)} · ${this.lastShot.taskKey}` : null },
      log: this.log.recent(8),
    };
  }

  getState(): ViewState {
    return this.lastState ?? this.buildState();
  }

  /** Recompute the view model, push it to every window and refresh the tray. */
  push() {
    if (!this.ready) return;
    const s = this.buildState();
    this.lastState = s;
    this.opts.shell.broadcast(s);
    const dot = this.view === 'home' ? vm.statusView(s.status, !!s.idle).dot : 'OUT';
    const tip = this.view === 'home' ? vm.trayTooltip(s.statusLabel, s.status, s.worked, s.activeTask) : 'Lexisora Tracker · Sign in to start';
    const key = `${dot}|${tip}`;
    if (key !== this.lastTray) {
      this.lastTray = key;
      this.opts.shell.tray(dot, tip);
    }
  }

  private diagnostics() {
    const c = this.creds;
    return {
      app: 'Lexisora Tracker',
      version: this.opts.appVersion,
      electron: process.versions.electron,
      os: this.identity.os,
      server: this.api.baseUrl,
      workspace: c?.workspace ?? null,
      deviceId: c?.deviceId ?? null,
      hostname: c?.hostname ?? this.identity.hostname,
      pairedAt: c?.pairedAt ?? null,
      user: c?.user.email ?? null,
      mode: this.mode,
      online: this.isOnline(),
      realtime: this.rt?.connected ?? false,
      queue: this.store.queue.counts(),
      outboxBytes: this.store.fileSize(),
      corruptLines: this.store.corruptLines,
      lastSyncAt: this.cache.lastSyncAt ? iso(this.cache.lastSyncAt) : null,
      lastSyncError: this.sync.lastError,
      policyUpdatedAt: this.cache.policy?.updatedAt ?? null,
      engine: {
        status: this.engine.status,
        day: this.engine.dayKey,
        segments: this.engine.segments.length,
        screenshots: this.engine.shots,
        idle: this.engine.idleState.phase,
        activeTaskId: this.engine.activeTaskId,
      },
      log: this.log.recent(20),
    };
  }

  // ── persistence ──────────────────────────────────────────────────────────
  private saveSnapshot() {
    try {
      this.local.snapshot.write(this.engine.snapshot());
      this.lastSave = Date.now();
    } catch (e) {
      this.log.add(`Could not save tracker state: ${String(e)}`, 'error');
    }
  }

  private saveCache() {
    try {
      this.local.cache.write(this.cache);
    } catch {
      /* next save retries */
    }
  }

  private savePrefs() {
    try {
      this.local.writePrefs(this.prefs);
    } catch {
      /* ignore */
    }
  }
}
