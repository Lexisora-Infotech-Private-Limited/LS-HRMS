import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ONBOARDING_STEP_LABELS,
  TSHIRT_SIZES,
  formatDate,
  type OnboardingDto,
  type OnboardingListRow,
  type OnboardingStepDto,
  type OnboardingStepKey,
} from '@lexisora/shared';
import { authUrl, uploadFile } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { FileDrop } from '@/components/form';
import { DataTable, type Column } from '@/components/table';
import { ErrorBlock, Loading, Modal, PageHeader, Seg, Tabs, Tag } from '@/components/ui';
import { peopleApi, peopleKeys, type OnboardingDetail, type QueueRow } from '../api';
import { DocStatus, VerifyButtons, openDoc, statusTone } from '../components';
import '../people.css';

const COPY: Record<OnboardingStepKey, { title?: string; body: string; action: string; cta: string }> = {
  offer: { body: '', action: 'Sign offer letter', cta: 'Sign & continue' },
  nda: { body: '', action: 'Sign NDA', cta: 'Sign & continue' },
  docs: { title: 'Upload your documents', body: 'PAN, Aadhaar, education marksheets and previous employment letters. HR verifies each one.', action: 'Upload documents', cta: 'Upload & continue' },
  bank: { title: 'Bank and tax details', body: 'Salary account, IFSC and tax regime selection for payroll.', action: 'Bank details', cta: 'Save & continue' },
  kit: { title: 'Your welcome kit', body: 'T-shirt, mug, notebook and bag will be handed over on day one. Pick your T-shirt size.', action: 'Confirm size', cta: 'Finish onboarding' },
};
const OB_STATUS_LABEL: Record<string, string> = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted · HR verifying', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };

/** Paperless onboarding — joiner's 5 steps; HR sees all joiners + verification. */
export default function OnboardingPage() {
  const can = useCan();
  const me = useMe();
  const hr = can('onboarding.manage');
  const [sp] = useSearchParams();
  const [view, setView] = useState<'joiners' | 'mine'>(hr ? 'joiners' : 'mine');
  return (
    <div data-screen-label="Paperless onboarding" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Paperless onboarding"
        sub="New joiners sign, upload and receive their welcome kit here before day one."
        actions={hr && me.employeeId ? <Seg value={view} onChange={setView} options={[{ value: 'joiners', label: 'New joiners' }, { value: 'mine', label: 'My onboarding' }]} /> : undefined}
      />
      {view === 'joiners' && hr ? <HrOnboardings initialEmployee={sp.get('employee')} /> : <JoinerFlow />}
    </div>
  );
}

// ── Joiner ────────────────────────────────────────────────────────────────

function stepState(s: OnboardingStepDto, current: OnboardingStepKey | null) {
  if (s.status === 'NEEDS_ATTENTION') return 'Fix';
  if (s.status === 'DONE') return 'Done';
  if (s.status === 'SKIPPED') return 'Skipped';
  return s.key === current ? 'Now' : 'Next';
}

