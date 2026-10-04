import { createHmac, timingSafeEqual } from 'node:crypto';

/** Pure CCTV rules (spec §11.5): masking, tile labels, viewing tokens, health transitions. */

/** "rtsp://admin:pw@10.0.0.21:554/Streaming/101" → "rtsp://***@10.0.0.21/…" (credentials and path never leave the API). */
export function maskRtsp(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^(rtsps?):\/\/(?:([^@/]*)@)?([^/:?#]+)(?::\d+)?(\/[^?#]*)?/i.exec(url.trim());
  if (!m) return 'rtsp://…';
  const [, scheme, creds, host, path] = m;
  return `${scheme!.toLowerCase()}://${creds ? '***@' : ''}${host}${path && path !== '/' ? '/…' : ''}`;
}

/** Tile kicker + meta: "Live · Ahmedabad HQ", "Offline · Last seen 08:12". */
export function cameraTile(c: { status: string; enabled: boolean; location: string; lastSeen: string | null }): { kicker: string; meta: string; live: boolean } {
  if (!c.enabled || c.status === 'DISABLED') return { kicker: 'Disabled', meta: c.location, live: false };
  if (c.status === 'ONLINE') return { kicker: 'Live', meta: c.location, live: true };
  if (c.status === 'OFFLINE') return { kicker: 'Offline', meta: c.lastSeen ? `Last seen ${c.lastSeen}` : 'Not seen yet', live: false };
  return { kicker: 'Connecting', meta: c.location, live: false };
}

/** Two consecutive failed probes turn a camera OFFLINE; one success turns it ONLINE. */
export function nextHealth(prev: { status: string; failures: number }, ready: boolean): { status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'; failures: number; wentOffline: boolean } {
  if (ready) return { status: 'ONLINE', failures: 0, wentOffline: false };
  const failures = prev.failures + 1;
  if (failures >= 2) return { status: 'OFFLINE', failures, wentOffline: prev.status !== 'OFFLINE' };
  return { status: prev.status === 'OFFLINE' ? 'OFFLINE' : 'UNKNOWN', failures, wentOffline: false };
}

/** Short-lived viewing token for the gateway's auth hook: base64url(sid.path.exp).sig */
export function signViewToken(secret: string, p: { sid: string; path: string; exp: number }): string {
  const body = Buffer.from(`${p.sid}.${p.path}.${p.exp}`).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyViewToken(secret: string, token: string, now = Date.now()): { sid: string; path: string; exp: number } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [sid, path, exp] = Buffer.from(body, 'base64url').toString().split('.');
  if (!sid || !path || !exp || Number(exp) < now) return null;
  return { sid, path, exp: Number(exp) };
}

export const VIEW_TOKEN_TTL_MS = 5 * 60_000;
export const RECONNECT_COOLDOWN_MS = 30_000;
export const SESSION_IDLE_MS = 3 * 60_000;
