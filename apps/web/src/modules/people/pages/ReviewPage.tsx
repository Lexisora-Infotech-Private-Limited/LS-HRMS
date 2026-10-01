import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { APPRAISAL_STATUS_LABELS, KRA_RATING_LABELS, formatDate, type AppraisalReviewInput, type ReviewDetail } from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { FormModal } from '@/components/form';
import { ErrorBlock, Loading, PageHeader, StatusTag, Tag } from '@/components/ui';
import { peopleApi, peopleKeys } from '../api';
import { reviewTag } from './AppraisalsPage';
import '../people.css';

type Draft = Record<string, { rating: number | null; comment: string }>;

function weighted(items: ReviewDetail['items'], d: Draft): number | null {
  if (!items.length || items.some((i) => d[i.id]?.rating == null)) return null;
  const w = items.reduce((a, i) => a + i.weight, 0);
  return w ? Math.round((items.reduce((a, i) => a + i.weight * (d[i.id]!.rating as number), 0) / w) * 100) / 100 : null;
}
const band = (s: number | null) => (s == null ? null : s >= 4.5 ? 'Outstanding' : s >= 3.5 ? 'Exceeds expectations' : s >= 2.5 ? 'Meets expectations' : s >= 1.5 ? 'Needs improvement' : 'Unsatisfactory');

function Rating({ value, onChange, disabled }: { value: number | null; onChange?: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      {[1, 2, 3, 4, 5].map((v) => (
        <button key={v} type="button" className={`pp-rate${value === v ? ' on' : ''}`} title={KRA_RATING_LABELS[v - 1]} disabled={disabled || !onChange} onClick={() => onChange?.(v)}>
          {v}
        </button>
      ))}
    </div>
  );
}

