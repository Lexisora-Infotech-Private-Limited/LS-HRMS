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
    get MastersService () {
        return MastersService;
    },
    get groupHolidays () {
        return groupHolidays;
    },
    get toLocationRow () {
        return toLocationRow;
    },
    get toShiftRow () {
        return toShiftRow;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _eventsservice = require("../../../core/registry/events.service");
const _jobsservice = require("../../../core/jobs/jobs.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _daycalc = require("../lib/day-calc");
const _timeutils = require("../lib/time-utils");
const _holidaylists = require("../lib/holiday-lists");
const _periodlockservice = require("./period-lock.service");
const _policyservice = require("./policy.service");
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
const ACTIVE = [
    'ACTIVE',
    'NOTICE_PERIOD'
];
let MastersService = class MastersService {
    prisma;
    policies;
    locks;
    audit;
    notifications;
    realtime;
    events;
    jobs;
    constructor(prisma, policies, locks, audit, notifications, realtime, events, jobs){
        this.prisma = prisma;
        this.policies = policies;
        this.locks = locks;
        this.audit = audit;
        this.notifications = notifications;
        this.realtime = realtime;
        this.events = events;
        this.jobs = jobs;
    }
    // ── shifts ────────────────────────────────────────────────────────────────
    /** employeeId → current shiftId (assignment covering today → Employee.shiftId → default). */ async currentShiftMap() {
        const today = (0, _timeutils.dateOf)((0, _timeutils.istKeyOf)(new Date()));
        const [emps, assigns, def] = await Promise.all([
            this.prisma.employee.findMany({
                where: {
                    status: {
                        in: [
                            ...ACTIVE
                        ]
                    }
                },
                select: {
                    id: true,
                    shiftId: true
                }
            }),
            this.prisma.shiftAssignment.findMany({
                where: {
                    effectiveFrom: {
                        lte: today
                    },
                    OR: [
                        {
                            effectiveTo: null
                        },
                        {
                            effectiveTo: {
                                gte: today
                            }
                        }
                    ]
                },
                orderBy: {
                    effectiveFrom: 'asc'
                }
            }),
            this.policies.defaultShift()
        ]);
        const byEmp = new Map();
        for (const a of assigns)byEmp.set(a.employeeId, a.shiftId);
        return new Map(emps.map((e)=>[
                e.id,
                byEmp.get(e.id) ?? e.shiftId ?? def?.id ?? null
            ]));
    }
    async listShifts() {
        const [rows, current] = await Promise.all([
            this.prisma.shift.findMany({
                where: {
                    archivedAt: null
                },
                orderBy: [
                    {
                        isDefault: 'desc'
                    },
                    {
                        startMinute: 'asc'
                    }
                ]
            }),
            this.currentShiftMap()
        ]);
        const counts = new Map();
        for (const s of current.values())if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
        return rows.map((s)=>toShiftRow(s, counts.get(s.id) ?? 0));
    }
    validateShift(input, existing) {
        const start = input.start !== undefined ? (0, _timeutils.parseHm)(input.start) : existing.startMinute;
        const end = input.end !== undefined ? (0, _timeutils.parseHm)(input.end) : existing.endMinute;
        if (start === end) throw new _errors.AppError(422, 'SHIFT_INVALID', 'Start and end cannot be the same');
        const duration = (0, _daycalc.shiftDurationMinutes)({
            startMinute: start,
            endMinute: end
        });
        const brk = input.breakMinutes ?? existing?.breakMinutes ?? 60;
        if (brk >= duration) throw new _errors.AppError(422, 'SHIFT_INVALID', 'Break must be shorter than the shift');
        const full = input.minFullDayMinutes ?? existing?.minFullDayMinutes ?? Math.min(450, duration - brk);
        const half = input.minHalfDayMinutes ?? existing?.minHalfDayMinutes ?? Math.min(240, Math.floor(full / 2));
        if (half >= full) throw new _errors.AppError(422, 'SHIFT_INVALID', 'Half-day minimum must be below the full-day minimum');
        if (full > duration - brk + 60) throw new _errors.AppError(422, 'SHIFT_INVALID', 'Full-day minimum is longer than the shift allows');
        const off = input.weeklyOffDays ?? existing?.weeklyOffDays ?? [
            0,
            6
        ];
        if (new Set(off).size >= 7) throw new _errors.AppError(422, 'SHIFT_INVALID', 'Keep at least one working day');
        return {
            startMinute: start,
            endMinute: end,
            breakMinutes: brk,
            minFullDayMinutes: full,
            minHalfDayMinutes: half,
            weeklyOffDays: [
                ...new Set(off)
            ].sort()
        };
    }
    async createShift(input) {
        const v = this.validateShift(input);
        const exists = await this.prisma.shift.findFirst({
            where: {
                name: input.name
            }
        });
        if (exists && !exists.archivedAt) throw new _errors.AppError(409, 'DUPLICATE', 'A shift with this name already exists');
        const hasDefault = await this.prisma.shift.count({
            where: {
                isDefault: true,
                archivedAt: null
            }
        });
        const makeDefault = !!input.isDefault || !hasDefault;
        if (makeDefault) await this.prisma.shift.updateMany({
            where: {
                isDefault: true
            },
            data: {
                isDefault: false
            }
        });
        const data = {
            name: input.name,
            ...v,
            graceMinutes: input.graceMinutes,
            halfDayIfLateByMinutes: input.halfDayIfLateByMinutes === undefined ? 120 : input.halfDayIfLateByMinutes,
            isDefault: makeDefault,
            archivedAt: null
        };
        const s = exists ? await this.prisma.shift.update({
            where: {
                id: exists.id
            },
            data
        }) : await this.prisma.shift.create({
            data: data
        });
        await this.audit.record({
            action: 'shift.created',
            entity: 'Shift',
            entityId: s.id,
            meta: {
                name: s.name,
                timing: `${(0, _timeutils.fmtMinute)(s.startMinute)}–${(0, _timeutils.fmtMinute)(s.endMinute)}`
            }
        });
        return toShiftRow(s, 0);
    }
    async updateShift(id, input) {
        const s = await this.prisma.shift.findFirst({
            where: {
                id,
                archivedAt: null
            }
        });
        if (!s) throw (0, _errors.notFound)('Shift');
        const v = this.validateShift(input, s);
        if (input.isDefault) await this.prisma.shift.updateMany({
            where: {
                isDefault: true,
                id: {
                    not: id
                }
            },
            data: {
                isDefault: false
            }
        });
        const saved = await this.prisma.shift.update({
            where: {
                id
            },
            data: {
                ...input.name ? {
                    name: input.name
                } : {},
                ...v,
                ...input.graceMinutes !== undefined ? {
                    graceMinutes: input.graceMinutes
                } : {},
                ...input.halfDayIfLateByMinutes !== undefined ? {
                    halfDayIfLateByMinutes: input.halfDayIfLateByMinutes
                } : {},
                ...input.isDefault !== undefined ? {
                    isDefault: input.isDefault || s.isDefault
                } : {}
            }
        });
        const diff = {};
        for (const k of [
            'name',
            'startMinute',
            'endMinute',
            'graceMinutes',
            'breakMinutes',
            'weeklyOffDays',
            'minFullDayMinutes',
            'minHalfDayMinutes',
            'halfDayIfLateByMinutes'
        ]){
            if (JSON.stringify(s[k]) !== JSON.stringify(saved[k])) diff[k] = {
                from: s[k],
                to: saved[k]
            };
        }
        await this.audit.record({
            action: 'shift.updated',
            entity: 'Shift',
            entityId: id,
            meta: diff
        });
        const counts = await this.currentShiftMap();
        return toShiftRow(saved, [
            ...counts.values()
        ].filter((x)=>x === id).length);
    }
    async archiveShift(id) {
        const s = await this.prisma.shift.findFirst({
            where: {
                id,
                archivedAt: null
            }
        });
        if (!s) throw (0, _errors.notFound)('Shift');
        if (s.isDefault) throw new _errors.AppError(409, 'SHIFT_IN_USE', 'Make another shift the default before archiving this one');
        const today = (0, _timeutils.dateOf)((0, _timeutils.istKeyOf)(new Date()));
        const inUse = await this.prisma.shiftAssignment.count({
            where: {
                shiftId: id,
                OR: [
                    {
                        effectiveTo: null
                    },
                    {
                        effectiveTo: {
                            gte: today
                        }
                    }
                ]
            }
        });
        const direct = await this.prisma.employee.count({
            where: {
                shiftId: id,
                status: {
                    in: [
                        ...ACTIVE
                    ]
                }
            }
        });
        if (inUse || direct) throw new _errors.AppError(409, 'SHIFT_IN_USE', 'This shift still has current or future allocations');
        await this.prisma.shift.update({
            where: {
                id
            },
            data: {
                archivedAt: new Date()
            }
        });
        await this.audit.record({
            action: 'shift.archived',
            entity: 'Shift',
            entityId: id,
            meta: {
                name: s.name
            }
        });
        return {
            ok: true
        };
    }
    async listAllocations(q) {
        const today = (0, _timeutils.istKeyOf)(new Date());
        const rows = await this.prisma.shiftAssignment.findMany({
            where: {
                ...q.shiftId ? {
                    shiftId: q.shiftId
                } : {}
            },
            include: {
                shift: true
            },
            orderBy: [
                {
                    effectiveFrom: 'desc'
                }
            ],
            take: 500
        });
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(rows.map((r)=>r.employeeId))
                    ]
                },
                ...q.departmentId ? {
                    departmentId: q.departmentId
                } : {}
            },
            select: {
                id: true,
                fullName: true,
                department: {
                    select: {
                        name: true
                    }
                }
            }
        });
        const em = new Map(emps.map((e)=>[
                e.id,
                e
            ]));
        return rows.filter((r)=>em.has(r.employeeId)).map((r)=>{
            const from = (0, _timeutils.keyOf)(r.effectiveFrom);
            const to = r.effectiveTo ? (0, _timeutils.keyOf)(r.effectiveTo) : null;
            const e = em.get(r.employeeId);
            return {
                id: r.id,
                employeeId: r.employeeId,
                employeeName: e.fullName,
                department: e.department?.name ?? null,
                shiftId: r.shiftId,
                shiftName: r.shift.name,
                from,
                to,
                allocatedBy: r.assignedByName,
                current: from <= today && (!to || to >= today)
            };
        });
    }
    /** Allocate (B3): close each open-ended assignment at D−1 and insert the new one; backdated → recompute. */ async allocate(input) {
        const ctx = (0, _requestcontext.requireContext)();
        const shift = await this.prisma.shift.findFirst({
            where: {
                id: input.shiftId,
                archivedAt: null
            }
        });
        if (!shift) throw (0, _errors.notFound)('Shift');
        if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw (0, _errors.badRequest)('To date must be on or after the From date');
        const today = (0, _timeutils.istKeyOf)(new Date());
        if (input.effectiveFrom <= today && await this.locks.isLocked(input.effectiveFrom)) {
            throw new _errors.AppError(409, 'PERIOD_LOCKED', 'This date is in a locked attendance period');
        }
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: input.employeeIds
                },
                status: {
                    not: 'EXITED'
                }
            },
            select: {
                id: true,
                joiningDate: true,
                userId: true,
                fullName: true
            }
        });
        if (!emps.length) throw (0, _errors.badRequest)('Select employees');
        const from = (0, _timeutils.dateOf)(input.effectiveFrom);
        const to = input.effectiveTo ? (0, _timeutils.dateOf)(input.effectiveTo) : null;
        for (const e of emps){
            const start = e.joiningDate && (0, _timeutils.keyOf)(e.joiningDate) > input.effectiveFrom ? e.joiningDate : from;
            // overlap check against closed ranges that are not the open-ended current one
            const overlapping = await this.prisma.shiftAssignment.findFirst({
                where: {
                    employeeId: e.id,
                    effectiveTo: {
                        not: null,
                        gte: start
                    },
                    effectiveFrom: to ? {
                        lte: to
                    } : undefined
                }
            });
            if (overlapping && (0, _timeutils.keyOf)(overlapping.effectiveFrom) >= (0, _timeutils.keyOf)(start)) {
                throw new _errors.AppError(409, 'ALLOCATION_OVERLAP', `${e.fullName} already has a shift allocation in this range`);
            }
            await this.prisma.$transaction(async (tx)=>{
                const open = await tx.shiftAssignment.findMany({
                    where: {
                        tenantId: ctx.tenantId,
                        employeeId: e.id,
                        OR: [
                            {
                                effectiveTo: null
                            },
                            {
                                effectiveTo: {
                                    gte: start
                                }
                            }
                        ]
                    }
                });
                for (const o of open){
                    if (o.effectiveFrom >= start) await tx.shiftAssignment.delete({
                        where: {
                            id: o.id
                        }
                    });
                    else await tx.shiftAssignment.update({
                        where: {
                            id: o.id
                        },
                        data: {
                            effectiveTo: (0, _timeutils.dateOf)((0, _timeutils.addDays)((0, _timeutils.keyOf)(start), -1))
                        }
                    });
                }
                await tx.shiftAssignment.create({
                    data: {
                        tenantId: ctx.tenantId,
                        employeeId: e.id,
                        shiftId: shift.id,
                        effectiveFrom: start,
                        effectiveTo: to,
                        assignedByName: ctx.userName ?? null
                    }
                });
                if ((0, _timeutils.keyOf)(start) <= today && (!to || (0, _timeutils.keyOf)(to) >= today)) await tx.employee.update({
                    where: {
                        id: e.id
                    },
                    data: {
                        shiftId: shift.id
                    }
                });
            });
        }
        await this.audit.record({
            action: 'shift.allocated',
            entity: 'Shift',
            entityId: shift.id,
            meta: {
                employeeIds: emps.map((e)=>e.id),
                from: input.effectiveFrom,
                to: input.effectiveTo ?? null
            }
        });
        const timing = `${(0, _timeutils.fmtMinute)(shift.startMinute)}–${(0, _timeutils.fmtMinute)(shift.endMinute)}`;
        await this.notifications.notify({
            userIds: emps.map((e)=>e.userId).filter((x)=>!!x),
            type: 'shift.changed',
            title: `Your shift changes to ${shift.name} ${timing} from ${(0, _timeutils.dm)(input.effectiveFrom)}`,
            link: '/attendance',
            from: ctx.userName ?? 'HR',
            email: true
        });
        if (input.effectiveFrom <= today) {
            await this.jobs.enqueue('time.recomputeRange', {
                tenantId: ctx.tenantId,
                employeeIds: emps.map((e)=>e.id),
                from: input.effectiveFrom,
                to: today
            });
        }
        return {
            ok: true,
            count: emps.length
        };
    }
    async deleteAllocation(id) {
        const a = await this.prisma.shiftAssignment.findFirst({
            where: {
                id
            }
        });
        if (!a) throw (0, _errors.notFound)('Allocation');
        if ((0, _timeutils.keyOf)(a.effectiveFrom) <= (0, _timeutils.istKeyOf)(new Date())) throw new _errors.AppError(409, 'ALLOCATION_STARTED', 'Only future-dated allocations can be deleted');
        await this.prisma.shiftAssignment.delete({
            where: {
                id
            }
        });
        await this.audit.record({
            action: 'shift.allocation.deleted',
            entity: 'ShiftAssignment',
            entityId: id,
            meta: {
                employeeId: a.employeeId
            }
        });
        return {
            ok: true
        };
    }
    // ── locations ─────────────────────────────────────────────────────────────
    async locationCounts() {
        const remote = await this.policies.remoteLocation();
        const emps = await this.prisma.employee.findMany({
            where: {
                status: {
                    in: [
                        ...ACTIVE
                    ]
                }
            },
            select: {
                workLocationId: true,
                workMode: true
            }
        });
        const m = new Map();
        for (const e of emps){
            const loc = e.workMode === 'REMOTE' ? remote.id : e.workLocationId;
            if (loc) m.set(loc, (m.get(loc) ?? 0) + 1);
        }
        return m;
    }
    async listLocations() {
        await this.policies.remoteLocation();
        const [rows, counts] = await Promise.all([
            this.prisma.workLocation.findMany({
                where: {
                    archivedAt: null
                },
                orderBy: [
                    {
                        isRemote: 'asc'
                    },
                    {
                        createdAt: 'asc'
                    }
                ]
            }),
            this.locationCounts()
        ]);
        return rows.map((l)=>toLocationRow(l, counts.get(l.id) ?? 0));
    }
    async locationDetail(id) {
        const l = await this.prisma.workLocation.findFirst({
            where: {
                id
            }
        });
        if (!l) throw (0, _errors.notFound)('Location');
        const emps = await this.prisma.employee.findMany({
            where: {
                status: {
                    in: [
                        ...ACTIVE
                    ]
                },
                ...l.isRemote ? {
                    OR: [
                        {
                            workMode: 'REMOTE'
                        },
                        {
                            workLocationId: id
                        }
                    ]
                } : {
                    workLocationId: id
                }
            },
            select: {
                id: true,
                fullName: true,
                empCode: true,
                workMode: true,
                department: {
                    select: {
                        name: true
                    }
                }
            },
            orderBy: {
                fullName: 'asc'
            }
        });
        const devices = await this.prisma.biometricDevice.findMany({
            where: {
                locationId: id
            },
            orderBy: {
                name: 'asc'
            }
        });
        return {
            ...toLocationRow(l, emps.length),
            employeeList: emps.map((e)=>({
                    id: e.id,
                    name: e.fullName,
                    empCode: e.empCode,
                    department: e.department?.name ?? null,
                    workMode: e.workMode
                })),
            devices: devices.map((d)=>({
                    id: d.id,
                    serialNumber: d.serialNumber,
                    name: d.name,
                    locationId: d.locationId,
                    locationName: l.name,
                    model: d.model,
                    firmware: d.firmware,
                    directionMode: d.directionMode,
                    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
                    lastSeen: d.lastSeenAt ? d.lastSeenAt.toISOString() : 'Never',
                    status: d.status === 'DISABLED' ? 'Disabled' : d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 30 * 60_000 ? 'Online' : 'Offline',
                    unprocessed: 0
                }))
        };
    }
    checkLocation(input, existing) {
        const isRemote = existing?.isRemote ?? false;
        if (isRemote && input.punchMode === 'BIOMETRIC_ONLY') throw new _errors.AppError(422, 'LOCATION_INVALID', 'A remote location cannot be biometric only');
        const fence = input.geoFenceWebPunch ?? existing?.geoFenceWebPunch ?? false;
        const lat = input.lat !== undefined ? input.lat : existing?.lat;
        const lng = input.lng !== undefined ? input.lng : existing?.lng;
        if (fence && (lat == null || lng == null)) throw new _errors.AppError(422, 'LOCATION_INVALID', 'Enter latitude and longitude to enforce the geo-fence');
        if (fence && !(input.geoRadiusM ?? existing?.geoRadiusM)) throw new _errors.AppError(422, 'LOCATION_INVALID', 'Enter a geo radius to enforce the geo-fence');
    }
    async createLocation(input) {
        this.checkLocation(input);
        const dup = await this.prisma.workLocation.findFirst({
            where: {
                name: input.name
            }
        });
        if (dup) throw new _errors.AppError(409, 'DUPLICATE', 'A location with this name already exists');
        const l = await this.prisma.workLocation.create({
            data: {
                name: input.name,
                address: input.address ?? null,
                geoRadiusM: input.geoRadiusM ?? null,
                punchMode: input.punchMode,
                lat: input.lat ?? null,
                lng: input.lng ?? null,
                geoFenceWebPunch: input.geoFenceWebPunch ?? false,
                isRemote: false
            }
        });
        await this.audit.record({
            action: 'location.created',
            entity: 'WorkLocation',
            entityId: l.id,
            meta: {
                name: l.name,
                punchMode: l.punchMode
            }
        });
        return toLocationRow(l, 0);
    }
    async updateLocation(id, input) {
        const l = await this.prisma.workLocation.findFirst({
            where: {
                id,
                archivedAt: null
            }
        });
        if (!l) throw (0, _errors.notFound)('Location');
        this.checkLocation(input, l);
        if (l.isSystem && input.name && input.name !== l.name) throw new _errors.AppError(422, 'LOCATION_SYSTEM', 'The Remote location cannot be renamed');
        const saved = await this.prisma.workLocation.update({
            where: {
                id
            },
            data: {
                ...input.name !== undefined ? {
                    name: input.name
                } : {},
                ...input.address !== undefined ? {
                    address: input.address
                } : {},
                ...input.geoRadiusM !== undefined ? {
                    geoRadiusM: input.geoRadiusM
                } : {},
                ...input.punchMode !== undefined ? {
                    punchMode: input.punchMode
                } : {},
                ...input.lat !== undefined ? {
                    lat: input.lat
                } : {},
                ...input.lng !== undefined ? {
                    lng: input.lng
                } : {},
                ...input.geoFenceWebPunch !== undefined ? {
                    geoFenceWebPunch: input.geoFenceWebPunch
                } : {}
            }
        });
        const diff = {};
        for (const k of [
            'name',
            'address',
            'geoRadiusM',
            'punchMode',
            'lat',
            'lng',
            'geoFenceWebPunch'
        ])if (l[k] !== saved[k]) diff[k] = {
            from: l[k],
            to: saved[k]
        };
        await this.audit.record({
            action: 'location.updated',
            entity: 'WorkLocation',
            entityId: id,
            meta: diff
        });
        if (diff.punchMode || diff.geoFenceWebPunch || diff.geoRadiusM) {
            const ctx = (0, _requestcontext.requireContext)();
            this.realtime.toTenant(ctx.tenantId, 'policy.updated', {
                locationId: id
            });
            this.realtime.toTenant(ctx.tenantId, 'tracker.policy.updated', {
                locationId: id
            });
        }
        return toLocationRow(saved, (await this.locationCounts()).get(id) ?? 0);
    }
    async deleteLocation(id) {
        const l = await this.prisma.workLocation.findFirst({
            where: {
                id,
                archivedAt: null
            }
        });
        if (!l) throw (0, _errors.notFound)('Location');
        if (l.isSystem) throw new _errors.AppError(409, 'LOCATION_SYSTEM', 'The Remote location cannot be deleted');
        const emps = await this.prisma.employee.count({
            where: {
                workLocationId: id,
                status: {
                    not: 'EXITED'
                }
            }
        });
        if (emps) throw new _errors.AppError(409, 'LOCATION_IN_USE', `${emps} employee${emps === 1 ? ' is' : 's are'} still assigned to this location`);
        const [devices, punches] = await Promise.all([
            this.prisma.biometricDevice.count({
                where: {
                    locationId: id
                }
            }),
            this.prisma.attendancePunch.count({
                where: {
                    locationId: id
                }
            })
        ]);
        if (!devices && !punches) await this.prisma.workLocation.delete({
            where: {
                id
            }
        });
        else await this.prisma.workLocation.update({
            where: {
                id
            },
            data: {
                archivedAt: new Date()
            }
        });
        await this.audit.record({
            action: 'location.archived',
            entity: 'WorkLocation',
            entityId: id,
            meta: {
                name: l.name,
                hardDeleted: !devices && !punches
            }
        });
        return {
            ok: true
        };
    }
    async assignLocation(id, employeeIds) {
        const l = await this.prisma.workLocation.findFirst({
            where: {
                id,
                archivedAt: null
            }
        });
        if (!l) throw (0, _errors.notFound)('Location');
        const res = await this.prisma.employee.updateMany({
            where: {
                id: {
                    in: employeeIds
                },
                status: {
                    not: 'EXITED'
                }
            },
            data: {
                workLocationId: id
            }
        });
        await this.audit.record({
            action: 'location.employees.assigned',
            entity: 'WorkLocation',
            entityId: id,
            meta: {
                employeeIds
            }
        });
        for (const e of employeeIds)this.events.emit('employee.location.changed', {
            employeeId: e,
            locationId: id
        });
        const ctx = (0, _requestcontext.requireContext)();
        this.realtime.toTenant(ctx.tenantId, 'policy.updated', {
            locationId: id
        });
        return {
            ok: true,
            count: res.count
        };
    }
    // ── holidays ──────────────────────────────────────────────────────────────
    async listHolidays(year) {
        const rows = await this.prisma.holiday.findMany({
            where: {
                date: {
                    gte: (0, _timeutils.dateOf)(`${year}-01-01`),
                    lte: (0, _timeutils.dateOf)(`${year}-12-31`)
                }
            },
            orderBy: {
                date: 'asc'
            }
        });
        const locs = await this.prisma.workLocation.findMany({
            select: {
                id: true,
                name: true
            }
        });
        const ln = new Map(locs.map((l)=>[
                l.id,
                l.name
            ]));
        return rows.map((h)=>toHolidayRow(h, ln));
    }
    /** Grouped upcoming holidays ("Diwali 8–9 Nov") from a date (default today). */ async upcoming(from, limit = 8) {
        const start = from ?? (0, _timeutils.istKeyOf)(new Date());
        const rows = await this.prisma.holiday.findMany({
            where: {
                date: {
                    gte: (0, _timeutils.dateOf)(start)
                }
            },
            orderBy: {
                date: 'asc'
            },
            take: 40
        });
        return groupHolidays(rows).slice(0, limit);
    }
    async createHoliday(input) {
        const from = input.date;
        const to = input.endDate && input.endDate > from ? input.endDate : from;
        const created = [];
        for(let d = from; d <= to; d = (0, _timeutils.addDays)(d, 1)){
            const exists = await this.prisma.holiday.findFirst({
                where: {
                    date: (0, _timeutils.dateOf)(d),
                    name: input.name
                }
            });
            if (exists) continue;
            created.push(await this.prisma.holiday.create({
                data: {
                    date: (0, _timeutils.dateOf)(d),
                    name: input.name,
                    type: input.type ?? 'MANDATORY',
                    calendar: input.calendar || `National ${from.slice(0, 4)}`,
                    locationIds: input.locationIds ?? []
                }
            }));
        }
        if (!created.length) throw new _errors.AppError(409, 'DUPLICATE', 'This holiday is already on the calendar');
        await this.audit.record({
            action: 'holiday.created',
            entity: 'Holiday',
            entityId: created[0].id,
            meta: {
                name: input.name,
                from,
                to
            }
        });
        await this.recomputeIfPast(from, to);
        return {
            ok: true,
            count: created.length
        };
    }
    async updateHoliday(id, input) {
        const h = await this.prisma.holiday.findFirst({
            where: {
                id
            }
        });
        if (!h) throw (0, _errors.notFound)('Holiday');
        const saved = await this.prisma.holiday.update({
            where: {
                id
            },
            data: {
                ...input.date ? {
                    date: (0, _timeutils.dateOf)(input.date)
                } : {},
                ...input.name ? {
                    name: input.name
                } : {},
                ...input.type ? {
                    type: input.type
                } : {},
                ...input.calendar !== undefined ? {
                    calendar: input.calendar ?? 'National'
                } : {},
                ...input.locationIds ? {
                    locationIds: input.locationIds
                } : {}
            }
        });
        await this.audit.record({
            action: 'holiday.updated',
            entity: 'Holiday',
            entityId: id,
            meta: {
                name: saved.name
            }
        });
        await this.recomputeIfPast((0, _timeutils.keyOf)(h.date), (0, _timeutils.keyOf)(h.date));
        if (input.date) await this.recomputeIfPast(input.date, input.date);
        return {
            ok: true
        };
    }
    async deleteHoliday(id) {
        const h = await this.prisma.holiday.findFirst({
            where: {
                id
            }
        });
        if (!h) throw (0, _errors.notFound)('Holiday');
        await this.prisma.holiday.delete({
            where: {
                id
            }
        });
        await this.audit.record({
            action: 'holiday.deleted',
            entity: 'Holiday',
            entityId: id,
            meta: {
                name: h.name,
                date: (0, _timeutils.keyOf)(h.date)
            }
        });
        await this.recomputeIfPast((0, _timeutils.keyOf)(h.date), (0, _timeutils.keyOf)(h.date));
        return {
            ok: true
        };
    }
    async importHolidays(year, calendar) {
        const list = (_holidaylists.BUILTIN_HOLIDAYS[year] ?? []).filter((h)=>h.calendars.includes(calendar));
        if (!list.length) throw new _errors.AppError(404, 'NO_LIST', `No built-in ${calendar} list for ${year}`);
        let n = 0;
        for (const h of list){
            const exists = await this.prisma.holiday.findFirst({
                where: {
                    date: (0, _timeutils.dateOf)(h.date),
                    name: h.name
                }
            });
            if (exists) continue;
            await this.prisma.holiday.create({
                data: {
                    date: (0, _timeutils.dateOf)(h.date),
                    name: h.name,
                    type: h.type,
                    calendar: `${calendar} ${year}`,
                    locationIds: []
                }
            });
            n++;
        }
        await this.audit.record({
            action: 'holiday.imported',
            entity: 'Holiday',
            meta: {
                year,
                calendar,
                added: n
            }
        });
        return {
            ok: true,
            count: n
        };
    }
    async copyHolidays(fromYear, toYear) {
        if (fromYear === toYear) throw (0, _errors.badRequest)('Pick a different year');
        const rows = await this.prisma.holiday.findMany({
            where: {
                date: {
                    gte: (0, _timeutils.dateOf)(`${fromYear}-01-01`),
                    lte: (0, _timeutils.dateOf)(`${fromYear}-12-31`)
                }
            }
        });
        let n = 0;
        for (const h of rows){
            const k = (0, _timeutils.keyOf)(h.date);
            const target = `${toYear}${k.slice(4)}`;
            if (target.endsWith('02-29')) continue;
            const exists = await this.prisma.holiday.findFirst({
                where: {
                    date: (0, _timeutils.dateOf)(target),
                    name: h.name
                }
            });
            if (exists) continue;
            await this.prisma.holiday.create({
                data: {
                    date: (0, _timeutils.dateOf)(target),
                    name: h.name,
                    type: h.type,
                    calendar: h.calendar.replace(String(fromYear), String(toYear)),
                    locationIds: h.locationIds
                }
            });
            n++;
        }
        await this.audit.record({
            action: 'holiday.copied',
            entity: 'Holiday',
            meta: {
                fromYear,
                toYear,
                added: n
            }
        });
        return {
            ok: true,
            count: n
        };
    }
    async recomputeIfPast(from, to) {
        const today = (0, _timeutils.istKeyOf)(new Date());
        if (from > today) return;
        const ctx = (0, _requestcontext.requireContext)();
        await this.jobs.enqueue('time.recomputeRange', {
            tenantId: ctx.tenantId,
            employeeIds: null,
            from,
            to: to < today ? to : today
        });
    }
    // ── lookups ───────────────────────────────────────────────────────────────
    async shiftOptions() {
        const rows = await this.prisma.shift.findMany({
            where: {
                archivedAt: null
            },
            orderBy: [
                {
                    isDefault: 'desc'
                },
                {
                    startMinute: 'asc'
                }
            ]
        });
        return rows.map((s)=>({
                value: s.id,
                label: `${s.name} · ${(0, _timeutils.fmtMinute)(s.startMinute)}–${(0, _timeutils.fmtMinute)(s.endMinute)}`
            }));
    }
    async locationOptions() {
        await this.policies.remoteLocation();
        const rows = await this.prisma.workLocation.findMany({
            where: {
                archivedAt: null
            },
            orderBy: [
                {
                    isRemote: 'asc'
                },
                {
                    createdAt: 'asc'
                }
            ]
        });
        return rows.map((l)=>({
                value: l.id,
                label: l.name
            }));
    }
};
MastersService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _policyservice.PolicyService === "undefined" ? Object : _policyservice.PolicyService,
        typeof _periodlockservice.PeriodLockService === "undefined" ? Object : _periodlockservice.PeriodLockService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _jobsservice.JobsService === "undefined" ? Object : _jobsservice.JobsService
    ])
], MastersService);
function toShiftRow(s, employees) {
    return {
        id: s.id,
        name: s.name,
        timing: `${(0, _timeutils.fmtMinute)(s.startMinute)} – ${(0, _timeutils.fmtMinute)(s.endMinute)}`,
        start: (0, _timeutils.fmtMinute)(s.startMinute),
        end: (0, _timeutils.fmtMinute)(s.endMinute),
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        graceMinutes: s.graceMinutes,
        breakMinutes: s.breakMinutes,
        weeklyOffDays: s.weeklyOffDays,
        weeklyOff: (0, _timeutils.weeklyOffLabel)(s.weeklyOffDays),
        employees,
        isDefault: s.isDefault,
        minFullDayMinutes: s.minFullDayMinutes,
        minHalfDayMinutes: s.minHalfDayMinutes,
        halfDayIfLateByMinutes: s.halfDayIfLateByMinutes
    };
}
function toLocationRow(l, employees) {
    return {
        id: l.id,
        name: l.name,
        address: l.address,
        geoRadiusM: l.geoRadiusM,
        geoRadius: l.geoRadiusM ? `${l.geoRadiusM} m` : '—',
        punchMode: l.punchMode,
        punchModeLabel: l.punchMode === 'BIOMETRIC_ONLY' ? 'Biometric only' : 'Web / desktop',
        isRemote: l.isRemote,
        isSystem: l.isSystem,
        employees,
        lat: l.lat,
        lng: l.lng,
        geoFenceWebPunch: l.geoFenceWebPunch
    };
}
function toHolidayRow(h, locNames) {
    const k = (0, _timeutils.keyOf)(h.date);
    return {
        id: h.id,
        date: k,
        dateLabel: (0, _timeutils.dayLabel)(k).slice(4) + ` ${k.slice(0, 4)}`,
        weekday: _timeutils.DOW_SHORT[(0, _timeutils.dateOf)(k).getUTCDay()],
        name: h.name,
        type: h.type === 'OPTIONAL' ? 'OPTIONAL' : 'MANDATORY',
        calendar: h.calendar,
        locations: h.locationIds.length ? h.locationIds.map((id)=>locNames.get(id) ?? '—').join(', ') : 'All locations',
        locationIds: h.locationIds
    };
}
function groupHolidays(rows) {
    const out = [];
    for (const h of rows){
        const k = (0, _timeutils.keyOf)(h.date);
        const last = out.at(-1);
        if (last && last.name === h.name && (0, _timeutils.addDays)(last.to, 1) === k) {
            last.to = k;
            last.days++;
            continue;
        }
        out.push({
            name: h.name,
            from: k,
            to: k,
            label: '',
            days: 1,
            type: h.type
        });
    }
    for (const g of out){
        const a = (0, _timeutils.dateOf)(g.from);
        const b = (0, _timeutils.dateOf)(g.to);
        g.label = g.days === 1 ? (0, _timeutils.dm)(g.from) : a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${(0, _timeutils.dm)(g.to)}` : `${(0, _timeutils.dm)(g.from)} – ${(0, _timeutils.dm)(g.to)}`;
    }
    return out;
}

//# sourceMappingURL=masters.service.js.map