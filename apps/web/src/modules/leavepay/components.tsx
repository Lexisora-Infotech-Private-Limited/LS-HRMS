import { useState } from 'react';
import { useAction } from '@/lib/query';
import { Modal } from '@/components/ui';
import { LEAVE_ALL, lpApi } from './api';

export type RejectTarget = { id: string; employeeName: string; typeName: string; status: string; kind?: string };

/** Reject a leave / comp-off request (or decline a cancellation) with a comment for the employee. */
export function RejectModal({ row, onClose }: { row: RejectTarget; onClose: () => void }) {
  const [comment, setComment] = useState('');
  const act = useAction(() => (row.kind === 'COMP_OFF' ? lpApi.rejectCompOff(row.id, comment) : row.status === 'CANCELLATION_PENDING' ? lpApi.decideCancellation(row.id, false) : lpApi.reject(row.id, comment)), {
    success: `Request from ${row.employeeName} rejected`,
    invalidate: [LEAVE_ALL, ['approvals']],
    onSuccess: onClose,
  });
  return (
    <Modal
      title={`Reject ${row.typeName.toLowerCase()} · ${row.employeeName}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={comment.trim().length < 3 || act.isPending} onClick={() => act.mutate(undefined)}>Reject</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="rej-c">Comment for the employee</label>
        <textarea id="rej-c" className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why it can't be approved, or a better date" />
      </div>
    </Modal>
  );
}
