import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { hasPerm } from '../../core/auth/decorators';
import { getContext, runAsTenant } from '../../core/context/request-context';
import { JobsService } from '../../core/jobs/jobs.service';
import { LookupsService } from '../../core/lookups/lookups';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventsService } from '../../core/registry/events.service';
import { ApprovalCountsService, SearchService } from '../../core/registry/registries';
import { fileAccessCheckers } from '../../core/storage/files.controller';
import { AppraisalsService } from './appraisals/appraisals.service';
import { AssetsService } from './assets/assets.service';
import { EmployeesService } from './employees/employees.service';
import { ProfileService } from './employees/profile.service';
import { IdCardsService } from './idcards/idcards.service';
import { OnboardingService } from './onboarding/onboarding.service';
import { CandidatesService } from './recruitment/candidates.service';
import { InterviewsService } from './recruitment/interviews.service';
import { isHr, PeopleAccess } from './people.access';

/** Registries (lookups, search, approvals, file access), event handlers and schedules for People. */
@Injectable()
export class PeopleJobs implements OnModuleInit {
  private readonly log = new Logger('PeopleJobs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: LookupsService,
    private readonly search: SearchService,
    private readonly approvals: ApprovalCountsService,
    private readonly events: EventsService,
    private readonly jobs: JobsService,
    private readonly access: PeopleAccess,
    private readonly employees: EmployeesService,
    private readonly profile: ProfileService,
    private readonly onboarding: OnboardingService,
    private readonly idcards: IdCardsService,
    private readonly assets: AssetsService,
    private readonly candidates: CandidatesService,
    private readonly interviews: InterviewsService,
    private readonly appraisals: AppraisalsService,
  ) {}

