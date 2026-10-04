"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "StubGitAdapter", {
    enumerable: true,
    get: function() {
        return StubGitAdapter;
    }
});
const _common = require("@nestjs/common");
const _gitadapter = require("./git.adapter");
let StubGitAdapter = class StubGitAdapter {
    nextIid;
    mode = 'stub';
    log = new _common.Logger('GitStub');
    openMrs = new Map();
    constructor(nextIid){
        this.nextIid = nextIid;
    }
    async resolveProject(repoUrl) {
        const web = (0, _gitadapter.repoWebUrl)(repoUrl);
        let id = 0;
        for (const ch of web)id = (id * 31 + ch.charCodeAt(0)) % 900_000;
        return {
            projectId: 100_000 + id,
            defaultBranch: 'main',
            webUrl: web
        };
    }
    async ensureBranch(repo, name, ref) {
        const url = `${(0, _gitadapter.repoWebUrl)(repo.repoUrl)}/-/tree/${name}`;
        this.log.log(`branch ${name} from ${ref} on ${repo.repoUrl}`);
        return {
            name,
            url,
            created: true,
            ref
        };
    }
    async ensureMr(repo, i) {
        const key = `${(0, _gitadapter.repoWebUrl)(repo.repoUrl)}#${i.source}`;
        const existing = this.openMrs.get(key);
        if (existing) return {
            ...existing,
            created: false
        };
        const iid = await this.nextIid((0, _gitadapter.repoWebUrl)(repo.repoUrl));
        const mr = {
            iid,
            url: `${(0, _gitadapter.repoWebUrl)(repo.repoUrl)}/-/merge_requests/${iid}`,
            state: 'opened',
            created: true
        };
        this.openMrs.set(key, mr);
        this.log.log(`MR !${iid} ${i.source} → ${i.target}: ${i.title}`);
        return mr;
    }
    async testConnection() {
        return {
            ok: true,
            user: 'stub',
            message: 'No GitLab token configured — using the built-in stub (branches and MRs are recorded, not pushed).'
        };
    }
};

//# sourceMappingURL=git-stub.adapter.js.map