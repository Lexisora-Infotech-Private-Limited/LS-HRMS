import { useEffect, useMemo, useRef, useState, type DragEvent, type SyntheticEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BOARD_COLUMNS,
  TASK_STATUS_LABELS,
  adjacentColumns,
  formatEstimate,
  formatSpent,
  liveSpentSeconds,
  showsProgress,
  sortBoardCards,
  spentProgress,
  timerStateLabel,
  type BoardView,
  type TaskCard,
  type TaskMoveResult,
  type TaskStatusKey,
} from '@lexisora/shared';
import { HttpError } from '@/lib/api';
import { useAction } from '@/lib/query';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { useLookups, opts } from '@/components/lookups';
import { Empty, ErrorBlock, Loading, Modal, Pills, Tag } from '@/components/ui';
import { workApi, workKeys } from '../api';
import { AddTaskModal } from '../components';
import { TaskDrawer } from './TaskDrawer';
import '../work.css';

/** The four rules above the board (static copy). */
const RULES = [
  { title: 'Allotted → In progress', body: 'Timer starts on your desktop tracker' },
  { title: 'In progress → Dev completed', body: 'Timer stops and the time is saved' },
  { title: 'Break or punch out', body: 'Timer pauses, resumes on the same task' },
  { title: 'Every minute tracked', body: 'Lands in your timesheet automatically' },
];

/** Board views are refetched on realtime events; this is only a safety net (e.g. timesheet edits). */
const REFRESH_MS = 60_000;

