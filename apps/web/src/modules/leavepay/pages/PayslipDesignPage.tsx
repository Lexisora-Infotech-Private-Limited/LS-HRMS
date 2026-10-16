import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PAYSLIP_ALIGNS,
  PAYSLIP_ELEMENT_LABELS,
  PAYSLIP_FIELDS,
  PAYSLIP_FONTS,
  PAYSLIP_FONT_LABELS,
  PAYSLIP_PAGE,
  PAYSLIP_PRESET_LABELS,
  PAYSLIP_SAMPLE,
  TEXT_CASES,
  TEXT_CASE_LABELS,
  applyTextCase,
  bakeCompanyFields,
  newPayslipElement,
  payslipFieldLabel,
  planPayslipTable,
  payslipLabelsToText,
  payslipTextToLabels,
  payslipCanvasPreset,
  payslipCanvasSchema,
  type PayslipCanvas,
  type PayslipElement,
  type PayslipElementOf,
  type PayslipRowOverride,
  type PayslipElementType,
  type PayslipStyle,
} from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { ConfirmDialog, ErrorBlock, Loading, PageHeader } from '@/components/ui';
import { lpApi, lpKeys } from '../api';
import '../leavepay.css';

type Row = { label: string; value: string };
type Focus = { el: HTMLInputElement | HTMLTextAreaElement; set: (v: string) => void } | null;
type Drag = { id: string; mode: 'move' | 'resize'; x0: number; y0: number; orig: PayslipElement; moved: boolean };

