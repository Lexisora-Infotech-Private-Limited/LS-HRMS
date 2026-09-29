import { useEffect, type ReactNode } from 'react';
import { fileUrl } from '@/lib/api';

/** Page title block: h2 + subtitle on the left, actions on the right (every wireframe screen). */
export function PageHeader({ title, sub, actions, kicker }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {kicker && <div className="kicker">{kicker}</div>}
        <h2 style={kicker ? { marginTop: 4 } : undefined}>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export type Tone = 'accent' | 'outline' | 'neutral' | 'danger';
export function Tag({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`tag tag-${tone}`} title={title}>
      {children}
    </span>
  );
}

/**
 * Status → tag tone, following the wireframe convention: settled/positive states use the
 * accent fill ("~"), pending/attention states use outline ("!"), inert states neutral ("-").
 */
const POSITIVE = /^(active|approved|paid|signed|verified|done|completed|resolved|booked|selected|offered|ready|present|assigned|current|closed|on track|live|acknowledged|issued|published|hired|in stock|passed)$/i;
const PENDING = /(pending|progress|review|interview|screening|emailed|draft|due|at risk|late|notice|sent|open|submitted|scheduled|warranty expired|repair|high|offline|waiting|awaiting|planning|hold|escalated)/i;
const NEGATIVE = /(rejected|failed|cancel|exited|overdue|missing|absent|revoked|lost|suspended)/i;
export function toneFor(status: string | null | undefined): Tone {
  const s = (status ?? '').trim();
  if (NEGATIVE.test(s)) return 'danger';
  if (POSITIVE.test(s)) return 'accent';
  if (PENDING.test(s)) return 'outline';
  return 'neutral';
}
export function StatusTag({ status, label }: { status: string | null | undefined; label?: ReactNode }) {
  if (!status) return <span className="faint">—</span>;
  return <Tag tone={toneFor(status)}>{label ?? humanize(status)}</Tag>;
}
/** "PENDING_RM" → "Pending RM", "in_progress" → "In progress". */
export function humanize(s: string): string {
  if (!/[_A-Z]/.test(s) || /[a-z]/.test(s)) return s.includes('_') ? cap(s.replace(/_/g, ' ').toLowerCase()) : s;
  const words = s.split('_').map((w) => (w.length <= 2 ? w : w.toLowerCase()));
  return cap(words.join(' '));
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Tabs<T extends string | number>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={String(t.value)} role="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Segmented control (approval levels, billing cycle, card side…). */
export function Seg<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pill button row used for filters (team board, work mode…). */
export function Pills<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            font: 'inherit',
            fontSize: 12,
            padding: '5px 12px',
            borderRadius: 4,
            cursor: 'pointer',
            background: 'transparent',
            border: `1px solid ${o.value === value ? 'var(--color-accent)' : 'var(--color-divider)'}`,
            color: o.value === value ? 'var(--color-accent-700)' : 'var(--color-text)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type KpiItem = { label: ReactNode; value: ReactNode; sub?: ReactNode };
export function Kpis({ items }: { items: KpiItem[] }) {
  return (
    <div className="kpis">
      {items.map((k, i) => (
        <div className="kpi" key={i}>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{k.value}</div>
          {k.sub && <div className="kpi-sub">{k.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function Card({ kicker, title, children, actions, style }: { kicker?: ReactNode; title?: ReactNode; children?: ReactNode; actions?: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={style}>
      {kicker && <div className="card-kicker">{kicker}</div>}
      {title && <div className="card-title">{title}</div>}
      {children}
      {actions && <div className="row" style={{ marginTop: 'auto' }}>{actions}</div>}
    </div>
  );
}

export function Avatar({ name, initials, photoFileId, size = 32 }: { name?: string; initials?: string; photoFileId?: string | null; size?: number }) {
  const init = initials ?? (name ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} title={name}>
      {photoFileId ? <img src={fileUrl(photoFileId)} alt={name ?? ''} /> : init}
    </span>
  );
}

/** Square checkbox used in matrices (roles, policy, welcome kits, compliance). */
export function Check({ checked, onChange, disabled, label }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      className="check"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || !onChange}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!checked);
      }}
    >
      {checked ? '✓' : ''}
    </button>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="loading-block" aria-busy>
      <div className="row">
        <span className="spinner" /> {label && <span className="faint">{label}</span>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBlock({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="note" role="alert">
      {(error as Error)?.message ?? 'Something went wrong'} {retry && <button className="btn btn-ghost btn-sm" onClick={retry}>Retry</button>}
    </div>
  );
}

export function Modal({ title, onClose, children, actions, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className={`dialog${wide ? ' dialog-wide' : ''}`} role="dialog" aria-modal onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        {children}
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy }: { title: ReactNode; body?: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </>
      }
    >
      {body && <div className="dialog-body">{body}</div>}
    </Modal>
  );
}

/** Coloured strip of time segments (attendance timeline, tracker summary). */
export function TimelineBar({ segments, height = 28 }: { segments: { weight: number; kind: 'active' | 'break' | 'idle'; label?: string }[]; height?: number }) {
  return (
    <div className="timeline" style={{ height }}>
      {segments.map((s, i) => (
        <div key={i} className={`seg-${s.kind}`} style={{ flex: s.weight }} title={s.label ?? s.kind} />
      ))}
    </div>
  );
}
