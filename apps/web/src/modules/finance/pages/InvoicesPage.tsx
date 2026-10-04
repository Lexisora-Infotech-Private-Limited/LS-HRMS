import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  finComputeInvoiceTax,
  finDeriveSupplyType,
  finGstLabel,
  finHoursLabel,
  finMonthLabel,
  finPlaceOfSupply,
  formatDate,
  formatINR,
  formatINRKpi,
  type FinInvoiceDetail,
  type FinInvoiceFormOptions,
  type FinInvoiceRow,
  type FinSupplyKind,
} from '@lexisora/shared';
import { ConfirmDialog, ErrorBlock, Kpis, Loading, Modal, PageHeader, Tabs, Tag } from '@/components/ui';
import { DataTable, Pager, type Column } from '@/components/table';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { FIN_ALL, finApi, finKeys, monthKeyNow, paiseToRupeesText, rupeesToPaise, todayKey } from '../api';
import { amt, ChipsInput, DocFrame, errorText, Field, fieldErrors, inr2, invoiceTone, ReasonDialog, Section, useParamState } from '../components';
import '../finance.css';

type Tab = 'all' | 'draft' | 'emailed' | 'paid' | 'overdue';
const TABS: Tab[] = ['all', 'draft', 'emailed', 'paid', 'overdue'];
const TAB_LABEL: Record<Tab, string> = { all: 'All', draft: 'Draft', emailed: 'Emailed', paid: 'Paid', overdue: 'Overdue' };
const EMPTY: Record<Tab, string> = {
  all: 'No invoices yet. Generate one from approved billable hours.',
  draft: 'No drafts.',
  emailed: 'No issued invoices are awaiting payment.',
  paid: 'No paid invoices yet.',
  overdue: 'Nothing overdue.',
};
const PAGE_SIZE = 20;

const gstSplit = (r: { supplyType: FinSupplyKind; cgstPaise: number; sgstPaise: number; igstPaise: number }) =>
  r.supplyType === 'INTRA' ? `CGST ${formatINR(r.cgstPaise, { decimals: true })} + SGST ${formatINR(r.sgstPaise, { decimals: true })}` : `IGST ${formatINR(r.igstPaise, { decimals: true })}`;

