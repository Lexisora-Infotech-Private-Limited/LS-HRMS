import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { currentTenantId, runAsTenant } from '../../../core/context/request-context';
import { computeHealth, computeProgress, crossedEstimate, type ProjectStatus, type TaskStatus } from '../work.rules';
import { todayDate } from '../work.util';

type Delegate = { findMany: (args: any) => Promise<any[]> } | undefined;

/**
 * Logged minutes, progress and health.
 *
 * Time spent on a task (idle excluded) =
 *     Σ tracker WORK segments on the task (exact seconds — the live source the desktop tracker shows)
 *   + Σ over the task's timesheet cells of (finalMinutes − trackedMinutes)
 *       → what the timesheet counts beyond tracker work: approved idle claims, accepted outside hours,
 *         manual adjustments (positive or negative)
 *   + openingLoggedMinutes (hours logged before tracking went live).
 * So a day the employee edited down to 0 stays 0, and claims waiting for review don't count yet.
 * ActivitySegment / TimesheetCell are spine models read directly via Prisma (read-only).
 * Recomputed nightly, on task changes and on read (throttled).
 */
@Injectable()
export class WorkMetricsService {
  private readonly log = new Logger('WorkMetrics');
  private readonly lastTenantRun = new Map<string, number>();
  private readonly lastProjectRun = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private delegate(name: string): Delegate {
    const d = (this.prisma as any)[name];
    return d && typeof d.findMany === 'function' ? d : undefined;
  }

