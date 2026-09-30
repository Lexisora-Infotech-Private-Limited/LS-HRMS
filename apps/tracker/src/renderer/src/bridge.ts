import { useSyncExternalStore } from 'react';
import { CONFIRM_CODES } from '@tracker-shared/channels';
import type { Command, CommandResult, ToastMessage, ViewState } from '@tracker-shared/ipc';

/**
 * Renderer side of the preload bridge. The view model lives in main (TrackerController) and
 * is pushed every second; the renderer only renders it and sends commands back.
 */
const bridge = window.tracker;

// ── view state (external store) ─────────────────────────────────────────
let current: ViewState | null = null;
const stateSubs = new Set<() => void>();
let started = false;

function emitState() {
  for (const fn of stateSubs) fn();
}

function startState() {
  if (started) return;
  started = true;
  bridge.onState((s) => {
    current = s;
    emitState();
  });
  void bridge.getState().then((s) => {
    if (s && !current) {
      current = s;
      emitState();
    }
  });
}

export function useViewState(): ViewState | null {
  startState();
  return useSyncExternalStore(
    (cb) => {
      stateSubs.add(cb);
      return () => stateSubs.delete(cb);
    },
    () => current,
    () => current,
  );
}

// ── in-window toasts ─────────────────────────────────────────────────────
let toasts: ToastMessage[] = [];
const toastSubs = new Set<() => void>();
let toastSeq = 1_000_000;
let toastsWired = false;

function emitToasts() {
  for (const fn of toastSubs) fn();
}

export function pushToast(text: string, tone: 'info' | 'error' = 'info') {
  const t: ToastMessage = { id: ++toastSeq, text, tone };
  toasts = [...toasts.filter((x) => x.text !== text).slice(-2), t];
  emitToasts();
  setTimeout(
    () => {
      toasts = toasts.filter((x) => x.id !== t.id);
      emitToasts();
    },
    tone === 'error' ? 5000 : 3500,
  );
}

export function dismissToast(id: number) {
  toasts = toasts.filter((x) => x.id !== id);
  emitToasts();
}

/** Toasts pushed by main (e.g. "Back online · 6 entries synced") plus command results. */
export function useToasts(): ToastMessage[] {
  if (!toastsWired) {
    toastsWired = true;
    bridge.onToast((t) => pushToast(t.text, t.tone ?? 'info'));
  }
  return useSyncExternalStore(
    (cb) => {
      toastSubs.add(cb);
      return () => toastSubs.delete(cb);
    },
    () => toasts,
    () => toasts,
  );
}

// ── commands ─────────────────────────────────────────────────────────────
const CONFIRMS = new Set<string>(Object.values(CONFIRM_CODES));

export type RunOptions = {
  /** Don't toast errors / messages (the screen shows them inline). */
  silent?: boolean;
};

/** Send a command to main. Errors and success messages become toasts unless `silent`. */
export async function run<T = unknown>(cmd: Command, opts: RunOptions = {}): Promise<CommandResult<T>> {
  let r: CommandResult<T>;
  try {
    r = await bridge.invoke<T>(cmd);
  } catch {
    r = { ok: false, code: 'IPC', error: 'Something went wrong. Try again.' };
  }
  if (!opts.silent) {
    if (!r.ok && !CONFIRMS.has(r.code)) pushToast(r.error, 'error');
    else if (r.ok && r.message) pushToast(r.message);
  }
  return r;
}

export function onShot(fn: Parameters<typeof bridge.onShot>[0]) {
  return bridge.onShot(fn);
}

export { CONFIRM_CODES };
