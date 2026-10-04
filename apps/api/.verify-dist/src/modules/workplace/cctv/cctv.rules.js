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
    get RECONNECT_COOLDOWN_MS () {
        return RECONNECT_COOLDOWN_MS;
    },
    get SESSION_IDLE_MS () {
        return SESSION_IDLE_MS;
    },
    get VIEW_TOKEN_TTL_MS () {
        return VIEW_TOKEN_TTL_MS;
    },
    get cameraTile () {
        return cameraTile;
    },
    get maskRtsp () {
        return maskRtsp;
    },
    get nextHealth () {
        return nextHealth;
    },
    get signViewToken () {
        return signViewToken;
    },
    get verifyViewToken () {
        return verifyViewToken;
    }
});
const _nodecrypto = require("node:crypto");
function maskRtsp(url) {
    if (!url) return null;
    const m = /^(rtsps?):\/\/(?:([^@/]*)@)?([^/:?#]+)(?::\d+)?(\/[^?#]*)?/i.exec(url.trim());
    if (!m) return 'rtsp://…';
    const [, scheme, creds, host, path] = m;
    return `${scheme.toLowerCase()}://${creds ? '***@' : ''}${host}${path && path !== '/' ? '/…' : ''}`;
}
function cameraTile(c) {
    if (!c.enabled || c.status === 'DISABLED') return {
        kicker: 'Disabled',
        meta: c.location,
        live: false
    };
    if (c.status === 'ONLINE') return {
        kicker: 'Live',
        meta: c.location,
        live: true
    };
    if (c.status === 'OFFLINE') return {
        kicker: 'Offline',
        meta: c.lastSeen ? `Last seen ${c.lastSeen}` : 'Not seen yet',
        live: false
    };
    return {
        kicker: 'Connecting',
        meta: c.location,
        live: false
    };
}
function nextHealth(prev, ready) {
    if (ready) return {
        status: 'ONLINE',
        failures: 0,
        wentOffline: false
    };
    const failures = prev.failures + 1;
    if (failures >= 2) return {
        status: 'OFFLINE',
        failures,
        wentOffline: prev.status !== 'OFFLINE'
    };
    return {
        status: prev.status === 'OFFLINE' ? 'OFFLINE' : 'UNKNOWN',
        failures,
        wentOffline: false
    };
}
function signViewToken(secret, p) {
    const body = Buffer.from(`${p.sid}.${p.path}.${p.exp}`).toString('base64url');
    const sig = (0, _nodecrypto.createHmac)('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
}
function verifyViewToken(secret, token, now = Date.now()) {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expect = (0, _nodecrypto.createHmac)('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !(0, _nodecrypto.timingSafeEqual)(a, b)) return null;
    const [sid, path, exp] = Buffer.from(body, 'base64url').toString().split('.');
    if (!sid || !path || !exp || Number(exp) < now) return null;
    return {
        sid,
        path,
        exp: Number(exp)
    };
}
const VIEW_TOKEN_TTL_MS = 5 * 60_000;
const RECONNECT_COOLDOWN_MS = 30_000;
const SESSION_IDLE_MS = 3 * 60_000;

//# sourceMappingURL=cctv.rules.js.map