import type { Command, CommandResult, ShotToast, ToastMessage, ViewState } from '@tracker-shared/ipc';

/**
 * The only surface the sandboxed renderer gets (contextBridge → window.tracker).
 * Every command is validated with zod in main; tokens and keys never cross this bridge.
 */
export interface TrackerBridge {
  invoke<T = unknown>(cmd: Command): Promise<CommandResult<T>>;
  getState(): Promise<ViewState | null>;
  onState(fn: (state: ViewState) => void): () => void;
  onToast(fn: (toast: ToastMessage) => void): () => void;
  onShot(fn: (shot: ShotToast) => void): () => void;
}

declare global {
  interface Window {
    tracker: TrackerBridge;
  }
}

export {};