export default function BoardPage() {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [params, setParams] = useSearchParams();
  const lk = useLookups(['projects']);
  const projects = opts(lk.data, 'projects').filter((p) => !/· INT$/.test(p.label));
  const projectId = params.get('project') || projects[0]?.value || '';
  const taskId = params.get('task');
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);

  const boardsQ = useQuery({ queryKey: workKeys.boards(projectId), queryFn: () => workApi.projectBoards(projectId), enabled: !!projectId });
  const boards = boardsQ.data ?? [];
  const boardId = params.get('board') || boards.find((b) => !b.locked)?.departmentId || boards[0]?.departmentId || '';
  const board = boards.find((b) => b.departmentId === boardId);

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const boardKey = [...workKeys.board(projectId, boardId), showDone] as const;
  const viewQ = useQuery({
    queryKey: boardKey,
    queryFn: () => workApi.board(projectId, boardId, showDone),
    enabled: !!projectId && !!boardId && !board?.locked,
    retry: (n, e) => !(e instanceof HttpError && e.status === 403) && n < 1,
    refetchInterval: REFRESH_MS,
  });

  // Realtime: any move / new task / assignee change / tracker start-stop on this project refreshes the view.
  useEffect(() => {
    const off1 = onRealtime<{ projectId: string; departmentId: string | null }>('work.board', (p) => {
      if (p.projectId === projectId) void qc.invalidateQueries({ queryKey: ['work', 'board', projectId] });
    });
    const off2 = onRealtime<{ projectId: string }>('work.boardAccess', (p) => {
      void qc.invalidateQueries({ queryKey: workKeys.boards(p.projectId) });
      void qc.invalidateQueries({ queryKey: ['work', 'board', p.projectId] });
    });
    return () => {
      off1();
      off2();
    };
  }, [projectId, qc]);

  // One backend action for drag and drop and the ← / → links; the card moves at once and goes back on failure.
  const move = useMutation({
    mutationFn: (a: { card: TaskCard; to: TaskStatusKey }) => workApi.moveTask(a.card.id, { toStatus: a.to, version: a.card.version }),
    onMutate: async (a) => {
      await qc.cancelQueries({ queryKey: boardKey });
      const before = qc.getQueryData<BoardView>(boardKey);
      qc.setQueryData<BoardView>(boardKey, (old) => (old ? placeCard(old, { ...a.card, status: a.to, allowedMoves: [] }) : old));
      return { before };
    },
    onError: (e, _a, ctx) => {
      if (ctx?.before) qc.setQueryData(boardKey, ctx.before);
      toastError(e);
    },
    onSuccess: (r: TaskMoveResult) => {
      qc.setQueryData<BoardView>(boardKey, (old) => (old ? placeCard(old, r.task) : old));
      if (r.message) toast(r.message);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['work', 'board', projectId] });
      void qc.invalidateQueries({ queryKey: workKeys.projects });
    },
  });
  const doMove = (card: TaskCard, to: TaskStatusKey) => {
    if (card.status !== to) move.mutate({ card, to });
  };

  const lockedError = viewQ.error instanceof HttpError && viewQ.error.status === 403;
  const isLocked = !!board?.locked || lockedError;
  const view = viewQ.data;
  const projectName = view?.project.name ?? projects.find((p) => p.value === projectId)?.label.replace(/ · [A-Z]+$/, '') ?? '';
  // Server clock at render time, so running timers tick from the server's start time whatever the PC clock says.
  const skewMs = view ? Date.parse(view.serverNow) - viewQ.dataUpdatedAt : 0;

  return (
    <div data-screen-label="Task board" className="stack tb-page" style={{ gap: 20 }}>
      <div className="tb-head">
        <div>
          <h2>Task board · {projectName || '—'}</h2>
          <p>Drag cards between columns, or use the move links. Your timer follows the card.</p>
        </div>
        <div className="row">
          {board?.canManage && !isLocked && <button className="btn btn-secondary" onClick={() => setManaging(true)}>Manage members</button>}
          {view?.canCreate && !isLocked && <button className="btn btn-primary tb-add" onClick={() => setAdding(true)}>Add task</button>}
        </div>
      </div>

      <div className="tb-rules">
        {RULES.map((r) => (
          <div key={r.title} className="tb-rule">
            <div className="tb-rule-title">{r.title}</div>
            <div className="tb-rule-body">{r.body}</div>
          </div>
        ))}
      </div>

      <div className="tb-toolbar">
        <select className="input" value={projectId} onChange={(e) => setParam({ project: e.target.value, board: null, task: null })} aria-label="Project">
          {projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <span className="tb-toolbar-label">Team board:</span>
        {boards.length ? (
          <Pills value={boardId} onChange={(v) => setParam({ board: v, task: null })} options={boards.map((b) => ({ value: b.departmentId, label: `${b.name}${b.locked ? ' 🔒' : ''}` }))} />
        ) : (
          <span className="faint">{boardsQ.isLoading ? 'Loading…' : 'No team boards on this project'}</span>
        )}
        <span className="spacer" />
        {!isLocked && (
          <label className="radio tb-toolbar-label">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            <span className="dot" style={{ borderRadius: 3 }} />
            Show done
          </label>
        )}
      </div>

      {lk.isLoading ? (
        <Loading />
      ) : !projectId ? (
        <Empty>No active projects yet.</Empty>
      ) : isLocked ? (
        <div className="wk-locked">
          <div className="serif">This board is private to the {board?.name ?? 'team'} team</div>
          <div className="muted" style={{ fontSize: 13.5 }}>
            Team-level access control: only members allocated by the {board?.name ?? 'team'} lead{board?.leadName ? ` (${board.leadName})` : ''} can view or edit these tasks.
          </div>
        </div>
      ) : viewQ.error ? (
        <ErrorBlock error={viewQ.error} retry={() => void viewQ.refetch()} />
      ) : !view ? (
        <SkeletonColumns showDone={showDone} />
      ) : (
        <>
          {view.project.locked && <div className="note">This project is {view.project.status.toLowerCase()} — the board is read-only.</div>}
          <Columns view={view} skewMs={skewMs} onMove={doMove} onOpen={(id) => setParam({ task: id })} />
          <div className="tb-footer">
            Board members: {view.members.map((m) => `${m.name}${m.isLead ? ' (lead)' : ''}`).join(', ') || '—'} · you are signed in as {view.viewer.name}
          </div>
        </>
      )}

      {adding && view && (
        <AddTaskModal
          projectId={projectId}
          departmentId={boardId}
          members={view.members}
          me={view.viewer.employeeId}
          canAssignOthers={view.viewer.canManage}
          onClose={() => setAdding(false)}
        />
      )}
      {managing && board && <MembersDialog projectId={projectId} departmentId={boardId} onClose={() => setManaging(false)} />}
      {taskId && <TaskDrawer taskId={taskId} onClose={() => setParam({ task: null })} />}
    </div>
  );
}

