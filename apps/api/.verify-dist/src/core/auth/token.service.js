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
    get TokenService () {
        return TokenService;
    },
    get randomToken () {
        return randomToken;
    },
    get sha256 () {
        return sha256;
    }
});
const _common = require("@nestjs/common");
const _jwt = require("@nestjs/jwt");
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
function _ts_metadata(metadataKey, metadataValue) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") {
        return Reflect.metadata(metadataKey, metadataValue);
    }
}
const sha256 = (s)=>(0, _nodecrypto.createHash)('sha256').update(s).digest('hex');
const randomToken = (bytes = 32)=>(0, _nodecrypto.randomBytes)(bytes).toString('base64url');
let TokenService = class TokenService {
    jwt;
    constructor(jwt){
        this.jwt = jwt;
    }
    signAccess(userId, tenantId) {
        const p = {
            sub: userId,
            tid: tenantId,
            typ: 'access'
        };
        return this.jwt.sign(p, {
            secret: _env.env.JWT_ACCESS_SECRET,
            expiresIn: _env.env.ACCESS_TOKEN_TTL_SEC
        });
    }
    signDevice(userId, tenantId, deviceId) {
        const p = {
            sub: userId,
            tid: tenantId,
            did: deviceId,
            typ: 'device'
        };
        return this.jwt.sign(p, {
            secret: _env.env.JWT_ACCESS_SECRET,
            expiresIn: '365d'
        });
    }
    verify(token) {
        try {
            return this.jwt.verify(token, {
                secret: _env.env.JWT_ACCESS_SECRET
            });
        } catch  {
            return null;
        }
    }
};
TokenService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _jwt.JwtService === "undefined" ? Object : _jwt.JwtService
    ])
], TokenService);

//# sourceMappingURL=token.service.js.map