import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { searchTypeLabel } from '@lexisora/shared';
import { Empty, ErrorBlock, Loading, PageHeader, Tabs } from '@/components/ui';
import { useSearchGroups } from '../search';
import '../platform.css';

/** "See all results" page for the header search: every group, filter tabs by type. */
export default function SearchPage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const [type, setType] = useState('all');
  useEffect(() => setText(q), [q]);
  useEffect(() => setType('all'), [q]);

  const { groups, loading, error } = useSearchGroups(q, 50);
  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  const shown = type === 'all' ? groups : groups.filter((g) => g.type === type);

  return (
    <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties} data-screen-label="Search">
      <PageHeader title="Search" sub={q ? `Results for “${q}” across the modules you can open.` : 'Search people, tasks, projects, documents and screens.'} />
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (t) setParams({ q: t });
        }}
      >
        <input className="input" style={{ maxWidth: 420, flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search people, tasks, documents" aria-label="Search" autoFocus />
        <button className="btn btn-primary" type="submit">Search</button>
      </form>
      {q.trim().length < 2 ? (
        <Empty>Type at least 2 characters.</Empty>
      ) : error ? (
        <ErrorBlock error={error} />
      ) : (
        <>
          {groups.length > 0 && (
            <Tabs<string>
              tabs={[{ value: 'all', label: `All · ${total}` }, ...groups.map((g) => ({ value: g.type, label: `${searchTypeLabel(g.type)} · ${g.hits.length}` }))]}
              value={type}
              onChange={setType}
            />
          )}
          {loading && !groups.length ? (
            <Loading label="Searching…" />
          ) : !groups.length ? (
            <Empty>No results for “{q}”. Try a name, employee ID, task key such as AT-101, or a screen name.</Empty>
          ) : (
            shown.map((g) => (
              <div className="card" key={g.type}>
                <div className="card-kicker">{searchTypeLabel(g.type)}</div>
                <div>
                  {g.hits.map((h) => (
                    <button
                      key={`${g.type}:${h.id}`}
                      type="button"
                      className="list-row"
                      style={{ width: '100%', background: 'transparent', border: 0, borderTop: '1px solid var(--color-divider)', font: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
                      onClick={() => nav(h.link)}
                    >
                      <span>{h.title}</span>
                      {h.subtitle && <span className="faint">{h.subtitle}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
