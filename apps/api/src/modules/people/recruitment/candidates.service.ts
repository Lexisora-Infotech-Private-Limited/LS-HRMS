import { Injectable } from '@nestjs/common';
import type { ApplicationStage, Prisma } from '@prisma/client';
import {
  CANDIDATE_SOURCE_LABELS,
  type CandidateDetail,
  type CandidateInput,
  type CandidateListQuery,
  type CandidateRow,
  type HireInput,
  type JobOfferInput,
} from '@lexisora/shared';
import { AuditService } from '../../../core/audit/audit.service';
import { hasPerm } from '../../../core/auth/decorators';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../../core/http/errors';
import { MailService } from '../../../core/mail/mail.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { EmployeesService, escapeHtml } from '../employees/employees.service';
import { addDays, applicationScore, canMoveStage } from '../people.rules';
import { dbDateKey, fmt, fmtWhen, inrPdf, toDbDate, todayKey } from '../people.util';

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  OFFERED: 'Offered',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
  OFFER_DECLINED: 'Offer declined',
  WITHDRAWN: 'Withdrawn',
};

const TAB_STAGES: Record<CandidateListQuery['tab'], ApplicationStage[] | null> = {
  all: null,
  screening: ['SCREENING'],
  interview: ['INTERVIEW'],
  offered: ['OFFERED', 'HIRED'],
  rejected: ['REJECTED', 'OFFER_DECLINED', 'WITHDRAWN'],
};