/** /appraisals/review/:id — self review, manager review, calibration and acknowledgement. */
export default function ReviewPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: [...peopleKeys.appraisals, 'review', id], queryFn: () => peopleApi.review(id) });
  const r = q.data;
  const [self, setSelf] = useState<Draft>({});
  const [mgr, setMgr] = useState<Draft>({});
  const [loadedFor, setLoadedFor] = useState('');
  const [calibrating, setCalibrating] = useState(false);
  const [ack, setAck] = useState(false);
  useEffect(() => {
    if (!r || loadedFor === r.id) return;
    setSelf(Object.fromEntries(r.items.map((i) => [i.id, { rating: i.selfRating, comment: i.selfComment ?? '' }])));
    setMgr(Object.fromEntries(r.items.map((i) => [i.id, { rating: i.managerRating, comment: i.managerComment ?? '' }])));
    setLoadedFor(r.id);
  }, [r, loadedFor]);

  const inv = [peopleKeys.appraisals];
  const save = useAction((b: AppraisalReviewInput) => peopleApi.saveReview(id, b), { success: (_x, b) => (b.submit ? 'Review submitted' : 'Draft saved'), invalidate: inv });
  const calibrate = useAction((b: { score: number; note: string | null }) => peopleApi.calibrate(id, b.score, b.note), { success: 'Calibrated score saved', invalidate: inv });
  const acknowledge = useAction((comment: string | null) => peopleApi.acknowledge(id, comment), { success: 'Acknowledged · thank you', invalidate: inv });

  if (q.error) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  if (!r) return <Loading />;
  const selfEditable = r.isSelf && !r.isReviewer && r.cycleStatus === 'SELF_REVIEW' && r.selfStatus !== 'SUBMITTED';
  const mgrEditable = r.isReviewer && (r.cycleStatus === 'SELF_REVIEW' || r.cycleStatus === 'MANAGER_REVIEW') && r.managerStatus !== 'SUBMITTED';
  const mgrCanSubmit = mgrEditable && r.cycleStatus === 'MANAGER_REVIEW';
  const editing = selfEditable ? 'self' : mgrEditable ? 'manager' : null;
  const draft = editing === 'self' ? self : mgr;
  const liveScore = editing ? weighted(r.items, draft) : null;
  const submit = (s: boolean) => save.mutate({ ratings: Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, { rating: v.rating, comment: v.comment || null }])), submit: s });
  const showMgrCol = !r.isSelf || r.cycleStatus === 'CLOSED' || r.isReviewer || r.canCalibrate;

  return (
    <div data-screen-label="Appraisal review" className="stack" style={{ gap: 18 }}>
      <PageHeader
        kicker={`${r.cycleName} · ${APPRAISAL_STATUS_LABELS[r.cycleStatus] ?? r.cycleStatus}`}
        title={r.isSelf ? 'Your self review' : `Review · ${r.employee}`}
        sub={`${r.employee} · reviewer ${r.reviewer}`}
        actions={<button className="btn btn-ghost" onClick={() => nav(-1)}>Back</button>}
      />
      <div className="row" style={{ gap: 8 }}>
        <span className="faint" style={{ fontSize: 13 }}>Self</span> {reviewTag(r.selfStatus)}
        <span className="faint" style={{ fontSize: 13, marginLeft: 8 }}>Manager</span> {reviewTag(r.managerStatus)}
        {r.finalScore != null && (
          <>
            <span className="faint" style={{ fontSize: 13, marginLeft: 8 }}>Final</span>
            <Tag tone="accent">{r.finalScore.toFixed(2)}{r.band ? ` · ${r.band}` : ''}</Tag>
          </>
        )}
      </div>
      {r.isReviewer && !r.showSelfToReviewer && <div className="note">The self review is not submitted yet; you will see the employee's ratings once it is.</div>}
      {r.isSelf && r.cycleStatus !== 'CLOSED' && r.selfStatus === 'SUBMITTED' && <div className="note">Submitted. Your manager's ratings and the final result show here once the cycle closes.</div>}
      <div className="stack" style={{ gap: 10 }}>
        {r.items.map((k) => (
          <div key={k.id} className="pp-app">
            <div className="row-between" style={{ alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 500 }}>{k.title}</div>
                {k.description && <div className="pp-sub">{k.description}</div>}
                {k.measurement && <div className="pp-sub">Measured by: {k.measurement}</div>}
              </div>
              <Tag tone="neutral">{k.weight}%</Tag>
            </div>
            <div className="pp-review-grid">
              <div className="stack" style={{ gap: 6 }}>
                <div className="kicker">Self</div>
                {editing === 'self' ? (
                  <>
                    <Rating value={self[k.id]?.rating ?? null} onChange={(v) => setSelf((s) => ({ ...s, [k.id]: { rating: v, comment: s[k.id]?.comment ?? '' } }))} />
                    <textarea className="input" placeholder="What did you deliver? Evidence, links, numbers" value={self[k.id]?.comment ?? ''} onChange={(e) => setSelf((s) => ({ ...s, [k.id]: { rating: s[k.id]?.rating ?? null, comment: e.target.value } }))} />
                  </>
                ) : (
                  <>
                    <Rating value={k.selfRating} disabled />
                    {k.selfComment ? <div style={{ fontSize: 13 }}>{k.selfComment}</div> : <div className="faint" style={{ fontSize: 13 }}>—</div>}
                  </>
                )}
              </div>
              {showMgrCol && (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="kicker">Manager</div>
                  {editing === 'manager' ? (
                    <>
                      <Rating value={mgr[k.id]?.rating ?? null} onChange={(v) => setMgr((s) => ({ ...s, [k.id]: { rating: v, comment: s[k.id]?.comment ?? '' } }))} />
                      <textarea className="input" placeholder="Your assessment" value={mgr[k.id]?.comment ?? ''} onChange={(e) => setMgr((s) => ({ ...s, [k.id]: { rating: s[k.id]?.rating ?? null, comment: e.target.value } }))} />
                    </>
                  ) : (
                    <>
                      <Rating value={k.managerRating} disabled />
                      {k.managerComment ? <div style={{ fontSize: 13 }}>{k.managerComment}</div> : <div className="faint" style={{ fontSize: 13 }}>—</div>}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="row-between" style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 12 }}>
        <div className="row" style={{ gap: 14, fontSize: 13.5 }}>
          {editing ? (
            <span>Weighted score <strong className="tnum">{liveScore != null ? liveScore.toFixed(2) : '—'}</strong>{liveScore != null && <span className="faint"> · {band(liveScore)}</span>}</span>
          ) : (
            <>
              {r.selfScore != null && <span>Self <strong className="tnum">{r.selfScore.toFixed(2)}</strong></span>}
              {r.managerScore != null && <span>Manager <strong className="tnum">{r.managerScore.toFixed(2)}</strong></span>}
            </>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {editing && <button className="btn btn-secondary" disabled={save.isPending} onClick={() => submit(false)}>Save draft</button>}
          {(selfEditable || mgrCanSubmit) && <button className="btn btn-primary" disabled={save.isPending || liveScore == null} title={liveScore == null ? 'Rate every KRA first' : undefined} onClick={() => submit(true)}>Submit</button>}
          {mgrEditable && !mgrCanSubmit && <span className="faint" style={{ fontSize: 12.5 }}>You can submit once manager reviews open.</span>}
          {r.canCalibrate && <button className="btn btn-primary" onClick={() => setCalibrating(true)}>Calibrate</button>}
          {r.isSelf && r.cycleStatus === 'CLOSED' && !r.acknowledgedAt && <button className="btn btn-primary" onClick={() => setAck(true)}>Acknowledge</button>}
        </div>
      </div>
      {r.acknowledgedAt && (
        <div className="faint" style={{ fontSize: 13 }}>
          Acknowledged on {formatDate(r.acknowledgedAt)}{r.employeeComment ? ` · “${r.employeeComment}”` : ''}
        </div>
      )}
      {r.cycleStatus === 'CLOSED' && r.band && <StatusTag status="closed" label={`Final band: ${r.band}`} />}
      {calibrating && (
        <FormModal
          title={`Calibrate ${r.employee}`}
          fields={[
            { name: 'score', label: 'Calibrated score (1–5)', type: 'number', required: true },
            { name: 'note', label: 'Calibration note', type: 'area' },
          ]}
          initial={{ score: r.finalScore ?? r.managerScore ?? '' }}
          submitLabel="Save score"
          onClose={() => setCalibrating(false)}
          onSubmit={(v) => calibrate.mutateAsync({ score: Number(v.score), note: (v.note as string) || null })}
        />
      )}
      {ack && (
        <FormModal
          title="Acknowledge your appraisal"
          fields={[{ name: 'comment', label: 'Comment (optional)', type: 'area' }]}
          submitLabel="Acknowledge"
          onClose={() => setAck(false)}
          onSubmit={(v) => acknowledge.mutateAsync((v.comment as string) || null)}
        />
      )}
    </div>
  );
}
