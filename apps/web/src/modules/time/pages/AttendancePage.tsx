import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DAY_STATUS_LABEL, REGULARIZATION_TYPES, REGULARIZATION_TYPE_LABEL, type AttendanceDayRow, type AttendanceMonthSummary, type AttendanceTimeline, type TeamTodayRow, type TimelineSegment } from '@lexisora/shared';
import { FormModal, type FieldDef } from '@/components/form';
import { DataTable } from '@/components/table';
import { ErrorBlock, Kpis, Loading, PageHeader, Seg, Tabs, Tag, toneFor } from '@/components/ui';
import { post, put } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { dayKeyLabel, dur, istToday, monthLabel, shiftMonth, timeOf, tk, useMonth, useMyIdCheck, useTeam, useTimeline } from '../api';
import { useIdlePending, type PendingIdle } from '../idle';
import { lateText, usePunch } from '../punch';
import '../time.css';
import { BiometricPanel } from './BiometricPanel';
import { CorrectionsPanel, MyCorrections } from './CorrectionsPanel';
import { PeriodLocksPanel } from './PeriodLocksPanel';

type View = 'mine' | 'team' | 'corrections' | 'locks' | 'devices';

export default function AttendancePage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const [who, setWho] = useState<{ id: string; name: string; date: string } | null>(null);
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
        sub="Punch rules follow HR policy and your shift: late after shift start + grace, half day when very late."
        actions={options.length === 2 ? <Seg options={options} value={view} onChange={setView} /> : undefined}
      />
      {options.length > 2 && <Tabs<View> tabs={options} value={view} onChange={setView} />}
      {view === 'mine' && <MyAttendance />}
      {view === 'team' && !who && <TeamView onOpen={(r, date) => setWho({ id: r.employeeId, name: r.name, date })} />}
      {view === 'team' && who && <EmployeeAttendance id={who.id} name={who.name} date={who.date} onBack={() => setWho(null)} />}
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
  const [why, setWhy] = useState<AttendanceDayRow | null>(null);
  const idc = useMyIdCheck();
  const late = lateText(t);

  return (
    <>
      {t && (
        <div className="time-mode">
          <span>Work mode:</span>
          <Tag tone="outline">{t.modeChip}</Tag>
          <span className="muted">
            {t.modeNote} · Shift {t.shift.name} {t.shift.start} – {t.shift.end}
            {t.late.workingDay ? ` · grace ${t.late.graceMinutes} min (late after ${t.late.lateAfter})` : ''}
          </span>
        </div>
      )}
      <div className="time-cards">
        <div className="card">
          <div className="card-kicker">Punch</div>
          <div className="card-title">{p.title}</div>
          <div className="time-elapsed">{p.elapsed}</div>
          {!t ? (
            p.error ? <ErrorBlock error={p.error} retry={p.retry} /> : <Loading />
          ) : p.blocked || p.outElsewhere ? (
            <div className="time-blocked">{t.blockReason ?? (p.outElsewhere ? 'Punch out where you punched in.' : 'Web punch is not allowed for you right now.')}</div>
          ) : (
            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => void p.toggle()} disabled={p.busy}>
              {p.busy ? 'Saving…' : p.label}
            </button>
          )}
          {late && (
            <div className="time-late-note" title={t?.late.reason ?? undefined}>
              {late}
              {t?.late.reason ? ` · “${t.late.reason}”` : ''}
            </div>
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
      <TimelineBlock employeeId={null} date={istToday()} live={p.punchedIn} />
      <DaysTable employeeId={null} month={month} setMonth={setMonth} onRegularize={setReg} onLateReason={setWhy} />
      <MyCorrections />
      {reg && <RegularizeForm day={reg} onClose={() => setReg(null)} />}
      {why && <LateReasonForm day={why} onClose={() => setWhy(null)} />}
    </>
  );
}