/** The view with `card` in its (new) column, columns re-sorted and re-counted. */
function placeCard(view: BoardView, card: TaskCard): BoardView {
  const columns = view.columns.map((c) => {
    const others = c.cards.filter((x) => x.id !== card.id);
    const cards = c.status === card.status ? sortBoardCards([...others, card]) : others;
    return { ...c, cards, count: cards.length };
  });
  return { ...view, columns };
}

/** Loading: the same columns, no cards yet. */
function SkeletonColumns({ showDone }: { showDone: boolean }) {
  const cols: TaskStatusKey[] = [...BOARD_COLUMNS, ...(showDone ? (['DONE'] as const) : [])];
  return (
    <div className="tb-board" aria-busy="true">
      {cols.map((s) => (
        <div key={s} className="tb-col">
          <ColumnHead status={s} label={TASK_STATUS_LABELS[s]} count={null} />
        </div>
      ))}
    </div>
  );
}

function ColumnHead({ status, label, count }: { status: TaskStatusKey; label: string; count: number | null }) {
  const timerCol = status === 'WIP';
  return (
    <div className={`tb-col-head${timerCol ? ' has-note' : ''}`}>
      <span>{label}</span>
      <span className="tb-count">{count ?? '–'}</span>
      {timerCol && <span className="tb-note">timer runs here</span>}
    </div>
  );
}

