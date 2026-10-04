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
    get MAX_DAYS_AHEAD () {
        return MAX_DAYS_AHEAD;
    },
    get MAX_HOST_OVERLAPS () {
        return MAX_HOST_OVERLAPS;
    },
    get PAST_GRACE_MIN () {
        return PAST_GRACE_MIN;
    },
    get SHORT_CODE_ALPHABET () {
        return SHORT_CODE_ALPHABET;
    },
    get SLOT_MIN () {
        return SLOT_MIN;
    },
    get bookingIcs () {
        return bookingIcs;
    },
    get bookingProblem () {
        return bookingProblem;
    },
    get bookingTone () {
        return bookingTone;
    },
    get findConflict () {
        return findConflict;
    },
    get hostOverlapProblem () {
        return hostOverlapProblem;
    },
    get isPassValidAt () {
        return isPassValidAt;
    },
    get newPassToken () {
        return newPassToken;
    },
    get newShortCode () {
        return newShortCode;
    },
    get overlaps () {
        return overlaps;
    },
    get parsePassCode () {
        return parsePassCode;
    },
    get passToast () {
        return passToast;
    },
    get passWindow () {
        return passWindow;
    },
    get timeRange () {
        return timeRange;
    },
    get visitorCode () {
        return visitorCode;
    },
    get visitorTimeLabel () {
        return visitorTimeLabel;
    },
    get visitorTone () {
        return visitorTone;
    },
    get waLink () {
        return waLink;
    },
    get waNumber () {
        return waNumber;
    }
});
const _nodecrypto = require("node:crypto");
const _dates = require("../common/dates");
const SLOT_MIN = 15;
const MAX_DAYS_AHEAD = 60;
const PAST_GRACE_MIN = 5;
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function overlaps(a, b) {
    return a.startAt.getTime() < b.endAt.getTime() && b.startAt.getTime() < a.endAt.getTime();
}
function findConflict(existing, candidate, excludeId) {
    return existing.find((b)=>b.status === 'BOOKED' && b.id !== excludeId && overlaps(b, candidate)) ?? null;
}
const toMin = (hhmm)=>{
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};
function bookingProblem(p, room, now = new Date()) {
    const from = toMin(p.from);
    const to = toMin(p.to);
    if (from % SLOT_MIN || to % SLOT_MIN) return 'Pick times in 15-minute steps';
    if (to <= from) return 'End time must be after the start time';
    if (to - from < SLOT_MIN) return 'Book at least 15 minutes';
    if (to - from > room.maxBookingMins) return `${room.name} can be booked for at most ${Math.round(room.maxBookingMins / 60)} hours`;
    if (from < toMin(room.openFrom) || to > toMin(room.openTo)) return `${room.name} is open ${room.openFrom} – ${room.openTo}`;
    const start = (0, _dates.istInstant)(p.date, p.from);
    if (start.getTime() < now.getTime() - PAST_GRACE_MIN * 60_000) return 'That time has already passed';
    if (start.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) return 'Rooms can be booked up to 60 days ahead';
    return null;
}
function timeRange(from, to) {
    return `${from} – ${to}`;
}
function passWindow(dateKey, expectedTime) {
    const expected = (0, _dates.istInstant)(dateKey, expectedTime);
    return {
        validFrom: new Date(expected.getTime() - 2 * 3_600_000),
        validUntil: new Date((0, _dates.istInstant)(dateKey, '23:59').getTime() + 59_000)
    };
}
function isPassValidAt(v, at = new Date()) {
    return !v.passRevokedAt && at.getTime() >= v.validFrom.getTime() && at.getTime() <= v.validUntil.getTime();
}
function newShortCode(len = 6) {
    let s = '';
    for(let i = 0; i < len; i++)s += SHORT_CODE_ALPHABET[(0, _nodecrypto.randomInt)(SHORT_CODE_ALPHABET.length)];
    return s;
}
function newPassToken() {
    return (0, _nodecrypto.randomBytes)(24).toString('base64url');
}
function parsePassCode(input) {
    const s = input.trim();
    const fromUrl = /\/pass\/([A-Za-z0-9_-]{16,})/.exec(s);
    if (fromUrl) return {
        token: fromUrl[1]
    };
    const code = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length === 6) return {
        shortCode: code
    };
    if (/^[A-Za-z0-9_-]{16,}$/.test(s)) return {
        token: s
    };
    return {
        shortCode: code
    };
}
function waNumber(phone) {
    if (!phone) return null;
    const d = phone.replace(/\D/g, '');
    const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
    return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null;
}
function waLink(phone, text) {
    const n = waNumber(phone);
    return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
function passToast(delivered) {
    const wa = delivered.includes('WHATSAPP');
    const em = delivered.includes('EMAIL');
    if (wa && em) return 'E-pass sent on WhatsApp and email';
    if (wa) return 'E-pass sent on WhatsApp';
    if (em) return 'E-pass sent by email';
    return 'E-pass ready to share';
}
const visitorCode = (n)=>`VIS-${String(n).padStart(4, '0')}`;
const MAX_HOST_OVERLAPS = 3;
function hostOverlapProblem(hostBookings, candidate, excludeId) {
    const n = hostBookings.filter((b)=>b.status === 'BOOKED' && b.id !== excludeId && overlaps(b, candidate)).length;
    return n >= MAX_HOST_OVERLAPS ? `You already have ${MAX_HOST_OVERLAPS} bookings at that time` : null;
}
function bookingTone(status) {
    return status === 'BOOKED' ? 'accent' : 'neutral';
}
function visitorTone(status) {
    if (status === 'CHECKED_IN') return 'accent';
    if (status === 'REGISTERED' || status === 'PASS_SENT') return 'outline';
    return 'neutral';
}
const icsStamp = (d)=>d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s)=>s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function bookingIcs(p) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Lexisora HRMS//Rooms//EN',
        `METHOD:${p.method}`,
        'BEGIN:VEVENT',
        `UID:${p.uid}`,
        `SEQUENCE:${p.sequence ?? 0}`,
        `DTSTAMP:${icsStamp(p.now ?? new Date())}`,
        `DTSTART:${icsStamp(p.startAt)}`,
        `DTEND:${icsStamp(p.endAt)}`,
        `SUMMARY:${icsText(p.summary)}`,
        `LOCATION:${icsText(p.location)}`,
        `ORGANIZER;CN=${icsText(p.organizer.name)}:mailto:${p.organizer.email}`,
        ...p.attendees.map((a)=>`ATTENDEE;CN=${icsText(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`),
        `STATUS:${p.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ];
    return lines.join('\r\n');
}
function visitorTimeLabel(expected, inAt, outAt) {
    return [
        expected,
        inAt ? `in ${inAt}` : null,
        outAt ? `out ${outAt}` : null
    ].filter(Boolean).join(' · ');
}

//# sourceMappingURL=facility.rules.js.map