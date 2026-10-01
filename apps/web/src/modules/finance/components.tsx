import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { finMonthLabel } from '@lexisora/shared';
import { Modal, type Tone } from '@/components/ui';
import { lastMonths, monthKeyNow } from './api';

/** Month dropdown (newest first) used for KPI periods. */
export function MonthSelect({ value, onChange, count = 12, label = 'Month' }: { value: string; onChange: (v: string) => void; count?: number; label?: string }) {
  return (
    <select className="input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto' }}>
      {lastMonths(monthKeyNow(), count).map((m) => (
        <option key={m} value={m}>{finMonthLabel(m)}</option>
      ))}
    </select>
  );
}

/** `?open=<id>` style deep links (header search, cross-links between finance screens). */
export function useParamState(key: string): [string | null, (v: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key);
  const set = (v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(key, v);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  return [value, set];
}

/** Text area dialog for reasons (reverse voucher, cancel invoice / purchase). */
export function ReasonDialog({ title, body, label = 'Reason', confirmLabel, danger, onConfirm, onClose }: { title: ReactNode; body?: ReactNode; label?: string; confirmLabel: string; danger?: boolean; onConfirm: (reason: string) => Promise<unknown>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (reason.trim().length < 3) return setErr('Give a reason');
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={go}>{busy ? 'Working…' : confirmLabel}</button>
        </>
      }
    >
      {body && <div className="dialog-body">{body}</div>}
      <div className="field">
        <label htmlFor="fin-reason">{label}</label>
        <textarea id="fin-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!err || undefined} autoFocus />
        {err && <div className="field-error">{err}</div>}
      </div>
    </Modal>
  );
}

/** Comma / Enter separated chips (tags, email lists). */
export function ChipsInput({ value, onChange, placeholder, lower }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; lower?: boolean }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(/[,;\n]/).map((s) => (lower ? s.trim().toLowerCase() : s.trim())).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])]);
    setText('');
  };
  return (
    <div className="input fin-chip-input" style={{ padding: 6 }}>
      {value.map((v) => (
        <span key={v} className="tag tag-accent" style={{ cursor: 'pointer' }} onClick={() => onChange(value.filter((x) => x !== v))} title="Remove">
          {v} ×
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => (/[,;]/.test(e.target.value) ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(text)}
        placeholder={value.length ? '' : placeholder}
        style={{ border: 0, outline: 0, background: 'transparent', font: 'inherit', fontSize: 13, flex: 1, minWidth: 120 }}
      />
    </div>
  );
}

/** Invoice status → wireframe tag tone (Draft neutral, Emailed outline, Paid accent, Overdue red). */
const INVOICE_TONE: Record<string, Tone> = { Draft: 'neutral', Issued: 'outline', Emailed: 'outline', 'Partially paid': 'outline', Paid: 'accent', Cancelled: 'neutral', Overdue: 'danger' };
export const invoiceTone = (display: string): Tone => INVOICE_TONE[display] ?? 'neutral';

export function Section({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="fin-section">
      <div className="row-between" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h4 style={{ margin: 0, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', fontWeight: 400 }}>{title}</h4>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** Opens an authenticated PDF/image in an inline frame (preview) — falls back to a link on phones. */
export function DocFrame({ src, title }: { src: string; title: string }) {
  return <iframe className="fin-pdf" src={src} title={title} />;
}
