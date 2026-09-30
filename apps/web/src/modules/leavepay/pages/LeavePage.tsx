import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HALF_DAY_OPTIONS, LEAVE_STATUS_TONE, type LeaveApplyInput, type LeaveRequestRow, type TeamRequestRow } from '@lexisora/shared';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { useLookups, opts } from '@/components/lookups';
import { DataTable, type Column } from '@/components/table';
import { Check, Empty, ErrorBlock, Loading, Modal, PageHeader, Seg, Tabs, Tag } from '@/components/ui';
import { LEAVE_ALL, fmtDays, lpApi, lpKeys } from '../api';
import { RejectModal } from '../components';
import '../leavepay.css';

type Tab = 'mine' | 'team';

export default function LeavePage() {
  const can = useCan();
  const canApprove = can(['leave.approve', 'leave.manage']);
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'team' && canApprove ? 'team' : 'mine';
  const [applyOpen, setApplyOpen] = useState(params.get('apply') === '1');
  const [openId, setOpenId] = useState<string | null>(null);
  const team = useQuery({ queryKey: [...lpKeys.team, 'PENDING'], queryFn: () => lpApi.team('PENDING'), enabled: canApprove });

  useEffect(() => {
    if (params.get('apply') === '1') {
      setApplyOpen(true);
      const p = new URLSearchParams(params);
      p.delete('apply');
      setParams(p, { replace: true });
    }
  }, [params, setParams]);

  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    if (t === 'team') p.set('tab', 'team');
    else p.delete('tab');
    setParams(p, { replace: true });
  };

  return (
    <div data-screen-label="Time off" className="stack" style={{ gap: 20 }}>
      <PageHeader
        title="Time off"
        sub="Requests route to your Reporting Manager; approved leave flows into payroll."
        actions={<button className="btn btn-primary" onClick={() => setApplyOpen(true)}>Apply time off</button>}
      />
      {canApprove && (
        <Tabs<Tab>
          tabs={[
            { value: 'mine', label: 'My time off' },
            { value: 'team', label: `Team requests${team.data ? ` · ${team.data.length}` : ''}` },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      {tab === 'mine' ? <MyTimeOff onOpen={setOpenId} /> : <TeamRequests onOpen={setOpenId} />}
      {applyOpen && <ApplyModal onClose={() => setApplyOpen(false)} />}
      {openId && <RequestModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ── My time off ──────────────────────────────────────────────────────────

function MyTimeOff({ onOpen }: { onOpen: (id: string) => void }) {
  const balances = useQuery({ queryKey: lpKeys.balances, queryFn: lpApi.balances });
  const history = useQuery({ queryKey: lpKeys.myRequests, queryFn: () => lpApi.myRequests({ pageSize: 50 }) });
  const upcoming = useQuery({ queryKey: lpKeys.upcoming, queryFn: lpApi.upcoming });
  const cols: Column<LeaveRequestRow>[] = [
    { key: 't', header: 'Type', render: (r) => r.typeName },
    { key: 'd', header: 'Dates', render: (r) => r.dates },
    { key: 'n', header: 'Days', render: (r) => fmtDays(r.days) },
    { key: 'r', header: 'Reason', render: (r) => r.reason ?? <span className="faint">—</span> },
    { key: 's', header: 'Status', render: (r) => <Tag tone={LEAVE_STATUS_TONE[r.status]}>{r.statusLabel}</Tag> },
  ];
  return (
    <>
      {balances.error ? (
        <ErrorBlock error={balances.error} retry={() => balances.refetch()} />
      ) : (
        <div className="lp-balances">
          {balances.isLoading && <Loading />}
          {(balances.data ?? []).map((b) => (
            <div key={b.leaveTypeId} className="card">
              <div className="card-kicker">{b.name}</div>
              <div className="lp-big">
                {fmtDays(b.available)}
                <span> / {fmtDays(b.total)}</span>
              </div>
              <div className="card-meta">days available{b.meta ? ` · ${b.meta}` : ''}</div>
            </div>
          ))}
        </div>
      )}
      <div className="grid-2-1">
        <div className="stack" style={{ gap: 0 }}>
          <h4 style={{ margin: '0 0 8px' }}>History</h4>
          {history.error ? (
            <ErrorBlock error={history.error} retry={() => history.refetch()} />
          ) : (
            <DataTable columns={cols} rows={history.data?.items} loading={history.isLoading} rowKey={(r) => r.id} onRowClick={(r) => onOpen(r.id)} empty="No time off requests yet." />
          )}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <h4 style={{ margin: 0 }}>Upcoming</h4>
          {upcoming.isLoading && <Loading />}
          {(upcoming.data ?? []).map((u, i) => (
            <div key={`${u.kind}-${u.date}-${i}`} className="list-row">
              <span>
                {u.label}
                {u.status && u.status !== 'Approved' && <span className="faint"> · {u.status}</span>}
              </span>
              <span>{u.dates}</span>
            </div>
          ))}
          {upcoming.data && !upcoming.data.length && <div className="list-row faint">No holidays or leave in the next four months.</div>}
        </div>
      </div>
    </>
  );
}

// ── Team requests ────────────────────────────────────────────────────────

function TeamRequests({ onOpen }: { onOpen: (id: string) => void }) {
  const [view, setView] = useState<'PENDING' | 'HISTORY'>('PENDING');
  const [rejecting, setRejecting] = useState<TeamRequestRow | null>(null);
  const q = useQuery({ queryKey: [...lpKeys.team, view], queryFn: () => lpApi.team(view) });
  const approve = useAction((r: TeamRequestRow) => (r.kind === 'COMP_OFF' ? lpApi.approveCompOff(r.id) : r.status === 'CANCELLATION_PENDING' ? lpApi.decideCancellation(r.id, true) : lpApi.approve(r.id)), {
    success: (_x, r) => `${r.kind === 'COMP_OFF' ? 'Comp-off' : r.typeName} for ${r.employeeName} approved`,
    invalidate: [LEAVE_ALL, ['approvals']],
  });
  const cols: Column<TeamRequestRow>[] = [
    { key: 'e', header: 'Employee', render: (r) => <div><div>{r.employeeName}</div><div className="faint" style={{ fontSize: 11.5 }}>{r.employeeCode}{r.department ? ` · ${r.department}` : ''}</div></div> },
    { key: 't', header: 'Type', render: (r) => r.typeName },
    { key: 'd', header: 'Dates', render: (r) => r.dates },
    { key: 'n', header: 'Days', num: true, render: (r) => fmtDays(r.days) },
    { key: 'r', header: 'Reason', render: (r) => r.reason ?? r.evidence ?? <span className="faint">—</span> },
    { key: 'b', header: 'Balance after', num: true, render: (r) => (r.balanceAfter === null ? '—' : fmtDays(r.balanceAfter)) },
    { key: 'o', header: 'Team off', num: true, render: (r) => (r.teamOverlap ? <Tag tone="outline">{r.teamOverlap}</Tag> : '0') },
    {
      key: 'a',
      header: view === 'PENDING' ? '' : 'Status',
      render: (r) =>
        view === 'PENDING' ? (
          <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
            <button className="btn btn-secondary btn-sm" onClick={() => setRejecting(r)}>Reject</button>
            <button className="btn btn-primary btn-sm" disabled={approve.isPending} onClick={() => approve.mutate(r)}>Approve</button>
          </div>
        ) : (
          <Tag tone={LEAVE_STATUS_TONE[r.status]}>{r.statusLabel}</Tag>
        ),
    },
  ];
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row-between">
        <Seg options={[{ value: 'PENDING', label: 'Pending' }, { value: 'HISTORY', label: 'Decided' }]} value={view} onChange={setView} />
        <span className="faint" style={{ fontSize: 12.5 }}>Balance after, and how many of your team are already off on those dates.</span>
      </div>
      {q.error ? <ErrorBlock error={q.error} retry={() => q.refetch()} /> : <DataTable columns={cols} rows={q.data} loading={q.isLoading} rowKey={(r) => `${r.kind}-${r.id}`} onRowClick={(r) => r.kind === 'LEAVE' && onOpen(r.id)} empty={view === 'PENDING' ? 'No requests waiting for you.' : 'Nothing decided yet.'} />}
      {rejecting && <RejectModal row={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  );
}

// ── Apply ────────────────────────────────────────────────────────────────

function ApplyModal({ onClose }: { onClose: () => void }) {
  const look = useLookups(['leaveTypes', 'employees']);
  const types = opts(look.data, 'leaveTypes');
  const balances = useQuery({ queryKey: lpKeys.balances, queryFn: lpApi.balances });
  const [v, setV] = useState({ leaveTypeId: '', fromDate: '', toDate: '', halfDay: 'NONE' as LeaveApplyInput['halfDay'], notify: '', reason: '', acceptLop: false });
  const set = (k: keyof typeof v, val: any) => setV((s) => ({ ...s, [k]: val }));
  useEffect(() => {
    if (!v.leaveTypeId && types.length) set('leaveTypeId', types[0]!.value);
  }, [types, v.leaveTypeId]);
  const single = !!v.fromDate && (v.fromDate === v.toDate || !v.toDate);
  const body: LeaveApplyInput | null = useMemo(() => {
    if (!v.leaveTypeId || !v.fromDate) return null;
    const to = v.toDate || v.fromDate;
    if (to < v.fromDate) return null;
    return { leaveTypeId: v.leaveTypeId, fromDate: v.fromDate, toDate: to, halfDay: single ? v.halfDay : 'NONE', fromSession: 'FULL', toSession: 'FULL', notifyEmployeeIds: v.notify ? [v.notify] : [], reason: v.reason.trim(), acceptLop: v.acceptLop, attachmentFileId: null };
  }, [v, single]);
  const preview = useQuery({
    queryKey: ['leavepay', 'preview', body && { ...body, reason: '' }],
    queryFn: () => lpApi.preview(body!),
    enabled: !!body,
    placeholderData: (p) => p,
    retry: false,
  });
  const p = body ? preview.data : undefined;
  const approverName = p?.approver?.name ?? null;
  const submit = useAction(() => lpApi.apply(body!), {
    success: () => `Request sent to ${approverName ?? 'your Reporting Manager'}`,
    invalidate: [LEAVE_ALL, ['approvals']],
    onSuccess: onClose,
  });
  const bal = balances.data?.find((b) => b.leaveTypeId === v.leaveTypeId);
  const people = opts(look.data, 'employees').filter((o) => o.value !== p?.approver?.id);
  const blocked = !body || !p || p.blocks.length > 0 || (p.lopDays > 0 && !v.acceptLop) || preview.isFetching;
  return (
    <Modal
      title="Apply time off"
      onClose={onClose}
      wide
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={blocked || submit.isPending} onClick={() => submit.mutate(undefined)}>
            {submit.isPending ? 'Sending…' : 'Submit request'}
          </button>
        </>
      }
    >
      <form className="form-grid" onSubmit={(e) => e.preventDefault()}>
        <div className="field span-2">
          <label htmlFor="lv-type">Leave type</label>
          <select id="lv-type" className="input" value={v.leaveTypeId} onChange={(e) => set('leaveTypeId', e.target.value)}>
            {types.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {bal && <div className="field-hint">{fmtDays(bal.available)} of {fmtDays(bal.total)} available{bal.meta ? ` · ${bal.meta}` : ''}</div>}
        </div>
        <div className="field">
          <label htmlFor="lv-from">From</label>
          <input id="lv-from" type="date" className="input" value={v.fromDate} onChange={(e) => setV((s) => ({ ...s, fromDate: e.target.value, toDate: !s.toDate || s.toDate < e.target.value ? e.target.value : s.toDate }))} />
        </div>
        <div className="field">
          <label htmlFor="lv-to">To</label>
          <input id="lv-to" type="date" className="input" min={v.fromDate || undefined} value={v.toDate} onChange={(e) => set('toDate', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="lv-half">Half day</label>
          <select id="lv-half" className="input" value={single ? v.halfDay : 'NONE'} disabled={!single || bal?.allowHalfDay === false} onChange={(e) => set('halfDay', e.target.value)}>
            {HALF_DAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {!single && v.fromDate && <div className="field-hint">Half day applies to single-day requests</div>}
        </div>
        <div className="field">
          <label htmlFor="lv-notify">Notify</label>
          <select id="lv-notify" className="input" value={v.notify} onChange={(e) => set('notify', e.target.value)}>
            <option value="">{approverName ? `${approverName} (RM)` : 'Reporting Manager'}</option>
            {people.map((o) => (
              <option key={o.value} value={o.value}>{approverName ? `${approverName} (RM) + ${o.label}` : o.label}</option>
            ))}
          </select>
        </div>
        <div className="field span-2">
          <label htmlFor="lv-reason">Reason</label>
          <textarea id="lv-reason" className="input" value={v.reason} maxLength={500} onChange={(e) => set('reason', e.target.value)} />
        </div>
      </form>
      {body && (
        <div className="lp-preview">
          {preview.error && !p ? (
            <div className="field-error">{(preview.error as Error).message}</div>
          ) : !p ? (
            <span className="faint">Checking balance and calendar…</span>
          ) : (
            <>
              <div className="row-between">
                <strong>{p.summary}</strong>
                <span className="faint">Balance after: {fmtDays(p.balanceAfter)}</span>
              </div>
              {p.days.some((d) => d.kind !== 'WORKING' || d.isSandwich) && (
                <div className="lp-days">
                  {p.days.map((d) => (
                    <span key={d.date} className={`lp-day ${d.units > 0 ? 'on' : ''}`} title={d.holidayName ?? d.kind.replace('_', ' ').toLowerCase()}>
                      {d.date.slice(8)}
                      <small>{d.units > 0 ? (d.units === 1 ? (d.isSandwich ? 'sandwich' : 'leave') : '½') : d.kind === 'HOLIDAY' ? 'holiday' : 'off'}</small>
                    </span>
                  ))}
                </div>
              )}
              {p.blocks.map((b) => (
                <div key={b} className="field-error">{b}</div>
              ))}
              {p.warnings.map((w) => (
                <div key={w} className="field-hint">{w}</div>
              ))}
              {p.lopDays > 0 && !p.blocks.length && <Check checked={v.acceptLop} onChange={(x) => set('acceptLop', x)} label={`Accept ${fmtDays(p.lopDays)} day(s) as unpaid leave (LOP)`} />}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Request detail ───────────────────────────────────────────────────────

function RequestModal({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: lpKeys.request(id), queryFn: () => lpApi.detail(id) });
  const [rejecting, setRejecting] = useState(false);
  const inv = { invalidate: [LEAVE_ALL, ['approvals']] };
  const withdraw = useAction(() => lpApi.withdraw(id), { success: 'Request withdrawn', ...inv, onSuccess: onClose });
  const cancel = useAction(() => lpApi.cancel(id), { success: (r) => (r.status === 'CANCELLATION_PENDING' ? 'Cancellation sent to your Reporting Manager' : 'Leave cancelled'), ...inv, onSuccess: onClose });
  const approve = useAction(() => lpApi.approve(id), { success: 'Request approved', ...inv, onSuccess: onClose });
  const decideCancel = useAction((ok: boolean) => lpApi.decideCancellation(id, ok), { success: (_r, ok) => (ok ? 'Cancellation approved' : 'Cancellation declined'), ...inv, onSuccess: onClose });
  const r = q.data;
  return (
    <Modal
      title={r ? `${r.typeName} · ${r.dates}` : 'Time off request'}
      onClose={onClose}
      wide
      actions={
        r && (
          <>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
            {r.can.withdraw && <button className="btn btn-secondary" disabled={withdraw.isPending} onClick={() => withdraw.mutate(undefined)}>Withdraw</button>}
            {(r.can.cancel || r.can.requestCancel) && <button className="btn btn-danger" disabled={cancel.isPending} onClick={() => cancel.mutate(undefined)}>{r.can.cancel ? 'Cancel leave' : 'Request cancellation'}</button>}
            {r.can.decideCancellation && (
              <>
                <button className="btn btn-secondary" onClick={() => decideCancel.mutate(false)}>Keep leave</button>
                <button className="btn btn-primary" onClick={() => decideCancel.mutate(true)}>Approve cancellation</button>
              </>
            )}
            {r.can.reject && <button className="btn btn-secondary" onClick={() => setRejecting(true)}>Reject</button>}
            {r.can.approve && <button className="btn btn-primary" disabled={approve.isPending} onClick={() => approve.mutate(undefined)}>Approve</button>}
          </>
        )
      }
    >
      {q.isLoading && <Loading />}
      {q.error && <ErrorBlock error={q.error} />}
      {r && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="lp-kv">
            <span>Employee</span><span>{r.employeeName} · {r.employeeCode}</span>
            <span>Request</span><span>{r.requestNo}</span>
            <span>Status</span><span><Tag tone={LEAVE_STATUS_TONE[r.status]}>{r.statusLabel}</Tag></span>
            <span>Days</span><span>{fmtDays(r.days)}{r.lopDays ? ` (${fmtDays(r.lopDays)} unpaid)` : ''}</span>
            <span>Approver</span><span>{r.approverName ?? '—'}</span>
            <span>Reason</span><span>{r.reason ?? '—'}</span>
            {r.decisionNote && (<><span>Comment</span><span>{r.decisionNote}</span></>)}
            {r.balanceAfter !== null && (<><span>Balance after</span><span>{fmtDays(r.balanceAfter)}</span></>)}
            {r.teamOverlap > 0 && (<><span>Team off</span><span>{r.teamOverlap} teammate(s) off on these dates</span></>)}
            {r.notify.length > 0 && (<><span>Notified</span><span>{r.notify.map((n) => n.name).join(', ')}</span></>)}
          </div>
          {r.breakdown.length > 0 && (
            <div className="lp-days">
              {r.breakdown.map((d) => (
                <span key={d.date} className={`lp-day ${d.units > 0 ? 'on' : ''}`} title={d.holidayName ?? d.kind.toLowerCase()}>
                  {d.date.slice(8)}
                  <small>{d.units > 0 ? (d.units === 1 ? (d.isSandwich ? 'sandwich' : 'leave') : '½') : d.kind === 'HOLIDAY' ? 'holiday' : 'off'}</small>
                </span>
              ))}
            </div>
          )}
          {r.timeline.length > 0 && (
            <div className="lp-timeline">
              {r.timeline.map((t, i) => (
                <div key={i}><span className="faint">{new Date(t.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> {t.text}</div>
              ))}
            </div>
          )}
          {!r.breakdown.length && !r.timeline.length && <Empty>No day breakdown.</Empty>}
        </div>
      )}
      {rejecting && r && <RejectModal row={{ id: r.id, employeeName: r.employeeName, typeName: r.typeName, status: r.status }} onClose={() => { setRejecting(false); onClose(); }} />}
    </Modal>
  );
}
