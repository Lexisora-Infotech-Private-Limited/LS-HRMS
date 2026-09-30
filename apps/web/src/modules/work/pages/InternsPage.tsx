import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { INTERN_TASK_STATUSES, type InternSheetRow, type InternTaskRow, type InternWeek } from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { FormModal } from '@/components/form';
import { DataTable, type Column } from '@/components/table';
import { Empty, ErrorBlock, Loading, PageHeader, Tabs, Tag, humanize, type Tone } from '@/components/ui';
import { workApi, workKeys } from '../api';
import { Drawer } from '../components';
import '../work.css';

const STATUS_TONE: Record<string, Tone> = { DONE: 'accent', IN_PROGRESS: 'outline', ASSIGNED: 'outline', NOT_DONE: 'danger', NOT_ASSIGNED: 'neutral' };
const TASK_LABEL: Record<string, string> = { ASSIGNED: 'Not started', IN_PROGRESS: 'In progress', DONE: 'Done', NOT_DONE: 'Not done' };
const inv = [workKeys.interns];

type Tab = 'sheets' | 'mine';

export default function InternsPage() {
  const ctx = useQuery({ queryKey: [...workKeys.interns, 'ctx'], queryFn: workApi.internContext });
  const [tab, setTab] = useState<Tab | null>(null);
  if (ctx.isLoading) return <Loading />;
  if (ctx.error || !ctx.data) return <ErrorBlock error={ctx.error} retry={() => void ctx.refetch()} />;
  const c = ctx.data;
  const mentorView = c.isMentor || c.canViewAll || c.canAssign;
  const current: Tab = tab ?? (mentorView ? 'sheets' : 'mine');
  return (
    <div data-screen-label="Intern task sheets" className="stack" style={{ gap: 18 }}>
      {mentorView && c.isIntern && (
        <Tabs<Tab> value={current} onChange={setTab} tabs={[{ value: 'sheets', label: 'Intern task sheets' }, { value: 'mine', label: 'My task sheet' }]} />
      )}
      {current === 'sheets' && mentorView ? <MentorView today={c.today} canAssign={c.canAssign} mentees={c.mentees} canViewAll={c.canViewAll} /> : c.isIntern ? <MySheet today={c.today} /> : <NotIntern />}
    </div>
  );
}

function NotIntern() {
  return (
    <>
      <PageHeader title="Intern task sheets" sub="Interns have a separate dashboard with daily task sheets, tracked apart from full-time staff." />
      <Empty>You have no interns to mentor and no intern task sheet.</Empty>
    </>
  );
}

function MentorView({ today, canAssign, mentees, canViewAll }: { today: string; canAssign: boolean; mentees: { value: string; label: string }[]; canViewAll: boolean }) {
  const [date, setDate] = useState(today);
  const [assigning, setAssigning] = useState(false);
  const [openIntern, setOpenIntern] = useState<string | null>(null);
  const sheet = useQuery({ queryKey: [...workKeys.interns, 'sheet', date], queryFn: () => workApi.internSheet({ date }) });
  const assign = useAction((b: unknown) => workApi.assignIntern(b), { success: 'Task assigned · intern notified', invalidate: inv });
  const columns: Column<InternSheetRow>[] = [
    { key: 'i', header: 'Intern', render: (r) => <div><div>{r.internName}</div><div className="faint" style={{ fontSize: 11.5 }}>{r.empCode}{r.department ? ` · ${r.department}` : ''}</div></div> },
    { key: 'm', header: 'Mentor', render: (r) => r.mentorName ?? '—' },
    { key: 't', header: "Today's task", render: (r) => (r.todayTask ? <span>{r.todayTask}{r.todayMore ? <span className="faint"> +{r.todayMore} more</span> : null}</span> : <span className="faint">Not assigned</span>) },
    { key: 'h', header: 'Hours', num: true, render: (r) => (r.hours ? r.hours : r.tasks.length ? '0' : '—') },
    { key: 's', header: 'Status', render: (r) => <Tag tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.statusLabel}</Tag> },
    { key: 'w', header: 'Week score', num: true, render: (r) => (r.weekScore != null ? r.weekScore.toFixed(1) : '—') },
  ];
  return (
    <>
      <PageHeader
        title="Intern task sheets"
        sub="Interns have a separate dashboard with daily task sheets, tracked apart from full-time staff."
        actions={canAssign ? <button className="btn btn-primary" onClick={() => setAssigning(true)}>Assign task</button> : undefined}
      />
      <div className="wk-toolbar">
        <span style={{ fontSize: 13 }}>Day:</span>
        <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 'auto' }} />
        {date !== today && <button className="btn btn-ghost btn-sm" onClick={() => setDate(today)}>Today</button>}
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12.5 }}>{canViewAll ? 'All interns' : 'Your mentees'} · open a row for the week sheet and scoring</span>
      </div>
      {sheet.error ? (
        <ErrorBlock error={sheet.error} retry={() => void sheet.refetch()} />
      ) : (
        <DataTable columns={columns} rows={sheet.data} loading={sheet.isLoading} rowKey={(r) => r.internEmployeeId} onRowClick={(r) => setOpenIntern(r.internEmployeeId)} empty="No interns assigned to you." />
      )}
      {assigning && (
        <FormModal
          title="Assign intern task"
          submitLabel="Assign"
          fields={[
            { name: 'internEmployeeId', label: 'Intern', type: 'select', options: mentees, required: true },
            { name: 'date', label: 'Date', type: 'date', required: true },
            { name: 'title', label: 'Task', type: 'area', span: 2, required: true },
            { name: 'estimatedHours', label: 'Estimated hours', type: 'number' },
          ]}
          initial={{ date }}
          onSubmit={(v) => assign.mutateAsync({ internEmployeeId: v.internEmployeeId, date: v.date, title: v.title, estimatedHours: v.estimatedHours ?? null })}
          onClose={() => setAssigning(false)}
        />
      )}
      {openIntern && <WeekDrawer internId={openIntern} startDate={date} onClose={() => setOpenIntern(null)} />}
    </>
  );
}