const MAX_LOGO_BYTES = 250 * 1024;
const uid = () => `e${Math.random().toString(36).slice(2, 9)}`;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const FONT_CSS: Record<PayslipStyle['font'], string> = { HELVETICA: 'Helvetica, Arial, sans-serif', TIMES: "'Times New Roman', Times, serif", COURIER: "'Courier New', Courier, monospace" };
const money = (paise: number) => `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ELEMENT_TYPES = Object.keys(PAYSLIP_ELEMENT_LABELS) as PayslipElementType[];
const ADD_LABELS: Record<PayslipElementType, string> = { text: 'Text', logo: 'Logo', line: 'Line', box: 'Box', details: 'Details rows', table: 'Table' };

function summary(e: PayslipElement): string {
  switch (e.type) {
    case 'text': return e.text.replace(/\s+/g, ' ').slice(0, 34) || '(empty)';
    case 'logo': return 'Company or uploaded logo';
    case 'line': return e.dashed ? 'Dashed' : 'Solid';
    case 'box': return e.fill ? 'Filled' : 'Outline';
    case 'details': return `${e.rows.length} rows`;
    case 'table': return `${e.kind === 'EARNINGS' ? 'Earnings' : 'Deductions'} · ${e.heading}`;
  }
}

// ── Small form pieces ────────────────────────────────────────────────────────────────────────────────────────
function Tick({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="radio">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="dot" style={{ borderRadius: 3 }} />
      {label}
    </label>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

/** A number box you can clear and retype; commits whenever the text is a valid number. */
function Num({ value, onChange, label, min, max, step = 1, width = 72 }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number; width?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className="input"
      type="number"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      style={{ width }}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && !Number.isNaN(n)) onChange(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

/** A text box whose cursor position the "Insert field" picker can use. */
function TextBox({ value, onChange, focus, multiline, label, placeholder, maxLength = 160, width }: { value: string; onChange: (v: string) => void; focus: React.MutableRefObject<Focus>; multiline?: boolean; label: string; placeholder?: string; maxLength?: number; width?: number | string }) {
  // Employee values are stored as {{employee.name}} but typed and shown as [Employee name].
  const set = (v: string) => onChange(payslipLabelsToText(v));
  const common = {
    value: payslipTextToLabels(value),
    'aria-label': label,
    placeholder,
    maxLength,
    className: 'input',
    style: width ? { width } : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(e.target.value),
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      focus.current = { el: e.currentTarget, set };
    },
  };
  return multiline ? <textarea rows={3} {...common} /> : <input {...common} />;
}

function FieldPicker({ focus }: { focus: React.MutableRefObject<Focus> }) {
  // Company name, address and PAN are plain typed text, so only employee and payroll values are offered here.
  const fields = PAYSLIP_FIELDS.filter((f) => f.group !== 'Company');
  const groups = [...new Set(fields.map((f) => f.group))];
  return (
    <select
      className="input"
      aria-label="Insert employee field"
      value=""
      style={{ width: 210 }}
      onChange={(e) => {
        const key = e.target.value;
        const f = focus.current;
        if (!key || !f) return;
        const token = payslipFieldLabel(key);
        const start = f.el.selectionStart ?? f.el.value.length;
        const end = f.el.selectionEnd ?? start;
        f.set(f.el.value.slice(0, start) + token + f.el.value.slice(end));
        const el = f.el;
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start + token.length, start + token.length);
        }, 0);
      }}
    >
      <option value="">Insert employee value…</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {fields.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

const FIELD_HELP = 'Type any text you like, including your company name. Something that changes per employee (name, net pay…) shows as [Employee name] and is filled in from payroll; insert it from the list.';

/** Font family, size, bold / italic, colour and alignment. */
function StyleBar({ value, onChange, noAlign }: { value: PayslipStyle; onChange: (s: PayslipStyle) => void; noAlign?: boolean }) {
  const set = (p: Partial<PayslipStyle>) => onChange({ ...value, ...p });
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <select className="input" aria-label="Font" style={{ width: 150 }} value={value.font} onChange={(e) => set({ font: e.target.value as PayslipStyle['font'] })}>
        {PAYSLIP_FONTS.map((f) => <option key={f} value={f}>{PAYSLIP_FONT_LABELS[f]}</option>)}
      </select>
      <Num label="Font size" min={6} max={28} step={0.5} value={value.size} onChange={(size) => set({ size })} />
      <button type="button" aria-label="Bold" aria-pressed={value.bold} className={`btn btn-sm ${value.bold ? 'btn-primary' : 'btn-secondary'}`} style={{ fontWeight: 700 }} onClick={() => set({ bold: !value.bold })}>B</button>
      <button type="button" aria-label="Italic" aria-pressed={value.italic} className={`btn btn-sm ${value.italic ? 'btn-primary' : 'btn-secondary'}`} style={{ fontStyle: 'italic' }} onClick={() => set({ italic: !value.italic })}>I</button>
      <input type="color" aria-label="Text colour" value={value.color} onChange={(e) => set({ color: e.target.value })} style={{ width: 36, height: 32, padding: 2 }} />
      <select className="input" aria-label="Text case" title="Text case" style={{ width: 150 }} value={value.textCase} onChange={(e) => set({ textCase: e.target.value as PayslipStyle['textCase'] })}>
        {TEXT_CASES.map((c) => <option key={c} value={c}>{TEXT_CASE_LABELS[c]}</option>)}
      </select>
      {!noAlign &&
        PAYSLIP_ALIGNS.map((a) => (
          <button key={a} type="button" aria-label={`Align ${a.toLowerCase()}`} aria-pressed={value.align === a} className={`btn btn-sm ${value.align === a ? 'btn-primary' : 'btn-secondary'}`} onClick={() => set({ align: a })}>
            {a === 'LEFT' ? 'Left' : a === 'CENTER' ? 'Centre' : 'Right'}
          </button>
        ))}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 44, height: 34, padding: 2 }} />;
}

/** An editable list of label / value rows (add, remove, reorder). */
function RowList({ rows, onChange, focus }: { rows: Row[]; onChange: (r: Row[]) => void; focus: React.MutableRefObject<Focus> }) {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 6, alignItems: 'center' }}>
          <TextBox label={`Row ${i + 1} label`} value={r.label} maxLength={40} width={120} placeholder="Label" focus={focus} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
          <TextBox label={`Row ${i + 1} value`} value={r.value} width="100%" placeholder="Value" focus={focus} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Move row up" onClick={() => move(i, -1)}>↑</button>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Move row down" onClick={() => move(i, 1)}>↓</button>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Delete row" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...rows, { label: 'Label', value: '' }])}>+ Add row</button></div>
    </div>
  );
}

/** Lines and spacing of a table: for the whole table, then row by row (matched to the pay component's name). */
function TableLines({ e, set }: { e: PayslipElementOf<'table'>; set: (patch: Record<string, unknown>) => void }) {
  const [extra, setExtra] = useState('');
  const sample = (e.kind === 'EARNINGS' ? PAYSLIP_SAMPLE.earnings : PAYSLIP_SAMPLE.deductions).map((l) => l.label);
  const key = (l: string) => l.trim().toLowerCase();
  const names = [...sample, ...e.rowOverrides.map((o) => o.label).filter((l) => !sample.some((s) => key(s) === key(l)))];
  const find = (l: string) => e.rowOverrides.find((o) => key(o.label) === key(l));
  const setRow = (label: string, patch: Partial<PayslipRowOverride>) => {
    const cur = find(label) ?? { label, height: 0, gapAfter: 0, line: 'DEFAULT' as const };
    const next = { ...cur, ...patch };
    const plain = !next.height && !next.gapAfter && next.line === 'DEFAULT';
    set({ rowOverrides: [...e.rowOverrides.filter((o) => key(o.label) !== key(label)), ...(plain ? [] : [next])] });
  };
  const tri = (v: boolean | null) => (v === null ? 'AUTO' : v ? 'ON' : 'OFF');
  const untri = (v: string) => (v === 'AUTO' ? null : v === 'ON');
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="kicker">Lines and spacing</div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="Line colour"><ColorField label="Line colour" value={e.lineColor} onChange={(lineColor) => set({ lineColor })} /></Field>
        <Field label="Line thickness"><Num label="Line thickness" min={0.25} max={4} step={0.25} value={e.lineWidth} onChange={(lineWidth) => set({ lineWidth })} /></Field>
        <Tick checked={e.lineDashed} onChange={(lineDashed) => set({ lineDashed })} label="Dashed" />
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="Line under heading">
          <select className="input" aria-label="Line under heading" style={{ width: 110 }} value={tri(e.headerLine)} onChange={(ev) => set({ headerLine: untri(ev.target.value) })}>
            <option value="AUTO">Like rows</option>
            <option value="ON">Show</option>
            <option value="OFF">Hide</option>
          </select>
        </Field>
        <Field label="Line under total">
          <select className="input" aria-label="Line under total" style={{ width: 110 }} value={tri(e.totalLine)} onChange={(ev) => set({ totalLine: untri(ev.target.value) })}>
            <option value="AUTO">Like rows</option>
            <option value="ON">Show</option>
            <option value="OFF">Hide</option>
          </select>
        </Field>
        <Tick checked={e.rules} onChange={(rules) => set({ rules })} label="Lines between rows" />
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="Row height"><Num label="Row height" min={10} max={40} value={e.rowHeight} onChange={(rowHeight) => set({ rowHeight })} /></Field>
        <Field label="Heading height (0 = row)"><Num label="Heading height" min={0} max={60} value={e.headerHeight} onChange={(headerHeight) => set({ headerHeight })} /></Field>
        <Field label="Gap under heading"><Num label="Gap under heading" min={0} max={60} value={e.headerGap} onChange={(headerGap) => set({ headerGap })} /></Field>
        {e.showTotal && <Field label="Gap above total"><Num label="Gap above total" min={0} max={60} value={e.totalGap} onChange={(totalGap) => set({ totalGap })} /></Field>}
        <Field label="Heading colour"><ColorField label="Heading colour" value={e.headColor} onChange={(headColor) => set({ headColor })} /></Field>
      </div>
      <div className="kicker">Row by row</div>
      <div className="faint" style={{ fontSize: 12 }}>These settings follow the row’s name, so they apply to every employee who has that pay component. Height 0 means the table’s row height.</div>
      {names.map((n) => {
        const o = find(n);
        return (
          <div key={n} className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderBottom: '1px solid var(--color-divider)', paddingBottom: 8 }}>
            <div style={{ width: 110, fontWeight: 600, fontSize: 13 }}>{n}</div>
            <Field label="Height"><Num label={`${n} height`} min={0} max={60} width={60} value={o?.height ?? 0} onChange={(height) => setRow(n, { height })} /></Field>
            <Field label="Space after"><Num label={`${n} space after`} min={0} max={60} width={60} value={o?.gapAfter ?? 0} onChange={(gapAfter) => setRow(n, { gapAfter })} /></Field>
            <Field label="Line under">
              <select className="input" aria-label={`${n} line`} style={{ width: 100 }} value={o?.line ?? 'DEFAULT'} onChange={(ev) => setRow(n, { line: ev.target.value as PayslipRowOverride['line'] })}>
                <option value="DEFAULT">Like table</option>
                <option value="SHOW">Show</option>
                <option value="HIDE">Hide</option>
              </select>
            </Field>
            {!sample.some((s) => key(s) === key(n)) && <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${n}`} onClick={() => set({ rowOverrides: e.rowOverrides.filter((x) => key(x.label) !== key(n)) })}>✕</button>}
          </div>
        );
      })}
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <input className="input" aria-label="Another pay component name" placeholder="Another component, e.g. Bonus" maxLength={40} style={{ flex: 1 }} value={extra} onChange={(ev) => setExtra(ev.target.value)} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={!extra.trim() || names.some((n) => key(n) === key(extra))} onClick={() => { setRow(extra.trim(), { gapAfter: 1 }); setExtra(''); }}>+ Add row name</button>
      </div>
    </div>
  );
}

