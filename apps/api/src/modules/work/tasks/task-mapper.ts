import type { Task } from '@prisma/client';
import type { TaskCard, TaskStatusKey } from '@lexisora/shared';
import { canMoveTask, shortName } from '../work.rules';
import { dateKey, todayKey } from '../work.util';

/** Task row → kanban card. `names` maps employeeId → full name. */
export function toCard(
  t: Task,
  names: Map<string, string>,
  rights: { canView: boolean; canManage: boolean },
  me: string | null,
): TaskCard {
  const assigneeName = t.assigneeEmployeeId ? (names.get(t.assigneeEmployeeId) ?? null) : null;
  const due = dateKey(t.dueDate);
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    moduleName: t.moduleName,
    status: t.status as TaskStatusKey,
    assigneeEmployeeId: t.assigneeEmployeeId,
    assigneeName,
    assigneeShort: shortName(assigneeName),
    estimatedMinutes: t.estimatedMinutes,
    loggedMinutes: t.loggedMinutes,
    dueDate: due,
    overdue: !!due && due < todayKey() && t.status !== 'DONE' && t.status !== 'CANCELLED',
    gitBranch: t.gitBranch,
    gitMrUrl: t.gitMrUrl,
    gitMrIid: t.gitMrIid,
    gitMrState: t.gitMrState,
    gitSyncStatus: t.gitSyncStatus,
    version: t.version,
    canMove: canMoveTask({ canManage: rights.canManage, canView: rights.canView, assigneeEmployeeId: t.assigneeEmployeeId, me }),
  };
}