/** The late rules behind the figures, in words (hover text on "Late marks"). */
function penaltyRule(s: AttendanceMonthSummary): string {
  const r = s.lateRules;
  const half = r.halfDayAsLeave ? 'booked as half-day leave' : 'a half day';
  const parts: string[] = [`Late after shift start + ${r.graceMinutes} min grace.`];
  if (r.allowedMarks > 0) {
    parts.push(`${r.allowedMarks} late ${r.allowedMarks === 1 ? 'arrival is' : 'arrivals are'} allowed a month (no leave cut). From late ${r.allowedMarks + 1}, the first half of that day is ${half}.`);
  } else if (r.source === 'NONE') parts.push('Late marks cost no leave.');
  else {
    const every = r.marksPerPenalty === 1 ? 'Every late mark costs' : `Every ${r.marksPerPenalty} late marks cost`;
    parts.push(`${every} ${r.penaltyDays} day ${r.source === 'LOP' ? 'as loss of pay' : 'from your leave (loss of pay when it runs out)'}, settled when payroll is finalized.`);
  }
  if (r.halfDayAfterMinutes) parts.push(`Late by ${dur(r.halfDayAfterMinutes)} or more: the first half is ${half}.`);
  return parts.join(' ');
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
        <>
          <div className="time-stat-grid">
            <div><div className="n">{s.presentDays}</div>Present days</div>
            <div title={penaltyRule(s)}>
              <div className="n">{s.lateMarks}</div>Late marks
              {s.lateRules.allowedMarks > 0 && (
                <div>
                  <Tag tone={s.lateMarks > s.lateRules.allowedMarks ? 'danger' : 'outline'} title={penaltyRule(s)}>
                    {s.lateMarks > s.lateRules.allowedMarks
                      ? `${s.lateRules.allowedMarks} allowed · ${s.lateMarks - s.lateRules.allowedMarks} over`
                      : `${s.lateMarks} of ${s.lateRules.allowedMarks} allowed`}
                  </Tag>
                </div>
              )}
              {s.latePenaltyDays > 0 && (
                <div>
                  <Tag tone="danger" title={penaltyRule(s)}>
                    {s.latePenaltyDays} {s.latePenaltyDays > 1 ? 'days' : 'day'} penalty
                  </Tag>
                </div>
              )}
              {s.lateHalfDays > 0 && (
                <div>
                  <Tag tone="danger" title="Late days whose first half counted as a half day (very late, or more lates than allowed this month)">
                    {s.lateHalfDays} late half {s.lateHalfDays > 1 ? 'days' : 'day'}
                  </Tag>
                </div>
              )}
            </div>
            <div><div className="n">{dur(s.activeMinutes)}</div>Active hours</div>
            <div><div className="n">{dur(s.idleMinutes)}</div>Idle (auto)</div>
          </div>
        </>
      )}
    </div>
  );
}

function TimelineBlock({ employeeId, date, live = false }: { employeeId: string | null; date: string; live?: boolean }) {
  const isToday = date === istToday();
  const q = useTimeline(employeeId, date, isToday && (live || !!employeeId));
  const pending = useIdlePending();
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h4 style={{ margin: 0 }}>{isToday ? "Today's timeline" : `Timeline · ${dayKeyLabel(date)}`}</h4>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorBlock error={q.error} retry={() => void q.refetch()} /> : q.data && <TimelineStrip tl={q.data} live={employeeId || !isToday ? null : pending} />}
    </div>
  );
}

type StripPart = { start: number; end: number; kind: TimelineSegment['kind'] | 'gap' | 'late'; label: string };
const KIND_RANK: Record<TimelineSegment['kind'], number> = { active: 1, break: 2, idle: 3, missing: 4 };
const hmOf = (ms: number) => timeOf(new Date(ms).toISOString());

/**
 * Lay segments on the axis; where they overlap the higher kind wins (missing > idle > break > active).
 * Gaps before the first punch-in on a working day are "not punched in" (late once past the grace).
 */
