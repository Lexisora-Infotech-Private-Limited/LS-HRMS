import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  IDCARD_BINDING_LABELS,
  IDCARD_BINDINGS,
  formatDate,
  formatTime,
  type IdCardBinding,
  type IdCardElement,
  type IdCardPreviewData,
  type IdCardRow,
  type IdCardSettings,
  type IdCardTemplateDto,
  type IdCardTemplateInput,
} from '@lexisora/shared';
import { authUrl, download, fileUrl, uploadFile } from '@/lib/api';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { FormModal, type FieldDef } from '@/components/form';
import { DataTable, type Column } from '@/components/table';
import { ConfirmDialog, ErrorBlock, Loading, Modal, PageHeader, Pills, Seg, Tabs, Tag, type Tone } from '@/components/ui';
import { lookupsFor, peopleApi, peopleKeys, type PrintBatchRow } from '../api';
import '../people.css';

/**
 * ID card designer (M10): elements palette, CR80 front/back canvas with draggable, resizable
 * fields bound to employee data (1 mm snap), templates, properties panel; card generation,
 * print-vendor batches and the cards register. Server renders the same template JSON to
 * 300-DPI PNG/PDF (pdfkit) with a QR that opens the public verify page.
 */

type Tab = 'designer' | 'cards' | 'batches';
type Side = 'front' | 'back';
type Draft = { name: string; orientation: 'PORTRAIT' | 'LANDSCAPE'; front: IdCardElement[]; back: IdCardElement[]; frontBgFileId: string | null; backBgFileId: string | null };

const K = {
  templates: [...peopleKeys.idcards, 'templates'] as const,
  settings: [...peopleKeys.idcards, 'settings'] as const,
  generatable: [...peopleKeys.idcards, 'generatable'] as const,
  batches: [...peopleKeys.idcards, 'batches'] as const,
  preview: (id: string) => [...peopleKeys.idcards, 'preview', id] as const,
  list: (status: string, q: string) => [...peopleKeys.idcards, 'list', status, q] as const,
};
const INVALIDATE = [[...peopleKeys.idcards]];
const DIMS = { PORTRAIT: { w: 53.98, h: 85.6 }, LANDSCAPE: { w: 85.6, h: 53.98 } } as const;
const FAMILY = { serif: "Georgia, 'Times New Roman', serif", sans: "'Segoe UI', Arial, Helvetica, sans-serif" };
const PT_TO_MM = 25.4 / 72;

const STATUS_TONE: Record<string, Tone> = { QUEUED: 'outline', READY: 'accent', SENT_TO_PRINT: 'outline', PRINTED: 'accent', ISSUED: 'accent', REVOKED: 'danger', SURRENDERED: 'neutral', REPLACED: 'neutral', VOID: 'neutral' };
const BATCH_LABEL: Record<string, string> = { QUEUED: 'Queued', SENT: 'Sent', ACKNOWLEDGED: 'Acknowledged', DELIVERED: 'Delivered', FAILED: 'Failed' };

// ── Element palette (wireframe idEls + spec extras) ───────────────────────

type Font = NonNullable<IdCardElement['font']>;
const font = (size: number, family: Font['family'] = 'sans', color = '#201f1d', align: Font['align'] = 'center', weight: Font['weight'] = 'normal'): Font => ({ size, family, color, align, weight });
type PaletteItem = { key: string; label: string; make: (W: number) => Omit<IdCardElement, 'id'> };
const textEl = (label: string, binding: IdCardBinding | null, w: number, h: number, f: Font, text?: string, type: IdCardElement['type'] = 'TEXT'): Omit<IdCardElement, 'id'> => ({
  type,
  label,
  binding,
  text: text ?? null,
  xMm: 0,
  yMm: 0,
  wMm: w,
  hMm: h,
  z: 1,
  font: f,
});
const PALETTE: PaletteItem[] = [
  { key: 'photo', label: 'Photo', make: () => ({ type: 'PHOTO', label: 'Photo', binding: 'employee.photo', xMm: 0, yMm: 0, wMm: 22, hMm: 25.6, z: 1 }) },
  { key: 'name', label: 'Full name', make: (W) => textEl('Full name', 'employee.full_name', W - 4, 8, font(22, 'serif')) },
  { key: 'designation', label: 'Designation', make: (W) => textEl('Designation', 'employee.designation', W - 4, 5, font(9, 'sans', '#605d5d')) },
  { key: 'code', label: 'Employee ID', make: (W) => textEl('Employee ID', 'employee.emp_code', W - 4, 5, font(9)) },
  { key: 'blood', label: 'Blood group', make: () => textEl('Blood group', 'employee.blood_group', 30, 5, font(9), 'Blood group: ') },
  { key: 'qr', label: 'QR code', make: () => ({ type: 'QR', label: 'QR code', binding: 'qr.verify_url', xMm: 0, yMm: 0, wMm: 21, hMm: 21, z: 1 }) },
  { key: 'logo', label: 'Company logo', make: (W) => ({ type: 'LOGO', label: 'Company logo', binding: 'tenant.logo', xMm: 0, yMm: 0, wMm: Math.min(40, W - 4), hMm: 8, z: 1, font: font(13, 'serif') }) },
  { key: 'emergency', label: 'Emergency contact', make: (W) => textEl('Emergency contact', 'settings.emergency_line', W - 6, 4, font(7.5), 'Emergency: ') },
];
const PALETTE_MORE: PaletteItem[] = [
  { key: 'static', label: 'Static text', make: (W) => textEl('Static text', null, Math.min(40, W - 4), 5, font(8), 'Your text', 'STATIC') },
  { key: 'signature', label: 'Signature', make: (W) => textEl('Signature', null, W - 10, 5, font(7.5), 'Authorised signatory', 'SIGNATURE') },
  { key: 'shape', label: 'Shape', make: () => ({ type: 'SHAPE', label: 'Shape', xMm: 0, yMm: 0, wMm: 20, hMm: 2, fill: '#b68235', z: 0 }) },
];
const ALL_PALETTE = [...PALETTE, ...PALETTE_MORE];

