import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ApprovalDetail, ReviewItem } from '@lexisora/shared';
import { ErrorBlock, Loading, PageHeader, Pills, Seg, Tag, toneFor } from '@/components/ui';
import { Pager } from '@/components/table';
import { fileUrl, post } from '@/lib/api';
import { useAction } from '@/lib/query';
import { onRealtime } from '@/lib/socket';
import { hmm, tk, useApproval, useApprovals } from '../api';
import '../time.css';

type Level = '1' | '2';
type Status = 'PENDING' | 'APPROVED' | 'RETURNED' | 'ALL';

export default function ApprovalsPage() {
  const [level, setLevel] = useState<Level>('1');
  const [status, setStatus] = useState<Status>('PENDING');
  const [sel, setSel] = useState<string | null>(null);
  const q = useApprovals(Number(level), status);
  const qc = useQueryClient();
  const data = q.data;

  useEffect(() => onRealtime('approvals.counts', () => void qc.invalidateQueries({ queryKey: ['time', 'approvals'] })), [qc]);
  // First load: open the level the viewer can act on.
  useEffect(() => {
    if (data && !data.canL1 && data.canL2 && level === '1') setLevel('2');
  }, [data, level]);

  const tabs = [
    ...(data?.canL1 !== false ? [{ value: '1' as Level, label: `Level 1 · Project Lead · ${data?.counts.l1 ?? 0}` }] : []),
    ...(data?.canL2 !== false ? [{ value: '2' as Level, label: `Level 2 · Reporting Manager · ${data?.counts.l2 ?? 0}` }] : []),
  ];

  return (
    <div data-screen-label="Timesheet approvals" className="stack" style={{ gap: 18 }}>
      <PageHeader title="Timesheet approvals" sub="Level 1: Project Lead reviews task hours and screenshots. Level 2: Reporting Manager signs off before payroll." />
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Seg options={tabs} value={level} onChange={(v) => { setLevel(v); setSel(null); }} />
        <Pills
          options={[
            { value: 'PENDING', label: 'Waiting' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'RETURNED', label: 'Sent back' },
            { value: 'ALL', label: 'All' },
          ]}
          value={status}
          onChange={(v) => { setStatus(v); setSel(null); }}
        />
      </div>
      <div className="time-appr">
        <div className="stack" style={{ gap: 0 }}>
          {q.isLoading && <Loading />}
          {q.isError && <ErrorBlock error={q.error} retry={() => void q.refetch()} />}
          {data?.items.map((r) => (
            <button key={r.stepId} className={`time-appr-row${sel === r.stepId ? ' sel' : ''}`} onClick={() => setSel(r.stepId)}>
              <span className="nm">{r.name}</span>
              <Tag tone={toneFor(r.statusLabel)}>{r.statusLabel}</Tag>
              <span style={{ fontSize: 12.5, color: 'var(--color-neutral-700)' }}>
                {r.week} · {r.hours} worked · {r.idle} idle{r.projectName && level === '1' ? ` · ${r.projectName}` : ''}
              </span>
              <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
                {r.shots} shots{r.flags ? ` · ${r.flags} to review` : ''}
              </span>
            </button>
          ))}
          {data && data.items.length === 0 && <div style={{ padding: '24px 10px', fontSize: 14, color: 'var(--color-neutral-600)' }}>Nothing waiting at this level.</div>}
        </div>
        {sel && <Detail key={sel} stepId={sel} onDone={() => setSel(null)} />}
      </div>
    </div>
  );
}

