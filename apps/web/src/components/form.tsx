import { useRef, useState, type ReactNode } from 'react';
import { HttpError, uploadFile } from '@/lib/api';
import { Modal } from './ui';

export type Option = { value: string; label: string };

export type FieldDef = {
  name: string;
  label: string;
  type: 'text' | 'email' | 'number' | 'money' | 'date' | 'time' | 'datetime' | 'select' | 'multiselect' | 'area' | 'file' | 'checkbox' | 'password' | 'color';
  /** 2 = full row (wireframe "span 2"). */
  span?: 1 | 2;
  options?: Option[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** File upload category (FileObject.category). Value becomes the FileObject id. */
  category?: string;
  accept?: string;
  /** Hide/show based on current values. */
  showIf?: (values: Record<string, any>) => boolean;
  disabled?: boolean;
};

export type FormValues = Record<string, any>;

function initialValue(f: FieldDef, init?: FormValues) {
  if (init && init[f.name] !== undefined && init[f.name] !== null) return init[f.name];
  if (f.type === 'checkbox') return false;
  if (f.type === 'multiselect') return [];
  if (f.type === 'select' && f.required && f.options?.length) return f.options[0]!.value;
  return '';
}

/**
 * Generic create/edit dialog — the wireframe's modal form. `onSubmit` receives values with
 * files already uploaded (their FileObject ids), numbers parsed, money in paise.
 */
export function FormModal({
  title,
  fields,
  submitLabel = 'Save',
  initial,
  onSubmit,
  onClose,
  intro,
  wide,
}: {
  title: ReactNode;
  fields: FieldDef[];
  submitLabel?: string;
  initial?: FormValues;
  onSubmit: (values: FormValues) => Promise<unknown> | unknown;
  onClose: () => void;
  intro?: ReactNode;
  wide?: boolean;
}) {
  const [values, setValues] = useState<FormValues>(() => Object.fromEntries(fields.map((f) => [f.name, initialValue(f, initial)])));
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (name: string, v: any) => setValues((s) => ({ ...s, [name]: v }));
  const visible = fields.filter((f) => !f.showIf || f.showIf(values));

  async function submit() {
    const errs: Record<string, string> = {};
    for (const f of visible) {
      const v = values[f.name];
      const empty = f.type === 'file' ? !files[f.name] && !v : v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length);
      if (f.required && empty) errs[f.name] = `${f.label} is required`;
      if (f.type === 'email' && v && !/^\S+@\S+\.\S+$/.test(v)) errs[f.name] = 'Enter a valid email';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const out: FormValues = {};
      for (const f of visible) {
        let v = values[f.name];
        if (f.type === 'file') {
          const file = files[f.name];
          v = file ? (await uploadFile(file, f.category ?? 'misc')).id : v || null;
        } else if (f.type === 'number') v = v === '' ? null : Number(v);
        else if (f.type === 'money') v = v === '' ? null : Math.round(Number(String(v).replace(/[,₹\s]/g, '')) * 100);
        else if (v === '') v = null;
        out[f.name] = v;
      }
      await onSubmit(out);
      onClose();
    } catch (e) {
      if (e instanceof HttpError && e.details && typeof e.details === 'object' && 'fieldErrors' in (e.details as any)) {
        const fe = (e.details as any).fieldErrors as Record<string, string[]>;
        setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? 'Invalid'])));
      }
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide={wide}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </>
      }
    >
      {intro && <div className="dialog-body">{intro}</div>}
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {visible.map((f) => (
          <div key={f.name} className={`field${f.span === 2 || f.type === 'area' || f.type === 'file' ? ' span-2' : ''}`}>
            {f.type !== 'checkbox' && <label htmlFor={`f-${f.name}`}>{f.label}{f.required ? '' : ''}</label>}
            <FieldInput f={f} value={values[f.name]} onChange={(v) => set(f.name, v)} file={files[f.name] ?? null} onFile={(file) => setFiles((s) => ({ ...s, [f.name]: file }))} invalid={!!errors[f.name]} />
            {errors[f.name] ? <div className="field-error">{errors[f.name]}</div> : f.hint ? <div className="field-hint">{f.hint}</div> : null}
          </div>
        ))}
        <button type="submit" hidden />
      </form>
      {formError && <div className="field-error" role="alert">{formError}</div>}
    </Modal>
  );
}

export function FieldInput({ f, value, onChange, file, onFile, invalid }: { f: FieldDef; value: any; onChange: (v: any) => void; file?: File | null; onFile?: (f: File | null) => void; invalid?: boolean }) {
  const id = `f-${f.name}`;
  const common = { id, 'aria-invalid': invalid || undefined, disabled: f.disabled } as const;
  switch (f.type) {
    case 'select':
      return (
        <select className="input" {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {!f.required && <option value="">{f.placeholder ?? 'Select…'}</option>}
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case 'multiselect':
      return <MultiSelect options={f.options ?? []} value={value ?? []} onChange={onChange} />;
    case 'area':
      return <textarea className="input" {...common} placeholder={f.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return (
        <label className="radio">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span className="dot" style={{ borderRadius: 3 }} />
          {f.label}
        </label>
      );
    case 'file':
      return <FileDrop file={file ?? null} onFile={onFile ?? (() => {})} accept={f.accept} existing={value ? 'File attached' : undefined} />;
    case 'money':
      return <input className="input" {...common} inputMode="decimal" placeholder={f.placeholder ?? '₹'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'datetime':
      return <input className="input" {...common} type="datetime-local" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input className="input" {...common} type={f.type} placeholder={f.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function MultiSelect({ options, value, onChange }: { options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="input" style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 4 }}>
        {value.map((v) => (
          <span key={v} className="tag tag-accent" style={{ cursor: 'pointer' }} onClick={() => onChange(value.filter((x) => x !== v))}>
            {options.find((o) => o.value === v)?.label ?? v} ×
          </span>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={value.length ? '' : 'Search and pick…'} style={{ border: 0, outline: 0, background: 'transparent', font: 'inherit', fontSize: 13, flex: 1, minWidth: 80 }} />
      </div>
      {q && (
        <div style={{ maxHeight: 150, overflow: 'auto', borderTop: '1px solid var(--color-divider)' }}>
          {shown.slice(0, 30).map((o) => (
            <div
              key={o.value}
              style={{ padding: '4px 6px', cursor: 'pointer', fontSize: 13 }}
              onClick={() => {
                if (!value.includes(o.value)) onChange([...value, o.value]);
                setQ('');
              }}
            >
              {o.label}
            </div>
          ))}
          {!shown.length && <div className="faint" style={{ padding: 6, fontSize: 12 }}>No matches</div>}
        </div>
      )}
    </div>
  );
}

export function FileDrop({ file, onFile, accept, label = 'Drop file or browse', existing }: { file: File | null; onFile: (f: File | null) => void; accept?: string; label?: string; existing?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
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
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <input ref={ref} type="file" hidden accept={accept} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file ? (
        <span>
          {file.name} · {(file.size / 1024).toFixed(0)} KB{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onFile(null); }}>Remove</button>
        </span>
      ) : (
        existing ?? label
      )}
    </div>
  );
}
