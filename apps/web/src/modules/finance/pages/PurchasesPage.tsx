import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  FIN_GST_STATES,
  finDeriveSupplyType,
  finEstimateInputGst,
  finMonthLabel,
  finSplitInputGst,
  formatDate,
  formatDayMonth,
  formatINR,
  formatINRKpi,
  type BillExtraction,
  type FinVendorRow,
  type PurchaseCategoryRow,
  type PurchaseRow,
} from '@lexisora/shared';
import { ErrorBlock, Kpis, Loading, Modal, PageHeader, Tabs, Tag } from '@/components/ui';
import { DataTable, Pager, type Column } from '@/components/table';
import { FileDrop, FormModal, type FieldDef } from '@/components/form';
import { fileUrl, uploadFile } from '@/lib/api';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { FIN_ALL, finApi, finKeys, monthKeyNow, paiseToRupeesText, rupeesToPaise, todayKey } from '../api';
import { Badge, DocFrame, errorText, Field, fieldErrors, inr2, MonthSelect, ReasonDialog, Section, useFallbackMonth, useParamState, useReportEmpty } from '../components';
import '../finance.css';

type Tab = 'purchases' | 'gstr3b' | 'vendors';
const PAGE_SIZE = 25;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const stateOf = (gstin: string | null | undefined) => (gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null);

