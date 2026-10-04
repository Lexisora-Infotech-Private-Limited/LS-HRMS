"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "OrgService", {
    enumerable: true,
    get: function() {
        return OrgService;
    }
});
const _common = require("@nestjs/common");
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
let OrgService = class OrgService {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    /** The signed-in user's Employee record (throws if the user has none, e.g. platform-only users). */ async me() {
        const ctx = (0, _requestcontext.requireContext)();
        if (!ctx.employeeId) throw new _errors.AppError(400, 'NO_EMPLOYEE', 'Your account is not linked to an employee record');
        return this.prisma.employee.findUniqueOrThrow({
            where: {
                id: ctx.employeeId
            },
            include: {
                department: true,
                designation: true,
                manager: true,
                branch: true
            }
        });
    }
    myEmployeeId() {
        const id = (0, _requestcontext.requireContext)().employeeId;
        if (!id) throw new _errors.AppError(400, 'NO_EMPLOYEE', 'Your account is not linked to an employee record');
        return id;
    }
    /** Direct + indirect reports of an employee (for Reporting Manager scopes). */ async reportTree(employeeId) {
        const out = [];
        let frontier = [
            employeeId
        ];
        for(let depth = 0; depth < 10 && frontier.length; depth++){
            const rows = await this.prisma.employee.findMany({
                where: {
                    managerId: {
                        in: frontier
                    }
                },
                select: {
                    id: true
                }
            });
            frontier = rows.map((r)=>r.id).filter((id)=>!out.includes(id));
            out.push(...frontier);
        }
        return out;
    }
    async userIdOf(employeeId) {
        if (!employeeId) return null;
        const e = await this.prisma.employee.findUnique({
            where: {
                id: employeeId
            },
            select: {
                userId: true
            }
        });
        return e?.userId ?? null;
    }
    async tenant() {
        return this.prisma.raw.tenant.findUniqueOrThrow({
            where: {
                id: (0, _requestcontext.requireContext)().tenantId
            }
        });
    }
};
OrgService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], OrgService);

//# sourceMappingURL=org.service.js.map