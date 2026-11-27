import { Injectable } from '@nestjs/common';
import type { Prisma, RightToWorkCheck } from '@prisma/client';
import {
  RTW_METHOD_LABELS,
  RTW_RESULT_LABELS,
  RTW_STATUS_LABELS,
  formatShareCode,
  normaliseShareCode,
  zonedDateKey,
  type RtwCheckData,
  type RtwCheckDto,
  type RtwHistory,
  type RtwList,
  type RtwMethod,
  type RtwPersonRow,
  type RtwResult,
} from '@lexisora/shared';
import { hasPerm } from '../../../core/auth/decorators';
import { AuditService } from '../../../core/audit/audit.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, forbidden, notFound } from '../../../core/http/errors';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { currentRegion } from '../../../core/region/region-cache';
import { dbDateKey, toDbDate } from '../people.util';
import { missingCheckBeforeStart, rtwReminder, rtwStatus, rtwWarnings, validateRtwCheck } from './rtw.rules';

const ACTIVE_STATUSES = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD'] as const;

/**
 * UK right to work checks (region GB only). One current check per person; recording a new
 * one supersedes the previous (history is kept as evidence for the Home Office).
 */
@Injectable()
export class RtwService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** 403 unless the tenant runs UK payroll/people rules. */
  assertUk() {
    if (currentRegion() !== 'GB') throw new AppError(403, 'REGION_NOT_SUPPORTED', 'Right to work checks are only for companies set up in the United Kingdom.');
  }

  private today() {
    return zonedDateKey(new Date());
  }

  private canManage() {
    return hasPerm(requireContext(), 'rtw.manage');
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private toDto(c: RightToWorkCheck, joiningDate: string | null, names: Map<string, string>): RtwCheckDto {
    const checkedOn = dbDateKey(c.checkedOn)!;
    const method = c.method as RtwMethod;
    const result = c.result as RtwResult;
    return {
      id: c.id,
      employeeId: c.employeeId,
      method,
      methodLabel: RTW_METHOD_LABELS[method] ?? c.method,
      documentType: c.documentType,
      shareCode: c.shareCode ? formatShareCode(c.shareCode) : null,
      result,
      resultLabel: RTW_RESULT_LABELS[result] ?? c.result,
      permissionExpiresOn: dbDateKey(c.permissionExpiresOn),
      followUpOn: dbDateKey(c.followUpOn),
      checkedOn,
      checkedBy: c.checkedById ? (names.get(c.checkedById) ?? null) : null,
      evidenceFileId: c.evidenceFileId,
      sponsored: c.sponsored,
      notes: c.notes,
      supersededAt: c.supersededAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      warnings: c.supersededAt ? [] : rtwWarnings({ method, documentType: c.documentType, shareCode: c.shareCode, result, checkedOn }, joiningDate),
    };
  }

  private statusOf(c: RightToWorkCheck | null, today: string) {
    return rtwStatus(c ? { result: c.result as RtwResult, permissionExpiresOn: dbDateKey(c.permissionExpiresOn), followUpOn: dbDateKey(c.followUpOn) } : null, today);
  }

  /** Everyone currently employed or joining, with their current check, status and KPI counts. */
  async list(): Promise<RtwList> {
    this.assertUk();
    const today = this.today();
    const emps = await this.prisma.employee.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] } },
      select: { id: true, fullName: true, empCode: true, status: true, joiningDate: true },
      orderBy: { fullName: 'asc' },
    });
    const checks = await this.prisma.rightToWorkCheck.findMany({ where: { employeeId: { in: emps.map((e) => e.id) }, supersededAt: null }, orderBy: { createdAt: 'desc' } });
    const byEmp = new Map<string, RightToWorkCheck>();
    for (const c of checks) if (!byEmp.has(c.employeeId)) byEmp.set(c.employeeId, c);
    const names = await this.userNames(checks.map((c) => c.checkedById));
    const items: RtwPersonRow[] = emps.map((e) => {
      const c = byEmp.get(e.id) ?? null;
      const joining = dbDateKey(e.joiningDate);
      const s = this.statusOf(c, today);
      return {
        employeeId: e.id,
        name: e.fullName,
        empCode: e.empCode,
        employeeStatus: e.status,
        joiningDate: joining,
        check: c ? this.toDto(c, joining, names) : null,
        status: s.status,
        statusLabel: RTW_STATUS_LABELS[s.status],
        daysToFollowUp: s.daysToFollowUp,
      };
    });
    const n = (st: string) => items.filter((i) => i.status === st).length;
    return {
      items,
      counts: {
        total: items.length,
        checked: n('CURRENT') + n('FOLLOW_UP_DUE'),
        followUpDue: n('FOLLOW_UP_DUE'),
        missing: n('MISSING'),
        expired: n('EXPIRED'),
        noRight: n('NO_RIGHT'),
        sponsored: items.filter((i) => i.check?.sponsored).length,
      },
    };
  }

  /** All checks for one person, newest first. HR, or the employee themself. */
  async history(employeeId: string): Promise<RtwHistory> {
    this.assertUk();
    const ctx = requireContext();
    const id = employeeId === 'me' ? ctx.employeeId : employeeId;
    if (!id) throw notFound('Employee');
    if (!this.canManage() && ctx.employeeId !== id) throw forbidden('Only HR can see right to work checks of other people');
    const e = await this.prisma.employee.findUnique({ where: { id }, select: { id: true, fullName: true, empCode: true, joiningDate: true } });
    if (!e) throw notFound('Employee');
    const checks = await this.prisma.rightToWorkCheck.findMany({ where: { employeeId: id }, orderBy: [{ checkedOn: 'desc' }, { createdAt: 'desc' }] });
    const names = await this.userNames(checks.map((c) => c.checkedById));
    const joining = dbDateKey(e.joiningDate);
    const current = checks.find((c) => !c.supersededAt) ?? null;
    const s = this.statusOf(current, this.today());
    return {
      employeeId: e.id,
      name: e.fullName,
      empCode: e.empCode,
      joiningDate: joining,
      status: s.status,
      statusLabel: RTW_STATUS_LABELS[s.status],
      checks: checks.map((c) => this.toDto(c, joining, names)),
    };
  }

  /** Record a check; the previous current check is superseded. */
  async create(i: RtwCheckData): Promise<RtwHistory> {
    this.assertUk();
    const ctx = requireContext();
    const e = await this.prisma.employee.findUnique({ where: { id: i.employeeId }, select: { id: true, fullName: true, status: true } });
    if (!e) throw notFound('Employee');
    if (e.status === 'EXITED') throw badRequest(`${e.fullName} has left; record checks only for current staff and joiners`, 'EMPLOYEE_EXITED');
    const shareCode = i.shareCode ? normaliseShareCode(i.shareCode) : null;
    const err = validateRtwCheck({ ...i, shareCode }, this.today());
    if (err) throw new AppError(422, 'RTW_INVALID', err);
    if (i.evidenceFileId) {
      const f = await this.prisma.fileObject.findUnique({ where: { id: i.evidenceFileId }, select: { id: true, mime: true } });
      if (!f) throw badRequest('Upload the evidence file first', 'FILE_MISSING');
      if (!/^(application\/pdf|image\/(png|jpe?g|webp))$/.test(f.mime)) throw new AppError(422, 'FILE_TYPE', 'Evidence must be a PDF, JPG or PNG');
    }
    const followUp = i.result === 'NO_RIGHT' ? null : (i.followUpOn ?? (i.result === 'TIME_LIMITED' ? i.permissionExpiresOn : null) ?? null);
    const now = new Date();
    await this.prisma.rightToWorkCheck.updateMany({ where: { employeeId: e.id, supersededAt: null }, data: { supersededAt: now } });
    const row = await this.prisma.rightToWorkCheck.create({
      data: {
        employeeId: e.id,
        method: i.method,
        documentType: i.documentType,
        shareCode: i.method === 'SHARE_CODE' || shareCode ? shareCode : null,
        result: i.result,
        permissionExpiresOn: i.result === 'TIME_LIMITED' && i.permissionExpiresOn ? toDbDate(i.permissionExpiresOn) : null,
        followUpOn: followUp ? toDbDate(followUp) : null,
        checkedOn: toDbDate(i.checkedOn),
        checkedById: ctx.userId ?? null,
        evidenceFileId: i.evidenceFileId || null,
        sponsored: i.sponsored ?? false,
        notes: i.notes || null,
      } as Prisma.RightToWorkCheckUncheckedCreateInput,
    });
    await this.audit.record({ action: 'rtw.checked', entity: 'Employee', entityId: e.id, meta: { checkId: row.id, method: i.method, result: i.result, permissionExpiresOn: i.permissionExpiresOn ?? null } });
    return this.history(e.id);
  }

  /** HR users to alert (rtw.manage; falls back to employees.manage while roles are being updated). */
  private async hrUsers(): Promise<string[]> {
    const ids = await this.notify.usersWithPermission('rtw.manage');
    return ids.length ? ids : this.notify.usersWithPermission('employees.manage');
  }

  /**
   * Daily job (UK tenants): re-check reminders 60/30/7 days ahead, the day after a permission
   * ends, and joiners starting within 3 days with no check. Returns the alerts sent.
   */
  async remind(today = this.today()): Promise<number> {
    if (currentRegion() !== 'GB') return 0;
    const emps = await this.prisma.employee.findMany({ where: { status: { in: [...ACTIVE_STATUSES] } }, select: { id: true, fullName: true, empCode: true, status: true, joiningDate: true } });
    if (!emps.length) return 0;
    const checks = await this.prisma.rightToWorkCheck.findMany({ where: { employeeId: { in: emps.map((e) => e.id) }, supersededAt: null } });
    const byEmp = new Map(checks.map((c) => [c.employeeId, c]));
    const alerts: { title: string; body: string; link: string }[] = [];
    for (const e of emps) {
      const c = byEmp.get(e.id);
      if (!c) {
        if (e.status === 'ONBOARDING' && missingCheckBeforeStart(dbDateKey(e.joiningDate), today, false)) {
          alerts.push({
            title: `Right to work check needed · ${e.fullName} starts ${dbDateKey(e.joiningDate)}`,
            body: `${e.empCode} has no right to work check. Do it on or before the first day of work.`,
            link: `/right-to-work?employee=${e.id}`,
          });
        }
        continue;
      }
      const r = rtwReminder({ result: c.result as RtwResult, permissionExpiresOn: dbDateKey(c.permissionExpiresOn), followUpOn: dbDateKey(c.followUpOn) }, today);
      if (!r) continue;
      alerts.push(
        r.kind === 'EXPIRED'
          ? { title: `Right to work permission ended · ${e.fullName}`, body: `${e.empCode}: permission ended on ${dbDateKey(c.permissionExpiresOn)}. Do a follow-up check now; without one you lose your statutory excuse.`, link: `/right-to-work?employee=${e.id}` }
          : { title: `Right to work re-check in ${r.days} days · ${e.fullName}`, body: `${e.empCode}: follow-up check due on ${dbDateKey(c.followUpOn ?? c.permissionExpiresOn)}.`, link: `/right-to-work?employee=${e.id}` },
      );
    }
    if (!alerts.length) return 0;
    const users = await this.hrUsers();
    for (const a of alerts) await this.notify.notify({ userIds: users, type: 'people.rtwReminder', title: a.title, body: a.body, link: a.link, from: 'System', email: true });
    return alerts.length;
  }

  /** May the current user open this evidence file? (HR, or the employee it belongs to.) */
  async canViewEvidence(fileId: string, employeeId: string | null | undefined): Promise<boolean> {
    if (currentRegion() !== 'GB') return false;
    const c = await this.prisma.rightToWorkCheck.findFirst({ where: { evidenceFileId: fileId }, select: { employeeId: true } });
    if (!c) return false;
    return this.canManage() || (!!employeeId && c.employeeId === employeeId);
  }
}
