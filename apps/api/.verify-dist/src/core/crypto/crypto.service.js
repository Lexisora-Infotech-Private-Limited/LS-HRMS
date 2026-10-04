"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CryptoService", {
    enumerable: true,
    get: function() {
        return CryptoService;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _env = require("../../config/env");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") {
        r = Reflect.decorate(decorators, target, key, desc);
    } else {
        for(var i = decorators.length - 1; i >= 0; i--){
            if (d = decorators[i]) {
                r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
            }
        }
    }
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let CryptoService = class CryptoService {
    key = (0, _nodecrypto.createHash)('sha256').update(_env.env.DATA_ENCRYPTION_KEY).digest();
    encrypt(plain) {
        if (plain === null || plain === undefined || plain === '') return null;
        const iv = (0, _nodecrypto.randomBytes)(12);
        const c = (0, _nodecrypto.createCipheriv)('aes-256-gcm', this.key, iv);
        const data = Buffer.concat([
            c.update(plain, 'utf8'),
            c.final()
        ]);
        return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
    }
    decrypt(cipher) {
        if (!cipher) return null;
        const [v, iv, tag, data] = cipher.split(':');
        if (v !== 'v1' || !iv || !tag || !data) return null;
        const d = (0, _nodecrypto.createDecipheriv)('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
        d.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([
            d.update(Buffer.from(data, 'base64')),
            d.final()
        ]).toString('utf8');
    }
    encryptJson(v) {
        return this.encrypt(JSON.stringify(v));
    }
    decryptJson(c) {
        const s = this.decrypt(c);
        return s ? JSON.parse(s) : null;
    }
    /** "XXXX XXXX 1234" style masking for display. */ static mask(last4, prefix = 'XXXX XXXX ') {
        return last4 ? prefix + last4 : '—';
    }
};
CryptoService = _ts_decorate([
    (0, _common.Injectable)()
], CryptoService);

//# sourceMappingURL=crypto.service.js.map