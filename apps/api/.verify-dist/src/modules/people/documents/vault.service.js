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
    get DOC_TYPE_CATEGORY () {
        return DOC_TYPE_CATEGORY;
    },
    get DOC_TYPE_TITLE () {
        return DOC_TYPE_TITLE;
    },
    get VaultService () {
        return VaultService;
    },
    get vaultStatus () {
        return vaultStatus;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _auditservice = require("../../../core/audit/audit.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _storageservice = require("../../../core/storage/storage.service");
const _peopleutil = require("../people.util");
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
const DOC_TYPE_CATEGORY = {
    OFFER_LETTER: 'OFFER_COMPENSATION',
    COMPENSATION_BREAKDOWN: 'OFFER_COMPENSATION',
    NDA: 'LEGAL',
    POLICY_ACK: 'LEGAL',
    PAN: 'GOVERNMENT_ID',
    AADHAAR: 'GOVERNMENT_ID',
    PASSPORT: 'GOVERNMENT_ID',
    MARKSHEET_10: 'EDUCATION',
    MARKSHEET_12: 'EDUCATION',
    DEGREE: 'EDUCATION',
    PREV_EMPLOYMENT: 'EMPLOYMENT',
    EXPERIENCE_LETTER: 'EMPLOYMENT',
    RELIEVING_LETTER: 'EXIT',
    CANCELLED_CHEQUE: 'BANK_TAX',
    RESUME: 'CAREER',
    CERTIFICATE: 'CERTIFICATE',
    OTHER: 'OTHER'
};
const DOC_TYPE_TITLE = {
    OFFER_LETTER: 'Offer letter',
    COMPENSATION_BREAKDOWN: 'Compensation breakdown',
    NDA: 'NDA',
    POLICY_ACK: 'Policy acknowledgement',
    PAN: 'PAN card',
    AADHAAR: 'Aadhaar card',
    PASSPORT: 'Passport',
    MARKSHEET_10: '10th marksheet',
    MARKSHEET_12: '12th marksheet',
    DEGREE: 'Degree marksheets',
    PREV_EMPLOYMENT: 'Previous employment letter',
    EXPERIENCE_LETTER: 'Experience letter',
    RELIEVING_LETTER: 'Relieving letter',
    CANCELLED_CHEQUE: 'Cancelled cheque',
    RESUME: 'Resume',
    CERTIFICATE: 'Certificate',
    OTHER: 'Document'
};
/** Types HR must verify; the rest are NOT_REQUIRED. */ const NEEDS_VERIFICATION = new Set([
    'PAN',
    'AADHAAR',
    'PASSPORT',
    'MARKSHEET_10',
    'MARKSHEET_12',
    'DEGREE',
    'PREV_EMPLOYMENT',
    'EXPERIENCE_LETTER',
    'RELIEVING_LETTER',
    'CANCELLED_CHEQUE'
]);
/** Types where a new upload replaces the previous one (versioned). */ const SINGLE_INSTANCE = new Set([
    'PAN',
    'AADHAAR',
    'PASSPORT',
    'MARKSHEET_10',
    'MARKSHEET_12',
    'CANCELLED_CHEQUE',
    'RESUME'
]);
const SENSITIVE = new Set([
    'GOVERNMENT_ID',
    'BANK_TAX',
    'OFFER_COMPENSATION'
]);
function vaultStatus(d) {
    if (d.source === 'ESIGNED') return {
        status: 'SIGNED',
        label: 'Signed'
    };
    if (d.docType === 'COMPENSATION_BREAKDOWN') return d.isCurrent ? {
        status: 'CURRENT',
        label: 'Current'
    } : {
        status: 'SUPERSEDED',
        label: 'Superseded'
    };
    switch(d.verificationStatus){
        case 'VERIFIED':
            return {
                status: 'VERIFIED',
                label: 'Verified'
            };
        case 'PENDING':
            return {
                status: 'PENDING',
                label: 'Pending'
            };
        case 'REJECTED':
            return {
                status: 'REJECTED',
                label: 'Rejected · re-upload'
            };
        default:
            return {
                status: 'NA',
                label: '—'
            };
    }
}
const isHrCtx = ()=>{
    const ctx = (0, _requestcontext.requireContext)();
    return ctx.permissions.has('*') || ctx.permissions.has('employees.manage') || ctx.permissions.has('onboarding.manage');
};
let VaultService = class VaultService {
    prisma;
    storage;
    audit;
    notify;
    constructor(prisma, storage, audit, notify){
        this.prisma = prisma;
        this.storage = storage;
        this.audit = audit;
        this.notify = notify;
    }
    assertVaultAccess(employeeId) {
        const ctx = (0, _requestcontext.requireContext)();
        if (ctx.employeeId !== employeeId && !isHrCtx()) throw (0, _errors.forbidden)('Documents are visible only to the employee and HR');
    }
    toRow(d) {
        const s = vaultStatus(d);
        const ctx = (0, _requestcontext.requireContext)();
        const own = d.employeeId === ctx.employeeId;
        return {
            id: d.id,
            title: d.title,
            category: d.category,
            categoryLabel: _shared.DOC_CATEGORY_LABELS[d.category],
            docType: d.docType,
            uploadedAt: (0, _peopleutil.dbDateKey)(d.uploadedAt),
            status: s.status,
            statusLabel: s.label,
            fileId: d.fileId,
            rejectionReason: d.rejectionReason,
            canDelete: own && d.source === 'SELF_UPLOAD' && d.verificationStatus !== 'VERIFIED' || isHrCtx() && d.source !== 'ESIGNED',
            version: d.version
        };
    }
    async listFor(employeeId, category) {
        this.assertVaultAccess(employeeId);
        const rows = await this.prisma.employeeDocument.findMany({
            where: {
                employeeId,
                deletedAt: null,
                isCurrent: true,
                ...category ? {
                    category: category
                } : {}
            },
            orderBy: [
                {
                    uploadedAt: 'asc'
                }
            ]
        });
        // Order by category the way the vault groups them.
        const order = Object.keys(_shared.DOC_CATEGORY_LABELS);
        return rows.sort((a, b)=>order.indexOf(a.category) - order.indexOf(b.category) || a.uploadedAt.getTime() - b.uploadedAt.getTime()).map((d)=>this.toRow(d));
    }
    async versions(docId) {
        const d = await this.prisma.employeeDocument.findUnique({
            where: {
                id: docId
            }
        });
        if (!d) throw (0, _errors.notFound)('Document');
        this.assertVaultAccess(d.employeeId);
        const chain = [];
        const all = await this.prisma.employeeDocument.findMany({
            where: {
                employeeId: d.employeeId,
                docType: d.docType,
                deletedAt: null
            },
            orderBy: {
                version: 'desc'
            }
        });
        for (const x of all)chain.push(x);
        return chain.map((x)=>({
                ...this.toRow(x),
                isCurrent: x.isCurrent,
                verifiedBy: x.verifiedByName
            }));
    }
    /**
   * Add a document. Self uploads need HR verification for identity/education types;
   * single-instance types (PAN, Aadhaar…) supersede the current version.
   */ async add(employeeId, i) {
        const ctx = (0, _requestcontext.requireContext)();
        const file = await this.prisma.fileObject.findUnique({
            where: {
                id: i.fileId
            }
        });
        if (!file) throw (0, _errors.badRequest)('Upload the file first', 'FILE_MISSING');
        if (i.source === 'SELF_UPLOAD' && !/^(application\/pdf|image\/(png|jpe?g|webp))$/.test(file.mime)) throw new _errors.AppError(422, 'FILE_TYPE', 'Upload a PDF, JPG or PNG');
        if (i.source === 'SELF_UPLOAD' && file.size > 10 * 1024 * 1024) throw new _errors.AppError(422, 'FILE_TOO_LARGE', 'Documents are limited to 10 MB');
        if (file.sha256) {
            const dup = await this.prisma.employeeDocument.findFirst({
                where: {
                    employeeId,
                    docType: i.docType,
                    deletedAt: null,
                    isCurrent: true,
                    fileId: {
                        not: i.fileId
                    }
                },
                select: {
                    fileId: true
                }
            });
            if (dup) {
                const f2 = await this.prisma.fileObject.findUnique({
                    where: {
                        id: dup.fileId
                    },
                    select: {
                        sha256: true
                    }
                });
                if (f2?.sha256 && f2.sha256 === file.sha256) throw new _errors.AppError(409, 'DUPLICATE_DOCUMENT', 'This exact file is already in your vault');
            }
        }
        let previous = null;
        if (SINGLE_INSTANCE.has(i.docType) || i.source === 'GENERATED') {
            previous = await this.prisma.employeeDocument.findFirst({
                where: {
                    employeeId,
                    docType: i.docType,
                    isCurrent: true,
                    deletedAt: null
                },
                orderBy: {
                    version: 'desc'
                }
            });
        } else {
            previous = await this.prisma.employeeDocument.findFirst({
                where: {
                    employeeId,
                    docType: i.docType,
                    isCurrent: true,
                    deletedAt: null,
                    verificationStatus: 'REJECTED'
                },
                orderBy: {
                    version: 'desc'
                }
            });
        }
        if (previous?.source === 'ESIGNED') previous = null;
        const verification = i.verificationStatus ?? (NEEDS_VERIFICATION.has(i.docType) ? i.source === 'HR_UPLOAD' ? 'VERIFIED' : 'PENDING' : 'NOT_REQUIRED');
        const doc = await this.prisma.employeeDocument.create({
            data: {
                employeeId,
                category: DOC_TYPE_CATEGORY[i.docType],
                docType: i.docType,
                title: i.title?.trim() || DOC_TYPE_TITLE[i.docType],
                fileId: i.fileId,
                version: previous ? previous.version + 1 : 1,
                supersedesId: previous?.id ?? null,
                source: i.source,
                verificationStatus: verification,
                verifiedByName: verification === 'VERIFIED' && i.source === 'HR_UPLOAD' ? ctx.userName ?? null : null,
                verifiedAt: verification === 'VERIFIED' && i.source === 'HR_UPLOAD' ? new Date() : null,
                esignEnvelopeId: i.esignEnvelopeId ?? null,
                tags: i.tags ?? [],
                uploadedByUserId: ctx.userId ?? null
            }
        });
        if (previous) await this.prisma.employeeDocument.update({
            where: {
                id: previous.id
            },
            data: {
                isCurrent: false
            }
        });
        await this.audit.record({
            action: 'document.uploaded',
            entity: 'EmployeeDocument',
            entityId: doc.id,
            meta: {
                employeeId,
                docType: i.docType,
                version: doc.version,
                source: i.source
            }
        });
        if (verification === 'PENDING') {
            const e = await this.prisma.employee.findUnique({
                where: {
                    id: employeeId
                },
                select: {
                    fullName: true
                }
            });
            await this.notify.notify({
                userIds: await this.notify.usersWithPermission('onboarding.manage'),
                type: 'people.documentPending',
                title: `${e?.fullName ?? 'An employee'} uploaded ${doc.title}`,
                body: 'Verify it in Paperless onboarding → Document verification.',
                link: '/onboarding?tab=verification',
                from: 'System'
            });
        }
        return doc;
    }
    /** Vault "Upload document" (self) or HR upload onto someone's profile. */ async upload(employeeId, i) {
        this.assertVaultAccess(employeeId);
        const ctx = (0, _requestcontext.requireContext)();
        const self = ctx.employeeId === employeeId;
        if ([
            'OFFER_LETTER',
            'NDA',
            'COMPENSATION_BREAKDOWN',
            'POLICY_ACK'
        ].includes(i.docType) && self && !isHrCtx()) {
            throw (0, _errors.forbidden)('Signed and generated documents are added by the system');
        }
        const tags = (i.tags ?? '').split(',').map((t)=>t.trim()).filter(Boolean).slice(0, 10);
        const doc = await this.add(employeeId, {
            docType: i.docType,
            fileId: i.fileId,
            title: i.title,
            tags,
            source: self ? 'SELF_UPLOAD' : 'HR_UPLOAD'
        });
        return this.toRow(doc);
    }
    async verify(docId, decision, reason) {
        const ctx = (0, _requestcontext.requireContext)();
        const d = await this.prisma.employeeDocument.findUnique({
            where: {
                id: docId
            }
        });
        if (!d || d.deletedAt) throw (0, _errors.notFound)('Document');
        if (d.source === 'ESIGNED' || d.source === 'GENERATED') throw new _errors.AppError(409, 'IMMUTABLE', 'Signed and generated documents need no verification');
        if (decision === 'REJECTED' && !reason?.trim()) throw (0, _errors.badRequest)('Give a reason so the employee can fix it', 'REASON_REQUIRED');
        await this.prisma.employeeDocument.update({
            where: {
                id: docId
            },
            data: {
                verificationStatus: decision,
                verifiedByUserId: ctx.userId ?? null,
                verifiedByName: ctx.userName ?? null,
                verifiedAt: new Date(),
                rejectionReason: decision === 'REJECTED' ? reason.trim() : null
            }
        });
        await this.audit.record({
            action: decision === 'VERIFIED' ? 'document.verified' : 'document.rejected',
            entity: 'EmployeeDocument',
            entityId: docId,
            meta: {
                employeeId: d.employeeId,
                docType: d.docType,
                reason: reason ?? null
            }
        });
        if (decision === 'REJECTED') {
            await this.notify.notify({
                userIds: await this.notify.usersForEmployees([
                    d.employeeId
                ]),
                type: 'people.documentRejected',
                title: `${d.title} needs a re-upload`,
                body: `HR: ${reason}`,
                link: '/vault',
                from: 'HR',
                email: true
            });
        }
        return {
            employeeId: d.employeeId,
            docType: d.docType,
            decision
        };
    }
    async remove(docId) {
        const ctx = (0, _requestcontext.requireContext)();
        const d = await this.prisma.employeeDocument.findUnique({
            where: {
                id: docId
            }
        });
        if (!d || d.deletedAt) throw (0, _errors.notFound)('Document');
        const own = d.employeeId === ctx.employeeId && d.source === 'SELF_UPLOAD' && d.verificationStatus !== 'VERIFIED';
        if (!own && !(isHrCtx() && d.source !== 'ESIGNED')) throw (0, _errors.forbidden)('You can delete only your own unverified uploads');
        await this.prisma.employeeDocument.update({
            where: {
                id: docId
            },
            data: {
                deletedAt: new Date(),
                isCurrent: false
            }
        });
        if (d.supersedesId) await this.prisma.employeeDocument.updateMany({
            where: {
                id: d.supersedesId,
                deletedAt: null
            },
            data: {
                isCurrent: true
            }
        });
        await this.audit.record({
            action: 'document.deleted',
            entity: 'EmployeeDocument',
            entityId: docId,
            meta: {
                employeeId: d.employeeId,
                docType: d.docType
            }
        });
        return {
            ok: true
        };
    }
    async download(docId) {
        const d = await this.prisma.employeeDocument.findUnique({
            where: {
                id: docId
            }
        });
        if (!d || d.deletedAt) throw (0, _errors.notFound)('Document');
        this.assertVaultAccess(d.employeeId);
        const { row, data } = await this.storage.read(d.fileId);
        if (SENSITIVE.has(d.category)) await this.audit.record({
            action: 'document.downloaded',
            entity: 'EmployeeDocument',
            entityId: docId,
            meta: {
                employeeId: d.employeeId,
                docType: d.docType
            }
        });
        return {
            data,
            mime: row.mime,
            filename: row.filename
        };
    }
    /** HR verification queue (Paperless onboarding → Document verification). */ async queue(employeeId) {
        if (!isHrCtx()) throw (0, _errors.forbidden)();
        const rows = await this.prisma.employeeDocument.findMany({
            where: {
                verificationStatus: 'PENDING',
                deletedAt: null,
                isCurrent: true,
                ...employeeId ? {
                    employeeId
                } : {}
            },
            orderBy: {
                uploadedAt: 'asc'
            },
            take: 200
        });
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: rows.map((r)=>r.employeeId)
                }
            },
            select: {
                id: true,
                fullName: true,
                empCode: true,
                panEnc: true,
                aadhaarLast4: true
            }
        });
        const em = new Map(emps.map((e)=>[
                e.id,
                e
            ]));
        return rows.map((d)=>({
                ...this.toRow(d),
                employeeId: d.employeeId,
                employee: em.get(d.employeeId)?.fullName ?? '—',
                empCode: em.get(d.employeeId)?.empCode ?? '',
                captured: d.docType === 'AADHAAR' && em.get(d.employeeId)?.aadhaarLast4 ? `XXXX XXXX ${em.get(d.employeeId).aadhaarLast4}` : null
            }));
    }
    async pendingCount() {
        return this.prisma.employeeDocument.count({
            where: {
                verificationStatus: 'PENDING',
                deletedAt: null,
                isCurrent: true
            }
        });
    }
};
VaultService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _storageservice.StorageService === "undefined" ? Object : _storageservice.StorageService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService
    ])
], VaultService);

//# sourceMappingURL=vault.service.js.map