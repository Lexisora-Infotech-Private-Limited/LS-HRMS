import type {
  PairStartInput,
  PairStartResponse,
  PairStatusResponse,
  ScreenshotMeta,
  TrackerBatch,
  TrackerBatchResult,
  TrackerEvent,
  TrackerPolicy,
  TrackerTask,
  TrackerToday,
} from '@lexisora/shared';

/**
 * Thin fetch wrapper for the tracker endpoints (all under /api/v1).
 * The device token lives only here in main; it is never handed to the renderer.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly network = false,
    public readonly details?: unknown,
  ) {
    super(message);
  }
  /** Network failure or 5xx — worth retrying later. */
  get retryable() {
    return this.network || this.status >= 500 || this.status === 429;
  }
}

/** POST /tracker/auth/login — tolerant of the backend's exact field names. */
export type TrackerLoginResponse = {
  pairingToken?: string;
  accessToken?: string;
  token?: string;
  deviceToken?: string;
  deviceId?: string;
  mode?: 'FULL' | 'MONITOR_ONLY';
  user?: { id?: string; name?: string; email?: string; employeeId?: string | null; workMode?: string | null };
};

export type LatestRelease = { version: string; url?: string; downloadUrl?: string; notes?: string; mandatory?: boolean };

export type HeartbeatResponse = { serverTime?: string; policyVersion?: number; commands?: string[] } | null;

export class ApiClient {
  baseUrl: string;
  token: string | null = null;
  forcedOffline = false;
  /** Called on 401 with a device token → the device was revoked / token invalid. */
  onUnauthorized: ((err: ApiError) => void) | null = null;

  constructor(serverUrl: string) {
    this.baseUrl = serverUrl.replace(/\/+$/, '');
  }

  setServer(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { token?: string | null; timeoutMs?: number; form?: FormData; allow404?: boolean } = {},
  ): Promise<T> {
    if (this.forcedOffline) throw new ApiError(0, 'OFFLINE', 'You are offline', true);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15_000);
    const token = opts.token === undefined ? this.token : opts.token;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload: BodyInit | undefined;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1${path}`, { method, headers, body: payload, signal: ctl.signal });
    } catch (e) {
      throw new ApiError(0, 'NETWORK', "Can't reach the server. Check your connection.", true, String(e));
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = new ApiError(
        res.status,
        json?.code ?? `HTTP_${res.status}`,
        json?.message ?? (res.status >= 500 ? 'The server had a problem. Retrying shortly.' : `Request failed (${res.status})`),
        false,
        json?.details,
      );
      if (res.status === 401 && token && token === this.token) this.onUnauthorized?.(err);
      throw err;
    }
    return json as T;
  }

  // ── sign-in & pairing ───────────────────────────────────────────────────
  login(input: { workspace: string; email: string; password: string }) {
    return this.request<TrackerLoginResponse>('POST', '/tracker/auth/login', { ...input, client: 'tracker' }, { token: null });
  }

  pairStart(pairingToken: string, input: PairStartInput) {
    return this.request<PairStartResponse>('POST', '/tracker/pair/start', input, { token: pairingToken });
  }

  pairStatus(pairingToken: string, deviceId: string) {
    return this.request<PairStatusResponse>('GET', `/tracker/pair/status?deviceId=${encodeURIComponent(deviceId)}`, undefined, {
      token: pairingToken,
    });
  }

  // ── device-token endpoints ──────────────────────────────────────────────
  policy() {
    return this.request<TrackerPolicy & { mode?: 'FULL' | 'MONITOR_ONLY'; screenshotAllMonitors?: boolean; idleClaimsAllowed?: boolean }>(
      'GET',
      '/tracker/policy',
    );
  }

  tasks() {
    return this.request<TrackerTask[] | { items: TrackerTask[] }>('GET', '/tracker/tasks');
  }

  today() {
    return this.request<TrackerToday & { source?: string; weekSubmitted?: boolean; shiftStart?: string; shiftEnd?: string }>(
      'GET',
      '/tracker/today',
    );
  }

  punch(event: TrackerEvent) {
    return this.request<unknown>('POST', '/tracker/punch', {
      ...event,
      direction: event.type === 'PUNCH_IN' ? 'IN' : 'OUT',
    });
  }

  sync(batch: TrackerBatch) {
    return this.request<TrackerBatchResult>('POST', '/tracker/sync', batch, { timeoutMs: 30_000 });
  }

  uploadScreenshot(meta: ScreenshotMeta, jpeg: Buffer) {
    const form = new FormData();
    form.set('clientId', meta.clientId);
    form.set('capturedAt', meta.capturedAt);
    form.set('taskId', meta.taskId ?? '');
    form.set('monitorCount', String(meta.monitorCount));
    form.set('blurred', String(meta.blurred));
    form.set('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), `${meta.clientId}.jpg`);
    return this.request<unknown>('POST', '/tracker/screenshots', undefined, { form, timeoutMs: 60_000 });
  }

  heartbeat(body: { appVersion: string; queueDepth: number; status: string; taskId: string | null; hostname: string }) {
    return this.request<HeartbeatResponse>('POST', '/tracker/heartbeat', body, { timeoutMs: 10_000 });
  }

  unpair() {
    return this.request<unknown>('DELETE', '/tracker/devices/current');
  }

  saveSettings(settings: { launchAtStartup: boolean; showTrayWidget: boolean; breakReminders: boolean }) {
    return this.request<unknown>('PATCH', '/tracker/devices/current/settings', settings);
  }

  latestRelease() {
    return this.request<LatestRelease | null>('GET', '/tracker/releases/latest');
  }
}
