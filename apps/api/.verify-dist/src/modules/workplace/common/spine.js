"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "SpineReader", {
    enumerable: true,
    get: function() {
        return SpineReader;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
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
let SpineReader = class SpineReader {
    prisma;
    log = new _common.Logger('WorkplaceSpine');
    constructor(prisma){
        this.prisma = prisma;
    }
    delegate(name) {
        const d = this.prisma[name];
        return d && typeof d.findMany === 'function' ? d : null;
    }
    async safe(name, args) {
        const d = this.delegate(name);
        if (!d) return [];
        try {
            return await d.findMany(args);
        } catch (e) {
            this.log.debug(`${name} read failed: ${e.message}`);
            return [];
        }
    }
    tasks(where, take = 50) {
        return this.safe('task', {
            where,
            take,
            orderBy: {
                dueDate: 'asc'
            }
        });
    }
    projects(where = {}) {
        return this.safe('project', {
            where,
            orderBy: {
                name: 'asc'
            }
        });
    }
    projectMembers(where) {
        return this.safe('projectMember', {
            where
        });
    }
    timesheets(where) {
        return this.safe('timesheet', {
            where,
            orderBy: {
                weekStart: 'desc'
            },
            take: 10
        });
    }
    holidays(from, to) {
        return this.safe('holiday', {
            where: {
                date: {
                    gte: from,
                    lt: to
                }
            },
            orderBy: {
                date: 'asc'
            }
        });
    }
    /** Employee ids on a project (members + lead). */ async projectEmployeeIds(projectId) {
        const [members, proj] = await Promise.all([
            this.projectMembers({
                projectId
            }),
            this.projects({
                id: projectId
            })
        ]);
        return [
            ...new Set([
                ...members.map((m)=>m.employeeId),
                ...proj.map((p)=>p.leadEmployeeId).filter((x)=>!!x)
            ])
        ];
    }
    /** Projects an employee belongs to (member or lead). */ async projectIdsOf(employeeId) {
        const [members, led] = await Promise.all([
            this.projectMembers({
                employeeId
            }),
            this.projects({
                leadEmployeeId: employeeId
            })
        ]);
        return [
            ...new Set([
                ...members.map((m)=>m.projectId),
                ...led.map((p)=>p.id)
            ])
        ];
    }
    /** Other interview-scoring and onboarding to-dos (people domain), read defensively. */ async rawFindMany(model, args) {
        return this.safe(model, args);
    }
};
SpineReader = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], SpineReader);

//# sourceMappingURL=spine.js.map