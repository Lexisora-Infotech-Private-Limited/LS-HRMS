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
    get LiveKitProvider () {
        return LiveKitProvider;
    },
    get LocalRtcProvider () {
        return LocalRtcProvider;
    },
    get rtcProviderFromEnv () {
        return rtcProviderFromEnv;
    }
});
const _common = require("@nestjs/common");
const _livekitserversdk = require("livekit-server-sdk");
const _env = require("../../../../config/env");
let LiveKitProvider = class LiveKitProvider {
    url;
    key;
    secret;
    name = 'livekit';
    log = new _common.Logger('LiveKit');
    constructor(url, key, secret){
        this.url = url;
        this.key = key;
        this.secret = secret;
    }
    async issueToken(p) {
        const at = new _livekitserversdk.AccessToken(this.key, this.secret, {
            identity: p.identity,
            name: p.name,
            ttl: p.ttlSec ?? 4 * 3600
        });
        at.addGrant({
            roomJoin: true,
            room: p.room,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true
        });
        return at.toJwt();
    }
    async endRoom(room) {
        try {
            const http = this.url.replace(/^ws/, 'http');
            await new _livekitserversdk.RoomServiceClient(http, this.key, this.secret).deleteRoom(room);
        } catch (e) {
            this.log.debug(`deleteRoom ${room}: ${e.message}`);
        }
    }
};
let LocalRtcProvider = class LocalRtcProvider {
    name = 'local';
    url = null;
    async issueToken() {
        return null;
    }
    async endRoom() {
    /* nothing to tear down */ }
};
function rtcProviderFromEnv() {
    if (_env.env.LIVEKIT_URL && _env.env.LIVEKIT_API_KEY && _env.env.LIVEKIT_API_SECRET) return new LiveKitProvider(_env.env.LIVEKIT_URL, _env.env.LIVEKIT_API_KEY, _env.env.LIVEKIT_API_SECRET);
    return new LocalRtcProvider();
}

//# sourceMappingURL=rtc.js.map