/** Purchases & input GST (GEN.purchases): KPIs, bills, GSTR-3B summary and vendor / category masters. */
export default function PurchasesPage() {
  const [tab, setTab] = useState<Tab>('purchases');
  const [openId, setOpenId] = useParamState('open');
  const [record, setRecord] = useState(false);
  return (
    <div data-screen-label="Purchases & input GST" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Purchases & input GST"
        sub="Company purchases with Input GST captured automatically from uploaded invoices."
        actions={<button className="btn btn-primary" onClick={() => setRecord(true)}>Record purchase</button>}
      />
      <Tabs<Tab>
        tabs={[
          { value: 'purchases', label: 'Purchases' },
          { value: 'gstr3b', label: 'GSTR-3B summary' },
          { value: 'vendors', label: 'Vendors & categories' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'purchases' && <PurchasesTab onOpen={setOpenId} />}
      {tab === 'gstr3b' && <Gstr3bTab />}
      {tab === 'vendors' && <MastersTab />}
      {record && <RecordPurchaseForm onClose={() => setRecord(false)} onSaved={(id) => setOpenId(id)} />}
      {openId && !record && <PurchaseDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ── Purchases list ───────────────────────────────────────────────────────────

function PurchasesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [month, setMonth, reportEmpty] = useFallbackMonth();
  const [categoryId, setCategoryId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [itc, setItc] = useState<'all' | 'eligible' | 'ineligible'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<PurchaseRow | null>(null);
  const kpiMonth = month || monthKeyNow();
  const kpis = useQuery({ queryKey: finKeys.purchaseKpis(kpiMonth), queryFn: () => finApi.purchaseKpis(kpiMonth) });
  const opts = useQuery({ queryKey: finKeys.purchaseOptions, queryFn: finApi.purchaseOptions });
  const query = { month: month || undefined, categoryId: categoryId || undefined, vendorId: vendorId || undefined, itc, q: q.trim() || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: finKeys.purchases(query), queryFn: () => finApi.purchases(query), placeholderData: keepPreviousData });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  const k = kpis.data;
  useReportEmpty(reportEmpty, k ? k.bills === 0 : undefined);
  const short = finMonthLabel(kpiMonth).slice(0, 3);

  const columns: Column<PurchaseRow>[] = [
    { key: 'date', header: 'Date', render: (r) => formatDayMonth(r.billDate) },
    { key: 'vendor', header: 'Vendor', render: (r) => <span className={r.status === 'CANCELLED' ? 'fin-strike' : undefined}>{r.vendorName}</span> },
    { key: 'no', header: 'Invoice no.', render: (r) => r.vendorInvoiceNo },
    { key: 'cat', header: 'Category', render: (r) => r.category },
    { key: 'amount', header: 'Amount', num: true, render: (r) => formatINR(r.amountPaise) },
    {
      key: 'gst',
      header: 'Input GST',
      num: true,
      render: (r) => (
        <span title={r.igstPaise ? `IGST ${inr2(r.igstPaise)}` : `CGST ${inr2(r.cgstPaise)} + SGST ${inr2(r.sgstPaise)}`}>
          {formatINR(r.inputGstPaise)}
          {r.gstSource === 'ESTIMATED' && <Badge title="Estimated as amount × 18/118 — no GST amount was found on the bill">est.</Badge>}
          {!r.itcEligible && <Badge low title="Input tax credit is not claimable (blocked category or no vendor GSTIN)">no ITC</Badge>}
        </span>
      ),
    },
    {
      key: 'bill',
      header: 'Bill',
      render: (r) =>
        r.billFileId ? (
          <button
            className="tag tag-neutral"
            style={{ cursor: 'pointer', font: 'inherit', fontSize: 11 }}
            onClick={(e) => {
              e.stopPropagation();
              setPreview(r);
            }}
          >
            PDF
          </button>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <div className="fin-toolbar">
        <MonthSelect value={month} onChange={reset(setMonth)} allowAll label="Month" />
        <select className="input" aria-label="Category" value={categoryId} onChange={(e) => reset(setCategoryId)(e.target.value)}>
          <option value="">All categories</option>
          {opts.data?.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className="input" aria-label="Vendor" value={vendorId} onChange={(e) => reset(setVendorId)(e.target.value)}>
          <option value="">All vendors</option>
          {opts.data?.vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
        <select className="input" aria-label="Input tax credit" value={itc} onChange={(e) => reset(setItc)(e.target.value as typeof itc)}>
          <option value="all">ITC: all</option>
          <option value="eligible">ITC eligible</option>
          <option value="ineligible">ITC not claimable</option>
        </select>
        <input className="input grow" aria-label="Search purchases" placeholder="Search vendor or invoice no." value={q} onChange={(e) => reset(setQ)(e.target.value)} />
      </div>
      {k && (
        <Kpis
          items={[
            { label: `Purchases (${short})`, value: formatINRKpi(k.purchasesPaise), sub: `${k.bills} ${k.bills === 1 ? 'bill' : 'bills'}` },
            { label: 'Input GST claimable', value: formatINRKpi(k.itcClaimablePaise), sub: 'for GSTR-3B' },
          ]}
        />
      )}
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={columns} rows={list.data?.items} rowKey={(r) => r.id} onRowClick={(r) => onOpen(r.id)} loading={list.isLoading} empty="No purchases match these filters. Record a purchase by uploading the bill." />
      )}
      {list.data && <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      {preview && (
        <Modal wide title={`${preview.vendorName} · ${preview.vendorInvoiceNo}`} onClose={() => setPreview(null)} actions={<button className="btn btn-secondary" onClick={() => setPreview(null)}>Close</button>}>
          <DocFrame src={fileUrl(preview.billFileId) ?? ''} title="Bill" />
        </Modal>
      )}
    </>
  );
}

// ── Purchase detail ──────────────────────────────────────────────────────────

function PurchaseDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: finKeys.purchase(id), queryFn: () => finApi.purchase(id) });
  const p = q.data;
  const [cancelling, setCancelling] = useState(false);
  const cancel = useAction((reason: string) => finApi.cancelPurchase(id, reason), { success: 'Purchase cancelled · voucher reversed', invalidate: FIN_ALL });
  return (
    <>
      <Modal wide title={p ? `${p.vendorName} · ${p.vendorInvoiceNo}` : 'Purchase'} onClose={onClose} actions={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
        {!p ? (
          q.error ? <ErrorBlock error={q.error} retry={() => void q.refetch()} /> : <Loading />
        ) : (
          <div className="fin-split" data-screen-label="Purchase detail">
            <div>{p.billFileId ? <DocFrame src={fileUrl(p.billFileId) ?? ''} title="Bill" /> : <div className="placeholder-media">No bill attached</div>}</div>
            <div className="stack" style={{ gap: 14 }}>
              <div className="row">
                <Tag tone={p.status === 'CANCELLED' ? 'neutral' : 'accent'}>{p.status === 'CANCELLED' ? 'Cancelled' : 'Recorded'}</Tag>
                <Tag tone={p.itcEligible ? 'outline' : 'danger'}>{p.itcEligible ? `ITC in GSTR-3B ${finMonthLabel(p.itcPeriod)}` : 'ITC not claimable'}</Tag>
              </div>
              <div className="fin-kv">
                <span>Vendor</span>
                <span>
                  {p.vendorName}
                  <div className="fin-muted fin-small">{p.vendorGstin ? `GSTIN ${p.vendorGstin}` : 'Unregistered (no GSTIN)'}</div>
                </span>
                <span>Bill date</span>
                <span>{formatDate(p.billDate)} · FY {p.fy}</span>
                <span>Category</span>
                <span>{p.category}</span>
                <span>Amount (incl. GST)</span>
                <span className="tnum">{inr2(p.amountPaise)}</span>
                <span>Taxable value</span>
                <span className="tnum">{inr2(p.taxablePaise)}</span>
                <span>Input GST</span>
                <span className="tnum">
                  {inr2(p.inputGstPaise)} · {p.supplyType === 'INTRA' ? `CGST ${inr2(p.cgstPaise)} + SGST ${inr2(p.sgstPaise)}` : `IGST ${inr2(p.igstPaise)}`}
                </span>
                <span>GST captured</span>
                <span>{p.gstSource === 'OCR' ? `From the bill${p.ocrConfidence !== null ? ` (${Math.round(p.ocrConfidence * 100)}% confidence)` : ''}` : p.gstSource === 'MANUAL' ? 'Entered manually' : 'Estimated (amount × 18/118)'}</span>
                <span>Paid via</span>
                <span>{p.paidVia === 'UNPAID' ? 'Unpaid — payable to vendor' : p.paidVia === 'CASH' ? 'Cash' : 'Bank'}</span>
                {p.voucherNumber && (
                  <>
                    <span>Ledger</span>
                    <span>
                      <button className="fin-link" onClick={() => navigate(`/ledger?voucher=${p.voucherId}`)}>{p.voucherNumber}</button>
                      {p.filingDocumentId && (
                        <>
                          {' · '}
                          <button className="fin-link" onClick={() => navigate(`/filing?q=${encodeURIComponent(p.vendorInvoiceNo)}`)}>Filing cabinet</button>
                        </>
                      )}
                    </span>
                  </>
                )}
                {p.notes && (
                  <>
                    <span>Notes</span>
                    <span>{p.notes}</span>
                  </>
                )}
              </div>
              {p.status !== 'CANCELLED' && (
                <div className="fin-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setCancelling(true)}>Cancel purchase</button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
      {p && cancelling && (
        <ReasonDialog
          title={`Cancel ${p.vendorName} ${p.vendorInvoiceNo}?`}
          body="The purchase voucher is reversed in the ledger and the input GST drops out of GSTR-3B."
          confirmLabel="Cancel purchase"
          danger
          onConfirm={(reason) => cancel.mutateAsync(reason)}
          onClose={() => setCancelling(false)}
        />
      )}
    </>
  );
}

// ── Record purchase (FORMS.purchase) ─────────────────────────────────────────

function RecordPurchaseForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const opts = useQuery({ queryKey: finKeys.purchaseOptions, queryFn: finApi.purchaseOptions });
  const o = opts.data;
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [ex, setEx] = useState<BillExtraction | null>(null);
  const [fromBill, setFromBill] = useState<Set<string>>(new Set());
  const [vendorName, setVendorName] = useState('');
  const [vendorGstin, setVendorGstin] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [billDate, setBillDate] = useState(todayKey());
  const [amount, setAmount] = useState('');
  const [gst, setGst] = useState('');
  const [gstSource, setGstSource] = useState<'OCR' | 'ESTIMATED' | 'MANUAL'>('ESTIMATED');
  const [categoryId, setCategoryId] = useState('');
  const [paidVia, setPaidVia] = useState<'BANK' | 'CASH' | 'UNPAID'>('BANK');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cat = o?.categories.find((c) => c.id === categoryId) ?? o?.categories[0];
  const amountPaise = rupeesToPaise(amount);
  const estimated = Number.isFinite(amountPaise) && amountPaise > 0 ? finEstimateInputGst(amountPaise, cat?.defaultGstRateBp ?? 1800) : 0;
  const gstPaise = gstSource === 'ESTIMATED' ? estimated : rupeesToPaise(gst);
  const knownVendor = o?.vendors.find((v) => v.name.toLowerCase() === vendorName.trim().toLowerCase());
  const gstinValue = vendorGstin.trim().toUpperCase() || knownVendor?.gstin || '';
  const vendorState = knownVendor?.stateCode || stateOf(gstinValue);
  const supply = finDeriveSupplyType(o?.tenantStateCode, vendorState);
  const split = finSplitInputGst(Number.isFinite(gstPaise) ? gstPaise : 0, supply);
  const itcOk = !!cat?.itcEligibleDefault && !!gstinValue;
  const lowConfidence = !!ex && ex.textFound && ex.confidence < 0.8 && fromBill.size > 0;
  const low = (k: string) => lowConfidence && fromBill.has(k);
  const fromBadge = (k: string) => (fromBill.has(k) ? <Badge low={lowConfidence}>from bill{ex ? ` ${Math.round(ex.confidence * 100)}%` : ''}</Badge> : null);

  async function onFile(f: File | null) {
    setFile(f);
    setFileId(null);
    setEx(null);
    setFromBill(new Set());
    setConfirmed(false);
    setFormError(null);
    if (!f) return;
    setReading(true);
    try {
      const up = await uploadFile(f, 'bill');
      setFileId(up.id);
      const r = await finApi.extractBill(up.id, cat?.id ?? null);
      setEx(r);
      const filled = new Set<string>();
      if (r.vendorName) {
        setVendorName(r.vendorName);
        filled.add('vendor');
      }
      if (r.vendorGstin) {
        setVendorGstin(r.vendorGstin);
        filled.add('gstin');
      }
      if (r.invoiceNo) {
        setInvoiceNo(r.invoiceNo);
        filled.add('invoiceNo');
      }
      if (r.billDate) {
        setBillDate(r.billDate);
        filled.add('billDate');
      }
      if (r.amountPaise) {
        setAmount(paiseToRupeesText(r.amountPaise));
        filled.add('amount');
      }
      if (r.source === 'OCR' && r.inputGstPaise !== null) {
        setGst(paiseToRupeesText(r.inputGstPaise));
        setGstSource('OCR');
        filled.add('gst');
      } else setGstSource('ESTIMATED');
      setFromBill(filled);
    } catch (e) {
      setFormError(errorText(e));
    } finally {
      setReading(false);
    }
  }

  async function submit() {
    const errs: Record<string, string> = {};
    if (!fileId) errs.billFileId = file ? 'The bill is still uploading' : 'Upload the bill';
    if (vendorName.trim().length < 2) errs.vendorName = 'Vendor is required';
    if (vendorGstin.trim() && !GSTIN_RE.test(vendorGstin.trim().toUpperCase())) errs.vendorGstin = 'Enter a valid 15-character GSTIN';
    if (!invoiceNo.trim()) errs.vendorInvoiceNo = 'Invoice no. is required';
    if (!billDate) errs.billDate = 'Bill date is required';
    else if (billDate > todayKey()) errs.billDate = 'Bill date cannot be in the future';
    if (!(amountPaise > 0)) errs.amountPaise = 'Amount must be more than zero';
    if (gstSource !== 'ESTIMATED' && !(gstPaise >= 0)) errs.inputGstPaise = 'Enter the GST amount';
    if (!cat) errs.categoryId = 'Category is required';
    if (lowConfidence && !confirmed) errs.confirm = 'Check the highlighted values and confirm';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const r = await finApi.createPurchase({
        vendorName: vendorName.trim(),
        vendorGstin: vendorGstin.trim().toUpperCase() || null,
        vendorInvoiceNo: invoiceNo.trim(),
        billDate,
        amountPaise,
        inputGstPaise: gstSource === 'ESTIMATED' ? null : gstPaise,
        gstSource,
        ocrConfidence: ex?.textFound ? ex.confidence : null,
        categoryId: cat!.id,
        billFileId: fileId!,
        paidVia,
        notes: notes.trim() || null,
      });
      void qc.invalidateQueries({ queryKey: finKeys.all });
      toast(`Saved · input GST ${formatINR(r.inputGstPaise)} captured`);
      onSaved(r.id);
      onClose();
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title="Record purchase"
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || reading || !o} onClick={() => void submit()}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      {!o ? (
        opts.error ? <ErrorBlock error={opts.error} retry={() => void opts.refetch()} /> : <Loading />
      ) : (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field span2 label="Bill" error={errors.billFileId} hint={reading ? 'Reading the bill…' : ex ? (ex.textFound ? `Read from the bill · ${Math.round(ex.confidence * 100)}% of fields found` : 'No text layer found (scanned bill) — GST is estimated as amount × 18/118') : 'Upload the PDF first — vendor, invoice no., amount and GST are read from it'}>
            <FileDrop file={file} onFile={(f) => void onFile(f)} accept="application/pdf,image/png,image/jpeg,image/webp" label="Drop the bill (PDF or photo) or browse" />
          </Field>
          {ex?.duplicateOf && <div className="fin-warn span-2">Possible duplicate: {ex.vendorName} bill {ex.duplicateOf.vendorInvoiceNo} is already recorded this financial year.</div>}
          <Field label="Vendor" htmlFor="pur-vendor" error={errors.vendorName} badge={fromBadge('vendor')} low={low('vendor')}>
            <input id="pur-vendor" className="input" list="pur-vendors" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Pick or type a new vendor" />
            <datalist id="pur-vendors">
              {o.vendors.map((v) => (
                <option key={v.id} value={v.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Invoice no." htmlFor="pur-no" error={errors.vendorInvoiceNo} badge={fromBadge('invoiceNo')} low={low('invoiceNo')}>
            <input id="pur-no" className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </Field>
          <Field label="Amount (incl. GST)" htmlFor="pur-amt" error={errors.amountPaise} badge={fromBadge('amount')} low={low('amount')}>
            <input id="pur-amt" className="input" inputMode="decimal" placeholder="₹" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field
            label="Input GST (auto)"
            htmlFor="pur-gst"
            error={errors.inputGstPaise}
            badge={gstSource === 'ESTIMATED' ? <Badge title="amount × rate / (100 + rate)">estimated</Badge> : gstSource === 'OCR' ? fromBadge('gst') : <Badge>edited</Badge>}
            low={low('gst')}
            hint={
              gstSource !== 'ESTIMATED' ? (
                <button type="button" className="fin-link" onClick={() => setGstSource('ESTIMATED')}>Use estimate ({formatINR(estimated, { decimals: true })})</button>
              ) : (
                `${(cat?.defaultGstRateBp ?? 1800) / 100}% GST included in the amount`
              )
            }
          >
            <input
              id="pur-gst"
              className="input"
              inputMode="decimal"
              value={gstSource === 'ESTIMATED' ? (estimated ? paiseToRupeesText(estimated) : '') : gst}
              onChange={(e) => {
                setGst(e.target.value);
                setGstSource('MANUAL');
              }}
            />
          </Field>
          <Field label="Category" htmlFor="pur-cat" error={errors.categoryId}>
            <select id="pur-cat" className="input" value={cat?.id ?? ''} onChange={(e) => setCategoryId(e.target.value)}>
              {o.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Bill date" htmlFor="pur-date" error={errors.billDate} badge={fromBadge('billDate')} low={low('billDate')}>
            <input id="pur-date" type="date" className="input" max={todayKey()} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </Field>
          <Field label="Vendor GSTIN" htmlFor="pur-gstin" error={errors.vendorGstin} badge={fromBadge('gstin')} low={low('gstin')} hint={knownVendor?.gstin && !vendorGstin ? `From vendor master: ${knownVendor.gstin}` : undefined}>
            <input id="pur-gstin" className="input" value={vendorGstin} onChange={(e) => setVendorGstin(e.target.value.toUpperCase())} placeholder="Optional — needed to claim ITC" maxLength={15} />
          </Field>
          <Field label="Paid via" htmlFor="pur-paid">
            <select id="pur-paid" className="input" value={paidVia} onChange={(e) => setPaidVia(e.target.value as typeof paidVia)}>
              <option value="BANK">Bank</option>
              <option value="CASH">Cash</option>
              <option value="UNPAID">Unpaid (payable to vendor)</option>
            </select>
          </Field>
          <div className="fin-preview span-2">
            <span>Taxable value</span>
            <span>{inr2(Math.max(0, (amountPaise || 0) - (gstPaise || 0)))}</span>
            {supply === 'INTRA' ? (
              <>
                <span>CGST · SGST</span>
                <span>{inr2(split.cgstPaise)} · {inr2(split.sgstPaise)}</span>
              </>
            ) : (
              <>
                <span>IGST</span>
                <span>{inr2(split.igstPaise)}</span>
              </>
            )}
            <span>Input tax credit</span>
            <span>{itcOk ? `Claimable in GSTR-3B ${finMonthLabel((billDate || todayKey()).slice(0, 7))}` : !cat?.itcEligibleDefault ? 'Blocked for this category (Sec 17(5))' : 'Not claimable without the vendor GSTIN'}</span>
          </div>
          <Field span2 label="Notes" htmlFor="pur-notes">
            <input id="pur-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — shown as the voucher narration" />
          </Field>
          {lowConfidence && (
            <div className="span-2">
              <label className="radio">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span className="dot" style={{ borderRadius: 3 }} />
                I've checked the highlighted values read from the bill
              </label>
              {errors.confirm && <div className="field-error">{errors.confirm}</div>}
            </div>
          )}
          <button type="submit" hidden />
        </form>
      )}
      {formError && <div className="field-error" role="alert">{formError}</div>}
    </Modal>
  );
}

// ── GSTR-3B summary ──────────────────────────────────────────────────────────

function Gstr3bTab() {
  const [month, setMonth, reportEmpty] = useFallbackMonth();
  const q = useQuery({ queryKey: finKeys.gstr3b(month), queryFn: () => finApi.gstr3b(month) });
  const csv = useAction(() => finApi.gstr3bCsv(month), {});
  const file = useAction(() => finApi.fileGstr3b(month), { success: (r) => `Saved to Filing cabinet › GST returns · ${r.title}`, invalidate: FIN_ALL });
  const s = q.data;
  useReportEmpty(reportEmpty, s ? s.outward.invoices === 0 && s.itc.bills === 0 : undefined);
  const r = (p: number) => inr2(p);
  return (
    <div className="stack" style={{ gap: 14 }} data-screen-label="GSTR-3B summary">
      <div className="fin-toolbar">
        <MonthSelect value={month} onChange={setMonth} label="Return period" />
        <span className="spacer" />
        <button className="btn btn-secondary" onClick={() => csv.mutate(undefined)}>Download CSV</button>
        <button className="btn btn-primary" disabled={file.isPending} onClick={() => file.mutate(undefined)}>{file.isPending ? 'Saving…' : 'Save to Filing cabinet'}</button>
      </div>
      {!s ? (
        q.error ? <ErrorBlock error={q.error} retry={() => void q.refetch()} /> : <Loading />
      ) : (
        <>
          <Kpis
            items={[
              { label: 'Output tax', value: formatINRKpi(s.outward.igstPaise + s.outward.cgstPaise + s.outward.sgstPaise), sub: `${s.outward.invoices} invoices${s.outward.creditNotes ? ` · ${s.outward.creditNotes} credit notes` : ''}` },
              { label: 'Input tax credit', value: formatINRKpi(s.itc.totalPaise), sub: `${s.itc.bills} bills` },
              { label: 'Net GST payable', value: formatINRKpi(s.payable.totalPaise), sub: `in cash · ${s.monthLabel}` },
            ]}
          />
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Description</th>
                  <th className="num">Taxable value</th>
                  <th className="num">IGST</th>
                  <th className="num">CGST</th>
                  <th className="num">SGST</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>3.1(a)</td>
                  <td>Outward taxable supplies</td>
                  <td className="num">{r(s.outward.taxablePaise)}</td>
                  <td className="num">{r(s.outward.igstPaise)}</td>
                  <td className="num">{r(s.outward.cgstPaise)}</td>
                  <td className="num">{r(s.outward.sgstPaise)}</td>
                </tr>
                <tr>
                  <td>4(A)(5)</td>
                  <td>All other ITC</td>
                  <td className="num">—</td>
                  <td className="num">{r(s.itc.igstPaise)}</td>
                  <td className="num">{r(s.itc.cgstPaise)}</td>
                  <td className="num">{r(s.itc.sgstPaise)}</td>
                </tr>
                <tr className="fin-dim">
                  <td>4(D)(2)</td>
                  <td>Ineligible ITC — Sec 17(5) (not claimed)</td>
                  <td className="num">—</td>
                  <td className="num" colSpan={3}>{r(s.ineligibleItcPaise)}</td>
                </tr>
                <tr>
                  <td>6.1</td>
                  <td><strong>Net tax payable in cash</strong></td>
                  <td className="num">—</td>
                  <td className="num"><strong>{r(s.payable.igstPaise)}</strong></td>
                  <td className="num"><strong>{r(s.payable.cgstPaise)}</strong></td>
                  <td className="num"><strong>{r(s.payable.sgstPaise)}</strong></td>
                </tr>
                <tr className="fin-dim">
                  <td>—</td>
                  <td>ITC carried forward</td>
                  <td className="num">—</td>
                  <td className="num">{r(s.carryForward.igstPaise)}</td>
                  <td className="num">{r(s.carryForward.cgstPaise)}</td>
                  <td className="num">{r(s.carryForward.sgstPaise)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <Section title="ITC utilisation">
            {s.utilisation.length ? (
              <div className="fin-timeline">
                {s.utilisation.map((u, i) => (
                  <div key={i}>
                    <span>{u.from} credit → {u.to}</span>
                    {inr2(u.amountPaise)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="fin-muted fin-small">No credit used this period.</div>
            )}
            <div className="fin-muted fin-small">Order: IGST credit → IGST, CGST, SGST; CGST credit → CGST, IGST; SGST credit → SGST, IGST. CGST and SGST credits never cross.</div>
          </Section>
        </>
      )}
    </div>
  );
}

// ── Masters: vendors & purchase categories ───────────────────────────────────

const STATE_OPTIONS = Object.entries(FIN_GST_STATES).map(([code, name]) => ({ value: code, label: `${code} · ${name}` }));
const RATE_OPTIONS = [0, 500, 1200, 1800, 2800].map((bp) => ({ value: String(bp), label: `${bp / 100}%` }));

function MastersTab() {
  const vendors = useQuery({ queryKey: finKeys.vendors, queryFn: finApi.vendors });
  const categories = useQuery({ queryKey: finKeys.categories, queryFn: finApi.categories });
  const accounts = useQuery({ queryKey: finKeys.accounts, queryFn: finApi.accounts });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [vendor, setVendor] = useState<FinVendorRow | 'new' | null>(null);
  const [category, setCategory] = useState<PurchaseCategoryRow | 'new' | null>(null);
  const ledgerOptions = useMemo(() => (accounts.data ?? []).filter((a) => !a.isGroup && a.isActive && (a.type === 'EXPENSE' || a.type === 'ASSET') && !a.partyType).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })), [accounts.data]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['finance', 'purchases'] });

  const vendorFields: FieldDef[] = [
    { name: 'name', label: 'Vendor name', type: 'text', required: true, span: 2 },
    { name: 'gstin', label: 'GSTIN', type: 'text', placeholder: '15 characters' },
    { name: 'pan', label: 'PAN', type: 'text', placeholder: 'Taken from the GSTIN if blank' },
    { name: 'stateCode', label: 'State', type: 'select', options: STATE_OPTIONS, placeholder: 'From GSTIN' },
    { name: 'email', label: 'Email', type: 'email' },
  ];
  const categoryFields: FieldDef[] = [
    { name: 'name', label: 'Category name', type: 'text', required: true },
    { name: 'accountId', label: 'Expense ledger', type: 'select', required: true, options: ledgerOptions },
    { name: 'defaultGstRateBp', label: 'Default GST rate', type: 'select', required: true, options: RATE_OPTIONS },
    { name: 'itcEligibleDefault', label: 'Input tax credit eligible', type: 'checkbox' },
    { name: 'createsAsset', label: 'Creates an asset record', type: 'checkbox' },
    ...(category && category !== 'new' ? [{ name: 'isActive', label: 'Active', type: 'checkbox' as const }] : []),
  ];
  const vCols: Column<FinVendorRow>[] = [
    { key: 'name', header: 'Vendor', render: (v) => v.name },
    { key: 'gstin', header: 'GSTIN', render: (v) => v.gstin ?? <span className="fin-muted">Unregistered</span> },
    { key: 'state', header: 'State', render: (v) => (v.stateCode ? FIN_GST_STATES[v.stateCode] ?? v.stateCode : '—') },
    { key: 'email', header: 'Email', render: (v) => v.email ?? '—' },
    { key: 'bills', header: 'Bills', num: true, render: (v) => v.bills },
    { key: 'spend', header: 'Spend', num: true, render: (v) => formatINR(v.spendPaise) },
  ];
  const cCols: Column<PurchaseCategoryRow>[] = [
    { key: 'name', header: 'Category', render: (c) => <span className={c.isActive ? undefined : 'fin-strike'}>{c.name}</span> },
    { key: 'ledger', header: 'Ledger', render: (c) => c.accountName },
    { key: 'rate', header: 'GST', num: true, render: (c) => `${c.defaultGstRateBp / 100}%` },
    { key: 'itc', header: 'ITC', render: (c) => (c.itcEligibleDefault ? <Tag tone="outline">Eligible</Tag> : <Tag tone="danger">Blocked</Tag>) },
    { key: 'asset', header: 'Asset', render: (c) => (c.createsAsset ? 'Yes' : '—') },
    { key: 'bills', header: 'Bills', num: true, render: (c) => c.bills },
  ];
  return (
    <div className="stack" style={{ gap: 22 }}>
      <Section title="Vendors" actions={<button className="btn btn-secondary btn-sm" onClick={() => setVendor('new')}>Add vendor</button>}>
        {vendors.error ? <ErrorBlock error={vendors.error} /> : <DataTable columns={vCols} rows={vendors.data} rowKey={(v) => v.id} onRowClick={setVendor} loading={vendors.isLoading} empty="No vendors yet — they are added when you record a purchase." />}
      </Section>
      <Section title="Purchase categories" actions={<button className="btn btn-secondary btn-sm" onClick={() => setCategory('new')}>Add category</button>}>
        {categories.error ? <ErrorBlock error={categories.error} /> : <DataTable columns={cCols} rows={categories.data} rowKey={(c) => c.id} onRowClick={setCategory} loading={categories.isLoading} />}
      </Section>
      {vendor && (
        <FormModal
          title={vendor === 'new' ? 'Add vendor' : `Edit ${vendor.name}`}
          fields={vendorFields}
          submitLabel="Save"
          initial={vendor === 'new' ? {} : { name: vendor.name, gstin: vendor.gstin ?? '', pan: vendor.pan ?? '', stateCode: vendor.stateCode ?? '', email: vendor.email ?? '' }}
          onSubmit={async (v) => {
            const body = { name: v.name, gstin: v.gstin ? String(v.gstin).toUpperCase() : null, pan: v.pan || null, stateCode: v.stateCode || null, email: v.email || null };
            if (vendor === 'new') await finApi.createVendor(body);
            else await finApi.updateVendor(vendor.id, body);
            refresh();
            toast('Saved');
          }}
          onClose={() => setVendor(null)}
        />
      )}
      {category && (
        <FormModal
          title={category === 'new' ? 'Add purchase category' : `Edit ${category.name}`}
          fields={categoryFields}
          submitLabel="Save"
          initial={
            category === 'new'
              ? { defaultGstRateBp: '1800', itcEligibleDefault: true, accountId: ledgerOptions[0]?.value }
              : { name: category.name, accountId: category.accountId, defaultGstRateBp: String(category.defaultGstRateBp), itcEligibleDefault: category.itcEligibleDefault, createsAsset: category.createsAsset, isActive: category.isActive }
          }
          onSubmit={async (v) => {
            const body = { name: v.name, accountId: v.accountId, defaultGstRateBp: Number(v.defaultGstRateBp), itcEligibleDefault: !!v.itcEligibleDefault, createsAsset: !!v.createsAsset, ...(category === 'new' ? {} : { isActive: !!v.isActive }) };
            if (category === 'new') await finApi.createCategory(body);
            else await finApi.updateCategory(category.id, body);
            refresh();
            toast('Saved');
          }}
          onClose={() => setCategory(null)}
        />
      )}
    </div>
  );
}
