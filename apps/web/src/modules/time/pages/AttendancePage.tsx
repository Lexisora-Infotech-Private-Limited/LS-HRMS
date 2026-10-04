import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DAY_STATUS_LABEL, REGULARIZATION_TYPES, REGULARIZATION_TYPE_LABEL, type AttendanceDayRow, type AttendanceTimeline, type TeamTodayRow } from '@lexisora/shared';
import { FormModal, type FieldDef } from '@/components/form';
import { DataTable } from '@/components/table';
import { ErrorBlock, Kpis, Loading, PageHeader, Seg, Tabs, Tag, toneFor } from '@/components/ui';
import { post } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { dur, istToday, monthLabel, shiftMonth, timeOf, tk, useMonth, useMyIdCheck, useTeam, useTimeline } from '../api';
import { usePunch } from '../punch';
import '../time.css';
import { BiometricPanel } from './BiometricPanel';
import { CorrectionsPanel, MyCorrections } from './CorrectionsPanel';
import { PeriodLocksPanel } from './PeriodLocksPanel';

type View = 'mine' | 'team' | 'corrections' | 'locks' | 'devices';

export default function AttendancePage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const options: { value: View; label: string }[] = [
    { value: 'mine', label: 'My attendance' },
    ...(can(['attendance.team', 'attendance.manage']) ? [{ value: 'team' as View, label: 'Team' }] : []),
    ...(can(['attendance.regularize.approve', 'attendance.manage']) ? [{ value: 'corrections' as View, label: 'Corrections' }] : []),
    ...(can('attendance.lock') ? [{ value: 'locks' as View, label: 'Period locks' }] : []),
    ...(can('attendance.manage') ? [{ value: 'devices' as View, label: 'Biometric devices' }] : []),
  ];
  const asked = params.get('view') as View | null;
  const view: View = asked && options.some((o) => o.value === asked) ? asked : 'mine';
  const setView = (v: View) => {
    setWho(null);
    setParams(v === 'mine' ? {} : { view: v }, { replace: true });
  };

  return (
    <div data-screen-label="Attendance" className="stack" style={{ gap: 22 }}>
      <PageHeader
        title="Attendance"
        sub="Punch source follows HR policy: office staff punch by biometric, remote staff punch on web or desktop."
        actions={options.length === 2 ? <Seg options={options} value={view} onChange={setView} /> : undefined}
      />
      {options.length > 2 && <Tabs<View> tabs={options} value={view} onChange={setView} />}
      {view === 'mine' && <MyAttendance />}
      {view === 'team' && !who && <TeamView onOpen={(r) => setWho({ id: r.employeeId, name: r.name })} />}
      {view === 'team' && who && <EmployeeAttendance id={who.id} name={who.name} onBack={() => setWho(null)} />}
      {view === 'corrections' && <CorrectionsPanel />}
      {view === 'locks' && <PeriodLocksPanel />}
      {view === 'devices' && <BiometricPanel focusDevice={params.get('device')} />}
    </div>
  );
}

function MyAttendance() {
  const p = usePunch();
  const t = p.today;
  const [month, setMonth] = useState(() => istToday().slice(0, 7));
  const [reg, setReg] = useState<AttendanceDayRow | null>(null);
  const idc = useMyIdCheck();

  return (
    <>
      {t && (
        <div className="time-mode">
          <span>Work mode:</span>
          <Tag tone="outline">{t.modeChip}</Tag>
          <span className="muted">{t.modeNote}{t.shift ? ` · Shift ${t.shift.name} ${t.shift.start} – ${t.shift.end}` : ''}</span>
        </div>
      )}
      <div className="time-cards">
        <div className="card">
          <div className="card-kicker">Punch</div>
          <div className="card-title">{p.title}</div>
          <div className="time-elapsed">{p.elapsed}</div>
          {!t ? (
            <Loading />
          ) : p.blocked ? (
            <div className="time-blocked">Web punch disabled. Use the fingerprint sensor at the office entrance.</div>
          ) : (
            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => void p.toggle()} disabled={p.busy}>
              {p.label}
            </button>
          )}
          {t?.openSessionSource && p.punchedIn && <div className="card-meta">Punched in via {t.openSessionSource.toLowerCase()}</div>}
        </div>
        <MonthCard employeeId={null} month={month} />
        <div className="card">
          <div className="card-kicker">ID card check</div>
          {idc.data ? (
            <>
              <div className="card-title">{idc.data.title}</div>
              <div className="card-body">{idc.data.body}</div>
              <div className="card-meta">{idc.data.meta}</div>
            </>
          ) : idc.isError ? (
            <div className="card-body muted">Not available</div>
          ) : (
            <Loading />
          )}
        </div>
      </div>
      <TimelineBlock employeeId={null} />
      <DaysTable employeeId={null} month={month} setMonth={setMonth} onRegularize={setReg} />
      <MyCorrections />
      {reg && <RegularizeForm day={reg} onClose={() => setReg(null)} />}
    </>
  );
}

