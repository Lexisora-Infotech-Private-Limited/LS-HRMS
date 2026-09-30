import { Injectable } from '@nestjs/common';
import type { Job, JobStatus, Prisma } from '@prisma/client';
import { JOB_TYPE_LABELS, type JobInput, type JobRow } from '@lexisora/shared';
import { AuditService } from '../../../core/audit/audit.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, notFound } from '../../../core/http/errors';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SequenceService } from '../../../core/registry/sequence.service';

const STATUS_LABEL: Record<JobStatus, string> = { DRAFT: 'Draft', OPEN: 'Open', ON_HOLD: 'On hold', CLOSED: 'Closed' };
const JOB_FLOW: Record<JobStatus, JobStatus[]> = { DRAFT: ['OPEN', 'CLOSED'], OPEN: ['ON_HOLD', 'CLOSED'], ON_HOLD: ['OPEN', 'CLOSED'], CLOSED: ['OPEN'] };

/** Jobs (M6): Open (incl. drafts and on hold) / Closed tabs, applicant counts. */
@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  private async rows(jobs: Job[]): Promise<JobRow[]> {
    const ids = jobs.map((j) => j.id);
    const [depts, branches, apps, hired] = await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: jobs.map((j) => j.departmentId) } }, select: { id: true, name: true } }),
      this.prisma.branch.findMany({ where: { id: { in: jobs.map((j) => j.branchId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      this.prisma.jobApplication.groupBy({ by: ['jobId'], where: { jobId: { in: ids } }, _count: { _all: true } }),
      this.prisma.jobApplication.groupBy({ by: ['jobId'], where: { jobId: { in: ids }, stage: 'HIRED' }, _count: { _all: true } }),
    ]);
    const dm = new Map(depts.map((d) => [d.id, d.name]));
    const bm = new Map(branches.map((d) => [d.id, d.name]));
    const am = new Map(apps.map((a) => [a.jobId, a._count._all]));
    const hm = new Map(hired.map((a) => [a.jobId, a._count._all]));
    return jobs.map((j) => ({
      id: j.id,
      code: j.code,
      title: j.title,
      department: dm.get(j.departmentId) ?? '—',
      departmentId: j.departmentId,
      jobType: j.jobType,
      typeLabel: JOB_TYPE_LABELS[j.jobType],
      openings: j.openings,
      branch: j.branchId ? (bm.get(j.branchId) ?? '—') : '—',
      applicants: am.get(j.id) ?? 0,
      hired: hm.get(j.id) ?? 0,
      status: j.status,
      statusLabel: STATUS_LABEL[j.status],
      description: j.description,
    }));
  }

  async list(tab: 'open' | 'closed' = 'open') {
    const where: Prisma.JobWhereInput = tab === 'closed' ? { status: 'CLOSED' } : { status: { not: 'CLOSED' } };
    const [jobs, open, closed] = await Promise.all([
      this.prisma.job.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.job.count({ where: { status: 'OPEN' } }),
      this.prisma.job.count({ where: { status: 'CLOSED' } }),
    ]);
    return { items: await this.rows(jobs), counts: { open, closed } };
  }

  async detail(id: string) {
    const j = await this.prisma.job.findUnique({ where: { id } });
    if (!j) throw notFound('Job');
    const [row] = await this.rows([j]);
    const stages = await this.prisma.jobApplication.groupBy({ by: ['stage'], where: { jobId: id }, _count: { _all: true } });
    return { ...row!, designationId: j.designationId, branchId: j.branchId, experienceMinYrs: j.experienceMinYrs, experienceMaxYrs: j.experienceMaxYrs, hiringManagerId: j.hiringManagerId, roundNames: j.roundNames, pipeline: Object.fromEntries(stages.map((s) => [s.stage, s._count._all])) };
  }

  private async validate(i: JobInput) {
    if (!(await this.prisma.department.findUnique({ where: { id: i.departmentId } }))) throw badRequest('Pick a department');
    if (i.branchId && !(await this.prisma.branch.findUnique({ where: { id: i.branchId } }))) throw badRequest('Pick a branch');
    if (i.experienceMinYrs != null && i.experienceMaxYrs != null && i.experienceMaxYrs < i.experienceMinYrs) throw badRequest('Maximum experience must be at least the minimum');
  }

  async create(i: JobInput) {
    await this.validate(i);
    const code = await this.seq.next('recruitment.job', { prefix: 'JOB-', pad: 4 });
    const j = await this.prisma.job.create({
      data: {
        code,
        title: i.title,
        departmentId: i.departmentId,
        designationId: i.designationId ?? null,
        jobType: i.jobType,
        openings: i.openings,
        branchId: i.branchId ?? null,
        description: i.description ?? null,
        experienceMinYrs: i.experienceMinYrs ?? null,
        experienceMaxYrs: i.experienceMaxYrs ?? null,
        hiringManagerId: i.hiringManagerId ?? null,
        roundNames: i.roundNames,
        status: i.status,
        publishedAt: i.status === 'OPEN' ? new Date() : null,
      } as Prisma.JobUncheckedCreateInput,
    });
    await this.audit.record({ action: 'job.created', entity: 'Job', entityId: j.id, meta: { code, title: i.title, status: i.status } });
    return this.detail(j.id);
  }

  async update(id: string, i: JobInput) {
    const j = await this.prisma.job.findUnique({ where: { id } });
    if (!j) throw notFound('Job');
    await this.validate(i);
    await this.prisma.job.update({
      where: { id },
      data: {
        title: i.title,
        departmentId: i.departmentId,
        designationId: i.designationId ?? null,
        jobType: i.jobType,
        openings: i.openings,
        branchId: i.branchId ?? null,
        description: i.description ?? null,
        experienceMinYrs: i.experienceMinYrs ?? null,
        experienceMaxYrs: i.experienceMaxYrs ?? null,
        hiringManagerId: i.hiringManagerId ?? null,
        roundNames: i.roundNames,
      },
    });
    await this.audit.record({ action: 'job.updated', entity: 'Job', entityId: id });
    return this.detail(id);
  }

  async setStatus(id: string, status: JobStatus, reason?: string | null) {
    const j = await this.prisma.job.findUnique({ where: { id } });
    if (!j) throw notFound('Job');
    if (j.status === status) return this.detail(id);
    if (!JOB_FLOW[j.status].includes(status)) throw new AppError(409, 'INVALID_TRANSITION', `A ${STATUS_LABEL[j.status].toLowerCase()} job cannot be moved to ${STATUS_LABEL[status].toLowerCase()}`);
    await this.prisma.job.update({
      where: { id },
      data: { status, closedAt: status === 'CLOSED' ? new Date() : null, closeReason: status === 'CLOSED' ? (reason ?? 'CANCELLED') : null, publishedAt: status === 'OPEN' ? (j.publishedAt ?? new Date()) : j.publishedAt },
    });
    await this.audit.record({ action: `job.${status.toLowerCase()}`, entity: 'Job', entityId: id, meta: { from: j.status, reason: reason ?? null, by: requireContext().userName ?? null } });
    return this.detail(id);
  }
}
