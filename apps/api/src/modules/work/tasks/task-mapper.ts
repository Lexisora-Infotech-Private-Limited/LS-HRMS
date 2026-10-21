import type { Task } from '@prisma/client';
import { isOverdue, type TaskCard, type TaskStatusKey } from '@lexisora/shared';
import { allowedMoves, canMoveTask, shortName } from '../work.rules';
import { dateKey, todayKey } from '../work.util';

export type CardExtras = {
  /** Spent seconds up to `timer.since` (see TaskCard.spentSeconds); default loggedMinutes. */
  spentSeconds?: number;
  /** Who is timing the task right now (TaskTimerService.running). */
  timer?: { employeeId: string; since: Date } | null;
  /** Board members (department lead + allocated) — only they can pick up an unassigned card. */
  boardPeople?: ReadonlySet<string>;
  /** Project archived / completed / cancelled: no moves. */
  locked?: boolean;
};

/** Task row → kanban card. `names` maps employeeId → full name (include the timer's employee). */
export function toCard(
  t: Task,
  names: Map<string, string>,
  rights: { canView: boolean; canManage: boolean },
  me: string | null,
  extra: CardExtras = {},
): TaskCard {
  const assigneeName = t.assigneeEmployeeId ? (names.get(t.assigneeEmployeeId) ?? null) : null;
  const due = dateKey(t.dueDate);
  const status = t.status as TaskStatusKey;
  const timerName = extra.timer ? (names.get(extra.timer.employeeId) ?? null) : null;
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    moduleName: t.moduleName,
    status,
    assigneeEmployeeId: t.assigneeEmployeeId,
    assigneeName,
    assigneeShort: assigneeName ? shortName(assigneeName) : 'Unassigned',
    estimatedMinutes: t.estimatedMinutes,
    loggedMinutes: t.loggedMinutes,
    dueDate: due,
    overdue: isOverdue(due, status, todayKey()),
    gitBranch: t.gitBranch,
    gitMrUrl: t.gitMrUrl,
    gitMrIid: t.gitMrIid,
    gitMrState: t.gitMrState,
    gitSyncStatus: t.gitSyncStatus,
    version: t.version,
    canMove: !extra.locked && canMoveTask({ canManage: rights.canManage, canView: rights.canView, assigneeEmployeeId: t.assigneeEmployeeId, me }),
    spentSeconds: Math.max(0, Math.round(extra.spentSeconds ?? t.loggedMinutes * 60)),
    timer: extra.timer
      ? {
          employeeId: extra.timer.employeeId,
          name: timerName ?? '—',
          short: shortName(timerName),
          since: extra.timer.since.toISOString(),
          mine: !!me && extra.timer.employeeId === me,
        }
      : null,
    allowedMoves: allowedMoves({
      status,
      canManage: rights.canManage,
      canView: rights.canView,
      locked: !!extra.locked,
      assigneeEmployeeId: t.assigneeEmployeeId,
      me,
      boardPeople: extra.boardPeople,
    }),
  };
}
