import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { searchTypeLabel, type SearchGroupDto } from '@lexisora/shared';
import { Avatar } from '@/components/ui';
import { useAuth, useCan } from '@/lib/auth';
import { onRealtime } from '@/lib/socket';
import { isPeople, useSearchGroups } from './search';
import './platform.css';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
type Hit = SearchGroupDto['hits'][number];

/**
 * Header search "Search people, tasks, documents" (spec M8): Ctrl/Cmd+K focuses, 250 ms debounce,
 * min 2 characters, results grouped by type (top 5 each) plus "Go to" screens, ↑/↓ + Enter, Esc
 * closes, "See all results" → /search?q=.
 */
export function GlobalSearch() {
  const nav = useNavigate();
  const loc = useLocation();
  const { reload } = useAuth();
  const can = useCan();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // A person whose profile the viewer can't open shows as a mini card instead (spec M8).
  const [card, setCard] = useState<Hit | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const { groups, loading } = useSearchGroups(q, 5);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => setCard(null), [text, open]);

  // Ctrl/Cmd+K focuses the search from anywhere.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  // Navigating closes the panel; the term stays only on the full results page (to refine it there).
  useEffect(() => {
    setOpen(false);
    if (loc.pathname !== '/search') setText('');
  }, [loc.pathname]);

  // Roles & access changes apply live: when an admin changes my role, refresh the session so the
  // sidebar and screen guards follow without signing in again (the API re-reads permissions per request).
  useEffect(() => onRealtime('rbac.changed', () => void reload().catch(() => undefined)), [reload]);
  // A newly published theme (Branding → Publish theme) applies live in every open session.
  useEffect(() => onRealtime('branding.updated', () => void reload().catch(() => undefined)), [reload]);

  const term = text.trim();
  const showPanel = open && term.length >= 2;
  const seeAllIndex = flat.length;

  function go(link: string) {
    setOpen(false);
    setText('');
    inputRef.current?.blur();
    nav(link);
  }
  /** Open a hit: people the viewer can't open (the provider links them to the guarded directory) get the mini card. */
  function pick(h: Hit) {
    if (isPeople(h.type) && h.link === '/employees' && !can('employees.view')) setCard(h);
    else go(h.link);
  }
  function seeAll() {
    if (term.length < 2) return;
    setOpen(false);
    inputRef.current?.blur();
    nav(`/search?q=${encodeURIComponent(term)}`);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(seeAllIndex, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Results still reflect an older term while typing: Enter goes to the full results page instead.
      const fresh = q === term;
      const hit = fresh ? flat[active] : undefined;
      if (hit) pick(hit);
      else seeAll();
    } else if (e.key === 'Escape') {
      if (card) return setCard(null);
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  let idx = -1;
  return (
    <div className="pf-search" ref={boxRef}>
      <input
        ref={inputRef}
        className="input"
        type="search"
        placeholder="Search people, tasks, documents"
        aria-label="Search people, tasks, documents"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {!text && <span className="pf-search-kbd">{isMac ? '⌘K' : 'Ctrl K'}</span>}
      {showPanel && card && (
        <div className="pf-search-panel" id={listId} role="dialog" aria-label={card.title}>
          <div className="pf-search-card">
            <Avatar name={card.title} size={44} />
            <div className="pf-search-text">
              <span className="serif" style={{ fontSize: 16 }}>{card.title}</span>
              {card.subtitle && <small>{card.subtitle}</small>}
            </div>
          </div>
          <div className="pf-search-foot">
            <span className="row" style={{ gap: 6 }}>
              {can('chat.use') && (
                <button type="button" className="btn btn-secondary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => go('/chat')}>
                  Message
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => setCard(null)}>
                Back to results
              </button>
            </span>
            <span>Esc back</span>
          </div>
        </div>
      )}
      {showPanel && !card && (
        <div className="pf-search-panel" id={listId} role="listbox" aria-label="Search results">
          {groups.map((g) => (
            <div key={g.type} role="group" aria-label={searchTypeLabel(g.type)}>
              <div className="pf-search-group">{searchTypeLabel(g.type)}</div>
              {g.hits.map((h) => {
                idx += 1;
                const i = idx;
                return (
                  <button
                    key={`${g.type}:${h.id}`}
                    type="button"
                    role="option"
                    aria-selected={active === i}
                    className="pf-search-item"
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(h)}
                  >
                    {isPeople(g.type) && <Avatar name={h.title} size={26} />}
                    <span className="pf-search-text">
                      <span>{h.title}</span>
                      {h.subtitle && <small>{h.subtitle}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {!groups.length && <div className="pf-search-empty">{loading || q !== term ? 'Searching…' : `No results for “${term}”`}</div>}
          {groups.length > 0 && (loading || q !== term) && <div className="pf-search-empty" aria-live="polite">Searching…</div>}
          <div className="pf-search-foot">
            <button
              type="button"
              role="option"
              aria-selected={active === seeAllIndex}
              className="btn btn-ghost btn-sm"
              onMouseEnter={() => setActive(seeAllIndex)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={seeAll}
            >
              See all results
            </button>
            <span>↑↓ move · Enter open · Esc close</span>
          </div>
        </div>
      )}
    </div>
  );
}
