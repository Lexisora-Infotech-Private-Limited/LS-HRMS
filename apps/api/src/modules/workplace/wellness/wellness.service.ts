import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { GameSession, Prisma } from '@prisma/client';
import {
  GAME_KEYS,
  GAME_REVEAL_AFTER_SEC,
  generateLadder,
  generateQueens,
  generateSudoku,
  initialsOf,
  puzzleDateFor,
  scoreGame,
  validateLadder,
  validateQueens,
  validateSudoku,
  type GameKey,
  type GameResult,
  type GameStart,
  type LeaderboardResponse,
  type WellnessToday,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SettingsService } from '../../../core/settings/settings.service';
import { AuditService } from '../../../core/audit/audit.service';
import { currentTenantId, requireContext, type RequestContext } from '../../../core/context/request-context';
import { AppError, badRequest, forbidden, notFound } from '../../../core/http/errors';
import { dateOnly, keyOf, longDate } from '../common/dates';
import {
  DEFAULT_WELLNESS,
  elapsedFor,
  gameTile,
  leaderboardTile,
  nextUnlockLabel,
  peopleBoard,
  streakFrom,
  teamBoard,
  weekLabel,
  weekRange,
  type WellnessSettings,
} from './wellness.rules';

const SETTINGS_KEY = 'wellness.settings';

/**
 * Wellness games (spec §10): deterministic daily puzzles per tenant (shared generators, so the
 * web and the API build the same board), server-timed sessions, validated results, streaks and
 * the weekly department leaderboard.
 */
@Injectable()
export class WellnessService {
  private boardCache = new Map<string, { at: number; data: LeaderboardResponse }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private me(): { ctx: RequestContext; employeeId: string } {
    const ctx = requireContext();
    if (!ctx.employeeId) throw forbidden('Your login is not linked to an employee record');
    return { ctx, employeeId: ctx.employeeId };
  }

  canManage(ctx: RequestContext = requireContext()): boolean {
    return ctx.roleKey === 'hr' || ctx.roleKey === 'admin' || ctx.permissions.has('*');
  }

  async config(): Promise<WellnessSettings> {
    const s = await this.settings.get<Partial<WellnessSettings>>(SETTINGS_KEY, DEFAULT_WELLNESS);
    return { ...DEFAULT_WELLNESS, ...s, enabledGames: (s.enabledGames ?? DEFAULT_WELLNESS.enabledGames).filter((g): g is GameKey => (GAME_KEYS as readonly string[]).includes(g)) };
  }