/** Candidates & interview vault (M6): applications by stage, offers and hire → employee. */
@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly mail: MailService,
    private readonly notify: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private canManage() {
    const ctx = requireContext();
    return hasPerm(ctx, 'candidates.manage') || hasPerm(ctx, 'jobs.manage');
  }

  private assertManage() {
    if (!this.canManage()) throw forbidden('Only recruiters can change candidates');
  }

  /**
   * Leads (recruiters without `jobs.manage`) see only candidates for jobs in their own
   * department or jobs they are the hiring manager for (spec M6). HR/admin: no scope.
   */
  async jobScope(): Promise<Prisma.JobWhereInput | null> {
    const ctx = requireContext();
    if (hasPerm(ctx, 'jobs.manage')) return null;
    const me = ctx.employeeId;
    if (!me) return { id: '__none__' };
    const e = await this.prisma.employee.findUnique({ where: { id: me }, select: { departmentId: true } });
    return { OR: [{ hiringManagerId: me }, ...(e?.departmentId ? [{ departmentId: e.departmentId }] : [])] };
  }

  // ── List / detail ────────────────────────────────────────────────────────

  async list(q: CandidateListQuery) {
    const base: Prisma.JobApplicationWhereInput = { candidate: { anonymisedAt: null } };
    const scope = await this.jobScope();
    if (scope) base.job = scope;
    if (q.jobId) base.jobId = q.jobId;
    if (q.q) base.candidate = { anonymisedAt: null, OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { tags: { has: q.q.toLowerCase() } }] };
    const stages = TAB_STAGES[q.tab];
    const where: Prisma.JobApplicationWhereInput = stages ? { AND: [base, { stage: { in: stages } }] } : base;
    const [apps, grouped] = await Promise.all([
      this.prisma.jobApplication.findMany({ where, include: { candidate: true, job: { select: { title: true } } }, orderBy: [{ stageChangedAt: 'desc' }], take: 500 }),
      this.prisma.jobApplication.groupBy({ by: ['stage'], where: base, _count: { _all: true } }),
    ]);
    const by = Object.fromEntries(grouped.map((g) => [g.stage, g._count._all])) as Partial<Record<ApplicationStage, number>>;
    const sum = (s: ApplicationStage[]) => s.reduce((a, k) => a + (by[k] ?? 0), 0);
    const items: CandidateRow[] = apps.map((a) => ({
      applicationId: a.id,
      candidateId: a.candidateId,
      name: a.candidate.fullName,
      email: a.candidate.email,
      appliedFor: a.job.title,
      jobId: a.jobId,
      source: a.candidate.source,
      sourceLabel: CANDIDATE_SOURCE_LABELS[a.candidate.source],
      score: a.score,
      stage: a.stage,
      stageLabel: STAGE_LABEL[a.stage],
      resumeFileId: a.candidate.resumeFileId,
    }));
    return {
      items,
      counts: {
        all: grouped.reduce((s, g) => s + g._count._all, 0),
        screening: sum(['SCREENING']),
        interview: sum(['INTERVIEW']),
        offered: sum(['OFFERED', 'HIRED']),
        rejected: sum(['REJECTED', 'OFFER_DECLINED', 'WITHDRAWN']),
      },
      canManage: this.canManage(),
    };
  }

  async detail(candidateId: string): Promise<CandidateDetail> {
    const c = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        applications: {
          include: {
            job: { select: { title: true, departmentId: true, hiringManagerId: true } },
            offer: true,
            events: { orderBy: { at: 'asc' } },
            interviews: { include: { panelists: true, scorecards: true }, orderBy: { startsAt: 'asc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!c || c.anonymisedAt) throw notFound('Candidate');
    const scope = await this.jobScope();
    if (scope) {
      const me = requireContext().employeeId;
      const dept = me ? (await this.prisma.employee.findUnique({ where: { id: me }, select: { departmentId: true } }))?.departmentId : null;
      c.applications = c.applications.filter((a) => a.job.hiringManagerId === me || (!!dept && a.job.departmentId === dept));
      if (!c.applications.length) throw notFound('Candidate');
    }
    const empIds = c.applications.flatMap((a) => a.interviews.flatMap((i) => [...i.panelists.map((p) => p.employeeId), ...i.scorecards.map((s) => s.interviewerEmployeeId)]));
    const names = new Map((await this.prisma.employee.findMany({ where: { id: { in: [...new Set(empIds)] } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
    return {
      id: c.id,
      fullName: c.fullName,
      email: c.email,
      phone: c.phone,
      location: c.location,
      source: c.source,
      sourceLabel: CANDIDATE_SOURCE_LABELS[c.source],
      tags: c.tags,
      resumeFileId: c.resumeFileId,
      currentCtcPaise: c.currentCtcPaise,
      expectedCtcPaise: c.expectedCtcPaise,
      noticePeriodDays: c.noticePeriodDays,
      applications: c.applications.map((a) => ({
        id: a.id,
        jobId: a.jobId,
        jobTitle: a.job.title,
        stage: a.stage,
        stageLabel: STAGE_LABEL[a.stage],
        score: a.score,
        employeeId: a.employeeId,
        offer: a.offer
          ? {
              annualCtcPaise: a.offer.annualCtcPaise,
              joiningDate: dbDateKey(a.offer.joiningDate)!,
              expiresOn: dbDateKey(a.offer.expiresOn)!,
              status: a.offer.status,
              designationId: a.offer.designationId,
              departmentId: a.offer.departmentId,
              branchId: a.offer.branchId,
              employmentType: a.offer.employmentType,
            }
          : null,
        events: a.events.map((e) => ({ from: e.from, to: e.to, by: e.byName, reason: e.reason, at: e.at.toISOString() })),
        interviews: a.interviews.map((i) => ({
          id: i.id,
          round: i.roundName,
          when: fmtWhen(i.startsAt),
          interviewer: names.get(i.panelists.find((p) => p.role === 'LEAD')?.employeeId ?? i.panelists[0]?.employeeId ?? '') ?? '—',
          result: i.status === 'CANCELLED' ? 'CANCELLED' : i.result,
          scores: i.scorecards.map((s) => ({ by: names.get(s.interviewerEmployeeId) ?? '—', overall: s.overall, recommendation: s.recommendation, status: s.status })),
        })),
      })),
      canManage: this.canManage(),
      canHire: hasPerm(requireContext(), 'employees.manage'),
    };
  }

  // ── Create / stage changes ───────────────────────────────────────────────

  private async event(applicationId: string, from: ApplicationStage | null, to: ApplicationStage, reason?: string | null) {
    await this.prisma.jobApplicationEvent.create({
      data: { applicationId, from, to, reason: reason ?? null, byName: requireContext().userName ?? null } as Prisma.JobApplicationEventUncheckedCreateInput,
    });
  }

  async create(i: CandidateInput) {
    this.assertManage();
    const job = await this.prisma.job.findUnique({ where: { id: i.jobId } });
    if (!job) throw badRequest('Pick the job applied for', 'JOB_INVALID');
    if (job.status === 'CLOSED') throw conflict(`${job.title} is closed for applications`, 'JOB_CLOSED');
    const file = await this.prisma.fileObject.findUnique({ where: { id: i.resumeFileId } });
    if (!file) throw badRequest('Attach the resume', 'FILE_MISSING');
    const tags = (i.tags ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10);
    const existing = await this.prisma.candidate.findFirst({ where: { email: i.email } });
    let candidateId: string;
    if (existing) {
      if (existing.anonymisedAt) throw conflict('This candidate asked to be forgotten; add them as a new record later', 'ANONYMISED');
      if (await this.prisma.jobApplication.findFirst({ where: { candidateId: existing.id, jobId: job.id } })) throw conflict(`${existing.fullName} has already applied for ${job.title}`, 'DUPLICATE_APPLICATION');
      await this.prisma.candidate.update({ where: { id: existing.id }, data: { phone: i.phone, resumeFileId: i.resumeFileId, source: i.source, tags: [...new Set([...existing.tags, ...tags])] } });
      candidateId = existing.id;
    } else {
      const c = await this.prisma.candidate.create({
        data: {
          fullName: i.fullName,
          email: i.email,
          phone: i.phone,
          location: i.location ?? null,
          source: i.source,
          referredByEmployeeId: i.referredByEmployeeId ?? null,
          currentCtcPaise: i.currentCtcPaise ?? null,
          expectedCtcPaise: i.expectedCtcPaise ?? null,
          noticePeriodDays: i.noticePeriodDays ?? null,
          totalExpMonths: i.totalExpYears != null ? Math.round(i.totalExpYears * 12) : null,
          tags,
          resumeFileId: i.resumeFileId,
          consentAt: i.consent ? new Date() : null,
          retentionUntil: toDbDate(addDays(todayKey(), 730)),
        } as Prisma.CandidateUncheckedCreateInput,
      });
      candidateId = c.id;
    }
    const app = await this.prisma.jobApplication.create({ data: { candidateId, jobId: job.id, stage: 'SCREENING' } as Prisma.JobApplicationUncheckedCreateInput });
    await this.event(app.id, null, 'SCREENING', 'Added');
    await this.audit.record({ action: 'candidate.added', entity: 'Candidate', entityId: candidateId, meta: { jobId: job.id, source: i.source } });
    if (job.hiringManagerId) {
      await this.notify.notify({ userIds: await this.notify.usersForEmployees([job.hiringManagerId]), type: 'people.newApplicant', title: `New applicant for ${job.title}: ${i.fullName}`, link: `/candidates?candidate=${candidateId}`, from: 'Recruitment' });
    }
    return { candidateId, applicationId: app.id };
  }

  async addApplication(candidateId: string, jobId: string) {
    this.assertManage();
    const [c, job] = await Promise.all([this.prisma.candidate.findUnique({ where: { id: candidateId } }), this.prisma.job.findUnique({ where: { id: jobId } })]);
    if (!c || c.anonymisedAt) throw notFound('Candidate');
    if (!job || job.status === 'CLOSED') throw badRequest('Pick an open job', 'JOB_INVALID');
    if (await this.prisma.jobApplication.findFirst({ where: { candidateId, jobId } })) throw conflict(`${c.fullName} has already applied for ${job.title}`, 'DUPLICATE_APPLICATION');
    const app = await this.prisma.jobApplication.create({ data: { candidateId, jobId, stage: 'SCREENING' } as Prisma.JobApplicationUncheckedCreateInput });
    await this.event(app.id, null, 'SCREENING', 'Considered for another job');
    await this.audit.record({ action: 'candidate.applied', entity: 'JobApplication', entityId: app.id, meta: { jobId } });
    return this.detail(candidateId);
  }

  async moveStage(applicationId: string, to: ApplicationStage, reason?: string | null) {
    this.assertManage();
    const a = await this.prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { candidate: true } });
    if (!a) throw notFound('Application');
    if (a.stage === to) return this.detail(a.candidateId);
    if (to === 'HIRED') throw new AppError(409, 'USE_HIRE', 'Use “Hire” to convert the candidate into an employee');
    if (!canMoveStage(a.stage, to)) throw new AppError(409, 'INVALID_TRANSITION', `Cannot move from ${STAGE_LABEL[a.stage]} to ${STAGE_LABEL[to]}`);
    if (to === 'REJECTED' && !reason?.trim()) throw badRequest('Give a rejection reason', 'REASON_REQUIRED');
    await this.prisma.jobApplication.update({ where: { id: applicationId }, data: { stage: to, stageChangedAt: new Date(), rejectReason: to === 'REJECTED' ? reason!.trim() : null } });
    if (to === 'OFFER_DECLINED') await this.prisma.jobOffer.updateMany({ where: { applicationId }, data: { status: 'DECLINED' } });
    if (to === 'WITHDRAWN' || to === 'REJECTED') await this.prisma.jobOffer.updateMany({ where: { applicationId, status: { in: ['DRAFT', 'ISSUED'] } }, data: { status: 'WITHDRAWN' } });
    await this.event(applicationId, a.stage, to, reason);
    await this.audit.record({ action: 'candidate.stage_changed', entity: 'JobApplication', entityId: applicationId, meta: { from: a.stage, to, reason: reason ?? null } });
    return this.detail(a.candidateId);
  }

  /** Recompute the application score from submitted scorecards (average overall /10). */
  async recomputeScore(applicationId: string) {
    const cards = await this.prisma.interviewScorecard.findMany({ where: { interview: { applicationId, status: { not: 'CANCELLED' } }, status: 'SUBMITTED' }, select: { overall: true } });
    const score = applicationScore(cards.map((c) => c.overall));
    await this.prisma.jobApplication.update({ where: { id: applicationId }, data: { score } });
    return score;
  }

  // ── Offer & hire ─────────────────────────────────────────────────────────

  async saveOffer(applicationId: string, i: JobOfferInput) {
    this.assertManage();
    const a = await this.prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { candidate: true, job: true } });
    if (!a) throw notFound('Application');
    if (!['SCREENING', 'INTERVIEW', 'OFFERED'].includes(a.stage)) throw new AppError(409, 'INVALID_STAGE', `Cannot make an offer at stage ${STAGE_LABEL[a.stage]}`);
    if (i.expiresOn < todayKey()) throw badRequest('The offer expiry must be in the future');
    const data = {
      designationId: i.designationId ?? a.job.designationId ?? null,
      departmentId: i.departmentId ?? a.job.departmentId,
      branchId: i.branchId ?? a.job.branchId ?? null,
      employmentType: i.employmentType,
      annualCtcPaise: i.annualCtcPaise,
      joiningDate: toDbDate(i.joiningDate),
      expiresOn: toDbDate(i.expiresOn),
      status: 'ISSUED' as const,
    };
    await this.prisma.jobOffer.upsert({ where: { applicationId }, create: { applicationId, ...data } as Prisma.JobOfferUncheckedCreateInput, update: data });
    if (a.stage !== 'OFFERED') {
      await this.prisma.jobApplication.update({ where: { id: applicationId }, data: { stage: 'OFFERED', stageChangedAt: new Date() } });
      await this.event(applicationId, a.stage, 'OFFERED', `Offer ${inrPdf(i.annualCtcPaise)} p.a.`);
    }
    const t = await this.prisma.raw.tenant.findUnique({ where: { id: requireContext().tenantId } });
    const company = t?.name ?? 'Lexisora';
    await this.mail.send({
      to: a.candidate.email,
      subject: `Offer from ${company} · ${a.job.title}`,
      text: `Hi ${a.candidate.fullName},\n\nWe are delighted to offer you the role of ${a.job.title} at ${company} with an annual CTC of ${inrPdf(i.annualCtcPaise)}, joining on ${fmt(i.joiningDate)}.\n\nThis offer is valid until ${fmt(i.expiresOn)}. Once you accept, you will receive an invite to sign the formal offer letter online.\n\n— ${company} HR`,
      html: `<p>Hi ${escapeHtml(a.candidate.fullName)},</p><p>We are delighted to offer you the role of <b>${escapeHtml(a.job.title)}</b> at ${escapeHtml(company)} with an annual CTC of <b>${inrPdf(i.annualCtcPaise)}</b>, joining on ${fmt(i.joiningDate)}.</p><p>This offer is valid until ${fmt(i.expiresOn)}. Once you accept, you will receive an invite to sign the formal offer letter online.</p><p>— ${escapeHtml(company)} HR</p>`,
    });
    await this.audit.record({ action: 'offer.issued', entity: 'JobApplication', entityId: applicationId, meta: { annualCtcPaise: i.annualCtcPaise, joiningDate: i.joiningDate } });
    return this.detail(a.candidateId);
  }

  /** "Hire": candidate → employee (User INVITED + Employee + onboarding), application HIRED. */
  async hire(applicationId: string, i: HireInput) {
    const ctx = requireContext();
    if (!hasPerm(ctx, 'employees.manage')) throw forbidden('Only HR can hire');
    const a = await this.prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { candidate: true, job: true, offer: true } });
    if (!a) throw notFound('Application');
    if (a.employeeId || a.stage === 'HIRED') throw conflict(`${a.candidate.fullName} is already hired`, 'ALREADY_HIRED');
    if (a.stage !== 'OFFERED' && a.stage !== 'INTERVIEW') throw new AppError(409, 'INVALID_STAGE', 'Make an offer before hiring');
    const departmentId = i.departmentId ?? a.offer?.departmentId ?? a.job.departmentId;
    const designationId = i.designationId ?? a.offer?.designationId ?? a.job.designationId;
    if (!designationId) throw badRequest('Pick a designation', 'DESIGNATION_REQUIRED');
    const joiningDate = i.joiningDate ?? dbDateKey(a.offer?.joiningDate) ?? addDays(todayKey(), 7);
    const employmentType = (a.offer?.employmentType as 'FULL_TIME' | 'INTERN' | 'CONTRACT' | undefined) ?? (a.job.jobType === 'INTERNSHIP' ? 'INTERN' : a.job.jobType === 'CONTRACT' ? 'CONTRACT' : 'FULL_TIME');
    const res = await this.employees.create(
      {
        fullName: a.candidate.fullName,
        officialEmail: i.officialEmail,
        personalEmail: a.candidate.email,
        phone: a.candidate.phone,
        departmentId,
        designationId,
        managerId: i.managerId ?? a.job.hiringManagerId ?? null,
        employmentType,
        workMode: i.workMode,
        joiningDate,
        shiftId: i.shiftId ?? null,
        branchId: a.offer?.branchId ?? a.job.branchId ?? null,
        skipOnboarding: false,
        sendInvite: true,
      },
      { sourceApplicationId: a.id, resumeFileId: a.candidate.resumeFileId },
    );
    await this.prisma.jobApplication.update({ where: { id: a.id }, data: { stage: 'HIRED', stageChangedAt: new Date(), employeeId: res.employee.id } });
    if (a.offer) await this.prisma.jobOffer.update({ where: { id: a.offer.id }, data: { employeeId: res.employee.id } });
    else {
      await this.prisma.jobOffer.create({
        data: { applicationId: a.id, designationId, departmentId, branchId: a.job.branchId, employmentType, annualCtcPaise: a.candidate.expectedCtcPaise ?? 0, joiningDate: toDbDate(joiningDate), expiresOn: toDbDate(joiningDate), status: 'ISSUED', employeeId: res.employee.id } as Prisma.JobOfferUncheckedCreateInput,
      });
    }
    await this.event(a.id, a.stage, 'HIRED', `Employee ${res.employee.empCode}`);
    const hired = await this.prisma.jobApplication.count({ where: { jobId: a.jobId, stage: 'HIRED' } });
    if (hired >= a.job.openings && a.job.status !== 'CLOSED') {
      await this.prisma.job.update({ where: { id: a.jobId }, data: { status: 'CLOSED', closedAt: new Date(), closeReason: 'FILLED' } });
      await this.audit.record({ action: 'job.closed', entity: 'Job', entityId: a.jobId, meta: { reason: 'FILLED' } });
    }
    await this.audit.record({ action: 'candidate.hired', entity: 'JobApplication', entityId: a.id, meta: { employeeId: res.employee.id, empCode: res.employee.empCode } });
    return { ...res, candidateId: a.candidateId };
  }

  /** DPDP: anonymise a candidate on request (keeps aggregate pipeline numbers). */
  async anonymise(candidateId: string) {
    this.assertManage();
    const c = await this.prisma.candidate.findUnique({ where: { id: candidateId }, include: { applications: true } });
    if (!c) throw notFound('Candidate');
    if (c.applications.some((a) => a.stage === 'HIRED')) throw conflict('Hired candidates are kept on the employee record', 'HIRED');
    await this.prisma.candidate.update({ where: { id: candidateId }, data: { fullName: 'Anonymised candidate', email: `anon-${candidateId}@invalid.local`, phone: '0000000000', location: null, resumeFileId: null, notes: null, tags: [], anonymisedAt: new Date() } });
    await this.audit.record({ action: 'candidate.anonymised', entity: 'Candidate', entityId: candidateId });
    return { ok: true };
  }

  /**
   * DPDP retention (daily job): candidates whose retentionUntil has passed are anonymised.
   * Hired candidates are kept (their data lives on the employee record). Runs without a user.
   */
  async retentionSweep(today = todayKey()): Promise<number> {
    const due = await this.prisma.candidate.findMany({ where: { anonymisedAt: null, retentionUntil: { lt: toDbDate(today) }, applications: { none: { stage: 'HIRED' } } }, select: { id: true }, take: 500 });
    for (const c of due) {
      await this.prisma.candidate.update({ where: { id: c.id }, data: { fullName: 'Anonymised candidate', email: `anon-${c.id}@invalid.local`, phone: '0000000000', location: null, currentCompany: null, resumeFileId: null, notes: null, tags: [], anonymisedAt: new Date() } });
      await this.audit.record({ action: 'candidate.anonymised', entity: 'Candidate', entityId: c.id, meta: { reason: 'RETENTION_EXPIRED' } });
    }
    return due.length;
  }

  async lookupOptions() {
    const ctx = requireContext();
    if (!hasPerm(ctx, 'candidates.view') && !hasPerm(ctx, 'candidates.manage') && !hasPerm(ctx, 'jobs.manage')) return [];
    const scope = await this.jobScope();
    const apps = await this.prisma.jobApplication.findMany({ where: { stage: { in: ['SCREENING', 'INTERVIEW', 'OFFERED'] }, candidate: { anonymisedAt: null }, ...(scope ? { job: scope } : {}) }, include: { candidate: { select: { fullName: true } }, job: { select: { title: true } } }, orderBy: { stageChangedAt: 'desc' }, take: 300 });
    return apps.map((a) => ({ value: a.id, label: `${a.candidate.fullName} · ${a.job.title}` }));
  }
}
