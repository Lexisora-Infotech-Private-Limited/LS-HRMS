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
    get IdCardsService () {
        return IdCardsService;
    },
    get verifyUrl () {
        return verifyUrl;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _env = require("../../../config/env");
const _auditservice = require("../../../core/audit/audit.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _mailservice = require("../../../core/mail/mail.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _pdfservice = require("../../../core/pdf/pdf.service");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _sequenceservice = require("../../../core/registry/sequence.service");
const _settingsservice = require("../../../core/settings/settings.service");
const _storageservice = require("../../../core/storage/storage.service");
const _peoplerules = require("../people.rules");
const _peopleutil = require("../people.util");
const _cardrender = require("./card-render");
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
const SETTINGS_KEY = 'people.idcard.settings';
const ACTIVE = [
    'QUEUED',
    'READY',
    'SENT_TO_PRINT',
    'PRINTED',
    'ISSUED'
];
const STATUS_LABEL = {
    QUEUED: 'Queued',
    READY: 'Ready',
    SENT_TO_PRINT: 'Sent to print',
    PRINTED: 'Printed',
    ISSUED: 'Issued',
    REVOKED: 'Revoked',
    REPLACED: 'Replaced',
    SURRENDERED: 'Surrendered',
    VOID: 'Void'
};
const verifyUrl = (token)=>`${_env.env.WEB_ORIGIN}/api/v1/id-cards/verify/${token}`;
let IdCardsService = class IdCardsService {
    prisma;
    settingsSvc;
    seq;
    storage;
    pdf;
    mail;
    notify;
    audit;
    log = new _common.Logger('IdCards');
    constructor(prisma, settingsSvc, seq, storage, pdf, mail, notify, audit){
        this.prisma = prisma;
        this.settingsSvc = settingsSvc;
        this.seq = seq;
        this.storage = storage;
        this.pdf = pdf;
        this.mail = mail;
        this.notify = notify;
        this.audit = audit;
    }
    // ── Settings ─────────────────────────────────────────────────────────────
    async settings() {
        const t = await this.prisma.raw.tenant.findUnique({
            where: {
                id: (0, _requestcontext.requireContext)().tenantId
            }
        });
        const company = t?.brandName ? `${t.legalName ?? t.name}` : t?.name ?? 'Lexisora';
        return this.settingsSvc.get(SETTINGS_KEY, {
            printVendorEmail: 'print@shreeprints.in',
            printVendorName: 'Shree Prints',
            returnAddress: `${t?.name ?? company}, ${t?.address?.split(',')[0] ?? ''}${t?.city ? `, ${t.city}` : ''}`.replace(/, ,/g, ','),
            emergencyLine: t?.phone ?? null,
            autoGenerate: false,
            requireBloodGroup: true
        });
    }
    async saveSettings(s) {
        await this.settingsSvc.set(SETTINGS_KEY, s);
        await this.audit.record({
            action: 'idcard.settings_updated',
            entity: 'Setting',
            entityId: SETTINGS_KEY,
            meta: {
                printVendorEmail: s.printVendorEmail
            }
        });
        return this.settings();
    }
    // ── Templates ────────────────────────────────────────────────────────────
    async ensureTemplates() {
        if (await this.prisma.idCardTemplate.count()) return;
        const c = (0, _cardrender.classicPortrait)();
        const l = (0, _cardrender.landscapeMinimal)();
        await this.prisma.idCardTemplate.create({
            data: {
                name: 'Classic portrait',
                orientation: 'PORTRAIT',
                widthMm: 53.98,
                heightMm: 85.6,
                front: c.front,
                back: c.back,
                isDefault: true
            }
        });
        await this.prisma.idCardTemplate.create({
            data: {
                name: 'Landscape minimal',
                orientation: 'LANDSCAPE',
                widthMm: 85.6,
                heightMm: 53.98,
                front: l.front,
                back: l.back,
                isDefault: false
            }
        });
    }
    tplDto(t) {
        return {
            id: t.id,
            name: t.name,
            orientation: t.orientation,
            front: t.front,
            back: t.back,
            frontBgFileId: t.frontBgFileId,
            backBgFileId: t.backBgFileId,
            isDefault: t.isDefault,
            widthMm: t.widthMm,
            heightMm: t.heightMm,
            version: t.version
        };
    }
    async templates() {
        await this.ensureTemplates();
        const rows = await this.prisma.idCardTemplate.findMany({
            where: {
                status: {
                    not: 'ARCHIVED'
                }
            },
            orderBy: [
                {
                    isDefault: 'desc'
                },
                {
                    createdAt: 'asc'
                }
            ]
        });
        return rows.map((r)=>this.tplDto(r));
    }
    async createTemplate(i) {
        const dims = i.orientation === 'LANDSCAPE' ? {
            widthMm: 85.6,
            heightMm: 53.98
        } : {
            widthMm: 53.98,
            heightMm: 85.6
        };
        const row = await this.prisma.idCardTemplate.create({
            data: {
                name: i.name,
                orientation: i.orientation,
                ...dims,
                front: i.front,
                back: i.back,
                frontBgFileId: i.frontBgFileId ?? null,
                backBgFileId: i.backBgFileId ?? null,
                isDefault: false
            }
        });
        if (i.isDefault) await this.setDefault(row.id);
        await this.audit.record({
            action: 'idcard.template.created',
            entity: 'IdCardTemplate',
            entityId: row.id,
            meta: {
                name: i.name
            }
        });
        return this.tplDto(await this.prisma.idCardTemplate.findUnique({
            where: {
                id: row.id
            }
        }));
    }
    async updateTemplate(id, i) {
        const t = await this.prisma.idCardTemplate.findUnique({
            where: {
                id
            }
        });
        if (!t) throw (0, _errors.notFound)('Template');
        const dims = i.orientation === 'LANDSCAPE' ? {
            widthMm: 85.6,
            heightMm: 53.98
        } : {
            widthMm: 53.98,
            heightMm: 85.6
        };
        await this.prisma.idCardTemplate.update({
            where: {
                id
            },
            data: {
                name: i.name,
                orientation: i.orientation,
                ...dims,
                front: i.front,
                back: i.back,
                frontBgFileId: i.frontBgFileId ?? null,
                backBgFileId: i.backBgFileId ?? null,
                version: t.version + 1
            }
        });
        if (i.isDefault) await this.setDefault(id);
        await this.audit.record({
            action: 'idcard.template.published',
            entity: 'IdCardTemplate',
            entityId: id,
            meta: {
                version: t.version + 1
            }
        });
        return this.tplDto(await this.prisma.idCardTemplate.findUnique({
            where: {
                id
            }
        }));
    }
    async setDefault(id) {
        if (!await this.prisma.idCardTemplate.findUnique({
            where: {
                id
            }
        })) throw (0, _errors.notFound)('Template');
        await this.prisma.idCardTemplate.updateMany({
            where: {
                isDefault: true
            },
            data: {
                isDefault: false
            }
        });
        await this.prisma.idCardTemplate.update({
            where: {
                id
            },
            data: {
                isDefault: true
            }
        });
        return {
            ok: true
        };
    }
    async defaultTemplate() {
        await this.ensureTemplates();
        return await this.prisma.idCardTemplate.findFirst({
            where: {
                isDefault: true
            }
        }) ?? await this.prisma.idCardTemplate.findFirstOrThrow({
            orderBy: {
                createdAt: 'asc'
            }
        });
    }
    // ── Data binding ─────────────────────────────────────────────────────────
    async employee(id) {
        const e = await this.prisma.employee.findUnique({
            where: {
                id
            },
            include: {
                designation: true,
                department: true
            }
        });
        if (!e) throw (0, _errors.notFound)('Employee');
        return e;
    }
    async cardData(e, card) {
        const s = await this.settings();
        const t = await this.prisma.raw.tenant.findUnique({
            where: {
                id: (0, _requestcontext.requireContext)().tenantId
            }
        });
        return {
            'employee.full_name': e.fullName,
            'employee.emp_code': e.empCode,
            'employee.designation': e.designation?.name ?? null,
            'employee.department': e.department?.name ?? null,
            'employee.blood_group': e.bloodGroup ?? null,
            'employee.photo': e.photoFileId ?? null,
            'employee.emergency_contact': e.emergencyContactName ? `${e.emergencyContactName}${e.emergencyContactPhone ? ` · ${e.emergencyContactPhone}` : ''}` : null,
            'employee.joining_date': e.joiningDate ? (0, _peopleutil.fmt)(e.joiningDate) : null,
            'employee.code_blood': [
                e.empCode,
                e.bloodGroup
            ].filter(Boolean).join(' · '),
            'card.serial': card?.serial ?? 'IDC-PREVIEW',
            'qr.verify_url': card ? verifyUrl(card.verifyToken) : `${_env.env.WEB_ORIGIN}/verify`,
            'tenant.name': t?.brandName ? t.name ?? t.brandName : t?.name ?? 'Lexisora',
            'tenant.logo': t?.logoFileId ?? null,
            'tenant.address': t?.address ?? null,
            'settings.return_address': s.returnAddress ?? null,
            'settings.emergency_line': s.emergencyLine ?? null
        };
    }
    async imageData(fileId, max = 700) {
        if (!fileId) return null;
        try {
            const { data } = await this.storage.read(fileId, (0, _requestcontext.getContext)()?.tenantId);
            return (0, _cardrender.toDataUrl)(data, max);
        } catch  {
            return null;
        }
    }
    /** Render both sides as 300-DPI PNGs. */ async renderSides(tpl, data) {
        const images = {
            photo: await this.imageData(data['employee.photo']),
            logo: await this.imageData(data['tenant.logo'], 400),
            qr: data['qr.verify_url'] ? await (0, _cardrender.qrDataUrl)(data['qr.verify_url']) : null
        };
        const side = (els, bg)=>(0, _cardrender.renderCardSvg)({
                widthMm: tpl.widthMm,
                heightMm: tpl.heightMm,
                elements: els
            }, data, {
                ...images,
                bg
            });
        const [front, back] = await Promise.all([
            (0, _cardrender.svgToPng)(side(tpl.front, await this.imageData(tpl.frontBgFileId, 1100))),
            (0, _cardrender.svgToPng)(side(tpl.back, await this.imageData(tpl.backBgFileId, 1100)))
        ]);
        return {
            front,
            back
        };
    }
    /** One PDF page per side at exact card size (CR80), 300-DPI artwork. */ async cardsPdf(items) {
        return this.pdf.render((doc)=>{
            items.forEach((it, i)=>{
                const size = [
                    it.tpl.widthMm * _cardrender.PT_PER_MM,
                    it.tpl.heightMm * _cardrender.PT_PER_MM
                ];
                for (const [j, png] of [
                    it.front,
                    it.back
                ].entries()){
                    if (i > 0 || j > 0) doc.addPage({
                        size,
                        margin: 0
                    });
                    doc.image(png, 0, 0, {
                        width: size[0],
                        height: size[1]
                    });
                }
            });
        }, {
            size: [
                items[0].tpl.widthMm * _cardrender.PT_PER_MM,
                items[0].tpl.heightMm * _cardrender.PT_PER_MM
            ],
            margin: 0,
            info: {
                Title: 'ID cards',
                Author: 'Lexisora HRMS'
            }
        });
    }
    async previewData(employeeId) {
        let id = employeeId;
        if (!id) {
            const q = await this.prisma.idCard.findFirst({
                where: {
                    status: 'QUEUED'
                },
                orderBy: {
                    createdAt: 'asc'
                }
            });
            id = q?.employeeId ?? (0, _requestcontext.requireContext)().employeeId ?? null;
        }
        if (!id) throw (0, _errors.notFound)('Employee');
        const e = await this.employee(id);
        const card = await this.prisma.idCard.findFirst({
            where: {
                employeeId: id,
                status: {
                    in: ACTIVE
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        const data = await this.cardData(e, card);
        return {
            employeeId: id,
            name: e.fullName,
            data,
            qrDataUrl: await (0, _cardrender.qrDataUrl)(data['qr.verify_url'] ?? _env.env.WEB_ORIGIN)
        };
    }
    async previewPng(templateId, employeeId, side) {
        const tpl = await this.prisma.idCardTemplate.findUnique({
            where: {
                id: templateId
            }
        });
        if (!tpl) throw (0, _errors.notFound)('Template');
        const e = await this.employee(employeeId);
        const card = await this.prisma.idCard.findFirst({
            where: {
                employeeId,
                status: {
                    in: ACTIVE
                }
            }
        });
        const r = await this.renderSides(tpl, await this.cardData(e, card));
        return side === 'back' ? r.back : r.front;
    }
    // ── Cards ────────────────────────────────────────────────────────────────
    async missingFor(e) {
        const s = await this.settings();
        return (0, _peoplerules.idCardMissing)({
            photoFileId: e.photoFileId,
            bloodGroup: e.bloodGroup,
            designation: e.designation?.name,
            fullName: e.fullName
        }, s.requireBloodGroup);
    }
    /** Every employee gets a QUEUED card when added. */ async ensureCard(employeeId) {
        const existing = await this.prisma.idCard.findFirst({
            where: {
                employeeId,
                status: {
                    in: ACTIVE
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        if (existing) return existing;
        const e = await this.employee(employeeId);
        const tpl = await this.defaultTemplate();
        const year = new Date().getFullYear();
        const serial = await this.seq.next('idcard.serial', {
            prefix: `IDC-${year}-`,
            pad: 4,
            period: String(year)
        });
        return this.prisma.idCard.create({
            data: {
                employeeId,
                templateId: tpl.id,
                serial,
                status: 'QUEUED',
                missingFields: await this.missingFor(e),
                verifyToken: (0, _nodecrypto.randomBytes)(16).toString('base64url')
            }
        });
    }
    /** Recompute missing fields after a profile change; a data change on a generated card needs a regenerate. */ async refresh(employeeId) {
        const card = await this.prisma.idCard.findFirst({
            where: {
                employeeId,
                status: {
                    in: ACTIVE
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        if (!card) return;
        const e = await this.employee(employeeId);
        const missing = await this.missingFor(e);
        if (card.status === 'QUEUED') {
            await this.prisma.idCard.update({
                where: {
                    id: card.id
                },
                data: {
                    missingFields: missing
                }
            });
            const s = await this.settings();
            if (s.autoGenerate && !missing.length && e.status !== 'ONBOARDING') await this.generate({
                cardIds: [
                    card.id
                ]
            }).catch(()=>undefined);
        } else if (card.status === 'READY') {
            // Not yet printed: re-render so the PDF matches the profile.
            await this.prisma.idCard.update({
                where: {
                    id: card.id
                },
                data: {
                    status: 'QUEUED',
                    missingFields: missing,
                    printPdfFileId: null
                }
            });
        }
    }
    row(c, e, tplName, batch) {
        return {
            id: c.id,
            employeeId: c.employeeId,
            employee: e?.fullName ?? '—',
            empCode: e?.empCode ?? '—',
            template: tplName ?? null,
            status: c.status,
            statusLabel: c.status === 'QUEUED' && c.missingFields.length ? `Waiting for ${c.missingFields.map((m)=>_peoplerules.MISSING_LABELS[m] ?? m).join(', ')}` : STATUS_LABEL[c.status] ?? c.status,
            missing: c.missingFields.map((m)=>_peoplerules.MISSING_LABELS[m] ?? m),
            generatedAt: c.generatedAt?.toISOString() ?? null,
            printBatch: batch ?? null,
            serial: c.serial
        };
    }
    async cards(status, q) {
        const where = status ? {
            status: status
        } : {
            status: {
                notIn: [
                    'VOID',
                    'REPLACED'
                ]
            }
        };
        if (q) {
            const emps = await this.prisma.employee.findMany({
                where: {
                    OR: [
                        {
                            fullName: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        },
                        {
                            empCode: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        }
                    ]
                },
                select: {
                    id: true
                }
            });
            where.employeeId = {
                in: emps.map((e)=>e.id)
            };
        }
        const rows = await this.prisma.idCard.findMany({
            where,
            orderBy: [
                {
                    createdAt: 'desc'
                }
            ],
            take: 300
        });
        const [emps, tpls, batches] = await Promise.all([
            this.prisma.employee.findMany({
                where: {
                    id: {
                        in: rows.map((r)=>r.employeeId)
                    }
                },
                select: {
                    id: true,
                    fullName: true,
                    empCode: true
                }
            }),
            this.prisma.idCardTemplate.findMany({
                select: {
                    id: true,
                    name: true
                }
            }),
            this.prisma.idCardPrintBatch.findMany({
                where: {
                    id: {
                        in: rows.map((r)=>r.printBatchId).filter((x)=>!!x)
                    }
                },
                select: {
                    id: true,
                    code: true
                }
            })
        ]);
        const em = new Map(emps.map((e)=>[
                e.id,
                e
            ]));
        const tm = new Map(tpls.map((t)=>[
                t.id,
                t.name
            ]));
        const bm = new Map(batches.map((b)=>[
                b.id,
                b.code
            ]));
        return rows.map((c)=>this.row(c, em.get(c.employeeId), c.templateId ? tm.get(c.templateId) : undefined, c.printBatchId ? bm.get(c.printBatchId) : undefined));
    }
    async generatable() {
        const queued = await this.prisma.idCard.findMany({
            where: {
                status: 'QUEUED'
            }
        });
        // Refresh missing fields so the button count is live.
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: queued.map((c)=>c.employeeId)
                }
            },
            include: {
                designation: true,
                department: true
            }
        });
        const em = new Map(emps.map((e)=>[
                e.id,
                e
            ]));
        const waiting = [];
        let count = 0;
        for (const c of queued){
            const e = em.get(c.employeeId);
            if (!e || e.status === 'EXITED') continue;
            const missing = await this.missingFor(e);
            if (missing.join() !== c.missingFields.join()) await this.prisma.idCard.update({
                where: {
                    id: c.id
                },
                data: {
                    missingFields: missing
                }
            });
            if (missing.length) waiting.push({
                cardId: c.id,
                employeeId: e.id,
                name: e.fullName,
                missing: missing.map((m)=>_peoplerules.MISSING_LABELS[m] ?? m)
            });
            else count++;
        }
        const ready = await this.prisma.idCard.count({
            where: {
                status: 'READY'
            }
        });
        return {
            count,
            waiting,
            ready
        };
    }
    async generate(opts) {
        const where = opts.cardIds?.length ? {
            id: {
                in: opts.cardIds
            },
            status: {
                in: [
                    'QUEUED',
                    'READY'
                ]
            }
        } : {
            status: 'QUEUED'
        };
        const cards = await this.prisma.idCard.findMany({
            where
        });
        let generated = 0;
        const skipped = [];
        for (const c of cards){
            const e = await this.employee(c.employeeId);
            const missing = await this.missingFor(e);
            if (missing.length) {
                await this.prisma.idCard.update({
                    where: {
                        id: c.id
                    },
                    data: {
                        missingFields: missing
                    }
                });
                skipped.push(`${e.fullName}: ${missing.map((m)=>_peoplerules.MISSING_LABELS[m] ?? m).join(', ')}`);
                continue;
            }
            const tpl = c.templateId && await this.prisma.idCardTemplate.findUnique({
                where: {
                    id: c.templateId
                }
            }) || await this.defaultTemplate();
            const data = await this.cardData(e, c);
            const sides = await this.renderSides(tpl, data);
            const pdf = await this.cardsPdf([
                {
                    tpl,
                    ...sides
                }
            ]);
            const f = await this.storage.save({
                data: pdf,
                filename: `${e.empCode}-id-card.pdf`,
                mime: 'application/pdf',
                category: 'id-card'
            });
            await this.prisma.idCard.update({
                where: {
                    id: c.id
                },
                data: {
                    status: 'READY',
                    missingFields: [],
                    printPdfFileId: f.id,
                    generatedAt: new Date(),
                    templateId: tpl.id,
                    dataSnapshot: data
                }
            });
            await this.audit.record({
                action: 'idcard.generated',
                entity: 'IdCard',
                entityId: c.id,
                meta: {
                    employeeId: e.id,
                    serial: c.serial
                }
            });
            generated++;
        }
        if (generated) {
            await this.notify.notify({
                userIds: await this.notify.usersWithPermission('idcard.manage'),
                type: 'people.idcardsReady',
                title: `${generated} ID card${generated === 1 ? '' : 's'} ready to print`,
                link: '/id-card?tab=cards',
                from: 'System'
            });
        }
        return {
            generated,
            skipped
        };
    }
    async assertCardAccess(c) {
        const ctx = (0, _requestcontext.requireContext)();
        const hr = ctx.permissions.has('*') || ctx.permissions.has('idcard.manage') || ctx.permissions.has('employees.manage');
        if (!hr && ctx.employeeId !== c.employeeId) throw (0, _errors.forbidden)();
    }
    async cardPdf(id) {
        const c = await this.prisma.idCard.findUnique({
            where: {
                id
            }
        });
        if (!c) throw (0, _errors.notFound)('ID card');
        await this.assertCardAccess(c);
        const e = await this.employee(c.employeeId);
        if (c.printPdfFileId) {
            const { data } = await this.storage.read(c.printPdfFileId);
            return {
                pdf: data,
                filename: `${e.empCode}-id-card.pdf`
            };
        }
        const tpl = c.templateId && await this.prisma.idCardTemplate.findUnique({
            where: {
                id: c.templateId
            }
        }) || await this.defaultTemplate();
        const sides = await this.renderSides(tpl, await this.cardData(e, c));
        return {
            pdf: await this.cardsPdf([
                {
                    tpl,
                    ...sides
                }
            ]),
            filename: `${e.empCode}-id-card-preview.pdf`
        };
    }
    async cardPng(id, side) {
        const c = await this.prisma.idCard.findUnique({
            where: {
                id
            }
        });
        if (!c) throw (0, _errors.notFound)('ID card');
        await this.assertCardAccess(c);
        const e = await this.employee(c.employeeId);
        const tpl = c.templateId && await this.prisma.idCardTemplate.findUnique({
            where: {
                id: c.templateId
            }
        }) || await this.defaultTemplate();
        const data = c.dataSnapshot ?? await this.cardData(e, c);
        const sides = await this.renderSides(tpl, data);
        return side === 'back' ? sides.back : sides.front;
    }
    async myCard() {
        const me = (0, _requestcontext.requireContext)().employeeId;
        if (!me) throw (0, _errors.notFound)('Employee');
        const c = await this.prisma.idCard.findFirst({
            where: {
                employeeId: me,
                status: {
                    in: ACTIVE
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        if (!c) return null;
        return this.row(c, await this.prisma.employee.findUnique({
            where: {
                id: me
            },
            select: {
                fullName: true,
                empCode: true
            }
        }) ?? undefined, undefined, undefined);
    }
    // ── Print batches ────────────────────────────────────────────────────────
    async sendToPrint(opts) {
        const ctx = (0, _requestcontext.requireContext)();
        const s = await this.settings();
        if (!s.printVendorEmail) throw (0, _errors.badRequest)('Set the print vendor email first', 'VENDOR_MISSING');
        const cards = await this.prisma.idCard.findMany({
            where: {
                status: 'READY',
                ...opts.cardIds?.length ? {
                    id: {
                        in: opts.cardIds
                    }
                } : {}
            },
            orderBy: {
                createdAt: 'asc'
            }
        });
        if (!cards.length) throw new _errors.AppError(409, 'NOTHING_TO_PRINT', 'No ready ID cards to send. Generate cards first.');
        const items = [];
        for (const c of cards){
            const e = await this.employee(c.employeeId);
            const tpl = c.templateId && await this.prisma.idCardTemplate.findUnique({
                where: {
                    id: c.templateId
                }
            }) || await this.defaultTemplate();
            const data = c.dataSnapshot ?? await this.cardData(e, c);
            items.push({
                tpl,
                ...await this.renderSides(tpl, data)
            });
        }
        const pdf = await this.cardsPdf(items);
        const code = await this.seq.next('idcard.printBatch', {
            prefix: 'PB-',
            pad: 3
        });
        const file = await this.storage.save({
            data: pdf,
            filename: `${code}-id-cards.pdf`,
            mime: 'application/pdf',
            category: 'id-card'
        });
        const t = await this.prisma.raw.tenant.findUnique({
            where: {
                id: ctx.tenantId
            }
        });
        const me = ctx.userId ? await this.prisma.user.findUnique({
            where: {
                id: ctx.userId
            },
            select: {
                email: true
            }
        }) : null;
        const sent = await this.mail.send({
            to: s.printVendorEmail,
            cc: me?.email,
            subject: `ID cards · ${t?.name ?? 'Lexisora'} · batch ${code} · ${cards.length} cards`,
            text: `Hello ${s.printVendorName ?? ''},\n\nPlease print the attached ${cards.length} ID card${cards.length === 1 ? '' : 's'} (CR80, front and back, 300 DPI artwork, ${cards.length * 2} pages).\n\nBatch: ${code}\n\n— ${ctx.userName ?? 'HR'}, ${t?.name ?? ''}`,
            attachments: [
                {
                    filename: `${code}-id-cards.pdf`,
                    content: pdf,
                    contentType: 'application/pdf'
                }
            ]
        });
        const batch = await this.prisma.idCardPrintBatch.create({
            data: {
                code,
                vendorEmail: s.printVendorEmail,
                cardCount: cards.length,
                pdfFileId: file.id,
                status: sent ? 'SENT' : 'FAILED',
                sentAt: new Date(),
                sentByName: ctx.userName ?? null
            }
        });
        if (!sent) throw new _errors.AppError(502, 'MAIL_FAILED', 'Could not email the print vendor; the batch is saved as failed');
        await this.prisma.idCard.updateMany({
            where: {
                id: {
                    in: cards.map((c)=>c.id)
                }
            },
            data: {
                status: 'SENT_TO_PRINT',
                printBatchId: batch.id
            }
        });
        await this.audit.record({
            action: 'idcard.sent_to_print',
            entity: 'IdCardPrintBatch',
            entityId: batch.id,
            meta: {
                cards: cards.length,
                vendor: s.printVendorEmail
            }
        });
        return {
            batchId: batch.id,
            code,
            cards: cards.length,
            vendorEmail: s.printVendorEmail
        };
    }
    async batches() {
        const rows = await this.prisma.idCardPrintBatch.findMany({
            orderBy: {
                createdAt: 'desc'
            },
            take: 100
        });
        return rows.map((b)=>({
                id: b.id,
                code: b.code,
                sentAt: b.sentAt?.toISOString() ?? null,
                cards: b.cardCount,
                vendor: b.vendorEmail,
                status: b.status,
                pdfFileId: b.pdfFileId,
                sentBy: b.sentByName
            }));
    }
    async setBatchStatus(id, status) {
        const b = await this.prisma.idCardPrintBatch.findUnique({
            where: {
                id
            }
        });
        if (!b) throw (0, _errors.notFound)('Print batch');
        await this.prisma.idCardPrintBatch.update({
            where: {
                id
            },
            data: {
                status
            }
        });
        if (status === 'DELIVERED') await this.prisma.idCard.updateMany({
            where: {
                printBatchId: id,
                status: 'SENT_TO_PRINT'
            },
            data: {
                status: 'PRINTED'
            }
        });
        await this.audit.record({
            action: 'idcard.batch_' + status.toLowerCase(),
            entity: 'IdCardPrintBatch',
            entityId: id
        });
        return {
            ok: true
        };
    }
    // ── Card lifecycle ───────────────────────────────────────────────────────
    async markIssued(id) {
        const c = await this.prisma.idCard.findUnique({
            where: {
                id
            }
        });
        if (!c) throw (0, _errors.notFound)('ID card');
        if (![
            'READY',
            'SENT_TO_PRINT',
            'PRINTED'
        ].includes(c.status)) throw new _errors.AppError(409, 'INVALID_STATUS', 'Only generated or printed cards can be issued');
        await this.prisma.idCard.update({
            where: {
                id
            },
            data: {
                status: 'ISSUED',
                issuedAt: new Date()
            }
        });
        await this.notify.notify({
            userIds: await this.notify.usersForEmployees([
                c.employeeId
            ]),
            type: 'people.idcardIssued',
            title: 'Your ID card has been issued',
            body: 'Collect it from the HR desk if you have not already.',
            link: '/me',
            from: 'HR'
        });
        await this.audit.record({
            action: 'idcard.issued',
            entity: 'IdCard',
            entityId: id
        });
        return {
            ok: true
        };
    }
    async revoke(id, reason) {
        const c = await this.prisma.idCard.findUnique({
            where: {
                id
            }
        });
        if (!c) throw (0, _errors.notFound)('ID card');
        await this.prisma.idCard.update({
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
            action: 'idcard.revoked',
            entity: 'IdCard',
            entityId: id,
            meta: {
                reason
            }
        });
        return {
            ok: true
        };
    }
    async reissue(employeeId, reason) {
        const old = await this.prisma.idCard.findFirst({
            where: {
                employeeId,
                status: {
                    in: [
                        ...ACTIVE,
                        'REVOKED'
                    ]
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        if (old) await this.prisma.idCard.update({
            where: {
                id: old.id
            },
            data: {
                status: old.status === 'QUEUED' ? 'VOID' : 'REPLACED',
                revokedAt: new Date(),
                revokeReason: reason
            }
        });
        const card = await this.ensureCard(employeeId);
        await this.audit.record({
            action: 'idcard.reissued',
            entity: 'IdCard',
            entityId: card.id,
            meta: {
                reason,
                previous: old?.id ?? null
            }
        });
        return this.row(card, await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                fullName: true,
                empCode: true
            }
        }) ?? undefined, undefined, undefined);
    }
    async surrender(employeeId) {
        await this.prisma.idCard.updateMany({
            where: {
                employeeId,
                status: {
                    in: [
                        'READY',
                        'SENT_TO_PRINT',
                        'PRINTED',
                        'ISSUED'
                    ]
                }
            },
            data: {
                status: 'SURRENDERED',
                revokedAt: new Date(),
                revokeReason: 'EXITED'
            }
        });
        await this.prisma.idCard.updateMany({
            where: {
                employeeId,
                status: 'QUEUED'
            },
            data: {
                status: 'VOID'
            }
        });
    }
    async revokeForExit(employeeId) {
        await this.prisma.idCard.updateMany({
            where: {
                employeeId,
                status: {
                    in: [
                        'READY',
                        'SENT_TO_PRINT',
                        'PRINTED',
                        'ISSUED'
                    ]
                }
            },
            data: {
                status: 'REVOKED',
                revokedAt: new Date(),
                revokeReason: 'EXITED'
            }
        });
        await this.prisma.idCard.updateMany({
            where: {
                employeeId,
                status: 'QUEUED'
            },
            data: {
                status: 'VOID'
            }
        });
    }
    // ── Public verification (QR) ─────────────────────────────────────────────
    async verifyHtml(token) {
        const c = await this.prisma.raw.idCard.findUnique({
            where: {
                verifyToken: token
            }
        });
        const page = (body)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ID card verification</title><meta name="robots" content="noindex"><style>body{margin:0;font-family:'Segoe UI',Arial,sans-serif;background:#f7f5f2;color:#201f1d;display:grid;place-items:center;min-height:100vh}.card{background:#fff;border:1px solid #d7d3d3;border-radius:10px;padding:28px;width:min(340px,90vw);text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.06)}.co{font-family:Georgia,serif;font-size:20px;border-bottom:2px solid #b68235;padding-bottom:10px;margin-bottom:16px}.ph{width:110px;height:130px;object-fit:cover;border:1px solid #d7d3d3;margin:0 auto 12px;display:block}.nm{font-family:Georgia,serif;font-size:24px}.mt{font-size:13px;color:#605d5d;margin-top:4px}.st{display:inline-block;margin-top:14px;padding:4px 12px;border-radius:4px;font-size:13px}.ok{background:#f1e4cc;color:#6e4c19}.bad{background:#fbe3e1;color:#9b2c21}.ft{font-size:11px;color:#9a9696;margin-top:16px}</style></head><body><div class="card">${body}</div></body></html>`;
        if (!c) return {
            status: 404,
            html: page('<div class="nm">Card not found</div><div class="mt">This QR code does not match any ID card.</div>')
        };
        const [e, t] = await Promise.all([
            this.prisma.raw.employee.findUnique({
                where: {
                    id: c.employeeId
                },
                include: {
                    designation: true
                }
            }),
            this.prisma.raw.tenant.findUnique({
                where: {
                    id: c.tenantId
                }
            })
        ]);
        let photo = '';
        if (e?.photoFileId) {
            try {
                const { data } = await this.storage.read(e.photoFileId, c.tenantId);
                const url = await (0, _cardrender.toDataUrl)(data, 300);
                if (url) photo = `<img class="ph" src="${url}" alt="">`;
            } catch  {
            /* no photo */ }
        }
        const valid = [
            'READY',
            'SENT_TO_PRINT',
            'PRINTED',
            'ISSUED'
        ].includes(c.status) && e?.status !== 'EXITED';
        const label = valid ? 'Valid' : c.status === 'QUEUED' ? 'Not yet issued' : 'Revoked';
        await this.audit.recordRaw(c.tenantId, {
            action: 'idcard.verified_public',
            entity: 'IdCard',
            entityId: c.id,
            meta: {
                status: label
            }
        });
        const esc = (s)=>s.replace(/[&<>"']/g, (ch)=>({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;'
                })[ch]);
        return {
            status: 200,
            html: page(`<div class="co">${esc(t?.name ?? '')}</div>${photo}<div class="nm">${esc(e?.fullName ?? '—')}</div><div class="mt">${esc(e?.designation?.name ?? '')}</div><div class="mt">${esc(e?.empCode ?? '')} · ${esc(c.serial)}</div><div class="st ${valid ? 'ok' : 'bad'}">${label}</div><div class="ft">Checked ${esc((0, _peopleutil.fmtStamp)(new Date()))} IST</div>`)
        };
    }
    /** Scan helper for Time's ID compliance (authenticated). */ async scan(token) {
        const c = await this.prisma.idCard.findFirst({
            where: {
                verifyToken: token
            }
        });
        if (!c) throw (0, _errors.notFound)('ID card');
        return {
            employeeId: c.employeeId,
            status: c.status,
            generatedAt: (0, _peopleutil.dbDateKey)(c.generatedAt)
        };
    }
};
IdCardsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _settingsservice.SettingsService === "undefined" ? Object : _settingsservice.SettingsService,
        typeof _sequenceservice.SequenceService === "undefined" ? Object : _sequenceservice.SequenceService,
        typeof _storageservice.StorageService === "undefined" ? Object : _storageservice.StorageService,
        typeof _pdfservice.PdfService === "undefined" ? Object : _pdfservice.PdfService,
        typeof _mailservice.MailService === "undefined" ? Object : _mailservice.MailService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], IdCardsService);

//# sourceMappingURL=idcards.service.js.map