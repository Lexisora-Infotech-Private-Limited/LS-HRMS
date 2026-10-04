"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WorkEvents", {
    enumerable: true,
    get: function() {
        return WorkEvents;
    }
});
const _common = require("@nestjs/common");
const _realtimegateway = require("../../core/realtime/realtime.gateway");
const _eventsservice = require("../../core/registry/events.service");
const _requestcontext = require("../../core/context/request-context");
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
let WorkEvents = class WorkEvents {
    realtime;
    events;
    constructor(realtime, events){
        this.realtime = realtime;
        this.events = events;
    }
    boardChanged(projectId, departmentId, taskId) {
        const t = (0, _requestcontext.getContext)()?.tenantId;
        if (t) this.realtime.toTenant(t, 'work.board', {
            projectId,
            departmentId,
            taskId: taskId ?? null
        });
    }
    /** A user's board access changed (allocated / revoked) — their lock state updates live. */ accessChanged(userIds, projectId, departmentId) {
        this.realtime.toUsers(userIds, 'work.boardAccess', {
            projectId,
            departmentId
        });
    }
    /** Tracker "Working on" list should refresh for these users. */ trackerTasksChanged(userIds) {
        this.realtime.toUsers(userIds.filter(Boolean), 'tracker.tasks_changed', {});
    }
    taskStatusChanged(taskId, from, to) {
        this.events.emit('task.statusChanged', {
            taskId,
            from,
            to
        });
    }
    emit(event, payload) {
        this.events.emit(event, payload);
    }
};
WorkEvents = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService
    ])
], WorkEvents);

//# sourceMappingURL=work-events.service.js.map