import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { INTERVIEW_RECOMMENDATION_LABELS, RECOMMENDATIONS, type InterviewDetail, type InterviewRow, type ScorecardInput } from '@lexisora/shared';
import { fileUrl } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { FormModal } from '@/components/form';
import { DataTable, type Column } from '@/components/table';
import { ErrorBlock, Loading, Modal, PageHeader, Pills, StatusTag, Tabs, Tag } from '@/components/ui';
import { peopleApi, peopleKeys, type InterviewTab } from '../api';
import { todayKey } from '../components';
import { PromptModal, ScheduleInterviewModal } from '../recruitment';
import '../people.css';

const TAB_LABELS: Record<InterviewTab, string> = { upcoming: 'Upcoming', past: 'Past', all: 'All' };
const istDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
const istTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/**
 * Interviews. Recruiters see everything in scope; leads, managers and any employee sitting on a
 * panel see their own interviews here even without the nav item (audit G2).
 */
export default function InterviewsPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<InterviewTab>('all');
  const [mine, setMine] = useState<'all' | 'mine'>('all');
  const [scheduling, setScheduling] = useState(false);
  const openId = params.get('interview');
  const list = useQuery({ queryKey: [...peopleKeys.interviews, tab, mine], queryFn: () => peopleApi.interviews(tab, mine === 'mine'), placeholderData: (p) => p });
  const canManage = list.data?.canManage ?? false;
  const c = list.data?.counts;
  const setOpen = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('interview', id);
    else p.delete('interview');
    setParams(p, { replace: true });
  };
  // "All": upcoming first (soonest first), then past (latest first) — as the wireframe lists them.
  const rows = useMemo(() => {
    const items = list.data?.items ?? [];
    if (tab !== 'all') return items;
    const now = Date.now();
    const up = items.filter((i) => i.status === 'SCHEDULED' && new Date(i.startsAt).getTime() >= now - 2 * 3600_000).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const past = items.filter((i) => !up.includes(i)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    return [...up, ...past];
  }, [list.data, tab]);

  const columns: Column<InterviewRow>[] = [
    { key: 'c', header: 'Candidate', render: (r) => <div><div>{r.candidate}</div><div className="pp-sub">{r.jobTitle}</div></div> },
    { key: 'r', header: 'Round', render: (r) => r.round },
    { key: 'i', header: 'Interviewer', render: (r) => r.interviewer },
    { key: 'w', header: 'When', render: (r) => <span className="tnum">{r.when}</span> },
    { key: 'm', header: 'Mode', render: (r) => r.modeLabel },
    {
      key: 'res',
      header: 'Result',
      render: (r) => (
        <span className="row" style={{ gap: 6 }}>
          <StatusTag status={r.result} label={r.resultLabel} />
          {r.isPanelist && r.scorecardStatus !== 'SUBMITTED' && r.status !== 'CANCELLED' && new Date(r.startsAt).getTime() < Date.now() && <Tag tone="outline">Scorecard due</Tag>}
        </span>
      ),
    },
  ];

  return (
    <div data-screen-label="Interviews" className="stack" style={{ gap: 18 }}>
      <PageHeader title="Interviews" sub="Scheduled interview appointments and scorecards." actions={canManage && <button className="btn btn-primary" onClick={() => setScheduling(true)}>Schedule interview</button>} />
      <div className="row-between" style={{ gap: 10 }}>
        <Tabs<InterviewTab> value={tab} onChange={setTab} tabs={(['all', 'upcoming', 'past'] as InterviewTab[]).map((t) => ({ value: t, label: `${TAB_LABELS[t]}${c ? ` · ${c[t]}` : ''}` }))} />
        {canManage && <Pills value={mine} onChange={setMine} options={[{ value: 'all', label: 'All interviews' }, { value: 'mine', label: 'Where I am a panelist' }]} />}
      </div>
      {!canManage && list.data && <div className="faint" style={{ fontSize: 13 }}>You see the interviews where you are on the panel. Open one to read the resume and submit your scorecard.</div>}
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={columns} rows={list.data ? rows : undefined} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => setOpen(r.id)} empty={canManage ? 'No interviews here.' : 'You have no interviews to take.'} />
      )}
      {scheduling && <ScheduleInterviewModal onClose={() => setScheduling(false)} />}
      {openId && <InterviewModal id={openId} onClose={() => setOpen(null)} />}
    </div>
  );
}

