import { Body, Controller, Get, Injectable, OnModuleDestroy, OnModuleInit, Put } from '@nestjs/common';
import {
  REGIONS,
  REGION_CODES,
  setCompanyTaxSchema,
  setRegionSchema,
  type SetCompanyTaxInput,
  type RegionChecklistItem,
  type RegionCode,
  type RegionStatusDto,
  type SetRegionInput,
} from '@lexisora/shared';
import { PrismaService } from '../prisma/prisma.service';
import { requireContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RequirePerm } from '../auth/decorators';
import { ZodPipe } from '../http/zod.pipe';
import { AppError } from '../http/errors';
import { cacheRegion, installRegionResolver, regionOfTenant, replaceRegionCache } from './region-cache';

const REFRESH_MS = 60_000;
const ACTIVE = ['ACTIVE', 'NOTICE_PERIOD', 'ONBOARDING'] as const;
/** Built-in UK bank-holiday calendar names (see time/lib/holiday-lists.ts). */
export const UK_HOLIDAY_CALENDARS = ['England and Wales', 'Scotland', 'Northern Ireland'];

/**
 * Tenant region (India / United Kingdom). Keeps the in-memory cache the shared helpers read,
 * and lets an admin switch the region while the tenant has no finalised pay runs or issued
 * invoices (those were calculated under the old region's rules and currency).
 */