function JoinerFlow() {
  const q = useQuery({ queryKey: peopleKeys.onboardingMe, queryFn: peopleApi.myOnboarding });
  const [sel, setSel] = useState<OnboardingStepKey | null>(null);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  const ob = q.data;
  const readOnly = ob.status === 'SUBMITTED' || ob.status === 'COMPLETED' || ob.status === 'CANCELLED';
  const key: OnboardingStepKey = sel ?? ob.currentStep ?? 'kit';
  const step = ob.steps.find((s) => s.key === key)!;
  const next = (d: OnboardingDto) => setSel(d.currentStep ?? 'kit');
  return (
    <div className="stack" style={{ gap: 18 }}>
      {readOnly && (
        <div className="note" style={{ fontSize: 13 }}>
          {ob.status === 'COMPLETED'
            ? ob.id
              ? `Onboarding complete${ob.completedAt ? ` · ${formatDate(ob.completedAt)}` : ''}. HR has verified your documents and bank details.`
              : 'You joined before paperless onboarding went live. Here is a read-only summary; your documents are in My digital vault.'
            : ob.status === 'SUBMITTED'
              ? `Submitted${ob.submittedAt ? ` on ${formatDate(ob.submittedAt)}` : ''} · HR notified, ID card queued. HR is verifying your documents and bank details.`
              : 'This onboarding was cancelled.'}
        </div>
      )}
      <div className="pp-steps">
        {ob.steps.map((s) => (
          <button key={s.key} className={`pp-step${s.key === key ? ' on' : ''}${s.status === 'NEEDS_ATTENTION' ? ' attn' : ''}`} onClick={() => setSel(s.key)}>
            <span className="pp-step-k">Step {s.order} · {stepState(s, ob.currentStep)}</span>
            {s.label}
          </button>
        ))}
      </div>
      <div className="pp-ob">
        <DocPanel ob={ob} step={step} />
        <div className="pp-action">
          <h4 style={{ margin: 0 }}>{COPY[key].action}</h4>
          {step.note && step.status === 'NEEDS_ATTENTION' && <div className="note pp-err" style={{ fontSize: 12.5 }}>{step.note}</div>}
          {readOnly || step.status === 'DONE' || step.status === 'SKIPPED' ? (
            key === 'kit' && !readOnly && ob.status !== 'NOT_STARTED' ? <KitStep ob={ob} onDone={next} /> : <StepSummary ob={ob} step={step} />
          ) : key === 'offer' || key === 'nda' ? (
            <SignStep ob={ob} step={step} onDone={next} />
          ) : key === 'docs' ? (
            <DocsStep onDone={next} />
          ) : key === 'bank' ? (
            <BankStep ob={ob} onDone={next} />
          ) : (
            <KitStep ob={ob} onDone={next} />
          )}
        </div>
      </div>
    </div>
  );
}

function DocPanel({ ob, step }: { ob: OnboardingDto; step: OnboardingStepDto }) {
  const k = step.key;
  const title = k === 'offer' ? ob.offerDoc.title : k === 'nda' ? ob.ndaDoc.title : COPY[k].title!;
  const body = k === 'offer' ? ob.offerDoc.body : k === 'nda' ? ob.ndaDoc.body : COPY[k].body;
  const docs = k === 'docs' ? ob.documents.filter((d) => ['GOVERNMENT_ID', 'EDUCATION', 'EMPLOYMENT'].includes(d.category)) : [];
  return (
    <div className="pp-doc">
      <div className="pp-doc-title">{title}</div>
      <div className="pp-doc-body">{body}</div>
      {step.envelopeId ? (
        <>
          <iframe title={title} src={authUrl(`/esign/${step.envelopeId}/pdf`)} />
          <a className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} href={authUrl(`/esign/${step.envelopeId}/pdf`)} target="_blank" rel="noreferrer">Open full document</a>
        </>
      ) : docs.length ? (
        <div className="stack" style={{ gap: 0, marginTop: 6 }}>
          {docs.map((d) => (
            <div key={d.id} className="row-between" style={{ padding: '7px 0', borderBottom: '1px solid var(--color-divider)', fontSize: 13 }}>
              <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => openDoc(d.id)}>{d.title}</button>
              <DocStatus status={d.status} label={d.statusLabel} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="pp-doc-line" style={{ width: '92%' }} />
          <div className="pp-doc-line" style={{ width: '86%' }} />
          <div className="pp-doc-line" style={{ width: '90%' }} />
          <div className="pp-doc-line" style={{ width: '60%' }} />
        </>
      )}
    </div>
  );
}

function StepSummary({ ob, step }: { ob: OnboardingDto; step: OnboardingStepDto }) {
  const d = (step.data ?? {}) as Record<string, any>;
  const lines: string[] = [];
  if (step.status === 'SKIPPED') lines.push('Skipped by HR');
  if (step.key === 'offer' || step.key === 'nda') {
    lines.push(d.signedAt ? `Signed ${formatDate(d.signedAt)}` : step.note ?? 'Signed');
    if (d.signedSha256) lines.push(`Document fingerprint ${String(d.signedSha256).slice(0, 16)}…`);
  } else if (step.key === 'docs') {
    if (d.pan) lines.push(`PAN ${d.pan}`);
    if (d.aadhaarLast4) lines.push(`Aadhaar XXXX XXXX ${d.aadhaarLast4}`);
    lines.push('Each document shows its HR verification status on the left.');
  } else if (step.key === 'bank') {
    if (d.last4) lines.push(`Account XXXX${d.last4}${d.bank ? ` · ${d.bank}` : ''}`);
    if (d.ifsc) lines.push(`IFSC ${d.ifsc}`);
    lines.push(`Tax regime: ${d.taxRegime === 'OLD' ? 'Old' : 'New'}`);
    lines.push(ob.bankVerified ? 'Verified by HR' : 'Awaiting HR verification');
  } else if (step.key === 'kit') {
    if (d.tshirtSize) lines.push(`T-shirt size ${d.tshirtSize}`);
    lines.push(d.delivery === 'SHIPPED' ? 'Shipping to your address' : 'Handed over on day one');
  }
  const signedDoc = step.key === 'offer' || step.key === 'nda' ? ob.documents.find((x) => x.docType === (step.key === 'offer' ? 'OFFER_LETTER' : 'NDA')) : null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Tag tone="accent">{step.status === 'SKIPPED' ? 'Skipped' : 'Done'}{step.completedAt ? ` · ${formatDate(step.completedAt)}` : ''}</Tag>
      {lines.map((l) => <div key={l} style={{ fontSize: 13.5 }}>{l}</div>)}
      {signedDoc && <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => openDoc(signedDoc.id)}>Download signed copy</button>}
    </div>
  );
}

