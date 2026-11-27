import { useState } from 'react';
import type { LeaveRequestRow } from '@lexisora/shared';
import { fileUrl } from '@/lib/api';
import { useAction } from '@/lib/query';
import { Modal, Tag } from '@/components/ui';
import { LEAVE_ALL, lpApi } from './api';

/**
 * Supporting document of a leave request (medical certificate etc.). The API only sends the file
 * id to people allowed to open it (the employee, the approver, HR); everyone else sees that a
 * document is attached but can't open it.
 */
export function LeaveDocument({ row, name }: { row: Pick<LeaveRequestRow, 'hasAttachment' | 'attachmentFileId'>; name?: string }) {
  if (!row.hasAttachment) return null;
  if (!row.attachmentFileId) return <Tag tone="outline" title="Visible to the employee, the approver and HR only">Document attached</Tag>;
  return (
    <a className="btn btn-ghost btn-sm" href={fileUrl(row.attachmentFileId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open the supporting document">
      {name ? `View document · ${name}` : 'View document'}
    </a>
  );
}

export type RejectTarget = { id: string; employeeName: string; typeName: string; status: string; kind?: string };

/** Reject a leave / comp-off request (or decline a cancellation) with a comment for the employee. */
export function RejectModal({ row, onClose }: { row: RejectTarget; onClose: () => void }) {
  const [comment, setComment] = useState('');
  const act = useAction(() => (row.kind === 'COMP_OFF' ? lpApi.rejectCompOff(row.id, comment) : row.status === 'CANCELLATION_PENDING' ? lpApi.decideCancellation(row.id, false, comment) : lpApi.reject(row.id, comment)), {
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
