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
    get IdCardsController () {
        return IdCardsController;
    },
    get VcardController () {
        return VcardController;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _zodpipe = require("../../../core/http/zod.pipe");
const _vcardservice = require("../vcard/vcard.service");
const _idcardsservice = require("./idcards.service");
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
const send = (res, mime, name, data, inline = true)=>{
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(name)}"`);
    res.send(data);
};
let IdCardsController = class IdCardsController {
    cards;
    constructor(cards){
        this.cards = cards;
    }
    async verify(token, res) {
        const r = await this.cards.verifyHtml(token);
        res.status(r.status).setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(r.html);
    }
    mine() {
        return this.cards.myCard();
    }
    settings() {
        return this.cards.settings();
    }
    saveSettings(dto) {
        return this.cards.saveSettings(dto);
    }
    templates() {
        return this.cards.templates();
    }
    createTemplate(dto) {
        return this.cards.createTemplate(dto);
    }
    updateTemplate(id, dto) {
        return this.cards.updateTemplate(id, dto);
    }
    setDefault(id) {
        return this.cards.setDefault(id);
    }
    async preview(id, side, employeeId, res) {
        const png = await this.cards.previewPng(id, employeeId, side === 'back' ? 'back' : 'front');
        res.setHeader('Cache-Control', 'no-store');
        send(res, 'image/png', `preview-${side}.png`, png);
    }
    previewData(employeeId) {
        return this.cards.previewData(employeeId || null);
    }
    list(status, q) {
        return this.cards.cards(status || undefined, q || undefined);
    }
    generatable() {
        return this.cards.generatable();
    }
    generate(dto) {
        return this.cards.generate(dto);
    }
    print(dto) {
        return this.cards.sendToPrint(dto);
    }
    batches() {
        return this.cards.batches();
    }
    batchStatus(id, status) {
        return this.cards.setBatchStatus(id, status === 'delivered' ? 'DELIVERED' : 'ACKNOWLEDGED');
    }
    async pdf(id, res) {
        const r = await this.cards.cardPdf(id);
        send(res, 'application/pdf', r.filename, r.pdf);
    }
    async png(id, side, res) {
        send(res, 'image/png', `id-card-${side}.png`, await this.cards.cardPng(id, side === 'back' ? 'back' : 'front'));
    }
    issue(id) {
        return this.cards.markIssued(id);
    }
    revoke(id, dto) {
        return this.cards.revoke(id, dto.reason);
    }
    reissue(employeeId, dto) {
        return this.cards.reissue(employeeId, dto.reason);
    }
};
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Get)('verify/:token'),
    _ts_param(0, (0, _common.Param)('token')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], IdCardsController.prototype, "verify", null);