  async updateConfig(dto: Partial<WellnessSettings>): Promise<WellnessSettings> {
    if (!this.canManage()) throw forbidden('Only HR and Admin can change wellness settings');
    const next = { ...(await this.config()), ...dto };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.unlockTime)) throw badRequest('Unlock time must be HH:mm');
    await this.settings.set(SETTINGS_KEY, next);
    await this.audit.record({ action: 'wellness.settings.update', entity: 'Setting', entityId: SETTINGS_KEY, meta: { enabledGames: next.enabledGames, unlockTime: next.unlockTime, breakOnly: next.breakOnly } });
    return next;
  }

  private puzzle(game: GameKey, date: string) {
    const t = currentTenantId();
    if (game === 'queens') return { queens: generateQueens(t, date) };
    if (game === 'sudoku6') return { sudoku: generateSudoku(t, date) };
    return { ladder: generateLadder(t, date) };
  }

  private async rankOf(s: GameSession): Promise<{ rank: number; players: number }> {
    const rows = await this.prisma.gameSession.findMany({ where: { gameKey: s.gameKey, puzzleDate: s.puzzleDate, completedAt: { not: null } }, select: { id: true, points: true, elapsedSec: true } });
    rows.sort((a, b) => b.points - a.points || (a.elapsedSec ?? 0) - (b.elapsedSec ?? 0));
    return { rank: Math.max(1, rows.findIndex((r) => r.id === s.id) + 1), players: rows.length };
  }

  private async result(s: GameSession): Promise<GameResult | null> {
    if (!s.completedAt) return null;
    const r = await this.rankOf(s);
    return { points: s.points, elapsedSec: s.elapsedSec ?? 0, hintsUsed: s.hintsUsed, revealed: s.revealed, moves: s.moves, ...r };
  }

  async today(): Promise<WellnessToday> {
    const { employeeId } = this.me();
    const cfg = await this.config();
    const now = new Date();
    const date = puzzleDateFor(now, cfg.unlockTime);
    const week = weekRange(date);
    const [todays, played, weekRows, board] = await Promise.all([
      this.prisma.gameSession.findMany({ where: { employeeId, puzzleDate: dateOnly(date) } }),
      this.prisma.gameSession.findMany({ where: { employeeId, completedAt: { not: null }, puzzleDate: { gte: dateOnly(keyOf(new Date(dateOnly(date).getTime() - 400 * 86_400_000))) } }, select: { puzzleDate: true }, distinct: ['puzzleDate'] }),
      this.prisma.gameSession.findMany({ where: { employeeId, completedAt: { not: null }, puzzleDate: { gte: dateOnly(week.start), lte: dateOnly(week.end) } }, select: { points: true } }),
      this.leaderboard('current'),
    ]);
    const byGame = new Map(todays.map((s) => [s.gameKey, s]));
    return {
      date,
      dateLabel: longDate(new Date(`${date}T06:30:00Z`)),
      nextUnlockLabel: nextUnlockLabel(now, cfg.unlockTime),
      tiles: [...cfg.enabledGames.map((g) => gameTile(g, byGame.get(g) ?? null)), leaderboardTile(board.leader)],
      streak: streakFrom(played.map((p) => keyOf(p.puzzleDate)), date),
      weekPoints: weekRows.reduce((a, r) => a + r.points, 0),
    };
  }

  /** Idempotent: the same puzzle opened twice (or in two tabs) returns the same session. */
  async start(game: GameKey): Promise<GameStart> {
    const { employeeId } = this.me();
    const cfg = await this.config();
    if (!cfg.enabledGames.includes(game)) throw new AppError(409, 'WELLNESS_GAME_DISABLED', 'This game is switched off for your organisation');
    const date = puzzleDateFor(new Date(), cfg.unlockTime);
    let s = await this.prisma.gameSession.findFirst({ where: { employeeId, gameKey: game, puzzleDate: dateOnly(date) } });
    if (!s) {
      s = await this.prisma.gameSession
        .create({ data: { tenantId: currentTenantId(), employeeId, gameKey: game, puzzleDate: dateOnly(date), startToken: randomBytes(18).toString('base64url') } })
        .catch(async () => (await this.prisma.gameSession.findFirst({ where: { employeeId, gameKey: game, puzzleDate: dateOnly(date) } }))!);
    }
    return { game, puzzleDate: date, startToken: s.startToken, startedAt: s.startedAt.toISOString(), serverNow: new Date().toISOString(), ...this.puzzle(game, date), result: await this.result(s) };
  }

  async complete(game: GameKey, dto: { startToken: string; solution?: unknown; hintsUsed: number; moves?: number; revealed: boolean }): Promise<GameResult> {
    const { employeeId } = this.me();
    const s = await this.prisma.gameSession.findFirst({ where: { startToken: dto.startToken, employeeId, gameKey: game } });
    if (!s) throw notFound('Game');
    if (s.completedAt) return (await this.result(s))!;
    const date = keyOf(s.puzzleDate);
    const now = new Date();
    const elapsedSec = elapsedFor(s.startedAt, now);
    let steps: number | undefined;
    let par: number | undefined;
    if (dto.revealed) {
      if (elapsedSec < GAME_REVEAL_AFTER_SEC) throw new AppError(409, 'WELLNESS_REVEAL_LOCKED', 'Reveal unlocks after 10 minutes of play');
    } else {
      const p = this.puzzle(game, date);
      const ok = p.queens ? validateQueens(p.queens.regions, dto.solution) : p.sudoku ? validateSudoku(p.sudoku.givens, dto.solution) : validateLadder(p.ladder!, dto.solution);
      if (!ok) throw new AppError(422, 'WELLNESS_INVALID', 'That solution does not check out — keep going');
      if (p.ladder) {
        steps = (dto.solution as unknown[]).length - 1;
        par = p.ladder.par;
      }
    }
    const points = scoreGame(game, { elapsedSec, hintsUsed: dto.hintsUsed, revealed: dto.revealed, steps, par });
    const updated = await this.prisma.gameSession.update({
      where: { id: s.id },
      data: { completedAt: now, elapsedSec, hintsUsed: dto.hintsUsed, revealed: dto.revealed, moves: dto.moves ?? steps ?? null, points, solution: (dto.solution ?? null) as Prisma.InputJsonValue },
    });
    this.boardCache.clear();
    return (await this.result(updated))!;
  }

  /** Weekly department leaderboard (Mon–Sun IST), computed on read and cached for 60 s. */
  async leaderboard(which: 'current' | 'last'): Promise<LeaderboardResponse> {
    const ctx = requireContext();
    const cfg = await this.config();
    const today = puzzleDateFor(new Date(), cfg.unlockTime);
    const range = weekRange(today, which);
    const cacheKey = `${ctx.tenantId}:${range.start}`;
    const hit = this.boardCache.get(cacheKey);
    let base: LeaderboardResponse;
    if (hit && Date.now() - hit.at < 60_000) base = hit.data;
    else {
      const sessions = await this.prisma.gameSession.findMany({ where: { completedAt: { not: null }, puzzleDate: { gte: dateOnly(range.start), lte: dateOnly(range.end) } }, select: { employeeId: true, points: true } });
      const [employees, depts] = await Promise.all([
        this.prisma.employee.findMany({ where: { status: { in: ['ACTIVE', 'NOTICE_PERIOD'] } }, select: { id: true, fullName: true, departmentId: true, department: { select: { name: true } } } }),
        this.prisma.department.findMany({ select: { id: true, name: true } }),
      ]);
      const emp = new Map(employees.map((e) => [e.id, e]));
      const rows = sessions.map((s) => ({ employeeId: s.employeeId, departmentId: emp.get(s.employeeId)?.departmentId ?? null, points: s.points }));
      const headcount = new Map<string, number>();
      for (const e of employees) if (e.departmentId) headcount.set(e.departmentId, (headcount.get(e.departmentId) ?? 0) + 1);
      const teams = teamBoard(rows, depts.map((d) => ({ id: d.id, name: d.name, headcount: headcount.get(d.id) ?? 0 })), null);
      const people = peopleBoard(rows, new Map(employees.map((e) => [e.id, { name: e.fullName, initials: initialsOf(e.fullName), department: e.department?.name ?? null }])), null);
      const leader = teams.find((t) => t.rank === 1)?.department ?? null;
      base = { week: which, weekStart: range.start, weekEnd: range.end, label: weekLabel(range, which), teams, people, leader };
      this.boardCache.set(cacheKey, { at: Date.now(), data: base });
    }
    const myDept = ctx.employeeId ? ((await this.prisma.employee.findFirst({ where: { id: ctx.employeeId }, select: { departmentId: true } }))?.departmentId ?? null) : null;
    return {
      ...base,
      teams: base.teams.map((t) => ({ ...t, mine: !!t.departmentId && t.departmentId === myDept })),
      people: base.people.map((p) => ({ ...p, mine: p.employeeId === ctx.employeeId })),
    };
  }
}