/** GST invoices (GEN.invoices): KPIs, status tabs, invoice list, generate form and invoice detail. */
export default function InvoicesPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useParamState('open');
  const [form, setForm] = useState<{ edit?: FinInvoiceDetail } | null>(null);
  const kpis = useQuery({ queryKey: finKeys.invoiceKpis, queryFn: finApi.invoiceKpis });
  const query = { tab, q: q.trim() || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: finKeys.invoices(query), queryFn: () => finApi.invoices(query), placeholderData: keepPreviousData });
  const counts = list.data?.counts;

  const columns: Column<FinInvoiceRow>[] = [
    { key: 'no', header: 'Invoice', render: (r) => <span className={r.number ? undefined : 'fin-muted'}>{r.label}</span> },
    {
      key: 'client',
      header: 'Client',
      render: (r) => (
        <div>
          <div>{r.clientName}</div>
          <div className="fin-muted fin-small">{[r.projectName, r.periodLabel].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    { key: 'hours', header: 'Billable hours', num: true, render: (r) => r.hours },
    { key: 'taxable', header: 'Taxable', num: true, render: (r) => formatINR(r.taxablePaise) },
    { key: 'gst', header: 'GST 18%', num: true, render: (r) => <span title={gstSplit(r)}>{formatINR(r.gstPaise)}</span> },
    { key: 'total', header: 'Total', num: true, render: (r) => formatINR(r.totalPaise) },
    { key: 'status', header: 'Status', render: (r) => <Tag tone={invoiceTone(r.displayStatus)} title={r.dueDate ? `Due ${formatDate(r.dueDate)}` : undefined}>{r.displayStatus}</Tag> },
  ];

  const k = kpis.data;
  return (
    <div data-screen-label="GST invoices" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="GST invoices"
        sub="Invoices generated from client billable hours with GST applied, emailed from here."
        actions={<button className="btn btn-primary" onClick={() => setForm({})}>Generate invoice</button>}
      />
      {k && (
        <Kpis
          items={[
            { label: 'Outstanding', value: formatINRKpi(k.outstandingPaise), sub: 'issued, awaiting payment' },
            { label: 'Overdue', value: formatINRKpi(k.overduePaise), sub: `${k.overdueCount} ${k.overdueCount === 1 ? 'invoice' : 'invoices'} past due` },
            { label: `Invoiced (${k.monthLabel.slice(0, 3)})`, value: formatINRKpi(k.invoicedMonthPaise), sub: `${k.invoicedMonthCount} ${k.invoicedMonthCount === 1 ? 'invoice' : 'invoices'} incl. GST` },
          ]}
        />
      )}
      <Tabs
        tabs={TABS.map((t) => ({ value: t, label: counts ? `${TAB_LABEL[t]} · ${counts[t]}` : TAB_LABEL[t] }))}
        value={tab}
        onChange={(t) => {
          setTab(t);
          setPage(1);
        }}
      />
      <div className="fin-toolbar">
        <input
          className="input grow"
          aria-label="Search invoices"
          placeholder="Search invoice no., client or project"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={columns} rows={list.data?.items} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} loading={list.isLoading} empty={EMPTY[tab]} />
      )}
      {list.data && <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      {form && <InvoiceForm edit={form.edit} onClose={() => setForm(null)} onSaved={(d) => setOpenId(d.id)} />}
      {openId && !form && (
        <InvoiceDetailModal
          id={openId}
          onClose={() => setOpenId(null)}
          onEdit={(d) => {
            setOpenId(null);
            setForm({ edit: d });
          }}
        />
      )}
    </div>
  );
}

// ── Generate / edit form (FORMS.invoice) ─────────────────────────────────────

type Client = FinInvoiceFormOptions['clients'][number];

