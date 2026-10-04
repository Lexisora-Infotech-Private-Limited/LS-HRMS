"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "NotificationsController", {
    enumerable: true,
    get: function() {
        return NotificationsController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _requestcontext = require("../context/request-context");
const _decorators = require("../auth/decorators");
const _notificationsservice = require("./notifications.service");
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
/** "Today" / "Yesterday" / "26 Sep", judged on the IST business day (not server time). */ function whenLabel(d) {
    const key = (0, _shared.istDateKey)(d);
    if (key === (0, _shared.istDateKey)()) return 'Today';
    if (key === (0, _shared.istDateKey)(new Date(Date.now() - 86400_000))) return 'Yesterday';
    return (0, _shared.formatDayMonth)(d);
}
let NotificationsController = class NotificationsController {
    notifications;
    constructor(notifications){
        this.notifications = notifications;
    }
    async list() {
        const rows = await this.notifications.list((0, _requestcontext.requireContext)().userId);
        return rows.map((n)=>({
                ...n,
                when: whenLabel(n.createdAt)
            }));
    }
    async count() {
        return {
            unread: await this.notifications.unreadCount((0, _requestcontext.requireContext)().userId)
        };
    }
    async readAll() {
        await this.notifications.markRead((0, _requestcontext.requireContext)().userId);
    }
    async read(id) {
        await this.notifications.markRead((0, _requestcontext.requireContext)().userId, id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], NotificationsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('count'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], NotificationsController.prototype, "count", null);
_ts_decorate([
    (0, _common.Post)('read-all'),
    (0, _common.HttpCode)(204),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], NotificationsController.prototype, "readAll", null);
_ts_decorate([
    (0, _common.Post)(':id/read'),
    (0, _common.HttpCode)(204),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], NotificationsController.prototype, "read", null);
NotificationsController = _ts_decorate([
    (0, _common.Controller)('notifications'),
    (0, _decorators.RequirePerm)('alerts.view'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService
    ])
], NotificationsController);

//# sourceMappingURL=notifications.controller.js.map