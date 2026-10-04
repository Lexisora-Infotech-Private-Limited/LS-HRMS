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
    get BILLABLE_SHEET_STATUSES () {
        return BILLABLE_SHEET_STATUSES;
    },
    get PENDING_SHEET_STATUSES () {
        return PENDING_SHEET_STATUSES;
    },
    get SpineReader () {
        return SpineReader;
    }
});
const _common = require("@nestjs/common");
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
const BILLABLE_SHEET_STATUSES = [
    'PENDING_RM',
    'APPROVED',
    'LOCKED'
];
const PENDING_SHEET_STATUSES = [
    'SUBMITTED'
];
let SpineReader = class SpineReader {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    get db() {
        return this.prisma;
    }
    async clients(where = {}) {
        return await this.db.client?.findMany({
            where,
            orderBy: {
                name: 'asc'
            }
        }) ?? [];
    }
    async client(id) {
        return await this.db.client?.findFirst({
            where: {
                id
            }
        }) ?? null;
    }
    async clientByName(name) {
        return await this.db.client?.findFirst({
            where: {
                name
            }
        }) ?? null;
    }
    async projects(where = {}) {
        return await this.db.project?.findMany({
            where,
            orderBy: {
                name: 'asc'
            }
        }) ?? [];
    }
    async project(id) {
        return await this.db.project?.findFirst({
            where: {
                id
            }
        }) ?? null;
    }
    async tasks(ids) {
        if (!ids.length) return [];
        return await this.db.task?.findMany({
            where: {
                id: {
                    in: ids
                }
            },
            select: {
                id: true,
                key: true,
                title: true
            }
        }) ?? [];
    }
    /**
   * Billable timesheet cells for a project in [start, end], split into invoiceable
   * (L1-approved sheets) and pending (submitted, not yet approved).
   */ async billableCells(projectId, start, end) {
        if (!this.db.timesheetLine || !this.db.timesheet || !this.db.timesheetCell) return {
            approved: [],
            pending: [],
            sheets: new Map(),
            lines: new Map()
        };
        const lines = await this.db.timesheetLine.findMany({
            where: {
                projectId,
                billable: true
            },
            select: {
                id: true,
                timesheetId: true,
                projectId: true,
                taskId: true,
                label: true,
                billable: true
            }
        });
        if (!lines.length) return {
            approved: [],
            pending: [],
            sheets: new Map(),
            lines: new Map()
        };
        const sheets = await this.db.timesheet.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(lines.map((l)=>l.timesheetId))
                    ]
                }
            },
            select: {
                id: true,
                employeeId: true,
                status: true,
                weekStart: true
            }
        });
        const sheetById = new Map(sheets.map((s)=>[
                s.id,
                s
            ]));
        const lineById = new Map(lines.map((l)=>[
                l.id,
                l
            ]));
        const cells = await this.db.timesheetCell.findMany({
            where: {
                lineId: {
                    in: lines.map((l)=>l.id)
                },
                date: {
                    gte: start,
                    lte: end
                },
                finalMinutes: {
                    gt: 0
                }
            },
            select: {
                id: true,
                lineId: true,
                date: true,
                finalMinutes: true
            }
        });
        const approved = [];
        const pending = [];
        for (const c of cells){
            const st = sheetById.get(lineById.get(c.lineId)?.timesheetId ?? '')?.status ?? '';
            if (BILLABLE_SHEET_STATUSES.includes(st)) approved.push(c);
            else if (PENDING_SHEET_STATUSES.includes(st)) pending.push(c);
        }
        return {
            approved,
            pending,
            sheets: sheetById,
            lines: lineById
        };
    }
    /** Cell id → timesheet status, only for cells whose sheet is still invoiceable (L1+ approved). */ async cellSheetStatus(cellIds) {
        const out = new Map();
        if (!cellIds.length || !this.db.timesheetCell || !this.db.timesheetLine || !this.db.timesheet) return out;
        const cells = await this.db.timesheetCell.findMany({
            where: {
                id: {
                    in: cellIds
                }
            },
            select: {
                id: true,
                lineId: true
            }
        });
        const lines = await this.db.timesheetLine.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(cells.map((c)=>c.lineId))
                    ]
                }
            },
            select: {
                id: true,
                timesheetId: true
            }
        });
        const sheets = await this.db.timesheet.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(lines.map((l)=>l.timesheetId))
                    ]
                }
            },
            select: {
                id: true,
                status: true
            }
        });
        const lineSheet = new Map(lines.map((l)=>[
                l.id,
                l.timesheetId
            ]));
        const status = new Map(sheets.map((s)=>[
                s.id,
                s.status
            ]));
        for (const c of cells){
            const st = status.get(lineSheet.get(c.lineId) ?? '') ?? '';
            if (BILLABLE_SHEET_STATUSES.includes(st)) out.set(c.id, st);
        }
        return out;
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