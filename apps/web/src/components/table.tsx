import { useEffect, useState, type ReactNode } from 'react';
import { Empty, Loading } from './ui';

export type Column<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Right-align with tabular numerals. */
  num?: boolean;
  width?: string;
};

/** True while the screen is narrower than `px` (a phone). */
export function useNarrow(px = 640): boolean {
  const q = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return narrow;
}

/** The wireframe's list table: uppercase header, hairline rows, optional row click. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  empty = 'Nothing here yet.',
  footer,
  mobileCards,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  footer?: ReactNode;
  /** On a phone, show each row as a card (first column as the title, the rest as labelled lines) instead of a squeezed table. */
  mobileCards?: boolean;
}) {
  const narrow = useNarrow();
  if (loading && !rows) return <Loading />;
  if (mobileCards && narrow) {
    const [title, ...rest] = columns;
    return (
      <div className="dt-cards">
        {(rows ?? []).map((r) => (
          <div
            key={rowKey(r)}
            className={`dt-card${onRowClick ? ' clickable' : ''}`}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(r)) : undefined}
          >
            {title && <div className="dt-card-title">{title.render(r)}</div>}
            {rest.map((c) => {
              const unlabelled = c.header === '' || c.header === null || c.header === undefined;
              return (
                <div key={c.key} className={`dt-card-row${unlabelled ? ' full' : ''}`}>
                  {!unlabelled && <span className="dt-card-label">{c.header}</span>}
                  <span className={`dt-card-value${c.num ? ' num' : ''}`}>{c.render(r)}</span>
                </div>
              );
            })}
          </div>
        ))}
        {rows && rows.length === 0 && <Empty>{empty}</Empty>}
        {footer}
      </div>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : undefined} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={rowKey(r)} className={onRowClick ? 'clickable' : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
      {rows && rows.length === 0 && <Empty>{empty}</Empty>}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="row" style={{ justifyContent: 'flex-end', fontSize: 13 }}>
      <span className="faint">
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}
