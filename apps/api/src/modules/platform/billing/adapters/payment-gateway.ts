import { Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../../../config/env';

export type GatewayEvent = {
  id: string;
  type: 'payment.captured' | 'payment.failed';
  orderId: string;
  paymentId?: string;
  amountPaise: number;
  reason?: string;
};

/** Payment gateway port (Razorpay in production, a mock checkout in dev). */
export interface PaymentGateway {
  readonly name: 'MOCK' | 'RAZORPAY';
  readonly keyId?: string;
  createOrder(p: { invoiceId: string; amountPaise: number; notes: Record<string, string> }): Promise<{ orderId: string }>;
  /** Verify a webhook body/signature and normalise it. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): { valid: boolean; event: GatewayEvent | null };
  /** Sign a body the way the gateway would (used by the mock checkout to post a webhook to ourselves). */
  sign(body: unknown): string;
}

const hmac = (secret: string, body: unknown) => createHmac('sha256', secret).update(typeof body === 'string' ? body : JSON.stringify(body)).digest('hex');
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const header = (h: Record<string, string | string[] | undefined>, k: string) => {
  const v = h[k] ?? h[k.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/** Dev/default gateway: checkout happens on our own /billing/checkout/:orderId page. */
export class MockGateway implements PaymentGateway {
  readonly name = 'MOCK' as const;
  private readonly log = new Logger('MockGateway');
  private readonly secret = `mock:${env.JWT_ACCESS_SECRET}`;

  async createOrder(p: { invoiceId: string; amountPaise: number }) {
    const orderId = `mock_order_${randomBytes(8).toString('hex')}`;
    this.log.log(`Created order ${orderId} for invoice ${p.invoiceId} (₹${(p.amountPaise / 100).toFixed(2)})`);
    return { orderId };
  }

  sign(body: unknown) {
    return hmac(this.secret, body);
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, body: unknown) {
    const sig = header(headers, 'x-mock-signature') ?? '';
    const valid = !!sig && safeEq(sig, this.sign(body));
    const b = body as Partial<GatewayEvent>;
    const event = valid && b?.id && b.orderId && (b.type === 'payment.captured' || b.type === 'payment.failed') ? (b as GatewayEvent) : null;
    return { valid, event };
  }
}

/**
 * Razorpay Orders + webhook adapter. Enabled when RAZORPAY_KEY_ID/SECRET are set.
 * Order creation is stubbed (no outbound network from this environment) but produces
 * Razorpay-shaped ids; webhook verification follows X-Razorpay-Signature (HMAC SHA256 of
 * the raw body — here the JSON body as received).
 */
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'RAZORPAY' as const;
  private readonly log = new Logger('RazorpayGateway');
  constructor(
    readonly keyId: string,
    private readonly secret: string,
  ) {}

  async createOrder(p: { invoiceId: string; amountPaise: number; notes: Record<string, string> }) {
    const orderId = `order_${randomBytes(7).toString('base64url')}`;
    this.log.log(`POST https://api.razorpay.com/v1/orders {amount:${p.amountPaise}, currency:"INR", receipt:"${p.invoiceId}"} → ${orderId} (stub)`);
    return { orderId };
  }

  sign(body: unknown) {
    return hmac(this.secret, body);
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, body: unknown) {
    const sig = header(headers, 'x-razorpay-signature') ?? '';
    const valid = !!sig && safeEq(sig, this.sign(body));
    if (!valid) return { valid, event: null };
    const b = body as any;
    const entity = b?.payload?.payment?.entity;
    const type = b?.event === 'payment.captured' ? 'payment.captured' : b?.event === 'payment.failed' ? 'payment.failed' : null;
    if (!entity || !type) return { valid, event: null };
    return {
      valid,
      event: { id: String(header(headers, 'x-razorpay-event-id') ?? `${entity.id}:${type}`), type, orderId: entity.order_id, paymentId: entity.id, amountPaise: Number(entity.amount), reason: entity.error_description } as GatewayEvent,
    };
  }
}

export function createGateway(): PaymentGateway {
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) return new RazorpayGateway(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET);
  return new MockGateway();
}
