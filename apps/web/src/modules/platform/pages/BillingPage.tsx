import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FREE_SEATS,
  GST_STATE_NAMES,
  PLAN_CARDS,
  formatDate,
  formatINR,
  planCtas,
  seatUsageCopy,
  type BillingCycleKey,
  type BillingOverview,
  type PlanCardCode,
  type QuoteDto,
  type SaasInvoiceDto,
} from '@lexisora/shared';
import { Card, ConfirmDialog, ErrorBlock, Loading, Modal, PageHeader, Seg, Tag, type Tone } from '@/components/ui';
import { DataTable, type Column } from '@/components/table';
import { FormModal, type FieldDef } from '@/components/form';
import { download } from '@/lib/api';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { onRealtime } from '@/lib/socket';
import { billingApi, saasKeys, useBillingOverview, useSaasInvoices } from '../api';
import '../platform.css';

const cycleWord = (c: BillingCycleKey) => (c === 'YEARLY' ? 'yearly' : 'monthly');

const INVOICE_TONE: Record<string, Tone> = { PAID: 'accent', ISSUED: 'outline', OVERDUE: 'danger', VOID: 'neutral' };
const INVOICE_LABEL: Record<string, string> = { PAID: 'Paid', ISSUED: 'Due', OVERDUE: 'Overdue', VOID: 'Void' };

