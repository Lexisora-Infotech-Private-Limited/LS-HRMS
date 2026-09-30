import { app, ipcMain, safeStorage, session, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { join } from 'node:path';
import { IPC } from '@tracker-shared/channels';
import type { CommandResult } from '@tracker-shared/ipc';
import { TrackerController } from './app/controller';
import type { KeyProtector } from './services/crypto-box';
import { DesktopShell } from './windows/shell';

/**
 * Lexisora Tracker — Electron main process entry.
 *
 *   single-instance lock → app ready → DesktopShell (windows, tray, notifications)
 *   → TrackerController (engine, encrypted outbox, sync, realtime, powerMonitor, screenshots)
 *
 * `--hidden` (used by the Windows start-up entry) keeps the window in the tray when a device
 * is already paired. Server URL: LEXISORA_SERVER_URL (default http://localhost:4000); it can
 * also be changed on the sign-in screen.
 */

const isDev = !app.isPackaged;
const DEFAULT_SERVER = process.env.LEXISORA_SERVER_URL?.trim() || 'http://localhost:4000';
const startHidden = process.argv.includes('--hidden');

app.setName('Lexisora Tracker');
// Keep a development profile apart from an installed tracker on the same PC.
if (isDev) app.setPath('userData', join(app.getPath('appData'), 'Lexisora Tracker (dev)'));
// Windows toasts need the AppUserModelID of the Start-menu shortcut the installer creates.
if (process.platform === 'win32') app.setAppUserModelId(isDev ? process.execPath : 'in.lexisora.tracker');

const ui = new DesktopShell({
  isDev,
  preload: join(__dirname, '../preload/index.js'),
  rendererUrl: isDev ? (process.env.ELECTRON_RENDERER_URL ?? null) : null,
  rendererFile: join(__dirname, '../renderer/index.html'),
});
let controller: TrackerController | null = null;

function keyProtector(): KeyProtector {
  return {
    available: () => {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  };
}

/** Renderers never navigate away, open windows or embed webviews; external links open in the browser. */
function harden(wc: WebContents) {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!ui.isAppUrl(url)) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return ui.isAppUrl(url);
}

const forbidden: CommandResult = { ok: false, code: 'FORBIDDEN', error: 'Not allowed' };

function registerIpc(c: TrackerController) {
  ipcMain.handle(IPC.invoke, (e, cmd: unknown) => (trusted(e) ? c.handle(cmd) : forbidden));
  ipcMain.handle(IPC.getState, (e) => (trusted(e) ? c.getState() : null));
}

function start() {
  app.on('second-instance', () => controller?.openMain());
  // Closing windows only hides them; the tracker lives in the tray until Quit.
  app.on('window-all-closed', () => undefined);
  app.on('web-contents-created', (_e, wc) => harden(wc));

  // Any quit that didn't come through tray → Quit (installer, OS, Ctrl+C in dev): close what's open and flush briefly.
  app.on('before-quit', (e) => {
    if (ui.quitting || !controller || controller.stopped) {
      ui.quitting = true;
      return;
    }
    e.preventDefault();
    ui.quitting = true;
    const c = controller;
    void c.shutdown().finally(() => app.quit());
  });
  app.on('will-quit', () => ui.dispose());

  process.on('uncaughtException', (err) => controller?.log.add(`Unexpected error: ${err?.stack ?? String(err)}`, 'error'));
  process.on('unhandledRejection', (r) => controller?.log.add(`Unhandled rejection: ${r instanceof Error ? (r.stack ?? r.message) : String(r)}`, 'error'));
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => app.quit());

  void app.whenReady().then(() => {
    // The renderer needs no browser permissions (screen capture runs in main via desktopCapturer).
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    const c = new TrackerController({
      userData: app.getPath('userData'),
      appVersion: app.getVersion(),
      isDev,
      defaultServerUrl: DEFAULT_SERVER,
      protector: keyProtector(),
      shell: ui,
    });
    controller = c;
    ui.host = c;
    registerIpc(c);
    ui.createMain();
    c.init();
    if (!startHidden || !c.paired) c.openMain();
    setTimeout(() => ui.warmUp(), 1500);
  });
}

if (!app.requestSingleInstanceLock()) {
  // A second launch just focuses the running tracker (see 'second-instance').
  app.quit();
} else {
  start();
}