  /**
   * Seconds spent per task (without openingLoggedMinutes), and per `${taskId}|${employeeId}|${date}`.
   * See the class comment for the formula.
   */
  async spentSecondsByTask(taskIds: string[]): Promise<{ byTask: Map<string, number>; byTaskEmpDay: Map<string, number> }> {
    const byTask = new Map<string, number>();
    const byTaskEmpDay = new Map<string, number>();
    if (!taskIds.length) return { byTask, byTaskEmpDay };
    const add = (taskId: string, employeeId: string, date: Date, sec: number) => {
      if (!sec) return;
      const k = `${taskId}|${employeeId}|${date.toISOString().slice(0, 10)}`;
      byTaskEmpDay.set(k, (byTaskEmpDay.get(k) ?? 0) + sec);
      byTask.set(taskId, (byTask.get(taskId) ?? 0) + sec);
    };
    try {
      const segD = this.delegate('activitySegment');
      if (segD) {
        const segs = await segD.findMany({ where: { taskId: { in: taskIds }, kind: 'WORK' }, select: { taskId: true, employeeId: true, workDate: true, durationSec: true } });
        for (const s of segs) add(s.taskId, s.employeeId, s.workDate as Date, s.durationSec ?? 0);
      }
    } catch (e) {
      this.log.debug(`tracker read skipped: ${(e as Error).message}`);
    }
    try {
      const lineD = this.delegate('timesheetLine');
      const cellD = this.delegate('timesheetCell');
      const sheetD = this.delegate('timesheet');
      if (lineD && cellD && sheetD) {
        const lines = await lineD.findMany({ where: { taskId: { in: taskIds } }, select: { id: true, taskId: true, timesheetId: true } });
        if (lines.length) {
          const sheets = await sheetD.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.timesheetId))] } }, select: { id: true, employeeId: true } });
          const empOf = new Map(sheets.map((s) => [s.id, s.employeeId as string]));
          const lineOf = new Map(lines.map((l) => [l.id, l]));
          const cells = await cellD.findMany({ where: { lineId: { in: lines.map((l) => l.id) } }, select: { lineId: true, date: true, finalMinutes: true, trackedMinutes: true } });
          for (const c of cells) {
            const l = lineOf.get(c.lineId);
            const emp = l ? empOf.get(l.timesheetId) : undefined;
            if (!l || !emp) continue;
            add(l.taskId, emp, c.date as Date, ((c.finalMinutes ?? 0) - (c.trackedMinutes ?? 0)) * 60);
          }
        }
      }
    } catch (e) {
      this.log.debug(`timesheet read skipped: ${(e as Error).message}`);
    }
    return { byTask, byTaskEmpDay };
  }

  /** Spent minutes per task (and per task+employee+date for interns), without openingLoggedMinutes. */
  async trackedByTask(taskIds: string[]): Promise<{ byTask: Map<string, number>; byTaskEmpDay: Map<string, number> }> {
    const s = await this.spentSecondsByTask(taskIds);
    const min = (m: Map<string, number>) => new Map([...m].map(([k, sec]) => [k, Math.max(0, Math.round(sec / 60))]));
    return { byTask: min(s.byTask), byTaskEmpDay: min(s.byTaskEmpDay) };
  }

  /** Minutes on project-level timesheet lines without a task (count towards the project only). */
  private async projectOnlyMinutes(projectId: string): Promise<number> {
    try {
      const lineD = this.delegate('timesheetLine');
      const cellD = this.delegate('timesheetCell');
      if (!lineD || !cellD) return 0;
      const lines = await lineD.findMany({ where: { projectId, taskId: null }, select: { id: true } });
      if (!lines.length) return 0;
      const cells = await cellD.findMany({ where: { lineId: { in: lines.map((l) => l.id) } }, select: { finalMinutes: true } });
      return cells.reduce((s, c) => s + (c.finalMinutes ?? 0), 0);
    } catch {
      return 0;
    }
  }

  /** Recompute task logged minutes, project logged/progress/health for one project. */
  async recomputeProject(projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId } });
    if (!project) return;
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      select: { id: true, key: true, title: true, departmentId: true, assigneeEmployeeId: true, status: true, estimatedMinutes: true, isStanding: true, loggedMinutes: true, openingLoggedMinutes: true },
    });
    const { byTask } = await this.trackedByTask(tasks.map((t) => t.id));
    let logged = project.openingLoggedMinutes + (await this.projectOnlyMinutes(projectId));
    for (const t of tasks) {
      const m = t.openingLoggedMinutes + (byTask.get(t.id) ?? 0);
      logged += m;
      if (m !== t.loggedMinutes) await this.prisma.task.update({ where: { id: t.id }, data: { loggedMinutes: m } });
      if (!t.isStanding && t.status !== 'DONE' && t.status !== 'CANCELLED' && crossedEstimate(t.loggedMinutes, m, t.estimatedMinutes)) {
        await this.notifyOverEstimate(project, t, m).catch((e) => this.log.warn(`over-estimate notice ${t.key}: ${(e as Error).message}`));
      }
    }
    const progressPct = project.isSystem ? 0 : computeProgress(tasks.map((t) => ({ status: t.status as TaskStatus, estimatedMinutes: t.estimatedMinutes, isStanding: t.isStanding })), project.estimatedMinutes);
    const { health, reason } = project.isSystem
      ? { health: 'NA' as const, reason: null }
      : computeHealth({ status: project.status as ProjectStatus, estimatedMinutes: project.estimatedMinutes, loggedMinutes: logged, progressPct, startDate: project.startDate, deadline: project.deadline }, todayDate());
    await this.prisma.project.update({ where: { id: projectId }, data: { loggedMinutes: logged, progressPct, health, healthReason: reason, healthComputedAt: new Date() } });
    if (health !== project.health && (health === 'AT_RISK' || health === 'OFF_TRACK')) {
      const managers = await this.notifications.usersWithPermission('tasks.viewAllBoards');
      const lead = await this.notifications.usersForEmployees([project.leadEmployeeId]);
      await this.notifications.notify({
        userIds: [...lead, ...managers].slice(0, 25),
        type: 'project.health',
        title: `${project.name} is ${health === 'AT_RISK' ? 'at risk' : 'off track'}`,
        body: reason ?? undefined,
        link: `/projects/${project.id}`,
        from: 'Projects',
        email: true,
      });
    }
    this.lastProjectRun.set(projectId, Date.now());
  }

  /** Logged time reached the estimate: tell the assignee and the project lead (once per crossing). */
  private async notifyOverEstimate(
    project: { id: string; leadEmployeeId: string | null },
    t: { id: string; key: string; title: string; departmentId: string | null; assigneeEmployeeId: string | null; estimatedMinutes: number | null },
    loggedMinutes: number,
  ) {
    const hours = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
    const userIds = await this.notifications.usersForEmployees([...new Set([t.assigneeEmployeeId, project.leadEmployeeId])]);
    if (!userIds.length) return;
    await this.notifications.notify({
      userIds,
      type: 'task.overEstimate',
      title: `${t.key} reached its estimate: ${hours(loggedMinutes)} of ${hours(t.estimatedMinutes ?? 0)}`,
      body: `${t.title} · re-estimate or wrap it up`,
      link: `/board?project=${project.id}&board=${t.departmentId ?? ''}&task=${t.id}`,
      from: 'Projects',
    });
  }

  async recomputeProjectIfStale(projectId: string, maxAgeMs = 60_000) {
    if (Date.now() - (this.lastProjectRun.get(projectId) ?? 0) < maxAgeMs) return;
    await this.recomputeProject(projectId);
  }

  /** All live projects of the current tenant. */
  async recomputeTenant(): Promise<void> {
    const projects = await this.prisma.project.findMany({ where: { status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED'] } }, select: { id: true } });
    for (const p of projects) await this.recomputeProject(p.id);
    this.lastTenantRun.set(currentTenantId(), Date.now());
  }

  /** Throttled recompute on read (project list / KPIs). */
  async recomputeTenantIfStale(maxAgeMs = 5 * 60_000): Promise<void> {
    const t = currentTenantId();
    if (Date.now() - (this.lastTenantRun.get(t) ?? 0) < maxAgeMs) return;
    this.lastTenantRun.set(t, Date.now());
    try {
      await this.recomputeTenant();
    } catch (e) {
      this.log.warn(`recompute failed: ${(e as Error).message}`);
    }
  }

  /** Nightly 02:00 IST: logged minutes, progress and health for every tenant. */
  @Cron('0 2 * * *', { timeZone: 'Asia/Kolkata' })
  async nightly() {
    const tenants = await this.prisma.raw.tenant.findMany({ select: { id: true } });
    for (const t of tenants) {
      await runAsTenant(t.id, () => this.recomputeTenant()).catch((e) => this.log.error(`nightly ${t.id}: ${(e as Error).message}`));
    }
  }

  /**
   * Billable minutes per project for a month. Source preference: approved/submitted timesheet cells on
   * billable lines → tracker segments → task logged minutes of tasks active that month.
   */
  async billableMinutes(projectIds: string[], start: Date, end: Date): Promise<{ byProject: Map<string, number>; source: 'timesheets' | 'tracker' | 'tasks' }> {
    const byProject = new Map<string, number>();
    if (!projectIds.length) return { byProject, source: 'timesheets' };
    try {
      const lineD = this.delegate('timesheetLine');
      const cellD = this.delegate('timesheetCell');
      if (lineD && cellD) {
        const anyCells = await cellD.findMany({ where: { date: { gte: start, lt: end } }, select: { lineId: true }, take: 1 });
        if (anyCells.length) {
          const lines = await lineD.findMany({ where: { projectId: { in: projectIds }, billable: true }, select: { id: true, projectId: true } });
          const pOf = new Map(lines.map((l) => [l.id, l.projectId as string]));
          const cells = lines.length ? await cellD.findMany({ where: { lineId: { in: lines.map((l) => l.id) }, date: { gte: start, lt: end } }, select: { lineId: true, finalMinutes: true } }) : [];
          for (const c of cells) {
            const pid = pOf.get(c.lineId);
            if (pid) byProject.set(pid, (byProject.get(pid) ?? 0) + (c.finalMinutes ?? 0));
          }
          return { byProject, source: 'timesheets' };
        }
      }
    } catch (e) {
      this.log.debug(`billable timesheet read skipped: ${(e as Error).message}`);
    }
    try {
      const segD = this.delegate('activitySegment');
      if (segD) {
        const segs = await segD.findMany({ where: { projectId: { in: projectIds }, workDate: { gte: start, lt: end }, kind: { in: ['WORK', 'IDLE_WORK'] } }, select: { projectId: true, durationSec: true } });
        if (segs.length) {
          for (const s of segs) byProject.set(s.projectId, (byProject.get(s.projectId) ?? 0) + Math.round((s.durationSec ?? 0) / 60));
          return { byProject, source: 'tracker' };
        }
      }
    } catch (e) {
      this.log.debug(`billable tracker read skipped: ${(e as Error).message}`);
    }
    const tasks = await this.prisma.task.findMany({
      where: { projectId: { in: projectIds }, isStanding: false, OR: [{ doneAt: { gte: start, lt: end } }, { status: { in: ['WIP', 'DEV_COMPLETED', 'QA'] } }] },
      select: { projectId: true, loggedMinutes: true },
    });
    for (const t of tasks) byProject.set(t.projectId, (byProject.get(t.projectId) ?? 0) + t.loggedMinutes);
    return { byProject, source: 'tasks' };
  }
}
