import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BOARD_COLUMNS, TASK_STATUS_LABELS, type BoardView, type TaskCard, type TaskStatusKey } from '@lexisora/shared';
import { HttpError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { useLookups, opts } from '@/components/lookups';
import { Empty, ErrorBlock, Loading, Modal, Pills, Tag } from '@/components/ui';
import { hours, workApi, workKeys } from '../api';
import { AddTaskModal } from '../components';
import { TaskDrawer } from './TaskDrawer';
import '../work.css';

const NEXT: Partial<Record<TaskStatusKey, TaskStatusKey>> = { OPEN: 'ALLOTTED', ALLOTTED: 'WIP', WIP: 'DEV_COMPLETED', DEV_COMPLETED: 'QA', QA: 'DONE' };

export default function BoardPage() {
  const can = useCan();
  const qc = useQueryClient();
  const { toast } = useToast();
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
  });

  // Realtime: refresh when anyone moves/edits a card on this board, or when my access changes.
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

  const move = useAction(
    (a: { card: TaskCard; to: TaskStatusKey; beforeTaskId?: string }) => workApi.moveTask(a.card.id, { toStatus: a.to, version: a.card.version, beforeTaskId: a.beforeTaskId }),
    {
      success: (r) => r.message,
      invalidate: [['work', 'board', projectId], workKeys.projects],
    },
  );

  function doMove(card: TaskCard, to: TaskStatusKey, beforeTaskId?: string) {
    if (!card.canMove) return toast('You can move only your own or unassigned cards on this board');
    if (card.status === to && !beforeTaskId) return;
    // Optimistic: move the card locally, then let the server response/refresh settle it.
    qc.setQueryData<BoardView>(boardKey, (old) => {
      if (!old) return old;
      const cols = old.columns.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== card.id) }));
      const target = cols.find((c) => c.status === to);
      if (target) {
        const moved = { ...card, status: to };
        const idx = beforeTaskId ? target.cards.findIndex((x) => x.id === beforeTaskId) : -1;
        if (idx >= 0) target.cards.splice(idx, 0, moved);
        else target.cards.push(moved);
      }
      return { ...old, columns: cols.map((c) => ({ ...c, count: c.cards.length })) };
    });
    move.mutate(
      { card, to, beforeTaskId },
      {
        // Server rejected (stale version, no permission…): useAction toasts the reason; restore the real board.
        onError: () => void qc.invalidateQueries({ queryKey: ['work', 'board', projectId] }),
      },
    );
  }

  const lockedError = viewQ.error instanceof HttpError && viewQ.error.status === 403;
  const isLocked = !!board?.locked || lockedError;
  const view = viewQ.data;
  const projectName = view?.project.name ?? projects.find((p) => p.value === projectId)?.label.replace(/ · [A-Z]+$/, '') ?? '';

  return (
    <div data-screen-label="Task board" className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h2>Task board · {projectName || '—'}</h2>
          <p>Drag cards between columns. Moving to Dev Completed pushes the branch to GitLab.</p>
        </div>
        <div className="row">
          {board?.canManage && !isLocked && <button className="btn btn-secondary" onClick={() => setManaging(true)}>Manage members</button>}
          {can('tasks.manage') && <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={!projectId}>Add task</button>}
        </div>
      </div>

      <div className="wk-toolbar">
        <select className="input" style={{ width: 'auto', minWidth: 200 }} value={projectId} onChange={(e) => setParam({ project: e.target.value, board: null, task: null })} aria-label="Project">
          {projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <span style={{ fontSize: 13, margin: '0 4px 0 8px' }}>Team board:</span>
        {boards.length ? (
          <Pills value={boardId} onChange={(v) => setParam({ board: v, task: null })} options={boards.map((b) => ({ value: b.departmentId, label: `${b.name}${b.locked ? ' 🔒' : ''}` }))} />
        ) : (
          <span className="faint" style={{ fontSize: 13 }}>{boardsQ.isLoading ? 'Loading…' : 'No team boards on this project'}</span>
        )}
        <span className="spacer" />
        {!isLocked && view && (
          <label className="radio" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            <span className="dot" style={{ borderRadius: 3 }} />
            Show done
          </label>
        )}
      </div>

      {lk.isLoading || boardsQ.isLoading ? (
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
        <Loading />
      ) : (
        <>
          {view.project.locked && <div className="note">This project is {view.project.status.toLowerCase()} — the board is read-only.</div>}
          <Columns view={view} onMove={doMove} onOpen={(id) => setParam({ task: id })} />
          <div className="faint" style={{ fontSize: 12.5 }}>
            Board members: {view.members.map((m) => `${m.name}${m.isLead ? ' (lead)' : ''}`).join(', ') || '—'}
          </div>
        </>
      )}

      {adding && <AddTaskModal projectId={projectId} departmentId={boardId} onClose={() => setAdding(false)} />}
      {managing && board && <MembersDialog projectId={projectId} departmentId={boardId} onClose={() => setManaging(false)} />}
      {taskId && <TaskDrawer taskId={taskId} onClose={() => setParam({ task: null })} />}
    </div>
  );
}

