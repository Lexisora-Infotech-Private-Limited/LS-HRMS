"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PrismaService", {
    enumerable: true,
    get: function() {
        return PrismaService;
    }
});
const _common = require("@nestjs/common");
const _client = require("@prisma/client");
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
/** Models that carry a `tenantId` column — detected from the Prisma DMMF at startup. */ const TENANT_MODELS = new Set(_client.Prisma.dmmf.datamodel.models.filter((m)=>m.fields.some((f)=>f.name === 'tenantId')).map((m)=>m.name));
const WHERE_OPS = new Set([
    'findUnique',
    'findUniqueOrThrow',
    'findFirst',
    'findFirstOrThrow',
    'findMany',
    'count',
    'aggregate',
    'groupBy',
    'update',
    'updateMany',
    'updateManyAndReturn',
    'delete',
    'deleteMany',
    'upsert'
]);
function withTenant(base) {
    return base.$extends({
        name: 'tenant-scope',
        query: {
            $allModels: {
                async $allOperations ({ model, operation, args, query }) {
                    const ctx = (0, _requestcontext.getContext)();
                    // No context = system code that queries explicitly by tenantId (login, platform console).
                    if (!ctx || !TENANT_MODELS.has(model)) return query(args);
                    const tenantId = ctx.tenantId;
                    const a = args ?? {};
                    if (WHERE_OPS.has(operation)) {
                        a.where = {
                            ...a.where ?? {},
                            tenantId
                        };
                    }
                    if (operation === 'create') {
                        a.data = {
                            tenantId,
                            ...a.data ?? {}
                        };
                    } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
                        const d = a.data;
                        a.data = Array.isArray(d) ? d.map((x)=>({
                                tenantId,
                                ...x
                            })) : {
                            tenantId,
                            ...d
                        };
                    } else if (operation === 'upsert') {
                        a.create = {
                            tenantId,
                            ...a.create ?? {}
                        };
                    }
                    return query(a);
                }
            }
        }
    });
}
let PrismaService = class PrismaService {
    raw;
    db;
    constructor(){
        this.raw = new _client.PrismaClient();
        this.db = withTenant(this.raw);
        return new Proxy(this, {
            get (target, prop, receiver) {
                if (prop in target) return Reflect.get(target, prop, receiver);
                return target.db[prop];
            }
        });
    }
    async onModuleInit() {
        await this.raw.$connect();
    }
    async onModuleDestroy() {
        await this.raw.$disconnect();
    }
};
PrismaService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [])
], PrismaService);

//# sourceMappingURL=prisma.service.js.map