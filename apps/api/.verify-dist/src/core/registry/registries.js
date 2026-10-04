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
    get ApprovalCountsService () {
        return ApprovalCountsService;
    },
    get RegistriesController () {
        return RegistriesController;
    },
    get SearchService () {
        return SearchService;
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
let ApprovalCountsService = class ApprovalCountsService {
    providers = [];
    register(p) {
        this.providers.push(p);
    }
    async counts() {
        const ctx = (0, _requestcontext.requireContext)();
        const out = await Promise.all(this.providers.map((p)=>p(ctx).catch(()=>null)));
        return out.filter((x)=>!!x);
    }
};
ApprovalCountsService = _ts_decorate([
    (0, _common.Injectable)()
], ApprovalCountsService);
let SearchService = class SearchService {
    providers = [];
    register(type, fn) {
        this.providers.push({
            type,
            fn
        });
    }
    async search(q) {
        const ctx = (0, _requestcontext.requireContext)();
        const term = q.trim();
        if (term.length < 2) return [];
        const res = await Promise.all(this.providers.map(async (p)=>({
                type: p.type,
                hits: (await p.fn(term, ctx).catch(()=>[])).slice(0, 6)
            })));
        return res.filter((r)=>r.hits.length);
    }
};
SearchService = _ts_decorate([
    (0, _common.Injectable)()
], SearchService);
let RegistriesController = class RegistriesController {
    approvals;
    searchSvc;
    constructor(approvals, searchSvc){
        this.approvals = approvals;
        this.searchSvc = searchSvc;
    }
    counts() {
        return this.approvals.counts();
    }
    search(q = '') {
        return this.searchSvc.search(q);
    }
};
_ts_decorate([
    (0, _common.Get)('approvals/counts'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], RegistriesController.prototype, "counts", null);
_ts_decorate([
    (0, _common.Get)('search'),
    _ts_param(0, (0, _common.Query)('q')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        void 0
    ]),
    _ts_metadata("design:returntype", void 0)
], RegistriesController.prototype, "search", null);
RegistriesController = _ts_decorate([
    (0, _common.Controller)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof ApprovalCountsService === "undefined" ? Object : ApprovalCountsService,
        typeof SearchService === "undefined" ? Object : SearchService
    ])
], RegistriesController);

//# sourceMappingURL=registries.js.map