function Detail({ stepId, onDone }: { stepId: string; onDone: () => void }) {
  const [page, setPage] = useState(1);
  const [date, setDate] = useState('');
  const [taskKey, setTaskKey] = useState('');
  const q = useApproval(stepId, page, date, taskKey);
  const [comment, setComment] = useState('');
  const [decisions, setDecisions] = useState<Record<string, 'ACCEPT' | 'REJECT'>>({});
  const [err, setErr] = useState<string | null>(null);

  const approve = useAction(
    (d: ApprovalDetail) =>
      post<{ ok: boolean; message: string }>(`/timesheet-approvals/${stepId}/approve`, {
        comment: comment.trim() || null,
        decisions: d.items
          .filter((i) => i.status === 'PENDING')
          .map((i) => ({ type: i.type, id: i.id, decision: decisions[`${i.type}:${i.id}`] ?? 'ACCEPT' })),
      }),
    { success: (r) => r.message, invalidate: [tk.all, ['approvals']], onSuccess: onDone },
  );
  const sendBack = useAction(() => post<{ ok: boolean; message: string }>(`/timesheet-approvals/${stepId}/return`, { comment: comment.trim() }), {
    success: (r) => r.message,
    invalidate: [tk.all, ['approvals']],
    onSuccess: onDone,
  });

  if (q.isLoading && !q.data) return <div className="card"><Loading /></div>;
  if (q.isError || !q.data) return <div className="card"><ErrorBlock error={q.error} retry={() => void q.refetch()} /></div>;
  const d = q.data;
  const t = d.timesheet;
  const pending = d.items.filter((i) => i.status === 'PENDING');

  function doReturn() {
    if (comment.trim().length < 5) return setErr('Add a comment for the employee (at least 5 characters)');
    setErr(null);
    sendBack.mutate(undefined);
  }

  return (
    <div className="card" style={{ gap: 14 }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <div className="card-kicker">{t.shortLabel}{d.step.projectName ? ` · ${d.step.projectName}` : ''}</div>
          <div className="card-title" style={{ fontSize: 22 }}>{t.employee.name}</div>
          <div className="card-meta">Level {d.step.level} · {d.step.approverName ?? '—'} · {t.statusLabel}</div>
        </div>
        {d.canAct && (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <button className="btn btn-secondary" onClick={doReturn} disabled={sendBack.isPending || approve.isPending}>Send back</button>
            <button className="btn btn-primary" onClick={() => approve.mutate(d)} disabled={approve.isPending || sendBack.isPending}>Approve</button>
          </div>
        )}
      </div>
      {d.lateDataBanner && <div className="note">{d.lateDataBanner}</div>}
      <div className="time-kpi3">
        <div><div className="n">{d.kpis.worked}</div>Worked</div>
        <div><div className="n">{d.kpis.idle}</div>Auto-idle</div>
        <div><div className="n">{d.kpis.shots}</div>Screenshots</div>
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <div className="time-label">Hours by task</div>
        {t.lines.map((l) => (
          <div key={l.id} className="kv-row">
            <span>{l.label}<span className="faint" style={{ fontSize: 11.5 }}>{l.subLabel ? ` · ${l.subLabel}` : ''}</span></span>
            <span className="tnum">{hmm(l.total)}</span>
          </div>
        ))}
        {d.otherProjectsMinutes > 0 && <div className="kv-row faint"><span>Other projects (reviewed by their leads)</span><span className="tnum">{hmm(d.otherProjectsMinutes)}</span></div>}
      </div>

      {d.items.length > 0 && (
        <div className="stack" style={{ gap: 0 }}>
          <div className="time-label">Outside-hours and idle claims</div>
          {d.items.map((i) => (
            <ItemRow
              key={`${i.type}:${i.id}`}
              item={i}
              canAct={d.canAct}
              value={decisions[`${i.type}:${i.id}`]}
              onChange={(v) => setDecisions((s) => ({ ...s, [`${i.type}:${i.id}`]: v }))}
            />
          ))}
          {d.canAct && pending.length > 0 && <div className="field-hint" style={{ marginTop: 6 }}>Your Accept / Reject choices are applied when you approve.</div>}
        </div>
      )}

      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="time-label">Screenshots mapped to tasks · every 10 min</div>
        <div className="row" style={{ gap: 6 }}>
          <select className="input" style={{ width: 'auto', padding: '4px 8px' }} value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }}>
            <option value="">All days</option>
            {d.screenshots.days.map((x) => (
              <option key={x} value={x}>{new Date(`${x}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</option>
            ))}
          </select>
          <select className="input" style={{ width: 'auto', padding: '4px 8px' }} value={taskKey} onChange={(e) => { setTaskKey(e.target.value); setPage(1); }}>
            <option value="">All tasks</option>
            {d.screenshots.byTask.map((b) => (
              <option key={b.taskKey} value={b.taskKey}>{b.taskKey} · {b.count}</option>
            ))}
          </select>
        </div>
      </div>
      {d.screenshots.items.length === 0 ? (
        <div className="faint" style={{ fontSize: 13 }}>No screenshots for this selection.</div>
      ) : (
        <div className="time-shots">
          {d.screenshots.items.map((s) => {
            const url = s.fileId ? fileUrl(s.fileId) : undefined;
            return (
              <div className="time-shot" key={s.id}>
                <div className="img">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" style={{ display: 'contents' }}>
                      <img src={url} alt={`Screenshot ${s.time}`} className={s.blurred ? 'blur' : undefined} loading="lazy" />
                    </a>
                  ) : (
                    'screen'
                  )}
                </div>
                <span>{s.time} · {s.taskKey}</span>
              </div>
            );
          })}
        </div>
      )}
      {d.screenshots.total > d.screenshots.pageSize && <Pager page={d.screenshots.page} pageSize={d.screenshots.pageSize} total={d.screenshots.total} onPage={setPage} />}

      {d.canAct && (
        <div className="field">
          <label>Comment to employee</label>
          <textarea className="input" placeholder="Optional note" value={comment} onChange={(e) => setComment(e.target.value)} />
          {err && <div className="field-error">{err}</div>}
        </div>
      )}

      {d.history.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          <div className="time-label">History</div>
          {d.history.map((h, i) => (
            <div key={i} style={{ fontSize: 12.5 }} className="muted">
              {new Date(h.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · {h.actor ?? 'System'} · {h.type}
              {h.level ? ` (L${h.level})` : ''}
              {h.comment ? ` — “${h.comment}”` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TYPE_LABEL: Record<ReviewItem['type'], string> = { OUTSIDE_HOURS: 'Outside hours', IDLE_AS_WORK: 'Idle claimed as work', MANUAL_INCREASE: 'Manual increase' };

function ItemRow({ item, canAct, value, onChange }: { item: ReviewItem; canAct: boolean; value?: 'ACCEPT' | 'REJECT'; onChange: (v: 'ACCEPT' | 'REJECT') => void }) {
  const open = item.status === 'PENDING';
  return (
    <div className="time-item">
      <span>
        <b>{TYPE_LABEL[item.type]}</b> · {item.dateLabel} · {hmm(item.minutes)} · {item.task}
        <span className="faint" style={{ display: 'block', fontSize: 12 }}>{item.reason}</span>
      </span>
      {open && canAct ? (
        <Seg
          options={[
            { value: 'ACCEPT', label: 'Accept' },
            { value: 'REJECT', label: 'Reject' },
          ]}
          value={value ?? 'ACCEPT'}
          onChange={onChange}
        />
      ) : (
        <Tag tone={toneFor(item.status)}>{item.status.charAt(0) + item.status.slice(1).toLowerCase()}</Tag>
      )}
    </div>
  );
}
