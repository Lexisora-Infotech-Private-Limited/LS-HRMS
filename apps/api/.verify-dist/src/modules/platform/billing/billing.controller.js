"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "BillingController", {
    enumerable: true,
    get: function() {
        return BillingController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _billingservice = require("./billing.service");
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
let BillingController = class BillingController {
    billing;
    constructor(billing){
        this.billing = billing;
    }
    overview() {
        return this.billing.overview();
    }
    quote(dto) {
        return this.billing.quote(dto);
    }
    /** Upgrade / renew / change cycle → creates a pending order on the gateway. */ checkout(dto) {
        return this.billing.checkout(dto);
    }
    checkoutDetail(orderId) {
        return this.billing.checkoutDetail(orderId);
    }
    /** Mock gateway checkout page → "Pay" / "Fail" (posts a signed event to ourselves). */ confirm(orderId, dto) {
        return this.billing.confirmMock(orderId, dto.outcome);
    }
    seatQuote(dto) {
        return this.billing.seatQuote(dto.quantity);
    }
    seats(dto) {
        return this.billing.changeSeats(dto.quantity);
    }
    downgrade() {
        return this.billing.downgrade();
    }
    cancelDowngrade() {
        return this.billing.cancelDowngrade();
    }
    promo(dto) {
        return this.billing.applyPromo(dto.code);
    }
    contactSales(dto) {
        return this.billing.contactSales(dto);
    }
    profile(dto) {
        return this.billing.updateProfile(dto);
    }
    invoices() {
        return this.billing.invoices();
    }
    async invoicePdf(id, res) {
        const pdf = await this.billing.invoicePdf(id);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
        res.send(pdf.data);
    }
    /** "Pay now" on an issued / overdue invoice. */ pay(id) {
        return this.billing.payInvoice(id);
    }
    /** Payment gateway webhooks (Razorpay / mock): signature-verified and idempotent. */ webhook(gateway, headers, body) {
        return this.billing.handleWebhook(gateway, headers, body);
    }
};
_ts_decorate([
    (0, _common.Get)('overview'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "overview", null);
_ts_decorate([
    (0, _common.Post)('quote'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.quoteSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof QuoteInput === "undefined" ? Object : QuoteInput
    ]),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "quote", null);
_ts_decorate([
    (0, _common.Post)('checkout'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.checkoutSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CheckoutInput === "undefined" ? Object : CheckoutInput
    ]),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "checkout", null);
_ts_decorate([
    (0, _common.Get)('checkout/:orderId'),
    _ts_param(0, (0, _common.Param)('orderId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "checkoutDetail", null);
_ts_decorate([
    (0, _common.Post)('checkout/:orderId/confirm'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('orderId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.confirmPaymentSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof ConfirmPaymentInput === "undefined" ? Object : ConfirmPaymentInput
    ]),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "confirm", null);
_ts_decorate([
    (0, _common.Post)('seats/quote'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.seatsSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof SeatsInput === "undefined" ? Object : SeatsInput
    ]),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "seatQuote", null);
_ts_decorate([
    (0, _common.Post)('seats'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.seatsSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof SeatsInput === "undefined" ? Object : SeatsInput
    ]),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "seats", null);
_ts_decorate([
    (0, _common.Post)('downgrade'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "downgrade", null);
_ts_decorate([
    (0, _common.Post)('downgrade/cancel'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "cancelDowngrade", null);
_ts_decorate([
    (0, _common.Post)('promo'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.promoSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof PromoInput === "undefined" ? Object : PromoInput
    ]),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "promo", null);
_ts_decorate([
    (0, _common.Post)('contact-sales'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.contactSalesSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof ContactSalesInput === "undefined" ? Object : ContactSalesInput
    ]),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "contactSales", null);
_ts_decorate([
    (0, _common.Patch)('profile'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.billingProfileSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof BillingProfileInput === "undefined" ? Object : BillingProfileInput
    ]),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "profile", null);
_ts_decorate([
    (0, _common.Get)('invoices'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "invoices", null);
_ts_decorate([
    (0, _common.Get)('invoices/:id/pdf'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], BillingController.prototype, "invoicePdf", null);
_ts_decorate([
    (0, _common.Post)('invoices/:id/pay'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "pay", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('webhooks/:gateway'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('gateway')),
    _ts_param(1, (0, _common.Headers)()),
    _ts_param(2, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Record === "undefined" ? Object : Record,
        Object
    ]),
    _ts_metadata("design:returntype", void 0)
], BillingController.prototype, "webhook", null);
BillingController = _ts_decorate([
    (0, _common.Controller)('billing'),
    (0, _decorators.RequirePerm)('billing.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _billingservice.BillingService === "undefined" ? Object : _billingservice.BillingService
    ])
], BillingController);

//# sourceMappingURL=billing.controller.js.map