function Columns({ view, skewMs, onMove, onOpen }: { view: BoardView; skewMs: number; onMove: (c: TaskCard, to: TaskStatusKey) => void; onOpen: (id: string) => void }) {
  const dragRef = useRef<TaskCard | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<TaskCard | null>(null);
  const cardsById = useMemo(() => new Map(view.columns.flatMap((c) => c.cards).map((c) => [c.id, c])), [view]);
  return (
    <div className="tb-board">
      {view.columns.map((col) => {
        const canDrop = !!dragging && dragging.allowedMoves.includes(col.status);
        return (
          <div
            key={col.status}
            className={`tb-col${canDrop ? ' can-drop' : ''}${canDrop && over === col.status ? ' over' : ''}`}
            onDragOver={(e) => {
              if (!canDrop) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (over !== col.status) setOver(col.status);
            }}
            onDragLeave={(e) => {
              if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const card = dragRef.current ?? cardsById.get(e.dataTransfer.getData('text/plain'));
              setOver(null);
              setDragging(null);
              dragRef.current = null;
              if (card && card.allowedMoves.includes(col.status)) onMove(card, col.status);
            }}
          >
            <ColumnHead status={col.status} label={col.label} count={col.count} />
            {col.cards.map((k) => (
              <Card
                key={k.id}
                card={k}
                skewMs={skewMs}
                dragging={dragging?.id === k.id}
                onDragStart={(e) => {
                  dragRef.current = k;
                  setDragging(k);
                  try {
                    e.dataTransfer.setData('text/plain', k.id);
                    e.dataTransfer.effectAllowed = 'move';
                  } catch {
                    /* ignore */
                  }
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onMove={onMove}
                onOpen={onOpen}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Card({
  card: k,
  skewMs,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onOpen,
}: {
  card: TaskCard;
  skewMs: number;
  dragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onMove: (c: TaskCard, to: TaskStatusKey) => void;
  onOpen: (id: string) => void;
}) {
  const { back, forward } = adjacentColumns(k.status);
  const canBack = !!back && k.allowedMoves.includes(back);
  const canForward = !!forward && k.allowedMoves.includes(forward);
  const draggable = k.allowedMoves.length > 0;
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className={`tb-card${k.timer ? ' is-running' : ''}${dragging ? ' dragging' : ''}${draggable ? '' : ' readonly'}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(k.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(k.id)}
    >
      <div className="tb-card-meta">
        <span>{k.key}{k.moduleName ? ` · ${k.moduleName}` : ''}</span>
        {k.timer?.mine ? (
          <span className="tb-rec" title="Your desktop tracker is timing this task">● REC</span>
        ) : k.gitMrUrl ? (
          <span className="tb-mr" title={`Merge request${k.gitMrState ? ` · ${k.gitMrState}` : ''}`}>MR</span>
        ) : k.gitSyncStatus === 'FAILED' ? (
          <Tag tone="danger">Git</Tag>
        ) : null}
      </div>
      <div className="tb-card-title">{k.title}</div>
      <div className="tb-card-row">
        <span className="tb-assignee">{k.assigneeShort}</span>
        {k.overdue ? <span className="tb-chip is-overdue">Overdue</span> : k.dueDate ? <span className="tb-chip">Due {dueLabel(k.dueDate)}</span> : null}
        {k.estimatedMinutes ? <span className="tb-chip">{formatEstimate(k.estimatedMinutes)}</span> : null}
      </div>
      {showsProgress(k) && <CardProgress card={k} skewMs={skewMs} />}
      {(canBack || canForward) && (
        <div className="tb-moves" onClick={stop} onKeyDown={stop}>
          {canBack && (
            <button className="tb-link" aria-label={`Move back to ${TASK_STATUS_LABELS[back!]}`} title={`Back to ${TASK_STATUS_LABELS[back!]}`} onClick={() => onMove(k, back!)}>
              ←
            </button>
          )}
          {canForward && (
            <button className="tb-link" onClick={() => onMove(k, forward!)}>
              Move to {TASK_STATUS_LABELS[forward!]} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "9:45 / 8h · Running" + bar; a running timer ticks every second from the server-sent start. */
function CardProgress({ card, skewMs }: { card: TaskCard; skewMs: number }) {
  const now = useNow(card.timer ? 1000 : null) + skewMs;
  const spent = liveSpentSeconds(card, now);
  const { pct, over } = spentProgress(spent, card.estimatedMinutes);
  return (
    <div className="tb-progress">
      <div className="tb-progress-line">
        <span className="tnum">
          {formatSpent(spent)} / {card.estimatedMinutes ? formatEstimate(card.estimatedMinutes) : 'no estimate'}
        </span>
        <span className={card.timer ? 'tb-running' : undefined}>{timerStateLabel(card)}</span>
      </div>
      <div className={`tb-bar${over ? ' is-over' : ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Date.now(), re-rendering every `ms` (null = no ticking). */
function useNow(ms: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ms) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return ms ? now : Date.now();
}

/** "2026-10-21" → "21 Oct". */
function dueLabel(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function MembersDialog({ projectId, departmentId, onClose }: { projectId: string; departmentId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: workKeys.boardMembers(projectId, departmentId), queryFn: () => workApi.boardMembers(projectId, departmentId) });
  const [emp, setEmp] = useState('');
  const inv = [workKeys.boardMembers(projectId, departmentId), workKeys.boards(projectId), ['work', 'board', projectId]];
  const allocate = useAction(() => workApi.allocate(projectId, departmentId, emp), { success: (r) => r.message, invalidate: inv, onSuccess: () => setEmp('') });
  const revoke = useAction((employeeId: string) => workApi.revoke(projectId, departmentId, employeeId), { success: (r) => r.message, invalidate: inv });
  const d = q.data;
  return (
    <Modal title={d ? `${d.department} board members` : 'Board members'} onClose={onClose} actions={<button className="btn btn-secondary" onClick={onClose}>Done</button>}>
      {q.isLoading ? (
        <Loading />
      ) : q.error || !d ? (
        <ErrorBlock error={q.error} />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <p className="faint" style={{ margin: 0, fontSize: 13 }}>
            Only people allocated by the {d.department} lead{d.leadName ? ` (${d.leadName})` : ''} can view or edit this board. Managers see every board.
          </p>
          <div>
            {d.leadName && <div className="list-row"><span>{d.leadName}</span><Tag tone="accent">Lead</Tag></div>}
            {d.members.map((m) => (
              <div key={m.employeeId} className="list-row" style={{ alignItems: 'center' }}>
                <span>
                  {m.name}
                  <span className="faint" style={{ fontSize: 12 }}>{m.designation ? ` · ${m.designation}` : ''}{m.allocatedBy ? ` · added by ${m.allocatedBy}` : ''}</span>
                </span>
                {d.canAllocate && <button className="btn btn-ghost btn-sm" disabled={revoke.isPending} onClick={() => revoke.mutate(m.employeeId)}>Remove</button>}
              </div>
            ))}
            {!d.members.length && <Empty>No one allocated yet.</Empty>}
          </div>
          {d.canAllocate && (
            <div className="wk-inline-form">
              <select className="input" value={emp} onChange={(e) => setEmp(e.target.value)} style={{ flex: 1 }}>
                <option value="">Allocate a person…</option>
                {d.candidates.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <button className="btn btn-primary" disabled={!emp || allocate.isPending} onClick={() => allocate.mutate(undefined)}>Allocate</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
