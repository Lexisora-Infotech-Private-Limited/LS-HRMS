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
    get CertificatesService () {
        return CertificatesService;
    },
    get formatCode () {
        return formatCode;
    },
    get newVerificationCode () {
        return newVerificationCode;
    },
    get normalizeCode () {
        return normalizeCode;
    },
    get verifyUrl () {
        return verifyUrl;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _qrcode = /*#__PURE__*/ _interop_require_default(require("qrcode"));
const _env = require("../../../config/env");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _pdfservice = require("../../../core/pdf/pdf.service");
const _storageservice = require("../../../core/storage/storage.service");
const _jobsservice = require("../../../core/jobs/jobs.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _eventsservice = require("../../../core/registry/events.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
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
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function newVerificationCode() {
    const b = (0, _nodecrypto.randomBytes)(7);
    let bits = 0n;
    for (const x of b)bits = bits << 8n | BigInt(x);
    bits >>= 6n; // keep 50 bits
    let s = '';
    for(let i = 0; i < 10; i++){
        s = CROCKFORD[Number(bits & 31n)] + s;
        bits >>= 5n;
    }
    return s;
}
const formatCode = (c)=>`${c.slice(0, 5)}-${c.slice(5)}`;
const normalizeCode = (c)=>c.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
function verifyUrl(code) {
    return `${_env.env.WEB_ORIGIN.replace(/\/$/, '')}/api/v1/certificates/verify/${formatCode(code)}`;
}
let CertificatesService = class CertificatesService {
    prisma;
    pdf;
    storage;
    jobs;
    audit;
    notifications;
    events;
    log = new _common.Logger('Certificates');
    constructor(prisma, pdf, storage, jobs, audit, notifications, events){
        this.prisma = prisma;
        this.pdf = pdf;
        this.storage = storage;
        this.jobs = jobs;
        this.audit = audit;
        this.notifications = notifications;
        this.events = events;
    }
    onModuleInit() {
        this.jobs.register('workplace.certificate.render', async (d)=>{
            await this.render(d.certificateId);
        });
    }
    /** Idempotent on (sourceType, sourceId). Rendering is queued; download renders on demand. */ async issue(i) {
        const existing = await this.prisma.certificate.findFirst({
            where: {
                sourceType: i.sourceType,
                sourceId: i.sourceId
            }
        });
        if (existing) return existing;
        const emp = await this.prisma.employee.findUniqueOrThrow({
            where: {
                id: i.recipientEmployeeId
            },
            select: {
                fullName: true,
                userId: true
            }
        });
        const cert = await this.prisma.certificate.create({
            data: {
                tenantId: i.tenantId ?? (0, _requestcontext.requireContext)().tenantId,
                type: i.type,
                recipientEmployeeId: i.recipientEmployeeId,
                holderName: emp.fullName,
                title: i.title,
                subtitle: i.subtitle ?? null,
                verificationCode: newVerificationCode(),
                sourceType: i.sourceType,
                sourceId: i.sourceId,
                metadata: i.metadata ?? {}
            }
        });
        await this.audit.record({
            action: 'certificate.issue',
            entity: 'Certificate',
            entityId: cert.id,
            meta: {
                type: i.type,
                title: i.title
            }
        });
        await this.jobs.enqueue('workplace.certificate.render', {
            tenantId: (0, _requestcontext.requireContext)().tenantId,
            certificateId: cert.id
        });
        this.events.emit('certificate.issued', {
            certificateId: cert.id,
            employeeId: i.recipientEmployeeId,
            type: i.type
        });
        return cert;
    }
    async render(certificateId) {
        const cert = await this.prisma.certificate.findUnique({
            where: {
                id: certificateId
            }
        });
        if (!cert) throw (0, _errors.notFound)('Certificate');
        const tenant = await this.prisma.raw.tenant.findUniqueOrThrow({
            where: {
                id: cert.tenantId
            }
        });
        const signatory = await this.prisma.raw.employee.findFirst({
            where: {
                tenantId: cert.tenantId,
                user: {
                    role: {
                        key: 'admin'
                    }
                },
                status: 'ACTIVE'
            },
            orderBy: {
                joiningDate: 'asc'
            },
            include: {
                designation: true
            }
        });
        const qr = await _qrcode.default.toBuffer(verifyUrl(cert.verificationCode), {
            type: 'png',
            margin: 1,
            width: 240
        });
        const accent = tenant.brandAccent || _pdfservice.PDF_COLORS.accent;
        const meta = cert.metadata ?? {};
        const buf = await this.pdf.render((doc)=>{
            const W = doc.page.width;
            const H = doc.page.height;
            doc.rect(24, 24, W - 48, H - 48).lineWidth(2).strokeColor(accent).stroke();
            doc.rect(32, 32, W - 64, H - 64).lineWidth(0.5).strokeColor(_pdfservice.PDF_COLORS.rule).stroke();
            doc.font('Times-Bold').fontSize(26).fillColor(_pdfservice.PDF_COLORS.ink).text(tenant.brandName ?? tenant.name, 0, 70, {
                align: 'center',
                width: W
            });
            doc.font('Helvetica').fontSize(9).fillColor(accent).text(cert.type === 'EOTM' ? 'CERTIFICATE OF RECOGNITION' : 'CERTIFICATE OF COMPLETION', 0, 104, {
                align: 'center',
                width: W,
                characterSpacing: 2
            });
            doc.font('Helvetica').fontSize(12).fillColor(_pdfservice.PDF_COLORS.muted).text('This is to certify that', 0, 160, {
                align: 'center',
                width: W
            });
            doc.font('Times-Bold').fontSize(40).fillColor(_pdfservice.PDF_COLORS.ink).text(cert.holderName, 0, 185, {
                align: 'center',
                width: W
            });
            doc.moveTo(W / 2 - 160, 238).lineTo(W / 2 + 160, 238).lineWidth(0.8).strokeColor(accent).stroke();
            doc.font('Helvetica').fontSize(12).fillColor(_pdfservice.PDF_COLORS.muted).text(cert.type === 'EOTM' ? 'has been named' : 'has successfully completed', 0, 254, {
                align: 'center',
                width: W
            });
            doc.font('Times-Bold').fontSize(24).fillColor(_pdfservice.PDF_COLORS.ink).text(cert.title, 0, 276, {
                align: 'center',
                width: W
            });
            if (cert.subtitle) doc.font('Helvetica').fontSize(12).fillColor(_pdfservice.PDF_COLORS.muted).text(cert.subtitle, 0, 310, {
                align: 'center',
                width: W
            });
            if (meta.citation) doc.font('Times-Italic').fontSize(13).fillColor(_pdfservice.PDF_COLORS.ink).text(`“${meta.citation}”`, 140, 336, {
                align: 'center',
                width: W - 280
            });
            const baseY = H - 150;
            doc.font('Helvetica').fontSize(9).fillColor(_pdfservice.PDF_COLORS.muted).text('ISSUED ON', 80, baseY, {
                characterSpacing: 1
            });
            doc.font('Helvetica').fontSize(12).fillColor(_pdfservice.PDF_COLORS.ink).text(new Intl.DateTimeFormat('en-IN', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'Asia/Kolkata'
            }).format(cert.issuedAt), 80, baseY + 14);
            doc.moveTo(W / 2 - 110, baseY + 30).lineTo(W / 2 + 110, baseY + 30).lineWidth(0.5).strokeColor(_pdfservice.PDF_COLORS.rule).stroke();
            doc.font('Helvetica-Bold').fontSize(11).fillColor(_pdfservice.PDF_COLORS.ink).text(signatory?.fullName ?? 'Authorised signatory', W / 2 - 150, baseY + 36, {
                width: 300,
                align: 'center'
            });
            doc.font('Helvetica').fontSize(9).fillColor(_pdfservice.PDF_COLORS.muted).text(signatory?.designation?.name ?? 'Admin / CEO', W / 2 - 150, baseY + 52, {
                width: 300,
                align: 'center'
            });
            doc.image(qr, W - 170, baseY - 20, {
                width: 84
            });
            doc.font('Helvetica').fontSize(7.5).fillColor(_pdfservice.PDF_COLORS.muted).text(`Verify: ${formatCode(cert.verificationCode)}`, W - 200, baseY + 68, {
                width: 150,
                align: 'center'
            });
        }, {
            size: 'A4',
            layout: 'landscape',
            margin: 40,
            info: {
                Title: `${cert.title} — ${cert.holderName}`
            }
        });
        const stored = await this.storage.save({
            data: buf,
            filename: `certificate-${formatCode(cert.verificationCode)}.pdf`,
            mime: 'application/pdf',
            category: 'certificate',
            isPrivate: true,
            tenantId: cert.tenantId,
            ownerUserId: null
        });
        const sha256 = (0, _nodecrypto.createHash)('sha256').update(buf).digest('hex');
        const updated = await this.prisma.raw.certificate.update({
            where: {
                id: cert.id
            },
            data: {
                fileId: stored.id,
                sha256,
                status: cert.status === 'REVOKED' ? 'REVOKED' : 'READY'
            }
        });
        if (cert.status === 'PENDING') {
            const userId = (await this.prisma.raw.employee.findUnique({
                where: {
                    id: cert.recipientEmployeeId
                },
                select: {
                    userId: true
                }
            }))?.userId;
            if (userId) {
                await this.notifications.notify({
                    userIds: [
                        userId
                    ],
                    type: 'certificate.ready',
                    title: `Your certificate is ready: ${cert.title}`,
                    link: cert.type === 'EOTM' ? '/feed' : '/learning?tab=certificates'
                });
            }
        }
        return updated;
    }
    /** PDF bytes, rendering first if the job has not run yet. */ async pdfFor(certificateId) {
        let cert = await this.prisma.certificate.findUnique({
            where: {
                id: certificateId
            }
        });
        if (!cert) throw (0, _errors.notFound)('Certificate');
        if (!cert.fileId) cert = await this.render(cert.id);
        const { data } = await this.storage.read(cert.fileId, cert.tenantId);
        return {
            cert,
            data
        };
    }
    async revoke(id, reason) {
        const c = await this.prisma.certificate.update({
            where: {
                id
            },
            data: {
                status: 'REVOKED',
                revokedAt: new Date(),
                revokeReason: reason
            }
        });
        await this.audit.record({
            action: 'certificate.revoke',
            entity: 'Certificate',
            entityId: id,
            meta: {
                reason
            }
        });
        this.events.emit('certificate.revoked', {
            certificateId: id
        });
        return c;
    }
    /** Public lookup (no tenant context) — returns only non-identifying fields. */ async verify(code) {
        const c = await this.prisma.raw.certificate.findUnique({
            where: {
                verificationCode: normalizeCode(code)
            }
        });
        if (!c) return null;
        const tenant = await this.prisma.raw.tenant.findUnique({
            where: {
                id: c.tenantId
            }
        });
        return {
            valid: c.status !== 'REVOKED',
            status: c.status,
            holderName: c.holderName,
            title: c.title,
            subtitle: c.subtitle,
            issuedAt: c.issuedAt.toISOString(),
            issuer: tenant?.legalName ?? tenant?.name ?? '',
            code: formatCode(c.verificationCode),
            revokedAt: c.revokedAt?.toISOString() ?? null,
            sha256: c.sha256
        };
    }
};
CertificatesService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _pdfservice.PdfService === "undefined" ? Object : _pdfservice.PdfService,
        typeof _storageservice.StorageService === "undefined" ? Object : _storageservice.StorageService,
        typeof _jobsservice.JobsService === "undefined" ? Object : _jobsservice.JobsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService
    ])
], CertificatesService);

//# sourceMappingURL=certificates.service.js.map