// ── Properties of the selected element ────────────────────────────────────────────────────────────────────────
function Properties({ e, set, focus }: { e: PayslipElement; set: (patch: Record<string, unknown>) => void; focus: React.MutableRefObject<Focus> }) {
  const geometry = (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <Field label="X"><Num label="X" value={e.x} min={0} max={PAYSLIP_PAGE.width} onChange={(x) => set({ x })} /></Field>
      <Field label="Y"><Num label="Y" value={e.y} min={0} max={PAYSLIP_PAGE.height} onChange={(y) => set({ y })} /></Field>
      <Field label="Width"><Num label="Width" value={e.w} min={1} max={PAYSLIP_PAGE.width} onChange={(w) => set({ w })} /></Field>
      <Field label={e.type === 'line' ? 'Height (0 = straight)' : 'Height'}><Num label="Height" value={e.h} min={e.type === 'line' ? 0 : 1} max={PAYSLIP_PAGE.height} onChange={(h) => set({ h })} /></Field>
    </div>
  );
  let body: ReactNode = null;
  switch (e.type) {
    case 'text':
      body = (
        <>
          <TextBox multiline label="Text" value={e.text} maxLength={600} focus={focus} onChange={(v) => set({ text: v })} />
          <div className="row" style={{ gap: 8, alignItems: 'center' }}><FieldPicker focus={focus} /></div>
          <div className="faint" style={{ fontSize: 12 }}>{FIELD_HELP} You can also double-click the text on the page (or press Enter while it is selected) to type straight onto it.</div>
          <StyleBar value={e.style} onChange={(style) => set({ style })} />
        </>
      );
      break;
    case 'logo':
      body = <div className="faint" style={{ fontSize: 12 }}>Shows the logo chosen under “Logo and colour”. Drag the corner to resize it; the logo keeps its shape inside the box.</div>;
      break;
    case 'line':
      body = (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Colour"><ColorField label="Line colour" value={e.color} onChange={(color) => set({ color })} /></Field>
          <Field label="Thickness"><Num label="Thickness" min={0.25} max={6} step={0.25} value={e.thickness} onChange={(thickness) => set({ thickness })} /></Field>
          <Tick checked={e.dashed} onChange={(dashed) => set({ dashed })} label="Dashed" />
        </div>
      );
      break;
    case 'box':
      body = (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <Tick checked={!!e.fill} onChange={(on) => set({ fill: on ? '#f8f3ea' : null })} label="Fill" />
            {e.fill && <ColorField label="Fill colour" value={e.fill} onChange={(fill) => set({ fill })} />}
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <Tick checked={!!e.border} onChange={(on) => set({ border: on ? '#d7d3d3' : null })} label="Border" />
            {e.border && <ColorField label="Border colour" value={e.border} onChange={(border) => set({ border })} />}
            {e.border && <Field label="Border width"><Num label="Border width" min={0.25} max={6} step={0.25} value={e.borderWidth} onChange={(borderWidth) => set({ borderWidth })} /></Field>}
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Rounded corners">
              <select className="input" aria-label="Rounded corners" style={{ width: 150 }} value={e.corners} onChange={(ev) => set({ corners: ev.target.value })}>
                <option value="ALL">All four corners</option>
                <option value="TOP">Top two only</option>
                <option value="BOTTOM">Bottom two only</option>
                <option value="NONE">None (square)</option>
              </select>
            </Field>
            {e.corners !== 'NONE' && <Field label="Corner radius"><Num label="Corner radius" min={0} max={40} value={e.radius} onChange={(radius) => set({ radius })} /></Field>}
          </div>
        </div>
      );
      break;
    case 'details':
      body = (
        <>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}><FieldPicker focus={focus} /></div>
          <div className="faint" style={{ fontSize: 12 }}>Type the label on the left. On the right, type text or insert an employee value.</div>
          <RowList rows={e.rows} onChange={(rows) => set({ rows })} focus={focus} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Field label="Row height"><Num label="Row height" min={8} max={40} value={e.rowHeight} onChange={(rowHeight) => set({ rowHeight })} /></Field>
            <Field label="Label width"><Num label="Label width" min={30} max={300} value={e.labelWidth} onChange={(labelWidth) => set({ labelWidth })} /></Field>
            <Field label="After the label">
              <select className="input" style={{ width: 100 }} value={e.separator} onChange={(ev) => set({ separator: ev.target.value })}>
                <option value="">Nothing</option>
                <option value=":">A colon</option>
              </select>
            </Field>
            <Field label="Label colour"><ColorField label="Label colour" value={e.labelColor} onChange={(labelColor) => set({ labelColor })} /></Field>
          </div>
          <div className="kicker">Value style</div>
          <StyleBar value={e.style} onChange={(style) => set({ style })} noAlign />
        </>
      );
      break;
    case 'table':
      body = (
        <>
          <Field label="Shows">
            <select className="input" value={e.kind} onChange={(ev) => set({ kind: ev.target.value, heading: ev.target.value === 'EARNINGS' ? 'Earnings' : 'Deductions', totalLabel: ev.target.value === 'EARNINGS' ? 'Total earnings' : 'Total deductions', showFullMonth: false })}>
              <option value="EARNINGS">Earnings (one row per earning)</option>
              <option value="DEDUCTIONS">Deductions (one row per deduction)</option>
            </select>
          </Field>
          <div className="faint" style={{ fontSize: 12 }}>The names and amounts come from each employee’s payroll. You control the headings, labels, fonts and where it sits. Leave room below for extra rows.</div>
          <div className="form-grid">
            <Field label="Heading"><TextBox label="Table heading" value={e.heading} maxLength={40} focus={focus} onChange={(v) => set({ heading: v })} /></Field>
            <Field label="Amount column heading"><TextBox label="Amount heading" value={e.amountHeading} maxLength={30} focus={focus} onChange={(v) => set({ amountHeading: v })} /></Field>
          </div>
          {e.kind === 'EARNINGS' && (
            <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Tick checked={e.showFullMonth} onChange={(showFullMonth) => set({ showFullMonth })} label={`Show a “${e.fullMonthHeading}” column`} />
              {e.showFullMonth && <TextBox label="Full month heading" value={e.fullMonthHeading} maxLength={30} width={140} focus={focus} onChange={(v) => set({ fullMonthHeading: v })} />}
            </div>
          )}
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tick checked={e.showTotal} onChange={(showTotal) => set({ showTotal })} label="Show a total row" />
            {e.showTotal && <TextBox label="Total label" value={e.totalLabel} maxLength={40} width={160} focus={focus} onChange={(v) => set({ totalLabel: v })} />}
            {e.showTotal && <Tick checked={!!e.totalFill} onChange={(on) => set({ totalFill: on ? '#f6f5f4' : null })} label="Shade it" />}
            {e.showTotal && e.totalFill && <ColorField label="Total row shade" value={e.totalFill} onChange={(totalFill) => set({ totalFill })} />}
          </div>
          <TableLines e={e} set={set} />
          <div className="kicker">Row style</div>
          <StyleBar value={e.style} onChange={(style) => set({ style })} noAlign />
        </>
      );
      break;
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      {geometry}
      {body}
    </div>
  );
}

