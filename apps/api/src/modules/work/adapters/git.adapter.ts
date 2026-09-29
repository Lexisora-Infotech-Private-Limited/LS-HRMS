/** Git provider port (GitLab REST v4 in production, a recording stub in dev/test). */
export type RepoRef = { repoUrl: string; projectId?: number | null };
export type MrRef = { iid: number; url: string; state: 'opened' | 'merged' | 'closed'; created: boolean };
export type BranchRef = { name: string; url: string; created: boolean; ref: string };

export interface GitProviderAdapter {
  readonly mode: 'gitlab' | 'stub';
  resolveProject(repoUrl: string): Promise<{ projectId: number; defaultBranch: string; webUrl: string }>;
  ensureBranch(repo: RepoRef, name: string, ref: string): Promise<BranchRef>;
  ensureMr(repo: RepoRef, i: { source: string; target: string; title: string; description: string; labels: string[] }): Promise<MrRef>;
  testConnection(): Promise<{ ok: boolean; user: string; message?: string }>;
}

export class GitProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

/** "https://gitlab.com/lexisora/atlas-crm.git" → "lexisora/atlas-crm" */
export function repoPath(repoUrl: string): string {
  try {
    const u = new URL(repoUrl);
    return u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  } catch {
    return repoUrl.replace(/^git@[^:]+:/, '').replace(/\.git$/, '');
  }
}

/** Web URL of a repo without trailing .git / slash. */
export function repoWebUrl(repoUrl: string): string {
  return repoUrl.replace(/\.git$/, '').replace(/\/+$/, '');
}
