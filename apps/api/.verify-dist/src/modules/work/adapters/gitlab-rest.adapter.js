"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "GitLabRestAdapter", {
    enumerable: true,
    get: function() {
        return GitLabRestAdapter;
    }
});
const _common = require("@nestjs/common");
const _gitadapter = require("./git.adapter");
let GitLabRestAdapter = class GitLabRestAdapter {
    token;
    fetchImpl;
    mode = 'gitlab';
    log = new _common.Logger('GitLab');
    api;
    constructor(baseUrl, token, fetchImpl = fetch){
        this.token = token;
        this.fetchImpl = fetchImpl;
        this.api = `${baseUrl.replace(/\/+$/, '')}/api/v4`;
    }
    async call(method, path, body, allow404 = false) {
        let lastErr;
        for(let attempt = 1; attempt <= 3; attempt++){
            try {
                const res = await this.fetchImpl(`${this.api}${path}`, {
                    method,
                    headers: {
                        'PRIVATE-TOKEN': this.token,
                        ...body ? {
                            'content-type': 'application/json'
                        } : {}
                    },
                    body: body ? JSON.stringify(body) : undefined,
                    signal: AbortSignal.timeout(10_000)
                });
                if (res.status === 404 && allow404) return null;
                if (res.status === 429 || res.status >= 500) {
                    lastErr = new _gitadapter.GitProviderError(`GitLab ${res.status}`, res.status);
                    await new Promise((r)=>setTimeout(r, 300 * attempt * attempt));
                    continue;
                }
                if (!res.ok) {
                    const text = await res.text().catch(()=>'');
                    let msg = text;
                    try {
                        const j = JSON.parse(text);
                        msg = typeof j.message === 'string' ? j.message : JSON.stringify(j.message ?? j.error ?? j);
                    } catch  {}
                    throw new _gitadapter.GitProviderError(`GitLab ${res.status}: ${msg}`.slice(0, 300), res.status);
                }
                return await res.json();
            } catch (e) {
                if (e instanceof _gitadapter.GitProviderError && e.status && e.status < 500 && e.status !== 429) throw e;
                lastErr = e;
            }
        }
        throw lastErr instanceof Error ? lastErr : new _gitadapter.GitProviderError('GitLab request failed');
    }
    pid(repo) {
        return repo.projectId ? String(repo.projectId) : encodeURIComponent((0, _gitadapter.repoPath)(repo.repoUrl));
    }
    async resolveProject(repoUrl) {
        const p = await this.call('GET', `/projects/${encodeURIComponent((0, _gitadapter.repoPath)(repoUrl))}`);
        return {
            projectId: p.id,
            defaultBranch: p.default_branch ?? 'main',
            webUrl: p.web_url
        };
    }
    async ensureBranch(repo, name, ref) {
        const pid = this.pid(repo);
        const existing = await this.call('GET', `/projects/${pid}/repository/branches/${encodeURIComponent(name)}`, undefined, true);
        if (existing) return {
            name,
            url: existing.web_url ?? '',
            created: false,
            ref
        };
        let useRef = ref;
        const refExists = await this.call('GET', `/projects/${pid}/repository/branches/${encodeURIComponent(ref)}`, undefined, true);
        if (!refExists) {
            const p = await this.call('GET', `/projects/${pid}`);
            useRef = p.default_branch;
            this.log.warn(`Target branch ${ref} missing, branching ${name} from ${useRef}`);
        }
        const b = await this.call('POST', `/projects/${pid}/repository/branches?branch=${encodeURIComponent(name)}&ref=${encodeURIComponent(useRef)}`);
        return {
            name: b.name,
            url: b.web_url ?? '',
            created: true,
            ref: useRef
        };
    }
    async ensureMr(repo, i) {
        const pid = this.pid(repo);
        const open = await this.call('GET', `/projects/${pid}/merge_requests?state=opened&source_branch=${encodeURIComponent(i.source)}`);
        if (open && open.length) return {
            iid: open[0].iid,
            url: open[0].web_url,
            state: 'opened',
            created: false
        };
        const mr = await this.call('POST', `/projects/${pid}/merge_requests`, {
            source_branch: i.source,
            target_branch: i.target,
            title: i.title,
            description: i.description,
            remove_source_branch: true,
            labels: i.labels.join(',')
        });
        return {
            iid: mr.iid,
            url: mr.web_url,
            state: mr.state ?? 'opened',
            created: true
        };
    }
    async testConnection() {
        try {
            const u = await this.call('GET', '/user');
            return {
                ok: true,
                user: u.username
            };
        } catch (e) {
            return {
                ok: false,
                user: '',
                message: e.message
            };
        }
    }
};

//# sourceMappingURL=gitlab-rest.adapter.js.map