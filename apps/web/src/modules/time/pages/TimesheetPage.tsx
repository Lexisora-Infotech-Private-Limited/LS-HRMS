import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CompOffRules, OutsideHoursDto, SubmitResult, TimesheetCellDto, TimesheetLineDto, TimesheetLineTask, TimesheetWeek } from '@lexisora/shared';
import { FormModal, type FieldDef } from '@/components/form';
import { ConfirmDialog, ErrorBlock, Loading, Modal, PageHeader, Tag, toneFor, type Tone } from '@/components/ui';
import { HttpError, del, post, put } from '@/lib/api';
import { useAction } from '@/lib/query';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { compOffUnits, useCompOffRules } from '@/modules/leavepay/api';
import { addDaysKey, dur, hmm, istToday, parseHmm, tk, useTsOptions, useWeek } from '../api';
import '../time.css';

export default function TimesheetPage() {
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const q = useWeek(weekStart);
  const qc = useQueryClient();
  const w = q.data;
  const [edit, setEdit] = useState<{ line: TimesheetLineDto; cell: TimesheetCellDto; idx: number } | null>(null);
  const [outside, setOutside] = useState(false);
  const [addRow, setAddRow] = useState(false);
  const { toast, toastError } = useToast();
  const [busy, setBusy] = useState(false);
  const [showQuiet, setShowQuiet] = useState(false);
  const [emptyConfirm, setEmptyConfirm] = useState<string | null>(null);
  /** Rows added in this visit stay visible even before they have hours. */
  const [added, setAdded] = useState<string[]>([]);
  const rules = useCompOffRules();

  useEffect(() => onRealtime('timesheet.updated', () => void qc.invalidateQueries({ queryKey: ['time', 'week'] })), [qc]);

  const setWeek = (data: TimesheetWeek) => qc.setQueryData(tk.week(weekStart ?? 'default'), data);

  async function submit(confirmEmpty = false) {
    if (!w) return;
    setBusy(true);
    try {
      const r = await post<SubmitResult>(`/timesheets/${w.id}/submit`, { expectedVersion: w.version, confirmEmpty });
      toast(r.message);
      await qc.invalidateQueries({ queryKey: tk.all });
    } catch (e) {
      if (e instanceof HttpError && e.code === 'EMPTY_TIMESHEET' && !confirmEmpty) {
        setEmptyConfirm(e.message);
      } else toastError(e);
    } finally {
      setBusy(false);
    }
  }
  const recall = useAction(() => post(`/timesheets/${w!.id}/recall`), { success: 'Timesheet recalled · you can edit it again', invalidate: [tk.all] });
  const removeLine = useAction((lineId: string) => del<TimesheetWeek>(`/timesheets/${w!.id}/lines/${lineId}`), { success: 'Row removed', onSuccess: (d) => setWeek(d) });
  const removeOh = useAction((id: string) => del(`/timesheets/outside-hours/${id}`), { success: 'Outside-hours entry removed', invalidate: [tk.all] });
  const refresh = useAction(() => post<{ week: TimesheetWeek; message: string }>(`/timesheets/${w!.id}/refresh`), { success: (r) => r.message, onSuccess: (r) => setWeek(r.week) });

  if (q.isLoading) return <Loading />;
  if (q.isError || !w) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;

  const lines = w.lines.filter((l) => showQuiet || !l.quiet || added.includes(l.id));
  const hidden = w.lines.length - lines.length;

  return (
    <div data-screen-label="My timesheet" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="My timesheet"
        sub={`Week of ${w.label} · hours come from the desktop tracker, edits need a reason.`}
        actions={
          <>
            {w.editable && (
              <button className="btn btn-ghost" onClick={() => refresh.mutate(undefined)} disabled={refresh.isPending} title="Pull the latest desktop tracker time into this week · safe to repeat, never adds the same time twice">
                {refresh.isPending ? 'Refreshing…' : 'Refresh from tracker'}
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setOutside(true)} disabled={!w.editable}>Log outside-hours task</button>
            {w.canRecall && <button className="btn btn-ghost" onClick={() => recall.mutate(undefined)} disabled={recall.isPending}>Recall</button>}
            <button className="btn btn-primary" onClick={() => void submit()} disabled={!w.canSubmit || busy}>{w.submitLabel}</button>
          </>
        }
      />

      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="time-chain">
          {w.chain.map((c, i) => (
            <span key={c.key} className="row" style={{ gap: 8 }}>
              <Tag tone={c.tone} title={c.tooltip}>{c.label}</Tag>
              {i < w.chain.length - 1 && <span className="arrow">→</span>}
            </span>
          ))}
          <Tag tone={toneFor(w.statusLabel)}>{w.statusLabel}</Tag>
        </div>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(addDaysKey(w.weekStart, -7))}>‹ Previous week</button>
          <span className="tnum" style={{ fontSize: 13 }}>{w.shortLabel}</span>
          <button className="btn btn-ghost btn-sm" disabled={addDaysKey(w.weekStart, 7) > istToday()} onClick={() => setWeekStart(addDaysKey(w.weekStart, 7))}>Next week ›</button>
          {weekStart && <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(null)}>This week</button>}
        </div>
      </div>

      {w.returned && (
        <div className="note">Sent back{w.returned.by ? ` by ${w.returned.by}` : ''}: “{w.returned.comment}” · fix the hours and submit again.</div>
      )}
      {!w.hasTrackerData && w.editable && (
        <div className="note">No desktop tracker data for this week yet. Enter hours manually (each entry needs a reason) or open the tracker app.</div>
      )}

      <div className="time-grid sheet">
        <div className="hd">
          <span>Task</span>
          {w.days.map((d) => {
            const off = d.weeklyOff || !!d.holiday || (d.leave?.fraction ?? 0) >= 1;
            const what = d.holiday ? `${d.holiday} · holiday` : d.weeklyOff ? 'Weekly off' : d.leave ? d.leave.label : d.label;
            return (
              <span key={d.date} title={`${what}${d.expectedMinutes ? ` · ${dur(d.expectedMinutes)} expected` : ''}`} className={off ? 'time-day-off' : undefined}>
                {d.dow}
                <span className="sub" style={{ letterSpacing: 0, textTransform: 'none' }}>{d.label}</span>
                {(d.holiday || d.weeklyOff) && <span className="time-day-tag">{d.holiday ? 'Holiday' : 'Off'}</span>}
                {d.leave && <span className="time-day-tag leave">{d.leave.fraction >= 1 ? 'Leave' : '½ leave'}{d.leave.typeCode ? ` · ${d.leave.typeCode}` : ''}</span>}
              </span>
            );
          })}
          <span>Total</span>
        </div>
        {lines.length === 0 && <div className="empty">No hours yet this week.</div>}
        {lines.map((l) => (
          <div className="rw" key={l.id}>
            <span>
              <span style={{ display: 'block' }}>
                {l.label}
                {w.editable && l.isManual && l.total === 0 && l.pending === 0 && (
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6, padding: '0 6px' }} title="Remove row" onClick={() => removeLine.mutate(l.id)}>×</button>
                )}
              </span>
              <span className="sub">
                {l.subLabel ?? ''}
                {l.billable ? '' : l.subLabel ? ' · non-billable' : 'Non-billable'}
                {l.task ? ` · ${l.task.statusLabel}` : ''}
              </span>
              {l.task && l.task.estimatedMinutes ? <Estimate task={l.task} /> : null}
            </span>
            {l.cells.map((c, i) => {
              const title = [
                c.tracked ? `Tracked ${hmm(c.tracked)}` : null,
                c.idleAsWork ? `Idle claimed as work ${hmm(c.idleAsWork)}` : null,
                c.pendingIdle ? `Idle claim waiting for review ${hmm(c.pendingIdle)} (not counted yet)` : null,
                c.outsideHours ? `Outside hours ${hmm(c.outsideHours)} (accepted)` : null,
                c.pendingOutside ? `Outside hours ${hmm(c.pendingOutside)} waiting for PL review (not counted yet)` : null,
                c.adjustment ? `Edited ${c.adjustment > 0 ? '+' : ''}${hmm(Math.abs(c.adjustment))}${c.adjustment < 0 ? ' less' : ''}` : null,
                c.pendingAdjustment ? `Added ${hmm(c.pendingAdjustment)} waiting for PL review (not counted yet)` : null,
                c.adjustmentReason && (c.adjustment || c.pendingAdjustment) ? `Reason: ${c.adjustmentReason}` : null,
                c.outOfPeriod ? 'Outside this period' : null,
              ].filter(Boolean).join('\n');
              return (
                <span key={c.date}>
                  <button
                    className={`time-cell${c.adjusted ? ' adj' : ''}${c.outsideHours ? ' oh' : ''}`}
                    disabled={!c.editable}
                    title={title || undefined}
                    onClick={() => setEdit({ line: l, cell: c, idx: i })}
                  >
                    {hmm(c.final)}
                  </button>
                  {c.pending > 0 && <span className="time-pending" title="Waiting for your Project Lead · counts once accepted">+{hmm(c.pending)}</span>}
                </span>
              );
            })}
            <span style={{ fontWeight: 600 }}>
              {hmm(l.total) === '–' ? '0:00' : hmm(l.total)}
              {l.pending > 0 && <span className="time-pending">+{hmm(l.pending)}</span>}
            </span>
          </div>
        ))}
        {hidden > 0 && (
          <div className="rw quiet">
            <span>
              <button className="btn btn-ghost btn-sm" style={{ padding: '0 6px' }} onClick={() => setShowQuiet(true)}>
                Show {hidden} empty row{hidden === 1 ? '' : 's'}
              </button>
              <span className="sub">No time this week on tasks that are no longer in progress</span>
            </span>
          </div>
        )}
        <div className="rw idle" title="Idle time is never counted in the rows above · shown for information">
          <span>Auto-idle (not counted)</span>
          {w.idleRow.map((m, i) => (
            <span key={i}>{hmm(m)}</span>
          ))}
          <span>{hmm(w.totals.idle) === '–' ? '0:00' : hmm(w.totals.idle)}</span>
        </div>
        {w.totals.pending > 0 && (
          <div className="rw pend" title="Manual additions and outside-hours entries your Project Lead hasn't accepted yet · not in Total worked">
            <span>Waiting for review</span>
            {w.pendingRow.map((m, i) => (
              <span key={i}>{m ? `+${hmm(m)}` : '–'}</span>
            ))}
            <span>+{hmm(w.totals.pending)}</span>
          </div>
        )}
        <div className="rw tot">
          <span>Total worked</span>
          {w.dayTotals.map((m, i) => {
            const day = w.days[i];
            const units = rules.data?.enabled && day && (day.holiday || day.weeklyOff) ? compOffUnits(m, rules.data) : 0;
            return (
              <span key={i}>
                {hmm(m)}
                {units > 0 && <span className="time-day-tag" title="Comp-off credited once this timesheet is approved">+{units === 1 ? '1' : '½'} comp-off</span>}
              </span>
            );
          })}
          <span>{hmm(w.totals.worked) === '–' ? '0:00' : hmm(w.totals.worked)}</span>
        </div>
        {w.totals.expected > 0 && (
          <div className="rw exp" title="Your shift hours, less leave · none on weekly offs and holidays">
            <span>Expected</span>
            {w.days.map((d) => (
              <span key={d.date}>{d.expectedMinutes ? hmm(d.expectedMinutes) : d.holiday ? 'Holiday' : d.weeklyOff ? 'Off' : d.leave ? 'Leave' : '–'}</span>
            ))}
            <span>{hmm(w.totals.expected)}</span>
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        {w.editable && <button className="btn btn-ghost btn-sm" onClick={() => setAddRow(true)}>+ Add task row</button>}
        <span className="faint" style={{ fontSize: 12.5 }}>
          {hmm(w.totals.worked) === '–' ? '0:00' : hmm(w.totals.worked)} worked{w.totals.expected ? ` of ${hmm(w.totals.expected)} expected` : ''}
          {w.totals.pending ? ` · +${hmm(w.totals.pending)} waiting for your Project Lead (counts once accepted)` : ''}
        </span>
      </div>

      {w.outsideHours.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h4 style={{ margin: 0 }}>Outside-hours tasks</h4>
          {w.outsideHours.map((o) => {
            const st = ohStatus(o);
            return (
              <div key={o.id} className="time-item">
                <span>
                  <b>{o.taskText}</b> · {o.projectName ?? '—'} · {o.dateLabel} {o.from}–{o.to} ({hmm(o.minutes)})
                  <span className="sub faint" style={{ display: 'block' }}>{o.reason}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <Tag tone={st.tone}>{st.label}</Tag>
                  {w.editable && o.reviewStatus === 'PENDING_PL' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => removeOh.mutate(o.id)}>Remove</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {edit && <CellEditor week={w} edit={edit} rules={rules.data} onClose={() => setEdit(null)} onSaved={setWeek} />}
      {outside && <OutsideHoursForm week={w} onClose={() => setOutside(false)} onSaved={setWeek} />}
      {addRow && (
        <AddRowForm
          week={w}
          onClose={() => setAddRow(false)}
          onSaved={(d) => {
            const before = new Set(w.lines.map((l) => l.id));
            setAdded((a) => [...a, ...d.lines.filter((l) => !before.has(l.id)).map((l) => l.id)]);
            setWeek(d);
          }}
        />
      )}
      {emptyConfirm && (
        <ConfirmDialog
          title="Submit an empty timesheet?"
          body={emptyConfirm}
          confirmLabel="Submit anyway"
          busy={busy}
          onClose={() => setEmptyConfirm(null)}
          onConfirm={() => {
            setEmptyConfirm(null);
            void submit(true);
          }}
        />
      )}
    </div>
  );
}

function ohStatus(o: OutsideHoursDto): { label: string; tone: Tone } {
  if (o.reviewStatus === 'PENDING_PL') return { label: 'Waiting for PL review', tone: 'outline' };
  if (o.reviewStatus === 'ACCEPTED') return { label: 'Accepted', tone: 'accent' };
  if (o.reviewStatus === 'REJECTED') return { label: 'Rejected', tone: 'danger' };
  return { label: o.reviewStatus, tone: toneFor(o.reviewStatus) };
}

/** "Est 8:00 · 2:30 left" with a bar that turns red once the task is over its estimate. */
function Estimate({ task }: { task: TimesheetLineTask }) {
  const est = task.estimatedMinutes ?? 0;
  const spent = task.loggedMinutes;
  const over = spent > est;
  const pct = est ? Math.min(100, Math.round((spent / est) * 100)) : 0;
  return (
    <span className={`time-est${over ? ' over' : ''}`} title={`${hmm(spent) === '–' ? '0:00' : hmm(spent)} spent of ${hmm(est)} estimated (all weeks)`}>
      <span className="bar"><i style={{ width: `${pct}%` }} /></span>
      Est {hmm(est)} · {over ? `over by ${hmm(spent - est)}` : `${hmm(est - spent) === '–' ? '0:00' : hmm(est - spent)} left`}
    </span>
  );
}

function CellEditor({ week, edit, rules, onClose, onSaved }: { week: TimesheetWeek; edit: { line: TimesheetLineDto; cell: TimesheetCellDto; idx: number }; rules?: CompOffRules; onClose: () => void; onSaved: (w: TimesheetWeek) => void }) {
  const { cell, line } = edit;
  const day = week.days[edit.idx]!;
  const offDay = day.holiday ? `${day.holiday} is a holiday` : day.weeklyOff ? `${day.dow} ${day.label} is your weekly off` : null;
  const [value, setValue] = useState(cell.claimed ? hmm(cell.claimed) : '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = useAction((body: Record<string, unknown>) => put<TimesheetWeek>(`/timesheets/${week.id}/cells`, body), {
    success: 'Hours updated',
    onSuccess: (d) => {
      onSaved(d);
      onClose();
    },
  });
  const minutes = parseHmm(value);
  const changed = minutes !== null && minutes !== cell.claimed;
  const needsReason = changed && (cell.tracked > 0 || minutes! > 0);
  function go() {
    if (minutes === null) return setErr('Use H:MM, e.g. 4:30');
    if (needsReason && reason.trim().length < 10) return setErr('Edits need a reason (at least 10 characters)');
    setErr(null);
    save.mutate({ lineId: line.id, date: cell.date, minutes, reason: reason.trim() || null, expectedVersion: week.version });
  }
  return (
    <Modal
      title={`${line.label} · ${day.label}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={go} disabled={save.isPending || !changed}>Save</button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        {offDay && (
          <div className="note">
            {offDay}. If you were called in to work, log the hours here
            {rules?.enabled
              ? ` — once this timesheet is approved you get comp-off: ${dur(rules.fullDayMinutes)} or more = 1 day, ${dur(rules.halfDayMinutes)} or more = ½ day (all task rows of the day together). Use it within ${rules.expiryDays} days.`
              : '.'}
          </div>
        )}
        {day.leave && (
          <div className="note">
            You were on approved leave this day ({day.leave.label}).{day.leave.fraction >= 1 ? ' Log hours only if you actually worked — your Project Lead will see it.' : ''}
          </div>
        )}
        <div className="kv-row"><span>Tracked by desktop app</span><span className="tnum">{hmm(cell.tracked) === '–' ? '0:00' : hmm(cell.tracked)}</span></div>
        {cell.idleAsWork > 0 && <div className="kv-row"><span>Idle claimed as work</span><span className="tnum">{hmm(cell.idleAsWork)}</span></div>}
        {cell.outsideHours > 0 && <div className="kv-row"><span>Outside hours (accepted)</span><span className="tnum">{hmm(cell.outsideHours)}</span></div>}
        {cell.pendingOutside > 0 && <div className="kv-row"><span>Outside hours waiting for review</span><span className="tnum">+{hmm(cell.pendingOutside)}</span></div>}
        {cell.adjustment !== 0 && <div className="kv-row"><span>Your edit (counted)</span><span className="tnum">{cell.adjustment > 0 ? '+' : '−'}{hmm(Math.abs(cell.adjustment))}</span></div>}
        {cell.pendingAdjustment > 0 && <div className="kv-row"><span>Your addition waiting for review</span><span className="tnum">+{hmm(cell.pendingAdjustment)}</span></div>}
        <div className="field">
          <label>Hours (H:MM)</label>
          <input className="input" autoFocus value={value} placeholder="0:00" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        </div>
        <div className="field">
          <label>Reason{needsReason ? '' : ' (optional)'}</label>
          <textarea className="input" value={reason} placeholder={offDay ? 'e.g. Called in for the production release' : 'Why does this differ from the tracker?'} onChange={(e) => setReason(e.target.value)} />
          <div className="field-hint">Anything above tracked time waits for your Project Lead and counts in your total once accepted.</div>
        </div>
        {err && <div className="field-error">{err}</div>}
      </div>
    </Modal>
  );
}

function OutsideHoursForm({ week, onClose, onSaved }: { week: TimesheetWeek; onClose: () => void; onSaved: (w: TimesheetWeek) => void }) {
  const opts = useTsOptions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const projects = (opts.data?.projects ?? []).map((p) => ({ value: p.id, label: p.name }));
  const fields: FieldDef[] = [
    { name: 'taskText', label: 'Task', type: 'text', span: 2, required: true, placeholder: 'e.g. Hotfix for invoice export' },
    { name: 'projectId', label: 'Project', type: 'select', span: 1, required: true, options: projects },
    { name: 'date', label: 'Date', type: 'date', span: 1, required: true },
    { name: 'from', label: 'From', type: 'time', span: 1, required: true },
    { name: 'to', label: 'To', type: 'time', span: 1, required: true },
    { name: 'reason', label: 'Reason', type: 'area', span: 2, required: true },
  ];
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const lastDay = week.weekEnd < today ? week.weekEnd : today;
  if (opts.isLoading) return null;
  return (
    <FormModal
      title="Log outside-hours task"
      fields={fields}
      submitLabel="Log hours"
      initial={{ date: lastDay }}
      onSubmit={async (v) => {
        const d = await post<TimesheetWeek>(`/timesheets/${week.id}/outside-hours`, v);
        onSaved(d);
        void qc.invalidateQueries({ queryKey: ['time', 'week'] });
        toast('Added for PL review');
      }}
      onClose={onClose}
    />
  );
}

function AddRowForm({ week, onClose, onSaved }: { week: TimesheetWeek; onClose: () => void; onSaved: (w: TimesheetWeek) => void }) {
  const opts = useTsOptions();
  const { toast } = useToast();
  const have = new Set(week.lines.map((l) => l.taskId).filter(Boolean));
  const tasks = (opts.data?.tasks ?? []).filter((t) => !have.has(t.id)).map((t) => ({ value: t.id, label: `${t.key} ${t.title} · ${t.projectName}` }));
  if (opts.isLoading) return null;
  return (
    <FormModal
      title="Add task row"
      fields={[{ name: 'taskId', label: 'Task', type: 'select', span: 2, required: true, options: tasks }]}
      submitLabel="Add row"
      onSubmit={async (v) => {
        const d = await post<TimesheetWeek>(`/timesheets/${week.id}/lines`, { taskId: v.taskId });
        onSaved(d);
        toast('Row added · click a day to enter hours');
      }}
      onClose={onClose}
    />
  );
}