/** The intern's own dashboard section: today's tasks + this week. */
function MySheet({ today }: { today: string }) {
  const sheet = useQuery({ queryKey: [...workKeys.interns, 'mine', today], queryFn: () => workApi.internSheet({ date: today }) });
  const me = sheet.data?.[0];
  return (
    <>
      <PageHeader title="My task sheet" sub="Your daily tasks from your mentor. Update status and hours as you go; your mentor scores the week." />
      {sheet.isLoading ? (
        <Loading />
      ) : sheet.error ? (
        <ErrorBlock error={sheet.error} />
      ) : !me ? (
        <Empty>No task sheet found.</Empty>
      ) : (
        <WeekView internId={me.internEmployeeId} startDate={today} />
      )}
    </>
  );
}

function WeekDrawer({ internId, startDate, onClose }: { internId: string; startDate: string; onClose: () => void }) {
  return (
    <Drawer onClose={onClose} label="Intern week">
      <div className="wk-drawer-head">
        <span className="kicker">Week sheet</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <WeekView internId={internId} startDate={startDate} />
    </Drawer>
  );
}

function mondayOf(dateKey: string) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
}
const shiftWeek = (wk: string, n: number) => new Date(new Date(`${wk}T00:00:00Z`).getTime() + n * 7 * 86400000).toISOString().slice(0, 10);

