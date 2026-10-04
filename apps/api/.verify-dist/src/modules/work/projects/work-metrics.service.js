"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WorkMetricsService", {
    enumerable: true,
    get: function() {
        return WorkMetricsService;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _requestcontext = require("../../../core/context/request-context");
const _workrules = require("../work.rules");
const _workutil = require("../work.util");
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
let WorkMetricsService = class WorkMetricsService {
    prisma;
    notifications;
    log = new _common.Logger('WorkMetrics');
    lastTenantRun = new Map();
    lastProjectRun = new Map();
    constructor(prisma, notifications){
        this.prisma = prisma;
        this.notifications = notifications;
    }
    delegate(name) {
        const d = this.prisma[name];
        return d && typeof d.findMany === 'function' ? d : undefined;
    }
    /** Tracked minutes per task, keyed by taskId (and per task+employee+date for interns). */ async trackedByTask(taskIds) {
        const byTask = new Map();
        const byTaskEmpDay = new Map();
        if (!taskIds.length) return {
            byTask,
            byTaskEmpDay
        };
        const covered = new Set();
        const add = (k, taskId, min)=>{
            byTaskEmpDay.set(k, (byTaskEmpDay.get(k) ?? 0) + min);
            byTask.set(taskId, (byTask.get(taskId) ?? 0) + min);
        };
        try {
            const lineD = this.delegate('timesheetLine');
            const cellD = this.delegate('timesheetCell');
            const sheetD = this.delegate('timesheet');
            if (lineD && cellD && sheetD) {
                const lines = await lineD.findMany({
                    where: {
                        taskId: {
                            in: taskIds
                        }
                    },
                    select: {
                        id: true,
                        taskId: true,
                        timesheetId: true
                    }
                });
                if (lines.length) {
                    const sheets = await sheetD.findMany({
                        where: {
                            id: {
                                in: [
                                    ...new Set(lines.map((l)=>l.timesheetId))
                                ]
                            }
                        },
                        select: {
                            id: true,
                            employeeId: true
                        }
                    });
                    const empOf = new Map(sheets.map((s)=>[
                            s.id,
                            s.employeeId
                        ]));
                    const lineOf = new Map(lines.map((l)=>[
                            l.id,
                            l
                        ]));
                    const cells = await cellD.findMany({
                        where: {
                            lineId: {
                                in: lines.map((l)=>l.id)
                            }
                        },
                        select: {
                            lineId: true,
                            date: true,
                            finalMinutes: true
                        }
                    });
                    for (const c of cells){
                        const l = lineOf.get(c.lineId);
                        if (!l || !c.finalMinutes) continue;
                        const k = `${l.taskId}|${empOf.get(l.timesheetId)}|${c.date.toISOString().slice(0, 10)}`;
                        covered.add(k);
                        add(k, l.taskId, c.finalMinutes);
                    }
                }
            }
        } catch (e) {
            this.log.debug(`timesheet read skipped: ${e.message}`);
        }
        try {
            const segD = this.delegate('activitySegment');
            if (segD) {
                const segs = await segD.findMany({
                    where: {
                        taskId: {
                            in: taskIds
                        },
                        OR: [
                            {
                                kind: {
                                    in: [
                                        'WORK',
                                        'IDLE_WORK'
                                    ]
                                }
                            },
                            {
                                kind: 'IDLE',
                                idleResolution: 'CLAIMED_WORK'
                            }
                        ]
                    },
                    select: {
                        taskId: true,
                        employeeId: true,
                        workDate: true,
                        durationSec: true
                    }
                });
                const acc = new Map();
                for (const s of segs){
                    const k = `${s.taskId}|${s.employeeId}|${s.workDate.toISOString().slice(0, 10)}`;
                    if (covered.has(k)) continue;
                    const cur = acc.get(k) ?? {
                        taskId: s.taskId,
                        sec: 0
                    };
                    cur.sec += s.durationSec ?? 0;
                    acc.set(k, cur);
                }
                for (const [k, v] of acc)add(k, v.taskId, Math.round(v.sec / 60));
            }
        } catch (e) {
            this.log.debug(`tracker read skipped: ${e.message}`);
        }
        return {
            byTask,
            byTaskEmpDay
        };
    }
    /** Minutes on project-level timesheet lines without a task (count towards the project only). */ async projectOnlyMinutes(projectId) {
        try {
            const lineD = this.delegate('timesheetLine');
            const cellD = this.delegate('timesheetCell');
            if (!lineD || !cellD) return 0;
            const lines = await lineD.findMany({
                where: {
                    projectId,
                    taskId: null
                },
                select: {
                    id: true
                }
            });
            if (!lines.length) return 0;
            const cells = await cellD.findMany({
                where: {
                    lineId: {
                        in: lines.map((l)=>l.id)
                    }
                },
                select: {
                    finalMinutes: true
                }
            });
            return cells.reduce((s, c)=>s + (c.finalMinutes ?? 0), 0);
        } catch  {
            return 0;
        }
    }
    /** Recompute task logged minutes, project logged/progress/health for one project. */ async recomputeProject(projectId) {
        const project = await this.prisma.project.findFirst({
            where: {
                id: projectId
            }
        });
        if (!project) return;
        const tasks = await this.prisma.task.findMany({
            where: {
                projectId
            },
            select: {
                id: true,
                status: true,
                estimatedMinutes: true,
                isStanding: true,
                loggedMinutes: true,
                openingLoggedMinutes: true
            }
        });
        const { byTask } = await this.trackedByTask(tasks.map((t)=>t.id));
        let logged = project.openingLoggedMinutes + await this.projectOnlyMinutes(projectId);
        for (const t of tasks){
            const m = t.openingLoggedMinutes + (byTask.get(t.id) ?? 0);
            logged += m;
            if (m !== t.loggedMinutes) await this.prisma.task.update({
                where: {
                    id: t.id
                },
                data: {
                    loggedMinutes: m
                }
            });
        }
        const progressPct = project.isSystem ? 0 : (0, _workrules.computeProgress)(tasks.map((t)=>({
                status: t.status,
                estimatedMinutes: t.estimatedMinutes,
                isStanding: t.isStanding
            })), project.estimatedMinutes);
        const { health, reason } = project.isSystem ? {
            health: 'NA',
            reason: null
        } : (0, _workrules.computeHealth)({
            status: project.status,
            estimatedMinutes: project.estimatedMinutes,
            loggedMinutes: logged,
            progressPct,
            startDate: project.startDate,
            deadline: project.deadline
        }, (0, _workutil.todayDate)());
        await this.prisma.project.update({
            where: {
                id: projectId
            },
            data: {
                loggedMinutes: logged,
                progressPct,
                health,
                healthReason: reason,
                healthComputedAt: new Date()
            }
        });
        if (health !== project.health && (health === 'AT_RISK' || health === 'OFF_TRACK')) {
            const managers = await this.notifications.usersWithPermission('tasks.viewAllBoards');
            const lead = await this.notifications.usersForEmployees([
                project.leadEmployeeId
            ]);
            await this.notifications.notify({
                userIds: [
                    ...lead,
                    ...managers
                ].slice(0, 25),
                type: 'project.health',
                title: `${project.name} is ${health === 'AT_RISK' ? 'at risk' : 'off track'}`,
                body: reason ?? undefined,
                link: `/projects/${project.id}`,
                from: 'Projects',
                email: true
            });
        }
        this.lastProjectRun.set(projectId, Date.now());
    }
    async recomputeProjectIfStale(projectId, maxAgeMs = 60_000) {
        if (Date.now() - (this.lastProjectRun.get(projectId) ?? 0) < maxAgeMs) return;
        await this.recomputeProject(projectId);
    }
    /** All live projects of the current tenant. */ async recomputeTenant() {
        const projects = await this.prisma.project.findMany({
            where: {
                status: {
                    in: [
                        'PLANNING',
                        'ACTIVE',
                        'ON_HOLD',
                        'COMPLETED'
                    ]
                }
            },
            select: {
                id: true
            }
        });
        for (const p of projects)await this.recomputeProject(p.id);
        this.lastTenantRun.set((0, _requestcontext.currentTenantId)(), Date.now());
    }
    /** Throttled recompute on read (project list / KPIs). */ async recomputeTenantIfStale(maxAgeMs = 5 * 60_000) {
        const t = (0, _requestcontext.currentTenantId)();
        if (Date.now() - (this.lastTenantRun.get(t) ?? 0) < maxAgeMs) return;
        this.lastTenantRun.set(t, Date.now());
        try {
            await this.recomputeTenant();
        } catch (e) {
            this.log.warn(`recompute failed: ${e.message}`);
        }
    }
    /** Nightly 02:00 IST: logged minutes, progress and health for every tenant. */ async nightly() {
        const tenants = await this.prisma.raw.tenant.findMany({
            select: {
                id: true
            }
        });
        for (const t of tenants){
            await (0, _requestcontext.runAsTenant)(t.id, ()=>this.recomputeTenant()).catch((e)=>this.log.error(`nightly ${t.id}: ${e.message}`));
        }
    }
    /**
   * Billable minutes per project for a month. Source preference: approved/submitted timesheet cells on
   * billable lines → tracker segments → task logged minutes of tasks active that month.
   */ async billableMinutes(projectIds, start, end) {
        const byProject = new Map();
        if (!projectIds.length) return {
            byProject,
            source: 'timesheets'
        };
        try {
            const lineD = this.delegate('timesheetLine');
            const cellD = this.delegate('timesheetCell');
            if (lineD && cellD) {
                const anyCells = await cellD.findMany({
                    where: {
                        date: {
                            gte: start,
                            lt: end
                        }
                    },
                    select: {
                        lineId: true
                    },
                    take: 1
                });
                if (anyCells.length) {
                    const lines = await lineD.findMany({
                        where: {
                            projectId: {
                                in: projectIds
                            },
                            billable: true
                        },
                        select: {
                            id: true,
                            projectId: true
                        }
                    });
                    const pOf = new Map(lines.map((l)=>[
                            l.id,
                            l.projectId
                        ]));
                    const cells = lines.length ? await cellD.findMany({
                        where: {
                            lineId: {
                                in: lines.map((l)=>l.id)
                            },
                            date: {
                                gte: start,
                                lt: end
                            }
                        },
                        select: {
                            lineId: true,
                            finalMinutes: true
                        }
                    }) : [];
                    for (const c of cells){
                        const pid = pOf.get(c.lineId);
                        if (pid) byProject.set(pid, (byProject.get(pid) ?? 0) + (c.finalMinutes ?? 0));
                    }
                    return {
                        byProject,
                        source: 'timesheets'
                    };
                }
            }
        } catch (e) {
            this.log.debug(`billable timesheet read skipped: ${e.message}`);
        }
        try {
            const segD = this.delegate('activitySegment');
            if (segD) {
                const segs = await segD.findMany({
                    where: {
                        projectId: {
                            in: projectIds
                        },
                        workDate: {
                            gte: start,
                            lt: end
                        },
                        kind: {
                            in: [
                                'WORK',
                                'IDLE_WORK'
                            ]
                        }
                    },
                    select: {
                        projectId: true,
                        durationSec: true
                    }
                });
                if (segs.length) {
                    for (const s of segs)byProject.set(s.projectId, (byProject.get(s.projectId) ?? 0) + Math.round((s.durationSec ?? 0) / 60));
                    return {
                        byProject,
                        source: 'tracker'
                    };
                }
            }
        } catch (e) {
            this.log.debug(`billable tracker read skipped: ${e.message}`);
        }
        const tasks = await this.prisma.task.findMany({
            where: {
                projectId: {
                    in: projectIds
                },
                isStanding: false,
                OR: [
                    {
                        doneAt: {
                            gte: start,
                            lt: end
                        }
                    },
                    {
                        status: {
                            in: [
                                'WIP',
                                'DEV_COMPLETED',
                                'QA'
                            ]
                        }
                    }
                ]
            },
            select: {
                projectId: true,
                loggedMinutes: true
            }
        });
        for (const t of tasks)byProject.set(t.projectId, (byProject.get(t.projectId) ?? 0) + t.loggedMinutes);
        return {
            byProject,
            source: 'tasks'
        };
    }
};
_ts_decorate([
    (0, _schedule.Cron)('0 2 * * *', {
        timeZone: 'Asia/Kolkata'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WorkMetricsService.prototype, "nightly", null);
WorkMetricsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService
    ])
], WorkMetricsService);

//# sourceMappingURL=work-metrics.service.js.map