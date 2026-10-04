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
    get LookupsController () {
        return LookupsController;
    },
    get LookupsService () {
        return LookupsService;
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
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
let LookupsService = class LookupsService {
    prisma;
    providers = new Map();
    constructor(prisma){
        this.prisma = prisma;
        this.register('employees', async ()=>(await this.prisma.employee.findMany({
                where: {
                    status: {
                        not: 'EXITED'
                    }
                },
                orderBy: {
                    fullName: 'asc'
                },
                select: {
                    id: true,
                    fullName: true,
                    empCode: true
                }
            })).map((e)=>({
                    value: e.id,
                    label: `${e.fullName} · ${e.empCode}`
                })));
        this.register('managers', async ()=>{
            const rows = await this.prisma.employee.findMany({
                where: {
                    status: {
                        not: 'EXITED'
                    },
                    user: {
                        role: {
                            key: {
                                in: [
                                    'manager',
                                    'lead',
                                    'hr',
                                    'admin'
                                ]
                            }
                        }
                    }
                },
                orderBy: {
                    fullName: 'asc'
                },
                select: {
                    id: true,
                    fullName: true
                }
            });
            return rows.map((e)=>({
                    value: e.id,
                    label: e.fullName
                }));
        });
        this.register('interns', async ()=>(await this.prisma.employee.findMany({
                where: {
                    employmentType: 'INTERN',
                    status: {
                        not: 'EXITED'
                    }
                },
                orderBy: {
                    fullName: 'asc'
                }
            })).map((e)=>({
                    value: e.id,
                    label: e.fullName
                })));
        this.register('departments', async ()=>(await this.prisma.department.findMany({
                orderBy: {
                    name: 'asc'
                }
            })).map((d)=>({
                    value: d.id,
                    label: d.name
                })));
        this.register('designations', async ()=>(await this.prisma.designation.findMany({
                orderBy: {
                    name: 'asc'
                }
            })).map((d)=>({
                    value: d.id,
                    label: d.name
                })));
        this.register('branches', async ()=>(await this.prisma.branch.findMany({
                orderBy: {
                    name: 'asc'
                }
            })).map((d)=>({
                    value: d.id,
                    label: d.name
                })));
    }
    register(type, p) {
        this.providers.set(type, p);
    }
    async resolve(types) {
        const out = {};
        await Promise.all(types.map(async (t)=>{
            const p = this.providers.get(t);
            out[t] = p ? await p() : [];
        }));
        return out;
    }
};
LookupsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], LookupsService);
let LookupsController = class LookupsController {
    lookups;
    constructor(lookups){
        this.lookups = lookups;
    }
    get(types = '') {
        return this.lookups.resolve(types.split(',').map((s)=>s.trim()).filter(Boolean).slice(0, 20));
    }
};
_ts_decorate([
    (0, _common.Get)(),
    _ts_param(0, (0, _common.Query)('types')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        void 0
    ]),
    _ts_metadata("design:returntype", void 0)
], LookupsController.prototype, "get", null);
LookupsController = _ts_decorate([
    (0, _common.Controller)('lookups'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof LookupsService === "undefined" ? Object : LookupsService
    ])
], LookupsController);

//# sourceMappingURL=lookups.js.map