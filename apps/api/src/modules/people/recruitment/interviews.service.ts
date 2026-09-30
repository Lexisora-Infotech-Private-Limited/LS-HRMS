import { Injectable, Logger } from '@nestjs/common';
import type { Interview, InterviewPanelist, InterviewResult, InterviewScorecard, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  INTERVIEW_MODE_LABELS,
  type InterviewDetail,
  type InterviewRow,
  type ScheduleInterviewInput,
  type ScorecardInput,
} from '@lexisora/shared';
import { env } from '../../../config/env';
import { AuditService } from '../../../core/audit/audit.service';
import { hasPerm } from '../../../core/auth/decorators';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, forbidden, notFound } from '../../../core/http/errors';
import { MailService } from '../../../core/mail/mail.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { buildIcs, istDateTime, overallFromRatings, suggestResult } from '../people.rules';
import { fmtWhen, todayKey } from '../people.util';
import { CandidatesService } from './candidates.service';

const RESULT_LABEL: Record<string, string> = { PENDING: 'Pending', SELECTED: 'Selected', REJECTED: 'Rejected', ON_HOLD: 'On hold', CANCELLED: 'Cancelled' };
const DEFAULT_CRITERIA = [
  { key: 'problem_solving', label: 'Problem solving' },
  { key: 'technical_depth', label: 'Technical depth' },
  { key: 'communication', label: 'Communication' },
  { key: 'culture_fit', label: 'Culture fit' },
];

type Full = Interview & {
  panelists: InterviewPanelist[];
  scorecards: InterviewScorecard[];
  application: { id: string; candidateId: string; candidate: { fullName: string; email: string; resumeFileId: string | null }; job: { title: string } };
};

/** Interviews (M6): schedule with ICS invites, scorecards, results; panelists see their own (audit G2). */
@Injectable()
export class InterviewsService {
  private readonly log = new Logger('Interviews');

