import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { dateOf, keyOf } from './lib/time-utils';

/**
 * Read-only access to spine models owned by other domains (ARCHITECTURE §4/§5: direct Prisma
 * reads are allowed, writes are not). Accessed dynamically so the time module keeps working
 * (and type-checks) whether or not those domains' schemas are present; every read degrades
 * to an empty result instead of failing.
 */

export type SegmentRow = { id: string; clientId?: string; employeeId: string; workDate: Date; kind: 'WORK' | 'BREAK' | 'IDLE' | 'IDLE_WORK' | string; taskId: string | null; projectId: string | null; startAt: Date; endAt: Date; durationSec: number; idleResolution: string | null };
export type DaySummaryRow = { employeeId: string; workDate: Date; workedSec: number; breakSec: number; idleSec: number; idleDeductedSec: number; screenshotCount: number };
export type IdleClaimRow = { id: string; employeeId: string; workDate: Date; startAt: Date; endAt: Date; minutes: number; taskId: string | null; note: string | null; status: string };
export type ScreenshotRow = { id: string; employeeId: string; capturedAt: Date; workDate: Date; taskId: string | null; fileId: string | null; thumbFileId: string | null; blurred: boolean };
export type ProjectRow = { id: string; key: string; name: string; isInternal: boolean; leadEmployeeId: string | null; billable: boolean; status?: string };
export type TaskRow = { id: string; key: string; title: string; projectId: string; moduleName: string | null; assigneeEmployeeId: string | null; isStanding: boolean; status?: string };
export type LeaveDayRow = { employeeId: string; date: string; units: number; isPaid: boolean; typeCode: string | null };

@Injectable()
export class CrossReader {
  private readonly log = new Logger('TimeCross');
  constructor(private readonly prisma: PrismaService) {}

  private model(name: string): any {
    return (this.prisma as any)[name];
  }

  private async safe<T>(name: string, fn: (m: any) => Promise<T>, fallback: T): Promise<T> {
    const m = this.model(name);
    if (!m) return fallback;
    try {
      return await fn(m);
    } catch (e) {
      this.log.debug(`${name} read failed: ${(e as Error).message}`);
      return fallback;
    }
  }

  // ── tracker ──
  segments(employeeIds: string | string[], from: string, to: string): Promise<SegmentRow[]> {
    const ids = Array.isArray(employeeIds) ? employeeIds : [employeeIds];
    return this.safe('activitySegment', (m) => m.findMany({ where: { employeeId: { in: ids }, workDate: { gte: dateOf(from), lte: dateOf(to) } }, orderBy: { startAt: 'asc' } }), []);
  }

  daySummaries(employeeIds: string[], from: string, to: string): Promise<DaySummaryRow[]> {
    return this.safe('trackerDaySummary', (m) => m.findMany({ where: { employeeId: { in: employeeIds }, workDate: { gte: dateOf(from), lte: dateOf(to) } } }), []);
  }

  async daySummary(employeeId: string, date: string): Promise<DaySummaryRow | null> {
    return (await this.daySummaries([employeeId], date, date))[0] ?? null;
  }

  idleClaims(employeeId: string, from: string, to: string): Promise<IdleClaimRow[]> {
    return this.safe('idleClaim', (m) => m.findMany({ where: { employeeId, workDate: { gte: dateOf(from), lte: dateOf(to) } }, orderBy: { startAt: 'asc' } }), []);
  }

  screenshots(employeeId: string, from: string, to: string, opts: { taskIds?: string[]; date?: string; skip?: number; take?: number } = {}): Promise<ScreenshotRow[]> {
    const where: any = { employeeId, workDate: opts.date ? dateOf(opts.date) : { gte: dateOf(from), lte: dateOf(to) } };
    if (opts.taskIds) where.taskId = { in: opts.taskIds };
    return this.safe('screenshot', (m) => m.findMany({ where, orderBy: { capturedAt: 'asc' }, skip: opts.skip, take: opts.take }), []);
  }

  screenshotCount(employeeId: string, from: string, to: string, opts: { taskIds?: string[]; date?: string } = {}): Promise<number> {
    const where: any = { employeeId, workDate: opts.date ? dateOf(opts.date) : { gte: dateOf(from), lte: dateOf(to) } };
    if (opts.taskIds) where.taskId = { in: opts.taskIds };
    return this.safe('screenshot', (m) => m.count({ where }), 0);
  }

  screenshotByFile(fileId: string): Promise<ScreenshotRow | null> {
    return this.safe('screenshot', (m) => m.findFirst({ where: { OR: [{ fileId }, { thumbFileId: fileId }] } }), null);
  }