@Injectable()
export class RegionService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async onModuleInit() {
    installRegionResolver();
    await this.refresh().catch(() => undefined);
    this.timer = setInterval(() => void this.refresh().catch(() => undefined), REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Reload every tenant's region (also picks up changes made by another API instance). */
  async refresh() {
    const rows = await this.prisma.raw.tenant.findMany({ select: { id: true, region: true } });
    replaceRegionCache(rows);
  }

  regionOf(tenantId: string): RegionCode {
    return regionOfTenant(tenantId);
  }

  async status(): Promise<RegionStatusDto> {
    const { tenantId, isPlatformAdmin } = requireContext();
    const t = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { region: true, gstin: true } });
    const region = (REGION_CODES as readonly string[]).includes(t.region) ? (t.region as RegionCode) : 'IN';
    const blockers = isPlatformAdmin ? [] : await this.blockers();
    return {
      region,
      config: REGIONS[region],
      options: REGION_CODES.map((c) => REGIONS[c]),
      blockers,
      checklist: region === 'GB' ? await this.ukChecklist() : [],
      vatNumber: region === 'GB' ? (t.gstin ?? null) : null,
    };
  }

  private async blockers(): Promise<string[]> {
    const [runs, invoices] = await Promise.all([
      this.prisma.payrollRun.count({ where: { status: { in: ['FINALIZED', 'PAID'] } } }),
      this.prisma.invoice.count({ where: { status: { not: 'DRAFT' } } }),
    ]);
    const out: string[] = [];
    if (runs) out.push(`${runs} finalised pay run${runs === 1 ? '' : 's'} were calculated under the current region's tax rules.`);
    if (invoices) out.push(`${invoices} issued invoice${invoices === 1 ? '' : 's'} carry the current region's tax and currency.`);
    return out;
  }

  async setRegion(dto: SetRegionInput): Promise<RegionStatusDto> {
    const ctx = requireContext();
    const t = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    if (t.region === dto.region) return this.status();
    if (!(dto.force && ctx.isPlatformAdmin)) {
      const blockers = await this.blockers();
      if (blockers.length) {
        throw new AppError(409, 'REGION_LOCKED', `The region cannot be changed: ${blockers.join(' ')} Ask Lexisora support to move the tenant.`, { blockers });
      }
    }
    const cfg = REGIONS[dto.region];
    await this.prisma.raw.tenant.update({
      where: { id: t.id },
      // An Indian GSTIN is not a UK VAT number (and the other way round): clear it on a switch.
      data: { region: dto.region, timezone: cfg.timezone, gstin: null },
    });
    // Work locations still on the old region's time zone move to the new one.
    await this.prisma.workLocation.updateMany({ where: { timezone: REGIONS[(t.region === 'GB' ? 'GB' : 'IN') as RegionCode].timezone }, data: { timezone: cfg.timezone } });
    cacheRegion(t.id, dto.region);
    await this.audit.record({
      action: 'region.changed',
      entity: 'Tenant',
      entityId: t.id,
      meta: { from: t.region, to: dto.region, forced: !!dto.force },
    });
    this.realtime.toTenant(t.id, 'region.changed', { region: dto.region });
    return this.status();
  }

  /** UK: the company's VAT registration number (printed on VAT invoices). */
  async setCompanyTax(dto: SetCompanyTaxInput): Promise<RegionStatusDto> {
    const ctx = requireContext();
    const t = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    if (t.region !== 'GB') throw new AppError(409, 'NOT_UK', 'The VAT number is set here only for UK companies; Indian GST details are in the billing profile.');
    const vat = setCompanyTaxSchema.parse(dto).vatNumber || null;
    await this.prisma.raw.tenant.update({ where: { id: t.id }, data: { gstin: vat } });
    await this.audit.record({ action: 'region.vat.updated', entity: 'Tenant', entityId: t.id, meta: { registered: !!vat } });
    return this.status();
  }

  private async ukChecklist(): Promise<RegionChecklistItem[]> {
    const year = new Date().getUTCFullYear();
    const [tenant, locs, locsSet, holidays, alType, employees, profiles, rtwPeople] = await Promise.all([
      this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: requireContext().tenantId }, select: { gstin: true } }),
      this.prisma.workLocation.count({ where: { archivedAt: null, isRemote: false } }),
      this.prisma.workLocation.count({ where: { archivedAt: null, isRemote: false, ukNation: { not: null } } }),
      this.prisma.holiday.count({
        where: { calendar: { in: UK_HOLIDAY_CALENDARS }, date: { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) } },
      }),
      this.prisma.leaveType.count({ where: { code: 'AL', active: true } }),
      this.prisma.employee.findMany({ where: { status: { in: [...ACTIVE] } }, select: { id: true } }),
      this.prisma.employeePayrollProfile.findMany({ select: { employeeId: true, ukProfile: true } }),
      this.prisma.rightToWorkCheck.findMany({ where: { supersededAt: null }, select: { employeeId: true }, distinct: ['employeeId'] }),
    ]);
    const ids = new Set(employees.map((e) => e.id));
    const withTax = profiles.filter((p) => ids.has(p.employeeId) && typeof (p.ukProfile as { taxCode?: unknown } | null)?.taxCode === 'string').length;
    const withRtw = rtwPeople.filter((r) => ids.has(r.employeeId)).length;
    const n = ids.size;
    return [
      {
        key: 'vat',
        label: 'Company VAT number',
        done: !!tenant.gstin,
        detail: tenant.gstin ? `VAT number ${tenant.gstin}` : 'Add the VAT number used on invoices (leave empty if not VAT registered).',
        link: '/region',
      },
      {
        key: 'locations',
        label: 'Nation of each work location',
        done: locs > 0 && locsSet === locs,
        detail: `${locsSet} of ${locs} locations have a UK nation (decides which bank holidays apply).`,
        link: '/work-locations',
      },
      {
        key: 'holidays',
        label: `UK bank holidays ${year}`,
        done: holidays > 0,
        detail: holidays ? `${holidays} bank holidays imported.` : 'Import the bank holidays for your nations in Holiday & absence setup.',
        link: '/leave-setup',
      },
      {
        key: 'leave',
        label: 'UK holiday and absence types',
        done: alType > 0,
        detail: alType ? 'Annual leave and statutory absence types are set up.' : 'Add the UK pack: annual leave (5.6 weeks), sickness, maternity, paternity and more.',
        link: '/leave-setup',
      },
      {
        key: 'paye',
        label: 'Tax code and NI category for everyone',
        done: n > 0 && withTax >= n,
        detail: `${withTax} of ${n} people have UK payroll details (tax code, NI category, pension).`,
        link: '/payroll',
      },
      {
        key: 'rtw',
        label: 'Right to work checks',
        done: n > 0 && withRtw >= n,
        detail: `${withRtw} of ${n} people have a right-to-work check on file.`,
        link: '/right-to-work',
      },
    ];
  }
}

@Controller('region')
export class RegionController {
  constructor(private readonly region: RegionService) {}

  @Get()
  @RequirePerm('region.manage')
  get() {
    return this.region.status();
  }

  @Put('company-tax')
  @RequirePerm('region.manage')
  setCompanyTax(@Body(new ZodPipe(setCompanyTaxSchema)) dto: SetCompanyTaxInput) {
    return this.region.setCompanyTax(dto);
  }

  @Put()
  @RequirePerm('region.manage')
  set(@Body(new ZodPipe(setRegionSchema)) dto: SetRegionInput) {
    return this.region.setRegion(dto);
  }
}
