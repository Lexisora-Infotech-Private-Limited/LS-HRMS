import { Logger } from '@nestjs/common';
import { env } from '../../../../config/env';

/** NVR stream gateway (spec §11.7). MediaMTX turns each camera's RTSP feed into HLS on demand. */
export interface StreamGateway {
  readonly mode: 'gateway' | 'stub';
  upsertPath(path: string, sourceUrl: string): Promise<void>;
  removePath(path: string): Promise<void>;
  restartPath(path: string, sourceUrl: string | null): Promise<void>;
  /** ready = the source is connected and segments are being produced. */
  probe(path: string, hasSource: boolean): Promise<{ ready: boolean; error: string | null }>;
  /** Browser playback URL (HLS playlist) for a path, with the viewing token. */
  hlsUrl(path: string, token: string): string | null;
}

/**
 * MediaMTX: CCTV_GATEWAY_URL is the public HLS base (e.g. http://nvr.local:8888); the control
 * API defaults to the same host on :9997 (override with CCTV_GATEWAY_API_URL).
 */
export class MediaMtxGateway implements StreamGateway {
  readonly mode = 'gateway' as const;
  private readonly log = new Logger('CctvGateway');
  private readonly api: string;

  constructor(private readonly base: string) {
    const fromEnv = process.env.CCTV_GATEWAY_API_URL;
    let api = fromEnv ?? '';
    if (!api) {
      try {
        const u = new URL(base);
        u.port = '9997';
        u.pathname = '';
        api = u.toString();
      } catch {
        api = base;
      }
    }
    this.api = api.replace(/\/$/, '');
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.api}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
  }

  async upsertPath(path: string, sourceUrl: string): Promise<void> {
    const conf = { source: sourceUrl, sourceOnDemand: true };
    const patched = await this.call('PATCH', `/v3/config/paths/patch/${encodeURIComponent(path)}`, conf).catch(() => null);
    if (patched?.ok) return;
    const added = await this.call('POST', `/v3/config/paths/add/${encodeURIComponent(path)}`, conf);
    if (!added.ok) throw new Error(`gateway add ${path}: HTTP ${added.status}`);
  }

  async removePath(path: string): Promise<void> {
    await this.call('DELETE', `/v3/config/paths/delete/${encodeURIComponent(path)}`).catch((e) => this.log.debug(`remove ${path}: ${(e as Error).message}`));
  }

  async restartPath(path: string, sourceUrl: string | null): Promise<void> {
    await this.removePath(path);
    if (sourceUrl) await this.upsertPath(path, sourceUrl);
  }

  async probe(path: string): Promise<{ ready: boolean; error: string | null }> {
    try {
      const res = await this.call('GET', `/v3/paths/get/${encodeURIComponent(path)}`);
      if (res.status === 404) return { ready: false, error: 'Stream not running' };
      if (!res.ok) return { ready: false, error: `Gateway HTTP ${res.status}` };
      const j = (await res.json()) as { ready?: boolean };
      return { ready: !!j.ready, error: j.ready ? null : 'No video from the camera' };
    } catch (e) {
      return { ready: false, error: `Gateway unreachable: ${(e as Error).message}` };
    }
  }

  hlsUrl(path: string, token: string): string {
    return `${this.base.replace(/\/$/, '')}/${encodeURIComponent(path)}/index.m3u8?token=${encodeURIComponent(token)}`;
  }
}

/**
 * No gateway configured: tiles show the "Camera feed" placeholder with Live/Offline state.
 * Status comes from the stored camera row; Reconnect re-probes and succeeds for enabled cameras
 * that have an RTSP source, as a real gateway would once the camera answers again.
 */
export class StubGateway implements StreamGateway {
  readonly mode = 'stub' as const;
  async upsertPath(): Promise<void> {}
  async removePath(): Promise<void> {}
  async restartPath(): Promise<void> {}
  async probe(_path: string, hasSource: boolean): Promise<{ ready: boolean; error: string | null }> {
    return hasSource ? { ready: true, error: null } : { ready: false, error: 'No RTSP source configured' };
  }
  hlsUrl(): null {
    return null;
  }
}

export function gatewayFromEnv(): StreamGateway {
  return env.CCTV_GATEWAY_URL ? new MediaMtxGateway(env.CCTV_GATEWAY_URL) : new StubGateway();
}
