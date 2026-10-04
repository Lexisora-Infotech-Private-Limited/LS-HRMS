"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _shared = require("@lexisora/shared");
const _supportlogic = require("./support.logic");
const ist = (s)=>new Date(`${s}+05:30`);
const istIso = (d)=>new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16);
(0, _vitest.describe)('Business hours (Mon–Sat 09:00–19:00 IST)', ()=>{
    (0, _vitest.it)('adds within the same day', ()=>{
        // Tue 29 Sep 2026 10:12 + 4 business hours → 14:12 (SUP-221, High on Growth).
        (0, _vitest.expect)(istIso((0, _supportlogic.addBusinessMinutes)(ist('2026-09-29T10:12:00'), 240))).toBe('2026-09-29T14:12');
    });
    (0, _vitest.it)('rolls past closing time into the next working day', ()=>{
        // Tue 17:30 + 4h → 1.5h Tue + 2.5h Wed → Wed 11:30.
        (0, _vitest.expect)(istIso((0, _supportlogic.addBusinessMinutes)(ist('2026-09-29T17:30:00'), 240))).toBe('2026-09-30T11:30');
    });
    (0, _vitest.it)('skips Sunday', ()=>{
        // Sat 3 Oct 18:00 + 4h → 1h Sat + 3h Mon → Mon 5 Oct 12:00.
        (0, _vitest.expect)(istIso((0, _supportlogic.addBusinessMinutes)(ist('2026-10-03T18:00:00'), 240))).toBe('2026-10-05T12:00');
    });
    (0, _vitest.it)('a request opened before hours or on Sunday starts the clock at 09:00', ()=>{
        (0, _vitest.expect)(istIso((0, _supportlogic.addBusinessMinutes)(ist('2026-09-29T06:00:00'), 60))).toBe('2026-09-29T10:00');
        (0, _vitest.expect)(istIso((0, _supportlogic.addBusinessMinutes)(ist('2026-10-04T12:00:00'), 60))).toBe('2026-10-05T10:00');
    });
});
(0, _vitest.describe)('SLA targets', ()=>{
    (0, _vitest.it)('Growth: 4 business hours / 1 business day / 3 business days', ()=>{
        (0, _vitest.expect)((0, _supportlogic.slaPolicy)('GROWTH', 'HIGH')).toMatchObject({
            minutes: 240,
            business: true
        });
        (0, _vitest.expect)((0, _supportlogic.slaPolicy)('GROWTH', 'MEDIUM')).toMatchObject({
            minutes: 600,
            label: '1 business day'
        });
        (0, _vitest.expect)((0, _supportlogic.slaPolicy)('GROWTH', 'LOW')).toMatchObject({
            minutes: 1800
        });
    });
    (0, _vitest.it)('Enterprise / Internal: 24/7 wall clock for High and Medium', ()=>{
        (0, _vitest.expect)((0, _supportlogic.slaPolicy)('ENTERPRISE', 'HIGH')).toMatchObject({
            minutes: 60,
            business: false
        });
        // Sunday 23:30 + 1 hour wall clock → Monday 00:30.
        (0, _vitest.expect)(istIso((0, _supportlogic.firstResponseDue)('ENTERPRISE', 'HIGH', ist('2026-10-04T23:30:00')))).toBe('2026-10-05T00:30');
        (0, _vitest.expect)((0, _supportlogic.slaPolicy)('INTERNAL', 'MEDIUM')).toMatchObject({
            minutes: 240,
            business: false
        });
    });
    (0, _vitest.it)('Free: best effort within 3 business days', ()=>{
        (0, _vitest.expect)((0, _supportlogic.slaPolicy)('FREE', 'HIGH').label).toContain('best effort');
        (0, _vitest.expect)((0, _supportlogic.slaHint)('FREE')).toContain('Upgrade to Growth');
        (0, _vitest.expect)((0, _supportlogic.slaHint)('GROWTH')).toContain('4 business hours');
    });
    (0, _vitest.it)('breach = no first response by the due time', ()=>{
        const due = ist('2026-09-29T14:12:00');
        (0, _vitest.expect)((0, _supportlogic.slaBreached)({
            firstResponseDueAt: due,
            firstRespondedAt: null,
            status: 'ENGINEER_ASSIGNED'
        }, ist('2026-09-29T15:00:00'))).toBe(true);
        (0, _vitest.expect)((0, _supportlogic.slaBreached)({
            firstResponseDueAt: due,
            firstRespondedAt: ist('2026-09-29T10:41:00'),
            status: 'IN_PROGRESS'
        }, ist('2026-09-30T15:00:00'))).toBe(false);
        (0, _vitest.expect)((0, _supportlogic.slaBreached)({
            firstResponseDueAt: due,
            firstRespondedAt: null,
            status: 'OPEN'
        }, ist('2026-09-29T11:00:00'))).toBe(false);
    });
});
(0, _vitest.describe)('Ticket lifecycle', ()=>{
    (0, _vitest.it)('a customer reply on "Waiting on you" moves the ticket back to In progress', ()=>{
        (0, _vitest.expect)((0, _supportlogic.statusAfterCustomerReply)('WAITING_ON_CUSTOMER')).toBe('IN_PROGRESS');
        (0, _vitest.expect)((0, _supportlogic.statusAfterCustomerReply)('ENGINEER_ASSIGNED')).toBe('ENGINEER_ASSIGNED');
    });
    (0, _vitest.it)('reopen within 7 days of resolution; after 8 days it is refused', ()=>{
        const resolvedAt = ist('2026-09-21T15:00:00');
        (0, _vitest.expect)((0, _supportlogic.canReopen)({
            status: 'RESOLVED',
            resolvedAt
        }, ist('2026-09-27T15:00:00'))).toBe(true);
        (0, _vitest.expect)((0, _supportlogic.canReopen)({
            status: 'CLOSED',
            resolvedAt
        }, ist('2026-09-28T14:00:00'))).toBe(true);
        (0, _vitest.expect)((0, _supportlogic.canReopen)({
            status: 'RESOLVED',
            resolvedAt
        }, ist('2026-09-29T15:00:00'))).toBe(false);
        (0, _vitest.expect)((0, _supportlogic.canReopen)({
            status: 'IN_PROGRESS',
            resolvedAt: null
        })).toBe(false);
    });
    (0, _vitest.it)('Lexisora staff transitions follow the state machine', ()=>{
        (0, _vitest.expect)((0, _supportlogic.canTransition)('OPEN', 'ENGINEER_ASSIGNED')).toBe(true);
        (0, _vitest.expect)((0, _supportlogic.canTransition)('IN_PROGRESS', 'WAITING_ON_CUSTOMER')).toBe(true);
        (0, _vitest.expect)((0, _supportlogic.canTransition)('RESOLVED', 'CLOSED')).toBe(true);
        (0, _vitest.expect)((0, _supportlogic.canTransition)('CLOSED', 'IN_PROGRESS')).toBe(false);
        (0, _vitest.expect)((0, _supportlogic.canTransition)('IN_PROGRESS', 'OPEN')).toBe(false);
    });
    (0, _vitest.it)('status copy and tones (wireframe: !Engineer assigned, ~Resolved)', ()=>{
        (0, _vitest.expect)(_shared.SUPPORT_STATUS_LABELS.ENGINEER_ASSIGNED).toBe('Engineer assigned');
        (0, _vitest.expect)(_shared.SUPPORT_STATUS_LABELS.WAITING_ON_CUSTOMER).toBe('Waiting on you');
        (0, _vitest.expect)((0, _shared.supportStatusTone)('ENGINEER_ASSIGNED')).toBe('outline');
        (0, _vitest.expect)((0, _shared.supportStatusTone)('RESOLVED')).toBe('accent');
        (0, _vitest.expect)((0, _shared.supportStatusTone)('CLOSED')).toBe('neutral');
    });
    (0, _vitest.it)('validates the New support request form', ()=>{
        (0, _vitest.expect)(_shared.createSupportTicketSchema.safeParse({
            subject: 'SSO',
            description: 'x'
        }).success).toBe(false);
        (0, _vitest.expect)(_shared.createSupportTicketSchema.parse({
            subject: 'SSO login failing for 3 users',
            description: 'Since this morning.'
        })).toMatchObject({
            severity: 'MEDIUM',
            category: 'TECHNICAL'
        });
    });
});

//# sourceMappingURL=support.logic.spec.js.map