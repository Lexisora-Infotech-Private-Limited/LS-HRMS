"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WellnessService", {
    enumerable: true,
    get: function() {
        return WellnessService;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _settingsservice = require("../../../core/settings/settings.service");
const _auditservice = require("../../../core/audit/audit.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _dates = require("../common/dates");
const _wellnessrules = require("./wellness.rules");
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
const SETTINGS_KEY = 'wellness.settings';
let WellnessService = class WellnessService {
    prisma;
    settings;
    audit;
    boardCache = new Map();
    constructor(prisma, settings, audit){
        this.prisma = prisma;
        this.settings = settings;
        this.audit = audit;
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
        return ctx.roleKey === 'hr' || ctx.roleKey === 'admin' || ctx.permissions.has('*');
    }
    async config() {
        const s = await this.settings.get(SETTINGS_KEY, _wellnessrules.DEFAULT_WELLNESS);
        return {
            ..._wellnessrules.DEFAULT_WELLNESS,
            ...s,
            enabledGames: (s.enabledGames ?? _wellnessrules.DEFAULT_WELLNESS.enabledGames).filter((g)=>_shared.GAME_KEYS.includes(g))
        };
    }
    async updateConfig(dto) {
        if (!this.canManage()) throw (0, _errors.forbidden)('Only HR and Admin can change wellness settings');
        const next = {
            ...await this.config(),
            ...dto
        };
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.unlockTime)) throw (0, _errors.badRequest)('Unlock time must be HH:mm');
        await this.settings.set(SETTINGS_KEY, next);
        await this.audit.record({
            action: 'wellness.settings.update',
            entity: 'Setting',
            entityId: SETTINGS_KEY,
            meta: {
                enabledGames: next.enabledGames,
                unlockTime: next.unlockTime,
                breakOnly: next.breakOnly
            }
        });
        return next;
    }
    puzzle(game, date) {
        const t = (0, _requestcontext.currentTenantId)();
        if (game === 'queens') return {
            queens: (0, _shared.generateQueens)(t, date)
        };
        if (game === 'sudoku6') return {
            sudoku: (0, _shared.generateSudoku)(t, date)
        };
        return {
            ladder: (0, _shared.generateLadder)(t, date)
        };
    }
    async rankOf(s) {
        const rows = await this.prisma.gameSession.findMany({
            where: {
                gameKey: s.gameKey,
                puzzleDate: s.puzzleDate,
                completedAt: {
                    not: null
                }
            },
            select: {
                id: true,
                points: true,
                elapsedSec: true
            }
        });
        rows.sort((a, b)=>b.points - a.points || (a.elapsedSec ?? 0) - (b.elapsedSec ?? 0));
        return {
            rank: Math.max(1, rows.findIndex((r)=>r.id === s.id) + 1),
            players: rows.length
        };
    }
    async result(s) {
        if (!s.completedAt) return null;
        const r = await this.rankOf(s);
        return {
            points: s.points,
            elapsedSec: s.elapsedSec ?? 0,
            hintsUsed: s.hintsUsed,
            revealed: s.revealed,
            moves: s.moves,
            ...r
        };
    }
    async today() {
        const { employeeId } = this.me();
        const cfg = await this.config();
        const now = new Date();
        const date = (0, _shared.puzzleDateFor)(now, cfg.unlockTime);
        const week = (0, _wellnessrules.weekRange)(date);
        const [todays, played, weekRows, board] = await Promise.all([
            this.prisma.gameSession.findMany({
                where: {
                    employeeId,
                    puzzleDate: (0, _dates.dateOnly)(date)
                }
            }),
            this.prisma.gameSession.findMany({
                where: {
                    employeeId,
                    completedAt: {
                        not: null
                    },
                    puzzleDate: {
                        gte: (0, _dates.dateOnly)((0, _dates.keyOf)(new Date((0, _dates.dateOnly)(date).getTime() - 400 * 86_400_000)))
                    }
                },
                select: {
                    puzzleDate: true
                },
                distinct: [
                    'puzzleDate'
                ]
            }),
            this.prisma.gameSession.findMany({
                where: {
                    employeeId,
                    completedAt: {
                        not: null
                    },
                    puzzleDate: {
                        gte: (0, _dates.dateOnly)(week.start),
                        lte: (0, _dates.dateOnly)(week.end)
                    }
                },
                select: {
                    points: true
                }
            }),
            this.leaderboard('current')
        ]);
        const byGame = new Map(todays.map((s)=>[
                s.gameKey,
                s
            ]));
        return {
            date,
            dateLabel: (0, _dates.longDate)(new Date(`${date}T06:30:00Z`)),
            nextUnlockLabel: (0, _wellnessrules.nextUnlockLabel)(now, cfg.unlockTime),
            tiles: [
                ...cfg.enabledGames.map((g)=>(0, _wellnessrules.gameTile)(g, byGame.get(g) ?? null)),
                (0, _wellnessrules.leaderboardTile)(board.leader)
            ],
            streak: (0, _wellnessrules.streakFrom)(played.map((p)=>(0, _dates.keyOf)(p.puzzleDate)), date),
            weekPoints: weekRows.reduce((a, r)=>a + r.points, 0)
        };
    }
    /** Idempotent: the same puzzle opened twice (or in two tabs) returns the same session. */ async start(game) {
        const { employeeId } = this.me();
        const cfg = await this.config();
        if (!cfg.enabledGames.includes(game)) throw new _errors.AppError(409, 'WELLNESS_GAME_DISABLED', 'This game is switched off for your organisation');
        const date = (0, _shared.puzzleDateFor)(new Date(), cfg.unlockTime);
        let s = await this.prisma.gameSession.findFirst({
            where: {
                employeeId,
                gameKey: game,
                puzzleDate: (0, _dates.dateOnly)(date)
            }
        });
        if (!s) {
            s = await this.prisma.gameSession.create({
                data: {
                    tenantId: (0, _requestcontext.currentTenantId)(),
                    employeeId,
                    gameKey: game,
                    puzzleDate: (0, _dates.dateOnly)(date),
                    startToken: (0, _nodecrypto.randomBytes)(18).toString('base64url')
                }
            }).catch(async ()=>await this.prisma.gameSession.findFirst({
                    where: {
                        employeeId,
                        gameKey: game,
                        puzzleDate: (0, _dates.dateOnly)(date)
                    }
                }));
        }
        return {
            game,
            puzzleDate: date,
            startToken: s.startToken,
            startedAt: s.startedAt.toISOString(),
            serverNow: new Date().toISOString(),
            ...this.puzzle(game, date),
            result: await this.result(s)
        };
    }
    async complete(game, dto) {
        const { employeeId } = this.me();
        const s = await this.prisma.gameSession.findFirst({
            where: {
                startToken: dto.startToken,
                employeeId,
                gameKey: game
            }
        });
        if (!s) throw (0, _errors.notFound)('Game');
        if (s.completedAt) return await this.result(s);
        const date = (0, _dates.keyOf)(s.puzzleDate);
        const now = new Date();
        const elapsedSec = (0, _wellnessrules.elapsedFor)(s.startedAt, now);
        let steps;
        let par;
        if (dto.revealed) {
            if (elapsedSec < _shared.GAME_REVEAL_AFTER_SEC) throw new _errors.AppError(409, 'WELLNESS_REVEAL_LOCKED', 'Reveal unlocks after 10 minutes of play');
        } else {
            const p = this.puzzle(game, date);
            const ok = p.queens ? (0, _shared.validateQueens)(p.queens.regions, dto.solution) : p.sudoku ? (0, _shared.validateSudoku)(p.sudoku.givens, dto.solution) : (0, _shared.validateLadder)(p.ladder, dto.solution);
            if (!ok) throw new _errors.AppError(422, 'WELLNESS_INVALID', 'That solution does not check out — keep going');
            if (p.ladder) {
                steps = dto.solution.length - 1;
                par = p.ladder.par;
            }
        }
        const points = (0, _shared.scoreGame)(game, {
            elapsedSec,
            hintsUsed: dto.hintsUsed,
            revealed: dto.revealed,
            steps,
            par
        });
        const updated = await this.prisma.gameSession.update({
            where: {
                id: s.id
            },
            data: {
                completedAt: now,
                elapsedSec,
                hintsUsed: dto.hintsUsed,
                revealed: dto.revealed,
                moves: dto.moves ?? steps ?? null,
                points,
                solution: dto.solution ?? null
            }
        });
        this.boardCache.clear();
        return await this.result(updated);
    }
    /** Weekly department leaderboard (Mon–Sun IST), computed on read and cached for 60 s. */ async leaderboard(which) {
        const ctx = (0, _requestcontext.requireContext)();
        const cfg = await this.config();
        const today = (0, _shared.puzzleDateFor)(new Date(), cfg.unlockTime);
        const range = (0, _wellnessrules.weekRange)(today, which);
        const cacheKey = `${ctx.tenantId}:${range.start}`;
        const hit = this.boardCache.get(cacheKey);
        let base;
        if (hit && Date.now() - hit.at < 60_000) base = hit.data;
        else {
            const sessions = await this.prisma.gameSession.findMany({
                where: {
                    completedAt: {
                        not: null
                    },
                    puzzleDate: {
                        gte: (0, _dates.dateOnly)(range.start),
                        lte: (0, _dates.dateOnly)(range.end)
                    }
                },
                select: {
                    employeeId: true,
                    points: true
                }
            });
            const [employees, depts] = await Promise.all([
                this.prisma.employee.findMany({
                    where: {
                        status: {
                            in: [
                                'ACTIVE',
                                'NOTICE_PERIOD'
                            ]
                        }
                    },
                    select: {
                        id: true,
                        fullName: true,
                        departmentId: true,
                        department: {
                            select: {
                                name: true
                            }
                        }
                    }
                }),
                this.prisma.department.findMany({
                    select: {
                        id: true,
                        name: true
                    }
                })
            ]);
            const emp = new Map(employees.map((e)=>[
                    e.id,
                    e
                ]));
            const rows = sessions.map((s)=>({
                    employeeId: s.employeeId,
                    departmentId: emp.get(s.employeeId)?.departmentId ?? null,
                    points: s.points
                }));
            const headcount = new Map();
            for (const e of employees)if (e.departmentId) headcount.set(e.departmentId, (headcount.get(e.departmentId) ?? 0) + 1);
            const teams = (0, _wellnessrules.teamBoard)(rows, depts.map((d)=>({
                    id: d.id,
                    name: d.name,
                    headcount: headcount.get(d.id) ?? 0
                })), null);
            const people = (0, _wellnessrules.peopleBoard)(rows, new Map(employees.map((e)=>[
                    e.id,
                    {
                        name: e.fullName,
                        initials: (0, _shared.initialsOf)(e.fullName),
                        department: e.department?.name ?? null
                    }
                ])), null);
            const leader = teams.find((t)=>t.rank === 1)?.department ?? null;
            base = {
                week: which,
                weekStart: range.start,
                weekEnd: range.end,
                label: (0, _wellnessrules.weekLabel)(range, which),
                teams,
                people,
                leader
            };
            this.boardCache.set(cacheKey, {
                at: Date.now(),
                data: base
            });
        }
        const myDept = ctx.employeeId ? (await this.prisma.employee.findFirst({
            where: {
                id: ctx.employeeId
            },
            select: {
                departmentId: true
            }
        }))?.departmentId ?? null : null;
        return {
            ...base,
            teams: base.teams.map((t)=>({
                    ...t,
                    mine: !!t.departmentId && t.departmentId === myDept
                })),
            people: base.people.map((p)=>({
                    ...p,
                    mine: p.employeeId === ctx.employeeId
                }))
        };
    }
};
WellnessService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _settingsservice.SettingsService === "undefined" ? Object : _settingsservice.SettingsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService
    ])
], WellnessService);

//# sourceMappingURL=wellness.service.js.map