function paint(tl: AttendanceTimeline, segments: TimelineSegment[], now: number): StripPart[] {
  const a0 = Date.parse(tl.axisStart);
  const a1 = Date.parse(tl.axisEnd);
  const spans = segments.map((s) => ({ ...s, s: Math.max(a0, Date.parse(s.start)), e: Math.min(a1, Date.parse(s.end)) })).filter((s) => s.e > s.s);
  const points = [...new Set([a0, a1, ...spans.flatMap((s) => [s.s, s.e])])].sort((x, y) => x - y);
  const lastEnd = Math.max(a0, ...spans.map((s) => s.e));
  const out: (StripPart & { src: object | null })[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const x = points[i]!;
    const y = points[i + 1]!;
    let top: (typeof spans)[number] | null = null;
    for (const s of spans) if (s.s <= x && s.e >= y && (!top || KIND_RANK[s.kind] >= KIND_RANK[top.kind])) top = s;
    const prev = out.at(-1);
    if (prev && prev.src === top) prev.end = y;
    else out.push({ start: x, end: y, kind: top?.kind ?? 'gap', label: top?.label ?? '', src: top });
  }
  const firstIn = tl.firstIn ? Date.parse(tl.firstIn) : null;
  const lateAfter = Date.parse(tl.lateAfter);
  for (const p of out) {
    if (p.kind !== 'gap') continue;
    const beforeIn = tl.workingDay && (firstIn ? p.end <= firstIn : p.start < now);
    if (beforeIn) {
      p.label = firstIn
        ? `${hmOf(p.start)} – ${hmOf(p.end)} · not punched in yet${tl.lateByMinutes ? ` · late by ${dur(tl.lateByMinutes)}` : ''}`
        : `Not punched in · shift started ${hmOf(Date.parse(tl.expectedStart))}`;
      if ((firstIn ?? now) > lateAfter) p.kind = 'late';
    } else if (p.end <= lastEnd) p.label = `${hmOf(p.start)} – ${hmOf(p.end)} · no activity`;
  }
  return out;
}

