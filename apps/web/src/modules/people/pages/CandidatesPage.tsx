import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  APPLICATION_STAGE_LABELS,
  APPLICATION_STAGE_TRANSITIONS,
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_SOURCES,
  CANDIDATE_TABS,
  INTERVIEW_RECOMMENDATION_LABELS,
  INTERVIEW_RESULT_LABELS,
  formatINR,
  formatDate,
  formatTime,
  type ApplicationStage,
  type CandidateDetail,
  type CandidateInput,
  type CandidateRow,
} from '@lexisora/shared';
import { fileUrl } from '@/lib/api';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef } from '@/components/form';
import { DataTable, type Column } from '@/components/table';
import { ConfirmDialog, ErrorBlock, Loading, Modal, PageHeader, StatusTag, Tabs, Tag, type Tone } from '@/components/ui';
import { lookupsFor, peopleApi, peopleKeys, type CandidateTab } from '../api';
import { HireModal, OfferModal, RejectModal, ScheduleInterviewModal } from '../recruitment';
import '../people.css';

const TAB_LABELS: Record<CandidateTab, string> = { all: 'All', screening: 'Screening', interview: 'Interview', offered: 'Offered', rejected: 'Rejected' };

export const scoreText = (s: number | null | undefined) => (s == null ? '—' : `${s.toFixed(1)} / 10`);
/** Wireframe tones: screening/interview "!" outline, offered/hired "~" accent, closed-out stages "-" neutral. */
export const stageTone = (stage: string): Tone => (stage === 'OFFERED' || stage === 'HIRED' ? 'accent' : stage === 'SCREENING' || stage === 'INTERVIEW' ? 'outline' : 'neutral');

