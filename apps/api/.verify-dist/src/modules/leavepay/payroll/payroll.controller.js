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
    get PayrollController () {
        return PayrollController;
    },
    get PayslipsController () {
        return PayslipsController;
    },
    get SalaryController () {
        return SalaryController;
    }
});
const _common = require("@nestjs/common");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _payrollservice = require("./payroll.service");
const _payslipservice = require("./payslip.service");
const _salaryservice = require("./salary.service");
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
const periodParam = _zod.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-09');
const refreshQuery = _zod.z.object({
    refresh: _zod.z.coerce.boolean().optional()
});
const recalcBody = _zod.z.object({
    itemIds: _zod.z.array(_zod.z.string()).max(500).optional()
});
const periodBody = _zod.z.object({
    period: periodParam
});
const adjQuery = _zod.z.object({
    period: periodParam.optional()
});
function sendFile(res, data, filename, mime, inline = false) {
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
}
let PayrollController = class PayrollController {
    payroll;
    constructor(payroll){
        this.payroll = payroll;
    }
    period(period, q) {
        return this.payroll.periodView(period, !!q.refresh);
    }
    create(body) {
        return this.payroll.createRun(body);
    }
    update(id, body) {
        return this.payroll.updateRun(id, body);
    }
    recalc(id, body) {
        return this.payroll.recalculate(id, body.itemIds);
    }
    finalize(id) {
        return this.payroll.finalize(id);
    }
    cancel(id, body) {
        return this.payroll.cancel(id, body.reason);
    }
    markPaid(id) {
        return this.payroll.markPaid(id);
    }
    excludePending(id) {
        return this.payroll.excludePending(id);
    }
    bankFile(id) {
        return this.payroll.generateBankFile(id);
    }
    async bankFileDownload(id, res) {
        const f = await this.payroll.bankFileDownload(id);
        sendFile(res, f.data, f.filename, 'text/csv; charset=utf-8');
    }
    hold(id, itemId, body) {
        return this.payroll.hold(id, itemId, body.reason);
    }
    release(id, itemId) {
        return this.payroll.release(id, itemId);
    }
    item(itemId) {
        return this.payroll.itemDetail(itemId);
    }
    remind(body) {
        return this.payroll.remindRms(body.period);
    }
    adjustments(q) {
        return this.payroll.adjustments(q.period);
    }
    addAdjustment(body) {
        return this.payroll.addAdjustment(body);
    }
    cancelAdjustment(id) {
        return this.payroll.cancelAdjustment(id);
    }
};
_ts_decorate([
    (0, _common.Get)('period/:period'),
    _ts_param(0, (0, _common.Param)('period', new _zodpipe.ZodPipe(periodParam))),
    _ts_param(1, (0, _common.Query)(new _zodpipe.ZodPipe(refreshQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "period", null);
_ts_decorate([
    (0, _common.Post)('runs'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.payrollRunSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof PayrollRunInput === "undefined" ? Object : PayrollRunInput
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "create", null);
_ts_decorate([
    (0, _common.Patch)('runs/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.payrollRunSchema.partial()))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Partial === "undefined" ? Object : Partial
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)('runs/:id/recalculate'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(recalcBody))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "recalc", null);
_ts_decorate([
    (0, _common.Post)('runs/:id/finalize'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "finalize", null);
_ts_decorate([
    (0, _common.Post)('runs/:id/cancel'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.payrollCancelSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "cancel", null);
_ts_decorate([
    (0, _common.Post)('runs/:id/mark-paid'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "markPaid", null);
_ts_decorate([
    (0, _common.Post)('runs/:id/exclude-pending'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "excludePending", null);
_ts_decorate([
    (0, _common.Post)('runs/:id/bank-file'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "bankFile", null);
_ts_decorate([
    (0, _common.Get)('runs/:id/bank-file'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], PayrollController.prototype, "bankFileDownload", null);
_ts_decorate([
    (0, _common.Post)('runs/:id/items/:itemId/hold'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('itemId')),
    _ts_param(2, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.payrollHoldSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "hold", null);
_ts_decorate([
    (0, _common.Post)('runs/:id/items/:itemId/release'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('itemId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "release", null);
_ts_decorate([
    (0, _common.Get)('items/:itemId'),
    _ts_param(0, (0, _common.Param)('itemId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "item", null);
_ts_decorate([
    (0, _common.Post)('remind-rms'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(periodBody))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "remind", null);
_ts_decorate([
    (0, _common.Get)('adjustments'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(adjQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "adjustments", null);
_ts_decorate([
    (0, _common.Post)('adjustments'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.adjustmentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof AdjustmentInput === "undefined" ? Object : AdjustmentInput
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "addAdjustment", null);
_ts_decorate([
    (0, _common.Delete)('adjustments/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PayrollController.prototype, "cancelAdjustment", null);
PayrollController = _ts_decorate([
    (0, _common.Controller)('payroll'),
    (0, _decorators.RequirePerm)('payroll.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _payrollservice.PayrollService === "undefined" ? Object : _payrollservice.PayrollService
    ])
], PayrollController);
let PayslipsController = class PayslipsController {
    payslips;
    constructor(payslips){
        this.payslips = payslips;
    }
    mine(q) {
        return this.payslips.myPayslips(q.fy);
    }
    forEmployee(id, q) {
        return this.payslips.forEmployee(id, q.fy, false);
    }
    detail(id) {
        return this.payslips.detail(id);
    }
    async pdf(id, res, inline) {
        const f = await this.payslips.pdfFor(id);
        sendFile(res, f.data, f.filename, 'application/pdf', inline === '1');
    }
};
_ts_decorate([
    (0, _common.Get)('me'),
    (0, _decorators.RequirePerm)('payslips.self'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.payslipListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], PayslipsController.prototype, "mine", null);
_ts_decorate([
    (0, _common.Get)('employee/:id'),
    (0, _decorators.RequirePerm)('payroll.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.payslipListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], PayslipsController.prototype, "forEmployee", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    (0, _decorators.RequirePerm)('payslips.self', 'payroll.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PayslipsController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Get)(':id/pdf'),
    (0, _decorators.RequirePerm)('payslips.self', 'payroll.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_param(2, (0, _common.Query)('inline')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], PayslipsController.prototype, "pdf", null);
PayslipsController = _ts_decorate([
    (0, _common.Controller)('payslips'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _payslipservice.PayslipService === "undefined" ? Object : _payslipservice.PayslipService
    ])
], PayslipsController);
let SalaryController = class SalaryController {
    salary;
    constructor(salary){
        this.salary = salary;
    }
    view(id) {
        return this.salary.view(id);
    }
    list() {
        return this.salary.list();
    }
    preview(body) {
        return this.salary.preview(body);
    }
    revise(id, body) {
        return this.salary.revise(id, body);
    }
    profile(id, body) {
        return this.salary.updateProfile(id, body);
    }
};
_ts_decorate([
    (0, _common.Get)('employee/:id'),
    (0, _decorators.RequirePerm)('payslips.self', 'employees.compensation', 'payroll.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], SalaryController.prototype, "view", null);
_ts_decorate([
    (0, _common.Get)('employees'),
    (0, _decorators.RequirePerm)('payroll.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], SalaryController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)('preview'),
    (0, _decorators.RequirePerm)('payroll.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.salaryPreviewSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof SalaryPreviewInput === "undefined" ? Object : SalaryPreviewInput
    ]),
    _ts_metadata("design:returntype", void 0)
], SalaryController.prototype, "preview", null);
_ts_decorate([
    (0, _common.Post)('employee/:id/revisions'),
    (0, _decorators.RequirePerm)('payroll.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.salaryRevisionSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof SalaryRevisionInput === "undefined" ? Object : SalaryRevisionInput
    ]),
    _ts_metadata("design:returntype", void 0)
], SalaryController.prototype, "revise", null);
_ts_decorate([
    (0, _common.Patch)('employee/:id/profile'),
    (0, _decorators.RequirePerm)('payroll.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.payrollProfileSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof PayrollProfileInput === "undefined" ? Object : PayrollProfileInput
    ]),
    _ts_metadata("design:returntype", void 0)
], SalaryController.prototype, "profile", null);
SalaryController = _ts_decorate([
    (0, _common.Controller)('salary'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _salaryservice.SalaryService === "undefined" ? Object : _salaryservice.SalaryService
    ])
], SalaryController);

//# sourceMappingURL=payroll.controller.js.map