import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDate, formatINR } from '@lexisora/shared';
import { Card, ErrorBlock, Loading, PageHeader, Tag } from '@/components/ui';
import { useAction } from '@/lib/query';
import { billingApi, saasKeys, useCheckout } from '../api';
import { QuoteTable } from './BillingPage';
import '../platform.css';

/**
 * Hosted checkout for an order created by Subscription & billing. With the mock gateway (dev,
 * no RAZORPAY_* keys) this page stands in for the gateway: "Pay" / "Fail" post a signed event to
 * our own webhook path, exactly like a real capture.
 */
export default function CheckoutPage() {
  const { orderId = '' } = useParams();
  const nav = useNavigate();
  const d = useCheckout(orderId);
  const confirm = useAction((outcome: 'success' | 'fail') => billingApi.confirm(orderId, outcome), {
    success: (r) => r.message,
    invalidate: [saasKeys.billing],
    onSuccess: (r) => {
      if (r.status === 'CAPTURED') nav('/billing');
      else void d.refetch();
    },
  });

  if (d.isLoading) return <Loading />;
  if (d.error || !d.data) return <ErrorBlock error={d.error} retry={() => void d.refetch()} />;
  const c = d.data;
  const open = c.status === 'CREATED';
  const mock = c.gateway === 'MOCK';

  return (
    <div data-screen-label="Checkout" className="stack pf-checkout" style={{ gap: 16 }}>
      <PageHeader
        kicker={<span className="pf-gateway-badge">{mock ? 'Test payment gateway' : 'Razorpay'}</span>}
        title={`Pay ${formatINR(c.amountPaise, { decimals: true })}`}
        sub={`${c.tenantName} · ${c.description}`}
      />
      <Card kicker="Order" title={<span className="pf-mono">{c.orderId}</span>}>
        <QuoteTable q={c.quote} />
        <div className="muted" style={{ fontSize: 12.5 }}>
          Service period {formatDate(c.quote.periodStart)} – {formatDate(c.quote.periodEnd)} · Lexisora Infotech Pvt Ltd · GSTIN 24AAECL1234F1Z5
        </div>
        {!open && (
          <div className="row">
            <Tag tone={c.status === 'CAPTURED' ? 'accent' : 'danger'}>{c.status === 'CAPTURED' ? 'Paid' : 'Not paid'}</Tag>
            <span className="muted" style={{ fontSize: 13 }}>{c.status === 'CAPTURED' ? 'This order is paid. Your invoice is on the Subscription screen.' : 'This checkout is closed. Start a new one from Subscription & billing.'}</span>
          </div>
        )}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {open && mock && (
            <>
              <button className="btn btn-primary" disabled={confirm.isPending} onClick={() => confirm.mutate('success')}>
                Pay {formatINR(c.amountPaise)} · success
              </button>
              <button className="btn btn-secondary" disabled={confirm.isPending} onClick={() => confirm.mutate('fail')}>
                Simulate a failed payment
              </button>
            </>
          )}
          {open && !mock && <span className="muted" style={{ fontSize: 13 }}>Complete the payment in the Razorpay window. This page updates once the gateway confirms it.</span>}
          <Link className="btn btn-ghost" to="/billing">Back to billing</Link>
        </div>
        {mock && open && <div className="field-hint">Test mode: no card is charged. The gateway event is signed and processed exactly like a live capture.</div>}
      </Card>
    </div>
  );
}
