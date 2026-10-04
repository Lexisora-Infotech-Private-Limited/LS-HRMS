import { Injectable } from '@nestjs/common';
import {
  formatMonthYear,
  type ProfileAssetRow,
  type ProfileAttendanceRow,
  type ProfileDocumentRow,
  type ProfileDto,
  type ProfilePayRow,
  type ProfileTab,
} from '@lexisora/shared';
import { hasPerm } from '../../../core/auth/decorators';
import type { RequestContext } from '../../../core/context/request-context';
import { requireContext } from '../../../core/context/request-context';
import { CryptoService } from '../../../core/crypto/crypto.service';
import { forbidden, notFound } from '../../../core/http/errors';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { loadCompensation } from '../compensation';
import { VaultService } from '../documents/vault.service';
import { KitsService } from '../kits/kits.service';
import { isHr, PeopleAccess } from '../people.access';
import { employeeStatusLabel, initials, maskAccount, maskPan } from '../people.rules';
import { dbDateKey, fmt, model, todayKey } from '../people.util';
import { EmployeesService } from './employees.service';

const minToHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const WORK_MODE_PUNCH: Record<string, string> = { OFFICE: 'Office · biometric punch', REMOTE: 'Remote · web + desktop punch', HYBRID: 'Hybrid · web + desktop punch' };

