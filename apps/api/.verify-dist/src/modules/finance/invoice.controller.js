"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "InvoicesController", {
    enumerable: true,
    get: function() {
        return InvoicesController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../core/auth/decorators");
const _zodpipe = require("../../core/http/zod.pipe");
const _invoiceservice = require("./invoice.service");
const _ledgercontroller = require("./ledger.controller");
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
let InvoicesController = class InvoicesController {
    invoices;
    constructor(invoices){
        this.invoices = invoices;
    }
    list(q) {
        return this.invoices.list(q);
    }
    kpis(q) {
        return this.invoices.kpis(q.month);
    }
    options() {
        return this.invoices.options();
    }
    /** Approved, unbilled billable hours for client + project + month (form auto-fill). */ preview(q) {
        return this.invoices.preview(q);
    }
    create(dto) {
        return this.invoices.create(dto);
    }
    detail(id) {
        return this.invoices.detail(id);
    }
    update(id, dto) {
        return this.invoices.update(id, dto);
    }
    remove(id) {
        return this.invoices.remove(id);
    }
    issue(id) {
        return this.invoices.issue(id);
    }
    email(id, dto) {
        return this.invoices.email(id, dto);
    }
    pay(id, dto) {
        return this.invoices.recordPayment(id, dto);
    }
    reversePayment(id, paymentId) {
        return this.invoices.reversePayment(id, paymentId);
    }
    /** Cancel an issued invoice with a full credit note (hours become billable again). */ cancel(id, dto) {
        return this.invoices.cancel(id, dto.reason);
    }
    async pdf(id, res, inline) {
        const f = await this.invoices.pdfFile(id);
        (0, _ledgercontroller.sendBytes)(res, f.data, f.filename, 'application/pdf', inline === '1');
    }
    async creditNotePdf(id, cnId, res, inline) {
        const f = await this.invoices.creditNotePdf(id, cnId);
        (0, _ledgercontroller.sendBytes)(res, f.data, f.filename, 'application/pdf', inline === '1');
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.finInvoiceListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('kpis'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.ledgerKpiQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "kpis", null);
_ts_decorate([
    (0, _common.Get)('options'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "options", null);
_ts_decorate([
    (0, _common.Get)('preview'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.finInvoicePreviewQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "preview", null);
_ts_decorate([
    (0, _common.Post)(),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finCreateInvoiceSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof FinCreateInvoiceInput === "undefined" ? Object : FinCreateInvoiceInput
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Put)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finUpdateInvoiceSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "update", null);
_ts_decorate([
    (0, _common.Delete)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "remove", null);
_ts_decorate([
    (0, _common.Post)(':id/issue'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "issue", null);
_ts_decorate([
    (0, _common.Post)(':id/email'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finEmailInvoiceSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "email", null);
_ts_decorate([
    (0, _common.Post)(':id/payments'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finRecordPaymentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "pay", null);
_ts_decorate([
    (0, _common.Delete)(':id/payments/:paymentId'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('paymentId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "reversePayment", null);
_ts_decorate([
    (0, _common.Post)(':id/cancel'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finCancelInvoiceSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], InvoicesController.prototype, "cancel", null);
_ts_decorate([
    (0, _common.Get)(':id/pdf'),
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
], InvoicesController.prototype, "pdf", null);
_ts_decorate([
    (0, _common.Get)(':id/credit-notes/:cnId/pdf'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('cnId')),
    _ts_param(2, (0, _common.Res)()),
    _ts_param(3, (0, _common.Query)('inline')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof Response === "undefined" ? Object : Response,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], InvoicesController.prototype, "creditNotePdf", null);
InvoicesController = _ts_decorate([
    (0, _common.Controller)('invoices'),
    (0, _decorators.RequirePerm)('invoices.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _invoiceservice.InvoiceService === "undefined" ? Object : _invoiceservice.InvoiceService
    ])
], InvoicesController);

//# sourceMappingURL=invoice.controller.js.map