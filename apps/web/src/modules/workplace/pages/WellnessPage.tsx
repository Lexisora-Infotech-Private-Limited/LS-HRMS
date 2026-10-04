import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  formatGameClock,
  GAME_INFO,
  GAME_KEYS,
  GAME_MAX_HINTS,
  GAME_REVEAL_AFTER_SEC,
  isLadderWord,
  ladderPath,
  oneLetterApart,
  type GameKey,
  type GameResult,
  type GameStart,
  type LadderPuzzle,
  type LeaderboardResponse,
  type QueensPuzzle,
  type SudokuPuzzle,
  type WellnessTile,
} from '@lexisora/shared';
import { useToast } from '@/lib/toast';
import { Avatar, ConfirmDialog, Empty, ErrorBlock, Loading, Modal, PageHeader, Tabs, Tag } from '@/components/ui';
import { hubApi, hubKeys } from '../api-b';
import '../workplace.css';
import '../hub.css';

type Solve = (solution: unknown, moves: number) => void;
type Controls = { hintsLeft: number; takeHint: () => boolean; locked: boolean; showSolution: boolean; onSolve: Solve };

/** Wellness games — GEN.wellness tiles, game screens and the weekly leaderboard (spec §10). */
export default function WellnessPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('game');
  const open = (g: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      g ? n.set('game', g) : n.delete('game');
      return n;
    });
  const today = useQuery({ queryKey: hubKeys.wellnessToday, queryFn: hubApi.wellnessToday });
  const settings = useQuery({ queryKey: hubKeys.wellnessSettings, queryFn: hubApi.wellnessSettings });
  const [editSettings, setEditSettings] = useState(false);

  if (view === 'leaderboard') return <LeaderboardView onBack={() => open(null)} />;
  if (view && (GAME_KEYS as readonly string[]).includes(view)) return <GameScreen key={view} game={view as GameKey} onBack={() => open(null)} onLeaderboard={() => open('leaderboard')} />;

  const t = today.data;
  return (
    <div data-screen-label="Wellness games" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Wellness games"
        sub="Short daily puzzles for a five-minute break. A new set unlocks every morning."
        actions={settings.data?.canManage ? <button className="btn btn-secondary" onClick={() => setEditSettings(true)}>Settings</button> : undefined}
      />
      {today.isLoading ? (
        <Loading />
      ) : today.error ? (
        <ErrorBlock error={today.error} retry={() => void today.refetch()} />
      ) : t ? (
        <>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            <span className="kicker" style={{ margin: 0 }}>{t.dateLabel}</span>
            <Tag tone={t.streak > 0 ? 'accent' : 'neutral'}><FlameIcon /> {t.streak > 0 ? `${t.streak}-day streak` : 'Start a streak today'}</Tag>
            <Tag tone="outline">{t.weekPoints} pts this week</Tag>
            <span className="muted">{t.nextUnlockLabel}</span>
          </div>
          {t.tiles.length <= 1 ? (
            <Empty>Wellness games are switched off for your organisation.</Empty>
          ) : (
            <div className="wp-tiles">
              {t.tiles.map((tile) => <GameTile key={tile.key} tile={tile} onOpen={() => open(tile.key)} />)}
            </div>
          )}
        </>
      ) : null}
      {editSettings && settings.data && <SettingsModal value={settings.data} onClose={() => setEditSettings(false)} />}
    </div>
  );
}

function FlameIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 3 }}>
      <path fill="currentColor" d="M13.5 1s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5 1z" />
    </svg>
  );
}

function GameTile({ tile, onOpen }: { tile: WellnessTile; onOpen: () => void }) {
  return (
    <div className="card wp-tile">
      <div className="card-kicker">{tile.kicker}</div>
      <div className="card-title">{tile.title}</div>
      <div className="card-body">{tile.sub}</div>
      <div className="wp-tile-foot">
        <button className="btn btn-ghost" onClick={onOpen}>{tile.cta}</button>
        {tile.state === 'SOLVED' && <Tag tone="accent">Solved</Tag>}
        {tile.state === 'STARTED' && <Tag tone="outline">In progress</Tag>}
        {tile.state === 'REVEALED' && <Tag>Revealed</Tag>}
      </div>
    </div>
  );
}

