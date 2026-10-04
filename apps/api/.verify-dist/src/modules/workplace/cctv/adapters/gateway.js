"use strict";
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
    get MediaMtxGateway () {
        return MediaMtxGateway;
    },
    get StubGateway () {
        return StubGateway;
    },
    get gatewayFromEnv () {
        return gatewayFromEnv;
    }
});
const _common = require("@nestjs/common");
const _env = require("../../../../config/env");
let MediaMtxGateway = class MediaMtxGateway {
    base;
    mode = 'gateway';
    log = new _common.Logger('CctvGateway');
    api;
    constructor(base){
        this.base = base;
        const fromEnv = process.env.CCTV_GATEWAY_API_URL;
        let api = fromEnv ?? '';
        if (!api) {
            try {
                const u = new URL(base);
                u.port = '9997';
                u.pathname = '';
                api = u.toString();
            } catch  {
                api = base;
            }
        }
        this.api = api.replace(/\/$/, '');
    }
    async call(method, path, body) {
        return fetch(`${this.api}${path}`, {
            method,
            headers: body ? {
                'Content-Type': 'application/json'
            } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(10_000)
        });
    }
    async upsertPath(path, sourceUrl) {
        const conf = {
            source: sourceUrl,
            sourceOnDemand: true
        };
        const patched = await this.call('PATCH', `/v3/config/paths/patch/${encodeURIComponent(path)}`, conf).catch(()=>null);
        if (patched?.ok) return;
        const added = await this.call('POST', `/v3/config/paths/add/${encodeURIComponent(path)}`, conf);
        if (!added.ok) throw new Error(`gateway add ${path}: HTTP ${added.status}`);
    }
    async removePath(path) {
        await this.call('DELETE', `/v3/config/paths/delete/${encodeURIComponent(path)}`).catch((e)=>this.log.debug(`remove ${path}: ${e.message}`));
    }
    async restartPath(path, sourceUrl) {
        await this.removePath(path);
        if (sourceUrl) await this.upsertPath(path, sourceUrl);
    }
    async probe(path) {
        try {
            const res = await this.call('GET', `/v3/paths/get/${encodeURIComponent(path)}`);
            if (res.status === 404) return {
                ready: false,
                error: 'Stream not running'
            };
            if (!res.ok) return {
                ready: false,
                error: `Gateway HTTP ${res.status}`
            };
            const j = await res.json();
            return {
                ready: !!j.ready,
                error: j.ready ? null : 'No video from the camera'
            };
        } catch (e) {
            return {
                ready: false,
                error: `Gateway unreachable: ${e.message}`
            };
        }
    }
    hlsUrl(path, token) {
        return `${this.base.replace(/\/$/, '')}/${encodeURIComponent(path)}/index.m3u8?token=${encodeURIComponent(token)}`;
    }
};
let StubGateway = class StubGateway {
    mode = 'stub';
    async upsertPath() {}
    async removePath() {}
    async restartPath() {}
    async probe(_path, hasSource) {
        return hasSource ? {
            ready: true,
            error: null
        } : {
            ready: false,
            error: 'No RTSP source configured'
        };
    }
    hlsUrl() {
        return null;
    }
};
function gatewayFromEnv() {
    return _env.env.CCTV_GATEWAY_URL ? new MediaMtxGateway(_env.env.CCTV_GATEWAY_URL) : new StubGateway();
}

//# sourceMappingURL=gateway.js.map