/** Git provider port (GitLab REST v4 in production, a recording stub in dev/test). */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get GitProviderError () {
        return GitProviderError;
    },
    get repoPath () {
        return repoPath;
    },
    get repoWebUrl () {
        return repoWebUrl;
    }
});
let GitProviderError = class GitProviderError extends Error {
    status;
    constructor(message, status){
        super(message), this.status = status;
    }
};
function repoPath(repoUrl) {
    try {
        const u = new URL(repoUrl);
        return u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
    } catch  {
        return repoUrl.replace(/^git@[^:]+:/, '').replace(/\.git$/, '');
    }
}
function repoWebUrl(repoUrl) {
    return repoUrl.replace(/\.git$/, '').replace(/\/+$/, '');
}

//# sourceMappingURL=git.adapter.js.map