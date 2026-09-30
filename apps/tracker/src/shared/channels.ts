/** IPC channel names (kept free of runtime deps so the sandboxed preload stays tiny). */
export const IPC = {
  invoke: 'tracker:invoke',
  state: 'tracker:state',
  toast: 'tracker:toast',
  shot: 'tracker:shot',
  getState: 'tracker:get-state',
} as const;