// ── The page (canvas) ────────────────────────────────────────────────────────────────────────────────────────
function fillSample(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_, k: string) => values[k] ?? '');
}

const textCss = (s: PayslipStyle, scale: number): CSSProperties => ({
  fontFamily: FONT_CSS[s.font],
  fontSize: s.size * scale,
  fontWeight: s.bold ? 700 : 400,
  fontStyle: s.italic ? 'italic' : 'normal',
  color: s.color,
  textAlign: s.align.toLowerCase() as CSSProperties['textAlign'],
  lineHeight: 1.2,
});

/** CSS corner radii for a box: top-left, top-right, bottom-right, bottom-left. */
function boxRadius(e: PayslipElementOf<'box'>, scale: number): string {
  const r = e.corners === 'NONE' ? 0 : Math.min(e.radius, e.w / 2, e.h / 2) * scale;
  const top = e.corners === 'ALL' || e.corners === 'TOP' ? r : 0;
  const bottom = e.corners === 'ALL' || e.corners === 'BOTTOM' ? r : 0;
  return `${top}px ${top}px ${bottom}px ${bottom}px`;
}

function NodeBody({ e, scale, values, logoSrc, editing, onText, onStopEdit }: { e: PayslipElement; scale: number; values: Record<string, string>; logoSrc: string | null; editing: boolean; onText: (v: string) => void; onStopEdit: () => void }) {
  switch (e.type) {
    case 'text':
      if (editing) {
        return (
          <textarea
            autoFocus
            value={payslipTextToLabels(e.text)}
            maxLength={600}
            aria-label="Edit text"
            onPointerDown={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => {
              ev.stopPropagation();
              if (ev.key === 'Escape') onStopEdit();
            }}
            onChange={(ev) => onText(payslipLabelsToText(ev.target.value))}
            onBlur={onStopEdit}
            style={{ ...textCss(e.style, scale), width: '100%', height: '100%', resize: 'none', border: 'none', outline: '1px solid var(--color-accent)', background: 'rgba(255,255,255,.9)', padding: 0, margin: 0, overflow: 'hidden' }}
          />
        );
      }
      return <div style={{ ...textCss(e.style, scale), width: '100%', height: '100%', overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{applyTextCase(fillSample(e.text, values), e.style.textCase) || <span className="pd-empty">(empty)</span>}</div>;
    case 'logo':
      return logoSrc ? <img src={logoSrc} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'left top', display: 'block' }} /> : <div className="pd-ph">Logo</div>;
    case 'line':
      return (
        <svg width="100%" height="100%" style={{ overflow: 'visible', display: 'block' }}>
          <line x1={0} y1={0} x2={e.w * scale} y2={e.h * scale} stroke={e.color} strokeWidth={e.thickness * scale} strokeDasharray={e.dashed ? `${3 * scale} ${3 * scale}` : undefined} />
        </svg>
      );
    case 'box':
      return <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', background: e.fill ?? 'transparent', border: e.border ? `${Math.max(0.5, e.borderWidth * scale)}px solid ${e.border}` : undefined, borderRadius: boxRadius(e, scale) }} />;
    case 'details': {
      const sepW = e.separator ? 8 : 0;
      return (
        <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
          {e.rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', height: e.rowHeight * scale, overflow: 'hidden' }}>
              <span style={{ ...textCss({ ...e.style, bold: false, color: e.labelColor, size: e.style.size * 0.9, align: 'LEFT' }, scale), width: (e.labelWidth - 4) * scale, flex: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginRight: 4 * scale }}>{r.label}</span>
              {sepW > 0 && <span style={{ ...textCss({ ...e.style, bold: false, color: e.labelColor, align: 'LEFT' }, scale), width: sepW * scale - 4 * scale, flex: 'none' }}>{e.separator}</span>}
              <span style={{ ...textCss({ ...e.style, align: 'LEFT' }, scale), flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{applyTextCase(fillSample(r.value, values).trim(), e.style.textCase) || '—'}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'table': {
      const earn = e.kind === 'EARNINGS';
      const full = earn && e.showFullMonth;
      const lines = earn ? PAYSLIP_SAMPLE.earnings.map((l) => ({ label: l.label, full: money(l.full), amount: money(l.amount) })) : PAYSLIP_SAMPLE.deductions.map((l) => ({ label: l.label, full: '', amount: money(l.amount) }));
      const total = earn ? 9_160_000 : 200_000;
      const cols = full ? ['50%', '25%', '25%'] : ['70%', '30%'];
      const plan = planPayslipTable(e, lines.map((l) => l.label));
      const cellsFor = (kind: 'head' | 'row' | 'total', i: number) =>
        kind === 'head'
          ? full ? [e.heading, e.fullMonthHeading, e.amountHeading] : [e.heading, e.amountHeading]
          : kind === 'total'
            ? full ? [e.totalLabel, '', money(total)] : [e.totalLabel, money(total)]
            : full ? [lines[i - 1]!.label, lines[i - 1]!.full, lines[i - 1]!.amount] : [lines[i - 1]!.label, lines[i - 1]!.amount];
      const lineCss = `${Math.max(0.5, e.lineWidth * scale)}px ${e.lineDashed ? 'dashed' : 'solid'} ${e.lineColor}`;
      return (
        <div style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          {plan.map((p, i) => (
            <div key={i} style={{ marginTop: p.gapBefore * scale, marginBottom: p.gapAfter * scale }}>
              <div style={{ display: 'flex', height: p.height * scale, alignItems: 'center', borderBottom: p.line ? lineCss : undefined, background: p.kind === 'total' && e.totalFill ? e.totalFill : undefined, boxSizing: 'border-box' }}>
                {cellsFor(p.kind, i).map((c, j) => (
                  <span
                    key={j}
                    style={{
                      ...(p.kind === 'head' ? { ...textCss({ ...e.style, bold: true, size: Math.min(8, e.style.size), color: e.headColor, align: 'LEFT' }, scale), textTransform: 'uppercase' as const } : textCss({ ...e.style, bold: p.kind === 'total' ? true : e.style.bold, align: 'LEFT' }, scale)),
                      width: cols[j],
                      padding: `0 ${3 * scale}px`,
                      boxSizing: 'border-box',
                      textAlign: (full ? j > 0 : j === 1) ? 'right' : 'left',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {p.kind !== 'head' && j === 0 ? applyTextCase(c, e.style.textCase) : c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
  }
}

function Canvas({
  els,
  sel,
  logoSrc,
  values,
  editing,
  onSelect,
  onPatch,
  onDelete,
  onDuplicate,
  onEdit,
  onBeginChange,
}: {
  els: PayslipElement[];
  sel: string | null;
  logoSrc: string | null;
  values: Record<string, string>;
  editing: string | null;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, p: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onEdit: (id: string | null) => void;
  onBeginChange: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const lastDown = useRef<{ id: string; t: number }>({ id: '', t: 0 });
  const [avail, setAvail] = useState(PAYSLIP_PAGE.width + 40);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setAvail(entries[0]?.contentRect.width ?? PAYSLIP_PAGE.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = clamp((avail - 8) / PAYSLIP_PAGE.width, 0.5, 1.35);
  const W = PAYSLIP_PAGE.width * scale;
  const H = PAYSLIP_PAGE.height * scale;

  const down = (ev: RPointerEvent<HTMLElement>, el: PayslipElement, mode: 'move' | 'resize') => {
    ev.stopPropagation();
    if (editing === el.id && mode === 'move') return;
    // A second press on the same text within 400 ms starts typing on it. (The browser's own double-click event never
    // reaches the text, because the page holds the pointer while dragging.)
    const now = Date.now();
    if (mode === 'move' && el.type === 'text' && lastDown.current.id === el.id && now - lastDown.current.t < 400) {
      lastDown.current = { id: '', t: 0 };
      drag.current = null;
      ev.preventDefault();
      onSelect(el.id);
      onEdit(el.id);
      return;
    }
    lastDown.current = { id: el.id, t: now };
    ev.preventDefault();
    onSelect(el.id);
    page.current?.focus({ preventScroll: true });
    try {
      page.current?.setPointerCapture(ev.pointerId);
    } catch {
      /* older browsers */
    }
    drag.current = { id: el.id, mode, x0: ev.clientX, y0: ev.clientY, orig: el, moved: false };
  };
  const move = (ev: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = Math.round((ev.clientX - d.x0) / scale);
    const dy = Math.round((ev.clientY - d.y0) / scale);
    if (!dx && !dy && !d.moved) return;
    if (!d.moved) onBeginChange();
    d.moved = true;
    if (d.mode === 'move') onPatch(d.id, { x: round1(clamp(d.orig.x + dx, 0, PAYSLIP_PAGE.width - 4)), y: round1(clamp(d.orig.y + dy, 0, PAYSLIP_PAGE.height - 1)) });
    else onPatch(d.id, { w: round1(clamp(d.orig.w + dx, 1, PAYSLIP_PAGE.width)), h: round1(clamp(d.orig.h + dy, d.orig.type === 'line' ? 0 : 1, PAYSLIP_PAGE.height)) });
  };
  const up = (ev: RPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    try {
      page.current?.releasePointerCapture(ev.pointerId);
    } catch {
      /* not captured */
    }
  };
  const key = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (!sel || editing) return;
    const el = els.find((x) => x.id === sel);
    if (!el) return;
    const step = ev.shiftKey ? 10 : 1;
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      onDelete(el.id);
    } else if (nudge[ev.key]) {
      ev.preventDefault();
      const [dx, dy] = nudge[ev.key]!;
      onPatch(el.id, { x: round1(clamp(el.x + dx, 0, PAYSLIP_PAGE.width - 4)), y: round1(clamp(el.y + dy, 0, PAYSLIP_PAGE.height - 1)) });
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') {
      ev.preventDefault();
      onDuplicate(el.id);
    } else if (ev.key === 'Enter' && el.type === 'text') {
      ev.preventDefault();
      onEdit(el.id);
    } else if (ev.key === 'Escape') onSelect(null);
  };

  return (
    <div ref={wrap} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <div
        ref={page}
        className="pd-page"
        tabIndex={0}
        role="application"
        aria-label="Payslip page"
        style={{ width: W, height: H }}
        onPointerDown={() => {
          onSelect(null);
          onEdit(null);
        }}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        {els.map((el, i) => (
          <div
            key={el.id}
            className={`pd-node${el.id === sel ? ' sel' : ''}`}
            data-testid={`el-${el.type}`}
            style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: Math.max(el.type === 'line' ? Math.abs(el.h) * scale : 0, el.type === 'line' ? 6 : el.h * scale), zIndex: i + 1 }}
            onPointerDown={(ev) => down(ev, el, 'move')}
            onDoubleClick={() => el.type === 'text' && onEdit(el.id)}
            title={PAYSLIP_ELEMENT_LABELS[el.type]}
          >
            <NodeBody e={el} scale={scale} values={values} logoSrc={logoSrc} editing={editing === el.id} onText={(v) => onPatch(el.id, { text: v })} onStopEdit={() => onEdit(null)} />
            {el.id === sel && <span className="pd-handle" onPointerDown={(ev) => down(ev, el, 'resize')} aria-label="Resize" />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Payslip design (Admin/CEO and HR): a free canvas. Drag every element where you want it, type your own text. */
export default function PayslipDesignPage() {
  const q = useQuery({ queryKey: lpKeys.payslipTemplate, queryFn: lpApi.payslipTemplate });
  const [design, setDesign] = useState<PayslipCanvas | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<'design' | 'pdf'>('design');
  const [logoError, setLogoError] = useState<string | null>(null);
  const [confirmPreset, setConfirmPreset] = useState<'CLASSIC' | 'SUMMARY_CARD' | null>(null);
  const focus = useRef<Focus>(null);
  const past = useRef<PayslipCanvas[]>([]);
  const lastEdit = useRef(0);
  const [undoCount, setUndoCount] = useState(0);
  useEffect(() => {
    if (q.data && !design) setDesign(bakeCompanyFields(q.data.design, q.data.company));
  }, [q.data, design]);

  const saved = q.data?.design;
  const dirty = !!design && !!saved && JSON.stringify(design) !== JSON.stringify(saved);
  const parsed = useMemo(() => (design ? payslipCanvasSchema.safeParse(design) : null), [design]);
  const problems = parsed && !parsed.success ? [...new Set(parsed.error.issues.map((i) => i.message))] : [];
  const valid = !!parsed?.success;

  // The PDF check: a real sample payslip rendered by the server from the design being edited.
  const [debounced, setDebounced] = useState<PayslipCanvas | null>(null);
  useEffect(() => {
    if (!design || tab !== 'pdf') return;
    const t = setTimeout(() => setDebounced(design), 400);
    return () => clearTimeout(t);
  }, [design, tab]);
  const previewable = tab === 'pdf' && !!debounced && payslipCanvasSchema.safeParse(debounced).success;
  const preview = useQuery({
    queryKey: ['leavepay', 'payslip-preview', JSON.stringify(debounced)],
    queryFn: () => lpApi.previewPayslipPdf(debounced!),
    enabled: previewable,
    placeholderData: (p) => p,
    staleTime: Infinity,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!preview.data) return;
    const u = URL.createObjectURL(preview.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [preview.data]);

  const save = useAction(() => lpApi.savePayslipTemplate(design!), { success: 'Payslip design saved · it applies from the next payroll run', invalidate: [lpKeys.payslipTemplate] });

  if (q.isLoading || !design) return q.error ? <ErrorBlock error={q.error} retry={() => void q.refetch()} /> : <Loading />;

  const company = q.data?.company;
  const values = { ...PAYSLIP_SAMPLE.values, ...(company ? { 'company.name': company.name, 'company.address': company.address ?? '' } : {}) };
  const logoSrc = design.logoMode === 'CUSTOM' ? design.customLogo : design.logoMode === 'COMPANY' ? (q.data?.companyLogo ?? null) : null;

  // Undo: a snapshot is kept at the start of each discrete change (and of each drag).
  const beginChange = () => {
    past.current.push(design);
    if (past.current.length > 60) past.current.shift();
    setUndoCount(past.current.length);
  };
  const undo = () => {
    const prev = past.current.pop();
    setUndoCount(past.current.length);
    if (prev) {
      setDesign(prev);
      if (sel && !prev.elements.some((e) => e.id === sel)) setSel(null);
    }
  };
  const setEls = (f: (es: PayslipElement[]) => PayslipElement[]) => setDesign((d) => ({ ...d!, elements: f(d!.elements) }));
  const patch = (id: string, p: Record<string, unknown>) => setEls((es) => es.map((e) => (e.id === id ? ({ ...e, ...p } as PayslipElement) : e)));
  // Typing in a field is one undo step per burst, not one per keystroke.
  const patchTyped = (id: string, p: Record<string, unknown>) => {
    const now = Date.now();
    if (now - lastEdit.current > 1200) beginChange();
    lastEdit.current = now;
    patch(id, p);
  };
  const remove = (id: string) => {
    beginChange();
    setEls((es) => es.filter((e) => e.id !== id));
    if (sel === id) setSel(null);
  };
  const duplicate = (id: string) => {
    const src = design.elements.find((e) => e.id === id);
    if (!src) return;
    beginChange();
    const copy = { ...JSON.parse(JSON.stringify(src)), id: uid(), x: Math.min(src.x + 12, PAYSLIP_PAGE.width - 10), y: Math.min(src.y + 12, PAYSLIP_PAGE.height - 10) } as PayslipElement;
    setEls((es) => [...es, copy]);
    setSel(copy.id);
  };
  const reorder = (id: string, delta: number | 'top' | 'bottom') => {
    beginChange();
    setEls((es) => {
      const i = es.findIndex((e) => e.id === id);
      if (i < 0) return es;
      const j = delta === 'top' ? es.length - 1 : delta === 'bottom' ? 0 : clamp(i + delta, 0, es.length - 1);
      const next = [...es];
      const [it] = next.splice(i, 1);
      next.splice(j, 0, it!);
      return next;
    });
  };
  const add = (type: PayslipElementType) => {
    beginChange();
    const n = design.elements.length;
    const el = newPayslipElement(type, uid(), 60 + (n % 8) * 14, 60 + (n % 8) * 14);
    setEls((es) => [...es, el]);
    setSel(el.id);
    if (type === 'text') setEditing(el.id);
    setTab('design');
  };
  const applyPreset = (layout: 'CLASSIC' | 'SUMMARY_CARD') => {
    beginChange();
    const p = bakeCompanyFields(payslipCanvasPreset(layout, design.accentColor), q.data!.company);
    setDesign((d) => ({ ...p, logoMode: d!.logoMode, customLogo: d!.customLogo, accentColor: d!.accentColor }));
    setSel(null);
  };

  function pickLogo(file: File | undefined) {
    setLogoError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return setLogoError('Use a PNG or JPEG image.');
    if (file.size > MAX_LOGO_BYTES) return setLogoError('The logo is too large. Use an image under 250 KB.');
    const r = new FileReader();
    r.onload = () => setDesign((d) => ({ ...d!, customLogo: String(r.result), logoMode: 'CUSTOM' }));
    r.readAsDataURL(file);
  }

  const selected = design.elements.find((e) => e.id === sel) ?? null;
  const selIndex = selected ? design.elements.findIndex((e) => e.id === selected.id) : -1;

  return (
    <div data-screen-label="Payslip design" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Payslip design"
        sub="Design your payslip on the page: drag anything where you want it, resize it, and type your own text."
        actions={
          <>
            <button className="btn btn-secondary" disabled={undoCount === 0} onClick={undo}>Undo</button>
            <button className="btn btn-secondary" onClick={() => setConfirmPreset('CLASSIC')}>Reset to default</button>
            <button className="btn btn-primary" disabled={!dirty || !valid || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending ? 'Saving…' : 'Save design'}</button>
          </>
        }
      />
      <div className="note" style={{ fontSize: 13 }}>
        A saved design applies to payslips generated from the <b>next payroll run</b>; payslips already issued stay as they were. Names and amounts shown on the page are a sample. Only the earnings and deductions rows, and any employee value you insert, are filled in from payroll for each person.
        {q.data?.legacy && <> Your payslips currently use an earlier design; the page below starts from the closest template, and saving switches to this editor’s design.</>}
        {dirty && <b> · Unsaved changes</b>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 440px) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 20 }}>
          <section className="stack" style={{ gap: 8 }}>
            <div className="kicker">Add to the page</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {ELEMENT_TYPES.map((t) => <button key={t} className="btn btn-secondary btn-sm" onClick={() => add(t)}>+ {ADD_LABELS[t]}</button>)}
            </div>
            <div className="faint" style={{ fontSize: 12 }}>Drag an item on the page to move it, and drag its corner square to resize it. Double-click text to type on it. Arrow keys nudge (Shift = 10), Delete removes, Ctrl+D duplicates.</div>
          </section>

          <section className="stack" style={{ gap: 8 }}>
            <div className="kicker">Selected: {selected ? PAYSLIP_ELEMENT_LABELS[selected.type] : 'nothing'}</div>
            {selected ? (
              <div style={{ border: '1px solid var(--color-accent)', borderRadius: 6, padding: 12 }}>
                <Properties e={selected} set={(p) => patchTyped(selected.id, p)} focus={focus} />
                <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" disabled={selIndex === design.elements.length - 1} onClick={() => reorder(selected.id, 'top')}>Bring to front</button>
                  <button className="btn btn-ghost btn-sm" disabled={selIndex === 0} onClick={() => reorder(selected.id, 'bottom')}>Send to back</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => duplicate(selected.id)}>Duplicate</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(selected.id)}>Delete</button>
                </div>
              </div>
            ) : (
              <div className="faint" style={{ fontSize: 13, padding: 12, border: '1px dashed var(--color-divider)', borderRadius: 6 }}>Click an item on the page, or in the list below, to change its text, font, colour, size and position.</div>
            )}
          </section>

          <section className="stack" style={{ gap: 8 }}>
            <div className="kicker">Logo and colour</div>
            <div className="field">
              <label htmlFor="pd-logo">Logo</label>
              <select id="pd-logo" className="input" value={design.logoMode} onChange={(e) => setDesign((d) => ({ ...d!, logoMode: e.target.value as PayslipCanvas['logoMode'] }))}>
                <option value="NONE">No logo</option>
                <option value="COMPANY">Company logo (from Branding)</option>
                <option value="CUSTOM">Upload a logo for payslips</option>
              </select>
            </div>
            {design.logoMode === 'CUSTOM' && (
              <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                {design.customLogo && <img src={design.customLogo} alt="Payslip logo" style={{ height: 40, maxWidth: 120, objectFit: 'contain', border: '1px solid var(--color-divider)', borderRadius: 4, padding: 2 }} />}
                <input type="file" accept="image/png,image/jpeg" aria-label="Upload logo" onChange={(e) => pickLogo(e.target.files?.[0])} />
                {design.customLogo && <button className="btn btn-ghost btn-sm" onClick={() => setDesign((d) => ({ ...d!, customLogo: null }))}>Remove</button>}
              </div>
            )}
            {logoError && <div className="field-error">{logoError}</div>}
            <div className="faint" style={{ fontSize: 12 }}>The logo appears where you place a Logo item on the page.</div>
          </section>

          <section className="stack" style={{ gap: 8 }}>
            <div className="kicker">Start from a template</div>
            <div className="row" style={{ gap: 8 }}>
              {(['CLASSIC', 'SUMMARY_CARD'] as const).map((l) => <button key={l} className="btn btn-secondary" onClick={() => setConfirmPreset(l)}>{PAYSLIP_PRESET_LABELS[l]}</button>)}
            </div>
            <div className="faint" style={{ fontSize: 12 }}>Replaces everything on the page with that template; your logo choice is kept.</div>
          </section>

          <section className="stack" style={{ gap: 6 }}>
            <div className="kicker">On the page, back to front</div>
            {design.elements.map((e, i) => (
              <div key={e.id} className="row" style={{ gap: 6, alignItems: 'center', border: `1px solid ${sel === e.id ? 'var(--color-accent)' : 'var(--color-divider)'}`, borderRadius: 6, padding: '2px 6px' }}>
                <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: '4px 6px' }} onClick={() => setSel(e.id)}>
                  <span style={{ fontWeight: 600 }}>{PAYSLIP_ELEMENT_LABELS[e.type].split(' /')[0]}</span>
                  <span className="faint" style={{ marginLeft: 8, fontSize: 12 }}>{summary(e)}</span>
                </button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Move forward" disabled={i === design.elements.length - 1} onClick={() => reorder(e.id, 1)}>↑</button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Move back" disabled={i === 0} onClick={() => reorder(e.id, -1)}>↓</button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Delete item" onClick={() => remove(e.id)}>✕</button>
              </div>
            ))}
            {design.elements.length === 0 && <div className="faint" style={{ fontSize: 13 }}>The page is empty. Use “Add to the page” above.</div>}
          </section>

          {problems.map((p) => <div key={p} className="field-error">{p}</div>)}
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <div className="kicker" style={{ flex: 1 }}>{tab === 'design' ? 'Page (A4) · sample data' : 'PDF check · how the real payslip will print'}</div>
            <button className={`btn btn-sm ${tab === 'design' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('design')}>Design</button>
            <button className={`btn btn-sm ${tab === 'pdf' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('pdf')}>PDF check</button>
          </div>
          {tab === 'design' ? (
            <div className="pd-stage">
              <Canvas
                els={design.elements}
                sel={sel}
                logoSrc={logoSrc}
                values={values}
                editing={editing}
                onSelect={setSel}
                onPatch={(id, p) => patch(id, p)}
                onDelete={remove}
                onDuplicate={duplicate}
                onEdit={(id) => {
                  if (id && id !== editing) beginChange();
                  setEditing(id);
                }}
                onBeginChange={beginChange}
              />
            </div>
          ) : url && previewable ? (
            <iframe title="Payslip PDF check" src={`${url}#toolbar=0&navpanes=0&view=FitH`} style={{ width: '100%', height: 'min(86vh, 900px)', border: '1px solid var(--color-divider)', borderRadius: 6, background: '#fff' }} />
          ) : (
            <div className="faint" style={{ fontSize: 13, padding: 24, border: '1px dashed var(--color-divider)', borderRadius: 6 }}>{problems.length ? 'Fix the issues on the left to see the PDF.' : 'Preparing the PDF…'}</div>
          )}
          {tab === 'pdf' && preview.error && <div className="field-error">The PDF could not be generated: {(preview.error as Error).message}</div>}
        </div>
      </div>

      {confirmPreset && (
        <ConfirmDialog
          title={`Replace the page with the ${PAYSLIP_PRESET_LABELS[confirmPreset]} template?`}
          body="Everything on the page is replaced. Your logo choice is kept. You can Undo, and nothing is saved until you click Save design."
          confirmLabel="Replace page"
          onConfirm={() => {
            applyPreset(confirmPreset);
            setConfirmPreset(null);
          }}
          onClose={() => setConfirmPreset(null)}
        />
      )}
    </div>
  );
}

