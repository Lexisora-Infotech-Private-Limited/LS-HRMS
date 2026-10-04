import { useState } from 'react';
import type { PeriodLockReadiness, PeriodLockRow } from '@lexisora/shared';
import { DataTable } from '@/components/table';
import { ErrorBlock, Loading, Modal, Tag } from '@/components/ui';
import { post } from '@/lib/api';
import { useAction } from '@/lib/query';
import { dayKeyLabel, istToday, monthLabel, shiftMonth, stamp, tk, useLockReadiness, useLocks } from '../api';
import '../time.css';

/**
 * Attendance period locks (HR). A locked range rejects punches, corrections, day overrides and
 * timesheet edits with PERIOD_LOCKED. Payroll locks the month automatically when it runs.
 */
export function PeriodLocksPanel() {
  const today = istToday();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(shiftMonth(current, -1));
  const locks = useLocks();
  const ready = useLockReadiness(month);
  const [locking, setLocking] = useState(false);
  const [unlocking, setUnlocking] = useState<PeriodLockRow | null>(null);
  const months = [0, 1, 2, 3, 4, 5].map((i) => shiftMonth(current, -i));

  return (
    <div className="time-panel">
      <div className="row-between">
        <div className="row" style={{ gap: 8 }}>
          <label htmlFor="lock-month" style={{ fontSize: 13 }}>Month</label>
          <select id="lock-month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 180 }}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === current ? ' (running)' : ''}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={() => setLocking(true)}>Lock {monthLabel(month).split(' ')[0]}</button>
      </div>

      {ready.isLoading && <Loading />}
      {ready.isError && <ErrorBlock error={ready.error} retry={() => void ready.refetch()} />}
      {ready.data && <Readiness r={ready.data} />}

      <div>
        <div className="time-label" style={{ marginBottom: 6 }}>Lock history</div>
        {locks.isError ? (
          <ErrorBlock error={locks.error} />
        ) : (
          <DataTable
            loading={locks.isLoading}
            rows={locks.data}
            rowKey={(r) => r.month}
            empty="No periods locked yet. Payroll locks a month automatically when it runs."
            columns={[
              { key: 'm', header: 'Month', render: (r) => monthLabel(r.month) },
              { key: 'u', header: 'Locked up to', render: (r) => dayKeyLabel(r.lockedUpTo) },
              { key: 'b', header: 'Locked by', render: (r) => r.lockedBy ?? 'System' },
              { key: 'a', header: 'Locked at', render: (r) => stamp(r.lockedAt) },
              {
                key: 's',
                header: 'Status',
                render: (r) => (r.active ? <Tag tone="accent">Locked</Tag> : <Tag title={r.unlockReason ?? undefined}>Unlocked {stamp(r.unlockedAt)}</Tag>),
              },
              { key: 'x', header: '', render: (r) => (r.active ? <button className="btn btn-ghost btn-sm" onClick={() => setUnlocking(r)}>Unlock</button> : <span className="faint" style={{ fontSize: 12 }}>{r.unlockReason}</span>) },
            ]}
          />
        )}
      </div>
      {locking && <LockDialog month={month} readiness={ready.data} onClose={() => setLocking(false)} />}
      {unlocking && <UnlockDialog row={unlocking} onClose={() => setUnlocking(null)} />}
    </div>
  );
}

function Readiness({ r }: { r: PeriodLockReadiness }) {
  const items = [
    { n: r.pendingCorrections, label: 'Correction requests pending', warn: r.pendingCorrections > 0 },
    { n: r.missedPunchDays, label: 'Days with a missed punch', warn: r.missedPunchDays > 0 },
    { n: r.openSessions, label: 'Sessions still open', warn: r.openSessions > 0 },
    { n: r.timesheetsPending, label: 'Timesheets not yet approved', warn: r.timesheetsPending > 0 },
    { n: r.timesheetsApproved, label: 'Timesheets approved', warn: false },
  ];
  const open = items.filter((i) => i.warn).length;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 10 }}>
        <span className="time-label">Before you lock · {monthLabel(r.month)}</span>
        {r.lock?.active ? <Tag tone="accent">Locked up to {dayKeyLabel(r.lock.lockedUpTo)}</Tag> : <Tag>Open</Tag>}
      </div>
      <div className="time-check-list">
        {items.map((i) => (
          <div key={i.label} className={`it${i.warn ? ' warn' : ''}`}>
            <div className="n">{i.n}</div>
            <div className="faint">{i.label}</div>
          </div>
        ))}
      </div>
      <div className="faint" style={{ fontSize: 12.5 }}>
        {open ? 'Items above stay frozen once the month is locked. Clear them first or unlock later with a reason.' : 'Nothing outstanding. Locking freezes punches, corrections and timesheet edits for these days.'}
        {' '}{r.attendanceDays} attendance day records in the month.
      </div>
    </div>
  );
}

function LockDialog({ month, readiness, onClose }: { month: string; readiness?: PeriodLockReadiness; onClose: () => void }) {
  const today = istToday();
  const [y, m] = month.split('-').map(Number) as [number, number];
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const [upTo, setUpTo] = useState(monthEnd < today ? monthEnd : today);
  const act = useAction(() => post<PeriodLockRow>('/period-locks', { month, upTo }), {
    success: (r) => `${monthLabel(r.month)} locked up to ${dayKeyLabel(r.lockedUpTo)}`,
    invalidate: [tk.all],
    onSuccess: onClose,
  });
  const pending = (readiness?.pendingCorrections ?? 0) + (readiness?.timesheetsPending ?? 0);
  return (
    <Modal
      title={`Lock attendance · ${monthLabel(month)}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!upTo || act.isPending} onClick={() => act.mutate(undefined)}>Lock period</button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="lock-upto">Lock attendance up to</label>
          <input id="lock-upto" className="input" type="date" value={upTo} min={`${month}-01`} max={monthEnd < today ? monthEnd : today} onChange={(e) => setUpTo(e.target.value)} />
          <div className="field-hint">Days from the 1st up to this date reject punches, corrections and timesheet edits (PERIOD_LOCKED).</div>
        </div>
        {pending > 0 && <div className="note">{pending} open item{pending === 1 ? '' : 's'} (corrections or timesheets) will be frozen as they are.</div>}
      </div>
    </Modal>
  );
}

function UnlockDialog({ row, onClose }: { row: PeriodLockRow; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const act = useAction(() => post(`/period-locks/${row.month}/unlock`, { reason: reason.trim() }), {
    success: `${monthLabel(row.month)} unlocked`,
    invalidate: [tk.all],
    onSuccess: onClose,
  });
  return (
    <Modal
      title={`Unlock ${monthLabel(row.month)}?`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={reason.trim().length < 5 || act.isPending} onClick={() => act.mutate(undefined)}>Unlock</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="unlock-reason">Reason (kept in the audit log)</label>
        <textarea id="unlock-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Late biometric sync from the Pune device" />
      </div>
    </Modal>
  );
}
