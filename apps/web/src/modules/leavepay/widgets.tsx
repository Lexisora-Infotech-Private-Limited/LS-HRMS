import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LEAVE_STATUS_TONE, type LeaveBalanceView } from '@lexisora/shared';
import { useCan } from '@/lib/auth';
import { Tag } from '@/components/ui';
import { fmtDays, lpApi, lpKeys } from './api';

/**
 * Dashboard widgets owned by Leave (implemented by the Leavepay module).
 *  - LeaveBalanceCard: "Leave balance" card with type rows "left / total" + "Apply time off"
 *  - LeaveHistoryList: "Leave history" list on the dashboard's right column
 */

export function useLeaveBalances() {
  const can = useCan();
  return useQuery<LeaveBalanceView[]>({ queryKey: lpKeys.balances, queryFn: lpApi.balances, enabled: can('leave.self') });
}

export function LeaveBalanceCard() {
  const nav = useNavigate();
  const { data, isLoading, error } = useLeaveBalances();
  return (
    <div className="card">
      <div className="card-kicker">Leave balance</div>
      {isLoading && <div className="faint" style={{ fontSize: 13 }}>Loading…</div>}
      {error && <div className="faint" style={{ fontSize: 13 }}>Balances are unavailable right now.</div>}
      {(data ?? []).map((b) => (
        <div key={b.leaveTypeId} className="kv-row" title={b.meta ?? undefined}>
          <span>{b.name}</span>
          <span style={{ fontFeatureSettings: "'tnum'" }}>
            {fmtDays(b.available)} / {fmtDays(b.total)}
          </span>
        </div>
      ))}
      {data && !data.length && <div className="faint" style={{ fontSize: 13 }}>No leave types apply to you yet.</div>}
      <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/leave?apply=1')}>
        Apply time off
      </button>
    </div>
  );
}

export function LeaveHistoryList({ limit = 4, heading = true }: { limit?: number; heading?: boolean }) {
  const can = useCan();
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: [...lpKeys.myRequests, 'widget'], queryFn: () => lpApi.myRequests({ pageSize: limit }), enabled: can('leave.self') });
  const rows = data?.items ?? [];
  return (
    <>
      {heading && <h4 style={{ margin: '10px 0 0' }}>Leave history</h4>}
      {rows.map((l) => (
        <div key={l.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => nav('/leave')}>
          <span>
            {l.typeName} · {fmtDays(l.days)}
          </span>
          <Tag tone={LEAVE_STATUS_TONE[l.status]}>{l.statusLabel}</Tag>
        </div>
      ))}
      {data && !rows.length && <div className="list-row faint">No time off taken yet.</div>}
    </>
  );
}