export default function CandidatesPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<CandidateTab>('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const jobId = params.get('job') ?? undefined;
  const openId = params.get('candidate');
  const list = useQuery({ queryKey: [...peopleKeys.candidates, tab, q, jobId ?? ''], queryFn: () => peopleApi.candidates({ tab, q: q || undefined, jobId }), placeholderData: (p) => p });
  const jobs = useQuery({ queryKey: ['lookups', 'people', 'jobs'], queryFn: () => lookupsFor(['jobs']), enabled: !!jobId });
  const c = list.data?.counts;
  const canManage = list.data?.canManage ?? false;
  const setOpen = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('candidate', id);
    else p.delete('candidate');
    setParams(p, { replace: true });
  };

  const columns: Column<CandidateRow>[] = [
    { key: 'n', header: 'Candidate', render: (r) => <div><div>{r.name}</div><div className="pp-sub">{r.email}</div></div> },
    { key: 'j', header: 'Applied for', render: (r) => r.appliedFor },
    { key: 's', header: 'Source', render: (r) => r.sourceLabel },
    { key: 'sc', header: 'Score', render: (r) => <span className="tnum">{scoreText(r.score)}</span> },
    { key: 'st', header: 'Stage', render: (r) => <Tag tone={stageTone(r.stage)}>{r.stageLabel}</Tag> },
    {
      key: 'r',
      header: 'Resume',
      render: (r) =>
        r.resumeFileId ? (
          <a className="tag tag-neutral" href={fileUrl(r.resumeFileId)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>PDF</a>
        ) : (
          <span className="faint">—</span>
        ),
    },
  ];
  const jobLabel = jobId ? jobs.data?.jobs?.find((j) => j.value === jobId)?.label : null;

  return (
    <div data-screen-label="Candidates & interview vault" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Candidates & interview vault"
        sub="Every applicant with resume, interview scores and final result, kept for future hiring."
        actions={
          canManage && (
            <>
              <button className="btn btn-secondary" onClick={() => setScheduling(true)}>Schedule interview</button>
              <button className="btn btn-primary" onClick={() => setAdding(true)}>Add candidate</button>
            </>
          )
        }
      />
      <div className="row-between" style={{ gap: 10 }}>
        <Tabs<CandidateTab> value={tab} onChange={setTab} tabs={CANDIDATE_TABS.map((t) => ({ value: t, label: `${TAB_LABELS[t]}${c ? ` · ${c[t]}` : ''}` }))} />
        <input className="input pp-search" placeholder="Search name, email or skill" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {jobId && (
        <div className="row" style={{ gap: 8 }}>
          <Tag tone="outline">Job: {jobLabel ?? 'selected job'}</Tag>
          <button className="btn btn-ghost btn-sm" onClick={() => { const p = new URLSearchParams(params); p.delete('job'); setParams(p); }}>Show all jobs</button>
        </div>
      )}
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={columns} rows={list.data?.items} loading={list.isLoading} rowKey={(r) => r.applicationId} onRowClick={(r) => setOpen(r.candidateId)} empty={q ? `No candidates match “${q}”.` : 'No candidates in this tab.'} />
      )}
      {adding && <AddCandidateModal onClose={() => setAdding(false)} onAdded={(id) => setOpen(id)} />}
      {scheduling && <ScheduleInterviewModal onClose={() => setScheduling(false)} />}
      {openId && <CandidateDrawer id={openId} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** FORMS.candidate (+ referral, CTC, notice, experience, consent). */
function AddCandidateModal({ onClose, onAdded }: { onClose: () => void; onAdded: (candidateId: string) => void }) {
  const lk = useQuery({ queryKey: ['lookups', 'people', 'candidate-form'], queryFn: () => lookupsFor(['jobs', 'employees']) });
  const save = useAction((b: CandidateInput) => peopleApi.addCandidate(b), { success: 'Candidate added', invalidate: [peopleKeys.candidates, peopleKeys.jobs, ['lookups']], onSuccess: (r) => onAdded(r.candidateId) });
  if (lk.isLoading) return null;
  const d = lk.data ?? {};
  const fields: FieldDef[] = [
    { name: 'fullName', label: 'Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'text', required: true, placeholder: '+91 98250 12345' },
    { name: 'jobId', label: 'Applied for', type: 'select', required: true, options: d.jobs ?? [] },
    { name: 'source', label: 'Source', type: 'select', required: true, options: CANDIDATE_SOURCES.map((s) => ({ value: s, label: CANDIDATE_SOURCE_LABELS[s] })) },
    { name: 'referredByEmployeeId', label: 'Referred by', type: 'select', options: d.employees ?? [], showIf: (v) => v.source === 'REFERRAL' },
    { name: 'currentCtcPaise', label: 'Current CTC (₹ a year)', type: 'money' },
    { name: 'expectedCtcPaise', label: 'Expected CTC (₹ a year)', type: 'money' },
    { name: 'noticePeriodDays', label: 'Notice period (days)', type: 'number' },
    { name: 'totalExpYears', label: 'Total experience (years)', type: 'number' },
    { name: 'location', label: 'Location', type: 'text', placeholder: 'Ahmedabad' },
    { name: 'tags', label: 'Skills / tags', type: 'text', placeholder: 'react, typescript' },
    { name: 'resumeFileId', label: 'Resume', type: 'file', span: 2, required: true, category: 'resume', accept: '.pdf,.doc,.docx,application/pdf' },
    { name: 'consent', label: 'Candidate agreed to be kept in the talent pool for 24 months', type: 'checkbox', span: 2 },
  ];
  return (
    <FormModal
      title="Add candidate"
      fields={fields}
      wide
      initial={{ source: 'LINKEDIN', consent: true }}
      onClose={onClose}
      onSubmit={(v) => save.mutateAsync({ ...(v as CandidateInput), consent: !!v.consent })}
    />
  );
}

type App = CandidateDetail['applications'][number];

function CandidateDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: peopleKeys.candidate(id), queryFn: () => peopleApi.candidate(id) });
  const [dialog, setDialog] = useState<null | { kind: 'schedule' | 'offer' | 'hire' | 'reject'; app: App } | { kind: 'apply' | 'anonymise' }>(null);
  const inv = [peopleKeys.candidates, peopleKeys.interviews, peopleKeys.jobs];
  const move = useAction(({ appId, to }: { appId: string; to: ApplicationStage }) => peopleApi.moveStage(appId, to, null), { success: (_r, a) => `Moved to ${APPLICATION_STAGE_LABELS[a.to].toLowerCase()}`, invalidate: inv });
  const anonymise = useAction(() => peopleApi.anonymise(id), { success: 'Candidate anonymised', invalidate: inv, onSuccess: onClose });
  const c = q.data;
  useEffect(() => {
    if (q.error) onClose();
  }, [q.error, onClose]);

  return (
    <Modal
      title={c?.fullName ?? 'Candidate'}
      wide
      onClose={onClose}
      actions={
        c?.canManage ? (
          <>
            <button className="btn btn-ghost" onClick={() => setDialog({ kind: 'anonymise' })}>Anonymise (DPDP)</button>
            <button className="btn btn-secondary" onClick={() => setDialog({ kind: 'apply' })}>Add to another job</button>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </>
        ) : (
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        )
      }
    >
      {!c ? (
        <Loading />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row-between" style={{ alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 4 }}>
              <div style={{ fontSize: 13.5 }}>{c.email} · {c.phone}{c.location ? ` · ${c.location}` : ''}</div>
              <div className="pp-sub">
                Source: {c.sourceLabel}
                {c.currentCtcPaise != null && ` · Current ${formatINR(c.currentCtcPaise)}`}
                {c.expectedCtcPaise != null && ` · Expects ${formatINR(c.expectedCtcPaise)}`}
                {c.noticePeriodDays != null && ` · Notice ${c.noticePeriodDays} days`}
              </div>
              {c.tags.length > 0 && (
                <div className="pp-tags">
                  {c.tags.map((t) => (
                    <Tag key={t} tone="neutral">{t}</Tag>
                  ))}
                </div>
              )}
            </div>
            {c.resumeFileId && (
              <a className="btn btn-secondary btn-sm" href={fileUrl(c.resumeFileId)} target="_blank" rel="noopener noreferrer">Open resume</a>
            )}
          </div>
          {c.applications.map((a) => {
            const allowed = APPLICATION_STAGE_TRANSITIONS[a.stage as ApplicationStage] ?? [];
            const canSchedule = a.stage === 'SCREENING' || a.stage === 'INTERVIEW';
            const canOffer = !a.employeeId && ['SCREENING', 'INTERVIEW', 'OFFERED'].includes(a.stage);
            const canHire = c.canHire && !a.employeeId && (a.stage === 'OFFERED' || a.stage === 'INTERVIEW');
            const moves = allowed.filter((s) => s !== 'HIRED' && s !== 'REJECTED' && s !== 'OFFERED');
            return (
              <div key={a.id} className="pp-app">
                <div className="row-between">
                  <div className="row" style={{ gap: 8 }}>
                    <strong style={{ fontWeight: 500 }}>{a.jobTitle}</strong>
                    <Tag tone={stageTone(a.stage)}>{a.stageLabel}</Tag>
                    <span className="tnum faint" style={{ fontSize: 13 }}>Score {scoreText(a.score)}</span>
                  </div>
                  {c.canManage && (
                    <div className="row" style={{ gap: 6 }}>
                      {a.employeeId && <button className="btn btn-secondary btn-sm" onClick={() => nav(`/employees/${a.employeeId}`)}>View employee</button>}
                      {canSchedule && <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'schedule', app: a })}>Schedule interview</button>}
                      {canOffer && <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'offer', app: a })}>{a.offer ? 'Edit offer' : 'Make offer'}</button>}
                      {canHire && <button className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'hire', app: a })}>Convert to employee</button>}
                      {allowed.includes('REJECTED') && <button className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'reject', app: a })}>Reject</button>}
                      {moves.length > 0 && (
                        <select
                          className="input"
                          style={{ width: 'auto', padding: '4px 8px', fontSize: 12.5 }}
                          value=""
                          aria-label="Move stage"
                          onChange={(e) => e.target.value && move.mutate({ appId: a.id, to: e.target.value as ApplicationStage })}
                        >
                          <option value="">Move to…</option>
                          {moves.map((s) => (
                            <option key={s} value={s}>{APPLICATION_STAGE_LABELS[s]}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
                {a.offer && (
                  <div className="pp-sub" style={{ marginTop: 6 }}>
                    Offer {formatINR(a.offer.annualCtcPaise)} a year · joining {formatDate(a.offer.joiningDate)} · valid until {formatDate(a.offer.expiresOn)} · {a.offer.status.toLowerCase()}
                  </div>
                )}
                {a.interviews.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="kicker" style={{ marginBottom: 4 }}>Interviews</div>
                    {a.interviews.map((i) => (
                      <div key={i.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => nav(`/interviews?interview=${i.id}`)}>
                        <span>
                          {i.round} · {i.when} · {i.interviewer}
                          {i.scores.filter((s) => s.status === 'SUBMITTED').map((s, k) => (
                            <span key={k} className="faint"> · {s.by}: {s.overall != null ? `${s.overall}/10` : '—'}{s.recommendation ? ` (${INTERVIEW_RECOMMENDATION_LABELS[s.recommendation as keyof typeof INTERVIEW_RECOMMENDATION_LABELS] ?? s.recommendation})` : ''}</span>
                          ))}
                        </span>
                        <StatusTag status={i.result} label={INTERVIEW_RESULT_LABELS[i.result] ?? i.result} />
                      </div>
                    ))}
                  </div>
                )}
                {a.events.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="kicker" style={{ marginBottom: 4 }}>Stage history</div>
                    <div className="pp-history">
                      {a.events.map((e, k) => (
                        <div key={k} className="pp-history-row">
                          <span className="faint tnum">{formatDate(e.at)} {formatTime(e.at)}</span>
                          <span>
                            {e.from ? `${APPLICATION_STAGE_LABELS[e.from as ApplicationStage] ?? e.from} → ` : ''}
                            {APPLICATION_STAGE_LABELS[e.to as ApplicationStage] ?? e.to}
                            {e.reason ? <span className="faint"> · {e.reason}</span> : null}
                            {e.by ? <span className="faint"> · {e.by}</span> : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {c && dialog?.kind === 'schedule' && <ScheduleInterviewModal applicationId={dialog.app.id} onClose={() => setDialog(null)} />}
      {c && dialog?.kind === 'offer' && <OfferModal app={dialog.app} onClose={() => setDialog(null)} />}
      {c && dialog?.kind === 'hire' && <HireModal candidate={c} app={dialog.app} onClose={() => setDialog(null)} />}
      {c && dialog?.kind === 'reject' && <RejectModal app={dialog.app} onClose={() => setDialog(null)} />}
      {c && dialog?.kind === 'apply' && <ApplyModal candidate={c} onClose={() => setDialog(null)} />}
      {c && dialog?.kind === 'anonymise' && (
        <ConfirmDialog
          title={`Anonymise ${c.fullName}?`}
          body="Name, email, phone and resume are erased on the candidate's request (DPDP). Scores and pipeline counts are kept. This cannot be undone."
          confirmLabel="Anonymise"
          danger
          busy={anonymise.isPending}
          onConfirm={() => anonymise.mutate(undefined)}
          onClose={() => setDialog(null)}
        />
      )}
    </Modal>
  );
}

function ApplyModal({ candidate, onClose }: { candidate: CandidateDetail; onClose: () => void }) {
  const lk = useQuery({ queryKey: ['lookups', 'people', 'jobs'], queryFn: () => lookupsFor(['jobs']) });
  const save = useAction((jobId: string) => peopleApi.addApplication(candidate.id, jobId), { success: 'Added to the job', invalidate: [peopleKeys.candidates, peopleKeys.jobs] });
  if (lk.isLoading) return null;
  const taken = new Set(candidate.applications.map((a) => a.jobId));
  const options = (lk.data?.jobs ?? []).filter((j) => !taken.has(j.value));
  return (
    <FormModal
      title={`Consider ${candidate.fullName} for another job`}
      fields={[{ name: 'jobId', label: 'Job', type: 'select', span: 2, required: true, options }]}
      submitLabel="Add to job"
      intro={!options.length ? <span className="faint">They have applied for every open job already.</span> : undefined}
      onClose={onClose}
      onSubmit={(v) => save.mutateAsync(String(v.jobId))}
    />
  );
}
