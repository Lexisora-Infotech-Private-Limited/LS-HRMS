"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _facilityrules = require("./facility.rules");
const _dates = require("../common/dates");
const t = (hm, day = '2026-09-30')=>(0, _dates.istInstant)(day, hm);
const iv = (from, to, day)=>({
        startAt: t(from, day),
        endAt: t(to, day)
    });
const room = {
    name: 'Board room',
    openFrom: '08:00',
    openTo: '21:00',
    maxBookingMins: 240
};
const NOW = new Date('2026-09-29T04:10:00Z'); // Tue 29 Sep 2026, 09:40 IST
(0, _vitest.describe)('room booking overlap (half-open intervals)', ()=>{
    (0, _vitest.it)('detects real overlaps', ()=>{
        (0, _vitest.expect)((0, _facilityrules.overlaps)(iv('11:00', '12:00'), iv('11:30', '12:30'))).toBe(true);
        (0, _vitest.expect)((0, _facilityrules.overlaps)(iv('11:00', '12:00'), iv('10:00', '13:00'))).toBe(true);
        (0, _vitest.expect)((0, _facilityrules.overlaps)(iv('11:00', '12:00'), iv('11:15', '11:45'))).toBe(true);
    });
    (0, _vitest.it)('back-to-back bookings do not overlap', ()=>{
        (0, _vitest.expect)((0, _facilityrules.overlaps)(iv('11:00', '12:00'), iv('12:00', '13:00'))).toBe(false);
        (0, _vitest.expect)((0, _facilityrules.overlaps)(iv('11:00', '12:00'), iv('10:00', '11:00'))).toBe(false);
    });
    (0, _vitest.it)('different days never overlap', ()=>{
        (0, _vitest.expect)((0, _facilityrules.overlaps)(iv('11:00', '12:00', '2026-09-30'), iv('11:00', '12:00', '2026-10-01'))).toBe(false);
    });
    (0, _vitest.it)('findConflict ignores cancelled bookings and the booking being edited', ()=>{
        const existing = [
            {
                id: 'a',
                status: 'CANCELLED',
                ...iv('11:00', '12:00')
            },
            {
                id: 'b',
                status: 'BOOKED',
                ...iv('11:30', '12:30')
            }
        ];
        (0, _vitest.expect)((0, _facilityrules.findConflict)(existing, iv('11:00', '11:30'))).toBeNull();
        (0, _vitest.expect)((0, _facilityrules.findConflict)(existing, iv('11:00', '12:00'))?.id).toBe('b');
        (0, _vitest.expect)((0, _facilityrules.findConflict)(existing, iv('11:00', '12:00'), 'b')).toBeNull();
    });
    (0, _vitest.it)('limits a host to 3 overlapping bookings across rooms', ()=>{
        const mine = [
            'a',
            'b',
            'c'
        ].map((id)=>({
                id,
                status: 'BOOKED',
                ...iv('15:00', '16:00')
            }));
        (0, _vitest.expect)((0, _facilityrules.hostOverlapProblem)(mine.slice(0, 2), iv('15:00', '15:30'))).toBeNull();
        (0, _vitest.expect)((0, _facilityrules.hostOverlapProblem)(mine, iv('15:00', '15:30'))).toMatch(/already have 3 bookings/);
        (0, _vitest.expect)((0, _facilityrules.hostOverlapProblem)(mine, iv('15:00', '15:30'), 'a')).toBeNull();
    });
});
(0, _vitest.describe)('booking validation', ()=>{
    const ok = {
        date: '2026-09-30',
        from: '11:00',
        to: '12:00'
    };
    (0, _vitest.it)('accepts the wireframe booking', ()=>(0, _vitest.expect)((0, _facilityrules.bookingProblem)(ok, room, NOW)).toBeNull());
    (0, _vitest.it)('needs 15-minute steps', ()=>(0, _vitest.expect)((0, _facilityrules.bookingProblem)({
            ...ok,
            to: '11:50'
        }, room, NOW)).toBe('Pick times in 15-minute steps'));
    (0, _vitest.it)('needs the end after the start', ()=>(0, _vitest.expect)((0, _facilityrules.bookingProblem)({
            ...ok,
            to: '10:00'
        }, room, NOW)).toBe('End time must be after the start time'));
    (0, _vitest.it)('caps the duration at the room maximum', ()=>(0, _vitest.expect)((0, _facilityrules.bookingProblem)({
            ...ok,
            from: '09:00',
            to: '13:15'
        }, room, NOW)).toMatch(/at most 4 hours/));
    (0, _vitest.it)('stays inside the open window', ()=>(0, _vitest.expect)((0, _facilityrules.bookingProblem)({
            ...ok,
            from: '20:30',
            to: '21:30'
        }, room, NOW)).toBe('Board room is open 08:00 – 21:00'));
    (0, _vitest.it)('rejects the past (5 minutes of grace)', ()=>{
        (0, _vitest.expect)((0, _facilityrules.bookingProblem)({
            date: '2026-09-29',
            from: '09:00',
            to: '09:30'
        }, room, NOW)).toBe('That time has already passed');
        (0, _vitest.expect)((0, _facilityrules.bookingProblem)({
            date: '2026-09-29',
            from: '09:45',
            to: '10:00'
        }, room, NOW)).toBeNull();
    });
    (0, _vitest.it)('allows at most 60 days ahead', ()=>(0, _vitest.expect)((0, _facilityrules.bookingProblem)({
            date: '2026-12-15',
            from: '10:00',
            to: '11:00'
        }, room, NOW)).toBe('Rooms can be booked up to 60 days ahead'));
});
(0, _vitest.describe)('visitor e-pass', ()=>{
    (0, _vitest.it)('is valid from 2 hours before the expected time until 23:59 IST', ()=>{
        const w = (0, _facilityrules.passWindow)('2026-09-30', '10:45');
        (0, _vitest.expect)(w.validFrom.toISOString()).toBe('2026-09-30T03:15:00.000Z'); // 08:45 IST
        (0, _vitest.expect)(w.validUntil.toISOString()).toBe('2026-09-30T18:29:59.000Z'); // 23:59:59 IST
        const pass = {
            ...w,
            passRevokedAt: null
        };
        (0, _vitest.expect)((0, _facilityrules.isPassValidAt)(pass, t('08:44'))).toBe(false);
        (0, _vitest.expect)((0, _facilityrules.isPassValidAt)(pass, t('10:52'))).toBe(true);
        (0, _vitest.expect)((0, _facilityrules.isPassValidAt)({
            ...pass,
            passRevokedAt: new Date()
        }, t('10:52'))).toBe(false);
    });
    (0, _vitest.it)('short codes use the unambiguous alphabet', ()=>{
        for(let i = 0; i < 50; i++){
            const c = (0, _facilityrules.newShortCode)();
            (0, _vitest.expect)(c).toHaveLength(6);
            (0, _vitest.expect)([
                ...c
            ].every((ch)=>_facilityrules.SHORT_CODE_ALPHABET.includes(ch))).toBe(true);
            (0, _vitest.expect)(c).not.toMatch(/[01OIL]/);
        }
    });
    (0, _vitest.it)('parses scanned URLs, raw tokens and typed codes', ()=>{
        (0, _vitest.expect)((0, _facilityrules.parsePassCode)('https://acme.hrms.app/api/v1/facility/pass/abcDEF123_-xyz7890')).toEqual({
            token: 'abcDEF123_-xyz7890'
        });
        (0, _vitest.expect)((0, _facilityrules.parsePassCode)('nk7-q4m')).toEqual({
            shortCode: 'NK7Q4M'
        });
        (0, _vitest.expect)((0, _facilityrules.parsePassCode)('abcdefghijklmnopqrstu')).toEqual({
            token: 'abcdefghijklmnopqrstu'
        });
    });
    (0, _vitest.it)('builds wa.me links for Indian mobiles only', ()=>{
        (0, _vitest.expect)((0, _facilityrules.waNumber)('+91 98250 12345')).toBe('919825012345');
        (0, _vitest.expect)((0, _facilityrules.waNumber)('09825012345')).toBe('919825012345');
        (0, _vitest.expect)((0, _facilityrules.waNumber)('12345')).toBeNull();
        (0, _vitest.expect)((0, _facilityrules.waLink)('+919825012345', 'Hi Amit')).toBe('https://wa.me/919825012345?text=Hi%20Amit');
    });
    (0, _vitest.it)('toast copy follows the channels used', ()=>{
        (0, _vitest.expect)((0, _facilityrules.passToast)([
            'WHATSAPP'
        ])).toBe('E-pass sent on WhatsApp');
        (0, _vitest.expect)((0, _facilityrules.passToast)([
            'EMAIL'
        ])).toBe('E-pass sent by email');
        (0, _vitest.expect)((0, _facilityrules.passToast)([
            'WHATSAPP',
            'EMAIL'
        ])).toBe('E-pass sent on WhatsApp and email');
        (0, _vitest.expect)((0, _facilityrules.passToast)([])).toBe('E-pass ready to share');
    });
    (0, _vitest.it)('visitor log time and tag tone', ()=>{
        (0, _vitest.expect)((0, _facilityrules.visitorTimeLabel)('10:45', null, null)).toBe('10:45');
        (0, _vitest.expect)((0, _facilityrules.visitorTimeLabel)('10:45', '10:52', '12:10')).toBe('10:45 · in 10:52 · out 12:10');
        (0, _vitest.expect)((0, _facilityrules.visitorTone)('PASS_SENT')).toBe('outline');
        (0, _vitest.expect)((0, _facilityrules.visitorTone)('CHECKED_IN')).toBe('accent');
        (0, _vitest.expect)((0, _facilityrules.visitorTone)('CHECKED_OUT')).toBe('neutral');
    });
});
(0, _vitest.describe)('booking invite', ()=>{
    (0, _vitest.it)('renders an RFC 5545 request with organizer and attendees', ()=>{
        const ics = (0, _facilityrules.bookingIcs)({
            uid: 'b1@lx',
            method: 'REQUEST',
            ...iv('11:00', '12:00'),
            summary: 'Nimbus Retail review',
            location: 'Board room',
            organizer: {
                name: 'Rohit Verma',
                email: 'rohit@lexisora.in'
            },
            attendees: [
                {
                    name: 'Neha Kapoor',
                    email: 'neha@lexisora.in'
                }
            ],
            now: NOW
        });
        (0, _vitest.expect)(ics).toContain('METHOD:REQUEST');
        (0, _vitest.expect)(ics).toContain('DTSTART:20260930T053000Z');
        (0, _vitest.expect)(ics).toContain('DTEND:20260930T063000Z');
        (0, _vitest.expect)(ics).toContain('ATTENDEE;CN=Neha Kapoor;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:neha@lexisora.in');
        (0, _vitest.expect)((0, _facilityrules.bookingIcs)({
            uid: 'b1@lx',
            method: 'CANCEL',
            ...iv('11:00', '12:00'),
            summary: 'x',
            location: 'y',
            organizer: {
                name: 'a',
                email: 'a@x'
            },
            attendees: []
        })).toContain('STATUS:CANCELLED');
    });
});

//# sourceMappingURL=facility.spec.js.map