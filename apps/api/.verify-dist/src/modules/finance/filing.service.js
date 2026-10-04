"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "FilingService", {
    enumerable: true,
    get: function() {
        return FilingService;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../core/prisma/prisma.service");
const _auditservice = require("../../core/audit/audit.service");
const _storageservice = require("../../core/storage/storage.service");
const _requestcontext = require("../../core/context/request-context");
const _errors = require("../../core/http/errors");
const _paginate = require("../../core/http/paginate");
const _coa = require("./lib/coa");
const _money = require("./lib/money");
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
const LOCKED_LINKS = new Set([
    'PURCHASE',
    'INVOICE'
]);
const FILING_MIME = /^(application\/pdf|image\/(png|jpe?g|webp)|text\/(csv|plain)|application\/(json|zip|msword|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.[\w.]+))$/;
const cleanTags = (tags)=>[
        ...new Set(tags.map((t)=>t.trim().toLowerCase().slice(0, 32)).filter(Boolean))
    ].slice(0, 10);
let FilingService = class FilingService {
    prisma;
    audit;
    storage;
    constructor(prisma, audit, storage){
        this.prisma = prisma;
        this.audit = audit;
        this.storage = storage;
    }
    async ensureFolders() {
        const rows = await this.prisma.filingFolder.findMany({
            where: {
                systemKey: {
                    not: null
                }
            },
            select: {
                id: true,
                systemKey: true
            }
        });
        const map = new Map(rows.map((r)=>[
                r.systemKey,
                r.id
            ]));
        let order = 0;
        for (const f of _coa.SYSTEM_FOLDERS){
            order++;
            if (map.has(f.key)) continue;
            const row = await this.prisma.filingFolder.create({
                data: {
                    name: f.name,
                    systemKey: f.key,
                    isSystem: true,
                    sortOrder: order,
                    parentId: f.parent ? map.get(f.parent) ?? null : null
                }
            });
            map.set(f.key, row.id);
        }
        return map;
    }
    /** Folder id → count of live documents in it and all its descendants. */ async counts() {
        const [folders, grouped] = await Promise.all([
            this.prisma.filingFolder.findMany({
                orderBy: [
                    {
                        sortOrder: 'asc'
                    },
                    {
                        name: 'asc'
                    }
                ]
            }),
            this.prisma.filingDocument.groupBy({
                by: [
                    'folderId'
                ],
                where: {
                    deletedAt: null
                },
                _count: {
                    _all: true
                }
            })
        ]);
        const own = new Map(grouped.map((g)=>[
                g.folderId,
                g._count._all
            ]));
        const total = new Map();
        const children = new Map();
        for (const f of folders)if (f.parentId) children.set(f.parentId, [
            ...children.get(f.parentId) ?? [],
            f.id
        ]);
        const sum = (id, depth = 0)=>{
            if (total.has(id)) return total.get(id);
            const n = (own.get(id) ?? 0) + (depth > 8 ? 0 : (children.get(id) ?? []).reduce((s, c)=>s + sum(c, depth + 1), 0));
            total.set(id, n);
            return n;
        };
        folders.forEach((f)=>sum(f.id));
        return {
            folders,
            total
        };
    }
    tile(f, total) {
        return {
            id: f.id,
            name: f.name,
            systemKey: f.systemKey,
            isSystem: f.isSystem,
            parentId: f.parentId,
            files: total.get(f.id) ?? 0
        };
    }
    async tiles() {
        await this.ensureFolders();
        const { folders, total } = await this.counts();
        return {
            folders: folders.filter((f)=>!f.parentId).map((f)=>this.tile(f, total)),
            all: folders.map((f)=>this.tile(f, total))
        };
    }
    toRow(d) {
        return {
            id: d.id,
            folderId: d.folderId,
            folderName: d.folder.name,
            fileId: d.fileId,
            title: d.title,
            mime: d.mime,
            sizeBytes: d.sizeBytes,
            tags: d.tags,
            fy: d.fy,
            docDate: d.docDate ? (0, _money.dateKeyOf)(d.docDate) : null,
            uploadedAt: d.uploadedAt.toISOString(),
            uploadedByName: d.uploadedByName,
            linkedEntityType: d.linkedEntityType,
            linkedEntityId: d.linkedEntityId,
            linkedRef: d.linkedRef,
            locked: LOCKED_LINKS.has(d.linkedEntityType ?? '')
        };
    }
    docWhere(q) {
        return {
            deletedAt: null,
            ...q.q ? {
                OR: [
                    {
                        title: {
                            contains: q.q,
                            mode: 'insensitive'
                        }
                    },
                    {
                        tags: {
                            has: q.q.toLowerCase()
                        }
                    },
                    {
                        linkedRef: {
                            contains: q.q,
                            mode: 'insensitive'
                        }
                    }
                ]
            } : {},
            ...q.tag ? {
                tags: {
                    has: q.tag.toLowerCase()
                }
            } : {},
            ...q.fy ? {
                fy: q.fy
            } : {}
        };
    }
    async folder(id, q) {
        const { folders, total } = await this.counts();
        const f = folders.find((x)=>x.id === id);
        if (!f) throw (0, _errors.notFound)('Folder');
        const breadcrumb = [];
        let cur = f;
        for(let i = 0; cur && i < 10; i++){
            breadcrumb.unshift({
                id: cur.id,
                name: cur.name
            });
            cur = cur.parentId ? folders.find((x)=>x.id === cur.parentId) : undefined;
        }
        const where = {
            ...this.docWhere(q),
            folderId: id
        };
        const [docs, count, tagRows] = await Promise.all([
            this.prisma.filingDocument.findMany({
                where,
                include: {
                    folder: true
                },
                orderBy: [
                    {
                        uploadedAt: 'desc'
                    }
                ],
                ...(0, _paginate.pageArgs)(q)
            }),
            this.prisma.filingDocument.count({
                where
            }),
            this.prisma.filingDocument.findMany({
                where: {
                    folderId: id,
                    deletedAt: null
                },
                select: {
                    tags: true,
                    fy: true
                },
                take: 5000
            })
        ]);
        const tags = [
            ...new Set(tagRows.flatMap((t)=>t.tags))
        ].sort().slice(0, 40);
        const fys = [
            ...new Set(tagRows.map((t)=>t.fy).filter((x)=>!!x))
        ].sort().reverse();
        return {
            folder: this.tile(f, total),
            breadcrumb,
            subfolders: folders.filter((x)=>x.parentId === id).map((x)=>this.tile(x, total)),
            documents: docs.map((d)=>this.toRow(d)),
            total: count,
            page: q.page,
            pageSize: q.pageSize,
            tags,
            fys
        };
    }
    async search(q) {
        const where = this.docWhere(q);
        const [docs, count] = await Promise.all([
            this.prisma.filingDocument.findMany({
                where,
                include: {
                    folder: true
                },
                orderBy: {
                    uploadedAt: 'desc'
                },
                ...(0, _paginate.pageArgs)(q)
            }),
            this.prisma.filingDocument.count({
                where
            })
        ]);
        return (0, _paginate.paginated)(docs.map((d)=>this.toRow(d)), count, q);
    }
    async createFolder(name, parentId) {
        if (parentId && !await this.prisma.filingFolder.findFirst({
            where: {
                id: parentId
            }
        })) throw (0, _errors.badRequest)('Parent folder not found');
        const dup = await this.prisma.filingFolder.findFirst({
            where: {
                parentId: parentId ?? null,
                name: {
                    equals: name,
                    mode: 'insensitive'
                }
            }
        });
        if (dup) throw (0, _errors.conflict)(`A folder named “${name}” already exists here`);
        const row = await this.prisma.filingFolder.create({
            data: {
                name,
                parentId: parentId ?? null
            }
        });
        await this.audit.record({
            action: 'filing.folder.created',
            entity: 'FilingFolder',
            entityId: row.id,
            meta: {
                name
            }
        });
        return row;
    }
    async deleteFolder(id) {
        const f = await this.prisma.filingFolder.findFirst({
            where: {
                id
            }
        });
        if (!f) throw (0, _errors.notFound)('Folder');
        if (f.isSystem) throw (0, _errors.badRequest)('System folders cannot be deleted');
        const [docs, subs] = await Promise.all([
            this.prisma.filingDocument.count({
                where: {
                    folderId: id,
                    deletedAt: null
                }
            }),
            this.prisma.filingFolder.count({
                where: {
                    parentId: id
                }
            })
        ]);
        if (docs || subs) throw (0, _errors.conflict)('Only empty folders can be deleted');
        await this.prisma.filingDocument.deleteMany({
            where: {
                folderId: id
            }
        });
        await this.prisma.filingFolder.delete({
            where: {
                id
            }
        });
        await this.audit.record({
            action: 'filing.folder.deleted',
            entity: 'FilingFolder',
            entityId: id,
            meta: {
                name: f.name
            }
        });
    }
    async upload(input) {
        const ctx = (0, _requestcontext.requireContext)();
        const folder = await this.prisma.filingFolder.findFirst({
            where: {
                id: input.folderId
            }
        });
        if (!folder) throw (0, _errors.badRequest)('Pick a folder');
        const files = await this.prisma.fileObject.findMany({
            where: {
                id: {
                    in: input.fileIds
                }
            }
        });
        if (files.length !== new Set(input.fileIds).size) throw (0, _errors.badRequest)('Some files were not uploaded — try again');
        for (const f of files){
            if (!FILING_MIME.test(f.mime)) throw new _errors.AppError(422, 'FILE_TYPE', `${f.filename}: this file type can't be filed`);
            if (f.size > 25 * 1024 * 1024) throw new _errors.AppError(422, 'FILE_TOO_LARGE', `${f.filename} is larger than 25 MB`);
        }
        const docDate = input.docDate ? (0, _money.dateOnly)(input.docDate) : (0, _money.todayDate)();
        const tags = cleanTags(input.tags);
        const created = [];
        for (const f of files){
            const d = await this.prisma.filingDocument.create({
                data: {
                    folderId: folder.id,
                    fileId: f.id,
                    title: f.filename,
                    mime: f.mime,
                    sizeBytes: f.size,
                    tags,
                    fy: (0, _money.fyOf)(docDate),
                    docDate,
                    uploadedByUserId: ctx.userId ?? null,
                    uploadedByName: ctx.userName ?? null
                }
            });
            created.push(d);
            await this.audit.record({
                action: 'filing.document.uploaded',
                entity: 'FilingDocument',
                entityId: d.id,
                meta: {
                    title: d.title,
                    folder: folder.name,
                    tags
                }
            });
        }
        return {
            count: created.length,
            ids: created.map((d)=>d.id)
        };
    }
    async update(id, input) {
        const d = await this.prisma.filingDocument.findFirst({
            where: {
                id,
                deletedAt: null
            }
        });
        if (!d) throw (0, _errors.notFound)('Document');
        if (input.folderId && !await this.prisma.filingFolder.findFirst({
            where: {
                id: input.folderId
            }
        })) throw (0, _errors.badRequest)('Folder not found');
        const row = await this.prisma.filingDocument.update({
            where: {
                id
            },
            data: {
                ...input.title ? {
                    title: input.title
                } : {},
                ...input.tags ? {
                    tags: cleanTags(input.tags)
                } : {},
                ...input.folderId ? {
                    folderId: input.folderId
                } : {}
            }
        });
        await this.audit.record({
            action: 'filing.document.updated',
            entity: 'FilingDocument',
            entityId: id,
            meta: input
        });
        return row;
    }
    async remove(id) {
        const ctx = (0, _requestcontext.requireContext)();
        const d = await this.prisma.filingDocument.findFirst({
            where: {
                id,
                deletedAt: null
            }
        });
        if (!d) throw (0, _errors.notFound)('Document');
        if (LOCKED_LINKS.has(d.linkedEntityType ?? '')) {
            throw new _errors.AppError(409, 'RETENTION_LOCKED', `This document is linked to ${d.linkedRef ?? 'a posted record'} and must be kept for 8 years (GST record retention)`);
        }
        await this.prisma.filingDocument.update({
            where: {
                id
            },
            data: {
                deletedAt: new Date()
            }
        });
        await this.audit.record({
            action: 'filing.document.deleted',
            entity: 'FilingDocument',
            entityId: id,
            meta: {
                title: d.title,
                by: ctx.userName ?? null
            }
        });
    }
    async download(id) {
        const d = await this.prisma.filingDocument.findFirst({
            where: {
                id,
                deletedAt: null
            }
        });
        if (!d) throw (0, _errors.notFound)('Document');
        const { row, data } = await this.storage.read(d.fileId);
        await this.audit.record({
            action: 'filing.document.downloaded',
            entity: 'FilingDocument',
            entityId: id,
            meta: {
                title: d.title
            }
        });
        const ext = row.filename.includes('.') ? '' : row.mime === 'application/pdf' ? '.pdf' : '';
        return {
            data,
            mime: row.mime,
            filename: /\.\w{2,5}$/.test(d.title) ? d.title : `${d.title}${ext}`
        };
    }
    /** Auto-file a generated/uploaded document (invoice PDFs, purchase bills, GST returns). Idempotent per link. */ async autoFile(i) {
        const ctx = (0, _requestcontext.requireContext)();
        const folders = await this.ensureFolders();
        const folderId = folders.get(i.folderKey);
        if (i.linkedEntityType && i.linkedEntityId) {
            const existing = await this.prisma.filingDocument.findFirst({
                where: {
                    linkedEntityType: i.linkedEntityType,
                    linkedEntityId: i.linkedEntityId,
                    fileId: i.fileId,
                    deletedAt: null
                }
            });
            if (existing) return existing;
        }
        const file = await this.prisma.fileObject.findFirst({
            where: {
                id: i.fileId
            }
        });
        const docDate = i.docDate ?? (0, _money.todayDate)();
        return this.prisma.filingDocument.create({
            data: {
                folderId,
                fileId: i.fileId,
                title: i.title,
                mime: file?.mime ?? 'application/pdf',
                sizeBytes: file?.size ?? 0,
                tags: cleanTags(i.tags),
                fy: (0, _money.fyOf)(docDate),
                docDate,
                linkedEntityType: i.linkedEntityType ?? null,
                linkedEntityId: i.linkedEntityId ?? null,
                linkedRef: i.linkedRef ?? null,
                uploadedByUserId: ctx.userId ?? null,
                uploadedByName: ctx.userName ?? 'System'
            }
        });
    }
    /** Is this file referenced by a filing document? (file access checker). */ async referencesFile(fileId) {
        return !!await this.prisma.filingDocument.findFirst({
            where: {
                fileId
            },
            select: {
                id: true
            }
        });
    }
};
FilingService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _storageservice.StorageService === "undefined" ? Object : _storageservice.StorageService
    ])
], FilingService);

//# sourceMappingURL=filing.service.js.map