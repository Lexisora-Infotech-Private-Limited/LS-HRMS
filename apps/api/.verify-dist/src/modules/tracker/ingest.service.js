"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "IngestService", {
    enumerable: true,
    get: function() {
        return IngestService;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _sharp = /*#__PURE__*/ _interop_require_default(require("sharp"));
const _shared = require("@lexisora/shared");
const _client = require("@prisma/client");
const _prismaservice = require("../../core/prisma/prisma.service");
const _errors = require("../../core/http/errors");
const _auditservice = require("../../core/audit/audit.service");
const _eventsservice = require("../../core/registry/events.service");
const _notificationsservice = require("../../core/notifications/notifications.service");
const _storageservice = require("../../core/storage/storage.service");
const _requestcontext = require("../../core/context/request-context");
const _trackercontextservice = require("./tracker-context.service");
const _timeport = require("./time-port");
const _trackerrules = require("./tracker.rules");
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
const SUBMITTED_STATES = [
    'SUBMITTED',
    'PENDING_RM',
    'APPROVED',
    'LOCKED'
];
const TASK_ORDER = {
    WIP: 0,
    ALLOTTED: 1,
    QA: 2,
    DEV_COMPLETED: 3,
    OPEN: 4
};
const SHOT_MIME = /^image\/(png|jpe?g|webp)$/;
const fmtHm = (d)=>new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(d);
let IngestService = class IngestService {
    prisma;
    tctx;
    events;
    audit;
    notifications;
    storage;
    time;
    log = new _common.Logger('TrackerIngest');
    constructor(prisma, tctx, events, audit, notifications, storage, time){
        this.prisma = prisma;
        this.tctx = tctx;
        this.events = events;
        this.audit = audit;
        this.notifications = notifications;
        this.storage = storage;
        this.time = time;
    }
    // ── tasks ───────────────────────────────────────────────────────────────
    async tasks(employeeId) {
        const today = (0, _shared.trackerWorkDate)(new Date());
        const [assigned, standing, summary] = await Promise.all([
            this.prisma.task.findMany({
                where: {
                    assigneeEmployeeId: employeeId,
                    status: {
                        notIn: [
                            'DONE',
                            'CANCELLED'
                        ]
                    },
                    isStanding: false
                },
                include: {
                    project: {
                        select: {
                            id: true,
                            key: true,
                            name: true,
                            status: true
                        }
                    }
                },
                take: 100
            }),
            this.prisma.task.findMany({
                where: {
                    isStanding: true,
                    status: {
                        not: 'CANCELLED'
                    },
                    project: {
                        isInternal: true
                    }
                },
                include: {
                    project: {
                        select: {
                            id: true,
                            key: true,
                            name: true,
                            status: true
                        }
                    }
                },
                orderBy: {
                    number: 'asc'
                }
            }),
            this.prisma.trackerDaySummary.findUnique({
                where: {
                    employeeId_workDate: {
                        employeeId,
                        workDate: (0, _trackerrules.dbDate)(today)
                    }
                }
            })
        ]);
        const perTask = new Map((summary?.perTask ?? []).map((p)=>[
                p.taskId,
                p.seconds
            ]));
        const live = assigned.filter((t)=>![
                'ARCHIVED',
                'CANCELLED'
            ].includes(t.project.status));
        live.sort((a, b)=>(TASK_ORDER[a.status] ?? 9) - (TASK_ORDER[b.status] ?? 9) || a.key.localeCompare(b.key, 'en', {
                numeric: true
            }));
        const map = (t, isStanding)=>({
                id: t.id,
                key: t.key,
                title: t.title,
                projectName: t.project.name,
                projectId: t.project.id,
                projectKey: t.project.key,
                status: t.status,
                isStanding,
                todaySeconds: perTask.get(t.id) ?? 0
            });
        return [
            ...live.map((t)=>map(t, false)),
            ...standing.map((t)=>map(t, true))
        ];
    }
    // ── today ───────────────────────────────────────────────────────────────
    async today(employeeId, dateKey = (0, _shared.trackerWorkDate)(new Date())) {
        const date = (0, _trackerrules.dbDate)(dateKey);
        const [summary, open, lastBreak, day, emp] = await Promise.all([
            this.prisma.trackerDaySummary.findUnique({
                where: {
                    employeeId_workDate: {
                        employeeId,
                        workDate: date
                    }
                }
            }),
            this.prisma.workSession.findFirst({
                where: {
                    employeeId,
                    endedAt: null
                },
                orderBy: {
                    startedAt: 'desc'
                }
            }),
            this.prisma.trackerEvent.findFirst({
                where: {
                    employeeId,
                    workDate: date,
                    type: {
                        in: [
                            'BREAK_START',
                            'BREAK_END',
                            'PUNCH_IN',
                            'PUNCH_OUT'
                        ]
                    }
                },
                orderBy: {
                    at: 'desc'
                }
            }),
            this.prisma.attendanceDay.findUnique({
                where: {
                    employeeId_date: {
                        employeeId,
                        date
                    }
                }
            }).catch(()=>null),
            this.tctx.employee(employeeId)
        ]);
        const { mode } = await this.tctx.modeFor(emp);
        const status = open ? lastBreak?.type === 'BREAK_START' ? 'BREAK' : 'WORKING' : 'OUT';
        const perTask = summary?.perTask ?? [];
        return {
            status,
            workedSeconds: (summary?.workedSec ?? 0) + (summary?.idlePendingSec ?? 0),
            breakSeconds: summary?.breakSec ?? 0,
            idleSeconds: summary?.idleDeductedSec ?? 0,
            screenshots: summary?.screenshotCount ?? 0,
            byTask: perTask.map((p)=>({
                    taskId: p.taskId,
                    key: p.key,
                    title: p.title,
                    seconds: p.seconds
                })),
            punchedInAt: open?.startedAt.toISOString() ?? null,
            date: dateKey,
            mode,
            idlePendingSeconds: summary?.idlePendingSec ?? 0,
            firstInAt: (day?.firstInAt ?? summary?.firstInAt)?.toISOString() ?? null,
            lastOutAt: open ? null : (day?.lastOutAt ?? summary?.lastOutAt)?.toISOString() ?? null,
            punchSource: open?.source ?? null,
            timeline: summary?.timeline ?? [],
            confirmedAt: summary?.confirmedAt?.toISOString() ?? null,
            weekSubmitted: await this.weekSubmitted(employeeId, dateKey)
        };
    }
    async weekSubmitted(employeeId, dateKey) {
        const ts = await this.prisma.timesheet.findFirst({
            where: {
                employeeId,
                weekStart: (0, _trackerrules.dbDate)((0, _trackerrules.weekStartOf)(dateKey))
            },
            select: {
                status: true
            }
        }).catch(()=>null);
        return !!ts && SUBMITTED_STATES.includes(ts.status);
    }
    // ── punch ───────────────────────────────────────────────────────────────
    async punch(deviceId, employeeId, input) {
        const emp = await this.tctx.employee(employeeId);
        const { mode, message } = await this.tctx.modeFor(emp);
        if (mode === 'MONITOR_ONLY') throw new _errors.AppError(403, 'PUNCH_NOT_ALLOWED', message ?? 'Punch in with biometric at the office.');
        if (input.clientId) {
            const seen = await this.prisma.trackerEvent.findUnique({
                where: {
                    clientId: input.clientId
                }
            });
            if (seen) return {
                ok: true,
                direction: input.direction,
                at: seen.at.toISOString(),
                today: await this.today(employeeId)
            };
        }
        const device = await this.prisma.trackerDevice.findUniqueOrThrow({
            where: {
                id: deviceId
            }
        });
        const now = new Date();
        let at = input.at ? (0, _trackerrules.correctedInstant)(input.at, device.lastSkewSec ?? 0) : now;
        if (at.getTime() > now.getTime()) at = now;
        const policy = await this.tctx.policyRow('REMOTE');
        if (now.getTime() - at.getTime() > policy.offlineRetentionDays * 86400_000) {
            throw (0, _errors.badRequest)('This punch is older than the offline limit. Raise a regularization instead.', 'PUNCH_TOO_OLD');
        }
        await this.time.punch({
            employeeId,
            direction: input.direction,
            source: 'DESKTOP',
            at,
            deviceId,
            clientEventId: input.clientId ?? null
        });
        const workDate = (0, _shared.trackerWorkDate)(at);
        await this.prisma.trackerEvent.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                clientId: input.clientId ?? (0, _nodecrypto.randomUUID)(),
                deviceId,
                employeeId,
                type: input.direction === 'IN' ? 'PUNCH_IN' : 'PUNCH_OUT',
                at,
                clientAt: input.at ? new Date(input.at) : now,
                workDate: (0, _trackerrules.dbDate)(workDate),
                taskId: input.taskId ?? null
            }
        });
        await this.prisma.trackerDevice.update({
            where: {
                id: deviceId
            },
            data: {
                lastSeenAt: now,
                liveStatus: input.direction === 'IN' ? 'WORKING' : 'OUT',
                liveTaskId: input.taskId ?? null
            }
        });
        await this.audit.record({
            action: 'tracker.punch',
            entity: 'TrackerDevice',
            entityId: deviceId,
            meta: {
                direction: input.direction,
                source: 'DESKTOP',
                at: at.toISOString()
            }
        });
        return {
            ok: true,
            direction: input.direction,
            at: at.toISOString(),
            today: await this.today(employeeId, workDate)
        };
    }
    // ── sync ────────────────────────────────────────────────────────────────
    async sync(deviceId, employeeId, batch) {
        const now = new Date();
        const skew = (0, _trackerrules.estimateSkewSeconds)(batch.deviceTime, now.getTime());
        const fix = (iso)=>(0, _trackerrules.correctedInstant)(iso, skew);
        const workDates = new Set();
        const rejected = [];
        // 1. events (idempotent by clientId)
        const existingEv = batch.events.length ? await this.prisma.trackerEvent.findMany({
            where: {
                clientId: {
                    in: batch.events.map((e)=>e.clientId)
                }
            },
            select: {
                clientId: true
            }
        }) : [];
        const evPart = (0, _trackerrules.partitionByClientId)(batch.events, existingEv.map((e)=>e.clientId));
        if (evPart.fresh.length) {
            await this.prisma.trackerEvent.createMany({
                skipDuplicates: true,
                data: evPart.fresh.map((e)=>{
                    const at = fix(e.at);
                    const wd = (0, _shared.trackerWorkDate)(at);
                    workDates.add(wd);
                    return {
                        tenantId: (0, _requestcontext.currentTenantId)(),
                        clientId: e.clientId,
                        deviceId,
                        employeeId,
                        type: e.type,
                        at,
                        clientAt: new Date(e.at),
                        workDate: (0, _trackerrules.dbDate)(wd),
                        taskId: e.taskId ?? null,
                        resolution: e.resolution ?? null,
                        idleFrom: e.idleFrom ? fix(e.idleFrom) : null,
                        note: e.note ?? null,
                        payload: e.payload ?? undefined,
                        skewSec: skew
                    };
                })
            });
        }
        // 2. segments (idempotent, validated, idle resolved)
        const existingSeg = batch.segments.length ? await this.prisma.activitySegment.findMany({
            where: {
                clientId: {
                    in: batch.segments.map((s)=>s.clientId)
                }
            },
            select: {
                clientId: true
            }
        }) : [];
        const segPart = (0, _trackerrules.partitionByClientId)(batch.segments, existingSeg.map((s)=>s.clientId));
        const corrected = segPart.fresh.map((s)=>({
                ...s,
                startedAt: fix(s.startedAt).toISOString(),
                endedAt: fix(s.endedAt).toISOString()
            }));
        let acceptedSegs = 0;
        if (corrected.length) {
            const minStart = new Date(Math.min(...corrected.map((s)=>Date.parse(s.startedAt))));
            const maxEnd = new Date(Math.max(...corrected.map((s)=>Date.parse(s.endedAt))));
            const stored = await this.prisma.activitySegment.findMany({
                where: {
                    employeeId,
                    startAt: {
                        lt: maxEnd
                    },
                    endAt: {
                        gt: minStart
                    }
                },
                select: {
                    startAt: true,
                    endAt: true
                }
            });
            const v = (0, _trackerrules.validateSegments)(corrected, {
                nowMs: now.getTime(),
                existing: stored
            });
            rejected.push(...v.rejected);
            // idle answers stored earlier (dialog answered in a previous batch)
            const idleStarts = v.ok.filter((s)=>s.kind === 'IDLE' && !s.resolution).map((s)=>new Date(s.startedAt));
            const dbResolved = idleStarts.length ? await this.prisma.trackerEvent.findMany({
                where: {
                    employeeId,
                    type: 'IDLE_RESOLVED',
                    idleFrom: {
                        in: idleStarts
                    }
                },
                select: {
                    type: true,
                    idleFrom: true,
                    resolution: true
                }
            }) : [];
            const resolvedEvents = [
                ...batch.events.map((e)=>({
                        type: e.type,
                        idleFrom: e.idleFrom ? fix(e.idleFrom).toISOString() : undefined,
                        resolution: e.resolution
                    })),
                ...dbResolved.map((e)=>({
                        type: e.type,
                        idleFrom: e.idleFrom?.toISOString(),
                        resolution: e.resolution ?? undefined
                    }))
            ];
            const taskIds = [
                ...new Set(v.ok.map((s)=>s.taskId).filter((x)=>!!x))
            ];
            const tasks = taskIds.length ? await this.prisma.task.findMany({
                where: {
                    id: {
                        in: taskIds
                    }
                },
                select: {
                    id: true,
                    key: true,
                    projectId: true,
                    project: {
                        select: {
                            leadEmployeeId: true,
                            isInternal: true
                        }
                    }
                }
            }) : [];
            const taskById = new Map(tasks.map((t)=>[
                    t.id,
                    t
                ]));
            const emp = await this.tctx.employee(employeeId);
            const segRows = [];
            const claimRows = [];
            for (const s of v.ok){
                const res = (0, _trackerrules.matchIdleResolution)(s, resolvedEvents);
                const mapped = (0, _trackerrules.resolveSegmentKind)(s.kind, res);
                const task = s.taskId ? taskById.get(s.taskId) : undefined;
                const startAt = new Date(s.startedAt);
                const endAt = new Date(s.endedAt);
                const wd = (0, _shared.trackerWorkDate)(startAt);
                workDates.add(wd);
                const id = (0, _nodecrypto.randomUUID)();
                segRows.push({
                    id,
                    tenantId: (0, _requestcontext.currentTenantId)(),
                    clientId: s.clientId,
                    employeeId,
                    deviceId,
                    workDate: (0, _trackerrules.dbDate)(wd),
                    kind: mapped.kind,
                    taskId: task ? task.id : null,
                    projectId: task?.projectId ?? null,
                    startAt,
                    endAt,
                    durationSec: Math.round((endAt.getTime() - startAt.getTime()) / 1000),
                    idleResolution: mapped.idleResolution,
                    idleCause: s.idleCause ?? null,
                    note: s.note ?? null,
                    keyboardEvents: s.keyboardEvents ?? 0,
                    mouseEvents: s.mouseEvents ?? 0,
                    flags: (0, _trackerrules.isSkewFlagged)(skew) ? [
                        'SKEW_CORRECTED'
                    ] : []
                });
                if (mapped.createsClaim) {
                    claimRows.push({
                        tenantId: (0, _requestcontext.currentTenantId)(),
                        employeeId,
                        segmentId: id,
                        workDate: (0, _trackerrules.dbDate)(wd),
                        startAt,
                        endAt,
                        minutes: Math.max(1, Math.round((endAt.getTime() - startAt.getTime()) / 60000)),
                        taskId: task?.id ?? null,
                        projectId: task?.projectId ?? null,
                        note: s.note ?? null,
                        status: 'PENDING',
                        reviewerEmployeeId: (0, _trackerrules.pickClaimReviewer)({
                            employeeId,
                            projectLeadId: task?.project.leadEmployeeId,
                            projectIsInternal: task?.project.isInternal,
                            managerId: emp.managerId
                        })
                    });
                }
            }
            if (segRows.length) await this.prisma.activitySegment.createMany({
                data: segRows,
                skipDuplicates: true
            });
            if (claimRows.length) {
                await this.prisma.idleClaim.createMany({
                    data: claimRows,
                    skipDuplicates: true
                });
                await this.notifyClaimReviewers(emp.fullName, claimRows, taskById);
            }
            acceptedSegs = segRows.length;
        }
        // 3. integrity
        const today = (0, _shared.trackerWorkDate)(now);
        if ((0, _trackerrules.isSkewFlagged)(skew)) {
            await this.flag({
                employeeId,
                deviceId,
                workDate: today,
                type: 'CLOCK_SKEW',
                severity: Math.abs(skew) > 3600 ? 'WARN' : 'INFO',
                occurredAt: now,
                details: {
                    skewSeconds: skew,
                    message: `Device clock ${skew > 0 ? 'ahead' : 'behind'} by ${Math.round(Math.abs(skew) / 60)} min; times corrected`
                },
                dedupeKey: `skew:${deviceId}:${today}`
            });
        }
        for (const r of rejected.filter((x)=>x.reason === 'OVERLAP')){
            await this.flag({
                employeeId,
                deviceId,
                workDate: today,
                type: 'OVERLAP_REJECTED',
                severity: 'WARN',
                occurredAt: now,
                details: {
                    clientId: r.clientId
                },
                dedupeKey: `overlap:${r.clientId}`
            });
        }
        for (const e of evPart.fresh){
            const at = fix(e.at);
            if (e.type === 'APP_QUIT') {
                const open = await this.prisma.workSession.findFirst({
                    where: {
                        employeeId,
                        startedAt: {
                            lte: at
                        },
                        OR: [
                            {
                                endedAt: null
                            },
                            {
                                endedAt: {
                                    gt: at
                                }
                            }
                        ]
                    }
                });
                if (open) {
                    await this.flag({
                        employeeId,
                        deviceId,
                        workDate: (0, _shared.trackerWorkDate)(at),
                        type: 'APP_QUIT_WHILE_PUNCHED_IN',
                        severity: 'INFO',
                        occurredAt: at,
                        details: {
                            message: `Tracker closed while punched in at ${fmtHm(at)}`
                        },
                        dedupeKey: `quit:${e.clientId}`
                    });
                }
            } else if (e.type === 'CLOCK_CHANGE') {
                const drift = Number(e.payload?.driftSec ?? 0);
                await this.flag({
                    employeeId,
                    deviceId,
                    workDate: (0, _shared.trackerWorkDate)(at),
                    type: 'CLOCK_CHANGED',
                    severity: Math.abs(drift) > 3600 ? 'HIGH' : 'WARN',
                    occurredAt: at,
                    details: {
                        driftSec: drift,
                        message: `PC clock changed by ${Math.round(drift / 60)} min`
                    },
                    dedupeKey: `clock:${e.clientId}`
                });
            }
        }
        for (const wd of workDates)await this.detectGaps(employeeId, deviceId, wd, now);
        // 4. confirmations inside the batch ("Add to weekly timesheet" while offline)
        const confirmDates = evPart.fresh.filter((e)=>e.type === 'SUMMARY_CONFIRMED').map((e)=>(0, _shared.trackerWorkDate)(fix(e.at)));
        // 5. projections + downstream
        for (const wd of workDates)await this.projectDay(employeeId, wd);
        for (const wd of confirmDates)await this.markConfirmed(employeeId, wd);
        await this.prisma.trackerDevice.update({
            where: {
                id: deviceId
            },
            data: {
                lastSeenAt: now,
                lastSyncAt: now,
                lastSkewSec: skew,
                ...batch.queueDepth !== undefined ? {
                    queueDepth: batch.queueDepth
                } : {}
            }
        });
        const dates = [
            ...workDates
        ].sort();
        if (dates.length) this.events.emit('tracker.segmentsIngested', {
            employeeId,
            workDates: dates
        });
        if (rejected.length) await this.audit.record({
            action: 'tracker.sync.rejected',
            entity: 'TrackerDevice',
            entityId: deviceId,
            meta: {
                count: rejected.length,
                reasons: [
                    ...new Set(rejected.map((r)=>r.reason))
                ]
            }
        });
        return {
            accepted: evPart.fresh.length + acceptedSegs,
            duplicates: evPart.duplicates + segPart.duplicates,
            skewSeconds: skew,
            rejected,
            workDates: dates,
            serverTime: now.toISOString()
        };
    }
    async notifyClaimReviewers(name, claims, taskById) {
        const byReviewer = new Map();
        for (const c of claims)if (c.reviewerEmployeeId) byReviewer.set(c.reviewerEmployeeId, [
            ...byReviewer.get(c.reviewerEmployeeId) ?? [],
            c
        ]);
        for (const [rid, list] of byReviewer){
            const users = await this.notifications.usersForEmployees([
                rid
            ]);
            const first = list[0];
            const key = first.taskId ? taskById.get(first.taskId)?.key : null;
            await this.notifications.notify({
                userIds: users,
                type: 'approval',
                title: `${name.split(' ')[0]} marked ${first.minutes} min idle as working${key ? ` (${key})` : ''}`,
                body: list.length > 1 ? `${list.length} idle claims awaiting review` : first.note ?? undefined,
                link: '/approvals',
                from: name
            });
        }
    }
    async flag(i) {
        const tenantId = (0, _requestcontext.currentTenantId)();
        await this.prisma.trackerIntegrityEvent.upsert({
            where: {
                dedupeKey: `${tenantId}:${i.dedupeKey}`
            },
            update: {},
            create: {
                tenantId,
                employeeId: i.employeeId,
                deviceId: i.deviceId ?? null,
                workDate: (0, _trackerrules.dbDate)(i.workDate),
                type: i.type,
                severity: i.severity,
                occurredAt: i.occurredAt,
                details: i.details,
                dedupeKey: `${tenantId}:${i.dedupeKey}`
            }
        }).catch((e)=>this.log.warn(`integrity flag failed: ${e.message}`));
    }
    async detectGaps(employeeId, deviceId, dateKey, now) {
        const date = (0, _trackerrules.dbDate)(dateKey);
        const [segs, sessions] = await Promise.all([
            this.prisma.activitySegment.findMany({
                where: {
                    employeeId,
                    workDate: date
                },
                select: {
                    startAt: true,
                    endAt: true
                }
            }),
            this.prisma.workSession.findMany({
                where: {
                    employeeId,
                    attendanceDate: date
                },
                select: {
                    startedAt: true,
                    endedAt: true
                }
            }).catch(()=>[])
        ]);
        for (const g of (0, _trackerrules.findTrackingGaps)(segs, sessions, {
            now
        })){
            await this.flag({
                employeeId,
                deviceId,
                workDate: dateKey,
                type: 'GAP',
                severity: g.seconds >= 3600 ? 'WARN' : 'INFO',
                occurredAt: g.from,
                details: {
                    from: g.from.toISOString(),
                    to: g.to.toISOString(),
                    minutes: Math.round(g.seconds / 60),
                    message: `No tracker data ${fmtHm(g.from)}–${fmtHm(g.to)} while punched in`
                },
                dedupeKey: `gap:${employeeId}:${g.from.toISOString()}`
            });
        }
    }
    // ── projection ──────────────────────────────────────────────────────────
    /** Re-projects TrackerDaySummary for one employee/day from stored segments, claims and shots. */ async projectDay(employeeId, dateKey) {
        const date = (0, _trackerrules.dbDate)(dateKey);
        const [segs, claims, shots, flags] = await Promise.all([
            this.prisma.activitySegment.findMany({
                where: {
                    employeeId,
                    workDate: date
                },
                orderBy: {
                    startAt: 'asc'
                }
            }),
            this.prisma.idleClaim.findMany({
                where: {
                    employeeId,
                    workDate: date
                },
                select: {
                    segmentId: true,
                    status: true
                }
            }),
            this.prisma.screenshot.count({
                where: {
                    employeeId,
                    workDate: date
                }
            }),
            this.prisma.trackerIntegrityEvent.count({
                where: {
                    employeeId,
                    workDate: date
                }
            })
        ]);
        const claimBySeg = new Map(claims.map((c)=>[
                c.segmentId,
                c.status
            ]));
        const withClaims = segs.map((s)=>({
                ...s,
                claimStatus: claimBySeg.get(s.id) ?? (s.kind === 'IDLE_WORK' ? 'PENDING' : null)
            }));
        const totals = (0, _shared.summarizeSegments)(withClaims.map((s)=>({
                kind: s.kind,
                idleResolution: s.idleResolution,
                taskId: s.taskId,
                durationSec: s.durationSec,
                claimStatus: s.claimStatus
            })));
        const taskIds = Object.keys(totals.perTaskSec).filter(Boolean);
        const tasks = taskIds.length ? await this.prisma.task.findMany({
            where: {
                id: {
                    in: taskIds
                }
            },
            select: {
                id: true,
                key: true,
                title: true,
                projectId: true
            }
        }) : [];
        const tById = new Map(tasks.map((t)=>[
                t.id,
                t
            ]));
        const perTask = Object.entries(totals.perTaskSec).filter(([, sec])=>sec > 0).map(([taskId, seconds])=>{
            const t = tById.get(taskId);
            return {
                taskId: taskId || null,
                projectId: t?.projectId ?? null,
                key: t?.key ?? 'General',
                title: t?.title ?? 'Unallocated',
                seconds
            };
        }).sort((a, b)=>b.seconds - a.seconds);
        const timeline = (0, _trackerrules.buildTimeline)(withClaims, (id)=>id ? tById.get(id)?.key ?? null : null);
        const data = {
            workedSec: totals.workedSec,
            breakSec: totals.breakSec,
            idleSec: totals.idleSec,
            idleDeductedSec: totals.idleDeductedSec,
            idlePendingSec: totals.idlePendingSec,
            claimApprovedSec: totals.claimApprovedSec,
            screenshotCount: shots,
            perTask: perTask,
            timeline: timeline,
            firstInAt: segs[0]?.startAt ?? null,
            lastOutAt: segs.length ? segs[segs.length - 1].endAt : null,
            integrityFlags: flags,
            lastProjectedAt: new Date()
        };
        return this.prisma.trackerDaySummary.upsert({
            where: {
                employeeId_workDate: {
                    employeeId,
                    workDate: date
                }
            },
            create: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                employeeId,
                workDate: date,
                ...data
            },
            update: data
        });
    }
    async markConfirmed(employeeId, dateKey) {
        await this.prisma.trackerDaySummary.updateMany({
            where: {
                employeeId,
                workDate: (0, _trackerrules.dbDate)(dateKey),
                confirmedAt: null
            },
            data: {
                confirmedAt: new Date()
            }
        });
    }
    /** "Add to weekly timesheet": idempotent; re-projects and asks time to rebuild the timesheet. */ async confirmDay(employeeId, dateKey) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw (0, _errors.badRequest)('Invalid date');
        await this.projectDay(employeeId, dateKey);
        await this.markConfirmed(employeeId, dateKey);
        const s = await this.prisma.trackerDaySummary.findUniqueOrThrow({
            where: {
                employeeId_workDate: {
                    employeeId,
                    workDate: (0, _trackerrules.dbDate)(dateKey)
                }
            }
        });
        const weekSubmitted = await this.weekSubmitted(employeeId, dateKey);
        this.events.emit('tracker.segmentsIngested', {
            employeeId,
            workDates: [
                dateKey
            ],
            confirmed: true
        });
        await this.audit.record({
            action: 'tracker.summary.confirmed',
            entity: 'TrackerDaySummary',
            entityId: s.id,
            meta: {
                date: dateKey
            }
        });
        return {
            confirmedAt: s.confirmedAt.toISOString(),
            date: dateKey,
            weekSubmitted
        };
    }
    // ── screenshots ─────────────────────────────────────────────────────────
    async uploadScreenshot(deviceId, employeeId, userId, file, metaRaw) {
        let metaObj = metaRaw;
        if (typeof metaRaw === 'string') {
            try {
                metaObj = JSON.parse(metaRaw);
            } catch  {
                throw (0, _errors.badRequest)('meta must be JSON', 'VALIDATION_FAILED');
            }
        }
        const parsed = _shared.screenshotMetaSchema.safeParse(metaObj);
        if (!parsed.success) throw (0, _errors.badRequest)(parsed.error.issues[0]?.message ?? 'Invalid screenshot meta', 'VALIDATION_FAILED');
        const meta = parsed.data;
        const existing = await this.prisma.screenshot.findUnique({
            where: {
                clientId: meta.clientId
            }
        });
        if (existing) return {
            id: existing.id,
            duplicate: true,
            blurred: existing.blurred,
            workDate: (0, _trackerrules.dateKeyOf)(existing.workDate)
        };
        if (!file) throw (0, _errors.badRequest)('No image uploaded');
        if (!SHOT_MIME.test(file.mimetype)) throw (0, _errors.badRequest)(`Screenshots must be PNG, JPEG or WebP (got ${file.mimetype})`, 'FILE_TYPE');
        if (file.size > 15 * 1024 * 1024) throw (0, _errors.badRequest)('Screenshot is too large', 'FILE_TOO_LARGE');
        const device = await this.prisma.trackerDevice.findUniqueOrThrow({
            where: {
                id: deviceId
            }
        });
        const capturedAt = (0, _trackerrules.correctedInstant)(meta.capturedAt, device.lastSkewSec ?? 0);
        const workDate = (0, _shared.trackerWorkDate)(capturedAt);
        const policy = await this.tctx.policyFor(employeeId, capturedAt);
        let img = (0, _sharp.default)(file.buffer, {
            failOn: 'none'
        }).rotate();
        let blurred = meta.blurred;
        if (policy.blurScreenshots && !blurred) {
            img = img.blur(8); // defence in depth: device should already blur
            blurred = true;
        }
        let full;
        let thumb;
        try {
            full = await img.clone().resize({
                width: 1920,
                height: 1920,
                fit: 'inside',
                withoutEnlargement: true
            }).webp({
                quality: 70
            }).toBuffer();
            thumb = await img.clone().resize({
                width: 320,
                withoutEnlargement: true
            }).webp({
                quality: 60
            }).toBuffer();
        } catch  {
            throw (0, _errors.badRequest)('The screenshot image could not be read', 'IMAGE_INVALID');
        }
        const task = meta.taskId ? await this.prisma.task.findUnique({
            where: {
                id: meta.taskId
            },
            select: {
                id: true,
                key: true,
                projectId: true
            }
        }) : null;
        const stamp = capturedAt.toISOString().replace(/[:.]/g, '-');
        const fileRow = await this.storage.save({
            data: full,
            filename: `shot-${stamp}.webp`,
            mime: 'image/webp',
            category: 'screenshot',
            isPrivate: true,
            ownerUserId: userId
        });
        const thumbRow = await this.storage.save({
            data: thumb,
            filename: `shot-${stamp}-thumb.webp`,
            mime: 'image/webp',
            category: 'screenshot',
            isPrivate: true,
            ownerUserId: userId
        });
        const inIdle = !!await this.prisma.activitySegment.findFirst({
            where: {
                employeeId,
                kind: {
                    in: [
                        'IDLE',
                        'IDLE_WORK'
                    ]
                },
                startAt: {
                    lte: capturedAt
                },
                endAt: {
                    gt: capturedAt
                }
            },
            select: {
                id: true
            }
        });
        try {
            const row = await this.prisma.screenshot.create({
                data: {
                    tenantId: (0, _requestcontext.currentTenantId)(),
                    clientId: meta.clientId,
                    employeeId,
                    deviceId,
                    capturedAt,
                    workDate: (0, _trackerrules.dbDate)(workDate),
                    taskId: task?.id ?? null,
                    projectId: task?.projectId ?? null,
                    fileId: fileRow.id,
                    thumbFileId: thumbRow.id,
                    blurred,
                    inIdle,
                    monitorCount: meta.monitorCount,
                    purgeAfter: new Date(capturedAt.getTime() + policy.screenshotRetentionDays * 86400_000)
                }
            });
            await this.projectDay(employeeId, workDate);
            await this.prisma.trackerDevice.update({
                where: {
                    id: deviceId
                },
                data: {
                    lastSeenAt: new Date(),
                    displays: meta.monitorCount
                }
            });
            return {
                id: row.id,
                duplicate: false,
                blurred,
                workDate
            };
        } catch (e) {
            // concurrent retry of the same clientId
            if (e instanceof _client.Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                await this.storage.remove(fileRow.id);
                await this.storage.remove(thumbRow.id);
                const row = await this.prisma.screenshot.findUniqueOrThrow({
                    where: {
                        clientId: meta.clientId
                    }
                });
                return {
                    id: row.id,
                    duplicate: true,
                    blurred: row.blurred,
                    workDate: (0, _trackerrules.dateKeyOf)(row.workDate)
                };
            }
            throw e;
        }
    }
    /** Retention: delete screenshot files past purgeAfter; the row stays (purgedAt) for counts. */ async purgeScreenshots(now = new Date()) {
        const due = await this.prisma.screenshot.findMany({
            where: {
                purgeAfter: {
                    lt: now
                },
                purgedAt: null
            },
            take: 500
        });
        for (const s of due){
            await this.storage.remove(s.fileId).catch(()=>undefined);
            if (s.thumbFileId) await this.storage.remove(s.thumbFileId).catch(()=>undefined);
            await this.prisma.screenshot.update({
                where: {
                    id: s.id
                },
                data: {
                    purgedAt: now,
                    thumbFileId: null
                }
            });
        }
        if (due.length) await this.audit.record({
            action: 'screenshot.purged',
            entity: 'Screenshot',
            meta: {
                count: due.length
            }
        });
        return due.length;
    }
    /** Nightly: SCREENSHOT_MISSING when ≥ 3 expected shots are missing for the day. */ async screenshotMissingCheck(dateKey) {
        const rows = await this.prisma.trackerDaySummary.findMany({
            where: {
                workDate: (0, _trackerrules.dbDate)(dateKey),
                workedSec: {
                    gt: 0
                }
            }
        });
        for (const r of rows){
            const policy = await this.tctx.policyFor(r.employeeId);
            if (!policy.screenshotsEnabled) continue;
            const expected = Math.floor(r.workedSec / (policy.screenshotIntervalMin * 60));
            const missing = expected - r.screenshotCount;
            if (missing >= 3) {
                await this.flag({
                    employeeId: r.employeeId,
                    workDate: dateKey,
                    type: 'SCREENSHOT_MISSING',
                    severity: 'WARN',
                    occurredAt: new Date(),
                    details: {
                        expected,
                        actual: r.screenshotCount,
                        missing,
                        message: `Screenshots missing ${missing}`
                    },
                    dedupeKey: `shots:${r.employeeId}:${dateKey}`
                });
            }
        }
    }
};
IngestService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _trackercontextservice.TrackerContextService === "undefined" ? Object : _trackercontextservice.TrackerContextService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _storageservice.StorageService === "undefined" ? Object : _storageservice.StorageService,
        typeof _timeport.TimePort === "undefined" ? Object : _timeport.TimePort
    ])
], IngestService);

//# sourceMappingURL=ingest.service.js.map