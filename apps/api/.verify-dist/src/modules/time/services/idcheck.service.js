"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "IdCheckService", {
    enumerable: true,
    get: function() {
        return IdCheckService;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _cross = require("../cross");
const _timeutils = require("../lib/time-utils");
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
let IdCheckService = class IdCheckService {
    prisma;
    cross;
    audit;
    notifications;
    realtime;
    constructor(prisma, cross, audit, notifications, realtime){
        this.prisma = prisma;
        this.cross = cross;
        this.audit = audit;
        this.notifications = notifications;
        this.realtime = realtime;
    }
    /** Employees in office on the date: AttendanceDay with effectiveMode OFFICE and a first in. */ async inOffice(date) {
        const days = await this.prisma.attendanceDay.findMany({
            where: {
                date: (0, _timeutils.dateOf)(date),
                effectiveMode: 'OFFICE',
                firstInAt: {
                    not: null
                }
            },
            select: {
                employeeId: true,
                firstInAt: true
            }
        });
        return days;
    }
    async summary(date = (0, _timeutils.istKeyOf)(new Date())) {
        const [inOffice, headcount, checks] = await Promise.all([
            this.inOffice(date),
            this.prisma.employee.count({
                where: {
                    status: {
                        in: [
                            ...ACTIVE
                        ]
                    }
                }
            }),
            this.prisma.idCardCheck.findMany({
                where: {
                    date: (0, _timeutils.dateOf)(date)
                }
            })
        ]);
        const wearing = checks.filter((c)=>c.wearing).length;
        const missing = checks.length - wearing;
        const month = (0, _timeutils.monthOf)(date);
        const monthPct = await this.monthPct(month, date);
        const prev = await this.monthPct((0, _timeutils.prevMonth)(month));
        const reminded = missing > 0 && await this.prisma.notification.count({
            where: {
                type: 'idcheck.missing',
                createdAt: {
                    gte: (0, _timeutils.dateOf)(date)
                }
            }
        }) > 0;
        const inOfficeIds = new Set(inOffice.map((d)=>d.employeeId));
        const checkedIds = new Set(checks.map((c)=>c.employeeId));
        const unchecked = [
            ...inOfficeIds
        ].filter((id)=>!checkedIds.has(id)).length;
        return {
            date,
            inOffice: new Set([
                ...inOfficeIds,
                ...checkedIds
            ]).size,
            headcount,
            checked: checks.length,
            wearing,
            wearingPct: checks.length ? Math.round(wearing / checks.length * 100) : 0,
            missing,
            unchecked,
            remindersSent: reminded,
            monthCompliancePct: monthPct ?? 0,
            prevMonthCompliancePct: prev,
            deltaPct: monthPct != null && prev != null ? monthPct - prev : null
        };
    }
    async monthPct(month, upTo) {
        const { from, to } = (0, _timeutils.monthRange)(month);
        const rows = await this.prisma.idCardCheck.groupBy({
            by: [
                'wearing'
            ],
            where: {
                date: {
                    gte: (0, _timeutils.dateOf)(from),
                    lte: (0, _timeutils.dateOf)(upTo && upTo < to ? upTo : to)
                }
            },
            _count: {
                _all: true
            }
        });
        const total = rows.reduce((s, r)=>s + r._count._all, 0);
        if (!total) return null;
        const yes = rows.find((r)=>r.wearing)?._count._all ?? 0;
        return Math.round(yes / total * 100);
    }
    async list(q) {
        const date = q.date ?? (0, _timeutils.istKeyOf)(new Date());
        const rows = await this.prisma.idCardCheck.findMany({
            where: {
                date: (0, _timeutils.dateOf)(date),
                ...q.wearing === 'yes' ? {
                    wearing: true
                } : q.wearing === 'no' ? {
                    wearing: false
                } : {}
            },
            orderBy: {
                checkedAt: 'asc'
            }
        });
        const out = await this.toRows(rows);
        return q.departmentId ? out.filter((r)=>r.department === q.departmentId || r.department === null) : out;
    }
    async pending(date = (0, _timeutils.istKeyOf)(new Date())) {
        const [inOffice, checks] = await Promise.all([
            this.inOffice(date),
            this.prisma.idCardCheck.findMany({
                where: {
                    date: (0, _timeutils.dateOf)(date)
                },
                select: {
                    employeeId: true
                }
            })
        ]);
        const checked = new Set(checks.map((c)=>c.employeeId));
        const todo = inOffice.filter((d)=>!checked.has(d.employeeId));
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: todo.map((d)=>d.employeeId)
                }
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
        return todo.filter((d)=>em.has(d.employeeId)).map((d)=>({
                employeeId: d.employeeId,
                name: em.get(d.employeeId).fullName,
                department: em.get(d.employeeId).department?.name ?? null,
                firstIn: (0, _timeutils.istHm)(d.firstInAt)
            })).sort((a, b)=>(a.firstIn ?? '').localeCompare(b.firstIn ?? ''));
    }
    async log(input) {
        const ctx = (0, _requestcontext.requireContext)();
        let employeeId = input.employeeId ?? null;
        let method = 'MANUAL_PICK';
        if (input.badgeToken) {
            employeeId = await this.cross.employeeIdFromBadge(input.badgeToken);
            if (!employeeId) throw new _errors.AppError(422, 'BADGE_UNKNOWN', "This badge wasn't recognised · pick the employee instead");
            const revoked = await this.cardRevoked(input.badgeToken);
            if (revoked) throw new _errors.AppError(422, 'BADGE_REVOKED', 'This ID card has been revoked');
            method = 'BADGE_SCAN';
        }
        if (!employeeId) throw (0, _errors.badRequest)('Scan a badge or pick an employee');
        if (employeeId === ctx.employeeId) throw (0, _errors.forbidden)("You can't log your own ID card check");
        const emp = await this.prisma.employee.findFirst({
            where: {
                id: employeeId
            },
            select: {
                id: true,
                fullName: true,
                userId: true,
                managerId: true,
                workLocationId: true
            }
        });
        if (!emp) throw (0, _errors.notFound)('Employee');
        const date = (0, _timeutils.istKeyOf)(new Date());
        const day = await this.prisma.attendanceDay.findFirst({
            where: {
                employeeId,
                date: (0, _timeutils.dateOf)(date)
            },
            select: {
                firstInAt: true,
                effectiveMode: true
            }
        });
        const warning = !day?.firstInAt ? `${emp.fullName} hasn't punched in today` : null;
        const existing = await this.prisma.idCardCheck.findFirst({
            where: {
                employeeId,
                date: (0, _timeutils.dateOf)(date)
            }
        });
        const loggedByName = ctx.userName ?? 'Security desk';
        const data = {
            wearing: input.wearing,
            photoFileId: input.photoFileId ?? existing?.photoFileId ?? null,
            method,
            loggedByUserId: ctx.userId ?? null,
            loggedByName,
            note: input.note ?? null,
            checkedAt: new Date(),
            locationId: emp.workLocationId
        };
        const saved = existing ? await this.prisma.idCardCheck.update({
            where: {
                id: existing.id
            },
            data
        }) : await this.prisma.idCardCheck.create({
            data: {
                employeeId,
                date: (0, _timeutils.dateOf)(date),
                ...data
            }
        });
        await this.audit.record({
            action: existing ? 'idcheck.updated' : 'idcheck.logged',
            entity: 'IdCardCheck',
            entityId: saved.id,
            meta: {
                employeeId,
                wearing: input.wearing,
                method,
                before: existing ? {
                    wearing: existing.wearing,
                    checkedAt: existing.checkedAt.toISOString()
                } : null
            }
        });
        if (!input.wearing) await this.remindOne(saved, emp);
        this.realtime.toTenant(ctx.tenantId, 'idcheck.logged', {
            date
        });
        return {
            ...(await this.toRows([
                saved
            ]))[0],
            warning
        };
    }
    async update(id, wearing, note) {
        const ctx = (0, _requestcontext.requireContext)();
        const c = await this.prisma.idCardCheck.findFirst({
            where: {
                id
            }
        });
        if (!c) throw (0, _errors.notFound)('ID check');
        if (c.employeeId === ctx.employeeId) throw (0, _errors.forbidden)("You can't edit your own ID card check");
        const saved = await this.prisma.idCardCheck.update({
            where: {
                id
            },
            data: {
                wearing,
                note: note ?? c.note,
                loggedByName: ctx.userName ?? c.loggedByName,
                loggedByUserId: ctx.userId ?? null
            }
        });
        await this.audit.record({
            action: 'idcheck.updated',
            entity: 'IdCardCheck',
            entityId: id,
            meta: {
                before: {
                    wearing: c.wearing
                },
                after: {
                    wearing
                }
            }
        });
        if (!wearing && c.wearing) {
            const emp = await this.prisma.employee.findFirst({
                where: {
                    id: c.employeeId
                },
                select: {
                    id: true,
                    fullName: true,
                    userId: true,
                    managerId: true,
                    workLocationId: true
                }
            });
            if (emp) await this.remindOne(saved, emp);
        }
        this.realtime.toTenant(ctx.tenantId, 'idcheck.logged', {
            date: (0, _timeutils.keyOf)(c.date)
        });
        return (await this.toRows([
            saved
        ]))[0];
    }
    /** "Reminder sent": nudge everyone logged as not wearing today who hasn't been reminded yet. */ async remindMissing(date = (0, _timeutils.istKeyOf)(new Date())) {
        const missing = await this.prisma.idCardCheck.findMany({
            where: {
                date: (0, _timeutils.dateOf)(date),
                wearing: false
            }
        });
        let n = 0;
        for (const c of missing){
            const emp = await this.prisma.employee.findFirst({
                where: {
                    id: c.employeeId
                },
                select: {
                    id: true,
                    fullName: true,
                    userId: true,
                    managerId: true,
                    workLocationId: true
                }
            });
            if (emp) {
                await this.remindOne(c, emp, true);
                n++;
            }
        }
        return {
            ok: true,
            count: n
        };
    }
    async remindOne(c, emp, force = false) {
        const date = (0, _timeutils.keyOf)(c.date);
        if (emp.userId) {
            const already = !force && await this.prisma.notification.count({
                where: {
                    userId: emp.userId,
                    type: 'idcheck.missing',
                    createdAt: {
                        gte: (0, _timeutils.dateOf)(date)
                    }
                }
            }) > 0;
            if (!already) {
                await this.notifications.notify({
                    userIds: [
                        emp.userId
                    ],
                    type: 'idcheck.missing',
                    title: `Please wear your ID card (logged ${(0, _timeutils.istHm)(c.checkedAt)} by ${c.loggedByName})`,
                    link: '/attendance',
                    from: c.loggedByName
                });
            }
        }
        // 3rd miss this month → RM and HR
        const { from } = (0, _timeutils.monthRange)((0, _timeutils.monthOf)(date));
        const misses = await this.prisma.idCardCheck.count({
            where: {
                employeeId: emp.id,
                wearing: false,
                date: {
                    gte: (0, _timeutils.dateOf)(from),
                    lte: c.date
                }
            }
        });
        if (misses === 3) {
            const users = [
                ...await this.notifications.usersForEmployees([
                    emp.managerId
                ]),
                ...await this.notifications.usersWithPermission('idcompliance.manage')
            ];
            await this.notifications.notify({
                userIds: users,
                type: 'idcheck.repeat',
                title: `${emp.fullName} missed their ID card 3 times this month`,
                link: '/id-compliance',
                from: 'ID compliance'
            });
        }
    }
    async cardRevoked(token) {
        try {
            const card = await this.prisma.idCard?.findFirst({
                where: {
                    verifyToken: token.trim()
                },
                select: {
                    revokedAt: true
                }
            });
            return !!card?.revokedAt;
        } catch  {
            return false;
        }
    }
    /** Employee Attendance card "ID card check". */ async mine(employeeId) {
        const today = (0, _timeutils.istKeyOf)(new Date());
        const { from } = (0, _timeutils.monthRange)((0, _timeutils.monthOf)(today));
        const [todayRow, monthRows] = await Promise.all([
            this.prisma.idCardCheck.findFirst({
                where: {
                    employeeId,
                    date: (0, _timeutils.dateOf)(today)
                }
            }),
            this.prisma.idCardCheck.findMany({
                where: {
                    employeeId,
                    date: {
                        gte: (0, _timeutils.dateOf)(from),
                        lte: (0, _timeutils.dateOf)(today)
                    }
                },
                select: {
                    wearing: true
                }
            })
        ]);
        const yes = monthRows.filter((r)=>r.wearing).length;
        const meta = `Compliance this month: ${yes} / ${monthRows.length} days`;
        if (!todayRow) return {
            title: 'Not checked today',
            body: 'Security logs ID cards at the office entrance',
            meta,
            checkedToday: false
        };
        const body = `Logged by ${todayRow.loggedByName} · ${todayRow.photoFileId ? 'photo on file' : 'no photo'}`;
        return {
            title: todayRow.wearing ? `Verified today, ${(0, _timeutils.istHm)(todayRow.checkedAt)}` : `ID missing · logged ${(0, _timeutils.istHm)(todayRow.checkedAt)}`,
            body,
            meta,
            checkedToday: true
        };
    }
    /** File access: HR/admin, or the subject employee, may open an ID-check photo. */ async canOpenPhoto(fileId) {
        const ctx = (0, _requestcontext.requireContext)();
        const c = await this.prisma.idCardCheck.findFirst({
            where: {
                photoFileId: fileId
            },
            select: {
                employeeId: true
            }
        });
        if (!c) return false;
        return c.employeeId === ctx.employeeId || ctx.permissions.has('*') || ctx.permissions.has('idcompliance.manage');
    }
    async toRows(rows) {
        const emps = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(rows.map((r)=>r.employeeId))
                    ]
                }
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
        return rows.map((r)=>({
                id: r.id,
                employeeId: r.employeeId,
                employeeName: em.get(r.employeeId)?.fullName ?? '—',
                department: em.get(r.employeeId)?.department?.name ?? null,
                checkedAt: (0, _timeutils.istHm)(r.checkedAt),
                wearing: r.wearing,
                photo: r.photoFileId ? 'Taken' : 'Skipped',
                photoFileId: r.photoFileId,
                loggedBy: r.loggedByName,
                date: (0, _timeutils.keyOf)(r.date)
            }));
    }
};
IdCheckService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _cross.CrossReader === "undefined" ? Object : _cross.CrossReader,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway
    ])
], IdCheckService);

//# sourceMappingURL=idcheck.service.js.map