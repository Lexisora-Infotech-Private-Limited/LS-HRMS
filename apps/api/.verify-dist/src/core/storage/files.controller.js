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
    get FilesController () {
        return FilesController;
    },
    get fileAccessCheckers () {
        return fileAccessCheckers;
    }
});
const _common = require("@nestjs/common");
const _platformexpress = require("@nestjs/platform-express");
const _multer = require("multer");
const _requestcontext = require("../context/request-context");
const _decorators = require("../auth/decorators");
const _errors = require("../http/errors");
const _prismaservice = require("../prisma/prisma.service");
const _storageservice = require("./storage.service");
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
let FilesController = class FilesController {
    storage;
    prisma;
    constructor(storage, prisma){
        this.storage = storage;
        this.prisma = prisma;
    }
    async upload(file, category) {
        if (!file) throw (0, _errors.badRequest)('No file uploaded');
        if (!_storageservice.ALLOWED_UPLOAD_MIME.test(file.mimetype)) throw (0, _errors.badRequest)(`File type ${file.mimetype} is not allowed`, 'FILE_TYPE');
        return this.storage.save({
            data: file.buffer,
            filename: file.originalname,
            mime: file.mimetype,
            category: (category || 'misc').replace(/[^\w-]/g, '').slice(0, 40) || 'misc'
        });
    }
    async download(id, res) {
        const ctx = (0, _requestcontext.requireContext)();
        const { row, data } = await this.storage.read(id);
        const privileged = ctx.permissions.has('employees.manage') || ctx.permissions.has('*');
        if (row.isPrivate && row.ownerUserId !== ctx.userId && !privileged && !await this.referencedForViewer(row.id)) {
            throw (0, _errors.forbidden)();
        }
        res.setHeader('Content-Type', row.mime);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.filename)}"`);
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.send(data);
    }
    /** Non-private files (tenant logo, published policy PDFs, course media) — no auth. */ async publicFile(id, res) {
        const row = await this.prisma.raw.fileObject.findUnique({
            where: {
                id
            }
        });
        if (!row || row.isPrivate) throw (0, _errors.forbidden)();
        const { data } = await this.storage.read(id, row.tenantId);
        res.setHeader('Content-Type', row.mime);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(data);
    }
    /**
   * Hook for domain modules: registered checkers decide whether the current user may view
   * a private file they don't own (e.g. a lead viewing a report's screenshot).
   */ async referencedForViewer(fileId) {
        for (const check of fileAccessCheckers)if (await check(fileId)) return true;
        return false;
    }
};
_ts_decorate([
    (0, _common.Post)(),
    (0, _common.UseInterceptors)((0, _platformexpress.FileInterceptor)('file', {
        storage: (0, _multer.memoryStorage)(),
        limits: {
            fileSize: _storageservice.MAX_UPLOAD_BYTES
        }
    })),
    _ts_param(0, (0, _common.UploadedFile)()),
    _ts_param(1, (0, _common.Body)('category')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], FilesController.prototype, "upload", null);
_ts_decorate([
    (0, _common.Get)(':id'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], FilesController.prototype, "download", null);
_ts_decorate([
    (0, _decorators.Public)(),
    (0, _common.Get)(':id/public'),
    _ts_param(0, (0, _common.Param)('id')),
    _ts_param(1, (0, _common.Res)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        typeof Response === "undefined" ? Object : Response
    ]),
    _ts_metadata("design:returntype", Promise)
], FilesController.prototype, "publicFile", null);
FilesController = _ts_decorate([
    (0, _common.Controller)('files'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _storageservice.StorageService === "undefined" ? Object : _storageservice.StorageService,
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], FilesController);
const fileAccessCheckers = [];

//# sourceMappingURL=files.controller.js.map