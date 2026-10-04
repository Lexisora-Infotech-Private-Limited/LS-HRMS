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
    get AssetsController () {
        return AssetsController;
    },
    get WelcomeKitsController () {
        return WelcomeKitsController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _kitsservice = require("../kits/kits.service");
const _mastersservice = require("../masters/masters.service");
const _assetsservice = require("./assets.service");
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
let AssetsController = class AssetsController {
    assets;
    masters;
    constructor(assets, masters){
        this.assets = assets;
        this.masters = masters;
    }
    list(q) {
        return this.assets.list(q);
    }
    categories() {
        return this.masters.assetCategories();
    }
    createCategory(dto) {
        return this.masters.createAssetCategory(dto);
    }
    /** Employee acknowledges receipt of an assigned asset (own profile). */ acknowledge(id) {
        return this.assets.acknowledge(id);
    }
    detail(id) {
        return this.assets.detail(id);
    }
    create(dto) {
        return this.assets.create(dto);
    }
    update(id, dto) {
        return this.assets.update(id, dto);
    }
    assign(id, dto) {
        return this.assets.assign(id, dto.employeeId, dto.assignedOn);
    }
    returnAsset(id, dto) {
        return this.assets.returnAsset(id, dto.condition, dto.notes, dto.returnedOn);
    }
    inspect(id, dto) {
        return this.assets.inspect(id, dto.to);
    }
    repair(id, dto) {
        return this.assets.repair(id, dto.issue, dto.vendor, dto.expectedBack);
    }
    repairDone(id, dto) {
        return this.assets.repairComplete(id, dto.costPaise);
    }
    lost(id, dto) {
        return this.assets.lost(id, dto.note);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('assets.manage'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.assetListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('categories'),
    (0, _decorators.RequirePerm)('assets.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "categories", null);
_ts_decorate([
    (0, _common.Post)('categories'),
    (0, _decorators.RequirePerm)('assets.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.assetCategorySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "createCategory", null);
_ts_decorate([
    (0, _common.Post)('assignments/:id/acknowledge'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "acknowledge", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    (0, _decorators.RequirePerm)('assets.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('assets.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.assetSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof AssetInput === "undefined" ? Object : AssetInput
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "create", null);
_ts_decorate([
    (0, _common.Put)(':id'),
    (0, _decorators.RequirePerm)('assets.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.assetSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof AssetInput === "undefined" ? Object : AssetInput
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "update", null);
_ts_decorate([
    (0, _common.Post)(':id/assign'),
    (0, _decorators.RequirePerm)('assets.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.assignAssetSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "assign", null);
_ts_decorate([
    (0, _common.Post)(':id/return'),
    (0, _decorators.RequirePerm)('assets.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.returnAssetSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "returnAsset", null);
_ts_decorate([
    (0, _common.Post)(':id/inspect'),
    (0, _decorators.RequirePerm)('assets.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.inspectAssetSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "inspect", null);
_ts_decorate([
    (0, _common.Post)(':id/repair'),
    (0, _decorators.RequirePerm)('assets.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.repairAssetSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "repair", null);
_ts_decorate([
    (0, _common.Post)(':id/repair/complete'),
    (0, _decorators.RequirePerm)('assets.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.repairCompleteSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "repairDone", null);
_ts_decorate([
    (0, _common.Post)(':id/lost'),
    (0, _decorators.RequirePerm)('assets.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.lostAssetSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], AssetsController.prototype, "lost", null);
AssetsController = _ts_decorate([
    (0, _common.Controller)('assets'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _assetsservice.AssetsService === "undefined" ? Object : _assetsservice.AssetsService,
        typeof _mastersservice.MastersService === "undefined" ? Object : _mastersservice.MastersService
    ])
], AssetsController);
let WelcomeKitsController = class WelcomeKitsController {
    kits;
    constructor(kits){
        this.kits = kits;
    }
    list(status) {
        return this.kits.list(status || undefined);
    }
    items() {
        return this.kits.items();
    }
    createItem(dto) {
        return this.kits.createItem(dto);
    }
    updateItem(id, dto) {
        return this.kits.updateItem(id, dto);
    }
    issue(dto) {
        return this.kits.issue(dto.employeeId, dto.itemIds, dto.issuedOn, dto.force);
    }
    toggle(issueId, itemId, dto) {
        return this.kits.toggleLine(issueId, itemId, dto.issued, dto.size, dto.force);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('welcomekit.manage'),
    _ts_param(0, (0, _common.Query)('status')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], WelcomeKitsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('items'),
    (0, _decorators.RequirePerm)('welcomekit.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], WelcomeKitsController.prototype, "items", null);
_ts_decorate([
    (0, _common.Post)('items'),
    (0, _decorators.RequirePerm)('welcomekit.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.kitItemSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], WelcomeKitsController.prototype, "createItem", null);
_ts_decorate([
    (0, _common.Put)('items/:id'),
    (0, _decorators.RequirePerm)('welcomekit.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.kitItemSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], WelcomeKitsController.prototype, "updateItem", null);
_ts_decorate([
    (0, _common.Post)('issue'),
    (0, _decorators.RequirePerm)('welcomekit.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.issueKitSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], WelcomeKitsController.prototype, "issue", null);
_ts_decorate([
    (0, _common.Put)(':issueId/lines/:itemId'),
    (0, _decorators.RequirePerm)('welcomekit.manage'),
    _ts_param(0, (0, _common.Param)('issueId')),
    _ts_param(1, (0, _common.Param)('itemId')),
    _ts_param(2, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.kitLineSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], WelcomeKitsController.prototype, "toggle", null);
WelcomeKitsController = _ts_decorate([
    (0, _common.Controller)('welcome-kits'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _kitsservice.KitsService === "undefined" ? Object : _kitsservice.KitsService
    ])
], WelcomeKitsController);

//# sourceMappingURL=assets.controller.js.map