import { Injectable } from '@nestjs/common';
import { TRACKER_SOCKET_EVENTS, type TrackerSwitchCommand } from '@lexisora/shared';
import { RealtimeGateway } from '../../core/realtime/realtime.gateway';
import { EventsService } from '../../core/registry/events.service';
import { getContext } from '../../core/context/request-context';

/**
 * Realtime + domain events for the work domain.
 * Board broadcasts carry ids only (`work.board` → viewers refetch through the access-checked API),
 * so private boards never leak task data over the socket.
 */
@Injectable()
export class WorkEvents {
  constructor(
    private readonly realtime: RealtimeGateway,
    private readonly events: EventsService,
  ) {}

  boardChanged(projectId: string, departmentId: string | null, taskId?: string) {
    const t = getContext()?.tenantId;
    if (t) this.realtime.toTenant(t, 'work.board', { projectId, departmentId, taskId: taskId ?? null });
  }

  /** A user's board access changed (allocated / revoked) — their lock state updates live. */
  accessChanged(userIds: string[], projectId: string, departmentId: string) {
    this.realtime.toUsers(userIds, 'work.boardAccess', { projectId, departmentId });
  }

  /**
   * The tracker task list should refresh for these users: the web ('tracker.tasks_changed') and their
   * paired desktop trackers, whose sockets join the same user room ('tasks.updated').
   */
  trackerTasksChanged(userIds: (string | null | undefined)[]) {
    const ids = userIds.filter((x): x is string => !!x);
    this.realtime.toUsers(ids, 'tracker.tasks_changed', {});
    this.realtime.toUsers(ids, TRACKER_SOCKET_EVENTS.tasksUpdated, {});
  }

  /** Start (taskId) or stop (taskId null + ifActive) the employee's desktop timer; the tracker module delivers it. */
  timerCommand(employeeId: string, cmd: TrackerSwitchCommand) {
    this.events.emit('task.timerCommand', { employeeId, ...cmd });
  }

  taskStatusChanged(taskId: string, from: string, to: string) {
    this.events.emit('task.statusChanged', { taskId, from, to });
  }

  emit(event: string, payload: Record<string, unknown>) {
    this.events.emit(event, payload);
  }
}