function InterviewModal({ id, onClose }: { id: string; onClose: () => void }) {
  const nav = useNavigate();
  const me = useMe();
  const q = useQuery({ queryKey: peopleKeys.interview(id), queryFn: () => peopleApi.interview(id) });
  const [dialog, setDialog] = useState<null | 'reschedule' | 'cancel'>(null);
  const inv = [peopleKeys.interviews, peopleKeys.candidates];
  const result = useAction((r: 'PENDING' | 'SELECTED' | 'REJECTED' | 'ON_HOLD') => peopleApi.interviewResult(id, r), { success: (_x, r) => `Result: ${r === 'ON_HOLD' ? 'on hold' : r.toLowerCase()}`, invalidate: inv });
  const noShow = useAction(() => peopleApi.noShow(id), { success: 'Marked as no-show', invalidate: inv });
  const reschedule = useAction((b: { date: string; time: string; durationMin?: number }) => peopleApi.reschedule(id, b), { success: (r) => (r.emailed ? 'Updated invite emailed' : 'Interview moved'), invalidate: inv });
  const cancel = useAction((reason: string) => peopleApi.cancelInterview(id, reason), { success: 'Interview cancelled · candidate and panel informed', invalidate: inv });
  const i = q.data;
  useEffect(() => {
    if (q.error) onClose();
  }, [q.error, onClose]);
  const started = i ? new Date(i.startsAt).getTime() <= Date.now() : false;
  const isLead = !!i && i.panelists.some((p) => p.role === 'LEAD' && p.employeeId === me.employeeId);
  const canDecide = !!i && (i.canManage || isLead) && i.status !== 'CANCELLED' && i.status !== 'NO_SHOW';

  return (
    <Modal
      title={i ? `${i.candidate} · ${i.round}` : 'Interview'}
      wide
      onClose={onClose}
      actions={
        <>
          {i?.canManage && i.status === 'SCHEDULED' && (
            <>
              <button className="btn btn-ghost" onClick={() => setDialog('cancel')}>Cancel interview</button>
              {started && <button className="btn btn-ghost" disabled={noShow.isPending} onClick={() => noShow.mutate(undefined)}>Mark no-show</button>}
              <button className="btn btn-secondary" onClick={() => setDialog('reschedule')}>Reschedule</button>
            </>
          )}
          {i?.canManage && <button className="btn btn-ghost" onClick={() => nav(`/candidates?candidate=${i.candidateId}`)}>Candidate</button>}
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </>
      }
    >
      {!i ? (
        <Loading />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row-between" style={{ alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 4 }}>
              <div style={{ fontSize: 13.5 }}>{i.jobTitle} · {i.when} IST · {i.durationMin} min · {i.modeLabel}</div>
              <div className="pp-sub">{i.candidateEmail}{i.icsSequence > 0 ? ` · invite updated ${i.icsSequence}×` : ''}</div>
              {i.notesToCandidate && <div className="pp-sub">Note to candidate: {i.notesToCandidate}</div>}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <StatusTag status={i.result} label={i.resultLabel} />
              {i.resumeFileId && <a className="btn btn-secondary btn-sm" href={fileUrl(i.resumeFileId)} target="_blank" rel="noopener noreferrer">Resume</a>}
              {i.mode === 'VIDEO' && (
                <button className="btn btn-secondary btn-sm" disabled title="Video rooms open from the Comms hub (coming with Calls); the link is in the calendar invite">Join video</button>
              )}
            </div>
          </div>
          <div>
            <div className="kicker" style={{ marginBottom: 4 }}>Panel</div>
            {i.panelists.map((p) => (
              <div key={p.employeeId} className="list-row">
                <span>{p.name} <span className="faint">· {p.role === 'LEAD' ? 'Lead interviewer' : 'Panelist'}</span></span>
                <span className="row" style={{ gap: 6 }}>
                  {p.scorecard?.status === 'SUBMITTED' ? (
                    <>
                      <span className="tnum">{p.scorecard.overall != null ? `${p.scorecard.overall} / 10` : 'Scored'}</span>
                      {p.scorecard.recommendation && <Tag tone="neutral">{INTERVIEW_RECOMMENDATION_LABELS[p.scorecard.recommendation as keyof typeof INTERVIEW_RECOMMENDATION_LABELS] ?? p.scorecard.recommendation}</Tag>}
                    </>
                  ) : (
                    <Tag tone="outline">{p.scorecard?.status === 'DRAFT' ? 'Draft' : 'Scorecard pending'}</Tag>
                  )}
                </span>
              </div>
            ))}
          </div>
          {canDecide && (
            <div className="row-between" style={{ gap: 8 }}>
              <span className="faint" style={{ fontSize: 13 }}>
                Result{i.suggestedResult ? ` · panel suggests ${i.suggestedResult === 'ON_HOLD' ? 'on hold' : i.suggestedResult.toLowerCase()}` : ''}
              </span>
              <div className="row" style={{ gap: 6 }}>
                {(['SELECTED', 'ON_HOLD', 'REJECTED'] as const).map((r) => (
                  <button key={r} className={`btn btn-sm ${i.result === r ? 'btn-primary' : 'btn-secondary'}`} disabled={result.isPending} onClick={() => result.mutate(r)}>
                    {r === 'SELECTED' ? 'Selected' : r === 'ON_HOLD' ? 'On hold' : 'Rejected'}
                  </button>
                ))}
                {i.result !== 'PENDING' && <button className="btn btn-ghost btn-sm" onClick={() => result.mutate('PENDING')}>Reset</button>}
              </div>
            </div>
          )}
          {i.isPanelist && i.status !== 'CANCELLED' && <Scorecard i={i} />}
        </div>
      )}
      {i && dialog === 'reschedule' && (
        <FormModal
          title="Reschedule interview"
          fields={[
            { name: 'date', label: 'Date', type: 'date', required: true },
            { name: 'time', label: 'Time', type: 'time', required: true },
            { name: 'durationMin', label: 'Duration (minutes)', type: 'number', span: 2 },
          ]}
          initial={{ date: istDate(i.startsAt) < todayKey() ? todayKey() : istDate(i.startsAt), time: istTime(i.startsAt), durationMin: i.durationMin }}
          submitLabel="Move & email"
          onClose={() => setDialog(null)}
          onSubmit={(v) => reschedule.mutateAsync({ date: String(v.date), time: String(v.time), durationMin: v.durationMin ? Number(v.durationMin) : undefined })}
        />
      )}
      {i && dialog === 'cancel' && <PromptModal title="Cancel interview" label="Reason (internal)" submitLabel="Cancel & inform" initial="Rescheduling" onClose={() => setDialog(null)} onSubmit={(r) => cancel.mutateAsync(r)} />}
    </Modal>
  );
}

