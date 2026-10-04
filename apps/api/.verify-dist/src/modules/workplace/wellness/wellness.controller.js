"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WellnessController", {
    enumerable: true,
    get: function() {
        return WellnessController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _errors = require("../../../core/http/errors");
const _wellnessservice = require("./wellness.service");
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
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
const settingsSchema = _zod.z.object({
    enabledGames: _zod.z.array(_zod.z.enum(_shared.GAME_KEYS)).optional(),
    unlockTime: _zod.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm').optional()
});
function gameKey(g) {
    if (!_shared.GAME_KEYS.includes(g)) throw (0, _errors.badRequest)('Unknown game');
    return g;
}
let WellnessController = class WellnessController {
    wellness;
    constructor(wellness){
        this.wellness = wellness;
    }
    today() {
        return this.wellness.today();
    }
    leaderboard(q) {
        return this.wellness.leaderboard(q.week);
    }
    async settings() {
        return {
            ...await this.wellness.config(),
            canManage: this.wellness.canManage()
        };
    }
    updateSettings(dto) {
        return this.wellness.updateConfig(dto);
    }
    start(game) {
        return this.wellness.start(gameKey(game));
    }
    complete(game, dto) {
        return this.wellness.complete(gameKey(game), dto);
    }
};
_ts_decorate([
    (0, _common.Get)('today'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], WellnessController.prototype, "today", null);
_ts_decorate([
    (0, _common.Get)('leaderboard'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.leaderboardQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], WellnessController.prototype, "leaderboard", null);
_ts_decorate([
    (0, _common.Get)('settings'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WellnessController.prototype, "settings", null);
_ts_decorate([
    (0, _common.Patch)('settings'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(settingsSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], WellnessController.prototype, "updateSettings", null);
_ts_decorate([
    (0, _common.Post)(':game/start'),
    _ts_param(0, (0, _common.Param)('game')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], WellnessController.prototype, "start", null);
_ts_decorate([
    (0, _common.Post)(':game/complete'),
    _ts_param(0, (0, _common.Param)('game')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.gameCompleteSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], WellnessController.prototype, "complete", null);
WellnessController = _ts_decorate([
    (0, _common.Controller)('wellness'),
    (0, _decorators.RequirePerm)('wellness.play'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _wellnessservice.WellnessService === "undefined" ? Object : _wellnessservice.WellnessService
    ])
], WellnessController);

//# sourceMappingURL=wellness.controller.js.map