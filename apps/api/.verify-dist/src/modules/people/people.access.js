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
    get PeopleAccess () {
        return PeopleAccess;
    },
    get isHr () {
        return isHr;
    }
});
const _common = require("@nestjs/common");
const _decorators = require("../../core/auth/decorators");
const _requestcontext = require("../../core/context/request-context");
const _errors = require("../../core/http/errors");
const _orgservice = require("../../core/org/org.service");
const _prismaservice = require("../../core/prisma/prisma.service");
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
const isHr = (ctx)=>(0, _decorators.hasPerm)(ctx, 'employees.manage');
let PeopleAccess = class PeopleAccess {
    prisma;
    org;
    constructor(prisma, org){
        this.prisma = prisma;
        this.org = org;
    }
    ctx() {
        return (0, _requestcontext.requireContext)();
    }
    meId() {
        return (0, _requestcontext.getContext)()?.employeeId ?? null;
    }
    /** Resolves "me" to the caller's employee id. */ resolveId(id) {
        if (id === 'me') {
            const me = this.meId();
            if (!me) throw (0, _errors.notFound)('Employee');
            return me;
        }
        return id;
    }
    /** null = unrestricted; otherwise the employee ids the caller may see in lists. */ async listScope() {
        const ctx = this.ctx();
        if (isHr(ctx) || ctx.permissions.has('*')) return null;
        const me = ctx.employeeId;
        if (!me) return [];
        return [
            me,
            ...await this.org.reportTree(me)
        ];
    }
    async isInMyTree(employeeId) {
        const me = this.meId();
        if (!me) return false;
        if (me === employeeId) return true;
        return (await this.org.reportTree(me)).includes(employeeId);
    }
    /** Throws 404 (not 403, to avoid leaking existence) unless the caller may view the employee. */ async assertCanView(employeeId) {
        const ctx = this.ctx();
        const self = ctx.employeeId === employeeId;
        const hr = isHr(ctx) || ctx.permissions.has('*');
        const manager = !self && !hr && (0, _decorators.hasPerm)(ctx, 'employees.view') && await this.isInMyTree(employeeId);
        if (!self && !hr && !manager) throw (0, _errors.notFound)('Employee');
        return {
            self,
            hr,
            manager
        };
    }
    assertHr(message) {
        if (!isHr(this.ctx())) throw (0, _errors.forbidden)(message);
    }
    /** Employee id → display name (for tables). */ async names(ids) {
        const uniq = [
            ...new Set(ids.filter((x)=>!!x))
        ];
        if (!uniq.length) return new Map();
        const rows = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: uniq
                }
            },
            select: {
                id: true,
                fullName: true
            }
        });
        return new Map(rows.map((r)=>[
                r.id,
                r.fullName
            ]));
    }
};
PeopleAccess = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _orgservice.OrgService === "undefined" ? Object : _orgservice.OrgService
    ])
], PeopleAccess);

//# sourceMappingURL=people.access.js.map