"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "SettingsService", {
    enumerable: true,
    get: function() {
        return SettingsService;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../prisma/prisma.service");
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
let SettingsService = class SettingsService {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    async get(key, fallback) {
        const row = await this.prisma.setting.findFirst({
            where: {
                key
            }
        });
        if (!row) return fallback;
        const v = row.value;
        // Shallow-merge objects so new default fields appear for old tenants.
        if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && v && typeof v === 'object') {
            return {
                ...fallback,
                ...v
            };
        }
        return v;
    }
    /** Read a setting for a specific tenant (outside a request). */ async getFor(tenantId, key, fallback) {
        const row = await this.prisma.raw.setting.findUnique({
            where: {
                tenantId_key: {
                    tenantId,
                    key
                }
            }
        });
        if (!row) return fallback;
        const v = row.value;
        if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && v && typeof v === 'object') {
            return {
                ...fallback,
                ...v
            };
        }
        return v;
    }
    async set(key, value) {
        const existing = await this.prisma.setting.findFirst({
            where: {
                key
            }
        });
        if (existing) {
            await this.prisma.setting.update({
                where: {
                    id: existing.id
                },
                data: {
                    value: value
                }
            });
        } else {
            await this.prisma.setting.create({
                data: {
                    key,
                    value: value
                }
            });
        }
    }
};
SettingsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], SettingsService);

//# sourceMappingURL=settings.service.js.map