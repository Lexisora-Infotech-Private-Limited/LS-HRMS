import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { dayPartFor, type DashboardTodo, type NoticeDetail, type PersonalTodoRow } from '@lexisora/shared';
import { useCan, useMe } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { onRealtime } from '@/lib/socket';
import { ErrorBlock, Loading, Modal, Tag } from '@/components/ui';
import { FormModal, type FieldDef } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { PunchCard } from '@/modules/time/punch';
import { LeaveBalanceCard, LeaveHistoryList } from '@/modules/leavepay/widgets';
import { wpApi, wpKeys } from '../api';
import { NoticeDrawer } from '../components/NoticeDrawer';
import { NoticeFormModal } from '../components/NoticeForm';
import '../workplace.css';

type AddMode = 'todo' | 'task' | null;

/** Dashboard — wireframe lines 383–434. */
export default function DashboardPage() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: wpKeys.dashboard, queryFn: () => wpApi.dashboard(), refetchInterval: 60_000, refetchOnWindowFocus: true });
  const [openNotice, setOpenNotice] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<NoticeDetail | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Live refresh: server pushes dashboard:invalidate (approvals, to-dos, new notices).
  useEffect(() => {
    const refresh = () => void qc.invalidateQueries({ queryKey: wpKeys.dashboard });
    const offs = [onRealtime('dashboard:invalidate', refresh), onRealtime('notice:new', refresh)];
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      offs.forEach((off) => off());
      window.clearInterval(t);
    };
  }, [qc]);

  if (isLoading && !data) return <Loading label="Loading your day…" />;
  if (error && !data) return <ErrorBlock error={error} retry={() => void refetch()} />;
  const g = data?.greeting;
  const dayPart = dayPartFor(now);

  return (
    <div data-screen-label="Dashboard" className="stack" style={{ gap: 22 }}>
      <div className="row-between" style={{ alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div className="kicker">{g?.kicker}</div>
          <h2 style={{ margin: '4px 0 0' }}>
            Good {dayPart}, {g?.firstName || me.firstName}
          </h2>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {g?.title || me.title}
        </div>
      </div>

      {data?.quote && (
        <div className="wp-quote">
          <span className="wp-quote-label">Thought of the day</span>
          <span className="wp-quote-text">
            {data.quote.text}
            {data.quote.author && <span className="wp-quote-author"> — {data.quote.author}</span>}
          </span>
        </div>
      )}

      <div className="wp-cards">
        <PunchCard />
        <LeaveBalanceCard />
        <TodoCard todos={data?.todos ?? []} more={data?.todosMore ?? 0} />
        {data?.approvals && <ApprovalsCard rows={data.approvals} />}
      </div>

      <div className="grid-2-1">
        <div className="stack" style={{ gap: 10 }}>
          <div className="row-between">
            <h4 style={{ margin: 0 }}>Announcements</h4>
            <button className="wp-link" onClick={() => nav('/notices')}>
              Notice board
            </button>
          </div>
          {(data?.announcements ?? []).map((a) => (
            <div key={a.id} className="wp-ann" role="button" tabIndex={0} onClick={() => setOpenNotice(a.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenNotice(a.id)}>
              <span style={{ alignSelf: 'flex-start' }}>
                <Tag tone={a.scope === 'Global' ? 'accent' : 'outline'}>{a.scope}</Tag>
              </span>
              <div className="grow">
                <div className="wp-ann-title">
                  {a.title}
                  {!a.read && <span className="wp-dot" title="New" />}
                </div>
                <div className="wp-ann-body">{a.body}</div>
              </div>
              <span className="wp-ann-date">{a.date}</span>
            </div>
          ))}
          {data && !data.announcements?.length && <div className="list-row faint">No announcements right now.</div>}
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <div className="row-between">
            <h4 style={{ margin: 0 }}>Birthdays &amp; events</h4>
            <button className="wp-link" onClick={() => nav('/notices?tab=events')}>
              See all
            </button>
          </div>
          {(data?.events ?? []).map((e) => (
            <div key={e.id} className="list-row">
              <span>{e.what}</span>
              <span className="faint" style={{ whiteSpace: 'nowrap' }}>
                {e.when}
              </span>
            </div>
          ))}
          {data && !data.events?.length && <div className="list-row faint">Nothing coming up this week.</div>}
          <LeaveHistoryList />
        </div>
      </div>

      {openNotice && (
        <NoticeDrawer
          id={openNotice}
          onClose={() => setOpenNotice(null)}
          onEdit={(n) => {
            setOpenNotice(null);
            setEditNotice(n);
          }}
        />
      )}
      {editNotice && <NoticeFormModal notice={editNotice} onClose={() => setEditNotice(null)} />}
    </div>
  );
}

// ── Pending to-do ──────────────────────────────────────────────────────────

function TodoCard({ todos, more }: { todos: DashboardTodo[]; more: number }) {
  const can = useCan();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const [add, setAdd] = useState<AddMode>(null);
  const [all, setAll] = useState(false);
  const complete = useAction((id: string) => wpApi.completeTodo(id), { success: 'Marked done', invalidate: [wpKeys.dashboard, wpKeys.todos] });

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  return (
    <div className="card">
      <div className="card-kicker">Pending to-do</div>
      {todos.map((t) => (
        <TodoLine key={t.id} t={t} onDone={() => complete.mutate(t.id)} busy={complete.isPending && complete.variables === t.id} onOpen={() => t.link && nav(t.link)} />
      ))}
      {!todos.length && <div className="wp-muted-card">You’re all caught up.</div>}
      {more > 0 && (
        <button className="wp-link" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(true)}>
          +{more} more
        </button>
      )}
      <div className="wp-menu-anchor">
        <button
          className="btn btn-ghost"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={(e) => {
            e.stopPropagation();
            setMenu((m) => !m);
          }}
        >
          Add task
        </button>
        {menu && (
          <div className="menu" role="menu">
            <button role="menuitem" onClick={() => setAdd('todo')}>
              Personal to-do
            </button>
            {can('tasks.manage') && (
              <button role="menuitem" onClick={() => setAdd('task')}>
                Board task
              </button>
            )}
            <button role="menuitem" onClick={() => setAll(true)}>
              View all to-dos
            </button>
          </div>
        )}
      </div>
      {add === 'todo' && <PersonalTodoModal onClose={() => setAdd(null)} />}
      {add === 'task' && <BoardTaskModal onClose={() => setAdd(null)} />}
      {all && <AllTodosModal onClose={() => setAll(false)} onAdd={() => setAdd('todo')} />}
    </div>
  );
}

function TodoLine({ t, onDone, onOpen, busy }: { t: DashboardTodo; onDone: () => void; onOpen: () => void; busy?: boolean }) {
  return (
    <div className="wp-todo">
      <button
        type="button"
        className="wp-box"
        role="checkbox"
        aria-checked={false}
        aria-label={t.checkable ? `Mark “${t.text}” done` : 'Clears automatically when done'}
        title={t.checkable ? 'Mark done' : 'Clears automatically when done'}
        disabled={!t.checkable || busy}
        onClick={onDone}
      />
      <span className={`wp-todo-text${t.link ? ' link' : ''}`} onClick={t.link ? onOpen : undefined}>
        {t.text}
      </span>
      <Tag tone={t.overdue ? 'danger' : 'neutral'}>{t.due}</Tag>
    </div>
  );
}

const TODO_FIELDS: FieldDef[] = [
  { name: 'title', label: 'Title', type: 'text', span: 2, required: true, placeholder: 'e.g. Prepare sprint demo notes' },
  { name: 'dueDate', label: 'Due date', type: 'date' },
  { name: 'note', label: 'Note', type: 'area', placeholder: 'Only you can see personal to-dos.' },
];

function PersonalTodoModal({ onClose, todo }: { onClose: () => void; todo?: PersonalTodoRow }) {
  const save = useAction(
    (v: { title: string; dueDate: string | null; note: string | null }) => (todo ? wpApi.updateTodo(todo.id, v) : wpApi.createTodo(v)),
    { success: todo ? 'To-do updated' : 'To-do added', invalidate: [wpKeys.dashboard, wpKeys.todos] },
  );
  return (
    <FormModal
      title={todo ? 'Edit to-do' : 'Add personal to-do'}
      fields={TODO_FIELDS}
      initial={todo ? { title: todo.title, dueDate: todo.dueDate ?? '', note: todo.note ?? '' } : undefined}
      submitLabel={todo ? 'Save' : 'Add to-do'}
      onSubmit={(v) => save.mutateAsync({ title: String(v.title ?? ''), dueDate: v.dueDate || null, note: v.note || null })}
      onClose={onClose}
    />
  );
}

/** FORMS.task — creates a real board task through the Work domain's POST /tasks. */
function BoardTaskModal({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const lk = useLookups(['projects', 'employees', 'teams']);
  const save = useAction((v: Record<string, any>) => wpApi.createTask(v as Parameters<typeof wpApi.createTask>[0]), { success: 'Task added', invalidate: [wpKeys.dashboard, ['work']] });
  const fields = useMemo<FieldDef[]>(
    () => [
      { name: 'title', label: 'Title', type: 'text', span: 2, required: true },
      { name: 'projectId', label: 'Project', type: 'select', required: true, options: opts(lk.data, 'projects') },
      { name: 'moduleName', label: 'Module', type: 'text', placeholder: 'e.g. Billing' },
      { name: 'assigneeEmployeeId', label: 'Assignee', type: 'select', options: opts(lk.data, 'employees'), placeholder: 'Unassigned' },
      { name: 'estimatedHours', label: 'Estimated hours', type: 'number', placeholder: 'e.g. 6' },
      { name: 'dueDate', label: 'Due date', type: 'date' },
      { name: 'departmentId', label: 'Team board', type: 'select', required: true, options: opts(lk.data, 'teams') },
      { name: 'description', label: 'Description', type: 'area' },
    ],
    [lk.data],
  );
  if (lk.isLoading) return null;
  return (
    <FormModal
      title="Add task"
      fields={fields}
      submitLabel="Add task"
      initial={{ assigneeEmployeeId: me.employeeId ?? '' }}
      onSubmit={(v) => save.mutateAsync({ ...v, estimatedHours: v.estimatedHours ?? null })}
      onClose={onClose}
    />
  );
}

function AllTodosModal({ onClose, onAdd }: { onClose: () => void; onAdd: () => void }) {
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: wpKeys.todos, queryFn: wpApi.todos });
  const [edit, setEdit] = useState<PersonalTodoRow | null>(null);
  const inv = [wpKeys.dashboard, wpKeys.todos];
  const complete = useAction((id: string) => wpApi.completeTodo(id), { success: 'Marked done', invalidate: inv });
  const reopen = useAction((id: string) => wpApi.reopenTodo(id), { success: 'Moved back to your list', invalidate: inv });
  const remove = useAction((id: string) => wpApi.deleteTodo(id), { success: 'To-do deleted', invalidate: inv });
  const others = (data?.items ?? []).filter((t) => t.source !== 'PERSONAL');
  const personal = data?.personal ?? [];
  return (
    <Modal
      title="Pending to-do"
      onClose={onClose}
      wide
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onClose();
              onAdd();
            }}
          >
            Add personal to-do
          </button>
        </>
      }
    >
      {isLoading && <Loading />}
      {data && (
        <div className="stack" style={{ gap: 14 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>From your work · clears automatically</div>
            {others.map((t) => (
              <TodoLine
                key={t.id}
                t={t}
                onDone={() => undefined}
                onOpen={() => {
                  onClose();
                  if (t.link) nav(t.link);
                }}
              />
            ))}
            {!others.length && <div className="wp-muted-card">Nothing waiting on you.</div>}
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Personal · only you can see these</div>
            {personal.map((p) => (
              <div key={p.id} className="wp-todo">
                <button
                  type="button"
                  className={`wp-box${p.completedAt ? ' done' : ''}`}
                  role="checkbox"
                  aria-checked={!!p.completedAt}
                  aria-label={p.completedAt ? 'Reopen' : 'Mark done'}
                  onClick={() => (p.completedAt ? reopen.mutate(p.id) : complete.mutate(p.id))}
                >
                  {p.completedAt ? '✓' : ''}
                </button>
                <span className={`wp-todo-text${p.completedAt ? ' wp-strike' : ''}`}>
                  {p.title}
                  {p.note && <span className="faint"> · {p.note}</span>}
                </span>
                <Tag tone={p.overdue ? 'danger' : 'neutral'}>{p.completedAt ? 'Done' : p.due}</Tag>
                {!p.completedAt && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setEdit(p)}>
                    Edit
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => remove.mutate(p.id)} aria-label={`Delete ${p.title}`}>
                  Delete
                </button>
              </div>
            ))}
            {!personal.length && <div className="wp-muted-card">No personal to-dos. Add one for anything you want to remember.</div>}
          </div>
        </div>
      )}
      {edit && <PersonalTodoModal todo={edit} onClose={() => setEdit(null)} />}
    </Modal>
  );
}

// ── Awaiting your approval ─────────────────────────────────────────────────

function ApprovalsCard({ rows }: { rows: { key: string; label: string; count: number; link: string }[] }) {
  const nav = useNavigate();
  const target = rows.find((r) => r.count > 0) ?? rows[0];
  return (
    <div className="card">
      <div className="card-kicker">Awaiting your approval</div>
      {rows.map((r) => (
        <div key={r.key} className="kv-row" style={{ cursor: 'pointer' }} onClick={() => nav(r.link)}>
          <span>{r.label}</span>
          <span className="tnum">{r.count}</span>
        </div>
      ))}
      <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={!target} onClick={() => target && nav(target.link)}>
        Review now
      </button>
    </div>
  );
}
