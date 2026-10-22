import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatTime, type IdleClaimRow } from '@lexisora/shared';
import { fileUrl } from '@/lib/api';
import { useAction } from '@/lib/query';
import { Empty, ErrorBlock, Loading, Pills, StatusTag } from '@/components/ui';
import { trackerApi, trackerKeys } from './api';
import './tracker.css';

/**
 * Reviewer widgets for other domains' screens (time → Timesheet approvals L1, attendance):
 *   <ScreenshotGrid employeeId week />          "Screenshots mapped to tasks · every 10 min"
 *   <IdleClaimsReview employeeId week />        "I was working" claims with Approve / Reject
 *   <ScreenshotIntervalEditor employeeId />      Per-employee screenshot cadence override (RM / lead / HR)
 * All call the tracker API, which applies relationship scope (self / RM / project lead / admin).
 */

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function ScreenshotGrid({ employeeId, week, limit = 200 }: { employeeId: string; week: string; limit?: number }) {
  const [day, setDay] = useState<string>('all');
  const [task, setTask] = useState<string>('');
  const [idleOnly, setIdleOnly] = useState(false);
  const q = useQuery({
    queryKey: [...trackerKeys.screenshots, employeeId, week],
    queryFn: () => trackerApi.screenshots({ employeeId, week, limit: 500 }),
  });
  const items = q.data?.items ?? [];
  const tasks = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of items) if (s.task) m.set(s.task.id, `${s.task.key} · ${s.task.title}`);
    return [...m.entries()];
  }, [items]);
  const shown = items
    .filter((s) => day === 'all' || s.workDate === day)
    .filter((s) => !task || s.task?.id === task)
    .filter((s) => !idleOnly || s.inIdle)
    .slice(0, limit);

  return (
    <div className="stack">
      <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>
        Screenshots mapped to tasks · every {q.data?.intervalMin ?? 10} min
      </div>
      <div className="row-between">
        <Pills
          options={[{ value: 'all', label: 'Week' }, ...DAY.map((d, i) => ({ value: addDays(week, i), label: d }))]}
          value={day}
          onChange={setDay}
        />
        <div className="row">
          <select className="input" style={{ width: 'auto', minWidth: 160 }} value={task} onChange={(e) => setTask(e.target.value)} aria-label="Filter by task">
            <option value="">All tasks</option>
            {tasks.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <label className="row" style={{ fontSize: 12.5, gap: 6 }}>
            <input type="checkbox" checked={idleOnly} onChange={(e) => setIdleOnly(e.target.checked)} /> Only during idle
          </label>
        </div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      ) : shown.length === 0 ? (
        <Empty>No screenshots for this selection.</Empty>
      ) : (
        <div className="trk-shots">
          {shown.map((s) => (
            <div key={s.id} className={`trk-shot${s.inIdle ? ' idle' : ''}`}>
              <a href={fileUrl(s.fileId)} target="_blank" rel="noreferrer" title={s.blurred ? 'Blurred by policy' : 'Open full size'}>
                <img src={fileUrl(s.thumbFileId ?? s.fileId)} alt={`Screenshot ${formatTime(s.capturedAt)}`} loading="lazy" />
              </a>
              <span>
                {formatTime(s.capturedAt)} · {s.task?.key ?? 'No task'}
                {s.blurred ? ' · blurred' : ''}
                {s.inIdle ? ' · idle' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      {q.data && q.data.total > shown.length && day === 'all' && !task && !idleOnly && (
        <div className="faint" style={{ fontSize: 12 }}>
          Showing {shown.length} of {q.data.total}. Pick a day to see all.
        </div>
      )}
    </div>
  );
}

/** Lets an RM / project lead / HR set a different screenshot cadence for one employee (null = follow the tenant policy default). */
export function ScreenshotIntervalEditor({ employeeId }: { employeeId: string }) {
  const q = useQuery({ queryKey: [...trackerKeys.screenshotInterval, employeeId], queryFn: () => trackerApi.screenshotInterval(employeeId) });
  const [minutes, setMinutes] = useState<string>('');
  const save = useAction((m: number | null) => trackerApi.setScreenshotInterval(employeeId, m), {
    invalidate: [trackerKeys.screenshotInterval, trackerKeys.screenshots],
    success: (r) => (r.screenshotIntervalOverrideMin ? `Screenshot interval set to ${r.screenshotIntervalOverrideMin} min` : 'Screenshot interval reset to the policy default'),
  });
  if (q.isLoading || !q.data) return null;
  const current = minutes === '' ? q.data.overrideMin : Number(minutes);
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="faint" style={{ fontSize: 12.5 }}>
        Screenshot interval: <b>{q.data.effectiveMin} min</b>{q.data.overrideMin == null ? ' · policy default' : ' · custom'}
      </span>
      <input
        className="input"
        type="number"
        min={1}
        max={60}
        placeholder={String(q.data.policyDefaultMin)}
        style={{ width: 72, padding: '4px 8px' }}
        value={minutes === '' ? (q.data.overrideMin ?? '') : minutes}
        onChange={(e) => setMinutes(e.target.value)}
        aria-label="Screenshot interval override (minutes)"
      />
      <button
        className="btn btn-secondary btn-sm"
        disabled={save.isPending || !current || current === q.data.overrideMin}
        onClick={() => save.mutate(Math.min(60, Math.max(1, Number(current))))}
      >
        Save
      </button>
      {q.data.overrideMin != null && (
        <button className="btn btn-ghost btn-sm" disabled={save.isPending} onClick={() => { setMinutes(''); save.mutate(null); }}>
          Reset to default
        </button>
      )}
    </div>
  );
}

export function IdleClaimsReview({ employeeId, week, onChanged }: { employeeId: string; week: string; onChanged?: () => void }) {
  const q = useQuery({
    queryKey: [...trackerKeys.claims, employeeId, week],
    queryFn: () => trackerApi.idleClaims({ employeeId, week }),
  });
  const decide = useAction((a: { id: string; status: 'APPROVED' | 'REJECTED'; comment?: string }) => trackerApi.decideClaim(a.id, { status: a.status, comment: a.comment }), {
    invalidate: [trackerKeys.claims, trackerKeys.summaries],
    success: (r) => `Idle claim ${r.status === 'APPROVED' ? 'approved' : 'rejected'}`,
    onSuccess: () => onChanged?.(),
  });
  const rows = q.data ?? [];
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  if (!rows.length) return <div className="faint" style={{ fontSize: 13 }}>No "I was working" idle claims this week.</div>;
  return (
    <div className="stack" style={{ '--gap': '0px' } as React.CSSProperties}>
      <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: 6 }}>
        Idle marked as working · {rows.filter((r) => r.status === 'PENDING').length} pending
      </div>
      {rows.map((c: IdleClaimRow) => (
        <div key={c.id} className="list-row" style={{ alignItems: 'center' }}>
          <div style={{ minWidth: 0 }}>
            <div>
              {new Date(`${c.workDate}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} · {formatTime(c.startAt)}–{formatTime(c.endAt)} · {c.minutes} min
              {c.task ? ` · ${c.task.key}` : ''}
            </div>
            {c.note && <div className="faint" style={{ fontSize: 12.5 }}>“{c.note}”</div>}
            {c.comment && c.status !== 'PENDING' && <div className="faint" style={{ fontSize: 12 }}>Reviewer: {c.comment}</div>}
          </div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {c.status === 'PENDING' && c.canDecide ? (
              <>
                <button className="btn btn-secondary btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, status: 'REJECTED' })}>
                  Reject
                </button>
                <button className="btn btn-primary btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, status: 'APPROVED' })}>
                  Approve
                </button>
              </>
            ) : (
              <StatusTag status={c.status} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
