"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "FinanceModule", {
    enumerable: true,
    get: function() {
        return FinanceModule;
    }
});
const _common = require("@nestjs/common");
const _ledgerservice = require("./ledger.service");
const _invoiceservice = require("./invoice.service");
const _purchaseservice = require("./purchase.service");
const _filingservice = require("./filing.service");
const _complianceservice = require("./compliance.service");
const _spine = require("./spine");
const _financeregistry = require("./finance.registry");
const _ledgercontroller = require("./ledger.controller");
const _invoicecontroller = require("./invoice.controller");
const _purchasecontroller = require("./purchase.controller");
const _filingcontroller = require("./filing.controller");
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
let FinanceModule = class FinanceModule {
};
FinanceModule = _ts_decorate([
    (0, _common.Module)({
        imports: [],
        controllers: [
            _ledgercontroller.LedgerController,
            _ledgercontroller.VouchersController,
            _ledgercontroller.AccountsController,
            _invoicecontroller.InvoicesController,
            _purchasecontroller.PurchasesController,
            _purchasecontroller.VendorsController,
            _filingcontroller.FilingController
        ],
        providers: [
            _spine.SpineReader,
            _ledgerservice.LedgerService,
            _filingservice.FilingService,
            _invoiceservice.InvoiceService,
            _purchaseservice.PurchaseService,
            _complianceservice.ComplianceService,
            _financeregistry.FinanceRegistry
        ],
        exports: [
            _ledgerservice.LedgerService
        ]
    })
], FinanceModule);

//# sourceMappingURL=finance.module.js.map