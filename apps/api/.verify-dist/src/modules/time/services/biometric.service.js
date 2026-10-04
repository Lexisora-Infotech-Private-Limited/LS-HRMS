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
    get BiometricService () {
        return BiometricService;
    },
    get directionFromStatus () {
        return directionFromStatus;
    },
    get localToInstant () {
        return localToInstant;
    },
    get parseAttLog () {
        return parseAttLog;
    }
});
const _common = require("@nestjs/common");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _timeutils = require("../lib/time-utils");
const _attendanceservice = require("./attendance.service");
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
function parseAttLog(body) {
    const out = [];
    for (const rawLine of body.split(/\r?\n/)){
        const line = rawLine.trim();
        if (!line) continue;
        const parts = line.split('\t').map((p)=>p.trim());
        const pin = parts[0] ?? '';
        const local = parts[1] ?? '';
        if (!/^\d{1,9}$/.test(pin) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(local)) continue;
        out.push({
            pin,
            local: local.length === 16 ? `${local}:00` : local,
            status: parts[2] !== undefined && parts[2] !== '' ? Number(parts[2]) : null,
            verify: parts[3] !== undefined && parts[3] !== '' ? Number(parts[3]) : null,
            workCode: parts[4] || null,
            raw: line
        });
    }
    return out;
}
function localToInstant(local) {
    return new Date(new Date(`${local.replace(' ', 'T')}Z`).getTime() - _timeutils.IST_OFFSET_MIN * 60_000);
}
function directionFromStatus(status) {
    if (status === 0 || status === 3 || status === 4) return 'IN';
    if (status === 1 || status === 2 || status === 5) return 'OUT';
    return undefined;
}
let BiometricService = class BiometricService {
    prisma;
    attendance;
    audit;
    log = new _common.Logger('Biometric');
    constructor(prisma, attendance, audit){
        this.prisma = prisma;
        this.attendance = attendance;
        this.audit = audit;
    }
    // ── admin ────────────────────────────────────────────────────────────────
    async devices() {
        const rows = await this.prisma.biometricDevice.findMany({
            orderBy: {
                name: 'asc'
            }
        });
        const locs = new Map((await this.prisma.workLocation.findMany({
            select: {
                id: true,
                name: true
            }
        })).map((l)=>[
                l.id,
                l.name
            ]));
        const out = [];
        for (const d of rows)out.push(await this.toRow(d, locs));
        return out;
    }
    async toRow(d, locs) {
        const unprocessed = await this.prisma.biometricRawLog.count({
            where: {
                deviceId: d.id,
                processed: false
            }
        });
        const online = !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 30 * 60_000;
        return {
            id: d.id,
            serialNumber: d.serialNumber,
            name: d.name,
            locationId: d.locationId,
            locationName: d.locationId ? locs.get(d.locationId) ?? null : null,
            model: d.model,
            firmware: d.firmware,
            directionMode: d.directionMode,
            lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
            lastSeen: d.lastSeenAt ? d.lastSeenAt.toISOString() : 'Never',
            status: d.status === 'DISABLED' ? 'Disabled' : online ? 'Online' : 'Offline',
            unprocessed
        };
    }
    async createDevice(input) {
        const sn = input.serialNumber.toUpperCase();
        const exists = await this.prisma.raw.biometricDevice.findUnique({
            where: {
                serialNumber: sn
            }
        });
        if (exists) throw new _errors.AppError(409, 'DUPLICATE', 'A device with this serial number is already registered');
        const d = await this.prisma.biometricDevice.create({
            data: {
                serialNumber: sn,
                name: input.name,
                locationId: input.locationId ?? null,
                model: input.model ?? null,
                directionMode: input.directionMode ?? 'FIRST_LAST',
                status: input.status ?? 'ACTIVE'
            }
        });
        await this.prisma.raw.unclaimedBiometricDevice.deleteMany({
            where: {
                serialNumber: sn
            }
        });
        await this.audit.record({
            action: 'biometric.device.created',
            entity: 'BiometricDevice',
            entityId: d.id,
            meta: {
                serialNumber: sn,
                name: d.name
            }
        });
        return d;
    }
    async updateDevice(id, input) {
        const d = await this.prisma.biometricDevice.findFirst({
            where: {
                id
            }
        });
        if (!d) throw (0, _errors.notFound)('Device');
        const saved = await this.prisma.biometricDevice.update({
            where: {
                id
            },
            data: {
                ...input.name ? {
                    name: input.name
                } : {},
                ...input.locationId !== undefined ? {
                    locationId: input.locationId
                } : {},
                ...input.model !== undefined ? {
                    model: input.model
                } : {},
                ...input.directionMode ? {
                    directionMode: input.directionMode
                } : {},
                ...input.status ? {
                    status: input.status
                } : {}
            }
        });
        await this.audit.record({
            action: 'biometric.device.updated',
            entity: 'BiometricDevice',
            entityId: id,
            meta: input
        });
        return saved;
    }
    async deleteDevice(id) {
        const d = await this.prisma.biometricDevice.findFirst({
            where: {
                id
            }
        });
        if (!d) throw (0, _errors.notFound)('Device');
        const logs = await this.prisma.biometricRawLog.count({
            where: {
                deviceId: id
            }
        });
        if (logs) await this.prisma.biometricDevice.update({
            where: {
                id
            },
            data: {
                status: 'DISABLED'
            }
        });
        else await this.prisma.biometricDevice.delete({
            where: {
                id
            }
        });
        await this.audit.record({
            action: 'biometric.device.removed',
            entity: 'BiometricDevice',
            entityId: id,
            meta: {
                serialNumber: d.serialNumber,
                disabledOnly: !!logs
            }
        });
        return {
            ok: true
        };
    }
    async unclaimed() {
        return this.prisma.raw.unclaimedBiometricDevice.findMany({
            orderBy: {
                lastSeenAt: 'desc'
            },
            take: 20
        });
    }
    async enrollments() {
        const [emps, rows] = await Promise.all([
            this.prisma.employee.findMany({
                where: {
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
                    empCode: true,
                    workMode: true
                },
                orderBy: {
                    fullName: 'asc'
                }
            }),
            this.prisma.biometricEnrollment.findMany()
        ]);
        const pins = new Map(rows.map((r)=>[
                r.employeeId,
                r.pin
            ]));
        return emps.map((e)=>({
                employeeId: e.id,
                name: e.fullName,
                empCode: e.empCode,
                pin: pins.get(e.id) ?? null,
                workMode: e.workMode
            }));
    }
    async setEnrollment(employeeId, pin) {
        const clash = await this.prisma.biometricEnrollment.findFirst({
            where: {
                pin,
                employeeId: {
                    not: employeeId
                }
            }
        });
        if (clash) throw new _errors.AppError(409, 'PIN_IN_USE', 'This PIN is already enrolled for another employee');
        const existing = await this.prisma.biometricEnrollment.findFirst({
            where: {
                employeeId
            }
        });
        if (existing) await this.prisma.biometricEnrollment.update({
            where: {
                id: existing.id
            },
            data: {
                pin
            }
        });
        else await this.prisma.biometricEnrollment.create({
            data: {
                employeeId,
                pin
            }
        });
        await this.audit.record({
            action: 'biometric.enrollment.set',
            entity: 'BiometricEnrollment',
            entityId: employeeId,
            meta: {
                pin
            }
        });
        // Re-process logs that were waiting for this PIN.
        const waiting = await this.prisma.biometricRawLog.findMany({
            where: {
                pin,
                processed: false,
                error: 'UNKNOWN_PIN'
            },
            orderBy: {
                punchedAt: 'asc'
            }
        });
        for (const w of waiting){
            const d = await this.prisma.biometricDevice.findFirst({
                where: {
                    id: w.deviceId
                }
            });
            if (d) await this.processLog(d, w.id);
        }
        return {
            ok: true,
            reprocessed: waiting.length
        };
    }
    async logs(deviceId) {
        const rows = await this.prisma.biometricRawLog.findMany({
            where: deviceId ? {
                deviceId
            } : {},
            orderBy: {
                receivedAt: 'desc'
            },
            take: 100
        });
        const names = new Map((await this.prisma.employee.findMany({
            where: {
                id: {
                    in: rows.map((r)=>r.employeeId).filter((x)=>!!x)
                }
            },
            select: {
                id: true,
                fullName: true
            }
        })).map((e)=>[
                e.id,
                e.fullName
            ]));
        return rows.map((r)=>({
                id: r.id,
                pin: r.pin,
                employeeName: r.employeeId ? names.get(r.employeeId) ?? null : null,
                punchedAtLocal: r.punchedAtLocal,
                statusCode: r.statusCode,
                processed: r.processed,
                error: r.error,
                receivedAt: r.receivedAt.toISOString()
            }));
    }
    /** HR simulator: push one ATTLOG line through the same pipeline as a real device. */ async simulate(input) {
        const ctx = (0, _requestcontext.requireContext)();
        const d = await this.prisma.biometricDevice.findFirst({
            where: {
                serialNumber: input.serialNumber.toUpperCase()
            }
        });
        if (!d) throw (0, _errors.notFound)('Device');
        const at = input.at ? (input.at.length === 16 ? `${input.at}:00` : input.at).replace('T', ' ') : istLocalNow();
        const line = [
            input.pin,
            at,
            input.status ?? '',
            1,
            0
        ].join('\t');
        const res = await this.ingest(d, line);
        await this.audit.record({
            action: 'biometric.simulated',
            entity: 'BiometricDevice',
            entityId: d.id,
            meta: {
                pin: input.pin,
                at,
                by: ctx.userName ?? null
            }
        });
        const last = (await this.logs(d.id))[0];
        return {
            ...res,
            log: last ?? null
        };
    }
    // ── ADMS protocol (public, device SN auth) ──────────────────────────────
    /** Resolve the device by serial number; unknown devices are recorded as unclaimed. */ async deviceBySn(sn, ip) {
        const serial = (sn ?? '').trim().toUpperCase();
        if (!serial) return null;
        const d = await this.prisma.raw.biometricDevice.findUnique({
            where: {
                serialNumber: serial
            }
        });
        if (!d) {
            await this.prisma.raw.unclaimedBiometricDevice.upsert({
                where: {
                    serialNumber: serial
                },
                create: {
                    serialNumber: serial,
                    ip: ip ?? null
                },
                update: {
                    lastSeenAt: new Date(),
                    ip: ip ?? null
                }
            }).catch(()=>undefined);
            return null;
        }
        if (d.status === 'DISABLED') return null;
        await this.prisma.raw.biometricDevice.update({
            where: {
                id: d.id
            },
            data: {
                lastSeenAt: new Date()
            }
        });
        return d;
    }
    handshake(d) {
        return [
            `GET OPTION FROM: ${d.serialNumber}`,
            `ATTLOGStamp=${d.attLogStamp ?? 'None'}`,
            'OPERLOGStamp=9999',
            'ATTPHOTOStamp=None',
            'ErrorDelay=30',
            'Delay=10',
            'TransTimes=00:00;14:05',
            'TransInterval=1',
            'TransFlag=TransData AttLog',
            'TimeZone=330',
            'Realtime=1',
            'Encrypt=None'
        ].join('\n');
    }
    /** POST cdata?table=ATTLOG: store raw lines idempotently and turn them into punches. */ async ingest(d, body, stamp) {
        return (0, _requestcontext.runAsTenant)(d.tenantId, async ()=>{
            const lines = parseAttLog(body);
            let accepted = 0;
            for (const l of lines){
                const existing = await this.prisma.biometricRawLog.findFirst({
                    where: {
                        deviceId: d.id,
                        pin: l.pin,
                        punchedAtLocal: l.local
                    }
                });
                if (existing) continue;
                const row = await this.prisma.biometricRawLog.create({
                    data: {
                        deviceId: d.id,
                        pin: l.pin,
                        punchedAtLocal: l.local,
                        punchedAt: localToInstant(l.local),
                        statusCode: l.status,
                        verifyCode: l.verify,
                        workCode: l.workCode,
                        raw: l.raw
                    }
                });
                if (await this.processLog(d, row.id)) accepted++;
            }
            if (stamp) await this.prisma.biometricDevice.update({
                where: {
                    id: d.id
                },
                data: {
                    attLogStamp: stamp
                }
            });
            return {
                received: lines.length,
                accepted
            };
        });
    }
    async processLog(d, rawId) {
        const r = await this.prisma.biometricRawLog.findFirst({
            where: {
                id: rawId
            }
        });
        if (!r || r.processed) return false;
        const enr = await this.prisma.biometricEnrollment.findFirst({
            where: {
                pin: r.pin
            }
        });
        if (!enr) {
            await this.prisma.biometricRawLog.update({
                where: {
                    id: r.id
                },
                data: {
                    error: 'UNKNOWN_PIN'
                }
            });
            return false;
        }
        if (r.punchedAt.getTime() > Date.now() + 10 * 60_000) {
            await this.prisma.biometricRawLog.update({
                where: {
                    id: r.id
                },
                data: {
                    error: 'DEVICE_CLOCK',
                    employeeId: enr.employeeId
                }
            });
            return false;
        }
        try {
            const direction = d.directionMode === 'DEVICE_STATUS' ? directionFromStatus(r.statusCode) : undefined;
            const res = await this.attendance.punch({
                employeeId: enr.employeeId,
                direction,
                source: 'BIOMETRIC',
                at: r.punchedAt,
                biometricDeviceId: d.id,
                locationId: d.locationId,
                clientEventId: `${d.serialNumber}|${r.pin}|${r.punchedAtLocal}`,
                storeUnknownDirection: d.directionMode === 'FIRST_LAST'
            });
            await this.prisma.biometricRawLog.update({
                where: {
                    id: r.id
                },
                data: {
                    processed: true,
                    punchId: res.punchId,
                    employeeId: enr.employeeId,
                    error: res.duplicate ? 'DUPLICATE' : null
                }
            });
            return !res.duplicate;
        } catch (e) {
            const code = e?.response?.code ?? 'ERROR';
            this.log.warn(`ATTLOG ${d.serialNumber} pin ${r.pin} @ ${r.punchedAtLocal}: ${code}`);
            await this.prisma.biometricRawLog.update({
                where: {
                    id: r.id
                },
                data: {
                    error: String(code).slice(0, 40),
                    employeeId: enr.employeeId,
                    processed: code !== 'PERIOD_LOCKED' ? true : false
                }
            });
            return false;
        }
    }
};
BiometricService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _attendanceservice.AttendanceService === "undefined" ? Object : _attendanceservice.AttendanceService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], BiometricService);
function istLocalNow() {
    const d = new Date(Date.now() + _timeutils.IST_OFFSET_MIN * 60_000);
    return d.toISOString().slice(0, 19).replace('T', ' ');
}

//# sourceMappingURL=biometric.service.js.map