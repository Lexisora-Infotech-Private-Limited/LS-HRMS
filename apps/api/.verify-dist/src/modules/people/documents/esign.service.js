"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "EsignService", {
    enumerable: true,
    get: function() {
        return EsignService;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _auditservice = require("../../../core/audit/audit.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _pdfservice = require("../../../core/pdf/pdf.service");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _storageservice = require("../../../core/storage/storage.service");
const _peopleutil = require("../people.util");
const _esignrender = require("./esign-render");
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
const sha = (b)=>(0, _nodecrypto.createHash)('sha256').update(b).digest('hex');
let EsignService = class EsignService {
    prisma;
    pdf;
    storage;
    audit;
    constructor(prisma, pdf, storage, audit){
        this.prisma = prisma;
        this.pdf = pdf;
        this.storage = storage;
        this.audit = audit;
    }
    async event(envelopeId, type, meta) {
        const ctx = (0, _requestcontext.requireContext)();
        await this.prisma.esignEvent.create({
            data: {
                envelopeId,
                type,
                actorUserId: ctx.userId ?? null,
                ip: ctx.ip ?? null,
                meta: meta ?? undefined
            }
        });
    }
    async create(i) {
        const buf = await this.pdf.render((d)=>(0, _esignrender.renderEsignDocument)(d, i.doc), {
            size: 'A4',
            margin: 56,
            info: {
                Title: i.title,
                Author: i.doc.company
            }
        });
        const file = await this.storage.save({
            data: buf,
            filename: `${i.title}.pdf`,
            mime: 'application/pdf',
            category: 'esign'
        });
        const env = await this.prisma.esignEnvelope.create({
            data: {
                title: i.title,
                purpose: i.purpose,
                subjectEmployeeId: i.subjectEmployeeId,
                docData: i.doc,
                originalFileId: file.id,
                originalSha256: sha(buf),
                status: 'SENT',
                expiresAt: new Date(Date.now() + 30 * 86400_000),
                signerName: i.signerName,
                signerEmail: i.signerEmail,
                signerUserId: i.signerUserId
            }
        });
        await this.event(env.id, 'CREATED');
        await this.event(env.id, 'SENT', {
            to: i.signerEmail
        });
        return env;
    }
    async load(id) {
        const e = await this.prisma.esignEnvelope.findUnique({
            where: {
                id
            },
            include: {
                events: {
                    orderBy: {
                        at: 'asc'
                    }
                }
            }
        });
        if (!e) throw (0, _errors.notFound)('Document');
        return e;
    }
    assertViewer(e) {
        const ctx = (0, _requestcontext.requireContext)();
        const hr = ctx.permissions.has('*') || ctx.permissions.has('onboarding.manage') || ctx.permissions.has('employees.manage');
        if (!hr && e.signerUserId !== ctx.userId && e.subjectEmployeeId !== ctx.employeeId) throw (0, _errors.forbidden)();
    }
    async dto(id) {
        const e = await this.load(id);
        this.assertViewer(e);
        return {
            id: e.id,
            title: e.title,
            purpose: e.purpose,
            status: e.status,
            signerName: e.signerName,
            signedAt: e.signedAt?.toISOString() ?? null,
            signedSha256: e.signedSha256,
            originalSha256: e.originalSha256,
            events: e.events.map((x)=>({
                    type: x.type,
                    at: x.at.toISOString(),
                    ip: x.ip,
                    actorEmail: x.actorEmail
                }))
        };
    }
    /** PDF stream (signed version when complete); first view by the signer records VIEWED. */ async document(id) {
        const e = await this.load(id);
        this.assertViewer(e);
        const ctx = (0, _requestcontext.requireContext)();
        if (e.status === 'SENT' && e.signerUserId === ctx.userId) {
            await this.prisma.esignEnvelope.update({
                where: {
                    id
                },
                data: {
                    status: 'VIEWED'
                }
            });
            await this.event(id, 'VIEWED');
        }
        const fileId = e.signedFileId ?? e.originalFileId;
        const { data } = await this.storage.read(fileId);
        if (e.signedFileId) await this.event(id, 'DOWNLOADED');
        return {
            pdf: data,
            filename: `${e.title}${e.signedFileId ? ' (signed)' : ''}.pdf`
        };
    }
    async sign(id, input, ua) {
        const ctx = (0, _requestcontext.requireContext)();
        const e = await this.load(id);
        if (e.signerUserId && e.signerUserId !== ctx.userId) throw (0, _errors.forbidden)('Only the addressed signer can sign this document');
        if (e.status === 'COMPLETED') return {
            envelope: e,
            already: true
        };
        if ([
            'EXPIRED',
            'VOIDED',
            'DECLINED'
        ].includes(e.status) || e.expiresAt < new Date()) throw new _errors.AppError(410, 'ENVELOPE_CLOSED', 'This document can no longer be signed. Ask HR to resend it.');
        const now = new Date();
        let png = null;
        let signatureFileId = null;
        if (input.signatureType === 'DRAWN' && input.drawnPng) {
            png = Buffer.from(input.drawnPng.replace(/^data:image\/png;base64,/, ''), 'base64');
            if (png.length > 200 * 1024) throw new _errors.AppError(422, 'SIGNATURE_TOO_LARGE', 'Signature image is too large');
            signatureFileId = (await this.storage.save({
                data: png,
                filename: 'signature.png',
                mime: 'image/png',
                category: 'esign'
            })).id;
        }
        await this.event(id, 'CONSENTED', {
            text: 'I have read and agree to this document'
        });
        const timeline = [
            ...e.events.map((x)=>({
                    type: x.type,
                    at: `${(0, _peopleutil.fmtStamp)(x.at)} IST`,
                    ip: x.ip
                })),
            {
                type: 'CONSENTED',
                at: `${(0, _peopleutil.fmtStamp)(now)} IST`,
                ip: ctx.ip ?? null
            },
            {
                type: 'SIGNED',
                at: `${(0, _peopleutil.fmtStamp)(now)} IST`,
                ip: ctx.ip ?? null
            }
        ];
        const signed = await this.pdf.render((d)=>(0, _esignrender.renderEsignDocument)(d, e.docData, {
                signerName: e.signerName,
                signerEmail: e.signerEmail,
                signedAtLabel: (0, _peopleutil.fmtStamp)(now),
                signatureType: input.signatureType,
                png,
                typedName: input.typedName,
                typedFont: input.typedFont
            }, {
                envelopeId: e.id,
                title: e.title,
                originalSha256: e.originalSha256,
                signer: {
                    name: e.signerName,
                    email: e.signerEmail,
                    ip: ctx.ip ?? null,
                    userAgent: ua ?? null
                },
                events: timeline
            }), {
            size: 'A4',
            margin: 56,
            info: {
                Title: `${e.title} (signed)`
            }
        });
        const file = await this.storage.save({
            data: signed,
            filename: `${e.title} (signed).pdf`,
            mime: 'application/pdf',
            category: 'esign'
        });
        const signedSha256 = sha(signed);
        const updated = await this.prisma.esignEnvelope.update({
            where: {
                id
            },
            data: {
                status: 'COMPLETED',
                signedFileId: file.id,
                signedSha256,
                signatureType: input.signatureType,
                typedName: input.typedName ?? null,
                typedFont: input.typedFont ?? null,
                signatureFileId,
                consentText: 'I have read and agree to this document',
                signedAt: now,
                signerIp: ctx.ip ?? null,
                signerUserAgent: ua ?? null
            },
            include: {
                events: true
            }
        });
        await this.event(id, 'SIGNED', {
            signatureType: input.signatureType
        });
        await this.event(id, 'COMPLETED', {
            signedSha256
        });
        await this.audit.record({
            action: 'esign.completed',
            entity: 'EsignEnvelope',
            entityId: id,
            meta: {
                title: e.title,
                originalSha256: e.originalSha256,
                signedSha256
            }
        });
        return {
            envelope: updated,
            already: false
        };
    }
    async decline(id, reason) {
        const e = await this.load(id);
        const ctx = (0, _requestcontext.requireContext)();
        if (e.signerUserId && e.signerUserId !== ctx.userId) throw (0, _errors.forbidden)();
        if (e.status === 'COMPLETED') throw new _errors.AppError(409, 'ALREADY_SIGNED', 'This document is already signed');
        await this.prisma.esignEnvelope.update({
            where: {
                id
            },
            data: {
                status: 'DECLINED',
                declineReason: reason
            }
        });
        await this.event(id, 'DECLINED', {
            reason
        });
        await this.audit.record({
            action: 'esign.declined',
            entity: 'EsignEnvelope',
            entityId: id,
            meta: {
                reason
            }
        });
    }
    async voidEnvelope(id) {
        const e = await this.load(id);
        if (e.status === 'COMPLETED') return;
        await this.prisma.esignEnvelope.update({
            where: {
                id
            },
            data: {
                status: 'VOIDED'
            }
        });
        await this.event(id, 'VOIDED');
    }
    /** Public hash check: does a hash belong to a completed envelope? (no PII) */ async verifyHash(sha256) {
        const e = await this.prisma.raw.esignEnvelope.findFirst({
            where: {
                signedSha256: sha256.toLowerCase(),
                status: 'COMPLETED'
            }
        });
        return e ? {
            valid: true,
            completedAt: e.signedAt?.toISOString() ?? null,
            title: e.title
        } : {
            valid: false
        };
    }
};
EsignService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _pdfservice.PdfService === "undefined" ? Object : _pdfservice.PdfService,
        typeof _storageservice.StorageService === "undefined" ? Object : _storageservice.StorageService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], EsignService);

//# sourceMappingURL=esign.service.js.map