const TEXT_BINDINGS = IDCARD_BINDINGS.filter((b) => !['employee.photo', 'tenant.logo', 'qr.verify_url'].includes(b));
function bindingOptions(type: IdCardElement['type']): IdCardBinding[] {
  if (type === 'PHOTO') return ['employee.photo'];
  if (type === 'QR') return ['qr.verify_url'];
  if (type === 'LOGO') return ['tenant.logo'];
  return TEXT_BINDINGS;
}

// ── Rendering helpers (mirror the server renderer: card-render.ts) ────────

function fitFontSize(text: string, sizePt: number, widthMm: number): number {
  const w = text.length * sizePt * 0.52 * PT_TO_MM;
  if (w <= widthMm || !text) return sizePt;
  return Math.max(5, Math.floor(((sizePt * widthMm) / w) * 10) / 10);
}
function elementText(el: IdCardElement, data: IdCardPreviewData | undefined): { text: string; placeholder: boolean } {
  if (el.type === 'STATIC') return { text: el.text ?? '', placeholder: false };
  if (el.type === 'SIGNATURE') return { text: el.text || 'Authorised signatory', placeholder: false };
  if (el.type === 'LOGO') return { text: data?.['tenant.name'] ?? 'Company', placeholder: false };
  if (el.binding) {
    const v = data?.[el.binding];
    return v ? { text: `${el.text ?? ''}${v}`, placeholder: false } : { text: `${el.text ?? ''}{${IDCARD_BINDING_LABELS[el.binding] ?? el.binding}}`, placeholder: true };
  }
  return { text: el.text ?? '', placeholder: false };
}
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const newId = (k: string) => `${k}-${Math.random().toString(36).slice(2, 7)}`;
const toDraft = (t: IdCardTemplateDto): Draft => ({ name: t.name, orientation: t.orientation, front: t.front, back: t.back, frontBgFileId: t.frontBgFileId ?? null, backBgFileId: t.backBgFileId ?? null });
const toInput = (d: Draft, isDefault?: boolean): IdCardTemplateInput => ({ ...d, isDefault });

export default function IdCardPage() {
  const [sp, setSp] = useSearchParams();
  const tabParam = sp.get('tab');
  const [tab, setTab] = useState<Tab>(tabParam === 'cards' || tabParam === 'batches' ? tabParam : 'designer');
  const gen = useQuery({ queryKey: K.generatable, queryFn: () => peopleApi.generatable() });
  const settings = useQuery({ queryKey: K.settings, queryFn: () => peopleApi.idSettings() });
  const batches = useQuery({ queryKey: K.batches, queryFn: () => peopleApi.printBatches() });
  const [confirmPrint, setConfirmPrint] = useState(false);
  const nav = useNavigate();

  const generate = useAction(() => peopleApi.generateCards({ allGeneratable: true }), {
    success: (r) => (r.generated ? `${r.generated} ID card${r.generated === 1 ? '' : 's'} generated (front & back)` : `No cards generated${r.skipped.length ? ` · ${r.skipped.join('; ')}` : ''}`),
    invalidate: INVALIDATE,
  });
  const print = useAction(() => peopleApi.sendToPrint({ allReady: true }), {
    success: (r) => `High-res PDF emailed to ${r.vendorEmail}`,
    invalidate: INVALIDATE,
    onSuccess: () => setConfirmPrint(false),
  });

  const n = gen.data?.count ?? 0;
  const ready = gen.data?.ready ?? 0;
  const waiting = gen.data?.waiting ?? [];
  const vendor = settings.data?.printVendorEmail ?? '';
  const pickTab = (t: Tab) => {
    setTab(t);
    const next = new URLSearchParams(sp);
    if (t === 'designer') next.delete('tab');
    else next.set('tab', t);
    setSp(next, { replace: true });
  };

  return (
    <div data-screen-label="ID card designer" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="ID card designer"
        sub="Drag fields onto the card. Cards generate automatically when a photo and details are uploaded."
        actions={
          <>
            <button className="btn btn-secondary" disabled={!n || generate.isPending} title={n ? undefined : 'No new joiner has a complete profile yet'} onClick={() => generate.mutate(undefined)}>
              {generate.isPending ? 'Generating…' : `Generate for ${n} new joiner${n === 1 ? '' : 's'}`}
            </button>
            <button className="btn btn-primary" disabled={!ready} title={ready ? undefined : 'Generate cards first'} onClick={() => setConfirmPrint(true)}>
              Send to print vendor
            </button>
          </>
        }
      />
      {waiting.length > 0 && (
        <div className="note" style={{ fontSize: 13 }}>
          {waiting.length} waiting for photo or blood group:{' '}
          {waiting.map((w, i) => (
            <span key={w.cardId}>
              {i > 0 && ' · '}
              <a href={`/employees/${w.employeeId}`} onClick={(e) => { e.preventDefault(); nav(`/employees/${w.employeeId}`); }}>{w.name}</a>
              <span className="faint"> ({w.missing.join(', ')})</span>
            </span>
          ))}
        </div>
      )}
      <Tabs<Tab>
        value={tab}
        onChange={pickTab}
        tabs={[
          { value: 'designer', label: 'Designer' },
          { value: 'cards', label: `Cards${ready ? ` · ${ready} ready` : ''}` },
          { value: 'batches', label: `Print batches${batches.data?.length ? ` · ${batches.data.length}` : ''}` },
        ]}
      />
      {tab === 'designer' && <Designer settings={settings.data} initialEmployee={sp.get('employee')} />}
      {tab === 'cards' && <CardsTab />}
      {tab === 'batches' && <BatchesTab rows={batches.data} loading={batches.isLoading} error={batches.error} retry={() => void batches.refetch()} />}
      {confirmPrint && (
        <ConfirmDialog
          title="Send to print vendor"
          body={
            <>
              Email {ready} ready card{ready === 1 ? '' : 's'} to <b>{vendor || 'the print vendor'}</b>? A high-res PDF (CR80, front &amp; back, 300 DPI, {ready * 2} pages) is attached and
              the cards move to “Sent to print”.
            </>
          }
          confirmLabel={print.isPending ? 'Sending…' : 'Send PDF'}
          busy={print.isPending}
          onConfirm={() => print.mutate(undefined)}
          onClose={() => setConfirmPrint(false)}
        />
      )}
    </div>
  );
}

