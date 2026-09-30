import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TASK_STATUS_LABELS, formatDate, type TaskDetail, type TaskStatusKey } from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { ConfirmDialog, ErrorBlock, Loading, StatusTag, Tag } from '@/components/ui';
import { hours, workApi, workKeys } from '../api';
import { Drawer } from '../components';

const MOVABLE: TaskStatusKey[] = ['OPEN', 'ALLOTTED', 'WIP', 'DEV_COMPLETED', 'QA', 'DONE'];
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Task drawer: details, assignee/estimate/due, git branch + MR, comments, history. */
export function TaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: workKeys.task(taskId), queryFn: () => workApi.task(taskId) });
  return (
    <Drawer onClose={onClose} label="Task">
      {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorBlock error={q.error} retry={() => void q.refetch()} /> : <Body key={q.data.id} t={q.data} onClose={onClose} />}
    </Drawer>
  );
}

function Body({ t, onClose }: { t: TaskDetail; onClose: () => void }) {
  const inv = [workKeys.task(t.id), ['work', 'board', t.projectId]];
  const [title, setTitle] = useState(t.title);
  const [desc, setDesc] = useState(t.description ?? '');
  const [est, setEst] = useState(t.estimatedMinutes != null ? String(Math.round((t.estimatedMinutes / 60) * 100) / 100) : '');
  const [comment, setComment] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const update = useAction((b: Record<string, unknown>) => workApi.updateTask(t.id, b), { success: 'Task updated', invalidate: inv });
  const move = useAction((to: TaskStatusKey) => workApi.moveTask(t.id, { toStatus: to, version: t.version }), { success: (r) => r.message, invalidate: [...inv, ['work', 'projects']] });
  const addComment = useAction(() => workApi.comment(t.id, comment.trim()), { success: 'Comment added', invalidate: inv, onSuccess: () => setComment('') });
  const retry = useAction(() => workApi.retryGit(t.id), { success: (r) => r.message ?? 'GitLab sync retried', invalidate: inv });
  const cancel = useAction(() => workApi.cancelTask(t.id), { success: `${t.key} cancelled`, invalidate: inv, onSuccess: onClose });
  const ro = !t.canEdit;
  return (
    <>
      <div className="wk-drawer-head">
        <div>
          <div className="kicker">{t.key} · {t.projectName}{t.departmentName ? ` · ${t.departmentName}` : ''}</div>
          {ro ? (
            <h3 className="serif" style={{ margin: '4px 0 0', fontSize: 22 }}>{t.title}</h3>
          ) : (
            <input
              className="input serif"
              style={{ fontSize: 20, marginTop: 4 }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title.trim() !== t.title && update.mutate({ title: title.trim() })}
            />
          )}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <StatusTag status={t.status} label={TASK_STATUS_LABELS[t.status]} />
        {t.overdue && <Tag tone="danger">Overdue</Tag>}
        {t.isStanding && <Tag>Standing task</Tag>}
        {t.canMove && !t.isStanding && (
          <select className="input" style={{ width: 'auto', padding: '4px 8px' }} value="" onChange={(e) => e.target.value && move.mutate(e.target.value as TaskStatusKey)} aria-label="Move to">
            <option value="">Move to…</option>
            {MOVABLE.filter((s) => s !== t.status).map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
          </select>
        )}
      </div>

      <div className="wk-kv">
        <span>Assignee</span>
        {ro ? (
          <span>{t.assigneeName ?? '—'}</span>
        ) : (
          <select className="input" value={t.assigneeEmployeeId ?? ''} onChange={(e) => update.mutate({ assigneeEmployeeId: e.target.value || null })}>
            <option value="">Unassigned</option>
            {t.assigneeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <span>Module</span>
        {ro ? (
          <span>{t.moduleName ?? '—'}</span>
        ) : (
          <select className="input" value={t.moduleName ?? ''} onChange={(e) => update.mutate({ moduleName: e.target.value || null })}>
            <option value="">No module</option>
            {t.moduleOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        <span>Estimate</span>
        {ro ? (
          <span>{hours(t.estimatedMinutes)}</span>
        ) : (
          <input
            className="input"
            inputMode="decimal"
            placeholder="hours"
            value={est}
            onChange={(e) => setEst(e.target.value)}
            onBlur={() => {
              const n = est.trim() ? Number(est) : null;
              const cur = t.estimatedMinutes != null ? t.estimatedMinutes / 60 : null;
              if (n !== cur && (n === null || !Number.isNaN(n))) update.mutate({ estimatedHours: n });
            }}
          />
        )}
        <span>Logged</span><span className="tnum">{hours(t.loggedMinutes, '0h')}</span>
        <span>Due date</span>
        {ro ? <span>{t.dueDate ? formatDate(t.dueDate) : '—'}</span> : <input className="input" type="date" value={t.dueDate ?? ''} onChange={(e) => update.mutate({ dueDate: e.target.value || null })} />}
        <span>Reporter</span><span>{t.reporterName ?? '—'}</span>
        <span>Created</span><span>{formatDate(t.createdAt)}</span>
      </div>

      <div>
        <div className="wk-section-title">Description</div>
        {ro ? (
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{t.description || <span className="faint">No description.</span>}</p>
        ) : (
          <textarea className="input" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (t.description ?? '') && update.mutate({ description: desc || null })} />
        )}
      </div>

      <div>
        <div className="wk-section-title">GitLab</div>
        <div className="wk-kv">
          <span>Branch</span>
          <span>{t.gitBranch ? (t.gitBranchUrl ? <a href={t.gitBranchUrl} target="_blank" rel="noreferrer">{t.gitBranch}</a> : t.gitBranch) : <span className="faint">Created when the card moves to WIP</span>}</span>
          <span>Merge request</span>
          <span>{t.gitMrUrl ? <a href={t.gitMrUrl} target="_blank" rel="noreferrer">!{t.gitMrIid ?? ''} · {t.gitMrState ?? 'opened'}</a> : <span className="faint">Opened at Dev Completed</span>}</span>
          {t.pipelineStatus && (<><span>Pipeline</span><span><StatusTag status={t.pipelineStatus} /></span></>)}
          <span>Sync</span>
          <span className="row" style={{ gap: 6 }}>
            <StatusTag status={t.gitSyncStatus === 'NONE' ? 'Not synced' : t.gitSyncStatus} />
            {t.gitSyncStatus === 'FAILED' && <button className="btn btn-ghost btn-sm" disabled={retry.isPending} onClick={() => retry.mutate(undefined)}>Retry</button>}
          </span>
          {t.gitSyncError && (<><span>Error</span><span className="field-error">{t.gitSyncError}</span></>)}
        </div>
        {t.commits.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {t.commits.map((c) => (
              <div key={c.sha} className="list-row" style={{ fontSize: 12.5 }}>
                <span>{c.url ? <a href={c.url} target="_blank" rel="noreferrer"><code>{c.sha.slice(0, 8)}</code></a> : <code>{c.sha.slice(0, 8)}</code>} {c.message}</span>
                <span className="faint">{c.authorName ?? ''} · {when(c.committedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="wk-section-title">Comments · {t.comments.length}</div>
        <div className="stack" style={{ gap: 6 }}>
          {t.comments.map((c) => (
            <div key={c.id} className="wk-comment">
              <div className="faint">{c.authorName} · {when(c.createdAt)}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
            </div>
          ))}
          <textarea className="input" rows={2} placeholder="Write a comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="row"><button className="btn btn-secondary btn-sm" disabled={!comment.trim() || addComment.isPending} onClick={() => addComment.mutate(undefined)}>Comment</button></div>
        </div>
      </div>

      <div>
        <div className="wk-section-title">History</div>
        <div className="wk-history">
          {t.history.map((h) => (
            <div key={h.id}>
              <span>{h.byName}</span>{' '}
              <span className="muted">
                {h.fromStatus || h.toStatus ? `${h.fromStatus ? TASK_STATUS_LABELS[h.fromStatus as TaskStatusKey] ?? h.fromStatus : '—'} → ${h.toStatus ? TASK_STATUS_LABELS[h.toStatus as TaskStatusKey] ?? h.toStatus : '—'}` : ''}
                {h.note ? `${h.fromStatus || h.toStatus ? ' · ' : ''}${h.note}` : ''}
              </span>
              <div className="faint" style={{ fontSize: 11.5 }}>{when(h.at)}</div>
            </div>
          ))}
          {!t.history.length && <span className="faint">No activity yet.</span>}
        </div>
      </div>

      {t.canEdit && !t.isStanding && (
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setCancelling(true)}>Cancel task</button>
        </div>
      )}
      {cancelling && (
        <ConfirmDialog
          title={`Cancel ${t.key}?`}
          body="The card leaves the board. Logged time stays on the project."
          confirmLabel="Cancel task"
          danger
          busy={cancel.isPending}
          onConfirm={() => cancel.mutate(undefined)}
          onClose={() => setCancelling(false)}
        />
      )}
    </>
  );
}