  onModuleInit() {
    // ── Lookups ──
    this.lookups.register('jobs', async () => (await this.prisma.job.findMany({ where: { status: { in: ['OPEN', 'ON_HOLD'] } }, orderBy: { title: 'asc' } })).map((j) => ({ value: j.id, label: j.title })));
    this.lookups.register('candidates', () => this.candidates.lookupOptions());
    this.lookups.register('interviewRounds', () => this.interviews.rounds());
    this.lookups.register('kraTemplates', () => this.appraisals.templateOptions());
    this.lookups.register('assetCategories', async () => (await this.prisma.assetCategory.findMany({ orderBy: { name: 'asc' } })).map((c) => ({ value: c.id, label: c.name })));
    this.lookups.register('kitItems', async () => (await this.prisma.welcomeKitItem.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } })).map((c) => ({ value: c.id, label: c.name })));
    this.lookups.register('newJoiners', async () => {
      const rows = await this.prisma.welcomeKitIssue.findMany({ where: { status: { in: ['PENDING', 'PARTIAL'] } }, select: { employeeId: true } });
      const emps = await this.prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) }, status: { not: 'EXITED' } }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } });
      return emps.map((e) => ({ value: e.id, label: e.fullName }));
    });

    // ── Header search ──
    this.search.register('people', (q, ctx) => this.profile.search(q, ctx));
    this.search.register('candidates', async (q, ctx) => {
      if (!hasPerm(ctx, 'candidates.view')) return [];
      const rows = await this.prisma.candidate.findMany({ where: { anonymisedAt: null, OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] }, take: 5 });
      return rows.map((c) => ({ type: 'candidates', id: c.id, title: c.fullName, subtitle: 'Candidate', link: `/candidates?candidate=${c.id}` }));
    });

    // ── Awaiting your approval ──
    this.approvals.register(async (ctx) => {
      if (!hasPerm(ctx, 'onboarding.manage')) return null;
      const count = await this.prisma.employeeDocument.count({ where: { verificationStatus: 'PENDING', deletedAt: null, isCurrent: true } });
      return count ? { key: 'documents', label: 'Documents to verify', count, link: '/onboarding?tab=verification' } : null;
    });
    this.approvals.register(async (ctx) => {
      if (!ctx.employeeId) return null;
      const count = await this.interviews.pendingScorecards(ctx.employeeId);
      return count ? { key: 'scorecards', label: 'Interview scorecards', count, link: '/interviews' } : null;
    });
    this.approvals.register(async (ctx) => {
      if (!ctx.employeeId) return null;
      const count = await this.appraisals.pendingForReviewer(ctx.employeeId);
      return count ? { key: 'appraisals', label: 'Appraisal reviews', count, link: '/appraisals?tab=mine' } : null;
    });

    // ── Private file access (documents, resumes, photos) ──
    fileAccessCheckers.push(async (fileId) => {
      const ctx = getContext();
      if (!ctx) return false;
      // Photos are visible to colleagues (directory, ID cards).
      if (await this.prisma.employee.findFirst({ where: { photoFileId: fileId }, select: { id: true } })) return true;
      const doc = await this.prisma.employeeDocument.findFirst({ where: { fileId, deletedAt: null }, select: { employeeId: true } });
      if (doc && (doc.employeeId === ctx.employeeId || isHr(ctx) || hasPerm(ctx, 'onboarding.manage'))) return true;
      const cand = await this.prisma.candidate.findFirst({ where: { resumeFileId: fileId }, select: { id: true } });
      if (cand) {
        if (hasPerm(ctx, 'candidates.view') || hasPerm(ctx, 'candidates.manage')) return true;
        if (ctx.employeeId && (await this.prisma.interview.findFirst({ where: { application: { candidateId: cand.id }, panelists: { some: { employeeId: ctx.employeeId } } }, select: { id: true } }))) return true;
      }
      if (hasPerm(ctx, 'idcard.manage') && (await this.prisma.idCardTemplate.findFirst({ where: { OR: [{ frontBgFileId: fileId }, { backBgFileId: fileId }] }, select: { id: true } }))) return true;
      return false;
    });

    // ── Events ──
    this.events.on('onboarding.completed', async (p: Record<string, unknown>) => {
      const employeeId = String(p.employeeId);
      await this.idcards.ensureCard(employeeId);
      await this.idcards.refresh(employeeId);
    });
    this.jobs.register('people.idcards.generate', async (d: Record<string, unknown>) => this.idcards.generate({ cardIds: d.cardIds as string[] | undefined }));
    void this.access;
  }

  private async forEachTenant(name: string, fn: () => Promise<unknown>) {
    const tenants = await this.prisma.raw.tenant.findMany({ select: { id: true } }).catch(() => [] as { id: string }[]);
    for (const t of tenants) {
      try {
        await runAsTenant(t.id, fn);
      } catch (e) {
        this.log.error(`${name} failed for tenant ${t.id}: ${(e as Error).message}`);
      }
    }
  }

  /** 00:05 IST: joiners become ACTIVE on their joining date. */
  @Cron('5 0 * * *', { timeZone: 'Asia/Kolkata' })
  async lifecycle() {
    await this.forEachTenant('people-lifecycle', () => this.employees.dailyLifecycle());
  }

  /** 09:00 IST: onboarding reminders (7/3/1 days before joining). */
  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async onboardingReminders() {
    await this.forEachTenant('onboarding-reminders', () => this.onboarding.remind());
  }

  /** 08:30 IST: asset warranty expiry alerts (30 / 7 / 0 days). */
  @Cron('30 8 * * *', { timeZone: 'Asia/Kolkata' })
  async warranty() {
    await this.forEachTenant('asset-warranty', () => this.assets.warrantyScan());
  }

  /** 02:15 IST: anonymise candidates past their DPDP retention date (M6 acceptance 6). */
  @Cron('15 2 * * *', { timeZone: 'Asia/Kolkata' })
  async candidateRetention() {
    await this.forEachTenant('candidate-retention', () => this.candidates.retentionSweep());
  }
}