function WeekView({ internId, startDate }: { internId: string; startDate: string }) {
  const [week, setWeek] = useState(mondayOf(startDate));
  const q = useQuery({ queryKey: [...workKeys.interns, 'week', internId, week], queryFn: () => workApi.internWeek(internId, week) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  const w = q.data;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 className="serif" style={{ margin: 0, fontSize: 22 }}>{w.intern.name}</h3>
          <div className="faint" style={{ fontSize: 12.5 }}>{w.intern.empCode}{w.intern.department ? ` · ${w.intern.department}` : ''} · Mentor {w.intern.mentorName ?? '—'}</div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeek(shiftWeek(week, -1))}>← Prev</button>
          <span style={{ fontSize: 13 }}>Week of {new Date(`${w.weekStart}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeek(shiftWeek(week, 1))}>Next →</button>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">Hours</div><div className="kpi-value">{w.totals.hours}</div></div>
        <div className="kpi"><div className="kpi-label">Tasks done</div><div className="kpi-value">{w.totals.done} / {w.totals.total}</div></div>
        <div className="kpi"><div className="kpi-label">Week score</div><div className="kpi-value">{w.effectiveScore != null ? w.effectiveScore.toFixed(1) : '—'}</div><div className="kpi-sub">{w.weekScore ? `Scored by ${w.weekScore.scoredBy ?? 'mentor'}` : w.totals.avgTaskScore != null ? 'Average of task scores' : 'Not scored yet'}</div></div>
      </div>
      {w.days.map((d) => (
        <div key={d.date}>
          <div className="wk-section-title">{d.label}</div>
          {d.tasks.length ? d.tasks.map((t) => <TaskRow key={t.id} t={t} w={w} />) : <div className="faint" style={{ fontSize: 13 }}>No tasks.</div>}
        </div>
      ))}
      {w.canScore && <WeekScoreForm w={w} internId={internId} />}
      {w.weekScore?.feedback && !w.canScore && <div className="note">Mentor feedback: {w.weekScore.feedback}</div>}
      {w.trend.length > 1 && (
        <div className="faint" style={{ fontSize: 12.5 }}>
          Trend: {w.trend.map((x) => `${new Date(`${x.weekStart}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${x.score != null ? x.score.toFixed(1) : '—'}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

function TaskRow({ t, w }: { t: InternTaskRow; w: InternWeek }) {
  const [hours, setHours] = useState(t.hours != null ? String(t.hours) : '');
  const [note, setNote] = useState(t.internNote ?? '');
  const [score, setScore] = useState(t.mentorScore != null ? String(t.mentorScore) : '');
  const [feedback, setFeedback] = useState(t.mentorFeedback ?? '');
  const upd = useAction((b: Record<string, unknown>) => workApi.updateInternTask(t.id, b), { success: 'Task sheet updated', invalidate: inv });
  const remove = useAction(() => workApi.removeInternTask(t.id), { success: 'Task removed', invalidate: inv });
  const carry = useAction(() => workApi.carryOver(t.id), { success: 'Carried over to the next working day', invalidate: inv });
  const scoreable = t.status === 'DONE' || t.status === 'NOT_DONE';
  return (
    <div className="list-row" style={{ flexDirection: 'column', gap: 6 }}>
      <div className="row-between" style={{ gap: 8 }}>
        <span>{t.title}{t.linkedTaskKey && <span className="faint"> · {t.linkedTaskKey}</span>}{t.carriedFromId && <span className="faint"> · carried over</span>}</span>
        <Tag tone={STATUS_TONE[t.status] ?? 'neutral'}>{TASK_LABEL[t.status] ?? humanize(t.status)}</Tag>
      </div>
      {w.canEditOwn && (
        <div className="wk-inline-form">
          <select className="input" style={{ width: 150, minWidth: 0 }} value={t.status} onChange={(e) => upd.mutate({ status: e.target.value })}>
            {INTERN_TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_LABEL[s]}</option>)}
          </select>
          <input className="input" style={{ width: 90, minWidth: 0 }} inputMode="decimal" placeholder="Hours" value={hours} onChange={(e) => setHours(e.target.value)} onBlur={() => hours !== (t.hours != null ? String(t.hours) : '') && upd.mutate({ hours: hours ? Number(hours) : null })} />
          <input className="input" style={{ flex: 1 }} placeholder="Note for your mentor" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (t.internNote ?? '') && upd.mutate({ internNote: note || null })} />
        </div>
      )}
      {!w.canEditOwn && (
        <div className="faint" style={{ fontSize: 12.5 }}>
          {t.hours != null ? `${t.hours}h` : 'No hours'}{t.estimatedHours != null ? ` of ${t.estimatedHours}h est.` : ''}{t.internNote ? ` · “${t.internNote}”` : ''}
        </div>
      )}
      {w.canScore ? (
        <div className="wk-inline-form">
          <input className="input" style={{ width: 90, minWidth: 0 }} inputMode="decimal" placeholder="Score /10" disabled={!scoreable} value={score} onChange={(e) => setScore(e.target.value)} />
          <input className="input" style={{ flex: 1 }} placeholder={scoreable ? 'Feedback' : 'Score once the task is done or not done'} disabled={!scoreable} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          <button className="btn btn-secondary btn-sm" disabled={!scoreable || upd.isPending} onClick={() => upd.mutate({ mentorScore: score ? Number(score) : null, mentorFeedback: feedback || null })}>Save score</button>
          {t.status === 'NOT_DONE' && <button className="btn btn-ghost btn-sm" onClick={() => carry.mutate(undefined)}>Carry over</button>}
          {t.mentorScore == null && <button className="btn btn-ghost btn-sm" onClick={() => remove.mutate(undefined)}>Remove</button>}
        </div>
      ) : (
        t.mentorScore != null && <div style={{ fontSize: 12.5 }}>Score {t.mentorScore}/10{t.mentorFeedback ? ` · ${t.mentorFeedback}` : ''}</div>
      )}
    </div>
  );
}

function WeekScoreForm({ w, internId }: { w: InternWeek; internId: string }) {
  const [score, setScore] = useState(w.weekScore ? String(w.weekScore.score) : w.totals.avgTaskScore != null ? String(w.totals.avgTaskScore) : '');
  const [feedback, setFeedback] = useState(w.weekScore?.feedback ?? '');
  const save = useAction(() => workApi.scoreWeek(internId, { weekStart: w.weekStart, score: Number(score), feedback: feedback || null }), { success: 'Week score saved · intern notified', invalidate: inv });
  const valid = score !== '' && !Number.isNaN(Number(score)) && Number(score) >= 0 && Number(score) <= 10;
  return (
    <div className="card">
      <div className="card-kicker">Weekly score</div>
      <div className="wk-inline-form">
        <input className="input" style={{ width: 110, minWidth: 0 }} inputMode="decimal" placeholder="0–10" value={score} onChange={(e) => setScore(e.target.value)} />
        <input className="input" style={{ flex: 1 }} placeholder="Feedback for the week" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        <button className="btn btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined)}>Save week score</button>
      </div>
      <div className="field-hint">Half-point steps. Overrides the average of task scores.</div>
    </div>
  );
}
