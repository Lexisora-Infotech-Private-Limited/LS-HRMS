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
    get DEFAULT_SHIFT_NET_MINUTES () {
        return DEFAULT_SHIFT_NET_MINUTES;
    },
    get DEFAULT_WEEKLY_OFFS () {
        return DEFAULT_WEEKLY_OFFS;
    },
    get WorkCalendarService () {
        return WorkCalendarService;
    },
    get countWorkingDays () {
        return countWorkingDays;
    },
    get makeCalendar () {
        return makeCalendar;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _dates = require("./dates");
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
const DEFAULT_WEEKLY_OFFS = [
    0,
    6
];
const DEFAULT_SHIFT_NET_MINUTES = 480;
function makeCalendar(weeklyOffs, holidays, locationId) {
    const byDate = new Map();
    for (const h of holidays){
        if (h.type !== 'MANDATORY') continue;
        if (h.locationIds.length && (!locationId || !h.locationIds.includes(locationId))) continue;
        byDate.set(h.date, h);
    }
    const offs = new Set(weeklyOffs);
    return (date)=>{
        const h = byDate.get(date);
        if (h) return {
            date,
            kind: 'HOLIDAY',
            holidayName: h.name
        };
        if (offs.has((0, _dates.dow)(date))) return {
            date,
            kind: 'WEEKLY_OFF'
        };
        return {
            date,
            kind: 'WORKING'
        };
    };
}
function countWorkingDays(calendar, from, to) {
    if (from > to) return 0;
    return (0, _dates.eachDay)(from, to).filter((d)=>calendar(d).kind === 'WORKING').length;
}
let WorkCalendarService = class WorkCalendarService {
    prisma;
    constructor(prisma){
        this.prisma = prisma;
    }
    async holidays(from, to) {
        const rows = await this.prisma.holiday.findMany({
            where: {
                date: {
                    gte: (0, _dates.dd)(from),
                    lte: (0, _dates.dd)(to)
                }
            },
            orderBy: {
                date: 'asc'
            }
        });
        return rows.map((h)=>({
                id: h.id,
                date: (0, _dates.dk)(h.date),
                name: h.name,
                type: h.type,
                locationIds: h.locationIds ?? []
            }));
    }
    /** Calendars for many employees over a window (holidays loaded for the window ± 20 days, for sandwich lookups). */ async forEmployees(employeeIds, from, to) {
        const [emps, shifts, holidays] = await Promise.all([
            this.prisma.employee.findMany({
                where: {
                    id: {
                        in: employeeIds
                    }
                },
                select: {
                    id: true,
                    shiftId: true,
                    workLocationId: true
                }
            }),
            this.prisma.shift.findMany({
                where: {
                    archivedAt: null
                }
            }),
            this.holidays((0, _dates.addDays)(from, -20), (0, _dates.addDays)(to, 20))
        ]);
        const def = shifts.find((s)=>s.isDefault) ?? shifts[0];
        const out = new Map();
        for (const e of emps){
            const shift = shifts.find((s)=>s.id === e.shiftId) ?? def;
            const weeklyOffs = shift?.weeklyOffDays?.length ? shift.weeklyOffDays : DEFAULT_WEEKLY_OFFS;
            let net = DEFAULT_SHIFT_NET_MINUTES;
            if (shift) {
                const span = (shift.endMinute - shift.startMinute + 1440) % 1440 || 1440;
                net = Math.max(60, span - (shift.breakMinutes ?? 0));
            }
            out.set(e.id, {
                employeeId: e.id,
                weeklyOffs,
                shiftNetMinutes: net,
                calendar: makeCalendar(weeklyOffs, holidays, e.workLocationId)
            });
        }
        return out;
    }
    async forEmployee(employeeId, from, to) {
        const m = await this.forEmployees([
            employeeId
        ], from, to);
        return m.get(employeeId) ?? {
            employeeId,
            weeklyOffs: DEFAULT_WEEKLY_OFFS,
            shiftNetMinutes: DEFAULT_SHIFT_NET_MINUTES,
            calendar: makeCalendar(DEFAULT_WEEKLY_OFFS, [], null)
        };
    }
};
WorkCalendarService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService
    ])
], WorkCalendarService);

//# sourceMappingURL=calendar.service.js.map