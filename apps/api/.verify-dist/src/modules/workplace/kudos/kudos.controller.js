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
    get CertificatesController () {
        return CertificatesController;
    },
    get EotmController () {
        return EotmController;
    },
    get KudosController () {
        return KudosController;
    }
});
const _common = require("@nestjs/common");
const _platformexpress = require("@nestjs/platform-express");
const _multer = require("multer");
const _nodecrypto = require("node:crypto");
const _zod = require("zod");
const _shared = require("@lexisora/shared");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _zodpipe = require("../../../core/http/zod.pipe");
const _errors = require("../../../core/http/errors");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _certificatesservice = require("../common/certificates.service");
const _http = require("../common/http");
const _kudosservice = require("./kudos.service");
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
const yearQuery = _zod.z.object({
    year: _zod.z.coerce.number().int().min(2000).max(2100).optional()
});
let KudosController = class KudosController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    list(q) {
        return this.svc.list(q.tab, q.page, q.pageSize);
    }
    give(dto) {
        return this.svc.give(dto);
    }
    revoke(id, dto) {
        return this.svc.revoke(id, dto.reason);
    }
    badges() {
        return this.svc.badges();
    }
    createBadge(dto) {
        return this.svc.saveBadge(null, dto);
    }
    updateBadge(id, dto) {
        return this.svc.saveBadge(id, dto);
    }
    /** Distinct badges with counts — profile header tags (public inside the tenant). */ employeeBadges(employeeId) {
        return this.svc.employeeBadges(employeeId);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('kudos.view'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(_shared.kudosListQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], KudosController.prototype, "list", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('kudos.give'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.kudosCreateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof KudosCreateInput === "undefined" ? Object : KudosCreateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], KudosController.prototype, "give", null);
_ts_decorate([
    (0, _common.Post)(':id/revoke'),
    (0, _decorators.RequirePerm)('kudos.give', 'kudos.eotm'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.kudosRevokeSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], KudosController.prototype, "revoke", null);
_ts_decorate([
    (0, _common.Get)('badges'),
    (0, _decorators.RequirePerm)('kudos.view'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], KudosController.prototype, "badges", null);
_ts_decorate([
    (0, _common.Post)('badges'),
    (0, _decorators.RequirePerm)('kudos.eotm'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.badgeUpsertSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof BadgeUpsertInput === "undefined" ? Object : BadgeUpsertInput
    ]),
    _ts_metadata("design:returntype", void 0)
], KudosController.prototype, "createBadge", null);
_ts_decorate([
    (0, _common.Patch)('badges/:id'),
    (0, _decorators.RequirePerm)('kudos.eotm'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.badgeUpsertSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof BadgeUpsertInput === "undefined" ? Object : BadgeUpsertInput
    ]),
    _ts_metadata("design:returntype", void 0)
], KudosController.prototype, "updateBadge", null);
_ts_decorate([
    (0, _common.Get)('employees/:employeeId/badges'),
    (0, _decorators.RequirePerm)('kudos.view'),
    _ts_param(0, (0, _common.Param)('employeeId')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", void 0)
], KudosController.prototype, "employeeBadges", null);
KudosController = _ts_decorate([
    (0, _common.Controller)('kudos'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _kudosservice.KudosService === "undefined" ? Object : _kudosservice.KudosService
    ])
], KudosController);
let EotmController = class EotmController {
    svc;
    constructor(svc){
        this.svc = svc;
    }
    list(q) {
        return this.svc.eotmList(q.year);
    }
    current() {
        return this.svc.currentAward();
    }
    options() {
        return this.svc.eotmOptions();
    }
    announce(dto) {
        return this.svc.announce(dto);
    }
    revoke(id, dto) {
        return this.svc.revokeEotm(id, dto.reason);
    }
};
_ts_decorate([
    (0, _common.Get)(),
    (0, _decorators.RequirePerm)('kudos.view'),
    _ts_param(0, (0, _common.Query)(new _zodpipe.ZodPipe(yearQuery))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], EotmController.prototype, "list", null);
_ts_decorate([
    (0, _common.Get)('current'),
    (0, _decorators.RequirePerm)('kudos.view', 'feed.view'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], EotmController.prototype, "current", null);
_ts_decorate([
    (0, _common.Get)('options'),
    (0, _decorators.RequirePerm)('kudos.eotm'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", void 0)
], EotmController.prototype, "options", null);
_ts_decorate([
    (0, _common.Post)(),
    (0, _decorators.RequirePerm)('kudos.eotm'),
    _ts_param(0, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.eotmCreateSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof EotmCreateInput === "undefined" ? Object : EotmCreateInput
    ]),
    _ts_metadata("design:returntype", void 0)
], EotmController.prototype, "announce", null);
_ts_decorate([
    (0, _common.Post)(':id/revoke'),
    (0, _decorators.RequirePerm)('kudos.eotm'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.eotmRevokeSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", void 0)
], EotmController.prototype, "revoke", null);
EotmController = _ts_decorate([
    (0, _common.Controller)('eotm'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _kudosservice.KudosService === "undefined" ? Object : _kudosservice.KudosService
    ])
], EotmController);
const verifyLimit = (0, _http.rateLimiter)(30, 60_000);
const esc = (s)=>s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let CertificatesController = class CertificatesController {
    certs;
    prisma;
    audit;
    constructor(certs, prisma, audit){
        this.certs = certs;
        this.prisma = prisma;
        this.audit = audit;
    }
    async mine() {
        const me = (0, _requestcontext.requireContext)().employeeId;
        if (!me) return [];
        const rows = await this.prisma.certificate.findMany({
            where: {
                recipientEmployeeId: me
            },
            orderBy: {
                issuedAt: 'desc'
            }
        });
        return rows.map((c)=>({
                id: c.id,
                type: c.type,
                title: c.title,
                subtitle: c.subtitle,
                holderName: c.holderName,
                issuedAt: c.issuedAt.toISOString(),
                status: c.status,
                code: (0, _certificatesservice.formatCode)(c.verificationCode)
            }));
    }
    /** The recipient, certificate managers, or anyone in the tenant for EOTM (the award is public). */ async pdf(id, res, inline) {
        const ctx = (0, _requestcontext.requireContext)();
        const c = await this.prisma.certificate.findUnique({
            where: {
                id
            }
        });
        if (!c) throw (0, _errors.notFound)('Certificate');
        const mine = !!ctx.employeeId && c.recipientEmployeeId === ctx.employeeId;
        const manager = (0, _decorators.hasPerm)(ctx, c.type === 'EOTM' ? 'kudos.eotm' : 'lms.manage');
        if (!mine && !manager && !(c.type === 'EOTM' && c.status !== 'REVOKED')) throw (0, _errors.forbidden)('Only the recipient can download this certificate');
        const { cert, data } = await this.certs.pdfFor(id);
        (0, _http.sendFile)(res, data, `${cert.title.replace(/[^\w]+/g, '-')}-${cert.holderName.replace(/[^\w]+/g, '-')}.pdf`, 'application/pdf', inline === '1');
    }
    async regenerate(id) {
        const c = await this.certs.render(id);
        await this.audit.record({
            action: 'certificate.regenerate',
            entity: 'Certificate',
            entityId: id
        });
        return {
            ok: true,
            status: c.status
        };
    }
    async revoke(id, dto) {
        const c = await this.certs.revoke(id, dto.reason);
        return {
            ok: true,
            status: c.status
        };
    }
    /** Public verification (QR on the PDF). HTML for browsers, JSON for `Accept: application/json`. */ async verify(code, ip, res, accept) {
        if (!verifyLimit(ip ?? 'unknown')) throw new _errors.AppError(429, 'RATE_LIMITED', 'Too many verification requests — try again in a minute');
        const r = await this.certs.verify(code);
        if (r) {
            const c = await this.prisma.raw.certificate.findUnique({
                where: {
                    verificationCode: r.code.replace('-', '')
                },
                select: {
                    tenantId: true,
                    id: true
                }
            });
            if (c) await this.audit.recordRaw(c.tenantId, {
                action: 'certificate.verify',
                entity: 'Certificate',
                entityId: c.id,
                meta: {
                    ipHash: (0, _nodecrypto.createHash)('sha256').update(ip ?? '').digest('hex').slice(0, 16)
                }
            });
        }
        const body = r ? {
            valid: r.valid,
            status: r.status,
            holderName: r.holderName,
            title: r.title,
            subtitle: r.subtitle,
            issuedAt: r.issuedAt,
            issuer: r.issuer,
            code: r.code,
            revokedAt: r.revokedAt
        } : null;
        if ((accept ?? '').includes('application/json') && !(accept ?? '').includes('text/html')) {
            if (!body) throw (0, _errors.notFound)('Certificate');
            res.json(body);
            return;
        }
        res.status(body ? 200 : 404).setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(verifyPage(body, code));
    }
    /** Upload a PDF to check it is the genuine, unaltered certificate. */ async verifyFile(code, ip, file) {
        if (!verifyLimit(ip ?? 'unknown')) throw new _errors.AppError(429, 'RATE_LIMITED', 'Too many verification requests — try again in a minute');
        if (!file) throw (0, _errors.badRequest)('Attach the certificate PDF');
        const r = await this.certs.verify(code);
        if (!r) throw (0, _errors.notFound)('Certificate');
        const sha = (0, _nodecrypto.createHash)('sha256').update(file.buffer).digest('hex');
        return {
            matches: !!r.sha256 && sha === r.sha256,
            valid: r.valid,
            status: r.status
        };
    }
};
_ts_decorate([
    (0, _common.Get)('mine'),
    (0, _decorators.RequirePerm)('kudos.view', 'lms.view'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CertificatesController.prototype, "mine", null);
_ts_decorate([
    (0, _common.Get)(':id/pdf'),
    (0, _decorators.RequirePerm)('kudos.view', 'feed.view', 'lms.view'),
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
], CertificatesController.prototype, "pdf", null);
_ts_decorate([
    (0, _common.Post)(':id/regenerate'),
    (0, _decorators.RequirePerm)('kudos.eotm', 'lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], CertificatesController.prototype, "regenerate", null);
_ts_decorate([
    (0, _common.Post)(':id/revoke'),
    (0, _decorators.RequirePerm)('kudos.eotm', 'lms.manage'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Body)(new _zodpipe.ZodPipe(_shared.certificateRevokeSchema))),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof _zod.z === "undefined" || typeof _zod.z.infer === "undefined" ? Object : _zod.z.infer
    ]),
    _ts_metadata("design:returntype", Promise)
], CertificatesController.prototype, "revoke", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Get)('verify/:code'),
    _ts_param(0, (0, _common.Param)('code')),
    _ts_param(1, (0, _common.Ip)()),
    _ts_param(2, (0, _common.Res)()),
    _ts_param(3, (0, _common.Headers)('accept')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof Response === "undefined" ? Object : Response,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], CertificatesController.prototype, "verify", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Post)('verify/:code/file'),
    (0, _common.UseInterceptors)((0, _platformexpress.FileInterceptor)('file', {
        storage: (0, _multer.memoryStorage)(),
        limits: {
            fileSize: 10 * 1024 * 1024
        }
    })),
    _ts_param(0, (0, _common.Param)('code')),
    _ts_param(1, (0, _common.Ip)()),
    _ts_param(2, (0, _common.UploadedFile)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        typeof Express === "undefined" || typeof Express.Multer === "undefined" || typeof Express.Multer.File === "undefined" ? Object : Express.Multer.File
    ]),
    _ts_metadata("design:returntype", Promise)
], CertificatesController.prototype, "verifyFile", null);
CertificatesController = _ts_decorate([
    (0, _common.Controller)('certificates'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _certificatesservice.CertificatesService === "undefined" ? Object : _certificatesservice.CertificatesService,
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], CertificatesController);
function verifyPage(r, code) {
    const date = (s)=>new Intl.DateTimeFormat('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Kolkata'
        }).format(new Date(s));
    const content = !r ? `<p class="k">Not found</p><h1>No certificate matches ${esc(code)}</h1><p>Check the code printed under the QR on the certificate.</p>` : `<p class="k ${r.valid ? 'ok' : 'bad'}">${r.valid ? 'Valid certificate' : `Revoked${r.revokedAt ? ` on ${date(r.revokedAt)}` : ''}`}</p>
       <h1>${esc(r.holderName)}</h1>
       <p class="t">${esc(r.title)}${r.subtitle ? ` · ${esc(r.subtitle)}` : ''}</p>
       <dl><dt>Issued by</dt><dd>${esc(r.issuer)}</dd><dt>Issued on</dt><dd>${date(r.issuedAt)}</dd><dt>Code</dt><dd>${esc(r.code)}</dd></dl>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Certificate verification</title>
<style>:root{color-scheme:light dark;--bg:#faf8f5;--ink:#201f1d;--mut:#605d5d;--acc:#b68235;--rule:#d7d3d3}@media (prefers-color-scheme:dark){:root{--bg:#1b1a19;--ink:#f1eee9;--mut:#b4afa8;--rule:#3a3836}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{max-width:520px;width:100%;border-top:2px solid var(--acc);padding:28px 4px}h1{font:600 30px/1.2 Georgia,serif;margin:6px 0}.k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--acc);margin:0}.k.bad{color:#b3261e}.t{color:var(--mut);margin:0 0 18px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;border-top:1px solid var(--rule);padding-top:14px}dt{color:var(--mut)}dd{margin:0}</style></head><body><main>${content}</main></body></html>`;
}

//# sourceMappingURL=kudos.controller.js.map