_ts_decorate([
    (0, _common.Get)('mine'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "mine", null);
_ts_decorate([
    (0, _common.Get)('settings'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "settings", null);
_ts_decorate([
    (0, _common.Put)('settings'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.idCardSettingsSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof IdCardSettings === "undefined" ? Object : IdCardSettings
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "saveSettings", null);
_ts_decorate([
    (0, _common.Get)('templates'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "templates", null);
_ts_decorate([
    (0, _common.Post)('templates'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.idCardTemplateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof IdCardTemplateInput === "undefined" ? Object : IdCardTemplateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "createTemplate", null);
_ts_decorate([
    (0, _common.Put)('templates/:id'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.idCardTemplateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof IdCardTemplateInput === "undefined" ? Object : IdCardTemplateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "updateTemplate", null);
_ts_decorate([
    (0, _common.Post)('templates/:id/default'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "setDefault", null);
_ts_decorate([
    (0, _common.Get)('templates/:id/preview/:side'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('side')),
    _ts_param(2, (0, _common.Query)('employeeId')),
    _ts_param(3, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], IdCardsController.prototype, "preview", null);
_ts_decorate([
    (0, _common.Get)('preview-data'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    _ts_param(0, (0, _common.Query)('employeeId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "previewData", null);
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('idcard.manage'),
    _ts_param(0, (0, _common.Query)('status')),
    _ts_param(1, (0, _common.Query)('q')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('generatable'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "generatable", null);
_ts_decorate([
    (0, _common.Post)('generate'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.generateCardsSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "generate", null);
_ts_decorate([
    (0, _common.Post)('print'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.printBatchSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "print", null);
_ts_decorate([
    (0, _common.Get)('batches'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "batches", null);
_ts_decorate([
    (0, _common.Post)('batches/:id/:status'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('status')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "batchStatus", null);
_ts_decorate([
    (0, _common.Get)(':id/pdf'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], IdCardsController.prototype, "pdf", null);
_ts_decorate([
    (0, _common.Get)(':id/png/:side'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Param)('side')),
    _ts_param(2, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], IdCardsController.prototype, "png", null);
_ts_decorate([
    (0, _common.Post)(':id/issue'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "issue", null);
_ts_decorate([
    (0, _common.Post)(':id/revoke'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.peopleReasonSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "revoke", null);
_ts_decorate([
    (0, _common.Post)('employee/:employeeId/reissue'),
    (0, _decorators.RequirePerm)('idcard.manage'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Param)('employeeId')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.peopleReasonSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], IdCardsController.prototype, "reissue", null);
IdCardsController = _ts_decorate([
    (0, _common.Controller)('id-cards'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _idcardsservice.IdCardsService === "undefined" ? Object : _idcardsservice.IdCardsService
    ])
], IdCardsController);
let VcardController = class VcardController {
    vcard;
    constructor(vcard){
        this.vcard = vcard;
    }
    async publicCard(tenant, slug, res) {
        const r = await this.vcard.publicCard(tenant, slug);
        res.status(r.status);
        if (r.vcf) return send(res, 'text/vcard; charset=utf-8', r.filename ?? 'contact.vcf', r.vcf, false);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(r.html ?? '');
    }
    card() {
        return this.vcard.card();
    }
    settings(dto) {
        return this.vcard.updateSettings({
            ...dto,
            linkedinUrl: dto.linkedinUrl || null
        });
    }
    async png(res) {
        send(res, 'image/png', 'visiting-card.png', await this.vcard.png(), false);
    }
    async pdf(res) {
        send(res, 'application/pdf', 'visiting-card.pdf', await this.vcard.pdfFile(), false);
    }
    async vcf(res) {
        const r = await this.vcard.vcf();
        send(res, 'text/vcard; charset=utf-8', r.filename, r.vcf, false);
    }
    email(dto) {
        return this.vcard.shareEmail(dto.to, dto.message);
    }
    whatsapp(dto) {
        return this.vcard.shareWhatsapp(dto.phone || null);
    }
};
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Get)('c/:tenant/:slug'),
    _ts_param(0, (0, _common.Param)('tenant')),
    _ts_param(1, (0, _common.Param)('slug')),
    _ts_param(2, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], VcardController.prototype, "publicCard", null);
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('vcard.self'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], VcardController.prototype, "card", null);
_ts_decorate([
    (0, _common.Put)(),
    (0, _decorators.RequirePerm)('vcard.self'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.vcardSettingsSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], VcardController.prototype, "settings", null);
_ts_decorate([
    (0, _common.Get)('png'),
    (0, _decorators.RequirePerm)('vcard.self'),
    _ts_param(0, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], VcardController.prototype, "png", null);
_ts_decorate([
    (0, _common.Get)('pdf'),
    (0, _decorators.RequirePerm)('vcard.self'),
    _ts_param(0, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], VcardController.prototype, "pdf", null);
_ts_decorate([
    (0, _common.Get)('vcf'),
    (0, _decorators.RequirePerm)('vcard.self'),
    _ts_param(0, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], VcardController.prototype, "vcf", null);
_ts_decorate([
    (0, _common.Post)('share/email'),
    (0, _decorators.RequirePerm)('vcard.self'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.vcardEmailSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], VcardController.prototype, "email", null);
_ts_decorate([
    (0, _common.Post)('share/whatsapp'),
    (0, _decorators.RequirePerm)('vcard.self'),
    (0, _common.HttpCode)(200),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.vcardWhatsappSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof z === "undefined" || typeof z.infer === "undefined" ? Object : z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], VcardController.prototype, "whatsapp", null);
VcardController = _ts_decorate([
    (0, _common.Controller)('vcard'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _vcardservice.VcardService === "undefined" ? Object : _vcardservice.VcardService
    ])
], VcardController);

//# sourceMappingURL=idcards.controller.js.map