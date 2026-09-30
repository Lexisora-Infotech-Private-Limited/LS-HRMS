import type {
  PairStartInput,
  PairStartResponse,
  PairStatusResponse,
  ScreenshotMeta,
  ScreenshotUploadResult,
  TrackerBatch,
  TrackerBatchResult,
  TrackerConfirmResult,
  TrackerHeartbeatInput,
  TrackerHeartbeatResult,
  TrackerLoginInput,
  TrackerLoginResponse,
  TrackerPolicyResponse,
  TrackerPunchInput,
  TrackerPunchResult,
  TrackerTask,
  TrackerToday,
} from '@lexisora/shared';

/**
 * Thin fetch wrapper for the tracker endpoints (all under /api/v1, contract in
 * packages/shared/src/tracker.ts). The device token lives only here in main; it is
 * never handed to the renderer.
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
  /** Network failure, 5xx, 408 or 429 — worth retrying later. */
  get retryable() {
    return this.network || this.status >= 500 || this.status === 429 || this.status === 408;
  }
  /** The device credential is no longer valid (revoked / unpaired / token unknown). */
  get authLost() {
    return this.status === 401 || (this.status === 403 && /REVOKED|DEVICE_TOKEN|NOT_PAIRED/i.test(this.code));
  }
}

/** Optional server endpoint (not part of the core contract): GET /tracker/releases/latest. */
export type LatestRelease = { version: string; url?: string; downloadUrl?: string; notes?: string; mandatory?: boolean };

type RequestOpts = { token?: string | null; timeoutMs?: number; form?: FormData };

export class ApiClient {
  baseUrl: string;
  token: string | null = null;
  /** Dev "Go offline" switch: every request fails like a dropped connection. */
  forcedOffline = false;
  /** Called on 401 for a request made with the device token → the device was revoked / token invalid. */
  onUnauthorized: ((err: ApiError) => void) | null = null;
  /** Reachability signal after every request: true = the server answered (< 500), false = network error / 5xx. */
  onOutcome: ((reachable: boolean) => void) | null = null;

  constructor(
    serverUrl: string,
    private readonly userAgent = 'LexisoraTracker',
  ) {
    this.baseUrl = normalizeServerUrl(serverUrl);
  }

  setServer(url: string) {
    this.baseUrl = normalizeServerUrl(url);
  }

  private async request<T>(method: string, path: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
    if (this.forcedOffline) {
      this.onOutcome?.(false);
      throw new ApiError(0, 'OFFLINE', "You're offline. Tracking continues locally.", true);
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15_000);
    const token = opts.token === undefined ? this.token : opts.token;
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Client': this.userAgent };
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload: FormData | string | undefined;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1${path}`, { method, headers, body: payload, signal: ctl.signal });
    } catch (e) {
      this.onOutcome?.(false);
      throw new ApiError(0, 'NETWORK', "Can't reach the server. Check your connection.", true, String(e));
    } finally {
      clearTimeout(timer);
    }
    this.onOutcome?.(res.status < 500);
    const text = await res.text().catch(() => '');
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

  // ── sign-in & pairing (pairing-session token) ──────────────────────────
  login(input: TrackerLoginInput) {
    return this.request<TrackerLoginResponse>('POST', '/tracker/auth/login', input, { token: null });
  }

  pairStart(pairingToken: string, input: PairStartInput) {
    return this.request<PairStartResponse>('POST', '/tracker/pair/start', input, { token: pairingToken });
  }

  pairStatus(pairingToken: string) {
    return this.request<PairStatusResponse>('GET', '/tracker/pair/status', undefined, { token: pairingToken, timeoutMs: 10_000 });
  }

  pairCancel(pairingToken: string) {
    return this.request<{ ok: true }>('POST', '/tracker/pair/cancel', {}, { token: pairingToken, timeoutMs: 5_000 });
  }

  // ── device-token endpoints ──────────────────────────────────────────────
  policy() {
    return this.request<TrackerPolicyResponse>('GET', '/tracker/policy');
  }

  async tasks(): Promise<TrackerTask[]> {
    const r = await this.request<TrackerTask[] | { items: TrackerTask[] }>('GET', '/tracker/tasks');
    return Array.isArray(r) ? r : (r?.items ?? []);
  }

  today() {
    return this.request<TrackerToday>('GET', '/tracker/today');
  }

  punch(input: TrackerPunchInput) {
    return this.request<TrackerPunchResult>('POST', '/tracker/punch', input);
  }

  sync(batch: TrackerBatch) {
    return this.request<TrackerBatchResult>('POST', '/tracker/sync', batch, { timeoutMs: 30_000 });
  }

  /** multipart: file=<jpeg>, meta=<JSON ScreenshotMeta>. */
  uploadScreenshot(meta: ScreenshotMeta, jpeg: Buffer) {
    const form = new FormData();
    form.set('meta', JSON.stringify(meta));
    form.set('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), `${meta.clientId}.jpg`);
    return this.request<ScreenshotUploadResult>('POST', '/tracker/screenshots', undefined, { form, timeoutMs: 60_000 });
  }

  heartbeat(input: TrackerHeartbeatInput) {
    return this.request<TrackerHeartbeatResult>('POST', '/tracker/heartbeat', input, { timeoutMs: 10_000 });
  }

  /** "Add to weekly timesheet". */
  confirmDay(date: string) {
    return this.request<TrackerConfirmResult>('POST', `/tracker/days/${encodeURIComponent(date)}/confirm`, {});
  }

  /** "Sign out & unpair". */
  unpair() {
    return this.request<{ ok: true }>('POST', '/tracker/unpair', {}, { timeoutMs: 8_000 });
  }

  /** Optional endpoint; resolves null when the server doesn't provide it (404/405/501). */
  async latestRelease(): Promise<LatestRelease | null> {
    try {
      const r = await this.request<LatestRelease | null>('GET', '/tracker/releases/latest', undefined, { timeoutMs: 8_000 });
      return r && typeof r.version === 'string' ? r : null;
    } catch (e) {
      if (e instanceof ApiError && [404, 405, 501].includes(e.status)) return null;
      throw e;
    }
  }
}

/** "localhost:4000/" → "http://localhost:4000"; keeps https. */
export function normalizeServerUrl(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
}
