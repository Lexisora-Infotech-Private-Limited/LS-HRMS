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
    get SequenceService () {
        return SequenceService;
    },
    get financialYear () {
        return financialYear;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../prisma/prisma.service");
const _requestcontext = require("../context/request-context");
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
function financialYear(d = new Date()) {
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
let SequenceService = class SequenceService {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    async nextValue(key, opts = {}) {
        const tenantId = opts.tenantId ?? (0, _requestcontext.requireContext)().tenantId;
        const period = opts.period ?? '';
        const rows = await this.prisma.raw.$queryRaw`
      INSERT INTO "NumberSequence" ("id", "tenantId", "key", "period", "nextValue")
      VALUES (${`seq_${tenantId}_${key}_${period}`}, ${tenantId}, ${key}, ${period}, ${(opts.start ?? 1) + 1})
      ON CONFLICT ("tenantId", "key", "period")
      DO UPDATE SET "nextValue" = "NumberSequence"."nextValue" + 1
      RETURNING "nextValue" - 1 AS value`;
        return Number(rows[0].value);
    }
    async next(key, opts = {}) {
        const n = await this.nextValue(key, opts);
        return `${opts.prefix ?? ''}${String(n).padStart(opts.pad ?? 4, '0')}`;
    }
};
SequenceService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], SequenceService);

//# sourceMappingURL=sequence.service.js.map