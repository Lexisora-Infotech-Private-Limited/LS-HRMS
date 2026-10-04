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
    get ALLOWED_UPLOAD_MIME () {
        return ALLOWED_UPLOAD_MIME;
    },
    get MAX_UPLOAD_BYTES () {
        return MAX_UPLOAD_BYTES;
    },
    get StorageService () {
        return StorageService;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _promises = require("node:fs/promises");
const _nodepath = require("node:path");
const _env = require("../../config/env");
const _prismaservice = require("../prisma/prisma.service");
const _requestcontext = require("../context/request-context");
const _errors = require("../http/errors");
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
let LocalDiskDriver = class LocalDiskDriver {
    root = (0, _nodepath.resolve)(_env.env.STORAGE_DIR);
    path(key) {
        const p = (0, _nodepath.resolve)((0, _nodepath.join)(this.root, key));
        if (!p.startsWith(this.root)) throw new Error('Invalid storage key');
        return p;
    }
    async put(key, data) {
        const p = this.path(key);
        await (0, _promises.mkdir)((0, _nodepath.dirname)(p), {
            recursive: true
        });
        await (0, _promises.writeFile)(p, data);
    }
    get(key) {
        return (0, _promises.readFile)(this.path(key));
    }
    async remove(key) {
        await (0, _promises.rm)(this.path(key), {
            force: true
        });
    }
};
const ALLOWED_UPLOAD_MIME = /^(image\/(png|jpe?g|webp|gif|svg\+xml)|application\/pdf|text\/(csv|plain)|video\/(mp4|webm)|application\/(zip|vnd\.openxmlformats-officedocument\.[\w.]+|msword|vnd\.ms-excel))$/;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // course videos can be large
let StorageService = class StorageService {
    prisma;
    driver = new LocalDiskDriver();
    constructor(prisma){
        this.prisma = prisma;
    }
    /** Persist bytes and create a FileObject row in the current tenant. */ async save(input) {
        const tenantId = input.tenantId ?? (0, _requestcontext.requireContext)().tenantId;
        const safeName = input.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 180) || 'file';
        const key = `${tenantId}/${input.category}/${new Date().toISOString().slice(0, 7)}/${(0, _nodecrypto.randomUUID)()}-${safeName}`;
        await this.driver.put(key, input.data, input.mime);
        const row = await this.prisma.raw.fileObject.create({
            data: {
                tenantId,
                ownerUserId: input.ownerUserId ?? (0, _requestcontext.getContext)()?.userId ?? null,
                storageKey: key,
                filename: safeName,
                mime: input.mime,
                size: input.data.length,
                sha256: (0, _nodecrypto.createHash)('sha256').update(input.data).digest('hex'),
                category: input.category,
                isPrivate: input.isPrivate ?? true
            }
        });
        return {
            id: row.id,
            filename: row.filename,
            mime: row.mime,
            size: row.size,
            url: this.url(row.id)
        };
    }
    /** Authenticated download URL (the web client appends ?access_token=…). */ url(fileId) {
        return `/api/v1/files/${fileId}`;
    }
    async read(fileId, tenantId) {
        const row = await this.prisma.raw.fileObject.findUnique({
            where: {
                id: fileId
            }
        });
        const t = tenantId ?? (0, _requestcontext.getContext)()?.tenantId;
        if (!row || t && row.tenantId !== t) throw (0, _errors.notFound)('File');
        return {
            row,
            data: await this.driver.get(row.storageKey)
        };
    }
    async remove(fileId) {
        const row = await this.prisma.fileObject.findUnique({
            where: {
                id: fileId
            }
        });
        if (!row) return;
        await this.driver.remove(row.storageKey);
        await this.prisma.fileObject.delete({
            where: {
                id: fileId
            }
        });
    }
};
StorageService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], StorageService);

//# sourceMappingURL=storage.service.js.map