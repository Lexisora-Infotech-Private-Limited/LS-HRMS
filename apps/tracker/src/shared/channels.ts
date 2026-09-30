/** IPC channel names (kept free of runtime deps so the sandboxed preload stays tiny). */
export const IPC = {
  invoke: 'tracker:invoke',
  state: 'tracker:state',
  toast: 'tracker:toast',
  shot: 'tracker:shot',
  getState: 'tracker:get-state',
} as const;

/** Result codes that ask the renderer for a confirmation step (dependency-free so the renderer can import it). */
export const CONFIRM_CODES = {
  earlyPunchOut: 'CONFIRM_EARLY_PUNCH_OUT',
  unpairPunchOut: 'CONFIRM_UNPAIR_PUNCH_OUT',
  unpairOffline: 'UNPAIR_QUEUE_OFFLINE',
} as const;

/** Which window a renderer page is (`index.html?w=…`). */
export type WindowKind = 'main' | 'widget' | 'toast';
