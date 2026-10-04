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
    get AccountsController () {
        return AccountsController;
    },
    get LedgerController () {
        return LedgerController;
    },
    get VouchersController () {
        return VouchersController;
    },
    get sendBytes () {
        return sendBytes;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../core/auth/decorators");
const _zodpipe = require("../../core/http/zod.pipe");
const _errors = require("../../core/http/errors");
const _ledgerservice = require("./ledger.service");
const _money = require("./lib/money");
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
function sendBytes(res, data, filename, mime, inline = false) {
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/["\r\n]/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
}
let LedgerController = class LedgerController {
    ledger;
    constructor(ledger){
        this.ledger = ledger;
    }
    kpis(q) {
        return this.ledger.kpis(q.month);
    }
    vouchers(q, ctx) {
        return this.ledger.list(q, ctx);
    }
    options(ctx) {
        return this.ledger.ledgerOptions(ctx);
    }
    trialBalance(q) {
        return this.ledger.trialBalance(q.from, q.to);
    }
    async export(q, ctx, res) {
        if (q.kind === 'trial' && !(0, _decorators.hasPerm)(ctx, 'ledger.manage')) throw (0, _errors.forbidden)();
        const f = await this.ledger.exportCsv(q.kind, q.from, q.to, ctx);
        sendBytes(res, `﻿${f.csv}`, f.filename, 'text/csv; charset=utf-8');
    }
    lock(dto) {
        return this.ledger.lockBooks(dto.upTo);
    }
    async settings() {
        const s = await this.ledger.financeSettings();
        return {
            booksLockedUpTo: s.booksLockedUpTo,
            defaultPaymentTermsDays: s.defaultPaymentTermsDays,
            bank: s.bank,
            signatory: s.signatory
        };
    }
};
_ts_decorate([
    (0, _common.Get)('kpis'),
    (0, _decorators.RequirePerm)('ledger.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.ledgerKpiQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], LedgerController.prototype, "kpis", null);
_ts_decorate([
    (0, _common.Get)('vouchers'),
    (0, _decorators.RequirePerm)('ledger.manage', 'ledger.hrvoucher'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.voucherListQuery))),
    _ts_param(1, (0, _decorators.Ctx)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof VoucherListQuery === "undefined" ? Object : VoucherListQuery,
        typeof RequestContext === "undefined" ? Object : RequestContext
    ]),
    _ts_metadata("design:returntype", void 0)
], LedgerController.prototype, "vouchers", null);
_ts_decorate([
    (0, _common.Get)('options'),
    (0, _decorators.RequirePerm)('ledger.manage', 'ledger.hrvoucher'),
    _ts_param(0, (0, _decorators.Ctx)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof RequestContext === "undefined" ? Object : RequestContext
    ]),
    _ts_metadata("design:returntype", void 0)
], LedgerController.prototype, "options", null);
_ts_decorate([
    (0, _common.Get)('trial-balance'),
    (0, _decorators.RequirePerm)('ledger.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.finDateRangeQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], LedgerController.prototype, "trialBalance", null);
_ts_decorate([
    (0, _common.Get)('export'),
    (0, _decorators.RequirePerm)('ledger.manage', 'ledger.hrvoucher'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.finExportQuery))),
    _ts_param(1, (0, _decorators.Ctx)()),
    _ts_param(2, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer,
        typeof RequestContext === "undefined" ? Object : RequestContext,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], LedgerController.prototype, "export", null);
_ts_decorate([
    (0, _common.Post)('lock'),
    (0, _decorators.RequirePerm)('ledger.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.lockBooksSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], LedgerController.prototype, "lock", null);
_ts_decorate([
    (0, _common.Get)('settings'),
    (0, _decorators.RequirePerm)('ledger.manage', 'invoices.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], LedgerController.prototype, "settings", null);
LedgerController = _ts_decorate([
    (0, _common.Controller)('ledger'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _ledgerservice.LedgerService === "undefined" ? Object : _ledgerservice.LedgerService
    ])
], LedgerController);
let VouchersController = class VouchersController {
    ledger;
    constructor(ledger){
        this.ledger = ledger;
    }
    create(dto, ctx) {
        return this.ledger.createManual(dto, ctx);
    }
    detail(id, ctx) {
        return this.ledger.detail(id, ctx);
    }
    async reverse(id, dto) {
        const v = await this.ledger.reverse(id, dto.reason);
        return {
            id: v.id,
            number: v.number
        };
    }
};
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('ledger.manage', 'ledger.hrvoucher'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.createVoucherSchema))),
    _ts_param(1, (0, _decorators.Ctx)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CreateVoucherInput === "undefined" ? Object : CreateVoucherInput,
        typeof RequestContext === "undefined" ? Object : RequestContext
    ]),
    _ts_metadata("design:returntype", void 0)
], VouchersController.prototype, "create", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    (0, _decorators.RequirePerm)('ledger.manage', 'ledger.hrvoucher'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _decorators.Ctx)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof RequestContext === "undefined" ? Object : RequestContext
    ]),
    _ts_metadata("design:returntype", void 0)
], VouchersController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)(':id/reverse'),
    (0, _decorators.RequirePerm)('ledger.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.reverseVoucherSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", Promise)
], VouchersController.prototype, "reverse", null);
VouchersController = _ts_decorate([
    (0, _common.Controller)('vouchers'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _ledgerservice.LedgerService === "undefined" ? Object : _ledgerservice.LedgerService
    ])
], VouchersController);
let AccountsController = class AccountsController {
    ledger;
    constructor(ledger){
        this.ledger = ledger;
    }
    list() {
        return this.ledger.accounts();
    }
    create(dto) {
        return this.ledger.createAccount(dto);
    }
    update(id, dto) {
        return this.ledger.updateAccount(id, dto);
    }
    statement(id, q) {
        if (q.from && q.to && (0, _money.dateOnly)(q.from) > (0, _money.dateOnly)(q.to)) return this.ledger.statement(id, q.to, q.from);
        return this.ledger.statement(id, q.from, q.to);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('ledger.manage', 'purchases.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], AccountsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('ledger.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finCreateAccountSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AccountsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Patch)(':id'),
    (0, _decorators.RequirePerm)('ledger.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.finUpdateAccountSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AccountsController.prototype, "update", null);
_ts_decorate([
    (0, _common.Get)(':id/statement'),
    (0, _decorators.RequirePerm)('ledger.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.finStatementQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AccountsController.prototype, "statement", null);
AccountsController = _ts_decorate([
    (0, _common.Controller)('accounts'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _ledgerservice.LedgerService === "undefined" ? Object : _ledgerservice.LedgerService
    ])
], AccountsController);

//# sourceMappingURL=ledger.controller.js.map