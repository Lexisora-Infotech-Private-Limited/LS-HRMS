"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get MockGateway () {
        return MockGateway;
    },
    get RazorpayGateway () {
        return RazorpayGateway;
    },
    get createGateway () {
        return createGateway;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _env = require("../../../../config/env");
const hmac = (secret, body)=>(0, _nodecrypto.createHmac)('sha256', secret).update(typeof body === 'string' ? body : JSON.stringify(body)).digest('hex');
const safeEq = (a, b)=>a.length === b.length && (0, _nodecrypto.timingSafeEqual)(Buffer.from(a), Buffer.from(b));
const header = (h, k)=>{
    const v = h[k] ?? h[k.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
};
let MockGateway = class MockGateway {
    name = 'MOCK';
    log = new _common.Logger('MockGateway');
    secret = `mock:${_env.env.JWT_ACCESS_SECRET}`;
    async createOrder(p) {
        const orderId = `mock_order_${(0, _nodecrypto.randomBytes)(8).toString('hex')}`;
        this.log.log(`Created order ${orderId} for invoice ${p.invoiceId} (₹${(p.amountPaise / 100).toFixed(2)})`);
        return {
            orderId
        };
    }
    sign(body) {
        return hmac(this.secret, body);
    }
    verifyWebhook(headers, body) {
        const sig = header(headers, 'x-mock-signature') ?? '';
        const valid = !!sig && safeEq(sig, this.sign(body));
        const b = body;
        const event = valid && b?.id && b.orderId && (b.type === 'payment.captured' || b.type === 'payment.failed') ? b : null;
        return {
            valid,
            event
        };
    }
};
let RazorpayGateway = class RazorpayGateway {
    keyId;
    secret;
    name = 'RAZORPAY';
    log = new _common.Logger('RazorpayGateway');
    constructor(keyId, secret){
        this.keyId = keyId;
        this.secret = secret;
    }
    async createOrder(p) {
        const orderId = `order_${(0, _nodecrypto.randomBytes)(7).toString('base64url')}`;
        this.log.log(`POST https://api.razorpay.com/v1/orders {amount:${p.amountPaise}, currency:"INR", receipt:"${p.invoiceId}"} → ${orderId} (stub)`);
        return {
            orderId
        };
    }
    sign(body) {
        return hmac(this.secret, body);
    }
    verifyWebhook(headers, body) {
        const sig = header(headers, 'x-razorpay-signature') ?? '';
        const valid = !!sig && safeEq(sig, this.sign(body));
        if (!valid) return {
            valid,
            event: null
        };
        const b = body;
        const entity = b?.payload?.payment?.entity;
        const type = b?.event === 'payment.captured' ? 'payment.captured' : b?.event === 'payment.failed' ? 'payment.failed' : null;
        if (!entity || !type) return {
            valid,
            event: null
        };
        return {
            valid,
            event: {
                id: String(header(headers, 'x-razorpay-event-id') ?? `${entity.id}:${type}`),
                type,
                orderId: entity.order_id,
                paymentId: entity.id,
                amountPaise: Number(entity.amount),
                reason: entity.error_description
            }
        };
    }
};
function createGateway() {
    if (_env.env.RAZORPAY_KEY_ID && _env.env.RAZORPAY_KEY_SECRET) return new RazorpayGateway(_env.env.RAZORPAY_KEY_ID, _env.env.RAZORPAY_KEY_SECRET);
    return new MockGateway();
}

//# sourceMappingURL=payment-gateway.js.map