// ── Game screen ──────────────────────────────────────────────────────────

function useClock(start: GameStart | undefined, stopAt: number | null): number {
  const offset = useRef(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (start) offset.current = Date.parse(start.serverNow) - Date.now();
  }, [start]);
  useEffect(() => {
    if (stopAt !== null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stopAt]);
  if (!start) return 0;
  if (stopAt !== null) return stopAt;
  return Math.max(0, Math.floor((now + offset.current - Date.parse(start.startedAt)) / 1000));
}

function GameScreen({ game, onBack, onLeaderboard }: { game: GameKey; onBack: () => void; onLeaderboard: () => void }) {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const info = GAME_INFO[game];
  const start = useQuery({ queryKey: [...hubKeys.wellness, 'start', game], queryFn: () => hubApi.startGame(game), staleTime: Infinity, gcTime: 0, retry: false });
  const [result, setResult] = useState<GameResult | null>(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const hintsRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const done = result ?? start.data?.result ?? null;
  const elapsed = useClock(start.data, done ? done.elapsedSec : null);

  async function submit(solution: unknown, moves: number, revealed: boolean) {
    if (!start.data || busy) return;
    setBusy(true);
    try {
      const r = await hubApi.completeGame(game, { startToken: start.data.startToken, solution: revealed ? null : solution, hintsUsed: hintsRef.current, moves, revealed });
      setResult(r);
      toast(revealed ? 'Solution revealed · 0 pts' : `Solved in ${formatGameClock(r.elapsedSec)} · +${r.points} pts`);
      void qc.invalidateQueries({ queryKey: hubKeys.wellnessToday });
      void qc.invalidateQueries({ queryKey: [...hubKeys.wellness, 'board'] });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const controls: Controls = {
    hintsLeft: GAME_MAX_HINTS - hintsUsed,
    takeHint: () => {
      if (hintsRef.current >= GAME_MAX_HINTS || done) return false;
      hintsRef.current += 1;
      setHintsUsed(hintsRef.current);
      return true;
    },
    locked: !!done || busy,
    showSolution: !!done,
    onSolve: (solution, moves) => void submit(solution, moves, false),
  };
  const revealIn = GAME_REVEAL_AFTER_SEC - elapsed;

  return (
    <div data-screen-label={`Wellness · ${info.title}`} className="stack" style={{ gap: 16 }}>
      <PageHeader
        kicker={<button className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={onBack}>← Wellness games</button>}
        title={info.title}
        sub={info.sub}
      />
      {start.isLoading ? (
        <Loading />
      ) : start.error ? (
        <ErrorBlock error={start.error} retry={() => void start.refetch()} />
      ) : start.data ? (
        <div className="wp-game">
          <div>
            {game === 'queens' && start.data.queens && <QueensBoard p={start.data.queens} c={controls} />}
            {game === 'sudoku6' && start.data.sudoku && <SudokuBoard p={start.data.sudoku} c={controls} />}
            {game === 'wordladder' && start.data.ladder && <LadderBoard p={start.data.ladder} c={controls} />}
          </div>
          <div className="wp-game-side">
            <div className="card">
              <div className="card-kicker">{done ? 'Final time' : 'Time'}</div>
              <div className="wp-clock" aria-live="off">{formatGameClock(elapsed)}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>Puzzle for {start.data.puzzleDate.split('-').reverse().join('-')} · hints left {Math.max(0, GAME_MAX_HINTS - hintsUsed)}</div>
            </div>
            {done ? (
              <div className="card">
                <div className="card-kicker">{done.revealed ? 'Revealed' : 'Solved'}</div>
                <div className="big-num">{done.revealed ? '0 pts' : `+${done.points} pts`}</div>
                <div className="card-body">
                  {done.revealed ? 'The solution is shown on the board. Try again tomorrow.' : `Solved in ${formatGameClock(done.elapsedSec)}${done.hintsUsed ? ` with ${done.hintsUsed} hint${done.hintsUsed > 1 ? 's' : ''}` : ''}.`}
                  {` You are #${done.rank} of ${done.players} today.`}
                </div>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button className="btn btn-secondary" onClick={onBack}>More games</button>
                  <button className="btn btn-ghost" onClick={onLeaderboard}>Leaderboard</button>
                </div>
              </div>
            ) : (
              <div className="card">
                <div className="card-kicker">Stuck?</div>
                <div className="card-body">A hint costs 3 points (up to {GAME_MAX_HINTS}). Reveal unlocks after 10 minutes and scores 0.</div>
                <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={revealIn > 0 || busy} onClick={() => setConfirmReveal(true)}>
                  {revealIn > 0 ? `Reveal in ${formatGameClock(revealIn)}` : 'Reveal'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
      {confirmReveal && (
        <ConfirmDialog
          title="Reveal the solution?"
          body="You score 0 points for today's puzzle. Your streak still counts."
          confirmLabel="Reveal"
          onConfirm={() => { setConfirmReveal(false); void submit(null, 0, true); }}
          onClose={() => setConfirmReveal(false)}
        />
      )}
    </div>
  );
}

function Toolbar({ c, onUndo, onClear, onHint, canUndo, extra }: { c: Controls; onUndo: () => void; onClear: () => void; onHint: () => void; canUndo: boolean; extra?: ReactNode }) {
  return (
    <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <button className="btn btn-secondary btn-sm" disabled={c.locked || !canUndo} onClick={onUndo}>Undo</button>
      <button className="btn btn-secondary btn-sm" disabled={c.locked || !canUndo} onClick={onClear}>Clear</button>
      <button className="btn btn-secondary btn-sm" disabled={c.locked || c.hintsLeft <= 0} onClick={onHint}>Hint ({c.hintsLeft})</button>
      {extra}
    </div>
  );
}

// ── Queens ───────────────────────────────────────────────────────────────

const REGION_COLORS = ['#f4c7a1', '#b9d7f0', '#c9e4b4', '#f2b8c6', '#e0cdf3', '#f7e19c', '#b6e3dd', '#d9d4c7', '#f0a9a0', '#a9c1f0', '#d6eaa0', '#f5cba7'];

function QueensBoard({ p, c }: { p: QueensPuzzle; c: Controls }) {
  const n = p.n;
  const empty = () => Array.from({ length: n }, () => Array<number>(n).fill(0));
  const [cells, setCells] = useState<number[][]>(empty);
  const [history, setHistory] = useState<number[][][]>([]);
  const [hinted, setHinted] = useState<Set<string>>(new Set());
  const lastSent = useRef('');
  const board = c.showSolution ? Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, col) => (p.solution[r] === col ? 2 : 0))) : cells;

  const conflicts = useMemo(() => {
    const qs: [number, number][] = [];
    board.forEach((row, r) => row.forEach((v, col) => v === 2 && qs.push([r, col])));
    const bad = new Set<string>();
    for (let i = 0; i < qs.length; i++)
      for (let j = i + 1; j < qs.length; j++) {
        const [r1, c1] = qs[i]!;
        const [r2, c2] = qs[j]!;
        if (r1 === r2 || c1 === c2 || p.regions[r1]![c1] === p.regions[r2]![c2] || (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1)) {
          bad.add(`${r1}:${c1}`);
          bad.add(`${r2}:${c2}`);
        }
      }
    return { bad, count: qs.length };
  }, [board, p.regions]);

  useEffect(() => {
    if (c.locked || conflicts.count !== n || conflicts.bad.size) return;
    const cols = cells.map((row) => row.indexOf(2));
    const sig = cols.join(',');
    if (sig === lastSent.current) return; // a rejected board is not resent until it changes
    lastSent.current = sig;
    c.onSolve(cols, history.length);
  }, [cells, conflicts, n, c, history.length]);

  const commit = (next: number[][]) => {
    setHistory((h) => [...h, cells]);
    setCells(next);
  };
  const tap = (r: number, col: number) => {
    if (c.locked || hinted.has(`${r}:${col}`)) return;
    const next = cells.map((row) => [...row]);
    next[r]![col] = (next[r]![col]! + 1) % 3; // empty → × → queen → empty
    commit(next);
  };
  const hint = () => {
    const r = p.solution.findIndex((col, row) => cells[row]![col] !== 2 || cells[row]!.some((v, x) => v === 2 && x !== col));
    if (r < 0 || !c.takeHint()) return;
    const col = p.solution[r]!;
    const next = cells.map((row) => row.map((v) => v));
    for (let x = 0; x < n; x++) if (next[r]![x] === 2) next[r]![x] = 0;
    for (let y = 0; y < n; y++) if (next[y]![col] === 2) next[y]![col] = 0;
    next[r]![col] = 2;
    setHinted((h) => new Set(h).add(`${r}:${col}`));
    commit(next);
  };

  return (
    <div>
      <div className="wp-queens" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }} role="grid" aria-label={`Queens ${n} by ${n}`}>
        {board.map((row, r) =>
          row.map((v, col) => {
            const g = p.regions[r]![col]!;
            const key = `${r}:${col}`;
            return (
              <button
                key={key}
                type="button"
                className={`${conflicts.bad.has(key) ? 'is-conflict' : ''}${hinted.has(key) ? ' is-hint' : ''}`}
                style={{
                  background: REGION_COLORS[g % REGION_COLORS.length],
                  borderRight: col < n - 1 && p.regions[r]![col + 1] !== g ? '2px solid #1c1b1a' : undefined,
                  borderBottom: r < n - 1 && p.regions[r + 1]![col] !== g ? '2px solid #1c1b1a' : undefined,
                }}
                aria-label={`Row ${r + 1} column ${col + 1}${v === 2 ? ' queen' : v === 1 ? ' marked' : ''}`}
                onClick={() => tap(r, col)}
              >
                {v === 2 ? '♛' : v === 1 ? <span style={{ fontSize: 14, opacity: 0.55 }}>×</span> : ''}
              </button>
            );
          }),
        )}
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Tap once to mark ×, twice for a queen. Queens may not touch, even diagonally.</div>
      {!c.showSolution && <Toolbar c={c} canUndo={history.length > 0} onUndo={() => { setCells(history[history.length - 1] ?? empty()); setHistory((h) => h.slice(0, -1)); }} onClear={() => commit(empty().map((row, r) => row.map((_, col) => (hinted.has(`${r}:${col}`) ? 2 : 0))))} onHint={hint} />}
    </div>
  );
}

// ── Mini Sudoku 6×6 ──────────────────────────────────────────────────────

function SudokuBoard({ p, c }: { p: SudokuPuzzle; c: Controls }) {
  const [grid, setGrid] = useState<number[][]>(() => p.givens.map((r) => [...r]));
  const [history, setHistory] = useState<number[][][]>([]);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [hinted, setHinted] = useState<Set<string>>(new Set());
  const lastSent = useRef('');
  const board = c.showSolution ? p.solution : grid;
  const fixed = (r: number, col: number) => p.givens[r]![col] !== 0 || hinted.has(`${r}:${col}`);

  const conflicts = useMemo(() => {
    const bad = new Set<string>();
    for (let r = 0; r < 6; r++)
      for (let col = 0; col < 6; col++) {
        const v = board[r]![col]!;
        if (!v) continue;
        for (let k = 0; k < 6; k++) {
          if (k !== col && board[r]![k] === v) bad.add(`${r}:${col}`);
          if (k !== r && board[k]![col] === v) bad.add(`${r}:${col}`);
        }
        const br = Math.floor(r / 2) * 2;
        const bc = Math.floor(col / 3) * 3;
        for (let y = br; y < br + 2; y++) for (let x = bc; x < bc + 3; x++) if ((y !== r || x !== col) && board[y]![x] === v) bad.add(`${r}:${col}`);
      }
    return bad;
  }, [board]);

  useEffect(() => {
    if (c.locked || conflicts.size || grid.some((row) => row.some((v) => !v))) return;
    const sig = grid.map((row) => row.join('')).join('|');
    if (sig === lastSent.current) return;
    lastSent.current = sig;
    c.onSolve(grid, history.length);
  }, [grid, conflicts, c, history.length]);

  const put = (v: number) => {
    if (!sel || c.locked) return;
    const [r, col] = sel;
    if (fixed(r, col) || grid[r]![col] === v) return;
    setHistory((h) => [...h, grid]);
    setGrid((g) => g.map((row, y) => row.map((x, xi) => (y === r && xi === col ? v : x))));
  };
  const hint = () => {
    const wrong = (r: number, col: number) => grid[r]![col] !== p.solution[r]![col];
    let target: [number, number] | null = sel && !fixed(...sel) && wrong(...sel) ? sel : null;
    for (let r = 0; r < 6 && !target; r++) for (let col = 0; col < 6 && !target; col++) if (wrong(r, col)) target = [r, col];
    if (!target || !c.takeHint()) return;
    const [r, col] = target;
    setHinted((h) => new Set(h).add(`${r}:${col}`));
    setHistory((h) => [...h, grid]);
    setGrid((g) => g.map((row, y) => row.map((x, xi) => (y === r && xi === col ? p.solution[r]![col]! : x))));
    setSel(target);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (/^[1-6]$/.test(e.key)) put(Number(e.key));
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') put(0);
    else if (sel && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const [r, col] = sel;
      const d: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      const [dr, dc] = d[e.key] ?? [0, 0];
      setSel([Math.min(5, Math.max(0, r + dr)), Math.min(5, Math.max(0, col + dc))]);
    }
  };

  return (
    <div onKeyDown={onKey}>
      <div className="wp-sudoku" role="grid" aria-label="Mini Sudoku 6 by 6">
        {board.map((row, r) =>
          row.map((v, col) => {
            const key = `${r}:${col}`;
            const cls = [fixed(r, col) ? 'is-given' : '', sel && sel[0] === r && sel[1] === col ? 'is-sel' : '', conflicts.has(key) ? 'is-conflict' : '', col === 2 ? 'box-r' : '', r === 1 || r === 3 ? 'box-b' : ''].filter(Boolean).join(' ');
            return (
              <button key={key} type="button" className={cls} aria-label={`Row ${r + 1} column ${col + 1}${v ? ` ${v}` : ' empty'}`} onClick={() => setSel([r, col])}>
                {v || ''}
              </button>
            );
          }),
        )}
      </div>
      {!c.showSolution && (
        <>
          <div className="wp-keypad" style={{ marginTop: 12 }}>
            {[1, 2, 3, 4, 5, 6].map((d) => <button key={d} className="btn btn-secondary" disabled={c.locked || !sel} onClick={() => put(d)}>{d}</button>)}
            <button className="btn btn-ghost" disabled={c.locked || !sel} onClick={() => put(0)}>Erase</button>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Fill every row, column and 2×3 box with 1–6. You can type digits and use the arrow keys.</div>
          <Toolbar c={c} canUndo={history.length > 0} onUndo={() => { setGrid(history[history.length - 1] ?? p.givens.map((r) => [...r])); setHistory((h) => h.slice(0, -1)); }} onClear={() => { setHistory((h) => [...h, grid]); setGrid(p.givens.map((r, y) => r.map((v, x) => (hinted.has(`${y}:${x}`) ? p.solution[y]![x]! : v)))); }} onHint={hint} />
        </>
      )}
    </div>
  );
}

// ── Word ladder ──────────────────────────────────────────────────────────

function LadderBoard({ p, c }: { p: LadderPuzzle; c: Controls }) {
  const [words, setWords] = useState<string[]>([p.start]);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const shown = c.showSolution ? p.example : words;
  const last = words[words.length - 1]!;
  const reached = last === p.target;

  const add = (w: string) => {
    const word = w.trim().toLowerCase();
    if (word.length !== p.start.length) return setErr(`Use a ${p.start.length}-letter word`);
    if (!oneLetterApart(last, word)) return setErr(`Change exactly one letter of ${last.toUpperCase()}`);
    if (!isLadderWord(word)) return setErr(`${word.toUpperCase()} is not in the word list`);
    if (words.includes(word)) return setErr(`${word.toUpperCase()} is already in your ladder`);
    setErr(null);
    setDraft('');
    const next = [...words, word];
    setWords(next);
    if (word === p.target) c.onSolve(next, next.length - 1);
  };
  const hint = () => {
    // From the furthest word that can still reach the target.
    for (let i = words.length - 1; i >= 0; i--) {
      const path = ladderPath(words[i]!, p.target);
      if (path && path.length > 1) {
        if (!c.takeHint()) return;
        const base = words.slice(0, i + 1);
        const next = [...base, path[1]!];
        setWords(next);
        setErr(i < words.length - 1 ? `Went back to ${words[i]!.toUpperCase()} — the later words were a dead end` : null);
        if (path[1] === p.target) c.onSolve(next, next.length - 1);
        return;
      }
    }
  };

  return (
    <div>
      <div className="wp-ladder" aria-label="Word ladder">
        {shown.map((w, i) => {
          const prev = i > 0 ? shown[i - 1]! : null;
          return (
            <div key={`${w}-${i}`} className={`wp-ladder-word${prev ? ' is-changed' : ''}`}>
              <span>{[...w].map((ch, k) => <span key={k} className={prev && prev[k] !== ch ? 'ch' : undefined}>{ch}</span>)}</span>
              <span className="muted" style={{ fontSize: 11, letterSpacing: 0 }}>{i === 0 ? 'Start' : `${i}`}</span>
            </div>
          );
        })}
        {!c.showSolution && !reached && (
          <>
            <form onSubmit={(e) => { e.preventDefault(); add(draft); }} className="row" style={{ gap: 6 }}>
              <input
                className="input"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 20, letterSpacing: 8, textTransform: 'uppercase' }}
                maxLength={p.start.length}
                value={draft}
                autoFocus
                disabled={c.locked}
                aria-label="Next word"
                placeholder={'_'.repeat(p.start.length)}
                onChange={(e) => setDraft(e.target.value.replace(/[^a-zA-Z]/g, ''))}
              />
              <button className="btn btn-primary" type="submit" disabled={c.locked || draft.length !== p.start.length}>Add</button>
            </form>
            {err && <div className="field-error" role="alert">{err}</div>}
            <div className="wp-ladder-word is-target"><span>{p.target}</span><span style={{ fontSize: 11, letterSpacing: 0 }}>Target</span></div>
          </>
        )}
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        {c.showSolution ? `One shortest ladder · ${p.par} moves.` : `Par ${p.par} moves · ${words.length - 1} so far. Every step must be a real word.`}
      </div>
      {!c.showSolution && (
        <Toolbar
          c={c}
          canUndo={words.length > 1}
          onUndo={() => { setWords((w) => (w.length > 1 ? w.slice(0, -1) : w)); setErr(null); }}
          onClear={() => { setWords([p.start]); setErr(null); }}
          onHint={hint}
        />
      )}
    </div>
  );
}

// ── Leaderboard ──────────────────────────────────────────────────────────

function LeaderboardView({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'current' | 'last' | 'people'>('current');
  const week = tab === 'last' ? 'last' : 'current';
  const board = useQuery({ queryKey: hubKeys.leaderboard(week), queryFn: () => hubApi.leaderboard(week) });
  return (
    <div data-screen-label="Wellness · Team leaderboard" className="stack" style={{ gap: 16 }}>
      <PageHeader
        kicker={<button className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={onBack}>← Wellness games</button>}
        title="Team leaderboard"
        sub={board.data ? `${board.data.label}${board.data.leader ? ` · ${board.data.leader} leads` : ''}` : 'Department scores for this week (Mon–Sun).'}
      />
      <Tabs tabs={[{ value: 'current' as const, label: 'This week' }, { value: 'last' as const, label: 'Last week' }, { value: 'people' as const, label: 'Individuals' }]} value={tab} onChange={setTab} />
      {board.isLoading ? <Loading /> : board.error ? <ErrorBlock error={board.error} retry={() => void board.refetch()} /> : board.data ? (tab === 'people' ? <PeopleTable data={board.data} /> : <TeamTable data={board.data} />) : null}
    </div>
  );
}

function TeamTable({ data }: { data: LeaderboardResponse }) {
  if (!data.teams.some((t) => t.players > 0)) return <Empty>No games played {data.week === 'last' ? 'last week' : 'yet this week'}.</Empty>;
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="table">
        <thead><tr><th>Department</th><th className="num">Players</th><th className="num">Points</th><th className="num">Score per member</th><th className="num">Rank</th></tr></thead>
        <tbody>
          {data.teams.map((t) => (
            <tr key={t.departmentId} className={t.mine ? 'wp-board-row is-mine' : 'wp-board-row'}>
              <td><strong>{t.department}</strong>{t.mine && <span className="muted"> · your team</span>}</td>
              <td className="num">{t.players} / {t.headcount}</td>
              <td className="num">{t.points}</td>
              <td className="num">{t.scorePerMember.toFixed(1)}</td>
              <td className="num">{t.rank ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 12, padding: '8px 12px' }}>Score per member = points ÷ department headcount, so small and large teams compete fairly.</div>
    </div>
  );
}

function PeopleTable({ data }: { data: LeaderboardResponse }) {
  if (!data.people.length) return <Empty>No games played yet this week.</Empty>;
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="table">
        <thead><tr><th className="num">#</th><th>Name</th><th>Department</th><th className="num">Games</th><th className="num">Points</th></tr></thead>
        <tbody>
          {data.people.slice(0, 20).map((p) => (
            <tr key={p.employeeId} className={p.mine ? 'wp-board-row is-mine' : 'wp-board-row'}>
              <td className="num">{p.rank}</td>
              <td><span className="row" style={{ gap: 8, alignItems: 'center' }}><Avatar name={p.name} initials={p.initials} size={24} />{p.name}</span></td>
              <td>{p.department ?? '—'}</td>
              <td className="num">{p.games}</td>
              <td className="num">{p.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Settings (HR / Admin) ────────────────────────────────────────────────

function SettingsModal({ value, onClose }: { value: { enabledGames: GameKey[]; unlockTime: string; breakOnly: boolean }; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [games, setGames] = useState<GameKey[]>(value.enabledGames);
  const [unlock, setUnlock] = useState(value.unlockTime);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await hubApi.updateWellnessSettings({ enabledGames: games, unlockTime: unlock });
      toast('Wellness settings saved');
      await qc.invalidateQueries({ queryKey: hubKeys.wellness });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Wellness settings" onClose={onClose} actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Save</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label>Games</label>
          {GAME_KEYS.map((g) => (
            <label key={g} className="row" style={{ gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input type="checkbox" checked={games.includes(g)} onChange={(e) => setGames((x) => (e.target.checked ? [...x, g] : x.filter((y) => y !== g)))} /> {GAME_INFO[g].title}
            </label>
          ))}
        </div>
        <div className="field"><label htmlFor="w-unlock">New set unlocks at (IST)</label><input id="w-unlock" className="input" type="time" style={{ width: 140 }} value={unlock} onChange={(e) => setUnlock(e.target.value)} /></div>
        <label className="row" style={{ gap: 8, alignItems: 'center', fontSize: 14, opacity: 0.6 }}>
          <input type="checkbox" disabled checked={value.breakOnly} /> Playable only when on break or not punched in
        </label>
        <div className="muted" style={{ fontSize: 12 }}>Break-only play needs live break status from the desktop tracker and is not available yet.</div>
      </div>
      {err && <div className="field-error" role="alert">{err}</div>}
    </Modal>
  );
}
