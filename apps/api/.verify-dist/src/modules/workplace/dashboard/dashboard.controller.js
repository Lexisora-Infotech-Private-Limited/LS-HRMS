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
    get DashboardController () {
        return DashboardController;
    },
    get EventsController () {
        return EventsController;
    },
    get QuotesController () {
        return QuotesController;
    },
    get TodosController () {
        return TodosController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _zodpipe = require("../../../core/http/zod.pipe");
const _dashboardservice = require("./dashboard.service");
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
const quoteUpdateSchema = _shared.dailyQuoteSchema.partial();
const celebrationsQuery = _zod.z.object({
    days: _zod.z.coerce.number().int().min(1).max(60).default(14)
});
let DashboardController = class DashboardController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    get(q) {
        const sections = q.sections?.split(',').map((s)=>s.trim()).filter(Boolean);
        return this.svc.dashboard(sections);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('dashboard.view'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.dashboardQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], DashboardController.prototype, "get", null);
DashboardController = _ts_decorate([
    (0, _common.Controller)('dashboard'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _dashboardservice.DashboardService === "undefined" ? Object : _dashboardservice.DashboardService
    ])
], DashboardController);
let QuotesController = class QuotesController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    today() {
        return this.svc.quoteToday();
    }
    list() {
        return this.svc.listQuotes();
    }
    create(dto) {
        return this.svc.createQuote(dto);
    }
    update(id, dto) {
        return this.svc.updateQuote(id, dto);
    }
    remove(id) {
        return this.svc.deleteQuote(id);
    }
};
_ts_decorate([
    (0, _common.Get)('today'),
    (0, _decorators.RequirePerm)('dashboard.view'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], QuotesController.prototype, "today", null);
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('quotes.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], QuotesController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('quotes.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.dailyQuoteSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof DailyQuoteInput === "undefined" ? Object : DailyQuoteInput
    ]),
    _ts_metadata("design:returntype", void 0)
], QuotesController.prototype, "create", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    (0, _decorators.RequirePerm)('quotes.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(quoteUpdateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Partial === "undefined" ? Object : Partial
    ]),
    _ts_metadata("design:returntype", void 0)
], QuotesController.prototype, "update", null);
_ts_decorate([
    (0, _common.Delete)(':id'),
    (0, _decorators.RequirePerm)('quotes.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], QuotesController.prototype, "remove", null);
QuotesController = _ts_decorate([
    (0, _common.Controller)('quotes'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _dashboardservice.DashboardService === "undefined" ? Object : _dashboardservice.DashboardService
    ])
], QuotesController);
let TodosController = class TodosController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    list() {
        return this.svc.listTodos();
    }
    create(dto) {
        return this.svc.createTodo(dto);
    }
    update(id, dto) {
        return this.svc.updateTodo(id, dto);
    }
    complete(id) {
        return this.svc.setTodoDone(id, true);
    }
    reopen(id) {
        return this.svc.setTodoDone(id, false);
    }
    remove(id) {
        return this.svc.deleteTodo(id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('dashboard.view'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], TodosController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('dashboard.view'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.todoCreateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof TodoCreateInput === "undefined" ? Object : TodoCreateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], TodosController.prototype, "create", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    (0, _decorators.RequirePerm)('dashboard.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.todoUpdateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Partial === "undefined" ? Object : Partial
    ]),
    _ts_metadata("design:returntype", void 0)
], TodosController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)(':id/complete'),
    (0, _decorators.RequirePerm)('dashboard.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TodosController.prototype, "complete", null);
_ts_decorate([
    (0, _common.Post)(':id/reopen'),
    (0, _decorators.RequirePerm)('dashboard.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TodosController.prototype, "reopen", null);
_ts_decorate([
    (0, _common.Delete)(':id'),
    (0, _decorators.RequirePerm)('dashboard.view'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], TodosController.prototype, "remove", null);
TodosController = _ts_decorate([
    (0, _common.Controller)('todos'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _dashboardservice.DashboardService === "undefined" ? Object : _dashboardservice.DashboardService
    ])
], TodosController);
let EventsController = class EventsController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    list(q) {
        return this.svc.listEvents(q);
    }
    celebrations(q) {
        return this.svc.celebrations(q.days, (0, _requestcontext.requireContext)().employeeId);
    }
    create(dto) {
        return this.svc.createEvent(dto);
    }
    update(id, dto) {
        return this.svc.updateEvent(id, dto);
    }
    cancel(id) {
        return this.svc.cancelEvent(id);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('dashboard.view', 'notices.view'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.eventsQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], EventsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('celebrations'),
    (0, _decorators.RequirePerm)('dashboard.view', 'notices.view'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(celebrationsQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], EventsController.prototype, "celebrations", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('notices.publish.global'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.companyEventSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CompanyEventInput === "undefined" ? Object : CompanyEventInput
    ]),
    _ts_metadata("design:returntype", void 0)
], EventsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    (0, _decorators.RequirePerm)('notices.publish.global'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.companyEventSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof CompanyEventInput === "undefined" ? Object : CompanyEventInput
    ]),
    _ts_metadata("design:returntype", void 0)
], EventsController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)(':id/cancel'),
    (0, _decorators.RequirePerm)('notices.publish.global'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], EventsController.prototype, "cancel", null);
EventsController = _ts_decorate([
    (0, _common.Controller)('events'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _dashboardservice.DashboardService === "undefined" ? Object : _dashboardservice.DashboardService
    ])
], EventsController);

//# sourceMappingURL=dashboard.controller.js.map