/** Quote / invoice lines with GST split and round-off. */
export function QuoteTable({ q }: { q: QuoteDto }) {
  return (
    <table className="pf-quote">
      <tbody>
        {q.lines.map((l, i) => (
          <tr key={i}>
            <td>{l.description}</td>
            <td>{formatINR(l.amountPaise, { decimals: true })}</td>
          </tr>
        ))}
        <tr>
          <td>Taxable value</td>
          <td>{formatINR(q.taxablePaise, { decimals: true })}</td>
        </tr>
        {q.cgstPaise > 0 && (
          <>
            <tr>
              <td>CGST 9%</td>
              <td>{formatINR(q.cgstPaise, { decimals: true })}</td>
            </tr>
            <tr>
              <td>SGST 9%</td>
              <td>{formatINR(q.sgstPaise, { decimals: true })}</td>
            </tr>
          </>
        )}
        {q.igstPaise > 0 && (
          <tr>
            <td>IGST 18%</td>
            <td>{formatINR(q.igstPaise, { decimals: true })}</td>
          </tr>
        )}
        {q.roundOffPaise !== 0 && (
          <tr>
            <td>Round off</td>
            <td>{formatINR(q.roundOffPaise, { decimals: true })}</td>
          </tr>
        )}
        <tr className="total">
          <td>Total</td>
          <td>{formatINR(q.totalPaise, { decimals: true })}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Upgrade / renew: pick seats, see the GST quote, go to the payment gateway. */
function CheckoutModal({ ov, cycle, onClose }: { ov: BillingOverview; cycle: BillingCycleKey; onClose: () => void }) {
  const nav = useNavigate();
  const minSeats = Math.max(FREE_SEATS + 1, ov.seatsUsed);
  const [qty, setQty] = useState(() => Math.max(ov.planCode === 'GROWTH' ? ov.quantity : minSeats, minSeats));
  const [debounced, setDebounced] = useState(qty);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(qty), 300);
    return () => clearTimeout(t);
  }, [qty]);
  const valid = Number.isInteger(debounced) && debounced >= minSeats;
  const quote = useQuery({ queryKey: ['platform', 'billing', 'quote', cycle, debounced], queryFn: () => billingApi.quote(cycle, debounced), enabled: valid, retry: false });
  const pay = useAction(() => billingApi.checkout(cycle, qty), {
    success: 'Redirecting to payment gateway…',
    onSuccess: (r) => nav(r.checkoutPath),
  });
  const renewing = ov.planCode === 'GROWTH';
  return (
    <Modal
      title={renewing ? `Renew Growth · ${cycleWord(cycle)}` : `Upgrade to Growth · ${cycleWord(cycle)}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!quote.data || pay.isPending || qty !== debounced} onClick={() => pay.mutate(undefined)}>
            {quote.data ? `Pay ${formatINR(quote.data.totalPaise)}` : 'Pay'}
          </button>
        </>
      }
    >
      <div className="dialog-body stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="pf-seats">Seats</label>
          <div className="pf-stepper">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQty((q) => Math.max(minSeats, q - 1))} aria-label="Fewer seats">−</button>
            <input id="pf-seats" className="input" type="number" min={minSeats} value={qty} onChange={(e) => setQty(Math.floor(Number(e.target.value) || 0))} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQty((q) => q + 1)} aria-label="More seats">+</button>
          </div>
          <div className="field-hint">
            {ov.seatsUsed} users today · first {FREE_SEATS} seats are free · {formatINR(ov.prices[cycle])} per extra seat / month{cycle === 'YEARLY' ? ', billed yearly' : ''}
          </div>
          {qty < minSeats && <div className="field-error">Buy at least {minSeats} seats</div>}
        </div>
        {quote.isLoading && valid && <Loading label="Calculating…" />}
        {quote.error && <ErrorBlock error={quote.error} />}
        {quote.data && (
          <>
            <QuoteTable q={quote.data} />
            <div className="muted" style={{ fontSize: 12.5 }}>
              Service period {formatDate(quote.data.periodStart)} – {formatDate(quote.data.periodEnd)}
              {renewing ? ' · starts when your current period ends' : ''}
              {quote.data.promo ? ` · promo ${quote.data.promo} applied` : ''}. Place of supply {GST_STATE_NAMES[quote.data.placeOfSupply] ?? quote.data.placeOfSupply}.
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Seats stepper with a prorated price preview (Growth). */
function SeatsCard({ ov }: { ov: BillingOverview }) {
  const nav = useNavigate();
  const [qty, setQty] = useState(ov.quantity);
  const [debounced, setDebounced] = useState(ov.quantity);
  useEffect(() => setQty(ov.quantity), [ov.quantity]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(qty), 300);
    return () => clearTimeout(t);
  }, [qty]);
  const adding = debounced > ov.quantity;
  const preview = useQuery({ queryKey: ['platform', 'billing', 'seat-quote', debounced], queryFn: () => billingApi.seatQuote(debounced), enabled: adding, retry: false });
  const update = useAction(() => billingApi.seats(qty), {
    success: (r) => (r.checkout ? 'Redirecting to payment gateway…' : r.message),
    invalidate: [saasKeys.billing],
    onSuccess: (r) => {
      if (r.checkout) nav(r.checkout.checkoutPath);
    },
  });
  const min = Math.max(FREE_SEATS + 1, ov.seatsUsed);
  let line: string;
  if (qty === ov.quantity) line = `${ov.seatsUsed} of ${ov.quantity} seats in use.`;
  else if (qty < ov.quantity) line = qty < min ? `You have ${ov.seatsUsed} users — seats can’t go below ${min}.` : `Seats will drop to ${qty} at renewal on ${formatDate(ov.currentPeriodEnd)}.`;
  else if (preview.data && debounced === qty) line = `Adding ${preview.data.addedSeats} seats: ${formatINR(preview.data.amountPaise, { decimals: true })} prorated + GST (${preview.data.remainingDays} of ${preview.data.totalDays} days left).`;
  else line = 'Calculating…';
  return (
    <Card kicker="Seats" title="Purchased seats">
      <div className="pf-stepper">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer seats">−</button>
        <input className="input" type="number" aria-label="Purchased seats" value={qty} onChange={(e) => setQty(Math.floor(Number(e.target.value) || 0))} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQty((q) => q + 1)} aria-label="More seats">+</button>
      </div>
      <div className="card-meta">{line}</div>
      {ov.pendingChange?.quantity && <div className="note">Scheduled: {ov.pendingChange.quantity} seats from {formatDate(ov.currentPeriodEnd)}.</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={qty === ov.quantity || qty < min || update.isPending} onClick={() => update.mutate(undefined)}>
          Update seats
        </button>
      </div>
    </Card>
  );
}

const profileFields: FieldDef[] = [
  { name: 'legalName', label: 'Legal name', type: 'text', span: 2, required: true },
  { name: 'gstin', label: 'GSTIN (optional)', type: 'text', placeholder: '24AAECL1234F1Z5' },
  { name: 'stateCode', label: 'State', type: 'select', required: true, options: Object.entries(GST_STATE_NAMES).map(([value, label]) => ({ value, label })) },
  { name: 'address', label: 'Billing address', type: 'area' },
];

const salesFields: FieldDef[] = [
  { name: 'name', label: 'Your name', type: 'text', required: true },
  { name: 'phone', label: 'Phone', type: 'text', placeholder: '+91 98xxx xxxxx' },
  { name: 'email', label: 'Work email', type: 'email', required: true },
  { name: 'seats', label: 'Seats needed', type: 'number', placeholder: '250' },
  { name: 'message', label: 'What do you need?', type: 'area', placeholder: 'Dedicated database, CCTV and biometric integrations, SSO…' },
];

/** Subscription & billing (wireframe "Subscription"): plans, seats, promo codes, GST invoices. */
export default function BillingPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast } = useToast();
  const ov = useBillingOverview();
  const invoices = useSaasInvoices();
  const [cycle, setCycle] = useState<BillingCycleKey | null>(null);
  const [modal, setModal] = useState<'checkout' | 'downgrade' | 'sales' | 'profile' | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => onRealtime('billing.updated', () => void qc.invalidateQueries({ queryKey: saasKeys.billing })), [qc]);
  useEffect(() => {
    if (ov.data && cycle === null) setCycle(ov.data.cycle ?? 'YEARLY');
  }, [ov.data, cycle]);

  const promo = useAction((c: string) => billingApi.promo(c), { success: (r) => r.message, invalidate: [saasKeys.billing], onSuccess: () => setCode('') });
  const downgrade = useAction(() => billingApi.downgrade(), { success: (r) => r.message, invalidate: [saasKeys.billing], onSuccess: () => setModal(null) });
  const cancelDowngrade = useAction(() => billingApi.cancelDowngrade(), { success: (r) => r.message, invalidate: [saasKeys.billing] });
  const payNow = useAction((id: string) => billingApi.pay(id), { success: 'Redirecting to payment gateway…', onSuccess: (r) => nav(r.checkoutPath) });

  const ctas = useMemo(() => (ov.data ? planCtas(ov.data.planCode, ov.data.cancelAtPeriodEnd) : null), [ov.data]);

  if (ov.isLoading) return <Loading />;
  if (ov.error || !ov.data) return <ErrorBlock error={ov.error} retry={() => void ov.refetch()} />;
  const o = ov.data;
  const c = cycle ?? o.cycle ?? 'YEARLY';
  const isGrowth = o.planCode === 'GROWTH';
  /** The operator's own workspace (a fresh install): never billed, no seat limit. */
  const isInternal = o.planCode === 'INTERNAL';

  function choose(card: PlanCardCode) {
    const a = ctas![card].action;
    if (a === 'checkout') setModal('checkout');
    else if (a === 'downgrade') setModal('downgrade');
    else if (a === 'cancel-downgrade') cancelDowngrade.mutate(undefined);
    else if (a === 'contact') setModal('sales');
  }

  const price = (card: PlanCardCode) => (card === 'FREE' ? '₹ 0' : card === 'GROWTH' ? formatINR(o.prices[c]) : 'Custom');
  const unit = (card: PlanCardCode, fallback: string) => (card === 'GROWTH' ? `per user / month, billed ${cycleWord(c)}` : fallback);

  const columns: Column<SaasInvoiceDto>[] = [
    { key: 'no', header: 'Invoice no.', render: (i) => <span className="pf-mono">{i.number ?? '—'}</span> },
    { key: 'date', header: 'Date', render: (i) => <span className="pf-nowrap">{formatDate(i.issueDate)}</span> },
    { key: 'period', header: 'Period', render: (i) => <span>{i.description}<div className="muted" style={{ fontSize: 12 }}>{formatDate(i.periodStart)} – {formatDate(i.periodEnd)}</div></span> },
    { key: 'amount', header: 'Amount', num: true, render: (i) => formatINR(i.amountPaise, { decimals: true }) },
    { key: 'gst', header: 'GST', num: true, render: (i) => formatINR(i.gstPaise, { decimals: true }) },
    { key: 'total', header: 'Total', num: true, render: (i) => formatINR(i.totalPaise) },
    { key: 'status', header: 'Status', render: (i) => <Tag tone={INVOICE_TONE[i.status] ?? 'neutral'}>{INVOICE_LABEL[i.status] ?? i.status}</Tag> },
    {
      key: 'pdf',
      header: '',
      render: (i) => (
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {(i.status === 'ISSUED' || i.status === 'OVERDUE') && (
            <button className="btn btn-primary btn-sm" disabled={payNow.isPending} onClick={() => payNow.mutate(i.id)}>Pay now</button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => void download(`/billing/invoices/${i.id}/pdf`, `${(i.number ?? i.id).replace(/\//g, '-')}.pdf`)}>PDF</button>
        </span>
      ),
    },
  ];

  return (
    <div data-screen-label="Subscription" className="stack" style={{ gap: 20 }}>
      <PageHeader title="Subscription & billing" sub={isInternal ? `${o.seatsUsed} users · operator workspace — not billed, no seat limit.` : seatUsageCopy(o.seatsUsed, o.quantity)} />

      {o.billingState && (
        <div className={`pf-banner${o.status === 'PAST_DUE' || o.status === 'READ_ONLY' || o.status === 'SUSPENDED' ? ' danger' : ''}`} role="status">
          <span>{o.billingState}</span>
          {o.dueInvoice && (
            <button className="btn btn-primary btn-sm" disabled={payNow.isPending} onClick={() => payNow.mutate(o.dueInvoice!.id)}>
              Pay now · {formatINR(o.dueInvoice.totalPaise)}
            </button>
          )}
        </div>
      )}

      <div style={{ alignSelf: 'flex-start' }}>
        <Seg<BillingCycleKey>
          options={[
            { value: 'MONTHLY', label: 'Monthly' },
            { value: 'YEARLY', label: `Yearly · save ${o.savingsPct}%` },
          ]}
          value={c}
          onChange={setCycle}
        />
      </div>

      <div className="pf-plans">
        {PLAN_CARDS.map((p) => {
          const cta = ctas![p.code];
          return (
            <div key={p.code} className={`card pf-plan${cta.current ? ' current' : ''}`}>
              <div className="card-kicker">{p.name}{cta.current && o.planCode === 'GROWTH' ? ` · current · ${o.cycle === 'MONTHLY' ? 'monthly' : 'yearly'}` : cta.current ? ' · current' : ''}</div>
              <div className="pf-plan-price">{price(p.code)}</div>
              <div className="card-meta">{unit(p.code, p.unit)}</div>
              {p.feats.map((f) => (
                <div key={f} className="pf-plan-feat">{f}</div>
              ))}
              <button className={`btn ${cta.current || p.code === 'GROWTH' ? 'btn-primary' : 'btn-secondary'}`} disabled={cta.disabled || cancelDowngrade.isPending} onClick={() => choose(p.code)}>
                {cta.label}
              </button>
            </div>
          );
        })}
      </div>

      <form
        className="pf-promo"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) promo.mutate(code.trim());
        }}
      >
        <input className="input" placeholder="Promo code" aria-label="Promo code" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn btn-secondary" type="submit" disabled={!code.trim() || promo.isPending}>Apply</button>
        {o.promo && <span className="muted" style={{ fontSize: 12.5, flexBasis: '100%' }}><Tag tone="accent">{o.promo.code}</Tag> {o.promo.description} · applies to your next invoice</span>}
      </form>

      <div className="grid-2-1" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 16 }}>
          {isGrowth ? (
            <SeatsCard ov={o} />
          ) : (
            <Card kicker="Seats" title={o.planCode === 'FREE' ? `${o.seatsUsed} of ${FREE_SEATS} free seats in use` : isInternal ? `${o.seatsUsed} users` : `${o.seatsUsed} of ${o.quantity} seats in use`}>
              <div className="card-meta">
                {o.planCode === 'FREE' ? 'Upgrade to Growth to add more than 10 users.' : isInternal ? 'As the platform operator, your own workspace has no seat limit and is never invoiced.' : 'Seats on your contract are managed by Lexisora sales.'}
              </div>
            </Card>
          )}
          <Card kicker="Invoices" title="Lexisora tax invoices">
            <DataTable columns={columns} rows={invoices.data} rowKey={(i) => i.id} loading={invoices.isLoading} empty="No invoices yet." />
          </Card>
        </div>
        <div className="stack" style={{ gap: 16 }}>
          <Card kicker="Current plan" title={o.planName}>
            <div className="kv-row"><span>Status</span><span>{o.status === 'ACTIVE' ? 'Active' : o.status === 'PAST_DUE' ? 'Payment due' : o.status === 'READ_ONLY' ? 'Read-only' : o.status === 'FREE' ? 'Free' : o.status.charAt(0) + o.status.slice(1).toLowerCase()}</span></div>
            {o.currentPeriodEnd && <div className="kv-row"><span>{o.cancelAtPeriodEnd ? 'Ends' : 'Renews'}</span><span>{formatDate(o.currentPeriodEnd)}</span></div>}
            <div className="kv-row"><span>Seats</span><span>{isInternal ? 'No limit · not billed' : `${o.quantity} (${Math.max(0, o.quantity - FREE_SEATS)} billed)`}</span></div>
            <div className="kv-row"><span>Payment method</span><span>{isInternal ? 'Not billed' : o.gateway === 'MOCK' ? 'Test gateway · no real charge' : 'Razorpay checkout'}</span></div>
          </Card>
          <Card kicker="Billing details" title={o.profile.legalName ?? o.tenantName} actions={<button className="btn btn-secondary btn-sm" onClick={() => setModal('profile')}>Edit</button>}>
            <div className="kv-row"><span>GSTIN</span><span className="pf-mono">{o.profile.gstin ?? 'Unregistered'}</span></div>
            <div className="kv-row"><span>Place of supply</span><span>{o.profile.stateName ?? '—'}{o.profile.stateCode ? ` (${o.profile.stateCode})` : ''}</span></div>
            {o.profile.address && <div className="card-meta">{o.profile.address}</div>}
          </Card>
        </div>
      </div>

      {modal === 'checkout' && <CheckoutModal ov={o} cycle={c} onClose={() => setModal(null)} />}
      {modal === 'downgrade' && (
        <ConfirmDialog
          title="Downgrade to Free?"
          body={
            <>
              Your workspace stays on Growth until {formatDate(o.currentPeriodEnd)}, then moves to Free (up to {FREE_SEATS} users; payroll, ledger, desktop tracker and white-label switch off).
              {o.seatsUsed > FREE_SEATS ? ` You have ${o.seatsUsed} users — deactivate ${o.seatsUsed - FREE_SEATS} before then.` : ''} No refund is issued for the current period.
            </>
          }
          confirmLabel="Schedule downgrade"
          danger
          busy={downgrade.isPending}
          onConfirm={() => downgrade.mutate(undefined)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'sales' && (
        <FormModal
          title="Contact Lexisora sales"
          intro="Enterprise is priced per contract for 200+ users, with a dedicated database, CCTV & biometric integrations and 24/7 priority support."
          fields={salesFields}
          submitLabel="Send"
          onSubmit={async (v) => {
            await billingApi.contactSales(v as any);
            toast('Request noted');
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'profile' && (
        <FormModal
          title="Billing details"
          fields={profileFields}
          initial={{ legalName: o.profile.legalName, gstin: o.profile.gstin, stateCode: o.profile.stateCode ?? '24', address: o.profile.address }}
          onSubmit={async (v) => {
            await billingApi.profile(v as any);
            await qc.invalidateQueries({ queryKey: saasKeys.billing });
            toast('Saved');
          }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