// ── Designer ──────────────────────────────────────────────────────────────

function Designer({ settings, initialEmployee }: { settings: IdCardSettings | undefined; initialEmployee: string | null }) {
  const { toast, toastError } = useToast();
  const tpls = useQuery({ queryKey: K.templates, queryFn: () => peopleApi.idTemplates() });
  const emps = useQuery({ queryKey: ['lookups', 'people', 'idcard-employees'], queryFn: () => lookupsFor(['employees']) });
  const [tplId, setTplId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [side, setSide] = useState<Side>('front');
  const [sel, setSel] = useState<string | null>('name');
  const [employeeId, setEmployeeId] = useState<string>(initialEmployee ?? '');
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [vendor, setVendor] = useState('');
  const [bgBusy, setBgBusy] = useState(false);

  const preview = useQuery({ queryKey: K.preview(employeeId || 'auto'), queryFn: () => peopleApi.idPreviewData(employeeId || null) });
  useEffect(() => {
    if (!employeeId && preview.data?.employeeId) setEmployeeId(preview.data.employeeId);
  }, [preview.data?.employeeId, employeeId]);
  useEffect(() => setVendor(settings?.printVendorEmail ?? ''), [settings?.printVendorEmail]);

  const tpl = useMemo(() => tpls.data?.find((t) => t.id === tplId) ?? tpls.data?.find((t) => t.isDefault) ?? tpls.data?.[0] ?? null, [tpls.data, tplId]);
  useEffect(() => {
    if (tpl && (!draft || tplId !== tpl.id)) {
      setTplId(tpl.id);
      setDraft(toDraft(tpl));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl?.id, tpl?.version]);
  const dirty = !!tpl && !!draft && JSON.stringify(toDraft(tpl)) !== JSON.stringify(draft);

  const publish = useAction((d: Draft) => peopleApi.updateIdTemplate(tpl!.id, toInput(d)), {
    success: (r) => `${r.name} published · v${r.version}`,
    invalidate: INVALIDATE,
    // Adopt the server's normalised copy so the editor is clean again.
    onSuccess: (r) => setDraft(toDraft(r)),
  });
  const makeDefault = useAction(() => peopleApi.setDefaultIdTemplate(tpl!.id), { success: `${tpl?.name ?? 'Template'} is now the default template`, invalidate: INVALIDATE });
  const saveVendor = useAction(() => peopleApi.saveIdSettings({ ...(settings as IdCardSettings), printVendorEmail: vendor.trim() }), { success: 'Print vendor saved', invalidate: INVALIDATE });

  if (tpls.error) return <ErrorBlock error={tpls.error} retry={() => void tpls.refetch()} />;
  if (tpls.isLoading || !tpl || !draft) return <Loading />;

  const dims = DIMS[draft.orientation];
  const els = draft[side];
  const selected = els.find((e) => e.id === sel) ?? null;
  const setEls = (fn: (els: IdCardElement[]) => IdCardElement[]) => setDraft((d) => (d ? { ...d, [side]: fn(d[side]) } : d));
  const patchEl = (id: string, p: Partial<IdCardElement>) => setEls((list) => list.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const patchFont = (id: string, p: Partial<Font>) => setEls((list) => list.map((e) => (e.id === id ? { ...e, font: { ...font(10), ...(e.font ?? {}), ...p } } : e)));
  const removeEl = (id: string) => {
    setEls((list) => list.filter((e) => e.id !== id));
    setSel(null);
  };
  const addEl = (item: PaletteItem, at?: { x: number; y: number }) => {
    const base = item.make(dims.w);
    const x = at ? at.x - base.wMm / 2 : (dims.w - base.wMm) / 2;
    const y = at ? at.y - base.hMm / 2 : (dims.h - base.hMm) / 2;
    const el = { ...base, id: newId(item.key), xMm: round1(clamp(x, 0, Math.max(0, dims.w - base.wMm))), yMm: round1(clamp(y, 0, Math.max(0, dims.h - base.hMm))) } as IdCardElement;
    if (els.length >= 40) return toastError('A side can hold up to 40 elements');
    setEls((list) => [...list, el]);
    setSel(el.id);
  };
  const layer = (id: string, dir: 1 | -1) => setEls((list) => list.map((e) => (e.id === id ? { ...e, z: clamp((e.z ?? 0) + dir, -10, 30) } : e)));
  const pickTemplate = (id: string) => {
    if (id === tpl.id) return;
    if (dirty) setSwitchTo(id);
    else {
      setTplId(id);
      const t = tpls.data!.find((x) => x.id === id)!;
      setDraft(toDraft(t));
      setSel(null);
    }
  };

  async function uploadBg(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toastError('Upload a PNG or JPG image');
    setBgBusy(true);
    try {
      const f = await uploadFile(file, 'id-card');
      setDraft((d) => (d ? { ...d, [side === 'front' ? 'frontBgFileId' : 'backBgFileId']: f.id } : d));
      toast(`${side === 'front' ? 'Front' : 'Back'} background added · publish to apply`);
    } catch (e) {
      toastError(e);
    } finally {
      setBgBusy(false);
    }
  }
  const bgId = side === 'front' ? draft.frontBgFileId : draft.backBgFileId;

  return (
    <div className="pp-idc">
      {/* Left: elements + templates */}
      <div className="stack" style={{ gap: 6 }}>
        <div className="pp-idc-kick">Elements</div>
        {PALETTE.map((p) => (
          <PaletteButton key={p.key} item={p} onAdd={() => addEl(p)} />
        ))}
        <div className="pp-idc-kick" style={{ marginTop: 6 }}>More</div>
        {PALETTE_MORE.map((p) => (
          <PaletteButton key={p.key} item={p} onAdd={() => addEl(p)} />
        ))}
        <div className="pp-idc-kick" style={{ marginTop: 10 }}>Templates</div>
        {tpls.data!.map((t) => (
          <button key={t.id} type="button" className={`pp-idc-el pp-idc-tpl${t.id === tpl.id ? ' on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => pickTemplate(t.id)}>
            <span>{t.name}</span>
            <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>{t.isDefault ? 'Default · ' : ''}v{t.version}</span>
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>+ New template</button>
      </div>

      {/* Centre: canvas */}
      <div className="pp-idc-stage">
        <Seg<Side> value={side} onChange={(v) => { setSide(v); setSel(null); }} options={[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]} />
        <Canvas
          dims={dims}
          els={els}
          sel={sel}
          bgFileId={bgId}
          data={preview.data?.data}
          qr={preview.data?.qrDataUrl}
          onSelect={setSel}
          onPatch={patchEl}
          onDelete={removeEl}
          onDropItem={(key, at) => {
            const item = ALL_PALETTE.find((p) => p.key === key);
            if (item) addEl(item, at);
          }}
        />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center', fontSize: 13 }}>
          <label htmlFor="idc-emp" className="faint">Preview as</label>
          <select id="idc-emp" className="input" style={{ width: 200 }} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {!employeeId && <option value="">First queued joiner</option>}
            {(emps.data?.employees ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="faint" style={{ fontSize: 12, textAlign: 'center', maxWidth: 420 }}>
          CR80 · {dims.w} × {dims.h} mm · drag to move, corner to resize (1 mm snap) · arrow keys nudge, Delete removes. The QR opens the public verification page once the card is generated.
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-ghost btn-sm" disabled={!dirty} onClick={() => { setDraft(toDraft(tpl)); setSel(null); }}>Discard changes</button>
          <button className="btn btn-secondary btn-sm" disabled={!employeeId} onClick={() => setPreviewing(true)} title={dirty ? 'Shows the published version' : undefined}>Preview print</button>
          {!tpl.isDefault && <button className="btn btn-secondary btn-sm" disabled={makeDefault.isPending} onClick={() => makeDefault.mutate(undefined)}>Set as default</button>}
          <button className="btn btn-primary btn-sm" disabled={!dirty || publish.isPending} onClick={() => publish.mutate(draft)}>{publish.isPending ? 'Publishing…' : 'Publish template'}</button>
        </div>
      </div>

      {/* Right: properties */}
      <div className="stack" style={{ gap: 10 }}>
        <div className="pp-idc-kick">Properties · {selected ? (selected.label ?? selected.type.toLowerCase()) : 'Card'}</div>
        {selected ? (
          <ElementProps el={selected} cardW={dims.w} cardH={dims.h} onPatch={(p) => patchEl(selected.id, p)} onFont={(p) => patchFont(selected.id, p)} onLayer={(d) => layer(selected.id, d)} onDelete={() => removeEl(selected.id)} />
        ) : (
          <div className="field">
            <label htmlFor="idc-name">Template name</label>
            <input id="idc-name" className="input" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <span className="field-hint">{draft.orientation === 'PORTRAIT' ? 'Portrait' : 'Landscape'} · select an element on the card to edit it</span>
          </div>
        )}
        <div className="field">
          <label>Background · {side}</label>
          {bgId ? (
            <div className="stack" style={{ gap: 6 }}>
              <img src={fileUrl(bgId)} alt="" style={{ width: '100%', height: 60, objectFit: 'cover', border: '1px solid var(--color-divider)', borderRadius: 4 }} />
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDraft({ ...draft, [side === 'front' ? 'frontBgFileId' : 'backBgFileId']: null })}>Remove background</button>
            </div>
          ) : (
            <label className="pp-idc-upload">
              <input type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} disabled={bgBusy} onChange={(e) => { void uploadBg(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              {bgBusy ? 'Uploading…' : 'Upload image'}
            </label>
          )}
        </div>
        <div className="field">
          <label htmlFor="idc-vendor">Print vendor</label>
          <input id="idc-vendor" className="input" type="email" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="print@vendor.in" />
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            {settings && vendor.trim() !== settings.printVendorEmail && (
              <button className="btn btn-secondary btn-sm" disabled={saveVendor.isPending || !/^\S+@\S+\.\S+$/.test(vendor.trim())} onClick={() => saveVendor.mutate(undefined)}>Save</button>
            )}
            <button className="btn btn-ghost btn-sm" disabled={!settings} onClick={() => setEditingSettings(true)}>Card settings</button>
          </div>
        </div>
      </div>

      {switchTo && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          body={`Your changes to ${tpl.name} have not been published.`}
          confirmLabel="Discard & switch"
          danger
          onConfirm={() => {
            const t = tpls.data!.find((x) => x.id === switchTo)!;
            setTplId(t.id);
            setDraft(toDraft(t));
            setSel(null);
            setSwitchTo(null);
          }}
          onClose={() => setSwitchTo(null)}
        />
      )}
      {creating && (
        <NewTemplateModal
          current={draft}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setTplId(t.id);
            setDraft(toDraft(t));
            setSel(null);
            setCreating(false);
          }}
        />
      )}
      {previewing && employeeId && <PrintPreviewModal templateId={tpl.id} employeeId={employeeId} name={preview.data?.name ?? ''} onClose={() => setPreviewing(false)} />}
      {editingSettings && settings && <SettingsModal settings={settings} onClose={() => setEditingSettings(false)} />}
    </div>
  );
}

function PaletteButton({ item, onAdd }: { item: PaletteItem; onAdd: () => void }) {
  return (
    <button
      type="button"
      className="pp-idc-el"
      draggable
      title="Drag onto the card, or click to add"
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', `idc:${item.key}`);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onAdd}
    >
      {item.label}
    </button>
  );
}

// ── Canvas ────────────────────────────────────────────────────────────────

type DragState = { id: string; mode: 'move' | 'resize'; x0: number; y0: number; orig: IdCardElement; moved: boolean };

function Canvas({
  dims,
  els,
  sel,
  bgFileId,
  data,
  qr,
  onSelect,
  onPatch,
  onDelete,
  onDropItem,
}: {
  dims: { w: number; h: number };
  els: IdCardElement[];
  sel: string | null;
  bgFileId: string | null;
  data: IdCardPreviewData | undefined;
  qr: string | undefined;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, p: Partial<IdCardElement>) => void;
  onDelete: (id: string) => void;
  onDropItem: (key: string, at: { x: number; y: number }) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [avail, setAvail] = useState(420);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setAvail(entries[0]?.contentRect.width ?? 420));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // True-to-scale px per mm (≈ the wireframe's 236 × 370 portrait card), shrinking on narrow screens.
  const scale = Math.max(2.4, Math.min(4.4, (avail - 4) / dims.w));
  const W = dims.w * scale;
  const H = dims.h * scale;

  const down = (e: RPointerEvent<HTMLElement>, el: IdCardElement, mode: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(el.id);
    card.current?.focus({ preventScroll: true });
    try {
      card.current?.setPointerCapture(e.pointerId);
    } catch {
      /* older browsers */
    }
    drag.current = { id: el.id, mode, x0: e.clientX, y0: e.clientY, orig: el, moved: false };
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // 1 mm snap: the delta moves in whole millimetres so fine seeded offsets are kept.
    const dx = Math.round((e.clientX - d.x0) / scale);
    const dy = Math.round((e.clientY - d.y0) / scale);
    if (!dx && !dy && !d.moved) return;
    d.moved = true;
    if (d.mode === 'move') {
      onPatch(d.id, { xMm: round1(clamp(d.orig.xMm + dx, -2, dims.w - 1)), yMm: round1(clamp(d.orig.yMm + dy, -2, dims.h - 1)) });
    } else {
      const square = d.orig.type === 'QR';
      const w = round1(clamp(d.orig.wMm + dx, 0.2, dims.w + 2));
      const h = square ? w : round1(clamp(d.orig.hMm + dy, 0.2, dims.h + 2));
      onPatch(d.id, { wMm: w, hMm: h });
    }
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    try {
      card.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!sel) return;
    const el = els.find((x) => x.id === sel);
    if (!el) return;
    const step = e.shiftKey ? 5 : 1;
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete(el.id);
    } else if (nudge[e.key]) {
      e.preventDefault();
      const [dx, dy] = nudge[e.key]!;
      onPatch(el.id, { xMm: round1(clamp(el.xMm + dx, -2, dims.w - 1)), yMm: round1(clamp(el.yMm + dy, -2, dims.h - 1)) });
    } else if (e.key === 'Escape') onSelect(null);
  };
  const drop = (e: DragEvent<HTMLDivElement>) => {
    const k = e.dataTransfer.getData('text/plain');
    if (!k.startsWith('idc:') || !card.current) return;
    e.preventDefault();
    const r = card.current.getBoundingClientRect();
    onDropItem(k.slice(4), { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale });
  };

  const sorted = [...els].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  return (
    <div ref={wrap} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <div
        ref={card}
        className="pp-idc-card"
        tabIndex={0}
        role="application"
        aria-label="ID card canvas"
        style={{ width: W, height: H, borderRadius: 2.5 * scale, backgroundImage: bgFileId ? `url("${fileUrl(bgFileId)}")` : undefined }}
        onPointerDown={() => onSelect(null)}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={drop}
      >
        {sorted.map((el) => (
          <div
            key={el.id}
            className={`pp-idc-node${el.id === sel ? ' sel' : ''}`}
            style={{ left: el.xMm * scale, top: el.yMm * scale, width: el.wMm * scale, height: el.hMm * scale, zIndex: (el.z ?? 0) + 2 }}
            onPointerDown={(e) => down(e, el, 'move')}
            title={el.label ?? undefined}
          >
            <NodeBody el={el} data={data} qr={qr} scale={scale} />
            {el.id === sel && <span className="pp-idc-handle" onPointerDown={(e) => down(e, el, 'resize')} aria-label="Resize" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function NodeBody({ el, data, qr, scale }: { el: IdCardElement; data: IdCardPreviewData | undefined; qr: string | undefined; scale: number }) {
  if (el.type === 'SHAPE') return <div style={{ width: '100%', height: '100%', background: el.fill ?? '#b68235' }} />;
  if (el.type === 'PHOTO') {
    const id = data?.['employee.photo'];
    return id ? <img src={fileUrl(id)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <div className="pp-idc-ph">Photo</div>;
  }
  if (el.type === 'QR') return qr ? <img src={qr} alt="QR" draggable={false} style={{ width: '100%', height: '100%', display: 'block' }} /> : <div className="pp-idc-ph">QR</div>;
  if (el.type === 'LOGO' && data?.['tenant.logo']) return <img src={fileUrl(data['tenant.logo'])} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />;
  const f = { ...font(10), ...(el.font ?? {}) };
  const { text, placeholder } = elementText(el, data);
  const lines = text.split('\n');
  const sizePt = Math.min(...lines.map((l) => fitFontSize(l, f.size, el.wMm)));
  const style: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: el.type === 'SIGNATURE' ? 'flex-start' : 'center',
    alignItems: f.align === 'left' ? 'flex-start' : f.align === 'right' ? 'flex-end' : 'center',
    textAlign: f.align,
    fontFamily: FAMILY[f.family],
    fontWeight: f.weight,
    fontSize: sizePt * PT_TO_MM * scale,
    lineHeight: 1.25,
    color: placeholder ? '#9a9696' : f.color,
    fontStyle: placeholder ? 'italic' : undefined,
    whiteSpace: 'pre',
    borderTop: el.type === 'SIGNATURE' ? '1px solid #d7d3d3' : undefined,
    paddingTop: el.type === 'SIGNATURE' ? scale * 0.6 : undefined,
  };
  return <div style={style}>{text}</div>;
}

// ── Properties panel ──────────────────────────────────────────────────────

function ElementProps({ el, cardW, cardH, onPatch, onFont, onLayer, onDelete }: { el: IdCardElement; cardW: number; cardH: number; onPatch: (p: Partial<IdCardElement>) => void; onFont: (p: Partial<Font>) => void; onLayer: (d: 1 | -1) => void; onDelete: () => void }) {
  const f = { ...font(10), ...(el.font ?? {}) };
  const isText = ['TEXT', 'STATIC', 'SIGNATURE', 'LOGO'].includes(el.type);
  const num = (k: 'xMm' | 'yMm' | 'wMm' | 'hMm', label: string, max: number) => (
    <div className="field" style={{ gap: 2 }}>
      <label htmlFor={`idc-${k}`} style={{ fontSize: 11 }}>{label}</label>
      <input id={`idc-${k}`} className="input" type="number" step={0.5} min={k === 'wMm' || k === 'hMm' ? 0.2 : -5} max={max} value={el[k]} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onPatch({ [k]: round1(clamp(v, k === 'wMm' || k === 'hMm' ? 0.2 : -5, max)) }); }} />
    </div>
  );
  return (
    <>
      {el.type !== 'SHAPE' && el.type !== 'STATIC' && el.type !== 'SIGNATURE' && (
        <div className="field">
          <label htmlFor="idc-binding">Data field</label>
          <select id="idc-binding" className="input" value={el.binding ?? ''} onChange={(e) => onPatch({ binding: (e.target.value || null) as IdCardBinding | null })}>
            {bindingOptions(el.type).map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          {el.binding && <span className="field-hint">{IDCARD_BINDING_LABELS[el.binding]}</span>}
        </div>
      )}
      {(el.type === 'TEXT' || el.type === 'STATIC' || el.type === 'SIGNATURE') && (
        <div className="field">
          <label htmlFor="idc-text">{el.type === 'TEXT' ? 'Prefix text' : 'Text'}</label>
          {el.type === 'STATIC' ? (
            <textarea id="idc-text" className="input" rows={2} maxLength={200} value={el.text ?? ''} onChange={(e) => onPatch({ text: e.target.value })} />
          ) : (
            <input id="idc-text" className="input" maxLength={200} value={el.text ?? ''} placeholder={el.type === 'TEXT' ? 'e.g. Emergency: ' : undefined} onChange={(e) => onPatch({ text: e.target.value })} />
          )}
        </div>
      )}
      {isText && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="idc-size">Font size</label>
              <input id="idc-size" className="input" type="number" min={4} max={40} step={0.5} value={f.size} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onFont({ size: clamp(v, 4, 40) }); }} />
            </div>
            <div className="field" style={{ width: 70 }}>
              <label htmlFor="idc-color">Colour</label>
              <input id="idc-color" className="input" type="color" value={f.color} style={{ padding: 2, height: 36 }} onChange={(e) => onFont({ color: e.target.value })} />
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <select className="input" aria-label="Font" value={f.family} onChange={(e) => onFont({ family: e.target.value as Font['family'] })}>
              <option value="serif">Serif (heading)</option>
              <option value="sans">Sans (body)</option>
            </select>
            <select className="input" aria-label="Weight" value={f.weight} onChange={(e) => onFont({ weight: e.target.value as Font['weight'] })}>
              <option value="normal">Regular</option>
              <option value="bold">Bold</option>
            </select>
          </div>
          <Seg<Font['align']> value={f.align} onChange={(v) => onFont({ align: v })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} />
        </>
      )}
      {el.type === 'SHAPE' && (
        <div className="field">
          <label htmlFor="idc-fill">Fill</label>
          <input id="idc-fill" className="input" type="color" value={el.fill ?? '#b68235'} style={{ padding: 2, height: 36 }} onChange={(e) => onPatch({ fill: e.target.value })} />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {num('xMm', 'X (mm)', 100)}
        {num('yMm', 'Y (mm)', 100)}
        {num('wMm', 'Width (mm)', Math.min(100, cardW + 2))}
        {num('hMm', 'Height (mm)', Math.min(100, cardH + 2))}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => onPatch({ xMm: round1((cardW - el.wMm) / 2) })}>Centre</button>
        <button className="btn btn-ghost btn-sm" onClick={() => onLayer(1)}>Forward</button>
        <button className="btn btn-ghost btn-sm" onClick={() => onLayer(-1)}>Back</button>
        <button className="btn btn-ghost btn-sm" onClick={onDelete}>Delete</button>
      </div>
    </>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────

function NewTemplateModal({ current, onClose, onCreated }: { current: Draft; onClose: () => void; onCreated: (t: IdCardTemplateDto) => void }) {
  const create = useAction((b: IdCardTemplateInput) => peopleApi.createIdTemplate(b), { success: (r) => `${r.name} created`, invalidate: INVALIDATE, onSuccess: onCreated });
  const fields: FieldDef[] = [
    { name: 'name', label: 'Template name', type: 'text', span: 2, required: true, placeholder: 'Intern portrait' },
    { name: 'orientation', label: 'Orientation', type: 'select', required: true, options: [{ value: 'PORTRAIT', label: 'Portrait' }, { value: 'LANDSCAPE', label: 'Landscape' }] },
    { name: 'start', label: 'Start from', type: 'select', required: true, options: [{ value: 'copy', label: `Copy of ${current.name}` }, { value: 'blank', label: 'Blank card' }] },
  ];
  return (
    <FormModal
      title="New ID card template"
      fields={fields}
      initial={{ orientation: current.orientation, start: 'copy' }}
      submitLabel="Create template"
      onClose={onClose}
      onSubmit={async (v) => {
        const orientation = v.orientation as Draft['orientation'];
        const from = DIMS[current.orientation];
        const to = DIMS[orientation];
        const sx = to.w / from.w;
        const sy = to.h / from.h;
        const conv = (list: IdCardElement[]) =>
          v.start === 'blank'
            ? []
            : list.map((e) => {
                if (orientation === current.orientation) return { ...e };
                const w = round1(e.wMm * sx);
                const h = round1(e.hMm * sy);
                const sq = e.type === 'QR' || e.type === 'PHOTO' ? Math.min(w, h) : null;
                return { ...e, xMm: round1(e.xMm * sx), yMm: round1(e.yMm * sy), wMm: sq && e.type === 'QR' ? sq : w, hMm: sq && e.type === 'QR' ? sq : h };
              });
        await create.mutateAsync({ name: String(v.name), orientation, front: conv(current.front), back: conv(current.back), frontBgFileId: v.start === 'blank' ? null : current.frontBgFileId, backBgFileId: v.start === 'blank' ? null : current.backBgFileId });
      }}
    />
  );
}

function PrintPreviewModal({ templateId, employeeId, name, onClose }: { templateId: string; employeeId: string; name: string; onClose: () => void }) {
  const [stamp] = useState(() => Date.now());
  const src = (side: Side) => authUrl(`/id-cards/templates/${templateId}/preview/${side}?employeeId=${encodeURIComponent(employeeId)}&t=${stamp}`);
  return (
    <Modal title={`Print preview${name ? ` · ${name}` : ''}`} wide onClose={onClose} actions={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      <div className="dialog-body stack" style={{ gap: 10 }}>
        <div className="faint" style={{ fontSize: 12.5 }}>Rendered by the server at 300 DPI from the published template — exactly what the print PDF contains.</div>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
          {(['front', 'back'] as Side[]).map((s) => (
            <figure key={s} style={{ margin: 0, textAlign: 'center' }}>
              <img src={src(s)} alt={`${s} side`} style={{ maxWidth: 300, maxHeight: 360, border: '1px solid var(--color-divider)', borderRadius: 8, background: '#fff' }} />
              <figcaption className="faint" style={{ fontSize: 12, marginTop: 4 }}>{s === 'front' ? 'Front' : 'Back'}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function SettingsModal({ settings, onClose }: { settings: IdCardSettings; onClose: () => void }) {
  const save = useAction((b: IdCardSettings) => peopleApi.saveIdSettings(b), { success: 'Card settings saved', invalidate: INVALIDATE });
  const fields: FieldDef[] = [
    { name: 'printVendorName', label: 'Print vendor name', type: 'text', placeholder: 'Shree Prints' },
    { name: 'printVendorEmail', label: 'Print vendor email', type: 'email', required: true },
    { name: 'returnAddress', label: 'Return address (card back)', type: 'text', span: 2 },
    { name: 'emergencyLine', label: 'Emergency line (card back)', type: 'text', span: 2, placeholder: '+91 79 4000 1234' },
    { name: 'autoGenerate', label: 'Generate automatically when a joiner’s photo and details are complete', type: 'checkbox', span: 2 },
    { name: 'requireBloodGroup', label: 'Blood group is required on the card', type: 'checkbox', span: 2 },
  ];
  return (
    <FormModal
      title="ID card settings"
      fields={fields}
      initial={settings}
      submitLabel="Save settings"
      onClose={onClose}
      onSubmit={(v) =>
        save.mutateAsync({
          printVendorEmail: String(v.printVendorEmail).trim(),
          printVendorName: v.printVendorName || null,
          returnAddress: v.returnAddress || null,
          emergencyLine: v.emergencyLine || null,
          autoGenerate: !!v.autoGenerate,
          requireBloodGroup: !!v.requireBloodGroup,
        })
      }
    />
  );
}

// ── Cards register ────────────────────────────────────────────────────────

type CardFilter = 'all' | 'QUEUED' | 'READY' | 'SENT_TO_PRINT' | 'ISSUED' | 'REVOKED';

function CardsTab() {
  const [filter, setFilter] = useState<CardFilter>('all');
  const [q, setQ] = useState('');
  const [previewing, setPreviewing] = useState<IdCardRow | null>(null);
  const [reasonFor, setReasonFor] = useState<{ row: IdCardRow; kind: 'revoke' | 'reissue' } | null>(null);
  const [reason, setReason] = useState('');
  const list = useQuery({ queryKey: K.list(filter, q), queryFn: () => peopleApi.idCards(filter === 'all' ? undefined : filter, q || undefined), placeholderData: (p) => p });
  const regen = useAction((id: string) => peopleApi.generateCards({ cardIds: [id] }), { success: (r) => (r.generated ? 'ID card generated (front & back)' : `Not generated · ${r.skipped.join('; ')}`), invalidate: INVALIDATE });
  const issue = useAction((id: string) => peopleApi.issueCard(id), { success: 'Marked as issued · employee notified', invalidate: INVALIDATE });
  const act = useAction(
    (x: { row: IdCardRow; kind: 'revoke' | 'reissue'; reason: string }) => (x.kind === 'revoke' ? peopleApi.revokeCard(x.row.id, x.reason) : peopleApi.reissueCard(x.row.employeeId, x.reason)),
    { success: (_r, x) => (x.kind === 'revoke' ? `${x.row.employee}’s card revoked · QR now shows Revoked` : `New card queued for ${x.row.employee}`), invalidate: INVALIDATE, onSuccess: () => setReasonFor(null) },
  );
  const { toastError } = useToast();

  const columns: Column<IdCardRow>[] = [
    { key: 'e', header: 'Employee', render: (r) => r.employee },
    { key: 'c', header: 'Emp ID', render: (r) => <span className="tnum">{r.empCode}</span> },
    { key: 't', header: 'Template', render: (r) => r.template ?? <span className="faint">Default</span> },
    { key: 's', header: 'Status', render: (r) => <Tag tone={STATUS_TONE[r.status] ?? 'neutral'} title={r.serial}>{r.statusLabel}</Tag> },
    { key: 'g', header: 'Generated', render: (r) => (r.generatedAt ? formatDate(r.generatedAt) : <span className="faint">—</span>) },
    { key: 'b', header: 'Print batch', render: (r) => r.printBatch ?? <span className="faint">—</span> },
    {
      key: 'a',
      header: '',
      render: (r) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPreviewing(r)}>Preview</button>
          <button className="btn btn-ghost btn-sm" onClick={() => download(`/id-cards/${r.id}/pdf`).catch(toastError)}>PDF</button>
          {(r.status === 'QUEUED' || r.status === 'READY') && (
            <button className="btn btn-ghost btn-sm" disabled={regen.isPending} onClick={() => regen.mutate(r.id)}>{r.status === 'READY' ? 'Regenerate' : 'Generate'}</button>
          )}
          {['READY', 'SENT_TO_PRINT', 'PRINTED'].includes(r.status) && <button className="btn btn-secondary btn-sm" disabled={issue.isPending} onClick={() => issue.mutate(r.id)}>Mark issued</button>}
          {['READY', 'SENT_TO_PRINT', 'PRINTED', 'ISSUED'].includes(r.status) && <button className="btn btn-ghost btn-sm" onClick={() => { setReason(''); setReasonFor({ row: r, kind: 'revoke' }); }}>Revoke</button>}
          {['ISSUED', 'REVOKED', 'PRINTED'].includes(r.status) && <button className="btn btn-ghost btn-sm" onClick={() => { setReason(''); setReasonFor({ row: r, kind: 'reissue' }); }}>Reissue</button>}
        </span>
      ),
    },
  ];

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Pills<CardFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'QUEUED', label: 'Queued' },
            { value: 'READY', label: 'Ready' },
            { value: 'SENT_TO_PRINT', label: 'Sent to print' },
            { value: 'ISSUED', label: 'Issued' },
            { value: 'REVOKED', label: 'Revoked' },
          ]}
        />
        <input className="input pp-search" placeholder="Search name or Emp ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cards" />
      </div>
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={columns} rows={list.data} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={setPreviewing} empty="No ID cards in this view. A card is queued for every employee you add." />
      )}
      {previewing && (
        <Modal title={`${previewing.employee} · ${previewing.serial}`} wide onClose={() => setPreviewing(null)} actions={<><button className="btn btn-secondary" onClick={() => download(`/id-cards/${previewing.id}/pdf`).catch(toastError)}>Download PDF</button><button className="btn btn-primary" onClick={() => setPreviewing(null)}>Close</button></>}>
          <div className="dialog-body stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <Tag tone={STATUS_TONE[previewing.status] ?? 'neutral'}>{previewing.statusLabel}</Tag>
              {previewing.generatedAt && <span className="faint" style={{ fontSize: 12.5 }}>Generated {formatDate(previewing.generatedAt)}</span>}
            </div>
            <div className="row" style={{ gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
              {(['front', 'back'] as Side[]).map((s) => (
                <figure key={s} style={{ margin: 0, textAlign: 'center' }}>
                  <img src={authUrl(`/id-cards/${previewing.id}/png/${s}`)} alt={`${s} side`} style={{ maxWidth: 280, maxHeight: 340, border: '1px solid var(--color-divider)', borderRadius: 8, background: '#fff' }} />
                  <figcaption className="faint" style={{ fontSize: 12, marginTop: 4 }}>{s === 'front' ? 'Front' : 'Back'}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </Modal>
      )}
      {reasonFor && (
        <Modal
          title={reasonFor.kind === 'revoke' ? `Revoke ${reasonFor.row.employee}’s card` : `Reissue a card for ${reasonFor.row.employee}`}
          onClose={() => setReasonFor(null)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setReasonFor(null)}>Cancel</button>
              <button className={`btn ${reasonFor.kind === 'revoke' ? 'btn-danger' : 'btn-primary'}`} disabled={reason.trim().length < 2 || act.isPending} onClick={() => act.mutate({ ...reasonFor, reason: reason.trim() })}>
                {reasonFor.kind === 'revoke' ? 'Revoke card' : 'Queue new card'}
              </button>
            </>
          }
        >
          <div className="dialog-body stack" style={{ gap: 8 }}>
            <div className="faint" style={{ fontSize: 13 }}>{reasonFor.kind === 'revoke' ? 'Scanning the QR will show “Revoked”.' : 'The current card is marked replaced and a new card with a new serial is queued.'}</div>
            <div className="field">
              <label htmlFor="idc-reason">Reason</label>
              <input id="idc-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonFor.kind === 'revoke' ? 'Card lost' : 'Damaged card'} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Print batches ─────────────────────────────────────────────────────────

function BatchesTab({ rows, loading, error, retry }: { rows: PrintBatchRow[] | undefined; loading: boolean; error: unknown; retry: () => void }) {
  const mark = useAction((x: { id: string; status: 'acknowledged' | 'delivered' }) => peopleApi.batchStatus(x.id, x.status), {
    success: (_r, x) => (x.status === 'delivered' ? 'Batch delivered · cards marked printed' : 'Batch acknowledged by vendor'),
    invalidate: INVALIDATE,
  });
  const columns: Column<PrintBatchRow>[] = [
    { key: 'c', header: 'Batch', render: (r) => <span className="tnum">{r.code}</span> },
    { key: 's', header: 'Sent', render: (r) => (r.sentAt ? `${formatDate(r.sentAt)}, ${formatTime(r.sentAt)}` : '—') },
    { key: 'n', header: 'Cards', num: true, render: (r) => r.cards },
    { key: 'v', header: 'Vendor', render: (r) => r.vendor },
    { key: 'st', header: 'Status', render: (r) => <Tag tone={r.status === 'DELIVERED' ? 'accent' : r.status === 'FAILED' ? 'danger' : 'outline'}>{BATCH_LABEL[r.status] ?? r.status}</Tag> },
    {
      key: 'a',
      header: '',
      render: (r) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          <a className="btn btn-ghost btn-sm" href={fileUrl(r.pdfFileId)} target="_blank" rel="noopener noreferrer">PDF</a>
          {r.status === 'SENT' && <button className="btn btn-ghost btn-sm" disabled={mark.isPending} onClick={() => mark.mutate({ id: r.id, status: 'acknowledged' })}>Mark acknowledged</button>}
          {(r.status === 'SENT' || r.status === 'ACKNOWLEDGED') && <button className="btn btn-secondary btn-sm" disabled={mark.isPending} onClick={() => mark.mutate({ id: r.id, status: 'delivered' })}>Mark delivered</button>}
        </span>
      ),
    },
  ];
  if (error) return <ErrorBlock error={error} retry={retry} />;
  return <DataTable columns={columns} rows={rows} loading={loading} rowKey={(r) => r.id} empty="No print batches yet. Generate cards, then send them to the print vendor." />;
}
