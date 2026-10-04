"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "VcardService", {
    enumerable: true,
    get: function() {
        return VcardService;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _env = require("../../../config/env");
const _auditservice = require("../../../core/audit/audit.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _mailservice = require("../../../core/mail/mail.service");
const _pdfservice = require("../../../core/pdf/pdf.service");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _peoplerules = require("../people.rules");
const _cardrender = require("../idcards/card-render");
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
/** 3.5 × 2 in visiting card (88.9 × 50.8 mm); PNG 1050 × 600 px at 300 DPI. */ const W_MM = 88.9;
const H_MM = 50.8;
const publicUrl = (tenantSlug, slug)=>`${_env.env.WEB_ORIGIN}/api/v1/vcard/c/${tenantSlug}/${slug}`;
function cardElements(showPhone) {
    const f = (size, extra = {})=>({
            size,
            weight: 'normal',
            color: '#201f1d',
            align: 'left',
            family: 'sans',
            ...extra
        });
    return [
        {
            id: 'company',
            type: 'TEXT',
            binding: 'tenant.name',
            xMm: 6.5,
            yMm: 5,
            wMm: 55,
            hMm: 7,
            z: 1,
            font: f(12, {
                family: 'serif'
            })
        },
        {
            id: 'qr',
            type: 'QR',
            binding: 'qr.verify_url',
            xMm: 67,
            yMm: 5,
            wMm: 15.5,
            hMm: 15.5,
            z: 1
        },
        {
            id: 'name',
            type: 'TEXT',
            binding: 'employee.full_name',
            xMm: 6.5,
            yMm: 21,
            wMm: 76,
            hMm: 9,
            z: 1,
            font: f(20, {
                family: 'serif'
            })
        },
        {
            id: 'title',
            type: 'TEXT',
            binding: 'employee.designation',
            xMm: 6.5,
            yMm: 29,
            wMm: 76,
            hMm: 5,
            z: 1,
            font: f(9, {
                color: '#8a6326'
            })
        },
        {
            id: 'rule',
            type: 'SHAPE',
            xMm: 6.5,
            yMm: 38.5,
            wMm: 76,
            hMm: 0.3,
            fill: '#d7d3d3',
            z: 0
        },
        {
            id: 'email',
            type: 'TEXT',
            binding: 'employee.emp_code',
            xMm: 6.5,
            yMm: 40,
            wMm: 45,
            hMm: 5,
            z: 1,
            font: f(8)
        },
        ...showPhone ? [
            {
                id: 'phone',
                type: 'TEXT',
                binding: 'employee.emergency_contact',
                xMm: 46,
                yMm: 40,
                wMm: 36.5,
                hMm: 5,
                z: 1,
                font: f(8, {
                    align: 'right'
                })
            }
        ] : []
    ];
}
let VcardService = class VcardService {
    prisma;
    mail;
    pdf;
    audit;
    constructor(prisma, mail, pdf, audit){
        this.prisma = prisma;
        this.mail = mail;
        this.pdf = pdf;
        this.audit = audit;
    }
    async ensureProfile(employeeId, fullName) {
        const existing = await this.prisma.vCardProfile.findUnique({
            where: {
                employeeId
            }
        });
        if (existing) return existing;
        const slug = `${(0, _peoplerules.slugify)(fullName) || 'card'}-${(0, _nodecrypto.randomBytes)(3).readUIntBE(0, 3).toString(36).slice(0, 3)}`;
        return this.prisma.vCardProfile.create({
            data: {
                employeeId,
                publicSlug: slug
            }
        });
    }
    async disablePublic(employeeId) {
        await this.prisma.vCardProfile.updateMany({
            where: {
                employeeId
            },
            data: {
                isPublic: false
            }
        });
    }
    meId() {
        const me = (0, _requestcontext.requireContext)().employeeId;
        if (!me) throw (0, _errors.notFound)('Employee');
        return me;
    }
    async card(employeeId = this.meId()) {
        const e = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            include: {
                designation: true,
                department: true,
                branch: true
            }
        });
        if (!e) throw (0, _errors.notFound)('Employee');
        const p = await this.ensureProfile(e.id, e.fullName);
        const t = await this.prisma.raw.tenant.findUniqueOrThrow({
            where: {
                id: (0, _requestcontext.requireContext)().tenantId
            }
        });
        const company = t.name;
        const phone = p.showPhone ? p.workPhone || e.phone || null : null;
        const url = publicUrl(t.slug, p.publicSlug);
        const address = e.branch?.address ?? t.address ?? null;
        const title = [
            e.designation?.name,
            e.department?.name
        ].filter(Boolean).join(' · ');
        const vcf = (0, _peoplerules.buildVcf)({
            name: e.fullName,
            org: company,
            title: e.designation?.name,
            email: e.officialEmail,
            phone,
            url: p.isPublic ? url : null,
            address,
            linkedin: p.linkedinUrl
        });
        return {
            name: e.fullName,
            title,
            designation: e.designation?.name ?? null,
            department: e.department?.name ?? null,
            email: e.officialEmail,
            phone,
            company,
            address,
            publicUrl: url,
            // Public link off → the QR carries the vCard itself (works offline).
            qrDataUrl: await (0, _cardrender.qrDataUrl)(p.isPublic ? url : vcf),
            showPhone: p.showPhone,
            workPhone: p.workPhone,
            linkedinUrl: p.linkedinUrl,
            isPublic: p.isPublic,
            slug: p.publicSlug,
            tenantSlug: t.slug,
            vcf
        };
    }
    async updateSettings(dto) {
        const me = this.meId();
        const e = await this.prisma.employee.findUniqueOrThrow({
            where: {
                id: me
            }
        });
        const p = await this.ensureProfile(me, e.fullName);
        await this.prisma.vCardProfile.update({
            where: {
                id: p.id
            },
            data: {
                ...dto.showPhone !== undefined ? {
                    showPhone: dto.showPhone
                } : {},
                ...dto.workPhone !== undefined ? {
                    workPhone: dto.workPhone || null
                } : {},
                ...dto.linkedinUrl !== undefined ? {
                    linkedinUrl: dto.linkedinUrl || null
                } : {},
                ...dto.isPublic !== undefined ? {
                    isPublic: dto.isPublic
                } : {}
            }
        });
        if (dto.isPublic !== undefined && dto.isPublic !== p.isPublic) await this.audit.record({
            action: 'vcard.public_toggled',
            entity: 'VCardProfile',
            entityId: p.id,
            meta: {
                isPublic: dto.isPublic
            }
        });
        return this.card(me);
    }
    async png(employeeId = this.meId()) {
        const c = await this.card(employeeId);
        const data = {
            'tenant.name': c.company,
            'employee.full_name': c.name,
            'employee.designation': c.title,
            'employee.emp_code': c.email,
            'employee.emergency_contact': c.phone,
            'qr.verify_url': 'x'
        };
        const svg = (0, _cardrender.renderCardSvg)({
            widthMm: W_MM,
            heightMm: H_MM,
            elements: cardElements(!!c.phone)
        }, data, {
            qr: c.qrDataUrl
        });
        return (0, _cardrender.svgToPng)(svg);
    }
    async pdfFile(employeeId = this.meId()) {
        const png = await this.png(employeeId);
        const bleed = 3 * _cardrender.PT_PER_MM;
        const w = W_MM * _cardrender.PT_PER_MM;
        const h = H_MM * _cardrender.PT_PER_MM;
        return this.pdf.render((doc)=>{
            doc.rect(0, 0, w + 2 * bleed, h + 2 * bleed).fill('#ffffff');
            doc.image(png, bleed, bleed, {
                width: w,
                height: h
            });
            // crop marks
            doc.lineWidth(0.3).strokeColor('#999999');
            for (const [x, y] of [
                [
                    bleed,
                    bleed
                ],
                [
                    bleed + w,
                    bleed
                ],
                [
                    bleed,
                    bleed + h
                ],
                [
                    bleed + w,
                    bleed + h
                ]
            ]){
                doc.moveTo(x, y - bleed).lineTo(x, y - bleed / 2).stroke();
                doc.moveTo(x, y + bleed / 2).lineTo(x, y + bleed).stroke();
                doc.moveTo(x - bleed, y).lineTo(x - bleed / 2, y).stroke();
                doc.moveTo(x + bleed / 2, y).lineTo(x + bleed, y).stroke();
            }
        }, {
            size: [
                w + 2 * bleed,
                h + 2 * bleed
            ],
            margin: 0,
            info: {
                Title: 'Visiting card',
                Author: 'Lexisora HRMS'
            }
        });
    }
    async vcf(employeeId = this.meId()) {
        const c = await this.card(employeeId);
        return {
            vcf: c.vcf,
            filename: `${c.slug}.vcf`
        };
    }
    async sharesToday(employeeId) {
        const since = new Date(Date.now() - 86400_000);
        return this.prisma.vCardShare.count({
            where: {
                employeeId,
                createdAt: {
                    gte: since
                }
            }
        });
    }
    async shareEmail(to, message) {
        const me = this.meId();
        if (await this.sharesToday(me) + to.length > 20) throw new _errors.AppError(429, 'SHARE_LIMIT', 'You can share your card with up to 20 people a day');
        const c = await this.card(me);
        const png = await this.png(me);
        const mail = {
            to,
            replyTo: c.email,
            subject: `${c.name} · ${c.company} visiting card`,
            text: `${message ? `${message}\n\n` : ''}${c.name}\n${c.title}\n${c.company}\n${c.email}${c.phone ? `\n${c.phone}` : ''}${c.isPublic ? `\n\nView online: ${c.publicUrl}` : ''}\n\nThe card image and a contact file (.vcf) are attached.`,
            attachments: [
                {
                    filename: `${c.slug}.png`,
                    content: png,
                    contentType: 'image/png'
                },
                {
                    filename: `${c.slug}.vcf`,
                    content: c.vcf,
                    contentType: 'text/vcard'
                }
            ]
        };
        const ok = await this.mail.send(mail);
        if (!ok) throw new _errors.AppError(502, 'MAIL_FAILED', 'The email could not be sent. Try again.');
        await this.prisma.vCardShare.createMany({
            data: to.map((r)=>({
                    employeeId: me,
                    channel: 'EMAIL',
                    recipient: r,
                    status: 'SENT'
                }))
        });
        await this.audit.record({
            action: 'vcard.shared',
            entity: 'VCardProfile',
            entityId: me,
            meta: {
                channel: 'EMAIL',
                recipients: to.map((r)=>r.replace(/^(.).*@/, '$1***@'))
            }
        });
        return {
            sent: to.length
        };
    }
    /** WhatsApp stub adapter: always a wa.me deep link (the Business API is P3). */ async shareWhatsapp(phone) {
        const me = this.meId();
        const digits = (phone ?? '').replace(/\D/g, '');
        if (phone && (digits.length < 10 || digits.length > 13)) throw (0, _errors.badRequest)('Enter a valid WhatsApp number', 'PHONE_INVALID');
        const c = await this.card(me);
        const text = c.isPublic ? `Here's my visiting card: ${c.publicUrl}` : `${c.name} · ${c.title} · ${c.company} · ${c.email}${c.phone ? ` · ${c.phone}` : ''}`;
        const url = (0, _peoplerules.whatsappLink)(digits || null, text);
        await this.prisma.vCardShare.create({
            data: {
                employeeId: me,
                channel: 'WHATSAPP',
                recipient: digits || 'picker',
                status: 'DEEPLINK'
            }
        });
        await this.audit.record({
            action: 'vcard.shared',
            entity: 'VCardProfile',
            entityId: me,
            meta: {
                channel: 'WHATSAPP'
            }
        });
        return {
            mode: 'deeplink',
            url
        };
    }
    // ── Public page ──────────────────────────────────────────────────────────
    async publicCard(tenantSlug, slug) {
        const t = await this.prisma.raw.tenant.findUnique({
            where: {
                slug: tenantSlug
            }
        });
        const wantVcf = slug.endsWith('.vcf');
        const s = wantVcf ? slug.slice(0, -4) : slug;
        const p = t ? await this.prisma.raw.vCardProfile.findUnique({
            where: {
                tenantId_publicSlug: {
                    tenantId: t.id,
                    publicSlug: s
                }
            }
        }) : null;
        const e = p ? await this.prisma.raw.employee.findUnique({
            where: {
                id: p.employeeId
            },
            include: {
                designation: true,
                department: true
            }
        }) : null;
        const page = (body)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visiting card</title><style>body{margin:0;font-family:'Segoe UI',Arial,sans-serif;background:#f7f5f2;color:#201f1d;display:grid;place-items:center;min-height:100vh}.c{background:#fff;border:1px solid #d7d3d3;border-radius:8px;padding:26px;width:min(420px,90vw);box-shadow:0 8px 24px rgba(0,0,0,.06)}.co{font-family:Georgia,serif;font-size:18px}.nm{font-family:Georgia,serif;font-size:28px;margin-top:22px}.ti{font-size:13px;color:#8a6326}.ft{font-size:12.5px;border-top:1px solid #d7d3d3;margin-top:18px;padding-top:8px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px}a.b{display:inline-block;margin-top:16px;background:#b68235;color:#fff;text-decoration:none;padding:8px 14px;border-radius:4px;font-size:13px}</style></head><body><div class="c">${body}</div></body></html>`;
        const esc = (x)=>x.replace(/[&<>"']/g, (ch)=>({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;'
                })[ch]);
        if (!t || !p || !e) return {
            status: 404,
            html: page('<div class="nm">Card not found</div>')
        };
        if (!p.isPublic || e.status === 'EXITED') return {
            status: 410,
            html: page(`<div class="nm">No longer available</div><div class="ti">${e.status === 'EXITED' ? `No longer with ${esc(t.name)}` : 'This card is private.'}</div>`)
        };
        const phone = p.showPhone ? p.workPhone || e.phone || null : null;
        const vcf = (0, _peoplerules.buildVcf)({
            name: e.fullName,
            org: t.name,
            title: e.designation?.name,
            email: e.officialEmail,
            phone,
            url: publicUrl(t.slug, p.publicSlug),
            linkedin: p.linkedinUrl
        });
        if (wantVcf) return {
            status: 200,
            vcf,
            filename: `${p.publicSlug}.vcf`
        };
        return {
            status: 200,
            html: page(`<div class="co">${esc(t.name)}</div><div class="nm">${esc(e.fullName)}</div><div class="ti">${esc([
                e.designation?.name,
                e.department?.name
            ].filter(Boolean).join(' · '))}</div><div class="ft"><span>${esc(e.officialEmail)}</span>${phone ? `<span>${esc(phone)}</span>` : ''}</div><a class="b" href="${publicUrl(t.slug, p.publicSlug)}.vcf">Add to contacts</a>`)
        };
    }
};
VcardService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _mailservice.MailService === "undefined" ? Object : _mailservice.MailService,
        typeof _pdfservice.PdfService === "undefined" ? Object : _pdfservice.PdfService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], VcardService);

//# sourceMappingURL=vcard.service.js.map