const RATING_HINT = ['', 'Poor', 'Below bar', 'At bar', 'Strong', 'Exceptional'];

/** The panelist's own scorecard: criteria 1–5 with comments, overall /10, recommendation. */
function Scorecard({ i }: { i: InterviewDetail }) {
  const mineDone = i.myScorecard?.status === 'SUBMITTED';
  const init = () =>
    i.criteria.map((c) => {
      const r = i.myScorecard?.ratings.find((x) => x.key === c.key);
      return { key: c.key, label: c.label, rating: r?.rating ?? null, comment: r?.comment ?? '' };
    });
  const [ratings, setRatings] = useState(init);
  const [overall, setOverall] = useState<string>(i.myScorecard?.overall != null ? String(i.myScorecard.overall) : '');
  const [rec, setRec] = useState<string>(i.myScorecard?.recommendation ?? '');
  const [notes, setNotes] = useState(i.myScorecard?.notes ?? '');
  const save = useAction((submit: boolean) => peopleApi.scorecard(i.id, {
    ratings: ratings.map((r) => ({ key: r.key, label: r.label, rating: r.rating, comment: r.comment || null })),
    overall: overall === '' ? null : Number(overall),
    recommendation: (rec || null) as ScorecardInput['recommendation'],
    notes: notes || null,
    submit,
  }), { success: (_r, submit) => (submit ? 'Scorecard submitted' : 'Draft saved'), invalidate: [peopleKeys.interviews, peopleKeys.candidates] });
  const rated = ratings.filter((r) => r.rating != null).map((r) => r.rating as number);
  const auto = rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 20) / 10 : null;

  if (mineDone) {
    return (
      <div className="pp-app">
        <div className="row-between">
          <div className="kicker">Your scorecard · submitted</div>
          <span className="tnum">{i.myScorecard?.overall ?? '—'} / 10 · {INTERVIEW_RECOMMENDATION_LABELS[i.myScorecard?.recommendation as keyof typeof INTERVIEW_RECOMMENDATION_LABELS] ?? '—'}</span>
        </div>
        {i.myScorecard?.ratings.map((r) => (
          <div key={r.key} className="list-row">
            <span>{r.label}{r.comment ? <span className="faint"> · {r.comment}</span> : null}</span>
            <span className="tnum">{r.rating ?? '—'} / 5</span>
          </div>
        ))}
        {i.myScorecard?.notes && <div className="pp-sub" style={{ marginTop: 6 }}>{i.myScorecard.notes}</div>}
        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Submitted scorecards are locked. Ask HR if something needs correcting.</div>
      </div>
    );
  }
  return (
    <div className="pp-app">
      <div className="kicker" style={{ marginBottom: 6 }}>Your scorecard{i.myScorecard?.status === 'DRAFT' ? ' · draft' : ''}</div>
      {ratings.map((r, n) => (
        <div key={r.key} className="pp-score-row">
          <span>{r.label}</span>
          <div className="row" style={{ gap: 4 }}>
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} type="button" title={RATING_HINT[v]} className={`pp-rate${r.rating === v ? ' on' : ''}`} onClick={() => setRatings((s) => s.map((x, k) => (k === n ? { ...x, rating: v } : x)))}>
                {v}
              </button>
            ))}
          </div>
          <input className="input" placeholder="Comment" value={r.comment} onChange={(e) => setRatings((s) => s.map((x, k) => (k === n ? { ...x, comment: e.target.value } : x)))} />
        </div>
      ))}
      <div className="form-grid" style={{ marginTop: 10 }}>
        <div className="field">
          <label htmlFor="sc-overall">Overall (0–10)</label>
          <input id="sc-overall" className="input" inputMode="decimal" placeholder={auto != null ? `${auto} from ratings` : '—'} value={overall} onChange={(e) => setOverall(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        <div className="field">
          <label htmlFor="sc-rec">Recommendation</label>
          <select id="sc-rec" className="input" value={rec} onChange={(e) => setRec(e.target.value)}>
            <option value="">Select…</option>
            {RECOMMENDATIONS.map((x) => (
              <option key={x} value={x}>{INTERVIEW_RECOMMENDATION_LABELS[x]}</option>
            ))}
          </select>
        </div>
        <div className="field span-2">
          <label htmlFor="sc-notes">Notes</label>
          <textarea id="sc-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Strengths, concerns, follow-ups for the next round" />
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button className="btn btn-secondary" disabled={save.isPending} onClick={() => save.mutate(false)}>Save draft</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate(true)}>Submit scorecard</button>
      </div>
    </div>
  );
}