/** Draw-or-type signature → local e-sign (stamped into the PDF with name/time/IP). */
function SignStep({ ob, step, onDone }: { ob: OnboardingDto; step: OnboardingStepDto; onDone: (d: OnboardingDto) => void }) {
  const [mode, setMode] = useState<'DRAWN' | 'TYPED'>('DRAWN');
  const [typed, setTyped] = useState(ob.employeeName);
  const [font, setFont] = useState<'Times-Italic' | 'Helvetica-Oblique' | 'Courier-Oblique'>('Times-Italic');
  const [consent, setConsent] = useState(false);
  const [png, setPng] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const key = step.key as 'offer' | 'nda';
  const sign = useAction(
    () => peopleApi.sign(key, { signatureType: mode, drawnPng: mode === 'DRAWN' ? png : null, typedName: mode === 'TYPED' ? typed : null, typedFont: mode === 'TYPED' ? font : null, consent: true }),
    { success: key === 'offer' ? 'Offer letter signed' : 'NDA signed', invalidate: [peopleKeys.vault], onSuccess: (d) => onDone(d) },
  );
  const qc = useQueryClient();
  const decline = useAction(() => peopleApi.decline(reason), { success: 'Offer declined · HR notified', onSuccess: () => { setDeclining(false); void qc.invalidateQueries({ queryKey: peopleKeys.onboardingMe }); } });
  const ready = consent && (mode === 'DRAWN' ? !!png : typed.trim().length >= 2) && !!step.envelopeId;
  const fontCss = font === 'Times-Italic' ? 'italic 30px "Times New Roman", serif' : font === 'Helvetica-Oblique' ? 'oblique 28px Helvetica, Arial, sans-serif' : 'oblique 26px "Courier New", monospace';
  return (
    <>
      <Seg value={mode} onChange={setMode} options={[{ value: 'DRAWN', label: 'Draw' }, { value: 'TYPED', label: 'Type' }]} />
      {mode === 'DRAWN' ? (
        <SignaturePad onChange={setPng} />
      ) : (
        <>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full name" aria-label="Typed signature" />
          <div className="row" style={{ gap: 6 }}>
            {(['Times-Italic', 'Helvetica-Oblique', 'Courier-Oblique'] as const).map((f) => (
              <button key={f} className={`btn btn-sm ${font === f ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setFont(f)}>{f.split('-')[0]}</button>
            ))}
          </div>
          <div className="pp-typed" style={{ font: fontCss }}>{typed || 'Your signature'}</div>
        </>
      )}
      <label className="radio">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span className="dot" style={{ borderRadius: 3 }} />I have read and agree to this document
      </label>
      {!step.envelopeId && <div className="faint" style={{ fontSize: 12.5 }}>Your document is being prepared…</div>}
      <button className="btn btn-primary" disabled={!ready || sign.isPending} onClick={() => sign.mutate(undefined)}>{sign.isPending ? 'Signing…' : COPY[key].cta}</button>
      <div className="faint" style={{ fontSize: 11.5 }}>Your signature, name, time and IP address are stamped into the PDF with an audit trail.</div>
      {key === 'offer' && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDeclining(true)}>Decline offer</button>}
      {declining && (
        <Modal
          title="Decline the offer?"
          onClose={() => setDeclining(false)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setDeclining(false)}>Cancel</button>
              <button className="btn btn-danger" disabled={reason.trim().length < 2 || decline.isPending} onClick={() => decline.mutate(undefined)}>Decline offer</button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="decl">Reason (shared with HR)</label>
            <textarea id="decl" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </Modal>
      )}
    </>
  );
}

function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    const g = c.getContext('2d')!;
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#1b1b1b';
  }, []);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <canvas
        ref={ref}
        className="pp-sigpad"
        aria-label="Draw your signature"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const g = e.currentTarget.getContext('2d')!;
          const [x, y] = pos(e);
          g.beginPath();
          g.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const g = e.currentTarget.getContext('2d')!;
          const [x, y] = pos(e);
          g.lineTo(x, y);
          g.stroke();
          dirty.current = true;
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          if (dirty.current) onChange(e.currentTarget.toDataURL('image/png'));
        }}
      />
      <div className="row-between">
        <span className="faint" style={{ fontSize: 12 }}>Draw or type your signature</span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            const c = ref.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            dirty.current = false;
            onChange(null);
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function DocsStep({ onDone }: { onDone: (d: OnboardingDto) => void }) {
  const { toast, toastError } = useToast();
  const qc = useQueryClient();
  const [pan, setPan] = useState('');
  const [panFile, setPanFile] = useState<File | null>(null);
  const [aadhaar, setAadhaar] = useState('');
  const [aadhaarFile, setAadhaarFile] = useState<File | null>(null);
  const [marks, setMarks] = useState<(File | null)[]>([null]);
  const [prev, setPrev] = useState<File | null>(null);
  const [decl, setDecl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const markFiles = marks.filter((m): m is File => !!m);
  const ready = pan.trim() && panFile && aadhaar.trim() && aadhaarFile && markFiles.length && decl;
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const up = (f: File) => uploadFile(f, 'vault').then((r) => r.id);
      const [panFileId, aadhaarFileId, prevId, ...markIds] = await Promise.all([up(panFile!), up(aadhaarFile!), prev ? up(prev) : Promise.resolve(null), ...markFiles.map(up)]);
      const d = await peopleApi.submitDocs({ panNumber: pan.trim().toUpperCase(), panFileId, aadhaarNumber: aadhaar.replace(/\s+/g, ''), aadhaarFileId, marksheetFileIds: markIds as string[], prevEmploymentFileId: prevId, declaration: true });
      qc.setQueryData(peopleKeys.onboardingMe, d);
      void qc.invalidateQueries({ queryKey: peopleKeys.vault });
      toast('Documents uploaded · HR will verify them');
      onDone(d);
    } catch (e) {
      setErr((e as Error).message);
      toastError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="field"><label htmlFor="pan">PAN number</label><input id="pan" className="input" value={pan} maxLength={10} placeholder="ABCPE1234F" onChange={(e) => setPan(e.target.value.toUpperCase())} /></div>
      <FileDrop file={panFile} onFile={setPanFile} accept=".pdf,image/*" label="Drop PAN card or browse" />
      <div className="field"><label htmlFor="aad">Aadhaar number</label><input id="aad" className="input" value={aadhaar} maxLength={14} placeholder="1234 5678 9012" inputMode="numeric" onChange={(e) => setAadhaar(e.target.value)} /></div>
      <FileDrop file={aadhaarFile} onFile={setAadhaarFile} accept=".pdf,image/*" label="Drop Aadhaar card or browse" />
      <div className="field">
        <label>Education marksheets</label>
        <div className="stack" style={{ gap: 6 }}>
          {marks.map((m, i) => (
            <FileDrop key={i} file={m} onFile={(f) => setMarks((s) => s.map((x, j) => (j === i ? f : x)))} accept=".pdf,image/*" label="Drop marksheet or browse" />
          ))}
          {marks.length < 5 && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMarks((s) => [...s, null])}>+ Add another marksheet</button>}
        </div>
      </div>
      <div className="field"><label>Previous employment letter (optional)</label><FileDrop file={prev} onFile={setPrev} accept=".pdf,image/*" /></div>
      <label className="radio"><input type="checkbox" checked={decl} onChange={(e) => setDecl(e.target.checked)} /><span className="dot" style={{ borderRadius: 3 }} />I confirm these documents are genuine and belong to me</label>
      {err && <div className="field-error" role="alert">{err}</div>}
      <button className="btn btn-primary" disabled={!ready || busy} onClick={() => void submit()}>{busy ? 'Uploading…' : COPY.docs.cta}</button>
    </div>
  );
}

function BankStep({ ob, onDone }: { ob: OnboardingDto; onDone: (d: OnboardingDto) => void }) {
  const prev = (ob.steps.find((s) => s.key === 'bank')?.data ?? {}) as Record<string, any>;
  const [v, setV] = useState({ holderName: (prev.holderName as string) ?? ob.employeeName, accountNumber: '', confirmAccountNumber: '', ifsc: (prev.ifsc as string) ?? '', taxRegime: ((prev.taxRegime as string) ?? 'NEW') as 'NEW' | 'OLD', uan: '' });
  const [cheque, setCheque] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: k === 'ifsc' ? e.target.value.toUpperCase() : e.target.value }));
  const mismatch = v.confirmAccountNumber && v.accountNumber.replace(/\s/g, '') !== v.confirmAccountNumber.replace(/\s/g, '');
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const chequeFileId = cheque ? (await uploadFile(cheque, 'vault')).id : null;
      const d = await peopleApi.submitBank({ ...v, uan: v.uan || null, chequeFileId });
      qc.setQueryData(peopleKeys.onboardingMe, d);
      toast('Bank details saved');
      onDone(d);
    } catch (e) {
      setErr((e as Error).message);
      toastError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="field"><label htmlFor="bh">Account holder name</label><input id="bh" className="input" value={v.holderName} onChange={set('holderName')} /></div>
      <div className="form-grid">
        <div className="field"><label htmlFor="ba">Account no.</label><input id="ba" className="input" inputMode="numeric" autoComplete="off" value={v.accountNumber} onChange={set('accountNumber')} /></div>
        <div className="field"><label htmlFor="bc">Confirm account no.</label><input id="bc" className="input" inputMode="numeric" autoComplete="off" value={v.confirmAccountNumber} onChange={set('confirmAccountNumber')} aria-invalid={!!mismatch || undefined} />{mismatch && <div className="field-error">Account numbers don't match</div>}</div>
        <div className="field"><label htmlFor="bi">IFSC</label><input id="bi" className="input" maxLength={11} placeholder="HDFC0001234" value={v.ifsc} onChange={set('ifsc')} /></div>
        <div className="field"><label htmlFor="bu">UAN (optional)</label><input id="bu" className="input" inputMode="numeric" value={v.uan} onChange={set('uan')} /></div>
      </div>
      <div className="field">
        <label>Tax regime</label>
        <Seg value={v.taxRegime} onChange={(t) => setV((s) => ({ ...s, taxRegime: t }))} options={[{ value: 'NEW', label: 'New regime' }, { value: 'OLD', label: 'Old regime' }]} />
      </div>
      <div className="field"><label>Cancelled cheque (optional)</label><FileDrop file={cheque} onFile={setCheque} accept=".pdf,image/*" /></div>
      {err && <div className="field-error" role="alert">{err}</div>}
      <button className="btn btn-primary" disabled={busy || !v.holderName || !v.accountNumber || !v.confirmAccountNumber || !!mismatch || v.ifsc.length !== 11} onClick={() => void submit()}>{busy ? 'Saving…' : COPY.bank.cta}</button>
      <div className="faint" style={{ fontSize: 11.5 }}>Your account number is encrypted; HR and Payroll see only the last 4 digits.</div>
    </div>
  );
}

function KitStep({ ob, onDone }: { ob: OnboardingDto; onDone: (d: OnboardingDto) => void }) {
  const prev = (ob.steps.find((s) => s.key === 'kit')?.data ?? {}) as Record<string, any>;
  const [size, setSize] = useState<(typeof TSHIRT_SIZES)[number] | null>((prev.tshirtSize as never) ?? null);
  const [delivery, setDelivery] = useState<'HANDOVER' | 'SHIPPED'>((prev.delivery as never) ?? (ob.workMode === 'REMOTE' ? 'SHIPPED' : 'HANDOVER'));
  const [address, setAddress] = useState<string>((prev.address as string) ?? '');
  const qc = useQueryClient();
  const fin = useAction(() => peopleApi.finish({ tshirtSize: size!, delivery, address: delivery === 'SHIPPED' ? address : null }), {
    success: 'Onboarding complete · HR notified, ID card queued',
    invalidate: [peopleKeys.vault],
    onSuccess: (d) => {
      qc.setQueryData(peopleKeys.onboardingMe, d);
      onDone(d);
    },
  });
  const blocked = ob.incomplete.filter((k) => k !== 'kit');
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="pp-sizes" role="radiogroup" aria-label="T-shirt size">
        {TSHIRT_SIZES.map((s) => (
          <button key={s} role="radio" aria-checked={size === s} className={`btn ${size === s ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: 52 }} onClick={() => setSize(s)}>{s}</button>
        ))}
      </div>
      <Seg value={delivery} onChange={setDelivery} options={[{ value: 'HANDOVER', label: 'Hand over on day one' }, { value: 'SHIPPED', label: 'Ship to my address' }]} />
      {delivery === 'SHIPPED' && <textarea className="input" placeholder="Delivery address" value={address} onChange={(e) => setAddress(e.target.value)} />}
      {blocked.length > 0 && <div className="note" style={{ fontSize: 12.5 }}>Complete {blocked.map((k) => ONBOARDING_STEP_LABELS[k]).join(', ')} first.</div>}
      <button className="btn btn-primary" disabled={!size || blocked.length > 0 || fin.isPending || (delivery === 'SHIPPED' && address.trim().length < 5)} onClick={() => fin.mutate(undefined)}>{fin.isPending ? 'Finishing…' : COPY.kit.cta}</button>
    </div>
  );
}

// ── HR ────────────────────────────────────────────────────────────────────

type HrTab = 'all' | 'IN_PROGRESS' | 'SUBMITTED' | 'COMPLETED' | 'queue';

function HrOnboardings({ initialEmployee }: { initialEmployee: string | null }) {
  const [tab, setTab] = useState<HrTab>('all');
  const [open, setOpen] = useState<string | null>(initialEmployee);
  const list = useQuery({ queryKey: peopleKeys.onboardingList, queryFn: () => peopleApi.onboardings() });
  const queue = useQuery({ queryKey: peopleKeys.queue, queryFn: () => peopleApi.queue() });
  const rows = (list.data ?? []).filter((r) => tab === 'all' || tab === 'queue' || (tab === 'IN_PROGRESS' ? r.status === 'IN_PROGRESS' || r.status === 'NOT_STARTED' : r.status === tab));
  const count = (s: HrTab) => (list.data ?? []).filter((r) => (s === 'IN_PROGRESS' ? r.status === 'IN_PROGRESS' || r.status === 'NOT_STARTED' : r.status === s)).length;
  const cols: Column<OnboardingListRow>[] = [
    { key: 'n', header: 'Joiner', render: (r) => <div><div>{r.name}</div><div className="pp-sub">{r.empCode}</div></div> },
    { key: 'j', header: 'Joining', render: (r) => formatDate(r.joiningDate) },
    { key: 'p', header: 'Progress', render: (r) => <span className="tnum">{r.stepsDone} of 5 steps</span> },
    { key: 'd', header: 'Docs to verify', num: true, render: (r) => r.docsPending || '—' },
    { key: 'b', header: 'Bank', render: (r) => r.bank },
    { key: 's', header: 'Status', render: (r) => <Tag tone={statusTone(r.status)}>{r.statusLabel}</Tag> },
  ];
  const qcols: Column<QueueRow>[] = [
    { key: 'e', header: 'Employee', render: (r) => <div><div>{r.employee}</div><div className="pp-sub">{r.empCode}</div></div> },
    { key: 'd', header: 'Document', render: (r) => <div><div>{r.title}</div>{r.captured && <div className="pp-sub">Captured: {r.captured}</div>}</div> },
    { key: 'c', header: 'Category', render: (r) => r.categoryLabel },
    { key: 'u', header: 'Uploaded', render: (r) => formatDate(r.uploadedAt) },
    {
      key: 'a',
      header: '',
      render: (r) => (
        <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => openDoc(r.id)}>View</button>
          <VerifyButtons doc={r} invalidate={[peopleKeys.queue, peopleKeys.onboardingList, ['people', 'onboarding', 'detail']]} />
        </span>
      ),
    },
  ];
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Tabs<HrTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: `All · ${list.data?.length ?? 0}` },
          { value: 'IN_PROGRESS', label: `In progress · ${count('IN_PROGRESS')}` },
          { value: 'SUBMITTED', label: `Submitted · ${count('SUBMITTED')}` },
          { value: 'COMPLETED', label: `Completed · ${count('COMPLETED')}` },
          { value: 'queue', label: `Verification queue · ${queue.data?.length ?? 0}` },
        ]}
      />
      {tab === 'queue' ? (
        queue.error ? <ErrorBlock error={queue.error} /> : <DataTable columns={qcols} rows={queue.data} loading={queue.isLoading} rowKey={(r) => r.id} empty="Nothing waiting for verification." />
      ) : list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={cols} rows={list.data ? rows : undefined} loading={list.isLoading} rowKey={(r) => r.employeeId} onRowClick={(r) => setOpen(r.employeeId)} empty="No joiners here. Add an employee to send an onboarding invite." />
      )}
      {open && <HrDetail employeeId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function HrDetail({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: peopleKeys.onboardingDetail(employeeId), queryFn: () => peopleApi.onboardingDetail(employeeId) });
  const [reopening, setReopening] = useState<OnboardingStepKey | null>(null);
  const [overriding, setOverriding] = useState(false);
  const [rejectBank, setRejectBank] = useState(false);
  const [reason, setReason] = useState('');
  const inv = [peopleKeys.onboardingDetail(employeeId), peopleKeys.onboardingList, peopleKeys.queue];
  const reopen = useAction((k: OnboardingStepKey) => peopleApi.reopen(employeeId, k, reason), { success: 'Step reopened · joiner notified', invalidate: inv, onSuccess: () => { setReopening(null); setReason(''); } });
  const override = useAction(() => peopleApi.override(employeeId, reason), { success: 'Onboarding marked complete', invalidate: inv, onSuccess: () => { setOverriding(false); setReason(''); } });
  const bank = useAction((d: 'VERIFIED' | 'REJECTED') => peopleApi.verifyBank(employeeId, d, d === 'REJECTED' ? reason : null), {
    success: (_r, d) => (d === 'VERIFIED' ? 'Bank details verified' : 'Bank details rejected · joiner notified'),
    invalidate: inv,
    onSuccess: () => { setRejectBank(false); setReason(''); },
  });
  const ob: OnboardingDetail | undefined = q.data;
  const open = ob && ob.status !== 'COMPLETED' && ob.status !== 'CANCELLED' && !!ob.id;
  return (
    <Modal title={ob ? `${ob.employeeName} · ${ob.empCode}` : 'Onboarding'} wide onClose={onClose} actions={<><button className="btn btn-ghost" onClick={() => nav(`/employees/${employeeId}`)}>Open profile</button>{open && <button className="btn btn-secondary" onClick={() => setOverriding(true)}>Mark complete</button>}<button className="btn btn-primary" onClick={onClose}>Close</button></>}>
      {!ob ? (
        q.error ? <ErrorBlock error={q.error} /> : <Loading />
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 8 }}>
            <Tag tone={statusTone(ob.status)}>{OB_STATUS_LABEL[ob.status] ?? ob.status}</Tag>
            {ob.designation && <Tag tone="neutral">{ob.designation}</Tag>}
            {ob.joiningDate && <Tag tone="neutral">Joins {formatDate(ob.joiningDate)}</Tag>}
          </div>
          <div>
            <div className="kicker" style={{ marginBottom: 4 }}>Steps</div>
            {ob.steps.map((s) => (
              <div key={s.key} className="pp-check-row">
                <div>
                  {s.order}. {s.label}
                  {s.note && <div className="faint" style={{ fontSize: 12 }}>{s.note}</div>}
                </div>
                <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <Tag tone={s.status === 'DONE' ? 'accent' : s.status === 'NEEDS_ATTENTION' ? 'danger' : s.status === 'SKIPPED' ? 'neutral' : 'outline'}>{s.status === 'NEEDS_ATTENTION' ? 'Needs attention' : s.status === 'IN_PROGRESS' ? 'In progress' : s.status.charAt(0) + s.status.slice(1).toLowerCase()}</Tag>
                  {open && s.status === 'DONE' && <button className="btn btn-ghost btn-sm" onClick={() => setReopening(s.key)}>Reopen</button>}
                </span>
              </div>
            ))}
          </div>
          <div>
            <div className="kicker" style={{ marginBottom: 4 }}>Documents</div>
            {ob.documents.length === 0 ? (
              <div className="faint" style={{ fontSize: 13 }}>No documents yet.</div>
            ) : (
              ob.documents.map((d) => (
                <div key={d.id} className="pp-check-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                  <div>
                    <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => openDoc(d.id)}>{d.title}</button>
                    <span className="faint" style={{ fontSize: 12 }}> · {d.categoryLabel}</span>
                    {d.status === 'REJECTED' && d.rejectionReason && <div className="pp-err">{d.rejectionReason}</div>}
                  </div>
                  <span className="row" style={{ gap: 6 }}>
                    <DocStatus status={d.status} label={d.statusLabel} />
                    {d.status === 'PENDING' && <VerifyButtons doc={d} invalidate={inv} />}
                  </span>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="kicker" style={{ marginBottom: 4 }}>Bank & tax</div>
            <div className="pp-kv">
              <div>Account holder</div><div>{ob.bank.holder ?? '—'}</div>
              <div>Account</div><div>{ob.bank.account || '—'}{ob.bank.bank ? ` · ${ob.bank.bank}` : ''}</div>
              <div>IFSC</div><div>{ob.bank.ifsc ?? '—'}</div>
              <div>PAN</div><div>{ob.bank.pan || '—'}</div>
              <div>Tax regime</div><div>{ob.bank.taxRegime === 'OLD' ? 'Old regime' : 'New regime'}</div>
              <div>UAN</div><div>{ob.bank.uan ?? '—'}</div>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              {ob.bankVerified ? (
                <Tag tone="accent">Bank verified</Tag>
              ) : ob.bank.ifsc && open ? (
                <>
                  <button className="btn btn-secondary btn-sm" disabled={bank.isPending} onClick={() => bank.mutate('VERIFIED')}>Verify bank details</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setRejectBank(true)}>Reject</button>
                </>
              ) : (
                <span className="faint" style={{ fontSize: 12.5 }}>Not submitted yet</span>
              )}
            </div>
          </div>
        </div>
      )}
      {(reopening || overriding || rejectBank) && (
        <Modal
          title={reopening ? `Reopen “${ONBOARDING_STEP_LABELS[reopening]}”` : overriding ? 'Mark onboarding complete' : 'Reject bank details'}
          onClose={() => { setReopening(null); setOverriding(false); setRejectBank(false); }}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => { setReopening(null); setOverriding(false); setRejectBank(false); }}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={reason.trim().length < 2}
                onClick={() => (reopening ? reopen.mutate(reopening) : overriding ? override.mutate(undefined) : bank.mutate('REJECTED'))}
              >
                {reopening ? 'Reopen step' : overriding ? 'Mark complete' : 'Reject'}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="hr-reason">{overriding ? 'Reason (open steps are marked skipped; recorded in the audit log)' : 'Reason (emailed to the joiner)'}</label>
            <textarea id="hr-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </Modal>
      )}
    </Modal>
  );
}

