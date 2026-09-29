import { Logger } from '@nestjs/common';
import { repoWebUrl, type BranchRef, type GitProviderAdapter, type MrRef, type RepoRef } from './git.adapter';

/**
 * Stub used when no GitLab token is configured. Behaves like GitLab: returns realistic branch/MR
 * URLs, reuses an existing MR for the same source branch, numbers MRs per repo, and logs.
 * `nextIid` is backed by the tenant NumberSequence so MR numbers survive restarts.
 */
export class StubGitAdapter implements GitProviderAdapter {
  readonly mode = 'stub' as const;
  private readonly log = new Logger('GitStub');
  private readonly openMrs = new Map<string, MrRef>();

  constructor(private readonly nextIid: (repoKey: string) => Promise<number>) {}

  async resolveProject(repoUrl: string) {
    const web = repoWebUrl(repoUrl);
    let id = 0;
    for (const ch of web) id = (id * 31 + ch.charCodeAt(0)) % 900_000;
    return { projectId: 100_000 + id, defaultBranch: 'main', webUrl: web };
  }

  async ensureBranch(repo: RepoRef, name: string, ref: string): Promise<BranchRef> {
    const url = `${repoWebUrl(repo.repoUrl)}/-/tree/${name}`;
    this.log.log(`branch ${name} from ${ref} on ${repo.repoUrl}`);
    return { name, url, created: true, ref };
  }

  async ensureMr(repo: RepoRef, i: { source: string; target: string; title: string }): Promise<MrRef> {
    const key = `${repoWebUrl(repo.repoUrl)}#${i.source}`;
    const existing = this.openMrs.get(key);
    if (existing) return { ...existing, created: false };
    const iid = await this.nextIid(repoWebUrl(repo.repoUrl));
    const mr: MrRef = { iid, url: `${repoWebUrl(repo.repoUrl)}/-/merge_requests/${iid}`, state: 'opened', created: true };
    this.openMrs.set(key, mr);
    this.log.log(`MR !${iid} ${i.source} → ${i.target}: ${i.title}`);
    return mr;
  }

  async testConnection() {
    return { ok: true, user: 'stub', message: 'No GitLab token configured — using the built-in stub (branches and MRs are recorded, not pushed).' };
  }
}
