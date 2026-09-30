import { app, BrowserWindow, Menu, Notification, screen, Tray, type MenuItemConstructorOptions, type WebPreferences } from 'electron';
import { IPC, type WindowKind } from '@tracker-shared/channels';
import type { ShotToast, ToastMessage, ViewState } from '@tracker-shared/ipc';
import type { UiShell } from '../app/controller';
import type { DotState } from '../app/view-model';
import { appIcon, trayIcon } from './icons';
import { anchorToTray, isPositionVisible, type Rect } from './placement';

/** What the shell calls back into (the TrackerController), set right after construction. */
export interface ShellHost {
  trayMenu(): MenuItemConstructorOptions[];
  onTrayClick(): void;
  openMain(): void;
  hideToTray(): void;
  onSystemShutdown(): void;
  readonly widgetPosition: { x: number; y: number } | null;
  setWidgetPosition(pos: { x: number; y: number }): void;
}

export interface ShellOptions {
  isDev: boolean;
  /** Absolute path of the bundled preload (out/preload/index.js). */
  preload: string;
  /** electron-vite dev server URL, or null to load the built renderer file. */
  rendererUrl: string | null;
  rendererFile: string;
}

const MAIN_SIZE = { width: 400, height: 620 };
const WIDGET_SIZE = { width: 260, height: 200 };
const TOAST_SIZE = { width: 330, height: 86 };
const TOAST_MS = 3000;
const BG = '#f3f2f2';

/**
 * The window / tray layer (spec T7): the 400×620 frameless main window, the always-on-top
 * tray widget, the screenshot toast, the tray icon and Windows notifications.
 * All renderers are sandboxed with context isolation; they talk to main only through
 * the preload bridge (window.tracker).
 */
export class DesktopShell implements UiShell {
  host: ShellHost | null = null;
  /** Set once a real quit is under way, so window 'close' stops hiding to the tray. */
  quitting = false;

  private main: BrowserWindow | null = null;
  private widget: BrowserWindow | null = null;
  private toastWin: BrowserWindow | null = null;
  private trayRef: Tray | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toastSeq = 0;
  private readonly notes = new Set<Notification>();
  private readonly loaded = new WeakSet<BrowserWindow>();
  private widgetUserMove = false;

  constructor(private readonly opts: ShellOptions) {}

  // ── window factory ──────────────────────────────────────────────────────
  private webPreferences(): WebPreferences {
    return {
      preload: this.opts.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: this.opts.isDev,
    };
  }

  private load(win: BrowserWindow, kind: WindowKind) {
    win.webContents.on('did-finish-load', () => this.loaded.add(win));
    const p = this.opts.rendererUrl
      ? win.loadURL(`${this.opts.rendererUrl}?w=${kind}`)
      : win.loadFile(this.opts.rendererFile, { query: { w: kind } });
    p.catch(() => undefined);
  }

  private alive(win: BrowserWindow | null): win is BrowserWindow {
    return !!win && !win.isDestroyed();
  }

  /** Creates (once) the main window; it stays hidden until showMain(). */
  createMain(): BrowserWindow {
    if (this.alive(this.main)) return this.main;
    const win = new BrowserWindow({
      ...MAIN_SIZE,
      minWidth: 380,
      minHeight: 560,
      show: false,
      frame: false,
      resizable: true,
      maximizable: true,
      fullscreenable: false,
      title: 'Lexisora Tracker',
      backgroundColor: BG,
      icon: appIcon(),
      webPreferences: this.webPreferences(),
    });
    win.setMenu(null);
    // ✕ / Alt+F4 hide to the tray; the app keeps tracking.
    win.on('close', (e) => {
      if (this.quitting) return;
      e.preventDefault();
      this.host?.hideToTray();
    });
    win.on('focus', () => win.flashFrame(false));
    win.on('closed', () => {
      if (this.main === win) this.main = null;
    });
    // Windows log-off / restart / shutdown.
    win.on('session-end', () => {
      this.quitting = true;
      this.host?.onSystemShutdown();
    });
    this.load(win, 'main');
    this.main = win;
    return win;
  }

  private createWidget(): BrowserWindow {
    if (this.alive(this.widget)) return this.widget;
    const win = new BrowserWindow({
      ...WIDGET_SIZE,
      useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: 'Lexisora Tracker widget',
      backgroundColor: BG,
      icon: appIcon(),
      webPreferences: this.webPreferences(),
    });
    win.setMenu(null);
    win.setAlwaysOnTop(true, 'floating');
    // Remember only positions the user dragged it to ('will-move' fires for user moves only).
    win.on('will-move', () => {
      this.widgetUserMove = true;
    });
    win.on('moved', () => {
      if (!this.widgetUserMove) return;
      this.widgetUserMove = false;
      const [x, y] = win.getPosition();
      this.host?.setWidgetPosition({ x, y });
    });
    win.on('close', (e) => {
      if (this.quitting) return;
      e.preventDefault();
      win.hide();
    });
    win.on('closed', () => {
      if (this.widget === win) this.widget = null;
    });
    this.load(win, 'widget');
    this.widget = win;
    return win;
  }

  private createToast(): BrowserWindow {
    if (this.alive(this.toastWin)) return this.toastWin;
    const win = new BrowserWindow({
      ...TOAST_SIZE,
      useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: 'Screenshot captured',
      backgroundColor: BG,
      webPreferences: this.webPreferences(),
    });
    win.setMenu(null);
    win.setAlwaysOnTop(true, 'floating');
    win.on('close', (e) => {
      if (this.quitting) return;
      e.preventDefault();
      win.hide();
    });
    win.on('closed', () => {
      if (this.toastWin === win) this.toastWin = null;
    });
    this.load(win, 'toast');
    this.toastWin = win;
    return win;
  }