/** Employee profile (/employees/:id and /me): header, tabs and their data, with relationship scoping. */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly access: PeopleAccess,
    private readonly vault: VaultService,
    private readonly assets: AssetsService,
    private readonly kits: KitsService,
    private readonly employees: EmployeesService,
  ) {}

  private tabsFor(ctx: RequestContext, rel: { self: boolean; hr: boolean; manager: boolean }): ProfileTab[] {
    const tabs: ProfileTab[] = ['overview'];
    if (rel.self || rel.hr) tabs.push('documents');
    tabs.push('assets');
    if (rel.self || hasPerm(ctx, 'employees.compensation')) tabs.push('pay');
    tabs.push('attendance');
    if (rel.self || rel.hr) tabs.push('devices');
    return tabs;
  }

  async profile(idOrMe: string): Promise<ProfileDto> {
    const id = this.access.resolveId(idOrMe);
    const rel = await this.access.assertCanView(id);
    const ctx = requireContext();
    const e = await this.prisma.employee.findUnique({ where: { id }, include: { department: true, designation: true, branch: true, manager: { select: { id: true, fullName: true } } } });
    if (!e) throw notFound('Employee');

    let shift = '—';
    let location = WORK_MODE_PUNCH[e.workMode] ?? e.workMode;
    try {
      const s = e.shiftId ? await model(this.prisma, 'shift')?.findUnique({ where: { id: e.shiftId } }) : await model(this.prisma, 'shift')?.findFirst({ where: { isDefault: true } });
      if (s) shift = `${s.name} · ${minToHm(s.startMinute)}–${minToHm(s.endMinute)}`;
      const loc = e.workLocationId ? await model(this.prisma, 'workLocation')?.findUnique({ where: { id: e.workLocationId } }) : null;
      if (loc && e.workMode !== 'REMOTE') location = `${loc.name} · ${e.workMode === 'OFFICE' ? 'biometric punch' : 'web + desktop punch'}`;
    } catch {
      /* time tables not present */
    }

    const privileged = rel.self || rel.hr;
    const overview: { label: string; value: string }[] = [
      { label: 'Official email', value: e.officialEmail },
      { label: 'Phone', value: e.phone ? (privileged || rel.manager ? e.phone : e.phone.replace(/\d{5}$/, 'XXXXX')) : '—' },
      { label: 'Shift', value: shift },
      { label: 'Work location', value: location },
      { label: 'Blood group', value: e.bloodGroup ?? '—' },
      { label: 'Emergency contact', value: e.emergencyContactName ? `${e.emergencyContactName}${e.emergencyContactPhone ? ` · ${e.emergencyContactPhone}` : ''}` : '—' },
    ];
    if (privileged) {
      overview.push(
        { label: 'Personal email', value: e.personalEmail ?? '—' },
        { label: 'Date of birth', value: fmt(e.dateOfBirth) },
        { label: 'Address', value: e.address ?? '—' },
        { label: 'Branch', value: e.branch?.name ?? '—' },
        { label: 'Employment type', value: e.employmentType === 'INTERN' ? 'Intern' : e.employmentType === 'CONTRACT' ? 'Contract' : 'Full-time' },
        { label: 'PAN', value: maskPan(this.crypto.decrypt(e.panEnc)) },
        { label: 'Bank account', value: e.bankAccountLast4 ? `${maskAccount(e.bankAccountLast4)} · ${e.bankIfsc ?? ''}` : '—' },
        { label: 'Tax regime', value: e.taxRegime === 'OLD' ? 'Old regime' : 'New regime' },
      );
      if (e.status === 'NOTICE_PERIOD' || e.status === 'EXITED') overview.push({ label: e.status === 'EXITED' ? 'Exited on' : 'Last working day', value: fmt(e.exitDate) });
    }

    // Badges from workplace Kudos (optional table).
    let badges: string[] = [];
    let moreBadges = 0;
    try {
      const k = model(this.prisma, 'kudos');
      if (k) {
        const rows: { badge: { name: string } }[] = await k.findMany({ where: { recipientEmployeeId: id, revokedAt: null }, include: { badge: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 50 });
        const uniq = [...new Set(rows.map((r) => r.badge?.name).filter(Boolean))] as string[];
        badges = uniq.slice(0, 3);
        moreBadges = Math.max(0, uniq.length - 3);
      }
    } catch {
      /* workplace not available */
    }

    const hr = isHr(ctx) || ctx.permissions.has('*');
    return {
      id: e.id,
      isSelf: rel.self,
      fullName: e.fullName,
      initials: initials(e.fullName),
      photoFileId: e.photoFileId,
      empCode: e.empCode,
      designation: e.designation?.name ?? null,
      designationId: e.designationId,
      department: e.department?.name ?? null,
      departmentId: e.departmentId,
      manager: e.manager?.fullName ?? null,
      managerId: e.managerId,
      branchId: e.branchId,
      workMode: e.workMode,
      employmentType: e.employmentType,
      status: e.status,
      statusLabel: employeeStatusLabel(e.status, e.employmentType),
      joiningDate: dbDateKey(e.joiningDate),
      badges,
      moreBadges,
      visibleTabs: this.tabsFor(ctx, rel),
      canEdit: hr,
      canEditSelf: rel.self,
      canLifecycle: hr,
      exitedOn: e.status === 'EXITED' ? dbDateKey(e.exitDate) : null,
      overview,
      editable: hr || rel.self
        ? {
            fullName: e.fullName,
            phone: e.phone,
            personalEmail: e.personalEmail,
            departmentId: e.departmentId,
            designationId: e.designationId,
            branchId: e.branchId,
            managerId: e.managerId,
            employmentType: e.employmentType,
            workMode: e.workMode,
            joiningDate: dbDateKey(e.joiningDate),
            shiftId: e.shiftId,
            workLocationId: e.workLocationId,
            bloodGroup: e.bloodGroup,
            dateOfBirth: dbDateKey(e.dateOfBirth),
            gender: e.gender,
            maritalStatus: e.maritalStatus,
            address: e.address,
            emergencyContactName: e.emergencyContactName,
            emergencyContactPhone: e.emergencyContactPhone,
            photoFileId: e.photoFileId,
          }
        : {},
      exitCase: hr || rel.self || rel.manager ? await this.employees.exitCaseDto(id) : null,
    };
  }

  async documents(idOrMe: string): Promise<ProfileDocumentRow[]> {
    const id = this.access.resolveId(idOrMe);
    const rel = await this.access.assertCanView(id);
    if (!rel.self && !rel.hr) throw forbidden('Documents are visible only to the employee and HR');
    const rows = await this.vault.listFor(id);
    const canVerify = hasPerm(requireContext(), 'onboarding.manage');
    return rows.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      categoryLabel: d.categoryLabel,
      docType: d.docType,
      status: d.status,
      statusLabel: d.statusLabel,
      uploadedAt: d.uploadedAt,
      fileId: d.fileId,
      rejectionReason: d.rejectionReason,
      canVerify: canVerify && d.status === 'PENDING',
    }));
  }

  async assetsTab(idOrMe: string): Promise<{ rows: ProfileAssetRow[] }> {
    const id = this.access.resolveId(idOrMe);
    await this.access.assertCanView(id);
    const rows = await this.assets.forEmployee(id);
    const kit = await this.kits.summary(id);
    if (kit) rows.push({ id: 'kit', item: 'Welcome kit', serial: '—', assigned: kit.date ? fmt(kit.date) : '—', status: kit.issued === kit.total ? 'ISSUED' : 'PARTIAL', statusLabel: `${kit.issued} of ${kit.total} items` });
    return { rows };
  }

  async pay(idOrMe: string): Promise<{ rows: ProfilePayRow[]; effectiveFrom: string | null; source: string | null }> {
    const id = this.access.resolveId(idOrMe);
    const rel = await this.access.assertCanView(id);
    if (!rel.self && !hasPerm(requireContext(), 'employees.compensation')) throw forbidden('Compensation is visible only to the employee and Payroll/HR');
    const comp = await loadCompensation(this.prisma, this.crypto, id);
    return { rows: comp?.rows ?? [], effectiveFrom: comp?.effectiveFrom ?? null, source: comp?.source ?? null };
  }

  /** Last 6 months from time's AttendanceDay (present/leave days, idle, late). */
  async attendance(idOrMe: string): Promise<{ rows: ProfileAttendanceRow[] }> {
    const id = this.access.resolveId(idOrMe);
    await this.access.assertCanView(id);
    const m = model(this.prisma, 'attendanceDay');
    if (!m) return { rows: [] };
    const today = todayKey();
    const from = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
    from.setUTCMonth(from.getUTCMonth() - 5);
    let days: { date: Date; presentFraction: number; leaveFraction: number; idleMinutes: number; isLate: boolean }[] = [];
    try {
      days = await m.findMany({ where: { employeeId: id, date: { gte: from } }, select: { date: true, presentFraction: true, leaveFraction: true, idleMinutes: true, isLate: true } });
    } catch {
      return { rows: [] };
    }
    const by = new Map<string, ProfileAttendanceRow>();
    for (const d of days) {
      const key = d.date.toISOString().slice(0, 7);
      const r = by.get(key) ?? { month: formatMonthYear(d.date), present: 0, leave: 0, idleMinutes: 0, late: 0 };
      r.present += d.presentFraction ?? 0;
      r.leave += d.leaveFraction ?? 0;
      r.idleMinutes += d.idleMinutes ?? 0;
      r.late += d.isLate ? 1 : 0;
      by.set(key, r);
    }
    return { rows: [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, r]) => ({ ...r, present: Math.round(r.present * 2) / 2, leave: Math.round(r.leave * 2) / 2 })) };
  }

  /** Header search provider: HR/managers get code + email; employees see name + designation only. */
  async search(q: string, ctx: RequestContext) {
    const full = hasPerm(ctx, 'employees.view');
    const scope = full ? await this.access.listScope() : null;
    const rows = await this.prisma.employee.findMany({
      where: {
        status: { not: 'EXITED' },
        ...(scope && full ? {} : {}),
        OR: [{ fullName: { contains: q, mode: 'insensitive' } }, ...(full ? [{ empCode: { contains: q, mode: 'insensitive' as const } }, { officialEmail: { contains: q, mode: 'insensitive' as const } }] : [])],
      },
      include: { designation: true, department: true },
      take: 6,
      orderBy: { fullName: 'asc' },
    });
    return rows.map((e) => {
      const canOpen = full && (!scope || scope.includes(e.id));
      return {
        type: 'people',
        id: e.id,
        title: e.fullName,
        subtitle: full ? [e.designation?.name, e.department?.name, e.empCode].filter(Boolean).join(' · ') : (e.designation?.name ?? undefined),
        link: e.id === ctx.employeeId ? '/me' : canOpen ? `/employees/${e.id}` : '/employees',
      };
    });
  }
}
