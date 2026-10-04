"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const _billinglogic = require("./billing.logic");
const ist = (s)=>new Date(`${s}+05:30`);
(0, _vitest.describe)('Seats & prices', ()=>{
    (0, _vitest.it)('first 10 users are free on every plan', ()=>{
        (0, _vitest.expect)(_shared.FREE_SEATS).toBe(10);
        (0, _vitest.expect)((0, _shared.chargeableSeats)(50)).toBe(40);
        (0, _vitest.expect)((0, _shared.chargeableSeats)(10)).toBe(0);
        (0, _vitest.expect)((0, _shared.chargeableSeats)(7)).toBe(0);
        (0, _vitest.expect)((0, _shared.chargeableSeats)(11)).toBe(1);
    });
    (0, _vitest.it)('Growth costs ₹179 monthly or ₹149 yearly per seat per month — "save 17%"', ()=>{
        (0, _vitest.expect)(_shared.GROWTH_PRICE_PAISE).toEqual({
            MONTHLY: 17900,
            YEARLY: 14900
        });
        (0, _vitest.expect)(_shared.YEARLY_SAVINGS_PCT).toBe(17);
        (0, _vitest.expect)((0, _shared.seatPeriodPaise)('MONTHLY')).toBe(17900);
        (0, _vitest.expect)((0, _shared.seatPeriodPaise)('YEARLY')).toBe(178800);
    });
    (0, _vitest.it)('period line charges only the seats above the free 10', ()=>{
        const y = (0, _billinglogic.periodLine)('YEARLY', 50);
        (0, _vitest.expect)(y.quantity).toBe(40);
        (0, _vitest.expect)(y.amountPaise).toBe(40 * 178800);
        (0, _vitest.expect)(y.description).toContain('50 seats (first 10 free)');
        (0, _vitest.expect)((0, _billinglogic.periodLine)('MONTHLY', 62).amountPaise).toBe(52 * 17900);
    });
    (0, _vitest.it)('subtitle copy', ()=>{
        (0, _vitest.expect)((0, _shared.seatUsageCopy)(42, 50)).toBe('42 of 50 seats used · first 10 users are free on every plan.');
    });
    (0, _vitest.it)('seat gate: Free stops at 10, paid at the purchased seats, Internal never', ()=>{
        (0, _vitest.expect)((0, _billinglogic.seatAvailable)('FREE', 10, 9)).toBe(true);
        (0, _vitest.expect)((0, _billinglogic.seatAvailable)('FREE', 10, 10)).toBe(false);
        (0, _vitest.expect)((0, _billinglogic.seatAvailable)('GROWTH', 50, 49)).toBe(true);
        (0, _vitest.expect)((0, _billinglogic.seatAvailable)('GROWTH', 50, 50)).toBe(false);
        (0, _vitest.expect)((0, _billinglogic.seatAvailable)('INTERNAL', 0, 500)).toBe(true);
    });
    (0, _vitest.it)('a workspace without a subscription gets Free — unless it is the operator’s own (Internal, unlimited)', ()=>{
        (0, _vitest.expect)((0, _billinglogic.defaultSubscriptionFor)(false)).toEqual({
            planCode: 'FREE',
            status: 'FREE',
            quantity: _shared.FREE_SEATS,
            collection: 'GATEWAY'
        });
        const op = (0, _billinglogic.defaultSubscriptionFor)(true);
        (0, _vitest.expect)(op).toMatchObject({
            planCode: 'INTERNAL',
            status: 'ACTIVE'
        });
        // The operator never hits the seat gate, however many people it adds.
        (0, _vitest.expect)((0, _billinglogic.seatAvailable)(op.planCode, op.quantity, 128)).toBe(true);
    });
    (0, _vitest.it)('seats shown: Free is fixed at 10, Internal shows its users, paid plans the purchased seats', ()=>{
        (0, _vitest.expect)((0, _billinglogic.displayedSeats)('FREE', 25, 9)).toBe(_shared.FREE_SEATS);
        (0, _vitest.expect)((0, _billinglogic.displayedSeats)('INTERNAL', _shared.FREE_SEATS, 128)).toBe(128);
        (0, _vitest.expect)((0, _billinglogic.displayedSeats)('INTERNAL', _shared.FREE_SEATS, 4)).toBe(_shared.FREE_SEATS);
        (0, _vitest.expect)((0, _billinglogic.displayedSeats)('GROWTH', 50, 42)).toBe(50);
    });
    (0, _vitest.it)('Growth checkout needs at least 11 seats', ()=>{
        (0, _vitest.expect)(_shared.quoteSchema.safeParse({
            planCode: 'GROWTH',
            cycle: 'YEARLY',
            quantity: 10
        }).success).toBe(false);
        (0, _vitest.expect)(_shared.quoteSchema.parse({
            planCode: 'GROWTH',
            cycle: 'YEARLY',
            quantity: '11'
        }).quantity).toBe(11);
    });
});
(0, _vitest.describe)('GST invoices (spec M10 worked examples)', ()=>{
    (0, _vitest.it)('50 seats, yearly, Gujarat → CGST + SGST → ₹84,394', ()=>{
        const t = (0, _billinglogic.totalsFor)([
            (0, _billinglogic.periodLine)('YEARLY', 50)
        ], '24');
        (0, _vitest.expect)(t.subtotalPaise).toBe(7_152_000);
        (0, _vitest.expect)(t.cgstPaise).toBe(643_680);
        (0, _vitest.expect)(t.sgstPaise).toBe(643_680);
        (0, _vitest.expect)(t.igstPaise).toBe(0);
        (0, _vitest.expect)(t.roundOffPaise).toBe(40);
        (0, _vitest.expect)(t.totalPaise).toBe(8_439_400);
    });
    (0, _vitest.it)('62 seats, monthly, Maharashtra → IGST → ₹10,983', ()=>{
        const t = (0, _billinglogic.totalsFor)([
            (0, _billinglogic.periodLine)('MONTHLY', 62)
        ], '27');
        (0, _vitest.expect)(t.taxablePaise).toBe(930_800);
        (0, _vitest.expect)(t.igstPaise).toBe(167_544);
        (0, _vitest.expect)(t.cgstPaise + t.sgstPaise).toBe(0);
        (0, _vitest.expect)(t.roundOffPaise).toBe(-44);
        (0, _vitest.expect)(t.totalPaise).toBe(1_098_300);
    });
    (0, _vitest.it)('intra- vs inter-state split and rupee rounding', ()=>{
        (0, _vitest.expect)((0, _billinglogic.gstSplit)(10_000, '24')).toEqual({
            cgst: 900,
            sgst: 900,
            igst: 0
        });
        (0, _vitest.expect)((0, _billinglogic.gstSplit)(10_000, '29')).toEqual({
            cgst: 0,
            sgst: 0,
            igst: 1800
        });
        (0, _vitest.expect)((0, _billinglogic.roundToRupee)(1_098_344)).toEqual({
            total: 1_098_300,
            roundOff: -44
        });
        (0, _vitest.expect)((0, _billinglogic.roundToRupee)(8_439_360)).toEqual({
            total: 8_439_400,
            roundOff: 40
        });
    });
    (0, _vitest.it)('a promo discount is applied before GST and shows as its own line', ()=>{
        const promo = {
            code: 'DIWALI20',
            description: '20% off next renewal',
            percentOff: 20
        };
        const t = (0, _billinglogic.totalsFor)([
            (0, _billinglogic.periodLine)('YEARLY', 50)
        ], '24', promo);
        (0, _vitest.expect)(t.discountPaise).toBe(1_430_400);
        (0, _vitest.expect)(t.taxablePaise).toBe(5_721_600);
        (0, _vitest.expect)(t.cgstPaise).toBe(514_944);
        (0, _vitest.expect)(t.lines.at(-1)).toMatchObject({
            kind: 'DISCOUNT',
            amountPaise: -1_430_400
        });
        (0, _vitest.expect)((0, _billinglogic.discountFor)(1000, {
            code: 'X',
            description: '',
            amountOffPaise: 5000
        })).toBe(1000);
    });
    (0, _vitest.it)('invoice numbers: LXS/{FY}/{0000}', ()=>{
        (0, _vitest.expect)((0, _billinglogic.invoiceNumber)('2026-27', 1)).toBe('LXS/26-27/0001');
        (0, _vitest.expect)((0, _billinglogic.invoiceNumber)('2026-27', 42)).toBe('LXS/26-27/0042');
    });
});
(0, _vitest.describe)('Seat proration', ()=>{
    (0, _vitest.it)('yearly, add 5 seats with 182 of 365 days left → ₹4,457.75 + GST', ()=>{
        (0, _vitest.expect)((0, _billinglogic.prorationPaise)(50, 55, 'YEARLY', 182, 365)).toBe(445_775);
    });
    (0, _vitest.it)('only seats above the free 10 are prorated; reductions cost nothing', ()=>{
        (0, _vitest.expect)((0, _billinglogic.prorationPaise)(5, 8, 'YEARLY', 100, 365)).toBe(0);
        (0, _vitest.expect)((0, _billinglogic.prorationPaise)(8, 15, 'MONTHLY', 30, 30)).toBe(5 * 17900);
        (0, _vitest.expect)((0, _billinglogic.prorationPaise)(50, 40, 'YEARLY', 100, 365)).toBe(0);
    });
    (0, _vitest.it)('days are whole IST days', ()=>{
        (0, _vitest.expect)((0, _billinglogic.daysInclusive)(ist('2026-09-29T10:00:00'), ist('2026-10-12T00:00:00'))).toBe(13);
        (0, _vitest.expect)((0, _billinglogic.daysUntil)(ist('2026-10-06T23:00:00'), ist('2026-09-29T08:00:00'))).toBe(7);
    });
});
(0, _vitest.describe)('Promo codes', ()=>{
    const now = ist('2026-09-29T12:00:00');
    const promo = {
        code: 'DIWALI20',
        active: true,
        validFrom: ist('2026-09-01T00:00:00'),
        validUntil: ist('2026-11-30T23:59:59'),
        planCodes: [
            'GROWTH'
        ],
        cycles: [],
        maxRedemptions: 500,
        redeemedCount: 3
    };
    const base = {
        now,
        planCode: 'GROWTH',
        cycle: 'YEARLY',
        alreadyRedeemed: false
    };
    (0, _vitest.it)('valid code', ()=>(0, _vitest.expect)((0, _billinglogic.validatePromo)(promo, base)).toEqual({
            ok: true
        }));
    (0, _vitest.it)('unknown code', ()=>(0, _vitest.expect)((0, _billinglogic.validatePromo)(null, base)).toMatchObject({
            ok: false,
            status: 404,
            code: 'PROMO_NOT_FOUND'
        }));
    (0, _vitest.it)('expired or not yet valid', ()=>{
        (0, _vitest.expect)((0, _billinglogic.validatePromo)({
            ...promo,
            validUntil: ist('2026-08-31T23:59:59')
        }, base)).toMatchObject({
            code: 'PROMO_EXPIRED'
        });
        (0, _vitest.expect)((0, _billinglogic.validatePromo)({
            ...promo,
            validFrom: ist('2026-10-01T00:00:00')
        }, base)).toMatchObject({
            code: 'PROMO_EXPIRED'
        });
        (0, _vitest.expect)((0, _billinglogic.validatePromo)({
            ...promo,
            active: false
        }, base)).toMatchObject({
            code: 'PROMO_EXPIRED'
        });
    });
    (0, _vitest.it)('re-applying the same code → "Already used"', ()=>{
        (0, _vitest.expect)((0, _billinglogic.validatePromo)(promo, {
            ...base,
            alreadyRedeemed: true
        })).toMatchObject({
            status: 409,
            message: 'Already used'
        });
    });
    (0, _vitest.it)('redemption limit', ()=>{
        (0, _vitest.expect)((0, _billinglogic.validatePromo)({
            ...promo,
            redeemedCount: 500
        }, base)).toMatchObject({
            code: 'PROMO_EXHAUSTED'
        });
    });
    (0, _vitest.it)('a Free workspace may hold a Growth promo until it upgrades; other plans are refused', ()=>{
        (0, _vitest.expect)((0, _billinglogic.validatePromo)(promo, {
            ...base,
            planCode: 'FREE',
            cycle: null
        })).toEqual({
            ok: true
        });
        (0, _vitest.expect)((0, _billinglogic.validatePromo)(promo, {
            ...base,
            planCode: 'ENTERPRISE'
        })).toMatchObject({
            code: 'PROMO_NOT_FOR_PLAN'
        });
    });
    (0, _vitest.it)('cycle-restricted codes', ()=>{
        const monthly = {
            ...promo,
            cycles: [
                'MONTHLY'
            ]
        };
        (0, _vitest.expect)((0, _billinglogic.validatePromo)(monthly, base)).toMatchObject({
            code: 'PROMO_NOT_FOR_CYCLE',
            message: 'This promo code isn’t valid for yearly billing'
        });
        (0, _vitest.expect)((0, _billinglogic.validatePromo)(monthly, {
            ...base,
            cycle: 'MONTHLY'
        })).toEqual({
            ok: true
        });
    });
});
(0, _vitest.describe)('Platform metrics', ()=>{
    const subs = [
        {
            planCode: 'GROWTH',
            cycle: 'YEARLY',
            status: 'ACTIVE',
            quantity: 240,
            unitPaise: 14900
        },
        {
            planCode: 'GROWTH',
            cycle: 'MONTHLY',
            status: 'PAST_DUE',
            quantity: 62,
            unitPaise: 17900
        },
        {
            planCode: 'FREE',
            cycle: null,
            status: 'FREE',
            quantity: 10
        },
        {
            planCode: 'INTERNAL',
            cycle: null,
            status: 'ACTIVE',
            quantity: 128
        },
        {
            planCode: 'GROWTH',
            cycle: 'YEARLY',
            status: 'CANCELLED',
            quantity: 30
        },
        {
            planCode: 'ENTERPRISE',
            cycle: null,
            status: 'ACTIVE',
            quantity: 400,
            contractPaisePerYear: 120_000_000
        }
    ];
    (0, _vitest.it)('MRR counts active / past-due paid plans; Enterprise as contract ÷ 12; Free, Internal and cancelled are 0', ()=>{
        (0, _vitest.expect)((0, _billinglogic.mrrPaise)(subs)).toBe(230 * 14900 + 52 * 17900 + 10_000_000);
    });
    (0, _vitest.it)('seats billed = purchased seats on paid, billable subscriptions', ()=>{
        (0, _vitest.expect)((0, _billinglogic.seatsBilled)(subs)).toBe(240 + 62 + 400);
    });
    (0, _vitest.it)('Δ% vs 30 days ago', ()=>{
        (0, _vitest.expect)((0, _billinglogic.pctChange)(108, 100)).toBe(8);
        (0, _vitest.expect)((0, _billinglogic.pctChange)(100, null)).toBeNull();
    });
    (0, _vitest.it)('plan labels', ()=>{
        (0, _vitest.expect)((0, _billinglogic.planLabel)('GROWTH', 'YEARLY')).toBe('Growth · yearly');
        (0, _vitest.expect)((0, _billinglogic.planLabel)('GROWTH', 'MONTHLY')).toBe('Growth · monthly');
        (0, _vitest.expect)((0, _billinglogic.planLabel)('FREE', null)).toBe('Free');
        (0, _vitest.expect)((0, _billinglogic.planLabel)('INTERNAL', null)).toBe('Internal');
    });
    (0, _vitest.it)('renewal reminders at T-30 (yearly only), T-7 and T-1', ()=>{
        (0, _vitest.expect)((0, _billinglogic.reminderDue)('YEARLY', 30)).toBe(true);
        (0, _vitest.expect)((0, _billinglogic.reminderDue)('MONTHLY', 30)).toBe(false);
        (0, _vitest.expect)((0, _billinglogic.reminderDue)('MONTHLY', 7)).toBe(true);
        (0, _vitest.expect)((0, _billinglogic.reminderDue)('YEARLY', 1)).toBe(true);
        (0, _vitest.expect)((0, _billinglogic.reminderDue)('YEARLY', 3)).toBe(false);
    });
});
(0, _vitest.describe)('Plan cards', ()=>{
    (0, _vitest.it)('Free workspace: Current plan / Upgrade / Contact sales', ()=>{
        const c = (0, _shared.planCtas)('FREE');
        (0, _vitest.expect)([
            c.FREE.label,
            c.GROWTH.label,
            c.ENTERPRISE.label
        ]).toEqual([
            'Current plan',
            'Upgrade',
            'Contact sales'
        ]);
        (0, _vitest.expect)(c.GROWTH.action).toBe('checkout');
        (0, _vitest.expect)(c.FREE.disabled).toBe(true);
    });
    (0, _vitest.it)('Growth workspace: Downgrade / Current plan · renew / Contact sales; a scheduled downgrade can be cancelled', ()=>{
        const c = (0, _shared.planCtas)('GROWTH');
        (0, _vitest.expect)([
            c.FREE.label,
            c.GROWTH.label,
            c.ENTERPRISE.label
        ]).toEqual([
            'Downgrade',
            'Current plan · renew',
            'Contact sales'
        ]);
        (0, _vitest.expect)((0, _shared.planCtas)('GROWTH', true).FREE).toMatchObject({
            label: 'Cancel downgrade',
            action: 'cancel-downgrade'
        });
    });
    (0, _vitest.it)('Enterprise workspace: Free and Growth disabled', ()=>{
        const c = (0, _shared.planCtas)('ENTERPRISE');
        (0, _vitest.expect)(c.FREE.disabled && c.GROWTH.disabled).toBe(true);
        (0, _vitest.expect)(c.ENTERPRISE).toMatchObject({
            label: 'Current plan',
            current: true
        });
    });
});
(0, _vitest.describe)('Billing details', ()=>{
    (0, _vitest.it)('validates the GSTIN and its state code', ()=>{
        (0, _vitest.expect)(_shared.billingProfileSchema.safeParse({
            legalName: 'Lexisora Infotech Pvt Ltd',
            gstin: '24AAECL1234F1Z5',
            stateCode: '24'
        }).success).toBe(true);
        (0, _vitest.expect)(_shared.billingProfileSchema.safeParse({
            legalName: 'Lexisora',
            gstin: '24AAECL1234F1Z5',
            stateCode: '27'
        }).success).toBe(false);
        (0, _vitest.expect)(_shared.billingProfileSchema.safeParse({
            legalName: 'Lexisora',
            gstin: 'NOT-A-GSTIN',
            stateCode: '24'
        }).success).toBe(false);
        (0, _vitest.expect)(_shared.billingProfileSchema.parse({
            legalName: 'Bluepeak',
            gstin: '',
            stateCode: '27'
        }).gstin).toBeNull();
    });
});

//# sourceMappingURL=billing.logic.spec.js.map