  /** Pre-create the helper windows so the first toast / widget opens instantly. */
  warmUp() {
    this.createWidget();
    this.createToast();
  }

  // ── placement ───────────────────────────────────────────────────────────
  private trayDisplay() {
    const tb = this.trayRef && !this.trayRef.isDestroyed() ? this.trayRef.getBounds() : null;
    const display =
      tb && tb.width > 0 ? screen.getDisplayNearestPoint({ x: Math.round(tb.x + tb.width / 2), y: Math.round(tb.y + tb.height / 2) }) : screen.getPrimaryDisplay();
    return { display, tray: tb && tb.width > 0 ? (tb as Rect) : null };
  }

  private nearTray(size: { width: number; height: number }): Rect {
    const { display, tray } = this.trayDisplay();
    return anchorToTray({ bounds: display.bounds, workArea: display.workArea }, tray, size);
  }

  private widgetRect(): Rect {
    const saved = this.host?.widgetPosition ?? null;
    if (saved && isPositionVisible(saved, WIDGET_SIZE, screen.getAllDisplays().map((d) => d.workArea))) {
      return { ...saved, ...WIDGET_SIZE };
    }
    return this.nearTray(WIDGET_SIZE);
  }

  // ── UiShell ─────────────────────────────────────────────────────────────
  broadcast(state: ViewState) {
    for (const w of [this.main, this.widget]) {
      if (this.alive(w) && this.loaded.has(w) && (w === this.main || w.isVisible())) w.webContents.send(IPC.state, state);
    }
  }

  toast(text: string, tone: 'info' | 'error' = 'info') {
    const msg: ToastMessage = { id: ++this.toastSeq, text, tone };
    if (this.alive(this.main) && this.main.isVisible() && this.loaded.has(this.main)) this.main.webContents.send(IPC.toast, msg);
    else if (tone === 'error') this.notify('Lexisora Tracker', text);
  }

  showMain() {
    const win = this.createMain();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  hideMain() {
    if (this.alive(this.main)) this.main.hide();
  }

  minimizeMain() {
    if (this.alive(this.main)) this.main.minimize();
  }

  toggleMaximizeMain() {
    if (!this.alive(this.main)) return;
    if (this.main.isMaximized()) this.main.unmaximize();
    else this.main.maximize();
  }

  /** Idle prompt: bring the window to the front and flash the taskbar button (Focus Assist may hide toasts). */
  attention() {
    const win = this.createMain();
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.showInactive();
    win.moveTop();
    if (!win.isFocused()) win.flashFrame(true);
  }

  mainFocused() {
    return this.alive(this.main) && this.main.isVisible() && this.main.isFocused();
  }

  widgetOpen() {
    const win = this.createWidget();
    if (!win.isVisible()) {
      win.setBounds(this.widgetRect());
      win.showInactive();
    }
  }

  widgetClose() {
    if (this.alive(this.widget)) this.widget.hide();
  }

  widgetToggle() {
    if (this.widgetVisible()) this.widgetClose();
    else this.widgetOpen();
  }

  widgetVisible() {
    return this.alive(this.widget) && this.widget.isVisible();
  }

  /** "Screenshot captured · 10:10 · mapped to AT-101 · Visible to …" for 3 s, bottom-right, never takes focus. */
  shotToast(shot: ShotToast) {
    const win = this.createToast();
    const show = () => {
      if (win.isDestroyed()) return;
      win.setBounds(this.nearTray(TOAST_SIZE));
      win.webContents.send(IPC.shot, shot);
      win.showInactive();
    };
    if (this.loaded.has(win)) show();
    else win.webContents.once('did-finish-load', show);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      if (!win.isDestroyed()) win.hide();
    }, TOAST_MS);
  }

  tray(dot: DotState, tooltip: string) {
    const t = this.ensureTray();
    t.setImage(trayIcon(dot));
    t.setToolTip(tooltip);
  }

  private ensureTray(): Tray {
    if (this.trayRef && !this.trayRef.isDestroyed()) return this.trayRef;
    const t = new Tray(trayIcon('OUT'));
    t.setToolTip('Lexisora Tracker');
    t.on('click', () => this.host?.onTrayClick());
    // Build the menu on demand so it always shows the live status / timer / task.
    t.on('right-click', () => {
      const items = this.host?.trayMenu() ?? [];
      t.popUpContextMenu(Menu.buildFromTemplate(items));
    });
    this.trayRef = t;
    return t;
  }

  notify(title: string, body: string, onClick?: () => void) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: appIcon(), silent: false });
    // Keep a reference until the toast goes away, or Windows drops the click handler.
    this.notes.add(n);
    const drop = () => this.notes.delete(n);
    n.on('click', () => {
      drop();
      if (onClick) onClick();
      else this.host?.openMain();
    });
    n.on('close', drop);
    n.on('failed', drop);
    n.show();
    setTimeout(drop, 5 * 60_000);
  }

  quit() {
    this.quitting = true;
    app.quit();
  }

  /** Final cleanup on will-quit. */
  dispose() {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.trayRef && !this.trayRef.isDestroyed()) this.trayRef.destroy();
    this.trayRef = null;
    for (const w of [this.widget, this.toastWin, this.main]) if (this.alive(w)) w.destroy();
  }

  /** True when the IPC sender is one of our own renderer pages (not some navigated-to URL). */
  isAppUrl(url: string): boolean {
    if (this.opts.rendererUrl) return url.startsWith(this.opts.rendererUrl);
    if (!url.startsWith('file:')) return false;
    try {
      return decodeURIComponent(new URL(url).pathname).replace(/\\/g, '/').endsWith('/renderer/index.html');
    } catch {
      return false;
    }
  }
}
