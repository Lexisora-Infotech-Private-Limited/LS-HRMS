import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  EMPLOYEE_CSV_HEADERS,
  type CreateEmployeeInput,
  type EmployeeCounts,
  type EmployeeListQuery,
  type EmployeeRow,
  type ExitCaseDto,
  type ImportPreview,
  type StartExitInput,
  type UpdateEmployeeInput,
  type UpdateSelfInput,
} from '@lexisora/shared';
import { env } from '../../../config/env';
import { AuditService } from '../../../core/audit/audit.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, conflict, notFound } from '../../../core/http/errors';
import { pageArgs, paginated } from '../../../core/http/paginate';
import { MailService } from '../../../core/mail/mail.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { EventsService } from '../../../core/registry/events.service';
import { SequenceService } from '../../../core/registry/sequence.service';
import { isHr, PeopleAccess } from '../people.access';
import {
  computeLwd,
  csvEscape,
  defaultNoticeDays,
  empCodeSeries,
  employeeStatusLabel,
  EXIT_CHECKLIST,
  exitBlockers,
  formatEmpCode,
  maxCodeNumber,
  orderByManager,
  validateCsvRows,
  type EmpType,
  type NormalisedImportRow,
} from '../people.rules';
import { dbDateKey, fmt, splitName, toDbDate, todayKey, token } from '../people.util';
import { OnboardingService } from '../onboarding/onboarding.service';
import { IdCardsService } from '../idcards/idcards.service';
import { KitsService } from '../kits/kits.service';
import { VcardService } from '../vcard/vcard.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parse: parseCsv } = require('csv-parse/sync') as { parse: (input: Buffer | string, opts: Record<string, unknown>) => Record<string, string>[] };

const ACTIVE_STATUSES = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD'] as const;

type CreateOpts = { sourceApplicationId?: string; resumeFileId?: string | null; silent?: boolean };

