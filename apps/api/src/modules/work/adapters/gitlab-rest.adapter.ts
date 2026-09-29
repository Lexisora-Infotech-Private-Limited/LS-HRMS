import { Logger } from '@nestjs/common';
import { GitProviderError, repoPath, type BranchRef, type GitProviderAdapter, type MrRef, type RepoRef } from './git.adapter';

/**
 * GitLab REST v4 adapter (PRIVATE-TOKEN auth, scope `api`). Retries 429/5xx with backoff;
 * 401/403 are surfaced immediately so the integration can be flagged AUTH_ERROR.
 */
export class GitLabRestAdapter implements GitProviderAdapter {
  readonly mode = 'gitlab' as const;
  private readonly log = new Logger('GitLab');
  private readonly api: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.api = `${baseUrl.replace(/\/+$/, '')}/api/v4`;
  }

  private async call<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T | null> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await this.fetchImpl(`${this.api}${path}`, {
          method,
          headers: { 'PRIVATE-TOKEN': this.token, ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 404 && allow404) return null;
        if (res.status === 429 || res.status >= 500) {
          lastErr = new GitProviderError(`GitLab ${res.status}`, res.status);
          await new Promise((r) => setTimeout(r, 300 * attempt * attempt));
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          let msg = text;
          try {
            const j = JSON.parse(text);
            msg = typeof j.message === 'string' ? j.message : JSON.stringify(j.message ?? j.error ?? j);
          } catch {}
          throw new GitProviderError(`GitLab ${res.status}: ${msg}`.slice(0, 300), res.status);
        }
        return (await res.json()) as T;
      } catch (e) {
        if (e instanceof GitProviderError && e.status && e.status < 500 && e.status !== 429) throw e;
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new GitProviderError('GitLab request failed');
  }

  private pid(repo: RepoRef): string {
    return repo.projectId ? String(repo.projectId) : encodeURIComponent(repoPath(repo.repoUrl));
  }

  async resolveProject(repoUrl: string) {
    const p = await this.call<{ id: number; default_branch: string; web_url: string }>('GET', `/projects/${encodeURIComponent(repoPath(repoUrl))}`);
    return { projectId: p!.id, defaultBranch: p!.default_branch ?? 'main', webUrl: p!.web_url };
  }

  async ensureBranch(repo: RepoRef, name: string, ref: string): Promise<BranchRef> {
    const pid = this.pid(repo);
    const existing = await this.call<{ name: string; web_url?: string }>('GET', `/projects/${pid}/repository/branches/${encodeURIComponent(name)}`, undefined, true);
    if (existing) return { name, url: existing.web_url ?? '', created: false, ref };
    let useRef = ref;
    const refExists = await this.call('GET', `/projects/${pid}/repository/branches/${encodeURIComponent(ref)}`, undefined, true);
    if (!refExists) {
      const p = await this.call<{ default_branch: string }>('GET', `/projects/${pid}`);
      useRef = p!.default_branch;
      this.log.warn(`Target branch ${ref} missing, branching ${name} from ${useRef}`);
    }
    const b = await this.call<{ name: string; web_url?: string }>('POST', `/projects/${pid}/repository/branches?branch=${encodeURIComponent(name)}&ref=${encodeURIComponent(useRef)}`);
    return { name: b!.name, url: b!.web_url ?? '', created: true, ref: useRef };
  }

  async ensureMr(repo: RepoRef, i: { source: string; target: string; title: string; description: string; labels: string[] }): Promise<MrRef> {
    const pid = this.pid(repo);
    const open = await this.call<{ iid: number; web_url: string; state: string }[]>('GET', `/projects/${pid}/merge_requests?state=opened&source_branch=${encodeURIComponent(i.source)}`);
    if (open && open.length) return { iid: open[0]!.iid, url: open[0]!.web_url, state: 'opened', created: false };
    const mr = await this.call<{ iid: number; web_url: string; state: string }>('POST', `/projects/${pid}/merge_requests`, {
      source_branch: i.source,
      target_branch: i.target,
      title: i.title,
      description: i.description,
      remove_source_branch: true,
      labels: i.labels.join(','),
    });
    return { iid: mr!.iid, url: mr!.web_url, state: (mr!.state as MrRef['state']) ?? 'opened', created: true };
  }

  async testConnection() {
    try {
      const u = await this.call<{ username: string }>('GET', '/user');
      return { ok: true, user: u!.username };
    } catch (e) {
      return { ok: false, user: '', message: (e as Error).message };
    }
  }
}