function Columns({ view, onMove, onOpen }: { view: BoardView; onMove: (c: TaskCard, to: TaskStatusKey, before?: string) => void; onOpen: (id: string) => void }) {
  const dragRef = useRef<TaskCard | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const cardsById = useMemo(() => new Map(view.columns.flatMap((c) => c.cards).map((c) => [c.id, c])), [view]);
  return (
    <div className={`wk-board${view.columns.length > BOARD_COLUMNS.length ? ' with-done' : ''}`}>
      {view.columns.map((col) => (
        <div
          key={col.status}
          className={`wk-col${over === col.status ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (over !== col.status) setOver(col.status);
          }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/plain');
            const card = dragRef.current ?? cardsById.get(id);
            setOver(null);
            setDragging(null);
            if (card) onMove(card, col.status, beforeId && beforeId !== card.id ? beforeId : undefined);
            dragRef.current = null;
            setBeforeId(null);
          }}
        >
          <div className="wk-col-head"><span>{col.label}</span><span>{col.count}</span></div>
          {col.cards.map((k) => {
            const nextStatus = NEXT[k.status];
            return (
              <div
                key={k.id}
                className={`wk-card${dragging === k.id ? ' dragging' : ''}${k.canMove ? '' : ' readonly'}`}
                draggable={k.canMove}
                onDragStart={(e) => {
                  dragRef.current = k;
                  setDragging(k.id);
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
                onDragOver={() => setBeforeId(k.id)}
                onClick={() => onOpen(k.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(k.id)}
              >
                <div className="wk-card-meta">
                  <span>{k.key}{k.moduleName ? ` · ${k.moduleName}` : ''}</span>
                  <span className="row" style={{ gap: 4 }}>
                    {k.gitMrUrl && <span title={`MR ${k.gitMrState ?? ''}`}>MR</span>}
                    {!k.gitMrUrl && k.gitBranch && <span title={k.gitBranch}>⎇</span>}
                    {k.gitSyncStatus === 'FAILED' && <Tag tone="danger">Git</Tag>}
                  </span>
                </div>
                <div className="wk-card-title">{k.title}</div>
                <div className="wk-card-foot">
                  <span>{k.assigneeShort}</span>
                  <span className="row" style={{ gap: 4 }}>
                    {k.overdue && <Tag tone="danger">Overdue</Tag>}
                    <span className="tag tag-neutral">{hours(k.estimatedMinutes)}</span>
                  </span>
                </div>
                {nextStatus && (
                  <button
                    className="wk-next"
                    disabled={!k.canMove}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove(k, nextStatus);
                    }}
                  >
                    {nextStatus === 'DONE' ? 'Mark done' : `Move to ${TASK_STATUS_LABELS[nextStatus]} →`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
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
