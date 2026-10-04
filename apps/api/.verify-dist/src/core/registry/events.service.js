"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "EventsService", {
    enumerable: true,
    get: function() {
        return EventsService;
    }
});
const _common = require("@nestjs/common");
const _requestcontext = require("../context/request-context");
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
let EventsService = class EventsService {
    log = new _common.Logger('Events');
    handlers = new Map();
    on(event, handler) {
        const list = this.handlers.get(event) ?? [];
        list.push(handler);
        this.handlers.set(event, list);
    }
    emit(event, payload) {
        const ctx = (0, _requestcontext.getContext)();
        const list = this.handlers.get(event) ?? [];
        for (const h of list){
            setImmediate(()=>{
                const run = async ()=>{
                    try {
                        await h(payload);
                    } catch (e) {
                        this.log.error(`${event} handler failed: ${e.stack ?? e}`);
                    }
                };
                void (ctx ? (0, _requestcontext.runWithContext)(ctx, run) : run());
            });
        }
    }
    /** Await all handlers (use when the caller needs the side effects done, e.g. seeds/tests). */ async emitAndWait(event, payload) {
        for (const h of this.handlers.get(event) ?? [])await h(payload);
    }
};
EventsService = _ts_decorate([
    (0, _common.Injectable)()
], EventsService);

//# sourceMappingURL=events.service.js.map