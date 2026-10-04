import { useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { finMonthLabel, formatINR } from '@lexisora/shared';
import { Modal, type Tone } from '@/components/ui';
import { HttpError } from '@/lib/api';
import { lastMonths, monthKeyNow } from './api';

/** Month dropdown (newest first) used for KPI periods. `allowAll` adds an "All months" option (value ''). */
export function MonthSelect({ value, onChange, count = 12, label = 'Month', allowAll }: { value: string; onChange: (v: string) => void; count?: number; label?: string; allowAll?: boolean }) {
  return (
    <select className="input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto' }}>
      {allowAll && <option value="">All months</option>}
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

/** User-facing message of an API error. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong — try again';
}

/** `{ field: message }` from an API error's `details.fieldErrors`. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (e instanceof HttpError && e.details && typeof e.details === 'object' && 'fieldErrors' in (e.details as Record<string, unknown>)) {
    const fe = (e.details as { fieldErrors: Record<string, string[] | string> }).fieldErrors;
    return Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, Array.isArray(v) ? (v[0] ?? 'Invalid') : String(v)]));
  }
  return {};
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
      setErr(errorText(e));
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
export function ChipsInput({ value, onChange, placeholder, lower, id }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; lower?: boolean; id?: string }) {
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
        id={id}
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

/** Labelled form field with error / hint (finance custom forms). */
export function Field({ label, htmlFor, error, hint, span2, badge, low, children }: { label: ReactNode; htmlFor?: string; error?: string; hint?: ReactNode; span2?: boolean; badge?: ReactNode; low?: boolean; children: ReactNode }) {
  return (
    <div className={`field${span2 ? ' span-2' : ''}${low ? ' low' : ''}`}>
      <label htmlFor={htmlFor}>
        {label}
        {badge}
      </label>
      {children}
      {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

/** Drop zone for several files (filing upload). */
export function MultiFileDrop({ files, onFiles, accept }: { files: File[]; onFiles: (f: File[]) => void; accept?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    onFiles(next.slice(0, 20));
  };
  return (
    <div className="fin-file-list">
      <div
        className={`dropzone${drag ? ' drag' : ''}`}
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
      >
        <input ref={ref} type="file" hidden multiple accept={accept} onChange={(e) => add(e.target.files)} />
        {files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'} selected · add more` : 'Drop files or browse (up to 20)'}
      </div>
      {files.map((f) => (
        <div key={`${f.name}:${f.size}`} className="row-between" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{f.name} · {(f.size / 1024).toFixed(0)} KB</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFiles(files.filter((x) => x !== f))}>Remove</button>
        </div>
      ))}
    </div>
  );
}

/** Invoice status → wireframe tag tone (Draft neutral, Emailed outline, Paid accent, Overdue red). */
const INVOICE_TONE: Record<string, Tone> = { Draft: 'neutral', Issued: 'outline', Emailed: 'outline', 'Partially paid': 'outline', Paid: 'accent', Cancelled: 'neutral', Overdue: 'danger' };
export const invoiceTone = (display: string): Tone => INVOICE_TONE[display] ?? 'neutral';

export function Section({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="fin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h4>{title}</h4>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** Opens an authenticated PDF/image in an inline frame (preview). */
export function DocFrame({ src, title }: { src: string; title: string }) {
  return <iframe className="fin-pdf" src={src} title={title} />;
}

/** Debit/credit cell: blank when zero (day book convention). */
export const amt = (paise: number | null | undefined) => (paise ? formatINR(paise) : '');
/** ₹ with paise (detail views). */
export const inr2 = (paise: number | null | undefined) => formatINR(paise ?? 0, { decimals: true });
/** Debit-positive balance → "₹ 1,20,000 Dr" / "₹ 45,000 Cr". */
export const drCr = (paise: number) => (paise === 0 ? '₹ 0' : `${formatINR(Math.abs(paise))} ${paise > 0 ? 'Dr' : 'Cr'}`);

/** Small uppercase badge next to labels ("from bill 92%", "estimated"). */
export function Badge({ children, low, title }: { children: ReactNode; low?: boolean; title?: string }) {
  return (
    <span className={`fin-badge${low ? ' low' : ''}`} title={title}>
      {children}
    </span>
  );
}