function MonthCard({ employeeId, month }: { employeeId: string | null; month: string }) {
  const q = useMonth(employeeId, month);
  const s = q.data?.summary;
  return (
    <div className="card">
      <div className="card-kicker">{month === istToday().slice(0, 7) ? 'This month' : monthLabel(month)}</div>
      {!s ? (
        q.isError ? <ErrorBlock error={q.error} retry={() => void q.refetch()} /> : <Loading />
      ) : (
        <div className="time-stat-grid">
          <div><div className="n">{s.presentDays}</div>Present days</div>
          <div><div className="n">{s.lateMarks}</div>Late marks</div>
          <div><div className="n">{dur(s.activeMinutes)}</div>Active hours</div>
          <div><div className="n">{dur(s.idleMinutes)}</div>Idle (auto)</div>
        </div>
      )}
    </div>
  );
}

function TimelineBlock({ employeeId }: { employeeId: string | null }) {
  const [date] = useState(istToday());
  const q = useTimeline(employeeId, date);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h4 style={{ margin: 0 }}>Today's timeline</h4>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorBlock error={q.error} /> : q.data && <TimelineStrip tl={q.data} />}
    </div>
  );
}

export function TimelineStrip({ tl }: { tl: AttendanceTimeline }) {
  const parts = useMemo(() => {
    const a0 = new Date(tl.axisStart).getTime();
    const a1 = new Date(tl.axisEnd).getTime();
    const out: { w: number; kind: 'active' | 'break' | 'idle' | 'gap'; label: string }[] = [];
    let cur = a0;
    const segs = [...tl.segments].sort((x, y) => x.start.localeCompare(y.start));
    for (const s of segs) {
      const st = Math.max(a0, new Date(s.start).getTime());
      const en = Math.min(a1, new Date(s.end).getTime());
      if (en <= st) continue;
      if (st > cur) out.push({ w: st - cur, kind: 'gap', label: `${timeOf(new Date(cur).toISOString())} – ${timeOf(new Date(st).toISOString())} · no activity` });
      out.push({ w: en - Math.max(st, cur), kind: s.kind, label: s.label });
      cur = Math.max(cur, en);
    }
    if (cur < a1) out.push({ w: a1 - cur, kind: 'gap', label: '' });
    return out.filter((p) => p.w > 0);
  }, [tl]);
  return (
    <>
      <div className="timeline" style={{ height: 28 }}>
        {parts.map((p, i) => (
          <div key={i} className={p.kind === 'gap' ? 'time-gap' : `seg-${p.kind}`} style={{ flex: p.w }} title={p.label} />
        ))}
      </div>
      <div className="time-axis">
        {tl.ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="time-legend">
        <span><i className="a" />Active</span>
        <span><i className="b" />Break</span>
        <span><i className="i" />Auto-idle (no input &gt; {tl.idleThresholdMinutes} min)</span>
        {tl.source === 'none' && <span className="faint">No activity recorded yet today</span>}
      </div>
    </>
  );
}

function statusText(r: AttendanceDayRow): string {
  if (r.status === 'PRESENT' && r.isLate) return 'Late';
  if (r.status === 'HOLIDAY' && r.holidayName) return r.holidayName;
  if (r.status === 'LEAVE' && r.leaveTypeCode) return `Leave · ${r.leaveTypeCode}`;
  return r.statusLabel || DAY_STATUS_LABEL[r.status];
}

function DaysTable({ employeeId, month, setMonth, onRegularize }: { employeeId: string | null; month: string; setMonth: (m: string) => void; onRegularize?: (r: AttendanceDayRow) => void }) {
  const q = useMonth(employeeId, month);
  const today = istToday();
  const rows = (q.data?.days ?? []).filter((d) => d.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  const isCurrent = month >= today.slice(0, 7);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row-between">
        <h4 style={{ margin: 0 }}>{monthLabel(month)}{q.data?.locked ? ' · locked' : ''}</h4>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setMonth(shiftMonth(month, -1))}>‹ Previous</button>
          <button className="btn btn-ghost btn-sm" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))}>Next ›</button>
        </div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      ) : (
        <div className="time-grid att">
          <div className="hd"><span>Date</span><span>In</span><span>Out</span><span>Source</span><span>Breaks</span><span>Idle</span><span>Status</span></div>
          {rows.length === 0 && <div className="empty">No attendance recorded for this month yet.</div>}
          {rows.map((r) => {
            const label = statusText(r);
            const off = r.status === 'WEEKLY_OFF' || r.status === 'HOLIDAY';
            return (
              <div className="rw" key={r.date}>
                <span className={off ? 'time-day-off' : undefined}>{r.dateLabel}</span>
                <span title={r.isLate ? `Late by ${r.lateByMinutes} min` : undefined}>{r.in ?? '—'}</span>
                <span>{r.out ?? '—'}</span>
                <span>{r.source ?? '—'}</span>
                <span>{r.breakMinutes ? dur(r.breakMinutes) : '—'}</span>
                <span>{r.idleMinutes ? dur(r.idleMinutes) : '—'}</span>
                <span className="row" style={{ gap: 6 }}>
                  <Tag tone={label === 'Late' ? 'outline' : r.status === 'PRESENT' ? 'accent' : toneFor(label)}>{label}</Tag>
                  {r.pendingRegularization && <Tag tone="outline" title="Correction request pending">Correction pending</Tag>}
                  {onRegularize && r.canRegularize && !r.pendingRegularization && (
                    <button className="btn btn-ghost btn-sm" onClick={() => onRegularize(r)} title="Request a correction for this day">Fix</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RegularizeForm({ day, onClose }: { day: AttendanceDayRow; onClose: () => void }) {
  const act = useAction((v: Record<string, unknown>) => post('/regularizations', v), {
    success: 'Correction request sent for approval',
    invalidate: [tk.all],
  });
  const fields: FieldDef[] = [
    { name: 'type', label: 'Type', type: 'select', span: 2, required: true, options: REGULARIZATION_TYPES.map((t) => ({ value: t, label: REGULARIZATION_TYPE_LABEL[t] })) },
    { name: 'correctedIn', label: 'Corrected in', type: 'time', showIf: (v) => v.type !== 'LATE_EXCUSE' },
    { name: 'correctedOut', label: 'Corrected out', type: 'time', showIf: (v) => v.type !== 'LATE_EXCUSE' },
    { name: 'reason', label: 'Reason', type: 'area', span: 2, required: true, placeholder: 'What happened? (at least 10 characters)' },
    { name: 'attachmentFileId', label: 'Attachment (optional)', type: 'file', span: 2, category: 'regularization' },
  ];
  return (
    <FormModal
      title={`Request correction · ${day.dateLabel}`}
      fields={fields}
      submitLabel="Send request"
      initial={{ type: day.in && !day.out ? 'MISSED_PUNCH' : day.isLate ? 'LATE_EXCUSE' : 'MISSED_PUNCH', correctedIn: day.in ?? '', correctedOut: day.out ?? '' }}
      intro={<div className="note">Recorded: in {day.in ?? '—'} · out {day.out ?? '—'} · {statusText(day)}</div>}
      onSubmit={(v) => act.mutateAsync({ ...v, date: day.date })}
      onClose={onClose}
    />
  );
}

function TeamView({ onOpen }: { onOpen: (r: TeamTodayRow) => void }) {
  const [date, setDate] = useState(istToday());
  const q = useTeam(date, true);
  const c = q.data?.counts;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <span>Date</span>
        <input className="input" type="date" value={date} max={istToday()} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 170 }} />
      </div>
      {c && (
        <Kpis
          items={[
            { label: 'Present', value: c.present, sub: `of ${c.total}` },
            { label: 'Late', value: c.late },
            { label: 'On leave', value: c.onLeave },
            { label: 'Not yet in', value: c.notYetIn },
            { label: 'Absent', value: c.absent },
          ]}
        />
      )}
      {q.isError ? (
        <ErrorBlock error={q.error} />
      ) : (
        <DataTable
          loading={q.isLoading}
          rows={q.data?.rows}
          rowKey={(r) => r.employeeId}
          onRowClick={onOpen}
          empty="No one reports to you yet."
          columns={[
            { key: 'n', header: 'Employee', render: (r) => <span><span style={{ display: 'block' }}>{r.name}</span><span className="faint" style={{ fontSize: 11.5 }}>{r.empCode}{r.department ? ` · ${r.department}` : ''}</span></span> },
            { key: 'm', header: 'Mode', render: (r) => r.workMode.charAt(0) + r.workMode.slice(1).toLowerCase() },
            { key: 'i', header: 'In', render: (r) => r.in ?? '—' },
            { key: 'o', header: 'Out', render: (r) => r.out ?? '—' },
            { key: 's', header: 'Source', render: (r) => r.source ?? '—' },
            { key: 'st', header: 'Status', render: (r) => <Tag tone={r.isLate ? 'outline' : toneFor(r.status)}>{r.isLate ? 'Late' : r.status}</Tag> },
          ]}
        />
      )}
    </div>
  );
}

function EmployeeAttendance({ id, name, onBack }: { id: string; name: string; onBack: () => void }) {
  const [month, setMonth] = useState(() => istToday().slice(0, 7));
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>‹ Team</button>
        <h3 style={{ margin: 0 }}>{name}</h3>
      </div>
      <div className="time-cards">
        <MonthCard employeeId={id} month={month} />
      </div>
      <TimelineBlock employeeId={id} />
      <DaysTable employeeId={id} month={month} setMonth={setMonth} />
    </div>
  );
}
