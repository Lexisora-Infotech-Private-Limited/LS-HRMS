import { useState } from 'react';
import type { RegularizationRow } from '@lexisora/shared';
import { Card, ConfirmDialog, Empty, ErrorBlock, Loading, Modal, Pills, Tag, toneFor } from '@/components/ui';
import { post } from '@/lib/api';
import { useAction } from '@/lib/query';
import { stamp, tk, useMyRegs, useRegs } from '../api';
import '../time.css';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
const STATUS_LABEL: Record<string, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

/**
 * Attendance corrections (regularizations) awaiting a decision. Managers see requests routed to
 * them; HR (attendance.manage) sees everyone's. Used on Timesheet approvals and Attendance → Corrections.
 */
export function CorrectionsPanel() {
  const [status, setStatus] = useState<Status>('PENDING');
  const q = useRegs(status);
  const [deciding, setDeciding] = useState<{ row: RegularizationRow; action: 'approve' | 'reject' } | null>(null);

  return (
    <div className="time-panel">
      <div className="row-between">
        <span className="faint" style={{ fontSize: 13 }}>Missed punches, wrong times and late-mark excuses. Approving rewrites the day's punches and recomputes attendance.</span>
        <Pills<Status>
          options={[
            { value: 'PENDING', label: 'Waiting' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: 'ALL', label: 'All' },
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBlock error={q.error} retry={() => void q.refetch()} />}
      {q.data && !q.data.length && <Empty>{status === 'PENDING' ? 'No correction requests waiting for you.' : 'No correction requests here.'}</Empty>}
      <div>
        {q.data?.map((r) => (
          <div key={r.id} className="time-reg-row">
            <div className="stack" style={{ gap: 3 }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="nm">{r.employeeName}</span>
                <Tag tone={toneFor(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</Tag>
                {r.devicePunchesNow && <Tag tone="outline" title="A biometric or desktop punch for this day arrived after the request was made">Device punches now exist</Tag>}
              </div>
              <div>
                {r.dateLabel} · {r.typeLabel}
                {(r.requestedIn || r.requestedOut) && <span className="faint"> · corrected in {r.requestedIn ?? '—'} · out {r.requestedOut ?? '—'}</span>}
              </div>
              <div className="muted">“{r.reason}”</div>
              <div className="faint" style={{ fontSize: 12 }}>
                Requested {stamp(r.createdAt)} · approver {r.approverName ?? 'HR'}
                {r.decidedByName && ` · ${STATUS_LABEL[r.status]?.toLowerCase() ?? 'decided'} by ${r.decidedByName}`}
                {r.decisionComment && ` · “${r.decisionComment}”`}
              </div>
            </div>
            {r.status === 'PENDING' && (
              <div className="row" style={{ gap: 6, alignSelf: 'center' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setDeciding({ row: r, action: 'reject' })}>Reject</button>
                <button className="btn btn-primary btn-sm" onClick={() => setDeciding({ row: r, action: 'approve' })}>Approve</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {deciding && <DecisionDialog row={deciding.row} action={deciding.action} onClose={() => setDeciding(null)} />}
    </div>
  );
}

function DecisionDialog({ row, action, onClose }: { row: RegularizationRow; action: 'approve' | 'reject'; onClose: () => void }) {
  const [comment, setComment] = useState('');
  const approve = action === 'approve';
  const act = useAction(() => post(`/regularizations/${row.id}/${action}`, { comment: comment.trim() || null }), {
    success: approve ? 'Correction approved · attendance updated' : 'Correction rejected · employee notified',
    invalidate: [tk.all, ['approvals']],
    onSuccess: onClose,
  });
  const valid = approve || comment.trim().length >= 5;
  return (
    <Modal
      title={`${approve ? 'Approve' : 'Reject'} correction · ${row.employeeName}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className={`btn ${approve ? 'btn-primary' : 'btn-danger'}`} disabled={!valid || act.isPending} onClick={() => act.mutate(undefined)}>
            {approve ? 'Approve' : 'Reject'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 10 }}>
        <div className="note">
          {row.dateLabel} · {row.typeLabel}
          {(row.requestedIn || row.requestedOut) && ` · in ${row.requestedIn ?? '—'} · out ${row.requestedOut ?? '—'}`}
          <div className="muted" style={{ marginTop: 4 }}>“{row.reason}”</div>
        </div>
        {approve && row.type !== 'LATE_EXCUSE' && <div className="faint" style={{ fontSize: 12.5 }}>The day's existing punches are superseded by the corrected times (source: Regularization).</div>}
        <div className="field">
          <label htmlFor="reg-comment">{approve ? 'Comment (optional)' : 'Reason for rejecting'}</label>
          <textarea id="reg-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={approve ? '' : 'At least 5 characters, shared with the employee'} />
        </div>
      </div>
    </Modal>
  );
}

/** Employee side: my correction requests with status; pending ones can be withdrawn. */
export function MyCorrections() {
  const q = useMyRegs();
  const [cancel, setCancel] = useState<RegularizationRow | null>(null);
  const act = useAction((id: string) => post(`/regularizations/${id}/cancel`), { success: 'Correction request withdrawn', invalidate: [tk.all], onSuccess: () => setCancel(null) });
  if (!q.data?.length) return null;
  return (
    <Card kicker="My correction requests">
      {q.data.slice(0, 6).map((r) => (
        <div key={r.id} className="time-item" style={{ alignItems: 'center' }}>
          <span>
            {r.dateLabel} · {r.typeLabel}
            {(r.requestedIn || r.requestedOut) && <span className="faint"> · {r.requestedIn ?? '—'}–{r.requestedOut ?? '—'}</span>}
            {r.decisionComment && <span className="faint" style={{ display: 'block', fontSize: 12 }}>“{r.decisionComment}” — {r.decidedByName ?? 'Manager'}</span>}
          </span>
          <span className="row" style={{ gap: 6 }}>
            <Tag tone={toneFor(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</Tag>
            {r.status === 'PENDING' && <button className="btn btn-ghost btn-sm" onClick={() => setCancel(r)}>Withdraw</button>}
          </span>
        </div>
      ))}
      {cancel && (
        <ConfirmDialog
          title="Withdraw this correction request?"
          body={`${cancel.dateLabel} · ${cancel.typeLabel}. Your approver will no longer see it.`}
          confirmLabel="Withdraw"
          busy={act.isPending}
          onConfirm={() => act.mutate(cancel.id)}
          onClose={() => setCancel(null)}
        />
      )}
    </Card>
  );
}