  constructor(
    private readonly prisma: PrismaService,
    private readonly candidates: CandidatesService,
    private readonly mail: MailService,
    private readonly notify: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private isRecruiter() {
    const ctx = requireContext();
    return hasPerm(ctx, 'candidates.manage') || hasPerm(ctx, 'jobs.manage');
  }

  private include = {
    panelists: true,
    scorecards: true,
    application: { select: { id: true, candidateId: true, candidate: { select: { fullName: true, email: true, resumeFileId: true } }, job: { select: { title: true } } } },
  } as const;

  private async names(ids: string[]) {
    return new Map((await this.prisma.employee.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
  }

  private row(i: Full, names: Map<string, string>, me: string | null | undefined): InterviewRow {
    const lead = i.panelists.find((p) => p.role === 'LEAD') ?? i.panelists[0];
    const mine = me ? i.scorecards.find((s) => s.interviewerEmployeeId === me) : undefined;
    const result = i.status === 'CANCELLED' ? 'CANCELLED' : i.result;
    return {
      id: i.id,
      candidate: i.application.candidate.fullName,
      candidateId: i.application.candidateId,
      applicationId: i.applicationId,
      jobTitle: i.application.job.title,
      round: i.roundName,
      interviewer: [lead ? names.get(lead.employeeId) : null, ...i.panelists.filter((p) => p !== lead).map((p) => names.get(p.employeeId))].filter(Boolean).join(', ') || '—',
      interviewerIds: i.panelists.map((p) => p.employeeId),
      startsAt: i.startsAt.toISOString(),
      when: fmtWhen(i.startsAt),
      mode: i.mode,
      modeLabel: INTERVIEW_MODE_LABELS[i.mode],
      status: i.status,
      result,
      resultLabel: RESULT_LABEL[result] ?? result,
      isPanelist: !!me && i.panelists.some((p) => p.employeeId === me),
      scorecardStatus: mine?.status ?? (me && i.panelists.some((p) => p.employeeId === me) ? 'NOT_STARTED' : null),
    };
  }

  async list(tab: 'upcoming' | 'past' | 'all' = 'all', mine?: boolean) {
    const ctx = requireContext();
    const me = ctx.employeeId;
    const recruiter = this.isRecruiter();
    const where: Prisma.InterviewWhereInput = {};
    if (!recruiter || mine) {
      if (!me) return { items: [], canManage: false, counts: { upcoming: 0, past: 0, all: 0 } };
      where.panelists = { some: { employeeId: me } };
    }
    const now = new Date();
    const tabWhere: Prisma.InterviewWhereInput = tab === 'upcoming' ? { startsAt: { gte: new Date(now.getTime() - 2 * 3600_000) }, status: 'SCHEDULED' } : tab === 'past' ? { OR: [{ startsAt: { lt: now } }, { status: { not: 'SCHEDULED' } }] } : {};
    const [rows, upcoming, all] = await Promise.all([
      this.prisma.interview.findMany({ where: { AND: [where, tabWhere] }, include: this.include, orderBy: { startsAt: tab === 'past' ? 'desc' : 'asc' }, take: 300 }),
      this.prisma.interview.count({ where: { AND: [where, { startsAt: { gte: new Date(now.getTime() - 2 * 3600_000) }, status: 'SCHEDULED' }] } }),
      this.prisma.interview.count({ where }),
    ]);
    const names = await this.names(rows.flatMap((r) => r.panelists.map((p) => p.employeeId)));
    return { items: rows.map((r) => this.row(r as Full, names, me)), canManage: recruiter, counts: { upcoming, past: all - upcoming, all } };
  }

  private async load(id: string): Promise<Full> {
    const i = await this.prisma.interview.findUnique({ where: { id }, include: this.include });
    if (!i) throw notFound('Interview');
    return i as Full;
  }

  private assertCanSee(i: Full) {
    const me = requireContext().employeeId;
    if (!this.isRecruiter() && !(me && i.panelists.some((p) => p.employeeId === me))) throw notFound('Interview');
  }

  private async criteriaFor(roundName: string) {
    const r = await this.prisma.interviewRound.findFirst({ where: { name: roundName } });
    const c = (r?.criteria as { key: string; label: string }[] | undefined) ?? [];
    return c.length ? c : DEFAULT_CRITERIA;
  }

  async detail(id: string): Promise<InterviewDetail> {
    const i = await this.load(id);
    this.assertCanSee(i);
    const me = requireContext().employeeId;
    const names = await this.names([...i.panelists.map((p) => p.employeeId), ...i.scorecards.map((s) => s.interviewerEmployeeId)]);
    const criteria = await this.criteriaFor(i.roundName);
    const my = me ? i.scorecards.find((s) => s.interviewerEmployeeId === me) : undefined;
    const recruiter = this.isRecruiter();
    return {
      ...this.row(i, names, me),
      durationMin: i.durationMin,
      notesToCandidate: i.notesToCandidate,
      candidateEmail: i.application.candidate.email,
      resumeFileId: i.application.candidate.resumeFileId,
      panelists: i.panelists.map((p) => {
        const sc = i.scorecards.find((s) => s.interviewerEmployeeId === p.employeeId);
        // Panelists see others' scorecards only after submitting their own (avoid anchoring).
        const visible = recruiter || my?.status === 'SUBMITTED' || p.employeeId === me;
        return { employeeId: p.employeeId, name: names.get(p.employeeId) ?? '—', role: p.role, scorecard: sc && visible ? { overall: sc.overall, recommendation: sc.recommendation, status: sc.status } : sc ? { overall: null, recommendation: null, status: sc.status } : null };
      }),
      myScorecard: my
        ? { ratings: (my.ratings as { key: string; label: string; rating: number | null; comment: string | null }[]) ?? [], overall: my.overall, recommendation: my.recommendation, notes: my.notes, status: my.status }
        : null,
      criteria,
      canManage: recruiter,
      suggestedResult: suggestResult(i.scorecards.filter((s) => s.status === 'SUBMITTED').map((s) => s.recommendation)),
      icsSequence: i.icsSequence,
    };
  }

  // ── Scheduling & ICS ─────────────────────────────────────────────────────

  private async sendInvites(i: Full, method: 'REQUEST' | 'CANCEL') {
    const ctx = requireContext();
    const t = await this.prisma.raw.tenant.findUnique({ where: { id: ctx.tenantId } });
    const company = t?.name ?? 'Lexisora';
    const panel = await this.prisma.employee.findMany({ where: { id: { in: i.panelists.map((p) => p.employeeId) } }, select: { fullName: true, officialEmail: true } });
    const organizerEmail = (ctx.userId && (await this.prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }))?.email) || env.MAIL_FROM.replace(/^.*<|>$/g, '');
    const summary = `${i.roundName} interview · ${i.application.candidate.fullName} · ${i.application.job.title}`;
    const location = i.mode === 'VIDEO' ? (i.location ?? `${env.WEB_ORIGIN}/calls/interview-${i.id}`) : i.mode === 'IN_OFFICE' ? (i.location ?? `${company} office`) : 'Phone call';
    const ics = buildIcs({
      uid: i.icsUid,
      sequence: i.icsSequence,
      method,
      start: i.startsAt,
      durationMin: i.durationMin,
      summary,
      description: [i.notesToCandidate, `Mode: ${INTERVIEW_MODE_LABELS[i.mode]}`].filter(Boolean).join('\n'),
      location,
      organizer: { name: `${company} Recruitment`, email: organizerEmail },
      attendees: [{ name: i.application.candidate.fullName, email: i.application.candidate.email }, ...panel.map((p) => ({ name: p.fullName, email: p.officialEmail }))],
    });
    const when = `${fmtWhen(i.startsAt)} IST · ${i.durationMin} min · ${INTERVIEW_MODE_LABELS[i.mode]}`;
    const cancel = method === 'CANCEL';
    const candidateOk = await this.mail.send({
      to: i.application.candidate.email,
      subject: `${cancel ? 'Cancelled: ' : ''}${i.roundName} interview with ${company} · ${fmtWhen(i.startsAt)}`,
      text: `Hi ${i.application.candidate.fullName},\n\n${cancel ? 'Your interview has been cancelled. We will be in touch to reschedule.' : `Your ${i.roundName} interview for ${i.application.job.title} is scheduled for ${when}.\nWhere: ${location}`}${i.notesToCandidate && !cancel ? `\n\n${i.notesToCandidate}` : ''}\n\n— ${company} Recruitment`,
      icalEvent: { filename: 'interview.ics', method, content: ics },
    });
    const panelOk = panel.length
      ? await this.mail.send({
          to: panel.map((p) => p.officialEmail),
          subject: `${cancel ? 'Cancelled: ' : ''}${summary}`,
          text: `${cancel ? 'This interview has been cancelled.' : `You are on the panel for ${i.application.candidate.fullName} (${i.application.job.title}), ${i.roundName}.\nWhen: ${when}\nWhere: ${location}\n\nOpen the scorecard: ${env.WEB_ORIGIN}/interviews?interview=${i.id}`}`,
          icalEvent: { filename: 'interview.ics', method, content: ics },
        })
      : true;
    if (candidateOk || panelOk) await this.prisma.interview.update({ where: { id: i.id }, data: { emailedAt: new Date() } });
    return candidateOk && panelOk;
  }

  async schedule(input: ScheduleInterviewInput) {
    if (!this.isRecruiter()) throw forbidden('Only recruiters can schedule interviews');
    const app = await this.prisma.jobApplication.findUnique({ where: { id: input.applicationId }, include: { candidate: true, job: true } });
    if (!app) throw badRequest('Pick the candidate', 'APPLICATION_INVALID');
    if (!['SCREENING', 'INTERVIEW'].includes(app.stage)) throw new AppError(409, 'INVALID_STAGE', `${app.candidate.fullName} is at ${app.stage.toLowerCase()} stage`);
    const startsAt = istDateTime(input.date, input.time);
    if (input.date < todayKey()) throw badRequest('Pick a date from today onwards');
    const panelIds = [...new Set([input.interviewerId, ...input.panelistIds])];
    const emps = await this.prisma.employee.findMany({ where: { id: { in: panelIds }, status: { not: 'EXITED' } }, select: { id: true } });
    if (emps.length !== panelIds.length) throw badRequest('Pick active interviewers', 'INTERVIEWER_INVALID');
    // Double-booking guard for the lead interviewer.
    const end = new Date(startsAt.getTime() + input.durationMin * 60_000);
    const clash = await this.prisma.interview.findFirst({
      where: { status: 'SCHEDULED', panelists: { some: { employeeId: input.interviewerId } }, startsAt: { lt: end, gte: new Date(startsAt.getTime() - 8 * 3600_000) } },
    });
    if (clash && new Date(clash.startsAt.getTime() + clash.durationMin * 60_000) > startsAt) throw new AppError(409, 'INTERVIEWER_BUSY', `The interviewer already has an interview at ${fmtWhen(clash.startsAt)}`);
    const seq = (await this.prisma.interview.count({ where: { applicationId: app.id } })) + 1;
    const tenantId = requireContext().tenantId;
    const created = await this.prisma.interview.create({
      data: {
        applicationId: app.id,
        roundName: input.roundName,
        sequence: seq,
        startsAt,
        durationMin: input.durationMin,
        mode: input.mode,
        notesToCandidate: input.notesToCandidate ?? null,
        icsUid: `${randomUUID()}@lexisora-hrms`,
        panelists: { create: panelIds.map((employeeId) => ({ tenantId, employeeId, role: employeeId === input.interviewerId ? 'LEAD' : 'PANELIST' })) },
      } as Prisma.InterviewUncheckedCreateInput,
    });
    if (app.stage === 'SCREENING') {
      await this.prisma.jobApplication.update({ where: { id: app.id }, data: { stage: 'INTERVIEW', stageChangedAt: new Date() } });
      await this.prisma.jobApplicationEvent.create({ data: { applicationId: app.id, from: 'SCREENING', to: 'INTERVIEW', byName: requireContext().userName ?? null, reason: `${input.roundName} scheduled` } as Prisma.JobApplicationEventUncheckedCreateInput });
    }
    const full = await this.load(created.id);
    const emailed = await this.sendInvites(full, 'REQUEST');
    await this.notify.notify({
      userIds: await this.notify.usersForEmployees(panelIds),
      type: 'people.interviewScheduled',
      title: `Interview: ${app.candidate.fullName} · ${input.roundName}`,
      body: `${fmtWhen(startsAt)} · ${INTERVIEW_MODE_LABELS[input.mode]} · ${app.job.title}`,
      link: `/interviews?interview=${created.id}`,
      from: 'Recruitment',
    });
    await this.audit.record({ action: 'interview.scheduled', entity: 'Interview', entityId: created.id, meta: { applicationId: app.id, round: input.roundName, startsAt: startsAt.toISOString(), emailed } });
    return { id: created.id, emailed };
  }

  async reschedule(id: string, date: string, time: string, durationMin?: number) {
    if (!this.isRecruiter()) throw forbidden();
    const i = await this.load(id);
    if (i.status !== 'SCHEDULED') throw new AppError(409, 'INVALID_STATUS', 'Only scheduled interviews can be moved');
    if (date < todayKey()) throw badRequest('Pick a date from today onwards');
    await this.prisma.interview.update({ where: { id }, data: { startsAt: istDateTime(date, time), durationMin: durationMin ?? i.durationMin, icsSequence: i.icsSequence + 1 } });
    const emailed = await this.sendInvites(await this.load(id), 'REQUEST');
    await this.audit.record({ action: 'interview.rescheduled', entity: 'Interview', entityId: id, meta: { date, time } });
    return { ok: true, emailed };
  }

  async cancel(id: string, reason?: string | null) {
    if (!this.isRecruiter()) throw forbidden();
    const i = await this.load(id);
    if (i.status !== 'SCHEDULED') throw new AppError(409, 'INVALID_STATUS', 'Only scheduled interviews can be cancelled');
    await this.prisma.interview.update({ where: { id }, data: { status: 'CANCELLED', icsSequence: i.icsSequence + 1 } });
    await this.sendInvites(await this.load(id), 'CANCEL');
    await this.audit.record({ action: 'interview.cancelled', entity: 'Interview', entityId: id, meta: { reason: reason ?? null } });
    return { ok: true };
  }

  // ── Scorecards & result ──────────────────────────────────────────────────

  async saveScorecard(id: string, input: ScorecardInput) {
    const me = requireContext().employeeId;
    const i = await this.load(id);
    if (!me || !i.panelists.some((p) => p.employeeId === me)) throw forbidden('Only panelists can score this interview');
    if (i.status === 'CANCELLED') throw new AppError(409, 'CANCELLED', 'This interview was cancelled');
    const existing = i.scorecards.find((s) => s.interviewerEmployeeId === me);
    if (existing?.status === 'SUBMITTED') throw new AppError(409, 'ALREADY_SUBMITTED', 'You have already submitted your scorecard');
    if (input.submit) {
      if (input.ratings.some((r) => r.rating == null)) throw badRequest('Rate every criterion before submitting', 'RATINGS_INCOMPLETE');
      if (!input.recommendation) throw badRequest('Pick a recommendation', 'RECOMMENDATION_REQUIRED');
      if (i.startsAt.getTime() > Date.now() + 15 * 60_000) throw new AppError(409, 'NOT_YET', 'You can submit the scorecard once the interview has started');
    }
    const overall = input.overall ?? overallFromRatings(input.ratings.map((r) => r.rating));
    const data = {
      ratings: input.ratings as unknown as Prisma.InputJsonValue,
      overall,
      recommendation: input.recommendation ?? null,
      notes: input.notes ?? null,
      status: input.submit ? 'SUBMITTED' : 'DRAFT',
      submittedAt: input.submit ? new Date() : null,
    };
    await this.prisma.interviewScorecard.upsert({
      where: { interviewId_interviewerEmployeeId: { interviewId: id, interviewerEmployeeId: me } },
      create: { interviewId: id, interviewerEmployeeId: me, ...data } as Prisma.InterviewScorecardUncheckedCreateInput,
      update: data,
    });
    if (input.submit) {
      await this.candidates.recomputeScore(i.applicationId);
      const all = await this.prisma.interviewScorecard.count({ where: { interviewId: id, status: 'SUBMITTED' } });
      if (all >= i.panelists.length) {
        await this.notify.notify({
          userIds: await this.notify.usersWithPermission('candidates.manage'),
          type: 'people.scorecardsIn',
          title: `All scorecards in: ${i.application.candidate.fullName} · ${i.roundName}`,
          link: `/interviews?interview=${id}`,
          from: 'Recruitment',
        });
      }
      await this.audit.record({ action: 'interview.scorecard_submitted', entity: 'Interview', entityId: id, meta: { overall, recommendation: input.recommendation } });
    }
    return this.detail(id);
  }

  async setResult(id: string, result: InterviewResult) {
    const me = requireContext().employeeId;
    const i = await this.load(id);
    const isLead = !!me && i.panelists.some((p) => p.employeeId === me && p.role === 'LEAD');
    if (!this.isRecruiter() && !isLead) throw forbidden('Only recruiters or the lead interviewer can record the result');
    if (i.status === 'CANCELLED') throw new AppError(409, 'CANCELLED', 'This interview was cancelled');
    await this.prisma.interview.update({ where: { id }, data: { result, status: result === 'PENDING' ? i.status : 'COMPLETED' } });
    await this.candidates.recomputeScore(i.applicationId);
    await this.audit.record({ action: 'interview.result', entity: 'Interview', entityId: id, meta: { result } });
    return this.detail(id);
  }

  async rounds() {
    const rows = await this.prisma.interviewRound.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }] });
    return rows.map((r) => ({ value: r.name, label: r.name }));
  }

  /** Dashboard "Awaiting your approval": scorecards I still owe for interviews that already happened. */
  async pendingScorecards(employeeId: string) {
    return this.prisma.interview.count({
      where: { status: { in: ['SCHEDULED', 'COMPLETED'] }, startsAt: { lt: new Date() }, panelists: { some: { employeeId } }, NOT: { scorecards: { some: { interviewerEmployeeId: employeeId, status: 'SUBMITTED' } } } },
    });
  }
}