@Injectable()
export class EmployeesService {
  private readonly log = new Logger('People');

  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SequenceService,
    private readonly mail: MailService,
    private readonly notify: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly access: PeopleAccess,
    private readonly onboarding: OnboardingService,
    private readonly idcards: IdCardsService,
    private readonly kits: KitsService,
    private readonly vcard: VcardService,
  ) {}

  // ── Directory ────────────────────────────────────────────────────────────

  private tabWhere(tab: EmployeeListQuery['tab']): Prisma.EmployeeWhereInput {
    switch (tab) {
      case 'full_time':
        return { employmentType: { not: 'INTERN' }, status: { not: 'EXITED' } };
      case 'interns':
        return { employmentType: 'INTERN', status: { not: 'EXITED' } };
      case 'notice':
        return { status: 'NOTICE_PERIOD' };
      case 'exited':
        return { status: 'EXITED' };
      default:
        return { status: { in: [...ACTIVE_STATUSES] } };
    }
  }

  private async scopeWhere(q?: Partial<EmployeeListQuery>): Promise<Prisma.EmployeeWhereInput> {
    const scope = await this.access.listScope();
    const where: Prisma.EmployeeWhereInput = {};
    if (scope) where.id = { in: scope };
    if (q?.q) {
      where.OR = [
        { fullName: { contains: q.q, mode: 'insensitive' } },
        { empCode: { contains: q.q, mode: 'insensitive' } },
        { officialEmail: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    if (q?.departmentId) where.departmentId = q.departmentId;
    if (q?.workMode) where.workMode = q.workMode;
    if (q?.managerId) where.managerId = q.managerId;
    return where;
  }

  async list(q: EmployeeListQuery) {
    const base = await this.scopeWhere(q);
    const where = { AND: [base, this.tabWhere(q.tab)] };
    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: { department: true, designation: true, manager: { select: { fullName: true } } },
        orderBy: [{ fullName: 'asc' }],
        ...pageArgs(q),
      }),
      this.prisma.employee.count({ where }),
    ]);
    const items: EmployeeRow[] = rows.map((e) => ({
      id: e.id,
      fullName: e.fullName,
      empCode: e.empCode,
      photoFileId: e.photoFileId,
      department: e.department?.name ?? null,
      designation: e.designation?.name ?? null,
      workMode: e.workMode,
      manager: e.manager?.fullName ?? null,
      employmentType: e.employmentType,
      status: e.status,
      statusLabel: employeeStatusLabel(e.status, e.employmentType),
      officialEmail: e.officialEmail,
    }));
    return { ...paginated(items, total, q), counts: await this.counts(q) };
  }

  async counts(q?: Partial<EmployeeListQuery>): Promise<EmployeeCounts> {
    const base = await this.scopeWhere({ ...q, q: q?.q });
    const tabs = ['all', 'full_time', 'interns', 'notice', 'exited'] as const;
    const vals = await Promise.all(tabs.map((t) => this.prisma.employee.count({ where: { AND: [base, this.tabWhere(t)] } })));
    return Object.fromEntries(tabs.map((t, i) => [t, vals[i]!])) as EmployeeCounts;
  }

  exportCsv = async (q: EmployeeListQuery): Promise<string> => {
    const base = await this.scopeWhere(q);
    const rows = await this.prisma.employee.findMany({
      where: { AND: [base, this.tabWhere(q.tab)] },
      include: { department: true, designation: true, manager: { select: { fullName: true } } },
      orderBy: { fullName: 'asc' },
    });
    const head = ['Name', 'Emp ID', 'Official email', 'Department', 'Designation', 'Work mode', 'Manager', 'Status', 'Joining date'];
    const lines = rows.map((e) =>
      [e.fullName, e.empCode, e.officialEmail, e.department?.name, e.designation?.name, e.workMode, e.manager?.fullName, employeeStatusLabel(e.status, e.employmentType), dbDateKey(e.joiningDate)].map(csvEscape).join(','),
    );
    return [head.join(','), ...lines].join('\n');
  };

  // ── Create (Add employee / import / hire) ─────────────────────────────────

  private async nextEmpCode(type: EmpType): Promise<string> {
    const s = empCodeSeries(type);
    const existing = await this.prisma.employee.findMany({ where: { empCode: { startsWith: s.prefix } }, select: { empCode: true } });
    const start = maxCodeNumber(existing.map((e) => e.empCode), type) + 1;
    for (let i = 0; i < 5; i++) {
      const n = await this.seq.nextValue(s.key, { start });
      const code = formatEmpCode(type, n);
      if (!(await this.prisma.employee.findFirst({ where: { empCode: code }, select: { id: true } }))) return code;
    }
    throw new AppError(409, 'EMP_CODE_EXHAUSTED', 'Could not allocate an employee code; try again');
  }

  private async assertManager(managerId: string | null | undefined, selfId?: string) {
    if (!managerId) return;
    if (managerId === selfId) throw badRequest('An employee cannot report to themselves', 'MANAGER_INVALID');
    const m = await this.prisma.employee.findUnique({ where: { id: managerId }, select: { id: true, status: true, managerId: true } });
    if (!m || m.status === 'EXITED') throw badRequest('Pick an active reporting manager', 'MANAGER_INVALID');
    if (selfId) {
      // No cycles: the new manager must not be in the employee's own subtree.
      let cur: string | null = m.managerId;
      for (let i = 0; cur && i < 20; i++) {
        if (cur === selfId) throw badRequest('That reporting line would create a cycle', 'MANAGER_CYCLE');
        cur = (await this.prisma.employee.findUnique({ where: { id: cur }, select: { managerId: true } }))?.managerId ?? null;
      }
    }
  }

  async create(input: CreateEmployeeInput, opts: CreateOpts = {}) {
    const ctx = requireContext();
    const email = input.officialEmail.toLowerCase();
    if (await this.prisma.employee.findFirst({ where: { officialEmail: email }, select: { id: true } })) {
      throw conflict(`${email} already belongs to an employee`, 'EMAIL_TAKEN');
    }
    if (await this.prisma.user.findFirst({ where: { email }, select: { id: true } })) throw conflict(`${email} already has a login`, 'EMAIL_TAKEN');
    const [dept, desig] = await Promise.all([
      this.prisma.department.findUnique({ where: { id: input.departmentId } }),
      this.prisma.designation.findUnique({ where: { id: input.designationId } }),
    ]);
    if (!dept) throw badRequest('Pick a department', 'DEPARTMENT_INVALID');
    if (!desig) throw badRequest('Pick a designation', 'DESIGNATION_INVALID');
    await this.assertManager(input.managerId);
    if (input.joiningDate < '2000-01-01') throw badRequest('Joining date looks wrong');

    let empCode: string;
    if (input.empCodeOverride) {
      if (await this.prisma.employee.findFirst({ where: { empCode: input.empCodeOverride } })) throw conflict(`Emp ID ${input.empCodeOverride} is taken`, 'EMP_CODE_TAKEN');
      empCode = input.empCodeOverride;
    } else empCode = await this.nextEmpCode(input.employmentType);

    const role = await this.prisma.role.findFirst({ where: { key: 'employee' } });
    if (!role) throw new AppError(500, 'ROLE_MISSING', 'The Employee role is missing for this workspace');
    const { firstName, lastName } = splitName(input.fullName);
    const inviteToken = token(32);
    const branchId = input.branchId ?? (await this.prisma.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? null;

    const { user, employee } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: input.fullName,
          roleId: role.id,
          status: 'INVITED',
          inviteToken,
          inviteExpiresAt: new Date(Date.now() + 7 * 86400_000),
        } as Prisma.UserUncheckedCreateInput,
      });
      const employee = await tx.employee.create({
        data: {
          userId: user.id,
          empCode,
          firstName,
          lastName,
          fullName: input.fullName.trim(),
          officialEmail: email,
          personalEmail: input.personalEmail ?? null,
          phone: input.phone,
          departmentId: dept.id,
          designationId: desig.id,
          branchId,
          managerId: input.managerId ?? null,
          employmentType: input.employmentType,
          workMode: input.workMode,
          shiftId: input.shiftId ?? null,
          workLocationId: input.workLocationId ?? null,
          photoFileId: input.photoFileId ?? null,
          status: input.skipOnboarding ? 'ACTIVE' : 'ONBOARDING',
          joiningDate: toDbDate(input.joiningDate),
        } as Prisma.EmployeeUncheckedCreateInput,
      });
      return { user, employee };
    });

    if (!input.skipOnboarding) await this.onboarding.createFor(employee.id);
    await this.kits.ensureIssue(employee.id);
    const card = await this.idcards.ensureCard(employee.id);
    await this.vcard.ensureProfile(employee.id, employee.fullName);
    if (opts.resumeFileId) {
      await this.prisma.employeeDocument.create({
        data: { employeeId: employee.id, category: 'CAREER', docType: 'RESUME', title: 'Resume', fileId: opts.resumeFileId, source: 'RECRUITMENT', verificationStatus: 'NOT_REQUIRED' } as Prisma.EmployeeDocumentUncheckedCreateInput,
      });
    }

    let inviteSent = false;
    if (input.sendInvite !== false) inviteSent = await this.sendInvite(employee.id, inviteToken, input.personalEmail ?? email, input.fullName, !!input.skipOnboarding);

    if (input.managerId) {
      await this.notify.notify({
        userIds: await this.notify.usersForEmployees([input.managerId]),
        type: 'people.newReport',
        title: `${input.fullName} joins your team on ${fmt(input.joiningDate)}`,
        body: `${desig.name} · ${dept.name} · ${empCode}`,
        link: `/employees/${employee.id}`,
        from: 'HR',
      });
    }
    await this.audit.record({ action: 'employee.created', entity: 'Employee', entityId: employee.id, meta: { empCode, sourceApplicationId: opts.sourceApplicationId ?? null, by: ctx.userName ?? null } });
    this.events.emit('employee.created', { employeeId: employee.id });
    this.log.log(`Employee ${empCode} created (${user.email})`);
    return { employee: { id: employee.id, empCode, fullName: employee.fullName }, inviteSent, idCardStatus: card.status };
  }

  private async sendInvite(employeeId: string, inviteToken: string, to: string, name: string, existing: boolean) {
    const link = `${env.WEB_ORIGIN}/accept-invite?token=${encodeURIComponent(inviteToken)}`;
    const t = await this.prisma.raw.tenant.findUnique({ where: { id: requireContext().tenantId } });
    const company = t?.brandName ?? t?.name ?? 'Lexisora';
    const ok = await this.mail.send({
      to,
      subject: existing ? `Your ${company} HRMS account` : `Welcome to ${company} · start your paperless onboarding`,
      text: existing
        ? `Hi ${name},\n\nYour account on ${company} HRMS is ready. Set your password here (valid for 7 days):\n${link}\n\n— ${company} HR`
        : `Hi ${name},\n\nWelcome to ${company}! Before day one, please sign your offer letter and NDA, upload your documents, add bank details and pick your welcome-kit size.\n\nSet your password to begin (link valid for 7 days):\n${link}\n\n— ${company} HR`,
      html: `<p>Hi ${escapeHtml(name)},</p><p>${existing ? `Your account on ${escapeHtml(company)} HRMS is ready.` : `Welcome to ${escapeHtml(company)}! Complete your paperless onboarding before day one: sign your offer letter and NDA, upload documents, add bank details and pick your welcome-kit size.`}</p><p><a href="${link}">Set your password &amp; ${existing ? 'sign in' : 'start onboarding'}</a> (valid for 7 days)</p><p>— ${escapeHtml(company)} HR</p>`,
    });
    if (ok) await this.prisma.onboarding.updateMany({ where: { employeeId }, data: { invitedAt: new Date() } });
    return ok;
  }

  async resendInvite(id: string) {
    const e = await this.prisma.employee.findUnique({ where: { id }, include: { user: true } });
    if (!e?.user) throw notFound('Employee');
    if (e.user.status !== 'INVITED') throw badRequest(`${e.fullName} has already accepted the invite`, 'INVITE_ACCEPTED');
    const inviteToken = token(32);
    await this.prisma.user.update({ where: { id: e.user.id }, data: { inviteToken, inviteExpiresAt: new Date(Date.now() + 7 * 86400_000) } });
    const ok = await this.sendInvite(e.id, inviteToken, e.personalEmail ?? e.officialEmail, e.fullName, e.status !== 'ONBOARDING');
    await this.audit.record({ action: 'employee.invite_resent', entity: 'Employee', entityId: e.id });
    return { inviteSent: ok };
  }

  // ── Update ───────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateEmployeeInput) {
    const before = await this.prisma.employee.findUnique({ where: { id } });
    if (!before) throw notFound('Employee');
    if (dto.managerId !== undefined) await this.assertManager(dto.managerId, id);
    const data: Prisma.EmployeeUncheckedUpdateInput = {};
    const changed: Record<string, [unknown, unknown]> = {};
    const set = (k: keyof Prisma.EmployeeUncheckedUpdateInput, v: unknown) => {
      const old = (before as Record<string, unknown>)[k as string];
      const oldCmp = old instanceof Date ? dbDateKey(old) : old;
      const newCmp = v instanceof Date ? dbDateKey(v) : v;
      if (oldCmp !== newCmp) {
        (data as Record<string, unknown>)[k as string] = v;
        changed[k as string] = [oldCmp ?? null, newCmp ?? null];
      }
    };
    for (const [k, v] of Object.entries(dto)) {
      if (v === undefined) continue;
      if (k === 'joiningDate' || k === 'dateOfBirth') set(k as any, v ? toDbDate(v as string) : null);
      else set(k as any, v);
    }
    if (dto.fullName) {
      const n = splitName(dto.fullName);
      data.firstName = n.firstName;
      data.lastName = n.lastName;
    }
    if (!Object.keys(changed).length) return { ok: true, changed: {} };
    await this.prisma.employee.update({ where: { id }, data });
    if (dto.fullName) await this.prisma.user.updateMany({ where: { id: before.userId ?? '' }, data: { name: dto.fullName } });
    await this.audit.record({ action: 'employee.updated', entity: 'Employee', entityId: id, meta: { changed: changed as Prisma.InputJsonValue } });
    this.events.emit('employee.updated', { employeeId: id, changed });
    await this.idcards.refresh(id);
    return { ok: true, changed };
  }

  async updateSelf(dto: UpdateSelfInput) {
    const me = this.access.meId();
    if (!me) throw notFound('Employee');
    const allowed: UpdateSelfInput = {};
    for (const k of ['phone', 'personalEmail', 'bloodGroup', 'maritalStatus', 'address', 'emergencyContactName', 'emergencyContactPhone', 'photoFileId'] as const) {
      if (dto[k] !== undefined) (allowed as Record<string, unknown>)[k] = dto[k];
    }
    return this.update(me, allowed as UpdateEmployeeInput);
  }

  // ── Lifecycle: notice, exit, conversion ──────────────────────────────────

  private async setStatus(id: string, from: string, to: 'ACTIVE' | 'NOTICE_PERIOD' | 'EXITED' | 'ONBOARDING', extra: Prisma.EmployeeUncheckedUpdateInput = {}) {
    await this.prisma.employee.update({ where: { id }, data: { status: to, ...extra } });
    await this.audit.record({ action: 'employee.status_changed', entity: 'Employee', entityId: id, meta: { from, to } });
    this.events.emit('employee.statusChanged', { employeeId: id, from, to });
  }

  async startExit(id: string, dto: StartExitInput) {
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e) throw notFound('Employee');
    if (e.status !== 'ACTIVE' && e.status !== 'ONBOARDING') throw conflict(`${e.fullName} is ${employeeStatusLabel(e.status, e.employmentType).toLowerCase()}`, 'INVALID_STATUS');
    const notice = defaultNoticeDays(e.employmentType as EmpType, dbDateKey(e.joiningDate), todayKey());
    let lwd: { lastWorkingDay: string; shortfallDays: number };
    try {
      lwd = computeLwd(dto.resignationDate, notice, dto.lastWorkingDay);
    } catch (err) {
      throw badRequest((err as Error).message, 'LWD_INVALID');
    }
    const assigned = await this.prisma.asset.count({ where: { currentAssigneeId: id, status: 'ASSIGNED', deletedAt: null } });
    const exitCase = await this.prisma.exitCase.create({
      data: {
        employeeId: id,
        exitType: dto.exitType,
        resignationDate: toDbDate(dto.resignationDate),
        lastWorkingDay: toDbDate(lwd.lastWorkingDay),
        noticeShortfallDays: lwd.shortfallDays,
        reason: dto.reason ?? null,
        items: {
          create: EXIT_CHECKLIST.map((c, i) => ({
            tenantId: requireContext().tenantId,
            key: c.key,
            label: c.label,
            ownerRole: c.ownerRole,
            blocking: c.blocking,
            auto: c.auto,
            order: i,
            status: c.key === 'ASSET_RETURN' && assigned === 0 ? 'DONE' : 'PENDING',
          })),
        },
      } as Prisma.ExitCaseUncheckedCreateInput,
    });
    await this.setStatus(id, e.status, 'NOTICE_PERIOD', {
      noticeStartDate: toDbDate(dto.resignationDate),
      exitDate: toDbDate(lwd.lastWorkingDay),
      exitReason: dto.reason ?? null,
    });
    await this.audit.record({ action: 'employee.exit_started', entity: 'Employee', entityId: id, meta: { exitCaseId: exitCase.id, lwd: lwd.lastWorkingDay } });
    const mgrUsers = await this.notify.usersForEmployees([e.managerId]);
    await this.notify.notify({
      userIds: mgrUsers,
      type: 'people.exitStarted',
      title: `${e.fullName} is serving notice · last day ${fmt(lwd.lastWorkingDay)}`,
      body: 'Plan the knowledge transfer and reassign work before the last working day.',
      link: `/employees/${id}`,
      from: 'HR',
    });
    return this.exitCaseDto(id);
  }

  async exitCaseDto(employeeId: string): Promise<ExitCaseDto | null> {
    const c = await this.prisma.exitCase.findFirst({
      where: { employeeId, status: { in: ['OPEN', 'COMPLETED'] } },
      orderBy: { createdAt: 'desc' },
      include: { items: { orderBy: { order: 'asc' } } },
    });
    if (!c) return null;
    const assigned = await this.prisma.asset.count({ where: { currentAssigneeId: employeeId, status: 'ASSIGNED', deletedAt: null } });
    // Keep the derived asset item in sync.
    const assetItem = c.items.find((i) => i.key === 'ASSET_RETURN');
    if (assetItem && c.status === 'OPEN') {
      const want = assigned === 0 ? 'DONE' : 'PENDING';
      if (assetItem.status !== want) {
        await this.prisma.exitChecklistItem.update({ where: { id: assetItem.id }, data: { status: want, doneAt: want === 'DONE' ? new Date() : null, doneByName: want === 'DONE' ? 'System' : null } });
        assetItem.status = want;
      }
    }
    const blockers = exitBlockers(c.items, assigned);
    return {
      id: c.id,
      exitType: c.exitType,
      resignationDate: dbDateKey(c.resignationDate)!,
      lastWorkingDay: dbDateKey(c.lastWorkingDay)!,
      noticeShortfallDays: c.noticeShortfallDays,
      reason: c.reason,
      status: c.status,
      items: c.items.map((i) => ({
        key: i.key,
        label: i.key === 'ASSET_RETURN' && assigned ? `${i.label} · ${assigned} pending` : i.label,
        ownerRole: i.ownerRole,
        blocking: i.blocking,
        auto: i.auto,
        status: i.status as 'PENDING' | 'DONE' | 'NA',
        doneByName: i.doneByName,
        doneAt: i.doneAt?.toISOString() ?? null,
        note: i.note,
      })),
      canComplete: c.status === 'OPEN' && blockers.length === 0,
      blockers,
    };
  }

  async updateChecklist(employeeId: string, key: string, status: 'PENDING' | 'DONE' | 'NA', note?: string | null) {
    const ctx = requireContext();
    const c = await this.prisma.exitCase.findFirst({ where: { employeeId, status: 'OPEN' }, include: { items: true } });
    if (!c) throw notFound('Exit case');
    const item = c.items.find((i) => i.key === key);
    if (!item) throw notFound('Checklist item');
    if (item.key === 'ASSET_RETURN') throw badRequest('Asset return ticks itself when every assigned asset is returned', 'AUTO_ITEM');
    // The manager may tick the KT item; everything else is HR.
    if (!isHr(ctx)) {
      const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
      if (!(key === 'KT_HANDOVER' && e?.managerId && e.managerId === ctx.employeeId)) throw new AppError(403, 'FORBIDDEN', 'Only HR can update this item');
    }
    if (status === 'NA' && item.blocking && !['ABSCONDING', 'TERMINATION'].includes(c.exitType)) throw badRequest('Blocking items cannot be skipped for this exit type', 'BLOCKING_ITEM');
    await this.prisma.exitChecklistItem.update({
      where: { id: item.id },
      data: { status, note: note ?? item.note, doneAt: status === 'PENDING' ? null : new Date(), doneByName: status === 'PENDING' ? null : (ctx.userName ?? null) },
    });
    if (key === 'IDCARD_SURRENDER' && status === 'DONE') await this.idcards.surrender(employeeId);
    await this.audit.record({ action: 'employee.exit_checklist', entity: 'Employee', entityId: employeeId, meta: { key, status } });
    return this.exitCaseDto(employeeId);
  }

  async withdrawExit(id: string) {
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e || e.status !== 'NOTICE_PERIOD') throw conflict('Only employees serving notice can withdraw', 'INVALID_STATUS');
    await this.prisma.exitCase.updateMany({ where: { employeeId: id, status: 'OPEN' }, data: { status: 'WITHDRAWN' } });
    await this.setStatus(id, e.status, 'ACTIVE', { noticeStartDate: null, exitDate: null, exitReason: null });
    await this.audit.record({ action: 'employee.exit_withdrawn', entity: 'Employee', entityId: id });
    return { ok: true };
  }

  async completeExit(id: string, overrideReason?: string | null) {
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e || e.status !== 'NOTICE_PERIOD') throw conflict('Start the exit before completing it', 'INVALID_STATUS');
    const dto = await this.exitCaseDto(id);
    if (!dto) throw notFound('Exit case');
    const assetsHeld = await this.prisma.asset.count({ where: { currentAssigneeId: id, status: 'ASSIGNED', deletedAt: null } });
    if (dto.blockers.length) {
      const overridable = ['ABSCONDING', 'TERMINATION'].includes(dto.exitType) && !!overrideReason && assetsHeld === 0;
      if (!overridable) throw new AppError(409, 'EXIT_BLOCKED', `Complete these first: ${dto.blockers.join(', ')}`, dto.blockers);
    }
    const reports = await this.prisma.employee.count({ where: { managerId: id, status: { not: 'EXITED' } } });
    if (reports) throw new AppError(409, 'REPORTS_ASSIGNED', `Reassign ${reports} direct report${reports === 1 ? '' : 's'} before completing the exit`);
    await this.prisma.exitCase.update({ where: { id: dto.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await this.prisma.exitChecklistItem.updateMany({ where: { exitCaseId: dto.id, key: 'ACCESS_REVOKE' }, data: { status: 'DONE', doneAt: new Date(), doneByName: 'System' } });
    await this.setStatus(id, e.status, 'EXITED', { exitDate: toDbDate(dto.lastWorkingDay) });
    if (e.userId) {
      await this.prisma.user.update({ where: { id: e.userId }, data: { status: 'DISABLED' } });
      await this.prisma.refreshToken.updateMany({ where: { userId: e.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.idcards.revokeForExit(id);
    await this.vcard.disablePublic(id);
    await this.audit.record({ action: 'employee.exited', entity: 'Employee', entityId: id, meta: { overrideReason: overrideReason ?? null } });
    return { ok: true };
  }

  async convertIntern(id: string, effectiveDate: string, designationId: string) {
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e) throw notFound('Employee');
    if (e.employmentType !== 'INTERN' || e.status === 'EXITED') throw conflict('Only active interns can be converted', 'INVALID_STATUS');
    if (!(await this.prisma.designation.findUnique({ where: { id: designationId } }))) throw badRequest('Pick a designation');
    const newCode = await this.nextEmpCode('FULL_TIME');
    await this.prisma.employee.update({ where: { id }, data: { employmentType: 'FULL_TIME', empCode: newCode, designationId, confirmationDate: null } });
    await this.audit.record({ action: 'employee.converted', entity: 'Employee', entityId: id, meta: { oldCode: e.empCode, newCode, effectiveDate } });
    await this.idcards.reissue(id, 'DATA_CHANGE');
    this.events.emit('employee.updated', { employeeId: id, changed: { employmentType: ['INTERN', 'FULL_TIME'], empCode: [e.empCode, newCode] }, effectiveFrom: effectiveDate });
    return { empCode: newCode, previousCode: e.empCode };
  }

  /** Daily 00:05 IST: joiners become ACTIVE on their joining date; HR is told if onboarding is incomplete. */
  async dailyLifecycle() {
    const today = toDbDate(todayKey());
    const due = await this.prisma.employee.findMany({ where: { status: 'ONBOARDING', joiningDate: { lte: today } } });
    const hr = await this.notify.usersWithPermission('onboarding.manage');
    for (const e of due) {
      await this.setStatus(e.id, 'ONBOARDING', 'ACTIVE');
      const ob = await this.prisma.onboarding.findUnique({ where: { employeeId: e.id } });
      if (ob && ob.status !== 'COMPLETED' && ob.status !== 'SUBMITTED') {
        await this.notify.notify({ userIds: hr, type: 'people.onboardingIncomplete', title: `Onboarding incomplete for ${e.fullName}`, body: `${e.empCode} joined today with onboarding still open.`, link: `/onboarding?employee=${e.id}`, from: 'System', email: true });
      }
    }
    return due.length;
  }

  // ── CSV import ───────────────────────────────────────────────────────────

  templateCsv(): string {
    return [
      EMPLOYEE_CSV_HEADERS.join(','),
      'Aditya Kulkarni,aditya.kulkarni@lexisora.com,+91 98250 11111,Development,React Developer,neha.kapoor@lexisora.com,Full-time,Remote,2026-10-12,aditya.k@gmail.com,Ahmedabad',
      'Tanvi Shah,tanvi.shah@lexisora.com,+91 98250 22222,Design,Intern,vikram.joshi@lexisora.com,Intern,Office,12-10-2026,,Pune',
    ].join('\n');
  }

  async validateImport(file: { buffer: Buffer; originalname: string } | undefined, createMissingMasters: boolean): Promise<ImportPreview> {
    if (!file) throw badRequest('Attach a CSV file');
    if (file.buffer.length > 5 * 1024 * 1024) throw badRequest('CSV files are limited to 5 MB', 'FILE_TOO_LARGE');
    let raw: Record<string, string>[];
    try {
      raw = parseCsv(file.buffer, {
        columns: (h: string[]) => h.map((x) => x.trim().toLowerCase().replace(/[\s-]+/g, '_')),
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      });
    } catch (e) {
      throw badRequest(`Could not read the CSV: ${(e as Error).message}`, 'CSV_INVALID');
    }
    if (!raw.length) throw badRequest('The CSV has no data rows', 'CSV_EMPTY');
    if (raw.length > 5000) throw badRequest('Import at most 5,000 rows at a time', 'CSV_TOO_LARGE');
    const [depts, desigs, branches, emps] = await Promise.all([
      this.prisma.department.findMany(),
      this.prisma.designation.findMany(),
      this.prisma.branch.findMany(),
      this.prisma.employee.findMany({ select: { id: true, officialEmail: true, status: true } }),
    ]);
    const { valid, errors } = validateCsvRows(raw, {
      departments: new Map(depts.map((d) => [d.name.toLowerCase(), d.id])),
      designations: new Map(desigs.map((d) => [d.name.toLowerCase(), d.id])),
      branches: new Map(branches.map((d) => [d.name.toLowerCase(), d.id])),
      managersByEmail: new Map(emps.filter((e) => e.status !== 'EXITED').map((e) => [e.officialEmail.toLowerCase(), e.id])),
      existingEmails: new Set(emps.map((e) => e.officialEmail.toLowerCase())),
      createMissingMasters,
      today: todayKey(),
    });
    const imp = await this.prisma.employeeImport.create({
      data: {
        filename: file.originalname,
        options: { createMissingMasters, raw: raw.slice(0, 200).map((r, i) => ({ row: i + 1, fullName: r.full_name ?? '', officialEmail: r.official_email ?? '', department: r.department ?? '', employmentType: r.employment_type ?? '' })) },
        totalRows: raw.length,
        validRows: valid.length,
        rows: valid as unknown as Prisma.InputJsonValue,
        rowErrors: errors as unknown as Prisma.InputJsonValue,
        createdByUserId: requireContext().userId ?? null,
      } as unknown as Prisma.EmployeeImportUncheckedCreateInput,
    });
    await this.audit.record({ action: 'employee.import_validated', entity: 'EmployeeImport', entityId: imp.id, meta: { total: raw.length, valid: valid.length } });
    return this.importDto(imp.id);
  }

  async importDto(id: string): Promise<ImportPreview> {
    const imp = await this.prisma.employeeImport.findUnique({ where: { id } });
    if (!imp) throw notFound('Import');
    const valid = imp.rows as unknown as NormalisedImportRow[];
    const errors = imp.rowErrors as unknown as ImportPreview['errors'];
    const errRows = new Set(errors.map((e) => e.row));
    const preview = [
      ...valid.map((v) => ({ row: v.row, fullName: v.fullName, officialEmail: v.officialEmail, department: v.department, employmentType: v.employmentType, ok: true })),
      ...[...errRows].map((row) => {
        const r = ((imp.options as { raw?: { row: number; fullName: string; officialEmail: string; department: string; employmentType: string }[] } | null)?.raw ?? []).find((x) => x.row === row);
        return { row, fullName: r?.fullName ?? '', officialEmail: r?.officialEmail ?? '', department: r?.department ?? '', employmentType: r?.employmentType ?? '', ok: false };
      }),
    ].sort((a, b) => a.row - b.row);
    return { id: imp.id, filename: imp.filename, totalRows: imp.totalRows, validRows: imp.validRows, errors, preview: preview.slice(0, 200), status: imp.status, importedRows: imp.importedRows };
  }

  async commitImport(id: string, opts: { sendInvites: boolean; createMissingMasters: boolean }) {
    const imp = await this.prisma.employeeImport.findUnique({ where: { id } });
    if (!imp) throw notFound('Import');
    if (imp.status === 'DONE') return this.importDto(id); // idempotent re-commit
    const rows = orderByManager(imp.rows as unknown as NormalisedImportRow[]);
    const createdByEmail = new Map<string, string>();
    const extraErrors: ImportPreview['errors'] = [];
    let imported = 0;
    for (const r of rows) {
      try {
        if (await this.prisma.employee.findFirst({ where: { officialEmail: r.officialEmail }, select: { id: true } })) {
          imported++; // already imported by an earlier partial run
          continue;
        }
        const departmentId = r.departmentId ?? (opts.createMissingMasters ? await this.ensureMaster('department', r.department) : null);
        const designationId = r.designationId ?? (opts.createMissingMasters ? await this.ensureMaster('designation', r.designation) : null);
        const branchId = r.branchId ?? (r.branch && opts.createMissingMasters ? await this.ensureMaster('branch', r.branch) : null);
        if (!departmentId || !designationId) throw new Error('Department or designation missing');
        const managerId = r.managerId ?? (r.managerEmail ? (createdByEmail.get(r.managerEmail) ?? null) : null);
        const res = await this.create({
          fullName: r.fullName,
          officialEmail: r.officialEmail,
          personalEmail: r.personalEmail,
          phone: r.phone,
          departmentId,
          designationId,
          branchId,
          managerId,
          employmentType: r.employmentType,
          workMode: r.workMode,
          joiningDate: r.joiningDate,
          skipOnboarding: r.joiningDate < todayKey(),
          sendInvite: opts.sendInvites,
        });
        createdByEmail.set(r.officialEmail, res.employee.id);
        imported++;
      } catch (e) {
        extraErrors.push({ row: r.row, message: (e as Error).message });
      }
    }
    const allErrors = [...(imp.rowErrors as unknown as ImportPreview['errors']), ...extraErrors].sort((a, b) => a.row - b.row);
    await this.prisma.employeeImport.update({
      where: { id },
      data: { status: 'DONE', importedRows: imported, committedAt: new Date(), rowErrors: allErrors as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record({ action: 'employee.imported', entity: 'EmployeeImport', entityId: id, meta: { imported } });
    return this.importDto(id);
  }

  async importErrorsCsv(id: string): Promise<string> {
    const imp = await this.prisma.employeeImport.findUnique({ where: { id } });
    if (!imp) throw notFound('Import');
    const errors = imp.rowErrors as unknown as ImportPreview['errors'];
    return ['row,field,message', ...errors.map((e) => [e.row, e.field ?? '', e.message].map(csvEscape).join(','))].join('\n');
  }

  private async ensureMaster(kind: 'department' | 'designation' | 'branch', name: string): Promise<string> {
    const m = this.prisma[kind] as unknown as {
      findFirst: (a: unknown) => Promise<{ id: string } | null>;
      create: (a: unknown) => Promise<{ id: string }>;
    };
    const found = await m.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (found) return found.id;
    const created = await m.create({ data: { name } });
    await this.audit.record({ action: 'master.created', entity: kind, entityId: created.id, meta: { name, via: 'import' } });
    return created.id;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
