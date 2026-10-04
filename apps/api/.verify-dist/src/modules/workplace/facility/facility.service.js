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
    get FacilityService () {
        return FacilityService;
    },
    get passUrlFor () {
        return passUrlFor;
    }
});
const _common = require("@nestjs/common");
const _qrcode = /*#__PURE__*/ _interop_require_default(require("qrcode"));
const _shared = require("@lexisora/shared");
const _env = require("../../../config/env");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _mailservice = require("../../../core/mail/mail.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _sequenceservice = require("../../../core/registry/sequence.service");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _audience = require("../common/audience");
const _dates = require("../common/dates");
const _messenger = require("./adapters/messenger");
const _facilityrules = require("./facility.rules");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
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
const ACTIVE_PASS = [
    'REGISTERED',
    'PASS_SENT',
    'CHECKED_IN'
];
const istKey = (d)=>(0, _dates.keyOf)(new Date(d.getTime() + 330 * 60_000));
const passUrlFor = (token)=>`${_env.env.WEB_ORIGIN.replace(/\/$/, '')}/api/v1/facility/pass/${token}`;
let FacilityService = class FacilityService {
    prisma;
    audit;
    notifications;
    mail;
    realtime;
    seq;
    audience;
    log = new _common.Logger('Facility');
    whatsapp = (0, _messenger.messengerFromEnv)();
    constructor(prisma, audit, notifications, mail, realtime, seq, audience){
        this.prisma = prisma;
        this.audit = audit;
        this.notifications = notifications;
        this.mail = mail;
        this.realtime = realtime;
        this.seq = seq;
        this.audience = audience;
    }
    me() {
        const ctx = (0, _requestcontext.requireContext)();
        if (!ctx.employeeId) throw (0, _errors.forbidden)('Your login is not linked to an employee record');
        return {
            ctx,
            employeeId: ctx.employeeId
        };
    }
    canManage(ctx = (0, _requestcontext.requireContext)()) {
        return (0, _decorators.hasPerm)(ctx, 'facility.manage');
    }
    // ── Rooms ───────────────────────────────────────────────────────────────
    async rooms(all = false) {
        const ctx = (0, _requestcontext.requireContext)();
        const manage = this.canManage(ctx);
        const [rows, branches, upcoming, me] = await Promise.all([
            this.prisma.room.findMany({
                where: all && manage ? {} : {
                    active: true
                },
                orderBy: {
                    name: 'asc'
                }
            }),
            this.prisma.branch.findMany({
                select: {
                    id: true,
                    name: true
                }
            }),
            this.prisma.roomBooking.findMany({
                where: {
                    status: 'BOOKED',
                    endAt: {
                        gt: new Date()
                    }
                },
                select: {
                    roomId: true
                }
            }),
            ctx.employeeId ? this.prisma.employee.findFirst({
                where: {
                    id: ctx.employeeId
                },
                select: {
                    branchId: true
                }
            }) : null
        ]);
        const branchName = new Map(branches.map((b)=>[
                b.id,
                b.name
            ]));
        const count = new Map();
        for (const b of upcoming)count.set(b.roomId, (count.get(b.roomId) ?? 0) + 1);
        const myBranch = me?.branchId ?? null;
        return rows.map((r)=>({
                id: r.id,
                name: r.name,
                capacity: r.capacity,
                amenities: r.amenities,
                branchId: r.branchId,
                branch: r.branchId ? branchName.get(r.branchId) ?? null : null,
                active: r.active,
                openFrom: r.openFrom,
                openTo: r.openTo,
                maxBookingMins: r.maxBookingMins,
                upcoming: count.get(r.id) ?? 0
            })).sort((a, b)=>Number(!!myBranch && b.branchId === myBranch) - Number(!!myBranch && a.branchId === myBranch) || a.name.localeCompare(b.name));
    }
    async upsertRoom(id, dto) {
        if (!this.canManage()) throw (0, _errors.forbidden)('Only the facility manager can change rooms');
        const clash = await this.prisma.room.findFirst({
            where: {
                name: dto.name,
                ...id ? {
                    id: {
                        not: id
                    }
                } : {}
            }
        });
        if (clash) throw (0, _errors.conflict)(`${dto.name} already exists`, 'ROOM_EXISTS');
        const data = {
            name: dto.name,
            capacity: dto.capacity,
            amenities: dto.amenities,
            branchId: dto.branchId ?? null,
            active: dto.active
        };
        if (id) {
            const r = await this.prisma.room.findFirst({
                where: {
                    id
                }
            });
            if (!r) throw (0, _errors.notFound)('Room');
            await this.prisma.room.update({
                where: {
                    id
                },
                data
            });
        } else {
            await this.prisma.room.create({
                data: {
                    tenantId: (0, _requestcontext.currentTenantId)(),
                    ...data
                }
            });
        }
        await this.audit.record({
            action: id ? 'facility.room.update' : 'facility.room.create',
            entity: 'Room',
            entityId: id ?? dto.name,
            meta: {
                name: dto.name
            }
        });
        return this.rooms(true);
    }
    /** Busy intervals per room for one IST date (calendar + inline conflict hints). */ async availability(date) {
        const { employeeId } = this.me();
        const rooms = await this.prisma.room.findMany({
            where: {
                active: true
            },
            orderBy: {
                name: 'asc'
            }
        });
        const from = (0, _dates.istInstant)(date, '00:00');
        const to = (0, _dates.istInstant)((0, _dates.addDaysKey)(date, 1), '00:00');
        const bookings = await this.prisma.roomBooking.findMany({
            where: {
                status: 'BOOKED',
                startAt: {
                    lt: to
                },
                endAt: {
                    gt: from
                }
            },
            orderBy: {
                startAt: 'asc'
            }
        });
        const briefs = await this.audience.briefs(bookings.map((b)=>b.hostEmployeeId));
        return {
            date,
            rooms: rooms.map((r)=>({
                    id: r.id,
                    name: r.name,
                    capacity: r.capacity,
                    openFrom: r.openFrom,
                    openTo: r.openTo,
                    busy: bookings.filter((b)=>b.roomId === r.id).map((b)=>({
                            bookingId: b.id,
                            from: (0, _dates.hhmm)(b.startAt),
                            to: (0, _dates.hhmm)(b.endAt),
                            host: briefs.get(b.hostEmployeeId)?.name ?? 'Someone',
                            purpose: b.purpose,
                            mine: b.hostEmployeeId === employeeId
                        }))
                }))
        };
    }
    async clashMessage(roomName, b) {
        const host = (await this.audience.briefs([
            b.hostEmployeeId
        ])).get(b.hostEmployeeId)?.name ?? 'someone';
        return `${roomName} is booked ${(0, _facilityrules.timeRange)((0, _dates.hhmm)(b.startAt), (0, _dates.hhmm)(b.endAt))} by ${host}`;
    }
    /** Inline check before submit (same rules as booking). */ async check(q) {
        const { employeeId } = this.me();
        const room = await this.prisma.room.findFirst({
            where: {
                id: q.roomId,
                active: true
            }
        });
        if (!room) return {
            ok: false,
            message: 'Pick a room'
        };
        const problem = (0, _facilityrules.bookingProblem)(q, room);
        if (problem) return {
            ok: false,
            message: problem
        };
        const startAt = (0, _dates.istInstant)(q.date, q.from);
        const endAt = (0, _dates.istInstant)(q.date, q.to);
        const existing = await this.prisma.roomBooking.findMany({
            where: {
                roomId: room.id,
                status: 'BOOKED',
                startAt: {
                    lt: endAt
                },
                endAt: {
                    gt: startAt
                }
            }
        });
        const clash = (0, _facilityrules.findConflict)(existing, {
            startAt,
            endAt
        }, q.excludeId);
        if (clash) return {
            ok: false,
            message: await this.clashMessage(room.name, clash)
        };
        const mine = await this.prisma.roomBooking.findMany({
            where: {
                hostEmployeeId: employeeId,
                status: 'BOOKED',
                startAt: {
                    lt: endAt
                },
                endAt: {
                    gt: startAt
                }
            }
        });
        const hp = (0, _facilityrules.hostOverlapProblem)(mine, {
            startAt,
            endAt
        }, q.excludeId);
        return hp ? {
            ok: false,
            message: hp
        } : {
            ok: true,
            message: `${room.name} is free ${(0, _facilityrules.timeRange)(q.from, q.to)}`
        };
    }
    // ── Lists ───────────────────────────────────────────────────────────────
    bookingWhere(q, employeeId) {
        const now = new Date();
        const range = q.date ? {
            startAt: {
                lt: (0, _dates.istInstant)((0, _dates.addDaysKey)(q.date, 1), '00:00')
            },
            endAt: {
                gt: (0, _dates.istInstant)(q.date, '00:00')
            }
        } : q.upcoming ? {
            endAt: {
                gt: now
            }
        } : {
            startAt: {
                gte: (0, _dates.istInstant)((0, _dates.addDaysKey)((0, _dates.todayKey)(), -7), '00:00')
            }
        };
        return {
            ...range,
            ...q.roomId ? {
                roomId: q.roomId
            } : {},
            ...q.scope === 'mine' ? {
                OR: [
                    {
                        hostEmployeeId: employeeId
                    },
                    {
                        attendeeEmployeeIds: {
                            has: employeeId
                        }
                    }
                ]
            } : {}
        };
    }
    visitorWhere(q, employeeId, manage) {
        const range = q.date ? {
            visitDate: (0, _dates.dateOnly)(q.date)
        } : q.upcoming ? {
            visitDate: {
                gte: (0, _dates.dateOnly)((0, _dates.todayKey)())
            }
        } : {
            visitDate: {
                gte: (0, _dates.dateOnly)((0, _dates.addDaysKey)((0, _dates.todayKey)(), -7))
            }
        };
        return {
            ...range,
            ...manage && q.scope === 'all' ? {} : {
                hostEmployeeId: employeeId
            }
        };
    }
    async list(q) {
        const { ctx, employeeId } = this.me();
        const manage = this.canManage(ctx);
        const bw = this.bookingWhere(q, employeeId);
        const vw = this.visitorWhere(q, employeeId, manage);
        const [bookingCount, visitorCount] = await Promise.all([
            this.prisma.roomBooking.count({
                where: bw
            }),
            this.prisma.visitor.count({
                where: vw
            })
        ]);
        let items;
        if (q.tab === 'visitors') {
            const rows = await this.prisma.visitor.findMany({
                where: vw,
                orderBy: [
                    {
                        visitDate: 'asc'
                    },
                    {
                        expectedTime: 'asc'
                    }
                ],
                take: 200
            });
            items = await this.visitorRows(rows, ctx, employeeId);
        } else {
            const rows = await this.prisma.roomBooking.findMany({
                where: bw,
                include: {
                    room: true
                },
                orderBy: {
                    startAt: 'asc'
                },
                take: 200
            });
            items = await this.bookingRows(rows, ctx, employeeId);
        }
        return {
            items,
            counts: {
                bookings: bookingCount,
                visitors: visitorCount
            },
            canManage: manage
        };
    }
    async bookingRows(rows, ctx, employeeId) {
        const briefs = await this.audience.briefs(rows.map((r)=>r.hostEmployeeId));
        const manage = this.canManage(ctx);
        const now = Date.now();
        return rows.map((b)=>{
            const host = b.hostEmployeeId === employeeId;
            const live = b.status === 'BOOKED' && b.endAt.getTime() > now;
            return {
                id: b.id,
                kind: 'booking',
                name: b.room.name,
                date: (0, _dates.dayMonth)(b.startAt),
                dateKey: istKey(b.startAt),
                time: (0, _facilityrules.timeRange)((0, _dates.hhmm)(b.startAt), (0, _dates.hhmm)(b.endAt)),
                host: briefs.get(b.hostEmployeeId)?.name ?? 'Former employee',
                hostEmployeeId: b.hostEmployeeId,
                purpose: b.purpose,
                status: b.status,
                statusLabel: _shared.BOOKING_STATUS_LABEL[b.status] ?? b.status,
                tone: (0, _facilityrules.bookingTone)(b.status),
                canCancel: live && (host || manage),
                canEdit: live && host && b.startAt.getTime() > now,
                canCheckIn: false,
                canCheckOut: false,
                canResend: false,
                roomId: b.roomId,
                from: (0, _dates.hhmm)(b.startAt),
                to: (0, _dates.hhmm)(b.endAt)
            };
        });
    }
    async visitorRows(rows, ctx, employeeId) {
        const briefs = await this.audience.briefs(rows.map((r)=>r.hostEmployeeId));
        const manage = this.canManage(ctx);
        const today = (0, _dates.todayKey)();
        return rows.map((v)=>{
            const host = v.hostEmployeeId === employeeId;
            const dateKey = (0, _dates.keyOf)(v.visitDate);
            const pending = v.status === 'REGISTERED' || v.status === 'PASS_SENT';
            const shareable = (host || manage) && pending && dateKey >= today && !v.passRevokedAt;
            const wa = (v.deliveries ?? []).find((d)=>d.channel === 'WHATSAPP' && d.link)?.link ?? null;
            return {
                id: v.id,
                kind: 'visitor',
                name: v.company ? `${v.name} (${v.company})` : v.name,
                date: (0, _dates.dayMonth)(v.visitDate),
                dateKey,
                time: (0, _facilityrules.visitorTimeLabel)(v.expectedTime, v.checkedInAt ? (0, _dates.hhmm)(v.checkedInAt) : null, v.checkedOutAt ? (0, _dates.hhmm)(v.checkedOutAt) : null),
                host: briefs.get(v.hostEmployeeId)?.name ?? 'Former employee',
                hostEmployeeId: v.hostEmployeeId,
                purpose: v.purpose,
                status: v.status,
                statusLabel: _shared.VISITOR_STATUS_LABEL[v.status] ?? v.status,
                tone: (0, _facilityrules.visitorTone)(v.status),
                canCancel: (host || manage) && pending,
                canEdit: false,
                canCheckIn: manage && pending && dateKey === today,
                canCheckOut: manage && v.status === 'CHECKED_IN',
                canResend: shareable,
                passLink: host || manage ? passUrlFor(v.passToken) : null,
                waLink: shareable ? wa : null,
                shortCode: host || manage ? v.shortCode : null,
                company: v.company
            };
        });
    }
    // ── Bookings ────────────────────────────────────────────────────────────
    async contacts(employeeIds) {
        const rows = await this.prisma.employee.findMany({
            where: {
                id: {
                    in: [
                        ...new Set(employeeIds)
                    ]
                }
            },
            select: {
                id: true,
                fullName: true,
                officialEmail: true,
                userId: true
            }
        });
        return new Map(rows.map((r)=>[
                r.id,
                {
                    name: r.fullName,
                    email: r.officialEmail,
                    userId: r.userId
                }
            ]));
    }
    async sendInvites(b, room, method) {
        const people = await this.contacts([
            b.hostEmployeeId,
            ...b.attendeeEmployeeIds
        ]);
        const host = people.get(b.hostEmployeeId);
        if (!host) return;
        const attendees = b.attendeeEmployeeIds.map((id)=>people.get(id)).filter((x)=>!!x);
        const when = `${(0, _dates.longDate)(b.startAt)}, ${(0, _facilityrules.timeRange)((0, _dates.hhmm)(b.startAt), (0, _dates.hhmm)(b.endAt))}`;
        const ics = (0, _facilityrules.bookingIcs)({
            uid: `${b.id}@lexisora-hrms`,
            method,
            startAt: b.startAt,
            endAt: b.endAt,
            summary: b.purpose,
            location: room.name,
            organizer: host,
            attendees,
            sequence: method === 'CANCEL' ? 2 : 1
        });
        const to = [
            host.email,
            ...attendees.map((a)=>a.email)
        ];
        await this.mail.send({
            to,
            subject: `${method === 'CANCEL' ? 'Cancelled: ' : ''}${b.purpose} · ${room.name}`,
            text: `${method === 'CANCEL' ? 'This booking was cancelled.' : 'Room booked.'}\n\n${b.purpose}\n${room.name} · ${when}\nHost: ${host.name}`,
            icalEvent: {
                filename: 'invite.ics',
                method,
                content: ics
            }
        });
    }
    async book(dto) {
        const { ctx, employeeId } = this.me();
        const room = await this.prisma.room.findFirst({
            where: {
                id: dto.roomId,
                active: true
            }
        });
        if (!room) throw (0, _errors.notFound)('Room');
        const problem = (0, _facilityrules.bookingProblem)(dto, room);
        if (problem) throw (0, _errors.badRequest)(problem, 'BOOKING_INVALID');
        const startAt = (0, _dates.istInstant)(dto.date, dto.from);
        const endAt = (0, _dates.istInstant)(dto.date, dto.to);
        const attendees = [
            ...new Set(dto.attendeeEmployeeIds.filter((x)=>x && x !== employeeId))
        ];
        const created = await this.prisma.$transaction(async (tx)=>{
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${room.id}))::text AS locked`;
            const existing = await tx.roomBooking.findMany({
                where: {
                    roomId: room.id,
                    status: 'BOOKED',
                    startAt: {
                        lt: endAt
                    },
                    endAt: {
                        gt: startAt
                    }
                }
            });
            const clash = (0, _facilityrules.findConflict)(existing, {
                startAt,
                endAt
            });
            if (clash) throw (0, _errors.conflict)(await this.clashMessage(room.name, clash), 'BOOKING_CONFLICT');
            const mine = await tx.roomBooking.findMany({
                where: {
                    hostEmployeeId: employeeId,
                    status: 'BOOKED',
                    startAt: {
                        lt: endAt
                    },
                    endAt: {
                        gt: startAt
                    }
                }
            });
            const hp = (0, _facilityrules.hostOverlapProblem)(mine, {
                startAt,
                endAt
            });
            if (hp) throw (0, _errors.conflict)(hp, 'BOOKING_HOST_LIMIT');
            return tx.roomBooking.create({
                data: {
                    tenantId: (0, _requestcontext.currentTenantId)(),
                    roomId: room.id,
                    hostEmployeeId: employeeId,
                    purpose: dto.purpose,
                    startAt,
                    endAt,
                    attendeeEmployeeIds: attendees
                }
            });
        });
        await this.audit.record({
            action: 'facility.booking.create',
            entity: 'RoomBooking',
            entityId: created.id,
            meta: {
                room: room.name,
                date: dto.date,
                from: dto.from,
                to: dto.to
            }
        });
        if (attendees.length) {
            const users = await this.audience.userIds(attendees);
            await this.notifications.notify({
                userIds: users,
                type: 'facility.booking',
                title: `${ctx.userName ?? 'A colleague'} invited you: ${dto.purpose}`,
                body: `${room.name} · ${(0, _dates.dayMonth)(startAt)} · ${(0, _facilityrules.timeRange)(dto.from, dto.to)}`,
                link: '/facility',
                from: ctx.userName ?? undefined
            });
        }
        void this.sendInvites(created, room, 'REQUEST').catch((e)=>this.log.warn(`invite: ${e.message}`));
        this.realtime.toTenant(ctx.tenantId, 'facility:booking', {
            roomId: room.id,
            date: dto.date
        });
        const [row] = await this.bookingRows([
            {
                ...created,
                room
            }
        ], ctx, employeeId);
        return row;
    }
    async updateBooking(id, dto) {
        const { ctx, employeeId } = this.me();
        const b = await this.prisma.roomBooking.findFirst({
            where: {
                id
            },
            include: {
                room: true
            }
        });
        if (!b) throw (0, _errors.notFound)('Booking');
        if (b.hostEmployeeId !== employeeId) throw (0, _errors.forbidden)('Only the host can change the time');
        if (b.status !== 'BOOKED') throw (0, _errors.conflict)('This booking is no longer active', 'BOOKING_CLOSED');
        const problem = (0, _facilityrules.bookingProblem)(dto, b.room);
        if (problem) throw (0, _errors.badRequest)(problem, 'BOOKING_INVALID');
        const startAt = (0, _dates.istInstant)(dto.date, dto.from);
        const endAt = (0, _dates.istInstant)(dto.date, dto.to);
        const updated = await this.prisma.$transaction(async (tx)=>{
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${b.roomId}))::text AS locked`;
            const existing = await tx.roomBooking.findMany({
                where: {
                    roomId: b.roomId,
                    status: 'BOOKED',
                    startAt: {
                        lt: endAt
                    },
                    endAt: {
                        gt: startAt
                    }
                }
            });
            const clash = (0, _facilityrules.findConflict)(existing, {
                startAt,
                endAt
            }, id);
            if (clash) throw (0, _errors.conflict)(await this.clashMessage(b.room.name, clash), 'BOOKING_CONFLICT');
            return tx.roomBooking.update({
                where: {
                    id
                },
                data: {
                    startAt,
                    endAt
                }
            });
        });
        await this.audit.record({
            action: 'facility.booking.update',
            entity: 'RoomBooking',
            entityId: id,
            meta: {
                date: dto.date,
                from: dto.from,
                to: dto.to
            }
        });
        void this.sendInvites(updated, b.room, 'REQUEST').catch((e)=>this.log.warn(`invite: ${e.message}`));
        this.realtime.toTenant(ctx.tenantId, 'facility:booking', {
            roomId: b.roomId,
            date: dto.date
        });
        const [row] = await this.bookingRows([
            {
                ...updated,
                room: b.room
            }
        ], ctx, employeeId);
        return row;
    }
    async cancelBooking(id, reason) {
        const { ctx, employeeId } = this.me();
        const b = await this.prisma.roomBooking.findFirst({
            where: {
                id
            },
            include: {
                room: true
            }
        });
        if (!b) throw (0, _errors.notFound)('Booking');
        const host = b.hostEmployeeId === employeeId;
        if (!host && !this.canManage(ctx)) throw (0, _errors.forbidden)('Only the host or the facility manager can cancel');
        if (b.status !== 'BOOKED') throw (0, _errors.conflict)('This booking is already closed', 'BOOKING_CLOSED');
        const updated = await this.prisma.roomBooking.update({
            where: {
                id
            },
            data: {
                status: 'CANCELLED',
                cancelledByEmployeeId: employeeId,
                cancelReason: reason ?? null
            }
        });
        await this.audit.record({
            action: 'facility.booking.cancel',
            entity: 'RoomBooking',
            entityId: id,
            meta: {
                reason: reason ?? null
            }
        });
        const notifyIds = [
            ...b.attendeeEmployeeIds,
            ...host ? [] : [
                b.hostEmployeeId
            ]
        ];
        if (notifyIds.length) {
            const users = await this.audience.userIds(notifyIds);
            await this.notifications.notify({
                userIds: users,
                type: 'facility.booking',
                title: `Cancelled: ${b.purpose}`,
                body: `${b.room.name} · ${(0, _dates.dayMonth)(b.startAt)} · ${(0, _facilityrules.timeRange)((0, _dates.hhmm)(b.startAt), (0, _dates.hhmm)(b.endAt))}${reason ? ` — ${reason}` : ''}`,
                link: '/facility'
            });
        }
        void this.sendInvites(updated, b.room, 'CANCEL').catch((e)=>this.log.warn(`invite: ${e.message}`));
        this.realtime.toTenant(ctx.tenantId, 'facility:booking', {
            roomId: b.roomId,
            date: istKey(b.startAt)
        });
        const [row] = await this.bookingRows([
            {
                ...updated,
                room: b.room
            }
        ], ctx, employeeId);
        return row;
    }
    // ── Visitors ────────────────────────────────────────────────────────────
    async nextVisitorNumber() {
        const max = (await this.prisma.visitor.aggregate({
            _max: {
                number: true
            }
        }))._max.number ?? 0;
        const n = await this.seq.nextValue('facility.visitor', {
            start: max + 1
        });
        return n > max ? n : max + 1;
    }
    async uniqueShortCode() {
        for(let i = 0; i < 8; i++){
            const code = (0, _facilityrules.newShortCode)();
            const taken = await this.prisma.visitor.findFirst({
                where: {
                    shortCode: code,
                    status: {
                        in: [
                            ...ACTIVE_PASS
                        ]
                    },
                    passRevokedAt: null
                }
            });
            if (!taken) return code;
        }
        throw new _errors.AppError(503, 'PASS_CODE_EXHAUSTED', 'Could not issue a pass code — try again');
    }
    async tenantName() {
        const t = await this.prisma.raw.tenant.findUnique({
            where: {
                id: (0, _requestcontext.currentTenantId)()
            },
            select: {
                name: true,
                brandName: true
            }
        });
        return t?.brandName ?? t?.name ?? 'Lexisora';
    }
    /** WhatsApp (to the visitor) and/or email (to the visitor), plus a copy of the pass to the host by email. */ async deliver(v, via) {
        const company = await this.tenantName();
        const passUrl = passUrlFor(v.passToken);
        const when = `${(0, _dates.dayMonth)(v.visitDate)} at ${v.expectedTime}`;
        const text = `Hi ${v.name.split(' ')[0]}, your visitor pass for ${company} on ${when}. Show this at reception: ${passUrl} (pass code ${v.shortCode}).`;
        const out = [];
        const wantWa = via !== 'EMAIL' && !!v.phone;
        const wantEmail = (via !== 'WHATSAPP' || !v.phone) && !!v.email;
        if (wantWa) out.push(await this.whatsapp.sendPass({
            phone: v.phone,
            text
        }));
        const qr = await _qrcode.default.toBuffer(passUrl, {
            type: 'png',
            margin: 1,
            width: 360
        });
        const host = (await this.contacts([
            v.hostEmployeeId
        ])).get(v.hostEmployeeId);
        const html = (greeting)=>`<p>${greeting}</p><p><strong>${escapeHtml(v.name)}</strong>${v.company ? ` · ${escapeHtml(v.company)}` : ''}<br>${escapeHtml((0, _dates.longDate)((0, _dates.istInstant)((0, _dates.keyOf)(v.visitDate), v.expectedTime)))} · ${v.expectedTime}<br>Host: ${escapeHtml(host?.name ?? '')}</p><p>Pass code <strong style="letter-spacing:2px">${v.shortCode}</strong> · <a href="${passUrl}">Open e-pass</a></p><p><img src="cid:epass-qr" width="180" height="180" alt="QR code"></p>`;
        const attachments = [
            {
                filename: 'e-pass.png',
                content: qr,
                contentType: 'image/png',
                cid: 'epass-qr'
            }
        ];
        if (wantEmail) {
            const ok = await this.mail.send({
                to: v.email,
                subject: `Your visitor pass · ${company} · ${(0, _dates.dayMonth)(v.visitDate)}`,
                text,
                html: html(`Hi ${escapeHtml(v.name.split(' ')[0])}, here is your visitor pass for ${escapeHtml(company)}.`),
                attachments
            });
            out.push({
                channel: 'EMAIL',
                to: v.email,
                status: ok ? 'SENT' : 'FAILED',
                link: null,
                sentAt: new Date().toISOString()
            });
        }
        if (host?.email) {
            const wa = out.find((d)=>d.channel === 'WHATSAPP')?.link;
            void this.mail.send({
                to: host.email,
                subject: `E-pass for your visitor ${v.name} · ${(0, _dates.dayMonth)(v.visitDate)}`,
                text: `${text}${wa ? `\n\nShare on WhatsApp: ${wa}` : ''}`,
                html: html(`The e-pass for your visitor is ready.${wa ? ` <a href="${wa}">Share it on WhatsApp</a>.` : ''}`),
                attachments
            }).catch(()=>undefined);
        }
        const delivered = [
            ...new Set(out.filter((d)=>d.status !== 'FAILED').map((d)=>d.channel))
        ];
        return {
            deliveries: out,
            delivered,
            waLink: out.find((d)=>d.channel === 'WHATSAPP')?.link ?? null
        };
    }
    async registerVisitor(dto) {
        const { ctx, employeeId } = this.me();
        const manage = this.canManage(ctx);
        const hostId = dto.hostEmployeeId || employeeId;
        if (hostId !== employeeId && !manage) throw (0, _errors.forbidden)('Only the front desk can register a visitor for someone else');
        if (dto.walkIn && !manage) throw (0, _errors.forbidden)('Walk-ins are registered at the front desk');
        const host = await this.prisma.employee.findFirst({
            where: {
                id: hostId,
                status: {
                    in: [
                        'ACTIVE',
                        'NOTICE_PERIOD',
                        'ONBOARDING'
                    ]
                }
            },
            select: {
                id: true,
                fullName: true,
                userId: true,
                branchId: true
            }
        });
        if (!host) throw (0, _errors.badRequest)('Pick a host from your organisation');
        const today = (0, _dates.todayKey)();
        if (dto.date < today) throw (0, _errors.badRequest)('Pick today or a later date');
        if (dto.date > (0, _dates.addDaysKey)(today, 60)) throw (0, _errors.badRequest)('Visitors can be registered up to 60 days ahead');
        const win = (0, _facilityrules.passWindow)(dto.date, dto.expectedTime);
        const number = await this.nextVisitorNumber();
        const v = await this.prisma.visitor.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                number,
                name: dto.name,
                company: dto.company ?? null,
                phone: dto.phone ? dto.phone.startsWith('+91') ? dto.phone : `+91${dto.phone.replace(/^0/, '')}` : null,
                email: dto.email ?? null,
                hostEmployeeId: hostId,
                branchId: host.branchId,
                visitDate: (0, _dates.dateOnly)(dto.date),
                expectedTime: dto.expectedTime,
                purpose: dto.purpose,
                passToken: (0, _facilityrules.newPassToken)(),
                shortCode: await this.uniqueShortCode(),
                validFrom: dto.walkIn ? new Date(Math.min(win.validFrom.getTime(), Date.now())) : win.validFrom,
                validUntil: win.validUntil
            }
        });
        const sent = await this.deliver(v, dto.sendVia);
        let saved = await this.prisma.visitor.update({
            where: {
                id: v.id
            },
            data: {
                deliveries: sent.deliveries,
                status: sent.delivered.length ? 'PASS_SENT' : 'REGISTERED'
            }
        });
        if (dto.walkIn) saved = await this.prisma.visitor.update({
            where: {
                id: v.id
            },
            data: {
                status: 'CHECKED_IN',
                checkedInAt: new Date(),
                checkedInByEmployeeId: employeeId
            }
        });
        await this.audit.record({
            action: 'facility.visitor.register',
            entity: 'Visitor',
            entityId: v.id,
            meta: {
                code: (0, _facilityrules.visitorCode)(number),
                host: host.fullName,
                date: dto.date,
                delivered: sent.delivered,
                walkIn: dto.walkIn
            }
        });
        if (host.userId && hostId !== employeeId) {
            await this.notifications.notify({
                userIds: [
                    host.userId
                ],
                type: dto.walkIn ? 'facility.visitor.arrived' : 'facility.visitor',
                title: dto.walkIn ? `${dto.name} has arrived at reception` : `Visitor registered for you: ${dto.name}`,
                body: `${(0, _dates.dayMonth)(v.visitDate)} · ${dto.expectedTime}${dto.company ? ` · ${dto.company}` : ''}`,
                link: '/facility?tab=visitors'
            });
        }
        this.realtime.toTenant(ctx.tenantId, 'facility:visitor', {
            id: v.id,
            status: saved.status
        });
        const [row] = await this.visitorRows([
            saved
        ], ctx, employeeId);
        return {
            row: row,
            passUrl: passUrlFor(v.passToken),
            waLink: sent.waLink,
            delivered: sent.delivered,
            toast: (0, _facilityrules.passToast)(sent.delivered)
        };
    }
    async visitorFor(id, hostOrManage = true) {
        const { ctx, employeeId } = this.me();
        const v = await this.prisma.visitor.findFirst({
            where: {
                id
            }
        });
        if (!v) throw (0, _errors.notFound)('Visitor');
        const manage = this.canManage(ctx);
        if (hostOrManage && v.hostEmployeeId !== employeeId && !manage) throw (0, _errors.forbidden)('Only the host or the front desk can do this');
        return {
            v,
            ctx,
            employeeId,
            manage
        };
    }
    async resendPass(id) {
        const { v, ctx, employeeId } = await this.visitorFor(id);
        if (!(v.status === 'REGISTERED' || v.status === 'PASS_SENT') || v.passRevokedAt) throw (0, _errors.conflict)('This pass is no longer active', 'PASS_INACTIVE');
        if ((0, _dates.keyOf)(v.visitDate) < (0, _dates.todayKey)()) throw (0, _errors.conflict)('This visit date has passed', 'PASS_EXPIRED');
        const sent = await this.deliver(v, v.email && v.phone ? 'BOTH' : v.phone ? 'WHATSAPP' : 'EMAIL');
        const prev = v.deliveries ?? [];
        const saved = await this.prisma.visitor.update({
            where: {
                id
            },
            data: {
                deliveries: [
                    ...prev,
                    ...sent.deliveries
                ],
                status: sent.delivered.length ? 'PASS_SENT' : v.status
            }
        });
        await this.audit.record({
            action: 'facility.visitor.resend',
            entity: 'Visitor',
            entityId: id,
            meta: {
                delivered: sent.delivered
            }
        });
        const [row] = await this.visitorRows([
            saved
        ], ctx, employeeId);
        return {
            row: row,
            passUrl: passUrlFor(v.passToken),
            waLink: sent.waLink,
            delivered: sent.delivered,
            toast: (0, _facilityrules.passToast)(sent.delivered)
        };
    }
    async cancelVisitor(id, reason) {
        const { v, ctx, employeeId } = await this.visitorFor(id);
        if (!(v.status === 'REGISTERED' || v.status === 'PASS_SENT')) throw (0, _errors.conflict)('Only expected visitors can be cancelled', 'VISITOR_CLOSED');
        const saved = await this.prisma.visitor.update({
            where: {
                id
            },
            data: {
                status: 'CANCELLED',
                passRevokedAt: new Date()
            }
        });
        await this.audit.record({
            action: 'facility.visitor.cancel',
            entity: 'Visitor',
            entityId: id,
            meta: {
                reason: reason ?? null
            }
        });
        this.realtime.toTenant(ctx.tenantId, 'facility:visitor', {
            id,
            status: saved.status
        });
        const [row] = await this.visitorRows([
            saved
        ], ctx, employeeId);
        return row;
    }
    async card(v, now = new Date()) {
        const host = (await this.audience.briefs([
            v.hostEmployeeId
        ])).get(v.hostEmployeeId);
        let reason = null;
        if (v.status === 'CANCELLED' || v.passRevokedAt) reason = v.status === 'CHECKED_OUT' ? 'Already checked out' : 'This pass was cancelled';
        else if (v.status === 'CHECKED_OUT') reason = 'Already checked out';
        else if (now.getTime() < v.validFrom.getTime()) reason = `Pass valid from ${(0, _dates.hhmm)(v.validFrom)} on ${(0, _dates.dayMonth)(v.validFrom)}`;
        else if (now.getTime() > v.validUntil.getTime()) reason = 'This pass has expired';
        return {
            id: v.id,
            name: v.name,
            company: v.company,
            host: host?.name ?? 'Former employee',
            date: (0, _dates.dayMonth)(v.visitDate),
            expectedTime: v.expectedTime,
            status: v.status,
            statusLabel: _shared.VISITOR_STATUS_LABEL[v.status] ?? v.status,
            checkedInAt: v.checkedInAt ? (0, _dates.hhmm)(v.checkedInAt) : null,
            checkedOutAt: v.checkedOutAt ? (0, _dates.hhmm)(v.checkedOutAt) : null,
            shortCode: v.shortCode,
            validNow: v.status === 'CHECKED_IN' || (0, _facilityrules.isPassValidAt)(v, now),
            reason
        };
    }
    /** Front desk: today's expected visitors. */ async frontDesk() {
        if (!this.canManage()) throw (0, _errors.forbidden)('Front desk access is limited to the facility manager');
        const rows = await this.prisma.visitor.findMany({
            where: {
                visitDate: (0, _dates.dateOnly)((0, _dates.todayKey)()),
                status: {
                    not: 'CANCELLED'
                }
            },
            orderBy: {
                expectedTime: 'asc'
            }
        });
        return Promise.all(rows.map((v)=>this.card(v)));
    }
    /** Scanned QR (pass URL / token) or typed short code. */ async lookup(code) {
        if (!this.canManage()) throw (0, _errors.forbidden)('Front desk access is limited to the facility manager');
        const p = (0, _facilityrules.parsePassCode)(code);
        const v = p.token ? await this.prisma.visitor.findFirst({
            where: {
                passToken: p.token
            }
        }) : await this.prisma.visitor.findFirst({
            where: {
                shortCode: p.shortCode ?? ''
            },
            orderBy: [
                {
                    passRevokedAt: {
                        sort: 'asc',
                        nulls: 'first'
                    }
                },
                {
                    visitDate: 'desc'
                }
            ]
        });
        if (!v) throw (0, _errors.notFound)('Pass');
        return this.card(v);
    }
    async checkIn(id) {
        const { v, ctx, employeeId, manage } = await this.visitorFor(id, false);
        if (!manage) throw (0, _errors.forbidden)('Check-in happens at the front desk');
        if (!(v.status === 'REGISTERED' || v.status === 'PASS_SENT')) throw (0, _errors.conflict)(v.status === 'CHECKED_IN' ? 'Already checked in' : 'This pass is no longer active', 'VISITOR_STATE');
        const now = new Date();
        if (!(0, _facilityrules.isPassValidAt)(v, now)) throw (0, _errors.conflict)((await this.card(v, now)).reason ?? 'This pass is not valid now', 'PASS_NOT_VALID');
        const saved = await this.prisma.visitor.update({
            where: {
                id
            },
            data: {
                status: 'CHECKED_IN',
                checkedInAt: now,
                checkedInByEmployeeId: employeeId
            }
        });
        await this.audit.record({
            action: 'facility.visitor.checkin',
            entity: 'Visitor',
            entityId: id
        });
        const host = (await this.audience.briefs([
            v.hostEmployeeId
        ])).get(v.hostEmployeeId);
        if (host?.userId) {
            await this.notifications.notify({
                userIds: [
                    host.userId
                ],
                type: 'facility.visitor.arrived',
                title: `${v.name}${v.company ? ` (${v.company})` : ''} has arrived at reception`,
                body: `Checked in at ${(0, _dates.hhmm)(now)}`,
                link: '/facility?tab=visitors'
            });
            this.realtime.toUser(host.userId, 'facility:visitor', {
                id,
                status: saved.status
            });
        }
        this.realtime.toTenant(ctx.tenantId, 'facility:visitor', {
            id,
            status: saved.status
        });
        return this.card(saved, now);
    }
    async checkOut(id) {
        const { v, ctx, manage } = await this.visitorFor(id, false);
        if (!manage) throw (0, _errors.forbidden)('Check-out happens at the front desk');
        if (v.status !== 'CHECKED_IN') throw (0, _errors.conflict)('This visitor is not checked in', 'VISITOR_STATE');
        const now = new Date();
        const saved = await this.prisma.visitor.update({
            where: {
                id
            },
            data: {
                status: 'CHECKED_OUT',
                checkedOutAt: now,
                passRevokedAt: now
            }
        });
        await this.audit.record({
            action: 'facility.visitor.checkout',
            entity: 'Visitor',
            entityId: id
        });
        this.realtime.toTenant(ctx.tenantId, 'facility:visitor', {
            id,
            status: saved.status
        });
        return this.card(saved, now);
    }
    // ── Public pass page (no login) ─────────────────────────────────────────
    async publicPass(token) {
        const v = await this.prisma.raw.visitor.findUnique({
            where: {
                passToken: token
            }
        });
        if (!v) return null;
        const [tenant, host, branch] = await Promise.all([
            this.prisma.raw.tenant.findUnique({
                where: {
                    id: v.tenantId
                },
                select: {
                    name: true,
                    brandName: true,
                    brandAccent: true
                }
            }),
            this.prisma.raw.employee.findFirst({
                where: {
                    id: v.hostEmployeeId,
                    tenantId: v.tenantId
                },
                select: {
                    fullName: true
                }
            }),
            v.branchId ? this.prisma.raw.branch.findFirst({
                where: {
                    id: v.branchId,
                    tenantId: v.tenantId
                },
                select: {
                    name: true,
                    address: true
                }
            }) : null
        ]);
        const now = new Date();
        const valid = !v.passRevokedAt && v.status !== 'CANCELLED' && v.status !== 'CHECKED_OUT' && now.getTime() <= v.validUntil.getTime();
        const status = v.status === 'CHECKED_IN' ? 'Checked in' : valid ? now.getTime() < v.validFrom.getTime() ? `Valid from ${(0, _dates.hhmm)(v.validFrom)}` : 'Valid' : v.status === 'CHECKED_OUT' ? 'Checked out' : v.status === 'CANCELLED' ? 'Cancelled' : 'Expired';
        const company = tenant?.brandName ?? tenant?.name ?? 'Lexisora';
        const json = {
            company,
            visitor: v.name,
            visitorCompany: v.company,
            host: host?.fullName ?? null,
            date: (0, _dates.longDate)((0, _dates.istInstant)((0, _dates.keyOf)(v.visitDate), v.expectedTime)),
            expectedTime: v.expectedTime,
            window: `${(0, _dates.hhmm)(v.validFrom)} – 23:59`,
            office: branch ? [
                branch.name,
                branch.address
            ].filter(Boolean).join(' · ') : null,
            code: v.shortCode,
            status,
            valid
        };
        const qr = valid ? await _qrcode.default.toDataURL(passUrlFor(v.passToken), {
            margin: 1,
            width: 280
        }) : null;
        const accent = tenant?.brandAccent ?? '#b68235';
        const e = escapeHtml;
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visitor pass · ${e(company)}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f4f1;color:#201f1d;display:grid;place-items:center;min-height:100vh}
.pass{background:#fff;border:1px solid #e3dfdb;border-top:4px solid ${e(accent)};border-radius:8px;padding:28px;max-width:360px;width:calc(100% - 32px);box-sizing:border-box;text-align:center}
.k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8a6d3b}.n{font-family:Georgia,serif;font-size:28px;margin:6px 0 2px}.m{color:#605d5d;font-size:14px;margin:2px 0}
.code{font-size:24px;letter-spacing:6px;font-weight:600;margin:12px 0}.st{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;background:${valid ? '#f3ead9' : '#eee'};color:${valid ? '#6b4e1f' : '#555'}}img{margin:14px auto 4px;display:block}</style></head>
<body><div class="pass"><div class="k">${e(company)} · Visitor pass</div><div class="n">${e(v.name)}</div>${v.company ? `<div class="m">${e(v.company)}</div>` : ''}
<div class="m">Host: ${e(host?.fullName ?? '—')}</div><div class="m">${e(json.date)} · expected ${e(v.expectedTime)}</div>
${qr ? `<img src="${qr}" width="200" height="200" alt="Pass QR code">` : ''}<div class="code">${e(v.shortCode)}</div><span class="st">${e(status)}</span>
${json.office ? `<div class="m" style="margin-top:14px;font-size:12px">${e(json.office)}</div>` : ''}<div class="m" style="margin-top:10px;font-size:11px">Show this pass at reception. Valid ${e(json.window)} on the visit date.</div></div></body></html>`;
        return {
            html,
            json
        };
    }
    // ── Jobs ────────────────────────────────────────────────────────────────
    /** Completed bookings, no-shows and auto check-outs after the day ends; PII purge after 180 days. */ async closePast(now = new Date()) {
        const today = (0, _dates.dateOnly)((0, _dates.todayKey)(now));
        const bookings = await this.prisma.roomBooking.updateMany({
            where: {
                status: 'BOOKED',
                endAt: {
                    lt: now
                }
            },
            data: {
                status: 'COMPLETED'
            }
        });
        const noShows = await this.prisma.visitor.updateMany({
            where: {
                status: {
                    in: [
                        'REGISTERED',
                        'PASS_SENT'
                    ]
                },
                visitDate: {
                    lt: today
                }
            },
            data: {
                status: 'NO_SHOW',
                passRevokedAt: now
            }
        });
        const stale = await this.prisma.visitor.findMany({
            where: {
                status: 'CHECKED_IN',
                visitDate: {
                    lt: today
                }
            },
            select: {
                id: true,
                validUntil: true
            }
        });
        for (const s of stale)await this.prisma.visitor.update({
            where: {
                id: s.id
            },
            data: {
                status: 'CHECKED_OUT',
                checkedOutAt: s.validUntil,
                passRevokedAt: now
            }
        });
        const purged = await this.prisma.visitor.updateMany({
            where: {
                visitDate: {
                    lt: new Date(today.getTime() - 180 * 86_400_000)
                },
                OR: [
                    {
                        phone: {
                            not: null
                        }
                    },
                    {
                        email: {
                            not: null
                        }
                    }
                ]
            },
            data: {
                phone: null,
                email: null
            }
        });
        return {
            bookings: bookings.count,
            noShows: noShows.count,
            checkedOut: stale.length,
            purged: purged.count
        };
    }
    async briefsFor(ids) {
        return this.audience.briefs(ids);
    }
};
FacilityService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _mailservice.MailService === "undefined" ? Object : _mailservice.MailService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway,
        typeof _sequenceservice.SequenceService === "undefined" ? Object : _sequenceservice.SequenceService,
        typeof _audience.AudienceService === "undefined" ? Object : _audience.AudienceService
    ])
], FacilityService);
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c)=>({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[c]);
}

//# sourceMappingURL=facility.service.js.map