/** `live`: your open idle span (not saved yet), drawn on top in the idle colour. Hover or tap a part for its label. */
export function TimelineStrip({ tl, live }: { tl: AttendanceTimeline; live?: PendingIdle | null }) {
  const [hover, setHover] = useState<{ i: number; x: number; pct: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const parts = useMemo(() => {
    const segs = [...tl.segments];
    if (live) {
      const label = `Idle since ${hmOf(live.since)} · ${live.back === null ? 'no input' : 'waiting for your reason'}`;
      segs.push({ kind: 'idle', start: new Date(live.since).toISOString(), end: new Date(live.back ?? now).toISOString(), label });
    }
    return paint(tl, segs, now);
  }, [tl, live, now]);
  const pick = (i: number, el: HTMLElement) => {
    const x = el.offsetLeft + el.offsetWidth / 2;
    setHover({ i, x, pct: (x / Math.max(1, el.parentElement?.offsetWidth ?? 1)) * 100 });
  };
  const tip = hover ? parts[hover.i]?.label : null;
  const has = (k: StripPart['kind']) => parts.some((p) => p.kind === k);
  return (
    <>
      <div className="time-strip" onMouseLeave={() => setHover(null)}>
        <div className="timeline" style={{ height: 28 }}>
          {parts.map((p, i) => (
            <div
              key={i}
              className={`${p.kind === 'gap' ? 'time-gap' : p.kind === 'late' ? 'time-gap late' : `seg-${p.kind}`}${hover?.i === i && p.label ? ' is-hover' : ''}`}
              style={{ flex: p.end - p.start }}
              aria-label={p.label || undefined}
              onMouseEnter={(e) => pick(i, e.currentTarget)}
              onClick={(e) => pick(i, e.currentTarget)}
            />
          ))}
        </div>
        {tip && hover && (
          <div className="time-tip" role="tooltip" style={{ left: hover.x, transform: `translateX(-${hover.pct}%)` }}>
            {tip}
          </div>
        )}
      </div>
      <div className="time-axis">
        {tl.ticks.map((t, i) => (
          <span key={`${t}-${i}`}>{t}</span>
        ))}
      </div>
      <div className="time-legend">
        <span><i className="a" />Active</span>
        <span><i className="b" />Break</span>
        <span><i className="i" />Idle (no input &gt; {tl.idleThresholdMinutes} min)</span>
        {has('late') && <span><i className="l" />Not punched in (late)</span>}
        {has('missing') && <span><i className="m" />No punch-out</span>}
        {tl.source === 'none' ? <span className="faint">No activity recorded yet</span> : <span className="faint">Hover a bar to see details</span>}
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

function DaysTable({
  employeeId,
  month,
  setMonth,
  onRegularize,
  onLateReason,
}: {
  employeeId: string | null;
  month: string;
  setMonth: (m: string) => void;
  onRegularize?: (r: AttendanceDayRow) => void;
  onLateReason?: (r: AttendanceDayRow) => void;
}) {
  const q = useMonth(employeeId, month);
  const today = istToday();
  const rows = (q.data?.days ?? []).filter((d) => d.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  const isCurrent = month >= today.slice(0, 7);
  const left = q.data?.summary.correctionsLeft;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row-between">
        <h4 style={{ margin: 0 }}>
          {monthLabel(month)}
          {q.data?.locked ? ' · locked' : ''}
          {onRegularize && left !== undefined && <span className="faint" style={{ fontSize: 12, fontWeight: 400 }}> · {left} {left === 1 ? 'correction' : 'corrections'} left</span>}
        </h4>
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
                <span title={r.isLate ? `Late by ${dur(r.lateByMinutes)}` : undefined}>{r.in ?? '—'}</span>
                <span title={r.openSince ? `Punched in at ${r.openSince} and never punched out` : undefined}>
                  {r.status === 'MISSED_PUNCH' && r.openSince ? <span className="time-late-note">No punch-out</span> : (r.out ?? '—')}
                </span>
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
  const missed = day.status === 'MISSED_PUNCH' || (!!day.in && !day.out && !day.isToday);
  // "Excuse late mark" only when there is a late mark to excuse.
  const types = REGULARIZATION_TYPES.filter((t) => t !== 'LATE_EXCUSE' || (day.isLate && day.lateByMinutes > 0));
  const fields: FieldDef[] = [
    { name: 'type', label: 'Type', type: 'select', span: 2, required: true, options: types.map((t) => ({ value: t, label: REGULARIZATION_TYPE_LABEL[t] })) },
    { name: 'correctedIn', label: 'Punch-in time', type: 'time', showIf: (v) => v.type !== 'LATE_EXCUSE' },
    { name: 'correctedOut', label: 'Punch-out time', type: 'time', showIf: (v) => v.type !== 'LATE_EXCUSE', hint: missed ? 'When you actually left' : undefined },
    { name: 'reason', label: 'Reason', type: 'area', span: 2, required: true, placeholder: 'What happened? (at least 10 characters)' },
    { name: 'attachmentFileId', label: 'Attachment (optional)', type: 'file', span: 2, category: 'regularization' },
  ];
  const defaultType = missed ? 'MISSED_PUNCH' : day.isLate && day.lateByMinutes > 0 ? 'LATE_EXCUSE' : day.in ? 'WRONG_TIME' : 'MISSED_PUNCH';
  return (
    <FormModal
      title={`Request correction · ${day.dateLabel}`}
      fields={fields}
      submitLabel="Send request"
      // Never pre-fill a missed day's out time: it is the wrong one.
      initial={{ type: defaultType, correctedIn: day.in ?? '', correctedOut: missed ? '' : (day.out ?? '') }}
      intro={
        <div className="note">
          Recorded: in {day.in ?? '—'} · out {missed ? 'missing' : (day.out ?? '—')} · {day.statusLabel}
          {day.isLate && day.lateByMinutes > 0 ? ` · late by ${dur(day.lateByMinutes)}` : ''}
        </div>
      }
      onSubmit={(v) => {
        if (String(v.reason ?? '').trim().length < 10) throw new Error('Reason must be at least 10 characters');
        return act.mutateAsync({ ...v, date: day.date });
      }}
      onClose={onClose}
    />
  );
}

function LateReasonForm({ day, onClose }: { day: AttendanceDayRow; onClose: () => void }) {
  const act = useAction((reason: string) => put(`/attendance/me/days/${day.date}/late-reason`, { reason }), { success: 'Late reason saved', invalidate: [tk.all] });
  return (
    <FormModal
      title={`Why were you late · ${day.dateLabel}`}
      intro={<div className="note">In at {day.in ?? '—'} · late by {dur(day.lateByMinutes)}. Your manager sees this reason. To have the late mark removed, use Fix → “Excuse late mark”.</div>}
      fields={[{ name: 'reason', label: 'Reason', type: 'area', span: 2, required: true, placeholder: 'e.g. Train delayed by an hour' }]}
      initial={{ reason: day.lateReason ?? '' }}
      submitLabel="Save"
      onSubmit={(v) => {
        const r = String(v.reason ?? '').trim();
        if (r.length < 5) throw new Error('Write at least 5 characters');
        return act.mutateAsync(r);
      }}
      onClose={onClose}
    />
  );
}

function TeamView({ onOpen }: { onOpen: (r: TeamTodayRow, date: string) => void }) {
  const can = useCan();
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
            { label: date === istToday() ? 'Not yet in' : 'Not in', value: c.notYetIn },
            { label: 'Absent', value: c.absent },
          ]}
        />
      )}
      {q.isError ? (
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      ) : (
        <DataTable
          loading={q.isLoading}
          rows={q.data?.rows}
          rowKey={(r) => r.employeeId}
          onRowClick={(r) => onOpen(r, date)}
          empty={can('attendance.manage') ? 'No active employees.' : 'No one reports to you yet.'}
          columns={[
            { key: 'n', header: 'Employee', render: (r) => <span><span style={{ display: 'block' }}>{r.name}</span><span className="faint" style={{ fontSize: 11.5 }}>{r.empCode}{r.department ? ` · ${r.department}` : ''}</span></span> },
            { key: 'm', header: 'Mode', render: (r) => r.workMode.charAt(0) + r.workMode.slice(1).toLowerCase() },
            { key: 'i', header: 'In', render: (r) => r.in ?? '—' },
            { key: 'o', header: 'Out', render: (r) => r.out ?? '—' },
            { key: 's', header: 'Source', render: (r) => r.source ?? '—' },
            {
              key: 'st',
              header: 'Status',
              render: (r) => (
                <span className="row" style={{ gap: 6 }}>
                  <Tag tone={/absent|missed/i.test(r.status) ? 'danger' : /leave|holiday|weekly/i.test(r.status) ? 'neutral' : 'accent'}>{r.status}</Tag>
                  {r.isLate && (
                    <Tag tone={r.lateHalfDay ? 'danger' : 'outline'} title={r.lateReason ? `Reason: ${r.lateReason}` : 'No reason given'}>
                      Late {dur(r.lateByMinutes)}
                    </Tag>
                  )}
                  {r.lateReason && <span className="time-row-note">“{r.lateReason}”</span>}
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

function EmployeeAttendance({ id, name, date, onBack }: { id: string; name: string; date: string; onBack: () => void }) {
  const [month, setMonth] = useState(() => date.slice(0, 7));
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>‹ Team</button>
        <h3 style={{ margin: 0 }}>{name}</h3>
      </div>
      <div className="time-cards">
        <MonthCard employeeId={id} month={month} />
      </div>
      <TimelineBlock employeeId={id} date={date} />
      <DaysTable employeeId={id} month={month} setMonth={setMonth} />
    </div>
  );
}
