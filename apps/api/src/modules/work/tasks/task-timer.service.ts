import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type { AssigneeTimerState } from '../work.rules';

/** A heartbeat arrives every 60 s; a device silent for longer isn't timing anything. */
const FRESH_MS = 3 * 60_000;
/** The tracker closes and syncs its open segment at least every 15 min while working; older means a stalled sync. */
const MAX_UNSYNCED_MS = 30 * 60_000;
/** Events that open a new WORK segment on the device. */
const SEGMENT_STARTS = ['PUNCH_IN', 'TASK_SWITCH', 'BREAK_END', 'IDLE_RESOLVED'];

export type RunningTimer = { employeeId: string; since: Date };

/**
 * Live desktop-tracker state for the task board (tracker and attendance tables are read-only here).
 * The "timer" of a task is the assignee's tracker while its active task is that task.
 */
@Injectable()
export class TaskTimerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * taskId → who is timing it, and `since`: where the part not yet synced to the server starts
   * (the end of their last synced segment, or a later punch-in / switch / break end). The board adds
   * now − since to the synced spent time, so nothing is counted twice.
   */
  async running(taskIds: string[], now = new Date()): Promise<Map<string, RunningTimer>> {
    const out = new Map<string, RunningTimer>();
    if (!taskIds.length) return out;
    const devices = await this.prisma.trackerDevice.findMany({
      where: { status: 'ACTIVE', liveStatus: 'WORKING', liveTaskId: { in: taskIds }, lastSeenAt: { gte: new Date(now.getTime() - FRESH_MS) } },
      orderBy: { lastSeenAt: 'desc' },
      select: { employeeId: true, liveTaskId: true },
    });
    for (const d of devices) {
      if (!d.liveTaskId || out.has(d.liveTaskId)) continue;
      const since = await this.unsyncedSince(d.employeeId, now);
      if (since) out.set(d.liveTaskId, { employeeId: d.employeeId, since });
    }
    return out;
  }

  private async unsyncedSince(employeeId: string, now: Date): Promise<Date | null> {
    const floor = new Date(now.getTime() - 24 * 3600_000);
    const [seg, ev, session] = await Promise.all([
      this.prisma.activitySegment.findFirst({ where: { employeeId, endAt: { gte: floor, lte: now } }, orderBy: { endAt: 'desc' }, select: { endAt: true } }),
      this.prisma.trackerEvent.findFirst({ where: { employeeId, type: { in: SEGMENT_STARTS }, at: { gte: floor, lte: now } }, orderBy: { at: 'desc' }, select: { at: true } }),
      // Sessions opened on the web / biometric start tracking without a PUNCH_IN event.
      this.prisma.workSession.findFirst({ where: { employeeId, endedAt: null, startedAt: { gte: floor } }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
    ]);
    const t = Math.max(seg?.endAt.getTime() ?? 0, ev?.at.getTime() ?? 0, session?.startedAt.getTime() ?? 0);
    if (!t || now.getTime() - t > MAX_UNSYNCED_MS) return null;
    return new Date(t);
  }

  /** Can the assignee's timer start right now? (for the move toast) */
  async assigneeState(employeeId: string, now = new Date()): Promise<AssigneeTimerState> {
    const [devices, session] = await Promise.all([
      this.prisma.trackerDevice.findMany({ where: { employeeId, status: 'ACTIVE' }, orderBy: { lastSeenAt: 'desc' }, select: { liveStatus: true, lastSeenAt: true } }),
      this.prisma.workSession.findFirst({ where: { employeeId, endedAt: null }, select: { id: true } }),
    ]);
    const live = devices.find((d) => d.lastSeenAt && now.getTime() - d.lastSeenAt.getTime() < FRESH_MS);
    return {
      hasDevice: devices.length > 0,
      punchedIn: !!session || (!!live && live.liveStatus !== 'OUT' && live.liveStatus !== null),
      onBreak: live?.liveStatus === 'BREAK',
    };
  }
}
