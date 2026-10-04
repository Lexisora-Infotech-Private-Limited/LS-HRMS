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
    get DocumentsController () {
        return DocumentsController;
    },
    get OnboardingController () {
        return OnboardingController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _zodpipe = require("../../../core/http/zod.pipe");
const _esignservice = require("../documents/esign.service");
const _vaultservice = require("../documents/vault.service");
const _onboardingservice = require("./onboarding.service");
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
const pdf = (res, name, data, inline = true)=>{
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(name)}"`);
    res.send(data);
};
let OnboardingController = class OnboardingController {
    onboarding;
    vault;
    constructor(onboarding, vault){
        this.onboarding = onboarding;
        this.vault = vault;
    }
    mine() {
        return this.onboarding.mine();
    }
    sign(key, dto, ua) {
        if (key !== 'offer' && key !== 'nda') throw (0, _errors.notFound)('Step');
        return this.onboarding.sign(key, dto, ua);
    }
    decline(dto) {
        return this.onboarding.declineOffer(dto.reason);
    }
    docs(dto) {
        return this.onboarding.submitDocs(dto);
    }
    bank(dto) {
        return this.onboarding.submitBank(dto);
    }
    finish(dto) {
        return this.onboarding.finish(dto);
    }
    // ── HR ──
    list(status) {
        return this.onboarding.list(status || undefined);
    }
    queue(employeeId) {
        return this.vault.queue(employeeId || undefined);
    }
    templates() {
        return this.onboarding.templates();
    }
    saveTemplates(dto) {
        return this.onboarding.saveTemplates(dto);
    }
    detail(id) {
        return this.onboarding.detail(id);
    }
    reopen(id, dto) {
        return this.onboarding.reopen(id, dto.key, dto.reason);
    }
    override(id, dto) {
        return this.onboarding.override(id, dto.reason);
    }
    verifyBank(id, dto) {
        return this.onboarding.verifyBank(id, dto.decision, dto.reason);
    }
};
_ts_decorate([
    (0, _common.Get)('me'),
    (0, _decorators.RequirePerm)('onboarding.self', 'onboarding.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "mine", null);
_ts_decorate([
    (0, _common.Post)('me/sign/:key'),
    (0, _decorators.RequirePerm)('onboarding.self'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('key')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.esignSchema))),
    _ts_param(2, (0, _common.Headers)('user-agent')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof EsignInput === "undefined" ? Object : EsignInput,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "sign", null);
_ts_decorate([
    (0, _common.Post)('me/decline'),
    (0, _decorators.RequirePerm)('onboarding.self'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.peopleReasonSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "decline", null);
_ts_decorate([
    (0, _common.Post)('me/docs'),
    (0, _decorators.RequirePerm)('onboarding.self'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.docsStepSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof DocsStepInput === "undefined" ? Object : DocsStepInput
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "docs", null);
_ts_decorate([
    (0, _common.Post)('me/bank'),
    (0, _decorators.RequirePerm)('onboarding.self'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.bankStepSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof BankStepInput === "undefined" ? Object : BankStepInput
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "bank", null);
_ts_decorate([
    (0, _common.Post)('me/finish'),
    (0, _decorators.RequirePerm)('onboarding.self'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.kitStepSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof KitStepInput === "undefined" ? Object : KitStepInput
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "finish", null);
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('onboarding.manage'),
    _ts_param(0, (0, _common.Query)('status')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('verification'),
    (0, _decorators.RequirePerm)('onboarding.manage'),
    _ts_param(0, (0, _common.Query)('employeeId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "queue", null);
_ts_decorate([
    (0, _common.Get)('templates'),
    (0, _decorators.RequirePerm)('onboarding.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "templates", null);
_ts_decorate([
    (0, _common.Put)('templates'),
    (0, _decorators.RequirePerm)('onboarding.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.onboardingTemplatesSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof OnboardingTemplates === "undefined" ? Object : OnboardingTemplates
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "saveTemplates", null);
_ts_decorate([
    (0, _common.Get)(':employeeId'),
    (0, _decorators.RequirePerm)('onboarding.manage'),
    _ts_param(0, (0, _common.Param)('employeeId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "detail", null);
_ts_decorate([
    (0, _common.Post)(':employeeId/reopen'),
    (0, _decorators.RequirePerm)('onboarding.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('employeeId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.reopenStepSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "reopen", null);
_ts_decorate([
    (0, _common.Post)(':employeeId/override'),
    (0, _decorators.RequirePerm)('onboarding.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('employeeId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.peopleReasonSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "override", null);
_ts_decorate([
    (0, _common.Post)(':employeeId/bank/verify'),
    (0, _decorators.RequirePerm)('onboarding.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('employeeId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.verifyBankSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], OnboardingController.prototype, "verifyBank", null);
OnboardingController = _ts_decorate([
    (0, _common.Controller)('onboarding'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _onboardingservice.OnboardingService === "undefined" ? Object : _onboardingservice.OnboardingService,
        typeof _vaultservice.VaultService === "undefined" ? Object : _vaultservice.VaultService
    ])
], OnboardingController);
let DocumentsController = class DocumentsController {
    vault;
    onboarding;
    esign;
    constructor(vault, onboarding, esign){
        this.vault = vault;
        this.onboarding = onboarding;
        this.esign = esign;
    }
    me() {
        const me = (0, _requestcontext.requireContext)().employeeId;
        if (!me) throw (0, _errors.notFound)('Employee');
        return me;
    }
    mine(category) {
        return this.vault.listFor(this.me(), category || undefined);
    }
    upload(dto) {
        return this.vault.upload(this.me(), dto);
    }
    /** HR upload onto someone's profile (or self). */ uploadFor(employeeId, dto) {
        return this.vault.upload(employeeId, dto);
    }
    versions(id) {
        return this.vault.versions(id);
    }
    async file(id, res) {
        const f = await this.vault.download(id);
        res.setHeader('Content-Type', f.mime);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.filename)}"`);
        res.send(f.data);
    }
    async verify(id, dto) {
        const r = await this.vault.verify(id, dto.decision, dto.reason);
        const doc = await this.vault.versions(id);
        await this.onboarding.afterDocDecision(r.employeeId, dto.decision, doc[0]?.title, dto.reason);
        return r;
    }
    remove(id) {
        return this.vault.remove(id);
    }
    // ── E-sign envelopes ──
    envelope(id) {
        return this.esign.dto(id);
    }
    async envelopePdf(id, res) {
        const d = await this.esign.document(id);
        pdf(res, d.filename, d.pdf);
    }
    verifyHash(sha) {
        return this.esign.verifyHash(sha);
    }
};
_ts_decorate([
    (0, _common.Get)('vault'),
    (0, _decorators.RequirePerm)('vault.self'),
    _ts_param(0, (0, _common.Query)('category')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], DocumentsController.prototype, "mine", null);
_ts_decorate([
    (0, _common.Post)('vault'),
    (0, _decorators.RequirePerm)('vault.self'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.vaultUploadSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof VaultUploadInput === "undefined" ? Object : VaultUploadInput
    ]),
    _ts_metadata("design:returntype", void 0)
], DocumentsController.prototype, "upload", null);
_ts_decorate([
    (0, _common.Post)('documents/employee/:employeeId'),
    (0, _decorators.RequirePerm)('vault.self', 'employees.manage'),
    _ts_param(0, (0, _common.Param)('employeeId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.vaultUploadSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof VaultUploadInput === "undefined" ? Object : VaultUploadInput
    ]),
    _ts_metadata("design:returntype", void 0)
], DocumentsController.prototype, "uploadFor", null);
_ts_decorate([
    (0, _common.Get)('documents/:id/versions'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], DocumentsController.prototype, "versions", null);
_ts_decorate([
    (0, _common.Get)('documents/:id/file'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], DocumentsController.prototype, "file", null);
_ts_decorate([
    (0, _common.Post)('documents/:id/verify'),
    (0, _decorators.RequirePerm)('onboarding.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.vaultVerifySchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", Promise)
], DocumentsController.prototype, "verify", null);
_ts_decorate([
    (0, _common.Delete)('documents/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], DocumentsController.prototype, "remove", null);
_ts_decorate([
    (0, _common.Get)('esign/:id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], DocumentsController.prototype, "envelope", null);
_ts_decorate([
    (0, _common.Get)('esign/:id/pdf'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], DocumentsController.prototype, "envelopePdf", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Get)('esign/verify/:sha256'),
    _ts_param(0, (0, _common.Param)('sha256')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], DocumentsController.prototype, "verifyHash", null);
DocumentsController = _ts_decorate([
    (0, _common.Controller)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _vaultservice.VaultService === "undefined" ? Object : _vaultservice.VaultService,
        typeof _onboardingservice.OnboardingService === "undefined" ? Object : _onboardingservice.OnboardingService,
        typeof _esignservice.EsignService === "undefined" ? Object : _esignservice.EsignService
    ])
], DocumentsController);

//# sourceMappingURL=onboarding.controller.js.map