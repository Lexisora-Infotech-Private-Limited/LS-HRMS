import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SubmitResult, TimesheetCellDto, TimesheetLineDto, TimesheetWeek } from '@lexisora/shared';
import { FormModal, type FieldDef } from '@/components/form';
import { ErrorBlock, Loading, Modal, PageHeader, Tag, toneFor } from '@/components/ui';
import { HttpError, del, post, put } from '@/lib/api';
import { useAction } from '@/lib/query';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { addDaysKey, hmm, istToday, parseHmm, tk, useTsOptions, useWeek } from '../api';
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
        if (window.confirm(`${e.message}\n\nSubmit an empty timesheet anyway?`)) return void submit(true);
      } else toastError(e);
    } finally {
      setBusy(false);
    }
  }
  const recall = useAction(() => post(`/timesheets/${w!.id}/recall`), { success: 'Timesheet recalled · you can edit it again', invalidate: [tk.all] });
  const removeLine = useAction((lineId: string) => del<TimesheetWeek>(`/timesheets/${w!.id}/lines/${lineId}`), { success: 'Row removed', onSuccess: (d) => setWeek(d) });
  const removeOh = useAction((id: string) => del(`/timesheets/outside-hours/${id}`), { success: 'Outside-hours entry removed', invalidate: [tk.all] });

  if (q.isLoading) return <Loading />;
  if (q.isError || !w) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;

  return (
    <div data-screen-label="My timesheet" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="My timesheet"
        sub={`Week of ${w.label} · hours come from the desktop tracker, edits need a reason.`}
        actions={
          <>
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
          {w.days.map((d) => (
            <span key={d.date} title={d.holiday ?? (d.weeklyOff ? 'Weekly off' : d.label)} className={d.weeklyOff || d.holiday ? 'time-day-off' : undefined}>
              {d.dow}
              <span className="sub" style={{ letterSpacing: 0, textTransform: 'none' }}>{d.label}</span>
            </span>
          ))}
          <span>Total</span>
        </div>
        {w.lines.length === 0 && <div className="empty">No hours yet this week.</div>}
        {w.lines.map((l) => (
          <div className="rw" key={l.id}>
            <span>
              <span style={{ display: 'block' }}>
                {l.label}
                {w.editable && l.isManual && l.total === 0 && (
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6, padding: '0 6px' }} title="Remove row" onClick={() => removeLine.mutate(l.id)}>×</button>
                )}
              </span>
              <span className="sub">{l.subLabel ?? ''}{l.billable ? '' : l.subLabel ? ' · non-billable' : 'Non-billable'}</span>
            </span>
            {l.cells.map((c, i) => {
              const title = [
                c.tracked ? `Tracked ${hmm(c.tracked)}` : null,
                c.idleAsWork ? `Idle claimed as work ${hmm(c.idleAsWork)}` : null,
                c.pendingIdle ? `Idle claim pending ${hmm(c.pendingIdle)}` : null,
                c.outsideHours ? `Outside hours ${hmm(c.outsideHours)}${c.ohPending ? ' (pending PL)' : ''}` : null,
                c.adjustment ? `Adjusted ${c.adjustment > 0 ? '+' : ''}${hmm(c.adjustment)}${c.adjustmentReason ? ` · ${c.adjustmentReason}` : ''}` : null,
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
                </span>
              );
            })}
            <span style={{ fontWeight: 600 }}>{hmm(l.total) === '–' ? '0:00' : hmm(l.total)}</span>
          </div>
        ))}
        <div className="rw idle">
          <span>Auto-idle deducted</span>
          {w.idleRow.map((m, i) => (
            <span key={i}>{hmm(m)}</span>
          ))}
          <span>{hmm(w.totals.idle) === '–' ? '0:00' : hmm(w.totals.idle)}</span>
        </div>
        <div className="rw tot">
          <span>Total worked</span>
          {w.dayTotals.map((m, i) => (
            <span key={i}>{hmm(m)}</span>
          ))}
          <span>{hmm(w.totals.worked) === '–' ? '0:00' : hmm(w.totals.worked)}</span>
        </div>
      </div>
      {w.editable && (
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => setAddRow(true)}>+ Add task row</button>
        </div>
      )}

      {w.outsideHours.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h4 style={{ margin: 0 }}>Outside-hours tasks</h4>
          {w.outsideHours.map((o) => (
            <div key={o.id} className="time-item">
              <span>
                <b>{o.taskText}</b> · {o.projectName ?? '—'} · {o.dateLabel} {o.from}–{o.to} ({hmm(o.minutes)})
                <span className="sub faint" style={{ display: 'block' }}>{o.reason}</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <Tag tone={toneFor(o.reviewStatus)}>{o.reviewStatus === 'PENDING' ? 'Pending PL review' : o.reviewStatus.charAt(0) + o.reviewStatus.slice(1).toLowerCase()}</Tag>
                {w.editable && o.reviewStatus === 'PENDING' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => removeOh.mutate(o.id)}>Remove</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {edit && <CellEditor week={w} edit={edit} onClose={() => setEdit(null)} onSaved={setWeek} />}
      {outside && <OutsideHoursForm week={w} onClose={() => setOutside(false)} onSaved={setWeek} />}
      {addRow && <AddRowForm week={w} onClose={() => setAddRow(false)} onSaved={setWeek} />}
    </div>
  );
}

function CellEditor({ week, edit, onClose, onSaved }: { week: TimesheetWeek; edit: { line: TimesheetLineDto; cell: TimesheetCellDto; idx: number }; onClose: () => void; onSaved: (w: TimesheetWeek) => void }) {
  const { cell, line } = edit;
  const day = week.days[edit.idx]!;
  const [value, setValue] = useState(cell.final ? hmm(cell.final) : '');
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
  const changed = minutes !== null && minutes !== cell.final;
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
        <div className="kv-row"><span>Tracked by desktop app</span><span className="tnum">{hmm(cell.tracked) === '–' ? '0:00' : hmm(cell.tracked)}</span></div>
        {cell.idleAsWork > 0 && <div className="kv-row"><span>Idle claimed as work</span><span className="tnum">{hmm(cell.idleAsWork)}</span></div>}
        {cell.outsideHours > 0 && <div className="kv-row"><span>Outside hours{cell.ohPending ? ' (pending PL)' : ''}</span><span className="tnum">{hmm(cell.outsideHours)}</span></div>}
        {cell.adjustment !== 0 && <div className="kv-row"><span>Current adjustment</span><span className="tnum">{cell.adjustment > 0 ? '+' : ''}{hmm(cell.adjustment)}</span></div>}
        <div className="field">
          <label>Hours (H:MM)</label>
          <input className="input" autoFocus value={value} placeholder="0:00" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        </div>
        <div className="field">
          <label>Reason{needsReason ? '' : ' (optional)'}</label>
          <textarea className="input" value={reason} placeholder="Why does this differ from the tracker?" onChange={(e) => setReason(e.target.value)} />
          <div className="field-hint">Increases above tracked time go to your Project Lead for review.</div>
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
