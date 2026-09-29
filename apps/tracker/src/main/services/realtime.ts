import { backoffDelay } from '../engine/backoff';

/**
 * Minimal Socket.IO v4 client (Engine.IO protocol 4, websocket transport only) for the
 * server → device pushes ('policy.updated', 'device.revoked', 'tasks.updated',
 * 'attendance.punched', 'command.syncNow'). socket.io-client is not a tracker dependency,
 * and Electron 37's main process ships Node 22's global WebSocket, so we speak the
 * (tiny) wire protocol directly:
 *   server → "0{sid,pingInterval,…}" open   client → "40{auth}" connect to "/"
 *   server → "40{sid}" connected / "44{message}" refused
 *   server → "2" ping                         client → "3" pong
 *   server → '42["event",payload]'            event
 */
type Handler = (payload: any) => void;

interface WsLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export class RealtimeClient {
  private ws: WsLike | null = null;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;
  private pingWatch: NodeJS.Timeout | null = null;
  private stopped = true;
  private readonly handlers = new Map<string, Set<Handler>>();
  connected = false;
  onStatus: ((connected: boolean) => void) | null = null;

  constructor(
    private serverUrl: string,
    private token: string,
  ) {}

  static supported() {
    return typeof (globalThis as any).WebSocket === 'function';
  }

  on(event: string, fn: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
  }

  start() {
    if (!RealtimeClient.supported()) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.pingWatch) clearTimeout(this.pingWatch);
    this.timer = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.setConnected(false);
  }

  /** Reconnect now (e.g. after the network came back). */
  kick() {
    if (this.stopped || this.connected) return;
    if (this.timer) clearTimeout(this.timer);
    this.attempt = 0;
    this.connect();
  }

  private setConnected(v: boolean) {
    if (this.connected !== v) {
      this.connected = v;
      this.onStatus?.(v);
    }
  }

  private url() {
    const u = new URL(this.serverUrl);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/socket.io/';
    u.search = '?EIO=4&transport=websocket';
    return u.toString();
  }

  private connect() {
    if (this.stopped) return;
    let ws: WsLike;
    try {
      const WS = (globalThis as any).WebSocket;
      ws = new WS(this.url()) as WsLike;
    } catch {
      this.schedule();
      return;
    }
    this.ws = ws;
    ws.onmessage = (ev) => this.onPacket(String(ev.data));
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.setConnected(false);
        this.schedule();
      }
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private schedule() {
    if (this.stopped) return;
    const delay = backoffDelay(this.attempt++);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private watch(ms: number) {
    if (this.pingWatch) clearTimeout(this.pingWatch);
    this.pingWatch = setTimeout(() => {
      try {
        this.ws?.close();
      } catch {
        /* ignore */
      }
    }, ms);
  }

  private onPacket(data: string) {
    const type = data[0];
    if (type === '0') {
      let open: { pingInterval?: number; pingTimeout?: number } = {};
      try {
        open = JSON.parse(data.slice(1));
      } catch {
        /* ignore */
      }
      this.watch((open.pingInterval ?? 25_000) + (open.pingTimeout ?? 20_000));
      this.ws?.send('40' + JSON.stringify({ token: this.token }));
      return;
    }
    if (type === '2') {
      this.ws?.send('3');
      this.watch(50_000);
      return;
    }
    if (type === '1') {
      this.ws?.close();
      return;
    }
    if (type !== '4') return;
    const sub = data[1];
    if (sub === '0') {
      this.attempt = 0;
      this.setConnected(true);
    } else if (sub === '4' || sub === '1') {
      // connect_error (bad token) or server-side disconnect
      this.setConnected(false);
      this.ws?.close();
    } else if (sub === '2') {
      const body = data.slice(2).replace(/^\d+/, ''); // strip an ack id if present
      try {
        const [event, payload] = JSON.parse(body) as [string, unknown];
        for (const fn of this.handlers.get(event) ?? []) fn(payload);
      } catch {
        /* ignore malformed */
      }
    }
  }
}