function InvoiceForm({ edit, onClose, onSaved }: { edit?: FinInvoiceDetail; onClose: () => void; onSaved: (d: FinInvoiceDetail) => void }) {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const opts = useQuery({ queryKey: finKeys.invoiceOptions, queryFn: finApi.invoiceOptions });
  const o = opts.data;
  const [clientId, setClientId] = useState(edit?.clientId ?? '');
  const [projectId, setProjectId] = useState(edit?.projectId ?? '');
  const [period, setPeriod] = useState(edit?.period ?? monthKeyNow());
  const [hours, setHours] = useState(edit ? edit.hours : '');
  const [rate, setRate] = useState(edit ? paiseToRupeesText(edit.ratePaise) : '');
  const [touched, setTouched] = useState({ hours: !!edit, rate: !!edit });
  const [override, setOverride] = useState<FinSupplyKind | null>(edit?.taxOverrideReason ? edit.supplyType : null);
  const [overrideReason, setOverrideReason] = useState(edit?.taxOverrideReason ?? '');
  const [note, setNote] = useState(edit?.adjustmentNote ?? '');
  const [emailTo, setEmailTo] = useState<string[]>(edit?.emailTo ?? []);
  const [emailCc, setEmailCc] = useState<string[]>(edit?.emailCc ?? []);
  const [notes, setNotes] = useState(edit?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'issue_and_email' | null>(null);

  const projectsOf = (cid: string) => o?.projects.filter((p) => p.clientId === cid) ?? [];
  const pickClient = (c: Client | undefined) => {
    if (!c) return;
    setClientId(c.id);
    setProjectId(projectsOf(c.id)[0]?.id ?? '');
    setEmailTo(c.billingEmails);
    setTouched({ hours: false, rate: false });
    setOverride(null);
    setOverrideReason('');
  };
  // First open: default to the first client with a billable project.
  useEffect(() => {
    if (!o || clientId) return;
    pickClient(o.clients.find((c) => o.projects.some((p) => p.clientId === c.id)) ?? o.clients[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o]);

  const client = o?.clients.find((c) => c.id === clientId);
  const projects = projectsOf(clientId);
  const previewQuery = { clientId, projectId, period, ...(edit ? { excludeInvoiceId: edit.id } : {}) };
  const preview = useQuery({
    queryKey: finKeys.invoicePreview(previewQuery),
    queryFn: () => finApi.invoicePreview(previewQuery),
    enabled: !!clientId && !!projectId && !!period,
  });
  const pv = projectId ? preview.data : undefined;

  // Auto-fill hours and rate from approved, unbilled timesheet hours (until the user edits them).
  useEffect(() => {
    if (!pv) return;
    if (!touched.hours) setHours(pv.approvedHours);
    if (!touched.rate) setRate(paiseToRupeesText(pv.ratePaise));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pv]);
  useEffect(() => {
    if (projectId || !client) return;
    if (!touched.hours) setHours('');
    if (!touched.rate) setRate(paiseToRupeesText(client.defaultRatePaise ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, clientId, o]);

  const derived: FinSupplyKind = finDeriveSupplyType(o?.sellerStateCode, client?.stateCode);
  const supply = override ?? derived;
  const gstMode: 'AUTO' | 'INTRA' | 'INTER' = override && override !== derived ? override : 'AUTO';
  const minutes = Math.round((Number(hours) || 0) * 60);
  const ratePaise = rupeesToPaise(rate);
  const tax = finComputeInvoiceTax({ minutes, ratePaise: Number.isFinite(ratePaise) ? ratePaise : 0, supply });
  const approvedMinutes = pv?.approvedMinutes ?? 0;
  const adjusted = minutes !== approvedMinutes;

  async function submit(action: 'draft' | 'issue_and_email') {
    const errs: Record<string, string> = {};
    if (!clientId) errs.clientId = 'Client is required';
    if (!(minutes > 0)) errs.billableHours = 'Billable hours must be more than zero';
    if (!(ratePaise > 0)) errs.ratePaise = 'Rate must be more than zero';
    if (adjusted && !note.trim()) errs.adjustmentNote = `Approved hours are ${finHoursLabel(approvedMinutes)} — explain the difference`;
    if (gstMode !== 'AUTO' && !overrideReason.trim()) errs.overrideReason = 'A reason is required';
    if (action === 'issue_and_email' && !emailTo.length) errs.emailTo = 'Add at least one recipient';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(action);
    setFormError(null);
    const body = {
      clientId,
      projectId: projectId || null,
      period,
      billableHours: minutes / 60,
      ratePaise,
      gstMode,
      overrideReason: gstMode !== 'AUTO' ? overrideReason.trim() : null,
      adjustmentNote: adjusted ? note.trim() : null,
      emailTo,
      emailCc,
      notes: notes.trim() || null,
    };
    try {
      let d: FinInvoiceDetail;
      if (edit) {
        d = await finApi.updateInvoice(edit.id, body);
        if (action === 'issue_and_email') {
          d = await finApi.issueInvoice(edit.id);
          try {
            d = await finApi.emailInvoice(edit.id, { to: emailTo, cc: emailCc });
          } catch (e) {
            toastError(e);
          }
        }
      } else {
        d = await finApi.createInvoice({ ...body, action });
      }
      void qc.invalidateQueries({ queryKey: finKeys.all });
      if (action === 'draft') toast('Draft saved');
      else if (!d.emailedAt || d.lastEmailError) toast(`${d.label} issued · the email was not sent — resend it from the invoice`);
      else toast('Invoice emailed to client');
      onSaved(d);
      onClose();
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      wide
      title={edit ? 'Edit draft invoice' : 'Generate GST invoice'}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-secondary" disabled={!!busy || !o} onClick={() => void submit('draft')}>{busy === 'draft' ? 'Saving…' : 'Save draft'}</button>
          <button className="btn btn-primary" disabled={!!busy || !o} onClick={() => void submit('issue_and_email')}>{busy === 'issue_and_email' ? 'Generating…' : 'Generate & email'}</button>
        </>
      }
    >
      {!o ? (
        opts.error ? <ErrorBlock error={opts.error} retry={() => void opts.refetch()} /> : <Loading />
      ) : !o.clients.length ? (
        <div className="note">Add an active client in Clients before generating invoices.</div>
      ) : (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void submit('issue_and_email');
          }}
        >
          <Field label="Client" htmlFor="inv-client" error={errors.clientId}>
            <select id="inv-client" className="input" value={clientId} onChange={(e) => pickClient(o.clients.find((c) => c.id === e.target.value))} disabled={!!edit}>
              {o.clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Project" htmlFor="inv-project" error={errors.projectId}>
            <select
              id="inv-project"
              className="input"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setTouched({ hours: false, rate: false });
              }}
            >
              {!projects.length && <option value="">No billable project — enter hours manually</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.status !== 'ACTIVE' ? ` (${p.status.toLowerCase()})` : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Period" htmlFor="inv-period">
            <select
              id="inv-period"
              className="input"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setTouched((t) => ({ ...t, hours: false }));
              }}
            >
              {(o.periods.some((p) => p.value === period) ? o.periods : [{ value: period, label: finMonthLabel(period) }, ...o.periods]).map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Billable hours"
            htmlFor="inv-hours"
            error={errors.billableHours}
            hint={projectId ? (preview.isFetching ? 'Reading approved timesheets…' : `${pv?.approvedHours ?? '0'} approved, unbilled hours`) : 'Manual hours (no billable project)'}
          >
            <input
              id="inv-hours"
              className="input"
              inputMode="decimal"
              value={hours}
              aria-invalid={!!errors.billableHours || undefined}
              onChange={(e) => {
                setHours(e.target.value);
                setTouched((t) => ({ ...t, hours: true }));
              }}
            />
          </Field>
          <Field label="Rate / hour" htmlFor="inv-rate" error={errors.ratePaise} hint="Defaults from the project or client rate">
            <input
              id="inv-rate"
              className="input"
              inputMode="decimal"
              placeholder="₹"
              value={rate}
              aria-invalid={!!errors.ratePaise || undefined}
              onChange={(e) => {
                setRate(e.target.value);
                setTouched((t) => ({ ...t, rate: true }));
              }}
            />
          </Field>
          <Field
            label="GST"
            htmlFor="inv-gst"
            hint={
              override ? undefined : (
                <>
                  {derived === 'INTRA' ? 'Intra-state' : 'Inter-state'} · place of supply {finPlaceOfSupply(client?.stateCode)} ·{' '}
                  <button type="button" className="fin-link" onClick={() => setOverride(derived === 'INTRA' ? 'INTER' : 'INTRA')}>Override</button>
                </>
              )
            }
          >
            {override ? (
              <select id="inv-gst" className="input" value={override} onChange={(e) => setOverride(e.target.value as FinSupplyKind)}>
                <option value="INTER">{finGstLabel('INTER')}</option>
                <option value="INTRA">{finGstLabel('INTRA')}</option>
              </select>
            ) : (
              <input id="inv-gst" className="input" readOnly value={finGstLabel(derived)} />
            )}
          </Field>
          {override && (
            <Field
              span2
              label="Reason for overriding the derived GST"
              htmlFor="inv-override"
              error={errors.overrideReason}
              hint={
                <>
                  Derived: {finGstLabel(derived)} ·{' '}
                  <button
                    type="button"
                    className="fin-link"
                    onClick={() => {
                      setOverride(null);
                      setOverrideReason('');
                    }}
                  >
                    Use derived GST
                  </button>
                </>
              }
            >
              <input id="inv-override" className="input" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
            </Field>
          )}
          {adjusted && minutes > 0 && (
            <Field span2 label="Adjustment note" htmlFor="inv-note" error={errors.adjustmentNote} hint={`Approved hours are ${finHoursLabel(approvedMinutes)}; you are billing ${finHoursLabel(minutes)}.`}>
              <input id="inv-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fixed-scope milestone agreed with the client" />
            </Field>
          )}
          <Field span2 label="Email to" htmlFor="inv-to" error={errors.emailTo}>
            <ChipsInput id="inv-to" value={emailTo} onChange={setEmailTo} placeholder="accounts@client.com" />
          </Field>
          <Field span2 label="Cc" htmlFor="inv-cc">
            <ChipsInput id="inv-cc" value={emailCc} onChange={setEmailCc} placeholder="Optional" />
          </Field>
          <Field span2 label="Notes on invoice" htmlFor="inv-notes">
            <input id="inv-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — printed on the PDF" />
          </Field>
          {projectId && pv?.guidance && <div className="fin-guidance span-2">{pv.guidance}</div>}
          <div className="fin-preview span-2" aria-live="polite">
            <span>Taxable value</span>
            <span>{inr2(tax.taxablePaise)}</span>
            {supply === 'INTRA' ? (
              <>
                <span>CGST 9%</span>
                <span>{inr2(tax.cgstPaise)}</span>
                <span>SGST 9%</span>
                <span>{inr2(tax.sgstPaise)}</span>
              </>
            ) : (
              <>
                <span>IGST 18%</span>
                <span>{inr2(tax.igstPaise)}</span>
              </>
            )}
            {tax.roundOffPaise !== 0 && (
              <>
                <span>Round-off</span>
                <span>{inr2(tax.roundOffPaise)}</span>
              </>
            )}
            <span className="total">Total</span>
            <span className="total">{formatINR(tax.totalPaise)}</span>
          </div>
          <button type="submit" hidden />
        </form>
      )}
      {formError && <div className="field-error" role="alert">{formError}</div>}
    </Modal>
  );
}

// ── Invoice detail ───────────────────────────────────────────────────────────

type Dialog = 'issue' | 'email' | 'pay' | 'cancel' | 'delete' | null;

function InvoiceDetailModal({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (d: FinInvoiceDetail) => void }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: finKeys.invoice(id), queryFn: () => finApi.invoice(id) });
  const d = q.data;
  const [dialog, setDialog] = useState<Dialog>(null);
  const issue = useAction(() => finApi.issueInvoice(id), { success: (r) => `${r.number} issued`, invalidate: FIN_ALL, onSuccess: () => setDialog(null) });
  const remove = useAction(() => finApi.deleteInvoice(id), { success: 'Draft deleted', invalidate: FIN_ALL, onSuccess: onClose });
  const reversePay = useAction((pid: string) => finApi.reversePayment(id, pid), { success: 'Payment reversed', invalidate: FIN_ALL });
  const cancel = useAction((reason: string) => finApi.cancelInvoice(id, reason), {
    success: (r) => `Credit note ${r.creditNotes[r.creditNotes.length - 1]?.number ?? ''} issued`,
    invalidate: FIN_ALL,
  });
  const pdf = useAction(() => finApi.downloadInvoicePdf(id), {});
  const open = d && ['ISSUED', 'EMAILED', 'PARTIALLY_PAID'].includes(d.status);

  return (
    <>
      <Modal
        wide
        title={d ? `${d.label} · ${d.clientName}` : 'Invoice'}
        onClose={onClose}
        actions={<button className="btn btn-secondary" onClick={onClose}>Close</button>}
      >
        {!d ? (
          q.error ? <ErrorBlock error={q.error} retry={() => void q.refetch()} /> : <Loading />
        ) : (
          <div className="fin-split" data-screen-label="Invoice detail">
            <div className="stack">
              <DocFrame src={`${finApi.invoicePdfUrl(id)}&v=${d.status}-${d.number ?? 'draft'}-${d.totalPaise}`} title={`${d.label} PDF`} />
              <div className="fin-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => pdf.mutate(undefined)}>Download PDF</button>
                {d.creditNotes.map((c) => (
                  <button key={c.id} className="btn btn-ghost btn-sm" onClick={() => void finApi.downloadCreditNote(id, c.id)}>{c.number} PDF</button>
                ))}
              </div>
            </div>
            <div className="stack" style={{ gap: 14 }}>
              <div className="row">
                <Tag tone={invoiceTone(d.displayStatus)}>{d.displayStatus}</Tag>
                {d.taxOverrideReason && <Tag tone="outline" title={d.taxOverrideReason}>GST overridden</Tag>}
                {d.adjustmentNote && <Tag tone="outline" title={d.adjustmentNote}>Hours adjusted</Tag>}
              </div>
              <div className="fin-actions">
                {d.status === 'DRAFT' && (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => setDialog('issue')}>Issue</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => onEdit(d)}>Edit</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setDialog('delete')}>Delete draft</button>
                  </>
                )}
                {(open || d.status === 'PAID') && <button className={`btn btn-sm ${d.status === 'ISSUED' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDialog('email')}>{d.emailedAt ? 'Resend email' : 'Email'}</button>}
                {open && <button className="btn btn-primary btn-sm" onClick={() => setDialog('pay')}>Record payment</button>}
                {open && !d.payments.length && <button className="btn btn-ghost btn-sm" onClick={() => setDialog('cancel')}>Cancel (credit note)</button>}
              </div>
              {d.lastEmailError && <div className="fin-warn">Last email failed: {d.lastEmailError}</div>}
              <div className="fin-kv">
                <span>Bill to</span>
                <span>
                  {d.buyer.name}
                  {d.buyer.gstin && <div className="fin-muted fin-small">GSTIN {d.buyer.gstin}</div>}
                </span>
                <span>Place of supply</span>
                <span>{d.placeOfSupply ?? '—'} · {d.gstLabel}</span>
                <span>Project · period</span>
                <span>{[d.projectName, d.periodLabel].filter(Boolean).join(' · ')}</span>
                <span>Hours × rate</span>
                <span>{d.hours} h × {formatINR(d.ratePaise)}</span>
                <span>Taxable</span>
                <span className="tnum">{inr2(d.taxablePaise)}</span>
                {d.supplyType === 'INTRA' ? (
                  <>
                    <span>CGST + SGST</span>
                    <span className="tnum">{inr2(d.cgstPaise)} + {inr2(d.sgstPaise)}</span>
                  </>
                ) : (
                  <>
                    <span>IGST</span>
                    <span className="tnum">{inr2(d.igstPaise)}</span>
                  </>
                )}
                {d.roundOffPaise !== 0 && (
                  <>
                    <span>Round-off</span>
                    <span className="tnum">{inr2(d.roundOffPaise)}</span>
                  </>
                )}
                <span>Total</span>
                <span className="tnum" style={{ fontWeight: 600 }}>{inr2(d.totalPaise)}</span>
                {d.status !== 'DRAFT' && (
                  <>
                    <span>Received · TDS</span>
                    <span className="tnum">{inr2(d.receivedPaise)} · {inr2(d.tdsPaise)}</span>
                    <span>Balance due</span>
                    <span className="tnum">{inr2(d.balancePaise)}</span>
                    <span>Invoice · due date</span>
                    <span>{formatDate(d.invoiceDate)} · {formatDate(d.dueDate)}</span>
                  </>
                )}
                <span>Email to</span>
                <span>{d.emailTo.join(', ') || '—'}{d.emailCc.length ? ` · cc ${d.emailCc.join(', ')}` : ''}</span>
                {d.salesVoucher && (
                  <>
                    <span>Ledger</span>
                    <span>
                      <button className="fin-link" onClick={() => navigate(`/ledger?voucher=${d.salesVoucher!.id}`)}>{d.salesVoucher.number}</button>
                      {d.filingDocumentId && (
                        <>
                          {' · '}
                          <button className="fin-link" onClick={() => navigate(`/filing?q=${encodeURIComponent(d.number ?? '')}`)}>Filing cabinet</button>
                        </>
                      )}
                    </span>
                  </>
                )}
                {d.adjustmentNote && (
                  <>
                    <span>Adjustment note</span>
                    <span>{d.adjustmentNote} <span className="fin-muted fin-small">(approved {finHoursLabel(d.sourceMinutes)} h)</span></span>
                  </>
                )}
                {d.cancelReason && (
                  <>
                    <span>Cancelled</span>
                    <span>{d.cancelReason}</span>
                  </>
                )}
              </div>
              <Section title="Linked time entries">
                {d.timeEntries.length ? (
                  <table className="fin-lines">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Task</th>
                        <th className="num">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.timeEntries.map((t, i) => (
                        <tr key={i}>
                          <td>{t.employeeName}</td>
                          <td>{t.taskLabel}</td>
                          <td className="num">{t.hours}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="fin-muted fin-small">No timesheet entries are linked — the hours were entered manually.</div>
                )}
              </Section>
              {d.payments.length > 0 && (
                <Section title="Payments">
                  <table className="fin-lines">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Mode</th>
                        <th className="num">Received</th>
                        <th className="num">TDS</th>
                        <th>Voucher</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.payments.map((p) => (
                        <tr key={p.id}>
                          <td>{formatDate(p.date)}</td>
                          <td>{p.mode}{p.reference ? ` · ${p.reference}` : ''}</td>
                          <td className="num">{formatINR(p.amountPaise)}</td>
                          <td className="num">{amt(p.tdsPaise)}</td>
                          <td>{p.voucherNumber ?? '—'}</td>
                          <td className="num">
                            {d.status !== 'CANCELLED' && (
                              <button className="btn btn-ghost btn-sm" disabled={reversePay.isPending} onClick={() => reversePay.mutate(p.id)}>Reverse</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
              )}
              {d.creditNotes.length > 0 && (
                <Section title="Credit notes">
                  {d.creditNotes.map((c) => (
                    <div key={c.id} className="fin-small">{c.number} · {formatDate(c.date)} · {formatINR(c.totalPaise)} · {c.reason}</div>
                  ))}
                </Section>
              )}
              <Section title="Timeline">
                <div className="fin-timeline">
                  {d.timeline.map((t, i) => (
                    <div key={i}>
                      <span>{formatDate(t.at)}</span>
                      {t.label}
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          </div>
        )}
      </Modal>
      {d && dialog === 'issue' && (
        <ConfirmDialog
          title={`Issue the ${d.clientName} invoice?`}
          body="It gets the next invoice number, posts the sale and output GST to the ledger, and the PDF is filed under Bills & receipts › Sales invoices. Issued invoices can't be edited."
          confirmLabel={issue.isPending ? 'Issuing…' : 'Issue invoice'}
          busy={issue.isPending}
          onConfirm={() => issue.mutate(undefined)}
          onClose={() => setDialog(null)}
        />
      )}
      {d && dialog === 'delete' && (
        <ConfirmDialog
          title="Delete this draft?"
          body="The reserved timesheet hours become available for another invoice."
          confirmLabel="Delete draft"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(undefined)}
          onClose={() => setDialog(null)}
        />
      )}
      {d && dialog === 'email' && <EmailDialog d={d} onClose={() => setDialog(null)} />}
      {d && dialog === 'pay' && <PaymentDialog d={d} onClose={() => setDialog(null)} />}
      {d && dialog === 'cancel' && (
        <ReasonDialog
          title={`Cancel ${d.label} with a credit note`}
          body="A credit note reverses the sale and the output GST in the ledger. The billed hours become available for a new invoice."
          confirmLabel="Issue credit note"
          danger
          onConfirm={(reason) => cancel.mutateAsync(reason)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function EmailDialog({ d, onClose }: { d: FinInvoiceDetail; onClose: () => void }) {
  const [to, setTo] = useState<string[]>(d.emailTo);
  const [cc, setCc] = useState<string[]>(d.emailCc);
  const [message, setMessage] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const send = useAction(() => finApi.emailInvoice(d.id, { to, cc, message: message.trim() || null }), { success: 'Invoice emailed to client', invalidate: FIN_ALL, onSuccess: onClose });
  return (
    <Modal
      title={`Email ${d.label}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={send.isPending}
            onClick={() => {
              if (!to.length) return setErr('Add at least one recipient');
              setErr(null);
              send.mutate(undefined);
            }}
          >
            {send.isPending ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      <div className="dialog-body">The tax invoice PDF is attached. Bank and UPI details are included in the message.</div>
      <div className="form-grid">
        <Field span2 label="To" htmlFor="em-to" error={err ?? undefined}>
          <ChipsInput id="em-to" value={to} onChange={setTo} placeholder="accounts@client.com" />
        </Field>
        <Field span2 label="Cc" htmlFor="em-cc">
          <ChipsInput id="em-cc" value={cc} onChange={setCc} placeholder="Optional" />
        </Field>
        <Field span2 label="Message" htmlFor="em-msg">
          <textarea id="em-msg" className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional note added to the email" />
        </Field>
      </div>
    </Modal>
  );
}

function PaymentDialog({ d, onClose }: { d: FinInvoiceDetail; onClose: () => void }) {
  const [date, setDate] = useState(todayKey());
  const [amount, setAmount] = useState(paiseToRupeesText(d.balancePaise));
  const [tds, setTds] = useState('');
  const [mode, setMode] = useState('BANK');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const pay = useAction(
    () => finApi.recordPayment(d.id, { date, amountPaise: rupeesToPaise(amount), tdsPaise: tds ? rupeesToPaise(tds) : 0, mode, reference: reference.trim() || null }),
    {
      success: (r) => `${r.status === 'PAID' ? 'Paid in full' : 'Payment recorded'} · ${r.payments[r.payments.length - 1]?.voucherNumber ?? ''}`.replace(/ · $/, ''),
      invalidate: FIN_ALL,
      onSuccess: onClose,
    },
  );
  const submit = () => {
    const errs: Record<string, string> = {};
    const a = rupeesToPaise(amount);
    const t = tds ? rupeesToPaise(tds) : 0;
    if (!(a > 0)) errs.amountPaise = 'Enter the amount received';
    if (!Number.isFinite(t) || t < 0) errs.tdsPaise = 'Enter a valid TDS amount';
    if (a + t > d.balancePaise) errs.amountPaise = `Received + TDS can't exceed the balance due (${formatINR(d.balancePaise, { decimals: true })})`;
    if (!date) errs.date = 'Pick the payment date';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setFormError(null);
    pay.mutate(undefined, { onError: (e) => (setErrors(fieldErrors(e)), setFormError(errorText(e))) });
  };
  return (
    <Modal
      title={`Record payment · ${d.label}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={pay.isPending} onClick={submit}>{pay.isPending ? 'Saving…' : 'Record payment'}</button>
        </>
      }
    >
      <div className="dialog-body">Balance due {formatINR(d.balancePaise, { decimals: true })}. A receipt voucher is posted to the bank and the client's ledger.</div>
      <div className="form-grid">
        <Field label="Date received" htmlFor="pay-date" error={errors.date}>
          <input id="pay-date" type="date" className="input" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Mode" htmlFor="pay-mode">
          <select id="pay-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="BANK">Bank transfer</option>
            <option value="UPI">UPI</option>
            <option value="CHEQUE">Cheque</option>
            <option value="CASH">Cash</option>
          </select>
        </Field>
        <Field label="Amount received (₹)" htmlFor="pay-amt" error={errors.amountPaise}>
          <input id="pay-amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="TDS deducted by client (₹)" htmlFor="pay-tds" error={errors.tdsPaise} hint="Sec 194J — claimable against tax">
          <input id="pay-tds" className="input" inputMode="decimal" value={tds} placeholder="0" onChange={(e) => setTds(e.target.value)} />
        </Field>
        <Field span2 label="Reference" htmlFor="pay-ref">
          <input id="pay-ref" className="input" value={reference} placeholder="UTR / cheque no." onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      {formError && <div className="field-error" role="alert">{formError}</div>}
    </Modal>
  );
}
