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
    get PurchasesController () {
        return PurchasesController;
    },
    get VendorsController () {
        return VendorsController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../core/auth/decorators");
const _zodpipe = require("../../core/http/zod.pipe");
const _purchaseservice = require("./purchase.service");
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
let PurchasesController = class PurchasesController {
    purchases;
    constructor(purchases){
        this.purchases = purchases;
    }
    list(q) {
        return this.purchases.list(q);
    }
    kpis(q) {
        return this.purchases.kpis(q.month);
    }
    options() {
        return this.purchases.options();
    }
    /** Bill OCR: read the uploaded bill's text layer; estimate GST when nothing is found. */ extract(dto) {
        return this.purchases.extract(dto);
    }
    create(dto) {
        return this.purchases.create(dto);
    }
    gstr3b(q) {
        return this.purchases.gstr3b(q.month);
    }
    async gstr3bCsv(q, res) {
        const f = await this.purchases.gstr3bCsv(q.month);
        (0, _ledgercontroller.sendBytes)(res, `﻿${f.csv}`, f.filename, 'text/csv; charset=utf-8');
    }
    /** Save the GSTR-3B working PDF into Filing cabinet › GST returns. */ fileGstr3b(dto) {
        return this.purchases.fileGstr3b(dto.month);
    }
    categories() {
        return this.purchases.categories();
    }
    createCategory(dto) {
        return this.purchases.createCategory(dto);
    }
    updateCategory(id, dto) {
        return this.purchases.updateCategory(id, dto);
    }
    detail(id) {
        return this.purchases.detail(id);
    }
    cancel(id, dto) {
        return this.purchases.cancel(id, dto.reason);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('purchases.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.purchaseListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('kpis'),
    (0, _decorators.RequirePerm)('purchases.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.purchaseKpiQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "kpis", null);
_ts_decorate([
    (0, _common.Get)('options'),
    (0, _decorators.RequirePerm)('purchases.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "options", null);
_ts_decorate([
    (0, _common.Post)('extract'),
    (0, _decorators.RequirePerm)('purchases.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.extractBillSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "extract", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('purchases.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.createPurchaseSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CreatePurchaseInput === "undefined" ? Object : CreatePurchaseInput
    ]),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)('gstr3b'),
    (0, _decorators.RequirePerm)('purchases.manage', 'filing.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.gstr3bQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "gstr3b", null);
_ts_decorate([
    (0, _common.Get)('gstr3b/csv'),
    (0, _decorators.RequirePerm)('purchases.manage', 'filing.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.gstr3bQuery))),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], PurchasesController.prototype, "gstr3bCsv", null);
_ts_decorate([
    (0, _common.Post)('gstr3b/file'),
    (0, _decorators.RequirePerm)('purchases.manage', 'filing.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.gstr3bQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "fileGstr3b", null);
_ts_decorate([
    (0, _common.Get)('categories'),
    (0, _decorators.RequirePerm)('purchases.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "categories", null);
_ts_decorate([
    (0, _common.Post)('categories'),
    (0, _decorators.RequirePerm)('purchases.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finCreateCategorySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "createCategory", null);
_ts_decorate([
    (0, _common.Patch)('categories/:id'),
    (0, _decorators.RequirePerm)('purchases.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finUpdateCategorySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "updateCategory", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    (0, _decorators.RequirePerm)('purchases.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)(':id/cancel'),
    (0, _decorators.RequirePerm)('purchases.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.cancelPurchaseSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], PurchasesController.prototype, "cancel", null);
PurchasesController = _ts_decorate([
    (0, _common.Controller)('purchases'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _purchaseservice.PurchaseService === "undefined" ? Object : _purchaseservice.PurchaseService
    ])
], PurchasesController);
let VendorsController = class VendorsController {
    purchases;
    constructor(purchases){
        this.purchases = purchases;
    }
    list() {
        return this.purchases.vendors();
    }
    create(dto) {
        return this.purchases.createVendor(dto);
    }
    update(id, dto) {
        return this.purchases.updateVendor(id, dto);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], VendorsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)(),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finCreateVendorSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], VendorsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finCreateVendorSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], VendorsController.prototype, "update", null);
VendorsController = _ts_decorate([
    (0, _common.Controller)('vendors'),
    (0, _decorators.RequirePerm)('purchases.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _purchaseservice.PurchaseService === "undefined" ? Object : _purchaseservice.PurchaseService
    ])
], VendorsController);

//# sourceMappingURL=purchase.controller.js.map