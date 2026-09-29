import type { ApiError, LoginResponse } from '@lexisora/shared';

const BASE = '/api/v1';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(t: string | null) {
  accessToken = t;
}
export function getAccessToken() {
  return accessToken;
}
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Refresh the access token using the httpOnly refresh cookie. Single-flight. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(async (r) => {
        if (!r.ok) return false;
        const data = (await r.json()) as LoginResponse;
        accessToken = data.accessToken;
        sessionListeners.forEach((l) => l(data));
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}
const sessionListeners = new Set<(d: LoginResponse) => void>();
export function onSessionRefreshed(fn: (d: LoginResponse) => void) {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

type Opts = Omit<RequestInit, 'body'> & { body?: unknown; query?: Record<string, unknown> };

function buildUrl(path: string, query?: Record<string, unknown>) {
  const url = new URL(BASE + path, window.location.origin);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  return url.pathname + url.search;
}

/**
 * JSON API call. Retries once after refreshing an expired access token.
 * `body` FormData is sent as-is (uploads); anything else is JSON-encoded.
 */
export async function api<T = unknown>(path: string, opts: Opts = {}, retry = true): Promise<T> {
  const headers = new Headers(opts.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(buildUrl(path, opts.query), { ...opts, headers, body, credentials: 'include' });
  if (res.status === 401 && retry && !path.startsWith('/auth/login')) {
    if (await refreshSession()) return api<T>(path, opts, false);
    onSessionExpired?.();
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const e = (typeof data === 'object' ? data : { message: String(data) }) as Partial<ApiError>;
    throw new HttpError(res.status, e.code ?? 'ERROR', e.message ?? 'Request failed', e.details);
  }
  return data as T;
}

export const get = <T>(path: string, query?: Record<string, unknown>) => api<T>(path, { method: 'GET', query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export type UploadedFile = { id: string; filename: string; mime: string; size: number; url: string };

/** Upload a file to the generic store; returns the FileObject (use `.id` in domain payloads). */
export function uploadFile(file: File, category: string): Promise<UploadedFile> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('category', category);
  return api<UploadedFile>('/files', { method: 'POST', body: fd });
}

/** URL for <img>/<a> that carries the access token (files are private). */
export function fileUrl(fileId: string | null | undefined): string | undefined {
  if (!fileId) return undefined;
  return `${BASE}/files/${fileId}${accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : ''}`;
}

/** Any authenticated API path as a link (PDF downloads etc.). */
export function authUrl(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${BASE}${path}${accessToken ? `${sep}access_token=${encodeURIComponent(accessToken)}` : ''}`;
}

/** Trigger a browser download of an authenticated API resource. */
export async function download(path: string, filename?: string) {
  const headers = new Headers();
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  const res = await fetch(BASE + path, { headers, credentials: 'include' });
  if (!res.ok) throw new HttpError(res.status, 'DOWNLOAD_FAILED', 'Download failed');
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = filename ?? decodeURIComponent(/filename="?([^";]+)"?/.exec(cd)?.[1] ?? 'download');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
