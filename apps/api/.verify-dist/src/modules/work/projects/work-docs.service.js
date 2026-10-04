"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WorkDocsService", {
    enumerable: true,
    get: function() {
        return WorkDocsService;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _errors = require("../../../core/http/errors");
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
let WorkDocsService = class WorkDocsService {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    async rows(docs) {
        if (!docs.length) return [];
        const files = await this.prisma.fileObject.findMany({
            where: {
                id: {
                    in: docs.map((d)=>d.fileId)
                }
            },
            select: {
                id: true,
                mime: true,
                size: true
            }
        });
        const fOf = new Map(files.map((f)=>[
                f.id,
                f
            ]));
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: docs.map((d)=>d.uploadedByEmployeeId).filter((x)=>!!x)
                }
            },
            select: {
                id: true,
                fullName: true
            }
        });
        const eOf = new Map(emps.map((e)=>[
                e.id,
                e.fullName
            ]));
        return docs.map((d)=>({
                id: d.id,
                fileId: d.fileId,
                title: d.title,
                kind: d.kind,
                sizeBytes: d.sizeBytes || fOf.get(d.fileId)?.size || 0,
                mime: fOf.get(d.fileId)?.mime ?? null,
                uploadedBy: d.uploadedByEmployeeId ? eOf.get(d.uploadedByEmployeeId) ?? null : null,
                createdAt: d.createdAt.toISOString(),
                scope: d.projectId ? 'PROJECT' : 'CLIENT'
            }));
    }
    /** Validate uploaded file ids belong to this tenant; returns their metadata. */ async files(fileIds) {
        if (!fileIds.length) return [];
        const files = await this.prisma.fileObject.findMany({
            where: {
                id: {
                    in: fileIds
                }
            },
            select: {
                id: true,
                filename: true,
                size: true
            }
        });
        if (files.length !== new Set(fileIds).size) throw (0, _errors.badRequest)('One of the uploaded files was not found — upload it again');
        return files;
    }
};
WorkDocsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], WorkDocsService);

//# sourceMappingURL=work-docs.service.js.map