  activeTrackerDevices(employeeIds?: string[]): Promise<number> {
    return this.safe('trackerDevice', (m) => m.count({ where: { status: 'ACTIVE', ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) } }), 0);
  }

  // ── work ──
  projects(ids?: string[]): Promise<ProjectRow[]> {
    return this.safe('project', (m) => m.findMany({ where: ids ? { id: { in: ids } } : {}, orderBy: { name: 'asc' } }), []);
  }

  async projectMap(ids: string[]): Promise<Map<string, ProjectRow>> {
    const rows = ids.length ? await this.projects([...new Set(ids)]) : [];
    return new Map(rows.map((p) => [p.id, p]));
  }

  tasks(ids: string[]): Promise<TaskRow[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.safe('task', (m) => m.findMany({ where: { id: { in: [...new Set(ids)] } } }), []);
  }

  async taskMap(ids: string[]): Promise<Map<string, TaskRow>> {
    return new Map((await this.tasks(ids)).map((t) => [t.id, t]));
  }

  /** Project ids the employee belongs to (ProjectMember) plus projects they lead. */
  async memberProjectIds(employeeId: string): Promise<string[]> {
    const members = await this.safe<{ projectId: string }[]>('projectMember', (m) => m.findMany({ where: { employeeId }, select: { projectId: true } }), []);
    const led = await this.safe<{ id: string }[]>('project', (m) => m.findMany({ where: { leadEmployeeId: employeeId }, select: { id: true } }), []);
    const internal = await this.safe<{ id: string }[]>('project', (m) => m.findMany({ where: { isInternal: true }, select: { id: true } }), []);
    return [...new Set([...members.map((x) => x.projectId), ...led.map((x) => x.id), ...internal.map((x) => x.id)])];
  }

  /** Tasks the employee can log time against: assigned to them, or standing tasks (INT meetings…). */
  async assignableTasks(employeeId: string): Promise<TaskRow[]> {
    const projectIds = await this.memberProjectIds(employeeId);
    return this.safe(
      'task',
      (m) =>
        m.findMany({
          where: { OR: [{ assigneeEmployeeId: employeeId }, { isStanding: true }, ...(projectIds.length ? [{ projectId: { in: projectIds }, status: { notIn: ['DONE', 'CANCELLED'] } }] : [])] },
          orderBy: { key: 'asc' },
          take: 300,
        }),
      [],
    );
  }

  /** Employees on projects the lead leads (lead's project scope). */
  async projectTeam(leadEmployeeId: string): Promise<string[]> {
    const led = await this.safe<{ id: string }[]>('project', (m) => m.findMany({ where: { leadEmployeeId }, select: { id: true } }), []);
    if (!led.length) return [];
    const members = await this.safe<{ employeeId: string }[]>('projectMember', (m) => m.findMany({ where: { projectId: { in: led.map((p) => p.id) } }, select: { employeeId: true } }), []);
    return [...new Set(members.map((x) => x.employeeId))];
  }

  // ── leavepay ──
  async leaveDays(employeeIds: string[], from: string, to: string): Promise<LeaveDayRow[]> {
    const rows = await this.safe<any[]>(
      'leaveRequestDay',
      (m) => m.findMany({ where: { employeeId: { in: employeeIds }, active: true, date: { gte: dateOf(from), lte: dateOf(to) } } }),
      [],
    );
    if (!rows.length) return [];
    const reqs = await this.safe<any[]>('leaveRequest', (m) => m.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requestId))] } }, select: { id: true, leaveTypeId: true, status: true } }), []);
    const types = await this.safe<any[]>('leaveType', (m) => m.findMany({ where: { id: { in: [...new Set(reqs.map((r) => r.leaveTypeId))] } }, select: { id: true, code: true } }), []);
    const reqMap = new Map(reqs.map((r) => [r.id, r]));
    const typeMap = new Map(types.map((t) => [t.id, t.code as string]));
    return rows
      .filter((r) => {
        const req = reqMap.get(r.requestId);
        return !req || req.status === 'APPROVED' || req.status === 'CANCELLATION_PENDING';
      })
      .map((r) => ({ employeeId: r.employeeId, date: keyOf(r.date), units: Number(r.units), isPaid: !!r.isPaid, typeCode: typeMap.get(reqMap.get(r.requestId)?.leaveTypeId) ?? null }));
  }

  leaveRequest(id: string): Promise<{ id: string; employeeId: string; fromDate: Date; toDate: Date; status: string } | null> {
    return this.safe('leaveRequest', (m) => m.findFirst({ where: { id } }), null);
  }

  // ── people ──
  /** Resolve a scanned badge: IdCard.verifyToken (people domain), "DEV:<employeeId>", or an employee code. */
  async employeeIdFromBadge(token: string): Promise<string | null> {
    const t = token.trim();
    if (t.startsWith('DEV:')) return t.slice(4);
    const url = /\/(?:vcard|id-cards?|idcards?|verify)\/(?:scan\/)?([\w-]+)/.exec(t);
    const raw = url?.[1] ?? t;
    const card = await this.safe<any>('idCard', (m) => m.findFirst({ where: { verifyToken: raw } }), null);
    if (card?.employeeId) return card.employeeId as string;
    const byCode = await this.prisma.employee.findFirst({ where: { empCode: raw }, select: { id: true } });
    return byCode?.id ?? null;
  }
}
