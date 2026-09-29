import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
const handlers = new Map<string, Set<(p: any) => void>>();

export function connectSocket(token: string) {
  if (socket) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
    return;
  }
  socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'] });
  for (const [ev, set] of handlers) for (const h of set) socket.on(ev, h);
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}

/** Subscribe to a realtime event; returns an unsubscribe function. Survives reconnects. */
export function onRealtime<T = unknown>(event: string, fn: (payload: T) => void): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(fn);
  socket?.on(event, fn);
  return () => {
    handlers.get(event)?.delete(fn);
    socket?.off(event, fn);
  };
}

export function emitRealtime(event: string, payload: unknown, ack?: (res: any) => void) {
  if (ack) socket?.emit(event, payload, ack);
  else socket?.emit(event, payload);
}
