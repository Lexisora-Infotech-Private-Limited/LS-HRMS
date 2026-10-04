"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "LeaveController", {
    enumerable: true,
    get: function() {
        return LeaveController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _orgservice = require("../../../core/org/org.service");
const _errors = require("../../../core/http/errors");
const _requestcontext = require("../../../core/context/request-context");
const _dates = require("../common/dates");
const _leaverequestsservice = require("./leave-requests.service");
const _leaveadminservice = require("./leave-admin.service");
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
const yearQuery = _zod.z.object({
    year: _zod.z.coerce.number().int().min(2000).max(2100).optional()
});
const teamQuery = _zod.z.object({
    tab: _zod.z.enum([
        'PENDING',
        'HISTORY'
    ]).default('PENDING')
});
const previewQuery = _zod.z.object({
    employeeId: _zod.z.string().optional()
});
const runRuleBody = _zod.z.object({
    periodKey: _zod.z.string().regex(/^\d{4}(-\d{2})?$/, 'Use 2026 or 2026-09').optional()
});
const compOffDecision = _zod.z.object({
    comment: _zod.z.string().trim().max(500).optional()
});
let LeaveController = class LeaveController {
    requests;
    admin;
    org;
    constructor(requests, admin, org){
        this.requests = requests;
        this.admin = admin;
        this.org = org;
    }
    // ── self service ──
    myBalances(q) {
        return this.requests.balances(this.org.myEmployeeId(), q.year ?? (0, _dates.yearOf)((0, _dates.todayKey)()));
    }
    myRequests(q) {
        return this.requests.myRequests(this.org.myEmployeeId(), q);
    }
    upcoming() {
        return this.requests.upcoming(this.org.myEmployeeId());
    }
    today() {
        return this.requests.onLeave(this.org.myEmployeeId());
    }
    myCompOffs() {
        return this.admin.myCompOffs();
    }
    async employeeBalances(id, q) {
        const ctx = (0, _requestcontext.requireContext)();
        if (id !== ctx.employeeId && !(0, _decorators.hasPerm)(ctx, 'leave.manage')) {
            const tree = ctx.employeeId && (0, _decorators.hasPerm)(ctx, 'leave.approve') ? await this.org.reportTree(ctx.employeeId) : [];
            if (!tree.includes(id)) throw (0, _errors.forbidden)();
        }
        return this.requests.balances(id, q.year ?? (0, _dates.yearOf)((0, _dates.todayKey)()));
    }
    preview(body, q) {
        return this.requests.preview(body, q.employeeId);
    }
    apply(body) {
        return this.requests.apply(body);
    }
    onBehalf(body) {
        return this.requests.applyOnBehalf(body);
    }
    detail(id) {
        return this.requests.detail(id);
    }
    withdraw(id) {
        return this.requests.withdraw(id);
    }
    cancel(id, body) {
        return this.requests.cancel(id, body.reason);
    }
    approve(id, body) {
        return this.requests.approve(id, body.comment);
    }
    reject(id, body) {
        return this.requests.reject(id, body.comment);
    }
    approveCancellation(id) {
        return this.requests.decideCancellation(id, true);
    }
    rejectCancellation(id) {
        return this.requests.decideCancellation(id, false);
    }
    // ── team / admin ──
    team(q) {
        return this.requests.teamRequests(q.tab);
    }
    adminRequests(q) {
        return this.requests.adminRequests(q);
    }
    // ── comp-off ──
    requestCompOff(body) {
        return this.admin.requestCompOff(body);
    }
    approveCompOff(id, body) {
        return this.admin.decideCompOff(id, true, body.comment);
    }
    rejectCompOff(id, body) {
        return this.admin.decideCompOff(id, false, body.comment);
    }
    cancelGrant(id) {
        return this.admin.cancelGrant(id);
    }
    // ── setup ──
    types() {
        return this.admin.types((0, _decorators.hasPerm)((0, _requestcontext.requireContext)(), 'leave.manage'));
    }
    createType(body) {
        return this.admin.createType(body);
    }
    updateType(id, body) {
        return this.admin.updateType(id, body);
    }
    deleteType(id) {
        return this.admin.deleteType(id);
    }
    rules() {
        return this.admin.rules();
    }
    createRule(body) {
        return this.admin.saveRule(body);
    }
    updateRule(id, body) {
        return this.admin.saveRule(body, id);
    }
    runRule(id, body) {
        return this.admin.runRule(id, body.periodKey, {
            manual: true
        });
    }
    batches() {
        return this.admin.batches();
    }
    credits() {
        return this.admin.manualCredits();
    }
    credit(body) {
        return this.admin.manualCredit(body);
    }
    yearEndPreview(q) {
        return this.admin.yearEndPreview(q.year);
    }
    yearEnd(body) {
        return this.admin.runYearEnd(body.year);
    }
    settings() {
        return this.admin.getSettings();
    }
    saveSettings(body) {
        return this.admin.saveSettings(body);
    }
    holidays(q) {
        return this.admin.holidays(q.year ?? (0, _dates.yearOf)((0, _dates.todayKey)()));
    }
};
_ts_decorate([
    (0, _common.Get)('me/balances'),
    (0, _decorators.RequirePerm)('leave.self'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(yearQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "myBalances", null);
_ts_decorate([
    (0, _common.Get)('me/requests'),
    (0, _decorators.RequirePerm)('leave.self'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.leaveListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof LeaveListQuery === "undefined" ? Object : LeaveListQuery
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "myRequests", null);
_ts_decorate([
    (0, _common.Get)('me/upcoming'),
    (0, _decorators.RequirePerm)('leave.self'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "upcoming", null);
_ts_decorate([
    (0, _common.Get)('me/today'),
    (0, _decorators.RequirePerm)('leave.self'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "today", null);
_ts_decorate([
    (0, _common.Get)('me/comp-offs'),
    (0, _decorators.RequirePerm)('leave.self'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "myCompOffs", null);
_ts_decorate([
    (0, _common.Get)('employee/:id/balances'),
    (0, _decorators.RequirePerm)('leave.self', 'leave.manage', 'leave.approve'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Query)(new _zodpipe.ZodPipe(yearQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", Promise)
], LeaveController.prototype, "employeeBalances", null);
_ts_decorate([
    (0, _common.Post)('requests/preview'),
    (0, _decorators.RequirePerm)('leave.self', 'leave.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.leaveApplySchema))),
    _ts_param(1, (0, _common.Query)(new _zodpipe.ZodPipe(previewQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof LeaveApplyInput === "undefined" ? Object : LeaveApplyInput,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "preview", null);
_ts_decorate([
    (0, _common.Post)('requests'),
    (0, _decorators.RequirePerm)('leave.self'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.leaveApplySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof LeaveApplyInput === "undefined" ? Object : LeaveApplyInput
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "apply", null);
_ts_decorate([
    (0, _common.Post)('requests/on-behalf'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.leaveOnBehalfSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof LeaveOnBehalfInput === "undefined" ? Object : LeaveOnBehalfInput
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "onBehalf", null);
_ts_decorate([
    (0, _common.Get)('requests/:id'),
    (0, _decorators.RequirePerm)('leave.self', 'leave.approve', 'leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)('requests/:id/withdraw'),
    (0, _decorators.RequirePerm)('leave.self'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "withdraw", null);
_ts_decorate([
    (0, _common.Post)('requests/:id/cancel'),
    (0, _decorators.RequirePerm)('leave.self', 'leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.leaveCancelSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "cancel", null);
_ts_decorate([
    (0, _common.Post)('requests/:id/approve'),
    (0, _decorators.RequirePerm)('leave.approve', 'leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.leaveDecisionSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "approve", null);
_ts_decorate([
    (0, _common.Post)('requests/:id/reject'),
    (0, _decorators.RequirePerm)('leave.approve', 'leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.leaveRejectSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "reject", null);
_ts_decorate([
    (0, _common.Post)('requests/:id/cancellation/approve'),
    (0, _decorators.RequirePerm)('leave.approve', 'leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "approveCancellation", null);
_ts_decorate([
    (0, _common.Post)('requests/:id/cancellation/reject'),
    (0, _decorators.RequirePerm)('leave.approve', 'leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "rejectCancellation", null);
_ts_decorate([
    (0, _common.Get)('team/requests'),
    (0, _decorators.RequirePerm)('leave.approve', 'leave.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(teamQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "team", null);
_ts_decorate([
    (0, _common.Get)('admin/requests'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.leaveListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof LeaveListQuery === "undefined" ? Object : LeaveListQuery
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "adminRequests", null);
_ts_decorate([
    (0, _common.Post)('comp-off/requests'),
    (0, _decorators.RequirePerm)('leave.self'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.compOffRequestSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CompOffRequestInput === "undefined" ? Object : CompOffRequestInput
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "requestCompOff", null);
_ts_decorate([
    (0, _common.Post)('comp-off/requests/:id/approve'),
    (0, _decorators.RequirePerm)('leave.approve', 'leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(compOffDecision))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "approveCompOff", null);
_ts_decorate([
    (0, _common.Post)('comp-off/requests/:id/reject'),
    (0, _decorators.RequirePerm)('leave.approve', 'leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.leaveRejectSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "rejectCompOff", null);
_ts_decorate([
    (0, _common.Post)('comp-off/grants/:id/cancel'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "cancelGrant", null);
_ts_decorate([
    (0, _common.Get)('types'),
    (0, _decorators.RequirePerm)('leave.self', 'leave.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "types", null);
_ts_decorate([
    (0, _common.Post)('types'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.leaveTypeSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof LeaveTypeInput === "undefined" ? Object : LeaveTypeInput
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "createType", null);
_ts_decorate([
    (0, _common.Patch)('types/:id'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.leaveTypePatchSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "updateType", null);
_ts_decorate([
    (0, _common.Delete)('types/:id'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "deleteType", null);
_ts_decorate([
    (0, _common.Get)('rules'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "rules", null);
_ts_decorate([
    (0, _common.Post)('rules'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.creditRuleSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CreditRuleInput === "undefined" ? Object : CreditRuleInput
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "createRule", null);
_ts_decorate([
    (0, _common.Patch)('rules/:id'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.creditRuleSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof CreditRuleInput === "undefined" ? Object : CreditRuleInput
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "updateRule", null);
_ts_decorate([
    (0, _common.Post)('rules/:id/run'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(runRuleBody))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "runRule", null);
_ts_decorate([
    (0, _common.Get)('batches'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "batches", null);
_ts_decorate([
    (0, _common.Get)('credits'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "credits", null);
_ts_decorate([
    (0, _common.Post)('credits'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.manualCreditSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof ManualCreditInput === "undefined" ? Object : ManualCreditInput
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "credit", null);
_ts_decorate([
    (0, _common.Get)('year-end/preview'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.yearEndSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "yearEndPreview", null);
_ts_decorate([
    (0, _common.Post)('year-end'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.yearEndSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "yearEnd", null);
_ts_decorate([
    (0, _common.Get)('settings'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "settings", null);
_ts_decorate([
    (0, _common.Put)('settings'),
    (0, _decorators.RequirePerm)('leave.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.leaveSettingsSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof LeaveSettings === "undefined" ? Object : LeaveSettings
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "saveSettings", null);
_ts_decorate([
    (0, _common.Get)('holidays'),
    (0, _decorators.RequirePerm)('leave.self', 'leave.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(yearQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], LeaveController.prototype, "holidays", null);
LeaveController = _ts_decorate([
    (0, _common.Controller)('leave'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _leaverequestsservice.LeaveRequestsService === "undefined" ? Object : _leaverequestsservice.LeaveRequestsService,
        typeof _leaveadminservice.LeaveAdminService === "undefined" ? Object : _leaveadminservice.LeaveAdminService,
        typeof _orgservice.OrgService === "undefined" ? Object : _orgservice.OrgService
    ])
], LeaveController);

//# sourceMappingURL=leave.controller.js.map