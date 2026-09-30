import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '@tracker-shared/channels';
import type { TrackerBridge } from './api';

/**
 * Sandboxed preload: exposes a tiny, typed bridge. It deliberately imports nothing but the
 * channel names, so no Node or zod code runs in the renderer's process.
 */
function subscribe<T>(channel: string, fn: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

// The screenshot toast window may receive its first message before React has subscribed:
// keep the latest one briefly and replay it to a late subscriber.
let lastShot: { at: number; payload: Parameters<Parameters<TrackerBridge['onShot']>[0]>[0] } | null = null;
ipcRenderer.on(IPC.shot, (_e, payload) => {
  lastShot = { at: Date.now(), payload };
});

const bridge: TrackerBridge = {
  invoke: (cmd) => ipcRenderer.invoke(IPC.invoke, cmd),
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (fn) => subscribe(IPC.state, fn),
  onToast: (fn) => subscribe(IPC.toast, fn),
  onShot: (fn) => {
    if (lastShot && Date.now() - lastShot.at < 3000) fn(lastShot.payload);
    return subscribe(IPC.shot, fn);
  },
};

contextBridge.exposeInMainWorld('tracker', bridge);
